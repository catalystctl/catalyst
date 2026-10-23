import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const h = vi.hoisted(() => ({
  create: vi.fn(),
  /** Whatever the availability query returns for the secondary-drive endpoint. */
  secondaryStatus: undefined as
    | { enabled?: boolean; supported?: boolean; label?: string | null }
    | undefined,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../../services/api/backups', () => ({
  backupsApi: { create: (...args: unknown[]) => h.create(...args) },
}));
vi.mock('../../utils/notify', () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));
vi.mock('@/lib/queryClient', () => ({ queryClient: { invalidateQueries: vi.fn() } }));
vi.mock('@/csync', () => ({
  useMutation: (options: { mutationFn: () => Promise<unknown> }) => ({
    isPending: false,
    mutate: () => { void options.mutationFn(); },
  }),
  useQuery: () => ({ data: h.secondaryStatus }),
}));

import CreateBackupModal from './CreateBackupModal';

const openDialog = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'backups.create.action' }));
  return within(await screen.findByRole('dialog'));
};

describe('CreateBackupModal compression toggle', () => {
  afterEach(cleanup);

  it('defaults to compressed', async () => {
    h.create.mockReset().mockResolvedValue({});
    render(<CreateBackupModal serverId="server-1" />);
    const dialog = await openDialog();
    const toggle = dialog.getByRole('checkbox');
    expect(toggle).toBeChecked();
    fireEvent.click(dialog.getByRole('button', { name: 'backups.create.action' }));
    expect(h.create).toHaveBeenCalledWith('server-1', { name: undefined, compressed: true });
  });

  it('sends compressed: false once the toggle is unchecked', async () => {
    h.create.mockReset().mockResolvedValue({});
    render(<CreateBackupModal serverId="server-1" />);
    const dialog = await openDialog();
    const toggle = dialog.getByRole('checkbox');
    fireEvent.click(toggle);
    expect(toggle).not.toBeChecked();
    fireEvent.click(dialog.getByRole('button', { name: 'backups.create.action' }));
    expect(h.create).toHaveBeenCalledWith('server-1', { name: undefined, compressed: false });
  });
});

describe('CreateBackupModal pin toggle', () => {
  afterEach(cleanup);

  it('hides the pin option without the backup.pin grant', async () => {
    h.create.mockReset().mockResolvedValue({});
    render(<CreateBackupModal serverId="server-1" />);
    const dialog = await openDialog();
    expect(dialog.getAllByRole('checkbox')).toHaveLength(1);
  });

  it('sends pinned: true when Ignore limit is checked', async () => {
    h.create.mockReset().mockResolvedValue({});
    render(<CreateBackupModal serverId="server-1" canPin />);
    const dialog = await openDialog();
    const boxes = dialog.getAllByRole('checkbox');
    expect(boxes).toHaveLength(2);
    fireEvent.click(boxes[0]);
    expect(boxes[0]).toBeChecked();
    fireEvent.click(dialog.getByRole('button', { name: 'backups.create.action' }));
    expect(h.create).toHaveBeenCalledWith('server-1', {
      name: undefined,
      compressed: true,
      pinned: true,
    });
  });
});

describe('CreateBackupModal secondary drive toggle', () => {
  afterEach(() => {
    cleanup();
    h.secondaryStatus = undefined;
  });

  it('hides the option when no drive is enabled', async () => {
    h.create.mockReset().mockResolvedValue({});
    render(<CreateBackupModal serverId="server-1" />);
    const dialog = await openDialog();
    expect(dialog.getAllByRole('checkbox')).toHaveLength(1);
  });

  it('hides the option when the storage mode cannot use it', async () => {
    h.secondaryStatus = { enabled: true, supported: false };
    h.create.mockReset().mockResolvedValue({});
    render(<CreateBackupModal serverId="server-1" />);
    const dialog = await openDialog();
    expect(dialog.getAllByRole('checkbox')).toHaveLength(1);
  });

  it('sends secondaryDrive: true when enabled and ticked', async () => {
    h.secondaryStatus = { enabled: true, supported: true, label: 'backup-drive' };
    h.create.mockReset().mockResolvedValue({});
    render(<CreateBackupModal serverId="server-1" />);
    const dialog = await openDialog();
    const boxes = dialog.getAllByRole('checkbox');
    // Secondary option renders before the compression toggle.
    expect(boxes).toHaveLength(2);
    fireEvent.click(boxes[0]);
    expect(boxes[0]).toBeChecked();
    fireEvent.click(dialog.getByRole('button', { name: 'backups.create.action' }));
    expect(h.create).toHaveBeenCalledWith('server-1', {
      name: undefined,
      compressed: true,
      secondaryDrive: true,
    });
  });
});
