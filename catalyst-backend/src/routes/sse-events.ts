/**
 * SSE (Server-Sent Events) for server → client real-time events.
 *
 * Replaces WebSocket for unidirectional push messages.
 *
 * Endpoints:
 *   GET /api/servers/:serverId/events  — per-server event stream
 *   GET /api/servers/all-servers/events — global stream for all user servers (AppLayout)
 *
 * Events streamed:
 *   - server_state_update / server_state — status changes (start/stop/crash)
 *   - backup_* (started + complete for create/restore/delete)
 *   - server_files_changed — file manager mutations
 *   - task_progress / task_complete, resource_stats, mod/plugin manager
 *   - eula_required, alert, server lifecycle
 *
 * Command input goes over the dedicated console SSE route or REST API.
 * Agent ↔ Server traffic stays on WebSocket (bidirectional).
 */
import type { FastifyInstance } from 'fastify';
import type { WebSocketGateway } from '../websocket/gateway';
import { prisma } from '../db.js';
import { auth } from '../auth.js';
import { fromNodeHeaders } from 'better-auth/node';
import { hasNodeAccess, getUserAccessibleNodes } from '../lib/permissions.js';
import { decideServerAccess, isFullAdminRole } from '../lib/server-access.js';
import { openSseStream } from '../utils/sse.js';
import { apiError } from '../lib/http-error';
import { ErrorCodes } from '../shared-types';
import { requestImmediateStatsCoalesced } from '../lib/event-bus.js';

const HEARTBEAT_INTERVAL_MS = 25_000;

interface SseSubscriber {
  unsubscribe: () => void;
  heartbeatTimer: ReturnType<typeof setInterval>;
}

// Module-level subscriber registry so timers survive across HTTP requests
const activeSubscribers = new Map<string, SseSubscriber>();

function cleanupSubscriber(id: string) {
  const sub = activeSubscribers.get(id);
  if (!sub) return;
  clearInterval(sub.heartbeatTimer);
  sub.unsubscribe();
  activeSubscribers.delete(id);
}

type ReqHeaders = Record<string, string | string[] | undefined>;

// Cap the global stream (all-servers + metrics subscribers share the gateway
// registry). Checked before openSseStream so a full stream still returns JSON 503.
// Per-worker: each cluster worker enforces its own registry cap.
export const MAX_GLOBAL_SSE_SUBSCRIBERS = 200;

export const EVENT_TYPES = [
  'server_state_update',
  'backup_complete',
  'backup_restore_complete',
  'backup_delete_complete',
  // Lifecycle start events (FE was listening; BE never subscribed — silent gap)
  'backup_started',
  'backup_restore_started',
  'backup_delete_started',
  'eula_required',
  // Owner-visible alert lifecycle (creation + resolution both emit 'alert';
  // reaches non-admin owners through routeToClients / user-scoped global push).
  'alert',
  'task_progress',
  'task_complete',
  'resource_stats',
  'storage_resize_complete',
  'server_deleted',
  'server_created',
  'server_updated',
  'server_suspended',
  'server_unsuspended',
  // File manager realtime (emitted from files routes; was missing from subscriber filter)
  'server_files_changed',
  // Mod manager events
  'mod_install_complete',
  'mod_uninstall_complete',
  'mod_update_complete',
  // Plugin manager events
  'plugin_install_complete',
  'plugin_uninstall_complete',
  'plugin_update_complete',
  // Dense install/transfer/clone progress (% + stage)
  'server_operation_progress',
  // Failed clone (servers/core.ts) — a failed clone looked still-cloning without it
  'clone_failed',
  // Task CRUD (emitted by task routes)
  'task_created',
  'task_updated',
  'task_deleted',
  // Database lifecycle (emitted by database routes)
  'database_created',
  'database_deleted',
  'database_password_rotated',
  // Backup metadata changed / removed (gateway remote-upload + retention paths)
  'backup_updated',
  'backup_deleted',
  // User-scoped: permission set changed (delivered only to the global
  // subscribers of that userId via the payload-userId rule in evaluateGlobalSseDelivery)
  // NOTE: no apostrophes in comments inside this array — the FE contract test
  // extracts these names with a quote-pair regex.
  'permissions_updated',
  // Bus-reconnect signal: subscribers refetch state after possible event loss
  'resync',
  // P1.4 pruning: server_log, server_state, user_created, user_deleted and
  // user_updated were never routed to this per-server/global stream (they are
  // admin-stream only), so they were dead entries here.
];

