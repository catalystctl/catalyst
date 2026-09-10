import i18n from './index';
import { getErrorMessage } from '../utils/errors';
import { activeLocale } from './format';

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
  const err = error as ApiErrorShape & { params?: unknown };
  const params = err.response?.data?.params ?? err.params;
  return params && typeof params === 'object' ? (params as Record<string, unknown>) : undefined;
}

function translateCode(code: string, params?: Record<string, unknown>): string | undefined {
  for (const namespace of ['errors', 'validation'] as const) {
    if (i18n.exists(code, { ns: namespace })) return i18n.t(code, { ns: namespace, ...params });
  }
  return undefined;
}

/**
 * Whether a server message looks like something written for the user, rather
 * than an internal detail. The backend sanitizes its own messages in
 * `mapHttpError`, but routes that pass a caught `error.message` straight into
 * `apiError` can leak driver or runtime text.
 */
function looksUserFacing(message: string): boolean {
  if (!message || message.length > 200) return false;
  if (message.includes('\n')) return false;
  return !/prisma|Unique constraint|Foreign key|PrismaClient|at Object\.|undefined is not/i.test(message);
}

/** Connection-level failures that never reach the API. */
function isNetworkFailure(error: unknown): boolean {
  if (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError') {
    return false;
  }
  const message = error instanceof Error ? error.message : '';
  return /failed to fetch|network ?error|load failed|fetch failed/i.test(message);
}

/**
 * Resolve any thrown API error to a localized message.
 *
 * Order: translated backend code (non-English locales) -> server-provided
 * message (English, when it looks user-facing) -> catalog text -> localized
 * generic fallback. The server message is often more specific than the catalog
 * text — one code such as VALIDATION_ERROR covers many distinct messages — so
 * English readers keep it; other locales get the translation of the code.
 * Untranslated codes keep working exactly as before localization, so the
 * backend can add codes incrementally.
 */
export function getLocalizedErrorMessage(error: unknown, fallbackKey = 'generic'): string {
  const code = getApiErrorCode(error);
  const translated = code ? translateCode(code, getApiErrorParams(error)) : undefined;
  if (translated !== undefined && activeLocale() !== 'en') return translated;
  if (translated === undefined && isNetworkFailure(error)) {
    return i18n.t('NETWORK_ERROR', { ns: 'errors' });
  }
  const serverMessage = getErrorMessage(error, '');
  if (translated !== undefined && !looksUserFacing(serverMessage)) return translated;
  return serverMessage || translated || i18n.t(fallbackKey, { ns: 'errors' });
}

/** A field-level validation failure: which input, and what to tell the user. */
export interface LocalizedFieldError {
  field?: string;
  message: string;
}

/**
 * Field errors from a `VALIDATION_ERROR` response, translated through the
 * `validation` namespace when the backend sent a stable rule code
 * (`VALIDATION_TOO_SMALL`, …) and falling back to the server's English text.
 */
export function getLocalizedFieldErrors(error: unknown): LocalizedFieldError[] {
  const details = (error as { response?: { data?: { details?: unknown } } })?.response?.data?.details;
  if (!Array.isArray(details)) return [];
  const out: LocalizedFieldError[] = [];
  for (const detail of details) {
    if (!detail || typeof detail !== 'object') continue;
    const { field, message, code, params } = detail as {
      field?: unknown;
      message?: unknown;
      code?: unknown;
      params?: unknown;
    };
    const translated =
      typeof code === 'string' && i18n.exists(code, { ns: 'validation' })
        ? i18n.t(code, {
            ns: 'validation',
            ...(params && typeof params === 'object' ? (params as Record<string, unknown>) : {}),
          })
        : undefined;
    const text = translated ?? (typeof message === 'string' ? message : undefined);
    if (!text) continue;
    out.push({ field: typeof field === 'string' ? field : undefined, message: text });
  }
  return out;
}
