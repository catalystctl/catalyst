import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * D12: downloading a backup buffered the whole archive with no way out. The
 * section now passes an AbortController, and a user abort is reported as
 * "cancelled" — not as a failure, and not to the system-error log.
 */

const h = vi.hoisted(() => ({
  downloadWithSignal: vi.fn(),
  notifyInfo: vi.fn(),
  notifyError: vi.fn(),
  reportSystemError: vi.fn(),
  clearProgress: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/csync', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
    useQuery: () => ({ data: undefined }),
    useMutation: () => ({ isPending: false, mutate: vi.fn(), mutateAsync: vi.fn() }),
  };
});

vi.mock('../../hooks/useServer', () => ({
  useServer: () => ({
    data: {
      id: 'server-1',
      ownerId: 'user-1',
      backupStorageMode: 'local',
      backupAllocationMb: 4096,
      effectivePermissions: [],
    },
  }),
}));

vi.mock('../../hooks/useBackups', () => ({
  useBackups: () => ({
    data: {
      backups: [
        {
          id: 'backup-1',
          name: 'nightly',
          createdAt: '2026-11-20T10:00:00.000Z',
          sizeMb: 100,
          path: '/nightly.tar.gz',
          storageMode: 'local',
          compressed: true,
        },
      ],
      total: 1,
      totalPages: 1,
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

vi.mock('../../hooks/useSeedOnIdentity', async (importOriginal) => importOriginal<Record<string, unknown>>());

vi.mock('../../stores/authStore', () => ({
  useAuthStore: (selector: (s: { user: unknown }) => unknown) =>
    selector({ user: { id: 'user-1', permissions: ['*'] } }),
}));

vi.mock('../../stores/backupDownloadStore', () => ({
  useBackupDownloadStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      progressByBackup: {},
      setProgress: vi.fn(),
      clearProgress: h.clearProgress,
    }),
}));

vi.mock('../../services/api/backups', () => ({
  backupsApi: { downloadWithSignal: (...args: unknown[]) => h.downloadWithSignal(...args) },
}));
vi.mock('../../services/api/servers', () => ({ serversApi: { updateBackupSettings: vi.fn(), get: vi.fn(), stop: vi.fn() } }));
vi.mock('../../services/api/systemErrors', () => ({
  reportSystemError: (...args: unknown[]) => h.reportSystemError(...args),
}));
vi.mock('../../utils/notify', () => ({
  notifyError: (...args: unknown[]) => h.notifyError(...args),
  notifySuccess: vi.fn(),
  notifyInfo: (...args: unknown[]) => h.notifyInfo(...args),
}));

import BackupSection from './BackupSection';

describe('BackupSection cancellable download', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('passes an abort signal and reports a user abort as cancelled', async () => {
    // Capture the controller the section creates so the test can abort it the
    // way the row's Cancel button does, without reaching into component state.
    const RealAbortController = globalThis.AbortController;
    let created: AbortController | undefined;
    // A constructor that returns an object yields that object under `new`,
    // so the section gets a real controller while the test keeps a handle.
    const TrackedAbortController = function TrackedAbortController() {
      const controller = new RealAbortController();
      created = controller;
      return controller;
    } as unknown as typeof AbortController;
    vi.stubGlobal('AbortController', TrackedAbortController);

    // The download stays in flight until it is aborted, like a real one.
    h.downloadWithSignal.mockImplementation(
      (_serverId: string, _backupId: string, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );

    try {
      render(<BackupSection serverId="server-1" serverStatus="stopped" />);
      fireEvent.click(screen.getByRole('button', { name: 'common:actions.download' }));

      await waitFor(() => expect(h.downloadWithSignal).toHaveBeenCalled());
      const signal = h.downloadWithSignal.mock.calls[0][2] as AbortSignal;
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal.aborted).toBe(false);

      created?.abort();

      await waitFor(() => expect(h.clearProgress).toHaveBeenCalled());
      // A cancel is not an error and must not reach the error log.
      expect(h.reportSystemError).not.toHaveBeenCalled();
      expect(h.notifyError).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('reports a genuine failure as an error', async () => {
    h.downloadWithSignal.mockRejectedValue(new Error('connection reset'));
    render(<BackupSection serverId="server-1" serverStatus="stopped" />);
    fireEvent.click(screen.getByRole('button', { name: 'common:actions.download' }));

    await waitFor(() => expect(h.notifyError).toHaveBeenCalled());
    expect(h.reportSystemError).toHaveBeenCalled();
  });
});
