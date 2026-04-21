/**
 * SSE-based backup hook.
 *
 * Loads backups via REST API (TanStack Query).
 * Listens for backup_complete / backup_restore_complete / backup_delete_complete
 * via SSE to trigger query invalidation without polling.
 */
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { backupsApi } from '../services/api/backups';
import { createServerEventsStream, type ServerEventType } from '../services/api/server-events';

export function useBackups(serverId?: string, options?: { page?: number; limit?: number }) {
  const queryClient = useQueryClient();
  const { page = 1, limit = 10 } = options ?? {};

  // SSE listener — invalidates backup queries when completions arrive
  useEffect(() => {
    if (!serverId) return;

    const disconnect = createServerEventsStream(
      serverId,
      (type: ServerEventType, data: Record<string, unknown>) => {
        if (String(data.serverId) !== serverId) return;
        if (
          type !== 'backup_complete' &&
          type !== 'backup_restore_complete' &&
          type !== 'backup_delete_complete'
        ) return;

        queryClient.invalidateQueries({
          predicate: (query) =>
            Array.isArray(query.queryKey) &&
            query.queryKey[0] === 'backups' &&
            query.queryKey[1] === serverId,
        });

        // Follow-up fetch to pick up updated size/metadata after remote upload
        if (type === 'backup_complete') {
          setTimeout(() => {
            queryClient.invalidateQueries({
              predicate: (query) =>
                Array.isArray(query.queryKey) &&
                query.queryKey[0] === 'backups' &&
                query.queryKey[1] === serverId,
            });
          }, 1500);
        }
      },
      () => {},
    );

    return disconnect;
  }, [serverId, queryClient]);

  return useQuery({
    queryKey: ['backups', serverId, { page, limit }],
    queryFn: () => backupsApi.list(serverId!, { page, limit }),
    enabled: Boolean(serverId),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      const backups = data.backups ?? data;
      if (Array.isArray(backups) && backups.some((b: any) => b.status === 'in_progress' || b.status === 'processing')) {
        return 5000;
      }
      return false;
    },
  });
}
