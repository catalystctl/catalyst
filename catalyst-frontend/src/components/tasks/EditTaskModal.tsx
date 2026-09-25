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
        className="inline-flex h-7 items-center rounded-sm border border-border/60 px-2 text-mini font-semibold text-muted-foreground transition-colors hover:bg-surface-1/40 hover:text-foreground disabled:opacity-60"
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
                className="h-7 w-full rounded-sm border border-border/60 bg-background/40 px-2 text-mini text-foreground outline-none transition-colors focus:border-primary"
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
            <Button variant="outline" className="h-8 px-3 text-mini" onClick={() => setOpen(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button
              size="sm"
              className="h-8 px-3 text-mini"
              onClick={() => mutation.mutate()}
              disabled={disableSubmit}
            >
              {mutation.isPending ? t('tasks.edit.saving') : t('common:actions.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default EditTaskModal;
