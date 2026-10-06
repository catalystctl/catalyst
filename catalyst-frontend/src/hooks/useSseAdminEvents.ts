/**
 * Comprehensive admin SSE events hook.
 *
 * Listens for ALL admin entity events (users, servers, nodes, templates,
 * roles, alert rules, alert instances, API keys, locations, nests,
 * database hosts, and IP pools) via the admin SSE stream and
 * updates the appropriate Catalyst Sync caches in real-time.
 *
 * Only connects if the user holds literal `admin.read` — the backend gate for
 * /api/admin/events (routes/admin-events.ts:105). The wider
 * `hasAnyAdminPermission` predicate used to make narrower admins (apikey.manage,
 * template.read, …) open a stream that 403s and poisons the shared entry.
 */
import { useEffect, useMemo } from 'react';
import { useQueryClient, type Query } from '@/csync';
import { useAuthStore } from '../stores/authStore';
import {
  createAdminEventsStream,
  hasAdminReadPermission,
  type AdminEventType,
} from '../services/api/admin-events';
import { invalidateOnce } from '../lib/invalidateOnce';
import { qk } from '../lib/queryKeys';
import type { AdminUser, SystemError } from '../types/admin';
import type { Template } from '../types/template';
import i18n from '@/i18n';

/**
 * Admin event types this hook actually handles (each has a branch below).
 * Contract-tested against ADMIN_EVENT_TYPES in
 * csync/__tests__/sse-event-contract.test.ts — every allowlisted type must
 * appear here or in that test's documented KNOWN_UNHANDLED exception list.
 */
export const HANDLED_ADMIN_EVENTS: AdminEventType[] = [
  'user_created',
  'user_deleted',
  'user_updated',
  'server_created',
  'server_deleted',
  'server_updated',
  'server_suspended',
  'server_unsuspended',
  'node_created',
  'node_deleted',
  'node_updated',
  'template_created',
  'template_updated',
  'template_deleted',
  'templates_batch_imported',
  'role_created',
  'role_updated',
  'role_deleted',
  'alert_rule_created',
  'alert_rule_updated',
  'alert_rule_deleted',
  'alert_created',
  'alert_resolved',
  'alert_deleted',
  'api_key_created',
  'api_key_updated',
  'api_key_deleted',
  'location_created',
  'location_updated',
  'location_deleted',
  'nest_created',
  'nest_updated',
  'nest_deleted',
  'database_host_created',
  'database_host_updated',
  'database_host_deleted',
  'ip_pool_created',
  'ip_pool_updated',
  'ip_pool_deleted',
  'security_settings_updated',
  'smtp_settings_updated',
  'theme_settings_updated',
  'system_settings_updated',
  'oidc_settings_updated',
  'env_settings_updated',
  'mcp_settings_updated',
  'plugin_updated',
  'audit_log_created',
  'auth_lockout_created',
  'auth_lockout_cleared',
  'system_error',
  'system_error_resolved',
  'task_created',
  'task_updated',
  'task_deleted',
  'database_created',
  'database_deleted',
  'database_password_rotated',
  'node_assigned',
  'node_unassigned',
  'wildcard_assigned',
  'wildcard_removed',
  'node_flapping',
  'network_created',
  'network_updated',
  'network_deleted',
  'mod_install_complete',
  'mod_uninstall_complete',
  'mod_update_complete',
  'plugin_install_complete',
  'plugin_uninstall_complete',
  'plugin_update_complete',
  'migration_job_updated',
  'migration_step_updated',
  'agent_update_started',
  'agent_update_failed',
  'agent_update_progress',
  'node_metrics_updated',
  // Wave-3 additions (allocation lifecycle, alert deliveries, panel update,
  // container discovery) — each has a real branch below.
  'allocation_created',
  'allocation_updated',
  'allocation_deleted',
  'alert_delivery_updated',
  'panel_update_available',
  'panel_update_state',
  'discovered_servers_updated',
];

/**
 * P1-3/P0-F: allocation caches live per node (['node-allocations', nodeId]).
 * Events without a nodeId still consumed/released allocations on some node —
 * invalidate every node-allocations cache via predicate instead of skipping.
 */
function invalidateNodeAllocations(q: any, nodeId: string): Promise<void> {
  return nodeId
    ? invalidateOnce(q, { queryKey: qk.adminNodeAllocations(nodeId) })
    : invalidateOnce(q, {
        predicate: (query: any) =>
          Array.isArray(query.queryKey) &&
          query.queryKey[0] === 'node-allocations',
        dedupeKey: 'node-allocations-all',
      });
}

