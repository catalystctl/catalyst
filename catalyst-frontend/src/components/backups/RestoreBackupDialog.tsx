import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { backupsApi } from '../../services/api/backups';
import { notifyError, notifySuccess } from '../../utils/notify';
import type { Backup } from '../../types/backup';
import { ModalPortal } from '@/components/ui/modal-portal';

function RestoreBackupDialog({
  serverId,
  backup,
  disabled,
}: {
  serverId: string;
  backup: Backup;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  const mutation = useMutation({
    mutationFn: () => backupsApi.restore(serverId, backup.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backups', serverId] });
      queryClient.invalidateQueries({ queryKey: qk.server(serverId) });
      notifySuccess('Backup restoration started');
      setOpen(false);
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to restore backup';
      notifyError(message);
    },
  });

  return (
    <div>
      <button
        className="rounded-md border border-border px-3 py-1 text-xs font-semibold text-muted-foreground transition-all duration-300 hover:border-primary hover:text-foreground disabled:opacity-60 dark:border-border dark:hover:border-primary/30"
        onClick={() => setOpen(true)}
        disabled={disabled}
      >
        Restore
      </button>
      {open ? (
        <ModalPortal>
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 px-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-xl dark:border-border dark:bg-surface-0">
            <div className="text-lg font-semibold text-foreground">Restore backup</div>
            <p className="mt-2 text-sm text-muted-foreground">
              Restore <span className="font-semibold">{backup.name}</span> to this server? The server must be stopped
              before restoring and current files will be overwritten.
            </p>
            <div className="mt-4 flex justify-end gap-2 text-xs">
              <button
                className="rounded-md border border-border px-3 py-1 font-semibold text-muted-foreground transition-all duration-300 hover:border-primary hover:text-foreground dark:border-border dark:hover:border-primary/30"
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-primary px-4 py-2 font-semibold text-primary-foreground shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary/90 disabled:opacity-60"
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending || disabled}
              >
                Restore
              </button>
            </div>
          </div>
        </div>
        </ModalPortal>
      ) : null}
    </div>
  );
}

export default RestoreBackupDialog;
