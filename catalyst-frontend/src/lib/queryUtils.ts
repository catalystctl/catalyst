/**
 * Helper to set a single field optimistically across all matching queries.
 * Useful for status changes (e.g. server start/stop).
 *
 * @param queryClient - QueryClient instance
 * @param queryKeys - Array of query keys to update
 * @param updater - Partial data to merge into cached values
 */
export function optimisticSet<T>(
  queryClient: any,
  queryKeys: readonly unknown[],
  updater: (cached: T) => T,
) {
  queryClient.setQueriesData(
    { predicate: (q: any) => matchQueryKeys(q.queryKey, queryKeys) },
    updater,
  );
}

export function optimisticInvalidate(
  queryClient: any,
  queryKeys: readonly unknown[],
) {
  queryKeys.forEach((key) => {
    queryClient.invalidateQueries({ queryKey: key });
  });
}

/**
 * Lightweight key matcher — checks if queryKey starts with any of the given prefixes.
 *
 * Collection keys like `qk.servers()` now return `['servers']` (no null suffix),
 * so prefix matching works naturally with TanStack Query v5.
 */
function matchQueryKeys(queryKey: readonly unknown[], prefixes: readonly unknown[]): boolean {
  return prefixes.some((p) => {
    if (Array.isArray(p)) {
      return (
        queryKey.length >= p.length &&
        p.every((k, i) => k === queryKey[i])
      );
    }
    return queryKey[0] === p;
  });
}
