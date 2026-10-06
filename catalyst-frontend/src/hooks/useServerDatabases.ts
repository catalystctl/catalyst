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
    // database_* push is being added backend-side; belt-and-braces 60s poll (U3).
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}

export function useAvailableDatabaseHosts() {
  return useQuery({
    queryKey: qk.databaseHosts(),
    queryFn: databasesApi.listHosts,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
    // Host list can change under a non-admin; 60s safety poll (U3).
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}
