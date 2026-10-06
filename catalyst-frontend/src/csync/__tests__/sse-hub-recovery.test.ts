/**
 * SSE hub robustness — F14 coverage for the remediation paths:
 * - P0.5: fatal EventSource close must recover with exponential backoff.
 * - P2.5: half-open watchdog armed only by a named `ping` heartbeat.
 * - P2.2: global status API (subscribeSharedStatus / getSharedStreamStatus).
 * - F14: follower-takeover path over BroadcastChannel.
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  subscribeSharedEventSource,
  subscribeSharedStatus,
  getSharedStreamStatus,
  __sharedEventSourceStats,
  __resetSharedEventSources,
  type StreamStatus,
} from '../../services/api/sse-hub';

class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  readyState = FakeEventSource.CONNECTING;
  url: string;
  withCredentials: boolean;
  onopen: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  listeners = new Map<string, Set<(e: MessageEvent) => void>>();
  closed = false;

  constructor(url: string, opts?: { withCredentials?: boolean }) {
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

  emit(type: string, data: unknown) {
    const ev = { data: JSON.stringify(data) } as MessageEvent;
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
  }

  /** Simulate the browser reporting a connection failure at a given readyState. */
  fail(readyState: number) {
    this.readyState = readyState;
    this.onerror?.(new Event('error'));
  }
}

const fakeSources: FakeEventSource[] = [];

class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = [];
  name: string;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  closed = false;

  constructor(name: string) {
    this.name = name;
    FakeBroadcastChannel.instances.push(this);
  }

  postMessage(data: unknown) {
    if (this.closed) return;
    for (const inst of FakeBroadcastChannel.instances) {
      if (inst === this || inst.closed || inst.name !== this.name) continue;
      inst.onmessage?.({ data } as MessageEvent);
    }
  }

  close() {
    this.closed = true;
  }
}

/** Deliver a BroadcastChannel envelope as if it came from another tab. */
function deliverBc(data: unknown): void {
  const inst =
    FakeBroadcastChannel.instances[FakeBroadcastChannel.instances.length - 1];
  inst?.onmessage?.({ data } as MessageEvent);
}

