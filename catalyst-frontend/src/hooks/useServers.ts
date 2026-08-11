import { useQuery } from '@/csync';
import { qk } from '../lib/queryKeys';
import { serversApi } from '../services/api/servers';
import type { ServerListParams } from '../types/server';

const EMPTY_SERVERS: import('../types/server').Server[] = [];

const transitionalStatuses = new Set(['installing', 'starting', 'stopping', 'transferring', 'cloning']);

export function useServers(params?: ServerListParams) {
  return useQuery({
    queryKey: qk.servers(params as Record<string, unknown> | undefined),
    queryFn: () => serversApi.list(params),
    // Guard non-array cache writes so consumers can always .filter/.map
    select: (data) => (Array.isArray(data) ? data : EMPTY_SERVERS),
    staleTime: 30_000,
    placeholderData: (prev) => (Array.isArray(prev) ? prev : undefined),
    // SSE (useServerStateUpdates) patches status live. Poll only while any row is transitional
    // as a safety net if an event is missed mid-transition.
    refetchInterval: (query) =>
      Array.isArray(query.state.data) &&
      query.state.data.some((server) => transitionalStatuses.has(server.status))
        ? 2000
        : false,
    refetchIntervalInBackground: false,
  });
}
