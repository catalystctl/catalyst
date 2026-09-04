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
import { hasPermission, hasNodeAccess } from "../lib/permissions";
import { ALL_SERVER_PERMISSIONS } from "../lib/permissions-catalog";
import { sanitizeInput } from "../lib/validation";
import { ServerStateMachine } from "../services/state-machine";
import { normalizeHostIp } from "../utils/ipam";
import { captureSystemError } from "../services/error-logger";
import { injectPterodactylCompatibilityVars } from "../utils/pterodactyl-env.js";
import { getSecuritySettings, maxUploadBytesFromMb } from "../services/mailer";

/**
 * Simple capped Map that evicts the oldest entries when max size is reached.
 * Used as a lightweight LRU when lru-cache is not available.
 */
class CappedMap<K, V> extends Map<K, V> {
  constructor(private maxSize: number) {
    super();
  }

  set(key: K, value: V): this {
    if (this.size >= this.maxSize && !this.has(key)) {
      const first = this.keys().next().value;
      if (first !== undefined) {
        this.delete(first);
      }
    }
    return super.set(key, value);
  }
}

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
  /** Set while the socket is registered under a temporary pre-auth key. */
  preAuthNodeId?: string;
}

// Message types considered control-plane critical: always delivered when a
// socket exists even under backpressure, and never worth queueing offline
// beyond the general outbox rules below.
const CRITICAL_OUTBOUND_TYPES = new Set([
  "start_server",
  "stop_server",
  "kill_server",
  "restart_server",
  "delete_server",
  "install_server",
  "reinstall_server",
  "cancel_install_server",
  "rebuild_server",
  "update_agent",
  "resize_storage",
]);

// Message types safe to queue while an agent is mid-reconnect. Stale beyond
// the TTL they are dropped rather than replayed against a possibly-changed
// server state.
const OUTBOXABLE_TYPES = new Set([
  "start_server",
  "stop_server",
  "kill_server",
  "restart_server",
  "request_immediate_stats",
  "resume_console",
  "update_agent",
  "resize_storage",
]);

// Supported agent WebSocket protocol major version. Minor bumps are
// backwards-compatible; a major mismatch rejects the handshake explicitly.
const AGENT_PROTOCOL_MAJOR = 1;

// Outbox power commands eligible for stale-state re-validation at drain time.
const POWER_OUTBOX_COMMANDS = new Set([
  "start_server",
  "stop_server",
  "kill_server",
  "restart_server",
]);

// Heartbeat lastSeenAt persistence throttle: agents heartbeat every 15s, but
// writing lastSeenAt on every beat is pure DB churn. Persist at most once per
// window per node (finalizeAgentConnection resets the marker on reconnect).
const HEARTBEAT_PERSIST_THROTTLE_MS = 30_000;

/**
 * Coerce an inbound metric value into a finite number clamped to
 * [min, max]. Non-finite inputs (NaN, missing, wrong type) fall back to
 * `fallback` instead of poisoning the rest of the report — previously one
 * bad field could void an entire metrics payload or throw mid-persist.
 */
export function sanitizeMetric(value: unknown, min: number, max: number, fallback = 0): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

/** Round-and-clamp helper for integer MiB fields. */
export function sanitizeIntMetric(value: unknown, min: number, max: number, fallback = 0): number {
  return Math.round(sanitizeMetric(value, min, max, fallback));
}

/**
 * Byte counters arrive as u64 from the agent; numbers beyond 2^53 lose
 * precision in JS but remain positive. Non-numeric/NaN input becomes 0n —
 * BigInt(NaN) throws, which used to abort health-report processing entirely.
 */
export function toByteCounterBig(value: unknown): bigint {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0n;
  // Clamp to the int8 column range: 1e20 is finite but overflows bigint
  // columns (networkRxBytes/networkTxBytes) and would void the whole write.
  const bytes = BigInt(Math.floor(n));
  return bytes > INT8_MAX ? INT8_MAX : bytes;
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
  /** Owning node — lets us fail-fast every in-flight request on disconnect. */
  nodeId?: string;
  chunks?: Buffer[];
  onChunk?: (chunk: Buffer) => void;
};

// Postgres int4/int8 ceilings: metric columns are Int/BigInt, so values beyond
// these make the whole write (or an entire batch INSERT) fail.
const INT4_MAX = 2_147_483_647;
const INT8_MAX = 9_223_372_036_854_775_807n;

/**
 * Validate an agent-supplied epoch-milliseconds timestamp. Returns null for
 * non-finite input and for values outside the JS Date range (±8.64e15 ms) —
 * e.g. 1e20 produces an Invalid Date which would poison a whole batch INSERT.
 */
export function sanitizeBatchTimestamp(value: unknown): Date | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const ms = Math.floor(n);
  if (Math.abs(ms) > 8.64e15) return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

export class WebSocketGateway {
  private agents = new Map<string, ConnectedAgent>();
  private clients = new Map<string, ClientConnection>();
  private logger: pino.Logger;
  private pendingAgentRequests = new Map<string, PendingAgentRequest>();
  // Pre-handshake agent sockets are registered under a temporary key so an
  // unauthenticated socket can never displace a live authenticated agent.
  // handshakeTimeouts backs the 10s handshake deadline per connection.
  private handshakeTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  // nodeId → timestamp of the last heartbeat whose lastSeenAt hit the database.
  // Entries older than ~10 minutes are swept; reset on agent reconnect.
  private readonly nodeLastPersistedSeen = new Map<string, number>();
  private activeBackupRelay: { sourceNodeId: string; targetNodeId: string; resolve: () => void; reject: (err: Error) => void } | null = null;
  private consoleOutputCounters = new Map<string, { count: number; resetAt: number; warned: boolean }>();
  private clientCommandCounters = new Map<string, { count: number; resetAt: number }>();
  // Per-connection inbound client WS message limiter: every message costs DB
  // queries (subscribe runs several), so unbounded rates are a DB-amplification
  // DoS vector for any authenticated user.
  private clientMessageCounters = new Map<string, { count: number; resetAt: number }>();
  private static readonly CLIENT_MESSAGE_LIMIT = { max: 240, windowMs: 10_000 };
  private agentMessageCounters = new Map<string, { count: number; resetAt: number }>();
  private agentMetricsCounters = new Map<string, { count: number; resetAt: number }>();
  private serverMetricsCounters = new Map<string, { count: number; resetAt: number }>();
  private agentLimitWarnings = new Map<string, { resetAt: number }>();
  private serverCommandCounters = new Map<string, { count: number; resetAt: number }>();

  // Cache server access lists to avoid DB query on every routeToClients call.
  // Refreshed every 30 seconds per server.
  private serverAccessCache = new CappedMap<string, { allowedUsers: Set<string>; expiresAt: number }>(5000);
  private latestResourceStats = new CappedMap<string, Record<string, unknown>>(5000);
  private static readonly SERVER_ACCESS_TTL_MS = 30_000;
  private serverConsoleBytes = new Map<string, { count: number; resetAt: number }>();
  private consoleResumeTimestamps = new Map<string, number>();
  private lastConsoleLimitRefreshAt = 0;
  private consoleOutputLimit = { max: 2000, windowMs: 1000 };
  private readonly consoleLimitRefreshIntervalMs = 5000;
  private consoleInputLimit = { max: 10, windowMs: 1000 };
  private agentMessageLimit = { max: 10000, windowMs: 1000 };
  private agentMetricsLimit = { max: 1000, windowMs: 1000 };
  private serverMetricsLimit = { max: 1, windowMs: 1000 };
  private readonly agentConsoleBytesLimit = { maxBytes: resolveConsoleOutputByteLimit() };
  private readonly pendingAgentRequestLimit = 2000;
  private readonly autoRestartingServers = new Set<string>();
  // Track the last agent update version requested per node to avoid spamming.
  // Maps nodeId → target version string that was already sent.
  private readonly agentUpdateSent = new Map<string, string>();
  // After a failed update, wait before sending update_agent again.
  private readonly agentUpdateRetryAfter = new Map<string, number>();
  private static readonly AGENT_UPDATE_RETRY_MS = 15 * 60 * 1000;
  private heartbeatInterval?: ReturnType<typeof setInterval>;
  // Panel→agent WS-level ping loop: proves the agent socket is alive in both
  // directions, not just that the agent is still sending.
  private pingInterval?: ReturnType<typeof setInterval>;
  private subscriberSweepInterval?: ReturnType<typeof setInterval>;

  // ── Agent outbox ───────────────────────────────────────────────────────────
  // Commands queued per node when sendToAgent() finds no connected agent
  // (brief reconnects, panel restarts mid-deploy). Drained on reconnection;
  // entries expire after OUTBOX_TTL_MS and the queue is capped per node.
  private readonly outbox = new Map<string, Array<{ payload: string; queuedAt: number }>>();
  private static readonly OUTBOX_MAX_PER_NODE = 50;
  private static readonly OUTBOX_TTL_MS = 30_000;

  // Backpressure guard: if an agent's TCP buffer accumulates more than this
  // many unsent bytes (slow consumer, half-open peer), shed non-critical
  // outbound traffic instead of growing memory without bound.
  private static readonly AGENT_BACKPRESSURE_BYTES = (() => {
    const n = Number(process.env.AGENT_BACKPRESSURE_BYTES);
    return Number.isFinite(n) && n > 0 ? n : 4 * 1024 * 1024;
  })();

  // ── Reliability counters (per node, since process start) ──────────────────
  private readonly reliabilityConnections = new Map<string, number[]>();
  private readonly reliabilityHeartbeatTimeouts = new Map<string, number>();
  private readonly reliabilityRateLimitedDrops = new Map<string, number>();
  private readonly reliabilityOutboxQueued = new Map<string, number>();
  private readonly reliabilityOutboxDropped = new Map<string, number>();
  private readonly reliabilityBackpressureDrops = new Map<string, number>();
  private static readonly FLAP_WINDOW_MS = 60_000;
  private static readonly FLAP_THRESHOLD = 5;

  private bumpCounter(map: Map<string, number>, nodeId: string): void {
    map.set(nodeId, (map.get(nodeId) ?? 0) + 1);
  }

  // Last time we warned about state syncs for a given nodeId:serverUuid pair.
  private readonly unknownServerSyncWarned = new Map<string, number>();
  private static readonly UNKNOWN_SERVER_SYNC_WARN_TTL_MS = 10 * 60 * 1000;
  private static readonly UNKNOWN_SERVER_SYNC_WARN_CAP = 500;

  /** Warn once per TTL about an unknown synced container; count every hit. */
  private warnUnknownServerSyncOnce(nodeId: string, serverUuid: string): void {
    const key = `${nodeId}:${serverUuid}`;
    const now = Date.now();
    const last = this.unknownServerSyncWarned.get(key) ?? 0;
    if (now - last > WebSocketGateway.UNKNOWN_SERVER_SYNC_WARN_TTL_MS) {
      this.logger.warn(
        { nodeId, serverId: serverUuid },
        "State sync for unknown server ID (suppressing repeats for 10m)",
      );
      this.unknownServerSyncWarned.set(key, now);
      // Bound the map: on overflow drop the oldest half via re-insertion order.
      if (this.unknownServerSyncWarned.size > WebSocketGateway.UNKNOWN_SERVER_SYNC_WARN_CAP) {
        const entries = Array.from(this.unknownServerSyncWarned.entries());
        this.unknownServerSyncWarned.clear();
        for (const [k, v] of entries.slice(-WebSocketGateway.UNKNOWN_SERVER_SYNC_WARN_CAP / 2)) {
          this.unknownServerSyncWarned.set(k, v);
        }
      }
    }
  }

  /** Cumulative per-node reliability counters plus flap detection. */
  getReliabilityStats(): Record<string, Record<string, number>> {
    const toObj = <T>(m: Map<string, T>) => Object.fromEntries(m) as Record<string, any>;
    return {
      connections: toObj(this.reliabilityConnections),
      heartbeatTimeouts: toObj(this.reliabilityHeartbeatTimeouts),
      rateLimitedDroppedMessages: toObj(this.reliabilityRateLimitedDrops),
      outboxQueued: toObj(this.reliabilityOutboxQueued),
      outboxDropped: toObj(this.reliabilityOutboxDropped),
      backpressureDropped: toObj(this.reliabilityBackpressureDrops),
    };
  }

