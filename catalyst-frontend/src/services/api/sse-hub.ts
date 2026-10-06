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
/** Global listener over every shared stream, including ones created later (P2.2). */
export type SharedStatusListener = (url: string, status: StreamStatus, prev: StreamStatus) => void;

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
  /** P0-C — follower lease deadline; refreshed by ANY inbound BC traffic for this URL. */
  leaseUntil: number;
  /** Fallback self-promotion if no leader/status arrives (orphan streams). */
  takeoverTimer: number | null;
  /** Safety net: stalled connect → fatal-close recovery (P1-21). */
  connectingTimer: number | null;
  /** P0.5 — backoff re-open after a fatal close. */
  retryTimer: number | null;
  /** Current backoff step; reset on a successful open. */
  retryAttempt: number;
  /** Error events since the last successful open (P0.5). */
  errorCycles: number;
  /** P2.5 — half-open watchdog; armed only after a `ping` event was seen. */
  watchdogTimer: number | null;
  /** Timestamp of the last received message (open or event). */
  lastMessageAt: number;
  /** True once a named `ping` heartbeat event has arrived. */
  seenPing: boolean;
  /** The bookkeeping-only `ping` listener is bound on the current socket. */
  pingProbeBound: boolean;
};

/** P0.5 backoff: ~1s, 2s, 4s … capped at 30s, plus a small jitter. */
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 30_000;
const RETRY_JITTER_MS = 250;
/** Terminal-ish error budget before we take over from the browser's auto-retry. */
const MAX_ERROR_CYCLES = 3;
/** Safety net: a stalled connect goes through fatal-close recovery (P1-21). */
const CONNECTING_ERROR_MS = 8_000;
/** P2.5 — force reconnect after this much silence, once `ping` has been seen. */
const WATCHDOG_IDLE_MS = 70_000;
/** P0-C — leader re-announces every URL it leads at this cadence. */
const LEADER_HEARTBEAT_MS = 10_000;
/** P0-C — follower assumes the leader died after this much BC silence for the URL. */
const LEASE_TTL_MS = 30_000;
/** P0-C — follower lease check cadence. */
const LEASE_CHECK_MS = 10_000;

type BcEnvelope =
  | { kind: 'hello'; tabId: string; ts: number }
  | { kind: 'leader'; tabId: string; url: string; ts: number }
  | { kind: 'release'; tabId: string; url: string; ts: number }
  | { kind: 'event'; url: string; type: string; data: Record<string, unknown> }
  | { kind: 'status'; url: string; status: StreamStatus }
  | { kind: 'types'; url: string; types: string[] }
  | { kind: 'bye'; tabId: string };

const TAB_ID =
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const streams = new Map<string, SharedStream>();
/** Global (P2.2) status listeners — per-stream listeners live on the stream. */
const statusSubscribers = new Set<SharedStatusListener>();

const BC_NAME = 'catalyst-sse-hub';
let bc: BroadcastChannel | null = null;
let bcReady = false;
/** Known peer tabs (for diagnostics/bye handling; election is per-URL). */
const peers = new Set<string>([TAB_ID]);
/** P0-C — shared leader-heartbeat interval; runs while this tab leads any URL. */
let heartbeatTimer: number | null = null;
/** P0-C — shared follower-lease interval; runs while this tab follows any URL. */
let leaseTimer: number | null = null;

function canUseBroadcastChannel(): boolean {
  return typeof BroadcastChannel !== 'undefined';
}

