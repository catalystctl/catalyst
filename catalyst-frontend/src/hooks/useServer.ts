import { useQuery } from '@tanstack/react-query';
import { qk } from '../lib/queryKeys';
import { serversApi } from '../services/api/servers';
import { reportSystemError } from '../services/api/systemErrors';
import type { Server } from '../types/server';

const transitionalStatuses = new Set(['installing', 'starting', 'stopping', 'transferring']);

export function useServer(id?: string) {
  return useQuery({
    queryKey: qk.server(id!),
    queryFn: () => {
      if (id) return serversApi.get(id);
      reportSystemError({ level: 'error', component: 'useServer', message: 'missing id', metadata: { context: 'query' } });
      return Promise.reject(new Error('missing id'));
    },
    enabled: Boolean(id),
    staleTime: 15_000,
    refetchInterval: (query) => {
      const data = query.state.data as Server | undefined;
      return data && transitionalStatuses.has(data.status) ? 2000 : 10000;
    },
  });
}
