import { useState } from 'react';
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
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');

  const mutation = useMutation({
    mutationFn: () => backupsApi.create(serverId, { name: name.trim() || undefined }),
    onSuccess: () => {
      notifySuccess('Backup creation started');
      setOpen(false);
      setName('');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to create backup';
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
        Create backup
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Create backup</DialogTitle>
            <DialogDescription>
              Leave blank to auto-generate a name with the current timestamp.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="create-backup-name">Backup name (optional)</Label>
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
              Cancel
            </Button>
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || disabled}>
              Create backup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default CreateBackupModal;
