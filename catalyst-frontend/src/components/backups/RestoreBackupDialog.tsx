import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@/csync';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { backupsApi } from '../../services/api/backups';
import { serversApi } from '../../services/api/servers';
import { notifyError, notifySuccess } from '../../utils/notify';
import { getErrorMessage } from '../../utils/errors';
import type { Backup } from '../../types/backup';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Loader2 } from 'lucide-react';

/** How long we wait for the agent to confirm the container is down after stop. */
const STOP_TIMEOUT_MS = 90_000;
const STOP_POLL_MS = 1_500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Polls the server until the agent reports it stopped. `stop` resolves once the
 * graceful shutdown is accepted, but the container can still be tearing down;
 * restoring into a live container corrupts files, so this gate is not optional.
 */
async function waitForStopped(serverId: string): Promise<void> {
  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const server = await serversApi.get(serverId);
    if (server?.status === 'stopped') return;
    await sleep(STOP_POLL_MS);
  }
  throw new Error('STOP_TIMEOUT');
}

function RestoreBackupDialog({
  serverId,
  backup,
  disabled,
  isSuspended = false,
  serverStatus,
}: {
  serverId: string;
  backup: Backup;
  disabled?: boolean;
  /** A suspended server cannot be stopped or restored; the action stays locked. */
  isSuspended?: boolean;
  /** Live server status; anything but `stopped` offers "Stop server & restore". */
  serverStatus?: string;
}) {
  const { t } = useTranslation('server-tabs');
  const [open, setOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [step, setStep] = useState<'idle' | 'stopping'>('idle');
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    setOpen(false);
    setAcknowledged(false);
    setStep('idle');
    setError(null);
  };

  const needsStop = Boolean(serverStatus) && serverStatus !== 'stopped';
  const locked = Boolean(disabled) || isSuspended;

  const mutation = useMutation({
    mutationFn: async () => {
      if (needsStop) {
        setStep('stopping');
        setError(null);
        await serversApi.stop(serverId);
        try {
          await waitForStopped(serverId);
        } catch {
          // A stop that never lands must not be followed by a restore.
          throw new Error(t('backups.restore.stopTimeout'));
        } finally {
          setStep('idle');
        }
        void queryClient.invalidateQueries({ queryKey: qk.server(serverId) });
      }
      return backupsApi.restore(serverId, backup.id);
    },
    onSuccess: () => {
      notifySuccess(t('backups.restore.success'));
      close();
    },
    onError: (error: any) => {
      // The dialog stays open on a failed stop: the user can retry instead of
      // hunting the row down again.
      setStep('idle');
      setError(getErrorMessage(error, t('backups.restore.stopFailed')));
      notifyError(error);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk.backups(serverId) });
      queryClient.invalidateQueries({ queryKey: qk.server(serverId) });
    },
  });

  const busy = mutation.isPending;
  const stopping = step === 'stopping';

  return (
    <div>
      <Button
        variant="outline"
        size="sm"
        className="h-7 px-2 text-mini"
        onClick={() => setOpen(true)}
        disabled={locked}
        title={
          isSuspended
            ? t('backups.restore.blockedSuspended')
            : needsStop
              ? t('backups.restore.stopsServerFirst')
              : undefined
        }
      >
        {t('backups.restore.action')}
      </Button>
      <AlertDialog open={open} onOpenChange={(next) => { if (!busy && !next) close(); }}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('backups.restore.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('backups.restore.confirmPrefix')}
              <span className="font-semibold text-foreground">{backup.name}</span>
              {t('backups.restore.confirmSuffix')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {needsStop ? (
            <p
              className="mx-5 mt-1 rounded-sm border border-warning/30 bg-warning/5 px-3 py-2 text-mini text-warning"
              role="status"
            >
              {t('backups.restore.runningWarning')}
            </p>
          ) : null}
          <div className="flex items-start gap-2 px-5 py-2">
            <Checkbox id="restore-backup-acknowledge" checked={acknowledged} disabled={busy}
              onCheckedChange={(checked) => setAcknowledged(checked === true)} />
            <Label htmlFor="restore-backup-acknowledge" className="text-sm font-normal leading-relaxed">
              {t('backups.restore.acknowledgeOverwrite')}
            </Label>
          </div>
          {error ? (
            <p className="mx-5 mb-1 rounded-sm border border-danger/30 bg-danger/5 px-3 py-2 text-mini text-danger" role="alert">
              {error}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t('common:actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={!acknowledged || busy || locked}
              className="bg-warning text-warning-foreground hover:bg-warning/90" onClick={(event) => { event.preventDefault(); mutation.mutate(); }}>
              {busy ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  {stopping ? t('backups.restore.stopping') : t('backups.restore.restoring')}
                </>
              ) : needsStop ? (
                t('backups.restore.stopAndRestore')
              ) : (
                t('backups.restore.action')
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default RestoreBackupDialog;