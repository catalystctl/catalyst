import { useState } from 'react';
import { useMutation } from '@/csync';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { backupsApi } from '../../services/api/backups';
import { notifyError, notifySuccess } from '../../utils/notify';
import type { Backup } from '../../types/backup';
import { Button } from '@/components/ui/button';
import ConfirmDialog from '@/components/shared/ConfirmDialog';

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
      notifySuccess('Backup deleted');
      setOpen(false);
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to delete backup';
      notifyError(message);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk.backups(serverId) });
    },
  });

  return (
    <div>
      <Button
        variant="outline"
        size="sm"
        className="border-danger/20 text-danger hover:border-danger/40 hover:bg-danger/5"
        onClick={() => {
          if (!disabled) setOpen(true);
        }}
        disabled={disabled}
      >
        Delete
      </Button>
      <ConfirmDialog
        open={open}
        title="Delete backup"
        message={
          <>
            Delete <span className="font-semibold text-foreground">{backup.name}</span>? This action
            cannot be undone.
          </>
        }
        confirmText="Delete"
        variant="danger"
        loading={mutation.isPending}
        onConfirm={() => mutation.mutate()}
        onCancel={() => setOpen(false)}
      />
    </div>
  );
}

export default DeleteBackupDialog;
