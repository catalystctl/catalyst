import { useCallback, useMemo } from 'react';
import { useThemeStore } from '../stores/themeStore';
import { useAuthStore } from '../stores/authStore';
import {
  formatCpuReading,
  isCpuFormatPreference,
  resolveCpuFormat,
  type CpuDisplayFormat,
  type CpuFormatPreference,
  type CpuReading,
} from '../utils/cpu';

/**
 * The CPU format every gauge should print in.
 *
 * Resolution order, mirroring how the theme preference works:
 *   1. this user's own choice, if they pinned one;
 *   2. otherwise the panel-wide default an admin set;
 *   3. otherwise the shipped default ('cores').
 *
 * The format only decides the *text*. The bar and the severity colour always
 * follow the share of the allocation, so a server using one of four cores is
 * never painted danger-red just because per-core math says "100%".
 */
export function useCpuFormat(): {
  format: CpuDisplayFormat;
  preference: CpuFormatPreference;
  /** Persist locally and, when signed in, to this user's account. */
  setPreference: (pref: CpuFormatPreference) => void;
  /** Render one sample in the active format. */
  read: (
    cpuPercent: number | null | undefined,
    allocatedCpuCores: number | null | undefined,
    options?: { compact?: boolean },
  ) => CpuReading;
} {
  const preference = useThemeStore((s) => s.cpuFormatPreference);
  const storeSetPreference = useThemeStore((s) => s.setCpuFormatPreference);
  const panelDefault = useThemeStore((s) => s.themeSettings?.cpuDisplayFormat);

  const format = useMemo(
    () => resolveCpuFormat(preference, panelDefault),
    [preference, panelDefault],
  );

  const setPreference = useCallback(
    (pref: CpuFormatPreference) => {
      // Apply immediately: the store is what every gauge renders from, so the
      // panel repaints without waiting on the round trip.
      storeSetPreference(pref);
      void persistPreference(pref);
    },
    [storeSetPreference],
  );

  const read = useCallback(
    (
      cpuPercent: number | null | undefined,
      allocatedCpuCores: number | null | undefined,
      options?: { compact?: boolean },
    ) => formatCpuReading(cpuPercent, allocatedCpuCores, format, options),
    [format],
  );

  return { format, preference, setPreference, read };
}

/**
 * Write the choice to `User.preferences` so it follows the account across
 * devices. Best-effort: a failure leaves the local choice working, which is
 * why it never blocks the UI.
 */
async function persistPreference(pref: CpuFormatPreference): Promise<void> {
  if (!useAuthStore.getState().isAuthenticated) return;
  try {
    // Imported lazily: every gauge mounts this hook, and pulling the HTTP
    // client in statically would drag the API layer into every metrics view.
    const { profileApi } = await import('../services/api/profile');
    const profile = await profileApi.getProfile();
    await profileApi.updatePreferences({ ...(profile.preferences ?? {}), cpuDisplayFormat: pref });
  } catch (error) {
    console.warn('[cpu-format] Failed to save CPU format preference:', error);
  }
}

/**
 * Adopt the signed-in user's saved preference, and drop back to the panel
 * default on sign-out.
 *
 * Module-scope subscription rather than a React effect, the same pattern as
 * i18n/user-locale.ts: the format must be settled before the first
 * authenticated render, or gauges flash the previous user's choice.
 */
let lastUserId: string | null = null;

function syncFromUser(): void {
  const { user, isAuthenticated } = useAuthStore.getState();
  const store = useThemeStore.getState();

  if (!isAuthenticated || !user) {
    // Only react to an actual sign-out; the first call (no user yet, session
    // still restoring) must not overwrite the persisted choice.
    if (lastUserId !== null) {
      lastUserId = null;
      store.setCpuFormatPreference('panel');
    }
    return;
  }

  if (user.id === lastUserId) return;
  lastUserId = user.id;

  const saved = user.preferences?.cpuDisplayFormat;
  store.setCpuFormatPreference(isCpuFormatPreference(saved) ? saved : 'panel');
}

/** Subscribe once; called from the app bootstrap. Returns the unsubscribe. */
export function syncCpuFormatWithUser(): () => void {
  const unsubscribe = useAuthStore.subscribe(syncFromUser);
  syncFromUser();
  return unsubscribe;
}
