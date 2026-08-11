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
import { qk } from '../lib/queryKeys';

const DEBOUNCE_MS = 16; // ~60fps

const TRANSITIONAL = new Set(['installing', 'starting', 'stopping', 'transferring', 'cloning']);
function transitionalStage(state: string): string | undefined {
  switch (state) {
    case 'installing':
      return 'Installing server';
    case 'transferring':
      return 'Transferring server';
    case 'cloning':
      return 'Cloning files';
    case 'starting':
      return 'Starting';
    case 'stopping':
      return 'Stopping';
    default:
      return TRANSITIONAL.has(state) ? state : undefined;
  }
}


export function useServerStateUpdates() {
  const queryClient = useQueryClient();
  const pendingUpdates = useRef<Map<string, { state: string; data: Record<string, unknown> }>>(new Map());
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
          return {
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
        },
      );
    }

    // Update all servers list caches (unfiltered + filtered query keys like ['servers', filters])
    // Skip detail keys where queryKey[1] is a server id string.
    q.setQueriesData(
      {
        predicate: (query: Query) => {
          if (!Array.isArray(query.queryKey) || query.queryKey[0] !== 'servers') return false;
          // ['servers'] — unfiltered list
          if (query.queryKey.length === 1) return true;
          // ['servers', null] legacy
          if (query.queryKey.length === 2 && query.queryKey[1] === null) return true;
          // ['servers', { status: 'running' }] — filtered lists
          if (query.queryKey.length >= 2 && typeof query.queryKey[1] === 'object' && query.queryKey[1] !== null) {
            return true;
          }
          return false;
        },
      },
      (prev: any) => {
        if (!Array.isArray(prev)) return prev;
        return prev.map((srv: any) => {
          const update = updates.get(srv.id) || updates.get(srv.uuid);
          return update ? { ...srv, status: update.state } : srv;
        });
      },
    );

    // Patch is source of truth — do NOT invalidate list/detail (avoids refetch storms).
    // Safety polls on transitional statuses still refresh if SSE is missed.

    isProcessing.current = false;
  }, [queryClient]);

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
        const serverId = String(data.serverId ?? '');
        if (!serverId) return;

        if (type === 'server_state_update' || type === 'server_state') {
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
          // Invalidate file queries when server starts/stops (new files may be generated)
          if (state === 'running' || state === 'stopped' || state === 'offline') {
            (queryClient as any).invalidateQueries({ queryKey: qk.files(serverId) });
          }
          // Activity log records power transitions
          (queryClient as any).invalidateQueries({ queryKey: qk.serverActivity(serverId) });
          return;
        }

        if (type === 'server_deleted') {
          // Remove the deleted server from all list caches
          const q = queryClient as any;
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
          q.invalidateQueries({ queryKey: qk.servers() });
          return;
        }

        // Server lifecycle events — invalidate list and detail caches
        if (type === 'server_created' || type === 'server_updated' || type === 'server_suspended' || type === 'server_unsuspended') {
          const q = queryClient as any;
          q.invalidateQueries({ queryKey: qk.servers() });
          if (serverId) {
            q.invalidateQueries({ queryKey: qk.server(serverId) });
            q.invalidateQueries({ queryKey: qk.serverAllocations(serverId) });
            q.invalidateQueries({ queryKey: qk.serverPermissions(serverId) });
            q.invalidateQueries({ queryKey: qk.serverActivity(serverId) });
          }
          return;
        }

        if (type === 'server_operation_progress') {
          const q = queryClient as any;
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
          (queryClient as any).invalidateQueries({ queryKey: qk.backups(serverId) });
        }

        if (type === 'server_files_changed') {
          const q = queryClient as any;
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
            q.invalidateQueries({ queryKey: qk.files(serverId, parent) });
            q.invalidateQueries({ queryKey: qk.files(serverId, normalized) });
            // Also invalidate root when change is nested (tree may show ancestors)
            if (parent !== '/') {
              q.invalidateQueries({ queryKey: qk.files(serverId, '/') });
            }
          } else {
            q.invalidateQueries({ queryKey: qk.files(serverId) });
          }
        }

        // Task execution events
        if (type === 'task_progress' || type === 'task_complete') {
          const serverId = String(data.serverId ?? '');
          if (serverId) {
            (queryClient as any).invalidateQueries({ queryKey: qk.tasks(serverId) });
          }
        }

        // Mod manager events - invalidate mod manager query cache
        if (type === 'mod_install_complete' || type === 'mod_uninstall_complete' || type === 'mod_update_complete') {
          const serverId = String(data.serverId ?? '');
          if (serverId) {
            (queryClient as any).invalidateQueries({ queryKey: qk.modManagerInstalled(serverId) });
          }
        }

        // Plugin manager events - invalidate plugin manager query cache
        if (type === 'plugin_install_complete' || type === 'plugin_uninstall_complete' || type === 'plugin_update_complete') {
          const serverId = String(data.serverId ?? '');
          if (serverId) {
            (queryClient as any).invalidateQueries({ queryKey: qk.pluginManagerInstalled(serverId) });
          }
        }

        // Alert events - invalidate alert queries
        if (type === 'alert') {
          (queryClient as any).invalidateQueries({ queryKey: qk.alerts() });
          (queryClient as any).invalidateQueries({ queryKey: qk.alertStats() });
        }

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
    };
  }, [queryClient, scheduleProcess]);
}
