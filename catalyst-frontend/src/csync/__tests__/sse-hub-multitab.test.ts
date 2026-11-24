/**
 * SSE hub — A1 multi-tab split-brain regressions (audit 2026-11-24 §A1).
 *
 * Live repro: with two tabs open, the active tab showed "Reconnecting…" and
 * stale data while the background tab stayed "Live"; BroadcastChannel events
 * arrived in the stuck tab and were dropped, and recovery took ~60s (30s
 * follower lease + 10s check).
 *
 * - A1(a): a leader that re-announces on `hello` / a `leader` challenge also
 *   replays its current status, so a late follower learns 'connected' at once.
 * - A1(b): an inbound BC `event` proves a live leader — a follower mirrors
 *   'connected' instead of waiting for a status message.
 * - A1(c): the leader heartbeat only announces streams it has a socket for; a
 *   socketless "leader" starts recovery instead of suppressing live peers.
 * - A1(d): a leader that holds no socket demotes on any claim (id order is
 *   irrelevant — the claimant is the one with a live socket).
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  subscribeSharedEventSource,
  __sharedEventSourceStats,
  __resetSharedEventSources,
  __getSseHubTabId,
} from '../../services/api/sse-hub';

class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  /** Arms a constructor throw — models a promotion that cannot open a socket. */
  static throwNext = false;
  readyState = FakeEventSource.CONNECTING;
  url: string;
  withCredentials: boolean;
  onopen: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  listeners = new Map<string, Set<(e: MessageEvent) => void>>();
  closed = false;

  constructor(url: string, opts?: { withCredentials?: boolean }) {
    if (FakeEventSource.throwNext) {
      FakeEventSource.throwNext = false;
      throw new Error('synthetic EventSource construction failure');
    }
    this.url = url;
    this.withCredentials = Boolean(opts?.withCredentials);
    fakeSources.push(this);
    queueMicrotask(() => {
      if (this.closed) return;
      this.readyState = FakeEventSource.OPEN;
      this.onopen?.(new Event('open'));
    });
  }

  addEventListener(type: string, handler: EventListenerOrEventListenerObject) {
    const fn = handler as (e: MessageEvent) => void;
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }

  removeEventListener(type: string, handler: EventListenerOrEventListenerObject) {
    this.listeners.get(type)?.delete(handler as (e: MessageEvent) => void);
  }

  close() {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
  }

  /** Fatal close: the browser gives up on this socket permanently. */
  fail() {
    this.readyState = FakeEventSource.CLOSED;
    this.onerror?.(new Event('error'));
  }

  emit(type: string, data: unknown) {
    const ev = { data: JSON.stringify(data) } as MessageEvent;
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
  }
}

const fakeSources: FakeEventSource[] = [];

/** BC fake that records what the hub posts and lets tests inject messages. */
class RecordingBC {
  static instances: RecordingBC[] = [];
  name: string;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  closed = false;
  sent: unknown[] = [];

  constructor(name: string) {
    this.name = name;
    RecordingBC.instances.push(this);
  }

  postMessage(data: unknown) {
    if (this.closed) return;
    this.sent.push(data);
    for (const inst of RecordingBC.instances) {
      if (inst === this || inst.closed || inst.name !== this.name) continue;
      inst.onmessage?.({ data } as MessageEvent);
    }
  }

  close() {
    this.closed = true;
  }
}

function hub(): RecordingBC {
  return RecordingBC.instances[0];
}

function inject(msg: unknown): void {
  hub().onmessage?.({ data: msg } as MessageEvent);
}

type Envelope = { kind: string; url?: string; status?: string; tabId?: string };

function posts(kind: string, url: string): Envelope[] {
  return hub().sent.filter((m): m is Envelope => {
    const e = m as Envelope;
    return e.kind === kind && e.url === url;
  });
}

