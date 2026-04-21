/**
 * SSE (Server-Sent Events) service for server → client real-time events.
 *
 * Uses per-instance EventSource (one per server) rather than a global singleton.
 * Each hook gets its own connection for the server it manages.
 *
 * Handles:
 *   - server_state_update / server_state — status changes
 *   - backup_complete / backup_restore_complete / backup_delete_complete
 *   - eula_required
 *   - alert
 *   - server_log
 *   - task_progress / task_complete
 *   - resource_stats — real-time CPU, memory, disk metrics
 */
export type ServerEventType =
  | 'server_state_update'
  | 'server_state'
  | 'backup_complete'
  | 'backup_restore_complete'
  | 'backup_delete_complete'
  | 'eula_required'
  | 'alert'
  | 'console_output'
  | 'task_progress'
  | 'task_complete'
  | 'resource_stats'
  | 'storage_resize_complete'
  // Mod manager events
  | 'mod_install_complete'
  | 'mod_uninstall_complete'
  | 'mod_update_complete'
  // Plugin manager events
  | 'plugin_install_complete'
  | 'plugin_uninstall_complete'
  | 'plugin_update_complete';

export type StreamStatus = 'connecting' | 'connected' | 'reconnecting' | 'closed' | 'error';

export type ServerEventHandler = (type: ServerEventType, data: Record<string, unknown>) => void;

const EVENT_TYPES: ServerEventType[] = [
  'server_state_update',
  'server_state',
  'backup_complete',
  'backup_restore_complete',
  'backup_delete_complete',
  'eula_required',
  'alert',
  'console_output',
  'task_progress',
  'task_complete',
  'resource_stats',
  'storage_resize_complete',
  // Mod manager events
  'mod_install_complete',
  'mod_uninstall_complete',
  'mod_update_complete',
  // Plugin manager events
  'plugin_install_complete',
  'plugin_uninstall_complete',
  'plugin_update_complete',
];

/**
 * Creates a new SSE connection for a specific server.
 * Each hook gets its own EventSource instance.
 *
 * @param serverId - The server to stream events for
 * @param onEvent - Called whenever a matching event arrives
 * @param onStatus - Called when connection status changes
 * @returns disconnect function
 */
export function createServerEventsStream(
  serverId: string,
  onEvent: ServerEventHandler,
  onStatus: (status: StreamStatus) => void,
): () => void {
  const url = `/api/servers/${encodeURIComponent(serverId)}/events`;
  const es = new EventSource(url, { withCredentials: true });

  es.onopen = () => onStatus('connected');
  es.onerror = () => {
    if (es.readyState === EventSource.CONNECTING) onStatus('reconnecting');
    else if (es.readyState === EventSource.CLOSED) onStatus('closed');
    else onStatus('error');
  };

  // Listen for all event types
  for (const type of EVENT_TYPES) {
    es.addEventListener(type, (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as Record<string, unknown>;
        onEvent(type, data);
      } catch {
        // ignore parse errors
      }
    });
  }

  // Heartbeat / reconnection handled by EventSource natively
  return () => {
    es.close();
    onStatus('closed');
  };
}
