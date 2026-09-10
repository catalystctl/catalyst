import { useAuthStore } from '../stores/authStore';
import { isSupportedLocale, type SupportedLocale } from './config';
import { applyLocale, resetToDeviceLocale } from './locale';

interface WithPreferences {
  preferences?: Record<string, unknown>;
}

function readUserLocale(user: WithPreferences | null): SupportedLocale | undefined {
  const value = user?.preferences?.locale;
  return isSupportedLocale(value) ? value : undefined;
}

let lastUserId: string | null = null;

/**
 * Follow the signed-in user's saved language across sessions and devices.
 *
 * Module-scope subscription instead of a React effect: the preference must
 * apply before the first authenticated render, including on session restore.
 */
function syncFromUser(): void {
  const { user } = useAuthStore.getState();

  if (!user) {
    if (lastUserId !== null) {
      lastUserId = null;
      void resetToDeviceLocale();
    }
    return;
  }

  // Only react to a new identity; profile updates for the same user (theme,
  // colors, …) must not reload namespaces.
  if (user.id === lastUserId) return;
  lastUserId = user.id;

  const locale = readUserLocale(user);
  if (locale) void applyLocale(locale);
}

useAuthStore.subscribe(syncFromUser);
syncFromUser();
