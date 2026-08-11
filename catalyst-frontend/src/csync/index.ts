/**
 * Catalyst Sync public API.
 *
 * Import from `@/csync` (or relative `../csync`) instead of `@tanstack/react-query`.
 */
export {
  QueryClient,
  QueryCache,
  MutationCache,
  type QueryKey,
  type QueryFilters,
  type QueryOptions,
  type MutationOptions,
  type QueryClientConfig,
  type DefaultOptions,
  hashQueryKey,
  matchQuery,
  partialMatchKey,
  Query,
} from './client';

export {
  SyncProvider,
  QueryClientProvider,
  useQueryClient,
  useQuery,
  useMutation,
  ReactQueryDevtools,
  setFallbackQueryClient,
  type UseQueryResult,
  type UseMutationResult,
} from './react';

export { useVirtualizer, type VirtualItem } from './virtual';
