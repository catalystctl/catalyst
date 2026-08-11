import { QueryClient, MutationCache, setFallbackQueryClient } from '../csync';
import { reportSystemError } from '../services/api/systemErrors';

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
      const mutationKey = String(mutation.options.mutationKey ?? 'unknown');
      const message =
        error instanceof Error
          ? error.message
          : (error as any)?.message ||
            (error as any)?.response?.data?.error ||
            (error as any)?.response?.data?.message ||
            String(error);
      reportSystemError({
        level: 'error',
        component: `Mutation:${mutationKey}`,
        message,
        metadata: { mutationKey },
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
