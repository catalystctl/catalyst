/**
 * Shared EventSource hub — ref-count + multi-subscriber behavior.
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  subscribeSharedEventSource,
  __sharedEventSourceStats,
  __resetSharedEventSources,
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

const fakeSources: FakeEventSource[] = [];

describe('sse-hub shared EventSource', () => {
  beforeEach(() => {
    fakeSources.length = 0;
    __resetSharedEventSources();
    vi.stubGlobal('EventSource', FakeEventSource as any);
    // Disable cross-tab path in unit tests — exercise ref-count + single-tab leader.
    vi.stubGlobal('BroadcastChannel', undefined as any);
  });

  afterEach(() => {
    __resetSharedEventSources();
    vi.unstubAllGlobals();
  });

  it('reuses one socket for the same URL', () => {
    const a = vi.fn();
    const b = vi.fn();
    const u1 = subscribeSharedEventSource('/api/x', ['foo'], a);
    const u2 = subscribeSharedEventSource('/api/x', ['foo', 'bar'], b);
    expect(fakeSources.length).toBe(1);
    expect(__sharedEventSourceStats()[0].refCount).toBe(2);
    u1();
    expect(__sharedEventSourceStats()[0].refCount).toBe(1);
    expect(fakeSources[0].closed).toBe(false);
    u2();
    expect(__sharedEventSourceStats().length).toBe(0);
    expect(fakeSources[0].closed).toBe(true);
  });

  it('fans events out to all subscribers', async () => {
    const a = vi.fn();
    const b = vi.fn();
    subscribeSharedEventSource('/api/y', ['resource_stats'], a);
    subscribeSharedEventSource('/api/y', ['resource_stats'], b);
    // allow open microtask
    await Promise.resolve();
    fakeSources[0].emit('resource_stats', { cpuPercent: 12, serverId: 's1' });
    expect(a).toHaveBeenCalledWith('resource_stats', expect.objectContaining({ cpuPercent: 12 }));
    expect(b).toHaveBeenCalledWith('resource_stats', expect.objectContaining({ cpuPercent: 12 }));
  });

  it('opens separate sockets for different URLs', () => {
    subscribeSharedEventSource('/api/a', ['x'], vi.fn());
    subscribeSharedEventSource('/api/b', ['x'], vi.fn());
    expect(fakeSources.length).toBe(2);
  });

  it('marks the sole tab as leader with a live socket', async () => {
    subscribeSharedEventSource('/api/z', ['ping'], vi.fn());
    await Promise.resolve();
    const stats = __sharedEventSourceStats();
    expect(stats).toHaveLength(1);
    expect(stats[0].isLeader).toBe(true);
    expect(stats[0].hasSocket).toBe(true);
  });
});
