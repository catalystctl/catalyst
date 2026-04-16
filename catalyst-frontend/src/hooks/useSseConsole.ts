/**
 * SSE-based real-time console hook.
 *
 * Uses Server-Sent Events (EventSource) for real-time output and
 * HTTP POST for command submission. This replaces the WebSocket-based
 * console for better reliability and automatic reconnection.
 *
 * Key benefits over WebSocket:
 *   - Browser auto-reconnects after network drops (mobile/sleep/wake)
 *   - No custom reconnection logic needed
 *   - HTTP-native, works through all proxies
 *   - Commands are HTTP POST (easier rate limiting, debugging)
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { serversApi } from '../services/api/servers';
import { consoleSseClient, type ConsoleStreamEvent, type StreamStatus } from '../services/api/console';
import type { ServerLogEntry } from '../types/server';

type ConsoleEntry = {
  id: string;
  stream: string;
  data: string;
  timestamp?: string;
};

type ConsoleOptions = {
  initialLines?: number;
  maxEntries?: number;
};

const normalizeData = (data: string) => data.replace(/\r\n/g, '\n');

export function useSseConsole(serverId?: string, options: ConsoleOptions = {}) {
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>('connecting');
  const nextId = useRef(0);
  const maxEntries = options.maxEntries ?? 500;
  const initialLines = options.initialLines ?? 200;

  // ── Load initial log history via REST ──────────────────────────────────
  // This ensures we show historical output even if SSE hasn't connected yet
  const logsQuery = useQuery({
    queryKey: ['server-logs', serverId, initialLines],
    queryFn: () =>
      serverId
        ? serversApi.logs(serverId, { lines: initialLines })
        : Promise.reject(new Error('missing id')),
    enabled: Boolean(serverId),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  // ── SSE Stream ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!serverId) return;

    nextId.current = 0;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional: reset state on server change
    setEntries([]);
    setStreamStatus('connecting');
    consoleSseClient.connect(serverId);

    // Subscribe to SSE events
    const unsubEvent = consoleSseClient.onEvent((event: ConsoleStreamEvent) => {
      switch (event.type) {
        case 'connected':
          // SSE stream is established — merge with any already-loaded initial logs
          setEntries((prev) => {
            if (prev.length > 0) return prev; // Already have data (from initial load)
            return prev;
          });
          break;

        case 'console_output':
          setEntries((prev) => {
            const entry: ConsoleEntry = {
              id: String(nextId.current++),
              stream: event.stream,
              data: normalizeData(event.data),
              timestamp: event.timestamp,
            };
            const next = prev.concat(entry);
            return next.length > maxEntries ? next.slice(-maxEntries) : next;
          });
          break;

        case 'error':
          // Don't spam errors — just log to console for debugging
          console.warn('[SSE Console] Server error:', event.error);
          break;

        case 'eula_required':
          // Forward EULA events up for the page to handle
          setEntries((prev) => {
            const entry: ConsoleEntry = {
              id: String(nextId.current++),
              stream: 'system',
              data: `[Catalyst] Server requires EULA acceptance. Please accept in the prompt.\n`,
            };
            return prev.concat(entry);
          });
          break;
      }
    });

    // Subscribe to connection status
    const unsubStatus = consoleSseClient.onStatusChange(setStreamStatus);

    return () => {
      unsubEvent();
      unsubStatus();
    };
  }, [serverId, maxEntries]);

  // ── Load initial logs into state ───────────────────────────────────────
  useEffect(() => {
    if (!serverId || !logsQuery.data) return;

    const initialEntries: ConsoleEntry[] = logsQuery.data.map(
      (log: ServerLogEntry) => ({
        id: String(nextId.current++),
        stream: log.stream,
        data: normalizeData(log.data),
        timestamp: log.timestamp,
      }),
    );

    setEntries((prev) => {
      // If we already have SSE data, prepend the delta since last known timestamp
      // Otherwise, show all initial logs
      if (prev.length > 0 && initialEntries.length > 0) {
        // Keep SSE data, drop duplicate initial entries that are already in prev
        const sseIds = new Set(prev.map((e) => e.id));
        const unseenInitial = initialEntries.filter(
          (e, i) => i >= initialEntries.length - 50 && !sseIds.has(e.id),
        );
        return unseenInitial.length > 0 ? [...unseenInitial, ...prev] : prev;
      }
      // No SSE data yet — show initial logs
      return initialEntries.slice(-maxEntries);
    });
  }, [logsQuery.data, serverId, maxEntries]);

  // Fallback polling when SSE isn't connected
  useEffect(() => {
    if (!serverId || streamStatus === 'connected') return;
    const interval = setInterval(() => {
      logsQuery.refetch().catch(() => {});
    }, 2000);
    return () => clearInterval(interval);
  }, [serverId, streamStatus, logsQuery]);

  // ── Command sending ─────────────────────────────────────────────────────
  const send = useCallback(
    async (command: string) => {
      if (!serverId) return;
      const trimmed = command.trim();
      if (!trimmed) return;

      // Optimistically append stdin to the console
      setEntries((prev) => {
        const entry: ConsoleEntry = {
          id: String(nextId.current++),
          stream: 'stdin',
          data: `> ${trimmed}\n`,
        };
        return prev.concat(entry);
      });

      // Send via HTTP POST
      try {
        await consoleSseClient.sendCommand(serverId, trimmed);
      } catch (err: unknown) {
        // On error, append error to console and re-throw for UI feedback
        const msg = err instanceof Error ? err.message : 'Failed to send command';
        setEntries((prev) => {
          const entry: ConsoleEntry = {
            id: String(nextId.current++),
            stream: 'system',
            data: `[Error] ${msg}\n`,
          };
          return prev.concat(entry);
        });
        throw err;
      }
    },
    [serverId],
  );

  const clear = useCallback(() => {
    nextId.current = 0;
    setEntries([]);
  }, []);

  const refetch = useCallback(() => logsQuery.refetch(), [logsQuery]);

  return {
    entries,
    isConnected: streamStatus === 'connected',
    isConnecting: streamStatus === 'connecting' || streamStatus === 'reconnecting',
    streamStatus,
    isLoading: logsQuery.isLoading,
    isError: logsQuery.isError || streamStatus === 'error',
    refetch,
    clear,
    send,
  };
}
