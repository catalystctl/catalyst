/**
 * SSE (Server-Sent Events) console streaming service.
 *
 * Architecture:
 *   - Uses EventSource (native browser API) for receiving real-time console output
 *   - Commands are sent via standard HTTP POST (more reliable, easier to rate limit)
 *   - EventSource auto-reconnects on disconnect — critical for mobile/sleep/wake cycles
 *   - Works over HTTP/2 and HTTP/3 natively
 *
 * Why not WebSocket?
 *   - Simpler: no manual reconnect logic, browser handles it automatically
 *   - HTTP-native: works through all corporate proxies and firewalls
 *   - Stateless for the server: each SSE connection is independent HTTP
 *   - CORS-friendly: same-origin requests don't need special headers
 */

export type ConsoleStreamEvent =
  | { type: 'connected'; serverId: string; timestamp: string }
  | { type: 'console_output'; serverId: string; stream: string; data: string; timestamp?: string }
  | { type: 'error'; serverId?: string; error: string }
  | { type: 'eula_required'; serverId: string; serverUuid: string; eulaText: string };

export type StreamStatus = 'connecting' | 'connected' | 'reconnecting' | 'closed' | 'error';

type EventHandler = (event: ConsoleStreamEvent) => void;

const BASE_URL = '';

class ConsoleSseClient {
  private es: EventSource | null = null;
  private serverId: string | null = null;
  private handlers = new Set<EventHandler>();
  private statusListeners = new Set<(status: StreamStatus) => void>();
  private destroyed = false;

  // Reconnection is handled natively by the browser's EventSource API.
  // When the server sends `id:` fields in SSE events, the browser automatically
  // stores the last event ID and sends it as the `Last-Event-ID` header on
  // reconnect, enabling the server to replay any missed events.

  /** Connect to the SSE stream for a server's console output. */
  connect(serverId: string): void {
    if (this.es) {
      this.es.close();
      this.es = null;
    }

    this.serverId = serverId;
    this.destroyed = false;
    this.notifyStatus('connecting');
    this.openConnection();
  }

  private openConnection(): void {
    if (this.destroyed || !this.serverId) return;

    // Build SSE URL with credentials (cookies) for session auth
    const url = `${BASE_URL}/api/servers/${encodeURIComponent(this.serverId)}/console/stream`;

    this.es = new EventSource(url, { withCredentials: true });

    this.es.onopen = () => {
      this.notifyStatus('connected');
    };

    this.es.onerror = () => {
      if (this.destroyed) return;

      // EventSource auto-attempts reconnection, but we use it as a signal
      // to show a "reconnecting" state to the user
      if (this.es?.readyState === EventSource.CONNECTING) {
        this.notifyStatus('reconnecting');
      } else if (this.es?.readyState === EventSource.CLOSED) {
        this.notifyStatus('closed');
      }
    };

    // Named events from our SSE endpoint
    this.es.addEventListener('connected', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as { serverId: string; timestamp: string };
        this.dispatch({ type: 'connected', ...data });
      } catch {
        // ignore malformed data
      }
    });

    this.es.addEventListener('console_output', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as { serverId: string; stream: string; data: string; timestamp?: string };
        this.dispatch({ type: 'console_output', ...data });
      } catch {
        // ignore malformed data
      }
    });

    this.es.addEventListener('error', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as { serverId?: string; error: string };
        this.dispatch({ type: 'error', ...data });
      } catch {
        // ignore malformed data
      }
    });

    this.es.addEventListener('eula_required', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as { serverId: string; serverUuid: string; eulaText: string };
        this.dispatch({ type: 'eula_required', ...data });
      } catch {
        // ignore malformed data
      }
    });

    // Fallback: generic message event (catches untyped events)
    this.es.onmessage = (e: MessageEvent) => {
      if (e.data.startsWith(':')) return; // SSE comment/heartbeat
      try {
        const data = JSON.parse(e.data);
        if (data.type) {
          this.dispatch(data as ConsoleStreamEvent);
        }
      } catch {
        // ignore
      }
    };
  }

  /** Send a command to the server via HTTP POST. */
  async sendCommand(serverId: string, command: string): Promise<void> {
    const res = await fetch(`${BASE_URL}/api/servers/${encodeURIComponent(serverId)}/console/command`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command }),
    });

    if (!res.ok) {
      let errorMessage = `HTTP ${res.status}`;
      try {
        const data = await res.json();
        errorMessage = data.error || errorMessage;
      } catch {
        // use status text
      }
      throw new Error(errorMessage);
    }
  }

  /** Subscribe to console events. Returns an unsubscribe function. */
  onEvent(handler: EventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /** Subscribe to connection status changes. Returns an unsubscribe function. */
  onStatusChange(handler: (status: StreamStatus) => void): () => void {
    this.statusListeners.add(handler);
    return () => this.statusListeners.delete(handler);
  }

  /** Check if currently connected. */
  isConnected(): boolean {
    return this.es?.readyState === EventSource.OPEN;
  }

  /** Immediately disconnect and don't reconnect. */
  disconnect(): void {
    this.destroyed = true;
    if (this.es) {
      this.es.close();
      this.es = null;
    }
    this.notifyStatus('closed');
  }

  private dispatch(event: ConsoleStreamEvent): void {
    this.handlers.forEach((handler) => handler(event));
  }

  private notifyStatus(status: StreamStatus): void {
    this.statusListeners.forEach((handler) => handler(status));
  }
}

// Singleton — one SSE connection per browser tab, shared across all components
export const consoleSseClient = new ConsoleSseClient();
