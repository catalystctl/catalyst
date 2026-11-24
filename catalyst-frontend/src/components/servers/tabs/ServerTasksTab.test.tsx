import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * "Run now" on a scheduled task: the backend endpoint existed
 * (POST /api/servers/:serverId/tasks/:taskId/execute) but nothing in the panel
 * called it, so running a task once meant editing its cron and reverting it.
 */

const h = vi.hoisted(() => ({
  execute: vi.fn(),
  invalidateQueries: vi.fn(),
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key,
  }),
}));

vi.mock('@/csync', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useMutation: (options: {
      mutationFn: (arg: string) => Promise<unknown>;
      onSuccess?: (data: unknown, arg: string) => void;
      onError?: (error: unknown) => void;
      onSettled?: () => void;
    }) => ({
      isPending: false,
      mutate: (arg: string, extra?: { onSettled?: () => void }) => {
        void (async () => {
          try {
            const data = await options.mutationFn(arg);
            options.onSuccess?.(data, arg);
          } catch (error) {
            options.onError?.(error);
          } finally {
            options.onSettled?.();
            extra?.onSettled?.();
          }
        })();
      },
    }),
    useQueryClient: () => ({ invalidateQueries: h.invalidateQueries }),
  };
});

vi.mock('../../../services/api/tasks', () => ({
  tasksApi: { execute: (...args: unknown[]) => h.execute(...args) },
}));
vi.mock('../../../utils/notify', () => ({
  notifyError: (...args: unknown[]) => h.notifyError(...args),
  notifySuccess: (...args: unknown[]) => h.notifySuccess(...args),
}));
// The edit/create dialog is a separate concern with its own modal machinery.
vi.mock('../../tasks/ScheduleTaskModal', () => ({ default: () => <div data-testid="schedule-modal" /> }));

import ServerTasksTab from './ServerTasksTab';

const task = {
  id: 'task-1',
  name: 'Nightly restart',
  action: 'restart',
  schedule: '0 3 * * *',
  enabled: true,
  runCount: 4,
} as never;

const renderTab = () =>
  render(
    <ServerTasksTab
      serverId="server-1"
      isSuspended={false}
      tasks={[task]}
      tasksLoading={false}
      onPause={vi.fn()}
      pausePending={false}
      onDelete={vi.fn()}
      deletePending={false}
    />,
  );

describe('ServerTasksTab run now', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('executes the task through the existing endpoint and refreshes the list', async () => {
    h.execute.mockResolvedValue({ success: true });
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /tasks\.runNow\.action/ }));

    await waitFor(() => expect(h.execute).toHaveBeenCalledWith('server-1', 'task-1'));
    await waitFor(() => expect(h.notifySuccess).toHaveBeenCalled());
    expect(h.invalidateQueries).toHaveBeenCalled();
  });

  it('reports a failed run instead of silently doing nothing', async () => {
    h.execute.mockRejectedValue(new Error('server is stopped'));
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /tasks\.runNow\.action/ }));

    await waitFor(() => expect(h.notifyError).toHaveBeenCalled());
    expect(h.notifySuccess).not.toHaveBeenCalled();
  });

  it('disables the action on a suspended server', () => {
    render(
      <ServerTasksTab
        serverId="server-1"
        isSuspended
        tasks={[task]}
        tasksLoading={false}
        onPause={vi.fn()}
        pausePending={false}
        onDelete={vi.fn()}
        deletePending={false}
      />,
    );
    expect(screen.getByRole('button', { name: /tasks\.runNow\.action/ })).toBeDisabled();
  });
});
