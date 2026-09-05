/**
 * SSE-based real-time console hook.
 *
 * Correctness contract:
 *   1. History (REST) and live (SSE) share one buffer; the buffer is monotonic —
 *      history fetches only ever append unseen rows, never replace the buffer,
 *      so a stale or late history response cannot wipe newer live lines.
 *   2. Identity is by stable DB id (backend `id` / SSE `logId`). Live lines
 *      that already carry their DB id are registered in the seen set on arrival,
 *      so a later history fetch containing the same row is skipped instead of
 *      duplicated. Content is never used for dedupe (identical lines repeat).
 *   3. SSE events are batched via rAF so high-rate output does not thrash React.
 *   4. Polling every 2s when the stream is fully down; reconcile every 10s even
 *      when connected to catch throttled or otherwise missed SSE lines.
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
/** Cap the seen-id set so a multi-day session cannot grow unbounded. */
const MAX_SEEN_IDS = 20000;
const POLL_DOWN_MS = 2000;
const RECONCILE_CONNECTED_MS = 10000;

const normalizeData = (data: string) => data.replace(/\r\n/g, '\n');

function hashStr(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

/** Stable entry id for a history row. Prefers the DB id; falls back to a hash. */
function historyEntryId(log: ServerLogEntry): string {
  const raw = log.id ?? log.logId;
  if (raw) return `hist:${raw}`;
  const ts = typeof log.timestamp === 'string' ? log.timestamp : String(log.timestamp ?? '');
  return `hist-fallback:${log.stream}\0${ts}\0${hashStr(normalizeData(log.data))}:${log.data.length}`;
}

function toHistoryEntry(log: ServerLogEntry): ConsoleEntry {
  return {
    id: historyEntryId(log),
    stream: log.stream,
    data: normalizeData(log.data),
    timestamp: typeof log.timestamp === 'string' ? log.timestamp : String(log.timestamp ?? ''),
  };
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
  /** Every history/live DB id already in the buffer (prevents dupes, never wipes). */
  const seenIdsRef = useRef<Set<string>>(new Set());
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

  const rememberIds = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    const seen = seenIdsRef.current;
    for (const id of ids) seen.add(id);
    if (seen.size > MAX_SEEN_IDS) {
      const overflow = seen.size - MAX_SEEN_IDS;
      const it = seen.values();
      for (let i = 0; i < overflow; i++) {
        const next = it.next();
        if (next.done) break;
        seen.delete(next.value);
      }
    }
  }, []);

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
      // Live rows that already carry their DB id must not be re-added when
      // history later returns the same row.
      if (entry.id.startsWith('hist:')) rememberIds([entry.id]);
      batchBuffer.current.push(entry);
      scheduleFlush();
    },
    [scheduleFlush, rememberIds],
  );

  const pushLiveOutput = useCallback(
    (stream: string, data: string, timestamp?: string, logId?: string) => {
      pushLive({
        id: logId ? `hist:${logId}` : `live-${nextId.current++}`,
        stream,
        data: normalizeData(data),
        timestamp,
      });
    },
    [pushLive],
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
    // Console must always hit the network on refetch: csync fetchQuery serves
    // cache when fresh, which made the 2s down-polling return the same stale
    // rows and hide the latest logs.
    staleTime: 0,
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
    seenIdsRef.current = new Set();
    if (flushTimerRef.current !== null) {
      cancelAnimationFrame(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    setEntries([]);
  }, [serverId]);

  // ── Apply history monotonically: append unseen rows, never replace ──
  useEffect(() => {
    if (!serverId || !Array.isArray(logsQuery.data)) return;

    const key = `${serverId}:${initialLines}`;
    const isInitialLoad = loadedKeyRef.current !== key || !historyAppliedRef.current;
    const history: ConsoleEntry[] = logsQuery.data.map((log: ServerLogEntry) => toHistoryEntry(log));

    if (flushTimerRef.current !== null) {
      cancelAnimationFrame(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    if (batchBuffer.current.length) {
      pendingLiveRef.current.push(...batchBuffer.current);
      batchBuffer.current = [];
    }

    if (isInitialLoad) {
      const historyIds = new Set(history.map((e) => e.id));
      rememberIds([...historyIds]);
      // Live lines that arrived while history was in flight: keep any row whose
      // stable id is not already in history (truly newer). Local-only rows
      // (live-*) are always kept. Never filter by content — identical log
      // lines repeat and content dedupe drops the latest output.
      const pending = pendingLiveRef.current;
      pendingLiveRef.current = [];
      const freshPending = pending.filter((e) => (e.id.startsWith('hist:') ? !historyIds.has(e.id) : true));
      rememberIds(freshPending.filter((e) => e.id.startsWith('hist:')).map((e) => e.id));
      setEntries(trim(history.concat(freshPending)));
      loadedKeyRef.current = key;
      historyAppliedRef.current = true;
      return;
    }

    // Subsequent fetches (down-polling, connected reconcile, manual retry):
    // append only rows never seen. No wipe, no content matching.
    const unseen = history.filter((e) => !seenIdsRef.current.has(e.id));
    // Drain any stragglers held before the gate opened.
    const pending = pendingLiveRef.current;
    pendingLiveRef.current = [];
    const freshPending = pending.filter((e) => (e.id.startsWith('hist:') ? !seenIdsRef.current.has(e.id) : true));
    const additions = unseen.concat(freshPending);
    if (additions.length === 0) return;
    rememberIds(additions.filter((e) => e.id.startsWith('hist:')).map((e) => e.id));
    setEntries((prev) => trim(prev.concat(additions)));
  }, [logsQuery.data, serverId, initialLines, trim, rememberIds]);

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
          pushLiveOutput(event.stream, event.data, event.timestamp, event.logId);
          break;
        }

        case 'error':
          console.warn('[SSE Console] Server error:', event.error);
          break;

        case 'eula_required': {
          pushLive({
            id: `live-${nextId.current++}`,
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
  }, [serverId, pushLive, pushLiveOutput, flushBuffer]);

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
    }, POLL_DOWN_MS);

    return () => clearInterval(interval);
  }, [serverId, streamStatus, refetchLogs]);

  // ── Connected reconcile: SSE can miss lines (throttle drops, leader gaps,
  // reconnect windows). History is the source of truth, merged append-only.
  useEffect(() => {
    if (!serverId) return;
    if (streamStatus !== 'connected') return;
    const interval = setInterval(() => {
      refetchLogs().catch(() => {});
    }, RECONCILE_CONNECTED_MS);
    return () => clearInterval(interval);
  }, [serverId, streamStatus, refetchLogs]);

  // ── Command sending ──
  const send = useCallback(
    async (command: string) => {
      if (!serverId) return;
      const trimmed = command.trim();
      if (!trimmed) return;

      pushLive({
        id: `live-${nextId.current++}`,
        stream: 'stdin',
        data: `> ${trimmed}\n`,
      });

      try {
        await consoleSseClient.sendCommand(serverId, trimmed);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to send command';
        pushLive({
          id: `live-${nextId.current++}`,
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
    batchBuffer.current = [];
    pendingLiveRef.current = [];
    // Keep historyApplied and seen ids so the next poll does not re-add the
    // rows the user just cleared (user clear is display-only, not a reload).
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
