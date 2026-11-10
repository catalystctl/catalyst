import { toast } from 'sonner';
import { getLocalizedErrorMessage } from '../i18n/api-errors';

export function notifySuccess(message: string) {
  toast.success(message);
}

/**
 * Show an error toast. Accepts a ready-made message or a thrown value: thrown
 * API errors are resolved through their stable backend error code, falling back
 * to the server message, then to `fallback`.
 *
 * `fallback` may be a namespaced catalog key (`'templates:edit.updateError'`) or
 * an already-translated string — pass `t('…')` for keys in the current
 * namespace so the specific copy survives and the extractor still sees them.
 */
export function notifyError(error: unknown, fallback?: string) {
  const message =
    typeof error === 'string' ? error : getLocalizedErrorMessage(error, fallback);
  toast.error(message);
}

export function notifyInfo(message: string) {
  toast.info(message);
}

export function notifyLoading(message: string) {
  toast.loading(message);
}
