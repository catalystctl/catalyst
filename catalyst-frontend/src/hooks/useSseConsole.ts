/**
 * SSE-based real-time console hook.
 *
 * Correctness contract:
 *   1. History (REST) and live (SSE) share one buffer; live is NEVER wiped by a
 *      late history response.
 *   2. On first history load we seed the buffer, then append any live lines that
 *      arrived while history was in flight (deduped by content fingerprint).
 *   3. SSE events are batched via rAF so high-rate output does not thrash React.
 *   4. Polling only when the stream is fully down (not connecting/reconnecting).
 *
 * Note: backend still lacks SSE `id:` / Last-Event-ID replay; until that lands,
 * history+live merge is the reconnect path.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@/csync';
import { qk } from '../lib/queryKeys';
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

const MAX_BATCH_SIZE = 50;

const normalizeData = (data: string) => data.replace(/\r\n/g, '\n');

/** Cheap fingerprint for history↔live dedupe (stream + normalized body). */
function entryKey(e: { stream: string; data: string }): string {
  return `${e.stream}\0${e.data}`;
}

export function useSseConsole(serverId?: string, options: ConsoleOptions = {}) {
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>('connecting');

  const nextId = useRef(0);
  const maxEntries = options.maxEntries ?? 2000;
  const initialLines = options.initialLines ?? 200;
  const loadedKeyRef = useRef('');
  /** True once REST history has been applied for the current server key. */
  const historyAppliedRef = useRef(false);
  /**
   * Live lines that arrived before history finished. Flushed/merged into the
   * buffer when history lands so a late setEntries(history) cannot clobber them.
   */
  const pendingLiveRef = useRef<ConsoleEntry[]>([]);

  const batchBuffer = useRef<ConsoleEntry[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);

  const trim = useCallback(
    (list: ConsoleEntry[]) => (list.length > maxEntries ? list.slice(-maxEntries) : list),
    [maxEntries],
  );

  const flushBuffer = useCallback(() => {
    flushTimerRef.current = null;
    const batch = batchBuffer.current;
    if (batch.length === 0) return;
    batchBuffer.current = [];

    if (!historyAppliedRef.current) {
      // Hold live output until history seeds the buffer. Cap so a hung/never-
      // applied history request cannot grow unbounded (busy servers → GBs).
      pendingLiveRef.current = trim(pendingLiveRef.current.concat(batch));
      return;
    }

    setEntries((prev) => trim(prev.concat(batch)));
  }, [trim]);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current !== null) return;
    if (batchBuffer.current.length >= MAX_BATCH_SIZE) {
      flushBuffer();
      return;
    }
    flushTimerRef.current = requestAnimationFrame(flushBuffer);
  }, [flushBuffer]);

  const pushLive = useCallback(
    (entry: ConsoleEntry) => {
      batchBuffer.current.push(entry);
      scheduleFlush();
    },
    [scheduleFlush],
  );

  // ── Load initial log history via REST ──
  const logsQuery = useQuery({
    queryKey: qk.serverLogs(serverId, initialLines),
    queryFn: () =>
      serverId
        ? serversApi.logs(serverId, { lines: initialLines })
        : (() => {
            reportSystemError({
              level: 'error',
              component: 'useSseConsole',
              message: 'missing id',
              metadata: { context: 'logs query' },
            });
            return Promise.reject(new Error('missing id'));
          })(),
    enabled: Boolean(serverId),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  // Reset buffer when the server identity changes. Declared BEFORE the history
  // effect so a cached history response in the same commit re-seeds after clear
  // (React 18 batches; last setEntries wins).
  useEffect(() => {
    nextId.current = 0;
    batchBuffer.current = [];
    pendingLiveRef.current = [];
    historyAppliedRef.current = false;
    loadedKeyRef.current = '';
    if (flushTimerRef.current !== null) {
      cancelAnimationFrame(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    setEntries([]);
  }, [serverId]);

  // ── Apply history without destroying live lines ──
  useEffect(() => {
    if (!serverId || !Array.isArray(logsQuery.data)) return;

    const key = `${serverId}:${initialLines}`;
    const isInitialLoad = loadedKeyRef.current !== key;
    const isPollRefresh =
      !isInitialLoad &&
      streamStatus !== 'connected' &&
      streamStatus !== 'connecting' &&
      streamStatus !== 'reconnecting';

    if (!isInitialLoad && !isPollRefresh) return;

    const history: ConsoleEntry[] = logsQuery.data.map((log: ServerLogEntry) => ({
      id: String(nextId.current++),
      stream: log.stream,
      data: normalizeData(log.data),
      timestamp: log.timestamp,
    }));

    // Drain any live lines that arrived while history was in flight, then
    // dedupe against the history tail so late setEntries(history) never wipes live.
    if (flushTimerRef.current !== null) {
      cancelAnimationFrame(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    if (batchBuffer.current.length) {
      pendingLiveRef.current.push(...batchBuffer.current);
      batchBuffer.current = [];
    }
    const pending = pendingLiveRef.current;
    pendingLiveRef.current = [];

    const historyKeys = new Set(history.map(entryKey));
    const liveOnly = pending.filter((e) => !historyKeys.has(entryKey(e)));

    setEntries(trim(history.concat(liveOnly)));
    loadedKeyRef.current = key;
    historyAppliedRef.current = true;
  }, [logsQuery.data, serverId, initialLines, streamStatus, trim]);

  // If history request fails, still open the live gate so SSE/commands aren't stuck.
  useEffect(() => {
    if (!serverId || !logsQuery.isError || historyAppliedRef.current) return;

    if (flushTimerRef.current !== null) {
      cancelAnimationFrame(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    if (batchBuffer.current.length) {
      pendingLiveRef.current.push(...batchBuffer.current);
      batchBuffer.current = [];
    }
    const pending = pendingLiveRef.current;
    pendingLiveRef.current = [];
    historyAppliedRef.current = true;
    loadedKeyRef.current = `${serverId}:${initialLines}`;
    if (pending.length) {
      setEntries((prev) => trim(prev.concat(pending)));
    }
  }, [serverId, initialLines, logsQuery.isError, trim]);

  // ── SSE Stream ──
  useEffect(() => {
    if (!serverId) return;

    consoleSseClient.connect(serverId);

    const unsubEvent = consoleSseClient.onEvent((event: ConsoleStreamEvent) => {
      switch (event.type) {
        case 'connected':
          break;

        case 'console_output': {
          pushLive({
            id: String(nextId.current++),
            stream: event.stream,
            data: normalizeData(event.data),
            timestamp: event.timestamp,
          });
          break;
        }

        case 'error':
          console.warn('[SSE Console] Server error:', event.error);
          break;

        case 'eula_required': {
          pushLive({
            id: String(nextId.current++),
            stream: 'system',
            data: '[Catalyst] Server requires EULA acceptance. Please accept in the prompt.\n',
          });
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
  }, [serverId, pushLive, flushBuffer]);

  // ── Fallback polling when SSE is fully down ──
  const refetchLogs = logsQuery.refetch;
  useEffect(() => {
    if (!serverId) return;
    if (
      streamStatus === 'connected' ||
      streamStatus === 'connecting' ||
      streamStatus === 'reconnecting'
    ) {
      return;
    }

    const interval = setInterval(() => {
      refetchLogs().catch(() => {});
    }, 2000);

    return () => clearInterval(interval);
  }, [serverId, streamStatus, refetchLogs]);

  // ── Command sending ──
  const send = useCallback(
    async (command: string) => {
      if (!serverId) return;
      const trimmed = command.trim();
      if (!trimmed) return;

      pushLive({
        id: String(nextId.current++),
        stream: 'stdin',
        data: `> ${trimmed}\n`,
      });

      try {
        await consoleSseClient.sendCommand(serverId, trimmed);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to send command';
        pushLive({
          id: String(nextId.current++),
          stream: 'system',
          data: `[Error] ${msg}\n`,
        });
        reportSystemError({
          level: 'error',
          component: 'useSseConsole',
          message: msg,
          metadata: { context: 'send command' },
        });
        throw err;
      }
    },
    [serverId, pushLive],
  );

  const clear = useCallback(() => {
    nextId.current = 0;
    batchBuffer.current = [];
    pendingLiveRef.current = [];
    // Keep historyApplied so subsequent live lines still append (user clear ≠ reload).
    setEntries([]);
  }, []);

  const refetch = useCallback(() => refetchLogs(), [refetchLogs]);

  return {
    entries,
    isConnected: streamStatus === 'connected',
    isConnecting: streamStatus === 'connecting' || streamStatus === 'reconnecting',
    streamStatus,
    isLoading: logsQuery.isLoading && entries.length === 0,
    isError: logsQuery.isError || streamStatus === 'error',
    refetch,
    clear,
    send,
  };
}
