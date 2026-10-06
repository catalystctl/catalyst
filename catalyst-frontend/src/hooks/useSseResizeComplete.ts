/**
 * SSE-based storage resize completion hook.
 *
 * Listens for `storage_resize_complete` events via SSE and triggers
 * Catalyst Sync invalidation + toast notification.
 */
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@/csync';
import { createServerEventsStream, type ServerEventType } from '../services/api/server-events';
import { qk } from '../lib/queryKeys';
import { notifyError, notifySuccess } from '../utils/notify';
import i18n from '@/i18n';

type ResizeResult = { success: boolean; error?: string };

export function useSseResizeComplete(
  serverId: string,
  onComplete: (result: ResizeResult) => void,
) {
  const queryClient = useQueryClient();
  // P1-23: callers pass an inline closure, so keeping onComplete in the deps
  // tore the subscription down on every keystroke. Read it through a ref.
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

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
          notifySuccess(i18n.t('storageResize.succeeded', { ns: 'common' }));
        } else {
          notifyError(result.error || i18n.t('storageResize.failed', { ns: 'common' }));
        }

        Promise.all([
          queryClient.invalidateQueries({ queryKey: qk.server(serverId) }),
          queryClient.invalidateQueries({ queryKey: qk.servers() }),
          queryClient.invalidateQueries({ queryKey: qk.dashboardResources() }),
          queryClient.invalidateQueries({ queryKey: qk.dashboardStats() }),
        ]);

        onCompleteRef.current(result);
      },
      () => {},
    );

    return disconnect;
  }, [serverId, queryClient]);
}
