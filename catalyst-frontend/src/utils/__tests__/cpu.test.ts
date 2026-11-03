import { describe, expect, it } from 'vitest';
import {
  CPU_DISPLAY_FORMATS,
  CPU_FORMAT_PREFERENCES,
  DEFAULT_CPU_DISPLAY_FORMAT,
  cpuCoresUsed,
  cpuPercentOfAllocation,
  formatCpuCores,
  formatCpuReading,
  isCpuDisplayFormat,
  isCpuFormatPreference,
  resolveCpuCores,
  resolveCpuFormat,
} from '../cpu';

/**
 * Regression cover for the multi-core CPU gauge. Catalyst reports server CPU
 * per core (100% = one busy core) up to `allocatedCpuCores * 100`, so a gauge
 * fed the raw percentage pegs at full the moment a server uses a single core.
 */
describe('resolveCpuCores', () => {
  it('passes through a real allocation', () => {
    expect(resolveCpuCores(1)).toBe(1);
    expect(resolveCpuCores(3)).toBe(3);
    expect(resolveCpuCores(16)).toBe(16);
  });

  it('falls back to one core for missing or malformed allocations', () => {
    // A missing allocation must not divide by zero or hide the reading.
    expect(resolveCpuCores(undefined)).toBe(1);
    expect(resolveCpuCores(null)).toBe(1);
    expect(resolveCpuCores(0)).toBe(1);
    expect(resolveCpuCores(-2)).toBe(1);
    expect(resolveCpuCores(Number.NaN)).toBe(1);
    expect(resolveCpuCores(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe('cpuPercentOfAllocation', () => {
  it('leaves a single-core server unchanged', () => {
    expect(cpuPercentOfAllocation(0, 1)).toBe(0);
    expect(cpuPercentOfAllocation(50, 1)).toBe(50);
    expect(cpuPercentOfAllocation(100, 1)).toBe(100);
  });

  it('scales a multi-core reading down to the share of the allocation', () => {
    // The reported 260% on three cores is ~87% of the allowance, not an
    // overflow — this is the case that drew a pegged bar.
    expect(cpuPercentOfAllocation(260, 3)).toBeCloseTo(86.667, 3);
    expect(cpuPercentOfAllocation(100, 3)).toBeCloseTo(33.333, 3);
    expect(cpuPercentOfAllocation(300, 3)).toBe(100);
    expect(cpuPercentOfAllocation(150, 2)).toBe(75);
  });

  it('clamps at 100 so a stale over-allocation sample cannot overflow', () => {
    expect(cpuPercentOfAllocation(400, 3)).toBe(100);
  });

  it('treats absent or negative readings as idle', () => {
    expect(cpuPercentOfAllocation(undefined, 3)).toBe(0);
    expect(cpuPercentOfAllocation(null, 3)).toBe(0);
    expect(cpuPercentOfAllocation(-5, 3)).toBe(0);
    expect(cpuPercentOfAllocation(Number.NaN, 3)).toBe(0);
  });
});

describe('cpuCoresUsed', () => {
  it('converts the per-core percentage into cores', () => {
    expect(cpuCoresUsed(260, 3)).toBeCloseTo(2.6, 3);
    expect(cpuCoresUsed(100, 3)).toBe(1);
    expect(cpuCoresUsed(50, 1)).toBe(0.5);
  });

  it('never reports more than the allocation', () => {
    expect(cpuCoresUsed(400, 3)).toBe(3);
    expect(cpuCoresUsed(120, 1)).toBe(1);
  });

  it('reports zero for idle or unreadable values', () => {
    expect(cpuCoresUsed(0, 3)).toBe(0);
    expect(cpuCoresUsed(undefined, 3)).toBe(0);
    expect(cpuCoresUsed(-1, 3)).toBe(0);
  });
});

describe('formatCpuCores', () => {
  it('rounds to one decimal so the reading fits a narrow column', () => {
    expect(formatCpuCores(2.6)).toBe('2.6');
    expect(formatCpuCores(3)).toBe('3');
    expect(formatCpuCores(0.5)).toBe('0.5');
    expect(formatCpuCores(2.646)).toBe('2.6');
  });
});

/**
 * The user-facing choice: three formats, one underlying number, plus a
 * "follow the panel" option. None of them may change what the bar draws.
 */
describe('formatCpuReading', () => {
  it('prints the same sample three ways on a 4-core server', () => {
    // 260% per core on 4 cores = 2.6 cores busy = 65% of the allocation.
    expect(formatCpuReading(260, 4, 'cores').text).toBe('2.6 / 4 cores');
    expect(formatCpuReading(260, 4, 'perCore').text).toBe('260%');
    expect(formatCpuReading(260, 4, 'share').text).toBe('65%');
  });

  it('keeps the bar on the share of the allocation in every format', () => {
    for (const format of CPU_DISPLAY_FORMATS) {
      const reading = formatCpuReading(260, 4, format);
      expect(reading.share).toBe(65);
      expect(reading.cores).toBeCloseTo(2.6, 5);
      expect(reading.allocated).toBe(4);
      expect(reading.format).toBe(format);
    }
  });

  it('uses the compact flavour only for the cores format', () => {
    // The servers-list column is 88px; the other two formats are already terse.
    expect(formatCpuReading(260, 4, 'cores', { compact: true }).text).toBe('2.6/4');
    expect(formatCpuReading(260, 4, 'perCore', { compact: true }).text).toBe('260%');
    expect(formatCpuReading(260, 4, 'share', { compact: true }).text).toBe('65%');
  });

  it('prints an idle server consistently', () => {
    expect(formatCpuReading(0, 4, 'cores').text).toBe('0 / 4 cores');
    expect(formatCpuReading(0, 4, 'perCore').text).toBe('0%');
    expect(formatCpuReading(0, 4, 'share').text).toBe('0%');
  });

  it('treats a full allocation as 100% share and cores*100 per-core', () => {
    expect(formatCpuReading(400, 4, 'perCore').text).toBe('400%');
    expect(formatCpuReading(400, 4, 'share').text).toBe('100%');
    expect(formatCpuReading(400, 4, 'cores').text).toBe('4 / 4 cores');
  });

  it('never lets a stale sample exceed the allocation', () => {
    // 600% on 4 cores would be 6 cores: clamp the reading, not just the bar.
    expect(formatCpuReading(600, 4, 'cores').text).toBe('4 / 4 cores');
    expect(formatCpuReading(600, 4, 'share').text).toBe('100%');
    expect(formatCpuReading(600, 4, 'perCore').text).toBe('400%');
  });

  it('falls back to one core when the allocation is missing', () => {
    expect(formatCpuReading(100, undefined, 'cores').text).toBe('1 / 1 cores');
    expect(formatCpuReading(100, undefined, 'share').text).toBe('100%');
  });

  it('defaults to the cores format', () => {
    expect(formatCpuReading(260, 4).text).toBe('2.6 / 4 cores');
    expect(DEFAULT_CPU_DISPLAY_FORMAT).toBe('cores');
  });
});

describe('resolveCpuFormat', () => {
  it('prefers a pinned user format over the panel default', () => {
    expect(resolveCpuFormat('share', 'perCore')).toBe('share');
    expect(resolveCpuFormat('perCore', 'cores')).toBe('perCore');
  });

  it('follows the panel default when the user chose "panel"', () => {
    expect(resolveCpuFormat('panel', 'perCore')).toBe('perCore');
    expect(resolveCpuFormat('panel', 'share')).toBe('share');
    expect(resolveCpuFormat(undefined, 'perCore')).toBe('perCore');
  });

  it('falls back to cores when neither side is usable', () => {
    // A corrupt persisted store or an admin API that predates this field.
    expect(resolveCpuFormat('panel', undefined)).toBe('cores');
    expect(resolveCpuFormat(null, null)).toBe('cores');
    expect(resolveCpuFormat('nonsense' as never, 'garbage')).toBe('cores');
  });
});

describe('format guards', () => {
  it('accepts only the documented values', () => {
    expect(CPU_DISPLAY_FORMATS).toEqual(['cores', 'perCore', 'share']);
    expect(CPU_FORMAT_PREFERENCES).toEqual(['panel', 'cores', 'perCore', 'share']);
    expect(isCpuDisplayFormat('perCore')).toBe(true);
    expect(isCpuDisplayFormat('panel')).toBe(false);
    expect(isCpuDisplayFormat('')).toBe(false);
    expect(isCpuDisplayFormat(2)).toBe(false);
    expect(isCpuFormatPreference('panel')).toBe(true);
    expect(isCpuFormatPreference('share')).toBe(true);
    expect(isCpuFormatPreference('other')).toBe(false);
  });
});
