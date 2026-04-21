import { useQuery } from '@tanstack/react-query';
import { qk } from '../lib/queryKeys';
import { serversApi } from '../services/api/servers';
import type { Server, ServerListParams } from '../types/server';

const transitionalStatuses = new Set(['installing', 'starting', 'stopping', 'transferring']);

export function useServers(params?: ServerListParams) {
  return useQuery({
    queryKey: qk.servers(params as Record<string, unknown> | undefined),
    queryFn: () => serversApi.list(params),
    refetchInterval: (query) =>
      (query.state.data as Server[] | undefined)?.some((server) =>
        transitionalStatuses.has(server.status),
      )
        ? 2000
        : false,
  });
}
