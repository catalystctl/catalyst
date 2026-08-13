import { useState } from 'react';
import { useMutation } from '@/csync';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { backupsApi } from '../../services/api/backups';
import { notifyError, notifySuccess } from '../../utils/notify';
import type { Backup } from '../../types/backup';
import { ModalPortal } from '@/components/ui/modal-portal';

function DeleteBackupDialog({
 serverId,
 backup,
 disabled = false,
}: {
 serverId: string;
 backup: Backup;
 disabled?: boolean;
}) {
 const [open, setOpen] = useState(false);

 const mutation = useMutation({
 mutationFn: () => backupsApi.remove(serverId, backup.id),
 onSuccess: () => {
 notifySuccess('Backup deleted');
 setOpen(false);
 },
 onError: (error: any) => {
 const message = error?.response?.data?.error || 'Failed to delete backup';
 notifyError(message);
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.backups(serverId) });
 },
 });

 return (
 <div>
 <button
 className="rounded-md border border-danger/20 px-3 py-1 text-xs font-semibold text-danger transition-all duration-200 hover:border-danger/40 hover:bg-danger/5 disabled:opacity-50"
 onClick={() => {
 if (!disabled) setOpen(true);
 }}
 disabled={disabled}
 >
 Delete
 </button>
 {open ? (
 <ModalPortal>
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-0/70 px-4">
 <div className="w-full max-w-sm rounded-xl border border-border/40 bg-card p-6 shadow-elevated">
 <div className="text-lg font-semibold text-foreground">Delete backup</div>
 <p className="mt-2 text-sm text-muted-foreground">
 Delete <span className="font-semibold">{backup.name}</span>? This action cannot be undone.
 </p>
 <div className="mt-4 flex justify-end gap-2 text-xs">
 <button
 className="rounded-md border border-border/40 px-3 py-1 font-semibold text-muted-foreground transition-all duration-200 hover:border-primary/30 hover:text-foreground"
 onClick={() => setOpen(false)}
 >
 Cancel
 </button>
 <button
 className="rounded-md bg-danger px-4 py-2 font-semibold text-danger-foreground transition-all duration-200 hover:bg-danger/90 disabled:opacity-50"
 onClick={() => mutation.mutate()}
 disabled={mutation.isPending || disabled}
 >
 Delete
 </button>
 </div>
 </div>
 </div>
 </ModalPortal>
 ) : null}
 </div>
 );
}

export default DeleteBackupDialog;
