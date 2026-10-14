import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const create = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../../services/api/backups', () => ({
  backupsApi: { create: (...args: unknown[]) => create(...args) },
}));
vi.mock('../../utils/notify', () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));
vi.mock('@/lib/queryClient', () => ({ queryClient: { invalidateQueries: vi.fn() } }));
vi.mock('@/csync', () => ({
  useMutation: (options: { mutationFn: () => Promise<unknown> }) => ({
    isPending: false,
    mutate: () => { void options.mutationFn(); },
  }),
}));

import CreateBackupModal from './CreateBackupModal';

const openDialog = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'backups.create.action' }));
  return within(await screen.findByRole('dialog'));
};

describe('CreateBackupModal compression toggle', () => {
  afterEach(cleanup);

  it('defaults to compressed', async () => {
    create.mockReset().mockResolvedValue({});
    render(<CreateBackupModal serverId="server-1" />);
    const dialog = await openDialog();
    const toggle = dialog.getByRole('checkbox');
    expect(toggle).toBeChecked();
    fireEvent.click(dialog.getByRole('button', { name: 'backups.create.action' }));
    expect(create).toHaveBeenCalledWith('server-1', { name: undefined, compressed: true });
  });

  it('sends compressed: false once the toggle is unchecked', async () => {
    create.mockReset().mockResolvedValue({});
    render(<CreateBackupModal serverId="server-1" />);
    const dialog = await openDialog();
    const toggle = dialog.getByRole('checkbox');
    fireEvent.click(toggle);
    expect(toggle).not.toBeChecked();
    fireEvent.click(dialog.getByRole('button', { name: 'backups.create.action' }));
    expect(create).toHaveBeenCalledWith('server-1', { name: undefined, compressed: false });
  });
});

describe('CreateBackupModal pin toggle', () => {
  afterEach(cleanup);

  it('hides the pin option without the backup.pin grant', async () => {
    create.mockReset().mockResolvedValue({});
    render(<CreateBackupModal serverId="server-1" />);
    const dialog = await openDialog();
    expect(dialog.getAllByRole('checkbox')).toHaveLength(1);
  });

  it('sends pinned: true when Ignore limit is checked', async () => {
    create.mockReset().mockResolvedValue({});
    render(<CreateBackupModal serverId="server-1" canPin />);
    const dialog = await openDialog();
    const boxes = dialog.getAllByRole('checkbox');
    expect(boxes).toHaveLength(2);
    fireEvent.click(boxes[0]);
    expect(boxes[0]).toBeChecked();
    fireEvent.click(dialog.getByRole('button', { name: 'backups.create.action' }));
    expect(create).toHaveBeenCalledWith('server-1', {
      name: undefined,
      compressed: true,
      pinned: true,
    });
  });
});
