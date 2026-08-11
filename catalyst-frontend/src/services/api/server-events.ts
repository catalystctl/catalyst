/**
 * SSE (Server-Sent Events) service for server → client real-time events.
 *
 * Uses a ref-counted shared EventSource per URL (see sse-hub.ts) so multiple
 * hooks on the same server (metrics, backups, eula, resize, global layout)
 * share one connection instead of opening N sockets.
 *
 * Handles:
 *   - server_state_update / server_state — status changes
 *   - backup_complete / backup_restore_complete / backup_delete_complete
 *   - eula_required
 *   - alert
 *   - server_log
 *   - task_progress / task_complete
 *   - resource_stats — real-time CPU, memory, disk metrics
 *   - server_operation_progress — install/transfer/clone % + stage
 */
import { subscribeSharedEventSource, type StreamStatus } from './sse-hub';

export type ServerEventType =
  | 'server_state_update'
  | 'server_state'
  | 'backup_complete'
  | 'backup_restore_complete'
  | 'backup_delete_complete'
  | 'backup_started'
  | 'backup_restore_started'
  | 'backup_delete_started'
  | 'eula_required'
  | 'alert'
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
  // Mod manager events
  | 'mod_install_complete'
  | 'mod_uninstall_complete'
  | 'mod_update_complete'
  // Plugin manager events
  | 'plugin_install_complete'
  | 'plugin_uninstall_complete'
  | 'plugin_update_complete'
  | 'server_operation_progress';

export type { StreamStatus };

export type ServerEventHandler = (type: ServerEventType, data: Record<string, unknown>) => void;

export const SERVER_EVENT_TYPES: ServerEventType[] = [
  'server_state_update',
  'server_state',
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
  'mod_install_complete',
  'mod_uninstall_complete',
  'mod_update_complete',
  'plugin_install_complete',
  'plugin_uninstall_complete',
  'plugin_update_complete',
  'server_operation_progress',
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
