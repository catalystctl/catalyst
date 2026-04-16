import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { tasksApi } from '../../services/api/tasks';
import { notifyError, notifySuccess } from '../../utils/notify';
import type { Task } from '../../types/task';
import { actionOptions } from './CreateTaskModal';
import { ModalPortal } from '@/components/ui/modal-portal';

function EditTaskModal({
  serverId,
  task,
  disabled = false,
}: {
  serverId: string;
  task: Task;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(task.name);
  const [description, setDescription] = useState(task.description ?? '');
  const [action, setAction] = useState<Task['action']>(task.action);
  const [schedule, setSchedule] = useState(task.schedule);
  const [command, setCommand] = useState(
    typeof task.payload?.command === 'string' ? task.payload.command : '',
  );

  const mutation = useMutation({
    mutationFn: () =>
      tasksApi.update(serverId, task.id, {
        name: name.trim(),
        description: description.trim() || undefined,
        action,
        schedule: schedule.trim(),
        payload: action === 'command' && command.trim() ? { command: command.trim() } : {},
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.tasks(serverId) });
      notifySuccess('Task updated');
      setOpen(false);
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to update task';
      notifyError(message);
    },
  });

  const disableSubmit = useMemo(() => {
    if (!name.trim() || !schedule.trim()) return true;
    if (action === 'command' && !command.trim()) return true;
    return mutation.isPending || disabled;
  }, [action, command, name, schedule, mutation.isPending, disabled]);

  return (
    <div>
      <button
        className="rounded-md border border-border bg-white px-3 py-1 text-xs font-semibold text-muted-foreground transition-all duration-300 hover:border-primary-500 hover:text-foreground disabled:opacity-60 dark:border-border dark:bg-surface-1 dark:text-zinc-300 dark:hover:border-primary/30"
        onClick={() => {
          if (!disabled) setOpen(true);
        }}
        disabled={disabled}
      >
        Edit
      </button>
      {open ? (
        <ModalPortal>
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white dark:bg-zinc-950/60 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-border bg-white p-6 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 dark:border-border dark:bg-surface-1">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground dark:text-white">Edit task</h2>
              <button
                className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-all duration-300 hover:border-primary-500 dark:border-border dark:text-zinc-300 dark:hover:border-primary/30"
                onClick={() => setOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="mt-4 space-y-3 text-sm text-muted-foreground dark:text-zinc-300">
              <label className="block space-y-1">
                <span className="text-muted-foreground dark:text-muted-foreground">Name</span>
                <input
                  className="w-full rounded-lg border border-border bg-white px-3 py-2 text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-muted-foreground dark:text-muted-foreground">Description (optional)</span>
                <input
                  className="w-full rounded-lg border border-border bg-white px-3 py-2 text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-muted-foreground dark:text-muted-foreground">Action</span>
                <select
                  className="w-full rounded-lg border border-border bg-white px-3 py-2 text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
                  value={action}
                  onChange={(event) => setAction(event.target.value as Task['action'])}
                >
                  {actionOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              {action === 'command' ? (
                <label className="block space-y-1">
                  <span className="text-muted-foreground dark:text-muted-foreground">Command</span>
                  <input
                    className="w-full rounded-lg border border-border bg-white px-3 py-2 text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
                    value={command}
                    onChange={(event) => setCommand(event.target.value)}
                  />
                </label>
              ) : null}
              <label className="block space-y-1">
                <span className="text-muted-foreground dark:text-muted-foreground">Schedule (cron)</span>
                <input
                  className="w-full rounded-lg border border-border bg-white px-3 py-2 text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
                  value={schedule}
                  onChange={(event) => setSchedule(event.target.value)}
                />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2 text-xs">
              <button
                className="rounded-md border border-border px-3 py-1 font-semibold text-muted-foreground transition-all duration-300 hover:border-primary-500 hover:text-foreground dark:border-border dark:text-zinc-300 dark:hover:border-primary/30"
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-primary-600 px-4 py-2 font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
                onClick={() => mutation.mutate()}
                disabled={disableSubmit}
              >
                {mutation.isPending ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
        </ModalPortal>
      ) : null}
    </div>
  );
}

export default EditTaskModal;
