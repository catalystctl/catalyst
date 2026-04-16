/**
 * SSE-based storage resize completion hook.
 *
 * Listens for `storage_resize_complete` events via SSE and triggers
 * TanStack Query invalidation + toast notification.
 */
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createServerEventsStream, type ServerEventType } from '../services/api/server-events';
import { notifyError, notifySuccess } from '../utils/notify';

type ResizeResult = { success: boolean; error?: string };

export function useSseResizeComplete(
  serverId: string,
  onComplete: (result: ResizeResult) => void,
) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const disconnect = createServerEventsStream(
      serverId,
      (type: ServerEventType, data: Record<string, unknown>) => {
        if (type !== 'storage_resize_complete' || String(data.serverId) !== serverId) return;

        const result: ResizeResult = {
          success: Boolean(data.success),
          error: data.error ? String(data.error) : undefined,
        };

        if (result.success) {
          notifySuccess('Storage resized');
        } else {
          notifyError(result.error || 'Storage resize failed');
        }

        queryClient.invalidateQueries({ queryKey: ['server', serverId] });
        queryClient.invalidateQueries({ queryKey: ['servers'] });

        onComplete(result);
      },
      () => {},
    );

    return disconnect;
  }, [serverId, queryClient, onComplete]);
}
