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
    q.invalidateQueries({ queryKey: ['server'] });

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
            (queryClient as any).invalidateQueries({ queryKey: ['files', serverId] });
          }
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
          q.removeQueries({ queryKey: ['server', serverId] });
          q.invalidateQueries({ queryKey: ['servers'] });
          return;
        }

        // Server lifecycle events — invalidate list and detail caches
        if (type === 'server_created' || type === 'server_updated' || type === 'server_suspended' || type === 'server_unsuspended') {
          const q = queryClient as any;
          Promise.all([
            q.invalidateQueries({ queryKey: ['servers'] }),
            q.invalidateQueries({ queryKey: ['server'] }),
          ]);
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
          (queryClient as any).invalidateQueries({ queryKey: ['backups', serverId] });
        }

        if (type === 'server_files_changed') {
          (queryClient as any).invalidateQueries({ queryKey: ['files', serverId] });
        }

        // Task execution events
        if (type === 'task_progress' || type === 'task_complete') {
          const serverId = String(data.serverId ?? '');
          if (serverId) {
            (queryClient as any).invalidateQueries({ queryKey: ['tasks', serverId] });
          }
        }

        // Mod manager events - invalidate mod manager query cache
        if (type === 'mod_install_complete' || type === 'mod_uninstall_complete' || type === 'mod_update_complete') {
          const serverId = String(data.serverId ?? '');
          if (serverId) {
            (queryClient as any).invalidateQueries({ queryKey: ['mod-manager-installed', serverId] });
          }
        }

        // Plugin manager events - invalidate plugin manager query cache
        if (type === 'plugin_install_complete' || type === 'plugin_uninstall_complete' || type === 'plugin_update_complete') {
          const serverId = String(data.serverId ?? '');
          if (serverId) {
            (queryClient as any).invalidateQueries({ queryKey: ['plugin-manager-installed', serverId] });
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
