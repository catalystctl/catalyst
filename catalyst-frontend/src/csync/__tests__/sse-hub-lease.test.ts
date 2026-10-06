/**
 * SSE hub — P0-C orphaned-follower hardening + election convergence:
 * - A1: leader heartbeat re-announces every led URL.
 * - A2: follower lease expiry takes over from a silently dead leader.
 * - A3: a leader claim from ANY tab is accepted once the recorded lease lapsed.
 * - B1/B2: hello + larger-id challenges trigger incumbency re-announcements.
 * - C (P1-21): a stalled connect recovers via the fatal-close path.
 * - D2: getSharedStreamSnapshot.
 * - D3: late event types are announced over BC and bound by the leader.
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  subscribeSharedEventSource,
  getSharedStreamSnapshot,
  __sharedEventSourceStats,
  __resetSharedEventSources,
  __getSseHubTabId,
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
}

/** EventSource that never opens — models a stalled/buffered connect (C). */
class StalledEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  readyState = StalledEventSource.CONNECTING;
  url: string;
  withCredentials: boolean;
  onopen: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  listeners = new Map<string, Set<(e: MessageEvent) => void>>();
  closed = false;

  constructor(url: string, opts?: { withCredentials?: boolean }) {
    this.url = url;
    this.withCredentials = Boolean(opts?.withCredentials);
    stalledSources.push(this);
    // deliberately no open microtask — the connect stalls forever
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
    this.readyState = StalledEventSource.CLOSED;
  }
}

const fakeSources: FakeEventSource[] = [];
const stalledSources: StalledEventSource[] = [];

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

/** The hub's own channel instance (created by ensureBroadcast). */
function hub(): RecordingBC {
  return RecordingBC.instances[0];
}

/** Deliver a BroadcastChannel envelope as if it came from another tab. */
function inject(msg: unknown): void {
  hub().onmessage?.({ data: msg } as MessageEvent);
}

function sentLeaders(url: string): unknown[] {
  return hub().sent.filter((m) => (m as any).kind === 'leader' && (m as any).url === url);
}

