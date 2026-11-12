/**
 * Admin theme fallback used by App(): the public theme endpoint omits custom
 * CSS for accounts that may not read admin settings, so a user holding
 * `admin.read` loads the full theme settings here and the panel injects the
 * extra CSS.
 *
 * The load runs as a fire-and-forget side effect, and its outcomes are not
 * interchangeable for the caller: a 403 means "this account may not read admin
 * settings" (expected, nothing to report) while anything else is a real
 * failure worth reporting. They used to share the function's normal return
 * value, so a failed load was indistinguishable from one that applied the CSS.
 * Returning a discriminated result keeps that distinction.
 */
import { adminApi } from '../services/api/admin';

export type AdminCustomCssOutcome =
  /** Settings were read; `customCss` is undefined when the panel stores none. */
  | { status: 'applied'; customCss?: string }
  /** The account lacks `admin.read` — expected for non-admin roles. */
  | { status: 'forbidden' }
  /** The settings could not be read or the CSS could not be applied. */
  | { status: 'failed'; error: unknown };

/**
 * Read the admin theme settings and hand their custom CSS to `applyCss`.
 *
 * Never rejects: a failure is reported as `status: 'failed'` with the caught
 * error so the caller can report it with its own context.
 */
export async function loadAdminCustomCss(
  applyCss: (customCss: string) => void,
): Promise<AdminCustomCssOutcome> {
  try {
    const fullSettings = await adminApi.getThemeSettings();
    if (fullSettings.customCss !== undefined) {
      applyCss(fullSettings.customCss);
    }
    return { status: 'applied', customCss: fullSettings.customCss };
  } catch (error) {
    // A 403 just means the account lacks admin.read (expected for non-admin
    // roles) — not a system error worth reporting, but still its own outcome.
    if ((error as { status?: number })?.status === 403) {
      return { status: 'forbidden' };
    }
    return { status: 'failed', error };
  }
}
