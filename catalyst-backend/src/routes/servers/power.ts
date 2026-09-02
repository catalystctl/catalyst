import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../../db.js";
import { describeError } from "../../utils/describe-error.js";
import { createAuditLog, buildServerAuditDetails } from "../../middleware/audit.js";
import { ServerState, ServerStateMachine, checkIsAdmin, ensureNotSuspended, ensureServerAccess, ensureSuspendPermission, injectPterodactylCompatibilityVars, normalizeHostIp, parseStoredPortBindings, patchTemplateForRuntime, resolveTemplateImage, syncPortEnvironmentVariables } from './_helpers.js';
import { emitServerOperationProgress } from "../../lib/server-operation-progress.js";
import { emitServerStatusEvent } from "../../plugins/host-events.js";

/** Default timeouts for power command acks from the agent. */
const POWER_ACK_TIMEOUT = {
  /** stop waits for graceful shutdown + container remove */
  stop: 60_000,
  /** kill is force path — usually faster */
  kill: 30_000,
  /** start/restart only wait for accept-ack; lifecycle finishes via server_state_update */
  start: 15_000,
  restart: 15_000,
} as const;

type PowerSendResult =
  | { mode: "acked"; result: any; requestId?: string }
  | { mode: "sent"; requestId?: string }
  | { mode: "timeout"; requestId?: string; error: Error }
  | { mode: "failed"; error: Error };

/**
 * Send a power command to the agent.
 *
 * Prefers requestFromAgent (agent echoes power_command_ack with the same
 * requestId). Falls back to sendToAgent when requestFromAgent is unavailable.
 *
 * Notes:
 * - stop/kill acks after the operation finishes on the agent.
 * - start/restart acks immediately on accept; final state arrives via
 *   server_state_update (already handled by the gateway).
 * - On timeout the command was still delivered — callers should treat that as
 *   async-in-progress rather than a hard failure.
 */
async function sendPowerCommand(
  gateway: any,
  nodeId: string,
  message: Record<string, unknown>,
  timeoutMs: number,
): Promise<PowerSendResult> {
  if (!gateway) {
    return { mode: "failed", error: new Error("WebSocket gateway not available") };
  }

  if (typeof gateway.requestFromAgent === "function") {
    try {
      const result = await gateway.requestFromAgent(nodeId, message, timeoutMs);
      const requestId =
        (result && typeof result.requestId === "string" && result.requestId) ||
        (typeof message.requestId === "string" ? message.requestId : undefined);
      if (result && result.success === false) {
        return {
          mode: "failed",
          error: new Error(
            typeof result.error === "string" && result.error
              ? result.error
              : "Agent rejected power command",
          ),
        };
      }
      return { mode: "acked", result, requestId };
    } catch (err: any) {
      const error = err instanceof Error ? err : new Error(describeError(err));
      const msg = error.message || "";
      if (msg.includes("timed out") || msg.includes("timeout")) {
        return { mode: "timeout", error };
      }
      return { mode: "failed", error };
    }
  }

  if (typeof gateway.sendToAgent === "function") {
    const success = await gateway.sendToAgent(nodeId, message);
    if (!success) {
      return { mode: "failed", error: new Error("Failed to send command to agent") };
    }
    return { mode: "sent" };
  }

  return { mode: "failed", error: new Error("WebSocket gateway not available") };
}

function powerFailureStatus(result: PowerSendResult): number {
  if (result.mode === "failed") {
    const msg = result.error.message || "";
    if (msg.includes("not connected") || msg.includes("Failed to send")) {
      return 503;
    }
    return 502;
  }
  return 502;
}