/** FakeEventSource opens on a microtask — flush pending opens. */
async function flushOpens(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

/** First backoff is ~1000–1249 ms; 1300 ms covers it, 900 ms does not. */
const BACKOFF_SAFE_MS = 1_300;

describe('sse-hub robustness: fatal recovery, watchdog, status API', () => {
  const statusUnsubs: Array<() => void> = [];

  beforeEach(() => {
    fakeSources.length = 0;
    FakeBroadcastChannel.instances = [];
    __resetSharedEventSources();
    vi.useFakeTimers();
    vi.stubGlobal('EventSource', FakeEventSource as any);
    vi.stubGlobal('BroadcastChannel', undefined as any);
  });

  afterEach(() => {
    for (const off of statusUnsubs) off();
    statusUnsubs.length = 0;
    __resetSharedEventSources();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // ── P0.5 (a): fatal CLOSED → recovery re-creates the EventSource ──
  it('recovers a fatal CLOSED error with backoff re-open (P0.5)', async () => {
    const statuses: StreamStatus[] = [];
    statusUnsubs.push(
      subscribeSharedStatus((url, status) => {
        if (url !== '/api/fatal') return;
        if (statuses[statuses.length - 1] !== status) statuses.push(status);
      }),
    );

    subscribeSharedEventSource('/api/fatal', ['resource_stats'], vi.fn());
    await flushOpens();
    expect(fakeSources).toHaveLength(1);
    expect(statuses).toEqual(['connected']);

    // Fatal handshake failure: browser closes the EventSource permanently.
    fakeSources[0].fail(FakeEventSource.CLOSED);
    expect(__sharedEventSourceStats()[0].status).toBe('reconnecting');
    expect(__sharedEventSourceStats()[0].hasSocket).toBe(false);
    expect(getSharedStreamStatus('/api/fatal')).toBe('reconnecting');

    // Not before the backoff elapses…
    await vi.advanceTimersByTimeAsync(900);
    expect(fakeSources).toHaveLength(1);
    // …but shortly after the first backoff window (~1s + jitter ≤250ms).
    await vi.advanceTimersByTimeAsync(400);
    await flushOpens();
    expect(fakeSources).toHaveLength(2);
    expect(__sharedEventSourceStats()[0].status).toBe('connected');
    expect(__sharedEventSourceStats()[0].hasSocket).toBe(true);
    expect(statuses).toEqual(['connected', 'reconnecting', 'connected']);
  });

  // ── P0.5 (b): backoff resets on open ──
  it('resets the backoff after a successful open (P0.5)', async () => {
    subscribeSharedEventSource('/api/backoff', ['x'], vi.fn());
    await flushOpens();

    fakeSources[0].fail(FakeEventSource.CLOSED);
    expect(__sharedEventSourceStats()[0].retryAttempt).toBe(1);

    await vi.advanceTimersByTimeAsync(BACKOFF_SAFE_MS);
    await flushOpens();
    expect(fakeSources).toHaveLength(2);
    // A successful open resets the backoff step.
    expect(__sharedEventSourceStats()[0].retryAttempt).toBe(0);

    fakeSources[1].fail(FakeEventSource.CLOSED);
    expect(__sharedEventSourceStats()[0].retryAttempt).toBe(1);
    // Still the first step (~1s), not the second (~2s): 1300 ms must suffice.
    await vi.advanceTimersByTimeAsync(BACKOFF_SAFE_MS);
    await flushOpens();
    expect(fakeSources).toHaveLength(3);
    expect(__sharedEventSourceStats()[0].status).toBe('connected');
  });

  // ── P0.5 (c): no retry after teardown / refCount 0 ──
  it('stops recovering once the last subscriber tears the stream down (P0.5)', async () => {
    const unsub = subscribeSharedEventSource('/api/teardown', ['x'], vi.fn());
    await flushOpens();
    fakeSources[0].fail(FakeEventSource.CLOSED);
    expect(__sharedEventSourceStats()).toHaveLength(1);

    unsub();
    expect(__sharedEventSourceStats()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0); // backoff + connecting guard cleared

    await vi.advanceTimersByTimeAsync(60_000);
    expect(fakeSources).toHaveLength(1);
  });

  it('keeps recovering while at least one subscriber remains (P0.5)', async () => {
    const u1 = subscribeSharedEventSource('/api/partial', ['x'], vi.fn());
    subscribeSharedEventSource('/api/partial', ['x'], vi.fn());
    await flushOpens();

    fakeSources[0].fail(FakeEventSource.CLOSED);
    u1(); // refCount 2 → 1, stream must stay alive
    expect(__sharedEventSourceStats()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(BACKOFF_SAFE_MS);
    await flushOpens();
    expect(fakeSources).toHaveLength(2);
    expect(__sharedEventSourceStats()[0].status).toBe('connected');
  });

  it('clears watchdog and backoff timers on teardown (P0.5/P2.5)', async () => {
    const unsub = subscribeSharedEventSource('/api/timers', ['x'], vi.fn());
    await flushOpens();
    fakeSources[0].emit('ping', { ts: 1 }); // arms the watchdog
    expect(__sharedEventSourceStats()[0].hasWatchdog).toBe(true);
    expect(vi.getTimerCount()).toBe(1);

    fakeSources[0].fail(FakeEventSource.CLOSED); // swaps watchdog for backoff+guard
    unsub();
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(120_000);
    expect(fakeSources).toHaveLength(1);
  });

  // ── P0.5: repeated error cycles without an open ──
  it('recovers after repeated error cycles without an open (P0.5)', async () => {
    subscribeSharedEventSource('/api/cycles', ['x'], vi.fn());
    await flushOpens();

    fakeSources[0].fail(FakeEventSource.CONNECTING);
    fakeSources[0].fail(FakeEventSource.CONNECTING);
    // Two auto-retry failures still trust the browser — no re-create yet.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fakeSources).toHaveLength(1);
    expect(__sharedEventSourceStats()[0].status).toBe('reconnecting');

    fakeSources[0].fail(FakeEventSource.CONNECTING); // third: take over
    expect(__sharedEventSourceStats()[0].hasSocket).toBe(false);
    await vi.advanceTimersByTimeAsync(BACKOFF_SAFE_MS);
    await flushOpens();
    expect(fakeSources).toHaveLength(2);
    expect(__sharedEventSourceStats()[0].status).toBe('connected');
  });

  // ── P2.5 (d): watchdog disarmed without ping, armed with ping ──
  it('keeps the watchdog disarmed until a ping event arrives (P2.5)', async () => {
    subscribeSharedEventSource('/api/watch-off', ['resource_stats'], vi.fn());
    await flushOpens();
    fakeSources[0].emit('resource_stats', { cpuPercent: 1 });

    expect(__sharedEventSourceStats()[0].hasWatchdog).toBe(false);
    await vi.advanceTimersByTimeAsync(120_000);
    // No ping ever arrived — backend not yet updated: zero reconnect churn.
    expect(fakeSources).toHaveLength(1);
    expect(fakeSources[0].closed).toBe(false);
    expect(__sharedEventSourceStats()[0].status).toBe('connected');
    expect(__sharedEventSourceStats()[0].seenPing).toBe(false);
  });

  it('force-reconnects after 70s of silence once a ping was seen (P2.5)', async () => {
    subscribeSharedEventSource('/api/watch-on', ['resource_stats'], vi.fn());
    await flushOpens();
    fakeSources[0].emit('ping', { ts: 1 });
    expect(__sharedEventSourceStats()[0].hasWatchdog).toBe(true);
    expect(__sharedEventSourceStats()[0].seenPing).toBe(true);

    await vi.advanceTimersByTimeAsync(70_000);
    // Force-closed and moved onto the P0.5 backoff path.
    expect(fakeSources[0].closed).toBe(true);
    expect(__sharedEventSourceStats()[0].hasSocket).toBe(false);
    expect(__sharedEventSourceStats()[0].status).toBe('reconnecting');

    await vi.advanceTimersByTimeAsync(BACKOFF_SAFE_MS);
    await flushOpens();
    expect(fakeSources).toHaveLength(2);
    expect(__sharedEventSourceStats()[0].status).toBe('connected');
    // Watchdog re-armed for the new socket.
    expect(__sharedEventSourceStats()[0].hasWatchdog).toBe(true);
  });

  it('pushes the watchdog deadline out on every subsequent ping (P2.5)', async () => {
    subscribeSharedEventSource('/api/watch-refresh', ['x'], vi.fn());
    await flushOpens();
    fakeSources[0].emit('ping', { ts: 1 });

    await vi.advanceTimersByTimeAsync(69_000);
    fakeSources[0].emit('ping', { ts: 2 }); // heartbeat keeps arriving
    await vi.advanceTimersByTimeAsync(69_000);
    expect(fakeSources[0].closed).toBe(false); // still inside the refreshed window
    expect(__sharedEventSourceStats()[0].status).toBe('connected');

    await vi.advanceTimersByTimeAsync(2_000); // crosses the refreshed 70s deadline
    expect(fakeSources[0].closed).toBe(true);
    expect(__sharedEventSourceStats()[0].status).toBe('reconnecting');
  });

  // ── P2.2 (e): global status API ──
  it('subscribeSharedStatus receives connected → reconnecting → connected (P2.2/F14)', async () => {
    const events: Array<{ url: string; status: StreamStatus; prev: StreamStatus }> = [];
    statusUnsubs.push(
      subscribeSharedStatus((url, status, prev) => {
        events.push({ url, status, prev });
      }),
    );

    const perStream: StreamStatus[] = [];
    subscribeSharedEventSource('/api/status', ['x'], vi.fn(), (s) => perStream.push(s));
    await flushOpens();

    fakeSources[0].fail(FakeEventSource.CLOSED);
    await vi.advanceTimersByTimeAsync(BACKOFF_SAFE_MS);
    await flushOpens();

    expect(events.map((e) => e.status)).toEqual(['connected', 'reconnecting', 'connected']);
    expect(events.map((e) => e.url)).toEqual(['/api/status', '/api/status', '/api/status']);
    expect(events[1]).toEqual({ url: '/api/status', status: 'reconnecting', prev: 'connected' });
    expect(events[2]).toEqual({ url: '/api/status', status: 'connected', prev: 'reconnecting' });
    // Existing per-stream onStatus behavior is untouched.
    expect(perStream[0]).toBe('connecting');
    expect(perStream).toContain('connected');
    expect(perStream).toContain('reconnecting');
  });

  it('getSharedStreamStatus reports unknown urls as undefined and stops after unsubscribe (P2.2)', async () => {
    expect(getSharedStreamStatus('/api/none')).toBeUndefined();

    const seen: StreamStatus[] = [];
    statusUnsubs.push(
      subscribeSharedStatus((_url, status) => {
        seen.push(status);
      }),
    );

    const unsub = subscribeSharedEventSource('/api/known', ['x'], vi.fn());
    await flushOpens();
    expect(getSharedStreamStatus('/api/known')).toBe('connected');

    // Streams created after the status subscription are covered too.
    const unsub2 = subscribeSharedEventSource('/api/known-2', ['x'], vi.fn());
    await flushOpens();
    expect(getSharedStreamStatus('/api/known-2')).toBe('connected');
    expect(seen).toEqual(['connected', 'connected']);

    unsub();
    unsub2();
    expect(getSharedStreamStatus('/api/known')).toBeUndefined();
    expect(getSharedStreamStatus('/api/known-2')).toBeUndefined();
  });

  // ── F14 (f): follower takeover over BroadcastChannel ──
  it('follower takeover still works: demote on remote leader, takeover on release (F14)', async () => {
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel as any);

    subscribeSharedEventSource('/api/follower', ['x'], vi.fn());
    // B3: with BC available, first-time subscribers wait out the takeover
    // window (~900ms + jitter) instead of promoting synchronously.
    expect(__sharedEventSourceStats()[0].isLeader).toBe(false);
    expect(__sharedEventSourceStats()[0].hasSocket).toBe(false);
    await vi.advanceTimersByTimeAsync(1_300);
    await flushOpens();
    expect(__sharedEventSourceStats()[0].isLeader).toBe(true);
    expect(__sharedEventSourceStats()[0].hasSocket).toBe(true);
    expect(fakeSources[0].closed).toBe(false);

    // A remote tab with a smaller id claims leadership → we demote.
    deliverBc({ kind: 'leader', tabId: '', url: '/api/follower', ts: Date.now() });
    expect(__sharedEventSourceStats()[0].isLeader).toBe(false);
    expect(__sharedEventSourceStats()[0].hasSocket).toBe(false);
    expect(fakeSources[0].closed).toBe(true);
    expect(__sharedEventSourceStats()[0].status).toBe('connecting');

    // Remote leader releases (or dies) → we take over after the election delay.
    deliverBc({ kind: 'release', tabId: '', url: '/api/follower', ts: Date.now() });
    await vi.advanceTimersByTimeAsync(1_300);
    await flushOpens();
    expect(fakeSources).toHaveLength(2);
    expect(__sharedEventSourceStats()[0].isLeader).toBe(true);
    expect(__sharedEventSourceStats()[0].hasSocket).toBe(true);
    expect(__sharedEventSourceStats()[0].status).toBe('connected');
  });
});
