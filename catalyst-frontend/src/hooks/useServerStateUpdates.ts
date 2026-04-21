/**
 * SSE-based real-time server state update hook.
 *
 * Connects to /api/servers/all-servers/events (global endpoint) and updates
 * TanStack Query caches when server state changes.
 *
 * Use this in AppLayout to handle state updates for all servers globally.
 */
import { useEffect, useRef } from 'react';
import { useQueryClient, type Query } from '@tanstack/react-query';
import { createServerEventsStream, type ServerEventType } from '../services/api/server-events';

const DEBOUNCE_MS = 16; // ~60fps

export function useServerStateUpdates() {
  const queryClient = useQueryClient();
  const pendingUpdates = useRef<Map<string, { state: string; data: Record<string, unknown> }>>();
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isProcessing = useRef(false);

  const processUpdates = () => {
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
          Array.isArray(query.queryKey) && query.queryKey[0] === 'server' },
        (prev: any) => {
          if (!prev || typeof prev !== 'object') return prev;
          if (!matchesId(prev)) return prev;
          return {
            ...prev,
            status: update.state,
            portBindings: update.data.portBindings ?? prev.portBindings,
            lastExitCode:
              typeof update.data.exitCode === 'number'
                ? update.data.exitCode
                : prev.lastExitCode,
          };
        },
      );
    }

    // Update servers list once for all changes
    q.setQueriesData(
      { predicate: (query: Query) =>
        Array.isArray(query.queryKey) && query.queryKey[0] === 'servers' },
      (prev: any) => {
        if (!Array.isArray(prev)) return prev;
        return prev.map((srv: any) => {
          const update = updates.get(srv.id) || updates.get(srv.uuid);
          return update ? { ...srv, status: update.state } : srv;
        });
      },
    );

    // Invalidate queries in single batch
    q.invalidateQueries({
      predicate: (query: any) =>
        Array.isArray(query.queryKey) &&
        query.queryKey[0] === 'server' &&
        query.state?.data,
    });

    isProcessing.current = false;
  };

  const scheduleProcess = () => {
    if (debounceTimer.current) return;
    debounceTimer.current = setTimeout(() => {
      debounceTimer.current = null;
      processUpdates();
    }, DEBOUNCE_MS);
  };

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
            (queryClient as any).invalidateQueries({
              predicate: (query: any) =>
                Array.isArray(query.queryKey) &&
                query.queryKey[0] === 'files' &&
                query.queryKey[1] === serverId,
            });
          }
          return;
        }

        if (
          type === 'backup_complete' ||
          type === 'backup_restore_complete' ||
          type === 'backup_delete_complete'
        ) {
          (queryClient as any).invalidateQueries({
            predicate: (query: any) =>
              Array.isArray(query.queryKey) &&
              query.queryKey[0] === 'backups' &&
              query.queryKey[1] === serverId,
          });
        }

        // Task execution events
        if (type === 'task_progress' || type === 'task_complete') {
          const serverId = String(data.serverId ?? '');
          if (serverId) {
            (queryClient as any).invalidateQueries({
              predicate: (query: any) =>
                Array.isArray(query.queryKey) &&
                query.queryKey[0] === 'tasks' &&
                query.queryKey[1] === serverId,
            });
          }
        }

        // Mod manager events - invalidate mod manager query cache
        if (type === 'mod_install_complete' || type === 'mod_uninstall_complete' || type === 'mod_update_complete') {
          const serverId = String(data.serverId ?? '');
          if (serverId) {
            (queryClient as any).invalidateQueries({
              predicate: (query: any) =>
                Array.isArray(query.queryKey) &&
                query.queryKey[0] === 'mod-manager-installed' &&
                query.queryKey[1] === serverId,
            });
          }
        }

        // Plugin manager events - invalidate plugin manager query cache
        if (type === 'plugin_install_complete' || type === 'plugin_uninstall_complete' || type === 'plugin_update_complete') {
          const serverId = String(data.serverId ?? '');
          if (serverId) {
            (queryClient as any).invalidateQueries({
              predicate: (query: any) =>
                Array.isArray(query.queryKey) &&
                query.queryKey[0] === 'plugin-manager-installed' &&
                query.queryKey[1] === serverId,
            });
          }
        }
      },
      () => {},
    );

    return () => {
      disconnect();
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, [queryClient]);
}
