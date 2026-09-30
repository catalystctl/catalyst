import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const restore = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../../services/api/backups', () => ({ backupsApi: { restore: (...args: unknown[]) => restore(...args) } }));
vi.mock('../../utils/notify', () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));
vi.mock('@/lib/queryClient', () => ({ queryClient: { invalidateQueries: vi.fn() } }));
vi.mock('@/csync', () => ({
  useMutation: (options: { mutationFn: () => Promise<unknown> }) => ({
    isPending: false,
    mutate: () => { void options.mutationFn(); },
  }),
}));

import RestoreBackupDialog from './RestoreBackupDialog';

describe('RestoreBackupDialog overwrite acknowledgement', () => {
  afterEach(cleanup);

  it('requires acknowledging the overwrite before restoring', async () => {
    restore.mockReset().mockResolvedValue({});
    render(
      <RestoreBackupDialog
        serverId="server-1"
        backup={{ id: 'backup-1', name: 'nightly' } as never}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'backups.restore.action' }));
    const acknowledge = await screen.findByLabelText('backups.restore.acknowledgeOverwrite');
    // The page behind the modal dialog is aria-hidden, so only the dialog's
    // own action button is exposed under this name.
    const confirm = screen.getByRole('button', { name: 'backups.restore.action' });
    expect(confirm).toBeDisabled();
    fireEvent.click(acknowledge);
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(restore).toHaveBeenCalledWith('server-1', 'backup-1');
  });
});
