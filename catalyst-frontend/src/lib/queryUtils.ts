import type { UseMutationOptions } from '@tanstack/react-query';

/**
 * Helper to build mutation options with automatic optimistic updates.
 *
 * Usage:
 *   const mutation = useMutation(
 *     optimisticMutation({
 *       mutationFn: () => serversApi.start(serverId),
 *       onMutate: async () => {
 *         await queryClient.cancelQueries({ queryKey: qk.server(serverId) });
 *         const prev = queryClient.getQueryData(qk.server(serverId));
 *         queryClient.setQueryData(qk.server(serverId), (old) =>
 *           old ? { ...old, status: 'starting' } : old,
 *         );
 *         return { prev };
 *       },
 *       onError: (_err, _vars, ctx) => {
 *         if (ctx?.prev) {
 *           queryClient.setQueryData(qk.server(serverId), ctx.prev);
 *         }
 *       },
 *       onSettled: () => {
 *         queryClient.invalidateQueries({ queryKey: qk.server(serverId) });
 *       },
 *     }),
 *   );
 *
 * @param options - Mutation options (onMutate is used as the optimistic snapshot point)
 * @returns options shaped for useMutation
 */
export function optimisticMutation<TData = unknown, TError = unknown, TVariables = void, TContext = unknown>(
  options: Omit<UseMutationOptions<TData, TError, TVariables, TContext>, 'mutationFn'> & {
    mutationFn: UseMutationOptions<TData, TError, TVariables, TContext>['mutationFn'];
  },
): Omit<UseMutationOptions<TData, TError, TVariables, TContext>, 'mutationFn'> & {
  mutationFn: UseMutationOptions<TData, TError, TVariables, TContext>['mutationFn'];
} {
  return options as any;
}

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
    const effectiveKey = Array.isArray(key) && key[key.length - 1] === null ? key.slice(0, -1) : key;
    queryClient.invalidateQueries({ queryKey: effectiveKey });
  });
}

/**
 * Lightweight key matcher — checks if queryKey starts with any of the given prefixes.
 *
 * When a prefix ends with `null` (e.g. `['servers', null]` from `qk.servers()`),
 * it matches ALL queries sharing the same base key regardless of their second
 * element (filters, pagination params, etc.).  This avoids the TanStack Query
 * pitfall where `['servers', null]` would otherwise fail to match
 * `['servers', { status: 'running' }]`.
 */
function matchQueryKeys(queryKey: readonly unknown[], prefixes: readonly unknown[]): boolean {
  return prefixes.some((p) => {
    if (Array.isArray(p)) {
      // Strip trailing `null` entries — they represent "any params"
      const effective = p[p.length - 1] === null ? p.slice(0, -1) : p;
      return (
        queryKey.length >= effective.length &&
        effective.every((k, i) => k === queryKey[i])
      );
    }
    return queryKey[0] === p;
  });
}
