import { describe, expect, it } from 'vitest';
import { cpuCoresUsed, cpuPercentOfAllocation, formatCpuCores, resolveCpuCores } from '../cpu';

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
