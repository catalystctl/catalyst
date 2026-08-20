/**
 * Ref-counted shared EventSource hub with optional multi-tab leader election.
 *
 * - Same-tab: multiple hooks share one EventSource per URL (ref-count).
 * - Cross-tab: one leader tab owns the real EventSource; followers receive
 *   events via BroadcastChannel so N tabs don't open N×M sockets.
 *
 * Leader election is best-effort (BroadcastChannel). If BC is unavailable
 * (SSR / old browsers / private mode quirks), each tab falls back to its own ES.
 */
export type StreamStatus = 'connecting' | 'connected' | 'reconnecting' | 'closed' | 'error';

type StatusListener = (status: StreamStatus) => void;
type EventListener = (type: string, data: Record<string, unknown>) => void;

type SharedStream = {
  url: string;
  eventTypes: Set<string>;
  eventListeners: Set<EventListener>;
  statusListeners: Set<StatusListener>;
  status: StreamStatus;
  refCount: number;
  /** Real EventSource — only on the leader (or when BC disabled) */
  es: EventSource | null;
  nativeHandlers: Map<string, (e: MessageEvent) => void>;
  /** This tab currently owns the socket for this URL */
  isLeader: boolean;
  /** Last announced leader tabId for this URL (per-URL election). */
  knownLeader: string | null;
  /** Fallback self-promotion if no leader/status arrives (orphan streams). */
  takeoverTimer: number | null;
  /** Safety net: connecting → error so polling isn't stuck. */
  connectingTimer: number | null;
};

type BcEnvelope =
  | { kind: 'hello'; tabId: string; ts: number }
  | { kind: 'leader'; tabId: string; url: string; ts: number }
  | { kind: 'release'; tabId: string; url: string; ts: number }
  | { kind: 'event'; url: string; type: string; data: Record<string, unknown> }
  | { kind: 'status'; url: string; status: StreamStatus }
  | { kind: 'bye'; tabId: string };

const TAB_ID =
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const streams = new Map<string, SharedStream>();

const BC_NAME = 'catalyst-sse-hub';
let bc: BroadcastChannel | null = null;
let bcReady = false;
/** Known peer tabs (for diagnostics/bye handling; election is per-URL). */
const peers = new Set<string>([TAB_ID]);

function canUseBroadcastChannel(): boolean {
  return typeof BroadcastChannel !== 'undefined';
}

function clearTakeover(stream: SharedStream): void {
  if (stream.takeoverTimer !== null) {
    clearTimeout(stream.takeoverTimer);
    stream.takeoverTimer = null;
  }
}

function clearConnectingTimer(stream: SharedStream): void {
  if (stream.connectingTimer !== null) {
    clearTimeout(stream.connectingTimer);
    stream.connectingTimer = null;
  }
}

function scheduleTakeover(stream: SharedStream): void {
  if (stream.isLeader || stream.es) return;
  if (stream.takeoverTimer !== null) return;
  const jitter = Math.floor(Math.random() * 300);
  const delay = 900 + jitter;
  stream.takeoverTimer = window.setTimeout(() => {
    stream.takeoverTimer = null;
    if (stream.isLeader || stream.es) return;
    if (stream.status === 'connected') return;
    if (stream.knownLeader !== null && stream.knownLeader < TAB_ID) return;
    promoteLeader(stream);
  }, delay) as unknown as number;
}