function postLeaderAnnouncement(stream: SharedStream): void {
  if (!bc) return;
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

/** P0-C — any inbound BC traffic for a URL refreshes that URL's follower lease. */
function noteBcTraffic(stream: SharedStream): void {
  stream.leaseUntil = Date.now() + LEASE_TTL_MS;
}

/**
 * P0-C — keep the two shared hub intervals alive exactly while needed:
 * - heartbeat: re-announce leadership for every led URL, so followers can
 *   detect a silently dead leader (crash / tab discard / mobile kill — no
 *   beforeunload) through lease expiry;
 * - lease check: a follower stream with no socket and no BC traffic past the
 *   lease TTL assumes its leader is gone, clears the stale `knownLeader` and
 *   runs the takeover path.
 */
function syncHubTimers(): void {
  let leading = false;
  let following = false;
  for (const s of streams.values()) {
    if (s.refCount <= 0) continue;
    if (s.isLeader) leading = true;
    else if (!s.es) following = true;
  }
  if (leading && bc && heartbeatTimer === null) {
    heartbeatTimer = window.setInterval(() => {
      if (!bc) return;
      for (const s of streams.values()) {
        if (s.isLeader && s.refCount > 0) postLeaderAnnouncement(s);
      }
    }, LEADER_HEARTBEAT_MS) as unknown as number;
  }
  if ((!leading || !bc) && heartbeatTimer !== null) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (following && bc && leaseTimer === null) {
    leaseTimer = window.setInterval(() => {
      for (const s of streams.values()) {
        if (s.isLeader || s.es || s.refCount <= 0) continue;
        if (Date.now() <= s.leaseUntil) continue;
        // Lease expired: the recorded leader is presumed dead — forget it and
        // take over (also self-heals a stale knownLeader pointing at a dead tab).
        s.knownLeader = null;
        scheduleTakeover(s);
      }
    }, LEASE_CHECK_MS) as unknown as number;
  }
  if ((!following || !bc) && leaseTimer !== null) {
    clearInterval(leaseTimer);
    leaseTimer = null;
  }
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

function clearRetryTimer(stream: SharedStream): void {
  if (stream.retryTimer !== null) {
    clearTimeout(stream.retryTimer);
    stream.retryTimer = null;
  }
}

function clearWatchdog(stream: SharedStream): void {
  if (stream.watchdogTimer !== null) {
    clearTimeout(stream.watchdogTimer);
    stream.watchdogTimer = null;
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
    if (stream.knownLeader !== null && stream.knownLeader < TAB_ID) return;
    if (stream.status === 'connected') {
      // With a recorded leader, 'connected' is that leader's own mirror — don't
      // wrestle a working stream. With knownLeader cleared (bye / release /
      // lease expiry) it is a stale mirror of a dead leader (P0-C): reset and
      // take over instead of staying 'connected' forever with no socket.
      if (stream.knownLeader !== null) return;
      setStatus(stream, 'connecting', false);
    }
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
        // B1: re-assert leadership for every URL we lead so the new tab
        // converges on the incumbent instead of waiting for the next heartbeat.
        for (const s of streams.values()) {
          if (s.isLeader && s.refCount > 0) postLeaderAnnouncement(s);
        }
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
        // A2/A3: capture lease expiry before the refresh; once the recorded
        // leader's lease has lapsed, a FOLLOWER accepts a claim from ANY tab —
        // the previous leader is presumed dead and its id must not keep
        // blocking. A leader ignores expiry (the lease tracks its uplink, not
        // ours) and resolves challenges via the smaller-id rule below.
        const leaseExpired = stream.leaseUntil > 0 && Date.now() > stream.leaseUntil;
        noteBcTraffic(stream);
        if (
          stream.knownLeader === null ||
          msg.tabId < stream.knownLeader ||
          (leaseExpired && !stream.isLeader)
        ) {
          stream.knownLeader = msg.tabId;
        }
        if (stream.isLeader) {
          if (msg.tabId < TAB_ID) {
            demoteLeader(stream);
          } else {
            // B2: incumbency assertion — the smaller id wins, so re-announce;
            // the challenger sees our (smaller) id and defers.
            postLeaderAnnouncement(stream);
          }
        } else {
          clearTakeover(stream);
          clearConnectingTimer(stream);
          if (!stream.es && TAB_ID < msg.tabId) {
            promoteLeader(stream);
          }
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
        if (!stream) return;
        noteBcTraffic(stream);
        if (stream.isLeader) return;
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
        if (!stream) return;
        noteBcTraffic(stream);
        if (stream.isLeader) return;
        clearTakeover(stream);
        if (stream.knownLeader === null) stream.knownLeader = '__remote__';
        setStatus(stream, msg.status, false);
        break;
      }
      case 'types': {
        // D3: a peer tab bound extra event types for this URL — record them so
        // the current leader attaches native handlers (and any future leader
        // keeps the full union across a handover).
        const stream = streams.get(msg.url);
        if (!stream) break;
        noteBcTraffic(stream);
        for (const t of msg.types) {
          stream.eventTypes.add(t);
          bindNativeHandler(stream, t);
        }
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
    // A4: pagehide covers tab discard / bfcache / mobile kills where
    // beforeunload never fires, so followers stop waiting on this tab.
    const announceBye = () => {
      try {
        bc?.postMessage({ kind: 'bye', tabId: TAB_ID } satisfies BcEnvelope);
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('beforeunload', announceBye);
    window.addEventListener('pagehide', announceBye);
  }
}

function setStatus(stream: SharedStream, status: StreamStatus, broadcast = true) {
  const prev = stream.status;
  stream.status = status;
  if (status === 'connected') clearConnectingTimer(stream);
  for (const l of stream.statusListeners) {
    try {
      l(status);
    } catch {
      /* isolate */
    }
  }
  for (const l of statusSubscribers) {
    try {
      l(stream.url, status, prev);
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

/**
 * Safety net: don't leave the badge stuck at "Connecting"/"Reconnecting" forever
 * (proxy buffering / hidden 401/503). A stalled connect routes through the
 * fatal-close recovery (P1-21): the socket is closed and a backoff re-open is
 * scheduled, so the stream cannot dead-end with a live-but-useless socket.
 */
function armConnectingGuard(stream: SharedStream): void {
  clearConnectingTimer(stream);
  stream.connectingTimer = window.setTimeout(() => {
    stream.connectingTimer = null;
    if ((stream.status === 'connecting' || stream.status === 'reconnecting') && stream.isLeader) {
      // C (P1-21): don't dead-end at status 'error' with a live-but-stalled
      // socket — route through the fatal-close recovery so the socket is
      // closed and a backoff re-open is scheduled.
      recoverFromFatalClose(stream);
    }
  }, CONNECTING_ERROR_MS) as unknown as number;
}

/** P2.5 — force-close a half-open socket that has gone silent. */
function armWatchdog(stream: SharedStream): void {
  clearWatchdog(stream);
  if (!stream.seenPing || !stream.es) return;
  const due = Math.max(0, stream.lastMessageAt + WATCHDOG_IDLE_MS - Date.now());
  stream.watchdogTimer = window.setTimeout(() => {
    stream.watchdogTimer = null;
    if (streams.get(stream.url) !== stream) return;
    if (stream.refCount <= 0 || !stream.es) return;
    if (Date.now() - stream.lastMessageAt < WATCHDOG_IDLE_MS) {
      armWatchdog(stream); // a message raced the timer
      return;
    }
    recoverFromFatalClose(stream);
  }, due) as unknown as number;
}

/** Any received message refreshes liveness; a `ping` arms the watchdog (P2.5). */
function noteActivity(stream: SharedStream, isPing: boolean): void {
  stream.lastMessageAt = Date.now();
  if (isPing) stream.seenPing = true;
  if (stream.seenPing) armWatchdog(stream);
}

/** Bookkeeping-only listener for the backend heartbeat `ping` event (P2.5). */
function bindPingProbe(stream: SharedStream): void {
  if (!stream.es || stream.pingProbeBound) return;
  stream.pingProbeBound = true;
  stream.es.addEventListener('ping', () => noteActivity(stream, true));
}

/**
 * P0.5 (gap F1) — the browser permanently closes a failed EventSource
 * (403/503/proxy 5xx/204) and never retries it, so without this the stream
 * would stay dead for the session while subscribers remain mounted. Tear the
 * socket down and re-open with exponential backoff.
 */
function recoverFromFatalClose(stream: SharedStream): void {
  if (stream.es) {
    try {
      stream.es.close();
    } catch {
      /* ignore */
    }
    stream.es = null;
  }
  stream.nativeHandlers.clear();
  stream.pingProbeBound = false;
  clearConnectingTimer(stream);
  clearWatchdog(stream);
  clearTakeover(stream);
  setStatus(stream, 'reconnecting');
  armConnectingGuard(stream);
  scheduleRecovery(stream);
}

/** Schedule the backoff re-promotion; only while subscribers still exist. */
function scheduleRecovery(stream: SharedStream): void {
  if (stream.retryTimer !== null) return;
  if (streams.get(stream.url) !== stream || stream.refCount <= 0) return;
  const attempt = stream.retryAttempt;
  stream.retryAttempt = attempt + 1;
  const base = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(attempt, 10));
  const delay = Math.min(RETRY_MAX_MS, base + Math.floor(Math.random() * RETRY_JITTER_MS));
  stream.retryTimer = window.setTimeout(() => {
    stream.retryTimer = null;
    if (streams.get(stream.url) !== stream) return;
    if (stream.refCount <= 0 || stream.es || !stream.isLeader) return;
    if (stream.status !== 'reconnecting') setStatus(stream, 'reconnecting');
    promoteLeader(stream);
  }, delay) as unknown as number;
}

function attachEventType(stream: SharedStream, type: string) {
  if (stream.eventTypes.has(type)) return;
  stream.eventTypes.add(type);
  if (stream.es) {
    bindNativeHandler(stream, type);
  } else if (!stream.isLeader && bc) {
    // D3: follower bound a new type late — ask the leader tab to attach it on
    // the shared socket too.
    try {
      bc.postMessage({ kind: 'types', url: stream.url, types: [type] } satisfies BcEnvelope);
    } catch {
      /* ignore */
    }
  }
}

function bindNativeHandler(stream: SharedStream, type: string) {
  if (!stream.es || stream.nativeHandlers.has(type)) return;
  const handler = (e: MessageEvent) => {
    noteActivity(stream, type === 'ping');
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
  clearRetryTimer(stream);
  clearWatchdog(stream);
  armConnectingGuard(stream);
  const es = new EventSource(stream.url, { withCredentials: true });
  stream.es = es;
  stream.nativeHandlers.clear();
  stream.pingProbeBound = false;
  stream.errorCycles = 0;
  stream.lastMessageAt = Date.now();
  es.onopen = () => {
    if (es !== stream.es) return;
    clearConnectingTimer(stream);
    stream.retryAttempt = 0; // reset backoff on a successful open (P0.5)
    stream.errorCycles = 0;
    noteActivity(stream, false);
    setStatus(stream, 'connected');
  };
  es.onerror = () => {
    if (es !== stream.es) return;
    clearConnectingTimer(stream);
    stream.errorCycles += 1;
    if (es.readyState === EventSource.CLOSED) {
      // Terminal: the browser will never retry this socket — recover (P0.5).
      recoverFromFatalClose(stream);
      return;
    }
    if (stream.errorCycles >= MAX_ERROR_CYCLES) {
      // Repeated error cycles without an open — stop trusting auto-retry (P0.5).
      recoverFromFatalClose(stream);
      return;
    }
    if (es.readyState === EventSource.CONNECTING) setStatus(stream, 'reconnecting');
    else setStatus(stream, 'error');
  };
  for (const t of stream.eventTypes) bindNativeHandler(stream, t);
  bindPingProbe(stream);
  postLeaderAnnouncement(stream);
  // P0-C: start the shared heartbeat so followers can lease our leadership.
  syncHubTimers();
}

function demoteLeader(stream: SharedStream) {
  stream.isLeader = false;
  clearConnectingTimer(stream);
  clearTakeover(stream);
  clearRetryTimer(stream);
  clearWatchdog(stream);
  if (stream.es) {
    try {
      stream.es.close();
    } catch {
      /* ignore */
    }
    stream.es = null;
  }
  stream.nativeHandlers.clear();
  stream.pingProbeBound = false;
  setStatus(stream, 'connecting', false);
  scheduleTakeover(stream);
  syncHubTimers();
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
  // Static demo has no event stream — report closed so hooks fall back to
  // their polling path instead of opening a socket against the CDN.
  if ((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_DEMO_MODE === 'true') {
    try {
      onStatus?.('closed');
    } catch {
      /* isolate */
    }
    return () => {};
  }
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
      leaseUntil: 0,
      takeoverTimer: null,
      connectingTimer: null,
      retryTimer: null,
      retryAttempt: 0,
      errorCycles: 0,
      watchdogTimer: null,
      lastMessageAt: 0,
      seenPing: false,
      pingProbeBound: false,
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
    // A pending P0.5 backoff retry owns the next open — don't race it.
    if (!stream.es && stream.retryTimer === null) promoteLeader(stream);
  } else if (!stream.es && !stream.isLeader) {
    // B3: wait out the short takeover window instead of promoting
    // synchronously — an incumbent's heartbeat / hello re-announcement may
    // still arrive, and the smaller-id rule then converges without a handoff.
    scheduleTakeover(stream);
  }
  syncHubTimers();

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
      clearRetryTimer(s);
      clearWatchdog(s);
      const closingUrl = s.url;
      if (s.es) {
        try {
          s.es.close();
        } catch {
          /* ignore */
        }
      }
      // D1: emit 'closed' BEFORE deleting from the map so global status
      // subscribers (DataFreshness) can drop their per-URL state; the stream
      // is still resolvable via getSharedStreamStatus during this notify.
      setStatus(s, 'closed', false);
      streams.delete(url);
      syncHubTimers();
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

/**
 * P2.2 — subscribe to status transitions of every shared stream, including
 * streams created after this call. Invoked from `setStatus`; returns an
 * unsubscribe function. Existing per-stream `onStatus` behavior is unchanged.
 */
export function subscribeSharedStatus(cb: SharedStatusListener): () => void {
  statusSubscribers.add(cb);
  return () => {
    statusSubscribers.delete(cb);
  };
}

/** P2.2 — last known status of `url`, or undefined when no shared stream exists. */
export function getSharedStreamStatus(url: string): StreamStatus | undefined {
  return streams.get(url)?.status;
}

/** D2 — one live stream's externally relevant state. */
export type SharedStreamSnapshotEntry = {
  url: string;
  status: StreamStatus;
  lastMessageAt: number;
  isLeader: boolean;
  refCount: number;
};

/** D2 — point-in-time view of every live shared stream (DataFreshness etc.). */
export function getSharedStreamSnapshot(): SharedStreamSnapshotEntry[] {
  return [...streams.values()].map((s) => ({
    url: s.url,
    status: s.status,
    lastMessageAt: s.lastMessageAt,
    isLeader: s.isLeader,
    refCount: s.refCount,
  }));
}

/** Test helper */
export function __sharedEventSourceStats() {
  return [...streams.entries()].map(([url, s]) => ({
    url,
    refCount: s.refCount,
    status: s.status,
    eventTypes: [...s.eventTypes],
    isLeader: s.isLeader,
    knownLeader: s.knownLeader,
    hasSocket: Boolean(s.es),
    retryAttempt: s.retryAttempt,
    seenPing: s.seenPing,
    hasWatchdog: s.watchdogTimer !== null,
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
    if (s.retryTimer !== null) clearTimeout(s.retryTimer);
    if (s.watchdogTimer !== null) clearTimeout(s.watchdogTimer);
  }
  streams.clear();
  if (heartbeatTimer !== null) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (leaseTimer !== null) {
    clearInterval(leaseTimer);
    leaseTimer = null;
  }
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
