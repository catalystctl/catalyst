import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { tasksApi } from '../../services/api/tasks';
import { notifyError, notifySuccess } from '../../utils/notify';
import type { Task } from '../../types/task';

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
    return now.toISOString().slice(0, 16);
  });
  const [weekday, setWeekday] = useState('0');
  const [action, setAction] = useState<Task['action']>('restart');
  const [command, setCommand] = useState('');
  const queryClient = useQueryClient();

  const timezoneLabel = useMemo(() => {
    try {
      const parts = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
        .formatToParts(new Date());
      return parts.find((part) => part.type === 'timeZoneName')?.value ?? '';
    } catch {
      return '';
    }
  }, []);

  const buildCron = (isoValue: string, cadence: typeof repeat, dayOfWeek: string) => {
    const base = new Date(isoValue);
    if (Number.isNaN(base.getTime())) return '';
    if (cadence === 'minute') return '* * * * *';
    if (cadence === 'hour') return `${base.getUTCMinutes()} * * * *`;
    if (cadence === 'daily') return `${base.getUTCMinutes()} ${base.getUTCHours()} * * *`;
    if (cadence === 'weekly') {
      const targetWeekday = Number(dayOfWeek);
      const currentWeekday = base.getDay();
      const delta = (targetWeekday - currentWeekday + 7) % 7;
      const target = new Date(base);
      target.setDate(base.getDate() + delta);
      return `${target.getUTCMinutes()} ${target.getUTCHours()} * * ${target.getUTCDay()}`;
    }
    return `${base.getUTCMinutes()} ${base.getUTCHours()} ${base.getUTCDate()} * *`;
  };

  const mutation = useMutation({
    mutationFn: () => {
      const schedule = buildCron(startDate, repeat, weekday);
      if (!schedule) {
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
      queryClient.invalidateQueries({ queryKey: ['tasks', serverId] });
      notifySuccess('Task created');
      setOpen(false);
      setName('');
      setRepeat('daily');
      setWeekday('0');
      setStartDate(() => {
        const now = new Date();
        now.setMinutes(0, 0, 0);
        now.setHours(now.getHours() + 1);
        return now.toISOString().slice(0, 16);
      });
      setAction('restart');
      setCommand('');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to create task';
      notifyError(message);
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
        className="rounded-md bg-primary-600 px-3 py-1 text-xs font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
        onClick={() => {
          if (!disabled) setOpen(true);
        }}
        disabled={disabled}
      >
        Create task
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white dark:bg-slate-950/60 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Create task</h2>
              <button
                className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                onClick={() => setOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-300">
              <label className="block space-y-1">
                <span className="text-slate-500 dark:text-slate-400">Name</span>
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Nightly restart"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-slate-500 dark:text-slate-400">Action</span>
                <select
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
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
                  <span className="text-slate-500 dark:text-slate-400">Command</span>
                  <input
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                    value={command}
                    onChange={(event) => setCommand(event.target.value)}
                    placeholder="say Server restart in 5 minutes"
                  />
                </label>
              ) : null}
              <label className="block space-y-1">
                <span className="text-slate-500 dark:text-slate-400">Start time</span>
                <input
                  type="datetime-local"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                />
                <span className="text-xs text-slate-500 dark:text-slate-500">
                  {timezoneLabel
                    ? `Times are interpreted using your local timezone (${timezoneLabel}).`
                    : 'Times are interpreted using your local timezone.'}
                </span>
              </label>
              <label className="block space-y-1">
                <span className="text-slate-500 dark:text-slate-400">Repeat</span>
                <select
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                  value={repeat}
                  onChange={(event) => setRepeat(event.target.value as typeof repeat)}
                >
                  <option value="minute">Every minute</option>
                  <option value="hour">Every hour</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </label>
              {repeat === 'weekly' ? (
                <label className="block space-y-1">
                  <span className="text-slate-500 dark:text-slate-400">Day of week</span>
                  <select
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
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
                </label>
              ) : null}
            </div>
            <div className="mt-5 flex justify-end gap-2 text-xs">
              <button
                className="rounded-md border border-slate-200 px-3 py-1 font-semibold text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-primary-600 px-4 py-2 font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
                onClick={() => mutation.mutate()}
                disabled={disableSubmit}
              >
                {mutation.isPending ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default CreateTaskModal;
