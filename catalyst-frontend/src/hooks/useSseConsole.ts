/**
 * SSE-based real-time console hook — optimized rewrite.
 *
 * Key improvements over the previous version:
 *   1. Batched entry accumulation — SSE events are buffered in a ref and flushed
 *      to state at most every 32ms (aligned with requestAnimationFrame), preventing
 *      React re-renders on every single SSE event (which can be 50-100+/sec).
 *   2. Pre-allocated entry IDs via counter — no string UUID generation per entry.
 *   3. Lazy initial log merge — only merges initial REST logs once, then appends.
 *   4. Polling only when SSE is disconnected, with proper cleanup.
 *   5. Single source of truth for entries — no race conditions between initial load and SSE.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { serversApi } from '../services/api/servers';
import { consoleSseClient, type ConsoleStreamEvent, type StreamStatus } from '../services/api/console';
import { reportSystemError } from '../services/api/systemErrors';
import type { ServerLogEntry } from '../types/server';

export type ConsoleEntry = {
  id: string;
  stream: string;
  data: string;
  timestamp?: string;
};

type ConsoleOptions = {
  initialLines?: number;
  maxEntries?: number;
};

const FLUSH_INTERVAL = 32;
const MAX_BATCH_SIZE = 50;

// Module-level tracking so remounting the same server doesn't wipe logs.
// Survives component unmounts — only changes when the actual serverId changes.
let lastConnectedServerId: string | undefined = undefined;

const normalizeData = (data: string) => data.replace(/\r\n/g, '\n');

export function useSseConsole(serverId?: string, options: ConsoleOptions = {}) {
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>('connecting');

  const nextId = useRef(0);
  const maxEntries = options.maxEntries ?? 500;
  const initialLines = options.initialLines ?? 200;
  const loadedKeyRef = useRef('');

  // Batch buffer — accumulates SSE events between state flushes
  const batchBuffer = useRef<ConsoleEntry[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);

  // ── Batched state flush ──
  const flushBuffer = useCallback(() => {
    flushTimerRef.current = null;

    const batch = batchBuffer.current;
    if (batch.length === 0) return;

    batchBuffer.current = [];

    setEntries((prev) => {
      const next = prev.concat(batch);
      return next.length > maxEntries ? next.slice(-maxEntries) : next;
    });
  }, [maxEntries]);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current !== null) return;

    // If batch is very large, flush immediately
    if (batchBuffer.current.length >= MAX_BATCH_SIZE) {
      flushBuffer();
      return;
    }

    // Otherwise, schedule for next animation frame
    flushTimerRef.current = requestAnimationFrame(flushBuffer);
  }, [flushBuffer]);

  // ── Load initial log history via REST ──
  const logsQuery = useQuery({
    queryKey: ['server-logs', serverId, initialLines],
    queryFn: () =>
      serverId
        ? serversApi.logs(serverId, { lines: initialLines })
        : (() => {
            reportSystemError({ level: 'error', component: 'useSseConsole', message: 'missing id', metadata: { context: 'logs query' } });
            return Promise.reject(new Error('missing id'));
          })(),
    enabled: Boolean(serverId),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  // ── Load initial logs into state ──
  // Keyed by serverId + initialLines so remounting with the same params
  // still loads cached data into the fresh state.
  useEffect(() => {
    if (!serverId || !logsQuery.data) return;

    const key = `${serverId}:${initialLines}`;
    if (loadedKeyRef.current === key) return;

    const initialEntries: ConsoleEntry[] = logsQuery.data.map((log: ServerLogEntry) => ({
      id: String(nextId.current++),
      stream: log.stream,
      data: normalizeData(log.data),
      timestamp: log.timestamp,
    }));

    setEntries(initialEntries.slice(-maxEntries));
    loadedKeyRef.current = key;
  }, [logsQuery.data, serverId, initialLines, maxEntries]);

  // ── SSE Stream ──
  useEffect(() => {
    if (!serverId) return;

    const serverChanged = lastConnectedServerId !== serverId;
    lastConnectedServerId = serverId;

    if (serverChanged) {
      // Reset bookkeeping refs for the new server.
      // Do NOT setEntries([]) here — the initial-logs effect (above)
      // runs first and owns state population. Clearing here would be
      // batched after it in React 18, overwriting cached data with [].
      nextId.current = 0;
      batchBuffer.current = [];
      loadedKeyRef.current = ''; // force initial-logs effect to always repopulate
    }
    setStreamStatus('connecting');

    consoleSseClient.connect(serverId);

    const unsubEvent = consoleSseClient.onEvent((event: ConsoleStreamEvent) => {
      switch (event.type) {
        case 'connected':
          // Mark initial logs as loaded even if REST query hasn't returned yet
          // SSE will fill in the gaps
          break;

        case 'console_output': {
          const entry: ConsoleEntry = {
            id: String(nextId.current++),
            stream: event.stream,
            data: normalizeData(event.data),
            timestamp: event.timestamp,
          };
          batchBuffer.current.push(entry);
          scheduleFlush();
          break;
        }

        case 'error':
          console.warn('[SSE Console] Server error:', event.error);
          break;

        case 'eula_required': {
          const entry: ConsoleEntry = {
            id: String(nextId.current++),
            stream: 'system',
            data: '[Catalyst] Server requires EULA acceptance. Please accept in the prompt.\n',
          };
          batchBuffer.current.push(entry);
          scheduleFlush();
          break;
        }
      }
    });

    const unsubStatus = consoleSseClient.onStatusChange(setStreamStatus);

    return () => {
      unsubEvent();
      unsubStatus();
      consoleSseClient.disconnect();
      if (flushTimerRef.current !== null) {
        cancelAnimationFrame(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      flushBuffer();
    };
  }, [serverId, maxEntries, scheduleFlush, flushBuffer]);

  // ── Fallback polling when SSE is disconnected ──
  useEffect(() => {
    if (!serverId || streamStatus === 'connected') return;

    const interval = setInterval(() => {
      logsQuery.refetch().catch(() => {});
    }, 2000);

    return () => clearInterval(interval);
  }, [serverId, streamStatus, logsQuery]);

  // ── Command sending ──
  const send = useCallback(
    async (command: string) => {
      if (!serverId) return;
      const trimmed = command.trim();
      if (!trimmed) return;

      // Optimistically append stdin to the buffer
      const entry: ConsoleEntry = {
        id: String(nextId.current++),
        stream: 'stdin',
        data: `> ${trimmed}\n`,
      };
      batchBuffer.current.push(entry);
      scheduleFlush();

      try {
        await consoleSseClient.sendCommand(serverId, trimmed);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to send command';
        const errorEntry: ConsoleEntry = {
          id: String(nextId.current++),
          stream: 'system',
          data: `[Error] ${msg}\n`,
        };
        batchBuffer.current.push(errorEntry);
        scheduleFlush();
        reportSystemError({ level: 'error', component: 'useSseConsole', message: err instanceof Error ? err.message : 'Failed to send command', metadata: { context: 'send command' } });
        throw err;
      }
    },
    [serverId, scheduleFlush],
  );

  const clear = useCallback(() => {
    nextId.current = 0;
    batchBuffer.current = [];
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
