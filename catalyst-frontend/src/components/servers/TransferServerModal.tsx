import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { serversApi } from '../../services/api/servers';
import type { BackupStorageMode } from '../../types/server';
import { useNodes } from '../../hooks/useNodes';
import { notifyError, notifySuccess } from '../../utils/notify';
import { Button } from '@/components/ui/button';
import { ModalPortal } from '@/components/ui/modal-portal';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type Props = {
  serverId: string;
  disabled?: boolean;
};

function TransferServerModal({ serverId, disabled = false }: Props) {
  const [open, setOpen] = useState(false);
  const [targetNodeId, setTargetNodeId] = useState('');
  const [transferMode, setTransferMode] = useState<BackupStorageMode>('local');
  const { data: nodes = [], isLoading: nodesLoading } = useNodes();
  const selectedTargetNodeId = targetNodeId || nodes[0]?.id || '';

  const mutation = useMutation({
    mutationFn: () => serversApi.transfer(serverId, {
      targetNodeId: selectedTargetNodeId,
      transferMode,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.server(serverId) });
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      notifySuccess('Transfer started');
      setOpen(false);
    },
    onError: () => notifyError('Failed to transfer server'),
  });

  return (
    <div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => { if (!disabled) setOpen(true); }}
        disabled={disabled}
      >
        Transfer
      </Button>
      {open ? (
        <ModalPortal>
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">Transfer server</h2>
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Close</Button>
            </div>
            <div className="mt-4 space-y-3 text-sm text-muted-foreground">
              <label className="block space-y-1">
                <span className="text-xs font-medium">Target node</span>
                <Select
                  value={selectedTargetNodeId}
                  onValueChange={setTargetNodeId}
                  disabled={nodesLoading || !nodes.length}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select node" />
                  </SelectTrigger>
                  <SelectContent>
                    {!nodes.length && <SelectItem value="__none" disabled>No nodes available</SelectItem>}
                    {nodes.map((n) => (
                      <SelectItem key={n.id} value={n.id}>{n.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium">Transfer storage</span>
                <Select
                  value={transferMode}
                  onValueChange={(v) => setTransferMode(v as BackupStorageMode)}
                  disabled={disabled}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="local">Shared filesystem</SelectItem>
                    <SelectItem value="s3">S3</SelectItem>
                    <SelectItem value="stream">Stream</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <p className="text-xs text-muted-foreground">
                Transferring will reschedule workloads on the selected node.
              </p>
            </div>
            <div className="mt-4 flex justify-end gap-2 text-xs">
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending || !selectedTargetNodeId || !nodes.length || disabled}
              >
                Transfer
              </Button>
            </div>
          </div>
        </div>
        </ModalPortal>
      ) : null}
    </div>
  );
}

export default TransferServerModal;
