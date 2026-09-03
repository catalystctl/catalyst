import { useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { reportSystemError } from '../services/api/systemErrors';

const AUTH_INIT_TIMEOUT_MS = 12000;

export function useAuthInit() {
  const init = useAuthStore((s) => s.init);

  useEffect(() => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled && !useAuthStore.getState().isReady) {
        useAuthStore.setState({ isReady: true });
        reportSystemError({
          level: 'warn',
          component: 'useAuthInit',
          message: `Auth init timed out after ${AUTH_INIT_TIMEOUT_MS}ms, continuing without session`,
        });
      }
    }, AUTH_INIT_TIMEOUT_MS);
    // Silently handle 401 — expected when no session exists
    init().catch(() => {}).finally(() => {
      settled = true;
      clearTimeout(timer);
    });
    return () => {
      settled = true;
      clearTimeout(timer);
    };
  }, [init]);
}
