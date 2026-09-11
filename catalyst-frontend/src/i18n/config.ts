/**
 * Locale registry and detection for the panel UI.
 *
 * This list is the single source of truth for the languages the panel can
 * render. Adding a language means adding a catalog directory under
 * `src/i18n/locales/<code>/` with the same namespace files as `en`, then
 * adding one entry below.
 */

export interface LocaleDefinition {
  /** BCP-47 tag used as the catalog directory name and i18next language code. */
  code: string;
  /** English name, used in docs and admin-facing surfaces. */
  englishName: string;
  /** Endonym shown in the language switcher. */
  nativeName: string;
}

export const SUPPORTED_LOCALES = [
  { code: 'en', englishName: 'English', nativeName: 'English' },
  { code: 'zh-CN', englishName: 'Chinese (Simplified)', nativeName: '简体中文' },
] as const satisfies readonly LocaleDefinition[];

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]['code'];

export const DEFAULT_LOCALE: SupportedLocale = 'en';

export const SUPPORTED_LOCALE_CODES: readonly SupportedLocale[] = SUPPORTED_LOCALES.map((l) => l.code);

/** localStorage key holding the device-local language choice. */
export const LOCALE_STORAGE_KEY = 'catalyst-language';

/**
 * Browser tags that do not match a supported code exactly but should map onto
 * one. Browsers report `zh`, `zh-Hans` or `zh-Hans-CN`; without aliases those
 * would fall through to English despite a Simplified Chinese catalog existing.
 */
const LOCALE_ALIASES: Record<string, SupportedLocale> = {
  zh: 'zh-CN',
  'zh-hans': 'zh-CN',
  'zh-sg': 'zh-CN',
};

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === 'string' && (SUPPORTED_LOCALE_CODES as readonly string[]).includes(value);
}

/**
 * Match a browser language tag against the supported locales.
 *
 * Exact codes win, then known aliases (`zh-Hans` -> `zh-CN`), then a
 * region-less primary match (`en-GB` -> `en`). Region variants that would
 * change the writing system are deliberately not matched: `zh-TW` falls back
 * to English rather than serving a Simplified catalog.
 */
export function matchLocaleTag(tag: string): SupportedLocale | undefined {
  const normalized = tag.trim().toLowerCase();
  if (!normalized) return undefined;

  const exact = SUPPORTED_LOCALE_CODES.find((code) => code.toLowerCase() === normalized);
  if (exact) return exact;

  const exactAlias = LOCALE_ALIASES[normalized];
  if (exactAlias) return exactAlias;

  // Script/region extensions of a hyphenated alias (`zh-Hans-CN` -> `zh-Hans`).
  // Region-less aliases like `zh` are exact matches only, so `zh-TW` is not
  // served the Simplified catalog.
  for (const [alias, locale] of Object.entries(LOCALE_ALIASES)) {
    if (alias.includes('-') && normalized.startsWith(`${alias}-`)) return locale;
  }

  const primary = normalized.split('-')[0];
  for (const code of SUPPORTED_LOCALE_CODES) {
    const codeLower = code.toLowerCase();
    if (!codeLower.includes('-') && codeLower === primary) return code;
  }
  return undefined;
}

/** Explicit device preference, if one was saved. */
export function readStoredLocale(): SupportedLocale | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isSupportedLocale(stored) ? stored : undefined;
  } catch {
    // localStorage can throw when storage is disabled; fall through.
    return undefined;
  }
}

/**
 * Language an admin set for the whole instance (`GET /api/settings/locale`).
 *
 * Kept in memory only: it is the instance's setting, not this browser's, so
 * it is re-read on every load. `null` clears it.
 */
let systemDefaultLocale: SupportedLocale | undefined;

export function setSystemDefaultLocale(locale: SupportedLocale | null): void {
  systemDefaultLocale = locale ?? undefined;
}

export function getSystemDefaultLocale(): SupportedLocale | undefined {
  return systemDefaultLocale;
}

export function storeLocale(locale: SupportedLocale): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Best-effort: the in-memory language still changes for this session.
  }
}

/**
 * Language for this device: an explicit choice first, then the admin-set
 * instance default, then the browser's preference list, then English.
 *
 * The instance default deliberately outranks the browser: an admin who sets
 * the panel's language means it for every visitor who has not picked one, and
 * a browser list almost always ends in a supported language (`en`), so it
 * would otherwise always win and the setting would never do anything.
 */
export function detectDeviceLocale(): SupportedLocale {
  const stored = readStoredLocale();
  if (stored) return stored;

  if (systemDefaultLocale) return systemDefaultLocale;

  const candidates = [
    typeof navigator !== 'undefined' ? navigator.language : undefined,
    ...(typeof navigator !== 'undefined' ? navigator.languages ?? [] : []),
  ];
  for (const tag of candidates) {
    if (!tag) continue;
    const match = matchLocaleTag(tag);
    if (match) return match;
  }
  return DEFAULT_LOCALE;
}
