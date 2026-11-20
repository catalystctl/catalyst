import { describe, expect, it } from 'vitest';
import {
  countCpus,
  cpuAffinityChips,
  formatCpuList,
  isCpuSubset,
  normalizeCpuAffinity,
  parseCpuList,
  toggleCpus,
} from './cpuAffinity';
import { MAX_CPU_AFFINITY_LENGTH } from './serverLimits';

/**
 * A valid mask of exactly MAX_CPU_AFFINITY_LENGTH characters (127 three-character
 * items plus one four-character item, joined by commas) and its one-char-longer
 * sibling, which must be rejected.
 */
const longValidMask = [...Array<string>(127).fill('0-9'), '0-99'].join(',');
const longInvalidMask = [...Array<string>(127).fill('0-9'), '0-999'].join(',');

describe('cpu affinity parsing', () => {
  it('keeps the fixture masks at the intended lengths', () => {
    expect(longValidMask).toHaveLength(MAX_CPU_AFFINITY_LENGTH);
    expect(longInvalidMask).toHaveLength(MAX_CPU_AFFINITY_LENGTH + 1);
  });

  const accepted: Array<[string | null | undefined, string | null, number[]]> = [
    ['0', '0', [0]],
    ['0-3', '0-3', [0, 1, 2, 3]],
    ['0-3,6', '0-3,6', [0, 1, 2, 3, 6]],
    ['2,0-1', '0-2', [0, 1, 2]],
    ['0-1,2-3', '0-3', [0, 1, 2, 3]],
    ['5-5', '5', [5]],
    [' 0 - 3 , 6 ', '0-3,6', [0, 1, 2, 3, 6]],
    ['0 - 3 , 6', '0-3,6', [0, 1, 2, 3, 6]],
    ['0,1,1', '0-1', [0, 1]],
    ['0-4095', '0-4095', []],
    [longValidMask, '0-99', []],
    ['', null, []],
    ['   ', null, []],
    [null, null, []],
    [undefined, null, []],
  ];

  it.each(accepted)('canonicalises %j to %j', (input, mask, cpus) => {
    const normalized = normalizeCpuAffinity(input);
    expect(normalized).toEqual({ ok: true, mask });
    if (cpus.length) {
      expect(parseCpuList(input as string)).toEqual(cpus);
      expect(countCpus(mask)).toBe(cpus.length);
    }
  });

  it('accepts every CPU index up to the hard bound', () => {
    const cpus = parseCpuList('0-4095');
    expect(cpus).toHaveLength(4096);
    expect(cpus?.[4095]).toBe(4095);
    expect(countCpus(longValidMask)).toBe(100);
    expect(countCpus('0-4095')).toBe(4096);
  });

  const rejected = [
    '3-1',
    '01',
    '0-',
    '-1',
    '0,,1',
    '0,',
    '0-3,,6',
    'a',
    '0-4096',
    '4097',
    '1.5',
    '0-3 ,',
    longInvalidMask,
  ];

  it.each(rejected)('rejects %j', (input) => {
    expect(parseCpuList(input)).toBeNull();
    expect(normalizeCpuAffinity(input)).toEqual({ ok: false, error: 'invalid' });
    // An invalid list is never counted as a pin and never a subset of anything.
    expect(countCpus(input)).toBe(0);
    expect(isCpuSubset(input, '0-15')).toBe(false);
  });
});

describe('formatCpuList', () => {
  it('sorts, dedupes and merges contiguous runs', () => {
    expect(formatCpuList([6, 3, 2, 1, 0])).toBe('0-3,6');
    expect(formatCpuList([0, 2, 4])).toBe('0,2,4');
    expect(formatCpuList([7])).toBe('7');
    expect(formatCpuList([])).toBe('');
  });
});

describe('isCpuSubset', () => {
  it('checks the mask against a known set', () => {
    expect(isCpuSubset('0-3', '0-7')).toBe(true);
    expect(isCpuSubset('0-3,6', '0-7')).toBe(true);
    expect(isCpuSubset('0-15,32-47', '0-15,32-47')).toBe(true);
    expect(isCpuSubset('16', '0-15,32-47')).toBe(false);
    expect(isCpuSubset(null, '0-3')).toBe(true);
  });

  it('fails open when the node has not reported a set', () => {
    expect(isCpuSubset('0-3', null)).toBe(true);
    expect(isCpuSubset('0-3', undefined)).toBe(true);
    expect(isCpuSubset('0-3', 'not a set')).toBe(true);
    expect(isCpuSubset('0-3', '')).toBe(true);
  });

  it('treats an empty mask as "not a mask" rather than "no pinning"', () => {
    // The backend's strict parser rejects "", so only null means "no pinning".
    expect(isCpuSubset('', '0-3')).toBe(false);
    expect(isCpuSubset('   ', '0-3')).toBe(false);
    expect(isCpuSubset(null, '0-3')).toBe(true);
  });
});

describe('cpuAffinityChips', () => {
  it('gives one chip per CPU for a small set', () => {
    expect(cpuAffinityChips([0, 1, 2, 3])).toEqual([
      { key: '0', label: '0', cpus: [0] },
      { key: '1', label: '1', cpus: [1] },
      { key: '2', label: '2', cpus: [2] },
      { key: '3', label: '3', cpus: [3] },
    ]);
  });

  it('groups a large sparse set into runs of at most eight CPUs', () => {
    const host = parseCpuList('0-31,64-95') ?? [];
    const chips = cpuAffinityChips(host);
    expect(chips.flatMap((chip) => chip.cpus)).toEqual(host);
    expect(chips.map((chip) => chip.label)).toEqual([
      '0-7',
      '8-15',
      '16-23',
      '24-31',
      '64-71',
      '72-79',
      '80-87',
      '88-95',
    ]);
  });

  it('keeps one chip per CPU at the 32-CPU boundary', () => {
    const host = parseCpuList('0-15,32-47') ?? [];
    expect(cpuAffinityChips(host)).toHaveLength(32);
  });

  it('keeps gaps between runs as separate chips', () => {
    const host = Array.from({ length: 40 }, (_, index) => index * 2);
    const chips = cpuAffinityChips(host);
    expect(chips).toHaveLength(40);
    expect(chips[1]).toEqual({ key: '2', label: '2', cpus: [2] });
  });
});

describe('toggleCpus', () => {
  it('adds and removes CPUs, canonicalising the result', () => {
    expect(toggleCpus(null, [1])).toBe('1');
    expect(toggleCpus('0,2', [1])).toBe('0-2');
    expect(toggleCpus('0-3', [1, 2])).toBe('0,3');
    expect(toggleCpus('0', [0])).toBeNull();
  });
});
