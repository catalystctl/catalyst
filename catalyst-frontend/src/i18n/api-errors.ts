import i18n from './index';
import { getErrorMessage } from '../utils/errors';

interface ApiErrorShape {
  code?: unknown;
  response?: { data?: { code?: unknown; params?: unknown } };
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

/** Interpolation values the backend attaches to a coded error (min, max, …). */
export function getApiErrorParams(error: unknown): Record<string, unknown> | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const params = (error as ApiErrorShape).response?.data?.params;
  return params && typeof params === 'object' ? (params as Record<string, unknown>) : undefined;
}

export function hasErrorTranslation(code: string): boolean {
  return i18n.exists(code, { ns: 'errors' }) || i18n.exists(code, { ns: 'validation' });
}

function translateCode(code: string, params?: Record<string, unknown>): string | undefined {
  for (const namespace of ['errors', 'validation'] as const) {
    if (i18n.exists(code, { ns: namespace })) return i18n.t(code, { ns: namespace, ...params });
  }
  return undefined;
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
  if (code) {
    const translated = translateCode(code, getApiErrorParams(error));
    if (translated !== undefined) return translated;
  }
  return getErrorMessage(error, i18n.t(fallbackKey, { ns: 'errors' }));
}