function ensureBroadcast() {
  if (bcReady || !canUseBroadcastChannel()) return;
  bcReady = true;
  try {
    bc = new BroadcastChannel(BC_NAME);
  } catch {
    bc = null;
    return;
  }
  bc.onmessage = (ev: MessageEvent<BcEnvelope>) => {
    const msg = ev.data;
    if (!msg || typeof msg !== 'object') return;
    switch (msg.kind) {
      case 'hello':
        peers.add(msg.tabId);
        break;
      case 'bye':
        peers.delete(msg.tabId);
        for (const s of streams.values()) {
          if (s.knownLeader === msg.tabId) {
            s.knownLeader = null;
            if (!s.isLeader && !s.es && s.refCount > 0) scheduleTakeover(s);
          }
        }
        break;
      case 'leader': {
        if (msg.tabId === TAB_ID) break;
        const stream = streams.get(msg.url);
        if (!stream) break;
        if (stream.knownLeader === null || msg.tabId < stream.knownLeader) {
          stream.knownLeader = msg.tabId;
        }
        clearTakeover(stream);
        clearConnectingTimer(stream);
        if (stream.isLeader && msg.tabId < TAB_ID) {
          demoteLeader(stream);
        } else if (!stream.isLeader && !stream.es && TAB_ID < msg.tabId) {
          promoteLeader(stream);
        }
        break;
      }
      case 'release': {
        if (msg.tabId === TAB_ID) break;
        const stream = streams.get(msg.url);
        if (!stream) break;
        if (stream.knownLeader === msg.tabId) {
          stream.knownLeader = null;
          clearTakeover(stream);
          if (!stream.isLeader && !stream.es && stream.refCount > 0) scheduleTakeover(stream);
        }
        break;
      }
      case 'event': {
        const stream = streams.get(msg.url);
        if (!stream || stream.isLeader) return;
        clearTakeover(stream);
        if (stream.knownLeader === null) stream.knownLeader = '__remote__';
        for (const l of stream.eventListeners) {
          try {
            l(msg.type, msg.data);
          } catch {
            /* isolate */
          }
        }
        break;
      }
      case 'status': {
        const stream = streams.get(msg.url);
        if (!stream || stream.isLeader) return;
        clearTakeover(stream);
        if (stream.knownLeader === null) stream.knownLeader = '__remote__';
        setStatus(stream, msg.status, false);
        break;
      }
      default:
        break;
    }
  };

  try {
    bc.postMessage({ kind: 'hello', tabId: TAB_ID, ts: Date.now() } satisfies BcEnvelope);
  } catch {
    /* ignore */
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => {
      try {
        bc?.postMessage({ kind: 'bye', tabId: TAB_ID } satisfies BcEnvelope);
      } catch {
        /* ignore */
      }
    });
  }
}

function setStatus(stream: SharedStream, status: StreamStatus, broadcast = true) {
  stream.status = status;
  if (status === 'connected') clearConnectingTimer(stream);
  for (const l of stream.statusListeners) {
    try {
      l(status);
    } catch {
      /* isolate */
    }
  }
  if (broadcast && stream.isLeader && bc) {
    try {
      bc.postMessage({
        kind: 'status',
        url: stream.url,
        status,
      } satisfies BcEnvelope);
    } catch {
      /* ignore */
    }
  }
}

function attachEventType(stream: SharedStream, type: string) {
  if (stream.eventTypes.has(type)) return;
  stream.eventTypes.add(type);
  if (stream.es) {
    bindNativeHandler(stream, type);
  }
}

function bindNativeHandler(stream: SharedStream, type: string) {
  if (!stream.es || stream.nativeHandlers.has(type)) return;
  const handler = (e: MessageEvent) => {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(e.data) as Record<string, unknown>;
    } catch {
      return;
    }
    for (const l of stream.eventListeners) {
      try {
        l(type, data);
      } catch {
        /* isolate */
      }
    }
    if (bc) {
      try {
        bc.postMessage({
          kind: 'event',
          url: stream.url,
          type,
          data,
        } satisfies BcEnvelope);
      } catch {
        /* ignore */
      }
    }
  };
  stream.nativeHandlers.set(type, handler);
  stream.es.addEventListener(type, handler as EventListenerOrEventListenerObject);
}

function promoteLeader(stream: SharedStream) {
  if (stream.es) return;
  stream.isLeader = true;
  stream.knownLeader = TAB_ID;
  clearTakeover(stream);
  clearConnectingTimer(stream);
  const es = new EventSource(stream.url, { withCredentials: true });
  stream.es = es;
  stream.nativeHandlers.clear();
  // Safety net: don't leave badge stuck at "Connecting" forever (proxy buffering / 401 / 503 hidden).
  // Transition to error so useSseConsole fallback polling (which only runs on closed/error) can take over.
  stream.connectingTimer = window.setTimeout(() => {
    stream.connectingTimer = null;
    if (stream.status === 'connecting' && stream.isLeader) {
      setStatus(stream, 'error');
    }
  }, 8000) as unknown as number;
  es.onopen = () => {
    clearConnectingTimer(stream);
    setStatus(stream, 'connected');
  };
  es.onerror = () => {
    clearConnectingTimer(stream);
    if (es.readyState === EventSource.CONNECTING) setStatus(stream, 'reconnecting');
    else if (es.readyState === EventSource.CLOSED) setStatus(stream, 'closed');
    else setStatus(stream, 'error');
  };
  for (const t of stream.eventTypes) bindNativeHandler(stream, t);
  if (bc) {
    try {
      bc.postMessage({
        kind: 'leader',
        tabId: TAB_ID,
        url: stream.url,
        ts: Date.now(),
      } satisfies BcEnvelope);
    } catch {
      /* ignore */
    }
  }
}

