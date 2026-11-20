/**
 * Table tests for the CPU affinity grammar. The same cases exist for the
 * frontend mirror (`catalyst-frontend/src/lib/cpuAffinity.test.ts`); a
 * divergence here means the form and the API disagree about a mask.
 */
import { describe, expect, it } from 'vitest';
import {
  InvalidCpuAffinityError,
  MAX_CPU_AFFINITY_LENGTH,
  MAX_CPU_INDEX,
  countCpus,
  formatCpuList,
  isCpuSubset,
  maxCpuIndexOf,
  normalizeCpuAffinity,
  parseCpuList,
  validateCpuAffinityWrite,
} from '../lib/cpu-affinity.js';

describe('normalizeCpuAffinity', () => {
  const accepted: Array<[string | null, string | null]> = [
    [null, null],
    ['', null],
    ['   ', null],
    ['0', '0'],
    ['0-3', '0-3'],
    ['0-3,6', '0-3,6'],
    ['0-3,8-11', '0-3,8-11'],
    [' 0 - 3 , 6 ', '0-3,6'],
    ['2,0-1', '0-2'],
    ['5-5', '5'],
    ['1,1,1', '1'],
    ['0-1,1-2', '0-2'],
    ['6,0-3', '0-3,6'],
    ['0-15,32-47', '0-15,32-47'],
    [`0-${MAX_CPU_INDEX}`, `0-${MAX_CPU_INDEX}`],
  ];

  for (const [input, expected] of accepted) {
    it(`normalises ${JSON.stringify(input)} to ${JSON.stringify(expected)}`, () => {
      expect(normalizeCpuAffinity(input)).toBe(expected);
    });
  }

  const rejected: Array<[string, string]> = [
    ['3-1', 'range_order'],
    ['01', 'leading_zero'],
    ['0-01', 'leading_zero'],
    ['0-', 'invalid_token'],
    ['-1', 'invalid_token'],
    ['0-1-2', 'invalid_token'],
    ['a', 'invalid_token'],
    ['0,,1', 'empty_item'],
    ['0,', 'empty_item'],
    ['0-4096', 'out_of_range'],
    ['4096', 'out_of_range'],
    ['1.5', 'invalid_token'],
    [`${'1,'.repeat(300)}1`, 'too_long'],
  ];

  for (const [input, reason] of rejected) {
    it(`rejects ${JSON.stringify(input)} as ${reason}`, () => {
      let error: unknown;
      try {
        normalizeCpuAffinity(input);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(InvalidCpuAffinityError);
      expect((error as InvalidCpuAffinityError).reason).toBe(reason);
      expect(parseCpuList(input)).toBeNull();
    });
  }

  it('accepts a mask exactly at the length limit and rejects one over it', () => {
    const atLimit = `${'1,'.repeat(255)}12`;
    expect(atLimit).toHaveLength(MAX_CPU_AFFINITY_LENGTH);
    expect(() => normalizeCpuAffinity(atLimit)).not.toThrow();
    expect(() => normalizeCpuAffinity(`${atLimit}1`)).toThrow(InvalidCpuAffinityError);
  });
});

describe('formatCpuList', () => {
  it('merges runs and dedupes', () => {
    expect(formatCpuList([0, 1, 2, 3, 6])).toBe('0-3,6');
    expect(formatCpuList([6, 0, 2, 1])).toBe('0-2,6');
    expect(formatCpuList([])).toBe('');
  });
});

describe('isCpuSubset', () => {
  it('accepts a subset and rejects a stray CPU', () => {
    expect(isCpuSubset('0-3', '0-15')).toBe(true);
    expect(isCpuSubset('0-3,16', '0-15')).toBe(false);
    expect(isCpuSubset('16', '0-15,32-47')).toBe(false);
    expect(isCpuSubset('32-35', '0-15,32-47')).toBe(true);
  });

  it('fails open when the node set is unknown or unparseable', () => {
    expect(isCpuSubset('0-3', null)).toBe(true);
    expect(isCpuSubset('0-3', undefined)).toBe(true);
    expect(isCpuSubset('0-3', 'not-a-list')).toBe(true);
  });

  it('fails closed when the mask itself is invalid', () => {
    expect(isCpuSubset('3-1', '0-15')).toBe(false);
  });
});

describe('countCpus / maxCpuIndexOf', () => {
  it('counts the CPUs a mask names', () => {
    expect(countCpus('0-3,6')).toBe(5);
    expect(countCpus(null)).toBe(0);
    expect(countCpus('garbage')).toBe(0);
  });

  it('reports the highest available CPU id, or null when unknown', () => {
    expect(maxCpuIndexOf('0-15,32-47')).toBe(47);
    expect(maxCpuIndexOf(null)).toBeNull();
    expect(maxCpuIndexOf('garbage')).toBeNull();
  });
});

describe('validateCpuAffinityWrite', () => {
  const base = { resolvedCores: 2, hostCpuSet: '0-15' } as const;

  it('leaves an omitted field alone', () => {
    expect(validateCpuAffinityWrite({ ...base, raw: undefined })).toEqual({
      ok: true,
      provided: false,
      value: null,
    });
  });

  it('treats null and "" as "unpin" and always allows clearing', () => {
    expect(validateCpuAffinityWrite({ ...base, raw: null })).toEqual({
      ok: true,
      provided: true,
      value: null,
    });
    expect(validateCpuAffinityWrite({ ...base, raw: '' })).toEqual({
      ok: true,
      provided: true,
      value: null,
    });
  });

  it('canonicalises an accepted mask', () => {
    const result = validateCpuAffinityWrite({ ...base, raw: ' 2,0-1 ' });
    expect(result).toEqual({ ok: true, provided: true, value: '0-2' });
  });

  it('refuses a mask the node does not have, naming the available set', () => {
    const result = validateCpuAffinityWrite({ ...base, raw: '0-3,20' });
    expect(result).toEqual({
      ok: false,
      reason: 'unavailable',
      params: { requested: '0-3,20', available: '0-15' },
    });
  });

  it('accepts anything when the node has not reported its CPU set', () => {
    expect(validateCpuAffinityWrite({ ...base, hostCpuSet: null, raw: '0-63' })).toEqual({
      ok: true,
      provided: true,
      value: '0-63',
    });
  });

  it('refuses a pin narrower than the allocation', () => {
    const result = validateCpuAffinityWrite({ ...base, resolvedCores: 4, raw: '0-1' });
    expect(result).toEqual({
      ok: false,
      reason: 'below_allocation',
      params: { cpus: 2, cores: 4 },
    });
  });

  it('accepts a pin wider than the allocation (spread across NUMA)', () => {
    expect(
      validateCpuAffinityWrite({ ...base, resolvedCores: 1, raw: '0-3' }),
    ).toEqual({ ok: true, provided: true, value: '0-3' });
  });

  it('reports a malformed mask as invalid with the offending value', () => {
    const result = validateCpuAffinityWrite({ ...base, raw: '3-1' });
    expect(result).toEqual({
      ok: false,
      reason: 'invalid',
      params: { value: '3-1', reason: 'range_order' },
    });
  });
});
