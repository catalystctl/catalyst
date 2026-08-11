/**
 * Comprehensive admin SSE events hook.
 *
 * Listens for ALL admin entity events (users, servers, nodes, templates,
 * roles, alert rules, alert instances, API keys, locations, nests,
 * database hosts, and IP pools) via the admin SSE stream and
 * updates the appropriate Catalyst Sync caches in real-time.
 *
 * Only connects if the user has admin permissions (avoids 401 spam on /api/admin/events).
 */
import { useEffect, useMemo } from 'react';
import { useQueryClient, type Query } from '@/csync';
import { useAuthStore } from '../stores/authStore';
import { hasAnyAdminPermission } from '../components/auth/ProtectedRoute';
import { createAdminEventsStream, type AdminEventType } from '../services/api/admin-events';
import { qk } from '../lib/queryKeys';
import type { AdminUser, SystemError } from '../types/admin';
import type { Template } from '../types/template';

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
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => queueMicrotask(flush));
    } else {
      queueMicrotask(flush);
    }
  };
}

export function useSseAdminEvents() {
  const queryClient = useQueryClient();
  const permissions = useAuthStore((s) => s.user?.permissions);
  // Any admin-panel permission (node.*, user.*, template.*, …) — not only
  // admin.read / admin.write — should receive live invalidation events.
  const isAdmin = useMemo(
    () => hasAnyAdminPermission(permissions),
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
            q.invalidateQueries({ queryKey: qk.dashboardActivity() }),
            q.invalidateQueries({ queryKey: qk.dashboardResources() }),
          ]);
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
          Promise.all([
            q.invalidateQueries({ queryKey: qk.adminUsers() }),
            // Also invalidate profile query if the updated user is the current user
            q.invalidateQueries({ queryKey: qk.profile() }),
            q.invalidateQueries({ queryKey: qk.myPermissions() }),
            // Also invalidate dashboard activity since user changes are notable events
            q.invalidateQueries({ queryKey: qk.dashboardActivity() }),
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
            q.invalidateQueries({ queryKey: qk.dashboardActivity() }),
            q.invalidateQueries({ queryKey: qk.dashboardResources() }),
          ]);
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
          const nodeId = String(data.nodeId ?? '');
          Promise.all([
            q.invalidateQueries({ queryKey: qk.adminServers() }),
            q.invalidateQueries({ queryKey: qk.servers() }),
            ...(nodeId ? [q.invalidateQueries({ queryKey: qk.adminNodeAllocations(nodeId) })] : []),
            q.invalidateQueries({ queryKey: qk.dashboardStats() }),
            q.invalidateQueries({ queryKey: qk.adminStats() }),
            q.invalidateQueries({ queryKey: qk.dashboardActivity() }),
            q.invalidateQueries({ queryKey: qk.dashboardResources() }),
          ]);
        }

        if (type === 'server_deleted') {
          const serverId = String(data.serverId ?? '');
          const nodeId = String(data.nodeId ?? '');
          Promise.all([
            q.invalidateQueries({ queryKey: qk.adminServers() }),
            q.invalidateQueries({ queryKey: qk.servers() }),
            ...(nodeId ? [q.invalidateQueries({ queryKey: qk.adminNodeAllocations(nodeId) })] : []),
            q.invalidateQueries({ queryKey: qk.dashboardStats() }),
            q.invalidateQueries({ queryKey: qk.adminStats() }),
            q.invalidateQueries({ queryKey: qk.dashboardActivity() }),
            q.invalidateQueries({ queryKey: qk.dashboardResources() }),
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
            q.invalidateQueries({ queryKey: qk.servers() }),
            q.invalidateQueries({ queryKey: qk.adminServers() }),
            ...(nodeId ? [q.invalidateQueries({ queryKey: qk.adminNodeAllocations(nodeId) })] : []),
            q.invalidateQueries({ queryKey: qk.dashboardStats() }),
            q.invalidateQueries({ queryKey: qk.adminStats() }),
            q.invalidateQueries({ queryKey: qk.dashboardActivity() }),
            q.invalidateQueries({ queryKey: qk.dashboardResources() }),
          ]);
          // Also invalidate server detail, permissions and invites (access changes)
          if (serverId) {
            q.invalidateQueries({ queryKey: qk.server(serverId) });
            q.invalidateQueries({ queryKey: qk.serverPermissions(serverId) });
            q.invalidateQueries({ queryKey: qk.serverInvites(serverId) });
            q.invalidateQueries({ queryKey: qk.serverAllocations(serverId) });
          }
        }

        // ── Node Events ─────────────────────────────────────────────
        if (type === 'node_created' || type === 'node_deleted') {
          const nodeId = String(data.nodeId ?? '');
          Promise.all([
            q.invalidateQueries({ queryKey: qk.adminNodes() }),
            q.invalidateQueries({ queryKey: qk.nodes() }),
            q.invalidateQueries({ queryKey: qk.accessibleNodes() }),
            ...(nodeId ? [q.invalidateQueries({ queryKey: qk.adminNodeAllocations(nodeId) })] : []),
            q.invalidateQueries({ queryKey: qk.dashboardStats() }),
            q.invalidateQueries({ queryKey: qk.adminStats() }),
            q.invalidateQueries({ queryKey: qk.adminHealth() }),
            q.invalidateQueries({ queryKey: qk.dashboardActivity() }),
            q.invalidateQueries({ queryKey: qk.dashboardResources() }),
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
            q.invalidateQueries({ queryKey: qk.adminNodes() }),
            q.invalidateQueries({ queryKey: qk.nodes() }),
            q.invalidateQueries({ queryKey: qk.accessibleNodes() }),
            ...(nodeId ? [q.invalidateQueries({ queryKey: qk.adminNodeAllocations(nodeId) })] : []),
            q.invalidateQueries({ queryKey: qk.adminHealth() }),
            q.invalidateQueries({ queryKey: qk.locations() }),
            q.invalidateQueries({ queryKey: qk.clusterMetrics() }),
          ]);
          if (nodeId) {
            q.invalidateQueries({ queryKey: qk.node(nodeId) });
            q.invalidateQueries({ queryKey: qk.nodeStats(nodeId) });
            q.invalidateQueries({ queryKey: qk.nodeMetrics(nodeId) });
            q.invalidateQueries({ queryKey: qk.adminNodeAllocations(nodeId) });
            // Agent control panel status depends on node online + agentVersion
            q.invalidateQueries({ queryKey: qk.agentStatus(nodeId) });
            q.invalidateQueries({ queryKey: qk.agentUpdateStatus(nodeId) });
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
          q.invalidateQueries({ queryKey: qk.templates() });
        }

        if (type === 'template_updated') {
          const templateId = String(data.templateId ?? '');
          if (!templateId) return;
          Promise.all([
            q.invalidateQueries({ queryKey: qk.templates() }),
            q.invalidateQueries({ queryKey: qk.template(templateId) }),
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
          q.invalidateQueries({ queryKey: qk.template(templateId) });
          // Reconcile with server after optimistic removal
          q.invalidateQueries({ queryKey: qk.templates() });
        }

        // ── Role Events ─────────────────────────────────────────────
        if (type === 'role_created' || type === 'role_updated' || type === 'role_deleted') {
          q.invalidateQueries({ queryKey: qk.adminRoles() });
          // Role changes affect permissions — invalidate server-permissions and my-permissions
          if (type === 'role_updated') {
            Promise.all([
              q.invalidateQueries({
                predicate: (query: any) =>
                  Array.isArray(query.queryKey) &&
                  query.queryKey[0] === 'servers' &&
                  query.queryKey[2] === 'permissions',
              }),
              q.invalidateQueries({ queryKey: qk.myPermissions() }),
            ]);
          }
          if (type === 'role_deleted') {
            // Individual role detail queries don't exist yet;
            // invalidating the list is sufficient.
          }
        }

        // ── Alert Rule Events ───────────────────────────────────────
        if (type === 'alert_rule_created' || type === 'alert_rule_updated' || type === 'alert_rule_deleted') {
          q.invalidateQueries({ queryKey: qk.alertRules() });
        }

        // ── Alert Instance Events ───────────────────────────────────
        if (type === 'alert_created' || type === 'alert_resolved' || type === 'alert_deleted') {
          Promise.all([
            q.invalidateQueries({ queryKey: qk.alerts() }),
            q.invalidateQueries({ queryKey: qk.alertStats() }),
            q.invalidateQueries({ queryKey: qk.dashboardStats() }),
            q.invalidateQueries({ queryKey: qk.adminStats() }),
          ]);
        }

        // ── API Key Events ─────────────────────────────────────────
        if (type === 'api_key_created' || type === 'api_key_updated' || type === 'api_key_deleted') {
          Promise.all([
            q.invalidateQueries({ queryKey: qk.apiKeys() }),
            q.invalidateQueries({ queryKey: qk.profileApiKeys() }),
            q.invalidateQueries({
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
            q.invalidateQueries({ queryKey: qk.locations() }),
            q.invalidateQueries({ queryKey: qk.adminNodes() }),
            q.invalidateQueries({ queryKey: qk.nodes() }),
          ]);
        }

        // ── Nest Events ────────────────────────────────────────────
        if (type === 'nest_created' || type === 'nest_updated' || type === 'nest_deleted') {
          Promise.all([
            q.invalidateQueries({ queryKey: qk.nests() }),
            q.invalidateQueries({ queryKey: qk.templates() }),
          ]);
        }

        // ── Database Host Events ───────────────────────────────────
        if (type === 'database_host_created' || type === 'database_host_updated' || type === 'database_host_deleted') {
          Promise.all([
            q.invalidateQueries({ queryKey: qk.databaseHosts() }),
            q.invalidateQueries({ queryKey: qk.adminDatabaseHosts() }),
          ]);
        }

        // ── IP Pool Events ─────────────────────────────────────────
        if (type === 'ip_pool_created' || type === 'ip_pool_updated' || type === 'ip_pool_deleted') {
          const nodeId = String(data.nodeId ?? '');
          if (nodeId) {
            q.invalidateQueries({ queryKey: qk.adminIpPools(nodeId) });
          } else {
            // No nodeId in event — invalidate all IP pool queries via predicate
            q.invalidateQueries({
              predicate: (query: any) =>
                Array.isArray(query.queryKey) &&
                query.queryKey[0] === 'ip-pools',
            });
          }
          q.invalidateQueries({ queryKey: qk.adminNodes() });
          q.invalidateQueries({ queryKey: qk.nodes() });
        }

        // ── Settings Events ──────────────────────────────────────────
        if (type === 'security_settings_updated') {
          q.invalidateQueries({ queryKey: qk.adminSecuritySettings() });
        }
        if (type === 'smtp_settings_updated') {
          q.invalidateQueries({ queryKey: qk.adminSmtp() });
        }
        if (type === 'theme_settings_updated') {
          q.invalidateQueries({ queryKey: qk.adminThemeSettings() });
        }
        if (type === 'system_settings_updated') {
          Promise.all([
            q.invalidateQueries({ queryKey: qk.adminModManager() }),
            q.invalidateQueries({ queryKey: qk.adminSmtp() }),
            q.invalidateQueries({ queryKey: qk.adminSecuritySettings() }),
          ]);
        }
        if (type === 'oidc_settings_updated') {
          // OIDC config uses local state, invalidate any related queries
          q.invalidateQueries({ queryKey: qk.adminOidcConfig() });
        }
        if (type === 'plugin_updated') {
          Promise.all([
            q.invalidateQueries({ queryKey: qk.adminPlugins() }),
          ]);
        }
        if (type === 'audit_log_created') {
          Promise.all([
            q.invalidateQueries({ queryKey: qk.adminAuditLogs() }),
            q.invalidateQueries({ queryKey: qk.profileAuditLog() }),
          ]);
        }
        if (type === 'auth_lockout_created' || type === 'auth_lockout_cleared') {
          q.invalidateQueries({ queryKey: qk.adminAuthLockouts() });
        }

        // ── Task Events (M-11) ──────────────────────────────────────
        if (type === 'task_created' || type === 'task_updated' || type === 'task_deleted') {
          const serverId = String(data.serverId ?? '');
          if (serverId) {
            q.invalidateQueries({ queryKey: qk.tasks(serverId) });
          }
        }

        // ── Database Events (M-12) ─────────────────────────────────
        if (type === 'database_created' || type === 'database_deleted' || type === 'database_password_rotated') {
          const serverId = String(data.serverId ?? '');
          if (serverId) {
            q.invalidateQueries({ queryKey: qk.serverDatabases(serverId) });
          }
        }

        // ── Node Assignment Events (H-03) ──────────────────────────
        if (type === 'node_assigned' || type === 'node_unassigned' || type === 'wildcard_assigned' || type === 'wildcard_removed') {
          const nodeId = String(data.nodeId ?? '');
          const roleId = String(data.roleId ?? '');
          const userId = String(data.userId ?? '');
          if (nodeId) {
            q.invalidateQueries({ queryKey: qk.nodeAssignments(nodeId) });
          }
          if (roleId) {
            q.invalidateQueries({ queryKey: qk.roleNodes(roleId) });
          }
          if (userId) {
            q.invalidateQueries({ queryKey: qk.userNodes(userId) });
          }
          q.invalidateQueries({ queryKey: qk.nodes() });
        }

        // ── Mod Manager Events ───────────────────────────────────────
        if (type === 'mod_install_complete' || type === 'mod_uninstall_complete' || type === 'mod_update_complete') {
          const serverId = String(data.serverId ?? '');
          if (serverId) {
            q.invalidateQueries({ queryKey: qk.modManagerInstalled(serverId) });
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
          q.invalidateQueries({ queryKey: qk.adminSystemErrors() });
        }

        // ── Plugin Manager Events ────────────────────────────────────
        if (type === 'plugin_install_complete' || type === 'plugin_uninstall_complete' || type === 'plugin_update_complete') {
          const serverId = String(data.serverId ?? '');
          if (serverId) {
            q.invalidateQueries({ queryKey: qk.pluginManagerInstalled(serverId) });
          }
        }

        // ── Migration progress ───────────────────────────────────────
        if (type === 'migration_job_updated') {
          const jobId = String(data.jobId ?? '');
          q.invalidateQueries({ queryKey: qk.migrationJobs() });
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
            q.invalidateQueries({ queryKey: qk.migrationJob(jobId) });
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
            q.invalidateQueries({ queryKey: qk.migrationSteps(jobId) });
          } else if (jobId) {
            q.invalidateQueries({ queryKey: qk.migrationSteps(jobId) });
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
            q.invalidateQueries({ queryKey: qk.nodeStats(nodeId) });
            q.invalidateQueries({ queryKey: qk.nodeMetrics(nodeId) });
            q.invalidateQueries({ queryKey: qk.node(nodeId) });
            q.invalidateQueries({ queryKey: qk.agentStatus(nodeId) });
          }
          // Don't full-invalidate clusterMetrics — we patched it. Still refresh lists lightly.
          q.invalidateQueries({ queryKey: qk.dashboardResources() });
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
                  error: data.error ?? 'Update failed',
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
          q.invalidateQueries({ queryKey: qk.agentUpdateStatus(nodeId) });
          q.invalidateQueries({ queryKey: qk.agentStatus(nodeId) });
          q.invalidateQueries({ queryKey: qk.node(nodeId) });
          q.invalidateQueries({ queryKey: qk.nodeStats(nodeId) });
        }
      });
      },
      () => {},
    );

    return disconnect;
  }, [queryClient, isAdmin]);
}
