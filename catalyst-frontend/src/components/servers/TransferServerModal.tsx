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
import { cn } from '@/lib/utils';
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

/** Deck field chrome — 4px radius, 32px control height, mini type ramp. */
const selectClass =
  'h-8 w-full rounded-sm border-border/60 bg-background/40 px-2.5 text-mini text-foreground focus:border-primary focus:ring-1 focus:ring-primary/40';
/** Labelled block on the dialog surface — never a nested rounded card. */
const blockClass = 'rounded-sm border border-border/50 bg-surface-1/40 p-3';
/** 1px separator for stacked fields inside a block. */
const dividerClass = 'border-t border-border/50 pt-3';

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
        className="h-8 px-3 text-mini"
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
            <div className={`${blockClass} space-y-3`}>
              <div className="space-y-1.5">
                <Label compact>{t('transferServer.targetNode')}</Label>
                <Select
                  value={selectedTargetNodeId}
                  onValueChange={setTargetNodeId}
                  disabled={nodesLoading || !nodes.length}
                >
                  <SelectTrigger className={selectClass}>
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
              <div className={cn('space-y-1.5', dividerClass)}>
                <Label compact>{t('transferServer.storage')}</Label>
                <Select
                  value={transferMode}
                  onValueChange={(v) => setTransferMode(v as BackupStorageMode)}
                  disabled={disabled}
                >
                  <SelectTrigger className={selectClass}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="local">{t('transferServer.modeLocal')}</SelectItem>
                    <SelectItem value="s3">S3</SelectItem>
                    <SelectItem value="stream">{t('transferServer.modeStream')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" size="sm" className="h-8 px-3 text-mini" onClick={() => setOpen(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button
              size="sm"
              className="h-8 px-3 text-mini"
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
