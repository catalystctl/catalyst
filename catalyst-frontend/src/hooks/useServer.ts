import { useQuery } from '@/csync';
import { qk } from '../lib/queryKeys';
import { serversApi } from '../services/api/servers';
import { reportSystemError } from '../services/api/systemErrors';
import { useStreamAwareInterval } from './useStreamAwareInterval';
import type { Server } from '../types/server';

const transitionalStatuses = new Set(['installing', 'starting', 'stopping', 'transferring', 'cloning']);

export function useServer(id?: string) {
  // P1-24: the 2s poll below is transitional-only — during an SSE outage the
  // detail page would freeze, so poll at 30s while streams are down.
  const outagePoll = useStreamAwareInterval(30_000);
  return useQuery({
    queryKey: qk.server(id!),
    queryFn: () => {
      if (id) return serversApi.get(id);
      reportSystemError({ level: 'error', component: 'useServer', message: 'missing id', metadata: { context: 'query' } });
      return Promise.reject(new Error('missing id'));
    },
    enabled: Boolean(id),
    staleTime: 15_000,
    placeholderData: (prev) => prev,
    // Status is patched from global SSE; poll only during transitional power/install states.
    refetchInterval: (query) => {
      const data = query.state.data as Server | undefined;
      return data && transitionalStatuses.has(data.status) ? 2000 : outagePoll;
    },
    refetchIntervalInBackground: false,
  });
}
