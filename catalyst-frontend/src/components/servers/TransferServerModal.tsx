import { useState } from 'react';
import { useMutation } from '@/csync';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { serversApi } from '../../services/api/servers';
import type { BackupStorageMode } from '../../types/server';
import { useNodes } from '../../hooks/useNodes';
import { notifyError, notifySuccess } from '../../utils/notify';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
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
      notifySuccess('Transfer started');
      setOpen(false);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk.server(serverId) });
      queryClient.invalidateQueries({ queryKey: qk.servers() });
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
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Transfer server</DialogTitle>
            <DialogDescription>
              Transferring will reschedule workloads on the selected node.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <div className="space-y-2">
              <Label>Target node</Label>
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
            </div>
            <div className="space-y-2">
              <Label>Transfer storage</Label>
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
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending || !selectedTargetNodeId || !nodes.length || disabled}
            >
              Transfer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default TransferServerModal;
