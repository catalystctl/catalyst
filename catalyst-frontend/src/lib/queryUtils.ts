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
  queryClient.invalidateQueries({
    predicate: (q: any) => matchQueryKeys(q.queryKey, queryKeys),
  });
}

/**
 * Lightweight key matcher — checks if queryKey starts with any of the given prefixes.
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
