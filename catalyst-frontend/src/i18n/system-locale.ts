import { isSupportedLocale, readStoredLocale, setSystemDefaultLocale, type SupportedLocale } from './config';
import { applyLocale } from './locale';

/**
 * The instance-wide language an admin set, read before the first render.
 *
 * Resolving it up front matters for anonymous visitors: the login, register
 * and setup screens would otherwise paint in the browser's language and switch
 * afterwards. The request is skipped entirely when this browser already has an
 * explicit choice, because that choice wins anyway.
 */

/** Longest a stale or unreachable backend may delay the first paint. */
const REQUEST_TIMEOUT_MS = 2500;

async function fetchInstanceDefaultLocale(): Promise<SupportedLocale | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch('/api/settings/locale', {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { data?: { defaultLocale?: unknown } };
    const locale = body?.data?.defaultLocale;
    return isSupportedLocale(locale) ? locale : null;
  } catch {
    // Offline, old backend without the endpoint, or aborted — the device
    // language stands, which is what the panel did before this setting existed.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function bootstrapSystemLocale(): Promise<void> {
  if (readStoredLocale()) return;

  const locale = await fetchInstanceDefaultLocale();
  if (!locale) return;

  setSystemDefaultLocale(locale);
  await applyLocale(locale);
}
