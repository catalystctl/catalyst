import EditTaskModal from '../../tasks/EditTaskModal';
import CreateTaskModal from '../../tasks/CreateTaskModal';
import ServerTabCard from './ServerTabCard';
import StatGrid from './StatGrid';

const formatDateTime = (value?: string | null) =>
  value ? new Date(value).toLocaleString() : '—';

interface Task {
  id: string;
  name: string;
  action: string;
  description?: string;
  schedule: string;
  nextRunAt?: string | null;
  lastRunAt?: string | null;
  lastStatus?: string | null;
  runCount?: number;
  lastError?: string | null;
  enabled?: boolean;
}

interface Props {
  serverId: string;
  isSuspended: boolean;
  tasks: Task[];
  tasksLoading: boolean;
  onPause: (task: { id: string; enabled: boolean }) => void;
  pausePending: boolean;
  onDelete: (taskId: string) => void;
  deletePending: boolean;
}

export default function ServerTasksTab({
  serverId,
  isSuspended,
  tasks,
  tasksLoading,
  onPause,
  pausePending,
  onDelete,
  deletePending,
}: Props) {
  return (
    <ServerTabCard>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-foreground">Scheduled tasks</div>
          <div className="text-xs text-muted-foreground">
            Automate restarts, backups, and commands.
          </div>
        </div>
        <CreateTaskModal serverId={serverId} disabled={isSuspended} />
      </div>
      <div className="mt-4">
        {tasksLoading ? (
          <div className="text-sm text-muted-foreground">Loading tasks...</div>
        ) : tasks.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-surface-2 px-6 py-8 text-center text-sm text-muted-foreground/50">
            No tasks configured for this server yet.
          </div>
        ) : (
          <div className="space-y-3">
            {tasks.map((task) => (
              <div
                className="rounded-lg border border-border bg-surface-2 px-4 py-3 transition-all duration-300 hover:border-primary/30"
                key={task.id}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-foreground">
                    {task.name}
                  </div>
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {task.action}
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {task.description || 'No description'}
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  Schedule: {task.schedule}
                </div>
                <StatGrid
                  columns={4}
                  className="mt-2"
                  items={[
                    { label: 'Next run', value: formatDateTime(task.nextRunAt) },
                    { label: 'Last run', value: formatDateTime(task.lastRunAt) },
                    { label: 'Status', value: task.lastStatus ?? '—' },
                    { label: 'Runs', value: task.runCount ?? 0 },
                  ]}
                />
                {task.lastError ? (
                  <div className="mt-2 rounded-md border border-danger/30 bg-danger-muted px-3 py-2 text-[11px] text-danger">
                    {task.lastError}
                  </div>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <EditTaskModal
                    serverId={serverId}
                    task={task}
                    disabled={isSuspended}
                  />
                  <button
                    type="button"
                    className={`rounded-md border px-3 py-1 font-semibold transition-all duration-300 ${
                      task.enabled === false
                        ? 'border-success/30 text-success hover:border-success/50'
                        : 'border-warning/30 text-warning hover:border-warning/50'
                    }`}
                    onClick={() =>
                      onPause(task as { id: string; enabled: boolean })
                    }
                    disabled={pausePending || isSuspended}
                  >
                    {task.enabled === false ? 'Resume' : 'Pause'}
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-danger/30 px-3 py-1 font-semibold text-danger transition-all duration-300 hover:border-danger/50"
                    onClick={() => onDelete(task.id)}
                    disabled={deletePending || isSuspended}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </ServerTabCard>
  );
}
