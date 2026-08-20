import { useState } from 'react';
import { useMutation } from '@/csync';
import type { Query } from '@/csync';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { isServerListQueryKey } from '@/lib/queryUtils';
import { serversApi } from '../../services/api/servers';
import { notifyError, notifySuccess } from '../../utils/notify';
import { Button } from '@/components/ui/button';
import ConfirmDialog from '@/components/shared/ConfirmDialog';

type Props = {
  serverId: string;
  serverName: string;
  disabled?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onDeleted?: () => void;
};

function DeleteServerDialog({ serverId, serverName, disabled = false, open: controlledOpen, onOpenChange, onDeleted }: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setOpen = (value: boolean) => {
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
      notifySuccess('Server deleted');
      setOpen(false);
      onDeleted?.();
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) {
        for (const [queryKey, data] of ctx.prev as Array<[unknown, unknown]>) {
          queryClient.setQueryData(queryKey as readonly unknown[], data);
        }
      }
      notifyError('Failed to delete server');
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
          onClick={() => { if (!disabled) setOpen(true); }}
          disabled={disabled}
        >
          Delete
        </Button>
      )}
      <ConfirmDialog
        open={open}
        title="Delete server"
        message={
          <>
            Are you sure you want to delete{' '}
            <span className="font-semibold text-foreground">{serverName}</span>? This action cannot
            be undone.
          </>
        }
        confirmText="Delete"
        variant="danger"
        loading={mutation.isPending || disabled}
        onConfirm={() => mutation.mutate()}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

export default DeleteServerDialog;
