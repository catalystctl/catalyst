import type pino from "pino";
import crypto from "crypto";
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import { auth } from "../auth";
import { verifyAgentApiKey } from "../lib/agent-auth";
import type {
  WsEvent} from "../shared-types";
import {
  ServerState,
  CatalystError,
  ErrorCodes,
} from "../shared-types";
import { hasPermission } from "../lib/permissions";
import { ServerStateMachine } from "../services/state-machine";
import { normalizeHostIp } from "../utils/ipam";

const DEFAULT_CONSOLE_OUTPUT_BYTE_LIMIT = 2 * 1024 * 1024; // 2MB/s per server
const MIN_CONSOLE_OUTPUT_BYTE_LIMIT = 256 * 1024;
const MAX_CONSOLE_OUTPUT_BYTE_LIMIT = 10 * 1024 * 1024;

const resolveConsoleOutputByteLimit = (value?: number | null) => {
  const raw =
    typeof value === "number" && Number.isFinite(value) && value > 0
      ? value
      : Number.parseInt(process.env.CONSOLE_OUTPUT_BYTE_LIMIT_BYTES ?? "", 10);
  if (!Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_CONSOLE_OUTPUT_BYTE_LIMIT;
  }
  return Math.min(MAX_CONSOLE_OUTPUT_BYTE_LIMIT, Math.max(MIN_CONSOLE_OUTPUT_BYTE_LIMIT, raw));
};

/**
 * Syncs port-related environment variables with the primaryPort.
 * This ensures that the server listens on the same port that is used for port forwarding.
 */
const syncPortEnvironmentVariables = (
  environment: Record<string, string>,
  primaryPort: number,
  portBindings?: Record<string, unknown>
): Record<string, string> => {
  const syncedEnv = { ...environment };

  // List of common primary port environment variable names
  const primaryPortVarNames = ["SERVER_PORT", "PORT", "GAME_PORT"];

  // Sync primary port variables if they exist in the environment
  for (const varName of primaryPortVarNames) {
    if (syncedEnv[varName] !== undefined) {
      syncedEnv[varName] = String(primaryPort);
    }
  }

  // Handle QUERY_PORT specially - if it's the primary port + 1, update it accordingly
  if (syncedEnv.QUERY_PORT !== undefined && portBindings) {
    // Find if there's a secondary port binding that's primary + 1
    const queryBinding = Object.entries(portBindings).find(
      ([containerPort, hostPort]) => {
        const cp = Number(containerPort);
        const hp = Number(hostPort);
        // Check if this is a query port (typically game port + 1)
        return cp === primaryPort + 1 || hp === primaryPort + 1;
      }
    );
    if (queryBinding) {
      syncedEnv.QUERY_PORT = queryBinding[0]; // Use container port
    }
  }

  return syncedEnv;
};

interface ConnectedAgent {
  nodeId: string;
  socket: any;
  authenticated: boolean;
  lastHeartbeat: number;
}

interface ClientConnection {
  userId: string;
  socket: any;
  authenticated: boolean;
  subscriptions: Set<string>;
  lastAuthAt?: number;
}

type PendingAgentRequest = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  kind: "json" | "binary";
  chunks?: Buffer[];
  onChunk?: (chunk: Buffer) => void;
};

export class WebSocketGateway {
  private agents = new Map<string, ConnectedAgent>();
  private clients = new Map<string, ClientConnection>();
  private logger: pino.Logger;
  private pendingAgentRequests = new Map<string, PendingAgentRequest>();
  private consoleOutputCounters = new Map<string, { count: number; resetAt: number; warned: boolean }>();
  private clientCommandCounters = new Map<string, { count: number; resetAt: number }>();
  private agentMessageCounters = new Map<string, { count: number; resetAt: number }>();
  private agentMetricsCounters = new Map<string, { count: number; resetAt: number }>();
  private serverMetricsCounters = new Map<string, { count: number; resetAt: number }>();
  private agentLimitWarnings = new Map<string, { resetAt: number }>();
  private serverCommandCounters = new Map<string, { count: number; resetAt: number }>();
  private serverConsoleBytes = new Map<string, { count: number; resetAt: number }>();
  private consoleResumeTimestamps = new Map<string, number>();
  private lastConsoleLimitRefreshAt = 0;
  private consoleOutputLimit = { max: 2000, windowMs: 1000 };
  private readonly consoleLimitRefreshIntervalMs = 5000;
  private consoleInputLimit = { max: 10, windowMs: 1000 };
  private agentMessageLimit = { max: 10000, windowMs: 1000 };
  private agentMetricsLimit = { max: 10000, windowMs: 1000 };
  private serverMetricsLimit = { max: 60, windowMs: 1000 };
  private readonly agentConsoleBytesLimit = { maxBytes: resolveConsoleOutputByteLimit() };
  private readonly pendingAgentRequestLimit = 2000;
  private readonly autoRestartingServers = new Set<string>();
  
  // Connection limits
  private readonly MAX_AGENT_CONNECTIONS = 1000;  // Max agent connections
  private readonly MAX_CLIENT_CONNECTIONS = 5000; // Max client connections
  private readonly MAX_CONNECTIONS_PER_USER = 50; // Max connections per user

  constructor(private prisma: PrismaClient, logger: pino.Logger) {
    this.logger = logger.child({ component: "WebSocketGateway" });
    this.startHeartbeatCheck();
    this.refreshConsoleLimits().catch((err) =>
      this.logger.warn({ err }, "Failed to load console rate limits")
    );
  }

  private async refreshConsoleLimits() {
    const settings = await this.prisma.systemSetting.findUnique({ where: { id: "security" } });
    if (settings?.consoleRateLimitMax && settings.consoleRateLimitMax > 0) {
      this.consoleInputLimit = { ...this.consoleInputLimit, max: settings.consoleRateLimitMax };
    }
    if (settings?.consoleOutputLinesMax && settings.consoleOutputLinesMax > 0) {
      this.consoleOutputLimit = { ...this.consoleOutputLimit, max: settings.consoleOutputLinesMax };
    }
    if (settings?.agentMessageMax && settings.agentMessageMax > 0) {
      this.agentMessageLimit = { ...this.agentMessageLimit, max: settings.agentMessageMax };
    }
    if (settings?.agentMetricsMax && settings.agentMetricsMax > 0) {
      this.agentMetricsLimit = { ...this.agentMetricsLimit, max: settings.agentMetricsMax };
    }
    if (settings?.serverMetricsMax && settings.serverMetricsMax > 0) {
      this.serverMetricsLimit = { ...this.serverMetricsLimit, max: settings.serverMetricsMax };
    }
    this.agentConsoleBytesLimit.maxBytes = resolveConsoleOutputByteLimit(
      settings?.consoleOutputByteLimitBytes
    );
  }

  private async authenticateAgentToken(nodeId: string, tokenValue: string) {
    if (!tokenValue) return null;
    const node = await this.prisma.node.findUnique({ where: { id: nodeId } });
    if (!node) return null;
    if (await verifyAgentApiKey(this.prisma, nodeId, tokenValue)) {
      return { node, authType: "api_key" as const };
    }
    return null;
  }

  async handleConnection(socket: any, request: FastifyRequest) {
    const query = (request.query as any) || {};
    const token = typeof query.token === "string" ? query.token : null;
    const nodeId =
      typeof query.nodeId === "string"
        ? query.nodeId
        : null;

    if (nodeId) {
      // Agent connection (token is expected in handshake if not provided here)
      await this.handleAgentConnection(socket, nodeId, token);
    } else {
      // Client connection (token expected via Authorization header)
      await this.handleClientConnection(socket, request);
    }
  }

