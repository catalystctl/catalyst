/**
 * CPU affinity (cpuset) format for per-server CPU pinning.
 *
 * The stored/transferred form is a Linux cpuset list: comma-separated integers
 * and `low-high` ranges, e.g. `0-3,6,8-11`. The canonical form is ascending
 * with contiguous runs merged and no whitespace, so two spellings of the same
 * mask ("2,0-1" and "0-2") compare equal — which is what lets the panel skip a
 * no-op update and what lets the agent's subset check stay trivial.
 *
 * Bounds are deliberately independent of `MAX_CPU_CORES` (128): that constant
 * bounds CFS quota arithmetic, not host topology, and a 256-core node must be
 * pinnable. `MAX_CPU_INDEX` is a sanity ceiling on a CPU id, not a core count.
 *
 * NOTE: `catalyst-frontend/src/lib/cpuAffinity.ts` mirrors this file. Keep the
 * grammar, the canonical output and the bounds in step; both sides have a
 * table-driven test with the same cases.
 */

/** Longest accepted mask. A sparse 64-CPU mask is ~255 chars. */
export const MAX_CPU_AFFINITY_LENGTH = 512;
/** Highest accepted CPU id. */
export const MAX_CPU_INDEX = 4095;
/** Most CPUs one mask may name. */
export const MAX_CPU_COUNT = 4096;

/** Why a mask was rejected; surfaced as the error's `reason`. */
export type CpuAffinityReason =
  | 'empty' // "" (allowed at the call site as "no pinning", not here)
  | 'too_long'
  | 'empty_item' // "0,,1"
  | 'invalid_token' // "a", "0-", "-1", "0-1-2"
  | 'leading_zero' // "01"
  | 'range_order' // "3-1"
  | 'out_of_range' // "0-4096"
  | 'too_many_cpus'; // names more than MAX_CPU_COUNT

export class InvalidCpuAffinityError extends Error {
  constructor(
    readonly reason: CpuAffinityReason,
    readonly value: string,
  ) {
    super(`Invalid CPU list "${value}": ${reason}`);
    this.name = 'InvalidCpuAffinityError';
  }
}

const TOKEN = /^(\d{1,4})(?:-(\d{1,4}))?$/;

/**
 * Parse a cpuset list. Returns `null` when the input is not valid; use
 * `normalizeCpuAffinity` when the caller needs to know why.
 */
export function parseCpuList(input: string): Set<number> | null {
  try {
    return parseStrict(input);
  } catch {
    return null;
  }
}

function parseStrict(input: string): Set<number> {
  // Whitespace carries no meaning in a cpuset list; strip it so "0 - 3 , 6"
  // (a human typing into the panel's text field) is the same mask as "0-3,6".
  const raw = input.replace(/\s+/g, '');
  if (raw === '') throw new InvalidCpuAffinityError('empty', input);
  if (raw.length > MAX_CPU_AFFINITY_LENGTH) {
    throw new InvalidCpuAffinityError('too_long', input);
  }

  const cpus = new Set<number>();
  for (const item of raw.split(',')) {
    if (item === '') throw new InvalidCpuAffinityError('empty_item', input);

    const match = TOKEN.exec(item);
    if (!match) throw new InvalidCpuAffinityError('invalid_token', input);

    const [low, high] = match[2] === undefined ? [match[1], match[1]] : [match[1], match[2]];
    if ((low.length > 1 && low.startsWith('0')) || (high.length > 1 && high.startsWith('0'))) {
      throw new InvalidCpuAffinityError('leading_zero', input);
    }

    const start = Number(low);
    const end = Number(high);
    if (start > end) throw new InvalidCpuAffinityError('range_order', input);
    if (end > MAX_CPU_INDEX) throw new InvalidCpuAffinityError('out_of_range', input);

    for (let cpu = start; cpu <= end; cpu += 1) {
      cpus.add(cpu);
      if (cpus.size > MAX_CPU_COUNT) {
        throw new InvalidCpuAffinityError('too_many_cpus', input);
      }
    }
  }

  return cpus;
}

/** Canonical `"0-3,6"` form of a set of CPU ids. */
export function formatCpuList(cpus: Iterable<number>): string {
  const sorted = [...new Set(cpus)].sort((a, b) => a - b);
  const parts: string[] = [];
  let runStart: number | undefined;
  let previous: number | undefined;

  for (const cpu of sorted) {
    if (runStart === undefined) {
      runStart = cpu;
      previous = cpu;
      continue;
    }
    if (previous !== undefined && cpu === previous + 1) {
      previous = cpu;
      continue;
    }
    parts.push(runStart === previous ? `${runStart}` : `${runStart}-${previous}`);
    runStart = cpu;
    previous = cpu;
  }
  if (runStart !== undefined && previous !== undefined) {
    parts.push(runStart === previous ? `${runStart}` : `${runStart}-${previous}`);
  }
  return parts.join(',');
}

