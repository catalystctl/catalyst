import EmptyState from '../../components/shared/EmptyState';

function TasksPage() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground ">Scheduled Tasks</h1>
          <p className="text-sm text-muted-foreground dark:text-muted-foreground">
            Automate backups, restarts, and commands.
          </p>
        </div>
        <button className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary/90">
          Create Task
        </button>
      </div>
      <EmptyState
        title="No tasks yet"
        description="Create cron-like schedules to automate server operations."
      />
    </div>
  );
}

export default TasksPage;
