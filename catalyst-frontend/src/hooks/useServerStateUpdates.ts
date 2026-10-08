/**
 * SSE-based real-time server state update hook.
 *
 * Connects to /api/servers/all-servers/events (global endpoint) and updates
 * Catalyst Sync caches when server state changes.
 *
 * Use this in AppLayout to handle state updates for all servers globally.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useQueryClient, type Query } from '@/csync';
import { createServerEventsStream, type ServerEventType } from '../services/api/server-events';
import { invalidateOnce, type InvalidateTarget } from '../lib/invalidateOnce';
import { setPendingEula } from './useEulaStore';
import { useAuthStore } from '../stores/authStore';
import { qk } from '../lib/queryKeys';
import i18n from '@/i18n';

const DEBOUNCE_MS = 16; // ~60fps

/**
 * Coalescing window for backend `resync` requests (same leading+trailing
 * pattern as useStreamRecovery): the first request re-syncs immediately,
 * further requests inside the window are replayed once when it closes.
 * Module-level so every hook instance shares one window.
 */
const RESYNC_DEBOUNCE_MS = 5_000;
let lastResyncAt = 0;
let resyncTrailingTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFullResync(client: InvalidateTarget) {
  const run = () => {
    lastResyncAt = Date.now();
    // Bare invalidate-all: no query identity to dedupe on, the window above
    // is the coalescing boundary (mirrors useStreamRecovery).
    void client.invalidateQueries({});
  };
  const elapsed = Date.now() - lastResyncAt;
  if (lastResyncAt === 0 || elapsed >= RESYNC_DEBOUNCE_MS) {
    run();
    return;
  }
  if (resyncTrailingTimer !== null) return;
  resyncTrailingTimer = setTimeout(() => {
    resyncTrailingTimer = null;
    if (Date.now() - lastResyncAt >= RESYNC_DEBOUNCE_MS) run();
  }, RESYNC_DEBOUNCE_MS - elapsed);
}

const TRANSITIONAL = new Set(['installing', 'starting', 'stopping', 'transferring', 'cloning']);
function transitionalStage(state: string): string | undefined {
  switch (state) {
    case 'installing':
      return i18n.t('operationStage.installing', { ns: 'common' });
    case 'transferring':
      return i18n.t('operationStage.transferring', { ns: 'common' });
    case 'cloning':
      return i18n.t('operationStage.cloning', { ns: 'common' });
    case 'starting':
      return i18n.t('status.starting', { ns: 'common' });
    case 'stopping':
      return i18n.t('status.stopping', { ns: 'common' });
    default:
      return TRANSITIONAL.has(state) ? state : undefined;
  }
}


const METRICS_FLUSH_MS = 400;

/** Any list-shaped servers cache: ['servers'], ['servers', null] or ['servers', filters]. */
function isServerListKey(queryKey: unknown): boolean {
  if (!Array.isArray(queryKey) || queryKey[0] !== 'servers') return false;
  if (queryKey.length === 1) return true;
  if (queryKey.length === 2 && queryKey[1] === null) return true;
  return queryKey.length >= 2 && typeof queryKey[1] === 'object' && queryKey[1] !== null;
}

/**
 * Resource-stats payload → the fields list rows render. The agent reports
 * `cpu`/`memory` aliases and may send memory as a percentage, so both are
 * accepted (mirrors useServerMetrics).
 */
function metricPatch(row: Record<string, any>, d: Record<string, any>): Record<string, any> {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const cpu = num(d.cpuPercent) ?? num(d.cpu);
  const memoryUsageMb = num(d.memoryUsageMb);
  const memoryPercent = num(d.memory);
  const diskUsageMb = num(d.diskUsageMb);
  const diskTotalMb = num(d.diskTotalMb);
  const diskIoMb = num(d.diskIoMb);
  const patch: Record<string, any> = {};
  if (cpu !== undefined) patch.cpuPercent = cpu;
  if (memoryUsageMb !== undefined) patch.memoryUsageMb = memoryUsageMb;
  if (memoryPercent !== undefined) patch.memoryPercent = memoryPercent;
  else if (memoryUsageMb !== undefined && num(row.allocatedMemoryMb)) {
    patch.memoryPercent = Math.min(100, (memoryUsageMb / Number(row.allocatedMemoryMb)) * 100);
  }
  if (diskUsageMb !== undefined) patch.diskUsageMb = diskUsageMb;
  if (diskTotalMb !== undefined) patch.diskTotalMb = diskTotalMb;
  if (diskIoMb !== undefined) patch.diskIoMb = diskIoMb;
  if (d.networkRxBytes !== undefined) patch.networkRxBytes = Number(d.networkRxBytes);
  if (d.networkTxBytes !== undefined) patch.networkTxBytes = Number(d.networkTxBytes);
  return patch;
}

