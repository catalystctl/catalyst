/**
 * Keeps the zustand auth store's `user` display fields in sync with the latest
 * profile data without risking a full session wipe.
 *
 * The sidebar reads user name/avatar from `useAuthStore` (zustand), not from
 * TanStack Query. Profile updates from SSE or mutations invalidate the
 * ['profile'] query, but that query has NO active observer unless the user is
 * on /profile — so invalidateQueries does nothing on every other page.
 *
 * This hook:
 *  1. Reacts to ['profile'] query cache changes (instant when on /profile)
 *  2. Polls /api/auth/me on a long interval ONLY when the tab is focused,
 *     and only patches name/image fields — never calls store.refresh() so a
 *     transient 401 cannot wipe the whole session via AuthStore:refresh.
 */
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';
import { authApi } from '../services/api/auth';

/** Longer interval — profile fields change rarely; avoid hammering /auth/me. */
const SYNC_INTERVAL = 60_000;

export function useProfileSync() {
  const queryClient = useQueryClient();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // ── 1. React to ['profile'] query cache changes (instant when on /profile) ──
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event?.type !== 'updated') return;
      const query = event.query;
      if (!Array.isArray(query.queryKey) || query.queryKey[0] !== 'profile') return;

      const profileData = query.state.data as Record<string, unknown> | undefined;
      if (!profileData) return;

      syncDisplayFieldsToStore(profileData);
    });

    // ── 2. Focused-tab poll as fallback (works on every page) ────────────
    // Only patches display fields. Does NOT call store.refresh() so a 401
    // here is swallowed and cannot wipe isAuthenticated / permissions.
    const pollProfile = async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }
      try {
        const { user } = await authApi.refresh();
        const store = useAuthStore.getState();
        if (!store.user || !store.isAuthenticated) return;

        syncDisplayFieldsToStore({
          firstName: user.firstName,
          lastName: user.lastName,
          username: user.username,
          image: user.image,
        });
      } catch {
        // Transient network/auth blip — leave session alone.
        // Global 401 interceptor still handles true session death on other calls.
      }
    };

    const startInterval = () => {
      if (intervalRef.current) return;
      intervalRef.current = setInterval(pollProfile, SYNC_INTERVAL);
    };
    const stopInterval = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        pollProfile();
        startInterval();
      } else {
        stopInterval();
      }
    };

    // Initial sync on mount (only if focused)
    if (typeof document === 'undefined' || document.visibilityState === 'visible') {
      pollProfile();
      startInterval();
    }

    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      unsubscribe();
      stopInterval();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [queryClient]);
}

function syncDisplayFieldsToStore(profileData: Record<string, unknown>) {
  const store = useAuthStore.getState();
  const currentUser = store.user;
  if (!currentUser) return;

  const firstName =
    (profileData as { firstName?: string }).firstName ?? currentUser.firstName;
  const lastName =
    (profileData as { lastName?: string }).lastName ?? currentUser.lastName;
  const username =
    (profileData as { username?: string }).username ?? currentUser.username;
  const image = (profileData as { image?: string }).image ?? currentUser.image;

  if (
    firstName !== currentUser.firstName ||
    lastName !== currentUser.lastName ||
    username !== currentUser.username ||
    image !== currentUser.image
  ) {
    // Patch display fields only — preserve permissions/role/id.
    store.setUser({
      ...currentUser,
      firstName,
      lastName,
      username,
      image,
    });
  }
}
