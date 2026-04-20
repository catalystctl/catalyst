/**
 * SSE service for admin entity events.
 *
 * Connects to /api/admin/events and receives real-time create/update/delete
 * events for users, templates, alerts, servers, and nodes.
 *
 * This is a separate stream from the server-scoped SSE (which is for server state updates).
 * Admin events are broadcast to all admin SSE subscribers globally.
 */
export type AdminEventType =
  | 'user_created'
  | 'user_deleted'
  | 'user_updated'
  | 'server_created'
  | 'server_deleted'
  | 'node_created'
  | 'node_deleted'
  | 'template_created'
  | 'template_deleted'
  | 'template_updated'
  | 'alert_rule_created'
  | 'alert_rule_deleted'
  | 'alert_rule_updated'
  | 'role_created'
  | 'role_deleted'
  | 'role_updated'
  | 'alert_created'
  | 'alert_resolved'
  | 'alert_deleted'
  | 'server_updated'
  | 'server_suspended'
  | 'server_unsuspended'
  | 'node_updated'
  | 'api_key_created'
  | 'api_key_updated'
  | 'api_key_deleted'
  | 'location_created'
  | 'location_updated'
  | 'location_deleted'
  | 'nest_created'
  | 'nest_updated'
  | 'nest_deleted'
  | 'database_host_created'
  | 'database_host_updated'
  | 'database_host_deleted'
  | 'ip_pool_created'
  | 'ip_pool_updated'
  | 'ip_pool_deleted';

const ADMIN_EVENT_TYPES: AdminEventType[] = [
  'user_created',
  'user_deleted',
  'user_updated',
  'server_created',
  'server_deleted',
  'node_created',
  'node_deleted',
  'template_created',
  'template_deleted',
  'template_updated',
  'alert_rule_created',
  'alert_rule_deleted',
  'alert_rule_updated',
  'role_created',
  'role_deleted',
  'role_updated',
  'alert_created',
  'alert_resolved',
  'alert_deleted',
  'server_updated',
  'server_suspended',
  'server_unsuspended',
  'node_updated',
  'api_key_created',
  'api_key_updated',
  'api_key_deleted',
  'location_created',
  'location_updated',
  'location_deleted',
  'nest_created',
  'nest_updated',
  'nest_deleted',
  'database_host_created',
  'database_host_updated',
  'database_host_deleted',
  'ip_pool_created',
  'ip_pool_updated',
  'ip_pool_deleted',
];

type AdminEventHandler = (type: AdminEventType, data: Record<string, unknown>) => void;

/**
 * Creates an SSE connection to /api/admin/events.
 * Returns a disconnect function. Multiple calls can coexist (one per admin page).
 *
 * @param onEvent - Called for each matching event
 * @param onStatus - Called on connection status changes
 */
export function createAdminEventsStream(
  onEvent: AdminEventHandler,
  onStatus: (status: 'connecting' | 'connected' | 'reconnecting' | 'closed' | 'error') => void,
): () => void {
  const url = '/api/admin/events';
  const es = new EventSource(url, { withCredentials: true });;

  es.onopen = () => onStatus('connected');
  es.onerror = () => {
    if (es.readyState === EventSource.CONNECTING) onStatus('reconnecting');
    else if (es.readyState === EventSource.CLOSED) onStatus('closed');
    else onStatus('error');
  };

  for (const type of ADMIN_EVENT_TYPES) {
    es.addEventListener(type, (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as Record<string, unknown>;
        onEvent(type, data);
      } catch {
        // ignore parse errors
      }
    });
  }

  return () => {
    es.close();
    onStatus('closed');
  };
}
