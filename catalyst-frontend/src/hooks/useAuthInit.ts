import { useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';

export function useAuthInit() {
  const init = useAuthStore((s) => s.init);

  useEffect(() => {
    // Silently handle 401 — expected when no session exists
    init().catch(() => {});
  }, [init]);
}
