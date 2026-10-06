import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@/csync';
import apiClient from '../services/api/client';
import i18n from '@/i18n';
import { getLocalizedErrorMessage } from '../i18n/api-errors';

const SETUP_STATUS_TIMEOUT_MS = 15000;
const INSTALLED_MEMORY_KEY = 'catalyst:setup-installed:v1';

/**
 * "This browser has seen a completed install." The setup answer flips from
 * true to false exactly once, so a remembered *false* (installed) can only be
 * wrong after a database wipe — and the background revalidation below recovers
 * from that within one request by routing to /setup. A remembered *true* is
 * never stored: replaying it was the historical "stranded on the wizard" bug.
 */
function readInstalledMemory(): boolean {
  try {
    return localStorage.getItem(INSTALLED_MEMORY_KEY) === '1';
  } catch {
    return false; // private mode / SSR — memory is a pure optimization
  }
}

function rememberInstalled(installed: boolean): void {
  try {
    if (installed) localStorage.setItem(INSTALLED_MEMORY_KEY, '1');
    else localStorage.removeItem(INSTALLED_MEMORY_KEY);
  } catch {
    /* best-effort */
  }
}

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
 * `/login`. Unknown = loading, then the retry screen — except when this
 * browser remembers a completed install, in which case routing starts
 * immediately and the network answer only arrives as a revalidation
 * (so the login page never blocks behind a booting or restarting backend).
 */
export function useSetupStatus(): SetupStatus {
  const queryClient = useQueryClient();
  // Read once per mount — a memory flip mid-session comes through the
  // revalidation path instead, with its own routing transition.
  const [hasInstalledMemory] = useState(readInstalledMemory);

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
    // Fail fast and let the unreachable poll below own the cadence: an
    // exponential backoff ladder here would park the retry screen for
    // minutes while a booting backend comes up. The 3s poll preserves the
    // "backend needs a few seconds for migrate-on-boot" recovery without the
    // ladder.
    retry: (failureCount, err: any) => {
      if (err?.response?.status === 404) return false;
      if (err?.response?.status === 401 || err?.response?.status === 403) return false;
      return failureCount < 1;
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  // Persist definitive answers: false = installed (enables the instant
  // routing fast path on the next load), true = clear any stale memory.
  useEffect(() => {
    if (data === false) rememberInstalled(true);
    else if (data === true) rememberInstalled(false);
  }, [data]);

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
  // With install memory the answer is only a revalidation: routing proceeds
  // immediately and a `true` (wiped database) arrives as a routing transition.
  const unreachable = !hasInstalledMemory && !isDefinitive && (timedOut || (isFetched && !!queryError));

  // Auto-heal: while the backend cannot be reached (and this browser has no
  // install memory), keep re-checking so the panel recovers the moment the
  // backend answers — the manual Retry button stays, but is no longer the
  // only way off the retry screen.
  useEffect(() => {
    if (!unreachable) return;
    const id = setInterval(() => {
      refetch().catch(() => {});
    }, 3000);
    return () => clearInterval(id);
  }, [unreachable, refetch]);

  // Block routing until the first attempt settles (success or terminal
  // error) — unless install memory lets the app start immediately.
  // Do NOT use csync's isLoading — it is false on the pre-fetch first paint.
  // Never block longer than the timeout — the retry screen takes over.
  const isLoading = !hasInstalledMemory && !isFetched && !timedOut;

  // Definitive true only from a successful response (or a revalidation after
  // a wipe). Unknown is NOT setup.
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
