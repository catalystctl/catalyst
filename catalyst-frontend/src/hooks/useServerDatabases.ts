import { useQuery } from '@/csync';
import { qk } from '../lib/queryKeys';
import { databasesApi } from '../services/api/databases';
import { reportSystemError } from '../services/api/systemErrors';

export function useServerDatabases(serverId?: string) {
  return useQuery({
    queryKey: qk.serverDatabases(serverId!),
    queryFn: () => {
      if (!serverId) {
        reportSystemError({ level: 'error', component: 'useServerDatabases', message: 'missing server id', metadata: { context: 'query' } });
        throw new Error('missing server id');
      }
      return databasesApi.list(serverId);
    },
    enabled: Boolean(serverId),
    placeholderData: (prev) => prev,
    staleTime: 5 * 60 * 1000,
  });
}
