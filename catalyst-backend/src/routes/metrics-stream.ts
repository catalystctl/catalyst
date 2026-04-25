/**
 * SSE stream for real-time server resource metrics (CPU, memory, disk, network).
 *
 * Streams resource_stats events from the agent to all connected SSE subscribers.
 * The WebSocketGateway.routeToClients() already pushes resource_stats to SSE subscribers
 * via the globalSseSubscribers list — this endpoint just provides a dedicated HTTP stream.
 */
import type { FastifyInstance } from 'fastify';
import type { WebSocketGateway } from '../websocket/gateway';
import { prisma } from '../db.js';
import { auth } from '../auth.js';
import { fromNodeHeaders } from 'better-auth/node';
import { hasNodeAccess } from '../lib/permissions.js';

const HEARTBEAT_INTERVAL_MS = 25_000;
const METRICS_EVENT_TYPES = ['resource_stats', 'storage_resize_complete'];

type ReqHeaders = Record<string, string | string[] | undefined>;

function formatSse(event: string, data: unknown): string {
  const json = typeof data === 'string' ? data : JSON.stringify(data);
  return `event: ${event}\ndata: ${json.replace(/\n/g, '\\n')}\n\n`;
}

function formatSseComment(comment: string): string {
  return `: ${comment}\n\n`;
}

// Module-level subscriber registry
interface Subscriber {
  unsubscribe: () => void;
  heartbeatTimer: ReturnType<typeof setInterval>;
}

const activeSubscribers = new Map<string, Subscriber>();

function cleanupSubscriber(id: string) {
  const sub = activeSubscribers.get(id);
  if (!sub) return;
  clearInterval(sub.heartbeatTimer);
  sub.unsubscribe();
  activeSubscribers.delete(id);
}

export function metricsStreamRoutes(app: FastifyInstance, wsGateway: WebSocketGateway) {
  // ── GET /api/servers/:serverId/metrics/stream ────────────────────────────────
  //
  // Long-lived SSE stream delivering resource_stats events for one server.
  // Authenticated via session cookie. Subscribes to the global SSE list
  // (addGlobalSseSubscriber) so it receives all resource_stats via routeToClients.

  app.get<{ Params: { serverId: string } }>(
    '/:serverId/metrics/stream',
    {
      config: { rateLimit: false },
    },
    async (request, reply) => {
      const { serverId } = request.params;

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

      // Verify access to this server
      const server = await prisma.server.findUnique({
        where: { id: serverId },
        include: { access: { select: { userId: true } } },
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

      // SSE headers — prevent proxy buffering
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': request.headers.origin || '*',
        'Access-Control-Allow-Credentials': 'true',
      });

      reply.raw.write(formatSseComment('connected'));
      reply.raw.write(formatSse('connected', {
        serverId,
        timestamp: new Date().toISOString(),
      }));

      const push = (eventType: string, data: unknown) => {
        try {
          reply.raw.write(formatSse(eventType, data));
        } catch {
          // Connection closed
        }
      };

      // Push cached latest metric immediately so the client doesn't wait for the next agent tick
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
            diskTotalMb: server.allocatedDiskMb ?? 0,
            timestamp: latest.timestamp.getTime(),
          });
        }
      }

      // Ask the agent to send fresh stats immediately (don't wait for the 30s tick)
      if (server.nodeId) {
        wsGateway.sendToAgent(server.nodeId, {
          type: 'request_immediate_stats',
          serverId,
        }).catch(() => {});
      }

      // Subscribe to resource_stats for this server via the gateway's global list
      // Filter by serverId so we only receive metrics for this specific server
      const unsubscribe = wsGateway.addGlobalSseSubscriber(METRICS_EVENT_TYPES, push, [serverId]);

      const heartbeatTimer = setInterval(() => {
        try {
          reply.raw.write(formatSseComment('heartbeat'));
        } catch {
          clearInterval(heartbeatTimer);
        }
      }, HEARTBEAT_INTERVAL_MS);

      const subscriberId = `${serverId}-metrics-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      activeSubscribers.set(subscriberId, { unsubscribe, heartbeatTimer });

      request.raw.on('close', () => {
        cleanupSubscriber(subscriberId);
      });
    },
  );
}
