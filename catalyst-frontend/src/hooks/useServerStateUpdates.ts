/**
 * SSE-based real-time server state update hook.
 *
 * Connects to /api/servers/all-servers/events (global endpoint) and updates
 * TanStack Query caches when server state changes.
 *
 * Use this in AppLayout to handle state updates for all servers globally.
 */
import { useEffect } from 'react';
import { useQueryClient, type Query } from '@tanstack/react-query';
import { createServerEventsStream, type ServerEventType } from '../services/api/server-events';

export function useServerStateUpdates() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const disconnect = createServerEventsStream(
      'all-servers',
      (type: ServerEventType, data: Record<string, unknown>) => {
        const q = queryClient as any;
        const serverId = String(data.serverId ?? '');
        if (!serverId) return;

        if (type === 'server_state_update' || type === 'server_state') {
          const nextState = String(data.state ?? '');
          const matchesId = (srv: any) =>
            srv?.id === serverId || srv?.uuid === serverId;

          q.setQueriesData(
            { predicate: (query: Query) =>
              Array.isArray(query.queryKey) && query.queryKey[0] === 'server' },
            (prev: any) => {
              if (!prev || typeof prev !== 'object') return prev;
              if (!matchesId(prev)) return prev;
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

          q.setQueriesData(
            { predicate: (query: Query) =>
              Array.isArray(query.queryKey) && query.queryKey[0] === 'servers' },
            (prev: any) => {
              if (!Array.isArray(prev)) return prev;
              return prev.map((srv: any) =>
                matchesId(srv) ? { ...srv, status: nextState } : srv,
              );
            },
          );

          q.invalidateQueries({
            predicate: (query: any) =>
              Array.isArray(query.queryKey) &&
              query.queryKey[0] === 'server' &&
              query.state?.data &&
              matchesId(query.state.data),
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
              query.queryKey[1] === serverId,
          });
        }
      },
      () => {},
    );

    return disconnect;
  }, [queryClient]);
}