  private async handleAgentConnection(socket: any, nodeId: string, token: string | null) {
    try {
      // Check agent connection limit
      if (this.agents.size >= this.MAX_AGENT_CONNECTIONS) {
        this.logger.warn({ nodeId }, `Agent connection rejected: limit reached (${this.MAX_AGENT_CONNECTIONS})`);
        socket.send(JSON.stringify({ type: 'error', error: 'Connection limit reached' }));
        socket.close();
        return;
      }
      
      const agent: ConnectedAgent = {
        nodeId,
        socket,
        authenticated: false,
        lastHeartbeat: Date.now(),
      };
      const onMessage = (data: any) => this.handleAgentMessage(nodeId, socket, data);
      const onClose = () => {
        const current = this.agents.get(nodeId);
        if (!current || current.socket !== socket) {
          this.logger.debug({ nodeId }, "Ignoring close from stale agent socket");
          return;
        }
        this.agents.delete(nodeId);
        this.prisma.node.update({
          where: { id: nodeId },
          data: { isOnline: false },
        });
        this.logger.info(`Agent disconnected: ${nodeId}`);
      };

      if (token) {
        const authResult = await this.authenticateAgentToken(nodeId, token);
        if (authResult) {
          const existing = this.agents.get(nodeId);
          if (existing && existing.socket !== socket) {
            this.logger.warn({ nodeId }, "Replacing existing agent connection");
            try {
              existing.socket.close();
            } catch {
              // ignore close errors
            }
          }
          this.agents.set(nodeId, agent);
          socket.on("message", onMessage);
          socket.on("close", onClose);
          this.logger.info(
            { nodeId, authType: authResult.authType },
            "Agent authenticated during connection",
          );
          agent.authenticated = true;
          await this.finalizeAgentConnection(authResult.node, agent);
        } else {
          this.logger.warn(`Agent authentication failed for node: ${nodeId}`);
          agent.socket.close();
        }
      } else {
        // No token in URL - agent will send handshake with token
        // Add to agents map so handleAgentMessage can find it
        const existing = this.agents.get(nodeId);
        if (existing && existing.socket !== socket) {
          this.logger.warn({ nodeId }, "Replacing existing agent connection");
          try {
            existing.socket.close();
          } catch {
            // ignore close errors
          }
        }
        this.agents.set(nodeId, agent);
        socket.on("message", onMessage);
        socket.on("close", onClose);
        this.logger.info({ nodeId }, "Agent connected, awaiting handshake");

        // Disconnect agent if handshake not completed within 10 seconds
        setTimeout(() => {
          const pending = this.agents.get(nodeId);
          if (pending && pending.socket === socket && !pending.authenticated) {
            pending.socket.close();
            this.agents.delete(nodeId);
            this.logger.warn({ nodeId }, "Agent handshake timeout");
          }
        }, 10000);
      }
    } catch (err) {
      this.logger.error(err, "Error in agent connection");
      socket.close();
    }
  }

  private async finalizeAgentConnection(node: any, agent: ConnectedAgent) {
    // Note: agent.authenticated should be set to true BEFORE calling this function
    // to prevent race conditions with the handshake timeout
    await this.prisma.node.update({
      where: { id: node.id },
      data: { isOnline: true, lastSeenAt: new Date() },
    });
    this.logger.info(`Agent connected: ${node.id} (${node.hostname})`);
    agent.socket.send(
      JSON.stringify({
        type: "node_handshake_response",
        success: true,
        backendAddress: process.env.BACKEND_EXTERNAL_ADDRESS || "http://localhost:3000",
      })
    );
    await this.resumeConsoleStreams(node.id);
  }

  private async resumeConsoleStreams(nodeId: string) {
    try {
      const servers = await this.prisma.server.findMany({
        where: {
          nodeId,
          status: { in: ["running", "starting"] },
        },
        select: {
          id: true,
          uuid: true,
        },
      });

      if (!servers.length) {
        return;
      }

      const agent = this.agents.get(nodeId);
      if (!agent || agent.socket.readyState !== 1) {
        return;
      }

      for (const server of servers) {
        agent.socket.send(
          JSON.stringify({
            type: "resume_console",
            serverId: server.id,
            serverUuid: server.uuid,
          })
        );
      }
    } catch (err) {
      this.logger.error(err, "Failed to resume console streams");
    }
  }

