/**
 * SSE (Server-Sent Events) console streaming service.
 *
 * Uses the shared SSE hub (ref-counted + multi-tab leader election) so console
 * reuses the same connection machinery as server/admin streams.
 *
 * Commands are still sent via HTTP POST.
 */
import { reportSystemError } from './systemErrors';
import { subscribeSharedEventSource, type StreamStatus } from './sse-hub';

export type ConsoleStreamEvent =
  | { type: 'connected'; serverId: string; timestamp: string }
  | { type: 'console_output'; serverId: string; stream: string; data: string; timestamp?: string }
  | { type: 'error'; serverId?: string; error: string }
  | { type: 'eula_required'; serverId: string; serverUuid: string; eulaText: string };

export type { StreamStatus };

type EventHandler = (event: ConsoleStreamEvent) => void;

const BASE_URL = '';
const CONSOLE_EVENT_TYPES = ['connected', 'console_output', 'error', 'eula_required'] as const;

class ConsoleSseClient {
  private handlers = new Set<EventHandler>();
  private statusListeners = new Set<(status: StreamStatus) => void>();
  private unsub: (() => void) | null = null;
  private lastStatus: StreamStatus = 'closed';

  /** Connect to the SSE stream for a server's console output. */
  connect(serverId: string): void {
    this.disconnect();
    this.notifyStatus('connecting');

    const url = `${BASE_URL}/api/servers/${encodeURIComponent(serverId)}/console/stream`;
    this.unsub = subscribeSharedEventSource(
      url,
      CONSOLE_EVENT_TYPES,
      (type, data) => {
        if (type === 'connected') {
          this.dispatch({
            type: 'connected',
            serverId: String(data.serverId ?? serverId),
            timestamp: String(data.timestamp ?? new Date().toISOString()),
          });
          return;
        }
        if (type === 'console_output') {
          this.dispatch({
            type: 'console_output',
            serverId: String(data.serverId ?? serverId),
            stream: String(data.stream ?? 'stdout'),
            data: String(data.data ?? ''),
            timestamp: data.timestamp ? String(data.timestamp) : undefined,
          });
          return;
        }
        if (type === 'error') {
          this.dispatch({
            type: 'error',
            serverId: data.serverId ? String(data.serverId) : undefined,
            error: String(data.error ?? 'Unknown error'),
          });
          return;
        }
        if (type === 'eula_required') {
          this.dispatch({
            type: 'eula_required',
            serverId: String(data.serverId ?? serverId),
            serverUuid: String(data.serverUuid ?? ''),
            eulaText: String(data.eulaText ?? ''),
          });
        }
      },
      (status) => this.notifyStatus(status),
    );
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
      reportSystemError({
        level: 'error',
        component: 'ApiConsole',
        message: errorMessage,
        metadata: { action: 'sendCommand', status: res.status },
      });
      throw new Error(errorMessage);
    }
  }

  /** Subscribe to console events. Returns an unsubscribe function. */
  onEvent(handler: EventHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  /** Subscribe to connection status changes. Returns an unsubscribe function. */
  onStatusChange(handler: (status: StreamStatus) => void): () => void {
    this.statusListeners.add(handler);
    try {
      handler(this.lastStatus);
    } catch {
      /* isolate */
    }
    return () => {
      this.statusListeners.delete(handler);
    };
  }

  /** Check if currently connected. */
  isConnected(): boolean {
    return this.lastStatus === 'connected';
  }

  /** Immediately disconnect. */
  disconnect(): void {
    if (this.unsub) {
      this.unsub();
      this.unsub = null;
    }
    this.notifyStatus('closed');
  }

  private dispatch(event: ConsoleStreamEvent): void {
    this.handlers.forEach((handler) => {
      try {
        handler(event);
      } catch {
        /* isolate */
      }
    });
  }

  private notifyStatus(status: StreamStatus): void {
    this.lastStatus = status;
    this.statusListeners.forEach((handler) => {
      try {
        handler(status);
      } catch {
        /* isolate */
      }
    });
  }
}

/** Singleton — one logical console client per tab (hub may share socket across tabs). */
export const consoleSseClient = new ConsoleSseClient();