  /**
   * Track a successful agent connection for flap detection. Nodes reconnecting
   * more than FLAP_THRESHOLD times within FLAP_WINDOW_MS are reported to admin
   * subscribers so chronic instability surfaces instead of hiding behind logs.
   */
  private recordAgentConnection(nodeId: string): void {
    const now = Date.now();
    const stamps = (this.reliabilityConnections.get(nodeId) ?? []).filter(
      (t) => now - t < WebSocketGateway.FLAP_WINDOW_MS,
    );
    stamps.push(now);
    this.reliabilityConnections.set(nodeId, stamps);
    if (stamps.length >= WebSocketGateway.FLAP_THRESHOLD) {
      this.logger.warn({ nodeId, reconnectsInWindow: stamps.length }, "Node connection flapping detected");
      this.pushToAdminSubscribers("node_flapping", {
        type: "node_flapping",
        nodeId,
        reconnectsInWindow: stamps.length,
        windowMs: WebSocketGateway.FLAP_WINDOW_MS,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /** Force-tear down a socket. Unlike close(), terminate() does not wait for a
   * close-frame handshake from a peer that may be half-open or dead. */
  private terminateSocket(socket: any): void {
    try {
      if (typeof socket?.terminate === "function") {
        socket.terminate();
      } else {
        socket?.close?.();
      }
    } catch {
      // Socket may already be destroyed — nothing to do.
    }
  }

  private queueInOutbox(nodeId: string, message: any): boolean {
    if (!message || typeof message.type !== "string" || !OUTBOXABLE_TYPES.has(message.type)) {
      return false;
    }
    const now = Date.now();
    let queue = this.outbox.get(nodeId);
    if (!queue) {
      queue = [];
      this.outbox.set(nodeId, queue);
    }
    // Expire stale entries before appending.
    while (queue.length > 0 && now - queue[0].queuedAt > WebSocketGateway.OUTBOX_TTL_MS) {
      queue.shift();
      this.bumpCounter(this.reliabilityOutboxDropped, nodeId);
    }
    if (queue.length >= WebSocketGateway.OUTBOX_MAX_PER_NODE) {
      this.bumpCounter(this.reliabilityOutboxDropped, nodeId);
      return false;
    }
    queue.push({ payload: JSON.stringify(message), queuedAt: now });
    this.bumpCounter(this.reliabilityOutboxQueued, nodeId);
    return true;
  }

  private async drainOutbox(nodeId: string, agent: ConnectedAgent): Promise<void> {
    const queue = this.outbox.get(nodeId);
    if (!queue || queue.length === 0) return;
    this.outbox.delete(nodeId);
    const now = Date.now();
    let sent = 0;
    let expired = 0;
    let stale = 0;
    let failureAt = -1;

    // Stale-command guard: a power command queued while the agent was offline
    // can contradict decisions made since (user stopped the server,
    // auto-restart already started it, server was suspended or deleted).
    // Re-validate every queued power command against current DB state before
    // replaying; non-power commands (stats/resume) are always safe to replay.
    const pendingPower = new Map<string, string[]>(); // serverId → queued types
    const pendingResize = new Map<string, number[]>(); // serverId → queued disk targets
    for (const entry of queue) {
      try {
        const payload = JSON.parse(entry.payload);
        if (
          POWER_OUTBOX_COMMANDS.has(payload?.type) &&
          typeof payload.serverId === "string"
        ) {
          const list = pendingPower.get(payload.serverId) ?? [];
          list.push(payload.type);
          pendingPower.set(payload.serverId, list);
        } else if (
          payload?.type === "resize_storage" &&
          typeof payload.serverId === "string" &&
          Number.isFinite(payload.allocatedDiskMb)
        ) {
          const targets = pendingResize.get(payload.serverId) ?? [];
          targets.push(Number(payload.allocatedDiskMb));
          pendingResize.set(payload.serverId, targets);
        }
      } catch {
        // handled per-entry below
      }
    }
    const staleServerIds = new Set<string>();
    const staleResizeServerIds = new Set<string>();
    if (pendingPower.size > 0 || pendingResize.size > 0) {
      try {
        const servers = await this.prisma.server.findMany({
          where: {
            id: {
              in: [...new Set([...pendingPower.keys(), ...pendingResize.keys()])],
            },
          },
          select: { id: true, status: true, suspendedAt: true, allocatedDiskMb: true },
        });
        const byId = new Map(servers.map((s: any) => [s.id, s]));
        for (const [serverId, commands] of pendingPower) {
          const server = byId.get(serverId);
          // Deleted or suspended server: never replay power commands.
          if (!server || (server.suspendedAt && process.env.SUSPENSION_ENFORCED !== "false")) {
            staleServerIds.add(serverId);
            continue;
          }
          for (const command of commands) {
            const state = server.status as ServerState;
            const contradictory =
              (command === "start_server" && !ServerStateMachine.canStart(state)) ||
              (command === "stop_server" && !ServerStateMachine.canStop(state)) ||
              (command === "kill_server" && !ServerStateMachine.canStop(state)) ||
              (command === "restart_server" && !ServerStateMachine.canRestart(state));
            if (contradictory) {
              staleServerIds.add(serverId);
              break;
            }
          }
        }
        // Queued resizes: a grow is always safe to replay, but a queued shrink
        // is stale if the server is no longer stopped (shrink-while-running is
        // rejected by the API and would be rejected by the agent too).
        for (const [serverId, targets] of pendingResize) {
          const server = byId.get(serverId);
          if (!server || (server.suspendedAt && process.env.SUSPENSION_ENFORCED !== "false")) {
            staleResizeServerIds.add(serverId);
            continue;
          }
          const state = server.status as ServerState;
          if (targets.some((target) => target < server.allocatedDiskMb && state !== ServerState.STOPPED)) {
            staleResizeServerIds.add(serverId);
          }
        }
      } catch (err) {
        // DB unavailable: replay rather than silently lose the commands
        // (matches the pre-guard behavior for this failure mode).
        this.logger.warn({ err, nodeId }, "Outbox stale-command re-validation failed; replaying queue");
      }
    }

    for (let i = 0; i < queue.length; i++) {
      const entry = queue[i];
      if (now - entry.queuedAt > WebSocketGateway.OUTBOX_TTL_MS) {
        expired += 1;
        continue;
      }
      if (staleServerIds.size > 0 || staleResizeServerIds.size > 0) {
        try {
          const payload = JSON.parse(entry.payload);
          const serverId = typeof payload?.serverId === "string" ? payload.serverId : null;
          const isStalePower =
            serverId !== null &&
            POWER_OUTBOX_COMMANDS.has(payload?.type) &&
            staleServerIds.has(serverId);
          const isStaleResize =
            serverId !== null &&
            payload?.type === "resize_storage" &&
            staleResizeServerIds.has(serverId);
          if (isStalePower || isStaleResize) {
            stale += 1;
            continue;
          }
        } catch {
          stale += 1;
          continue;
        }
      }
      // Only send to an open socket. The ws library silently no-ops send()
      // on a closed socket, which would silently discard the command.
      if (agent.socket.readyState !== 1) {
        failureAt = i;
        break;
      }
      try {
        agent.socket.send(entry.payload);
        sent += 1;
      } catch {
        failureAt = i;
        break;
      }
    }
    if (failureAt >= 0) {
      // Re-queue everything that was not successfully sent (including the
      // failed entry itself) so a subsequent reconnect can retry it, instead
      // of silently dropping the rest of the queue.
      const remaining = queue
        .slice(failureAt)
        .filter((e) => now - e.queuedAt <= WebSocketGateway.OUTBOX_TTL_MS);
      if (remaining.length > 0) {
        const existing = this.outbox.get(nodeId) ?? [];
        this.outbox.set(nodeId, [...remaining, ...existing]);
        this.bumpCounter(this.reliabilityOutboxDropped, nodeId);
      }
    }
    if (expired > 0 || stale > 0) {
      this.bumpCounter(this.reliabilityOutboxDropped, nodeId);
    }
    if (sent > 0 || expired > 0 || stale > 0) {
      this.logger.info(
        { nodeId, drained: sent, expired, stale },
        "Drained agent command outbox after reconnect",
      );
    }
  }

  // SSE console stream subscribers — maps serverId → subscriberId → { push, lastActivity }
  private readonly sseSubscribers = new Map<string, Map<string, { push: (event: string, data: any) => void; lastActivity: number }>>();
  // SSE event subscribers — maps serverId → subscriberId → { eventTypes, push, lastActivity }
  // Used for non-console events (state updates, backups, alerts, etc.)
  private readonly sseEventSubscribers = new Map<string, Map<string, { eventTypes: string[]; push: (event: string, data: any) => void; lastActivity: number }>>();
  // Global SSE event subscribers — receive ALL events across all servers (for AppLayout)
  private readonly globalSseSubscribers = new Map<string, { eventTypes: string[]; push: (event: string, data: any) => void; serverIds?: Set<string>; lastActivity: number }>();
  // Admin SSE event subscribers — receive entity-level admin events (users, nodes, templates, alerts)
  private readonly adminEventSubscribers = new Map<string, { eventTypes: string[]; push: (event: string, data: any) => void; lastActivity: number }>();
  // Discovered containers on nodes (for auto-import of existing servers)
  private discoveredContainers = new Map<string, Array<{
    containerId: string;
    image: string;
    status: string;
    labels: Record<string, string>;
    networkMode?: string;
    memoryLimitMb?: number;
    cpuCores?: number;
    startupCommand?: string;
    envVarNames?: string[];
    discoveredAt: number;
  }>>();

  // ── Agent auth lockout tracker (progressive backoff) ───────────────────────
  // Tracks failed auth attempts per nodeId. Lockout durations increase with
  // each successive failure: 5s, 15s, 60s, 300s, 900s, 3600s (max 1 hour).
  private agentAuthFailures = new Map<string, { count: number; lockedUntil: number }>();
  private static readonly AGENT_LOCKOUT_BASE_SECONDS = [5, 15, 60, 300, 900, 3600];

  private getAgentLockoutSeconds(failureCount: number): number {
    const tiers = WebSocketGateway.AGENT_LOCKOUT_BASE_SECONDS;
    return tiers[Math.min(failureCount - 1, tiers.length - 1)];
  }

  private recordAgentAuthFailure(nodeId: string): number {
    const entry = this.agentAuthFailures.get(nodeId);
    const now = Date.now();
    if (!entry || now >= entry.lockedUntil) {
      // First failure or previous lockout expired — start fresh
      const lockoutSeconds = this.getAgentLockoutSeconds(1);
      this.agentAuthFailures.set(nodeId, { count: 1, lockedUntil: now + lockoutSeconds * 1000 });
      return lockoutSeconds;
    }
    // Still within lockout window — increment and extend
    entry.count += 1;
    const lockoutSeconds = this.getAgentLockoutSeconds(entry.count);
    entry.lockedUntil = now + lockoutSeconds * 1000;
    return lockoutSeconds;
  }

  private checkAgentLockout(nodeId: string): { locked: boolean; retryAfterSeconds: number } {
    const entry = this.agentAuthFailures.get(nodeId);
    if (!entry) return { locked: false, retryAfterSeconds: 0 };
    const now = Date.now();
    if (now >= entry.lockedUntil) {
      // Lockout expired, clean up
      this.agentAuthFailures.delete(nodeId);
      return { locked: false, retryAfterSeconds: 0 };
    }
    return { locked: true, retryAfterSeconds: Math.ceil((entry.lockedUntil - now) / 1000) };
  }

  private clearAgentAuthFailures(nodeId: string): void {
    this.agentAuthFailures.delete(nodeId);
  }

  // ── Plugin WebSocket handler dispatch ─────────────────────────────────────
  // Maps prefixed message types (e.g. "plugin:ticketing-plugin:subscribe")
  // to the handler registered by the plugin and the plugin name.
  private pluginWsHandlers = new Map<
    string,
    { handler: (data: any, clientId?: string, userId?: string) => Promise<void> | void; pluginName: string }
  >();

  // Connection limits (environment-driven with safe defaults)
  private readonly MAX_AGENT_CONNECTIONS = Number(process.env.MAX_AGENT_CONNECTIONS || 1000);
  private readonly MAX_CLIENT_CONNECTIONS = Number(process.env.MAX_CLIENT_CONNECTIONS || 10000);
  private readonly MAX_CONNECTIONS_PER_USER = Number(process.env.MAX_CONNECTIONS_PER_USER || 10);

  // SSE hard caps
  private readonly MAX_SSE_CONSOLE_PER_SERVER = 50;
  private readonly MAX_SSE_EVENTS_PER_SERVER = 100;

  constructor(private prisma: PrismaClient, logger: pino.Logger) {
    this.logger = logger.child({ component: "WebSocketGateway" });
    this.startHeartbeatCheck();
    this.startPingLoop();
    this.startMaintenanceSweep();
    this.refreshConsoleLimits().catch((err) =>
      this.logger.warn({ err }, "Failed to load console rate limits")
    );
  }

  private async refreshConsoleLimits() {
    const settings = await this.prisma.systemSetting.findUnique({ where: { id: "security" } });
    if (settings?.consoleRateLimitMax && settings.consoleRateLimitMax > 0) {
      this.consoleInputLimit = { max: settings.consoleRateLimitMax, windowMs: settings.consoleRateLimitWindowMs ?? 60_000 };
    }
    if (settings?.consoleRateLimitWindowMs && settings.consoleRateLimitWindowMs > 0) {
      this.consoleInputLimit = { ...this.consoleInputLimit, windowMs: settings.consoleRateLimitWindowMs };
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
      // Routing key for this socket in this.agents. Starts as the real nodeId
      // for token-authenticated connections; for the handshake path it starts
      // as a temporary pre-auth key and is re-bound after successful auth.
      const agentKey = () => agent.nodeId;
      const onMessage = (data: any, isBinary: boolean) =>
        this.handleAgentMessage(agentKey(), socket, data, isBinary);
      // WS-level pong from the panel's ping loop is direct proof the agent
      // socket is still alive in the panel→agent direction.
      const onPong = () => {
        const current = this.agents.get(agentKey());
        if (current && current.socket === socket) {
          current.lastHeartbeat = Date.now();
        }
      };
      const onClose = () => {
        const current = this.agents.get(agentKey());
        if (!current || current.socket !== socket) {
          this.logger.debug({ nodeId }, "Ignoring close from stale agent socket");
          return;
        }
        this.agents.delete(agentKey());
        this.agentUpdateSent.delete(agentKey());
        // Fail-fast any commands still awaiting an ack from this agent instead
        // of letting them hang until their per-request timeout (15-60s).
        this.failPendingRequestsForNode(nodeId, `Agent ${nodeId} disconnected`);
        this.discoveredContainers.delete(nodeId);
        // Release an active backup relay owned by this node so node-to-node
        // transfers fail fast instead of wedging until the 5-minute timeout.
        this.rejectBackupRelay(nodeId, new Error(`Source or target agent ${nodeId} disconnected mid-relay`));
        // Clear any pending handshake deadline for this socket. While
        // pre-registered, the socket's map key IS agent.nodeId (the
        // __preauth: key); the map is keyed by that key, not by nodeId.
        const handshakeTimer = this.handshakeTimeouts.get(agent.nodeId);
        if (handshakeTimer) {
          clearTimeout(handshakeTimer);
          this.handshakeTimeouts.delete(agent.nodeId);
        }
        this.prisma.node.update({
          where: { id: nodeId },
          data: { isOnline: false },
        }).catch(err => {
          this.logger.error({ err, nodeId }, 'Failed to update node status on disconnect');
          captureSystemError({
            level: 'error',
            component: 'WebSocketGateway',
            message: `Failed to update node status on disconnect: ${nodeId}`,
            stack: err instanceof Error ? err.stack : undefined,
            metadata: { nodeId },
          }).catch(() => {});
        });

        // Revert stuck backup/restore states for servers on this node
        this.revertStuckBackupStatesForNode(nodeId);

        this.pushToAdminSubscribers('node_updated', {
          type: 'node_updated',
          nodeId,
          isOnline: false,
          timestamp: Date.now(),
        });
        this.logger.info(`Agent disconnected: ${nodeId}`);
      };

      if (token) {
        // Check progressive lockout before attempting auth
        const lockout = this.checkAgentLockout(nodeId);
        if (lockout.locked) {
          this.logger.warn(
            { nodeId, retryAfterSeconds: lockout.retryAfterSeconds },
            `Agent connection rejected: auth lockout active for ${lockout.retryAfterSeconds}s`,
          );
          socket.send(JSON.stringify({ type: 'error', error: 'auth_lockout', retryAfterSeconds: lockout.retryAfterSeconds }));
          socket.close();
          return;
        }

        const authResult = await this.authenticateAgentToken(nodeId, token);
        if (authResult) {
          this.clearAgentAuthFailures(nodeId);
          const existing = this.agents.get(nodeId);
          if (existing && existing.socket !== socket) {
            this.logger.warn({ nodeId }, "Replacing existing agent connection");
            // Fail requests that were sent over the superseded socket.
            this.failPendingRequestsForNode(nodeId, `Agent ${nodeId} connection replaced`);
            // Terminate: a replaced socket may be half-open, and close() would
            // wait forever for its close-frame handshake.
            this.terminateSocket(existing.socket);
          }
          this.agents.set(nodeId, agent);
          socket.on("message", onMessage);
          socket.on("pong", onPong);
          socket.on("close", onClose);
          this.logger.info(
            { nodeId, authType: authResult.authType },
            "Agent authenticated during connection",
          );
          agent.authenticated = true;
          await this.finalizeAgentConnection(authResult.node, agent);
        } else {
          const lockoutSeconds = this.recordAgentAuthFailure(nodeId);
          this.logger.warn(
            { nodeId, failureCount: this.agentAuthFailures.get(nodeId)?.count, lockoutSeconds },
            `Agent authentication failed for node: ${nodeId} — locked out for ${lockoutSeconds}s`,
          );
          socket.send(JSON.stringify({ type: 'error', error: 'auth_failed', retryAfterSeconds: lockoutSeconds }));
          agent.socket.close();
        }
      } else {
        // No token in URL - agent will send handshake with token
        // SECURITY: do NOT replace or displace an existing connection here.
        // A socket that has not authenticated must never terminate a live
        // (authenticated) agent — an attacker knowing only the nodeId could
        // otherwise knock the real agent offline. The pre-auth socket is
        // registered under a temporary key so messages from it can be routed,
        // and it is bound to the real key only after a successful handshake.
        const preAuthKey = `__preauth:${nodeId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
        const existing = this.agents.get(nodeId);
        if (existing && existing.socket === socket) {
          // Duplicate registration of the same socket — ignore.
          socket.close();
          return;
        }
        agent.nodeId = preAuthKey;
        agent.preAuthNodeId = nodeId;
        this.agents.set(preAuthKey, agent);
        socket.on("message", onMessage);
        socket.on("pong", onPong);
        socket.on("close", onClose);

        // Check progressive lockout for handshake path (pre-auth sockets
        // cannot displace anyone, but lockout still applies).
        const lockout = this.checkAgentLockout(nodeId);
        if (lockout.locked) {
          this.logger.warn(
            { nodeId, retryAfterSeconds: lockout.retryAfterSeconds },
            `Agent connection rejected: auth lockout active for ${lockout.retryAfterSeconds}s (handshake path)`,
          );
          socket.send(JSON.stringify({ type: 'error', error: 'auth_lockout', retryAfterSeconds: lockout.retryAfterSeconds }));
          socket.close();
          return;
        }

        this.logger.info({ nodeId }, "Agent connected, awaiting handshake");

        // Disconnect agent if handshake not completed within 10 seconds
        const handshakeTimer = setTimeout(() => {
          const pending = this.agents.get(preAuthKey);
          if (pending && pending.socket === socket && !pending.authenticated) {
            // Never authenticated — nothing to negotiate, kill the socket now.
            this.terminateSocket(pending.socket);
            this.agents.delete(preAuthKey);
            this.agentUpdateSent.delete(preAuthKey);
            this.logger.warn({ nodeId }, "Agent handshake timeout");
          }
          this.handshakeTimeouts.delete(preAuthKey);
        }, 10000);
        this.handshakeTimeouts.set(preAuthKey, handshakeTimer);
      }
    } catch (err) {
      this.logger.error(err, "Error in agent connection");
      captureSystemError({
        level: 'error',
        component: 'WebSocketGateway',
        message: err instanceof Error ? err.message : 'Error in agent connection',
        stack: err instanceof Error ? err.stack : undefined,
        metadata: { nodeId },
      }).catch(() => {});
      socket.close();
    }
  }

  private async finalizeAgentConnection(node: any, agent: ConnectedAgent) {
    // Note: agent.authenticated should be set to true BEFORE calling this function
    // to prevent race conditions with the handshake timeout
    // Reset the lastSeenAt-persist throttle so the FIRST heartbeat after a
    // (re)connect always persists immediately.
    this.nodeLastPersistedSeen.delete(node.id);
    this.recordAgentConnection(node.id);
    await this.prisma.node.update({
      where: { id: node.id },
      data: { isOnline: true, lastSeenAt: new Date() },
    });
    this.pushToAdminSubscribers('node_updated', {
      type: 'node_updated',
      nodeId: node.id,
      isOnline: true,
      timestamp: Date.now(),
    });
    this.logger.info(`Agent connected: ${node.id} (${node.hostname})`);
    const security = await getSecuritySettings();
    agent.socket.send(
      JSON.stringify({
        type: "node_handshake_response",
        success: true,
        backendAddress: process.env.BACKEND_EXTERNAL_ADDRESS || "http://localhost:3000",
        maxUploadBytes: maxUploadBytesFromMb(security.fileTunnelMaxUploadMb),
      })
    );
    // Replay any commands queued while this agent was reconnecting.
    this.drainOutbox(node.id, agent).catch((err) => {
      this.logger.error({ err, nodeId: node.id }, "Failed to drain agent command outbox");
    });
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
      captureSystemError({
        level: 'error',
        component: 'WebSocketGateway',
        message: err instanceof Error ? err.message : 'Failed to resume console streams',
        stack: err instanceof Error ? err.stack : undefined,
        metadata: { nodeId },
      }).catch(() => {});
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
        this.logger.debug({ clientId, dataType: typeof data, dataLength: data?.length }, "Raw message received");
        this.handleClientMessage(clientId, data);
      });
      socket.on("close", () => {
        this.clients.delete(clientId);
        this.clientCommandCounters.delete(clientId);
        this.clientMessageCounters.delete(clientId);
        this.logger.info(`Client disconnected: ${clientId}`);
      });

      setTimeout(() => {
        const pending = this.clients.get(clientId);
        if (pending && !pending.authenticated) {
          pending.socket.close();
          this.clients.delete(clientId);
          this.logger.warn({ clientId }, "Client handshake timeout");
        }
      }, 3000);  // Reduced from 5s to 3s
    } catch (err) {
      this.logger.error(err, "Error in client connection");
      captureSystemError({
        level: 'error',
        component: 'WebSocketGateway',
        message: err instanceof Error ? err.message : 'Error in client connection',
        stack: err instanceof Error ? err.stack : undefined,
      }).catch(() => {});
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

  /** Full-admin (manage) permission: '*' or admin.write — mirrors
   *  decideServerAccess in lib/server-access.ts. admin.read alone must NOT
   *  authorize power actions or console writes. */
  private async userHasAdminWrite(userId: string) {
    try {
      return await hasPermission(this.prisma, userId, "admin.write");
    } catch (err) {
      this.logger.warn({ err, userId }, "Failed to evaluate admin.write permission");
      return false;
    }
  }

  /** Aggregate the user's role permissions (same query shape hasPermission uses). */
  private async getUserRolePermissions(userId: string): Promise<string[]> {
    try {
      const userRoles = await this.prisma.role.findMany({
        where: { users: { some: { id: userId } } },
        select: { permissions: true },
      });
      const out: string[] = [];
      for (const role of userRoles) out.push(...role.permissions);
      return out;
    } catch (err) {
      this.logger.warn({ err, userId }, "Failed to load role permissions");
      return [];
    }
  }

  /**
   * Server-scoped role permissions: global role perms UNION RoleServerGrant
   * UNION RoleNodeGrant rows covering this server. Used by the subscribe,
   * server_control, and console authz paths so role-scoped grants apply
   * over the WebSocket exactly like over the REST routes.
   */
  private async getUserServerRolePermissions(
    userId: string,
    serverId: string,
    nodeId: string,
  ): Promise<string[]> {
    try {
      const { resolveServerPermissions } = await import("../lib/permissions-catalog.js");
      return await resolveServerPermissions(userId, serverId, nodeId);
    } catch (err) {
      this.logger.warn({ err, userId, serverId }, "Failed to load server-scoped role permissions");
      return [];
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

  private async handleAgentMessage(nodeId: string, socket: any, data: any, isBinary?: boolean) {
    try {
      // Binary frames: forward to active relay if one exists
      if (isBinary && this.activeBackupRelay) {
        // SECURITY: only the authenticated agent socket that STARTED the
        // relay may inject frames. Without this check any connected socket —
        // including a pre-handshake one — could corrupt the restore stream.
        if (
          nodeId !== this.activeBackupRelay.sourceNodeId ||
          socket.__catalystRelaySocket !== true
        ) {
          this.logger.warn(
            { nodeId, sourceNodeId: this.activeBackupRelay.sourceNodeId },
            "Dropping binary frame from non-source socket",
          );
          return;
        }
        const targetAgent = this.agents.get(this.activeBackupRelay.targetNodeId);
        if (!targetAgent || targetAgent.socket.readyState !== 1) {
          // Relay target vanished mid-transfer — error the stream instead of
          // silently dropping frames.
          const { reject } = this.activeBackupRelay;
          this.activeBackupRelay = null;
          reject(new Error("Relay target disconnected mid-stream"));
          return;
        }
        // Backpressure guard: bulk binary relay must not buffer unboundedly
        // behind a slow consumer. Aborting the stream surfaces the stall to
        // both operators instead of growing panel memory silently.
        if (
          Number(targetAgent.socket.bufferedAmount ?? 0) >
          WebSocketGateway.AGENT_BACKPRESSURE_BYTES
        ) {
          const { reject } = this.activeBackupRelay;
          this.activeBackupRelay = null;
          this.bumpCounter(this.reliabilityBackpressureDrops, nodeId);
          reject(new Error("Relay target backpressure threshold exceeded"));
          return;
        }
        targetAgent.socket.send(data);
        return;
      }

      // Parse BEFORE the rate-limit gate: heartbeats must never be dropped by
      // the limiter, or a busy node (stats flush + backup stream burst) gets
      // falsely marked offline.
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
      if (
        message.type !== "heartbeat" &&
        !this.allowAgentMessage(nodeId, this.agentMessageLimit)
      ) {
        this.bumpCounter(this.reliabilityRateLimitedDrops, nodeId);
        if (this.shouldWarnRateLimit(nodeId, this.agentMessageLimit.windowMs)) {
          this.logger.warn({ nodeId }, "Agent message rate limit exceeded");
        }
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
      // Liveness: refresh immediately after auth gating so any accepted frame
      // counts — including heartbeats during traffic bursts (rate-limiter
      // exemption above keeps them flowing).
      agent.lastHeartbeat = Date.now();
      if (message.type === "node_handshake") {
        if (agent.authenticated) {
          this.logger.debug({ nodeId }, "Ignoring redundant node_handshake for authenticated agent");
          return;
        }
        // Protocol negotiation: agents speaking an incompatible protocol
        // major get an explicit error instead of undefined post-upgrade
        // behavior. Missing field → legacy agent, treated as v1.
        const reportedVersion =
          typeof message.protocolVersion === "string" ? message.protocolVersion : "";
        const parsedMajor = Number.parseInt(reportedVersion.split(".")[0] ?? "", 10);
        const effectiveMajor = Number.isFinite(parsedMajor) ? parsedMajor : 1;
        if (effectiveMajor !== AGENT_PROTOCOL_MAJOR) {
          const supportedVersion = `${AGENT_PROTOCOL_MAJOR}.0`;
          this.logger.warn(
            { nodeId, reportedVersion: reportedVersion || null, supportedVersion },
            "Agent protocol version mismatch — rejecting handshake",
          );
          try {
            agent.socket.send(
              JSON.stringify({
                type: "error",
                error: "protocol_mismatch",
                receivedProtocolVersion: reportedVersion || null,
                supportedProtocolVersion: supportedVersion,
              }),
            );
          } catch { /* socket may already be closing */ }
          this.terminateSocket(agent.socket);
          this.agents.delete(agent.nodeId);
          return;
        }
        this.logger.info({ nodeId, hasToken: Boolean(message.token) }, "Received node_handshake from agent");
        // Pre-auth sockets are registered under a temporary __preauth: key;
        // authentication and lockout must always target the REAL node id the
        // socket claims (agent.preAuthNodeId), never the temporary key.
        const realNodeId =
          typeof agent.preAuthNodeId === "string" ? agent.preAuthNodeId : nodeId;
        const tokenValue = typeof message.token === "string" ? message.token : "";
        const authResult = await this.authenticateAgentToken(realNodeId, tokenValue);
        this.logger.debug(
          { nodeId: realNodeId, tokenProvided: Boolean(tokenValue), authType: authResult?.authType },
          "Agent auth check",
        );
        if (!authResult) {
          const lockoutSeconds = this.recordAgentAuthFailure(realNodeId);
          this.logger.warn(
            { nodeId: realNodeId, token: Boolean(tokenValue), lockoutSeconds },
            `Agent authentication failed for node: ${realNodeId} — locked out for ${lockoutSeconds}s`,
          );
          try {
            agent.socket.send(JSON.stringify({ type: 'error', error: 'auth_failed', retryAfterSeconds: lockoutSeconds }));
          } catch { /* socket may already be closing */ }
          agent.socket.close();
          this.agents.delete(agent.nodeId);
          this.agentUpdateSent.delete(agent.nodeId);
          return;
        }
        this.clearAgentAuthFailures(realNodeId);
        // Bind the pre-auth entry to its REAL node id (agent.preAuthNodeId —
        // the nodeId parameter here is the routing key, which is the
        // temporary __preauth: key for handshake-path sockets).
        const bindNodeId = realNodeId;
        const preAuthKey = agent.nodeId;
        if (typeof preAuthKey === "string" && preAuthKey.startsWith("__preauth:")) {
          this.agents.delete(preAuthKey);
          const handshakeTimer = this.handshakeTimeouts.get(preAuthKey);
          if (handshakeTimer) {
            clearTimeout(handshakeTimer);
            this.handshakeTimeouts.delete(preAuthKey);
          }
        }
        const existing = this.agents.get(nodeId);
        if (existing && existing.socket !== socket) {
          this.logger.warn({ nodeId }, "Replacing existing agent connection");
          // Fail requests that were sent over the superseded socket.
          this.failPendingRequestsForNode(nodeId, `Agent ${nodeId} connection replaced`);
          // Terminate: a replaced socket may be half-open, and close() would
          // wait forever for its close-frame handshake.
          this.terminateSocket(existing.socket);
        }
        agent.nodeId = bindNodeId;
        delete agent.preAuthNodeId;
        this.agents.set(bindNodeId, agent);
        // Set authenticated flag IMMEDIATELY to prevent timeout from disconnecting during async operations
        agent.authenticated = true;
        await this.finalizeAgentConnection(authResult.node, agent);

        // Check if agent needs update immediately on handshake,
        // rather than waiting for the first health_report.
        // Also persist the version to the database.
        if (message.agentVersion && typeof message.agentVersion === 'string') {
          await this.prisma.node.update({
            where: { id: bindNodeId },
            data: { agentVersion: String(message.agentVersion) },
          }).catch(() => {});
          this.checkAgentUpdate(bindNodeId, message.agentVersion).catch(() => {});
        }
        return;
      }
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

      if (message.type === "backup_stream_complete") {
        this.resolveBackupRelay(nodeId);
        return;
      }

      // Network lifecycle events from agents (create/update/delete).
      // Always resolve a matching pending requestId (admin waits for ack), and
      // surface the result to admin subscribers for observability.
      if (
        message.type === "network_created" ||
        message.type === "network_updated" ||
        message.type === "network_deleted"
      ) {
        if (message.requestId) {
          const pending = this.pendingAgentRequests.get(message.requestId);
          if (pending && pending.kind === "json") {
            clearTimeout(pending.timeout);
            this.pendingAgentRequests.delete(message.requestId);
            pending.resolve(message);
          }
        }
        if (message.success === false) {
          this.logger.warn(
            {
              nodeId,
              type: message.type,
              networkName: message.networkName,
              error: message.error,
            },
            "Agent network operation failed",
          );
        } else {
          this.logger.info(
            {
              nodeId,
              type: message.type,
              networkName: message.networkName,
            },
            "Agent network operation succeeded",
          );
        }
        this.pushToAdminSubscribers(message.type, {
          ...message,
          nodeId,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // Clone file-copy completion (same-node clone via requestFromAgent).
      if (message.type === "clone_files_complete") {
        if (message.requestId) {
          const pending = this.pendingAgentRequests.get(message.requestId);
          if (pending && pending.kind === "json") {
            clearTimeout(pending.timeout);
            this.pendingAgentRequests.delete(message.requestId);
            pending.resolve(message);
            return;
          }
        }
        this.logger.info(
          { nodeId, serverId: message.serverId, success: message.success },
          "clone_files_complete without matching pending request",
        );
        return;
      }

      // Generic pending request resolver — any message with a requestId that
      // matches a pending request will resolve it.
      if (message.requestId) {
        const pending = this.pendingAgentRequests.get(message.requestId);
        // Defense in depth: a response is only accepted from the node the
        // request was sent to (requestIds are unguessable UUIDs, but a
        // compromised node must not be able to resolve another node's
        // in-flight request by replaying an observed id).
        if (pending && pending.kind === "json" && (!pending.nodeId || pending.nodeId === nodeId)) {
          clearTimeout(pending.timeout);
          this.pendingAgentRequests.delete(message.requestId);
          pending.resolve(message);
          return;
        }
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
          captureSystemError({
            level: 'error',
            component: 'WebSocketGateway',
            message: `Agent download chunk error: ${message.error}`,
            metadata: { requestId: message.requestId, error: message.error },
          }).catch(() => {});
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
              captureSystemError({
                level: 'error',
                component: 'WebSocketGateway',
                message: error instanceof Error ? error.message : 'Failed to handle backup download chunk',
                stack: error instanceof Error ? error.stack : undefined,
                metadata: { requestId: message.requestId },
              }).catch(() => {});
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
          // Agents beat every 15s; writing lastSeenAt on every beat is avoidable
          // write load. Throttle to one DB write per window per node — the
          // in-memory liveness timestamp above still updates on every beat.
          const lastPersistedAt = this.nodeLastPersistedSeen.get(nodeId) ?? 0;
          if (Date.now() - lastPersistedAt >= HEARTBEAT_PERSIST_THROTTLE_MS) {
            this.nodeLastPersistedSeen.set(nodeId, Date.now());
            try {
              await this.prisma.node.update({
                where: { id: nodeId },
                data: { lastSeenAt: new Date() },
              });
            } catch (err) {
              captureSystemError({
                level: 'error',
                component: 'WebSocketGateway',
                message: err instanceof Error ? err.message : 'WebSocket handler error: heartbeat node update failed',
                stack: err instanceof Error ? err.stack : undefined,
                metadata: { nodeId },
              }).catch(() => {});
              this.logger.error({ err, nodeId }, 'WebSocket handler error: heartbeat node update failed');
            }
          }
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
        // All fields sanitized field-by-field: a single bad value degrades to
        // its fallback instead of rejecting the whole report. Host CPU is
        // 0-100 (sysinfo aggregate); per-container CPU (>100 on multicore)
        // is clamped later with the server's allocated cores in mind.
        const cpuPercent = sanitizeMetric(message.cpuPercent, 0, 100);
        const memoryUsageMb = sanitizeIntMetric(
          message.memoryUsageMb,
          0,
          Number.MAX_SAFE_INTEGER,
          Math.round(node.maxMemoryMb ?? 0),
        );
        const memoryTotalMb = sanitizeIntMetric(
          message.memoryTotalMb,
          0,
          Number.MAX_SAFE_INTEGER,
          Math.round(node.maxMemoryMb ?? 0),
        );
        const diskUsageMb = sanitizeIntMetric(message.diskUsageMb, 0, Number.MAX_SAFE_INTEGER);
        const diskTotalMb = sanitizeIntMetric(message.diskTotalMb, 0, Number.MAX_SAFE_INTEGER);
        const containerCount = Math.round(sanitizeMetric(message.containerCount, 0, 1_000_000));
        const uptimeSeconds = Math.round(sanitizeMetric(message.uptimeSeconds, 0, Number.MAX_SAFE_INTEGER));
        const networkRxBytes = toByteCounterBig(message.networkRxBytes);
        const networkTxBytes = toByteCounterBig(message.networkTxBytes);
        try {
          await this.prisma.node.update({
            where: { id: nodeId },
            data: {
              isOnline: true,
              lastSeenAt: new Date(),
              ...(message.agentVersion ? { agentVersion: String(message.agentVersion) } : {}),
            },
          });
          await this.prisma.nodeMetrics.create({
            data: {
              nodeId,
              cpuPercent,
              memoryUsageMb: Math.round(memoryUsageMb),
              memoryTotalMb: Math.round(memoryTotalMb),
              diskUsageMb: Math.round(diskUsageMb),
              diskTotalMb: Math.round(diskTotalMb),
              networkRxBytes,
              networkTxBytes,
              containerCount: Math.max(0, Math.round(containerCount)),
              uptimeSeconds,
            },
          });
        } catch (err) {
          captureSystemError({
            level: 'error',
            component: 'WebSocketGateway',
            message: err instanceof Error ? err.message : 'WebSocket handler error: failed to persist health report',
            stack: err instanceof Error ? err.stack : undefined,
            metadata: { nodeId },
          }).catch(() => {});
          this.logger.error({ err, nodeId }, 'WebSocket handler error: failed to persist health report');
        }

        // Fan out to admin SSE so node dashboards stop hard-polling.
        // Throttled lightly via allowAgentMetrics already; still avoid flooding UI.
        this.pushToAdminSubscribers('node_metrics_updated', {
          type: 'node_metrics_updated',
          nodeId,
          isOnline: true,
          agentVersion: message.agentVersion ? String(message.agentVersion) : undefined,
          cpuPercent,
          memoryUsageMb: Math.round(memoryUsageMb),
          memoryTotalMb: Math.round(memoryTotalMb),
          diskUsageMb: Math.round(diskUsageMb),
          diskTotalMb: Math.round(diskTotalMb),
          networkRxBytes: Number(message.networkRxBytes ?? 0),
          networkTxBytes: Number(message.networkTxBytes ?? 0),
          containerCount: Math.max(0, Math.round(containerCount)),
          uptimeSeconds,
          timestamp: new Date().toISOString(),
        });

        // --- Agent auto-update check ---
        // Compare the agent's version against the panel version.
        // If the agent is behind, send an update_agent command with the target version.
        // Track which version was last requested to avoid sending duplicate commands.
        this.checkAgentUpdate(nodeId, message.agentVersion).catch(() => {});
      } else if (message.type === "agent_update_started") {
        this.logger.info(
          { nodeId, targetVersion: message.targetVersion },
          'Agent confirmed update is being applied',
        );
        // Fan out to admin SSE so Agent Control Panel updates without polling.
        this.pushToAdminSubscribers('agent_update_started', {
          type: 'agent_update_started',
          nodeId,
          targetVersion: message.targetVersion ?? null,
          progress: typeof message.progress === 'number' ? message.progress : 0,
          timestamp: new Date().toISOString(),
        });
      } else if (message.type === "agent_update_failed") {
        this.logger.warn(
          { nodeId, error: message.error },
          'Agent reported update failure — backing off before retry',
        );
        this.pushToAdminSubscribers('agent_update_failed', {
          type: 'agent_update_failed',
          nodeId,
          error: message.error ?? 'Update failed',
          timestamp: new Date().toISOString(),
        });
        this.agentUpdateRetryAfter.set(
          nodeId,
          Date.now() + WebSocketGateway.AGENT_UPDATE_RETRY_MS,
        );
        this.agentUpdateSent.delete(nodeId);
      } else if (message.type === "agent_update_progress") {
        this.pushToAdminSubscribers('agent_update_progress', {
          type: 'agent_update_progress',
          nodeId,
          status: message.status ?? 'updating',
          progress: typeof message.progress === 'number' ? message.progress : 0,
          currentVersion: message.currentVersion ?? null,
          targetVersion: message.targetVersion ?? null,
          error: message.error ?? null,
          timestamp: new Date().toISOString(),
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

        // Container CPU is normalized against the cores the server is
        // allocated: a 4-core server legitimately reports up to 400%. The
        // old hard clamp at 100 silently corrupted multi-core usage.
        const cpuCeiling = 100 * Math.max(1, (server as any).allocatedCpuCores ?? 1);
        const cpuPercent = sanitizeMetric(message.cpuPercent, 0, cpuCeiling);
        // int4 columns (ServerMetrics): clamp at the column ceiling. Values
        // beyond int4 max would make the write (or a whole batch INSERT) fail.
        const memoryUsageMb = sanitizeIntMetric(message.memoryUsageMb, 0, INT4_MAX);
        const diskUsageMb = sanitizeIntMetric(message.diskUsageMb, 0, INT4_MAX);
        const diskIoMb = sanitizeIntMetric(message.diskIoMb, 0, INT4_MAX);
        const diskTotalMb = sanitizeIntMetric(message.diskTotalMb, 0, INT4_MAX);
        const networkRxBytes = toByteCounterBig(message.networkRxBytes);
        const networkTxBytes = toByteCounterBig(message.networkTxBytes);
        // Split IO halves (newer agents). Absent on older agents → fall back
        // to legacy behavior below rather than guessing.
        const diskReadMbRaw = message.diskReadMb;
        const diskWriteMbRaw = message.diskWriteMb;
        const hasSplitIo =
          diskReadMbRaw !== undefined &&
          diskWriteMbRaw !== undefined &&
          Number.isFinite(Number(diskReadMbRaw)) &&
          Number.isFinite(Number(diskWriteMbRaw));
        const diskReadMb = hasSplitIo
          ? sanitizeIntMetric(diskReadMbRaw, 0, INT4_MAX)
          : null;
        const diskWriteMb = hasSplitIo
          ? sanitizeIntMetric(diskWriteMbRaw, 0, INT4_MAX)
          : null;

        if (!this.allowServerMetrics(server.id)) {
          return;
        }

        // Honor the agent's sample timestamp (same semantics as the batch
        // ingest path): the panel may be delayed in processing, and the
        // ServerMetrics unique constraint is (serverId, timestamp). Fall back
        // to now for legacy agents that omit it.
        const tsNumber = Number(message.timestamp);
        const sampleTs = Number.isFinite(tsNumber) && tsNumber > 0 ? new Date(tsNumber) : new Date();

        // Persist metrics to DB — fire-and-forget to avoid blocking SSE broadcast
        const metricsData = {
          serverId: server.id,
          cpuPercent,
          memoryUsageMb,
          networkRxBytes,
          networkTxBytes,
          diskIoMb,
          diskUsageMb,
          timestamp: sampleTs,
        };
        this.prisma.serverMetrics.create({ data: metricsData }).catch((err) => {
          this.logger.warn({ err, serverId: server.id }, 'Failed to persist serverMetrics');
        });

        // Persist to historical ServerStat table (fire-and-forget)
        // Clamp to 32-bit signed int max to avoid Prisma overflow for large servers.
        const INT32_MAX = 2_147_483_647;
        const toStatBytes = (mb: number) => Math.min(Math.round(mb * 1024 * 1024), INT32_MAX);
        this.prisma.serverStat.create({
          data: {
            serverId: server.id,
            cpuPercent: metricsData.cpuPercent,
            memoryUsed: toStatBytes(metricsData.memoryUsageMb),
            memoryLimit: toStatBytes(server.allocatedMemoryMb),
            diskUsed: metricsData.diskUsageMb ? toStatBytes(metricsData.diskUsageMb) : null,
            netRx: Number(networkRxBytes) || null,
            netTx: Number(networkTxBytes) || null,
            // Split halves when the agent provides them; otherwise legacy
            // fallback writes the combined counter into blockRead.
            blockRead:
              hasSplitIo && (diskReadMb as number) > 0
                ? toStatBytes(diskReadMb as number)
                : metricsData.diskIoMb
                  ? toStatBytes(metricsData.diskIoMb)
                  : null,
            blockWrite: hasSplitIo && (diskWriteMb as number) > 0 ? toStatBytes(diskWriteMb as number) : null,
          },
        }).catch((err) => {
          this.logger.warn({ err, serverId: server.id }, 'Failed to persist ServerStat');
        });

        const payload = {
          type: "resource_stats",
          serverId: server.id,
          cpuPercent,
          memoryUsageMb,
          networkRxBytes: networkRxBytes.toString(),
          networkTxBytes: networkTxBytes.toString(),
          diskIoMb,
          diskUsageMb,
          diskTotalMb,
          ...(hasSplitIo
            ? { diskReadMb: diskReadMb as number, diskWriteMb: diskWriteMb as number }
            : {}),
          timestamp: sampleTs.getTime(),
        };
        this.latestResourceStats.set(server.id, payload);
        await this.routeToClients(server.id, payload);
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
        // Samples stamped more than 5 minutes into the future are dropped:
        // clock-skewed future rows sit at the top of "latest metrics" queries
        // and escape retention pruning until their horizon passes. Past
        // timestamps remain accepted by design (offline backfill).
        const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
        for (const m of message.metrics) {
          if (!m.serverUuid || !m.timestamp) continue;
          if (!Number.isFinite(Number(m.timestamp))) continue;
          // Reject values outside the JS Date range (e.g. 1e20 or -1e20):
          // they become Invalid Dates and would abort the whole batch INSERT.
          const ts = sanitizeBatchTimestamp(m.timestamp);
          if (!ts) continue;
          if (Number(m.timestamp) > Date.now() + MAX_FUTURE_SKEW_MS) {
            this.logger.warn(
              { nodeId, serverId: m.serverUuid, timestamp: m.timestamp },
              "Dropping resource_stats_batch item with future timestamp",
            );
            continue;
          }
          items.push({
            serverId: m.serverUuid,
            // CPU ceiling depends on each server's allocated cores (known
            // after the server lookup below), so keep the raw value here and
            // clamp in the filtered pass.
            cpuPercentRaw: sanitizeMetric(m.cpuPercent, 0, Number.MAX_SAFE_INTEGER),
            // int4 columns: clamp at the column ceiling so one poisoned
            // sample cannot void the entire batch INSERT.
            memoryUsageMb: sanitizeIntMetric(m.memoryUsageMb, 0, INT4_MAX),
            networkRxBytes: toByteCounterBig(m.networkRxBytes),
            networkTxBytes: toByteCounterBig(m.networkTxBytes),
            diskIoMb: sanitizeIntMetric(m.diskIoMb, 0, INT4_MAX),
            diskUsageMb: sanitizeIntMetric(m.diskUsageMb, 0, INT4_MAX),
            timestamp: ts,
          });
        }

        if (items.length === 0) return;

        const serverIds = Array.from(new Set(items.map((i) => i.serverId)));
        const servers = await this.prisma.server.findMany({
          where: { id: { in: serverIds }, nodeId },
          select: { id: true, allocatedCpuCores: true },
        });
        const coresByServer = new Map<string, number>();
        for (const s of servers) coresByServer.set(s.id, Math.max(1, s.allocatedCpuCores ?? 1));
        const allowed = new Set(coresByServer.keys());
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
          const cpu = Math.min(it.cpuPercentRaw, 100 * (coresByServer.get(it.serverId) ?? 1));
          const mem = it.memoryUsageMb;
          const rx = it.networkRxBytes;
          const tx = it.networkTxBytes;
          const dio = it.diskIoMb;
          const dusg = it.diskUsageMb;
          const ts = new Date(it.timestamp);
          tuples.push(
            Prisma.sql`(${crypto.randomUUID()}, ${it.serverId}, ${cpu}, ${mem}, ${rx}, ${tx}, ${dio}, ${dusg}, ${ts})`
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
          captureSystemError({
            level: 'error',
            component: 'WebSocketGateway',
            message: err instanceof Error ? err.message : 'Failed to upsert batched metrics, falling back to per-item safe upsert',
            stack: err instanceof Error ? err.stack : undefined,
            metadata: {},
          }).catch(() => {});
          this.logger.error({ err }, 'Failed to upsert batched metrics, falling back to per-item safe upsert');

          // Fallback: upsert each item individually (safe but slower). We attempt
          // to preserve spike semantics by keeping max(memory, disk, network) where applicable.
          const MAX_FALLBACK_ITEMS = 20;
          if (filtered.length > MAX_FALLBACK_ITEMS) {
            this.logger.warn({ count: filtered.length }, 'Batch metrics fallback limited to 20 items');
          }
          for (const it of filtered.slice(0, MAX_FALLBACK_ITEMS)) {
            try {
              const existing = await this.prisma.serverMetrics.findUnique({
                where: {
                  serverId_timestamp: {
                    serverId: it.serverId,
                    timestamp: new Date(it.timestamp),
                  },
                },
              });

              const cpu = Math.min(it.cpuPercentRaw, 100 * (coresByServer.get(it.serverId) ?? 1));
              const mem = it.memoryUsageMb;
              const rx = it.networkRxBytes;
              const tx = it.networkTxBytes;
              const dio = it.diskIoMb;
              const dusg = it.diskUsageMb;
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
              captureSystemError({
                level: 'error',
                component: 'WebSocketGateway',
                message: e2 instanceof Error ? e2.message : 'Failed to upsert individual metric',
                stack: e2 instanceof Error ? e2.stack : undefined,
                metadata: { item: it },
              }).catch(() => {});
              this.logger.error({ err: e2, item: it }, 'Failed to upsert individual metric');
            }
          }
        }

        // Broadcast latest metrics for affected servers
        const filteredIds = Array.from(new Set(filtered.map((i) => i.serverId)));
        for (const sid of filteredIds) {
          const latest = await this.prisma.serverMetrics.findFirst({ where: { serverId: sid }, orderBy: { timestamp: 'desc' } });
          if (latest) {
            const payload = {
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
            };
            this.latestResourceStats.set(sid, payload);
            await this.routeToClients(sid, payload);
          }
        }
      } else if (message.type === "console_output") {
        // Node ownership check: an agent may only report console output for
        // servers that actually live on its node. Without this, a compromised
        // node can forge log lines into any server's console and database.
        const consoleServer = message.serverId
          ? await this.prisma.server.findUnique({
              where: { id: message.serverId },
              select: { nodeId: true },
            })
          : null;
        if (!consoleServer || consoleServer.nodeId !== nodeId) {
          this.logger.warn(
            { nodeId, serverId: message.serverId },
            "console_output for server not on this node — dropping",
          );
          return;
        }
        if (typeof message.data === "string") {
          if (!this.allowConsoleOutputBytes(message.serverId, Buffer.byteLength(message.data))) {
            this.logger.warn({ nodeId, serverId: message.serverId }, "console_output exceeded byte limit");
            return;
          }
        }
        // Per-message size limit to prevent DB bloat from a single huge log dump (1MB)
        const MAX_CONSOLE_MESSAGE_BYTES = 1048576;
        if (message.serverId && message.data && Buffer.byteLength(message.data) > MAX_CONSOLE_MESSAGE_BYTES) {
          this.logger.warn(
            { nodeId, serverId: message.serverId, size: Buffer.byteLength(message.data) },
            "console_output single message exceeds 1MB limit, truncating for DB storage",
          );
          message.data = (message.data as string).slice(0, MAX_CONSOLE_MESSAGE_BYTES);
        }
        if (message.serverId && message.data) {
          // Sanitize console output to prevent XSS attacks
          const sanitizedData = sanitizeInput(message.data);
          try {
            await this.prisma.serverLog.create({
              data: {
                serverId: message.serverId,
                stream: message.stream || "stdout",
                data: sanitizedData,
              },
            });
          } catch (err) {
            captureSystemError({
              level: 'error',
              component: 'WebSocketGateway',
              message: err instanceof Error ? err.message : 'WebSocket handler error: failed to persist console log',
              stack: err instanceof Error ? err.stack : undefined,
              metadata: { serverId: message.serverId },
            }).catch(() => {});
            this.logger.error({ err, serverId: message.serverId }, 'WebSocket handler error: failed to persist console log');
          }
        }
        if (!this.allowConsoleOutput(message.serverId)) {
          await this.maybeWarnConsoleThrottle(message.serverId);
          return;
        }
        // Sanitize console output data before sending to clients to prevent XSS
        const sanitizedMessage = {
          ...message,
          data: typeof message.data === 'string' ? sanitizeInput(message.data) : message.data,
        };
        await this.routeConsoleToSubscribers(message.serverId, sanitizedMessage);
      } else if (message.type === "eula_required") {
        // Forward EULA requirement to subscribed browser clients so the
        // frontend can display an acceptance modal.
        if (!message.serverId) {
          this.logger.warn({ nodeId }, "eula_required missing serverId");
          return;
        }
        // Node ownership check (same rationale as console_output): the EULA
        // text is attacker-controlled content shown to the server owner, so a
        // cross-node spoof would be a phishing primitive.
        const eulaServer = await this.prisma.server.findUnique({
          where: { id: message.serverId },
          select: { nodeId: true },
        });
        if (!eulaServer || eulaServer.nodeId !== nodeId) {
          this.logger.warn(
            { nodeId, serverId: message.serverId },
            "eula_required for server not on this node — dropping",
          );
          return;
        }
        await this.routeToClients(message.serverId, {
          type: "eula_required",
          serverId: message.serverId,
          serverUuid: message.serverUuid,
          eulaText: message.eulaText,
          timestamp: Date.now(),
        });
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

        // A server that reaches RUNNING after a genuine start has proven
        // stability: clear the crash counter so the auto-restart budget is
        // per-run, not lifetime. Without this, maxCrashCount crashes spread
        // over weeks silently and permanently disable auto-restart.
        if (message.state === ServerState.RUNNING && (server.crashCount ?? 0) > 0) {
          nextData.crashCount = 0;
        }

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

        try {
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
        } catch (err) {
          captureSystemError({
            level: 'error',
            component: 'WebSocketGateway',
            message: err instanceof Error ? err.message : 'WebSocket handler error: failed to persist state update',
            stack: err instanceof Error ? err.stack : undefined,
            metadata: { serverId: message.serverId },
          }).catch(() => {});
          this.logger.error({ err, serverId: message.serverId }, 'WebSocket handler error: failed to persist state update');
        }

        if (shouldAutoRestart && server.node?.isOnline) {
          this.autoRestartingServers.add(server.id);
          await this.prisma.server.update({
            where: { id: server.id },
            data: { status: ServerState.STARTING },
          });
          const serverDir = process.env.SERVER_DATA_DIR || "/var/lib/catalyst/servers";
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
          const syncedEnvironment = injectPterodactylCompatibilityVars(
            syncPortEnvironmentVariables(
              environment,
              server.primaryPort,
              portBindings as Record<string, unknown> | undefined
            ),
            {
              uuid: server.uuid,
              name: server.name,
              primaryIp: server.primaryIp,
              primaryPort: server.primaryPort,
              allocatedMemoryMb: server.allocatedMemoryMb,
              allocatedDiskMb: server.allocatedDiskMb,
            },
            portBindings as Record<number, number> | undefined,
            {
              startupCommand:
                (server as any).startupCommand ||
                (server.template as any)?.startup ||
                undefined,
            },
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
            autoRestart: {
              enabled: true,
              delay: 10,
              maxRestarts: server.maxCrashCount ?? 5,
              windowSecs: 60,
            },
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
          // One stale container re-syncs every 30s; warning each time floods
          // logs for days after a server deletion. Warn once per server per
          // window, then count silently (visible via reliability stats).
          this.warnUnknownServerSyncOnce(nodeId, message.serverUuid);
          // Only track running unknown containers for auto-import. Stopped/crashed
          // containers are usually deleted servers or ones that don't exist anymore.
          if (message.state !== 'running') {
            return;
          }
          // Track as unregistered container for auto-import
          const existing = this.discoveredContainers.get(nodeId) ?? [];
          if (!existing.some(c => c.containerId === message.serverUuid)) {
            existing.push({
              containerId: message.serverUuid,
              image: "",
              status: message.state === "running" ? "Up" : "Exited",
              labels: {},
              discoveredAt: Date.now(),
            });
            this.discoveredContainers.set(nodeId, existing);
          }
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
          // Transitional operations (INSTALLING/TRANSFERRING/CLONING and the
          // backup/restore windows) are owned by explicit lifecycle code: the
          // 30s sync must never pull a server out of them — an INSTALLING
          // server has no container yet, so a periodic sync would mark it
          // "stopped" and unlock start/stop mid-install. Only the operation's
          // own completion/error handlers may move these states.
          if (ServerStateMachine.isTransitioning(server.status as ServerState)) {
            this.logger.warn(
              { serverId: server.id, from: server.status, to: message.state },
              "State sync ignored: server is in a guarded transitional state",
            );
            return;
          }
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
              notIn: [
                ServerState.STOPPED,
                ServerState.ERROR,
                ServerState.CREATING_BACKUP,
                ServerState.RESTORING,
                ServerState.INSTALLING,
                ServerState.TRANSFERRING,
                ServerState.CLONING,
              ],
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

        // Prune discovered containers cache to only include containers
        // that the agent actually found during reconciliation. This removes
        // stale entries from deleted servers or outdated event-driven syncs.
        const discovered = this.discoveredContainers.get(nodeId) ?? [];
        const stillPresent = discovered.filter((c) => foundContainers.has(c.containerId));
        if (stillPresent.length !== discovered.length) {
          this.discoveredContainers.set(nodeId, stillPresent);
          this.logger.debug({ nodeId, pruned: discovered.length - stillPresent.length }, 'Pruned stale discovered containers');
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

        // Transition server back to STOPPED after backup completes
        if (server.status === ServerState.CREATING_BACKUP) {
          await this.prisma.server.update({
            where: { id: message.serverId },
            data: { status: ServerState.STOPPED },
          });
        }

        // Backup lookup must be scoped to this server: a node must not be
        // able to rewrite the size/checksum/metadata of another server's
        // backup by supplying its backupId.
        const backupRecord = message.backupId
          ? await this.prisma.backup.findFirst({
              where: { id: message.backupId, serverId: message.serverId },
            })
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

        const resolvedEncrypted =
          typeof message.encrypted === "boolean"
            ? message.encrypted
            : (backupRecord.metadata as any)?.encrypted ?? false;

        const updated = await this.prisma.backup.update({
          where: { id: backupRecord.id },
          data: {
            sizeMb: resolvedSizeMb,
            checksum: resolvedChecksum,
            metadata: {
              ...(backupRecord.metadata as any),
              encrypted: resolvedEncrypted,
            },
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
            captureSystemError({
              level: 'error',
              component: 'WebSocketGateway',
              message: error instanceof Error ? error.message : 'Failed to upload backup to S3',
              stack: error instanceof Error ? error.stack : undefined,
              metadata: { backupId: backupRecord.id },
            }).catch(() => {});
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
            // Clean up agent-local copy so the failed upload doesn't leak disk
            this.sendToAgent(server.nodeId, {
              type: "delete_backup",
              serverId: server.id,
              serverUuid: server.uuid,
              backupPath: agentPath,
            }).catch(() => {});
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
            captureSystemError({
              level: 'error',
              component: 'WebSocketGateway',
              message: error instanceof Error ? error.message : 'Failed to upload backup to SFTP',
              stack: error instanceof Error ? error.stack : undefined,
              metadata: { backupId: backupRecord.id },
            }).catch(() => {});
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
            // Clean up agent-local copy so the failed upload doesn't leak disk
            this.sendToAgent(server.nodeId, {
              type: "delete_backup",
              serverId: server.id,
              serverUuid: server.uuid,
              backupPath: agentPath,
            }).catch(() => {});
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
            captureSystemError({
              level: 'error',
              component: 'WebSocketGateway',
              message: error instanceof Error ? error.message : 'Failed to fetch stream backup',
              stack: error instanceof Error ? error.stack : undefined,
              metadata: { backupId: backupRecord.id },
            }).catch(() => {});
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
                  backupS3Config: (server as any).backupS3Config,
                  backupSftpConfig: (server as any).backupSftpConfig,
                });
                // Use deleteMany to avoid P2025 (RecordNotFound) when periodic
                // retention already deleted this backup between our findMany and here.
                await this.prisma.backup.deleteMany({ where: { id: backup.id } });
              } catch (error) {
                this.logger.warn({ err: error, backupId: backup.id }, "Failed to enforce retention");
              }
            }
          }
        }

      } else if (message.type === "backup_restore_complete") {
        // Node ownership check: a node must not be able to finalize (or
        // corrupt) another node's restore by spoofing the serverId.
        const restoreServer = await this.prisma.server.findUnique({
          where: { id: message.serverId },
          select: { nodeId: true },
        });
        if (!restoreServer || restoreServer.nodeId !== nodeId) {
          this.logger.warn(
            { nodeId, serverId: message.serverId },
            "backup_restore_complete for server not on this node — dropping",
          );
          return;
        }
        // Transition server back to STOPPED after restore completes
        await this.prisma.server.updateMany({
          where: { id: message.serverId, status: ServerState.RESTORING },
          data: { status: ServerState.STOPPED },
        });

        // Update backup record with restore timestamp only after agent confirms success
        if (message.backupId) {
          await this.prisma.backup.update({
            where: { id: message.backupId },
            data: { restoredAt: new Date() },
          }).catch(() => {}); // Best effort — don't fail the SSE event
        }

        await this.routeToClients(message.serverId, message);
      } else if (message.type === "backup_delete_complete") {
        await this.routeToClients(message.serverId, message);
      } else if (message.type === "storage_resize_complete") {
        await this.routeToClients(message.serverId, message);
      } else if (message.type === "agent_error_report") {
        // Agent (node) is reporting an error — store it as a system error with nodeId
        const level = (typeof message.level === "string" && ["error", "warn", "critical"].includes(message.level))
          ? message.level as "error" | "warn" | "critical"
          : "error";
        const component = typeof message.component === "string" ? message.component : `agent:${nodeId}`;
        const errorMessage = typeof message.message === "string" ? message.message : "Unknown agent error";
        const stack = typeof message.stack === "string" ? message.stack : undefined;
        const metadata = typeof message.metadata === "object" && message.metadata !== null
          ? message.metadata
          : undefined;
        const requestId = typeof message.requestId === "string" ? message.requestId : undefined;

        captureSystemError({
          level,
          component,
          message: errorMessage,
          stack,
          metadata,
          requestId,
          nodeId,
        }).catch(() => {});

        this.logger.info(
          { nodeId, level, component, message: errorMessage.slice(0, 200) },
          "Agent error reported"
        );

        // Revert stuck backup/restore states on agent error. The server must
        // belong to the reporting node — otherwise any node could flip another
        // node's server into ERROR.
        const errorServerId = metadata?.serverId;
        if (errorServerId && typeof errorServerId === "string") {
          const isBackupError =
            component.includes("backup") ||
            (typeof message.backupId === "string" && message.backupId) ||
            (typeof message.backupPath === "string" && message.backupPath);
          if (isBackupError) {
            const server = await this.prisma.server.findFirst({
              where: { id: errorServerId, nodeId },
              select: { id: true, status: true },
            });
            if (server && (server.status === ServerState.CREATING_BACKUP || server.status === ServerState.RESTORING)) {
              await this.prisma.server.update({
                where: { id: server.id },
                data: { status: ServerState.ERROR },
              });
              await this.prisma.serverLog.create({
                data: {
                  serverId: server.id,
                  stream: "system",
                  data: `[Agent Error] Backup/restore failed: ${errorMessage}. Transitioned from ${server.status} to ERROR.`,
                },
              });
              await this.routeToClients(server.id, {
                type: "server_state_update",
                serverId: server.id,
                state: ServerState.ERROR,
                reason: `Agent error during ${server.status}: ${errorMessage.slice(0, 200)}`,
                timestamp: Date.now(),
              });
              this.logger.info(
                { serverId: server.id, fromStatus: server.status },
                "Reverted stuck state to ERROR after agent error"
              );
            }
          }
        }
      } else if (message.type === "discovered_servers") {
        if (!message.nodeId || message.nodeId !== nodeId) {
          this.logger.warn({ nodeId, messageNodeId: message.nodeId }, "discovered_servers node mismatch");
          return;
        }
        const containers = Array.isArray(message.containers) ? message.containers : [];

        this.discoveredContainers.set(nodeId, containers.map((c: any) => ({
          containerId: String(c.containerId || ""),
          image: String(c.image || ""),
          status: String(c.status || ""),
          labels: typeof c.labels === "object" && c.labels !== null ? c.labels : {},
          networkMode: typeof c.networkMode === "string" ? c.networkMode : undefined,
          memoryLimitMb: typeof c.memoryLimitMb === "number" ? c.memoryLimitMb : undefined,
          cpuCores: typeof c.cpuCores === "number" ? c.cpuCores : undefined,
          startupCommand: typeof c.startupCommand === "string" ? c.startupCommand : undefined,
          envVarNames: Array.isArray(c.envVarNames) ? c.envVarNames : undefined,
          discoveredAt: Date.now(),
        })));

        this.logger.info(
          { nodeId, count: containers.length },
          `Discovered ${containers.length} containers on node`
        );
      }
    } catch (err) {
      this.logger.error(err, `Error handling agent message from ${nodeId}`);
      captureSystemError({
        level: 'error',
        component: 'WebSocketGateway',
        message: err instanceof Error ? err.message : `Error handling agent message from ${nodeId}`,
        stack: err instanceof Error ? err.stack : undefined,
        metadata: { nodeId },
      }).catch(() => {});
    }
  }

  private async handleClientMessage(clientId: string, data: any) {
    try {
      // Enforce maximum message size limit to prevent memory exhaustion
      const MAX_MESSAGE_BYTES = 1024 * 1024; // 1MB max
      if (data && Buffer.byteLength(data) > MAX_MESSAGE_BYTES) {
        this.logger.warn({ clientId, size: Buffer.byteLength(data) }, "Client message exceeds 1MB limit");
        const client = this.clients.get(clientId);
        if (client?.socket?.readyState === 1) {
          client.socket.close();
        }
        return;
      }

      const message = JSON.parse(data.toString());
      const client = this.clients.get(clientId);

      if (!client) {
        this.logger.warn({ clientId }, "Received message for unknown client");
        return;
      }

      // Per-connection message rate limit (handshakes included, so pre-auth
      // floods cost the same as post-auth floods).
      const nowMs = Date.now();
      const limiter = this.clientMessageCounters.get(clientId);
      if (!limiter || nowMs >= limiter.resetAt) {
        this.clientMessageCounters.set(clientId, {
          count: 1,
          resetAt: nowMs + WebSocketGateway.CLIENT_MESSAGE_LIMIT.windowMs,
        });
      } else if (limiter.count >= WebSocketGateway.CLIENT_MESSAGE_LIMIT.max) {
        this.logger.debug({ clientId }, "Client message rate limit exceeded");
        return;
      } else {
        limiter.count += 1;
      }

      this.logger.debug({ clientId, type: message.type, authenticated: client.authenticated }, "Received client message");

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
        // Enforce the same per-user connection cap as the cookie path so the
        // token path cannot bypass MAX_CLIENT_CONNECTIONS_PER_USER.
        let userConnections = 0;
        for (const [, c] of this.clients) {
          if (c.authenticated && c.userId === session.user.id) userConnections += 1;
        }
        if (userConnections >= this.MAX_CONNECTIONS_PER_USER) {
          this.logger.warn(
            { clientId, userId: session.user.id, connections: userConnections },
            "Client connection rejected: per-user limit reached (token handshake)",
          );
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

      // ── Plugin WebSocket handler dispatch ─────────────────────────────
      if (typeof message.type === 'string' && message.type.startsWith('plugin:')) {
        const entry = this.pluginWsHandlers.get(message.type);
        if (entry) {
          try {
            await entry.handler(message.data ?? message, clientId, client.userId);
          } catch (err) {
            captureSystemError({
              level: 'error',
              component: 'WebSocketGateway',
              message: err instanceof Error ? err.message : `Plugin WS handler error for ${message.type}`,
              stack: err instanceof Error ? err.stack : undefined,
              metadata: { messageType: message.type },
            }).catch(() => {});
            this.logger.error(err, `Plugin WS handler error for ${message.type}`);
          }
          return;
        }
        // No matching handler — fall through to other message types
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
        // Server-scoped role permissions: global roles + RoleServerGrant +
        // RoleNodeGrant rows covering this server (mirrors the REST checks).
        const rolePerms = await this.getUserServerRolePermissions(
          client.userId,
          server.id,
          server.nodeId,
        );
        // SECURITY: a bare node assignment must not grant console output or
        // server event visibility for every server on the node — require the
        // node.update management pairing (same contract as server_control
        // authorization and routes/backups.ts).
        const nodeAccess =
          (await hasNodeAccess(this.prisma, client.userId, server.nodeId)) &&
          rolePerms.includes("node.update");
        const roleCanServerRead =
          rolePerms.includes("server.read") ||
          rolePerms.includes("admin.write") ||
          rolePerms.includes("*");
        const roleCanConsoleRead = rolePerms.includes("console.read") || roleCanServerRead;
        if (
          !access &&
          server.ownerId !== client.userId &&
          !isAdmin &&
          !nodeAccess &&
          !roleCanServerRead &&
          !roleCanConsoleRead
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
        const isOwner = server.ownerId === client.userId;
        const canConsoleRead =
          isOwner || isAdmin || nodeAccess || roleCanConsoleRead || access?.permissions?.includes("console.read");
        const canServerRead =
          isOwner || isAdmin || nodeAccess || roleCanServerRead || access?.permissions?.includes("server.read");
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
            serverId: server.id,
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

        // Check if client is owner or has access. Power actions follow the
        // decideServerAccess contract: admin requires admin.write (admin.read
        // is observation-only), a global role granting the action's specific
        // server permission also counts, and node assignment alone grants
        // nothing unless paired with node.update.
        const isOwner = server.ownerId === client.userId;
        const isAdmin = await this.userHasAdminWrite(client.userId);
        const rolePerms = await this.getUserServerRolePermissions(
          client.userId,
          server.id,
          server.nodeId,
        );
        const nodeAccess =
          (await hasNodeAccess(this.prisma, client.userId, server.nodeId)) &&
          rolePerms.includes("node.update");
        const requiredPermission =
          event.action === "start"
            ? "server.start"
            : event.action === "stop"
              ? "server.stop"
              // kill, restart, and reboot are destructive actions requiring server.stop permission
              : event.action === "kill" || event.action === "restart" || event.action === "reboot"
                ? "server.stop"
                : "server.start";
        const roleAllows = rolePerms.includes(requiredPermission);
        if (!isOwner && !access && !isAdmin && !nodeAccess && !roleAllows) {
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
        if (
          !isOwner &&
          !isAdmin &&
          !nodeAccess &&
          !roleAllows &&
          !access?.permissions?.includes(requiredPermission)
        ) {
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
          // SECURITY: forward an explicit whitelist only. `...event` preserved
          // every client-supplied key, and the agent honors dockerImage/image/
          // startupCommand on server_control restarts — a sub-user with only
          // server.stop could restart another tenant's server into an
          // attacker-chosen image/startup command with the victim's data
          // mounted. Power control never carries template/image payloads:
          // panel-initiated config changes use the dedicated install_server /
          // rebuild_server messages built server-side (routes/servers/power.ts).
          const whitelisted: Record<string, unknown> = {
            type: "server_control",
            serverId: event.serverId,
            action: event.action,
          };
          const maybeRequestId = (event as unknown as Record<string, unknown>)
            .requestId;
          if (typeof maybeRequestId === "string") {
            whitelisted.requestId = maybeRequestId;
          }
          const maybeTemplate = (event as unknown as Record<string, unknown>)
            .template;
          if (
            maybeTemplate &&
            typeof maybeTemplate === "object" &&
            !Array.isArray(maybeTemplate)
          ) {
            // Graceful stop policy only (template.stopCommand / sendSignalTo);
            // startup/image fields are intentionally excluded.
            const t = maybeTemplate as Record<string, unknown>;
            const stopPolicy: Record<string, unknown> = {};
            if (typeof t.stopCommand === "string") {
              stopPolicy.stopCommand = t.stopCommand.slice(0, 500);
            }
            if (typeof t.sendSignalTo === "string") {
              stopPolicy.sendSignalTo = t.sendSignalTo.slice(0, 32);
            }
            if (Object.keys(stopPolicy).length > 0) {
              whitelisted.template = stopPolicy;
            }
          }
          agent.socket.send(
            JSON.stringify({
              ...whitelisted,
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

        const isAdmin = await this.userHasAdminWrite(client.userId);
        const access = await this.prisma.serverAccess.findUnique({
          where: { userId_serverId: { userId: client.userId, serverId: server.id } },
        });
        // Node assignment alone must not grant console write (the
        // decideServerAccess contract) — it requires node.update too.
        const rolePerms = await this.getUserRolePermissions(client.userId);
        const consoleNodeAccess =
          (await hasNodeAccess(this.prisma, client.userId, server.nodeId)) &&
          rolePerms.includes("node.update");
        if (!access && server.ownerId !== client.userId && !isAdmin && !consoleNodeAccess) {
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
          !isAdmin &&
          !consoleNodeAccess
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
          // SECURITY: forward an explicit whitelist (serverId/data + DB-derived
          // serverUuid). `...event` forwarded every client-supplied key to the
          // privileged agent; harmless today (the agent reads only these three
          // fields) but the same pattern that made server_control dangerous.
          const data = (event as unknown as Record<string, unknown>).data;
          agent.socket.send(
            JSON.stringify({
              type: "console_input",
              serverId: event.serverId,
              serverUuid: server.uuid,
              ...(typeof data === "string" ? { data } : {}),
            })
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
      captureSystemError({
        level: 'error',
        component: 'WebSocketGateway',
        message: err instanceof Error ? err.message : `Error handling client message from ${clientId}`,
        stack: err instanceof Error ? err.stack : undefined,
        metadata: { clientId },
      }).catch(() => {});
    }
  }

  /**
   * Route a message to all subscribed clients (WebSocket + SSE).
   * Used for server-scoped events (state changes, backups, alerts).
   */
  async routeToClients(serverId: string, message: any): Promise<void> {
    // Use cached server access list
    const now = Date.now();
    const cached = this.serverAccessCache.get(serverId);
    let allowedUsers: Set<string>;

    if (cached && cached.expiresAt > now) {
      allowedUsers = cached.allowedUsers;
    } else {
      const server = await this.prisma.server.findUnique({
        where: { id: serverId },
        include: { access: { select: { userId: true } } },
      });
      if (!server) return;
      allowedUsers = new Set([
        server.ownerId,
        ...server.access.map((a) => a.userId),
      ]);
      this.serverAccessCache.set(serverId, { allowedUsers, expiresAt: now + WebSocketGateway.SERVER_ACCESS_TTL_MS });
    }


    // Sanitize console data before relaying to prevent XSS
    let messageToSend = message;
    if (message.type === 'console_output' && typeof message.data === 'string') {
      messageToSend = {
        ...message,
        data: sanitizeInput(message.data),
      };
    }

    for (const [, client] of this.clients) {
      if (!client.subscriptions.has(serverId)) continue;
      if (allowedUsers.has(client.userId)) {
        if (client.socket.readyState === 1) {
          client.socket.send(JSON.stringify(messageToSend));
        }
      }
    }

    const eventType = messageToSend.type;
    const sseEventSubs = this.sseEventSubscribers.get(serverId);
    if (sseEventSubs) {
      const eventData = JSON.stringify(messageToSend);
      for (const [, sub] of sseEventSubs) {
        if (sub.eventTypes.includes(eventType)) {
          sub.lastActivity = Date.now();
          try { sub.push(eventType, eventData); } catch { /* ignore */ }
        }
      }
    }

    // Also push to global SSE subscribers (serverIds filter applies)
    const eventData = JSON.stringify(messageToSend);
    for (const [, sub] of this.globalSseSubscribers) {
      if (sub.serverIds && !sub.serverIds.has(serverId)) continue;
      if (sub.eventTypes.includes(eventType)) {
        sub.lastActivity = Date.now();
        try { sub.push(eventType, eventData); } catch { /* ignore */ }
      }
    }
  }

  /**
   * Push an event to all global SSE subscribers listening for that event type.
   * Used for user-level events (user_created, user_deleted) that don't belong to a server.
   *
   * @param eventType - The event type (e.g. 'user_created')
   * @param data - Event payload
   */
  pushToGlobalSubscribers(eventType: string, data: unknown): void {
    const eventData = JSON.stringify(data);
    // When payload carries a serverId, honor per-subscriber server scope so
    // non-admin global streams cannot observe other tenants' lifecycle events.
    const payloadServerId =
      data && typeof data === 'object' && typeof (data as any).serverId === 'string'
        ? ((data as any).serverId as string)
        : undefined;
    for (const [, sub] of this.globalSseSubscribers) {
      if (!sub.eventTypes.includes(eventType)) continue;
      if (
        payloadServerId &&
        sub.serverIds &&
        !sub.serverIds.has(payloadServerId)
      ) {
        continue;
      }
      sub.lastActivity = Date.now();
      try {
        sub.push(eventType, eventData);
      } catch {
        // subscriber connection closed — will be cleaned up
      }
    }
  }


  /**
   * Push an event to all admin SSE subscribers listening for that event type.
   * Used for entity-level events (users, nodes, templates, alerts) in admin context.
   */
  pushToAdminSubscribers(eventType: string, data: unknown): void {
    const eventData = JSON.stringify(data);
    for (const [, sub] of this.adminEventSubscribers) {
      if (sub.eventTypes.includes(eventType)) {
        sub.lastActivity = Date.now();
        try {
          sub.push(eventType, eventData);
        } catch {
          // subscriber connection closed — will be cleaned up
        }
      }
    }
  }

  /**
   * Register an SSE subscriber for admin entity events.
   * Returns an unsubscribe function.
   */
  addAdminEventSubscriber(
    eventTypes: string[],
    push: (event: string, data: any) => void,
  ): () => void {
    const subscriberId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.adminEventSubscribers.set(subscriberId, { eventTypes, push, lastActivity: Date.now() });
    this.logger.debug({ subscriberId, eventTypes }, 'Admin SSE subscriber added');
    return () => {
      this.adminEventSubscribers.delete(subscriberId);
      this.logger.debug({ subscriberId }, 'Admin SSE subscriber removed');
    };
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

    // Sanitize console data before relaying to clients to prevent XSS
    const sanitizedMessage = {
      ...message,
      data: typeof message.data === 'string' ? sanitizeInput(message.data) : message.data,
    };

    for (const [, client] of this.clients) {
      if (!client.subscriptions.has(serverId)) {
        continue;
      }
      if (allowedUsers.includes(client.userId)) {
        try {
          if (client.socket.readyState === 1) {
            client.socket.send(JSON.stringify(sanitizedMessage));
          }
        } catch {
          // Stale socket — ignore
        }
      }
    }

    // Also push to SSE subscribers (HTTP/2 streaming)
    const sseSubs = this.sseSubscribers.get(serverId);
    if (sseSubs) {
      const msgType = message.type;

      // Console SSE subscribers only need console_output, eula_required, error, and connected.
      // Skip high-frequency non-console events (resource_stats, server_state_update, etc.)
      // to avoid flooding the SSE connection with irrelevant data.
      if (
        msgType !== 'console_output' &&
        msgType !== 'eula_required' &&
        msgType !== 'error' &&
        msgType !== 'connected'
      ) {
        return;
      }

      const event = msgType === 'console_output'
        ? 'console_output'
        : msgType === 'error'
          ? 'error'
          : msgType === 'eula_required'
            ? 'eula_required'
            : 'message';

      const eventData = event === 'message'
        ? JSON.stringify(message)
        : JSON.stringify({
          serverId: message.serverId,
          stream: message.stream ?? 'stdout',
          data: message.data ?? '',
          timestamp: message.timestamp ?? new Date().toISOString(),
          type: message.type,
          eulaText: message.eulaText,
          eulaServerUuid: message.serverUuid,
          error: message.error,
        });

      for (const [, sub] of sseSubs) {
        sub.lastActivity = Date.now();
        try {
          sub.push(event, eventData);
        } catch {
          // Stale subscriber — ignore
        }
      }
    }
  }

  // ── SSE Subscriber Management ────────────────────────────────────────────────

  /**
   * Register an SSE subscriber for a server's console output.
   * Returns an unsubscribe function to call when the SSE connection closes.
   */
  addSseSubscriber(
    serverId: string,
    push: (event: string, data: string) => void,
  ): { unsubscribe: () => void; touch: () => void } {
    if (!this.sseSubscribers.has(serverId)) {
      this.sseSubscribers.set(serverId, new Map());
    }
    const sseSubs = this.sseSubscribers.get(serverId);
    if (sseSubs && sseSubs.size >= this.MAX_SSE_CONSOLE_PER_SERVER) {
      throw new Error(`SSE console subscriber cap reached for server ${serverId}`);
    }
    const subscriberId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    if (sseSubs) {
      sseSubs.set(subscriberId, { push, lastActivity: Date.now() });
    }
    this.logger.debug({ serverId, subscriberId }, 'SSE subscriber added');

    const unsubscribe = () => {
      const subs = this.sseSubscribers.get(serverId);
      if (subs) {
        subs.delete(subscriberId);
        if (subs.size === 0) {
          this.sseSubscribers.delete(serverId);
        }
        this.logger.debug({ serverId, subscriberId }, 'SSE subscriber removed');
      }
    };

    const touch = () => {
      const subs = this.sseSubscribers.get(serverId);
      if (subs) {
        const sub = subs.get(subscriberId);
        if (sub) {
          sub.lastActivity = Date.now();
        }
      }
    };

    return { unsubscribe, touch };
  }

  /**
   * Check how many SSE subscribers are active for a server.
   */
  getSseSubscriberCount(serverId: string): number {
    return this.sseSubscribers.get(serverId)?.size ?? 0;
  }

  /**
   * Register an SSE subscriber for specific event types on a server.
   * Returns an unsubscribe function.
   *
   * @param serverId - The server to subscribe to
   * @param eventTypes - Array of event types to receive (e.g. ['server_state_update', 'backup_complete'])
   * @param push - Function called with (eventType, eventData) when matching messages arrive
   */
  addSseEventSubscriber(
    serverId: string,
    eventTypes: string[],
    push: (event: string, data: any) => void,
  ): () => void {
    if (!this.sseEventSubscribers.has(serverId)) {
      this.sseEventSubscribers.set(serverId, new Map());
    }
    const sseEventSubs = this.sseEventSubscribers.get(serverId);
    if (sseEventSubs && sseEventSubs.size >= this.MAX_SSE_EVENTS_PER_SERVER) {
      throw new Error(`SSE event subscriber cap reached for server ${serverId}`);
    }
    const subscriberId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    if (sseEventSubs) {
      sseEventSubs.set(subscriberId, { eventTypes, push, lastActivity: Date.now() });
    }
    this.logger.debug({ serverId, subscriberId, eventTypes }, 'SSE event subscriber added');

    return () => {
      const subs = this.sseEventSubscribers.get(serverId);
      if (subs) {
        subs.delete(subscriberId);
        if (subs.size === 0) {
          this.sseEventSubscribers.delete(serverId);
        }
        this.logger.debug({ serverId, subscriberId }, 'SSE event subscriber removed');
      }
    };
  }

  /**
   * Get count of SSE event subscribers for a server.
   */
  getSseEventSubscriberCount(serverId: string): number {
    return this.sseEventSubscribers.get(serverId)?.size ?? 0;
  }

  /**
   * Register a global SSE subscriber that receives events for specific servers.
   * Used by SSE endpoints (events stream, metrics stream) to avoid per-WS subscriptions.
   *
   * @param eventTypes - Array of event types to receive (e.g. ['server_state_update', 'resource_stats'])
   * @param push - Function called with (eventType, eventData) when matching messages arrive
   * @param serverIds - Optional list of server IDs to filter events to (if non-empty, events from other servers are ignored)
   */
  getLatestResourceStats(serverId: string): Record<string, unknown> | undefined {
    return this.latestResourceStats.get(serverId);
  }

  addGlobalSseSubscriber(
    eventTypes: string[],
    push: (event: string, data: any) => void,
    serverIds?: string[],
  ): () => void {
    const subscriberId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.globalSseSubscribers.set(subscriberId, {
      eventTypes,
      push,
      // undefined = no filter (full admin). Explicit empty array = no servers allowed.
      serverIds: serverIds === undefined ? undefined : new Set(serverIds),
      lastActivity: Date.now(),
    });
    this.logger.debug({ subscriberId, eventTypes, serverIds }, 'Global SSE subscriber added');


    return () => {
      this.globalSseSubscribers.delete(subscriberId);
      this.logger.debug({ subscriberId }, 'Global SSE subscriber removed');
    };
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
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      const timeout = 60000; // 60 seconds - agent sends every 15s

      for (const [nodeId, agent] of this.agents) {
        if (now - agent.lastHeartbeat > timeout) {
          this.logger.warn(`Agent heartbeat timeout: ${nodeId}`);
          this.bumpCounter(this.reliabilityHeartbeatTimeouts, nodeId);
          // terminate(), not close(): a half-open socket will never complete a
          // close-frame handshake, leaving the connection lingering for minutes.
          this.terminateSocket(agent.socket);
          this.agents.delete(nodeId);
        this.agentUpdateSent.delete(nodeId);
          // Full disconnect cleanup — the socket's own onClose handler will
          // early-return (its map entry is already gone), so the reap must do
          // everything the close path would have done.
          this.failPendingRequestsForNode(nodeId, `Agent ${nodeId} heartbeat timeout`);
          this.discoveredContainers.delete(nodeId);
          this.rejectBackupRelay(nodeId, new Error(`Source or target agent ${nodeId} disconnected mid-relay`));
          this.prisma.node.update({
            where: { id: nodeId },
            data: { isOnline: false },
          }).catch(err => {
            this.logger.error({ err, nodeId }, 'Failed to update node status on heartbeat timeout');
            captureSystemError({
              level: 'error',
              component: 'WebSocketGateway',
              message: `Failed to update node status on heartbeat timeout: ${nodeId}`,
              stack: err instanceof Error ? err.stack : undefined,
              metadata: { nodeId },
            }).catch(() => {});
          });
          this.pushToAdminSubscribers('node_updated', {
            type: 'node_updated',
            nodeId,
            isOnline: false,
            timestamp: Date.now(),
          });
          // Revert stuck backup/restore states (mirrors the onClose path) so
          // servers don't linger in CREATING_BACKUP/RESTORING until the
          // 15-minute watchdog fires.
          this.revertStuckBackupStatesForNode(nodeId);
        }
      }
    }, 10000); // Check every 10 seconds
  }

  /**
   * Revert servers on a node that are stuck in CREATING_BACKUP/RESTORING to
   * STOPPED. Shared by the disconnect-close path and the heartbeat reaper.
   */
  private revertStuckBackupStatesForNode(nodeId: string): void {
    this.prisma.server.findMany({
      where: {
        nodeId,
        status: { in: [ServerState.CREATING_BACKUP, ServerState.RESTORING] },
      },
      select: { id: true, status: true },
    }).then(async (stuckServers) => {
      for (const server of stuckServers) {
        await this.prisma.server.update({
          where: { id: server.id },
          data: { status: ServerState.STOPPED },
        });
        await this.prisma.serverLog.create({
          data: {
            serverId: server.id,
            stream: "system",
            data: `[Node Disconnect] Node ${nodeId} went offline while server was in ${server.status}. Transitioned to STOPPED.`,
          },
        });
        await this.routeToClients(server.id, {
          type: "server_state_update",
          serverId: server.id,
          state: ServerState.STOPPED,
          reason: `Node ${nodeId} disconnected during ${server.status}`,
          timestamp: Date.now(),
        });
        this.logger.info(
          { serverId: server.id, nodeId, fromStatus: server.status },
          "Reverted stuck state to STOPPED on node disconnect"
        );
      }
    }).catch(err => {
      this.logger.error({ err, nodeId }, "Failed to revert stuck states on node disconnect");
    });
  }

  /**
   * Panel-initiated WS ping loop. Heartbeats prove the agent→panel direction;
   * this proves panel→agent and updates liveness on pong so a silently
   * dead socket is reaped by the heartbeat check within one interval.
   */
  private startPingLoop() {
    const PING_INTERVAL_MS = 30_000;
    this.pingInterval = setInterval(() => {
      for (const [, agent] of this.agents) {
        if (!agent.authenticated || agent.socket.readyState !== 1) continue;
        try {
          agent.socket.ping();
        } catch {
          // A failed ping means a broken pipe; the heartbeat timeout will
          // reap it — don't race it here.
        }
      }
    }, PING_INTERVAL_MS);
  }

  private sweepCounters() {
    const now = Date.now();
    for (const [key, val] of this.consoleOutputCounters) {
      if (now >= val.resetAt) this.consoleOutputCounters.delete(key);
    }
    for (const [key, val] of this.clientCommandCounters) {
      if (now >= val.resetAt) this.clientCommandCounters.delete(key);
    }
    for (const [key, val] of this.agentMessageCounters) {
      if (now >= val.resetAt) this.agentMessageCounters.delete(key);
    }
    for (const [key, val] of this.agentMetricsCounters) {
      if (now >= val.resetAt) this.agentMetricsCounters.delete(key);
    }
    for (const [key, val] of this.serverMetricsCounters) {
      if (now >= val.resetAt) this.serverMetricsCounters.delete(key);
    }
    for (const [key, val] of this.consoleResumeTimestamps) {
      // Resume timestamps are single-use; expire after 60 seconds
      if (now - val > 60_000) this.consoleResumeTimestamps.delete(key);
    }
    for (const [nodeId, ts] of this.nodeLastPersistedSeen) {
      // Bound the heartbeat-throttle map: entries idle longer than 10 minutes
      // belong to nodes that are long gone.
      if (now - ts > 600_000) this.nodeLastPersistedSeen.delete(nodeId);
    }
    for (const [nodeId, queue] of this.outbox) {
      const fresh = queue.filter((e) => now - e.queuedAt <= WebSocketGateway.OUTBOX_TTL_MS);
      if (fresh.length === 0) {
        this.outbox.delete(nodeId);
      } else if (fresh.length !== queue.length) {
        this.outbox.set(nodeId, fresh);
      }
    }
    // Sweep the remaining counter maps: without these, an authenticated agent
    // (or console traffic) inflating entries for arbitrary server/node ids
    // grows the heap without bound (serverConsoleBytes was attacker-inflatable).
    for (const [key, val] of this.serverConsoleBytes) {
      if (now >= val.resetAt) this.serverConsoleBytes.delete(key);
    }
    for (const [key, val] of this.agentLimitWarnings) {
      if (now >= val.resetAt) this.agentLimitWarnings.delete(key);
    }
    for (const [key, val] of this.serverCommandCounters) {
      if (now >= val.resetAt) this.serverCommandCounters.delete(key);
    }
    for (const [key, val] of this.clientMessageCounters) {
      if (now >= val.resetAt) this.clientMessageCounters.delete(key);
    }
    for (const [key, val] of this.userCommandCounters) {
      if (now >= val.resetAt) this.userCommandCounters.delete(key);
    }
  }

  private startMaintenanceSweep() {
    this.subscriberSweepInterval = setInterval(() => {
      this.sweepSseSubscribers();
      this.sweepSseEventSubscribers();
      this.sweepGlobalSubscribers();
      this.sweepAdminSubscribers();
      this.sweepCounters();
    }, 60000);
  }

  private sweepSseSubscribers() {
    const now = Date.now();
    // Console SSE connections are long-lived by design (agents may be offline for
    // extended periods while browsers stay connected). Use a 5-minute sweep to
    // avoid deleting active subscribers during agent reconnections.
    const SWEEP_MS = 300_000;
    for (const [serverId, subs] of this.sseSubscribers) {
      for (const [subId, sub] of subs) {
        if (now - sub.lastActivity > SWEEP_MS) {
          subs.delete(subId);
        }
      }
      if (subs.size === 0) {
        this.sseSubscribers.delete(serverId);
      }
    }
  }

  private sweepSseEventSubscribers() {
    const now = Date.now();
    for (const [serverId, subs] of this.sseEventSubscribers) {
      for (const [subId, sub] of subs) {
        if (now - sub.lastActivity > 300_000) {
          subs.delete(subId);
        }
      }
      if (subs.size === 0) {
        this.sseEventSubscribers.delete(serverId);
      }
    }
  }

  private sweepGlobalSubscribers() {
    const now = Date.now();
    for (const [subId, sub] of this.globalSseSubscribers) {
      if (now - sub.lastActivity > 300_000) {
        this.globalSseSubscribers.delete(subId);
      }
    }
  }

  private sweepAdminSubscribers() {
    const now = Date.now();
    for (const [subId, sub] of this.adminEventSubscribers) {
      if (now - sub.lastActivity > 300_000) {
        this.adminEventSubscribers.delete(subId);
      }
    }
  }

  // Send message to agent (for API endpoints)
  /** True when an authenticated agent socket is currently open for this node. */
  isAgentConnected(nodeId: string): boolean {
    const agent = this.agents.get(nodeId);
    return Boolean(agent && agent.authenticated && agent.socket.readyState === 1);
  }

  async sendToAgent(nodeId: string, message: any): Promise<boolean> {
    const agent = this.agents.get(nodeId);
    if (!agent || !agent.authenticated || agent.socket.readyState !== 1) {
      // Agent mid-reconnect: queue control-plane commands (bounded, with TTL)
      // so they are replayed on reconnect instead of vanishing.
      if (this.queueInOutbox(nodeId, message)) {
        this.logger.debug(
          { nodeId, type: typeof message?.type === "string" ? message.type : undefined },
          "Agent offline — command queued in outbox",
        );
        return true;
      }
      this.logger.warn(
        { nodeId, type: typeof message?.type === "string" ? message.type : undefined },
        "Cannot send to agent: not connected",
      );
      return false;
    }

    // Backpressure guard: a slow/half-open consumer can accumulate unbounded
    // kernel-buffered bytes. Shed non-critical traffic above the watermark;
    // control-plane messages always attempt delivery.
    const bufferedAmount = Number(agent.socket.bufferedAmount ?? 0);
    if (
      bufferedAmount > WebSocketGateway.AGENT_BACKPRESSURE_BYTES &&
      !CRITICAL_OUTBOUND_TYPES.has(message?.type)
    ) {
      this.bumpCounter(this.reliabilityBackpressureDrops, nodeId);
      this.logger.warn(
        { nodeId, bufferedAmount, type: message?.type },
        "Agent backpressure threshold exceeded — dropping low-priority message",
      );
      return false;
    }

    try {
      agent.socket.send(JSON.stringify(message));
      return true;
    } catch (err) {
      captureSystemError({
        level: 'error',
        component: 'WebSocketGateway',
        message: err instanceof Error ? err.message : `Error sending message to agent ${nodeId}`,
        stack: err instanceof Error ? err.stack : undefined,
        metadata: { nodeId },
      }).catch(() => {});
      this.logger.error(err, `Error sending message to agent ${nodeId}`);
      return false;
    }
  }

  /** Push a JSON message to every authenticated agent. */
  broadcastToAgents(message: Record<string, unknown>): number {
    let sent = 0;
    const payload = JSON.stringify(message);
    for (const [nodeId, agent] of this.agents) {
      if (!agent.authenticated || agent.socket.readyState !== 1) {
        continue;
      }
      try {
        agent.socket.send(payload);
        sent++;
      } catch (err) {
        this.logger.warn({ err, nodeId }, "Failed to broadcast to agent");
      }
    }
    return sent;
  }

  /** Send a raw binary payload to an agent (used for efficient backup streaming). */
  sendBinaryToAgent(nodeId: string, data: Buffer): boolean {
    const agent = this.agents.get(nodeId);
    if (!agent || !agent.authenticated || agent.socket.readyState !== 1) {
      return false;
    }
    // Backpressure guard for bulk transfers: exceeding the watermark fails
    // the send (and thus the transfer) rather than buffering without bound.
    if (Number(agent.socket.bufferedAmount ?? 0) > WebSocketGateway.AGENT_BACKPRESSURE_BYTES) {
      this.bumpCounter(this.reliabilityBackpressureDrops, nodeId);
      return false;
    }
    try {
      agent.socket.send(data);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Set up a transparent binary relay between two agents for backup streaming.
   * Binary frames from sourceNodeId are forwarded directly to targetNodeId.
   * Returns a promise that resolves when the source sends backup_stream_complete.
   */
  async relayBackupStream(
    sourceNodeId: string,
    targetNodeId: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const sourceAgent = this.agents.get(sourceNodeId);
      const targetAgent = this.agents.get(targetNodeId);

      if (!sourceAgent || sourceAgent.socket.readyState !== 1) {
        return reject(new Error(`Source agent ${sourceNodeId} not connected`));
      }
      if (!sourceAgent.authenticated) {
        return reject(new Error(`Source agent ${sourceNodeId} is not authenticated`));
      }
      if (!targetAgent || targetAgent.socket.readyState !== 1) {
        return reject(new Error(`Target agent ${targetNodeId} not connected`));
      }

      if (this.activeBackupRelay) {
        return reject(new Error("A backup relay is already active"));
      }

      const cleanup = () => {
        delete sourceAgent.socket.__catalystRelaySocket;
      };

      const timeout = setTimeout(() => {
        this.activeBackupRelay = null;
        cleanup();
        reject(new Error("Backup stream relay timed out (5 min)"));
      }, 5 * 60 * 1000);

      this.activeBackupRelay = { sourceNodeId, targetNodeId, resolve, reject };

      // Tag the socket allowed to inject binary frames for this relay. The
      // binary branch of handleAgentMessage drops frames from any other socket.
      sourceAgent.socket.__catalystRelaySocket = true;

      // The handleAgentMessage method will forward binary frames while this relay is active.
      // The source agent sends a text frame "backup_stream_complete" when done,
      // which is handled by the normal message path below.

      // Store timeout reference for cleanup
      (this.activeBackupRelay as any)._timeout = timeout;
    });
  }

  /** Resolve an active backup relay (called when backup_stream_complete is received). */
  resolveBackupRelay(sourceNodeId: string): void {
    if (this.activeBackupRelay && this.activeBackupRelay.sourceNodeId === sourceNodeId) {
      const sourceAgent = this.agents.get(sourceNodeId);
      if (sourceAgent) delete sourceAgent.socket.__catalystRelaySocket;
      clearTimeout((this.activeBackupRelay as any)._timeout);
      const { resolve } = this.activeBackupRelay;
      this.activeBackupRelay = null;
      resolve();
    }
  }

  /** Reject and clean up an active backup relay. Matches the relay whose
   *  source OR target is the given node, so either endpoint disconnecting
   *  fails the transfer fast instead of wedging the single relay slot. */
  rejectBackupRelay(sourceNodeId: string, err: Error): void {
    if (
      this.activeBackupRelay &&
      (this.activeBackupRelay.sourceNodeId === sourceNodeId ||
        this.activeBackupRelay.targetNodeId === sourceNodeId)
    ) {
      const sourceAgent = this.agents.get(this.activeBackupRelay.sourceNodeId);
      if (sourceAgent) delete sourceAgent.socket.__catalystRelaySocket;
      clearTimeout((this.activeBackupRelay as any)._timeout);
      const { reject } = this.activeBackupRelay;
      this.activeBackupRelay = null;
      reject(err);
    }
  }

  /**
   * Fail-fast every pending agent request that was sent to a node which just
   * disconnected or had its connection replaced. Requests belonging to other
   * nodes are untouched. Returns the number of rejected entries.
   */
  private failPendingRequestsForNode(nodeId: string, reason: string): number {
    let failed = 0;
    for (const [requestId, pending] of this.pendingAgentRequests) {
      if (pending.nodeId !== nodeId) continue;
      clearTimeout(pending.timeout);
      this.pendingAgentRequests.delete(requestId);
      pending.reject(new Error(reason));
      failed += 1;
    }
    return failed;
  }

  async requestFromAgent(nodeId: string, message: any, timeoutMs = 15000): Promise<any> {
    const agent = this.agents.get(nodeId);
    if (!agent || !agent.authenticated || agent.socket.readyState !== 1) {
      throw new Error(`Agent ${nodeId} not connected`);
    }

    if (this.pendingAgentRequests.size >= this.pendingAgentRequestLimit) {
      return Promise.reject(new Error('Pending agent request limit exceeded'));
    }
    const requestId = message.requestId || crypto.randomUUID();
    const payload = { ...message, requestId };

    const response = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingAgentRequests.delete(requestId);
        reject(new Error("Agent request timed out"));
      }, timeoutMs);
      this.pendingAgentRequests.set(requestId, { resolve, reject, timeout, kind: "json", nodeId });
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
      return Promise.reject(new Error('Pending agent request limit exceeded'));
    }
    const requestId = message.requestId || crypto.randomUUID();
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
        nodeId,
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
      return Promise.reject(new Error('Pending agent request limit exceeded'));
    }
    const requestId = message.requestId || crypto.randomUUID();
    const payload = { ...message, requestId };

    const response = new Promise<void>((resolve, reject) => {
      let timeout: ReturnType<typeof setTimeout>;
      // Sliding inactivity timeout: every received chunk resets the clock, so
      // long-running transfers stay alive while data flows. Only a genuine
      // stall (no chunks for timeoutMs) aborts the stream. A fixed 60s
      // wall-clock previously killed every backup larger than ~60s of
      // streaming — including the agent's only copy on the S3-upload path.
      const resetTimeout = () => {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => {
          this.pendingAgentRequests.delete(requestId);
          reject(new Error("Agent request timed out"));
        }, timeoutMs);
      };
      resetTimeout();
      this.pendingAgentRequests.set(requestId, {
        resolve,
        reject,
        get timeout() {
          return timeout;
        },
        kind: "binary",
        nodeId,
        onChunk: (chunk: Buffer) => {
          resetTimeout();
          onChunk(chunk);
        },
      });
    });

    agent.socket.send(JSON.stringify(payload));
    await response;
  }

  /**
   * Disconnect all active WebSocket client connections for a specific user.
   * Used when a user is deleted or banned to immediately revoke their real-time access.
   * Returns the number of connections closed.
   */
  disconnectUser(userId: string): number {
    let closed = 0;
    for (const [clientId, client] of this.clients) {
      if (client.userId === userId) {
        try {
          if (client.socket.readyState === 1) {
            client.socket.close(4001, "User account terminated");
          }
        } catch {
          // Socket may already be closing
        }
        this.clients.delete(clientId);
        closed++;
      }
    }
    if (closed > 0) {
      this.logger.info({ userId, closed }, "Disconnected user WebSocket sessions");
    }
    return closed;
  }

  /**
   * Send a console command from an HTTP request (via SSE console route).
   * This is the HTTP-path equivalent of the WebSocket console_input handler.
   * Validates permissions and rate limits, then forwards to the agent.
   */
  async sendConsoleCommand(serverId: string, userId: string, command: string): Promise<void> {
    const server = await this.prisma.server.findUnique({
      where: { id: serverId },
    });

    if (!server) {
      throw new Error('Server not found');
    }

    // Permission check — same contract as the WS console_input path:
    // admin requires admin.write; node assignment alone is not enough.
    const access = await this.prisma.serverAccess.findUnique({
      where: { userId_serverId: { userId, serverId } },
    });
    const isAdmin = await this.userHasAdminWrite(userId);
    // Server-scoped role permissions: global roles + RoleServerGrant +
    // RoleNodeGrant rows covering this server.
    const rolePerms = await this.getUserServerRolePermissions(userId, serverId, server.nodeId);
    const hasScopedGrant = rolePerms.some((p) =>
      (ALL_SERVER_PERMISSIONS as readonly string[]).includes(p),
    );
    const consoleNodeAccess =
      (await hasNodeAccess(this.prisma, userId, server.nodeId)) &&
      rolePerms.includes("node.update");

    if (
      !access &&
      server.ownerId !== userId &&
      !isAdmin &&
      !consoleNodeAccess &&
      !hasScopedGrant
    ) {
      throw Object.assign(new Error('Permission denied'), { code: 403 });
    }
    if (
      !access?.permissions?.includes('console.write') &&
      server.ownerId !== userId &&
      !isAdmin &&
      !consoleNodeAccess &&
      !rolePerms.includes('console.write')
    ) {
      throw Object.assign(new Error('Permission denied'), { code: 403 });
    }

    // Suspension check
    if (process.env.SUSPENSION_ENFORCED !== 'false' && server.suspendedAt) {
      throw new Error('Server is suspended');
    }

    // Rate limit — check client-side rate limit (we don't have clientId in HTTP context,
    // so we use userId as the key for per-user rate limiting)
    const userCommandCount = this.userCommandCounters.get(userId);
    const now = Date.now();
    if (!userCommandCount || now >= userCommandCount.resetAt) {
      this.userCommandCounters.set(userId, { count: 1, resetAt: now + this.consoleInputLimit.windowMs });
    } else {
      if (userCommandCount.count >= this.consoleInputLimit.max) {
        throw new Error('Rate limit exceeded — too many commands. Please wait before sending more.');
      }
      userCommandCount.count += 1;
    }

    // Also apply server-side rate limit
    if (!this.allowServerCommand(serverId)) {
      throw new Error('Server rate limit exceeded — please wait.');
    }

    // Get the agent for this server's node
    const agent = this.agents.get(server.nodeId);
    if (!agent) {
      throw new Error('Node agent is not connected');
    }

    // Forward to agent
    const agentMessage = JSON.stringify({
      type: 'console_input',
      serverId,
      serverUuid: server.uuid,
      data: command,
    });

    try {
      agent.socket.send(agentMessage);
    } catch (err) {
      this.logger.error({ err, serverId, userId }, 'Failed to forward console command to agent');
      captureSystemError({
        level: 'error',
        component: 'WebSocketGateway',
        message: 'Failed to forward console command to agent',
        stack: err instanceof Error ? err.stack : undefined,
        metadata: { serverId, userId },
      }).catch(() => {});
      throw new Error('Failed to communicate with node agent');
    }

    this.logger.debug({ serverId, userId, commandLength: command.length }, 'Console command forwarded via HTTP/SSE route');
  }

  private userCommandCounters = new Map<string, { count: number; resetAt: number }>();

  // ── Plugin WebSocket Handler Management ──────────────────────────────────

  /**
   * Register a plugin WebSocket message handler.
   * @param type  Prefixed type string, e.g. "plugin:ticketing-plugin:subscribe"
   * @param handler  Async handler receiving (data, clientId, userId)
   * @param pluginName  Name of the registering plugin (for cleanup on unload)
   */
  registerPluginWsHandler(
    type: string,
    handler: (data: any, clientId?: string, userId?: string) => Promise<void> | void,
    pluginName: string,
  ): void {
    this.pluginWsHandlers.set(type, { handler, pluginName });
    this.logger.debug({ type, pluginName }, 'Plugin WS handler registered');
  }

  /**
   * Unregister all WebSocket handlers for a plugin (called on disable/unload).
   */
  unregisterPluginWsHandlers(pluginName: string): void {
    for (const [type, entry] of this.pluginWsHandlers) {
      if (entry.pluginName === pluginName) {
        this.pluginWsHandlers.delete(type);
      }
    }
    this.logger.debug({ pluginName }, 'Plugin WS handlers unregistered');
  }

  /**
   * Broadcast a message to all authenticated WebSocket clients.
   * Used by plugins to push real-time events.
   */
  broadcastToAuthenticated(message: any): void {
    const data = typeof message === 'string' ? message : JSON.stringify(message);
 for (const [, client] of this.clients) {
      if (client.authenticated && client.socket.readyState === 1) {
        try {
          client.socket.send(data);
        } catch {
          // ignore send errors on stale connections
        }
      }
    }
  }

  // ── Discovered container accessors (for auto-import) ───────────────────

  getDiscoveredContainers(nodeId: string) {
    return this.discoveredContainers.get(nodeId) ?? [];
  }

  clearDiscoveredContainers(nodeId: string) {
    this.discoveredContainers.delete(nodeId);
  }

  removeDiscoveredContainer(nodeId: string, containerId: string): boolean {
    const discovered = this.discoveredContainers.get(nodeId) ?? [];
    const filtered = discovered.filter((c) => c.containerId !== containerId);
    if (filtered.length !== discovered.length) {
      this.discoveredContainers.set(nodeId, filtered);
      return true;
    }
    return false;
  }

  /**
   * Destroy the gateway: close all connections and clean up resources.
   */
  destroy(): void {
    this.logger.info('Destroying WebSocket gateway');
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.pingInterval) clearInterval(this.pingInterval);
    if (this.subscriberSweepInterval) clearInterval(this.subscriberSweepInterval);
    for (const [nodeId, agent] of this.agents) {
      try {
        agent.socket.close();
      } catch {
        // ignore
      }
      this.agents.delete(nodeId);
        this.agentUpdateSent.delete(nodeId);
    }
    for (const clientId of this.handshakeTimeouts.keys()) {
      const timer = this.handshakeTimeouts.get(clientId);
      if (timer) clearTimeout(timer);
    }
    this.handshakeTimeouts.clear();
    for (const [clientId, client] of this.clients) {
      try {
        client.socket.close();
      } catch {
        // ignore
      }
      this.clients.delete(clientId);
    }
    // Reject (not just clear) pending requests so callers fail fast and no
    // per-request timeout timers outlive the gateway, and clear the relay so
    // app.close() cannot stall on a wedged relay promise.
    for (const [requestId, pending] of this.pendingAgentRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Gateway shutting down"));
      this.pendingAgentRequests.delete(requestId);
    }
    if (this.activeBackupRelay) {
      clearTimeout((this.activeBackupRelay as any)._timeout);
      const { reject } = this.activeBackupRelay;
      this.activeBackupRelay = null;
      reject(new Error("Gateway shutting down"));
    }
    this.outbox.clear();
    this.sseSubscribers.clear();
    this.sseEventSubscribers.clear();
    this.globalSseSubscribers.clear();
    this.adminEventSubscribers.clear();
    this.pluginWsHandlers.clear();
    this.discoveredContainers.clear();
    this.logger.info('WebSocket gateway destroyed');
  }

  /**
   * Check if an agent needs to be updated to match the panel version.
   * Sends update_agent command with targetVersion if the agent is behind.
   * Tracks the last-sent version per node to avoid spamming on every health_report.
   */
  private async checkAgentUpdate(nodeId: string, agentVersion: unknown): Promise<void> {
    if (!agentVersion || typeof agentVersion !== 'string') return;

    const panelVersion = (await import('../services/auto-updater')).getCurrentVersion();
    if (!panelVersion || panelVersion === 'unknown') return;

    const agentParts = agentVersion.replace(/^v/, '').split('.').map(Number);
    const panelParts = panelVersion.replace(/^v/, '').split('.').map(Number);
    const maxLen = Math.max(agentParts.length, panelParts.length);

    let agentBehind = false;
    for (let i = 0; i < maxLen; i++) {
      const cur = agentParts[i] || 0;
      const lat = panelParts[i] || 0;
      if (lat > cur) { agentBehind = true; break; }
      if (lat < cur) { break; }
    }

    if (!agentBehind) {
      this.agentUpdateSent.delete(nodeId);
      this.agentUpdateRetryAfter.delete(nodeId);
      return;
    }

    const retryAfter = this.agentUpdateRetryAfter.get(nodeId);
    if (retryAfter && Date.now() < retryAfter) {
      return;
    }

    // Only send update if we haven't already requested this exact target version.
    const lastSent = this.agentUpdateSent.get(nodeId);
    if (lastSent === panelVersion) return;

    this.logger.info(
      { nodeId, agentVersion, panelVersion },
      'Agent version behind panel — sending update_agent command',
    );

    const sent = await this.sendToAgent(nodeId, {
      type: 'update_agent',
      targetVersion: panelVersion,
    });

    if (sent) {
      this.agentUpdateSent.set(nodeId, panelVersion);
    }
  }
}

// ── Module-level singleton getter for services that don't have access to the Fastify app ──
let _wsGatewayInstance: WebSocketGateway | null = null;

/** Return the gateway singleton. Returns null before the app calls `setWsGateway()`. */
export function getWsGateway(): WebSocketGateway | null {
  return _wsGatewayInstance;
}

/** Called once from index.ts after the gateway is constructed. */
export function setWsGateway(gw: WebSocketGateway): void {
  _wsGatewayInstance = gw;
}
