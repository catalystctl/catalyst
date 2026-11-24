/**
 * Remember the last server tab per server (audit D7).
 *
 * Returning to a server always opened Console, so an operator who works in
 * Files/Backups/Tasks re-clicked the tab on every visit. The chosen tab is
 * stored per server id and restored only when the URL names no tab — an
 * explicit `/servers/:id/backups` link always wins.
 *
 * Only built-in tabs are stored and restored: a plugin tab may be uninstalled
 * or disabled between visits, and landing on its "not found" panel would be
 * worse than the Console default.
 *
 * Pure functions + a tiny storage shim, so the behaviour is unit-testable
 * without rendering the page.
 */

const STORAGE_PREFIX = 'catalyst.lastTab.';

/** localStorage key for one server's remembered tab. */
export function lastTabStorageKey(serverId: string): string {
  return `${STORAGE_PREFIX}${serverId}`;
}

function storage(): Storage | null {
  try {
    // Absent in SSR/tests without a DOM; a missing store just means "no memory".
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    // Private mode / blocked storage throws on access.
    return null;
  }
}

/**
 * The remembered tab for `serverId`, or null when nothing was stored or the
 * stored value is not one of `validTabs`.
 */
export function readLastServerTab(
  serverId: string | undefined,
  validTabs: readonly string[],
): string | null {
  if (!serverId) return null;
  const store = storage();
  if (!store) return null;
  try {
    const stored = store.getItem(lastTabStorageKey(serverId));
    if (!stored) return null;
    return validTabs.includes(stored) ? stored : null;
  } catch {
    return null;
  }
}

/** Persist `tab` for `serverId`; ignores tabs that are not `validTabs`. */
export function writeLastServerTab(
  serverId: string | undefined,
  tab: string | undefined,
  validTabs: readonly string[],
): void {
  if (!serverId || !tab || !validTabs.includes(tab)) return;
  const store = storage();
  if (!store) return;
  try {
    store.setItem(lastTabStorageKey(serverId), tab);
  } catch {
    // Quota/blocked storage: remembering a tab is not worth an error path.
  }
}

/**
 * Where a tab-less visit to `serverId` should land: the remembered tab, or
 * null when the Console default is already correct (no stored tab, or the
 * stored tab is `defaultTab`).
 */
export function restoreServerTab(
  serverId: string | undefined,
  urlTab: string | undefined,
  validTabs: readonly string[],
  defaultTab = 'console',
): string | null {
  if (!serverId || urlTab) return null;
  const stored = readLastServerTab(serverId, validTabs);
  if (!stored || stored === defaultTab) return null;
  return stored;
}