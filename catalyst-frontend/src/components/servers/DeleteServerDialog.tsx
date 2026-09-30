import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useMutation } from '@/csync';
import type { Query } from '@/csync';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { isServerListQueryKey } from '@/lib/queryUtils';
import { serversApi } from '../../services/api/servers';
import { notifyError, notifySuccess } from '../../utils/notify';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

type Props = {
  serverId: string;
  serverName: string;
  disabled?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onDeleted?: () => void;
};

function DeleteServerDialog({ serverId, serverName, disabled = false, open: controlledOpen, onOpenChange, onDeleted }: Props) {
  const { t } = useTranslation('servers');
  const [internalOpen, setInternalOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setOpen = (value: boolean) => {
    if (!value) setConfirmation('');
    setInternalOpen(value);
    onOpenChange?.(value);
  };
  const mutation = useMutation({
    mutationFn: () => serversApi.delete(serverId),
    onMutate: async () => {
      await queryClient.cancelQueries({
        predicate: (q: Query<unknown, unknown>) => isServerListQueryKey(q.queryKey),
      });
      const prev = queryClient.getQueriesData({
        predicate: (q: Query<unknown, unknown>) => isServerListQueryKey(q.queryKey),
      });
      queryClient.setQueriesData(
        { predicate: (q: Query<unknown, unknown>) => isServerListQueryKey(q.queryKey) },
        (servers: unknown) =>
          Array.isArray(servers)
            ? (servers as Array<{ id: string }>).filter((s) => s.id !== serverId)
            : (servers as unknown),
      );
      queryClient.removeQueries({ queryKey: qk.server(serverId) });
      return { prev };
    },
    onSuccess: () => {
      notifySuccess(t('deleteServer.deleted'));
      setOpen(false);
      onDeleted?.();
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) {
        for (const [queryKey, data] of ctx.prev as Array<[unknown, unknown]>) {
          queryClient.setQueryData(queryKey as readonly unknown[], data);
        }
      }
      notifyError(err);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk.servers() });
      queryClient.invalidateQueries({ queryKey: qk.adminServers() });
    },
  });

  return (
    <>
      {controlledOpen === undefined && (
        <Button
          variant="destructive"
          size="sm"
          className="h-8 px-3 text-mini"
          onClick={() => { if (!disabled) setOpen(true); }}
          disabled={disabled}
        >
          {t('common:actions.delete')}
        </Button>
      )}
      <AlertDialog open={open} onOpenChange={(next) => { if (!mutation.isPending) setOpen(next); }}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteServer.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              <Trans ns="servers" i18nKey="deleteServer.confirm" values={{ name: serverName }}
                components={{ strong: <span className="font-semibold text-foreground" /> }} />
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 px-5 pb-2">
            <Label htmlFor="delete-server-confirm-name">{t('deleteServer.typeNameToConfirm', { name: serverName })}</Label>
            <Input id="delete-server-confirm-name" autoComplete="off" value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutation.isPending}>{t('common:actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={mutation.isPending || disabled || confirmation !== serverName}
              className="bg-danger text-danger-foreground hover:bg-danger/90" onClick={(event) => { event.preventDefault(); mutation.mutate(); }}>
              {t('common:actions.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default DeleteServerDialog;
