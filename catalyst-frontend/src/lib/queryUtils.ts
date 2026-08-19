/**
 * Optimistic cache helpers for power-state (and similar) updates.
 *
 * The second argument is a single query-key prefix, e.g. `qk.servers()` or
 * `qk.server(id)`. It is NOT a list of independent prefixes — iterating
 * `['servers', id]` as `'servers'` + `id` matches every servers query and
 * lets a detail updater `{ ...srv }` turn a Server[] list into a non-array.
 */
import type { Query, QueryClient, QueryKey } from '@/csync';

export function isServerListQueryKey(queryKey: QueryKey | readonly unknown[]): boolean {
  if (!Array.isArray(queryKey) || queryKey[0] !== 'servers') return false;
  // ['servers'] — unfiltered list
  if (queryKey.length === 1) return true;
  // ['servers', null] legacy
  if (queryKey.length === 2 && queryKey[1] === null) return true;
  // ['servers', { status: 'running' }] — filtered lists
  return queryKey.length >= 2 && typeof queryKey[1] === 'object' && queryKey[1] !== null;
}

export function optimisticSet<T>(
  queryClient: QueryClient,
  queryKey: QueryKey,
  updater: (cached: T) => T,
) {
  // Exact key only. Prefix setQueriesData + `{ ...entity }` corrupts list caches.
  queryClient.setQueryData(queryKey, updater);
}

export function optimisticInvalidate(queryClient: QueryClient, queryKey: QueryKey) {
  void queryClient.invalidateQueries({ queryKey });
}

export function patchServerListStatus(
  queryClient: QueryClient,
  serverId: string,
  status: string,
) {
  queryClient.setQueriesData(
    { predicate: (query: Query<unknown, unknown>) => isServerListQueryKey(query.queryKey) },
    (servers: unknown) =>
      Array.isArray(servers)
        ? servers.map((s: { id?: string }) => (s?.id === serverId ? { ...s, status } : s))
        : servers,
  );
}
