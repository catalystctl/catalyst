import { useCallback, useEffect, useState } from 'react';
import { serversApi } from '../services/api/servers';
import { useWebSocketStore } from '../stores/websocketStore';

type EulaPrompt = {
  serverId: string;
  eulaText: string;
};

/**
 * Listens for `eula_required` WebSocket messages and provides
 * an `accept` / `decline` callback that calls the backend API.
 */
export function useEulaPrompt(serverId?: string) {
  const [eulaPrompt, setEulaPrompt] = useState<EulaPrompt | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { onMessage } = useWebSocketStore();

  useEffect(() => {
    if (!serverId) return;

    const unsubscribe = onMessage((message) => {
      if (message.type === 'eula_required' && message.serverId === serverId) {
        setEulaPrompt({
          serverId: message.serverId,
          eulaText: message.eulaText ?? '',
        });
      }
    });

    return unsubscribe;
  }, [serverId, onMessage]);

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
