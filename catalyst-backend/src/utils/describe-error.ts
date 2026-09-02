/**
 * Safe error-to-string conversion for system error reporting.
 *
 * `String(err)` on a plain object renders "[object Object]", which erases the
 * actual failure from system error reports. `describeError` unwraps Error
 * messages and JSON-stringifies plain objects so reports stay actionable.
 */

/**
 * Produce a readable, single-line description of any thrown value.
 *
 * - `Error` instances → `.message`
 * - plain objects → `.message` when a non-empty string, else compact JSON
 * - strings → as-is
 * - primitives/null/undefined → `String(value)`
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
    // Circular or otherwise unserializable — fall back to String()
    return String(error);
  }
}

/**
 * Convenience for catch blocks: `describeError(err)` for the message and
 * `.stack` only when the value is an actual Error. Keeps stacks truthful —
 * a plain object never yields a fake stack.
 */
export function describeErrorWithStack(error: unknown): {
  message: string;
  stack: string | undefined;
} {
  return {
    message: describeError(error),
    stack: error instanceof Error ? error.stack : undefined,
  };
}
