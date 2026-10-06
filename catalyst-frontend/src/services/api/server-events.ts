/**
 * SSE (Server-Sent Events) service for server → client real-time events.
 *
 * Uses a ref-counted shared EventSource per URL (see sse-hub.ts) so multiple
 * hooks on the same server (metrics, backups, eula, resize, global layout)
 * share one connection instead of opening N sockets.
 *
 * Handles:
 *   - server_state_update — status changes
 *   - backup_complete / backup_restore_complete / backup_delete_complete
 *   - eula_required
 *   - alert
 *   - task_progress / task_complete
 *   - resource_stats — real-time CPU, memory, disk metrics
 *   - server_operation_progress — install/transfer/clone % + stage
 *   - task_/database_/backup_ CRUD, permissions_updated, resync
 *
 * Dead-alias note: `server_state` (legacy name for `server_state_update`) was
 * pruned here and on the backend allowlist (audit §6.2 / P1.4) — neither side
 * ever emitted it. `console_output` remains an FE-only entry because that
 * payload belongs to the dedicated console stream, not this one.
 */
import { subscribeSharedEventSource, type StreamStatus } from './sse-hub';

export type ServerEventType =
  | 'server_state_update'
  | 'backup_complete'
  | 'backup_restore_complete'
  | 'backup_delete_complete'
  | 'backup_started'
  | 'backup_restore_started'
  | 'backup_delete_started'
  | 'eula_required'
  | 'alert'
  // Dead entry on THIS stream: console_output is only ever delivered on the
  // dedicated console stream (/api/servers/:id/console), never on /events.
  // Kept so the console fallback path can reuse this type union; exempted in
  // csync/__tests__/sse-event-contract.test.ts from the FE⊆BE check.
  | 'console_output'
  | 'task_progress'
  | 'task_complete'
  | 'resource_stats'
  | 'storage_resize_complete'
  | 'server_deleted'
  | 'server_created'
  | 'server_updated'
  | 'server_suspended'
  | 'server_unsuspended'
  | 'server_files_changed'
  // A failed clone (routes/servers/core.ts) — without it an SSE-only client
  // shows the clone as still cloning forever.
  | 'clone_failed'
  // Mod manager events
  | 'mod_install_complete'
  | 'mod_uninstall_complete'
  | 'mod_update_complete'
  // Plugin manager events
  | 'plugin_install_complete'
  | 'plugin_uninstall_complete'
  | 'plugin_update_complete'
  | 'server_operation_progress'
  // Task/database CRUD (payloads: {type, taskId?, serverId, timestamp} /
  // {type, serverId, databaseId?, timestamp})
  | 'task_created'
  | 'task_updated'
  | 'task_deleted'
  | 'database_created'
  | 'database_deleted'
  | 'database_password_rotated'
  // Backup list changes outside the start/complete lifecycle
  // ({type, serverId, backupId, timestamp})
  | 'backup_updated'
  | 'backup_deleted'
  // User-scoped: {type, userId, timestamp}
  | 'permissions_updated'
  // Server-agnostic cache resync request: {type, reason?, timestamp}
  | 'resync';

export type { StreamStatus };

export type ServerEventHandler = (type: ServerEventType, data: Record<string, unknown>) => void;

export const SERVER_EVENT_TYPES: ServerEventType[] = [
  'server_state_update',
  'backup_complete',
  'backup_restore_complete',
  'backup_delete_complete',
  'backup_started',
  'backup_restore_started',
  'backup_delete_started',
  'eula_required',
  'alert',
  'console_output',
  'task_progress',
  'task_complete',
  'resource_stats',
  'storage_resize_complete',
  'server_deleted',
  'server_created',
  'server_updated',
  'server_suspended',
  'server_unsuspended',
  'server_files_changed',
  'clone_failed',
  'mod_install_complete',
  'mod_uninstall_complete',
  'mod_update_complete',
  'plugin_install_complete',
  'plugin_uninstall_complete',
  'plugin_update_complete',
  'server_operation_progress',
  'task_created',
  'task_updated',
  'task_deleted',
  'database_created',
  'database_deleted',
  'database_password_rotated',
  'backup_updated',
  'backup_deleted',
  'permissions_updated',
  'resync',
];

/**
 * Subscribe to server events (shared EventSource per serverId).
 *
 * @param serverId - server id or `all-servers` for the global AppLayout stream
 * @param onEvent - called for each matching event
 * @param onStatus - connection status changes
 * @param options.eventTypes - optional subset (e.g. metrics-only stream still uses full types filter client-side)
 * @returns disconnect / unsubscribe
 */
export function createServerEventsStream(
  serverId: string,
  onEvent: ServerEventHandler,
  onStatus: (status: StreamStatus) => void,
  options?: { eventTypes?: readonly ServerEventType[]; url?: string },
): () => void {
  const url =
    options?.url ??
    `/api/servers/${encodeURIComponent(serverId)}/events`;
  const types = options?.eventTypes ?? SERVER_EVENT_TYPES;

  return subscribeSharedEventSource(
    url,
    types,
    (type, data) => {
      onEvent(type as ServerEventType, data);
    },
    onStatus,
  );
}

/**
 * Dedicated lean metrics stream (CPU/memory/disk) — prefers /metrics/stream.
 */
export function createServerMetricsStream(
  serverId: string,
  onEvent: ServerEventHandler,
  onStatus: (status: StreamStatus) => void,
): () => void {
  return createServerEventsStream(serverId, onEvent, onStatus, {
    url: `/api/servers/${encodeURIComponent(serverId)}/metrics/stream`,
    eventTypes: ['resource_stats', 'storage_resize_complete'],
  });
}
