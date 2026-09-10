import enEmail from './locales/en/email.json' with { type: 'json' };
import zhCnEmail from './locales/zh-CN/email.json' with { type: 'json' };
import { DEFAULT_LOCALE, type SupportedLocale } from './locales.js';

type Catalog = Record<string, unknown>;
type TranslateParams = Record<string, string | number>;

const CATALOGS: Record<SupportedLocale, Catalog> = {
  en: enEmail as Catalog,
  'zh-CN': zhCnEmail as Catalog,
};

function lookup(catalog: Catalog, key: string): string | undefined {
  let current: unknown = catalog;
  for (const segment of key.split('.')) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === 'string' ? current : undefined;
}

function interpolate(template: string, params?: TranslateParams): string {
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/**
 * Translate a server-rendered string (email subject/body fragments) for a
 * recipient locale. Falls back to English, then to the key itself, so a missing
 * translation can never break sending.
 */
export function translate(
  locale: SupportedLocale,
  key: string,
  params?: TranslateParams,
): string {
  const template = lookup(CATALOGS[locale], key) ?? lookup(CATALOGS[DEFAULT_LOCALE], key);
  return interpolate(template ?? key, params);
}

/** Bound translator for one recipient. */
export function translatorFor(locale: SupportedLocale) {
  return (key: string, params?: TranslateParams) => translate(locale, key, params);
}
