import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { AlertTriangle, Info } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: 'default' | 'danger' | 'warning';
  loading?: boolean;
}

const variantConfig = {
  default: {
    icon: <Info className="h-4 w-4" />,
    iconClassName: 'border-primary/20 bg-primary/10 text-primary',
    buttonClass: 'bg-primary text-primary-foreground hover:bg-primary/90',
  },
  danger: {
    icon: <AlertTriangle className="h-4 w-4" />,
    iconClassName: 'border-danger/20 bg-danger/10 text-danger',
    buttonClass: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
  },
  warning: {
    icon: <AlertTriangle className="h-4 w-4" />,
    iconClassName: 'border-warning/20 bg-warning/10 text-warning',
    buttonClass: 'bg-warning text-foreground hover:bg-warning/90',
  },
};

export function ConfirmDialog({
  open,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  onConfirm,
  onCancel,
  variant = 'default',
  loading = false,
}: ConfirmDialogProps) {
  const config = variantConfig[variant];

  return (
    <AlertDialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <AlertDialogContent size="sm">
        <AlertDialogHeader icon={config.icon} iconClassName={config.iconClassName}>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {typeof message === 'string' ? (
            <AlertDialogDescription>{message}</AlertDialogDescription>
          ) : (
            <>
              <AlertDialogDescription className="sr-only">{title}</AlertDialogDescription>
              <div className="text-sm leading-relaxed text-muted-foreground">{message}</div>
            </>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>{cancelText}</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={loading}
            className={config.buttonClass}
          >
            {loading ? 'Working…' : confirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default ConfirmDialog;