  private async handleClientConnection(socket: any, request: FastifyRequest) {
    try {
      // Check overall client connection limit
      if (this.clients.size >= this.MAX_CLIENT_CONNECTIONS) {
        this.logger.warn('Client connection rejected: overall limit reached');
        socket.send(JSON.stringify({ type: 'error', error: 'Connection limit reached' }));
        socket.close();
        return;
      }
      
      const clientId = `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const client: ClientConnection = {
        userId: "",
        socket,
        authenticated: false,
        subscriptions: new Set<string>(),
      };
      this.clients.set(clientId, client);
      this.logger.info(`Client connected (pending auth): ${clientId}`);

      // Try to authenticate immediately via cookies from upgrade request
      try {
        const cookieHeader = request.headers.cookie || "";
        this.logger.debug({ clientId, hasCookie: !!cookieHeader, cookieLength: cookieHeader.length }, "Attempting cookie auth");
        const session = await auth.api.getSession({
          headers: new Headers({ cookie: cookieHeader }),
        });
        if (session?.user?.id) {
          // Check per-user connection limit
          const userConnections = Array.from(this.clients.values()).filter(c => c.userId === session.user.id).length;
          if (userConnections >= this.MAX_CONNECTIONS_PER_USER) {
            this.logger.warn({ userId: session.user.id, current: userConnections }, 'User connection limit reached');
            socket.send(JSON.stringify({ type: 'error', error: 'Too many connections for this user' }));
            this.clients.delete(clientId);
            socket.close();
            return;
          }
          
          client.userId = session.user.id;
          client.authenticated = true;
          client.lastAuthAt = Date.now();
          this.logger.info({ clientId, userId: session.user.id }, "Client authenticated via cookie");
        } else {
          this.logger.debug({ clientId, hasSession: !!session }, "Cookie auth returned no user");
        }
      } catch (cookieErr) {
        this.logger.debug({ clientId, err: cookieErr }, "Cookie auth failed, waiting for handshake");
      }

      socket.on("message", (data: any) => {
        this.logger.info({ clientId, dataType: typeof data, dataLength: data?.length }, "Raw message received");
        this.handleClientMessage(clientId, data);
      });
      socket.on("close", () => {
        this.clients.delete(clientId);
        this.clientCommandCounters.delete(clientId);
        this.logger.info(`Client disconnected: ${clientId}`);
      });

      setTimeout(() => {
        const pending = this.clients.get(clientId);
        if (pending && !pending.authenticated) {
          pending.socket.close();
          this.clients.delete(clientId);
          this.logger.warn({ clientId }, "Client handshake timeout");
        }
      }, 5000);
    } catch (err) {
      this.logger.error(err, "Error in client connection");
      socket.close();
    }
  }

  private async userHasAdminRead(userId: string) {
    try {
      return await hasPermission(this.prisma, userId, "admin.read");
    } catch (err) {
      this.logger.warn({ err, userId }, "Failed to evaluate admin.read permission");
      return false;
    }
  }

  private allowAgentMessage(nodeId: string, limit: { max: number; windowMs: number }) {
    const now = Date.now();
    const existing = this.agentMessageCounters.get(nodeId);
    if (!existing || now >= existing.resetAt) {
      this.agentMessageCounters.set(nodeId, { count: 1, resetAt: now + limit.windowMs });
      return true;
    }
    if (existing.count >= limit.max) {
      return false;
    }
    existing.count += 1;
    return true;
  }

  private allowAgentMetrics(nodeId: string, count = 1) {
    const now = Date.now();
    const existing = this.agentMetricsCounters.get(nodeId);
    if (!existing || now >= existing.resetAt) {
      this.agentMetricsCounters.set(nodeId, { count, resetAt: now + this.agentMetricsLimit.windowMs });
      return true;
    }
    if (existing.count + count > this.agentMetricsLimit.max) {
      return false;
    }
    existing.count += count;
    return true;
  }

  private allowServerMetrics(serverId: string, count = 1) {
    const now = Date.now();
    const existing = this.serverMetricsCounters.get(serverId);
    if (!existing || now >= existing.resetAt) {
      this.serverMetricsCounters.set(serverId, { count, resetAt: now + this.serverMetricsLimit.windowMs });
      return true;
    }
    if (existing.count + count > this.serverMetricsLimit.max) {
      return false;
    }
    existing.count += count;
    return true;
  }

  private shouldWarnRateLimit(nodeId: string, windowMs: number) {
    const now = Date.now();
    const existing = this.agentLimitWarnings.get(nodeId);
    if (!existing || now >= existing.resetAt) {
      this.agentLimitWarnings.set(nodeId, { resetAt: now + windowMs });
      return true;
    }
    return false;
  }

  private allowServerCommand(serverId: string) {
    const now = Date.now();
    const existing = this.serverCommandCounters.get(serverId);
    if (!existing || now >= existing.resetAt) {
      this.serverCommandCounters.set(serverId, { count: 1, resetAt: now + this.consoleInputLimit.windowMs });
      return true;
    }
    if (existing.count >= this.consoleInputLimit.max) {
      return false;
    }
    existing.count += 1;
    return true;
  }

  private allowConsoleOutputBytes(serverId: string, bytes: number) {
    const now = Date.now();
    const windowMs = this.consoleOutputLimit.windowMs;
    const limit = this.agentConsoleBytesLimit.maxBytes;
    this.maybeRefreshConsoleLimits(now);
    const existing = this.serverConsoleBytes.get(serverId);
    if (!existing || now >= existing.resetAt) {
      this.serverConsoleBytes.set(serverId, { count: bytes, resetAt: now + windowMs });
      return bytes <= limit;
    }
    existing.count += bytes;
    return existing.count <= limit;
  }

  private parseAgentMessage(data: any): { ok: true; value: any } | { ok: false } {
    try {
      if (typeof data === "string") {
        return { ok: true, value: JSON.parse(data) };
      }
      if (Buffer.isBuffer(data)) {
        return { ok: true, value: JSON.parse(data.toString()) };
      }
      if (data?.toString) {
        return { ok: true, value: JSON.parse(data.toString()) };
      }
      return { ok: false };
    } catch {
      return { ok: false };
    }
  }

  private async handleAgentMessage(nodeId: string, socket: any, data: any) {
    try {
      if (!this.allowAgentMessage(nodeId, this.agentMessageLimit)) {
        if (this.shouldWarnRateLimit(nodeId, this.agentMessageLimit.windowMs)) {
          this.logger.warn({ nodeId }, "Agent message rate limit exceeded");
        }
        return;
      }
      const parsed = this.parseAgentMessage(data);
      if (!parsed.ok || !parsed.value || typeof parsed.value !== "object") {
        this.logger.warn({ nodeId }, "Invalid agent message payload");
        return;
      }
      const message = parsed.value;
      if (typeof message.type !== "string") {
        this.logger.warn({ nodeId }, "Agent message missing type");
        return;
      }
      const agent = this.agents.get(nodeId);
      if (!agent) return;
      if (agent.socket !== socket) {
        this.logger.debug({ nodeId }, "Ignoring message from stale agent socket");
        return;
      }
      if (!agent.authenticated && message.type !== "node_handshake") {
        this.logger.warn({ nodeId }, "Rejected agent message before handshake");
        return;
      }
      if (message.type === "node_handshake") {
        if (agent.authenticated) {
          this.logger.debug({ nodeId }, "Ignoring redundant node_handshake for authenticated agent");
          return;
        }
        this.logger.info({ nodeId, hasToken: Boolean(message.token) }, "Received node_handshake from agent");
        const tokenValue = typeof message.token === "string" ? message.token : "";
        const authResult = await this.authenticateAgentToken(nodeId, tokenValue);
        this.logger.debug(
          { nodeId, tokenProvided: Boolean(tokenValue), authType: authResult?.authType },
          "Agent auth check",
        );
        if (!authResult) {
          this.logger.warn(
            { nodeId, token: Boolean(tokenValue) },
            `Agent authentication failed for node: ${nodeId}`,
          );
          agent.socket.close();
          this.agents.delete(nodeId);
          return;
        }
        // Set authenticated flag IMMEDIATELY to prevent timeout from disconnecting during async operations
        agent.authenticated = true;
        await this.finalizeAgentConnection(authResult.node, agent);
        return;
      }
      // Treat any authenticated agent message as liveness to avoid false disconnects
      // when heartbeat packets are delayed but other traffic is active.
      agent.lastHeartbeat = Date.now();

      if (message.type === "backup_download_response") {
        const pending = message.requestId
          ? this.pendingAgentRequests.get(message.requestId)
          : undefined;
        if (pending) {
          clearTimeout(pending.timeout);
          if (message.success === false) {
            pending.reject(new Error("Backup download failed"));
          } else {
            pending.resolve(message);
          }
          this.pendingAgentRequests.delete(message.requestId);
        } else {
          this.logger.warn({ requestId: message.requestId }, "No pending download request");
        }
        return;
      }

      if (message.type === "backup_upload_response") {
        const pending = message.requestId
          ? this.pendingAgentRequests.get(message.requestId)
          : undefined;
        if (pending) {
          clearTimeout(pending.timeout);
          if (message.success === false) {
            pending.reject(new Error("Backup upload failed"));
          } else {
            pending.resolve(message);
          }
          this.pendingAgentRequests.delete(message.requestId);
        } else {
          this.logger.warn({ requestId: message.requestId }, "No pending upload request");
        }
        return;
      }

      if (message.type === "backup_upload_chunk_response") {
        return;
      }

      if (message.type === "backup_download_chunk") {
        const pending = message.requestId
          ? this.pendingAgentRequests.get(message.requestId)
          : undefined;
        if (!pending || pending.kind !== "binary") {
          this.logger.warn({ requestId: message.requestId }, "No pending chunk request");
          return;
        }
        if (message.error) {
          clearTimeout(pending.timeout);
          this.logger.error(
            { requestId: message.requestId, error: message.error },
            "Agent download chunk error",
          );
          pending.reject(new Error("Backup download failed"));
          this.pendingAgentRequests.delete(message.requestId);
          return;
        }
        if (message.data) {
          const buffer = Buffer.from(message.data, "base64");
          if (pending.onChunk) {
            try {
              pending.onChunk(buffer);
            } catch (error) {
              this.logger.error(
                { requestId: message.requestId, err: error },
                "Failed to handle backup download chunk",
              );
            }
          }
          pending.chunks?.push(buffer);
        }
        if (message.done) {
          clearTimeout(pending.timeout);
          if (pending.chunks) {
            const payload = Buffer.concat(pending.chunks);
            pending.resolve(payload);
          } else {
            pending.resolve(undefined);
          }
          this.pendingAgentRequests.delete(message.requestId);
        }
        return;
      }

      if (message.type === "heartbeat") {
        if (agent) {
          agent.lastHeartbeat = Date.now();
          await this.prisma.node.update({
            where: { id: nodeId },
            data: { lastSeenAt: new Date() },
          });
        }
      } else if (message.type === "health_report") {
        if (!this.allowAgentMetrics(nodeId)) {
          if (this.shouldWarnRateLimit(nodeId, this.agentMetricsLimit.windowMs)) {
            this.logger.warn({ nodeId }, "Agent metrics rate limit exceeded");
          }
          return;
        }
        const node = await this.prisma.node.findUnique({
          where: { id: nodeId },
        });
        if (!node) {
          return;
        }
        const cpuPercent = Number(message.cpuPercent);
        const memoryUsageMb = Number(message.memoryUsageMb);
        const memoryTotalMb = Number(message.memoryTotalMb ?? node.maxMemoryMb);
        const diskUsageMb = Number(message.diskUsageMb ?? 0);
        const diskTotalMb = Number(message.diskTotalMb ?? 0);
        const containerCount = Number(message.containerCount);
        if (
          !Number.isFinite(cpuPercent) ||
          !Number.isFinite(memoryUsageMb) ||
          !Number.isFinite(memoryTotalMb) ||
          !Number.isFinite(diskUsageMb) ||
          !Number.isFinite(diskTotalMb) ||
          !Number.isFinite(containerCount)
        ) {
          this.logger.warn({ nodeId }, "Invalid health report payload");
          return;
        }
        await this.prisma.node.update({
          where: { id: nodeId },
          data: { isOnline: true, lastSeenAt: new Date() },
        });
        await this.prisma.nodeMetrics.create({
          data: {
            nodeId,
            cpuPercent,
            memoryUsageMb: Math.round(memoryUsageMb),
            memoryTotalMb: Math.round(memoryTotalMb),
            diskUsageMb: Math.round(diskUsageMb),
            diskTotalMb: Math.round(diskTotalMb),
            networkRxBytes: BigInt(0),
            networkTxBytes: BigInt(0),
            containerCount: Math.max(0, Math.round(containerCount)),
          },
        });
      } else if (message.type === "resource_stats") {
        if (!this.allowAgentMetrics(nodeId)) {
          if (this.shouldWarnRateLimit(nodeId, this.agentMetricsLimit.windowMs)) {
            this.logger.warn({ nodeId }, "Agent metrics rate limit exceeded");
          }
          return;
        }
        const serverUuid = message.serverUuid;
        if (!serverUuid) {
          this.logger.warn("resource_stats missing serverUuid");
          return;
        }
        // Note: serverUuid here is actually the serverId (container name from agent)
        // Agent uses server.id as container name, so lookup by id not uuid
        const server = await this.prisma.server.findUnique({
          where: { id: serverUuid },
        });
        if (!server) {
          this.logger.warn({ serverId: serverUuid }, "resource_stats for unknown server");
          return;
        }
        if (server.nodeId !== nodeId) {
          this.logger.warn({ nodeId, serverId: server.id }, "resource_stats for wrong node");
          return;
        }

        const cpuPercent = Number(message.cpuPercent);
        const memoryUsageMb = Number(message.memoryUsageMb);
        const diskUsageMb = Number(message.diskUsageMb ?? 0);
        const diskIoMb = Number(message.diskIoMb ?? 0);
        const diskTotalMb = Number(message.diskTotalMb ?? 0);
        const networkRxBytes = BigInt(Math.max(0, Number(message.networkRxBytes ?? 0)));
        const networkTxBytes = BigInt(Math.max(0, Number(message.networkTxBytes ?? 0)));

        if (!this.allowServerMetrics(server.id)) {
          return;
        }
        await this.prisma.serverMetrics.create({
          data: {
            serverId: server.id,
            cpuPercent: Number.isFinite(cpuPercent) ? Math.min(Math.max(cpuPercent, 0), 100) : 0,
            memoryUsageMb: Math.round(Number.isFinite(memoryUsageMb) ? Math.max(memoryUsageMb, 0) : 0),
            networkRxBytes,
            networkTxBytes,
            diskIoMb: Math.round(Number.isFinite(diskIoMb) ? Math.max(diskIoMb, 0) : 0),
            diskUsageMb: Math.round(Number.isFinite(diskUsageMb) ? Math.max(diskUsageMb, 0) : 0),
          },
        });

        await this.routeToClients(server.id, {
          type: "resource_stats",
          serverId: server.id,
          cpuPercent: Number.isFinite(cpuPercent) ? Math.min(Math.max(cpuPercent, 0), 100) : 0,
          memoryUsageMb: Math.round(Number.isFinite(memoryUsageMb) ? Math.max(memoryUsageMb, 0) : 0),
          networkRxBytes: networkRxBytes.toString(),
          networkTxBytes: networkTxBytes.toString(),
          diskIoMb: Math.round(Number.isFinite(diskIoMb) ? Math.max(diskIoMb, 0) : 0),
          diskUsageMb: Math.round(Number.isFinite(diskUsageMb) ? Math.max(diskUsageMb, 0) : 0),
          diskTotalMb: Math.round(Number.isFinite(diskTotalMb) ? Math.max(diskTotalMb, 0) : 0),
          timestamp: Date.now(),
        });
      } else if (message.type === "resource_stats_batch") {
        if (!this.allowAgentMetrics(nodeId, message.metrics.length)) {
          if (this.shouldWarnRateLimit(nodeId, this.agentMetricsLimit.windowMs)) {
            this.logger.warn({ nodeId }, "Agent metrics rate limit exceeded");
          }
          return;
        }
        // message.metrics is expected to be an array of metric objects
        if (!Array.isArray(message.metrics)) {
          this.logger.warn('resource_stats_batch.metrics is not an array');
          return;
        }
        if (message.metrics.length > 500) {
          this.logger.warn({ count: message.metrics.length }, "resource_stats_batch too large");
          return;
        }

        const items: any[] = [];
        for (const m of message.metrics) {
          if (!m.serverUuid || !m.timestamp) continue;
          if (!Number.isFinite(Number(m.timestamp))) continue;
          items.push({
            serverId: m.serverUuid,
            cpuPercent: Number.isFinite(Number(m.cpuPercent)) ? Math.min(Math.max(Number(m.cpuPercent), 0), 100) : 0,
            memoryUsageMb: Math.round(Number.isFinite(Number(m.memoryUsageMb)) ? Math.max(Number(m.memoryUsageMb), 0) : 0),
            networkRxBytes: BigInt(Math.max(0, Number(m.networkRxBytes || 0))),
            networkTxBytes: BigInt(Math.max(0, Number(m.networkTxBytes || 0))),
            diskIoMb: Math.round(Number.isFinite(Number(m.diskIoMb)) ? Math.max(Number(m.diskIoMb), 0) : 0),
            diskUsageMb: Math.round(Number.isFinite(Number(m.diskUsageMb)) ? Math.max(Number(m.diskUsageMb), 0) : 0),
            timestamp: new Date(Number(m.timestamp)),
          });
        }

        if (items.length === 0) return;

        const serverIds = Array.from(new Set(items.map((i) => i.serverId)));
        const servers = await this.prisma.server.findMany({
          where: { id: { in: serverIds }, nodeId },
          select: { id: true },
        });
        const allowed = new Set(servers.map((s) => s.id));
        const filtered = items.filter((item) => {
          if (!allowed.has(item.serverId)) {
            return false;
          }
          return this.allowServerMetrics(item.serverId);
        });
        if (!filtered.length) {
          return;
        }

        // Use an upsert-style INSERT ... ON CONFLICT statement to dedupe and keep peaks
        // We use GREATEST(...) for memory / network to preserve spikes when backfilling
        const tuples: Prisma.Sql[] = [];
        for (const it of filtered) {
          const cpu = Number(it.cpuPercent) || 0;
          const mem = Number(it.memoryUsageMb) || 0;
          const rx = BigInt(it.networkRxBytes || 0);
          const tx = BigInt(it.networkTxBytes || 0);
          const dio = Number(it.diskIoMb) || 0;
          const dusg = Number(it.diskUsageMb) || 0;
          const ts = new Date(it.timestamp);
          tuples.push(
            Prisma.sql`(DEFAULT, ${it.serverId}, ${cpu}, ${mem}, ${rx}, ${tx}, ${dio}, ${dusg}, ${ts})`
          );
        }

        if (tuples.length === 0) return;

        const sql = Prisma.sql`
          INSERT INTO "ServerMetrics" ("id","serverId","cpuPercent","memoryUsageMb","networkRxBytes","networkTxBytes","diskIoMb","diskUsageMb","timestamp")
          VALUES ${Prisma.join(tuples)}
          ON CONFLICT ("serverId","timestamp") DO UPDATE SET
            "cpuPercent" = EXCLUDED."cpuPercent",
            "memoryUsageMb" = GREATEST("ServerMetrics"."memoryUsageMb", EXCLUDED."memoryUsageMb"),
            "networkRxBytes" = GREATEST("ServerMetrics"."networkRxBytes", EXCLUDED."networkRxBytes"),
            "networkTxBytes" = GREATEST("ServerMetrics"."networkTxBytes", EXCLUDED."networkTxBytes"),
            "diskIoMb" = GREATEST("ServerMetrics"."diskIoMb", EXCLUDED."diskIoMb"),
            "diskUsageMb" = GREATEST("ServerMetrics"."diskUsageMb", EXCLUDED."diskUsageMb")
        `;

        try {
          await this.prisma.$executeRaw(sql);
        } catch (err) {
          this.logger.error({ err }, 'Failed to upsert batched metrics, falling back to per-item safe upsert');

          // Fallback: upsert each item individually (safe but slower). We attempt
          // to preserve spike semantics by keeping max(memory, disk, network) where applicable.
          for (const it of filtered) {
            try {
              const existing = await this.prisma.serverMetrics.findUnique({
                where: {
                  serverId_timestamp: {
                    serverId: it.serverId,
                    timestamp: new Date(it.timestamp),
                  },
                },
              });

              const cpu = Number(it.cpuPercent) || 0;
              const mem = Math.round(Number(it.memoryUsageMb) || 0);
              const rx = BigInt(it.networkRxBytes || 0);
              const tx = BigInt(it.networkTxBytes || 0);
              const dio = Math.round(Number(it.diskIoMb) || 0);
              const dusg = Math.round(Number(it.diskUsageMb) || 0);
              const ts = new Date(it.timestamp);

              if (existing) {
                await this.prisma.serverMetrics.update({
                  where: { id: existing.id },
                  data: {
                    cpuPercent: cpu, // replace cpu with latest sample
                    memoryUsageMb: Math.max(existing.memoryUsageMb, mem),
                    networkRxBytes: (BigInt(existing.networkRxBytes.toString()) < rx) ? rx : BigInt(existing.networkRxBytes.toString()),
                    networkTxBytes: (BigInt(existing.networkTxBytes.toString()) < tx) ? tx : BigInt(existing.networkTxBytes.toString()),
                    diskIoMb: Math.max(existing.diskIoMb ?? 0, dio),
                    diskUsageMb: Math.max(existing.diskUsageMb, dusg),
                  },
                });
              } else {
                await this.prisma.serverMetrics.create({
                  data: {
                    serverId: it.serverId,
                    cpuPercent: cpu,
                    memoryUsageMb: mem,
                    networkRxBytes: rx,
                    networkTxBytes: tx,
                    diskIoMb: dio,
                    diskUsageMb: dusg,
                    timestamp: ts,
                  },
                });
              }
            } catch (e2) {
              this.logger.error({ err: e2, item: it }, 'Failed to upsert individual metric');
            }
          }
        }

        // Broadcast latest metrics for affected servers
        const filteredIds = Array.from(new Set(filtered.map((i) => i.serverId)));
        for (const sid of filteredIds) {
          const latest = await this.prisma.serverMetrics.findFirst({ where: { serverId: sid }, orderBy: { timestamp: 'desc' } });
          if (latest) {
            await this.routeToClients(sid, {
              type: 'resource_stats',
              serverId: sid,
              cpuPercent: latest.cpuPercent,
              memoryUsageMb: latest.memoryUsageMb,
              networkRxBytes: latest.networkRxBytes.toString(),
              networkTxBytes: latest.networkTxBytes.toString(),
              diskIoMb: latest.diskIoMb ?? 0,
              diskUsageMb: latest.diskUsageMb,
              diskTotalMb: 0,
              timestamp: latest.timestamp.getTime(),
            });
          }
        }
      } else if (message.type === "console_output") {
        if (typeof message.data === "string") {
          if (!this.allowConsoleOutputBytes(message.serverId, Buffer.byteLength(message.data))) {
            this.logger.warn({ nodeId, serverId: message.serverId }, "console_output exceeded byte limit");
            return;
          }
        }
        if (message.serverId && message.data) {
          await this.prisma.serverLog.create({
            data: {
              serverId: message.serverId,
              stream: message.stream || "stdout",
              data: message.data,
            },
          });
        }
        if (!this.allowConsoleOutput(message.serverId)) {
          await this.maybeWarnConsoleThrottle(message.serverId);
          return;
        }
        await this.routeConsoleToSubscribers(message.serverId, message);
      } else if (message.type === "server_state_update") {
        if (!message.serverId || typeof message.state !== "string") {
          return;
        }
        if (process.env.SUSPENSION_ENFORCED !== "false") {
          const current = await this.prisma.server.findUnique({
            where: { id: message.serverId },
            select: { suspendedAt: true },
          });
          if (current?.suspendedAt) {
            return;
          }
        }
        const server = await this.prisma.server.findUnique({
          where: { id: message.serverId },
          include: { node: true, template: true },
        });

        if (!server) {
          return;
        }
        if (server.nodeId !== nodeId) {
          this.logger.warn({ nodeId, serverId: server.id }, "server_state_update from wrong node");
          return;
        }
        if (server.status === message.state) {
          // Idempotent update from agent; no state change required.
          return;
        }
        const transition = ServerStateMachine.validateTransition(
          server.status as ServerState,
          message.state as ServerState
        );
        if (!transition.allowed) {
          this.logger.warn({ serverId: server.id, from: server.status, to: message.state }, "Invalid state transition");
          return;
        }

        const nextData: Record<string, any> = {
          status: message.state,
          ...(message.portBindings && typeof message.portBindings === "object"
            ? { portBindings: message.portBindings }
            : {}),
          ...(typeof message.exitCode === "number" ? { lastExitCode: message.exitCode } : {}),
        };

        const shouldRecordCrash = message.state === ServerState.CRASHED;
        let shouldAutoRestart = false;
        if (shouldRecordCrash) {
          const nextCrashCount = (server.crashCount ?? 0) + 1;
          nextData.crashCount = nextCrashCount;
          nextData.lastCrashAt = new Date();
          const maxCrashCount = server.maxCrashCount ?? 0;
          if (
            server.restartPolicy !== "never" &&
            nextCrashCount <= maxCrashCount
          ) {
            if (server.restartPolicy === "always") {
              shouldAutoRestart = true;
            } else if (server.restartPolicy === "on-failure") {
              const exitCode = typeof message.exitCode === "number" ? message.exitCode : null;
              if (exitCode !== null && exitCode !== 0) {
                shouldAutoRestart = true;
              }
            }
          }

        }

        await this.prisma.server.update({
          where: { id: message.serverId },
          data: nextData,
        });
        if (message.reason) {
          await this.prisma.serverLog.create({
            data: {
              serverId: message.serverId,
              stream: "system",
              data: `Status changed to ${message.state}: ${message.reason}`,
            },
          });
        }
        if (shouldRecordCrash && typeof message.exitCode === "number") {
          await this.prisma.serverLog.create({
            data: {
              serverId: message.serverId,
              stream: "system",
              data: `Exit code: ${message.exitCode}`,
            },
          });
        }

        if (shouldAutoRestart && server.node?.isOnline) {
          this.autoRestartingServers.add(server.id);
          await this.prisma.server.update({
            where: { id: server.id },
            data: { status: ServerState.STARTING },
          });
          const serverDir = process.env.SERVER_DATA_PATH || "/tmp/catalyst-servers";
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
          if (server.primaryIp && !environment.CATALYST_NETWORK_IP) {
            environment.CATALYST_NETWORK_IP = server.primaryIp;
          }
          if (server.networkMode === "host" && !environment.CATALYST_NETWORK_IP) {
            try {
              environment.CATALYST_NETWORK_IP =
                normalizeHostIp(server.node.publicAddress) ?? undefined;
            } catch (error: any) {
              this.logger.warn(
                { nodeId: server.nodeId, hostIp: server.node.publicAddress, error: error.message },
                "Invalid host network IP"
              );
            }
          }

          // Sync port environment variables with primaryPort
          const portBindings =
            message.portBindings && typeof message.portBindings === "object"
              ? message.portBindings
              : server.portBindings;
          const syncedEnvironment = syncPortEnvironmentVariables(
            environment,
            server.primaryPort,
            portBindings as Record<string, unknown> | undefined
          );

          const restartSent = await this.sendToAgent(server.nodeId, {
            type: "start_server",
            serverId: server.id,
            serverUuid: server.uuid,
            template: server.template,
            environment: syncedEnvironment,
            allocatedMemoryMb: server.allocatedMemoryMb,
            allocatedCpuCores: server.allocatedCpuCores,
            allocatedDiskMb: server.allocatedDiskMb,
            primaryPort: server.primaryPort,
            portBindings,
            networkMode: server.networkMode,
          });
          if (!restartSent) {
            this.autoRestartingServers.delete(server.id);
            await this.prisma.server.update({
              where: { id: server.id },
              data: { status: ServerState.CRASHED },
            });
            this.logger.warn({ serverId: server.id }, "Auto-restart failed to send to agent");
          }
        }

        if (message.state === ServerState.RUNNING && this.autoRestartingServers.has(server.id)) {
          this.autoRestartingServers.delete(server.id);
        }

        // Route to clients
        await this.routeToClients(message.serverId, message);
      } else if (message.type === "server_state_sync") {
        // State reconciliation from agent - updates status to match actual container state
        // Container name is the server ID (CUID), not the UUID field
        this.logger.info(
          { serverId: message.serverUuid, state: message.state, containerId: message.containerId },
          "Received state sync message"
        );

        const server = await this.prisma.server.findUnique({
          where: { id: message.serverUuid },  // Container name is server.id (CUID), not server.uuid
        });

        if (!server) {
          this.logger.warn(`State sync for unknown server ID: ${message.serverUuid}`);
          return;
        }
        if (server.nodeId !== nodeId) {
          this.logger.warn({ nodeId, serverId: server.id }, "server_state_sync from wrong node");
          return;
        }

        // Check if server is suspended - don't update suspended servers
        if (process.env.SUSPENSION_ENFORCED !== "false" && server.suspendedAt) {
          return;
        }

        // Only update if state is different to avoid unnecessary writes
        if (server.status !== message.state) {
          const transition = ServerStateMachine.validateTransition(
            server.status as ServerState,
            message.state as ServerState
          );
          if (!transition.allowed) {
            // State sync from agent represents actual container state - force update for reconciliation
            this.logger.info(
              { serverId: server.id, from: server.status, to: message.state },
              "State sync forced reconciliation (overriding state machine)"
            );
          }
          this.logger.info(
            { serverId: server.id, oldStatus: server.status, newStatus: message.state },
            "State reconciliation: updating server status"
          );

          const updateData: Record<string, any> = {
            status: message.state,
          };

          if (typeof message.exitCode === "number") {
            updateData.lastExitCode = message.exitCode;
          }

          await this.prisma.server.update({
            where: { id: server.id },
            data: updateData,
          });

          // Log the reconciliation event
          await this.prisma.serverLog.create({
            data: {
              serverId: server.id,
              stream: "system",
              data: `[State Sync] Status reconciled to ${message.state}`,
            },
          });

          // Notify clients of the state change
          await this.routeToClients(server.id, {
            type: "server_state_update",
            serverId: server.id,
            state: message.state,
            timestamp: message.timestamp || Date.now(),
          });
        }
      } else if (message.type === "server_state_sync_complete") {
        // Reconciliation completed - check for servers that should exist but weren't found
        if (!message.nodeId || message.nodeId !== nodeId) {
          this.logger.warn({ nodeId, messageNodeId: message.nodeId }, "server_state_sync_complete node mismatch");
          return;
        }
        const foundContainers = Array.isArray(message.foundContainers) 
          ? new Set(message.foundContainers) 
          : new Set();

        this.logger.debug(
          { nodeId, foundCount: foundContainers.size },
          "Received state sync completion"
        );

        // Find all servers that should be on this node
        const serversOnNode = await this.prisma.server.findMany({
          where: { 
            nodeId,
            // Only check servers that aren't already in terminal states
            status: {
              notIn: [ServerState.STOPPED, ServerState.ERROR]
            }
          },
          select: { id: true, uuid: true, status: true, suspendedAt: true }
        });

        // Check which servers are missing (container not found)
        for (const server of serversOnNode) {
          // Skip suspended servers
          if (process.env.SUSPENSION_ENFORCED !== "false" && server.suspendedAt) {
            continue;
          }

          // Container name is server.id (CUID), not server.uuid
          if (!foundContainers.has(server.id)) {
            // Server should exist but container wasn't found - mark as stopped
            this.logger.info(
              { serverId: server.id, uuid: server.uuid, previousStatus: server.status },
              "Marking missing server as stopped during reconciliation"
            );

            await this.prisma.server.update({
              where: { id: server.id },
              data: { status: ServerState.STOPPED }
            });

            await this.prisma.serverLog.create({
              data: {
                serverId: server.id,
                stream: "system",
                data: `[State Sync] Container not found during reconciliation, marked as stopped`
              }
            });

            // Notify clients
            await this.routeToClients(server.id, {
              type: "server_state_update",
              serverId: server.id,
              state: ServerState.STOPPED,
              timestamp: Date.now(),
            });
          }
        }
      } else if (message.type === "backup_complete") {
        const server = await this.prisma.server.findUnique({
          where: { id: message.serverId },
          include: { node: true },
        });

        if (!server) {
          return;
        }
        if (server.nodeId !== nodeId) {
          this.logger.warn({ nodeId, serverId: server.id }, "backup_complete from wrong node");
          return;
        }

        const backupRecord = message.backupId
          ? await this.prisma.backup.findUnique({ where: { id: message.backupId } })
          : await this.prisma.backup.findFirst({
              where: {
                serverId: message.serverId,
                name: message.backupName,
              },
              orderBy: { createdAt: "desc" },
            });

        if (!backupRecord) {
          return;
        }

        const mode = backupRecord.storageMode || "local";
        const agentPath =
          (backupRecord.metadata as any)?.agentPath ?? message.backupPath ?? backupRecord.path;

        const nextSizeMb = Number(message.sizeMb);
        const resolvedSizeMb = Number.isFinite(nextSizeMb) ? nextSizeMb : backupRecord.sizeMb;
        const resolvedChecksum =
          typeof message.checksum === "string" && message.checksum.length <= 256
            ? message.checksum
            : backupRecord.checksum;

        const updated = await this.prisma.backup.update({
          where: { id: backupRecord.id },
          data: {
            sizeMb: resolvedSizeMb,
            checksum: resolvedChecksum,
          },
        });
        this.logger.info(
          { backupId: backupRecord.id, sizeMb: updated.sizeMb },
          "Backup updated from agent",
        );

        await this.routeToClients(message.serverId, {
          ...message,
          sizeMb: updated.sizeMb,
          checksum: updated.checksum,
        });

        if (mode === "s3") {
          try {
            const { streamAgentBackupToS3 } = await import("../services/backup-storage");
            const storageKey = (backupRecord.metadata as any)?.storageKey;
            if (storageKey) {
              await streamAgentBackupToS3(
                this,
                server.nodeId,
                server.id,
                server.uuid,
                agentPath,
                storageKey,
                server as any,
              );
              await this.prisma.backup.update({
                where: { id: backupRecord.id },
                data: { metadata: { ...(backupRecord.metadata as any), remoteUploadStatus: "completed" } },
              });
            }
          } catch (error) {
            this.logger.error({ err: error, backupId: backupRecord.id }, "Failed to upload backup to S3");
            await this.prisma.backup.update({
              where: { id: backupRecord.id },
              data: {
                metadata: {
                  ...(backupRecord.metadata as any),
                  remoteUploadStatus: "failed",
                  remoteUploadError: error instanceof Error ? error.message : "S3 upload failed",
                },
              },
            });
          }
        } else if (mode === "sftp") {
          try {
            const { streamAgentBackupToSftp } = await import("../services/backup-storage");
            const storageKey = (backupRecord.metadata as any)?.storageKey;
            if (storageKey) {
              await streamAgentBackupToSftp(
                this,
                server.nodeId,
                server.id,
                server.uuid,
                agentPath,
                storageKey,
                server as any,
              );
              await this.prisma.backup.update({
                where: { id: backupRecord.id },
                data: { metadata: { ...(backupRecord.metadata as any), remoteUploadStatus: "completed" } },
              });
            }
          } catch (error) {
            this.logger.error({ err: error, backupId: backupRecord.id }, "Failed to upload backup to SFTP");
            await this.prisma.backup.update({
              where: { id: backupRecord.id },
              data: {
                metadata: {
                  ...(backupRecord.metadata as any),
                  remoteUploadStatus: "failed",
                  remoteUploadError: error instanceof Error ? error.message : "SFTP upload failed",
                },
              },
            });
          }
        } else if (mode === "stream") {
          try {
            const { streamAgentBackupToLocal } = await import("../services/backup-storage");
            await streamAgentBackupToLocal(
              this,
              server.nodeId,
              server.id,
              server.uuid,
              agentPath,
              backupRecord.path,
            );
          } catch (error) {
            this.logger.error({ err: error, backupId: backupRecord.id }, "Failed to fetch stream backup");
          }
        }

        const retentionCount = server.backupRetentionCount ?? 0;
        const retentionDays = server.backupRetentionDays ?? 0;
        if (retentionCount > 0 || retentionDays > 0) {
          const cutoff =
            retentionDays > 0
              ? new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
              : null;
          const backups = await this.prisma.backup.findMany({
            where: { serverId: message.serverId },
            orderBy: { createdAt: "desc" },
          });
          const byCount = retentionCount > 0 ? backups.slice(retentionCount) : [];
          const byAge = cutoff ? backups.filter((backup) => backup.createdAt < cutoff) : [];
          const toDelete = new Map(
            [...byCount, ...byAge].map((backup) => [backup.id, backup]),
          );
          if (toDelete.size) {
            for (const backup of toDelete.values()) {
              try {
                const { deleteBackupFromStorage } = await import("../services/backup-storage");
                await deleteBackupFromStorage(this, backup, {
                  id: server.id,
                  uuid: server.uuid,
                  nodeId: server.nodeId,
                  node: { isOnline: server.node?.isOnline ?? false },
                });
                await this.prisma.backup.delete({ where: { id: backup.id } });
              } catch (error) {
                this.logger.warn({ err: error, backupId: backup.id }, "Failed to enforce retention");
              }
            }
          }
        }

      } else if (message.type === "backup_restore_complete") {
        await this.routeToClients(message.serverId, message);
      } else if (message.type === "backup_delete_complete") {
        await this.routeToClients(message.serverId, message);
      } else if (message.type === "storage_resize_complete") {
        await this.routeToClients(message.serverId, message);
      }
    } catch (err) {
      this.logger.error(err, `Error handling agent message from ${nodeId}`);
    }
  }

  private async handleClientMessage(clientId: string, data: any) {
    try {
      const message = JSON.parse(data.toString());
      const client = this.clients.get(clientId);

      if (!client) {
        this.logger.warn({ clientId }, "Received message for unknown client");
        return;
      }

      this.logger.info({ clientId, type: message.type, authenticated: client.authenticated }, "Received client message");

      if (message.type === "client_handshake") {
        // If already authenticated via cookies, just acknowledge
        if (client.authenticated) {
          this.logger.info({ clientId, userId: client.userId }, "Client already authenticated via cookie");
          return;
        }
        
        this.logger.info({ clientId, hasToken: Boolean(message.token) }, "Received client_handshake");
        const token = typeof message.token === "string" ? message.token : "";
        if (!token) {
          this.logger.warn({ clientId }, "client_handshake missing token and no cookie auth");
          client.socket.close();
          this.clients.delete(clientId);
          return;
        }
        const session = await auth.api.getSession({
          headers: new Headers({ authorization: `Bearer ${token}` }),
        });
        if (!session) {
          this.logger.warn({ clientId }, "client_handshake invalid session");
          client.socket.close();
          this.clients.delete(clientId);
          return;
        }
        client.userId = session.user.id;
        client.authenticated = true;
        client.lastAuthAt = Date.now();
        this.logger.info({ clientId, userId: session.user.id }, "Client authenticated successfully");
        return;
      }

      if (!client.authenticated) {
        return;
      }

      if (message.type === "subscribe") {
        if (!message.serverId) {
          return;
        }
        const server = await this.prisma.server.findUnique({
          where: { id: message.serverId },
        });
        if (!server) {
          return;
        }
        const isAdmin = await this.userHasAdminRead(client.userId);
        const access = await this.prisma.serverAccess.findUnique({
          where: { userId_serverId: { userId: client.userId, serverId: server.id } },
        });
        if (!access && server.ownerId !== client.userId && !isAdmin) {
          if (client.socket.readyState === 1) {
            client.socket.send(
              JSON.stringify({
                type: "error",
                error: ErrorCodes.PERMISSION_DENIED,
                serverId: server.id,
              })
            );
          }
          return;
        }
        const isOwner = server.ownerId === client.userId;
        const canConsoleRead = isOwner || isAdmin || access?.permissions?.includes("console.read");
        const canServerRead = isOwner || isAdmin || access?.permissions?.includes("server.read");
        if (!canConsoleRead && !canServerRead) {
          if (client.socket.readyState === 1) {
            client.socket.send(
              JSON.stringify({
                type: "error",
                error: ErrorCodes.PERMISSION_DENIED,
                serverId: server.id,
              })
            );
          }
          return;
        }
        client.subscriptions.add(server.id);
        if (canConsoleRead) {
          await this.requestConsoleStream(server.id, server.uuid);
        }
        // Request immediate metrics to avoid 30-second wait
        if (server.nodeId) {
          await this.sendToAgent(server.nodeId, {
            type: "request_immediate_stats",
          });
        }
        return;
      }

      if (message.type === "unsubscribe") {
        if (message.serverId) {
          client.subscriptions.delete(message.serverId);
        }
        return;
      }

        if (message.type === "server_control") {
          const event: WsEvent.ServerControl = message;
          const validActions = new Set(["start", "stop", "kill", "restart", "reboot"]);
          if (!event.serverId || !validActions.has(event.action)) {
            return;
          }

        // Verify permission
        const access = await this.prisma.serverAccess.findUnique({
          where: {
            userId_serverId: { userId: client.userId, serverId: event.serverId },
          },
        });

        const server = await this.prisma.server.findUnique({
          where: { id: event.serverId },
        });

        if (!server) {
          return client.socket.send(
            JSON.stringify({
              type: "error",
              error: ErrorCodes.SERVER_NOT_FOUND,
            })
          );
        }

        // Check if client is owner or has access
        const isOwner = server.ownerId === client.userId;
        const isAdmin = await this.userHasAdminRead(client.userId);
        if (!isOwner && !access && !isAdmin) {
          return client.socket.send(
            JSON.stringify({
              type: "error",
              error: ErrorCodes.PERMISSION_DENIED,
              serverId: server.id,
            })
          );
        }

        if (process.env.SUSPENSION_ENFORCED !== "false" && server.suspendedAt) {
          return client.socket.send(
            JSON.stringify({
                type: "error",
                error: "SERVER_SUSPENDED",
                serverId: server.id,
              })
            );
        }
        const requiredPermission =
          event.action === "start"
            ? "server.start"
            : event.action === "stop"
              ? "server.stop"
              : event.action === "restart" || event.action === "reboot" || event.action === "kill"
                ? "server.start"
                : "server.start";
        if (!isOwner && !isAdmin && !access?.permissions?.includes(requiredPermission)) {
          return client.socket.send(
            JSON.stringify({
              type: "error",
              error: ErrorCodes.PERMISSION_DENIED,
              serverId: server.id,
            })
          );
        }

        // Route to agent
        const agent = this.agents.get(server.nodeId);
        if (agent && agent.socket.readyState === 1) {
          agent.socket.send(
            JSON.stringify({
              ...event,
              serverUuid: server.uuid,
              suspended: Boolean(server.suspendedAt),
            })
          );
        } else {
          return client.socket.send(
            JSON.stringify({
              type: "error",
              error: ErrorCodes.NODE_OFFLINE,
              serverId: server.id,
            })
          );
        }
      } else if (message.type === "console_input") {
          const event: WsEvent.ConsoleInput = message;
          if (!event.serverId || typeof event.data !== "string") {
            return;
          }

        const server = await this.prisma.server.findUnique({
          where: { id: event.serverId },
        });

        if (!server) {
          if (client.socket.readyState === 1) {
            client.socket.send(
              JSON.stringify({
                type: "error",
                error: ErrorCodes.SERVER_NOT_FOUND,
                serverId: event.serverId,
              })
            );
          }
          return;
        }

        const isAdmin = await this.userHasAdminRead(client.userId);
        const access = await this.prisma.serverAccess.findUnique({
          where: { userId_serverId: { userId: client.userId, serverId: server.id } },
        });
        if (!access && server.ownerId !== client.userId && !isAdmin) {
          if (client.socket.readyState === 1) {
            client.socket.send(
              JSON.stringify({
                type: "error",
                error: ErrorCodes.PERMISSION_DENIED,
                serverId: server.id,
              })
            );
          }
          return;
        }
        if (
          !access?.permissions?.includes("console.write") &&
          server.ownerId !== client.userId &&
          !isAdmin
        ) {
          if (client.socket.readyState === 1) {
            client.socket.send(
              JSON.stringify({
                type: "error",
                error: ErrorCodes.PERMISSION_DENIED,
                serverId: server.id,
              })
            );
          }
          return;
        }
        if (process.env.SUSPENSION_ENFORCED !== "false" && server.suspendedAt) {
          if (client.socket.readyState === 1) {
            client.socket.send(
              JSON.stringify({
                type: "error",
                error: "SERVER_SUSPENDED",
                serverId: server.id,
              })
            );
          }
          return;
        }
        if (
          !this.allowConsoleCommand(clientId) ||
          !this.allowServerCommand(server.id) ||
          event.data.length > 4096
        ) {
          if (client.socket.readyState === 1) {
            client.socket.send(
              JSON.stringify({
                type: "console_output",
                serverId: server.id,
                stream: "system",
                data: "[Catalyst] Console input rate limit exceeded.\n",
                timestamp: Date.now(),
              })
            );
          }
          return;
        }

        // Route to agent
        const agent = this.agents.get(server.nodeId);
        this.logger.info({ 
          serverId: server.id, 
          nodeId: server.nodeId, 
          hasAgent: !!agent, 
          agentState: agent?.socket?.readyState 
        }, "Routing console_input to agent");
        if (agent && agent.socket.readyState === 1) {
          agent.socket.send(
            JSON.stringify({ ...event, serverUuid: server.uuid })
          );
          this.logger.info({ nodeId: server.nodeId }, "Console input sent to agent");
        } else if (client.socket.readyState === 1) {
          this.logger.warn({ nodeId: server.nodeId, hasAgent: !!agent }, "Agent not available for console_input");
          client.socket.send(
            JSON.stringify({
              type: "error",
              error: ErrorCodes.NODE_OFFLINE,
              serverId: server.id,
            })
          );
        }
      }
    } catch (err) {
      this.logger.error(err, `Error handling client message from ${clientId}`);
    }
  }

  private async routeToClients(serverId: string, message: any) {
    const server = await this.prisma.server.findUnique({
      where: { id: serverId },
      include: {
        access: {
          select: { userId: true },
        },
      },
    });

    if (!server) {
      return;
    }

    const allowedUsers = [
      server.ownerId,
      ...server.access.map((a) => a.userId),
    ];

    for (const [, client] of this.clients) {
      if (allowedUsers.includes(client.userId)) {
        if (client.socket.readyState === 1) {
          client.socket.send(JSON.stringify(message));
        }
      }
    }
  }

  private async routeConsoleToSubscribers(serverId: string, message: any) {
    const server = await this.prisma.server.findUnique({
      where: { id: serverId },
      include: {
        access: {
          select: { userId: true },
        },
      },
    });

    if (!server) {
      return;
    }

    const allowedUsers = [
      server.ownerId,
      ...server.access.map((a) => a.userId),
    ];

    for (const [, client] of this.clients) {
      if (!client.subscriptions.has(serverId)) {
        continue;
      }
      if (allowedUsers.includes(client.userId)) {
        if (client.socket.readyState === 1) {
          client.socket.send(JSON.stringify(message));
        }
      }
    }
  }

  private allowConsoleCommand(clientId: string) {
    const now = Date.now();
    const windowMs = this.consoleInputLimit.windowMs;
    const limit = this.consoleInputLimit.max;
    this.maybeRefreshConsoleLimits(now);
    const existing = this.clientCommandCounters.get(clientId);
    if (!existing || now >= existing.resetAt) {
      this.clientCommandCounters.set(clientId, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (existing.count >= limit) {
      return false;
    }
    existing.count += 1;
    return true;
  }

  private maybeRefreshConsoleLimits(now = Date.now()) {
    if (now - this.lastConsoleLimitRefreshAt < this.consoleLimitRefreshIntervalMs) {
      return;
    }
    this.lastConsoleLimitRefreshAt = now;
    this.refreshConsoleLimits().catch((err) =>
      this.logger.warn({ err }, "Failed to refresh console rate limits")
    );
  }

  private allowConsoleOutput(serverId: string) {
    const now = Date.now();
    const windowMs = this.consoleOutputLimit.windowMs;
    const limit = this.consoleOutputLimit.max;
    const existing = this.consoleOutputCounters.get(serverId);
    if (!existing || now >= existing.resetAt) {
      this.consoleOutputCounters.set(serverId, { count: 1, resetAt: now + windowMs, warned: false });
      return true;
    }
    existing.count += 1;
    return existing.count <= limit;
  }

  private async maybeWarnConsoleThrottle(serverId: string) {
    const now = Date.now();
    const entry = this.consoleOutputCounters.get(serverId);
    if (!entry || entry.warned || now >= entry.resetAt) {
      return;
    }
    entry.warned = true;
    await this.routeConsoleToSubscribers(serverId, {
      type: "console_output",
      serverId,
      stream: "system",
      data: "[Catalyst] Console output throttled.\n",
      timestamp: now,
    });
  }

  private async requestConsoleStream(serverId: string, serverUuid: string) {
    const server = await this.prisma.server.findUnique({
      where: { id: serverId },
    });
    if (!server) {
      return;
    }
    const resumeKey = `${server.nodeId}:${serverId}`;
    const now = Date.now();
    const last = this.consoleResumeTimestamps.get(resumeKey) ?? 0;
    if (now - last < 1000) {
      return;
    }
    this.consoleResumeTimestamps.set(resumeKey, now);
    const agent = this.agents.get(server.nodeId);
    if (agent && agent.socket.readyState === 1) {
      agent.socket.send(
        JSON.stringify({
          type: "resume_console",
          serverId,
          serverUuid,
        })
      );
    }
  }

  private startHeartbeatCheck() {
    setInterval(() => {
      const now = Date.now();
      const timeout = 60000; // 60 seconds - agent sends every 15s

      for (const [nodeId, agent] of this.agents) {
        if (now - agent.lastHeartbeat > timeout) {
          this.logger.warn(`Agent heartbeat timeout: ${nodeId}`);
          agent.socket.close();
          this.agents.delete(nodeId);
          this.prisma.node.update({
            where: { id: nodeId },
            data: { isOnline: false },
          });
        }
      }
    }, 10000); // Check every 10 seconds
  }

  // Send message to agent (for API endpoints)
  async sendToAgent(nodeId: string, message: any): Promise<boolean> {
    const agent = this.agents.get(nodeId);
    if (!agent || !agent.authenticated || agent.socket.readyState !== 1) {
      this.logger.warn(
        { nodeId, type: typeof message?.type === "string" ? message.type : undefined },
        "Cannot send to agent: not connected",
      );
      return false;
    }

    try {
      agent.socket.send(JSON.stringify(message));
      return true;
    } catch (err) {
      this.logger.error(err, `Error sending message to agent ${nodeId}`);
      return false;
    }
  }

  async requestFromAgent(nodeId: string, message: any, timeoutMs = 15000): Promise<any> {
    const agent = this.agents.get(nodeId);
    if (!agent || !agent.authenticated || agent.socket.readyState !== 1) {
      throw new Error(`Agent ${nodeId} not connected`);
    }

    if (this.pendingAgentRequests.size >= this.pendingAgentRequestLimit) {
      throw new Error("Too many pending agent requests");
    }
    const requestId = crypto.randomUUID();
    const payload = { ...message, requestId };

    const response = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingAgentRequests.delete(requestId);
        reject(new Error("Agent request timed out"));
      }, timeoutMs);
      this.pendingAgentRequests.set(requestId, { resolve, reject, timeout, kind: "json" });
    });

    agent.socket.send(JSON.stringify(payload));
    return response;
  }

  async requestBinaryFromAgent(nodeId: string, message: any, timeoutMs = 60000): Promise<Buffer> {
    const agent = this.agents.get(nodeId);
    if (!agent || !agent.authenticated || agent.socket.readyState !== 1) {
      throw new Error(`Agent ${nodeId} not connected`);
    }

    if (this.pendingAgentRequests.size >= this.pendingAgentRequestLimit) {
      throw new Error("Too many pending agent requests");
    }
    const requestId = crypto.randomUUID();
    const payload = { ...message, requestId };

    const response = new Promise<Buffer>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingAgentRequests.delete(requestId);
        reject(new Error("Agent request timed out"));
      }, timeoutMs);
      this.pendingAgentRequests.set(requestId, {
        resolve,
        reject,
        timeout,
        kind: "binary",
        chunks: [],
      });
    });

    agent.socket.send(JSON.stringify(payload));
    return response;
  }

  async streamBinaryFromAgent(
    nodeId: string,
    message: any,
    onChunk: (chunk: Buffer) => void,
    timeoutMs = 60000,
  ): Promise<void> {
    const agent = this.agents.get(nodeId);
    if (!agent || !agent.authenticated || agent.socket.readyState !== 1) {
      throw new Error(`Agent ${nodeId} not connected`);
    }

    if (this.pendingAgentRequests.size >= this.pendingAgentRequestLimit) {
      throw new Error("Too many pending agent requests");
    }
    const requestId = crypto.randomUUID();
    const payload = { ...message, requestId };

    const response = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingAgentRequests.delete(requestId);
        reject(new Error("Agent request timed out"));
      }, timeoutMs);
      this.pendingAgentRequests.set(requestId, {
        resolve,
        reject,
        timeout,
        kind: "binary",
        onChunk,
      });
    });

    agent.socket.send(JSON.stringify(payload));
    await response;
  }
}
