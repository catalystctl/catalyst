/**
 * Pure helpers that translate between the preset schedule picker and a 5-field
 * cron expression.
 *
 * The panel stores exactly one schedule string per task and the backend runs it
 * through node-cron in `TZ`, so the builder must emit real cron and stay
 * reversible: whatever the user assembles in the presets has to parse back into
 * the same presets when the task is reopened for editing.
 *
 * All arithmetic is timezone-free — the picker collects a wall-clock time and
 * the cron stores the same wall-clock fields, so there is no Date math here.
 */

export const REPEAT_MODES = [
  'minute',
  'minutes',
  'hour',
  'daily',
  'weekly',
  'monthly',
  'custom',
] as const;

export type RepeatMode = (typeof REPEAT_MODES)[number];

export interface ScheduleSpec {
  repeat: RepeatMode;
  /** Every-N-minutes step, 1-59 (repeat === 'minutes'). */
  interval: number;
  /** Minute of the hour, 0-59. Ignored by 'minute'/'minutes'. */
  minute: number;
  /** Hour of the day, 0-23. Used by 'daily'/'weekly'/'monthly'. */
  hour: number;
  /** 0 (Sunday) - 6 (Saturday). Used by 'weekly'. */
  weekday: number;
  /** Day of the month, 1-31. Used by 'monthly'. */
  dayOfMonth: number;
  /** Raw expression, only read when repeat === 'custom'. */
  custom: string;
}

export const DEFAULT_SPEC: ScheduleSpec = {
  repeat: 'daily',
  interval: 15,
  minute: 0,
  hour: 3,
  weekday: 1,
  dayOfMonth: 1,
  custom: '',
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/** Normalize an unknown spec so an out-of-range value can never produce garbage cron. */
export function normalizeSpec(spec: Partial<ScheduleSpec> | null | undefined): ScheduleSpec {
  const merged = { ...DEFAULT_SPEC, ...(spec ?? {}) };
  const repeat = (REPEAT_MODES as readonly string[]).includes(merged.repeat)
    ? (merged.repeat as RepeatMode)
    : DEFAULT_SPEC.repeat;
  return {
    repeat,
    interval: clamp(Math.trunc(merged.interval) || 1, 1, 59),
    minute: clamp(Math.trunc(merged.minute) || 0, 0, 59),
    hour: clamp(Math.trunc(merged.hour) || 0, 0, 23),
    weekday: clamp(Math.trunc(merged.weekday) || 0, 0, 6),
    dayOfMonth: clamp(Math.trunc(merged.dayOfMonth) || 1, 1, 31),
    custom: typeof merged.custom === 'string' ? merged.custom : '',
  };
}

/** Render the spec as a 5-field cron expression. */
export function buildCron(spec: ScheduleSpec): string {
  const s = normalizeSpec(spec);
  switch (s.repeat) {
    case 'minute':
      return '* * * * *';
    case 'minutes':
      return s.interval === 1 ? '* * * * *' : `*/${s.interval} * * * *`;
    case 'hour':
      return `${s.minute} * * * *`;
    case 'daily':
      return `${s.minute} ${s.hour} * * *`;
    case 'weekly':
      return `${s.minute} ${s.hour} * * ${s.weekday}`;
    case 'monthly':
      return `${s.minute} ${s.hour} ${s.dayOfMonth} * *`;
    case 'custom':
    default:
      return s.custom.trim();
  }
}

const INT = /^\d{1,2}$/;
const STEP = /^\*\/(\d{1,2})$/;

/**
 * Best-effort reverse of {@link buildCron}. Returns `null` for anything that is
 * not one of the shapes the builder emits, so callers can fall back to showing
 * the raw expression instead of silently rewriting a hand-written schedule.
 */
export function parseCron(expression: string | null | undefined): ScheduleSpec | null {
  const parts = (expression ?? '').trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hour, dom, month, dow] = parts;

  // Only the every-* shapes the builder produces; anything with a list, range
  // or name (MON, 1-5, 1,15) is left to the raw/advanced editor.
  if (month !== '*') return null;

  if (min === '*' && hour === '*' && dom === '*' && dow === '*') {
    return { ...DEFAULT_SPEC, repeat: 'minute' };
  }

  const stepMatch = min.match(STEP);
  if (stepMatch && hour === '*' && dom === '*' && dow === '*') {
    return { ...DEFAULT_SPEC, repeat: 'minutes', interval: clamp(Number(stepMatch[1]), 1, 59) };
  }

  if (INT.test(min) && hour === '*' && dom === '*' && dow === '*') {
    return { ...DEFAULT_SPEC, repeat: 'hour', minute: Number(min) };
  }

  if (INT.test(min) && INT.test(hour)) {
    const minute = clamp(Number(min), 0, 59);
    const hourOfDay = clamp(Number(hour), 0, 23);

    if (dom === '*' && dow === '*') {
      return { ...DEFAULT_SPEC, repeat: 'daily', minute, hour: hourOfDay };
    }
    if (dom === '*' && INT.test(dow)) {
      return {
        ...DEFAULT_SPEC,
        repeat: 'weekly',
        minute,
        hour: hourOfDay,
        weekday: clamp(Number(dow), 0, 6),
      };
    }
    if (INT.test(dom) && dow === '*') {
      return {
        ...DEFAULT_SPEC,
        repeat: 'monthly',
        minute,
        hour: hourOfDay,
        dayOfMonth: clamp(Number(dom), 1, 31),
      };
    }
  }

  return null;
}

/** Spec for "as soon as possible" — used to seed a task whose cron cannot be parsed. */
export function fallbackSpec(expression: string): ScheduleSpec {
  return { ...DEFAULT_SPEC, repeat: 'custom', custom: expression };
}

/**
 * Seed the picker from an existing cron. Unparseable expressions land in the
 * advanced editor with the original text intact rather than being rewritten.
 */
export function specFromCron(expression: string | null | undefined): {
  spec: ScheduleSpec;
  advanced: boolean;
} {
  const parsed = parseCron(expression);
  if (parsed) return { spec: parsed, advanced: false };
  const trimmed = (expression ?? '').trim();
  if (!trimmed) return { spec: { ...DEFAULT_SPEC }, advanced: false };
  return { spec: fallbackSpec(trimmed), advanced: true };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `HH:MM` for a native `<input type="time">` value. */
export function toTimeValue(hour: number, minute: number): string {
  return `${pad(clamp(Math.trunc(hour) || 0, 0, 23))}:${pad(clamp(Math.trunc(minute) || 0, 0, 59))}`;
}

/** Inverse of {@link toTimeValue}; tolerates a bare `HH:MM` or empty input. */
export function fromTimeValue(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{1,2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/**
 * Which summary phrase describes this spec. The caller owns the copy so the
 * literal i18n keys stay visible to the extractor.
 */
export function describeSpec(spec: ScheduleSpec): { kind: RepeatMode } {
  return { kind: normalizeSpec(spec).repeat };
}

export const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;
