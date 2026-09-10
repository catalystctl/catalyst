import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import commonEn from './locales/en/common.json';
import errorsEn from './locales/en/errors.json';
import commonZhCn from './locales/zh-CN/common.json';
import errorsZhCn from './locales/zh-CN/errors.json';
import {
  DEFAULT_LOCALE,
  detectDeviceLocale,
  isSupportedLocale,
  matchLocaleTag,
  SUPPORTED_LOCALE_CODES,
} from './config';

/**
 * Namespaces bundled into the initial payload. Everything else is loaded on
 * demand (see `lazyBackend`), which keeps the entry bundle flat as the catalog
 * grows.
 */
export const INITIAL_NAMESPACES = ['common', 'errors'] as const;

type Catalog = Record<string, unknown>;
interface CatalogModule {
  default: Catalog;
}

// Every catalog file in the repo, as dynamic imports. Vite turns this into a
// manifest, so missing locale/namespace combinations are detectable at runtime.
const catalogModules = import.meta.glob<CatalogModule>('./locales/*/*.json');

/**
 * i18next backend that resolves namespaces from the bundled catalogs.
 *
 * Catalogs are part of the application build (not fetched from the server), so
 * translations work offline, are covered by the service worker's asset cache,
 * and need no nginx route. A missing non-English catalog falls back to English
 * rather than failing the load.
 */
const lazyBackend = {
  type: 'backend' as const,
  read(
    language: string,
    namespace: string,
    callback: (error: unknown, resources: Catalog | null) => void,
  ): void {
    const exact = catalogModules[`./locales/${language}/${namespace}.json`];
    const fallback = catalogModules[`./locales/${DEFAULT_LOCALE}/${namespace}.json`];
    const loader = exact ?? fallback;
    if (!loader) {
      callback(null, null);
      return;
    }
    loader()
      .then((mod) => callback(null, mod.default ?? {}))
      .catch((error: unknown) => callback(error, null));
  },
};

void i18n
  .use(lazyBackend)
  .use(initReactI18next)
  .init({
    lng: detectDeviceLocale(),
    fallbackLng: DEFAULT_LOCALE,
    supportedLngs: [...SUPPORTED_LOCALE_CODES],
    load: 'currentOnly',
    ns: [...INITIAL_NAMESPACES],
    defaultNS: 'common',
    resources: {
      en: { common: commonEn, errors: errorsEn },
      'zh-CN': { common: commonZhCn, errors: errorsZhCn },
    },
    // Bundled namespaces initialize synchronously; the rest load lazily.
    partialBundledLanguages: true,
    initAsync: false,
    // An empty string is a translator placeholder, not a translation — fall
    // back to English instead of rendering blank UI.
    returnEmptyString: false,
    interpolation: { escapeValue: false },
    react: { useSuspense: true },
  });

function resolveDocumentLanguage(language: string | undefined): string {
  if (!language) return DEFAULT_LOCALE;
  if (isSupportedLocale(language)) return language;
  return matchLocaleTag(language) ?? DEFAULT_LOCALE;
}

function syncDocumentLanguage(language: string | undefined): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = resolveDocumentLanguage(language);
}

syncDocumentLanguage(i18n.resolvedLanguage ?? i18n.language);
i18n.on('languageChanged', syncDocumentLanguage);

export default i18n;
