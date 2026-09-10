import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('server-tabs');
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
      notifySuccess(t('tasks.edit.success'));
      setOpen(false);
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || t('tasks.edit.failed');
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
        {t('common:actions.edit')}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>{t('tasks.edit.title')}</DialogTitle>
            <DialogDescription>{t('tasks.edit.description')}</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="edit-task-name">{t('tasks.name')}</Label>
              <Input
                id="edit-task-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-task-description">{t('tasks.descriptionLabel')}</Label>
              <Input
                id="edit-task-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-task-action">{t('tasks.action')}</Label>
              <select
                id="edit-task-action"
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground transition-all duration-300 focus:border-primary focus:outline-none hover:border-primary dark:border-border dark:text-foreground dark:hover:border-primary/30"
                value={action}
                onChange={(event) => setAction(event.target.value as Task['action'])}
              >
                {actionOptions(t).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            {action === 'command' ? (
              <div className="space-y-2">
                <Label htmlFor="edit-task-command">{t('tasks.command')}</Label>
                <Input
                  id="edit-task-command"
                  value={command}
                  onChange={(event) => setCommand(event.target.value)}
                />
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="edit-task-schedule">{t('tasks.scheduleCron')}</Label>
              <Input
                id="edit-task-schedule"
                value={schedule}
                onChange={(event) => setSchedule(event.target.value)}
              />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button onClick={() => mutation.mutate()} disabled={disableSubmit}>
              {mutation.isPending ? t('tasks.edit.saving') : t('common:actions.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default EditTaskModal;
