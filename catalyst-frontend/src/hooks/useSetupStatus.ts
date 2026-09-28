import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@/csync';
import apiClient from '../services/api/client';
import i18n from '@/i18n';
import { getLocalizedErrorMessage } from '../i18n/api-errors';

const SETUP_STATUS_TIMEOUT_MS = 15000;

// Per-browser memory that this panel has already been set up. Once a status
// response (or a completed wizard) proves setup is done, a later transient
// failure must not fall back to the wizard — that is what stranded installed
// panels on `/setup` after a backend restart or upgrade. Clearing this only
// re-arms the client-side gate, never the server-side setup guard.
const SETUP_DONE_STORAGE_KEY = 'catalyst.setup-complete';

function rememberSetupCompleted(): void {
  try {
    localStorage.setItem(SETUP_DONE_STORAGE_KEY, '1');
  } catch {
    /* private mode / storage disabled — best effort */
  }
}

function hasRememberedSetupCompleted(): boolean {
  try {
    return localStorage.getItem(SETUP_DONE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

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
 *
 * The fail-open only applies to genuinely unknown panels: if this browser has
 * ever seen setup completed, an error resolves to "not required" so an
 * installed panel is never sent back to the wizard.
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
        const res = await apiClient.get<{ setupRequired: boolean }>('/api/setup/status', {
          // The backend marks this no-store; force it client-side too so a
          // response cached before that header existed can never replay
          // "setupRequired: true" onto an already-installed panel.
          cache: 'no-store',
        });
        const setupRequired = res.setupRequired ?? false;
        if (!setupRequired) rememberSetupCompleted();
        return setupRequired;
      } catch (err: any) {
        // Old backends without the OOBE endpoint — treat as already set up.
        if (err?.response?.status === 404) {
          rememberSetupCompleted();
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
      rememberSetupCompleted();
      queryClient.invalidateQueries({ queryKey: ['setup', 'status'] });
    };
    window.addEventListener('catalyst:setup-complete', handleSetupComplete);
    return () => {
      window.removeEventListener('catalyst:setup-complete', handleSetupComplete);
    };
  }, [queryClient]);

  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (isFetched) return;
    const timer = setTimeout(() => setTimedOut(true), SETUP_STATUS_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [isFetched]);

  // Block routing until the first attempt settles (success or terminal error).
  // Do NOT use csync's isLoading — it is false on the pre-fetch first paint.
  // Never block longer than the timeout — fail open so a stalled backend
  // cannot leave the panel on the loading screen.
  const isLoading = !isFetched && !timedOut;

  // Definitive false only after a successful response (or 404 mapped to false).
  // On terminal error, fail open to setup so first-run Docker installs are not
  // stranded on /login with zero users — unless this browser already knows the
  // panel was set up, in which case an error must not re-open the wizard.
  const setupRequired = typeof data === 'boolean'
    ? data
    : !hasRememberedSetupCompleted();

  const error = timedOut && !isFetched
    ? i18n.t('setupStatus.timedOut', { ns: 'common', ms: SETUP_STATUS_TIMEOUT_MS })
    : queryError
      ? queryError instanceof Error
        ? getLocalizedErrorMessage(queryError)
        : i18n.t('setupStatus.checkFailed', { ns: 'common' })
      : null;

  return { setupRequired, isLoading, error, recheck };
}
