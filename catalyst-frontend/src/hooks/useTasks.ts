import { useQuery } from '@tanstack/react-query';
import { qk } from '../lib/queryKeys';
import { tasksApi } from '../services/api/tasks';
import { reportSystemError } from '../services/api/systemErrors';

export function useTasks(serverId?: string) {
  return useQuery({
    queryKey: qk.tasks(serverId!),
    queryFn: () => {
      if (!serverId) {
        reportSystemError({ level: 'error', component: 'useTasks', message: 'missing server id', metadata: { context: 'query' } });
        throw new Error('missing server id');
      }
      return tasksApi.list(serverId);
    },
    enabled: Boolean(serverId),
    refetchInterval: 10000,
  });
}
