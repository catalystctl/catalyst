import { useState } from 'react';
import { useMutation } from '@/csync';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { backupsApi } from '../../services/api/backups';
import { notifyError, notifySuccess } from '../../utils/notify';
import type { Backup } from '../../types/backup';
import { Button } from '@/components/ui/button';
import ConfirmDialog from '@/components/shared/ConfirmDialog';

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
      notifySuccess('Backup restoration started');
      setOpen(false);
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to restore backup';
      notifyError(message);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk.backups(serverId) });
      queryClient.invalidateQueries({ queryKey: qk.server(serverId) });
    },
  });

  return (
    <div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={disabled}
      >
        Restore
      </Button>
      <ConfirmDialog
        open={open}
        title="Restore backup"
        message={
          <>
            Restore <span className="font-semibold text-foreground">{backup.name}</span> to this
            server? The server must be stopped before restoring and current files will be
            overwritten.
          </>
        }
        confirmText="Restore"
        variant="warning"
        loading={mutation.isPending || !!disabled}
        onConfirm={() => mutation.mutate()}
        onCancel={() => setOpen(false)}
      />
    </div>
  );
}

export default RestoreBackupDialog;
