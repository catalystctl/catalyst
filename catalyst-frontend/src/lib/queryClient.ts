import { QueryClient, MutationCache } from '@tanstack/react-query';
import { reportSystemError } from '../services/api/systemErrors';

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
    onError: (error, _variables, _context, mutation) => {
      const mutationKey = String(mutation.options.mutationKey ?? 'unknown');
      const message = error instanceof Error
        ? error.message
        : (error as any)?.message || (error as any)?.response?.data?.error || (error as any)?.response?.data?.message || String(error);
      reportSystemError({
        level: 'error',
        component: `Mutation:${mutationKey}`,
        message,
        metadata: { mutationKey },
      });
    },
  }),
});

export { QueryClient };
