// src/plugins/usePluginWebSocket.ts
// React hook for plugin WebSocket communication.
// Listens for messages with type `plugin:{pluginName}:{eventType}` and auto-reconnects.

import { useEffect, useRef, useState, useCallback } from 'react';
import { reportSystemError } from '../services/api/systemErrors';

interface UsePluginWebSocketOptions {
  /** Whether the WebSocket connection is active (default: true) */
  enabled?: boolean;
  /** WebSocket server URL (defaults to current origin) */
  url?: string;
}

interface UsePluginWebSocketReturn {
  /** Whether the WebSocket is currently connected */
  connected: boolean;
  /** Send a message through the WebSocket */
  send: (data: any) => void;
  /** Last error message, or null */
  error: string | null;
}

/**
 * Hook for plugin WebSocket communication.
 *
 * Connects to the WebSocket server and listens for messages of the form:
 *   { type: "plugin:{pluginName}:{eventType}", data: ... }
 *
 * Auto-reconnects on disconnect with exponential backoff.
 * Cleans up on unmount.
 *
 * @example
 * const { connected, send, error } = usePluginWebSocket(
 *   'ticketing-plugin',
 *   'ticket-updated',
 *   (data) => {
 *     console.log('Ticket updated:', data);
 *     refreshTickets();
 *   },
 *   { enabled: true }
 * );
 */
export function usePluginWebSocket(
  pluginName: string,
  eventType: string,
  handler: (data: any) => void,
  options?: UsePluginWebSocketOptions,
): UsePluginWebSocketReturn {
  const { enabled = true, url } = options ?? {};

  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const handlerRef = useRef(handler);
  const enabledRef = useRef(enabled);
  const intentionalCloseRef = useRef(false);
  const connectRef = useRef<(() => void) | null>(null);

  // Keep handler ref up-to-date without re-triggering effects
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const connect = useCallback(() => {
    // Close any previous socket without removing callbacks; stale-socket
    // guards below will ignore events from the old instance.
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // ignore
      }
    }

    const wsUrl = url || `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;
    const fullUrl = `${wsUrl}/ws/plugins`;

    // Don't attempt connection if no custom URL provided — the default /ws/plugins
    // endpoint doesn't exist on the backend yet. Only connect if an explicit URL is given.
    if (!url) {
      return;
    }

    const ws = new WebSocket(fullUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (wsRef.current !== ws) return;
      setConnected(true);
      setError(null);
      reconnectAttemptsRef.current = 0;
    };

    ws.onclose = () => {
      if (wsRef.current !== ws) return;
      setConnected(false);
      wsRef.current = null;

      if (intentionalCloseRef.current) {
        intentionalCloseRef.current = false;
        setError(null);
        return;
      }

      // If we never successfully connected, give up after 2 attempts
      // to avoid spamming reconnect attempts to a non-existent endpoint
      if (reconnectAttemptsRef.current >= 2) {
        setError('WebSocket unavailable');
        return;
      }

      // Auto-reconnect with exponential backoff if still enabled
      if (enabledRef.current) {
        const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
        reconnectAttemptsRef.current += 1;
        reconnectTimeoutRef.current = setTimeout(() => connectRef.current?.(), delay);
      }
    };

    ws.onerror = () => {
      if (wsRef.current !== ws) return;
      setError('WebSocket connection error');
    };

    ws.onmessage = (event) => {
      if (wsRef.current !== ws) return;
      try {
        const message = JSON.parse(event.data);
        const expectedType = `plugin:${pluginName}:${eventType}`;
        if (message.type === expectedType) {
          handlerRef.current(message.data);
        }
      } catch {
        // Ignore non-JSON or malformed messages
      }
    };
  }, [pluginName, eventType, url]);

  // Sync connectRef so stale closures inside WebSocket callbacks
  // always see the latest connect() definition.
  useEffect(() => {
    connectRef.current = connect;
  });

  const send = useCallback((data: any) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: `plugin:${pluginName}:${eventType}`,
        data,
      }));
    }
  }, [pluginName, eventType]);

  useEffect(() => {
    if (!enabled) {
      // Disconnect when disabled
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (wsRef.current) {
        intentionalCloseRef.current = true;
        wsRef.current.close();
      }
      return;
    }

    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (wsRef.current) {
        intentionalCloseRef.current = true;
        wsRef.current.close();
      }
    };
  }, [enabled, connect]);

  return { connected, send, error };
}