export function useServerStateUpdates() {
  const queryClient = useQueryClient();
  const pendingUpdates = useRef<Map<string, { state: string; data: Record<string, unknown> }>>(new Map());
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Live telemetry from the global stream, coalesced: a 30-server fleet emits
  // a few hundred metric events a second and each flush re-renders the list.
  const pendingMetrics = useRef<Map<string, Record<string, unknown>>>(new Map());
  const metricsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isProcessing = useRef(false);

  const processUpdates = useCallback(() => {
    if (isProcessing.current || !pendingUpdates.current?.size) return;
    isProcessing.current = true;

    const q = queryClient as any;
    const updates = pendingUpdates.current;
    pendingUpdates.current = new Map();

    // Batch all updates into single queryClient operations
    for (const [serverId, update] of updates) {
      const matchesId = (srv: any) =>
        srv?.id === serverId || srv?.uuid === serverId;

      // Update single server query
      q.setQueriesData(
        { predicate: (query: Query) =>
          Array.isArray(query.queryKey) && query.queryKey[0] === 'servers' && query.queryKey.length >= 2 && typeof query.queryKey[1] === 'string' },
        (prev: any) => {
          if (!prev || typeof prev !== 'object') return prev;
          if (!matchesId(prev)) return prev;
          const stage =
            typeof update.data.stage === 'string'
              ? update.data.stage
              : typeof update.data.progressMessage === 'string'
                ? update.data.progressMessage
                : transitionalStage(update.state);
          const progressPct =
            typeof update.data.progress === 'number'
              ? update.data.progress
              : typeof update.data.percent === 'number'
                ? update.data.percent
                : undefined;
          const next = {
            ...prev,
            status: update.state,
            portBindings: update.data.portBindings ?? prev.portBindings,
            lastExitCode:
              typeof update.data.exitCode === 'number'
                ? update.data.exitCode
                : prev.lastExitCode,
            // Soft progress fields (agent may not send % yet; stage still helps UI)
            operationStage: stage ?? prev.operationStage,
            operationProgress:
              progressPct !== undefined ? progressPct : prev.operationProgress,
          };
          return next.status === prev.status &&
            next.portBindings === prev.portBindings &&
            next.lastExitCode === prev.lastExitCode &&
            next.operationStage === prev.operationStage &&
            next.operationProgress === prev.operationProgress
            ? prev
            : next;
        },
      );
    }

    // Update all servers list caches (unfiltered + filtered query keys like ['servers', filters]).
    // Skip detail keys where queryKey[1] is a server id string.
    // P1-9: ['admin-servers', …] list caches get the same status patch —
    // patching (not invalidating) keeps the admin table live without a
    // refetch storm on every fleet tick.
    q.setQueriesData(
      {
        predicate: (query: Query) => {
          if (!Array.isArray(query.queryKey)) return false;
          const head = query.queryKey[0];
          if (head !== 'servers' && head !== 'admin-servers') return false;
          // ['servers'] / ['admin-servers'] — unfiltered list
          if (query.queryKey.length === 1) return true;
          // ['servers', null] legacy
          if (query.queryKey.length === 2 && query.queryKey[1] === null) return true;
          // ['servers', { status: 'running' }] / ['admin-servers', params] — filtered lists
          if (query.queryKey.length >= 2 && typeof query.queryKey[1] === 'object' && query.queryKey[1] !== null) {
            return true;
          }
          return false;
        },
      },
      (prev: any) => {
        const patchRow = (srv: any) => {
          const update = updates.get(srv.id) || updates.get(srv.uuid);
            return update && srv.status !== update.state ? { ...srv, status: update.state } : srv;
        };
        if (Array.isArray(prev)) return prev.map(patchRow);
        // admin-servers caches { servers, pagination }
        if (prev && typeof prev === 'object' && Array.isArray(prev.servers)) {
          return { ...prev, servers: prev.servers.map(patchRow) };
        }
        return prev;
      },
    );

    // Patch is source of truth — do NOT invalidate list/detail (avoids refetch storms).
    // Safety polls on transitional statuses still refresh if SSE is missed.

    isProcessing.current = false;
  }, [queryClient]);

  const flushMetrics = useCallback(() => {
    metricsTimer.current = null;
    const pending = pendingMetrics.current;
    if (!pending.size) return;
    const updates = new Map(pending);
    pendingMetrics.current = new Map();
    const q = queryClient as any;

    // List rows (the fleet table) …
    q.setQueriesData(
      {
        predicate: (query: Query) =>
          Array.isArray(query.queryKey) &&
          query.queryKey[0] === 'servers' &&
          isServerListKey(query.queryKey),
      },
      (prev: any) => {
        if (!Array.isArray(prev)) return prev;
        let changed = false;
        const next = prev.map((row: any) => {
          const d = updates.get(row?.id) ?? updates.get(row?.uuid);
          if (!d) return row;
          changed = true;
          return { ...row, ...metricPatch(row, d) };
        });
        return changed ? next : prev;
      },
    );

    // … and the single-server cache.
    q.setQueriesData(
      {
        predicate: (query: Query) =>
          Array.isArray(query.queryKey) &&
          query.queryKey[0] === 'servers' &&
          query.queryKey.length >= 2 &&
          typeof query.queryKey[1] === 'string',
      },
      (prev: any) => {
        if (!prev || typeof prev !== 'object' || Array.isArray(prev)) return prev;
        const d = updates.get(prev.id) ?? updates.get(prev.uuid);
        if (!d) return prev;
        const patch = metricPatch(prev, d);
        return Object.keys(patch).some((key) => prev[key] !== patch[key])
          ? { ...prev, ...patch }
          : prev;
      },
    );
  }, [queryClient]);

  const scheduleMetrics = useCallback(() => {
    if (metricsTimer.current) return;
    metricsTimer.current = setTimeout(flushMetrics, METRICS_FLUSH_MS);
  }, [flushMetrics]);

  const scheduleProcess = useCallback(() => {
    if (debounceTimer.current) return;
    debounceTimer.current = setTimeout(() => {
      debounceTimer.current = null;
      processUpdates();
    }, DEBOUNCE_MS);
  }, [processUpdates]);

  useEffect(() => {
    const disconnect = createServerEventsStream(
      'all-servers',
      (type: ServerEventType, data: Record<string, unknown>) => {
        const q = queryClient as any;

        // ── Server-agnostic events (P0-B) ────────────────────────────
        // Handled BEFORE the serverId guard: these payloads are user- or
        // cache-scoped and carry no serverId, so the guard used to drop
        // every one of them (the `alert` branch below was unreachable).
        if (type === 'alert') {
          invalidateOnce(q, { queryKey: qk.alerts() });
          invalidateOnce(q, { queryKey: qk.alertStats() });
          return;
        }

        // F27: permission grant changed for the signed-in user — re-read
        // my-permissions and refresh the auth store (same calls the
        // user_updated self-branch in useSseAdminEvents makes).
        if (type === 'permissions_updated') {
          const userId = String(data.userId ?? '');
          const currentUser = useAuthStore.getState().user;
          if (userId && currentUser && currentUser.id === userId) {
            invalidateOnce(q, { queryKey: qk.myPermissions() });
            useAuthStore.getState().refresh().catch(() => {});
          }
          return;
        }

        // Backend-requested full cache resync (5s debounce, leading+trailing).
        if (type === 'resync') {
          scheduleFullResync(q);
          return;
        }

        const serverId = String(data.serverId ?? '');
        if (!serverId) return;

        // Live CPU/memory/disk for every visible server. Previously dropped, so
        // the fleet table only refreshed its readings on a full refetch.
        if (type === 'resource_stats') {
          pendingMetrics.current.set(serverId, data);
          scheduleMetrics();
          return;
        }

        // `server_state` (dead alias, pruned from both allowlists in P1.4)
        // is no longer matched — only `server_state_update` is emitted.
        if (type === 'server_state_update') {
          // Queue update instead of processing immediately
          if (!pendingUpdates.current) {
            pendingUpdates.current = new Map();
          }
          const state = String(data.state ?? '');
          pendingUpdates.current.set(serverId, {
            state,
            data,
          });
          scheduleProcess();
          // P1-16: a crash (or any reported exit code) changes detail-page
          // data the status patch cannot express (lastExitCode, crash count,
          // restart policy state) — reconcile the detail cache once.
          if (state === 'crashed' || data.exitCode != null) {
            invalidateOnce(queryClient as any, { queryKey: qk.server(serverId) });
          }
          // Invalidate file queries when server starts/stops (new files may be generated)
          if (state === 'running' || state === 'stopped' || state === 'offline') {
            invalidateOnce(queryClient as any, { queryKey: qk.files(serverId) });
          }
          // Activity log records power transitions
          invalidateOnce(queryClient as any, { queryKey: qk.serverActivity(serverId) });
          // F4: online/total counts on the dashboard (and the admin dashboard)
          // must move on every power transition — not only on the next 60s
          // poll. Only this branch invalidates them; `resource_stats` ticks
          // above must never do so (they fire per second per server).
          invalidateOnce(queryClient as any, { queryKey: qk.dashboardStats() });
          invalidateOnce(queryClient as any, { queryKey: qk.adminStats() });
          return;
        }

        if (type === 'server_deleted') {
          // Remove the deleted server from all list caches
          q.setQueriesData(
            { predicate: (query: Query) =>
              Array.isArray(query.queryKey) && query.queryKey[0] === 'servers' },
            (prev: any) => {
              if (!Array.isArray(prev)) return prev;
              return prev.filter((srv: any) => srv?.id !== serverId && srv?.uuid !== serverId);
            },
          );
          // Remove all detail queries for the deleted server
          q.removeQueries({ queryKey: qk.server(serverId) });
          q.removeQueries({ queryKey: qk.serverPermissions(serverId) });
          q.removeQueries({ queryKey: qk.serverInvites(serverId) });
          q.removeQueries({ queryKey: qk.serverAllocations(serverId) });
          q.removeQueries({ queryKey: qk.backups(serverId) });
          q.removeQueries({ queryKey: qk.tasks(serverId) });
          invalidateOnce(q, { queryKey: qk.servers() });
          return;
        }

        // Server lifecycle events — invalidate list and detail caches
        if (type === 'server_created' || type === 'server_updated' || type === 'server_suspended' || type === 'server_unsuspended') {
          invalidateOnce(q, { queryKey: qk.servers() });
          if (serverId) {
            invalidateOnce(q, { queryKey: qk.server(serverId) });
            invalidateOnce(q, { queryKey: qk.serverAllocations(serverId) });
            invalidateOnce(q, { queryKey: qk.serverPermissions(serverId) });
            invalidateOnce(q, { queryKey: qk.serverActivity(serverId) });
            if (type === 'server_updated') {
              // U4/U6: backend pushes server_updated globally but the handler
              // used to omit both keys — pending invites (10 min stale) and
              // startup variables (silent overwrite of a second actor's save).
              invalidateOnce(q, { queryKey: qk.serverInvites(serverId) });
              invalidateOnce(q, { queryKey: qk.serverVariables(serverId) });
            }
          }
          return;
        }

        // P1.9: a failed clone otherwise looks like "still cloning" forever.
        if (type === 'clone_failed') {
          invalidateOnce(q, { queryKey: qk.server(serverId) });
          invalidateOnce(q, { queryKey: qk.servers() });
          invalidateOnce(q, { queryKey: qk.adminServers() });
          return;
        }

        // P1.9: resize completion observed globally (the per-server listener
        // in UpdateServerModal only exists while that modal is mounted).
        if (type === 'storage_resize_complete') {
          invalidateOnce(q, { queryKey: qk.server(serverId) });
          invalidateOnce(q, { queryKey: qk.servers() });
          invalidateOnce(q, { queryKey: qk.dashboardResources() });
          invalidateOnce(q, { queryKey: qk.dashboardStats() });
          return;
        }

        // P1.9: store the one-shot prompt so useEulaPrompt (and any future
        // consumer) can show it regardless of which surface started the server.
        if (type === 'eula_required') {
          setPendingEula(serverId, {
            eulaText: data.eulaText,
            message: data.message,
          });
          return;
        }

        if (type === 'server_operation_progress') {
          const stage = typeof data.stage === 'string' ? data.stage : undefined;
          const progress =
            typeof data.progress === 'number'
              ? data.progress
              : typeof data.percent === 'number'
                ? data.percent
                : undefined;
          const state = typeof data.state === 'string' ? data.state : undefined;
          q.setQueriesData(
            {
              predicate: (query: Query) =>
                Array.isArray(query.queryKey) &&
                query.queryKey[0] === 'servers' &&
                query.queryKey.length >= 2 &&
                typeof query.queryKey[1] === 'string' &&
                (query.queryKey[1] === serverId ||
                  (query.state.data as any)?.id === serverId ||
                  (query.state.data as any)?.uuid === serverId),
            },
            (prev: any) => {
              if (!prev || typeof prev !== 'object' || Array.isArray(prev)) return prev;
              if (prev.id !== serverId && prev.uuid !== serverId) return prev;
              return {
                ...prev,
                ...(state ? { status: state } : {}),
                operationStage: stage ?? prev.operationStage,
                operationProgress:
                  progress !== undefined ? progress : prev.operationProgress,
              };
            },
          );
          // Also patch list rows
          q.setQueriesData(
            {
              predicate: (query: Query) => {
                if (!Array.isArray(query.queryKey) || query.queryKey[0] !== 'servers') return false;
                if (query.queryKey.length === 1) return true;
                if (query.queryKey.length >= 2 && typeof query.queryKey[1] === 'object') return true;
                return false;
              },
            },
            (prev: any) => {
              if (!Array.isArray(prev)) return prev;
              return prev.map((srv: any) =>
                srv?.id === serverId || srv?.uuid === serverId
                  ? {
                      ...srv,
                      ...(state ? { status: state } : {}),
                      operationStage: stage ?? srv.operationStage,
                      operationProgress:
                        progress !== undefined ? progress : srv.operationProgress,
                    }
                  : srv,
              );
            },
          );
          return;
        }

                if (
          type === 'backup_started' ||
          type === 'backup_restore_started' ||
          type === 'backup_delete_started' ||
          type === 'backup_complete' ||
          type === 'backup_restore_complete' ||
          type === 'backup_delete_complete'
        ) {
          invalidateOnce(queryClient as any, { queryKey: qk.backups(serverId) });
        }

        if (type === 'server_files_changed') {
          const changedPath = typeof data.path === 'string' ? data.path
            : typeof data.from === 'string' ? data.from
            : typeof data.to === 'string' ? data.to
            : undefined;
          if (changedPath) {
            // Invalidate the parent directory listing (and exact path if cached)
            const normalized = changedPath.replace(/\\/g, '/');
            const parent = normalized.includes('/')
              ? normalized.replace(/\/[^/]*$/, '') || '/'
              : '/';
            invalidateOnce(q, { queryKey: qk.files(serverId, parent) });
            invalidateOnce(q, { queryKey: qk.files(serverId, normalized) });
            // Also invalidate root when change is nested (tree may show ancestors)
            if (parent !== '/') {
              invalidateOnce(q, { queryKey: qk.files(serverId, '/') });
            }
          } else {
            invalidateOnce(q, { queryKey: qk.files(serverId) });
          }
        }

        // Task execution events
        if (type === 'task_progress' || type === 'task_complete') {
          const serverId = String(data.serverId ?? '');
          if (serverId) {
            invalidateOnce(queryClient as any, { queryKey: qk.tasks(serverId) });
          }
        }

        // P0-A: task CRUD changes the list even without an execution event.
        if (type === 'task_created' || type === 'task_updated' || type === 'task_deleted') {
          invalidateOnce(queryClient as any, { queryKey: qk.tasks(serverId) });
          return;
        }

        // P1-8: database CRUD invalidates the server's database list.
        if (
          type === 'database_created' ||
          type === 'database_deleted' ||
          type === 'database_password_rotated'
        ) {
          invalidateOnce(queryClient as any, { queryKey: qk.serverDatabases(serverId) });
          return;
        }

        // F16: backup list/detail changes outside the start/complete lifecycle.
        if (type === 'backup_updated' || type === 'backup_deleted') {
          invalidateOnce(queryClient as any, { queryKey: qk.backups(serverId) });
          return;
        }

        // Mod manager events - invalidate mod manager query cache
        if (type === 'mod_install_complete' || type === 'mod_uninstall_complete' || type === 'mod_update_complete') {
          const serverId = String(data.serverId ?? '');
          if (serverId) {
            invalidateOnce(queryClient as any, { queryKey: qk.modManagerInstalled(serverId) });
          }
        }

        // Plugin manager events - invalidate plugin manager query cache
        if (type === 'plugin_install_complete' || type === 'plugin_uninstall_complete' || type === 'plugin_update_complete') {
          const serverId = String(data.serverId ?? '');
          if (serverId) {
            invalidateOnce(queryClient as any, { queryKey: qk.pluginManagerInstalled(serverId) });
          }
        }

        // Alert events are server-agnostic — handled above, before the
        // serverId guard (P0-B).

        // Resource stats stream frequently — live gauges use useServerMetrics (dedicated SSE).
        // Do NOT invalidate historical metrics charts on every tick (refetch storm).
        // Charts refresh on their own slower interval.
      },
      () => {},
    );

    return () => {
      disconnect();
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
      if (metricsTimer.current) {
        clearTimeout(metricsTimer.current);
      }
    };
  }, [queryClient, scheduleProcess, scheduleMetrics]);
}
