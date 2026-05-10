/**
 * Conditional debug logger for the frontend.
 *
 * All console.log calls in runtime code should use debugLog() instead.
 * Output is suppressed unless VITE_DEBUG_LOG is set to "true" in the .env.
 *
 * console.error / console.warn are intentionally NOT guarded —
 * those should always surface for operational visibility.
 */

const DEBUG_ENABLED = import.meta.env.VITE_DEBUG_LOG === 'true';

/** Log a message (and optional data) only when VITE_DEBUG_LOG=true */
export function debugLog(...args: unknown[]): void {
  if (DEBUG_ENABLED) {
    // eslint-disable-next-line no-console -- this is the single allowed console.log sink
    console.log(...args);
  }
}
