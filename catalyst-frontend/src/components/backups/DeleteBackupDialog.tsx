import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { backupsApi } from '../../services/api/backups';
import { notifyError, notifySuccess } from '../../utils/notify';
import type { Backup } from '../../types/backup';
import { ModalPortal } from '@/components/ui/modal-portal';

function DeleteBackupDialog({
  serverId,
  backup,
  disabled = false,
}: {
  serverId: string;
  backup: Backup;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  const mutation = useMutation({
    mutationFn: () => backupsApi.remove(serverId, backup.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backups', serverId] });
      notifySuccess('Backup deleted');
      setOpen(false);
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to delete backup';
      notifyError(message);
    },
  });

  return (
    <div>
      <button
        className="rounded-md border border-destructive px-3 py-1 text-xs font-semibold text-destructive-foreground hover:border-destructive disabled:opacity-60"
        onClick={() => {
          if (!disabled) setOpen(true);
        }}
        disabled={disabled}
      >
        Delete
      </button>
      {open ? (
        <ModalPortal>
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-sm rounded-xl border border-border dark:border-border bg-card dark:bg-surface-0 p-6 shadow-xl">
            <div className="text-lg font-semibold text-foreground">Delete backup</div>
            <p className="mt-2 text-sm text-muted-foreground">
              Delete <span className="font-semibold">{backup.name}</span>? This action cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2 text-xs">
              <button
                className="rounded-md border border-border dark:border-border px-3 py-1 font-semibold text-muted-foreground hover:border-border dark:border-border"
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-destructive px-4 py-2 font-semibold text-destructive-foreground shadow hover:bg-destructive disabled:opacity-60"
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending || disabled}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
        </ModalPortal>
      ) : null}
    </div>
  );
}

export default DeleteBackupDialog;
