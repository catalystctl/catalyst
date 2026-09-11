/**
 * Instance-wide language settings.
 *
 * One row (`id = "localization"`) holds the panel's default language. It is
 * the language a visitor sees before they pick one, and the language emails
 * and alerts are written in for recipients who have not chosen one either.
 * Users can always override it for themselves (see `i18n/user-locale.ts`).
 */
import { prisma } from '../db.js';
import { cachedConfig, invalidateConfig } from '../lib/config-cache.js';
import { DEFAULT_LOCALE, isSupportedLocale, type SupportedLocale } from '../i18n/locales.js';

export const LOCALIZATION_SETTING_ID = 'localization';

export type LocalizationSettings = {
  /** Admin choice, or null when the instance runs on the built-in default. */
  defaultLocale: SupportedLocale | null;
};

export const DEFAULT_LOCALIZATION_SETTINGS: LocalizationSettings = {
  defaultLocale: null,
};

export const getLocalizationSettings = async (): Promise<LocalizationSettings> => {
  return cachedConfig('localization', async () => {
    const row = await prisma.systemSetting.findUnique({
      where: { id: LOCALIZATION_SETTING_ID },
      select: { defaultLocale: true },
    });
    // A locale removed from SUPPORTED_LOCALES after being saved must not be
    // served to clients that cannot render it.
    return {
      defaultLocale: isSupportedLocale(row?.defaultLocale) ? row.defaultLocale : null,
    };
  });
};

/** Language to use when a recipient has no language of their own. */
export const getDefaultLocale = async (): Promise<SupportedLocale> => {
  const settings = await getLocalizationSettings();
  return settings.defaultLocale ?? DEFAULT_LOCALE;
};

export const updateLocalizationSettings = async (input: LocalizationSettings): Promise<void> => {
  await prisma.systemSetting.upsert({
    where: { id: LOCALIZATION_SETTING_ID },
    create: { id: LOCALIZATION_SETTING_ID, defaultLocale: input.defaultLocale },
    update: { defaultLocale: input.defaultLocale },
  });
  await invalidateConfig('localization');
};
