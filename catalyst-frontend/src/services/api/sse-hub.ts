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
};

type BcEnvelope =
  | { kind: 'hello'; tabId: string; ts: number }
  | { kind: 'leader'; tabId: string; url: string; ts: number }
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
/** Known peer tabs (for crude leader election: lowest tabId wins) */
const peers = new Set<string>([TAB_ID]);
let electionTimer: ReturnType<typeof setTimeout> | null = null;

function canUseBroadcastChannel(): boolean {
  return typeof BroadcastChannel !== 'undefined';
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
        // Reply so the new tab learns about us
        try {
          bc?.postMessage({ kind: 'hello', tabId: TAB_ID, ts: Date.now() } satisfies BcEnvelope);
        } catch {
          /* ignore */
        }
        scheduleElection();
        break;
      case 'bye':
        peers.delete(msg.tabId);
        scheduleElection();
        break;
      case 'leader':
        // Another tab claimed leadership for a URL — if we had the socket, drop it
        if (msg.tabId !== TAB_ID) {
          const stream = streams.get(msg.url);
          if (stream?.isLeader && stream.es) {
            demoteLeader(stream);
          }
        }
        break;
      case 'event': {
        const stream = streams.get(msg.url);
        if (!stream || stream.isLeader) return; // leader already dispatched locally
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
        setStatus(stream, msg.status, /*broadcast*/ false);
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

function isElectedLeader(): boolean {
  // Lowest tabId among known peers wins (stable, deterministic).
  let min = TAB_ID;
  for (const id of peers) {
    if (id < min) min = id;
  }
  return min === TAB_ID;
}

function scheduleElection() {
  if (electionTimer) clearTimeout(electionTimer);
  electionTimer = setTimeout(() => {
    electionTimer = null;
    runElection();
  }, 50);
}

function runElection() {
  const shouldLead = !canUseBroadcastChannel() || !bc || isElectedLeader();
  for (const stream of streams.values()) {
    if (shouldLead && !stream.isLeader) {
      promoteLeader(stream);
    } else if (!shouldLead && stream.isLeader) {
      demoteLeader(stream);
    }
  }
}

function setStatus(stream: SharedStream, status: StreamStatus, broadcast = true) {
  stream.status = status;
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
  // If we already have an ES, attach now; otherwise promoteLeader will attach all.
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
  const es = new EventSource(stream.url, { withCredentials: true });
  stream.es = es;
  stream.nativeHandlers.clear();
  es.onopen = () => setStatus(stream, 'connected');
  es.onerror = () => {
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
  if (stream.es) {
    try {
      stream.es.close();
    } catch {
      /* ignore */
    }
    stream.es = null;
  }
  stream.nativeHandlers.clear();
  // Followers show connecting until leader sends status
  setStatus(stream, 'connecting', /*broadcast*/ false);
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

  // Elect / open socket
  if (!canUseBroadcastChannel() || !bc) {
    // No cross-tab: this tab always owns the socket
    if (!stream.es) promoteLeader(stream);
  } else {
    scheduleElection();
    // Optimistic: if we already know we're leader, open immediately
    if (isElectedLeader() && !stream.es) promoteLeader(stream);
  }

  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    const s = streams.get(url);
    if (!s) return;
    s.eventListeners.delete(onEvent);
    if (onStatus) s.statusListeners.delete(onStatus);
    s.refCount = Math.max(0, s.refCount - 1);
    if (s.refCount === 0) {
      if (s.es) {
        try {
          s.es.close();
        } catch {
          /* ignore */
        }
      }
      streams.delete(url);
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
  }
  streams.clear();
  peers.clear();
  peers.add(TAB_ID);
  if (electionTimer) {
    clearTimeout(electionTimer);
    electionTimer = null;
  }
}

export function __getSseHubTabId() {
  return TAB_ID;
}
