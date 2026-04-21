/**
 * Keeps the zustand auth store's `user` object in sync with the latest profile data.
 *
 * The sidebar reads user name/avatar from `useAuthStore` (zustand), not from
 * TanStack Query. Profile updates from SSE or mutations invalidate the ['profile']
 * query, but that query has NO active observer unless the user is on /profile —
 * so invalidateQueries does nothing on every other page.
 *
 * This hook works around that by directly polling the auth/me endpoint at a
 * regular interval and comparing the returned user fields with the zustand store.
 * It also reacts to ['profile'] query cache changes (when the user IS on /profile)
 * for instant sync in that case.
 */
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';
import { authApi } from '../services/api/auth';

const SYNC_INTERVAL = 15_000;

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

      syncToStore(profileData);
    });

    // ── 2. Direct API poll as fallback (works on every page) ────────────
    // This is the primary mechanism for pages other than /profile.
    const pollProfile = async () => {
      try {
        const { user } = await authApi.refresh();
        const store = useAuthStore.getState();
        if (!store.user) return;

        if (
          user.firstName !== store.user.firstName ||
          user.lastName !== store.user.lastName ||
          user.username !== store.user.username ||
          user.image !== store.user.image
        ) {
          store.setUser(user);
        }
      } catch {
        // Session may be expired — auth store handles redirect
      }
    };

    // Initial sync on mount
    pollProfile();

    intervalRef.current = setInterval(pollProfile, SYNC_INTERVAL);

    return () => {
      unsubscribe();
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [queryClient]);
}

function syncToStore(profileData: Record<string, unknown>) {
  const store = useAuthStore.getState();
  const currentUser = store.user;
  if (!currentUser) return;

  const firstName = (profileData as any).firstName ?? currentUser.firstName;
  const lastName = (profileData as any).lastName ?? currentUser.lastName;
  const username = (profileData as any).username ?? currentUser.username;
  const image = (profileData as any).image ?? currentUser.image;

  if (
    firstName !== currentUser.firstName ||
    lastName !== currentUser.lastName ||
    username !== currentUser.username ||
    image !== currentUser.image
  ) {
    store.setUser({
      ...currentUser,
      firstName,
      lastName,
      username,
      image,
    });
  }
}
