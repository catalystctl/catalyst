import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@/csync';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { backupsApi } from '../../services/api/backups';
import { notifyError, notifySuccess } from '../../utils/notify';
import type { Backup } from '../../types/backup';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

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
  const [acknowledged, setAcknowledged] = useState(false);
  const close = () => { setOpen(false); setAcknowledged(false); };

  const mutation = useMutation({
    mutationFn: () => backupsApi.restore(serverId, backup.id),
    onSuccess: () => {
      notifySuccess(t('backups.restore.success'));
      close();
    },
    onError: (error: any) => {
      notifyError(error);
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
        className="h-7 px-2 text-mini"
        onClick={() => setOpen(true)}
        disabled={disabled}
      >
        {t('backups.restore.action')}
      </Button>
      <AlertDialog open={open} onOpenChange={(next) => { if (!mutation.isPending && !next) close(); }}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('backups.restore.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('backups.restore.confirmPrefix')}
              <span className="font-semibold text-foreground">{backup.name}</span>
              {t('backups.restore.confirmSuffix')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-start gap-2 px-5 pb-2">
            <Checkbox id="restore-backup-acknowledge" checked={acknowledged}
              onCheckedChange={(checked) => setAcknowledged(checked === true)} />
            <Label htmlFor="restore-backup-acknowledge" className="text-sm font-normal leading-relaxed">
              {t('backups.restore.acknowledgeOverwrite')}
            </Label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutation.isPending}>{t('common:actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={!acknowledged || mutation.isPending || !!disabled}
              className="bg-warning text-warning-foreground hover:bg-warning/90" onClick={(event) => { event.preventDefault(); mutation.mutate(); }}>
              {t('backups.restore.action')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default RestoreBackupDialog;
