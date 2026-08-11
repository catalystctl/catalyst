import { useState } from 'react';
import { useMutation } from '@/csync';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { templatesApi } from '../../services/api/templates';
import { notifyError, notifySuccess } from '../../utils/notify';
import { ModalPortal } from '@/components/ui/modal-portal';

type Props = {
 templateId: string;
 templateName: string;
 onDeleted?: () => void;
 buttonClassName?: string;
 open?: boolean;
 onOpenChange?: (open: boolean) => void;
};

function TemplateDeleteDialog({ templateId, templateName, onDeleted, buttonClassName, open: controlledOpen, onOpenChange }: Props) {
 const [internalOpen, setInternalOpen] = useState(false);
 const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
 const setOpen = (value: boolean) => {
 setInternalOpen(value);
 onOpenChange?.(value);
 };
 const mutation = useMutation({
 mutationFn: () => templatesApi.remove(templateId),
 onSuccess: () => {
 notifySuccess('Template deleted');
 setOpen(false);
 onDeleted?.();
 },
 onError: (error: any) => {
 const message = error?.response?.data?.error || 'Failed to delete template';
 notifyError(message);
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.templates() });
 queryClient.invalidateQueries({ queryKey: qk.template(templateId) });
 },
 });

 return (
 <>
 {controlledOpen === undefined && (
 <button
 className={
 buttonClassName ||
 'rounded-md bg-destructive px-3 py-1 text-xs font-semibold text-destructive-foreground transition-colors hover:bg-destructive/90'
 }
 onClick={() => setOpen(true)}
 >
 Delete
 </button>
 )}
 {open ? (
 <ModalPortal>
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 px-4">
 <div className="w-full max-w-sm rounded-xl border border-border/30 bg-card p-6 shadow-surface-light transition-colors">
 <div className="text-lg font-semibold text-foreground">Delete template</div>
 <p className="mt-2 text-sm text-muted-foreground">
 Are you sure you want to delete <span className="font-semibold">{templateName}</span>? This
 action cannot be undone.
 </p>
 <div className="mt-4 flex justify-end gap-2 text-xs">
 <button
 className="rounded-md border border-border/40 px-3 py-1 font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
 onClick={() => setOpen(false)}
 >
 Cancel
 </button>
 <button
 className="rounded-md bg-destructive px-4 py-2 font-semibold text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-60"
 onClick={() => mutation.mutate()}
 disabled={mutation.isPending}
 >
 Delete
 </button>
 </div>
 </div>
 </div>
 </ModalPortal>
 ) : null}
 </>
 );
}

export default TemplateDeleteDialog;