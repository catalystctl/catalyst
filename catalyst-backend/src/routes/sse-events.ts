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
 *   - backup_complete / backup_restore_complete / backup_delete_complete
 *   - eula_required
 *   - alert
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

const HEARTBEAT_INTERVAL_MS = 25_000;
const CLEANUP_INTERVAL_MS = 60_000;

interface SseSubscriber {
  unsubscribe: () => void;
  heartbeatTimer: ReturnType<typeof setInterval>;
}

function formatSse(event: string, data: unknown): string {
  const json = typeof data === 'string' ? data : JSON.stringify(data);
  return `event: ${event}\ndata: ${json.replace(/\n/g, '\\n')}\n\n`;
}

function formatSseComment(comment: string): string {
  return `: ${comment}\n\n`;
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

const EVENT_TYPES = [
  'server_state_update',
  'server_state',
  'backup_complete',
  'backup_restore_complete',
  'backup_delete_complete',
  'eula_required',
  'alert',
  'server_log',
  'task_progress',
  'task_complete',
  'resource_stats',
  'storage_resize_complete',
  'server_deleted',
  'server_created',
  'server_updated',
  'server_suspended',
  'server_unsuspended',
  'user_created',
  'user_deleted',
  'user_updated',
  // Mod manager events
  'mod_install_complete',
  'mod_uninstall_complete',
  'mod_update_complete',
  // Plugin manager events
  'plugin_install_complete',
  'plugin_uninstall_complete',
  'plugin_update_complete',
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
          reply.status(401).send({ error: 'Unauthorized' });
          return;
        }
        userId = session.user.id;
      } catch {
        reply.status(401).send({ error: 'Unauthorized' });
        return;
      }

      let serverNodeId: string | undefined;
      let allowedServerIds: Set<string> | undefined;

      if (!isGlobal) {
        // Per-server: same AuthZ as decideServerAccess / ensureServerAccess.
        // Bare hasNodeAccess is NOT enough — need owner, ServerAccess,
        // (node access + node.update), or admin.write/*.
        const server = await prisma.server.findUnique({
          where: { id: serverId },
          include: {
            access: { select: { userId: true } },
          },
        });

        if (!server) {
          reply.status(404).send({ error: 'Server not found' });
          return;
        }

        if (!userId) {
          reply.status(401).send({ error: 'Unauthorized' });
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
        });

        if (!decision.allowed) {
          reply.status(403).send({ error: 'Access denied' });
          return;
        }
        serverNodeId = server.nodeId;
      } else {
        // Global subscription: build the set of servers this user may observe.
        // Contract matches decideServerAccess:
        //   owner | ServerAccess | (hasNodeAccess AND node.update) | admin.write/*
        // Do NOT fan out all servers on accessible nodes without node.update.
        // admin.read alone is NOT full-admin for cross-tenant event fanout.
        if (!userId) {
          reply.status(401).send({ error: 'Unauthorized' });
          return;
        }

        const { resolveUserPermissions } = await import('../lib/permissions-catalog.js');
        const rolePerms = await resolveUserPermissions(userId);

        if (isFullAdminRole(rolePerms)) {
          // Full admins (*/admin.write) may receive all server lifecycle events.
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

          // Node-assigned servers only when role also holds node.update.
          // Bare node assignment alone must NOT fan out every server on the node.
          if (rolePerms.includes('node.update') && accessibleNodes.nodeIds.length > 0) {
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

      // SSE headers — prevent proxy buffering with proper CORS using origin whitelist
      const origin = typeof request.headers.origin === 'string' ? request.headers.origin : '';
      const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').filter(Boolean);
      if (allowedOrigins.includes(origin)) {
        reply.raw.setHeader('Access-Control-Allow-Origin', origin);
        reply.raw.setHeader('Access-Control-Allow-Credentials', 'true');
      }
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      // Send initial connected event
      reply.raw.write(formatSseComment('connected'));
      reply.raw.write(formatSse('connected', {
        serverId,
        isGlobal,
        timestamp: new Date().toISOString(),
      }));

      // Subscribe to gateway events
      const push = (eventType: string, data: unknown) => {
        try {
          reply.raw.write(formatSse(eventType, data));
        } catch {
          // Connection closed — cleanup will happen via 'close' event
        }
      };

      // Enforce SSE subscriber caps
      const MAX_SSE_EVENTS_PER_SERVER = 100;
      if (!isGlobal && wsGateway.getSseEventSubscriberCount(serverId) >= MAX_SSE_EVENTS_PER_SERVER) {
        reply.status(503).send({ error: 'Too many event subscribers. Please try again later.' });
        return;
      }

      // Per-server subscription OR user-scoped global subscription for AppLayout.
      // For non-admins always pass an explicit list (may be empty). Only full
      // admins pass undefined (= unfiltered). Empty must NOT become unfiltered.
      const wasFirstSubscriber = !isGlobal && wsGateway.getSseEventSubscriberCount(serverId) === 0;
      const unsubscribe = isGlobal
        ? wsGateway.addGlobalSseSubscriber(
            EVENT_TYPES,
            push,
            allowedServerIds === undefined ? undefined : [...allowedServerIds],
          )
        : wsGateway.addSseEventSubscriber(serverId, EVENT_TYPES, push);

      // Push cached latest metric immediately so the client doesn't wait for the next agent tick
      if (!isGlobal) {
        const cached = wsGateway.getLatestResourceStats(serverId);
        if (cached) {
          push('resource_stats', cached);
        } else {
          // Fallback: query the DB for the most recent metric
          const latest = await prisma.serverMetrics.findFirst({
            where: { serverId },
            orderBy: { timestamp: 'desc' },
          });
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
              diskTotalMb: 0,
              timestamp: latest.timestamp.getTime(),
            });
          }
        }
      }

      // If this is the first SSE subscriber for this server, request live
      // metrics immediately so the user doesn't wait 30s for the next heartbeat.
      if (wasFirstSubscriber && serverNodeId) {
        wsGateway.sendToAgent(serverNodeId, { type: 'request_immediate_stats', serverId });
      }

      // Keep-alive heartbeat
      const heartbeatTimer = setInterval(() => {
        try {
          reply.raw.write(formatSseComment('heartbeat'));
        } catch {
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
