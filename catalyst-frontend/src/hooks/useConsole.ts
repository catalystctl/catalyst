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
  const { sendCommand, subscribe, unsubscribe, onMessage, isConnected } = useWebSocketStore();

  const logsQuery = useQuery({
    queryKey: ['server-logs', serverId, initialLines],
    queryFn: () =>
      serverId ? serversApi.logs(serverId, { lines: initialLines }) : Promise.reject(new Error('missing id')),
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

  const appendEntry = useCallback(
    (entry: Omit<ConsoleEntry, 'id'>) => {
      setEntries((prev) => {
        const next = [...prev, buildEntry(entry)];
        return next.length > maxEntries ? next.slice(-maxEntries) : next;
      });
    },
    [buildEntry, maxEntries],
  );

  useEffect(() => {
    nextId.current = 0;
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEntries((prev) => {
      if (!isConnected || !prev.length) return initialEntries.slice(-maxEntries);
      const merged = [...initialEntries, ...prev];
      return merged.length > maxEntries ? merged.slice(-maxEntries) : merged;
    });
  }, [logsQuery.data, buildEntry, maxEntries, serverId, isConnected]);

  useEffect(() => {
    if (!serverId || isConnected) return;
    const interval = setInterval(() => {
      logsQuery.refetch().catch(() => {
        // ignore polling errors
      });
    }, 2000);
    return () => clearInterval(interval);
  }, [serverId, isConnected, logsQuery]);

  useEffect(() => {
    if (!serverId) return;
    subscribe(serverId);
    const unsubscribeHandler = onMessage((message) => {
      if (message.type !== 'console_output' || message.serverId !== serverId) return;
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
