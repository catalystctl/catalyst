/**
 * Type-safe error utilities for handling unknown caught errors.
 */

/** Common shape for Axios/network errors returned by API calls */
interface ApiErrorLike {
  response?: {
    data?: {
      error?: string | { message?: string; error?: string };
      message?: string;
    };
    status?: number;
  };
  message?: string;
}

/**
 * Extract a human-readable error message from an unknown caught error.
 * Handles Axios errors, Error instances, and plain values.
 */
export function getErrorMessage(error: unknown, fallback = 'An error occurred'): string {
  if (!error) return fallback;
  const err = error as ApiErrorLike;
  if (err.response?.data) {
    const data = err.response.data;
    const dataError = data.error;
    if (typeof dataError === 'string') return dataError;
    if (dataError && typeof dataError === 'object') {
      return dataError.message || dataError.error || fallback;
    }
    if (typeof data.message === 'string') return data.message;
  }
  if (typeof err.message === 'string') return err.message;
  return fallback;
}

/**
 * Type guard to check if an unknown error has a specific error code.
 */
export function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === code
  );
}

/**
 * Produce a readable, single-line description of any thrown value.
 *
 * Unlike `String(error)` — which renders non-Error objects as "[object Object]"
 * — this JSON-stringifies plain objects/arrays so error reports stay useful.
 * Prefer this over `error instanceof Error ? error.message : String(error)`
 * in system-error reporting and log payloads.
 */
export function describeError(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (error === null || error === undefined) return String(error);
  if (typeof error !== 'object') return String(error);
  const message = (error as { message?: unknown }).message;
  if (typeof message === 'string' && message.length > 0) return message;
  try {
    const json = JSON.stringify(error);
    return json === undefined || json === '' ? String(error) : json;
  } catch {
    return String(error);
  }
}

/**
 * Derive a human-readable component label for mutation error reports.
 * Uses the declared mutationKey when present; otherwise falls back to the
 * API endpoint extracted from the thrown error (e.g. "POST /api/servers/:id/backups")
 * so keyless mutations no longer show up as "Mutation:unknown".
 */
export function describeMutationComponent(
  mutationKey: unknown,
  error: unknown,
): string {
  const key = Array.isArray(mutationKey)
    ? mutationKey.filter((part) => typeof part === 'string' && part.length > 0).join(':')
    : typeof mutationKey === 'string' && mutationKey.length > 0
      ? mutationKey
      : undefined;
  if (key) return `Mutation:${key}`;

  const method = (error as { method?: unknown })?.method;
  const path = (error as { path?: unknown })?.path;
  if (typeof path === 'string' && path.length > 0) {
    const m = typeof method === 'string' && method.length > 0 ? method : 'HTTP';
    return `Mutation:${m} ${path}`;
  }

  return 'Mutation:unknown';
}
