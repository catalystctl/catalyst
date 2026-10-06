/**
 * Per-tick invalidation dedupe (audit F11 / P1.10).
 *
 * The same event can arrive on both the admin and the global SSE stream (or
 * be pushed twice), and both AppLayout hooks then invalidate the same query
 * keys. `invalidateQueries` aborts and restarts in-flight fetches, so a
 * duplicate call doubles round trips on hot lists (servers, admin users, …).
 *
 * `invalidateOnce` records the queryKey hash for the current microtask tick
 * and drops repeats; the module-level Set is cleared on a `queueMicrotask`
 * scheduled at the first insert, so unrelated ticks are never deduped.
 * Predicate-only invalidations carry no key hash — pass `dedupeKey` to opt in.
 */
import { hashQueryKey, type QueryFilters, type QueryKey } from '@/csync';

export type InvalidateOnceOptions = {
  queryKey?: QueryKey;
  predicate?: QueryFilters['predicate'];
  exact?: boolean;
  refetchType?: 'active' | 'all' | 'none';
  /** Identity for dedupe when there is no (or an insufficient) queryKey. */
  dedupeKey?: string;
};

/** Structural slice of QueryClient we depend on — keeps this file test-free of React. */
export type InvalidateTarget = {
  invalidateQueries(
    filters?: QueryFilters,
    opts?: { refetchType?: 'active' | 'all' | 'none' },
  ): Promise<void>;
};

const seenThisTick = new Set<string>();
let clearScheduled = false;

// Namespacing per queryClient instance so a test (or a future second client)
// invalidating the same key in the same tick is not wrongly deduped.
const clientTags = new WeakMap<object, string>();
let clientCounter = 0;
function tagFor(target: InvalidateTarget): string {
  const key = target as object;
  let tag = clientTags.get(key);
  if (!tag) {
    tag = `qc${++clientCounter}`;
    clientTags.set(key, tag);
  }
  return tag;
}

function scheduleClear(): void {
  if (clearScheduled) return;
  clearScheduled = true;
  queueMicrotask(() => {
    seenThisTick.clear();
    clearScheduled = false;
  });
}

/**
 * `queryClient.invalidateQueries` with same-tick duplicate suppression.
 * Returns the underlying promise (resolved immediately for a deduped call).
 */
export function invalidateOnce(
  target: InvalidateTarget,
  options: InvalidateOnceOptions,
): Promise<void> {
  const { queryKey, predicate, exact, refetchType, dedupeKey } = options;
  const identity =
    dedupeKey !== undefined
      ? dedupeKey
      : queryKey !== undefined
        ? hashQueryKey(queryKey)
        : undefined;

  if (identity !== undefined) {
    const scoped = `${tagFor(target)}|${identity}`;
    if (seenThisTick.has(scoped)) return Promise.resolve();
    seenThisTick.add(scoped);
    scheduleClear();
  }

  const filters: QueryFilters = {};
  if (queryKey !== undefined) filters.queryKey = queryKey;
  if (predicate) filters.predicate = predicate;
  if (exact !== undefined) filters.exact = exact;
  return target.invalidateQueries(
    filters,
    refetchType !== undefined ? { refetchType } : undefined,
  );
}
