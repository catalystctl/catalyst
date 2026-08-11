import { useState } from 'react';
import { useMutation } from '@/csync';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { backupsApi } from '../../services/api/backups';
import { notifyError, notifySuccess } from '../../utils/notify';
import { ModalPortal } from '@/components/ui/modal-portal';

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
 <button
 type="button"
 className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-all duration-300 hover:bg-primary/90 disabled:opacity-60"
 onClick={() => {
 if (!disabled) setOpen(true);
 }}
 disabled={disabled}
 >
 Create Backup
 </button>
 {open ? (
 <ModalPortal>
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 px-4">
 <div className="w-full max-w-md rounded-xl border border-border/40 bg-card p-6 shadow-xl">
 <div className="flex items-center justify-between">
 <h2 className="text-lg font-semibold text-foreground">Create backup</h2>
 <button
 className="rounded-md border border-border/40 px-2 py-1 text-xs text-muted-foreground transition-all duration-200 hover:border-primary/30 hover:text-foreground"
 onClick={() => setOpen(false)}
 >
 Close
 </button>
 </div>
 <div className="mt-4 space-y-3 text-sm text-foreground">
 <label className="block space-y-1">
 <span className="text-muted-foreground">Backup name (optional)</span>
 <input
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-foreground transition-colors focus:border-primary focus:outline-none"
 value={name}
 onChange={(event) => setName(event.target.value)}
 placeholder="nightly-backup"
 />
 </label>
 <p className="text-xs text-muted-foreground">
 Leave blank to auto-generate a name with the current timestamp.
 </p>
 </div>
 <div className="mt-5 flex justify-end gap-2 text-xs">
 <button
 className="rounded-md border border-border/40 px-3 py-1 font-semibold text-muted-foreground transition-all duration-200 hover:border-primary/30 hover:text-foreground"
 onClick={() => setOpen(false)}
 >
 Cancel
 </button>
 <button
 className="rounded-md bg-primary px-4 py-2 font-semibold text-primary-foreground transition-all duration-300 hover:bg-primary/90 disabled:opacity-60"
 onClick={() => mutation.mutate()}
 disabled={mutation.isPending || disabled}
 >
 Create
 </button>
 </div>
 </div>
 </div>
 </ModalPortal>
 ) : null}
 </div>
 );
}

export default CreateBackupModal;
