import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('templates');
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setOpen = (value: boolean) => {
    setInternalOpen(value);
    onOpenChange?.(value);
  };
  const mutation = useMutation({
    mutationFn: () => templatesApi.remove(templateId),
    onSuccess: () => {
      notifySuccess(t('delete.success'));
      setOpen(false);
      onDeleted?.();
    },
    onError: (error: unknown) => {
      notifyError(error, 'templates:delete.error');
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
          {t('common:actions.delete')}
        </Button>
      )}
      <ConfirmDialog
        open={open}
        title={t('delete.title')}
        message={t('delete.confirm', { name: templateName })}
        confirmText={t('common:actions.delete')}
        variant="danger"
        loading={mutation.isPending}
        onConfirm={() => mutation.mutate()}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

export default TemplateDeleteDialog;