/**
 * Canonicalise a stored or submitted mask.
 *
 * `null` and `""` mean "no pinning". Anything else must parse, or this throws
 * `InvalidCpuAffinityError` — a malformed mask is never stored, because the
 * agent would fail the container start with a runtime message instead of the
 * panel naming the field.
 */
export function normalizeCpuAffinity(input: string | null): string | null {
  if (input === null) return null;
  const trimmed = input.trim();
  if (trimmed === '') return null;
  return formatCpuList(parseStrict(trimmed));
}

/** Number of CPUs a mask names (0 for null/invalid). */
export function countCpus(mask: string | null | undefined): number {
  if (mask === null || mask === undefined) return 0;
  return parseCpuList(mask)?.size ?? 0;
}

/**
 * Whether `mask` is placeable on `available`.
 *
 * `available` unknown (null/undefined) or itself unparseable returns `true`:
 * the panel then cannot prove the pin impossible, and the agent — which reads
 * the live cgroup cpuset — makes the authoritative call at container start.
 */
export function isCpuSubset(
  mask: string | null | undefined,
  available: string | null | undefined,
): boolean {
  if (mask === null || mask === undefined) return true;
  const wanted = parseCpuList(mask);
  if (!wanted) return false;
  if (available === null || available === undefined) return true;
  const allowed = parseCpuList(available);
  if (!allowed) return true;
  for (const cpu of wanted) {
    if (!allowed.has(cpu)) return false;
  }
  return true;
}

/**
 * The highest CPU id a node can offer, given its reported set: used by the
 * panel to bound form validation when the set is known.
 */
export function maxCpuIndexOf(available: string | null | undefined): number | null {
  if (available === null || available === undefined) return null;
  const allowed = parseCpuList(available);
  if (!allowed || allowed.size === 0) return null;
  return Math.max(...allowed);
}

/** Why a pin was refused; the routes map this to a stable error code. */
export type CpuAffinityRefusal = 'invalid' | 'unavailable' | 'below_allocation';

export interface CpuAffinityWriteInput {
  /** Raw request value. `undefined` = field not sent (leave unchanged). */
  raw: string | null | undefined;
  /** CPU cores the server will have after this write. */
  resolvedCores: number;
  /** The node's reported CPU set, when known. */
  hostCpuSet?: string | null;
}

export type CpuAffinityWriteResult =
  | { ok: true; provided: boolean; value: string | null }
  | { ok: false; reason: CpuAffinityRefusal; params: Record<string, unknown> };

/**
 * Validate and canonicalise a pin that is about to be stored.
 *
 * Rules (see the plan's D3): the mask must parse, must fit the node's reported
 * CPU set when that is known, and must name at least as many CPUs as the server
 * is allocated — a 4-core quota on 2 pinned CPUs can never be spent, so it is
 * refused rather than stored as an unreachable promise. Clearing (null/"") is
 * always allowed.
 */
export function validateCpuAffinityWrite(input: CpuAffinityWriteInput): CpuAffinityWriteResult {
  if (input.raw === undefined) {
    return { ok: true, provided: false, value: null };
  }

  let value: string | null;
  try {
    value = normalizeCpuAffinity(input.raw);
  } catch (error) {
    if (error instanceof InvalidCpuAffinityError) {
      return {
        ok: false,
        reason: 'invalid',
        params: { value: input.raw, reason: error.reason },
      };
    }
    throw error;
  }

  if (value === null) {
    return { ok: true, provided: true, value: null };
  }

  if (!isCpuSubset(value, input.hostCpuSet)) {
    const availableSet = input.hostCpuSet ? parseCpuList(input.hostCpuSet) : null;
    return {
      ok: false,
      reason: 'unavailable',
      params: {
        requested: value,
        available: availableSet ? formatCpuList(availableSet) : (input.hostCpuSet ?? ''),
      },
    };
  }

  const pinned = countCpus(value);
  if (pinned < input.resolvedCores) {
    return {
      ok: false,
      reason: 'below_allocation',
      params: { cpus: pinned, cores: input.resolvedCores },
    };
  }

  return { ok: true, provided: true, value };
}

/**
 * English message for a refused pin. The frontend translates the stable code;
 * this text is the API/log fallback and must name the values that failed.
 */
export function describeCpuAffinityError(
  refusal: CpuAffinityRefusal,
  params: Record<string, unknown>,
): string {
  switch (refusal) {
    case 'invalid':
      return `Invalid CPU list "${String(params.value ?? '')}"`;
    case 'unavailable':
      return `CPUs ${String(params.requested ?? '')} are not available on this node (available: ${String(params.available ?? 'unknown')})`;
    case 'below_allocation':
      return `CPU pinning covers ${String(params.cpus ?? '')} CPU(s) but the server is allocated ${String(params.cores ?? '')} core(s)`;
  }
}
