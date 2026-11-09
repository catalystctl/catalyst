import { formatNumber } from '@/i18n/format';

/**
 * The panel reports server CPU *per core*: 100% is one fully-busy core and the
 * ceiling is `allocatedCpuCores * 100` (the agent enforces that ceiling with a
 * CFS quota). A bar drawn straight from that number pegs at full the moment the
 * server uses a single core, which reads as "at capacity" on a multi-core
 * server when it may be a third of the allowance. Every CPU gauge therefore
 * draws `percentOfAllocation`, whatever format the reading is printed in.
 */

/**
 * How a CPU reading is printed. The *bar* is unaffected: it always means the
 * share of the allocation, so severity never depends on the chosen format.
 *
 *   cores   — "2.6 / 4 cores"
 *   perCore — "260%"   (one core = 100%, ceiling = cores * 100)
 *   share   — "65%"    (share of the server's whole allocation)
 */
export const CPU_DISPLAY_FORMATS = ['cores', 'perCore', 'share'] as const;
export type CpuDisplayFormat = (typeof CPU_DISPLAY_FORMATS)[number];

/** The shipped default; also the backend's column default. */
export const DEFAULT_CPU_DISPLAY_FORMAT: CpuDisplayFormat = 'cores';

/**
 * A user's own choice: follow the panel-wide default, or pin one format.
 * Mirrors ThemePreference's 'panel' option.
 */
export type CpuFormatPreference = 'panel' | CpuDisplayFormat;

export const CPU_FORMAT_PREFERENCES: readonly CpuFormatPreference[] = [
  'panel',
  ...CPU_DISPLAY_FORMATS,
];

export const isCpuDisplayFormat = (value: unknown): value is CpuDisplayFormat =>
  typeof value === 'string' && (CPU_DISPLAY_FORMATS as readonly string[]).includes(value);

export const isCpuFormatPreference = (value: unknown): value is CpuFormatPreference =>
  typeof value === 'string' && (CPU_FORMAT_PREFERENCES as readonly string[]).includes(value);

/**
 * Resolve a stored preference against the panel default. Anything unrecognised
 * (a legacy value, or a corrupt persisted store) falls back to the default
 * rather than rendering an empty gauge.
 */
export const resolveCpuFormat = (
  preference: CpuFormatPreference | null | undefined,
  panelDefault: string | null | undefined,
): CpuDisplayFormat => {
  if (isCpuDisplayFormat(preference)) return preference;
  if (isCpuDisplayFormat(panelDefault)) return panelDefault;
  return DEFAULT_CPU_DISPLAY_FORMAT;
};

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

/** Two decimals, locale-aware: the floor used by the "<" readings. */
const formatCpuFixed = (value: number): string =>
  formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });

/**
 * Locale-aware cores reading: 2.6 cores out of 3.
 *
 * One decimal is enough everywhere except below a tenth of a core, where it
 * rounds a real sample down to "0" — a server idling at 0.4% of a 4-core
 * allocation read "0 / 4 cores" whatever it was actually doing, on the very
 * point the chart was drawing full height. Small readings keep a second
 * decimal, and one too small even for that says so instead of printing zero.
 */
export const formatCpuCores = (cores: number): string => {
  if (!Number.isFinite(cores) || cores <= 0) return '0';
  if (cores < 0.01) return `<${formatCpuFixed(0.01)}`;
  return formatNumber(cores, {
    maximumFractionDigits: cores < 0.1 ? 2 : 1,
    useGrouping: false,
  });
};

/**
 * A CPU percentage as the panel prints it, in whichever scale the caller is
 * showing: share of the allocation or per core. Rounded to whole percent once
 * there is one to round (>= 10%), a decimal in the single digits, two below 1%.
 *
 * Rounding every reading to an integer is what made a near-idle server print
 * "0 / 4 cores · 0% of allocated cores" on every point of a chart that drew its
 * noise floor full height: the number said idle, the shape said peaking.
 */
export const formatCpuPercent = (percent: number): string => {
  if (!Number.isFinite(percent) || percent <= 0) return '0';
  const text = formatNumber(percent, {
    maximumFractionDigits: percent < 1 ? 2 : percent < 10 ? 1 : 0,
    useGrouping: false,
  });
  // A non-zero reading can still round to nothing at the last place.
  return text === '0' ? `<${formatCpuFixed(0.01)}` : text;
};

export type CpuReading = {
  /** The printed value, in the requested format. */
  text: string;
  /** Always the share of the allocation: what the bar draws and severity uses. */
  share: number;
  /** Cores in use (rounded to one decimal). */
  cores: number;
  /** Cores allocated to the server. */
  allocated: number;
  format: CpuDisplayFormat;
};

/**
 * Render one CPU sample in any of the three formats.
 *
 * `compact` is for the servers-list column, which is ~104px wide and cannot
 * afford "2.6 / 4 cores": it prints "2.6/4", "260%" or "65%" instead. Only the
 * cores format gets shorter — the others are already terse.
 */
export const formatCpuReading = (
  cpuPercent: number | null | undefined,
  allocatedCpuCores: number | null | undefined,
  format: CpuDisplayFormat = DEFAULT_CPU_DISPLAY_FORMAT,
  { compact = false }: { compact?: boolean } = {},
): CpuReading => {
  const allocated = resolveCpuCores(allocatedCpuCores);
  const cores = cpuCoresUsed(cpuPercent, allocated);
  const share = cpuPercentOfAllocation(cpuPercent, allocated);

  // Cores keep one decimal from a whole core up so the value never jumps between
  // "2.6 / 4 cores" and "3 / 4 cores" as load drifts.
  const used = formatCpuCores(cores);
  const total = formatCpuCores(allocated);

  const text =
    format === 'perCore'
      ? `${formatCpuPercent(cores * 100)}%`
      : format === 'share'
        ? `${formatCpuPercent(share)}%`
        : compact
          ? `${used}/${total}`
          : `${used} / ${total} cores`;

  return { text, share, cores, allocated, format };
};