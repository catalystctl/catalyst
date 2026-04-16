/**
 * Global SSE stream for admin entity events.
 *
 * Broadcasts create/delete/update events for users, nodes, servers, templates,
 * and alerts to all connected admin clients in real-time.
 *
 * All events are pushed via wsGateway.pushToGlobalSubscribers().
 * Event types:
 *   user_created, user_deleted, user_updated
 *   server_created, server_deleted
 *   node_created, node_deleted
 *   template_created, template_deleted, template_updated
 *   alert_created, alert_resolved, alert_deleted
 */
import type { FastifyInstance } from 'fastify';
import type { WebSocketGateway } from '../websocket/gateway';
import { auth } from '../auth.js';
import { fromNodeHeaders } from 'better-auth/node';

const HEARTBEAT_INTERVAL_MS = 25_000;
const ADMIN_EVENT_TYPES = [
  'user_created', 'user_deleted', 'user_updated',
  'server_created', 'server_deleted',
  'node_created', 'node_deleted',
  'template_created', 'template_deleted', 'template_updated',
  'alert_created', 'alert_resolved', 'alert_deleted',
];

type ReqHeaders = Record<string, string | string[] | undefined>;

function formatSse(event: string, data: unknown): string {
  const json = typeof data === 'string' ? data : JSON.stringify(data);
  return `event: ${event}\ndata: ${json.replace(/\n/g, '\\n')}\n\n`;
}

function formatSseComment(comment: string): string {
  return `: ${comment}\n\n`;
}

interface AdminSubscriber {
  unsubscribe: () => void;
  heartbeatTimer: ReturnType<typeof setInterval>;
}

const activeSubscribers = new Map<string, AdminSubscriber>();

function cleanupSubscriber(id: string) {
  const sub = activeSubscribers.get(id);
  if (!sub) return;
  clearInterval(sub.heartbeatTimer);
  sub.unsubscribe();
  activeSubscribers.delete(id);
}

export function adminEventsRoutes(app: FastifyInstance, wsGateway: WebSocketGateway) {
  // ── GET /api/admin/events ────────────────────────────────────────────────────
  //
  // Long-lived SSE stream for admin-level entity events.
  // Requires admin authentication (any admin permission).
  // Pushes to globalSseSubscribers with event types matching ADMIN_EVENT_TYPES.

  app.get(
    '/',
    { config: { rateLimit: false } },
    async (request, reply) => {
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

      // SSE headers
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
        userId,
        timestamp: new Date().toISOString(),
      }));

      const push = (eventType: string, data: unknown) => {
        try {
          reply.raw.write(formatSse(eventType, data));
        } catch {
          // Connection closed
        }
      };

      // Subscribe to all admin event types
      const unsubscribe = wsGateway.addAdminEventSubscriber(ADMIN_EVENT_TYPES, push);

      const heartbeatTimer = setInterval(() => {
        try {
          reply.raw.write(formatSseComment('heartbeat'));
        } catch {
          clearInterval(heartbeatTimer);
        }
      }, HEARTBEAT_INTERVAL_MS);

      const subscriberId = `admin-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      activeSubscribers.set(subscriberId, { unsubscribe, heartbeatTimer });

      request.raw.on('close', () => {
        cleanupSubscriber(subscriberId);
      });
    },
  );
}
