import i18n from './index';
import { getErrorMessage } from '../utils/errors';

interface ApiErrorShape {
  code?: unknown;
  response?: { data?: { code?: unknown } };
}

/**
 * Stable error code carried by API errors. The backend sends `{ error, code }`;
 * axios-level errors used to expose the code directly on the error object.
 */
export function getApiErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const err = error as ApiErrorShape;
  const bodyCode = err.response?.data?.code;
  if (typeof bodyCode === 'string' && bodyCode) return bodyCode;
  if (typeof err.code === 'string' && err.code) return err.code;
  return undefined;
}

export function hasErrorTranslation(code: string): boolean {
  return i18n.exists(code, { ns: 'errors' });
}

/**
 * Resolve any thrown API error to a localized message.
 *
 * Order: known backend error code -> server-provided message (English) ->
 * localized generic fallback. Untranslated codes keep working exactly as
 * before localization, so the backend can add codes incrementally.
 */
export function getLocalizedErrorMessage(error: unknown, fallbackKey = 'generic'): string {
  const code = getApiErrorCode(error);
  if (code && hasErrorTranslation(code)) return i18n.t(code, { ns: 'errors' });
  return getErrorMessage(error, i18n.t(fallbackKey, { ns: 'errors' }));
}
