import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
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
      queryClient.invalidateQueries({ queryKey: qk.templates() });
      queryClient.invalidateQueries({ queryKey: qk.template(templateId) });
      notifySuccess('Template deleted');
      setOpen(false);
      onDeleted?.();
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to delete template';
      notifyError(message);
    },
  });

  return (
    <>
      {controlledOpen === undefined && (
        <button
          className={
            buttonClassName ||
            'rounded-md bg-destructive px-3 py-1 text-xs font-semibold text-destructive-foreground shadow-lg shadow-destructive/20 transition-all duration-300 hover:bg-destructive/90'
          }
          onClick={() => setOpen(true)}
        >
          Delete
        </button>
      )}
      {open ? (
        <ModalPortal>
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 px-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 dark:border-border dark:bg-surface-1">
            <div className="text-lg font-semibold text-foreground">Delete template</div>
            <p className="mt-2 text-sm text-muted-foreground dark:text-foreground">
              Are you sure you want to delete <span className="font-semibold">{templateName}</span>? This
              action cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2 text-xs">
              <button
                className="rounded-md border border-border px-3 py-1 font-semibold text-muted-foreground transition-all duration-300 hover:border-primary hover:text-foreground dark:border-border dark:text-foreground dark:hover:border-primary/30"
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-destructive px-4 py-2 font-semibold text-destructive-foreground shadow-lg shadow-destructive/20 transition-all duration-300 hover:bg-destructive/90 disabled:opacity-60"
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
