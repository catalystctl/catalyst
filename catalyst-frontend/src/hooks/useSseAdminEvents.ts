/**
 * Comprehensive admin SSE events hook.
 *
 * Listens for ALL admin entity events (users, servers, nodes, templates,
 * roles, alert rules, alert instances, API keys, locations, nests,
 * database hosts, and IP pools) via the admin SSE stream and
 * updates the appropriate TanStack Query caches in real-time.
 *
 * Only connects if the user has admin permissions (avoids 401 spam on /api/admin/events).
 */
import { useEffect } from 'react';
import { useQueryClient, type Query } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';
import { createAdminEventsStream, type AdminEventType } from '../services/api/admin-events';
import type { AdminUser } from '../types/admin';
import type { ServerTemplate } from '../types/template';

export function useSseAdminEvents() {
  const queryClient = useQueryClient();
  const permissions = useAuthStore((s) => s.permissions);
  const isAdmin = permissions?.includes('admin.read') || permissions?.includes('admin.write') || permissions?.includes('*');

  useEffect(() => {
    if (!isAdmin) return;

    const disconnect = createAdminEventsStream(
      (type: AdminEventType, data: Record<string, unknown>) => {
        const q = queryClient as any;

        // ── User Events ─────────────────────────────────────────────
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

        if (type === 'user_updated') {
          const userId = String(data.userId ?? '');
          if (!userId) return;
          q.invalidateQueries({
            predicate: (query: Query) =>
              Array.isArray(query.queryKey) && query.queryKey[0] === 'admin-users',
          });
          // Also invalidate profile query if the updated user is the current user
          q.invalidateQueries({ queryKey: ['profile'] });
          q.invalidateQueries({ queryKey: ['my-permissions'] });
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

        // ── Server Events ───────────────────────────────────────────
        if (type === 'server_created') {
          q.invalidateQueries({
            predicate: (query: Query) =>
              Array.isArray(query.queryKey) && query.queryKey[0] === 'admin-servers',
          });
          q.invalidateQueries({
            predicate: (query: Query) =>
              Array.isArray(query.queryKey) && query.queryKey[0] === 'servers',
          });
          q.invalidateQueries({ queryKey: ['dashboard-stats'] });
        }

        if (type === 'server_deleted') {
          const serverId = String(data.serverId ?? '');
          q.invalidateQueries({
            predicate: (query: Query) =>
              Array.isArray(query.queryKey) && query.queryKey[0] === 'admin-servers',
          });
          q.invalidateQueries({
            predicate: (query: Query) =>
              Array.isArray(query.queryKey) && query.queryKey[0] === 'servers',
          });
          if (serverId) {
            q.removeQueries({ queryKey: ['server', serverId] });
          }
          q.invalidateQueries({ queryKey: ['dashboard-stats'] });
        }

        // ── Server Update/Suspend/Unsuspend Events ──────────────────
        if (type === 'server_updated' || type === 'server_suspended' || type === 'server_unsuspended') {
          const serverId = String(data.serverId ?? '');
          // Invalidate server detail and list caches
          q.invalidateQueries({
            predicate: (query: Query) =>
              Array.isArray(query.queryKey) && query.queryKey[0] === 'server',
          });
          q.invalidateQueries({
            predicate: (query: Query) =>
              Array.isArray(query.queryKey) && query.queryKey[0] === 'servers',
          });
          q.invalidateQueries({
            predicate: (query: Query) =>
              Array.isArray(query.queryKey) && query.queryKey[0] === 'admin-servers',
          });
          q.invalidateQueries({ queryKey: ['dashboard-stats'] });
        }

        // ── Node Events ─────────────────────────────────────────────
        if (type === 'node_created' || type === 'node_deleted') {
          q.invalidateQueries({
            predicate: (query: Query) =>
              Array.isArray(query.queryKey) &&
              (query.queryKey[0] === 'admin-nodes' || query.queryKey[0] === 'nodes'),
          });
          if (type === 'node_deleted') {
            const nodeId = String(data.nodeId ?? '');
            if (nodeId) {
              q.removeQueries({ queryKey: ['node', nodeId] });
            }
          }
          q.invalidateQueries({ queryKey: ['dashboard-stats'] });
        }

        if (type === 'node_updated') {
          q.invalidateQueries({
            predicate: (query: Query) =>
              Array.isArray(query.queryKey) &&
              (query.queryKey[0] === 'admin-nodes' || query.queryKey[0] === 'nodes'),
          });
        }

        // ── Template Events ─────────────────────────────────────────
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

        // ── Role Events ─────────────────────────────────────────────
        if (type === 'role_created' || type === 'role_updated' || type === 'role_deleted') {
          q.invalidateQueries({
            predicate: (query: Query) =>
              Array.isArray(query.queryKey) && query.queryKey[0] === 'admin-roles',
          });
          if (type === 'role_deleted') {
            const roleId = String(data.roleId ?? '');
            if (roleId) {
              q.removeQueries({ queryKey: ['role', roleId] });
            }
          }
        }

        // ── Alert Rule Events ───────────────────────────────────────
        if (type === 'alert_rule_created' || type === 'alert_rule_updated' || type === 'alert_rule_deleted') {
          q.invalidateQueries({
            predicate: (query: Query) =>
              Array.isArray(query.queryKey) && query.queryKey[0] === 'alert-rules',
          });
        }

        // ── Alert Instance Events ───────────────────────────────────
        if (type === 'alert_created' || type === 'alert_resolved' || type === 'alert_deleted') {
          q.invalidateQueries({
            predicate: (query: Query) =>
              Array.isArray(query.queryKey) && query.queryKey[0] === 'alerts',
          });
          q.invalidateQueries({ queryKey: ['alerts-stats'] });
        }

        // ── API Key Events ─────────────────────────────────────────
        if (type === 'api_key_created' || type === 'api_key_updated' || type === 'api_key_deleted') {
          q.invalidateQueries({
            predicate: (query: Query) =>
              Array.isArray(query.queryKey) && query.queryKey[0] === 'api-keys',
          });
        }

        // ── Location Events ────────────────────────────────────────
        if (type === 'location_created' || type === 'location_updated' || type === 'location_deleted') {
          q.invalidateQueries({
            predicate: (query: Query) =>
              Array.isArray(query.queryKey) && query.queryKey[0] === 'locations',
          });
        }

        // ── Nest Events ────────────────────────────────────────────
        if (type === 'nest_created' || type === 'nest_updated' || type === 'nest_deleted') {
          q.invalidateQueries({
            predicate: (query: Query) =>
              Array.isArray(query.queryKey) && query.queryKey[0] === 'nests',
          });
        }

        // ── Database Host Events ───────────────────────────────────
        if (type === 'database_host_created' || type === 'database_host_updated' || type === 'database_host_deleted') {
          q.invalidateQueries({
            predicate: (query: Query) =>
              Array.isArray(query.queryKey) &&
              (query.queryKey[0] === 'database-hosts' || query.queryKey[0] === 'admin-database-hosts'),
          });
        }

        // ── IP Pool Events ─────────────────────────────────────────
        if (type === 'ip_pool_created' || type === 'ip_pool_updated' || type === 'ip_pool_deleted') {
          const nodeId = String(data.nodeId ?? '');
          if (nodeId) {
            q.invalidateQueries({
              predicate: (query: Query) =>
                Array.isArray(query.queryKey) && query.queryKey[0] === 'ip-pools' && query.queryKey[1] === nodeId,
            });
          }
          // Also invalidate node detail since it may show pool count
          q.invalidateQueries({
            predicate: (query: Query) =>
              Array.isArray(query.queryKey) &&
              (query.queryKey[0] === 'admin-nodes' || query.queryKey[0] === 'nodes'),
          });
        }
      },
      () => {},
    );

    return disconnect;
  }, [queryClient, isAdmin]);
}
