/**
 * Locales the panel can render, used for server-side rendering (emails,
 * alerts) and for validating stored user preferences. Keep in sync with
 * `catalyst-frontend/src/i18n/config.ts`.
 */
export const SUPPORTED_LOCALES = ['en', 'zh-CN'] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = 'en';

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** Locale saved in a user's preferences, falling back to the default. */
export function resolveUserLocale(preferences: unknown): SupportedLocale {
  if (preferences && typeof preferences === 'object') {
    const locale = (preferences as { locale?: unknown }).locale;
    if (isSupportedLocale(locale)) return locale;
  }
  return DEFAULT_LOCALE;
}
