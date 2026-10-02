import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SPEC,
  buildCron,
  fromTimeValue,
  normalizeSpec,
  parseCron,
  specFromCron,
  toTimeValue,
  type ScheduleSpec,
} from '../scheduleBuilder';

const spec = (partial: Partial<ScheduleSpec>): ScheduleSpec => ({ ...DEFAULT_SPEC, ...partial });

describe('buildCron', () => {
  it('emits the expected expression for each preset', () => {
    expect(buildCron(spec({ repeat: 'minute' }))).toBe('* * * * *');
    expect(buildCron(spec({ repeat: 'minutes', interval: 15 }))).toBe('*/15 * * * *');
    expect(buildCron(spec({ repeat: 'minutes', interval: 1 }))).toBe('* * * * *');
    expect(buildCron(spec({ repeat: 'hour', minute: 30 }))).toBe('30 * * * *');
    expect(buildCron(spec({ repeat: 'daily', hour: 22, minute: 0 }))).toBe('0 22 * * *');
    expect(buildCron(spec({ repeat: 'weekly', weekday: 5, hour: 9, minute: 15 }))).toBe('15 9 * * 5');
    expect(buildCron(spec({ repeat: 'monthly', dayOfMonth: 1, hour: 3, minute: 0 }))).toBe('0 3 1 * *');
    expect(buildCron(spec({ repeat: 'custom', custom: '0 */2 1,15 * 3' }))).toBe('0 */2 1,15 * 3');
  });

  it('clamps out-of-range values instead of emitting invalid cron', () => {
    expect(buildCron(spec({ repeat: 'daily', hour: 99, minute: 99 }))).toBe('59 23 * * *');
    expect(buildCron(spec({ repeat: 'monthly', dayOfMonth: 0, hour: 3, minute: 0 }))).toBe('0 3 1 * *');
    expect(buildCron(spec({ repeat: 'weekly', weekday: 9 }))).toBe('0 3 * * 6');
  });
});

describe('parseCron', () => {
  it('round-trips every expression the builder emits', () => {
    const cases: ScheduleSpec[] = [
      spec({ repeat: 'minute' }),
      spec({ repeat: 'minutes', interval: 15 }),
      spec({ repeat: 'hour', minute: 30 }),
      spec({ repeat: 'daily', hour: 22, minute: 0 }),
      spec({ repeat: 'weekly', weekday: 5, hour: 9, minute: 15 }),
      spec({ repeat: 'monthly', dayOfMonth: 15, hour: 3, minute: 45 }),
    ];

    for (const original of cases) {
      const parsed = parseCron(buildCron(original));
      expect(parsed).not.toBeNull();
      // Everything except the raw/custom text must survive the round trip.
      expect(parsed).toMatchObject({
        repeat: original.repeat,
        interval: original.interval,
        minute: original.minute,
        hour: original.hour,
        weekday: original.weekday,
        dayOfMonth: original.dayOfMonth,
      });
      expect(buildCron(parsed!)).toBe(buildCron(original));
    }
  });

  it('parses the daily 22:00 example from the task-edit flow', () => {
    expect(parseCron('0 22 * * *')).toMatchObject({ repeat: 'daily', hour: 22, minute: 0 });
  });

  it('returns null for expressions the presets cannot express', () => {
    expect(parseCron('0 */2 1,15 * 3')).toBeNull();
    expect(parseCron('0 3 * * MON')).toBeNull();
    expect(parseCron('0 3 * 6 *')).toBeNull();
    expect(parseCron('0 3 * * 1-5')).toBeNull();
    expect(parseCron('* * * *')).toBeNull();
    expect(parseCron('')).toBeNull();
    expect(parseCron(null)).toBeNull();
  });
});

describe('specFromCron', () => {
  it('keeps parseable expressions in the presets', () => {
    const { spec: parsed, advanced } = specFromCron('30 4 * * *');
    expect(advanced).toBe(false);
    expect(parsed).toMatchObject({ repeat: 'daily', hour: 4, minute: 30 });
  });

  it('falls back to the advanced editor with the raw text intact', () => {
    const { spec: parsed, advanced } = specFromCron('0 */2 1,15 * 3');
    expect(advanced).toBe(true);
    expect(parsed.repeat).toBe('custom');
    expect(parsed.custom).toBe('0 */2 1,15 * 3');
  });

  it('seeds a fresh daily schedule when there is no expression', () => {
    const { spec: parsed, advanced } = specFromCron('');
    expect(advanced).toBe(false);
    expect(parsed.repeat).toBe(DEFAULT_SPEC.repeat);
  });
});

describe('time helpers', () => {
  it('formats and parses HH:MM', () => {
    expect(toTimeValue(3, 5)).toBe('03:05');
    expect(toTimeValue(23, 59)).toBe('23:59');
    expect(fromTimeValue('22:00')).toEqual({ hour: 22, minute: 0 });
    expect(fromTimeValue('9:5')).toEqual({ hour: 9, minute: 5 });
    expect(fromTimeValue('24:00')).toBeNull();
    expect(fromTimeValue('')).toBeNull();
  });
});

describe('normalizeSpec', () => {
  it('repairs a corrupt spec rather than producing garbage cron', () => {
    const repaired = normalizeSpec({
      repeat: 'nonsense' as never,
      interval: 0,
      minute: NaN,
      hour: -5,
      weekday: 12,
      dayOfMonth: 99,
    });
    expect(repaired.repeat).toBe('daily');
    expect(repaired.interval).toBe(1);
    expect(repaired.minute).toBe(0);
    expect(repaired.hour).toBe(0);
    expect(repaired.weekday).toBe(6);
    expect(repaired.dayOfMonth).toBe(31);
  });
});
