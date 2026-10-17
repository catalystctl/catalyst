/**
 * Shared helpers for the plugin list and the marketplace page.
 *
 * The backend already annotates browse results (`updateAvailable`,
 * `installedVersion`), but the installed list and the browse list are fetched
 * separately — a plugin can be installed after the index was cached, so the
 * UI re-derives the comparison locally instead of trusting one payload.
 */

/** Host label for a marketplace URL that never throws on malformed input. */
export function sourceHostLabel(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/**
 * True when `marketplace` is a strictly newer x.y.z than `installed`.
 * Non-semver versions fall back to inequality so a `1.0.0-beta` install is
 * still flagged against `1.0.0` rather than silently reported as current.
 */
export function isNewerVersion(
  installed: string | null | undefined,
  marketplace: string | null | undefined,
): boolean {
  if (!installed || !marketplace) return false;
  const parts = (v: string) => v.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const a = parts(installed);
  const b = parts(marketplace);
  for (let i = 0; i < 3; i++) {
    if ((b[i] ?? 0) > (a[i] ?? 0)) return true;
    if ((b[i] ?? 0) < (a[i] ?? 0)) return false;
  }
  return installed !== marketplace;
}
