import { useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { reportSystemError } from '../services/api/systemErrors';

const AUTH_INIT_TIMEOUT_MS = 12000;
/** One retry, so a slow-but-reachable backend still answers the probe. */
const MAX_ATTEMPTS = 2;

export function useAuthInit() {
  const init = useAuthStore((s) => s.init);

  useEffect(() => {
    let cancelled = false;
    const timers = new Set<ReturnType<typeof setTimeout>>();

    /**
     * Run the boot probe under a time limit. Never writing `isReady` here is the
     * point: the store announces readiness when the session question is actually
     * answered, so a slow backend cannot bounce an authenticated user to /login.
     */
    const start = (attempt: number) => {
      let settled = false;
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (cancelled || settled || useAuthStore.getState().isReady) return;
        if (attempt < MAX_ATTEMPTS) {
          // Re-arm the deadline rather than declaring "no session": if the first
          // probe already failed this starts a fresh one, and if it is still
          // running the retry joins it instead of racing a second request.
          start(attempt + 1);
          return;
        }
        // Still unresolved: fail open so the panel renders, and say so rather
        // than presenting a bare sign-in form. App renders the retry screen off
        // this flag; the retry button calls init() again.
        settled = true;
        useAuthStore.setState({ isReady: true, sessionCheckFailed: true });
        reportSystemError({
          level: 'warn',
          component: 'useAuthInit',
          message: `Auth init timed out after ${MAX_ATTEMPTS * AUTH_INIT_TIMEOUT_MS}ms, continuing without session`,
        });
      }, AUTH_INIT_TIMEOUT_MS);
      timers.add(timer);

      init()
        .catch(() => {})
        .finally(() => {
          // init() can return without answering (the loginGuard short-circuit
          // leaves the session to login()); only stop the clock once the store
          // says the question is answered.
          if (!useAuthStore.getState().isReady) return;
          settled = true;
          clearTimeout(timer);
          timers.delete(timer);
        });
    };

    start(1);

    // Silently handle 401 — expected when no session exists.
    return () => {
      cancelled = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    };
  }, [init]);
}