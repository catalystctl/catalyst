import { useState } from 'react';
import { useMutation } from '@/csync';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { templatesApi } from '../../services/api/templates';
import { notifyError, notifySuccess } from '../../utils/notify';
import { Button } from '@/components/ui/button';
import ConfirmDialog from '@/components/shared/ConfirmDialog';

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
        <Button
          variant="destructive"
          size="sm"
          className={buttonClassName}
          onClick={() => setOpen(true)}
        >
          Delete
        </Button>
      )}
      <ConfirmDialog
        open={open}
        title="Delete template"
        message={
          <>
            Are you sure you want to delete{' '}
            <span className="font-semibold text-foreground">{templateName}</span>? This action
            cannot be undone.
          </>
        }
        confirmText="Delete"
        variant="danger"
        loading={mutation.isPending}
        onConfirm={() => mutation.mutate()}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

export default TemplateDeleteDialog;
