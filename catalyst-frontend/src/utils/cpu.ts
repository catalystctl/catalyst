import { formatNumber } from '@/i18n/format';

/**
 * The panel reports server CPU *per core*: 100% is one fully-busy core and the
 * ceiling is `allocatedCpuCores * 100` (the agent enforces that ceiling with a
 * CFS quota). A bar drawn straight from that number pegs at full the moment the
 * server uses a single core, which reads as "at capacity" on a multi-core
 * server when it may be a third of the allowance. Every CPU gauge therefore
 * draws `percentOfAllocation` and labels the reading in cores.
 */

/** Allocated cores as a usable divisor; malformed or missing means one core. */
export const resolveCpuCores = (allocatedCpuCores?: number | null): number => {
  const cores = Number(allocatedCpuCores);
  return Number.isFinite(cores) && cores >= 1 ? cores : 1;
};

/** Cores actually busy, derived from the per-core percentage. */
export const cpuCoresUsed = (
  cpuPercent?: number | null,
  allocatedCpuCores?: number | null,
): number => {
  const percent = Number(cpuPercent);
  if (!Number.isFinite(percent) || percent <= 0) return 0;
  const cores = resolveCpuCores(allocatedCpuCores);
  // Never report more than the allocation: the agent's quota caps it anyway,
  // and a stale sample must not show "3.2 / 3".
  return Math.min(cores, percent / 100);
};

/**
 * Share of the allocation in use (0-100), which is what a gauge should draw.
 * Independent of the core floor so a 1-core server is unchanged.
 */
export const cpuPercentOfAllocation = (
  cpuPercent?: number | null,
  allocatedCpuCores?: number | null,
): number => {
  const percent = Number(cpuPercent);
  if (!Number.isFinite(percent) || percent <= 0) return 0;
  return Math.min(100, percent / resolveCpuCores(allocatedCpuCores));
};

/** One-decimal, locale-aware cores reading: 2.6 cores out of 3. */
export const formatCpuCores = (cores: number): string =>
  formatNumber(cores, { maximumFractionDigits: 1, useGrouping: false });
