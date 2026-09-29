import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@/csync';
import apiClient from '../services/api/client';
import i18n from '@/i18n';
import { getLocalizedErrorMessage } from '../i18n/api-errors';

const SETUP_STATUS_TIMEOUT_MS = 15000;

interface SetupStatus {
  setupRequired: boolean;
  isLoading: boolean;
  error: string | null;
  /** The backend could not answer; routing must not assume a fresh install. */
  unreachable: boolean;
  recheck: () => void;
}

/**
 * First-run / OOBE gate.
 *
 * IMPORTANT: only a *successful* `setupRequired: true` response opens the
 * wizard. A network/5xx failure does NOT mean "fresh install" — treating it
 * that way sent installed panels back to `/setup` whenever the backend was
 * briefly unavailable (an image update or restart). On failure we report
 * `unreachable` and keep polling, so an installed panel recovers on its own
 * once the backend is back. A genuinely fresh install still gets a successful
 * `true` and the wizard.
 *
 * The app must not fall through to the normal router while the answer is
 * unknown either: ProtectedRoute would bounce unauthenticated users to
 * `/login`. Unknown = loading, then the retry screen.
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
        return res.setupRequired ?? false;
      } catch (err: any) {
        // Old backends without the OOBE endpoint — treat as already set up.
        if (err?.response?.status === 404) return false;
        throw err;
      }
    },
    // Backend often needs a few seconds for migrate-on-boot on fresh Docker
    // volumes. Keep retrying transient failures so we don't freeze on a wrong
    // answer.
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

  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (isFetched) return;
    const timer = setTimeout(() => setTimedOut(true), SETUP_STATUS_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [isFetched]);

  const isDefinitive = typeof data === 'boolean';
  const unreachable = !isDefinitive && (timedOut || (isFetched && !!queryError));

  // Block routing until the first attempt settles (success or terminal error).
  // Do NOT use csync's isLoading — it is false on the pre-fetch first paint.
  // Never block longer than the timeout — the retry screen takes over.
  const isLoading = !isFetched && !timedOut;

  // Definitive true only from a successful response. Unknown is NOT setup.
  const setupRequired = data === true;

  const error = unreachable
    ? queryError
      ? queryError instanceof Error
        ? getLocalizedErrorMessage(queryError)
        : i18n.t('setupStatus.checkFailed', { ns: 'common' })
      : i18n.t('setupStatus.timedOut', { ns: 'common', ms: SETUP_STATUS_TIMEOUT_MS })
    : queryError
      ? queryError instanceof Error
        ? getLocalizedErrorMessage(queryError)
        : i18n.t('setupStatus.checkFailed', { ns: 'common' })
      : null;

  return { setupRequired, isLoading, error, unreachable, recheck };
}
