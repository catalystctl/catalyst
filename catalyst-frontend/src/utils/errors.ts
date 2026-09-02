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
 * Heuristic: names produced by production minifiers (single letter or
 * letter+digits like "k", "t3", "eA", "Ke") are useless as labels. Real
 * names are at least 3 characters of camelCase/PascalCase words, or contain
 * dots/slashes (methods, paths).
 */
function isMinifiedName(name: string): boolean {
  if (name.length <= 2) return true;
  return /^[a-zA-Z$_][0-9a-zA-Z$_]{0,2}$/.test(name) && !/^[A-Z][a-z]/.test(name);
}

/**
 * Extract a readable function name from an error stack. Property/method
 * names (e.g. "Object.enableTwoFactor") survive minification, so this often
 * yields the exact API wrapper that failed even in production builds.
 */
export function describeErrorFunction(error: unknown): string | undefined {
  const stack = error instanceof Error ? error.stack : undefined;
  if (!stack) return undefined;
  for (const frame of stack.split('\n')) {
    // Matches "Object.enableTwoFactor", "ProfilePage", "async enableTwoFactor" etc.
    const m = frame.match(/(?:at\s+(?:async\s+)?|Object\.)([A-Za-z_$][\w$]*)\s*(?:\(|$)/);
    if (m && !isMinifiedName(m[1])) return m[1];
  }
  return undefined;
}

/**
 * Derive a human-readable component label for mutation error reports.
 * Priority: declared mutationKey → function name parsed from the error
 * stack (property names survive minification) → API endpoint from ApiError
 * → "unknown". Keyless mutations no longer show up as "Mutation:unknown"
 * or "Mutation:k".
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
  if (key && !isMinifiedName(key)) return `Mutation:${key}`;

  const fromStack = describeErrorFunction(error);
  if (fromStack) return `Mutation:${fromStack}`;

  const method = (error as { method?: unknown })?.method;
  const path = (error as { path?: unknown })?.path;
  if (typeof path === 'string' && path.length > 0) {
    const m = typeof method === 'string' && method.length > 0 ? method : 'HTTP';
    return `Mutation:${m} ${path}`;
  }

  if (key) return `Mutation:${key}`;

  return 'Mutation:unknown';
}
