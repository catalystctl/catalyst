import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * "Stop server & restore": the restore row used to be a dead grey button while
 * the server was running, with no hint why. It now offers to stop the server
 * itself, waits for the agent to report `stopped`, and only then restores.
 * A failed or timed-out stop leaves the dialog open with the error in it —
 * restoring on top of a live container is what must never happen.
 */

const h = vi.hoisted(() => ({
  stop: vi.fn(),
  restore: vi.fn(),
  get: vi.fn(),
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: Record<string, unknown>) => (opts ? `${key}:${JSON.stringify(opts)}` : key) }),
}));
vi.mock('../../services/api/backups', () => ({ backupsApi: { restore: (...args: unknown[]) => h.restore(...args) } }));
vi.mock('../../services/api/servers', () => ({
  serversApi: {
    stop: (...args: unknown[]) => h.stop(...args),
    get: (...args: unknown[]) => h.get(...args),
  },
}));
vi.mock('../../utils/notify', () => ({
  notifyError: (...args: unknown[]) => h.notifyError(...args),
  notifySuccess: (...args: unknown[]) => h.notifySuccess(...args),
}));
vi.mock('@/lib/queryClient', () => ({ queryClient: { invalidateQueries: vi.fn() } }));
vi.mock('@/csync', () => ({
  useMutation: (options: { mutationFn: () => Promise<unknown>; onSuccess?: () => void; onError?: (e: unknown) => void; onSettled?: () => void }) => ({
    isPending: false,
    mutate: () => {
      const run = async () => {
        try {
          await options.mutationFn();
          options.onSuccess?.();
        } catch (error) {
          options.onError?.(error);
        } finally {
          options.onSettled?.();
        }
      };
      void run();
    },
  }),
}));

import RestoreBackupDialog from './RestoreBackupDialog';

const backup = { id: 'backup-1', name: 'nightly' } as never;

const openAndConfirm = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'backups.restore.action' }));
  const acknowledge = await screen.findByLabelText('backups.restore.acknowledgeOverwrite');
  fireEvent.click(acknowledge);
  return screen.getByRole('button', { name: /backups\.restore\.(stopAndRestore|action)/ });
};

describe('RestoreBackupDialog stop & restore', () => {
  beforeEach(() => {
    h.stop.mockReset().mockResolvedValue({});
    h.restore.mockReset().mockResolvedValue({});
    h.get.mockReset();
    h.notifyError.mockReset();
    h.notifySuccess.mockReset();
  });
  afterEach(cleanup);

  it('offers the stop action and refuses to stay a dead button while running', async () => {
    render(<RestoreBackupDialog serverId="server-1" backup={backup} serverStatus="running" />);
    const trigger = screen.getByRole('button', { name: 'backups.restore.action' });
    // Running is no longer a disabled/greyed restore: it explains itself.
    expect(trigger).toBeEnabled();
    expect(trigger).toHaveAttribute('title', 'backups.restore.stopsServerFirst');
    fireEvent.click(trigger);
    expect(await screen.findByText('backups.restore.runningWarning', { exact: false })).toBeTruthy();
  });

  it('stops the server, waits for stopped, then restores', async () => {
    // The agent keeps reporting a shutting-down container for one poll; the
    // restore must not start until it reports `stopped`.
    h.get
      .mockResolvedValueOnce({ status: 'stopping' })
      .mockResolvedValue({ status: 'stopped' });
    render(<RestoreBackupDialog serverId="server-1" backup={backup} serverStatus="running" />);
    const confirm = await openAndConfirm();
    expect(confirm.textContent).toContain('backups.restore.stopAndRestore');

    // Fake timers only for the stop poll, which sleeps between checks.
    vi.useFakeTimers();
    try {
      fireEvent.click(confirm);
      await vi.advanceTimersByTimeAsync(2_000);
    } finally {
      vi.useRealTimers();
    }

    await waitFor(() => expect(h.restore).toHaveBeenCalledWith('server-1', 'backup-1'));
    expect(h.stop).toHaveBeenCalledWith('server-1');
    expect(h.get).toHaveBeenCalledWith('server-1');
  });

  it('keeps the dialog open and shows the error when the stop fails', async () => {
    h.stop.mockRejectedValue(new Error('agent offline'));
    render(<RestoreBackupDialog serverId="server-1" backup={backup} serverStatus="running" />);
    const confirm = await openAndConfirm();
    fireEvent.click(confirm);

    await waitFor(() => expect(h.notifyError).toHaveBeenCalled());
    // Nothing was restored over a live server.
    expect(h.restore).not.toHaveBeenCalled();
    // Still open, with the overwrite acknowledgement intact.
    expect(screen.getByLabelText('backups.restore.acknowledgeOverwrite')).toBeChecked();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('never restores when the server does not stop in time', async () => {
    h.get.mockResolvedValue({ status: 'running' });
    render(<RestoreBackupDialog serverId="server-1" backup={backup} serverStatus="running" />);
    const confirm = await openAndConfirm();
    // Past the stop deadline (90s) the flow must abort instead of restoring.
    vi.useFakeTimers();
    try {
      fireEvent.click(confirm);
      await vi.advanceTimersByTimeAsync(120_000);
    } finally {
      vi.useRealTimers();
    }
    await waitFor(() => expect(h.notifyError).toHaveBeenCalled());
    expect(h.restore).not.toHaveBeenCalled();
  });

  it('restores directly when the server is already stopped', async () => {
    render(<RestoreBackupDialog serverId="server-1" backup={backup} serverStatus="stopped" />);
    const confirm = await openAndConfirm();
    expect(confirm.textContent).toContain('backups.restore.action');
    fireEvent.click(confirm);
    await waitFor(() => expect(h.restore).toHaveBeenCalledWith('server-1', 'backup-1'));
    expect(h.stop).not.toHaveBeenCalled();
  });

  it('stays locked for a suspended server', () => {
    render(<RestoreBackupDialog serverId="server-1" backup={backup} serverStatus="running" isSuspended />);
    const trigger = screen.getByRole('button', { name: 'backups.restore.action' });
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveAttribute('title', 'backups.restore.blockedSuspended');
  });
});
