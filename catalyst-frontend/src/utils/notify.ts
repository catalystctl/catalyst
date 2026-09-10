import { toast } from 'sonner';
import { getLocalizedErrorMessage } from '../i18n/api-errors';

export function notifySuccess(message: string) {
  toast.success(message);
}

/**
 * Show an error toast. Accepts a ready-made message or a thrown value: thrown
 * API errors are resolved through their stable backend error code, falling back
 * to the server message, then a localized generic message.
 */
export function notifyError(error: unknown, fallbackKey?: string) {
  const message =
    typeof error === 'string' ? error : getLocalizedErrorMessage(error, fallbackKey);
  toast.error(message);
}

export function notifyInfo(message: string) {
  toast.info(message);
}

export function notifyLoading(message: string) {
  toast.loading(message);
}
