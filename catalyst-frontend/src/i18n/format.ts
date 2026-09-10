import i18n from './index';
import { DEFAULT_LOCALE, isSupportedLocale, matchLocaleTag } from './config';

/** BCP-47 tag for the active interface language, suitable for the Intl APIs. */
export function activeLocale(): string {
  const language = i18n.resolvedLanguage ?? i18n.language;
  if (isSupportedLocale(language)) return language;
  return matchLocaleTag(language ?? '') ?? DEFAULT_LOCALE;
}

function toDate(value: Date | number | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export function formatDateTime(
  value: Date | number | string,
  options?: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(activeLocale(), options).format(toDate(value));
}

export function formatDate(
  value: Date | number | string,
  options?: Intl.DateTimeFormatOptions,
): string {
  return formatDateTime(value, { dateStyle: 'medium', ...options });
}

export function formatTime(
  value: Date | number | string,
  options?: Intl.DateTimeFormatOptions,
): string {
  return formatDateTime(value, { timeStyle: 'short', ...options });
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(activeLocale(), options).format(value);
}

const RELATIVE_TIME_UNITS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 60 * 60 * 1000],
  ['month', 30 * 24 * 60 * 60 * 1000],
  ['week', 7 * 24 * 60 * 60 * 1000],
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', 60 * 1000],
  ['second', 1000],
];

/**
 * Localized "3 hours ago" / "in 2 days". Falls back to seconds for any input,
 * so callers never need their own unit thresholds.
 */
export function formatRelativeTime(
  value: Date | number | string,
  base: Date | number = Date.now(),
): string {
  const target = toDate(value).getTime();
  const reference = base instanceof Date ? base.getTime() : base;
  const deltaMs = target - reference;
  const absMs = Math.abs(deltaMs);
  const formatter = new Intl.RelativeTimeFormat(activeLocale(), { numeric: 'auto' });

  for (const [unit, unitMs] of RELATIVE_TIME_UNITS) {
    if (absMs >= unitMs || unit === 'second') {
      return formatter.format(Math.round(deltaMs / unitMs), unit);
    }
  }
  return formatter.format(Math.round(deltaMs / 1000), 'second');
}
