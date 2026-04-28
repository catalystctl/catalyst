import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { serversApi } from '../../services/api/servers';
import { notifyError, notifySuccess } from '../../utils/notify';
import { Button } from '@/components/ui/button';
import { ModalPortal } from '@/components/ui/modal-portal';

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
    onSuccess: () => {
      queryClient.invalidateQueries({
        predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === 'servers',
      });
      queryClient.invalidateQueries({
        predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === 'admin-servers',
      });
      queryClient.removeQueries({ queryKey: qk.server(serverId) });
      notifySuccess('Server deleted');
      setOpen(false);
      onDeleted?.();
    },
    onError: () => notifyError('Failed to delete server'),
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
      {open ? (
        <ModalPortal>
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 px-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-xl">
            <div className="text-lg font-semibold text-foreground">Delete server</div>
            <p className="mt-2 text-sm text-muted-foreground">
              Are you sure you want to delete <span className="font-semibold text-foreground">{serverName}</span>? This
              action cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2 text-xs">
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending || disabled}
              >
                Delete
              </Button>
            </div>
          </div>
        </div>
        </ModalPortal>
      ) : null}
    </>
  );
}

export default DeleteServerDialog;
