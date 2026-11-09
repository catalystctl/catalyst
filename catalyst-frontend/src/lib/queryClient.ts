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
      // P2.1: returning to the tab is the cheapest freshness floor available —
      // the focus handler refetches queries that are past their staleTime (and
      // force-refetches interval queries that missed ticks while hidden).
      // Individual call sites that must not refetch on focus keep passing
      // `refetchOnWindowFocus: false` explicitly; those are honored as-is.
      refetchOnWindowFocus: true,
    },
    mutations: {
      retry: 0,
    },
  },
  mutationCache: new MutationCache({
    onError: ({ error, mutation }) => {
      // A schema rejection carries the offending fields in `details`; without
      // them the System Errors row is a bare "Invalid request body" and cannot
      // be acted on (this is how the image-variant regression was reported).
      const details = (error as { response?: { data?: { details?: unknown } } })?.response?.data?.details;
      const fieldSummary =
        Array.isArray(details) && details.length > 0
          ? ` [${details
              .slice(0, 5)
              .map((detail: any) =>
                detail && typeof detail === 'object'
                  ? `${detail.field ? `${detail.field}: ` : ''}${detail.message ?? ''}`.trim()
                  : String(detail),
              )
              .join('; ')}${details.length > 5 ? ` (+${details.length - 5})` : ''}]`
          : '';
      reportSystemError({
        level: 'error',
        component: describeMutationComponent(mutation.options.mutationKey, error),
        message: `${describeError(error)}${fieldSummary}`,
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
