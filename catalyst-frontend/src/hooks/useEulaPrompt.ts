/**
 * EULA prompt hook (accept / decline modal).
 *
 * The one-shot `eula_required` event is captured by the AppLayout-mounted
 * global stream (`useServerStateUpdates`) into `useEulaStore`; this hook
 * consumes that store instead of opening its own per-server stream, so the
 * prompt no longer depends on this component being mounted at the exact
 * moment the agent emits (audit P1.9 / F12 / U5).
 *
 * Exported API is unchanged: { eulaPrompt, isLoading, respond, dismiss }.
 */
import { useCallback, useEffect, useState } from 'react';
import { serversApi } from '../services/api/servers';
import { notifyError } from '../utils/notify';
import { consumePendingEula, usePendingEula } from './useEulaStore';

type EulaPrompt = {
  serverId: string;
  eulaText: string;
};

export function useEulaPrompt(serverId?: string) {
  const pending = usePendingEula(serverId);
  const [eulaPrompt, setEulaPrompt] = useState<EulaPrompt | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // One-shot: move the stored prompt into component state and clear the
  // store so a re-render / remount does not reopen the modal by itself.
  useEffect(() => {
    if (!pending) return;
    setEulaPrompt({
      serverId: pending.serverId,
      eulaText: pending.message ?? '',
    });
    consumePendingEula(pending.serverId);
  }, [pending]);

  const respond = useCallback(
    async (accepted: boolean) => {
      if (!eulaPrompt) return;
      setIsLoading(true);
      try {
        await serversApi.respondEula(eulaPrompt.serverId, accepted);
        setEulaPrompt(null);
        if (accepted) {
          try {
            await serversApi.start(eulaPrompt.serverId);
          } catch (startErr) {
            notifyError(startErr);
          }
        }
      } catch (err) {
        // Keep the modal open so the user can retry
        notifyError(err);
      } finally {
        setIsLoading(false);
      }
    },
    [eulaPrompt],
  );

  const dismiss = useCallback(() => {
    setEulaPrompt(null);
  }, []);

  return { eulaPrompt, isLoading, respond, dismiss };
}
