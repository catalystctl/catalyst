/**
 * SSE-based real-time server state update hook.
 *
 * Connects to /api/servers/:serverId/events and handles:
 *   - server_state_update / server_state — live status changes
 *   - backup_* — live backup notifications
 *   - eula_required — EULA prompts
 *
 * EventSource API handles reconnection automatically.
 */
import { useEffect } from 'react';
import { useQueryClient, type Query } from '@tanstack/react-query';
import { createServerEventsStream, type ServerEventType } from '../services/api/server-events';

export function useSseServerEvents(serverId?: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!serverId) return;

    const disconnect = createServerEventsStream(
      serverId,
      (type: ServerEventType, data: Record<string, unknown>) => {
        const q = queryClient as any;
        const sid = String(data.serverId ?? serverId);

        if (type === 'server_state_update' || type === 'server_state') {
          const nextState = String(data.state ?? '');

          const matchesServerId = (srv: any) =>
            srv?.id === sid || srv?.uuid === sid;

          // Update server detail cache
          q.setQueriesData(
            { predicate: (query: Query) =>
              Array.isArray(query.queryKey) && query.queryKey[0] === 'server' },
            (prev: any) => {
              if (!prev || typeof prev !== 'object') return prev;
              if (!matchesServerId(prev)) return prev;
              return {
                ...prev,
                status: nextState,
                portBindings: data.portBindings ?? prev.portBindings,
                lastExitCode:
                  typeof data.exitCode === 'number'
                    ? data.exitCode
                    : prev.lastExitCode,
              };
            },
          );

          // Update server list cache
          q.setQueriesData(
            { predicate: (query: Query) =>
              Array.isArray(query.queryKey) && query.queryKey[0] === 'servers' },
            (prev: any) => {
              if (!Array.isArray(prev)) return prev;
              return prev.map((srv: any) =>
                matchesServerId(srv)
                  ? { ...srv, status: nextState }
                  : srv,
              );
            },
          );

          // Invalidate to fetch fresh data
          q.invalidateQueries({
            predicate: (query: any) =>
              Array.isArray(query.queryKey) &&
              query.queryKey[0] === 'server' &&
              query.state?.data &&
              matchesServerId(query.state.data),
          });
          q.invalidateQueries({
            predicate: (query: any) =>
              Array.isArray(query.queryKey) && query.queryKey[0] === 'servers',
          });
        }

        if (
          type === 'backup_complete' ||
          type === 'backup_restore_complete' ||
          type === 'backup_delete_complete'
        ) {
          q.invalidateQueries({
            predicate: (query: any) =>
              Array.isArray(query.queryKey) &&
              query.queryKey[0] === 'backups' &&
              query.queryKey[1] === sid,
          });
        }
      },
      () => {}, // status changes handled separately if needed
    );

    return disconnect;
  }, [serverId, queryClient]);
}
