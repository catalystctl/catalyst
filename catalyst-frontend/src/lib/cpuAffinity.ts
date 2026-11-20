/**
 * CPU affinity (cpuset) parsing and formatting for the panel forms.
 *
 * Deliberate mirror of `catalyst-backend/src/lib/cpu-affinity.ts`: the backend
 * is the authority, this copy exists only so the forms can validate and
 * canonicalise before a request and so the CPU picker can reason about a node's
 * reported CPU set. A shared package was rejected because the frontend cannot
 * import backend sources, so the two copies are pinned by the same table of
 * cases — keep them in step, the way `lib/serverLimits.ts` mirrors
 * `lib/validation.ts`.
 *
 * Wire format is a Linux cpuset list. Canonical form is ascending, contiguous
 * runs merged, no whitespace, and a single CPU written as `6` (never `6-6`).
 * `""` and `null` both mean "no pinning". `"3-1"`, `"0-"`, `"0,,1"`, `"01"` and
 * any CPU index above `MAX_CPU_INDEX` are rejected.
 */
import { MAX_CPU_AFFINITY_LENGTH, MAX_CPU_INDEX } from './serverLimits';

/** One integer or `low-high` range, each at most four digits. */
const TOKEN_PATTERN = /^\d{1,4}(?:-\d{1,4})?$/;
/** A non-negative integer without leading zeros. */
const INDEX_PATTERN = /^(?:0|[1-9]\d*)$/;
/** Above this many CPUs the picker groups chips instead of one per CPU. */
const MAX_INDIVIDUAL_CHIPS = 32;
/** CPUs per chip once a node's set is too large for one chip each. */
const CHIP_GROUP_SIZE = 8;

function parseIndex(text: string): number | null {
  if (!INDEX_PATTERN.test(text)) return null;
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value > MAX_CPU_INDEX) return null;
  return value;
}

/**
 * Parse a cpuset list into ascending, de-duplicated CPU indexes.
 *
 * Returns `null` when the list is malformed or out of bounds; an empty or blank
 * list parses to `[]` ("no pinning").
 */
export function parseCpuList(value: string): number[] | null {
  const compact = value.replace(/\s+/g, '');
  if (compact.length > MAX_CPU_AFFINITY_LENGTH) return null;
  if (compact === '') return [];
  const cpus = new Set<number>();
  for (const token of compact.split(',')) {
    if (!TOKEN_PATTERN.test(token)) return null;
    const [startText, endText] = token.split('-');
    const start = parseIndex(startText);
    const end = endText === undefined ? start : parseIndex(endText);
    if (start === null || end === null || start > end) return null;
    for (let cpu = start; cpu <= end; cpu += 1) cpus.add(cpu);
  }
  return [...cpus].sort((a, b) => a - b);
}

/** Format CPU indexes in canonical cpuset form; an empty set formats to `''`. */
export function formatCpuList(cpus: Iterable<number>): string {
  const sorted = [...new Set(cpus)]
    .filter((cpu) => Number.isInteger(cpu) && cpu >= 0 && cpu <= MAX_CPU_INDEX)
    .sort((a, b) => a - b);
  const parts: string[] = [];
  let index = 0;
  while (index < sorted.length) {
    let end = index;
    while (end + 1 < sorted.length && sorted[end + 1] === sorted[end] + 1) end += 1;
    parts.push(end === index ? String(sorted[index]) : `${sorted[index]}-${sorted[end]}`);
    index = end + 1;
  }
  return parts.join(',');
}

/** Result of canonicalising what a form or the API handed us. */
export type CpuAffinityNormalization =
  | { ok: true; mask: string | null }
  | { ok: false; error: 'invalid' };

/**
 * Canonical mask for storage and requests: `null` when nothing is pinned, an
 * `invalid` error when the input cannot be canonicalised.
 */
export function normalizeCpuAffinity(value: string | null | undefined): CpuAffinityNormalization {
  if (value === null || value === undefined) return { ok: true, mask: null };
  const cpus = parseCpuList(value);
  if (cpus === null) return { ok: false, error: 'invalid' };
  return { ok: true, mask: cpus.length ? formatCpuList(cpus) : null };
}

/** How many CPUs a mask covers; 0 for "no pinning" and for an invalid list. */
export function countCpus(value: string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return parseCpuList(value)?.length ?? 0;
}

/**
 * Whether every CPU named by `mask` is present in `available`.
 *
 * Fails open when the available set is unknown (`null`/absent) or unparseable:
 * the panel then accepts the pin and the node agent decides at start, which is
 * the authoritative check. A mask that cannot be parsed is never a subset.
 */
export function isCpuSubset(
  mask: string | null | undefined,
  available: string | null | undefined,
): boolean {
  if (mask === null || mask === undefined) return true;
  // `""` / blank is not a mask: only `null` means "no pinning" here, matching
  // the backend, where an empty list is rejected by the strict parser.
  const wanted = parseCpuList(mask);
  if (wanted === null || wanted.length === 0) return false;
  if (available === null || available === undefined) return true;
  const allowed = parseCpuList(available);
  if (allowed === null || allowed.length === 0) return true;
  const allowedSet = new Set(allowed);
  return wanted.every((cpu) => allowedSet.has(cpu));
}

/** One clickable block of the CPU picker. */
export interface CpuChip {
  /** Stable React key and label — the canonical form of the chip's CPUs. */
  key: string;
  label: string;
  cpus: number[];
}

/**
 * Split a node's CPU set into picker chips.
 *
 * Up to 32 CPUs get one chip each so a pin can be exact; a larger set is
 * grouped into runs of at most 8 consecutive CPUs, which keeps a 128-core node
 * clickable (and matches how the node's own set is usually written).
 */
export function cpuAffinityChips(hostCpus: readonly number[]): CpuChip[] {
  const perCpu = hostCpus.length <= MAX_INDIVIDUAL_CHIPS;
  const chips: CpuChip[] = [];
  let index = 0;
  while (index < hostCpus.length) {
    const limit = perCpu ? index : index + CHIP_GROUP_SIZE - 1;
    let end = index;
    while (end + 1 < hostCpus.length && end < limit && hostCpus[end + 1] === hostCpus[end] + 1) {
      end += 1;
    }
    const cpus = hostCpus.slice(index, end + 1);
    const label = formatCpuList(cpus);
    chips.push({ key: label, label, cpus });
    index = end + 1;
  }
  return chips;
}

/**
 * Toggle every CPU of one chip inside a mask.
 *
 * Selecting the last remaining CPU off returns `null` — an empty pin is not a
 * pin, and the API reads `null` as "no pinning".
 */
export function toggleCpus(mask: string | null | undefined, cpus: readonly number[]): string | null {
  const selected = new Set(mask ? parseCpuList(mask) ?? [] : []);
  const allSelected = cpus.every((cpu) => selected.has(cpu));
  for (const cpu of cpus) {
    if (allSelected) selected.delete(cpu);
    else selected.add(cpu);
  }
  return selected.size ? formatCpuList(selected) : null;
}