function demoteLeader(stream: SharedStream) {
  stream.isLeader = false;
  clearConnectingTimer(stream);
  clearTakeover(stream);
  if (stream.es) {
    try {
      stream.es.close();
    } catch {
      /* ignore */
    }
    stream.es = null;
  }
  stream.nativeHandlers.clear();
  setStatus(stream, 'connecting', false);
  scheduleTakeover(stream);
}

/**
 * Subscribe to a shared EventSource at `url`.
 */
export function subscribeSharedEventSource(
  url: string,
  eventTypes: readonly string[],
  onEvent: EventListener,
  onStatus?: StatusListener,
): () => void {
  ensureBroadcast();

  let stream = streams.get(url);
  if (!stream) {
    stream = {
      url,
      eventTypes: new Set(),
      eventListeners: new Set(),
      statusListeners: new Set(),
      status: 'connecting',
      refCount: 0,
      es: null,
      nativeHandlers: new Map(),
      isLeader: false,
      knownLeader: null,
      takeoverTimer: null,
      connectingTimer: null,
    };
    streams.set(url, stream);
  }

  stream.refCount++;
  stream.eventListeners.add(onEvent);
  if (onStatus) {
    stream.statusListeners.add(onStatus);
    try {
      onStatus(stream.status);
    } catch {
      /* isolate */
    }
  }

  for (const t of eventTypes) attachEventType(stream, t);

  if (!canUseBroadcastChannel() || !bc) {
    if (!stream.es) promoteLeader(stream);
  } else if (!stream.es && !stream.isLeader) {
    if (stream.knownLeader === null) {
      promoteLeader(stream);
    } else if (TAB_ID < stream.knownLeader) {
      promoteLeader(stream);
    } else {
      scheduleTakeover(stream);
    }
    if (!stream.isLeader && !stream.es) scheduleTakeover(stream);
  }

  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    const s = streams.get(url);
    if (!s) return;
    s.eventListeners.delete(onEvent);
    if (onStatus) s.statusListeners.delete(onStatus);
    const wasLeaderForUrl = s.isLeader && s.knownLeader === TAB_ID;
    s.refCount = Math.max(0, s.refCount - 1);
    if (s.refCount === 0) {
      clearTakeover(s);
      clearConnectingTimer(s);
      const closingUrl = s.url;
      if (s.es) {
        try {
          s.es.close();
        } catch {
          /* ignore */
        }
      }
      streams.delete(url);
      if (wasLeaderForUrl && bc) {
        try {
          bc.postMessage({ kind: 'release', tabId: TAB_ID, url: closingUrl, ts: Date.now() } satisfies BcEnvelope);
        } catch {
          /* ignore */
        }
      }
    }
  };
}

/** Test helper */
export function __sharedEventSourceStats() {
  return [...streams.entries()].map(([url, s]) => ({
    url,
    refCount: s.refCount,
    status: s.status,
    eventTypes: [...s.eventTypes],
    isLeader: s.isLeader,
    hasSocket: Boolean(s.es),
  }));
}

/** Test helper — force-close all */
export function __resetSharedEventSources() {
  for (const [, s] of streams) {
    if (s.es) {
      try {
        s.es.close();
      } catch {
        /* ignore */
      }
    }
    if (s.takeoverTimer !== null) clearTimeout(s.takeoverTimer);
    if (s.connectingTimer !== null) clearTimeout(s.connectingTimer);
  }
  streams.clear();
  peers.clear();
  peers.add(TAB_ID);
  if (bc) {
    try {
      bc.close();
    } catch {
      /* ignore */
    }
    bc = null;
    bcReady = false;
  }
}

export function __getSseHubTabId() {
  return TAB_ID;
}