export async function serverPowerRoutes(app: FastifyInstance) {
  app.post(
    "/:serverId/install",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        include: {
          template: true,
          node: true,
        },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (!ensureNotSuspended(server, reply)) {
        return;
      }

      // Check permissions
      if (server.ownerId !== userId && !checkIsAdmin(request, "admin.write")) {
        const access = await prisma.serverAccess.findFirst({
          where: {
            userId,
            serverId,
            permissions: { has: "server.install" },
          },
        });
        // Node assignment alone must not grant power ops; require ServerAccess or admin.write/*
        if (!access) {
          return reply.status(403).send({ error: "Forbidden" });
        }
      }

      // Validate state transition
      const currentState = server.status as ServerState;
      if (!ServerStateMachine.canTransition(currentState, ServerState.INSTALLING)) {
        return reply.status(409).send({
          error: `Cannot install server in ${server.status} state`,
        });
      }

      // Check if node is online
      if (!server.node.isOnline) {
        return reply.status(503).send({ error: "Node is offline" });
      }

      // Send install command to agent via WebSocket
      const gateway = (app as any).wsGateway;
      if (!gateway) {
        return reply.status(500).send({ error: "WebSocket gateway not available" });
      }

      // Automatically add SERVER_DIR to environment (uses node's configured server data directory)
      const serverDir = server.node.serverDataDir || "/var/lib/catalyst/servers";
      const fullServerDir = `${serverDir}/${server.uuid}`;
      
      const templateVariables = (server.template.variables as any[]) || [];
      const templateDefaults = templateVariables.reduce((acc, variable) => {
        if (variable?.name && variable?.default !== undefined) {
          acc[variable.name] = String(variable.default);
        }
        return acc;
      }, {} as Record<string, string>);

      const environment = {
        ...templateDefaults,
        ...(server.environment as Record<string, string>),
        SERVER_DIR: fullServerDir,
      };
      if (server.template?.image) {
        const resolvedImage = resolveTemplateImage(server.template, environment);
        environment.TEMPLATE_IMAGE = resolvedImage;
      }
      if (server.primaryIp && !environment.CATALYST_NETWORK_IP) {
        environment.CATALYST_NETWORK_IP = server.primaryIp;
      }
      if (server.networkMode === "host" && !environment.CATALYST_NETWORK_IP) {
        try {
          environment.CATALYST_NETWORK_IP = normalizeHostIp(server.node.publicAddress) || "";
        } catch (error: any) {
          return reply.status(400).send({ error: error.message });
        }
      }
      if (server.subdomain && !environment.CATALYST_SUBDOMAIN) {
        environment.CATALYST_SUBDOMAIN = server.subdomain;
      }
      const runtimeTemplate = patchTemplateForRuntime(server.template);

      // Sync port environment variables with primaryPort
      const portBindings = parseStoredPortBindings(server.portBindings);
      let syncedEnvironment = syncPortEnvironmentVariables(
        environment,
        server.primaryPort,
        portBindings
      );
      syncedEnvironment = injectPterodactylCompatibilityVars(
        syncedEnvironment,
        {
          uuid: server.uuid,
          name: server.name,
          primaryIp: server.primaryIp,
          primaryPort: server.primaryPort,
          allocatedMemoryMb: server.allocatedMemoryMb,
          allocatedDiskMb: server.allocatedDiskMb,
          subdomain: server.subdomain,
        },
        portBindings,
        { startupCommand: runtimeTemplate.startup },
      );

      // Install is long-running — fire-and-forget with delivery check.
      // Final status arrives via server_state_update from the agent.
      const success = await gateway.sendToAgent(server.nodeId, {
        type: "install_server",
        serverId: server.id,
        serverUuid: server.uuid,
        template: runtimeTemplate,
        environment: syncedEnvironment,
        allocatedMemoryMb: server.allocatedMemoryMb,
        allocatedCpuCores: server.allocatedCpuCores,
        allocatedDiskMb: server.allocatedDiskMb,
        primaryPort: server.primaryPort,
        portBindings: portBindings,
      });

      if (!success) {
        return reply.status(503).send({ error: "Failed to send command to agent" });
      }

      // Update server status
      await prisma.server.update({
        where: { id: serverId },
        data: { status: "installing" },
      });

      await prisma.serverLog.create({
        data: {
          serverId: serverId,
          stream: "system",
          data: "Installation started.",
        },
      });

      emitServerOperationProgress((app as any).wsGateway, {
        serverId,
        operation: "install",
        stage: "Installation started",
        progress: 5,
        state: "installing",
      });

      // 202: accepted for async processing; completion via server_state_update
      reply.status(202).send({
        success: true,
        accepted: true,
        async: true,
        message: "Install command accepted; completion is asynchronous",
      });
    }
  );

  // Reinstall server (stops server, wipes data, runs install script)
  app.post(
    "/:serverId/reinstall",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        include: {
          template: true,
          node: true,
        },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (!ensureNotSuspended(server, reply)) {
        return;
      }

      // Check permissions
      if (server.ownerId !== userId && !checkIsAdmin(request, "admin.write")) {
        const access = await prisma.serverAccess.findFirst({
          where: {
            userId,
            serverId,
            permissions: { has: "server.reinstall" },
          },
        });
        // Node assignment alone must not grant power ops; require ServerAccess or admin.write/*
        if (!access) {
          return reply.status(403).send({ error: "Forbidden" });
        }
      }

      // Validate state transition
      const currentState = server.status as ServerState;
      if (!ServerStateMachine.canTransition(currentState, ServerState.INSTALLING)) {
        return reply.status(409).send({
          error: `Cannot reinstall server in ${server.status} state`,
        });
      }

      // Check if node is online
      if (!server.node.isOnline) {
        return reply.status(503).send({ error: "Node is offline" });
      }

      // Send reinstall command to agent via WebSocket
      const gateway = (app as any).wsGateway;
      if (!gateway) {
        return reply.status(500).send({ error: "WebSocket gateway not available" });
      }

      // Automatically add SERVER_DIR to environment
      const serverDir = server.node.serverDataDir || "/var/lib/catalyst/servers";
      const fullServerDir = `${serverDir}/${server.uuid}`;

      const templateVariables = (server.template.variables as any[]) || [];
      const templateDefaults = templateVariables.reduce((acc, variable) => {
        if (variable?.name && variable?.default !== undefined) {
          acc[variable.name] = String(variable.default);
        }
        return acc;
      }, {} as Record<string, string>);

      const environment = {
        ...templateDefaults,
        ...(server.environment as Record<string, string>),
        SERVER_DIR: fullServerDir,
      };
      if (server.template?.image) {
        const resolvedImage = resolveTemplateImage(server.template, environment);
        environment.TEMPLATE_IMAGE = resolvedImage;
      }
      if (server.primaryIp && !environment.CATALYST_NETWORK_IP) {
        environment.CATALYST_NETWORK_IP = server.primaryIp;
      }
      if (server.networkMode === "host" && !environment.CATALYST_NETWORK_IP) {
        try {
          environment.CATALYST_NETWORK_IP = normalizeHostIp(server.node.publicAddress) || "";
        } catch (error: any) {
          return reply.status(400).send({ error: error.message });
        }
      }
      if (server.subdomain && !environment.CATALYST_SUBDOMAIN) {
        environment.CATALYST_SUBDOMAIN = server.subdomain;
      }
      const runtimeTemplate = patchTemplateForRuntime(server.template);

      // Sync port environment variables with primaryPort
      const portBindings = parseStoredPortBindings(server.portBindings);
      let syncedEnvironment = syncPortEnvironmentVariables(
        environment,
        server.primaryPort,
        portBindings
      );
      syncedEnvironment = injectPterodactylCompatibilityVars(
        syncedEnvironment,
        {
          uuid: server.uuid,
          name: server.name,
          primaryIp: server.primaryIp,
          primaryPort: server.primaryPort,
          allocatedMemoryMb: server.allocatedMemoryMb,
          allocatedDiskMb: server.allocatedDiskMb,
          subdomain: server.subdomain,
        },
        portBindings,
        { startupCommand: runtimeTemplate.startup },
      );

      // Reinstall is long-running — fire-and-forget with delivery check.
      const success = await gateway.sendToAgent(server.nodeId, {
        type: "reinstall_server",
        serverId: server.id,
        serverUuid: server.uuid,
        template: runtimeTemplate,
        environment: syncedEnvironment,
        allocatedMemoryMb: server.allocatedMemoryMb,
        allocatedCpuCores: server.allocatedCpuCores,
        allocatedDiskMb: server.allocatedDiskMb,
        primaryPort: server.primaryPort,
        portBindings: portBindings,
      });

      if (!success) {
        return reply.status(503).send({ error: "Failed to send command to agent" });
      }

      // Update server status
      await prisma.server.update({
        where: { id: serverId },
        data: { status: "installing" },
      });

      await prisma.serverLog.create({
        data: {
          serverId: serverId,
          stream: "system",
          data: "Reinstallation started (data wipe + install).",
        },
      });

      emitServerOperationProgress((app as any).wsGateway, {
        serverId,
        operation: "reinstall",
        stage: "Reinstallation started",
        progress: 5,
        state: "installing",
      });

      reply.status(202).send({
        success: true,
        accepted: true,
        async: true,
        message: "Reinstall command accepted; completion is asynchronous",
      });
    }
  );

  // Respond to EULA prompt (accept or decline)
  app.post(
    "/eula",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId, accepted } = request.body as {
        serverId: string;
        accepted: boolean;
      };
      const userId = request.user.userId;

      if (!serverId || typeof accepted !== "boolean") {
        return reply.status(400).send({ error: "serverId (string) and accepted (boolean) are required" });
      }

      // Require ownership, ServerAccess with start (install flow), or admin.write/*
      // EULA is part of install/start lifecycle — treat as server.start capability.
      const server = await ensureServerAccess(serverId, userId, "server.start", reply);
      if (!server) {
        return;
      }

      // ensureServerAccess already checked suspension, but re-load node for sendToAgent
      const serverWithNode = await prisma.server.findUnique({
        where: { id: serverId },
        include: { node: true },
      });
      if (!serverWithNode) {
        return reply.status(404).send({ error: "Server not found" });
      }

      const gateway = (app as any).wsGateway;
      if (!gateway) {
        return reply.status(500).send({ error: "WebSocket gateway not available" });
      }

      const success = await gateway.sendToAgent(serverWithNode.nodeId, {
        type: accepted ? "accept_eula" : "decline_eula",
        serverId: serverWithNode.id,
        serverUuid: serverWithNode.uuid,
      });

      if (!success) {
        return reply.status(503).send({ error: "Failed to send command to agent" });
      }

      // Update server status
      await prisma.server.update({
        where: { id: serverId },
        data: { status: accepted ? "stopped" : "error" },
      });

      await prisma.serverLog.create({
        data: {
          serverId: serverId,
          stream: "system",
          data: accepted ? "EULA accepted." : "EULA declined.",
        },
      });

      reply.send({ success: true });
    }
  );

  // Rebuild server (stops server, removes container, recreates from image, preserves data)
  app.post(
    "/:serverId/rebuild",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        include: {
          template: true,
          node: true,
        },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (!ensureNotSuspended(server, reply)) {
        return;
      }

      // Check permissions
      if (server.ownerId !== userId && !checkIsAdmin(request, "admin.write")) {
        const access = await prisma.serverAccess.findFirst({
          where: {
            userId,
            serverId,
            permissions: { has: "server.rebuild" },
          },
        });
        // Node assignment alone must not grant power ops; require ServerAccess or admin.write/*
        if (!access) {
          return reply.status(403).send({ error: "Forbidden" });
        }
      }

      // Rebuild can work from STOPPED, RUNNING, ERROR, CRASHED states
      const currentState = server.status as ServerState;
      const allowedStates: ServerState[] = [
        ServerState.STOPPED,
        ServerState.RUNNING,
        ServerState.ERROR,
        ServerState.CRASHED,
      ];
      if (!allowedStates.includes(currentState)) {
        return reply.status(409).send({
          error: `Cannot rebuild server in ${server.status} state`,
        });
      }

      // Check if node is online
      if (!server.node.isOnline) {
        return reply.status(503).send({ error: "Node is offline" });
      }

      // Send rebuild command to agent via WebSocket
      const gateway = (app as any).wsGateway;
      if (!gateway) {
        return reply.status(500).send({ error: "WebSocket gateway not available" });
      }

      // Automatically add SERVER_DIR to environment
      const serverDir = server.node.serverDataDir || "/var/lib/catalyst/servers";
      const fullServerDir = `${serverDir}/${server.uuid}`;

      const templateVariables = (server.template.variables as any[]) || [];
      const templateDefaults = templateVariables.reduce((acc, variable) => {
        if (variable?.name && variable?.default !== undefined) {
          acc[variable.name] = String(variable.default);
        }
        return acc;
      }, {} as Record<string, string>);

      const environment = {
        ...templateDefaults,
        ...(server.environment as Record<string, string>),
        SERVER_DIR: fullServerDir,
      };
      if (server.template?.image) {
        const resolvedImage = resolveTemplateImage(server.template, environment);
        environment.TEMPLATE_IMAGE = resolvedImage;
      }
      if (server.primaryIp && !environment.CATALYST_NETWORK_IP) {
        environment.CATALYST_NETWORK_IP = server.primaryIp;
      }
      if (server.networkMode === "host" && !environment.CATALYST_NETWORK_IP) {
        try {
          environment.CATALYST_NETWORK_IP = normalizeHostIp(server.node.publicAddress) || "";
        } catch (error: any) {
          return reply.status(400).send({ error: error.message });
        }
      }
      if (server.subdomain && !environment.CATALYST_SUBDOMAIN) {
        environment.CATALYST_SUBDOMAIN = server.subdomain;
      }
      const runtimeTemplate = patchTemplateForRuntime(server.template);
      if (server.startupCommand) {
        runtimeTemplate.startup = server.startupCommand;
      }

      // Sync port environment variables with primaryPort
      const portBindings = parseStoredPortBindings(server.portBindings);
      let syncedEnvironment = syncPortEnvironmentVariables(
        environment,
        server.primaryPort,
        portBindings
      );
      syncedEnvironment = injectPterodactylCompatibilityVars(
        syncedEnvironment,
        {
          uuid: server.uuid,
          name: server.name,
          primaryIp: server.primaryIp,
          primaryPort: server.primaryPort,
          allocatedMemoryMb: server.allocatedMemoryMb,
          allocatedDiskMb: server.allocatedDiskMb,
          subdomain: server.subdomain,
        },
        portBindings,
        { startupCommand: runtimeTemplate.startup },
      );

      const success = await gateway.sendToAgent(server.nodeId, {
        type: "rebuild_server",
        serverId: server.id,
        serverUuid: server.uuid,
        template: runtimeTemplate,
        environment: syncedEnvironment,
        allocatedMemoryMb: server.allocatedMemoryMb,
        allocatedCpuCores: server.allocatedCpuCores,
        allocatedDiskMb: server.allocatedDiskMb,
        primaryPort: server.primaryPort,
        portBindings: portBindings,
        networkMode: server.networkMode,
      });

      if (!success) {
        return reply.status(503).send({ error: "Failed to send command to agent" });
      }

      await prisma.serverLog.create({
        data: {
          serverId: serverId,
          stream: "system",
          data: "Rebuild started (container recreation).",
        },
      });

      reply.send({ success: true, message: "Rebuild command sent to agent" });
    }
  );

  // Start server (sends start command to agent)
  app.post(
    "/:serverId/start",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        include: {
          template: true,
          node: true,
        },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (!ensureNotSuspended(server, reply)) {
        return;
      }

      // Check permissions
      if (server.ownerId !== userId && !checkIsAdmin(request, "admin.write")) {
        const access = await prisma.serverAccess.findFirst({
          where: {
            userId,
            serverId,
            permissions: { has: "server.start" },
          },
        });
        // Node assignment alone must not grant power ops; require ServerAccess or admin.write/*
        if (!access) {
          return reply.status(403).send({ error: "Forbidden" });
        }
      }

      // Validate state transition
      const currentState = server.status as ServerState;
      if (!ServerStateMachine.canStart(currentState)) {
        return reply.status(409).send({
          error: `Cannot start server in ${server.status} state. Server must be stopped or crashed.`,
        });
      }

      // Check if node is online
      if (!server.node.isOnline) {
        return reply.status(503).send({ error: "Node is offline" });
      }

      // Send start command to agent via WebSocket
      const gateway = (app as any).wsGateway;
      if (!gateway) {
        return reply.status(500).send({ error: "WebSocket gateway not available" });
      }

      // Automatically add SERVER_DIR to environment
      const serverDir = server.node.serverDataDir || "/var/lib/catalyst/servers";
      const fullServerDir = `${serverDir}/${server.uuid}`;
      
      const templateVariables = (server.template.variables as any[]) || [];
      const templateDefaults = templateVariables.reduce((acc, variable) => {
        if (variable?.name && variable?.default !== undefined) {
          acc[variable.name] = String(variable.default);
        }
        return acc;
      }, {} as Record<string, string>);

      const environment = {
        ...templateDefaults,
        ...(server.environment as Record<string, string>),
        SERVER_DIR: fullServerDir,
      };
      if (server.template?.image) {
        const resolvedImage = resolveTemplateImage(server.template, environment);
        environment.TEMPLATE_IMAGE = resolvedImage;
      }
      if (server.primaryIp && !environment.CATALYST_NETWORK_IP) {
        environment.CATALYST_NETWORK_IP = server.primaryIp;
      }
      if (server.networkMode === "host" && !environment.CATALYST_NETWORK_IP) {
        try {
          environment.CATALYST_NETWORK_IP = normalizeHostIp(server.node.publicAddress) || "";
        } catch (error: any) {
          return reply.status(400).send({ error: error.message });
        }
      }
      if (server.subdomain && !environment.CATALYST_SUBDOMAIN) {
        environment.CATALYST_SUBDOMAIN = server.subdomain;
      }
      const runtimeTemplate = patchTemplateForRuntime(server.template);
      if (server.startupCommand) {
        runtimeTemplate.startup = server.startupCommand;
      }

      // Sync port environment variables with primaryPort
      const portBindings = parseStoredPortBindings(server.portBindings);
      let syncedEnvironment = syncPortEnvironmentVariables(
        environment,
        server.primaryPort,
        portBindings
      );

      // Inject Pterodactyl-compatible env vars (SERVER_MEMORY, SERVER_PORT, …)
      syncedEnvironment = injectPterodactylCompatibilityVars(
        syncedEnvironment,
        {
          uuid: server.uuid,
          name: server.name,
          primaryIp: server.primaryIp,
          primaryPort: server.primaryPort,
          allocatedMemoryMb: server.allocatedMemoryMb,
          allocatedDiskMb: server.allocatedDiskMb,
          subdomain: server.subdomain,
        },
        portBindings,
        { startupCommand: runtimeTemplate.startup },
      );

      const powerResult = await sendPowerCommand(
        gateway,
        server.nodeId,
        {
          type: "start_server",
          serverId: server.id,
          serverUuid: server.uuid,
          template: runtimeTemplate,
          environment: syncedEnvironment,
          allocatedMemoryMb: server.allocatedMemoryMb,
          allocatedCpuCores: server.allocatedCpuCores,
          allocatedDiskMb: server.allocatedDiskMb,
          allocatedSwapMb: server.allocatedSwapMb,
          ioWeight: server.ioWeight,
          primaryPort: server.primaryPort,
          portBindings: portBindings,
          networkMode: server.networkMode,
          autoRestart: {
            enabled: server.restartPolicy !== "never",
            delay: 10,
            maxRestarts: server.maxCrashCount ?? 5,
            windowSecs: 60,
          },
        },
        POWER_ACK_TIMEOUT.start,
      );

      if (powerResult.mode === "failed") {
        return reply.status(powerFailureStatus(powerResult)).send({
          error: powerResult.error.message || "Failed to send command to agent",
        });
      }

      // Update server status optimistically; final state via server_state_update
      await prisma.server.update({
        where: { id: serverId },
        data: { status: "starting" },
      });
      emitServerStatusEvent(app, serverId, "starting", { action: "start" });

      await createAuditLog(userId, {
        action: "server.start",
        resource: "server",
        resourceId: serverId,
        request,
        details: buildServerAuditDetails(server, {
          powerResult: powerResult.mode,
          requestId: "requestId" in powerResult ? powerResult.requestId : undefined,
          allocatedMemoryMb: server.allocatedMemoryMb,
          allocatedCpuCores: server.allocatedCpuCores,
          allocatedDiskMb: server.allocatedDiskMb,
          networkMode: server.networkMode,
          primaryPort: server.primaryPort,
          newStatus: "starting",
        }),
      });

      if (powerResult.mode === "acked") {
        return reply.send({
          success: true,
          accepted: true,
          acked: true,
          requestId: powerResult.requestId,
          message: "Start command accepted by agent; completion is asynchronous",
        });
      }

      // timeout or legacy send: command was delivered (or we can't tell for legacy),
      // completion remains async via server_state_update.
      return reply.status(202).send({
        success: true,
        accepted: true,
        async: true,
        timedOutWaitingForAck: powerResult.mode === "timeout",
        requestId: "requestId" in powerResult ? powerResult.requestId : undefined,
        message:
          powerResult.mode === "timeout"
            ? "Start command sent; agent ack timed out — completion is asynchronous"
            : "Start command sent to agent; completion is asynchronous",
      });
    }
  );

  // Stop server (sends stop command to agent)
  app.post(
    "/:serverId/stop",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        include: {
          node: true,
          template: true,
        },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (!ensureNotSuspended(server, reply)) {
        return;
      }

      // Check permissions
      if (server.ownerId !== userId && !checkIsAdmin(request, "admin.write")) {
        const access = await prisma.serverAccess.findFirst({
          where: {
            userId,
            serverId,
            permissions: { has: "server.stop" },
          },
        });
        // Node assignment alone must not grant power ops; require ServerAccess or admin.write/*
        if (!access) {
          return reply.status(403).send({ error: "Forbidden" });
        }
      }

      // Validate state transition
      const currentState = server.status as ServerState;
      if (!ServerStateMachine.canStop(currentState)) {
        return reply.status(409).send({
          error: `Cannot stop server in ${server.status} state. Server must be running or starting.`,
        });
      }

      // If the server is crashed, the process is already dead — just set it to stopped directly
      if (currentState === ServerState.CRASHED) {
        await prisma.server.update({
          where: { id: serverId },
          data: { status: "stopped" },
        });
        await createAuditLog(userId, {
          action: "server.stop",
          resource: "server",
          resourceId: serverId,
          request,
          details: buildServerAuditDetails(server, {
            method: "mark_stopped",
            reason: "already_crashed",
            newStatus: "stopped",
          }),
        });
        return reply.send({ success: true, message: "Server marked as stopped" });
      }

      // Check if node is online
      if (!server.node.isOnline) {
        return reply.status(503).send({ error: "Node is offline" });
      }

      // Send stop command to agent via WebSocket
      const gateway = (app as any).wsGateway;
      if (!gateway) {
        return reply.status(500).send({ error: "WebSocket gateway not available" });
      }

      // Update server status BEFORE sending to agent to avoid race condition
      // where agent reports "stopped" before DB reflects "stopping"
      await prisma.server.update({
        where: { id: serverId },
        data: { status: "stopping" },
      });
      emitServerStatusEvent(app, serverId, "stopping", { action: "stop" });

      const powerResult = await sendPowerCommand(
        gateway,
        server.nodeId,
        {
          type: "stop_server",
          serverId: server.id,
          serverUuid: server.uuid,
          template: patchTemplateForRuntime(server.template),
        },
        POWER_ACK_TIMEOUT.stop,
      );

      if (powerResult.mode === "failed") {
        // Revert status since agent didn't accept/complete the command
        await prisma.server.update({
          where: { id: serverId },
          data: { status: server.status },
        });
        return reply.status(powerFailureStatus(powerResult)).send({
          error: powerResult.error.message || "Failed to send command to agent",
        });
      }

      await createAuditLog(userId, {
        action: "server.stop",
        resource: "server",
        resourceId: serverId,
        request,
        details: buildServerAuditDetails(server, {
          powerResult: powerResult.mode,
          requestId: "requestId" in powerResult ? powerResult.requestId : undefined,
          force: false,
          newStatus: "stopping",
        }),
      });

      if (powerResult.mode === "acked") {
        return reply.send({
          success: true,
          acked: true,
          requestId: powerResult.requestId,
          message: "Stop command completed by agent",
        });
      }

      // Timeout: command was delivered; final state via server_state_update
      return reply.status(202).send({
        success: true,
        accepted: true,
        async: true,
        timedOutWaitingForAck: powerResult.mode === "timeout",
        requestId: "requestId" in powerResult ? powerResult.requestId : undefined,
        message:
          powerResult.mode === "timeout"
            ? "Stop command sent; agent ack timed out — completion is asynchronous"
            : "Stop command sent to agent; completion is asynchronous",
      });
    }
  );

  // Kill server (force stop command to agent)
  app.post(
    "/:serverId/kill",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        include: {
          node: true,
          template: true,
        },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (!ensureNotSuspended(server, reply)) {
        return;
      }

      if (server.ownerId !== userId && !checkIsAdmin(request, "admin.write")) {
        const access = await prisma.serverAccess.findFirst({
          where: {
            userId,
            serverId,
            permissions: { has: "server.stop" },
          },
        });
        // Node assignment alone must not grant power ops; require ServerAccess or admin.write/*
        if (!access) {
          return reply.status(403).send({ error: "Forbidden" });
        }
      }

      const currentState = server.status as ServerState;
      const canKill =
        ServerStateMachine.canStop(currentState) || currentState === ServerState.STOPPING;
      if (!canKill) {
        return reply.status(409).send({
          error: `Cannot kill server in ${server.status} state. Server must be running, starting, or stopping.`,
        });
      }

      // If the server is crashed, the process is already dead — just set it to stopped directly
      if (currentState === ServerState.CRASHED) {
        await prisma.server.update({
          where: { id: serverId },
          data: { status: "stopped" },
        });
        await createAuditLog(userId, {
          action: "server.kill",
          resource: "server",
          resourceId: serverId,
          request,
          details: buildServerAuditDetails(server, {
            method: "mark_stopped",
            reason: "already_crashed",
            force: true,
            newStatus: "stopped",
          }),
        });
        return reply.send({ success: true, message: "Server marked as stopped" });
      }

      if (!server.node.isOnline) {
        return reply.status(503).send({ error: "Node is offline" });
      }

      const gateway = (app as any).wsGateway;
      if (!gateway) {
        return reply.status(500).send({ error: "WebSocket gateway not available" });
      }

      await prisma.server.update({
        where: { id: serverId },
        data: { status: "stopping" },
      });
      emitServerStatusEvent(app, serverId, "stopping", { action: "kill" });

      const powerResult = await sendPowerCommand(
        gateway,
        server.nodeId,
        {
          type: "kill_server",
          serverId: server.id,
          serverUuid: server.uuid,
          template: patchTemplateForRuntime(server.template),
        },
        POWER_ACK_TIMEOUT.kill,
      );

      if (powerResult.mode === "failed") {
        await prisma.server.update({
          where: { id: serverId },
          data: { status: server.status },
        });
        return reply.status(powerFailureStatus(powerResult)).send({
          error: powerResult.error.message || "Failed to send command to agent",
        });
      }

      await createAuditLog(userId, {
        action: "server.kill",
        resource: "server",
        resourceId: serverId,
        request,
        details: buildServerAuditDetails(server, {
          powerResult: powerResult.mode,
          requestId: "requestId" in powerResult ? powerResult.requestId : undefined,
          force: true,
          newStatus: "stopping",
        }),
      });

      if (powerResult.mode === "acked") {
        return reply.send({
          success: true,
          acked: true,
          requestId: powerResult.requestId,
          message: "Kill command completed by agent",
        });
      }

      return reply.status(202).send({
        success: true,
        accepted: true,
        async: true,
        timedOutWaitingForAck: powerResult.mode === "timeout",
        requestId: "requestId" in powerResult ? powerResult.requestId : undefined,
        message:
          powerResult.mode === "timeout"
            ? "Kill command sent; agent ack timed out — completion is asynchronous"
            : "Kill command sent to agent; completion is asynchronous",
      });
    }
  );

  // Restart server (stop then start)
  app.post(
    "/:serverId/restart",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        include: {
          template: true,
          node: true,
        },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (!ensureNotSuspended(server, reply)) {
        return;
      }

      // Check permissions - restart requires BOTH server.start AND server.stop
      if (server.ownerId !== userId && !checkIsAdmin(request, "admin.write")) {
        const [startAccess, stopAccess] = await Promise.all([
          prisma.serverAccess.findFirst({
            where: { userId, serverId, permissions: { has: "server.start" } },
          }),
          prisma.serverAccess.findFirst({
            where: { userId, serverId, permissions: { has: "server.stop" } },
          }),
        ]);
        // Require both start and stop; node assignment alone is not enough
        if (!startAccess || !stopAccess) {
          return reply.status(403).send({ error: "Forbidden" });
        }
      }

      // Validate state
      const currentState = server.status as ServerState;
      if (!ServerStateMachine.canRestart(currentState)) {
        return reply.status(409).send({
          error: `Cannot restart server in ${server.status} state`,
        });
      }

      // Check if node is online
      if (!server.node.isOnline) {
        return reply.status(503).send({ error: "Node is offline" });
      }

      const gateway = (app as any).wsGateway;
      if (!gateway) {
        return reply.status(500).send({ error: "WebSocket gateway not available" });
      }
      const runtimeTemplate = patchTemplateForRuntime(server.template);

      // If running, stop first (best-effort; restart path still proceeds)
      if (currentState === ServerState.RUNNING) {
        await prisma.server.update({
          where: { id: serverId },
          data: { status: "stopping" },
        });
        // Dedicated stop is not waited here — restart_server on the agent
        // performs stop+wait+start. The restart request below carries the ack.
      }

      // Start after a delay (agent will handle the actual timing)
      const serverDir = server.node.serverDataDir || "/var/lib/catalyst/servers";
      const fullServerDir = `${serverDir}/${server.uuid}`;
      
      const environment: Record<string, string> = {
        ...(server.environment as Record<string, string>),
        SERVER_DIR: fullServerDir,
      };
      if (server.template?.image) {
        const resolvedImage = resolveTemplateImage(server.template, environment);
        environment.TEMPLATE_IMAGE = resolvedImage;
      }
      if (server.primaryIp && !environment.CATALYST_NETWORK_IP) {
        environment.CATALYST_NETWORK_IP = server.primaryIp;
      }
      if (server.networkMode === "host" && !environment.CATALYST_NETWORK_IP) {
        try {
          environment.CATALYST_NETWORK_IP = normalizeHostIp(server.node.publicAddress) || "";
        } catch (error: any) {
          return reply.status(400).send({ error: error.message });
        }
      }
      if (server.subdomain && !environment.CATALYST_SUBDOMAIN) {
        environment.CATALYST_SUBDOMAIN = server.subdomain;
      }

      // Sync port environment variables with primaryPort
      const portBindings = parseStoredPortBindings(server.portBindings);
      let syncedEnvironment = syncPortEnvironmentVariables(
        environment,
        server.primaryPort,
        portBindings
      );
      syncedEnvironment = injectPterodactylCompatibilityVars(
        syncedEnvironment,
        {
          uuid: server.uuid,
          name: server.name,
          primaryIp: server.primaryIp,
          primaryPort: server.primaryPort,
          allocatedMemoryMb: server.allocatedMemoryMb,
          allocatedDiskMb: server.allocatedDiskMb,
          subdomain: server.subdomain,
        },
        portBindings,
        { startupCommand: runtimeTemplate.startup },
      );

      const powerResult = await sendPowerCommand(
        gateway,
        server.nodeId,
        {
          type: "restart_server",
          serverId: server.id,
          serverUuid: server.uuid,
          template: runtimeTemplate,
          environment: syncedEnvironment,
          allocatedMemoryMb: server.allocatedMemoryMb,
          allocatedCpuCores: server.allocatedCpuCores,
          allocatedDiskMb: server.allocatedDiskMb,
          primaryPort: server.primaryPort,
          portBindings: portBindings,
          networkMode: server.networkMode,
        },
        POWER_ACK_TIMEOUT.restart,
      );

      if (powerResult.mode === "failed") {
        return reply.status(powerFailureStatus(powerResult)).send({
          error: powerResult.error.message || "Failed to send command to agent",
        });
      }

      // Optimistic transitional state; final via server_state_update
      await prisma.server.update({
        where: { id: serverId },
        data: { status: "starting" },
      });
      emitServerStatusEvent(app, serverId, "starting", { action: "restart" });

      await createAuditLog(userId, {
        action: "server.restart",
        resource: "server",
        resourceId: serverId,
        request,
        details: buildServerAuditDetails(server, {
          powerResult: powerResult.mode,
          requestId: "requestId" in powerResult ? powerResult.requestId : undefined,
          wasRunning: currentState === ServerState.RUNNING,
          newStatus: "starting",
          allocatedMemoryMb: server.allocatedMemoryMb,
          allocatedCpuCores: server.allocatedCpuCores,
          primaryPort: server.primaryPort,
        }),
      });

      if (powerResult.mode === "acked") {
        return reply.send({
          success: true,
          accepted: true,
          acked: true,
          requestId: powerResult.requestId,
          message: "Restart command accepted by agent; completion is asynchronous",
        });
      }

      return reply.status(202).send({
        success: true,
        accepted: true,
        async: true,
        timedOutWaitingForAck: powerResult.mode === "timeout",
        requestId: "requestId" in powerResult ? powerResult.requestId : undefined,
        message:
          powerResult.mode === "timeout"
            ? "Restart command sent; agent ack timed out — completion is asynchronous"
            : "Restart command sent to agent; completion is asynchronous",
      });
    }
  );

  // List port allocations
  app.post(
    "/:serverId/suspend",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;
      const { reason, stopServer } = request.body as { reason?: string; stopServer?: boolean };

      if (!(ensureSuspendPermission(request, reply))) {
        return;
      }

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        include: { node: true },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (server.suspendedAt) {
        return reply.status(409).send({ error: "Server is already suspended" });
      }

      // Reject suspend from transitional states — the in-flight operation
      // owns the status and completing it must not race with the suspension.
      const TRANSITIONAL_STATUSES = new Set<string>([
        ServerState.STARTING,
        ServerState.STOPPING,
        ServerState.INSTALLING,
        ServerState.CREATING_BACKUP,
        ServerState.RESTORING,
        ServerState.TRANSFERRING,
        ServerState.CLONING,
      ]);
      if (TRANSITIONAL_STATUSES.has(server.status)) {
        return reply.status(409).send({
          error: `Cannot suspend a server while it is ${server.status}`,
        });
      }

      // Determine whether to stop the server.
      // Default is true (always stop). Set stopServer=false to suspend without stopping.
      const shouldStop = stopServer !== false;

      // Update DB BEFORE sending stop command to avoid race condition
      const updated = await prisma.server.update({
        where: { id: serverId },
        data: {
          status: "suspended",
          suspendedAt: new Date(),
          suspendedByUserId: userId,
          suspensionReason: reason?.trim() || null,
        },
      });

      if (shouldStop && (server.status === "running" || server.status === "starting")) {
        const gateway = (app as any).wsGateway;
        if (!gateway) {
          return reply.status(500).send({ error: "WebSocket gateway not available" });
        }
        if (!server.node?.isOnline) {
          return reply.status(503).send({ error: "Node is offline" });
        }
        const stopQueued = await gateway.sendToAgent(server.nodeId, {
          type: "stop_server",
          serverId: server.id,
          serverUuid: server.uuid,
        });
        if (stopQueued === false) {
          // sendToAgent returned false: the stop was dropped (offline agent with
          // a full outbox, or backpressure shedding) — not queued for replay.
          // The outbox is gateway-internal, so we can only surface a warning.
          app.log.warn(
            { serverId: server.id, nodeId: server.nodeId },
            "Suspend requested a stop but the command could not be delivered to the agent (offline or backpressure) — the server may still be running on the node",
          );
        }
      }

      // Disable all scheduled tasks for this server to prevent failed executions
      const scheduler = (app as any).taskScheduler;
      const disabledTasks = await prisma.scheduledTask.updateMany({
        where: { serverId, enabled: true },
        data: { enabled: false },
      });
      if (disabledTasks.count > 0) {
        // Unschedule them in the in-memory scheduler
        const tasks = await prisma.scheduledTask.findMany({
          where: { serverId, enabled: false },
          select: { id: true },
        });
        for (const task of tasks) {
          if (scheduler) scheduler.unscheduleTask(task.id);
        }
      }

      await createAuditLog(userId, {
        action: "server.suspend",
        resource: "server",
        resourceId: serverId,
        request,
        details: buildServerAuditDetails(server, {
          reason: updated.suspensionReason ?? undefined,
          stopServer: shouldStop,
          tasksDisabled: disabledTasks.count,
          newStatus: "suspended",
          previousStatus: server.status,
        }),
      });

      await prisma.serverLog.create({
        data: {
          serverId,
          stream: "system",
          data: `Server suspended${updated.suspensionReason ? `: ${updated.suspensionReason}` : ""}${disabledTasks.count > 0 ? ` (${disabledTasks.count} scheduled task(s) disabled)` : ""}`,
        },
      });

      // Fire webhook for server suspension
      const webhookService: any = (app as any).webhookService;
      if (webhookService) {
        webhookService.serverSuspended(serverId, server.name, updated.suspensionReason, userId).catch(() => {});
      }

      const wsGatewayServerSuspended = (app as any).wsGateway;
      if (wsGatewayServerSuspended?.pushToAdminSubscribers) {
        wsGatewayServerSuspended.pushToAdminSubscribers('server_suspended', {
          type: 'server_suspended',
          serverId,
          serverName: server.name,
          suspendedBy: userId,
          timestamp: new Date().toISOString(),
        });
      }
      if (wsGatewayServerSuspended?.pushToGlobalSubscribers) {
        wsGatewayServerSuspended.pushToGlobalSubscribers('server_suspended', {
          type: 'server_suspended',
          serverId,
          serverName: server.name,
          suspendedBy: userId,
          timestamp: new Date().toISOString(),
        });
      }

      return reply.send({ success: true, data: updated });
    }
  );

  // Unsuspend server
  app.post(
    "/:serverId/unsuspend",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;

      if (!(ensureSuspendPermission(request, reply))) {
        return;
      }

      const server = await prisma.server.findUnique({
        where: { id: serverId },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (!server.suspendedAt) {
        return reply.status(409).send({ error: "Server is not suspended" });
      }

      const updated = await prisma.server.update({
        where: { id: serverId },
        data: {
          status: "stopped",
          suspendedAt: null,
          suspendedByUserId: null,
          suspensionReason: null,
        },
      });

      // Re-enable all scheduled tasks that were disabled during suspension
      const scheduler = (app as any).taskScheduler;
      const reEnabledTasks = await prisma.scheduledTask.updateMany({
        where: { serverId, enabled: false },
        data: { enabled: true },
      });
      if (reEnabledTasks.count > 0) {
        const tasks = await prisma.scheduledTask.findMany({
          where: { serverId, enabled: true },
        });
        for (const task of tasks) {
          if (scheduler) scheduler.scheduleTask(task);
        }
      }

      await createAuditLog(userId, {
        action: "server.unsuspend",
        resource: "server",
        resourceId: serverId,
        request,
        details: buildServerAuditDetails(server, {
          tasksReEnabled: reEnabledTasks.count,
          previousSuspensionReason: server.suspensionReason ?? undefined,
          newStatus: "stopped",
        }),
      });

      await prisma.serverLog.create({
        data: {
          serverId,
          stream: "system",
          data: `Server unsuspended${reEnabledTasks.count > 0 ? ` (${reEnabledTasks.count} scheduled task(s) re-enabled)` : ""}`,
        },
      });

      // Fire webhook for server unsuspension
      const webhookService: any = (app as any).webhookService;
      if (webhookService) {
        webhookService.serverUnsuspended(serverId, server.name, userId).catch(() => {});
      }

      const wsGatewayServerUnsuspended = (app as any).wsGateway;
      if (wsGatewayServerUnsuspended?.pushToAdminSubscribers) {
        wsGatewayServerUnsuspended.pushToAdminSubscribers('server_unsuspended', {
          type: 'server_unsuspended',
          serverId,
          serverName: server.name,
          unsuspendedBy: userId,
          timestamp: new Date().toISOString(),
        });
      }
      if (wsGatewayServerUnsuspended?.pushToGlobalSubscribers) {
        wsGatewayServerUnsuspended.pushToGlobalSubscribers('server_unsuspended', {
          type: 'server_unsuspended',
          serverId,
          serverName: server.name,
          unsuspendedBy: userId,
          timestamp: new Date().toISOString(),
        });
      }

      return reply.send({ success: true, data: updated });
    }
  );

  // Transfer server ownership to another user
}
