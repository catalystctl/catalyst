/**
 * SSE-based backup completion hook.
 *
 * Listens for backup_* and eula_required events via SSE for a specific server.
 * Automatically refetches backup queries when completions arrive.
 */
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createServerEventsStream, type ServerEventType } from '../services/api/server-events';

export function useSseBackups(serverId?: string) {
  const queryClient = useQueryClient();
  const [eula, setEula] = useState<{ text: string; serverUuid?: string } | null>(null);

  useEffect(() => {
    if (!serverId) return;

    const disconnect = createServerEventsStream(
      serverId,
      (type: ServerEventType, data: Record<string, unknown>) => {
        const sid = String(data.serverId ?? serverId);
        if (sid !== serverId) return;

        const q = queryClient as any;

        if (
          type === 'backup_complete' ||
          type === 'backup_restore_complete' ||
          type === 'backup_delete_complete'
        ) {
          // Invalidate backup queries to trigger refetch
          q.invalidateQueries({
            predicate: (query: any) =>
              Array.isArray(query.queryKey) &&
              query.queryKey[0] === 'backups' &&
              query.queryKey[1] === sid,
          });
          // Secondary refetch after 1.5s for remote storage metadata
          if (type === 'backup_complete') {
            setTimeout(() => {
              q.invalidateQueries({
                predicate: (query: any) =>
                  Array.isArray(query.queryKey) &&
                  query.queryKey[0] === 'backups' &&
                  query.queryKey[1] === sid,
              });
            }, 1500);
          }
        }

        if (type === 'eula_required') {
          setEula({
            text: String(data.eulaText ?? ''),
            serverUuid: data.serverUuid ? String(data.serverUuid) : undefined,
          });
        }
      },
      () => {},
    );

    return disconnect;
  }, [serverId, queryClient]);

  return { eula, clearEula: () => setEula(null) };
}
