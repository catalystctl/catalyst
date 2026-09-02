import { QueryClient, MutationCache, setFallbackQueryClient } from '../csync';
import { reportSystemError } from '../services/api/systemErrors';
import { describeError, describeMutationComponent } from '../utils/errors';

/**
 * App-wide Catalyst Sync client (replaces TanStack QueryClient).
 * Import this singleton from non-React code (API client, auth store, dialogs).
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 10 * 60 * 1000,
      retry: 2,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
  mutationCache: new MutationCache({
    onError: ({ error, mutation }) => {
      reportSystemError({
        level: 'error',
        component: describeMutationComponent(mutation.options.mutationKey, error),
        message: describeError(error),
        stack: error instanceof Error ? error.stack : undefined,
        metadata: { mutationKey: String(mutation.options.mutationKey ?? 'unknown') },
      });
    },
  }),
});

setFallbackQueryClient(queryClient);

export { QueryClient };

/** Dev helper */
if (typeof window !== 'undefined') {
  (window as any).__CSYNC__ = {
    client: queryClient,
    dump: () =>
      queryClient.getQueryCache().getAll().map((q) => ({
        key: q.queryKey,
        status: q.state.status,
        observers: q.observers,
        updatedAt: q.state.dataUpdatedAt,
        data: q.state.data,
      })),
  };
}
