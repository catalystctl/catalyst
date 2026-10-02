import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const create = vi.fn();
const update = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, args?: Record<string, unknown>) =>
      args ? `${key}|${JSON.stringify(args)}` : key,
  }),
}));
vi.mock('@/services/api/tasks', () => ({
  tasksApi: {
    create: (...args: unknown[]) => create(...args),
    update: (...args: unknown[]) => update(...args),
  },
}));
vi.mock('@/utils/notify', () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));
vi.mock('@/services/api/systemErrors', () => ({ reportSystemError: vi.fn() }));
vi.mock('@/lib/queryClient', () => ({
  queryClient: {
    invalidateQueries: vi.fn(),
    cancelQueries: vi.fn(),
    setQueryData: vi.fn(),
    removeQueries: vi.fn(),
  },
}));
vi.mock('@/csync', () => ({
  useMutation: (options: { mutationFn: () => Promise<unknown> }) => ({
    isPending: false,
    mutate: () => {
      void options.mutationFn();
    },
  }),
}));

import ScheduleTaskModal from '../ScheduleTaskModal';
import type { Task } from '@/types/task';

const existingTask: Omit<Task, 'serverId'> = {
  id: 'task-1',
  name: 'test',
  action: 'restart',
  schedule: '0 22 * * *',
  enabled: true,
};

const openCreate = () => {
  render(<ScheduleTaskModal serverId="server-1" trigger="primary" />);
  fireEvent.click(screen.getByRole('button', { name: 'tasks.create.action' }));
};

const openEdit = (task: Omit<Task, 'serverId'> = existingTask) => {
  render(<ScheduleTaskModal serverId="server-1" task={task} />);
  fireEvent.click(screen.getByRole('button', { name: 'common:actions.edit' }));
};

describe('ScheduleTaskModal', () => {
  afterEach(() => {
    cleanup();
    create.mockReset();
    update.mockReset();
  });

  it('creates a task from presets without needing a follow-up edit', () => {
    create.mockResolvedValue({});
    openCreate();

    fireEvent.change(screen.getByLabelText('tasks.name'), { target: { value: 'Nightly restart' } });
    // Default preset is daily at 03:00; move it to 22:00 and confirm one save
    // is enough to persist the intended cron.
    fireEvent.change(screen.getByLabelText('tasks.timeOfDay'), { target: { value: '22:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'common:actions.create' }));

    expect(create).toHaveBeenCalledWith(
      'server-1',
      expect.objectContaining({
        name: 'Nightly restart',
        action: 'restart',
        schedule: '0 22 * * *',
      }),
    );
  });

  it('switches the preset controls when the repeat mode changes', () => {
    openCreate();

    // Daily shows a time-of-day control but no weekday picker.
    expect(screen.getByLabelText('tasks.timeOfDay')).toBeTruthy();
    expect(screen.queryByLabelText('tasks.dayOfWeek')).toBeNull();

    fireEvent.change(screen.getByLabelText('tasks.repeat'), { target: { value: 'weekly' } });
    expect(screen.getByLabelText('tasks.dayOfWeek')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('tasks.repeat'), { target: { value: 'minutes' } });
    expect(screen.getByLabelText('tasks.interval')).toBeTruthy();
    expect(screen.queryByLabelText('tasks.timeOfDay')).toBeNull();
  });

  it('reopens an existing task in the presets rather than a bare cron field', () => {
    update.mockResolvedValue({});
    openEdit();

    // '0 22 * * *' parses back into the daily preset, so the advanced editor
    // stays collapsed and the raw cron input is absent.
    expect(screen.queryByLabelText('tasks.scheduleCron')).toBeNull();
    expect((screen.getByLabelText('tasks.repeat') as HTMLSelectElement).value).toBe('daily');
    expect((screen.getByLabelText('tasks.timeOfDay') as HTMLInputElement).value).toBe('22:00');

    fireEvent.change(screen.getByLabelText('tasks.timeOfDay'), { target: { value: '23:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'common:actions.save' }));

    expect(update).toHaveBeenCalledWith(
      'server-1',
      'task-1',
      expect.objectContaining({ schedule: '30 23 * * *' }),
    );
  });

  it('falls back to the advanced editor with the raw cron intact', () => {
    update.mockResolvedValue({});
    openEdit({ ...existingTask, schedule: '0 */2 1,15 * 3' });

    const cronInput = screen.getByLabelText('tasks.scheduleCron') as HTMLInputElement;
    expect(cronInput.value).toBe('0 */2 1,15 * 3');
    expect(screen.queryByLabelText('tasks.repeat')).toBeNull();

    fireEvent.change(cronInput, { target: { value: '0 4 * * *' } });
    fireEvent.click(screen.getByRole('button', { name: 'common:actions.save' }));

    expect(update).toHaveBeenCalledWith(
      'server-1',
      'task-1',
      expect.objectContaining({ schedule: '0 4 * * *' }),
    );
  });

  it('toggling advanced off re-parses the typed cron back into the presets', () => {
    openCreate();
    fireEvent.click(screen.getByLabelText('tasks.advanced'));

    fireEvent.change(screen.getByLabelText('tasks.scheduleCron'), {
      target: { value: '15 6 * * 1' },
    });
    fireEvent.click(screen.getByLabelText('tasks.advanced'));

    expect((screen.getByLabelText('tasks.repeat') as HTMLSelectElement).value).toBe('weekly');
    expect((screen.getByLabelText('tasks.dayOfWeek') as HTMLSelectElement).value).toBe('1');
    expect((screen.getByLabelText('tasks.timeOfDay') as HTMLInputElement).value).toBe('06:15');
  });

  it('keeps a hand-written cron in advanced mode when the presets cannot express it', () => {
    openCreate();
    fireEvent.click(screen.getByLabelText('tasks.advanced'));
    fireEvent.change(screen.getByLabelText('tasks.scheduleCron'), {
      target: { value: '0 3 * * MON' },
    });
    fireEvent.click(screen.getByLabelText('tasks.advanced'));

    expect((screen.getByLabelText('tasks.scheduleCron') as HTMLInputElement).value).toBe(
      '0 3 * * MON',
    );
  });

  it('blocks saving while the schedule is empty', () => {
    openCreate();
    fireEvent.click(screen.getByLabelText('tasks.advanced'));
    fireEvent.change(screen.getByLabelText('tasks.scheduleCron'), { target: { value: '' } });

    expect(screen.getByRole('button', { name: 'common:actions.create' })).toBeDisabled();
  });
});
