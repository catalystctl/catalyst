import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('server-tabs');
  const [open, setOpen] = useState(false);

  const mutation = useMutation({
    mutationFn: () => backupsApi.remove(serverId, backup.id),
    onSuccess: () => {
      notifySuccess(t('backups.delete.success'));
      setOpen(false);
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || t('backups.delete.failed');
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
        {t('common:actions.delete')}
      </Button>
      <ConfirmDialog
        open={open}
        title={t('backups.delete.title')}
        message={
          <>
            {t('backups.delete.confirmPrefix')}
            <span className="font-semibold text-foreground">{backup.name}</span>
            {t('backups.delete.confirmSuffix')}
          </>
        }
        confirmText={t('common:actions.delete')}
        variant="danger"
        loading={mutation.isPending}
        onConfirm={() => mutation.mutate()}
        onCancel={() => setOpen(false)}
      />
    </div>
  );
}

export default DeleteBackupDialog;
