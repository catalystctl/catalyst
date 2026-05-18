import EditTaskModal from '../../tasks/EditTaskModal';
import CreateTaskModal from '../../tasks/CreateTaskModal';
import ServerTabCard from './ServerTabCard';
import StatGrid from './StatGrid';
import TabHeader from './TabHeader';
import TabEmptyState from './TabEmptyState';
import TabLoadingState from './TabLoadingState';
import { Clock } from 'lucide-react';

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
    <div className="space-y-4">
      <TabHeader
        icon={Clock}
        title="Scheduled Tasks"
        description="Automate restarts, backups, and commands."
        actions={
          <CreateTaskModal serverId={serverId} disabled={isSuspended} />
        }
      />

      <ServerTabCard>
        {tasksLoading ? (
          <TabLoadingState rows={3} />
        ) : tasks.length === 0 ? (
          <TabEmptyState
            title="No tasks configured"
            description="Create a task to automate server operations on a schedule."
            action={
              <CreateTaskModal serverId={serverId} disabled={isSuspended} />
            }
          />
        ) : (
          <div className="space-y-2">
            {tasks.map((task) => (
              <div
                className="group relative rounded-lg border border-border/30 px-4 py-3 transition-all duration-150 hover:border-primary/20 hover:bg-primary/[0.02]"
                key={task.id}
              >
                {/* Left accent bar */}
                <div className={`absolute left-0 top-2 bottom-2 w-0.5 rounded-full transition-colors duration-150 ${
                  task.enabled === false
                    ? 'bg-warning/40 group-hover:bg-warning/70'
                    : 'bg-primary/0 group-hover:bg-primary/50'
                }`} />

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-foreground">
                    {task.name}
                  </div>
                  <span className="rounded bg-surface-2/60 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {task.action}
                  </span>
                </div>
                {task.description && (
                  <div className="mt-1 text-[11px] text-muted-foreground/60">
                    {task.description}
                  </div>
                )}
                <div className="mt-1 font-mono text-[10px] tabular-nums text-muted-foreground/50">
                  {task.schedule}
                </div>

                <StatGrid
                  columns={4}
                  className="mt-2.5"
                  items={[
                    { label: 'Next run', value: formatDateTime(task.nextRunAt) },
                    { label: 'Last run', value: formatDateTime(task.lastRunAt) },
                    { label: 'Status', value: task.lastStatus ?? '—' },
                    { label: 'Runs', value: task.runCount ?? 0 },
                  ]}
                />

                {task.lastError && (
                  <div className="mt-2 rounded-md border border-danger/20 bg-danger/5 px-3 py-1.5 font-mono text-[10px] text-danger">
                    {task.lastError}
                  </div>
                )}

                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <EditTaskModal
                    serverId={serverId}
                    task={task}
                    disabled={isSuspended}
                  />
                  <button
                    type="button"
                    className={`rounded-md border px-3 py-1 text-[10px] font-semibold transition-all duration-200 ${
                      task.enabled === false
                        ? 'border-success/25 text-success hover:border-success/40 hover:bg-success/5'
                        : 'border-warning/25 text-warning hover:border-warning/40 hover:bg-warning/5'
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
                    className="rounded-md border border-danger/20 px-3 py-1 text-[10px] font-semibold text-danger transition-all duration-200 hover:border-danger/40 hover:bg-danger/5"
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
      </ServerTabCard>
    </div>
  );
}
