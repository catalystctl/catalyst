import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { DEFAULT_LOCALE, isSupportedLocale, matchLocaleTag, SUPPORTED_LOCALES, type SupportedLocale } from './config';
import { setLocale } from './locale';

/**
 * Current interface language plus a setter that persists the choice.
 * Re-renders on language change (react-i18next subscribes internally).
 */
export function useLocale(): {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => Promise<void>;
  supportedLocales: typeof SUPPORTED_LOCALES;
} {
  const { i18n } = useTranslation();
  const activeLanguage = i18n.resolvedLanguage ?? i18n.language;

  const locale = useMemo<SupportedLocale>(() => {
    if (isSupportedLocale(activeLanguage)) return activeLanguage;
    return matchLocaleTag(activeLanguage ?? '') ?? DEFAULT_LOCALE;
  }, [activeLanguage]);

  const changeLocale = useCallback((next: SupportedLocale) => setLocale(next), []);

  return { locale, setLocale: changeLocale, supportedLocales: SUPPORTED_LOCALES };
}
