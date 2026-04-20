// src/plugins/usePluginWebSocket.ts
// React hook for plugin WebSocket communication.
// Listens for messages with type `plugin:{pluginName}:{eventType}` and auto-reconnects.

import { useEffect, useRef, useState, useCallback } from 'react';

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

  // Keep handler ref up-to-date without re-triggering effects
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const connect = useCallback(() => {
    // Clean up any existing connection
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      try {
        wsRef.current.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    }

    const wsUrl = url || `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;
    const fullUrl = `${wsUrl}/ws/plugins`;

    try {
      const ws = new WebSocket(fullUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        setError(null);
        reconnectAttemptsRef.current = 0;
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;

        // Auto-reconnect with exponential backoff if still enabled
        if (enabledRef.current) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
          reconnectAttemptsRef.current += 1;
          reconnectTimeoutRef.current = setTimeout(connect, delay);
        }
      };

      ws.onerror = () => {
        setError('WebSocket connection error');
      };

      ws.onmessage = (event) => {
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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create WebSocket';
      setError(msg);
      setConnected(false);
    }
  }, [pluginName, eventType, url]);

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
        wsRef.current.onopen = null;
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.onmessage = null;
        try {
          wsRef.current.close();
        } catch {
          // ignore
        }
        wsRef.current = null;
      }
      setConnected(false);
      setError(null);
      return;
    }

    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.onopen = null;
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.onmessage = null;
        try {
          wsRef.current.close();
        } catch {
          // ignore
        }
        wsRef.current = null;
      }
      setConnected(false);
      reconnectAttemptsRef.current = 0;
    };
  }, [enabled, connect]);

  return { connected, send, error };
}