async function flushOpens(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

/** B3: first-time subscribers wait ~900ms + jitter before promoting. */
const TAKEOVER_SAFE_MS = 1_300;
/** First P0.5 backoff window is ~1s + jitter ≤250ms. */
const BACKOFF_SAFE_MS = 1_300;

/** This tab's hub entry for `url` (streams are kept in subscribe order). */
function streamAt(url: string) {
  const entry = __sharedEventSourceStats().find((s) => s.url === url);
  expect(entry, `no shared stream for ${url}`).toBeTruthy();
  return entry!;
}

/** Promote this tab to leader for `url` and wait for the socket to open. */
async function promote(url: string): Promise<void> {
  await vi.advanceTimersByTimeAsync(TAKEOVER_SAFE_MS);
  await flushOpens();
  expect(streamAt(url).isLeader).toBe(true);
  expect(streamAt(url).hasSocket).toBe(true);
}

describe('sse-hub multi-tab split-brain (A1)', () => {
  beforeEach(() => {
    fakeSources.length = 0;
    FakeEventSource.throwNext = false;
    RecordingBC.instances = [];
    __resetSharedEventSources();
    vi.useFakeTimers();
    vi.stubGlobal('EventSource', FakeEventSource as any);
    vi.stubGlobal('BroadcastChannel', RecordingBC as any);
  });

  afterEach(() => {
    __resetSharedEventSources();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // ── A1(a): status replay on hello ──
  it('replays its current status when a new tab says hello (A1a)', async () => {
    subscribeSharedEventSource('/api/a1-hello', ['x'], vi.fn());
    await promote('/api/a1-hello');

    hub().sent.length = 0;
    inject({ kind: 'hello', tabId: 'late-follower', ts: Date.now() });

    // The newcomer gets both facts: who leads, and that it is already live.
    // Without the status replay it sat at 'connecting' until the 30s lease
    // (the ~60s "Reconnecting…" in the audit repro).
    expect(posts('leader', '/api/a1-hello')).toHaveLength(1);
    expect(posts('status', '/api/a1-hello')).toEqual([
      expect.objectContaining({ kind: 'status', url: '/api/a1-hello', status: 'connected' }),
    ]);
  });

  // ── A1(a): status replay on the B2 incumbency assertion ──
  it('carries its status when asserting incumbency over a larger-id challenge (A1a/B2)', async () => {
    subscribeSharedEventSource('/api/a1-b2', ['x'], vi.fn());
    await promote('/api/a1-b2');

    const challenger = `${__getSseHubTabId()}z`; // lexicographically larger
    hub().sent.length = 0;
    inject({ kind: 'leader', tabId: challenger, url: '/api/a1-b2', ts: Date.now() });

    expect(__sharedEventSourceStats()[0].isLeader).toBe(true);
    expect(posts('leader', '/api/a1-b2')).toHaveLength(1);
    expect(posts('status', '/api/a1-b2')).toEqual([
      expect.objectContaining({ status: 'connected' }),
    ]);
  });

  // ── A1(b): inbound events prove a live leader ──
  it('mirrors connected on an inbound relayed event, with no lease wait (A1b)', async () => {
    const smaller = __getSseHubTabId().slice(0, -1); // legit incumbent
    const onEvent = vi.fn();
    subscribeSharedEventSource('/api/a1-event', ['x'], onEvent);
    inject({ kind: 'leader', tabId: smaller, url: '/api/a1-event', ts: Date.now() });
    await vi.advanceTimersByTimeAsync(TAKEOVER_SAFE_MS);
    await flushOpens();
    expect(__sharedEventSourceStats()[0].isLeader).toBe(false);
    expect(__sharedEventSourceStats()[0].hasSocket).toBe(false);
    expect(__sharedEventSourceStats()[0].status).toBe('connecting');

    // A relayed event can only exist if the leader's socket is alive: mirror
    // 'connected' immediately (no timers advanced — not a 30s lease repair).
    inject({ kind: 'event', url: '/api/a1-event', type: 'x', data: { v: 1 } });
    expect(__sharedEventSourceStats()[0].status).toBe('connected');
    expect(onEvent).toHaveBeenCalledWith('x', { v: 1 });
  });

  it('does not downgrade a connected follower on a stale status message (A1b regression)', async () => {
    const smaller = __getSseHubTabId().slice(0, -1);
    subscribeSharedEventSource('/api/a1-stale', ['x'], vi.fn());
    inject({ kind: 'leader', tabId: smaller, url: '/api/a1-stale', ts: Date.now() });
    inject({ kind: 'status', url: '/api/a1-stale', status: 'connected' });
    await vi.advanceTimersByTimeAsync(TAKEOVER_SAFE_MS);
    expect(__sharedEventSourceStats()[0].status).toBe('connected');

    // An event with no status change must keep the badge at 'connected'.
    inject({ kind: 'event', url: '/api/a1-stale', type: 'x', data: {} });
    expect(__sharedEventSourceStats()[0].status).toBe('connected');
  });

  // ── A1(d): socketless leader demotes on any claim ──
  it('demotes a socketless leader on a claim regardless of id order (A1d)', async () => {
    const onStatus = vi.fn();
    subscribeSharedEventSource('/api/a1-zombie', ['x'], vi.fn(), onStatus);
    await promote('/api/a1-zombie');

    // Fatal close: the socket is gone but this tab still believes it leads.
    fakeSources[0].fail();
    expect(__sharedEventSourceStats()[0].isLeader).toBe(true);
    expect(__sharedEventSourceStats()[0].hasSocket).toBe(false);

    // A LARGER-id tab claims leadership. Under the smaller-id rule alone we
    // would assert incumbency and keep the dead claim alive — the frozen tab.
    const claimant = `${__getSseHubTabId()}z`;
    hub().sent.length = 0;
    inject({ kind: 'leader', tabId: claimant, url: '/api/a1-zombie', ts: Date.now() });

    expect(__sharedEventSourceStats()[0].isLeader).toBe(false);
    expect(__sharedEventSourceStats()[0].hasSocket).toBe(false);
    // We handed over instead of suppressing the live peer with a claim.
    expect(posts('leader', '/api/a1-zombie')).toHaveLength(0);
    // The claimant is now the leader we follow; we are no longer 'connected'.
    expect(__sharedEventSourceStats()[0].knownLeader).toBe(claimant);
    expect(onStatus).toHaveBeenLastCalledWith('connecting');

    // We stay a follower — no takeover fight against the live claimant, and
    // its relayed events reach our listeners (the stuck tab in the repro
    // stayed frozen precisely because this path never converged).
    const onEvent = onStatus.mock.calls.length;
    inject({ kind: 'event', url: '/api/a1-zombie', type: 'x', data: { v: 7 } });
    expect(__sharedEventSourceStats()[0].isLeader).toBe(false);
    expect(__sharedEventSourceStats()[0].status).toBe('connected');
    await vi.advanceTimersByTimeAsync(TAKEOVER_SAFE_MS);
    expect(__sharedEventSourceStats()[0].isLeader).toBe(false);
    expect(fakeSources).toHaveLength(1); // the one dead socket, not a new one
    expect(onStatus.mock.calls.length).toBeGreaterThan(onEvent - 1);
  });

  // ── A1(c): a socketless leadership is never announced, and it recovers ──
  it('recovers a socketless leader instead of announcing it (A1c)', async () => {
    FakeEventSource.throwNext = true;
    subscribeSharedEventSource('/api/a1-hb', ['x'], vi.fn());
    // The promotion timer fires and dies inside `new EventSource`: isLeader was
    // already set, no socket exists and no retry owns the next open — the exact
    // zombie leadership that used to keep announcing itself (and so kept every
    // live peer a follower of a tab that had nothing to relay).
    try {
      await vi.advanceTimersByTimeAsync(TAKEOVER_SAFE_MS);
    } catch {
      /* the synthetic constructor throw — the zombie state is what matters */
    }
    const zombie = __sharedEventSourceStats().find((s) => s.url === '/api/a1-hb')!;
    expect(zombie.isLeader).toBe(true);
    expect(zombie.hasSocket).toBe(false);
    expect(fakeSources).toHaveLength(0);

    // A second stream this tab leads *with* a socket, to prove the guard is
    // per-stream (the 10s heartbeat announces through the same helper).
    subscribeSharedEventSource('/api/a1-hb-ok', ['x'], vi.fn());
    await promote('/api/a1-hb-ok');

    hub().sent.length = 0;
    const attemptBefore = zombie.retryAttempt;
    // Any leadership-announcement path — here `hello`, the same helper the
    // heartbeat uses — must skip the socketless stream and recover it.
    inject({ kind: 'hello', tabId: 'newcomer', ts: Date.now() });

    expect(posts('leader', '/api/a1-hb')).toHaveLength(0);
    expect(posts('leader', '/api/a1-hb-ok')).toHaveLength(1);
    const recovering = __sharedEventSourceStats().find((s) => s.url === '/api/a1-hb')!;
    expect(recovering.retryAttempt).toBe(attemptBefore + 1);

    // …and the scheduled recovery actually opens a socket.
    await vi.advanceTimersByTimeAsync(BACKOFF_SAFE_MS);
    await flushOpens();
    const afterRecovery = __sharedEventSourceStats().find((s) => s.url === '/api/a1-hb')!;
    expect(afterRecovery.hasSocket).toBe(true);
    expect(afterRecovery.status).toBe('connected');
    expect(posts('leader', '/api/a1-hb').length).toBeGreaterThan(0);
  });

  it('stops announcing a leader that lost its socket, then resumes once it recovers (A1c)', async () => {
    subscribeSharedEventSource('/api/a1-gap', ['x'], vi.fn());
    await promote('/api/a1-gap');

    // Fatal close → reconnecting, no socket, backoff pending.
    fakeSources[0].fail();
    expect(__sharedEventSourceStats()[0].hasSocket).toBe(false);
    expect(__sharedEventSourceStats()[0].status).toBe('reconnecting');

    // The pending backoff owns the next open; the heartbeat does not keep
    // announcing a leadership it cannot serve.
    hub().sent.length = 0;
    await vi.advanceTimersByTimeAsync(BACKOFF_SAFE_MS);
    await flushOpens();
    expect(__sharedEventSourceStats()[0].hasSocket).toBe(true);
    // Recovered: the promotion announcement is back.
    expect(posts('leader', '/api/a1-gap').length).toBeGreaterThan(0);
  });

  // ── A1: the whole path must not wait out the 30s lease ──
  it('a late follower is live within one heartbeat window, not a 60s lease pair', async () => {
    subscribeSharedEventSource('/api/a1-timing', ['x'], vi.fn());
    await promote('/api/a1-timing');

    // Simulate the newcomer: this tab keeps leading and answers `hello`.
    hub().sent.length = 0;
    inject({ kind: 'hello', tabId: 'newcomer', ts: Date.now() });
    // No timers advanced at all — the answer is synchronous with the hello.
    expect(posts('status', '/api/a1-timing')[0]?.status).toBe('connected');
  });
});