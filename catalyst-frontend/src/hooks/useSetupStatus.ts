import { useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@/csync';
import apiClient from '../services/api/client';

interface SetupStatus {
  setupRequired: boolean;
  isLoading: boolean;
  error: string | null;
  recheck: () => void;
}

/**
 * First-run / OOBE gate.
 *
 * IMPORTANT: never default "unknown" to setupRequired=false.
 * csync's `isLoading` is only true while `isPending && isFetching`. On the first
 * paint the fetch has not started yet (`isFetching` is still false), and a
 * default of `false` would briefly render the normal router — ProtectedRoute
 * then bounces unauthenticated users to `/login`. On a fresh Docker install the
 * backend is often still migrating, so the status call can also fail; treating
 * that as "setup done" permanently strands the operator on `/login` with no
 * accounts. Fail open toward setup, and keep the app in a loading state until
 * we have a definitive answer (or exhaust retries).
 */
export function useSetupStatus(): SetupStatus {
  const queryClient = useQueryClient();

  const {
    data,
    isFetched,
    error: queryError,
    refetch,
  } = useQuery({
    queryKey: ['setup', 'status'],
    queryFn: async () => {
      try {
        const res = await apiClient.get<{ setupRequired: boolean }>('/api/setup/status');
        return res.setupRequired ?? false;
      } catch (err: any) {
        // Old backends without the OOBE endpoint — treat as already set up.
        if (err?.response?.status === 404) {
          return false;
        }
        throw err;
      }
    },
    // Backend often needs a few seconds for migrate-on-boot on fresh Docker volumes.
    // Keep retrying transient failures so we don't freeze on a wrong answer.
    retry: (failureCount, err: any) => {
      if (err?.response?.status === 404) return false;
      if (err?.response?.status === 401 || err?.response?.status === 403) return false;
      return failureCount < 8;
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const recheck = useCallback(() => {
    refetch();
  }, [refetch]);

  useEffect(() => {
    const handleSetupComplete = () => {
      queryClient.invalidateQueries({ queryKey: ['setup', 'status'] });
    };
    window.addEventListener('catalyst:setup-complete', handleSetupComplete);
    return () => {
      window.removeEventListener('catalyst:setup-complete', handleSetupComplete);
    };
  }, [queryClient]);

  // Block routing until the first attempt settles (success or terminal error).
  // Do NOT use csync's isLoading — it is false on the pre-fetch first paint.
  const isLoading = !isFetched;

  // Definitive false only after a successful response (or 404 mapped to false).
  // On terminal error, fail open to setup so first-run Docker installs are not
  // stranded on /login with zero users.
  const setupRequired = typeof data === 'boolean' ? data : true;

  const error = queryError
    ? queryError instanceof Error
      ? queryError.message
      : 'Failed to check setup status'
    : null;

  return { setupRequired, isLoading, error, recheck };
}
