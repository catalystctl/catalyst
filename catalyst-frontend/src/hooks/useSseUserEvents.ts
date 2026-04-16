/**
 * SSE-based user management events hook.
 *
 * Listens for user_created and user_deleted events via the global SSE stream
 * (all-servers endpoint) and updates the admin users query cache in real-time.
 *
 * Only connects if the user has admin permissions (avoids 401 spam on /api/admin/events).
 */
import { useEffect } from 'react';
import { useQueryClient, type Query } from '@tanstack/react-query';
import { createServerEventsStream, type ServerEventType } from '../services/api/server-events';
import type { AdminUser } from '../types/admin';

export function useSseUserEvents() {
  const queryClient = useQueryClient();

  useEffect(() => {
    // Connect to the global SSE stream (all-servers) for user-level events
    const disconnect = createServerEventsStream(
      'all-servers',
      (type: ServerEventType, data: Record<string, unknown>) => {
        const q = queryClient as any;

        if (type === 'user_created') {
          const newUser = data.user as AdminUser;
          if (!newUser) return;

          q.setQueriesData(
            { predicate: (query: Query) =>
              Array.isArray(query.queryKey) && query.queryKey[0] === 'admin-users' },
            (prev: any) => {
              if (!prev || typeof prev !== 'object') return prev;
              if ('users' in prev && Array.isArray(prev.users)) {
                if (prev.users.some((u: AdminUser) => u.id === newUser.id)) return prev;
                return { ...prev, users: [newUser, ...prev.users] };
              }
              if (Array.isArray(prev)) {
                if (prev.some((u: AdminUser) => u.id === newUser.id)) return prev;
                return [newUser, ...prev];
              }
              return prev;
            },
          );
        }

        if (type === 'user_deleted') {
          const deletedUserId = String(data.userId ?? '');
          if (!deletedUserId) return;

          q.setQueriesData(
            { predicate: (query: Query) =>
              Array.isArray(query.queryKey) && query.queryKey[0] === 'admin-users' },
            (prev: any) => {
              if (!prev || typeof prev !== 'object') return prev;
              if ('users' in prev && Array.isArray(prev.users)) {
                return { ...prev, users: prev.users.filter((u: AdminUser) => u.id !== deletedUserId) };
              }
              if (Array.isArray(prev)) {
                return prev.filter((u: AdminUser) => u.id !== deletedUserId);
              }
              return prev;
            },
          );
        }
      },
      () => {},
    );

    return disconnect;
  }, [queryClient]);
}