/** FakeEventSource opens on a microtask — flush pending opens. */
async function flushOpens(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

/** B3: first-time subscribers wait ~900ms + jitter before promoting. */
const TAKEOVER_SAFE_MS = 1_300;

describe('sse-hub leader lease, heartbeat and election convergence', () => {
  beforeEach(() => {
    fakeSources.length = 0;
    stalledSources.length = 0;
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

  // ── A1: leader heartbeat ──
  it('leader re-announces itself on a 10s heartbeat and stops after teardown (A1)', async () => {
    const unsub = subscribeSharedEventSource('/api/hb', ['x'], vi.fn());
    await vi.advanceTimersByTimeAsync(TAKEOVER_SAFE_MS);
    await flushOpens();
    expect(__sharedEventSourceStats()[0].isLeader).toBe(true);
    expect(sentLeaders('/api/hb')).toHaveLength(1); // promotion announcement

    await vi.advanceTimersByTimeAsync(10_000);
    expect(sentLeaders('/api/hb')).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sentLeaders('/api/hb')).toHaveLength(3);

    // Teardown stops the shared heartbeat interval.
    unsub();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(sentLeaders('/api/hb')).toHaveLength(3);
  });

  // ── A2: follower lease expiry takeover ──
  it('follower takes over when the leader dies silently (lease expiry, A2)', async () => {
    const smaller = __getSseHubTabId().slice(0, -1); // lexicographically smaller → legit leader
    subscribeSharedEventSource('/api/orphan', ['x'], vi.fn());
    inject({ kind: 'leader', tabId: smaller, url: '/api/orphan', ts: Date.now() });
    inject({ kind: 'status', url: '/api/orphan', status: 'connected' });

    await vi.advanceTimersByTimeAsync(TAKEOVER_SAFE_MS);
    // We defer to the smaller id: follower, mirrored 'connected', no socket.
    expect(__sharedEventSourceStats()[0].isLeader).toBe(false);
    expect(__sharedEventSourceStats()[0].knownLeader).toBe(smaller);
    expect(__sharedEventSourceStats()[0].status).toBe('connected');
    expect(fakeSources).toHaveLength(0);

    // Leader dies without bye/beforeunload: no further traffic at all.
    // Lease (30s) expires; the 10s check clears knownLeader and takes over,
    // including resetting the stale 'connected' mirror.
    await vi.advanceTimersByTimeAsync(45_000);
    await vi.advanceTimersByTimeAsync(TAKEOVER_SAFE_MS);
    await flushOpens();
    expect(__sharedEventSourceStats()[0].isLeader).toBe(true);
    expect(__sharedEventSourceStats()[0].hasSocket).toBe(true);
    expect(__sharedEventSourceStats()[0].status).toBe('connected');
    expect(fakeSources).toHaveLength(1);
  });

  it('a heartbeating leader keeps the follower lease alive (A2)', async () => {
    const smaller = __getSseHubTabId().slice(0, -1);
    subscribeSharedEventSource('/api/lease', ['x'], vi.fn());
    // 60s of 10s heartbeats: the lease never lapses → no takeover.
    for (let i = 0; i < 6; i++) {
      inject({ kind: 'leader', tabId: smaller, url: '/api/lease', ts: Date.now() });
      await vi.advanceTimersByTimeAsync(10_000);
    }
    expect(__sharedEventSourceStats()[0].isLeader).toBe(false);
    expect(fakeSources).toHaveLength(0);

    // Silence past the 30s lease → takeover on the next check.
    await vi.advanceTimersByTimeAsync(45_000);
    await vi.advanceTimersByTimeAsync(TAKEOVER_SAFE_MS);
    await flushOpens();
    expect(__sharedEventSourceStats()[0].isLeader).toBe(true);
    expect(fakeSources).toHaveLength(1);
  });

  // ── A3: leader claims accepted after lease expiry ──
  it('accepts a larger-id leader claim once the recorded lease expired (A3)', async () => {
    const tab = __getSseHubTabId();
    const leaderA = tab.slice(0, -2); // smaller than both leaderB and us
    const leaderB = tab.slice(0, -1);
    subscribeSharedEventSource('/api/a3', ['x'], vi.fn());
    inject({ kind: 'leader', tabId: leaderA, url: '/api/a3', ts: Date.now() });
    await vi.advanceTimersByTimeAsync(TAKEOVER_SAFE_MS);
    expect(__sharedEventSourceStats()[0].isLeader).toBe(false);
    expect(__sharedEventSourceStats()[0].knownLeader).toBe(leaderA);

    // t≈31s: leaderA's lease (t0+30s) has lapsed. leaderB (> leaderA) claims
    // leadership — the claim must be accepted despite the larger id.
    await vi.advanceTimersByTimeAsync(30_000);
    inject({ kind: 'leader', tabId: leaderB, url: '/api/a3', ts: Date.now() });
    expect(__sharedEventSourceStats()[0].knownLeader).toBe(leaderB);

    // A stale release from the dead leaderA must now be ignored (it no longer
    // matches knownLeader), and leaderB's fresh lease blocks our takeover.
    inject({ kind: 'release', tabId: leaderA, url: '/api/a3', ts: Date.now() });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(__sharedEventSourceStats()[0].isLeader).toBe(false);
    expect(__sharedEventSourceStats()[0].hasSocket).toBe(false);
    expect(__sharedEventSourceStats()[0].knownLeader).toBe(leaderB);
  });

  // ── B1: hello re-announcement ──
  it('re-announces leadership when a new tab says hello (B1)', async () => {
    subscribeSharedEventSource('/api/b1', ['x'], vi.fn());
    await vi.advanceTimersByTimeAsync(TAKEOVER_SAFE_MS);
    await flushOpens();
    expect(__sharedEventSourceStats()[0].isLeader).toBe(true);

    hub().sent.length = 0;
    inject({ kind: 'hello', tabId: 'newcomer', ts: Date.now() });
    expect(sentLeaders('/api/b1')).toHaveLength(1);
  });

  // ── B2: incumbency assertion ──
  it('asserts incumbency when a larger-id tab claims leadership (B2)', async () => {
    subscribeSharedEventSource('/api/b2', ['x'], vi.fn());
    await vi.advanceTimersByTimeAsync(TAKEOVER_SAFE_MS);
    await flushOpens();
    expect(__sharedEventSourceStats()[0].isLeader).toBe(true);

    const challenger = `${__getSseHubTabId()}z`; // lexicographically larger
    hub().sent.length = 0;
    inject({ kind: 'leader', tabId: challenger, url: '/api/b2', ts: Date.now() });
    // We stay leader and re-post our (smaller) id so the challenger defers.
    expect(__sharedEventSourceStats()[0].isLeader).toBe(true);
    expect(__sharedEventSourceStats()[0].hasSocket).toBe(true);
    const rePosts = hub().sent.filter(
      (m) => (m as any).kind === 'leader' && (m as any).tabId === __getSseHubTabId(),
    );
    expect(rePosts).toHaveLength(1);
  });

  // ── B3: first-time subscriber waits out the takeover window ──
  it('first-time subscriber does not promote synchronously when BC exists (B3)', async () => {
    subscribeSharedEventSource('/api/b3', ['x'], vi.fn());
    expect(__sharedEventSourceStats()[0].isLeader).toBe(false);
    expect(fakeSources).toHaveLength(0);
    // An incumbent announcing inside the window keeps us a follower.
    const smaller = __getSseHubTabId().slice(0, -1);
    inject({ kind: 'leader', tabId: smaller, url: '/api/b3', ts: Date.now() });
    await vi.advanceTimersByTimeAsync(TAKEOVER_SAFE_MS);
    await flushOpens();
    expect(__sharedEventSourceStats()[0].isLeader).toBe(false);
    expect(fakeSources).toHaveLength(0);
  });

  // ── C (P1-21): stalled connect ──
  it('routes a stalled connect through the fatal-close recovery (C/P1-21)', async () => {
    vi.stubGlobal('BroadcastChannel', undefined as any);
    vi.stubGlobal('EventSource', StalledEventSource as any);
    subscribeSharedEventSource('/api/stalled', ['x'], vi.fn());
    expect(stalledSources).toHaveLength(1);
    expect(__sharedEventSourceStats()[0].status).toBe('connecting');

    // 8s guard: previously left status 'error' with the dead socket attached
    // and no retry path; now the socket is closed and a backoff re-open runs.
    await vi.advanceTimersByTimeAsync(8_000);
    expect(stalledSources[0].closed).toBe(true);
    expect(__sharedEventSourceStats()[0].hasSocket).toBe(false);
    expect(__sharedEventSourceStats()[0].status).toBe('reconnecting');

    await vi.advanceTimersByTimeAsync(TAKEOVER_SAFE_MS);
    expect(stalledSources).toHaveLength(2);
    expect(__sharedEventSourceStats()[0].retryAttempt).toBe(1);
  });

  // ── D2: snapshot accessor ──
  it('getSharedStreamSnapshot reflects the live streams map (D2)', async () => {
    vi.stubGlobal('BroadcastChannel', undefined as any);
    expect(getSharedStreamSnapshot()).toEqual([]);

    const unsub = subscribeSharedEventSource('/api/snap', ['x'], vi.fn());
    await flushOpens();
    const snap = getSharedStreamSnapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0]).toEqual({
      url: '/api/snap',
      status: 'connected',
      lastMessageAt: expect.any(Number),
      isLeader: true,
      refCount: 1,
    });
    expect(snap[0].lastMessageAt).toBeGreaterThan(0);

    unsub();
    expect(getSharedStreamSnapshot()).toEqual([]);
  });

  // ── D3: late event types ──
  it('announces late event types over BC and the leader binds them (D3)', async () => {
    subscribeSharedEventSource('/api/types', ['x'], vi.fn());
    // Pre-leader attach is announced so whoever owns the socket can bind it.
    expect(
      hub().sent.some(
        (m) =>
          (m as any).kind === 'types' &&
          (m as any).url === '/api/types' &&
          ((m as any).types as string[]).includes('x'),
      ),
    ).toBe(true);

    await vi.advanceTimersByTimeAsync(TAKEOVER_SAFE_MS);
    await flushOpens();
    expect(__sharedEventSourceStats()[0].isLeader).toBe(true);

    // Leader side: a peer tab asks for an extra type; we bind it natively and
    // fan its events out over BC like any subscribed type.
    const onEvent = vi.fn();
    subscribeSharedEventSource('/api/types', ['late_type'], onEvent);
    hub().sent.length = 0;
    inject({ kind: 'types', url: '/api/types', types: ['peer_only'] });
    expect(__sharedEventSourceStats()[0].eventTypes).toContain('peer_only');
    fakeSources[0].emit('peer_only', { v: 1 });
    expect(onEvent).toHaveBeenCalledWith('peer_only', { v: 1 });
    expect(
      hub().sent.some((m) => (m as any).kind === 'event' && (m as any).type === 'peer_only'),
    ).toBe(true);
  });
});
