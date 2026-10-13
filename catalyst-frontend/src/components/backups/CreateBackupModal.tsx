import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@/csync';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { backupsApi } from '../../services/api/backups';
import { notifyError, notifySuccess } from '../../utils/notify';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

function CreateBackupModal({ serverId, disabled = false }: { serverId: string; disabled?: boolean }) {
  const { t } = useTranslation('server-tabs');
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  // Compression is opt-out: checked by default, uncheck for a plain `.tar`.
  const [compress, setCompress] = useState(true);

  const mutation = useMutation({
    mutationFn: () =>
      backupsApi.create(serverId, { name: name.trim() || undefined, compressed: compress }),
    onSuccess: () => {
      notifySuccess(t('backups.create.success'));
      setOpen(false);
      setName('');
      setCompress(true);
    },
    onError: (error: any) => {
      notifyError(error);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk.backups(serverId) });
    },
  });

  return (
    <div>
      <Button
        type="button"
        size="sm"
        className="h-8 px-3 text-mini"
        onClick={() => {
          if (!disabled) setOpen(true);
        }}
        disabled={disabled}
      >
        {t('backups.create.action')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>{t('backups.create.title')}</DialogTitle>
            <DialogDescription>
              {t('backups.create.description')}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="create-backup-name">{t('backups.create.nameLabel')}</Label>
              <Input
                id="create-backup-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="nightly-backup"
              />
            </div>
            <div className="flex items-start gap-2">
              <Checkbox
                id="create-backup-compress"
                checked={compress}
                onCheckedChange={(value) => setCompress(value === true)}
                className="mt-0.5"
              />
              <label htmlFor="create-backup-compress" className="min-w-0 cursor-pointer">
                <span className="block text-mini text-foreground">
                  {t('backups.create.compressLabel')}
                </span>
                <span className="block text-micro text-muted-foreground">
                  {t('backups.create.compressHint')}
                </span>
              </label>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" className="h-8 px-3 text-mini" onClick={() => setOpen(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button
              size="sm"
              className="h-8 px-3 text-mini"
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending || disabled}
            >
              {t('backups.create.action')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default CreateBackupModal;
