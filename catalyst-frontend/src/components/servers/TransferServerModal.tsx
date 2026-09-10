import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('servers');
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
      notifySuccess(t('transferServer.started'));
      setOpen(false);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk.server(serverId) });
      queryClient.invalidateQueries({ queryKey: qk.servers() });
    },
    onError: (error) => notifyError(error),
  });

  return (
    <div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => { if (!disabled) setOpen(true); }}
        disabled={disabled}
      >
        {t('transferServer.transfer')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>{t('transferServer.title')}</DialogTitle>
            <DialogDescription>
              {t('transferServer.description')}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <div className="space-y-2">
              <Label>{t('transferServer.targetNode')}</Label>
              <Select
                value={selectedTargetNodeId}
                onValueChange={setTargetNodeId}
                disabled={nodesLoading || !nodes.length}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t('transferServer.selectNode')} />
                </SelectTrigger>
                <SelectContent>
                  {!nodes.length && <SelectItem value="__none" disabled>{t('transferServer.noNodes')}</SelectItem>}
                  {nodes.map((n) => (
                    <SelectItem key={n.id} value={n.id}>{n.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t('transferServer.storage')}</Label>
              <Select
                value={transferMode}
                onValueChange={(v) => setTransferMode(v as BackupStorageMode)}
                disabled={disabled}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="local">{t('transferServer.modeLocal')}</SelectItem>
                  <SelectItem value="s3">S3</SelectItem>
                  <SelectItem value="stream">{t('transferServer.modeStream')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending || !selectedTargetNodeId || !nodes.length || disabled}
            >
              {t('transferServer.transfer')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default TransferServerModal;
