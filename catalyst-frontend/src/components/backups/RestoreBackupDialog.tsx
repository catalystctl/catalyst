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

function RestoreBackupDialog({
  serverId,
  backup,
  disabled,
}: {
  serverId: string;
  backup: Backup;
  disabled?: boolean;
}) {
  const { t } = useTranslation('server-tabs');
  const [open, setOpen] = useState(false);

  const mutation = useMutation({
    mutationFn: () => backupsApi.restore(serverId, backup.id),
    onSuccess: () => {
      notifySuccess(t('backups.restore.success'));
      setOpen(false);
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || t('backups.restore.failed');
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
        {t('backups.restore.action')}
      </Button>
      <ConfirmDialog
        open={open}
        title={t('backups.restore.title')}
        message={
          <>
            {t('backups.restore.confirmPrefix')}
            <span className="font-semibold text-foreground">{backup.name}</span>
            {t('backups.restore.confirmSuffix')}
          </>
        }
        confirmText={t('backups.restore.action')}
        variant="warning"
        loading={mutation.isPending || !!disabled}
        onConfirm={() => mutation.mutate()}
        onCancel={() => setOpen(false)}
      />
    </div>
  );
}

export default RestoreBackupDialog;
