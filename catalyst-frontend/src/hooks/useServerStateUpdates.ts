import { useEffect } from 'react';
import { useQueryClient, type Query } from '@tanstack/react-query';
import { useWebSocketStore } from '../stores/websocketStore';

export function useServerStateUpdates() {
  const queryClient = useQueryClient();
  const { onMessage } = useWebSocketStore();

  useEffect(() => {
    // Subscribe to server_state_update messages (legacy server_state too)
    const unsubscribe = onMessage((message) => {
      if (
        (message.type === 'server_state_update' || message.type === 'server_state') &&
        message.serverId
      ) {
        const nextState = message.state;

        const matchesServerId = (server: any) =>
          server?.id === message.serverId || server?.uuid === message.serverId;

        // Update cached server detail if present.
        queryClient.setQueriesData(
          { predicate: (query) => Array.isArray(query.queryKey) && query.queryKey[0] === 'server' },
          (previous: any) => {
            if (!previous || typeof previous !== 'object') return previous;
            if (!matchesServerId(previous)) return previous;
            return {
              ...previous,
              status: nextState,
              portBindings: message.portBindings ?? previous.portBindings,
              lastExitCode:
                typeof message.exitCode === 'number'
                  ? message.exitCode
                  : previous.lastExitCode,
            };
          },
        );

        const serverListPredicate = (query: Query) =>
          Array.isArray(query.queryKey) && query.queryKey[0] === 'servers';

        // Update cached server lists (all filters) if present.
        queryClient.setQueriesData({ predicate: serverListPredicate }, (previous: any) => {
          if (!Array.isArray(previous)) return previous;
          return previous.map((server) =>
            matchesServerId(server)
              ? {
                  ...server,
                  status: nextState,
                  portBindings: message.portBindings ?? server.portBindings,
                  lastExitCode:
                    typeof message.exitCode === 'number'
                      ? message.exitCode
                      : server.lastExitCode,
                }
              : server,
          );
        });

        // Invalidate to refetch fresh data.
        queryClient.invalidateQueries({
          predicate: (query: any) =>
            Array.isArray(query.queryKey) &&
            query.queryKey[0] === 'server' &&
            query.state.data &&
            matchesServerId(query.state.data),
        });
        queryClient.invalidateQueries({
          predicate: serverListPredicate,
        });
      }
    });

    return unsubscribe;
  }, [queryClient, onMessage]);
}
