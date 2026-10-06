/**
 * Global SSE stream for admin entity events.
 *
 * Broadcasts create/delete/update events for users, nodes, servers, templates,
 * and alerts to all connected admin clients in real-time.
 *
 * Subscribers are registered on the gateway admin registry via
 * wsGateway.addAdminEventSubscriber() and pushed by pushToAdminSubscribers().
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
import { prisma } from '../db.js';
import { hasPermission } from '../lib/permissions.js';
import { apiError } from '../lib/http-error';
import { ErrorCodes } from '../shared-types';
import { openSseStream } from '../utils/sse.js';

const HEARTBEAT_INTERVAL_MS = 25_000;
// Cap the admin stream like the per-server (100) and console (50) streams.
// Checked before openSseStream so a full stream still returns JSON 503.
// Per-worker: each cluster worker enforces its own registry cap.
export const MAX_ADMIN_SSE_SUBSCRIBERS = 150;
export const ADMIN_EVENT_TYPES = [
  'user_created', 'user_deleted', 'user_updated',
  'server_created', 'server_deleted', 'server_updated',
  'server_suspended', 'server_unsuspended',
  'node_created', 'node_deleted', 'node_updated',
  'template_created', 'template_deleted', 'template_updated',
  'alert_created', 'alert_resolved', 'alert_deleted',
  'alert_rule_created', 'alert_rule_deleted', 'alert_rule_updated',
  'role_created', 'role_deleted', 'role_updated',
  'api_key_created', 'api_key_updated', 'api_key_deleted',
  'location_created', 'location_updated', 'location_deleted',
  'nest_created', 'nest_updated', 'nest_deleted',
  'database_host_created', 'database_host_updated', 'database_host_deleted',
  'ip_pool_created', 'ip_pool_updated', 'ip_pool_deleted',
  'security_settings_updated', 'smtp_settings_updated', 'theme_settings_updated',
  'system_settings_updated', 'oidc_settings_updated', 'plugin_updated',
  'audit_log_created', 'auth_lockout_created', 'auth_lockout_cleared',
  'system_error', 'system_error_resolved',
  // Task CRUD events
  'task_created', 'task_updated', 'task_deleted',
  // Database events
  'database_created', 'database_deleted', 'database_password_rotated',
  // Node assignment events
  'node_assigned', 'node_unassigned', 'wildcard_assigned', 'wildcard_removed',
  // Mod manager events (admin-scoped)
  'mod_install_complete', 'mod_uninstall_complete', 'mod_update_complete',
  // Plugin manager events (admin-scoped)
  'plugin_install_complete', 'plugin_uninstall_complete', 'plugin_update_complete',
  // Migration progress (Pterodactyl → Catalyst)
  'migration_job_updated', 'migration_step_updated',
  // Agent control panel
  'agent_update_started', 'agent_update_failed', 'agent_update_progress',
  // Node live metrics (from agent health_report)
  'node_metrics_updated',
  // P0.2: events already pushed to the admin stream but missing from this
  // allowlist (dropped at the gateway filter before this change).
  'env_settings_updated', 'mcp_settings_updated', 'node_flapping',
  'templates_batch_imported',
  // Server network CRUD (emitted from the gateway network fan-out)
  'network_created', 'network_updated', 'network_deleted',
  // Node allocation CRUD (emitted from routes/nodes.ts)
  'allocation_created', 'allocation_updated', 'allocation_deleted',
  // Alert webhook/email delivery state (emitted from alert routes)
  'alert_delivery_updated',
  // Panel auto-update lifecycle (emitted from admin update routes)
  'panel_update_available', 'panel_update_state',
  // Discovered unregistered containers per node (emitted from the gateway)
  'discovered_servers_updated',
];

type ReqHeaders = Record<string, string | string[] | undefined>;

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
          return apiError(reply, 401, ErrorCodes.AUTH_EXPIRED, 'Unauthorized');
        }
        userId = session.user.id;
      } catch {
        return apiError(reply, 401, ErrorCodes.AUTH_EXPIRED, 'Unauthorized');
      }

      // Authorize: require admin.read permission
      if (userId && !(await hasPermission(prisma, userId, 'admin.read'))) {
        return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, 'Admin read permission required');
      }

      // Enforce the admin-stream subscriber cap BEFORE openSseStream so the
      // client still gets a JSON error instead of a hijacked dead socket.
      if (wsGateway.getAdminSseSubscriberCount() >= MAX_ADMIN_SSE_SUBSCRIBERS) {
        return apiError(
          reply,
          503,
          ErrorCodes.SSE_SUBSCRIBER_LIMIT_REACHED,
          'Too many event subscribers. Please try again later.',
        );
      }

      // Take ownership of the socket so Fastify does not end the response on return.
      const sse = openSseStream(request, reply);
      sse.comment('connected');
      sse.push('connected', {
        userId,
        timestamp: new Date().toISOString(),
      });

      const push = (eventType: string, data: unknown) => {
        sse.push(eventType, data);
      };

      // Subscribe to all admin event types. userId + close feed the gateway's
      // periodic re-auth sweeper: on admin.read revocation it pushes an error
      // event, destroys the hijacked socket and unsubscribes.
      const { unsubscribe, touch } = wsGateway.addAdminEventSubscriber(ADMIN_EVENT_TYPES, push, {
        userId: userId ?? undefined,
        close: () => {
          try {
            (reply.raw as { destroy?: () => void }).destroy?.();
          } catch { /* socket already gone */ }
        },
      });

      const heartbeatTimer = setInterval(() => {
        try {
          sse.comment('heartbeat');
          // Named-event heartbeat: the FE half-open watchdog (P2.5) needs a
          // real dispatched event, not just an SSE comment.
          sse.push('ping', { t: Date.now() });
          // Keep the gateway subscriber alive while the browser stream lives.
          touch();
        } catch {
          // Socket is dead (destroyed by the write failure) — stop the timer.
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
