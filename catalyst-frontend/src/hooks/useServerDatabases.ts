import { useQuery } from '@tanstack/react-query';
import { qk } from '../lib/queryKeys';
import { databasesApi } from '../services/api/databases';

export function useServerDatabases(serverId?: string) {
  return useQuery({
    queryKey: qk.serverDatabases(serverId!),
    queryFn: () => {
      if (!serverId) throw new Error('missing server id');
      return databasesApi.list(serverId);
    },
    enabled: Boolean(serverId),
  });
}