/** Coalesce admin SSE side-effects into one microtask/rAF window to avoid invalidate storms. */
function createAdminWorkScheduler() {
  const pending = new Set<() => void>();
  let scheduled = false;
  const flush = () => {
    scheduled = false;
    const jobs = [...pending];
    pending.clear();
    for (const job of jobs) {
      try {
        job();
      } catch {
        /* isolate */
      }
    }
  };
  return (job: () => void) => {
    pending.add(job);
    if (scheduled) return;
    scheduled = true;
    // P2-10: rAF is paused in hidden tabs — pending closures would accumulate
    // until the tab is shown again. Fall back to a timer while hidden.
    if (typeof document !== 'undefined' && document.hidden) {
      setTimeout(flush, 50);
    } else if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => queueMicrotask(flush));
    } else {
      queueMicrotask(flush);
    }
  };
}

export function useSseAdminEvents() {
  const queryClient = useQueryClient();
  const permissions = useAuthStore((s) => s.user?.permissions);
  // Literal admin.read only (P0.6): mirrors the backend authorization check,
  // so users with e.g. apikey.manage/template.read no longer open a stream
  // that 403s. Routing itself still uses the wider ProtectedRoute predicate.
  const isAdmin = useMemo(
    () => hasAdminReadPermission(permissions),
    [permissions],
  );

  useEffect(() => {
    if (!isAdmin) return;

    const schedule = createAdminWorkScheduler();

    const disconnect = createAdminEventsStream(
      (type: AdminEventType, data: Record<string, unknown>) => {
        schedule(() => {
        const q = queryClient as any;

        // ── User Events ─────────────────────────────────────────────
        if (type === 'user_created') {
          const newUser = data.user as AdminUser;
          if (!newUser) return;
          Promise.all([
            // F7: the optimistic patch below cannot fix `pagination.total`
            // (nor other pages/filters) — invalidation makes every
            // admin-users cache converge with the server.
            invalidateOnce(q, { queryKey: qk.adminUsers() }),
            invalidateOnce(q, { queryKey: qk.dashboardActivity() }),
            invalidateOnce(q, { queryKey: qk.dashboardResources() }),
          ]);
          q.setQueriesData(
            { predicate: (query: Query) =>
              Array.isArray(query.queryKey) &&
              query.queryKey[0] === 'admin-users' &&
              // Exact list key only — never rewrite other pages'/filters'
              // caches (their shape/pagination differs); they converge
              // through the invalidateQueries call above.
              query.queryKey.length === 1 },
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
          Promise.all([
            invalidateOnce(q, { queryKey: qk.adminUsers() }),
            // A4: role membership changes emit user_updated, which also
            // changes each role's member count shown on RolesPage.
            invalidateOnce(q, { queryKey: qk.adminRoles() }),
            // Also invalidate profile query if the updated user is the current user
            invalidateOnce(q, { queryKey: qk.profile() }),
            invalidateOnce(q, { queryKey: qk.myPermissions() }),
            // Also invalidate dashboard activity since user changes are notable events
            invalidateOnce(q, { queryKey: qk.dashboardActivity() }),
          ]);

          // If the updated user is the current user, refresh the auth store
          // so the sidebar (which reads from zustand) updates immediately.
          // Use refresh() to get the full updated user from the server.
          const currentUser = useAuthStore.getState().user;
          if (currentUser && currentUser.id === userId) {
            useAuthStore.getState().refresh().catch(() => {});
          }
        }

        if (type === 'user_deleted') {
          const deletedUserId = String(data.userId ?? '');
          if (!deletedUserId) return;
          Promise.all([
            // F7: fixes pagination.total and converges every other page/filter.
            invalidateOnce(q, { queryKey: qk.adminUsers() }),
            invalidateOnce(q, { queryKey: qk.dashboardActivity() }),
            invalidateOnce(q, { queryKey: qk.dashboardResources() }),
          ]);
          q.setQueriesData(
            { predicate: (query: Query) =>
              Array.isArray(query.queryKey) &&
              query.queryKey[0] === 'admin-users' &&
              // Exact list key only (see user_created) — other caches
              // converge through the invalidateQueries call above.
              query.queryKey.length === 1 },
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
          const nodeId = String(data.nodeId ?? '');
          Promise.all([
            invalidateOnce(q, { queryKey: qk.adminServers() }),
            invalidateOnce(q, { queryKey: qk.servers() }),
            invalidateNodeAllocations(q, nodeId),
            invalidateOnce(q, { queryKey: qk.dashboardStats() }),
            invalidateOnce(q, { queryKey: qk.adminStats() }),
            invalidateOnce(q, { queryKey: qk.dashboardActivity() }),
            invalidateOnce(q, { queryKey: qk.dashboardResources() }),
          ]);
        }

        if (type === 'server_deleted') {
          const serverId = String(data.serverId ?? '');
          const nodeId = String(data.nodeId ?? '');
          Promise.all([
            invalidateOnce(q, { queryKey: qk.adminServers() }),
            invalidateOnce(q, { queryKey: qk.servers() }),
            invalidateNodeAllocations(q, nodeId),
            invalidateOnce(q, { queryKey: qk.dashboardStats() }),
            invalidateOnce(q, { queryKey: qk.adminStats() }),
            invalidateOnce(q, { queryKey: qk.dashboardActivity() }),
            invalidateOnce(q, { queryKey: qk.dashboardResources() }),
          ]);
          if (serverId) {
            q.removeQueries({ queryKey: qk.server(serverId) });
            q.removeQueries({ queryKey: qk.serverPermissions(serverId) });
            q.removeQueries({ queryKey: qk.serverInvites(serverId) });
            q.removeQueries({ queryKey: qk.serverAllocations(serverId) });
            q.removeQueries({ queryKey: qk.backups(serverId) });
            q.removeQueries({ queryKey: qk.tasks(serverId) });
          }
        }

        // ── Server Update/Suspend/Unsuspend Events ──────────────────
        if (type === 'server_updated' || type === 'server_suspended' || type === 'server_unsuspended') {
          const serverId = String(data.serverId ?? '');
          const nodeId = String(data.nodeId ?? '');
          // Invalidate server detail and list caches
          Promise.all([
            invalidateOnce(q, { queryKey: qk.servers() }),
            invalidateOnce(q, { queryKey: qk.adminServers() }),
            invalidateNodeAllocations(q, nodeId),
            invalidateOnce(q, { queryKey: qk.dashboardStats() }),
            invalidateOnce(q, { queryKey: qk.adminStats() }),
            invalidateOnce(q, { queryKey: qk.dashboardActivity() }),
            invalidateOnce(q, { queryKey: qk.dashboardResources() }),
          ]);
          // Also invalidate server detail, permissions and invites (access changes)
          if (serverId) {
            invalidateOnce(q, { queryKey: qk.server(serverId) });
            invalidateOnce(q, { queryKey: qk.serverPermissions(serverId) });
            invalidateOnce(q, { queryKey: qk.serverInvites(serverId) });
            invalidateOnce(q, { queryKey: qk.serverAllocations(serverId) });
          }
        }

        // ── RolesPage scope-server picker (A10) ─────────────────────
        // Custom key with no qk helper (pages/admin/RolesPage.tsx:987) used
        // by the role-wizard scope step; previously matched no handler.
        if (
          type === 'server_created' ||
          type === 'server_deleted' ||
          type === 'server_updated' ||
          type === 'server_suspended' ||
          type === 'server_unsuspended'
        ) {
          invalidateOnce(q, {
            predicate: (query: any) =>
              Array.isArray(query.queryKey) &&
              query.queryKey[0] === 'admin-servers-for-scope',
            dedupeKey: 'admin-servers-for-scope',
          });
        }

        // ── Node Events ─────────────────────────────────────────────
        if (type === 'node_created' || type === 'node_deleted') {
          const nodeId = String(data.nodeId ?? '');
          Promise.all([
            invalidateOnce(q, { queryKey: qk.adminNodes() }),
            invalidateOnce(q, { queryKey: qk.nodes() }),
            invalidateOnce(q, { queryKey: qk.accessibleNodes() }),
            // A9: MigrationPage's target-node picker — invalidated nowhere before.
            invalidateOnce(q, { queryKey: qk.catalystNodes() }),
            ...(nodeId ? [invalidateOnce(q, { queryKey: qk.adminNodeAllocations(nodeId) })] : []),
            invalidateOnce(q, { queryKey: qk.dashboardStats() }),
            invalidateOnce(q, { queryKey: qk.adminStats() }),
            invalidateOnce(q, { queryKey: qk.adminHealth() }),
            invalidateOnce(q, { queryKey: qk.dashboardActivity() }),
            invalidateOnce(q, { queryKey: qk.dashboardResources() }),
          ]);
          if (type === 'node_deleted') {
            if (nodeId) {
              q.removeQueries({ queryKey: qk.node(nodeId) });
              q.removeQueries({ queryKey: qk.nodeStats(nodeId) });
              q.removeQueries({ queryKey: qk.nodeMetrics(nodeId) });
              q.removeQueries({ queryKey: qk.adminNodeAllocations(nodeId) });
            }
          }
        }

        if (type === 'node_updated') {
          const nodeId = String(data.nodeId ?? '');
          Promise.all([
            invalidateOnce(q, { queryKey: qk.adminNodes() }),
            invalidateOnce(q, { queryKey: qk.nodes() }),
            invalidateOnce(q, { queryKey: qk.accessibleNodes() }),
            // A9: migration target-node list
            invalidateOnce(q, { queryKey: qk.catalystNodes() }),
            ...(nodeId ? [invalidateOnce(q, { queryKey: qk.adminNodeAllocations(nodeId) })] : []),
            invalidateOnce(q, { queryKey: qk.adminHealth() }),
            invalidateOnce(q, { queryKey: qk.locations() }),
            invalidateOnce(q, { queryKey: qk.clusterMetrics() }),
            // F8: the home-page activity feed also records node changes.
            invalidateOnce(q, { queryKey: qk.dashboardActivity() }),
          ]);
          if (nodeId) {
            invalidateOnce(q, { queryKey: qk.node(nodeId) });
            invalidateOnce(q, { queryKey: qk.nodeStats(nodeId) });
            invalidateOnce(q, { queryKey: qk.nodeMetrics(nodeId) });
            invalidateOnce(q, { queryKey: qk.adminNodeAllocations(nodeId) });
            // Agent control panel status depends on node online + agentVersion
            invalidateOnce(q, { queryKey: qk.agentStatus(nodeId) });
            invalidateOnce(q, { queryKey: qk.agentUpdateStatus(nodeId) });
          }
        }

        // ── Template Events ─────────────────────────────────────────
        if (type === 'template_created') {
          const template = data.template as Template;
          if (!template) return;
          q.setQueriesData(
            { predicate: (query: Query) =>
              Array.isArray(query.queryKey) && query.queryKey[0] === 'templates' },
            (prev: any) => {
              if (!prev || !Array.isArray(prev)) return prev;
              if (prev.some((t: Template) => t.id === template.id)) return prev;
              return [template, ...prev];
            },
          );
          // Reconcile with server after optimistic insert
          invalidateOnce(q, { queryKey: qk.templates() });
        }

        if (type === 'template_updated') {
          const templateId = String(data.templateId ?? '');
          if (!templateId) return;
          Promise.all([
            invalidateOnce(q, { queryKey: qk.templates() }),
            invalidateOnce(q, { queryKey: qk.template(templateId) }),
          ]);
        }

        if (type === 'template_deleted') {
          const templateId = String(data.templateId ?? '');
          if (!templateId) return;
          q.setQueriesData(
            { predicate: (query: Query) =>
              Array.isArray(query.queryKey) && query.queryKey[0] === 'templates' },
            (prev: any) => {
              if (!prev || !Array.isArray(prev)) return prev;
              return prev.filter((t: Template) => t.id !== templateId);
            },
          );
          invalidateOnce(q, { queryKey: qk.template(templateId) });
          // Reconcile with server after optimistic removal
          invalidateOnce(q, { queryKey: qk.templates() });
        }

        // ── Role Events ─────────────────────────────────────────────
        if (type === 'role_created' || type === 'role_updated' || type === 'role_deleted') {
          invalidateOnce(q, { queryKey: qk.adminRoles() });
          // Role changes affect permissions — invalidate server-permissions and my-permissions
          if (type === 'role_updated') {
            Promise.all([
              invalidateOnce(q, {
                predicate: (query: any) =>
                  Array.isArray(query.queryKey) &&
                  query.queryKey[0] === 'servers' &&
                  query.queryKey[2] === 'permissions',
              }),
              invalidateOnce(q, { queryKey: qk.myPermissions() }),
            ]);
          }
          if (type === 'role_deleted') {
            // Individual role detail queries don't exist yet;
            // invalidating the list is sufficient.
          }
        }

        // ── Alert Rule Events ───────────────────────────────────────
        if (type === 'alert_rule_created' || type === 'alert_rule_updated' || type === 'alert_rule_deleted') {
          invalidateOnce(q, { queryKey: qk.alertRules() });
        }

        // ── Alert Instance Events ───────────────────────────────────
        if (type === 'alert_created' || type === 'alert_resolved' || type === 'alert_deleted') {
          Promise.all([
            invalidateOnce(q, { queryKey: qk.alerts() }),
            invalidateOnce(q, { queryKey: qk.alertStats() }),
            invalidateOnce(q, { queryKey: qk.dashboardStats() }),
            invalidateOnce(q, { queryKey: qk.adminStats() }),
          ]);
        }

        // Delivery status (email/webhook attempt) changed on one alert —
        // deliveries render inside the alerts list/detail caches.
        if (type === 'alert_delivery_updated') {
          invalidateOnce(q, { queryKey: qk.alerts() });
        }

        // ── API Key Events ─────────────────────────────────────────
        if (type === 'api_key_created' || type === 'api_key_updated' || type === 'api_key_deleted') {
          Promise.all([
            invalidateOnce(q, { queryKey: qk.apiKeys() }),
            invalidateOnce(q, { queryKey: qk.profileApiKeys() }),
            invalidateOnce(q, {
              predicate: (query: any) =>
                Array.isArray(query.queryKey) &&
                query.queryKey[0] === 'nodes' &&
                query.queryKey[2] === 'api-key',
            }),
          ]);
        }

        // ── Location Events ────────────────────────────────────────
        if (type === 'location_created' || type === 'location_updated' || type === 'location_deleted') {
          Promise.all([
            invalidateOnce(q, { queryKey: qk.locations() }),
            invalidateOnce(q, { queryKey: qk.adminNodes() }),
            invalidateOnce(q, { queryKey: qk.nodes() }),
          ]);
        }

        // ── Nest Events ────────────────────────────────────────────
        if (type === 'nest_created' || type === 'nest_updated' || type === 'nest_deleted') {
          Promise.all([
            invalidateOnce(q, { queryKey: qk.nests() }),
            invalidateOnce(q, { queryKey: qk.templates() }),
          ]);
        }

        // ── Database Host Events ───────────────────────────────────
        if (type === 'database_host_created' || type === 'database_host_updated' || type === 'database_host_deleted') {
          Promise.all([
            invalidateOnce(q, { queryKey: qk.databaseHosts() }),
            invalidateOnce(q, { queryKey: qk.adminDatabaseHosts() }),
          ]);
        }

        // ── IP Pool Events ─────────────────────────────────────────
        if (type === 'ip_pool_created' || type === 'ip_pool_updated' || type === 'ip_pool_deleted') {
          const nodeId = String(data.nodeId ?? '');
          if (nodeId) {
            invalidateOnce(q, { queryKey: qk.adminIpPools(nodeId) });
          } else {
            // No nodeId in event — invalidate all IP pool queries via predicate
            invalidateOnce(q, {
              predicate: (query: any) =>
                Array.isArray(query.queryKey) &&
                query.queryKey[0] === 'ip-pools',
              dedupeKey: 'ip-pools',
            });
          }
          invalidateOnce(q, { queryKey: qk.adminNodes() });
          invalidateOnce(q, { queryKey: qk.nodes() });
        }

        // ── Settings Events ──────────────────────────────────────────
        if (type === 'security_settings_updated') {
          invalidateOnce(q, { queryKey: qk.adminSecuritySettings() });
        }
        if (type === 'smtp_settings_updated') {
          invalidateOnce(q, { queryKey: qk.adminSmtp() });
        }
        if (type === 'theme_settings_updated') {
          invalidateOnce(q, { queryKey: qk.adminThemeSettings() });
        }
        if (type === 'system_settings_updated') {
          Promise.all([
            invalidateOnce(q, { queryKey: qk.adminModManager() }),
            invalidateOnce(q, { queryKey: qk.adminSmtp() }),
            invalidateOnce(q, { queryKey: qk.adminSecuritySettings() }),
            // A11: SystemPage's locale card reads this key (useAdmin.ts:161).
            invalidateOnce(q, { queryKey: qk.adminLocalizationSettings() }),
            // P1-14: update automation settings/status are stored as system
            // settings server-side — UpdateSettings reads both keys.
            invalidateOnce(q, { queryKey: qk.adminUpdateSettings() }),
            invalidateOnce(q, { queryKey: qk.adminUpdateStatus() }),
          ]);
        }
        if (type === 'oidc_settings_updated') {
          // OIDC config uses local state, invalidate any related queries
          invalidateOnce(q, { queryKey: qk.adminOidcConfig() });
        }
        // A2: EnvironmentPage (useAdmin.ts:271) — emitted by routes/env.ts:86
        // but previously dropped by the allowlist and unhandled here.
        if (type === 'env_settings_updated') {
          invalidateOnce(q, { queryKey: qk.adminEnv() });
        }
        // A3: SecurityPage MCP card (useAdmin.ts:139).
        if (type === 'mcp_settings_updated') {
          invalidateOnce(q, { queryKey: qk.adminMcpSettings() });
        }
        if (type === 'plugin_updated') {
          Promise.all([
            invalidateOnce(q, { queryKey: qk.adminPlugins() }),
            // P1-11: per-plugin detail caches (['admin-plugin', name]) —
            // prefix invalidation on the list key never matched them.
            invalidateOnce(q, {
              predicate: (query: any) =>
                Array.isArray(query.queryKey) &&
                query.queryKey[0] === 'admin-plugin',
              dedupeKey: 'admin-plugin',
            }),
          ]);
        }
        if (type === 'audit_log_created') {
          Promise.all([
            invalidateOnce(q, { queryKey: qk.adminAuditLogs() }),
            invalidateOnce(q, { queryKey: qk.profileAuditLog() }),
            // F8: dashboard activity is fed by the audit log — this event is
            // its actual source (dashboard.ts:118).
            invalidateOnce(q, { queryKey: qk.dashboardActivity() }),
          ]);
        }
        if (type === 'auth_lockout_created' || type === 'auth_lockout_cleared') {
          invalidateOnce(q, { queryKey: qk.adminAuthLockouts() });
        }

        // ── Task Events (M-11) ──────────────────────────────────────
        if (type === 'task_created' || type === 'task_updated' || type === 'task_deleted') {
          const serverId = String(data.serverId ?? '');
          if (serverId) {
            invalidateOnce(q, { queryKey: qk.tasks(serverId) });
          }
        }

        // ── Database Events (M-12) ─────────────────────────────────
        if (type === 'database_created' || type === 'database_deleted' || type === 'database_password_rotated') {
          const serverId = String(data.serverId ?? '');
          if (serverId) {
            invalidateOnce(q, { queryKey: qk.serverDatabases(serverId) });
          }
        }

        // ── Node Assignment Events (H-03) ──────────────────────────
        if (type === 'node_assigned' || type === 'node_unassigned' || type === 'wildcard_assigned' || type === 'wildcard_removed') {
          const nodeId = String(data.nodeId ?? '');
          const roleId = String(data.roleId ?? '');
          const userId = String(data.userId ?? '');
          if (nodeId) {
            invalidateOnce(q, { queryKey: qk.nodeAssignments(nodeId) });
          }
          if (roleId) {
            invalidateOnce(q, { queryKey: qk.roleNodes(roleId) });
          }
          if (userId) {
            invalidateOnce(q, { queryKey: qk.userNodes(userId) });
          }
          invalidateOnce(q, { queryKey: qk.nodes() });
          Promise.all([
            // A4: grants/revoke badge counts live on the roles list.
            invalidateOnce(q, { queryKey: qk.adminRoles() }),
            // A9: migration target nodes (also refreshed by node_* events).
            invalidateOnce(q, { queryKey: qk.catalystNodes() }),
            // A7: NodesPage's delete-permission gate — custom key
            // ['admin', 'node-delete-access', userId] (NodesPage.tsx:299).
            invalidateOnce(q, {
              predicate: (query: any) =>
                Array.isArray(query.queryKey) &&
                query.queryKey[0] === 'admin' &&
                query.queryKey[1] === 'node-delete-access',
              dedupeKey: 'admin:node-delete-access',
            }),
          ]);
        }

        // ── Template batch import (A-P0.2) ─────────────────────────
        if (type === 'templates_batch_imported') {
          Promise.all([
            invalidateOnce(q, { queryKey: qk.templates() }),
            invalidateOnce(q, { queryKey: qk.nests() }),
          ]);
        }

        // ── Node reliability / agent network lifecycle (P0.2) ──────
        if (type === 'node_flapping') {
          // Node reconnected repeatedly — node lists + health are suspect.
          Promise.all([
            invalidateOnce(q, { queryKey: qk.adminNodes() }),
            invalidateOnce(q, { queryKey: qk.nodes() }),
            invalidateOnce(q, { queryKey: qk.adminHealth() }),
          ]);
        }
        if (
          type === 'network_created' ||
          type === 'network_updated' ||
          type === 'network_deleted'
        ) {
          // Gateway payload = agent message + nodeId + timestamp.
          const nodeId = String(data.nodeId ?? '');
          Promise.all([
            invalidateOnce(q, { queryKey: qk.adminNodes() }),
            ...(nodeId
              ? [invalidateOnce(q, { queryKey: qk.adminNodeAllocations(nodeId) })]
              : []),
          ]);
        }

        // ── Node allocation lifecycle (P0-F) ─────────────────────────
        // {type, nodeId, allocationIds?, timestamp}. Without a nodeId the
        // changed allocations cannot be located — refresh every node's list.
        if (
          type === 'allocation_created' ||
          type === 'allocation_updated' ||
          type === 'allocation_deleted'
        ) {
          invalidateNodeAllocations(q, String(data.nodeId ?? ''));
        }

        // ── Agent container discovery ────────────────────────────────
        // {type, nodeId, count, timestamp} — feeds the unregistered-containers
        // card on NodeDetailsPage (qk.unregisteredContainers).
        if (type === 'discovered_servers_updated') {
          const nodeId = String(data.nodeId ?? '');
          if (nodeId) {
            invalidateOnce(q, { queryKey: qk.unregisteredContainers(nodeId) });
          }
        }

        // ── Panel update pipeline ────────────────────────────────────
        // {type, currentVersion?, latestVersion?, timestamp}
        if (type === 'panel_update_available') {
          invalidateOnce(q, { queryKey: qk.adminUpdateStatus() });
        }
        // {type, state, progress?, message?, timestamp} — patch the cache
        // UpdateProgressModal reads (it keeps its own 2s poll as backstop).
        if (type === 'panel_update_state') {
          const nextState = typeof data.state === 'string' ? data.state : undefined;
          q.setQueryData(qk.adminUpdateState(), (prev: any) => {
            // Only patch an existing cache — never fabricate a partial
            // UpdateStateResponse; the modal's poll fetches the full shape.
            if (!prev || typeof prev !== 'object') return prev;
            return {
              ...prev,
              ...(nextState ? { state: nextState } : {}),
              message:
                data.message !== undefined ? data.message : (prev.message ?? null),
              updatedAt: String(data.timestamp ?? new Date().toISOString()),
            };
          });
          invalidateOnce(q, { queryKey: qk.adminUpdateState() });
        }

        // ── Mod Manager Events ───────────────────────────────────────
        if (type === 'mod_install_complete' || type === 'mod_uninstall_complete' || type === 'mod_update_complete') {
          const serverId = String(data.serverId ?? '');
          if (serverId) {
            invalidateOnce(q, { queryKey: qk.modManagerInstalled(serverId) });
          }
        }

        // ── System Error Events ─────────────────────────────────────
        if (type === 'system_error') {
          const error = data.error as SystemError;
          if (!error) return;
          // Prepend the new error to the cache
          q.setQueriesData(
            { predicate: (query: Query) =>
              Array.isArray(query.queryKey) && query.queryKey[0] === 'admin-system-errors' },
            (prev: any) => {
              if (!prev || typeof prev !== 'object') return prev;
              if ('errors' in prev && Array.isArray(prev.errors)) {
                if (prev.errors.some((e: SystemError) => e.id === error.id)) return prev;
                return { ...prev, errors: [error, ...prev.errors] };
              }
              return prev;
            },
          );
          // Reconcile with server after optimistic prepend
          invalidateOnce(q, { queryKey: qk.adminSystemErrors() });
        }

        // Distinct from `system_error` above (A6/P1.5): a resolution must NOT
        // optimistic-prepend anything — the row's state changed server-side,
        // so plain invalidation is the correct (and only) effect.
        if (type === 'system_error_resolved') {
          invalidateOnce(q, { queryKey: qk.adminSystemErrors() });
        }

        // ── Plugin Manager Events ────────────────────────────────────
        if (type === 'plugin_install_complete' || type === 'plugin_uninstall_complete' || type === 'plugin_update_complete') {
          const serverId = String(data.serverId ?? '');
          if (serverId) {
            invalidateOnce(q, { queryKey: qk.pluginManagerInstalled(serverId) });
          }
        }

        // ── Migration progress ───────────────────────────────────────
        if (type === 'migration_job_updated') {
          const jobId = String(data.jobId ?? '');
          invalidateOnce(q, { queryKey: qk.migrationJobs() });
          if (jobId) {
            // Patch active job detail when present; always mark list stale.
            q.setQueryData(qk.migrationJob(jobId), (prev: any) => {
              if (!prev || typeof prev !== 'object') return prev;
              return {
                ...prev,
                status: data.status ?? prev.status,
                currentPhase: data.currentPhase ?? prev.currentPhase,
                progress: data.progress ?? prev.progress,
                error: data.error !== undefined ? data.error : prev.error,
                completedAt: data.completedAt ?? prev.completedAt,
              };
            });
            // Ensure observers without cache still refetch
            invalidateOnce(q, { queryKey: qk.migrationJob(jobId) });
          }
        }

        if (type === 'migration_step_updated') {
          const jobId = String(data.jobId ?? '');
          const step = data.step as Record<string, unknown> | undefined;
          if (jobId && step && typeof step === 'object' && step.id) {
            q.setQueryData(qk.migrationSteps(jobId), (prev: any) => {
              if (!prev || typeof prev !== 'object') return prev;
              const steps = Array.isArray(prev.steps) ? prev.steps : null;
              if (!steps) {
                // Unknown shape — force refetch
                return prev;
              }
              const idx = steps.findIndex((s: any) => s?.id === step.id);
              let nextSteps;
              if (idx >= 0) {
                nextSteps = steps.slice();
                nextSteps[idx] = { ...steps[idx], ...step };
              } else {
                nextSteps = [...steps, step];
              }
              return { ...prev, steps: nextSteps };
            });
            // Safety refetch so pagination/count stay correct
            invalidateOnce(q, { queryKey: qk.migrationSteps(jobId) });
          } else if (jobId) {
            invalidateOnce(q, { queryKey: qk.migrationSteps(jobId) });
          }
        }

        // ── Node live metrics (health_report fanout) ─────────────────
        if (type === 'node_metrics_updated') {
          const nodeId = String(data.nodeId ?? '');
          const cpu = Number(data.cpuPercent ?? 0);
          const memUsage = Number(data.memoryUsageMb ?? 0);
          const memTotal = Number(data.memoryTotalMb ?? 0);
          const memoryPct = memTotal > 0 ? Math.round((memUsage / memTotal) * 100) : 0;
          const ts = String(data.timestamp ?? new Date().toISOString());

          // Live-patch cluster metrics cache (dense dashboard stream without REST fanout)
          q.setQueriesData(
            {
              predicate: (query: Query) =>
                Array.isArray(query.queryKey) && query.queryKey[0] === 'cluster-metrics',
            },
            (prev: any) => {
              if (!prev || typeof prev !== 'object' || !Array.isArray(prev.nodes)) return prev;
              let found = false;
              const nodes = prev.nodes.map((n: any) => {
                if (n.nodeId !== nodeId) return n;
                found = true;
                return {
                  ...n,
                  isOnline: data.isOnline !== false,
                  cpu: Number.isFinite(cpu) ? cpu : n.cpu,
                  memory: memoryPct || n.memory,
                  timestamp: ts,
                };
              });
              if (!found && nodeId) {
                nodes.push({
                  nodeId,
                  nodeName: String(data.nodeName ?? nodeId.slice(0, 8)),
                  isOnline: data.isOnline !== false,
                  cpu: Number.isFinite(cpu) ? cpu : 0,
                  memory: memoryPct,
                  networkRx: 0,
                  networkTx: 0,
                  timestamp: ts,
                });
              }
              const onlineNodes = nodes.filter((n: any) => n.isOnline);
              const totalCpu =
                onlineNodes.length > 0
                  ? Math.round(onlineNodes.reduce((s: number, n: any) => s + (n.cpu || 0), 0) / onlineNodes.length)
                  : 0;
              const totalMemory =
                onlineNodes.length > 0
                  ? Math.round(onlineNodes.reduce((s: number, n: any) => s + (n.memory || 0), 0) / onlineNodes.length)
                  : 0;
              return {
                ...prev,
                nodes,
                totalCpu,
                totalMemory,
                onlineCount: onlineNodes.length,
                offlineCount: nodes.length - onlineNodes.length,
                lastUpdated: ts,
              };
            },
          );

          if (nodeId) {
            invalidateOnce(q, { queryKey: qk.nodeStats(nodeId) });
            invalidateOnce(q, { queryKey: qk.nodeMetrics(nodeId) });
            invalidateOnce(q, { queryKey: qk.node(nodeId) });
            invalidateOnce(q, { queryKey: qk.agentStatus(nodeId) });
          }
          // Don't full-invalidate clusterMetrics — we patched it. Still refresh lists lightly.
          invalidateOnce(q, { queryKey: qk.dashboardResources() });
        }

                // ── Agent control ────────────────────────────────────────────
        if (
          type === 'agent_update_started' ||
          type === 'agent_update_failed' ||
          type === 'agent_update_progress'
        ) {
          const nodeId = String(data.nodeId ?? '');
          if (!nodeId) return;
          // Patch update-status cache when payload includes progress fields
          if (type === 'agent_update_progress' || type === 'agent_update_started' || type === 'agent_update_failed') {
            q.setQueryData(qk.agentUpdateStatus(nodeId), (prev: any) => {
              const base = prev && typeof prev === 'object' ? prev : {};
              if (type === 'agent_update_started') {
                return {
                  ...base,
                  status: 'updating',
                  targetVersion: data.targetVersion ?? base.targetVersion ?? null,
                  progress: typeof data.progress === 'number' ? data.progress : base.progress ?? 0,
                  error: null,
                  startedAt: data.timestamp ?? new Date().toISOString(),
                };
              }
              if (type === 'agent_update_failed') {
                return {
                  ...base,
                  status: 'failed',
                  error: data.error ?? i18n.t('nodeAgent.updateFailed', { ns: 'common' }),
                  progress: base.progress ?? 0,
                };
              }
              // progress
              return {
                ...base,
                status: data.status ?? base.status ?? 'updating',
                progress: typeof data.progress === 'number' ? data.progress : base.progress ?? 0,
                currentVersion: data.currentVersion ?? base.currentVersion,
                targetVersion: data.targetVersion ?? base.targetVersion,
                error: data.error ?? base.error ?? null,
              };
            });
          }
          invalidateOnce(q, { queryKey: qk.agentUpdateStatus(nodeId) });
          invalidateOnce(q, { queryKey: qk.agentStatus(nodeId) });
          invalidateOnce(q, { queryKey: qk.node(nodeId) });
          invalidateOnce(q, { queryKey: qk.nodeStats(nodeId) });
        }
      });
      },
      () => {},
    );

    return disconnect;
  }, [queryClient, isAdmin]);
}
