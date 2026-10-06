import { subscribeSharedEventSource, type StreamStatus } from './sse-hub';

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
  | 'ip_pool_deleted'
  | 'security_settings_updated'
  | 'smtp_settings_updated'
  | 'theme_settings_updated'
  | 'system_settings_updated'
  | 'oidc_settings_updated'
  | 'plugin_updated'
  | 'audit_log_created'
  | 'auth_lockout_created'
  | 'auth_lockout_cleared'
  | 'system_error'
  | 'task_created'
  | 'task_updated'
  | 'task_deleted'
  | 'database_created'
  | 'database_deleted'
  | 'database_password_rotated'
  | 'node_assigned'
  | 'node_unassigned'
  | 'wildcard_assigned'
  | 'wildcard_removed'
  // Mod manager events (admin-scoped)
  | 'mod_install_complete'
  | 'mod_uninstall_complete'
  | 'mod_update_complete'
  // Plugin manager events (admin-scoped)
  | 'plugin_install_complete'
  | 'plugin_uninstall_complete'
  | 'plugin_update_complete'
  | 'migration_job_updated'
  | 'migration_step_updated'
  | 'agent_update_started'
  | 'agent_update_failed'
  | 'agent_update_progress'
  | 'node_metrics_updated'
  // Wave-2 additions — must stay in lockstep with the backend allowlist in
  // catalyst-backend/src/routes/admin-events.ts (parity is contract-tested).
  | 'env_settings_updated'
  | 'mcp_settings_updated'
  | 'templates_batch_imported'
  | 'node_flapping'
  | 'network_created'
  | 'network_updated'
  | 'network_deleted'
  | 'system_error_resolved'
  // Wave-3 additions (contract: payloads below) — keep in lockstep with the
  // backend allowlist in catalyst-backend/src/routes/admin-events.ts.
  // {type, nodeId, allocationIds?, timestamp}
  | 'allocation_created'
  | 'allocation_updated'
  | 'allocation_deleted'
  // {type, alertId, deliveryId?, status?, timestamp}
  | 'alert_delivery_updated'
  // {type, currentVersion?, latestVersion?, timestamp}
  | 'panel_update_available'
  // {type, state, progress?, message?, timestamp}
  | 'panel_update_state'
  // {type, nodeId, count, timestamp}
  | 'discovered_servers_updated';

export const ADMIN_EVENT_TYPES: AdminEventType[] = [
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
  'security_settings_updated',
  'smtp_settings_updated',
  'theme_settings_updated',
  'system_settings_updated',
  'oidc_settings_updated',
  'plugin_updated',
  'audit_log_created',
  'auth_lockout_created',
  'auth_lockout_cleared',
  'system_error',
  'task_created',
  'task_updated',
  'task_deleted',
  'database_created',
  'database_deleted',
  'database_password_rotated',
  'node_assigned',
  'node_unassigned',
  'wildcard_assigned',
  'wildcard_removed',
  // Mod manager events (admin-scoped)
  'mod_install_complete',
  'mod_uninstall_complete',
  'mod_update_complete',
  // Plugin manager events (admin-scoped)
  'plugin_install_complete',
  'plugin_uninstall_complete',
  'plugin_update_complete',
  'migration_job_updated',
  'migration_step_updated',
  'agent_update_started',
  'agent_update_failed',
  'agent_update_progress',
  'node_metrics_updated',
  // Wave-2 additions (parity with routes/admin-events.ts):
  // settings pages that already emit but were dropped by this allowlist,
  // node/network lifecycle from the agent gateway, batch template import and
  // system-error resolution.
  'env_settings_updated',
  'mcp_settings_updated',
  'templates_batch_imported',
  'node_flapping',
  'network_created',
  'network_updated',
  'network_deleted',
  'system_error_resolved',
  // Wave-3 additions (parity with routes/admin-events.ts): node allocation
  // lifecycle, alert delivery status, panel update progress and agent
  // container discovery.
  'allocation_created',
  'allocation_updated',
  'allocation_deleted',
  'alert_delivery_updated',
  'panel_update_available',
  'panel_update_state',
  'discovered_servers_updated',
];

export type AdminEventHandler = (type: AdminEventType, data: Record<string, unknown>) => void;

export type { StreamStatus };

/**
 * Client-side mirror of the admin stream's server-side gate
 * (`routes/admin-events.ts:105` → `hasPermission(..., 'admin.read')`).
 *
 * The wider `hasAnyAdminPermission` (ProtectedRoute) lets e.g. `apikey.manage`
 * or `template.read` users open `/api/admin/events` and get a 403, which
 * poisons the shared EventSource entry for the whole tab. Only a user holding
 * literal `admin.read` (wildcard `*`, unscoped `admin.read`/`admin.write`, or
 * a wildcard-scoped `admin.read:*`) may subscribe; resource-scoped admin bits
 * do not count, exactly like the backend.
 */
export function hasAdminReadPermission(permissions?: string[]): boolean {
  if (!permissions || permissions.length === 0) return false;
  return permissions.some((granted) => {
    const colon = granted.indexOf(':');
    const perm = colon === -1 ? granted : granted.slice(0, colon);
    const scope = colon === -1 ? '' : granted.slice(colon + 1);
    if (perm === '*') return true;
    if (scope !== '' && scope !== '*') return false;
    return perm === 'admin.read' || perm === 'admin.write';
  });
}

/**
 * Subscribe to /api/admin/events via the shared EventSource hub.
 * Multiple callers (AppLayout + pages) share one socket.
 */
export function createAdminEventsStream(
  onEvent: AdminEventHandler,
  onStatus: (status: StreamStatus) => void,
): () => void {
  return subscribeSharedEventSource(
    '/api/admin/events',
    ADMIN_EVENT_TYPES,
    (type, data) => onEvent(type as AdminEventType, data),
    onStatus,
  );
}
