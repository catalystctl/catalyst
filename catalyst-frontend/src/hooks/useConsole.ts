import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { serversApi } from '../services/api/servers';
import { useWebSocketStore } from '../stores/websocketStore';
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

export function useConsole(serverId?: string, options: ConsoleOptions = {}) {
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  const nextId = useRef(0);
  const maxEntries = options.maxEntries ?? 500;
  const initialLines = options.initialLines ?? 200;
  const { sendCommand, subscribe, unsubscribe, onMessage, isConnected } =
    useWebSocketStore();

  // ── Batching buffer ──
  // Incoming WebSocket messages are collected into this buffer and flushed
  // together via requestAnimationFrame. This collapses rapid-fire messages
  // (e.g. log spam) into a single state update per frame, preventing the
  // main thread from being overwhelmed by per-message re-renders.
  const pendingBuffer = useRef<ConsoleEntry[]>([]);
  const rafId = useRef<number>(0);
  const isFlushing = useRef(false);

  const flushBuffer = useCallback(() => {
    isFlushing.current = false;
    const batch = pendingBuffer.current;
    if (batch.length === 0) return;
    pendingBuffer.current = [];

    setEntries((prev) => {
      const next = prev.length + batch.length > maxEntries
        ? prev.concat(batch).slice(-maxEntries)
        : prev.concat(batch);
      return next;
    });
  }, [maxEntries]);

  const scheduleFlush = useCallback(() => {
    if (isFlushing.current) return;
    isFlushing.current = true;
    // Use rAF so multiple messages within the same frame are batched.
    // Falls back to setTimeout(0) if rAF is not available.
    if (typeof requestAnimationFrame !== 'undefined') {
      rafId.current = requestAnimationFrame(flushBuffer);
    } else {
      rafId.current = window.setTimeout(flushBuffer, 0) as unknown as number;
    }
  }, [flushBuffer]);

  // Clean up pending rAF on unmount
  useEffect(() => {
    return () => {
      if (rafId.current) {
        cancelAnimationFrame(rafId.current);
        clearTimeout(rafId.current);
      }
    };
  }, []);

  const logsQuery = useQuery({
    queryKey: ['server-logs', serverId, initialLines],
    queryFn: () =>
      serverId
        ? serversApi.logs(serverId, { lines: initialLines })
        : Promise.reject(new Error('missing id')),
    enabled: Boolean(serverId),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: 30000,
  });

  const buildEntry = useCallback(
    (entry: Omit<ConsoleEntry, 'id'>): ConsoleEntry => ({
      id: String(nextId.current++),
      stream: entry.stream,
      data: normalizeData(entry.data),
      timestamp: entry.timestamp,
    }),
    [],
  );

  // Append to batch buffer instead of calling setEntries directly.
  // This avoids triggering a React re-render for every single message.
  const appendEntry = useCallback(
    (entry: Omit<ConsoleEntry, 'id'>) => {
      pendingBuffer.current.push(buildEntry(entry));
      scheduleFlush();
    },
    [buildEntry, scheduleFlush],
  );

  useEffect(() => {
    nextId.current = 0;
    pendingBuffer.current = [];
    setEntries([]);
  }, [serverId]);

  useEffect(() => {
    if (!serverId || !logsQuery.data) return;
    const initialEntries = logsQuery.data.map((log: ServerLogEntry) =>
      buildEntry({
        stream: log.stream,
        data: log.data,
        timestamp: log.timestamp,
      }),
    );
    setEntries((prev) => {
      if (!isConnected || !prev.length)
        return initialEntries.slice(-maxEntries);
      const merged = initialEntries.concat(prev);
      return merged.length > maxEntries ? merged.slice(-maxEntries) : merged;
    });
  }, [logsQuery.data, buildEntry, maxEntries, serverId, isConnected]);

  useEffect(() => {
    if (!serverId || isConnected) return;
    const interval = setInterval(() => {
      logsQuery.refetch().catch(() => {});
    }, 2000);
    return () => clearInterval(interval);
  }, [serverId, isConnected, logsQuery]);

  useEffect(() => {
    if (!serverId) return;
    subscribe(serverId);
    const unsubscribeHandler = onMessage((message) => {
      if (message.type === 'error') {
        if (message.serverId && message.serverId !== serverId) return;
        appendEntry({
          stream: 'system',
          data: `[Catalyst] ${message.error}\n`,
          timestamp: new Date().toISOString(),
        });
        return;
      }
      if (message.type !== 'console_output' || message.serverId !== serverId)
        return;
      appendEntry({
        stream: message.stream ?? 'stdout',
        data: message.data ?? '',
        timestamp: new Date().toISOString(),
      });
    });
    return () => {
      unsubscribeHandler();
      unsubscribe(serverId);
    };
  }, [serverId, subscribe, unsubscribe, onMessage, appendEntry]);

  const clear = () => {
    nextId.current = 0;
    pendingBuffer.current = [];
    setEntries([]);
  };

  const send = (command: string) => {
    if (!serverId) return;
    const trimmed = command.trim();
    if (!trimmed) return;
    const payload = trimmed.endsWith('\n') ? trimmed : `${trimmed}\n`;
    sendCommand(serverId, payload);
    appendEntry({
      stream: 'stdin',
      data: `> ${trimmed}\n`,
      timestamp: new Date().toISOString(),
    });
  };

  return {
    entries,
    isConnected,
    isLoading: logsQuery.isLoading,
    isError: logsQuery.isError,
    refetch: logsQuery.refetch,
    clear,
    send,
  };
}
