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
import { hasNodeAccess } from '../lib/permissions.js';

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
      if (!isGlobal) {
        // Per-server: verify access
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

        const allowedUsers = [server.ownerId, ...server.access.map((a) => a.userId)];
        if (!userId || !allowedUsers.includes(userId)) {
          const isAdmin = await hasNodeAccess(prisma, userId, server.nodeId);
          if (!isAdmin) {
            reply.status(403).send({ error: 'Access denied' });
            return;
          }
        }
        serverNodeId = server.nodeId;
      }
      // Global subscription (all-servers) — just verify userId exists

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

      // Per-server subscription OR global subscription for AppLayout
      const wasFirstSubscriber = !isGlobal && wsGateway.getSseEventSubscriberCount(serverId) === 0;
      const unsubscribe = isGlobal
        ? wsGateway.addGlobalSseSubscriber(EVENT_TYPES, push)
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