export function sseEventsRoutes(app: FastifyInstance, wsGateway: WebSocketGateway) {
  // ── GET /api/servers/:serverId/events ───────────────────────────────────────
  //
  // Per-server event stream. Authenticated, server-scoped.
  // Also handles /api/servers/all-servers/events for AppLayout global subscription.

  app.get<{ Params: { serverId: string } }>(
    '/:serverId/events',
    {
      config: { rateLimit: false },
      schema: {
        summary: 'Stream server events',
        tags: ['Events'],
        produces: ['text/event-stream'],
        params: { type: 'object', required: ['serverId'], properties: { serverId: { type: 'string' } } },
        response: { 200: { type: 'string' }, 401: { type: 'object' }, 403: { type: 'object' }, 404: { type: 'object' }, 503: { type: 'object' } },
      },
    },
    async (request, reply) => {
      const { serverId } = request.params;
      const isGlobal = serverId === 'all-servers';

      // Authenticate
      let userId: string | null = null;
      try {
        const session = await auth.api.getSession({
          headers: fromNodeHeaders(request.headers as ReqHeaders),
        });
        if (!session) {
          apiError(reply, 401, ErrorCodes.UNAUTHORIZED, 'Unauthorized');
          return;
        }
        userId = session.user.id;
      } catch {
        apiError(reply, 401, ErrorCodes.UNAUTHORIZED, 'Unauthorized');
        return;
      }

      let serverNodeId: string | undefined;
      let allowedServerIds: Set<string> | undefined;

      if (!isGlobal) {
        // Per-server: same AuthZ as decideServerAccess / ensureServerAccess.
        // Bare hasNodeAccess is NOT enough — need owner, ServerAccess,
        // (node access + node.server_manage), or admin.write/*.
        const server = await prisma.server.findUnique({
          where: { id: serverId },
          include: {
            access: { select: { userId: true } },
          },
        });

        if (!server) {
          apiError(reply, 404, ErrorCodes.SERVER_NOT_FOUND, 'Server not found');
          return;
        }

        if (!userId) {
          apiError(reply, 401, ErrorCodes.UNAUTHORIZED, 'Unauthorized');
          return;
        }

        const { resolveUserPermissions } = await import('../lib/permissions-catalog.js');
        const rolePerms = await resolveUserPermissions(userId);
        const hasExplicitServerAccess = server.access.some((a) => a.userId === userId);
        const hasNodeAccessToServer = await hasNodeAccess(prisma, userId, server.nodeId);
        const decision = decideServerAccess({
          isOwner: server.ownerId === userId,
          hasExplicitServerAccess,
          rolePermissions: rolePerms,
          hasNodeAccess: hasNodeAccessToServer,
          // Server events are a read stream.
          requiredPermission: "server.read",
        });

        if (!decision.allowed) {
          apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, 'Access denied');
          return;
        }
        serverNodeId = server.nodeId;
      } else {
        // Global subscription: build the set of servers this user may observe.
        // Scoped snapshot contract matches decideServerAccess:
        //   owner | ServerAccess | (hasNodeAccess AND node.server_manage)
        // Do NOT fan out all servers on accessible nodes without
        // node.server_manage (legacy node.update split value still
        // satisfies raw-includes checks).
        // Read tiers (admin.read/admin.write/*) read the whole panel — this
        // stream has no write channel, so the unfiltered feed IS the read
        // feed (contract item 1). Revocation is handled by the gateway's
        // 60s unfiltered-feed re-auth sweeper.
        if (!userId) {
          apiError(reply, 401, ErrorCodes.UNAUTHORIZED, 'Unauthorized');
          return;
        }

        const { resolveUserPermissions } = await import('../lib/permissions-catalog.js');
        const rolePerms = await resolveUserPermissions(userId);

        if (isFullAdminRole(rolePerms) || rolePerms.includes('admin.read')) {
          // Read tiers may receive all server lifecycle events.
          allowedServerIds = undefined;
        } else {
          const [owned, shared, accessibleNodes] = await Promise.all([
            prisma.server.findMany({
              where: { ownerId: userId },
              select: { id: true },
            }),
            prisma.serverAccess.findMany({
              where: { userId },
              select: { serverId: true },
            }),
            getUserAccessibleNodes(prisma, userId),
          ]);

          const ids = new Set<string>([
            ...owned.map((s) => s.id),
            ...shared.map((a) => a.serverId),
          ]);

          // Node-assigned servers only when the role also holds
          // node.server_manage (legacy node.update split value still
          // satisfies raw-includes checks). Bare node assignment alone must
          // NOT fan out every server on the node.
          if (
            (rolePerms.includes('node.server_manage') || rolePerms.includes('node.update')) &&
            accessibleNodes.nodeIds.length > 0
          ) {
            const nodeServers = await prisma.server.findMany({
              where: { nodeId: { in: accessibleNodes.nodeIds } },
              select: { id: true },
            });
            for (const s of nodeServers) ids.add(s.id);
          }

          // Explicit set — empty means no server events (not unfiltered).
          allowedServerIds = ids;
        }
      }

      // Enforce SSE subscriber caps BEFORE opening the stream (JSON error path).
      // Per-worker cap (registry is process-local).
      const MAX_SSE_EVENTS_PER_SERVER = 100;
      if (!isGlobal && wsGateway.getSseEventSubscriberCount(serverId) >= MAX_SSE_EVENTS_PER_SERVER) {
        apiError(
          reply,
          503,
          ErrorCodes.SSE_SUBSCRIBER_LIMIT_REACHED,
          'Too many event subscribers. Please try again later.',
        );
        return;
      }
      if (isGlobal && wsGateway.getGlobalSseSubscriberCount() >= MAX_GLOBAL_SSE_SUBSCRIBERS) {
        apiError(
          reply,
          503,
          ErrorCodes.SSE_SUBSCRIBER_LIMIT_REACHED,
          'Too many event subscribers. Please try again later.',
        );
        return;
      }

      // Hijack so Fastify keeps the socket open after this handler returns.
      const sse = openSseStream(request, reply);
      sse.comment('connected');
      sse.push('connected', {
        serverId,
        isGlobal,
        timestamp: new Date().toISOString(),
      });

      const push = (eventType: string, data: unknown) => {
        sse.push(eventType, data);
      };

      // Per-server subscription OR user-scoped global subscription for AppLayout.
      // For non-admins always pass an explicit list (may be empty). Only read
      // tiers (admin.read/admin.write/*) pass undefined (= unfiltered). Empty
      // must NOT become unfiltered.
      const wasFirstSubscriber = !isGlobal && wsGateway.getSseEventSubscriberCount(serverId) === 0;
      let unsubscribe: () => void;
      let touch: () => void;
      try {
        ({ unsubscribe, touch } = isGlobal
          ? wsGateway.addGlobalSseSubscriber(
              EVENT_TYPES,
              push,
              allowedServerIds === undefined ? undefined : [...allowedServerIds],
              userId,
              // Feeds the gateway's 60s unfiltered-feed re-auth sweeper: on
              // loss of the read-tier grant it destroys this hijacked socket.
              () => {
                try {
                  (reply.raw as { destroy?: () => void }).destroy?.();
                } catch { /* socket already gone */ }
              },
            )
          : wsGateway.addSseEventSubscriber(serverId, EVENT_TYPES, push, userId));
      } catch {
        // Cap TOCTOU: the registry filled between the pre-check and here.
        // Notify and destroy the socket so the browser doesn't sit on a
        // silent open stream.
        try {
          sse.push('error', {
            type: 'error',
            error: ErrorCodes.SSE_SUBSCRIBER_LIMIT_REACHED,
            code: ErrorCodes.SSE_SUBSCRIBER_LIMIT_REACHED,
            timestamp: Date.now(),
          });
        } catch { /* socket already gone */ }
        request.raw.destroy();
        return;
      }

      // Push cached latest metric immediately so the client doesn't wait for the next agent tick.
      // Offline servers must read zero CPU/memory, never the last running sample.
      // A DB blip (or a socket that died mid-snapshot) must not kill the stream
      // before the heartbeat is registered — skip the snapshot and continue.
      if (!isGlobal) {
        try {
          const liveOwner = await prisma.server.findUnique({
            where: { id: serverId },
            select: { status: true, allocatedDiskMb: true },
          });
          if (liveOwner && liveOwner.status !== 'running') {
            const cached = wsGateway.getLatestResourceStats(serverId) as Record<string, unknown> | undefined;
            const diskUsageMb = typeof cached?.diskUsageMb === 'number' ? (cached.diskUsageMb as number) : 0;
            push('resource_stats', {
              type: 'resource_stats',
              serverId,
              cpuPercent: 0,
              memoryUsageMb: 0,
              networkRxBytes: '0',
              networkTxBytes: '0',
              diskIoMb: 0,
              diskUsageMb,
              diskTotalMb: liveOwner.allocatedDiskMb ?? 0,
              timestamp: Date.now(),
            });
          } else {
            const cached = wsGateway.getLatestResourceStats(serverId);
            if (cached) {
              push('resource_stats', cached);
            } else {
              // Fallback: query the DB for the most recent metric
              const [latest, diskOwner] = await Promise.all([
                prisma.serverMetrics.findFirst({
                  where: { serverId },
                  orderBy: { timestamp: 'desc' },
                }),
                prisma.server.findUnique({
                  where: { id: serverId },
                  select: { allocatedDiskMb: true },
                }),
              ]);
              if (latest) {
                push('resource_stats', {
                  type: 'resource_stats',
                  serverId,
                  cpuPercent: latest.cpuPercent,
                  memoryUsageMb: latest.memoryUsageMb,
                  networkRxBytes: latest.networkRxBytes.toString(),
                  networkTxBytes: latest.networkTxBytes.toString(),
                  diskIoMb: latest.diskIoMb ?? 0,
                  diskUsageMb: latest.diskUsageMb,
                  diskTotalMb: diskOwner?.allocatedDiskMb ?? 0,
                  timestamp: latest.timestamp.getTime(),
                });
              }
            }
          }
        } catch {
          /* snapshot skipped — live events and heartbeats continue */
        }
      }

      // If this is the first SSE subscriber for this server, request live
      // metrics immediately so the user doesn't wait 30s for the next heartbeat.
      if (wasFirstSubscriber && serverNodeId) {
        const nodeId = serverNodeId;
        void requestImmediateStatsCoalesced(serverNodeId, serverId, () =>
          wsGateway.sendToAgent(nodeId, { type: 'request_immediate_stats', serverId }),
        );
      }

      // Keep-alive heartbeat
      const heartbeatTimer = setInterval(() => {
        try {
          sse.comment('heartbeat');
          // Named-event heartbeat: the FE half-open watchdog (P2.5) waits on a
          // dispatched event, which an SSE comment can never produce.
          sse.push('ping', { t: Date.now() });
          // Keep the gateway subscriber alive while the browser stream lives
          // (otherwise the idle sweeper drops it after 300s of quiet).
          touch();
        } catch {
          // Socket is dead (destroyed by the write failure) — stop the timer.
          clearInterval(heartbeatTimer);
        }
      }, HEARTBEAT_INTERVAL_MS);

      // Generate a unique subscriber ID for tracking
      const subscriberId = `${serverId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      // Register subscriber
      activeSubscribers.set(subscriberId, { unsubscribe, heartbeatTimer });

      // Cleanup on disconnect
      request.raw.on('close', () => {
        cleanupSubscriber(subscriberId);
      });
    },
  );
}
