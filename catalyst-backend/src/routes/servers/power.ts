import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../../db.js";
import { ServerState, ServerStateMachine, checkIsAdmin, ensureNotSuspended, ensureSuspendPermission, hasNodeAccess, injectPterodactylCompatibilityVars, normalizeHostIp, parseStoredPortBindings, patchTemplateForRuntime, resolveTemplateImage, syncPortEnvironmentVariables } from './_helpers.js';

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
      if (server.ownerId !== userId && !checkIsAdmin(request, "admin.read")) {
        const access = await prisma.serverAccess.findFirst({
          where: {
            userId,
            serverId,
            permissions: { has: "server.install" },
          },
        });
        const hasNodeAccessToServer = await hasNodeAccess(prisma, userId, server.nodeId);
        if (!access && !hasNodeAccessToServer) {
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
      const runtimeTemplate = patchTemplateForRuntime(server.template);

      // Sync port environment variables with primaryPort
      const portBindings = parseStoredPortBindings(server.portBindings);
      const syncedEnvironment = syncPortEnvironmentVariables(
        environment,
        server.primaryPort,
        portBindings
      );

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

      reply.send({ success: true, message: "Install command sent to agent" });
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
      if (server.ownerId !== userId && !checkIsAdmin(request, "admin.read")) {
        const access = await prisma.serverAccess.findFirst({
          where: {
            userId,
            serverId,
            permissions: { has: "server.reinstall" },
          },
        });
        const hasNodeAccessToServer = await hasNodeAccess(prisma, userId, server.nodeId);
        if (!access && !hasNodeAccessToServer) {
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
      const runtimeTemplate = patchTemplateForRuntime(server.template);

      // Sync port environment variables with primaryPort
      const portBindings = parseStoredPortBindings(server.portBindings);
      const syncedEnvironment = syncPortEnvironmentVariables(
        environment,
        server.primaryPort,
        portBindings
      );

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

      reply.send({ success: true, message: "Reinstall command sent to agent" });
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

      if (!serverId || typeof accepted !== "boolean") {
        return reply.status(400).send({ error: "serverId (string) and accepted (boolean) are required" });
      }

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        include: { node: true },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      const gateway = (app as any).wsGateway;
      if (!gateway) {
        return reply.status(500).send({ error: "WebSocket gateway not available" });
      }

      const success = await gateway.sendToAgent(server.nodeId, {
        type: accepted ? "accept_eula" : "decline_eula",
        serverId: server.id,
        serverUuid: server.uuid,
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
      if (server.ownerId !== userId && !checkIsAdmin(request, "admin.read")) {
        const access = await prisma.serverAccess.findFirst({
          where: {
            userId,
            serverId,
            permissions: { has: "server.rebuild" },
          },
        });
        const hasNodeAccessToServer = await hasNodeAccess(prisma, userId, server.nodeId);
        if (!access && !hasNodeAccessToServer) {
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
      const runtimeTemplate = patchTemplateForRuntime(server.template);
      if (server.startupCommand) {
        runtimeTemplate.startup = server.startupCommand;
      }

      // Sync port environment variables with primaryPort
      const portBindings = parseStoredPortBindings(server.portBindings);
      const syncedEnvironment = syncPortEnvironmentVariables(
        environment,
        server.primaryPort,
        portBindings
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
      if (server.ownerId !== userId && !checkIsAdmin(request, "admin.read")) {
        const access = await prisma.serverAccess.findFirst({
          where: {
            userId,
            serverId,
            permissions: { has: "server.start" },
          },
        });
        const hasNodeAccessToServer = await hasNodeAccess(prisma, userId, server.nodeId);
        if (!access && !hasNodeAccessToServer) {
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

      // Inject Pterodactyl-compatible env vars for migrated servers
      syncedEnvironment = injectPterodactylCompatibilityVars(
        syncedEnvironment,
        server,
        portBindings
      );

      const success = await gateway.sendToAgent(server.nodeId, {
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
      });

      if (!success) {
        return reply.status(503).send({ error: "Failed to send command to agent" });
      }

      // Update server status
      await prisma.server.update({
        where: { id: serverId },
        data: { status: "starting" },
      });

      reply.send({ success: true, message: "Start command sent to agent" });
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
      if (server.ownerId !== userId && !checkIsAdmin(request, "admin.read")) {
        const access = await prisma.serverAccess.findFirst({
          where: {
            userId,
            serverId,
            permissions: { has: "server.stop" },
          },
        });
        const hasNodeAccessToServer = await hasNodeAccess(prisma, userId, server.nodeId);
        if (!access && !hasNodeAccessToServer) {
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

      const success = await gateway.sendToAgent(server.nodeId, {
        type: "stop_server",
        serverId: server.id,
        serverUuid: server.uuid,
        template: patchTemplateForRuntime(server.template),
      });

      if (!success) {
        // Revert status since agent didn't receive the command
        await prisma.server.update({
          where: { id: serverId },
          data: { status: server.status },
        });
        return reply.status(503).send({ error: "Failed to send command to agent" });
      }

      reply.send({ success: true, message: "Stop command sent to agent" });
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

      if (server.ownerId !== userId && !checkIsAdmin(request, "admin.read")) {
        const access = await prisma.serverAccess.findFirst({
          where: {
            userId,
            serverId,
            permissions: { has: "server.stop" },
          },
        });
        const hasNodeAccessToServer = await hasNodeAccess(prisma, userId, server.nodeId);
        if (!access && !hasNodeAccessToServer) {
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

      const success = await gateway.sendToAgent(server.nodeId, {
        type: "kill_server",
        serverId: server.id,
        serverUuid: server.uuid,
        template: patchTemplateForRuntime(server.template),
      });

      if (!success) {
        await prisma.server.update({
          where: { id: serverId },
          data: { status: server.status },
        });
        return reply.status(503).send({ error: "Failed to send command to agent" });
      }

      reply.send({ success: true, message: "Kill command sent to agent" });
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

      // Check permissions - restart requires both server.start and server.stop
      if (server.ownerId !== userId && !checkIsAdmin(request, "admin.read")) {
        const [startAccess, stopAccess] = await Promise.all([
          prisma.serverAccess.findFirst({
            where: { userId, serverId, permissions: { has: "server.start" } },
          }),
          prisma.serverAccess.findFirst({
            where: { userId, serverId, permissions: { has: "server.stop" } },
          }),
        ]);
        const hasNodeAccessToServer = await hasNodeAccess(prisma, userId, server.nodeId);
        if (!startAccess && !stopAccess && !hasNodeAccessToServer) {
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

      // If running, stop first
      if (currentState === ServerState.RUNNING) {
        await prisma.server.update({
          where: { id: serverId },
          data: { status: "stopping" },
        });
        await gateway.sendToAgent(server.nodeId, {
          type: "stop_server",
          serverId: server.id,
          serverUuid: server.uuid,
          template: runtimeTemplate,
        });
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

      // Sync port environment variables with primaryPort
      const portBindings = parseStoredPortBindings(server.portBindings);
      const syncedEnvironment = syncPortEnvironmentVariables(
        environment,
        server.primaryPort,
        portBindings
      );

      const success = await gateway.sendToAgent(server.nodeId, {
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
      });

      if (!success) {
        return reply.status(503).send({ error: "Failed to send command to agent" });
      }

      reply.send({ success: true, message: "Restart command sent to agent" });
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
        await gateway.sendToAgent(server.nodeId, {
          type: "stop_server",
          serverId: server.id,
          serverUuid: server.uuid,
        });
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

      await prisma.auditLog.create({
        data: {
          userId,
          action: "server.suspend",
          resource: "server",
          resourceId: serverId,
          details: { reason: updated.suspensionReason ?? undefined, stopServer: shouldStop, tasksDisabled: disabledTasks.count },
        },
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

      await prisma.auditLog.create({
        data: {
          userId,
          action: "server.unsuspend",
          resource: "server",
          resourceId: serverId,
          details: { tasksReEnabled: reEnabledTasks.count },
        },
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
