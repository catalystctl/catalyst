/**
 * Plugin host realtime helpers — subscribe to panel SSE/WS without each plugin
 * opening its own sockets.
 */
import { createServerEventsStream, type ServerEventType } from '../services/api/server-events';
import { createAdminEventsStream, type AdminEventType } from '../services/api/admin-events';
import { usePluginWebSocket } from './usePluginWebSocket';

export type PluginRealtimeScope = 'server' | 'admin' | 'plugin-ws';

/** Imperative subscribe to shared server events (uses SSE hub). */
export function subscribeServerRealtime(
  serverId: string,
  handler: (type: ServerEventType, data: Record<string, unknown>) => void,
): () => void {
  return createServerEventsStream(serverId, handler, () => {});
}

/** Imperative subscribe to shared admin events (uses SSE hub). */
export function subscribeAdminRealtime(
  handler: (type: AdminEventType, data: Record<string, unknown>) => void,
): () => void {
  return createAdminEventsStream(handler, () => {});
}

export { usePluginWebSocket };
