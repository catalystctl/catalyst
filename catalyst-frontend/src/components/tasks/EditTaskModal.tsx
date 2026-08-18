import { useMemo, useState } from 'react';
import { useMutation } from '@/csync';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { tasksApi } from '../../services/api/tasks';
import { notifyError, notifySuccess } from '../../utils/notify';
import type { Task } from '../../types/task';
import { actionOptions } from './CreateTaskModal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

function EditTaskModal({
  serverId,
  task,
  disabled = false,
}: {
  serverId: string;
  task: Omit<Task, 'serverId'>;
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
      notifySuccess('Task updated');
      setOpen(false);
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to update task';
      notifyError(message);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk.tasks(serverId) });
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
        className="rounded-md border border-border bg-card px-3 py-1 text-xs font-semibold text-muted-foreground transition-all duration-300 hover:border-primary hover:text-foreground disabled:opacity-60 dark:border-border dark:text-foreground dark:hover:border-primary/30"
        onClick={() => {
          if (!disabled) setOpen(true);
        }}
        disabled={disabled}
      >
        Edit
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Edit task</DialogTitle>
            <DialogDescription>Update this scheduled task.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="edit-task-name">Name</Label>
              <Input
                id="edit-task-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-task-description">Description (optional)</Label>
              <Input
                id="edit-task-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-task-action">Action</Label>
              <select
                id="edit-task-action"
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground transition-all duration-300 focus:border-primary focus:outline-none hover:border-primary dark:border-border dark:text-foreground dark:hover:border-primary/30"
                value={action}
                onChange={(event) => setAction(event.target.value as Task['action'])}
              >
                {actionOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            {action === 'command' ? (
              <div className="space-y-2">
                <Label htmlFor="edit-task-command">Command</Label>
                <Input
                  id="edit-task-command"
                  value={command}
                  onChange={(event) => setCommand(event.target.value)}
                />
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="edit-task-schedule">Schedule (cron)</Label>
              <Input
                id="edit-task-schedule"
                value={schedule}
                onChange={(event) => setSchedule(event.target.value)}
              />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => mutation.mutate()} disabled={disableSubmit}>
              {mutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default EditTaskModal;
