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

/** Component options that cannot be combined with dateStyle/timeStyle in Intl. */
const COMPONENT_OPTIONS = [
  'weekday',
  'era',
  'year',
  'month',
  'day',
  'dayPeriod',
  'hour',
  'minute',
  'second',
  'fractionalSecondDigits',
  'timeZoneName',
] as const;

/**
 * Intl forbids mixing `dateStyle`/`timeStyle` with explicit component options,
 * so the style defaults only apply when the caller passes none of the latter.
 */
function withStyleDefaults(
  options: Intl.DateTimeFormatOptions | undefined,
  defaults: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormatOptions {
  if (!options) return defaults;
  const probe = options as Record<string, unknown>;
  const hasComponent = COMPONENT_OPTIONS.some((key) => probe[key] !== undefined);
  return hasComponent ? options : { ...defaults, ...options };
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
  return formatDateTime(value, withStyleDefaults(options, { dateStyle: 'medium' }));
}

export function formatTime(
  value: Date | number | string,
  options?: Intl.DateTimeFormatOptions,
): string {
  return formatDateTime(value, withStyleDefaults(options, { timeStyle: 'short' }));
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

/**
 * Elapsed reading ("3 minutes ago", "now") for a timestamp the UI knows has
 * already happened — a session's last activity, a plugin's load time, the
 * moment an update started.
 *
 * Use this instead of `formatRelativeTime` whenever the timestamp comes from
 * the SERVER. `Intl.RelativeTimeFormat` is direction-agnostic, so a server
 * clock running even a few seconds ahead of the browser produced "Started in
 * 24 seconds" for an update that was already pulling images. Three guards
 * make the reading impossible to invert:
 *
 *  - Anything at or after `base` clamps to zero elapsed → "now". The event
 *    demonstrably happened, so its start cannot be in the future; the skew is
 *    the display's problem, not the user's.
 *  - Units floor instead of round, so 59.6s reads "59 seconds ago" rather
 *    than "60 seconds ago" and never overstates the age.
 *  - An unparseable value returns '' — `Intl.RelativeTimeFormat.format(NaN)`
 *    throws a RangeError, which would take the whole render down.
 */
export function formatTimeSince(
  value: Date | number | string,
  base: Date | number = Date.now(),
): string {
  const target = toDate(value).getTime();
  if (!Number.isFinite(target)) return '';
  const reference = base instanceof Date ? base.getTime() : base;
  const elapsedMs = Math.max(0, reference - target);
  const formatter = new Intl.RelativeTimeFormat(activeLocale(), { numeric: 'auto' });

  for (const [unit, unitMs] of RELATIVE_TIME_UNITS) {
    if (elapsedMs >= unitMs || unit === 'second') {
      return formatter.format(-Math.floor(elapsedMs / unitMs), unit);
    }
  }
  return formatter.format(0, 'second');
}
