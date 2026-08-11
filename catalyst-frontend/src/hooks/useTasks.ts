import { useQuery } from '@/csync';
import { qk } from '../lib/queryKeys';
import { tasksApi } from '../services/api/tasks';
import { reportSystemError } from '../services/api/systemErrors';
import type { Task } from '../types/task';

const EMPTY_TASKS: Task[] = [];

/** Coerce any tasks payload (array / {tasks} / {data}) into Task[]. */
export function normalizeTasks(data: unknown): Task[] {
  if (Array.isArray(data)) return data as Task[];
  if (data && typeof data === 'object') {
    const d = data as { tasks?: unknown; data?: unknown };
    if (Array.isArray(d.tasks)) return d.tasks as Task[];
    if (Array.isArray(d.data)) return d.data as Task[];
  }
  return EMPTY_TASKS;
}

export function useTasks(serverId?: string) {
  return useQuery({
    queryKey: qk.tasks(serverId!),
    queryFn: async () => {
      if (!serverId) {
        reportSystemError({
          level: 'error',
          component: 'useTasks',
          message: 'missing server id',
          metadata: { context: 'query' },
        });
        throw new Error('missing server id');
      }
      // Prefer storing an array; select below still guards non-array cache writes.
      return normalizeTasks(await tasksApi.list(serverId));
    },
    enabled: Boolean(serverId),
    // Every cache read must be Task[] — SSE/setQueryData can write objects.
    select: (data) => normalizeTasks(data),
    placeholderData: (prev) => (Array.isArray(prev) ? prev : undefined),
    staleTime: 30_000,
    // task_progress / task_complete arrive via global SSE (useServerStateUpdates).
    // Poll only while a task appears in-flight as a safety net.
    refetchInterval: (query) => {
      const list = normalizeTasks(query.state.data);
      // Task model uses lastStatus (not status) for execution state.
      if (
        list.some((t) => {
          const s = String(t?.lastStatus ?? (t as any)?.status ?? '').toLowerCase();
          return s === 'running' || s === 'pending' || s === 'in_progress' || s === 'queued';
        })
      ) {
        return 5000;
      }
      return false;
    },
    refetchIntervalInBackground: false,
  });
}
