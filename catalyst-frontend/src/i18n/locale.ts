import i18n from './index';
import { detectDeviceLocale, readStoredLocale, storeLocale, type SupportedLocale } from './config';

/**
 * Apply a language to the running app without persisting it anywhere. Used for
 * preferences that come from the signed-in user.
 */
export async function applyLocale(locale: SupportedLocale): Promise<void> {
  if (i18n.resolvedLanguage === locale) return;
  await i18n.changeLanguage(locale);
}

/**
 * Switch the interface language from an explicit user action.
 *
 * The choice is always remembered for this device. When a user is signed in it
 * is also merged into their stored preferences so it follows them to other
 * browsers. Preference sync is best-effort — the local switch has already
 * happened if the request fails.
 */
export async function setLocale(locale: SupportedLocale): Promise<void> {
  storeLocale(locale);
  await applyLocale(locale);

  const { useAuthStore } = await import('../stores/authStore');
  if (!useAuthStore.getState().isAuthenticated) return;

  try {
    const { profileApi } = await import('../services/api/profile');
    const profile = await profileApi.getProfile();
    const preferences = profile.preferences ?? {};
    await profileApi.updatePreferences({ ...preferences, locale });
  } catch (error) {
    console.warn('[i18n] Failed to save language preference:', error);
  }
}

/** Restore the device language after a user with their own preference signs out. */
export async function resetToDeviceLocale(): Promise<void> {
  await applyLocale(readStoredLocale() ?? detectDeviceLocale());
}
