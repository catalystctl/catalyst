import { QueryClient, MutationCache } from '@tanstack/react-query';
import { reportSystemError } from '../services/api/systemErrors';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60 * 1000,
      retry: 2,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      const mutationKey = String(mutation.options.mutationKey ?? 'unknown');
      reportSystemError({
        level: 'error',
        component: `Mutation:${mutationKey}`,
        message: error instanceof Error ? error.message : String(error),
        metadata: { mutationKey },
      });
    },
  }),
});

export { QueryClient };
