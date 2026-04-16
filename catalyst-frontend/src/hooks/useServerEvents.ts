/**
 * SSE-based live server event log hook.
 *
 * Loads the last 20 events via REST API on mount.
 * Subscribes to /api/servers/:serverId/events for live updates:
 *   - console_output — server console output lines
 *   - server_log — structured server log lines
 *   - server_state_update / server_state — status change notifications
 *
 * Displays up to 8 most recent entries.
 */
import { useEffect, useMemo, useState } from 'react';
import { serversApi } from '../services/api/servers';
import { createServerEventsStream, type ServerEventType } from '../services/api/server-events';
import type { ServerLogEntry } from '../types/server';

type ServerEvent = {
  id: string;
  message: string;
  timestamp: string;
  stream?: string;
};

const MAX_EVENTS = 8;

const toIsoString = (timestamp?: number | string) => {
  if (!timestamp) return new Date().toISOString();
  if (typeof timestamp === 'number') return new Date(timestamp).toISOString();
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
};

const logToEvent = (log: ServerLogEntry, index: number): ServerEvent => ({
  id: `${log.timestamp}-${index}`,
  message: log.data,
  timestamp: log.timestamp,
  stream: log.stream,
});

export function useServerEvents(serverId?: string) {
  const [events, setEvents] = useState<ServerEvent[]>([]);
  const serverKey = useMemo(() => serverId ?? '', [serverId]);

  useEffect(() => {
    if (!serverKey) return;
    let isActive = true;

    const loadInitialLogs = async () => {
      try {
        const logs = await serversApi.logs(serverKey, { lines: 20 });
        if (!isActive) return;
        const normalized = logs.map(logToEvent).reverse().slice(0, MAX_EVENTS);
        setEvents(normalized);
      } catch {
        if (!isActive) return;
        setEvents([]);
      }
    };

    loadInitialLogs();

    return () => {
      isActive = false;
    };
  }, [serverKey]);

  useEffect(() => {
    if (!serverKey) return;

    const disconnect = createServerEventsStream(
      serverKey,
      (type: ServerEventType, data: Record<string, unknown>) => {
        if (String(data.serverId) !== serverKey) return;

        if (type === 'server_log') {
          if (!data.line) return;
          const entry: ServerEvent = {
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            message: String(data.line),
            timestamp: toIsoString(data.timestamp),
            stream: 'system',
          };
          setEvents((prev) => [entry, ...prev].slice(0, MAX_EVENTS));
        }

        if (type === 'server_state_update' || type === 'server_state') {
          const detail = data.reason ? ` (${data.reason})` : '';
          const entry: ServerEvent = {
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            message: `Status changed to ${data.state}${detail}`,
            timestamp: toIsoString(data.timestamp),
            stream: 'system',
          };
          setEvents((prev) => [entry, ...prev].slice(0, MAX_EVENTS));
        }
      },
      () => {},
    );

    return disconnect;
  }, [serverKey]);

  return events;
}
