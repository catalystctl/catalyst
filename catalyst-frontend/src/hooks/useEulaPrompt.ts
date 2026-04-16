/**
 * SSE-based EULA prompt hook.
 *
 * Listens for `eula_required` events via SSE and provides
 * an `accept` / `decline` callback that calls the backend API.
 */
import { useCallback, useEffect, useState } from 'react';
import { serversApi } from '../services/api/servers';
import { createServerEventsStream, type ServerEventType } from '../services/api/server-events';

type EulaPrompt = {
  serverId: string;
  eulaText: string;
};

export function useEulaPrompt(serverId?: string) {
  const [eulaPrompt, setEulaPrompt] = useState<EulaPrompt | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!serverId) return;

    const disconnect = createServerEventsStream(
      serverId,
      (type: ServerEventType, data: Record<string, unknown>) => {
        if (type === 'eula_required' && String(data.serverId) === serverId) {
          setEulaPrompt({
            serverId: String(data.serverId),
            eulaText: String(data.eulaText ?? ''),
          });
        }
      },
      () => {},
    );

    return disconnect;
  }, [serverId]);

  const respond = useCallback(
    async (accepted: boolean) => {
      if (!eulaPrompt) return;
      setIsLoading(true);
      try {
        await serversApi.respondEula(eulaPrompt.serverId, accepted);
        setEulaPrompt(null);
        if (accepted) {
          await serversApi.start(eulaPrompt.serverId);
        }
      } catch {
        // Keep the modal open so the user can retry
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
