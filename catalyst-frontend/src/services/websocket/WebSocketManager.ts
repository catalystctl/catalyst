import type { WebSocketMessage } from './types';

type Callbacks = {
  onOpen?: () => void;
  onClose?: () => void;
  onMessage?: (message: WebSocketMessage) => void;
  onError?: (error: Event) => void;
};

type PendingSend = {
  type: 'command' | 'subscribe' | 'unsubscribe';
  serverId?: string;
  data?: string;
};

export class WebSocketManager {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 5;
  private readonly subscriptions = new Set<string>();
  private candidateUrls: string[] = [];
  private candidateIndex = 0;
  private pendingSends: PendingSend[] = [];

  private buildWsUrl() {
    const envUrl = import.meta.env.VITE_WS_URL as string | undefined;

    // Build URL from env or use same origin as page
    let wsUrl: URL;
    if (envUrl) {
      if (
        envUrl.startsWith('http://') ||
        envUrl.startsWith('https://') ||
        envUrl.startsWith('ws://') ||
        envUrl.startsWith('wss://')
      ) {
        const normalized = envUrl
          .replace(/^http:\/\//, 'ws://')
          .replace(/^https:\/\//, 'wss://');
        wsUrl = new URL(normalized);
      } else {
        wsUrl = new URL(envUrl, window.location.origin);
      }
    } else {
      wsUrl = new URL('/ws', window.location.origin);
    }

    wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';

    if (!wsUrl.pathname || wsUrl.pathname === '/') {
      wsUrl.pathname = '/ws';
    }

    return wsUrl.toString();
  }

  connect(callbacks?: Callbacks) {
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    const url = this.buildWsUrl();
    this.candidateUrls = this.buildCandidateUrls(url);
    this.candidateIndex = 0;
    this.openWithCandidate(callbacks);
  }

  private buildCandidateUrls(primary: string) {
    const urls = new Set<string>([primary]);
    try {
      const parsed = new URL(primary);
      if (parsed.hostname === '127.0.0.1') {
        const alt = new URL(primary);
        alt.hostname = 'localhost';
        urls.add(alt.toString());
      } else if (parsed.hostname === 'localhost') {
        const alt = new URL(primary);
        alt.hostname = '127.0.0.1';
        urls.add(alt.toString());
      }
    } catch {
      // Ignore malformed URLs; fallback to primary only.
    }
    return Array.from(urls);
  }

  private openWithCandidate(callbacks?: Callbacks) {
    const url = this.candidateUrls[this.candidateIndex];
    console.log('[WebSocket] Connecting to:', url);
    this.ws = new WebSocket(url);
    let opened = false;

    this.ws.onopen = () => {
      console.log('[WebSocket] Connection opened to:', url);
      opened = true;
      this.reconnectAttempts = 0;

      // Send handshake — auth is handled via cookies on the HTTP upgrade request
      this.ws?.send(JSON.stringify({ type: 'client_handshake' }));

      // Re-subscribe to all previously subscribed servers
      this.subscriptions.forEach((serverId) => {
        this.ws?.send(JSON.stringify({ type: 'subscribe', serverId }));
      });

      // Flush any commands/subscriptions that were queued while connecting
      // (e.g., from React StrictMode remount or rapid user actions)
      const pending = this.pendingSends.splice(0);
      pending.forEach((p) => {
        if (p.type === 'command' && p.serverId && p.data !== undefined) {
          this.ws?.send(
            JSON.stringify({ type: 'console_input', serverId: p.serverId, data: p.data }),
          );
        } else if (p.type === 'subscribe' && p.serverId) {
          this.ws?.send(JSON.stringify({ type: 'subscribe', serverId: p.serverId }));
        } else if (p.type === 'unsubscribe' && p.serverId) {
          this.ws?.send(JSON.stringify({ type: 'unsubscribe', serverId: p.serverId }));
        }
      });

      callbacks?.onOpen?.();
    };

    this.ws.onclose = () => {
      callbacks?.onClose?.();
      if (!opened && this.candidateIndex < this.candidateUrls.length - 1) {
        this.candidateIndex += 1;
        this.openWithCandidate(callbacks);
        return;
      }
      this.scheduleReconnect(callbacks);
    };

    this.ws.onerror = (error) => {
      callbacks?.onError?.(error);
    };

    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data) as WebSocketMessage;
      callbacks?.onMessage?.(message);
    };
  }

  subscribe(serverId: string) {
    this.subscriptions.add(serverId);
    this.sendOrBuffer({ type: 'subscribe', serverId });
  }

  unsubscribe(serverId: string) {
    this.subscriptions.delete(serverId);
    this.sendOrBuffer({ type: 'unsubscribe', serverId });
  }

  sendCommand(serverId: string, command: string) {
    console.log('[WebSocketManager] sendCommand', { serverId, command, wsState: this.ws?.readyState });
    this.sendOrBuffer({ type: 'command', serverId, data: command });
  }

  /**
   * Send immediately if the WebSocket is open, otherwise buffer the message
   * and send it once the connection opens. This handles StrictMode remounts
   * and rapid user actions that fire while the socket is still connecting.
   */
  private sendOrBuffer(pending: PendingSend) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      if (pending.type === 'command' && pending.serverId && pending.data !== undefined) {
        this.ws.send(JSON.stringify({ type: 'console_input', serverId: pending.serverId, data: pending.data }));
      } else if (pending.type === 'subscribe' && pending.serverId) {
        this.ws.send(JSON.stringify({ type: 'subscribe', serverId: pending.serverId }));
      } else if (pending.type === 'unsubscribe' && pending.serverId) {
        this.ws.send(JSON.stringify({ type: 'unsubscribe', serverId: pending.serverId }));
      }
    } else {
      // Buffer the message — it will be flushed when the socket opens
      this.pendingSends.push(pending);
    }
  }

  private scheduleReconnect(callbacks?: Callbacks) {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return;
    this.reconnectAttempts += 1;
    const delay = 1000 * this.reconnectAttempts;
    setTimeout(() => this.connect(callbacks), delay);
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    // Clear buffered sends on explicit disconnect
    this.pendingSends = [];
  }

  reconnect(callbacks?: Callbacks) {
    console.log('[WebSocketManager] Reconnecting...');
    this.disconnect();
    this.reconnectAttempts = 0;
    this.connect(callbacks);
  }
}
