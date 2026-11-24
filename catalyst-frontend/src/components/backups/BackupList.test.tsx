import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

/**
 * BackupList gained two behaviours the audit asked for:
 *  - bulk delete (checkbox per row + one confirmed sequential delete), and
 *  - a Cancel button on a downloading row (the archive download is abortable).
 */

const h = vi.hoisted(() => ({
  remove: vi.fn(),
  setPinned: vi.fn(),
  restore: vi.fn(),
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
  cancelDownload: vi.fn(),
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
    useMutation: (options: { mutationFn: () => Promise<unknown> }) => ({
      isPending: false,
      mutate: () => {
        void options.mutationFn().catch(() => undefined);
      },
    }),
    // One virtual row per item, laid out exactly like the real virtualizer.
    useVirtualizer: ({ count }: { count: number }) => ({
      getTotalSize: () => count * 72,
      measureElement: () => undefined,
      getVirtualItems: () =>
        Array.from({ length: count }, (_, index) => ({
          index,
          key: index,
          start: index * 72,
          size: 72,
        })),
    }),
  };
});

vi.mock('@/lib/queryClient', () => ({ queryClient: { invalidateQueries: vi.fn() } }));
vi.mock('../../services/api/backups', () => ({
  backupsApi: {
    remove: (...args: unknown[]) => h.remove(...args),
    setPinned: (...args: unknown[]) => h.setPinned(...args),
    restore: (...args: unknown[]) => h.restore(...args),
  },
}));
vi.mock('../../services/api/servers', () => ({ serversApi: { stop: vi.fn(), get: vi.fn() } }));
vi.mock('../../utils/notify', () => ({
  notifyError: (...args: unknown[]) => h.notifyError(...args),
  notifySuccess: (...args: unknown[]) => h.notifySuccess(...args),
}));

import BackupList from './BackupList';

const makeBackup = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  createdAt: '2026-11-20T10:00:00.000Z',
  sizeMb: 10,
  path: `/backups/${name}.tar.gz`,
  storageMode: 'local',
  compressed: true,
  ...extra,
});

const backups = [
  makeBackup('b1', 'nightly'),
  makeBackup('b2', 'weekly'),
] as never[];

describe('BackupList bulk delete', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('deletes every selected backup sequentially through the existing endpoint', async () => {
    h.remove.mockResolvedValue({ success: true });
    render(<BackupList serverId="server-1" backups={backups} serverStatus="stopped" />);

    // Rows are selectable; the bulk bar only exists once something is picked.
    expect(screen.queryByText(/backups\.list\.selected/)).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'nightly' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'weekly' }));
    expect(screen.getByText(/backups\.list\.selected/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /backups\.bulkDelete\.action/ }));
    const dialog = within(await screen.findByRole('alertdialog'));
    // The count is in the confirmation, not just in the button.
    expect(dialog.getByText(/backups\.bulkDelete\.confirm/)).toBeTruthy();
    fireEvent.click(dialog.getByRole('button', { name: /backups\.bulkDelete\.action/ }));

    await waitFor(() => expect(h.remove).toHaveBeenCalledTimes(2));
    expect(h.remove.mock.calls).toEqual([
      ['server-1', 'b1'],
      ['server-1', 'b2'],
    ]);
    await waitFor(() => expect(h.notifySuccess).toHaveBeenCalled());
  });

  it('keeps deleting past a failure and reports the remainder', async () => {
    h.remove.mockReset();
    h.remove.mockRejectedValueOnce(new Error('locked')).mockResolvedValueOnce({ success: true });
    render(<BackupList serverId="server-1" backups={backups} serverStatus="stopped" />);

    fireEvent.click(screen.getByRole('checkbox', { name: 'backups.list.selectAll' }));
    fireEvent.click(screen.getByRole('button', { name: /backups\.bulkDelete\.action/ }));
    const dialog = within(await screen.findByRole('alertdialog'));
    fireEvent.click(dialog.getByRole('button', { name: /backups\.bulkDelete\.action/ }));

    await waitFor(() => expect(h.remove).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(h.notifyError).toHaveBeenCalled());
    // The failed row stays selected so it can be retried.
    expect(screen.getByText(/backups\.list\.selected/)).toBeTruthy();
  });
});

describe('BackupList download cancel', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('offers Cancel only on the row that is downloading', () => {
    const withProgress = [
      makeBackup('b1', 'nightly', { download: () => undefined, downloadProgress: '42%' }),
      makeBackup('b2', 'weekly', { download: () => undefined }),
    ] as never[];
    render(
      <BackupList
        serverId="server-1"
        backups={withProgress}
        serverStatus="stopped"
        onCancelDownload={h.cancelDownload}
      />,
    );

    const cancelButtons = screen.getAllByRole('button', { name: 'backups.download.cancel' });
    expect(cancelButtons).toHaveLength(1);
    fireEvent.click(cancelButtons[0]);
    expect(h.cancelDownload).toHaveBeenCalledWith('b1');
  });

  it('shows no Cancel button while nothing is downloading', () => {
    const idle = [makeBackup('b1', 'nightly', { download: () => undefined })] as never[];
    render(
      <BackupList serverId="server-1" backups={idle} serverStatus="stopped" onCancelDownload={h.cancelDownload} />,
    );
    expect(screen.queryByRole('button', { name: 'backups.download.cancel' })).toBeNull();
  });
});
