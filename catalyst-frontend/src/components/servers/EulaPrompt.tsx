/**
 * Global EULA prompt (audit D10 / P1.9).
 *
 * `eula_required` is a one-shot agent event that any start path can produce —
 * the detail page, the fleet list, a node page, a scheduled task. The prompt
 * used to be mounted only inside ServerDetailsPage, so a start anywhere else
 * left the server waiting silently.
 *
 * This component is mounted once by the layout shell, reads the global
 * `useEulaStore`, and answers through the same API the old inline prompt used.
 * Dismissing it (Esc / overlay / close) is NEUTRAL: the store entry is dropped
 * and the server keeps waiting for an answer, because closing a dialog is not a
 * decline. Only the explicit Decline button posts `accepted: false`.
 *
 * No props: it decides for itself which pending prompt to show.
 */
import { useCallback, useState } from 'react';
import EulaModal from './EulaModal';
import { serversApi } from '../../services/api/servers';
import { notifyError } from '../../utils/notify';
import { consumePendingEula, useAnyPendingEula } from '../../hooks/useEulaStore';

export default function EulaPrompt() {
  const pending = useAnyPendingEula();
  const [isLoading, setIsLoading] = useState(false);

  const respond = useCallback(
    async (accepted: boolean) => {
      if (!pending) return;
      setIsLoading(true);
      try {
        await serversApi.respondEula(pending.serverId, accepted);
        consumePendingEula(pending.serverId);
        if (accepted) {
          try {
            await serversApi.start(pending.serverId);
          } catch (startErr) {
            notifyError(startErr);
          }
        }
      } catch (err) {
        // Keep the prompt open so the answer can be retried.
        notifyError(err);
      } finally {
        setIsLoading(false);
      }
    },
    [pending],
  );

  // Neutral: drop the pending entry, decide nothing. The next start of that
  // server raises a fresh prompt, which is why no "dismissed" flag is kept.
  const dismiss = useCallback(() => {
    if (!pending) return;
    consumePendingEula(pending.serverId);
  }, [pending]);

  if (!pending) return null;

  return (
    <EulaModal
      eulaText={pending.message ?? ''}
      isLoading={isLoading}
      onAccept={() => void respond(true)}
      onDecline={() => void respond(false)}
      onDismiss={dismiss}
    />
  );
}