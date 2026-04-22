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
import { useQueryClient } from '@tanstack/react-query';
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
          q.invalidateQueries({ queryKey: ['dashboard-activity'] });
          q.invalidateQueries({ queryKey: ['dashboard-resources'] });
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

          // If the updated user is the current user, refresh the auth store
          // so the sidebar (which reads from zustand) updates immediately.
          // Use refresh() to get the full updated user from the server.
          const currentUser = useAuthStore.getState().user;
          if (currentUser && currentUser.id === userId) {
            useAuthStore.getState().refresh().catch(() => {});
          }
          // Also invalidate dashboard activity since user changes are notable events
          q.invalidateQueries({ queryKey: ['dashboard-activity'] });
        }

        if (type === 'user_deleted') {
          const deletedUserId = String(data.userId ?? '');
          if (!deletedUserId) return;
          q.invalidateQueries({ queryKey: ['dashboard-activity'] });
          q.invalidateQueries({ queryKey: ['dashboard-resources'] });
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
          Promise.all([
            q.invalidateQueries({ queryKey: ['admin-servers'] }),
            q.invalidateQueries({ queryKey: ['servers'] }),
            q.invalidateQueries({ queryKey: ['dashboard-stats'] }),
            q.invalidateQueries({ queryKey: ['admin-stats'] }),
            q.invalidateQueries({ queryKey: ['dashboard-activity'] }),
            q.invalidateQueries({ queryKey: ['dashboard-resources'] }),
          ]);
        }

        if (type === 'server_deleted') {
          const serverId = String(data.serverId ?? '');
          Promise.all([
            q.invalidateQueries({ queryKey: ['admin-servers'] }),
            q.invalidateQueries({ queryKey: ['servers'] }),
            q.invalidateQueries({ queryKey: ['dashboard-stats'] }),
            q.invalidateQueries({ queryKey: ['admin-stats'] }),
            q.invalidateQueries({ queryKey: ['dashboard-activity'] }),
            q.invalidateQueries({ queryKey: ['dashboard-resources'] }),
          ]);
          if (serverId) {
            q.removeQueries({ queryKey: ['server', serverId] });
          }
        }

        // ── Server Update/Suspend/Unsuspend Events ──────────────────
        if (type === 'server_updated' || type === 'server_suspended' || type === 'server_unsuspended') {
          const serverId = String(data.serverId ?? '');
          // Invalidate server detail and list caches
          Promise.all([
            q.invalidateQueries({ queryKey: ['server'] }),
            q.invalidateQueries({ queryKey: ['servers'] }),
            q.invalidateQueries({ queryKey: ['admin-servers'] }),
            q.invalidateQueries({ queryKey: ['dashboard-stats'] }),
            q.invalidateQueries({ queryKey: ['admin-stats'] }),
            q.invalidateQueries({ queryKey: ['dashboard-activity'] }),
            q.invalidateQueries({ queryKey: ['dashboard-resources'] }),
          ]);
          // Also invalidate server permissions and invites (access changes)
          if (serverId) {
            q.invalidateQueries({ queryKey: ['server-permissions', serverId] });
            q.invalidateQueries({ queryKey: ['server-invites', serverId] });
            q.invalidateQueries({ queryKey: ['server-allocations', serverId] });
          }
        }

        // ── Node Events ─────────────────────────────────────────────
        if (type === 'node_created' || type === 'node_deleted') {
          Promise.all([
            q.invalidateQueries({ queryKey: ['admin-nodes'] }),
            q.invalidateQueries({ queryKey: ['nodes'] }),
            q.invalidateQueries({ queryKey: ['dashboard-stats'] }),
            q.invalidateQueries({ queryKey: ['admin-stats'] }),
            q.invalidateQueries({ queryKey: ['admin-health'] }),
            q.invalidateQueries({ queryKey: ['dashboard-activity'] }),
            q.invalidateQueries({ queryKey: ['dashboard-resources'] }),
          ]);
          if (type === 'node_deleted') {
            const nodeId = String(data.nodeId ?? '');
            if (nodeId) {
              q.removeQueries({ queryKey: ['node', nodeId] });
            }
          }
        }

        if (type === 'node_updated') {
          Promise.all([
            q.invalidateQueries({ queryKey: ['admin-nodes'] }),
            q.invalidateQueries({ queryKey: ['nodes'] }),
            q.invalidateQueries({ queryKey: ['admin-health'] }),
            q.invalidateQueries({ queryKey: ['locations'] }),
            q.invalidateQueries({ queryKey: ['cluster-metrics'] }),
          ]);
          const nodeId = String(data.nodeId ?? '');
          if (nodeId) {
            q.invalidateQueries({ queryKey: ['node', nodeId] });
            q.invalidateQueries({ queryKey: ['node-stats', nodeId] });
            q.invalidateQueries({ queryKey: ['node-metrics', nodeId] });
          }
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
          // Role changes affect permissions — invalidate server-permissions and my-permissions
          if (type === 'role_updated') {
            q.invalidateQueries({
              predicate: (query: Query) =>
                Array.isArray(query.queryKey) && query.queryKey[0] === 'server-permissions',
            });
            q.invalidateQueries({ queryKey: ['my-permissions'] });
          }
          if (type === 'role_deleted') {
            // Individual role detail queries don't exist yet;
            // invalidating the list is sufficient.
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
          q.invalidateQueries({ queryKey: ['dashboard-stats'] });
          q.invalidateQueries({ queryKey: ['admin-stats'] });
        }

        // ── API Key Events ─────────────────────────────────────────
        if (type === 'api_key_created' || type === 'api_key_updated' || type === 'api_key_deleted') {
          q.invalidateQueries({
            predicate: (query: Query) =>
              Array.isArray(query.queryKey) && query.queryKey[0] === 'api-keys',
          });
          q.invalidateQueries({ queryKey: ['profile-api-keys'] });
          q.invalidateQueries({
            predicate: (query: Query) =>
              Array.isArray(query.queryKey) && query.queryKey[0] === 'node-api-key',
          });
        }

        // ── Location Events ────────────────────────────────────────
        if (type === 'location_created' || type === 'location_updated' || type === 'location_deleted') {
          q.invalidateQueries({
            predicate: (query: Query) =>
              Array.isArray(query.queryKey) && query.queryKey[0] === 'locations',
          });
          // Also invalidate node queries since nodes display location names
          q.invalidateQueries({
            predicate: (query) =>
              Array.isArray(query.queryKey) &&
              (query.queryKey[0] === 'admin-nodes' || query.queryKey[0] === 'nodes'),
          });
        }

        // ── Nest Events ────────────────────────────────────────────
        if (type === 'nest_created' || type === 'nest_updated' || type === 'nest_deleted') {
          q.invalidateQueries({
            predicate: (query: Query) =>
              Array.isArray(query.queryKey) && query.queryKey[0] === 'nests',
          });
          // Templates are grouped by nest, so nest changes should refresh template lists
          q.invalidateQueries({
            predicate: (query) =>
              Array.isArray(query.queryKey) && query.queryKey[0] === 'templates',
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
          // Also invalidate the plain ip-pools key (used by NodeAllocationsPage)
          q.invalidateQueries({
            predicate: (query) =>
              Array.isArray(query.queryKey) && query.queryKey[0] === 'ip-pools',
          });
          // Also invalidate node detail since it may show pool count
          q.invalidateQueries({
            predicate: (query: Query) =>
              Array.isArray(query.queryKey) &&
              (query.queryKey[0] === 'admin-nodes' || query.queryKey[0] === 'nodes'),
          });
        }

        // ── Settings Events ──────────────────────────────────────────
        if (type === 'security_settings_updated') {
          q.invalidateQueries({ queryKey: ['admin-security-settings'] });
        }
        if (type === 'smtp_settings_updated') {
          q.invalidateQueries({ queryKey: ['admin-smtp'] });
        }
        if (type === 'theme_settings_updated') {
          q.invalidateQueries({ queryKey: ['admin-theme-settings'] });
        }
        if (type === 'system_settings_updated') {
          q.invalidateQueries({ queryKey: ['admin-mod-manager'] });
          q.invalidateQueries({ queryKey: ['admin-smtp'] });
          q.invalidateQueries({ queryKey: ['admin-security-settings'] });
        }
        if (type === 'oidc_settings_updated') {
          // OIDC config uses local state, invalidate any related queries
          q.invalidateQueries({ queryKey: ['admin-oidc-config'] });
        }
        if (type === 'plugin_updated') {
          q.invalidateQueries({
            predicate: (query: Query) =>
              Array.isArray(query.queryKey) &&
              (query.queryKey[0] === 'admin-plugins' || query.queryKey[0] === 'plugins'),
          });
        }
        if (type === 'audit_log_created') {
          q.invalidateQueries({
            predicate: (query: Query) =>
              Array.isArray(query.queryKey) && query.queryKey[0] === 'admin-audit-logs',
          });
          // Also invalidate profile audit log (users see their own audit entries)
          q.invalidateQueries({
            predicate: (query: Query) =>
              Array.isArray(query.queryKey) && query.queryKey[0] === 'profile-audit-log',
          });
        }
        if (type === 'auth_lockout_created' || type === 'auth_lockout_cleared') {
          q.invalidateQueries({ queryKey: ['admin-auth-lockouts'] });
        }

        // ── Task Events (M-11) ──────────────────────────────────────
        if (type === 'task_created' || type === 'task_updated' || type === 'task_deleted') {
          const serverId = String(data.serverId ?? '');
          if (serverId) {
            q.invalidateQueries({
              predicate: (query: Query) =>
                Array.isArray(query.queryKey) && query.queryKey[0] === 'tasks' && query.queryKey[1] === serverId,
            });
          }
        }

        // ── Database Events (M-12) ─────────────────────────────────
        if (type === 'database_created' || type === 'database_deleted' || type === 'database_password_rotated') {
          const serverId = String(data.serverId ?? '');
          if (serverId) {
            q.invalidateQueries({
              predicate: (query: Query) =>
                Array.isArray(query.queryKey) && query.queryKey[0] === 'server-databases' && query.queryKey[1] === serverId,
            });
          }
        }

        // ── Node Assignment Events (H-03) ──────────────────────────
        if (type === 'node_assigned' || type === 'node_unassigned' || type === 'wildcard_assigned' || type === 'wildcard_removed') {
          const nodeId = String(data.nodeId ?? '');
          const roleId = String(data.roleId ?? '');
          const userId = String(data.userId ?? '');
          if (nodeId) {
            q.invalidateQueries({ queryKey: ['nodes', nodeId, 'assignments'] });
          }
          if (roleId) {
            q.invalidateQueries({ queryKey: ['roles', roleId, 'nodes'] });
          }
          if (userId) {
            q.invalidateQueries({ queryKey: ['users', userId, 'nodes'] });
          }
          q.invalidateQueries({
            predicate: (query: Query) =>
              Array.isArray(query.queryKey) && query.queryKey[0] === 'nodes',
          });
        }

        // ── Mod Manager Events ───────────────────────────────────────
        if (type === 'mod_install_complete' || type === 'mod_uninstall_complete' || type === 'mod_update_complete') {
          const serverId = String(data.serverId ?? '');
          if (serverId) {
            q.invalidateQueries({
              predicate: (query: Query) =>
                Array.isArray(query.queryKey) &&
                query.queryKey[0] === 'mod-manager-installed',
            });
          }
        }

        // ── Plugin Manager Events ────────────────────────────────────
        if (type === 'plugin_install_complete' || type === 'plugin_uninstall_complete' || type === 'plugin_update_complete') {
          const serverId = String(data.serverId ?? '');
          if (serverId) {
            q.invalidateQueries({
              predicate: (query: Query) =>
                Array.isArray(query.queryKey) &&
                query.queryKey[0] === 'plugin-manager-installed',
            });
          }
        }
      },
      () => {},
    );

    return disconnect;
  }, [queryClient, isAdmin]);
}
