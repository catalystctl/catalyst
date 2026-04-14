import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { serversApi } from '../../services/api/servers';
import { notifyError, notifySuccess } from '../../utils/notify';
import { Button } from '@/components/ui/button';

type Props = {
  serverId: string;
  serverName: string;
  disabled?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

function DeleteServerDialog({ serverId, serverName, disabled = false, open: controlledOpen, onOpenChange }: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setOpen = (value: boolean) => {
    setInternalOpen(value);
    onOpenChange?.(value);
  };
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => serversApi.delete(serverId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      notifySuccess('Server deleted');
      setOpen(false);
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-xl">
            <div className="text-lg font-semibold text-foreground dark:text-white">Delete server</div>
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
      ) : null}
    </>
  );
}

export default DeleteServerDialog;
