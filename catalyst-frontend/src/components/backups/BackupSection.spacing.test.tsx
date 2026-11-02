import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

/**
 * Regression guard for the reported bug: on the Backups tab the "Save settings"
 * row sat flush (0px) against the field grid above it, while every other
 * boundary in that card separates by 12px.
 *
 * The card's blocks — the retention grid, the per-mode config grid and the save
 * row — live in one `space-y-3` container so they share the section header's
 * 12px rhythm. If that wrapper is dropped again, these assertions fail.
 */

const h = vi.hoisted(() => ({
  storageMode: 's3' as 's3' | 'sftp' | 'local' | 'stream',
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/csync', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const client = {
    invalidateQueries: vi.fn(),
    setQueryData: vi.fn(),
    getQueryData: vi.fn(),
    cancelQueries: vi.fn(),
  };
  return {
    ...actual,
    useQueryClient: () => client,
    useQuery: () => ({ data: undefined, isLoading: false, isError: false }),
    useMutation: () => ({ isPending: false, mutate: vi.fn() }),
  };
});

vi.mock('../../hooks/useServer', () => ({
  useServer: () => ({
    data: {
      id: 'server-1',
      ownerId: 'user-1',
      backupStorageMode: h.storageMode,
      backupRetentionCount: 5,
      backupRetentionDays: 7,
      backupAllocationMb: 0,
      effectivePermissions: [],
    },
  }),
}));

vi.mock('../../hooks/useBackups', () => ({
  useBackups: () => ({
    data: { backups: [], total: 0, totalPages: 1 },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

vi.mock('../../hooks/useSeedOnIdentity', async (importOriginal) =>
  importOriginal<Record<string, unknown>>(),
);

vi.mock('../../stores/authStore', () => ({
  useAuthStore: (selector: (s: { user: unknown }) => unknown) =>
    selector({ user: { id: 'user-1', permissions: ['*'] } }),
}));

vi.mock('../../stores/backupDownloadStore', () => ({
  useBackupDownloadStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      progressByBackup: {},
      setProgress: vi.fn(),
      clearProgress: vi.fn(),
    }),
}));

vi.mock('../../services/api/backups', () => ({ backupsApi: { download: vi.fn() } }));
vi.mock('../../services/api/servers', () => ({ serversApi: { updateBackupSettings: vi.fn() } }));
vi.mock('../../services/api/systemErrors', () => ({ reportSystemError: vi.fn() }));
vi.mock('../../utils/notify', () => ({
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
  notifyInfo: vi.fn(),
}));

import BackupSection from './BackupSection';

const renderSection = () => render(<BackupSection serverId="server-1" serverStatus="running" />);

/** The save row and the rhythm container that owns every block in the card. */
const saveRow = () => {
  const button = screen.getByRole('button', { name: 'backups.settings.save' });
  return button.parentElement as HTMLElement;
};

describe('BackupSection settings card spacing', () => {
  afterEach(cleanup);

  it('puts the save row and the field grids in one 12px rhythm container', () => {
    renderSection();
    const row = saveRow();
    const wrapper = row.parentElement as HTMLElement;

    // The row itself carries no margin: the gap comes from the container, so
    // it cannot drift from the other blocks in the card.
    expect(wrapper).toHaveClass('space-y-3');
    expect(row).not.toHaveClass('mt-3');

    // Every block in the card is a child of that container: the retention grid,
    // the mode-specific config grid and the save row.
    const siblings = Array.from(wrapper.children) as HTMLElement[];
    expect(siblings.length).toBeGreaterThanOrEqual(2);
    expect(siblings[siblings.length - 1]).toBe(row);
    expect(siblings[0].tagName).toBe('DIV');
    expect(siblings[0]).toHaveClass('grid');
  });

  it('keeps the per-mode config grid inside the same rhythm container', () => {
    h.storageMode = 'sftp';
    renderSection();
    const row = saveRow();
    const wrapper = row.parentElement as HTMLElement;
    expect(wrapper).toHaveClass('space-y-3');

    // sftp renders two grids; both must be direct children of the container so
    // the boundary between them is spaced too (it was 0px before the fix).
    const grids = Array.from(wrapper.children).filter((c) =>
      (c as HTMLElement).className.includes('grid'),
    );
    expect(grids.length).toBe(2);
    h.storageMode = 's3';
  });

  it('keeps the section header outside the rhythm container', () => {
    renderSection();
    const row = saveRow();
    const wrapper = row.parentElement as HTMLElement;
    // The header keeps its own mb-3; wrapping it too would double the gap.
    expect(wrapper.previousElementSibling).not.toBeNull();
    expect(wrapper.previousElementSibling?.className).toContain('mb-3');
  });
});
