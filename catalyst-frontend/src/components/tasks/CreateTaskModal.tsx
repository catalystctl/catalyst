import { useMemo, useState } from 'react';
import { useMutation } from '@/csync';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { tasksApi } from '../../services/api/tasks';
import { notifyError, notifySuccess } from '../../utils/notify';
import { reportSystemError } from '../../services/api/systemErrors';
import type { Task } from '../../types/task';
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

function toLocalDateTimeInputValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export const actionOptions: Array<{ value: Task['action']; label: string }> = [
  { value: 'restart', label: 'Restart server' },
  { value: 'start', label: 'Start server' },
  { value: 'stop', label: 'Stop server' },
  { value: 'backup', label: 'Create backup' },
  { value: 'command', label: 'Send command' },
];

function CreateTaskModal({ serverId, disabled = false }: { serverId: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [repeat, setRepeat] = useState<'minute' | 'hour' | 'daily' | 'weekly' | 'monthly'>('daily');
  const [startDate, setStartDate] = useState(() => {
    const now = new Date();
    now.setMinutes(0, 0, 0);
    now.setHours(now.getHours() + 1);
    return toLocalDateTimeInputValue(now);
  });
  const [weekday, setWeekday] = useState('0');
  const [action, setAction] = useState<Task['action']>('restart');
  const [command, setCommand] = useState('');

  const timezoneLabel = useMemo(() => {
    try {
      const parts = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
        .formatToParts(new Date());
      return parts.find((part) => part.type === 'timeZoneName')?.value ?? '';
    } catch {
      return '';
    }
  }, []);

  // Build cron in the user's *local* timezone to match the datetime-local
  // input and the UI copy. Weekday math also uses local getDay().
  const buildCron = (isoValue: string, cadence: typeof repeat, dayOfWeek: string) => {
    const base = new Date(isoValue);
    if (Number.isNaN(base.getTime())) return '';
    if (cadence === 'minute') return '* * * * *';
    if (cadence === 'hour') return `${base.getMinutes()} * * * *`;
    if (cadence === 'daily') return `${base.getMinutes()} ${base.getHours()} * * *`;
    if (cadence === 'weekly') {
      const targetWeekday = Number(dayOfWeek);
      const currentWeekday = base.getDay();
      const delta = (targetWeekday - currentWeekday + 7) % 7;
      const target = new Date(base);
      target.setDate(base.getDate() + delta);
      return `${target.getMinutes()} ${target.getHours()} * * ${target.getDay()}`;
    }
    return `${base.getMinutes()} ${base.getHours()} ${base.getDate()} * *`;
  };

  const mutation = useMutation({
    mutationFn: () => {
      const schedule = buildCron(startDate, repeat, weekday);
      if (!schedule) {
        reportSystemError({ level: 'error', component: 'CreateTaskModal', message: 'Invalid start time', metadata: { context: 'create task mutation' } });
        throw new Error('Invalid start time');
      }
      return tasksApi.create(serverId, {
        name: name.trim(),
        action,
        schedule,
        payload: action === 'command' && command.trim() ? { command: command.trim() } : {},
      });
    },
    onSuccess: () => {
      notifySuccess('Task created');
      setOpen(false);
      setName('');
      setRepeat('daily');
      setWeekday('0');
      setStartDate(() => {
        const now = new Date();
        now.setMinutes(0, 0, 0);
        now.setHours(now.getHours() + 1);
        return toLocalDateTimeInputValue(now);
      });
      setAction('restart');
      setCommand('');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to create task';
      notifyError(message);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk.tasks(serverId) });
    },
  });

  const disableSubmit = useMemo(() => {
    if (!name.trim()) return true;
    if (!startDate) return true;
    if (action === 'command' && !command.trim()) return true;
    return mutation.isPending || disabled;
  }, [action, command, name, startDate, mutation.isPending, disabled]);

  return (
    <div>
      <button
        type="button"
        className="rounded-md bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground transition-all duration-300 hover:bg-primary/90 disabled:opacity-60"
        onClick={() => {
          if (!disabled) setOpen(true);
        }}
        disabled={disabled}
      >
        Create task
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Create task</DialogTitle>
            <DialogDescription>
              Schedule a recurring action for this server.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="create-task-name">Name</Label>
              <Input
                id="create-task-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Nightly restart"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-task-action">Action</Label>
              <select
                id="create-task-action"
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
                <Label htmlFor="create-task-command">Command</Label>
                <Input
                  id="create-task-command"
                  value={command}
                  onChange={(event) => setCommand(event.target.value)}
                  placeholder="say Server restart in 5 minutes"
                />
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="create-task-start">Start time</Label>
              <Input
                id="create-task-start"
                type="datetime-local"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
              <span className="text-xs text-muted-foreground">
                {timezoneLabel
                  ? `Times are interpreted using your local timezone (${timezoneLabel}).`
                  : 'Times are interpreted using your local timezone.'}
              </span>
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-task-repeat">Repeat</Label>
              <select
                id="create-task-repeat"
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground transition-all duration-300 focus:border-primary focus:outline-none hover:border-primary dark:border-border dark:text-foreground dark:hover:border-primary/30"
                value={repeat}
                onChange={(event) => setRepeat(event.target.value as typeof repeat)}
              >
                <option value="minute">Every minute</option>
                <option value="hour">Every hour</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            {repeat === 'weekly' ? (
              <div className="space-y-2">
                <Label htmlFor="create-task-weekday">Day of week</Label>
                <select
                  id="create-task-weekday"
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground transition-all duration-300 focus:border-primary focus:outline-none hover:border-primary dark:border-border dark:text-foreground dark:hover:border-primary/30"
                  value={weekday}
                  onChange={(event) => setWeekday(event.target.value)}
                >
                  <option value="0">Sunday</option>
                  <option value="1">Monday</option>
                  <option value="2">Tuesday</option>
                  <option value="3">Wednesday</option>
                  <option value="4">Thursday</option>
                  <option value="5">Friday</option>
                  <option value="6">Saturday</option>
                </select>
              </div>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => mutation.mutate()} disabled={disableSubmit}>
              {mutation.isPending ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default CreateTaskModal;
