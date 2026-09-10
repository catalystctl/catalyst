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

  const mutation = useMutation({
    mutationFn: () => backupsApi.create(serverId, { name: name.trim() || undefined }),
    onSuccess: () => {
      notifySuccess(t('backups.create.success'));
      setOpen(false);
      setName('');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || t('backups.create.failed');
      notifyError(message);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk.backups(serverId) });
    },
  });

  return (
    <div>
      <Button
        type="button"
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
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || disabled}>
              {t('backups.create.action')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default CreateBackupModal;
