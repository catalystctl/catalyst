/**
 * SSE-based real-time template events hook.
 *
 * Listens for template_created / template_updated / template_deleted events
 * via the admin SSE stream and updates the templates query cache.
 *
 * Only connects if the user has admin permissions (avoids 401 spam on /api/admin/events).
 */
import { useEffect } from 'react';
import { useQueryClient, type Query } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';
import { createAdminEventsStream, type AdminEventType } from '../services/api/admin-events';
import type { ServerTemplate } from '../types/template';

export function useSseTemplateEvents() {
  const queryClient = useQueryClient();
  const permissions = useAuthStore((s) => s.permissions);
  const isAdmin = permissions?.includes('admin.read') || permissions?.includes('admin.write') || permissions?.includes('*');

  useEffect(() => {
    if (!isAdmin) return;

    const disconnect = createAdminEventsStream(
      (type: AdminEventType, data: Record<string, unknown>) => {
        const q = queryClient as any;

        if (type === 'template_created') {
          const template = data.template as ServerTemplate;
          if (!template) return;
          q.setQueriesData(
            { predicate: (query: Query) =>
              Array.isArray(query.queryKey) && query.queryKey[0] === 'templates' },
            (prev: any) => {
              if (!prev || !Array.isArray(prev)) return prev;
              if (prev.some((t: ServerTemplate) => t.id === template.id)) return prev;
              return [template, ...prev];
            },
          );
        }

        if (type === 'template_updated') {
          const templateId = String(data.templateId ?? '');
          if (!templateId) return;
          q.invalidateQueries({
            predicate: (query: Query) =>
              Array.isArray(query.queryKey) && query.queryKey[0] === 'templates',
          });
          q.invalidateQueries({
            predicate: (query: Query) =>
              Array.isArray(query.queryKey) && query.queryKey[0] === 'template' && query.queryKey[1] === templateId,
          });
        }

        if (type === 'template_deleted') {
          const templateId = String(data.templateId ?? '');
          if (!templateId) return;
          q.setQueriesData(
            { predicate: (query: Query) =>
              Array.isArray(query.queryKey) && query.queryKey[0] === 'templates' },
            (prev: any) => {
              if (!prev || !Array.isArray(prev)) return prev;
              return prev.filter((t: ServerTemplate) => t.id !== templateId);
            },
          );
          q.invalidateQueries({
            predicate: (query: Query) =>
              Array.isArray(query.queryKey) && query.queryKey[0] === 'template' && query.queryKey[1] === templateId,
          });
        }
      },
      () => {},
    );

    return disconnect;
  }, [queryClient, isAdmin]);
}
