/**
 * useStreamRecovery — P2.2 missed-event repair.
 *
 * Verifies the recovery rule and the reconnect-storm coalescing: only a
 * transition into 'connected' from a genuinely lost state re-syncs, and rapid
 * flapping collapses to at most one full re-sync per window.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { StreamStatus } from '../../services/api/sse-hub';

// Capture the global listener the hook installs so tests can drive transitions.
type Listener = (url: string, status: StreamStatus, prev: StreamStatus) => void;
let listeners: Listener[];
let unsubscribed: number;

vi.mock('../../services/api/sse-hub', () => ({
  subscribeSharedStatus: (cb: Listener) => {
    listeners.push(cb);
    return () => {
      unsubscribed += 1;
      listeners = listeners.filter((l) => l !== cb);
    };
  },
}));

import { useStreamRecovery, RECOVERY_DEBOUNCE_MS, type RecoveryTarget } from '../useStreamRecovery';

const URL = '/api/admin/events';

/** Minimal QueryClient-shaped spy for the hook. */
function createClientSpy() {
  return {
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
  } as unknown as RecoveryTarget & {
    invalidateQueries: ReturnType<typeof vi.fn>;
  };
}

function fire(status: StreamStatus, prev: StreamStatus, url = URL) {
  // Snapshot so a listener that unsubscribes itself is still invoked safely.
  for (const l of [...listeners]) l(url, status, prev);
}

/** Model a normal session: the initial connect, then a loss, then recovery. */
function connect() {
  act(() => fire('connected', 'connecting'));
}
function drop() {
  act(() => fire('reconnecting', 'connected'));
}
function recover() {
  act(() => fire('connected', 'reconnecting'));
}

describe('useStreamRecovery', () => {
  beforeEach(() => {
    listeners = [];
    unsubscribed = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('re-syncs exactly once on a reconnect (non-connected → connected)', () => {
    const client = createClientSpy();
    renderHook(() => useStreamRecovery(client));
    expect(listeners).toHaveLength(1);

    connect(); // initial connect — must NOT sync
    expect(client.invalidateQueries).not.toHaveBeenCalled();

    drop();
    recover(); // recovered

    expect(client.invalidateQueries).toHaveBeenCalledTimes(1);
    // No filters → invalidate everything (marks all stale, refetches active).
    expect(client.invalidateQueries).toHaveBeenCalledWith({});
  });

  it('does NOT re-sync on an initial connect', () => {
    const client = createClientSpy();
    renderHook(() => useStreamRecovery(client));

    // Fresh page load: connecting → connected with nothing ever lost.
    act(() => fire('connected', 'connecting'));

    expect(client.invalidateQueries).not.toHaveBeenCalled();
  });

  it('does NOT treat a first transition from an unknown state as a recovery', () => {
    const client = createClientSpy();
    renderHook(() => useStreamRecovery(client));

    act(() => fire('connected', undefined as unknown as StreamStatus));

    expect(client.invalidateQueries).not.toHaveBeenCalled();
  });

  it('coalesces rapid flapping to one re-sync, then re-syncs after the window', () => {
    const client = createClientSpy();
    renderHook(() => useStreamRecovery(client));
    connect();

    // First recovery fires immediately (leading edge).
    drop();
    recover();
    expect(client.invalidateQueries).toHaveBeenCalledTimes(1);

    // A storm inside the window must not add a second sync.
    drop();
    act(() => fire('connected', 'error'));
    expect(client.invalidateQueries).toHaveBeenCalledTimes(1);

    // ...but the trailing catch-up fires once when the window closes, so the
    // flapped-out state is still repaired.
    act(() => {
      vi.advanceTimersByTime(RECOVERY_DEBOUNCE_MS);
    });
    expect(client.invalidateQueries).toHaveBeenCalledTimes(2);

    // A recovery after the window (leading edge again) syncs immediately.
    act(() => {
      vi.advanceTimersByTime(RECOVERY_DEBOUNCE_MS);
    });
    drop();
    recover();
    expect(client.invalidateQueries).toHaveBeenCalledTimes(3);
  });

  it('does not schedule a trailing sync when a fresh sync lands inside the window', () => {
    const client = createClientSpy();
    renderHook(() => useStreamRecovery(client));
    connect();

    drop();
    recover(); // leading sync at t=0
    drop();
    recover(); // inside window → trailing armed
    act(() => {
      vi.advanceTimersByTime(RECOVERY_DEBOUNCE_MS);
    });
    expect(client.invalidateQueries).toHaveBeenCalledTimes(2);

    // Nothing further should fire without a new transition.
    act(() => {
      vi.advanceTimersByTime(RECOVERY_DEBOUNCE_MS * 3);
    });
    expect(client.invalidateQueries).toHaveBeenCalledTimes(2);
  });

  it('unsubscribes on unmount, so later transitions do nothing', () => {
    const client = createClientSpy();
    const { unmount } = renderHook(() => useStreamRecovery(client));

    expect(listeners).toHaveLength(1);
    unmount();
    expect(unsubscribed).toBe(1);
    expect(listeners).toHaveLength(0);

    // Any transition that slips through after unmount is not reacted to.
    connect();
    drop();
    recover();
    expect(client.invalidateQueries).not.toHaveBeenCalled();
  });

  it('is StrictMode-safe: mount/unmount/remount leaves exactly one listener', () => {
    const client = createClientSpy();
    const { unmount } = renderHook(() => useStreamRecovery(client));
    expect(listeners).toHaveLength(1);

    // StrictMode double-invokes the effect: unmount, then mount again.
    unmount();
    const { unmount: unmount2 } = renderHook(() => useStreamRecovery(client));
    expect(listeners).toHaveLength(1);

    // Only one listener ever reacts, so a recovery = exactly one re-sync.
    connect();
    drop();
    recover();
    expect(client.invalidateQueries).toHaveBeenCalledTimes(1);
    unmount2();
  });

  it('keeps separate streams independent for the initial-connect guard', () => {
    const client = createClientSpy();
    renderHook(() => useStreamRecovery(client));

    // Initial connects of two distinct streams must neither re-sync.
    act(() => fire('connected', 'connecting', '/api/admin/events'));
    act(() => fire('connected', 'connecting', '/api/servers/all-servers/events'));
    expect(client.invalidateQueries).not.toHaveBeenCalled();

    // A recovery on one stream re-syncs (all queries, once).
    act(() => fire('reconnecting', 'connected', '/api/admin/events'));
    act(() => fire('connected', 'reconnecting', '/api/admin/events'));
    expect(client.invalidateQueries).toHaveBeenCalledTimes(1);
  });

  // ── P2-12: wasDisconnected semantics ──
  it('does NOT count stream recreation on navigation as a recovery (P2-12)', () => {
    const client = createClientSpy();
    renderHook(() => useStreamRecovery(client));
    connect();

    // Navigation tears the stream down (the hub announces 'closed' at refCount
    // 0) and the next page recreates the same URL: connecting → connected.
    // An intentional teardown is not a connection loss — no re-sync.
    act(() => fire('closed', 'connected', URL));
    act(() => fire('connected', 'connecting', URL));
    expect(client.invalidateQueries).not.toHaveBeenCalled();

    // A genuine loss on the recreated stream still repairs.
    drop();
    recover();
    expect(client.invalidateQueries).toHaveBeenCalledTimes(1);
  });

  it('still recovers when a genuine loss preceded the teardown (P2-12)', () => {
    const client = createClientSpy();
    renderHook(() => useStreamRecovery(client));
    connect();

    // The stream left 'connected' through a real loss, then was torn down
    // mid-outage and recreated — events were missed, so the reconnect repairs.
    drop();
    act(() => fire('closed', 'reconnecting', URL));
    act(() => fire('connected', 'connecting', URL));
    expect(client.invalidateQueries).toHaveBeenCalledTimes(1);
  });

  it('counts a loss observed via any non-connected status (P2-12)', () => {
    const client = createClientSpy();
    renderHook(() => useStreamRecovery(client));

    // Never saw the initial connect (mounted mid-session), but an 'error'
    // followed by 'connected' is an observable loss → recovery.
    act(() => fire('error', 'connecting', URL));
    act(() => fire('connected', 'error', URL));
    expect(client.invalidateQueries).toHaveBeenCalledTimes(1);
  });

  it('issues exactly one unfiltered invalidate-all per re-sync', () => {
    const client = createClientSpy();
    renderHook(() => useStreamRecovery(client));
    connect();
    drop();
    recover();

    expect(client.invalidateQueries).toHaveBeenCalledTimes(1);
    // A bare `{}` filter — no queryKey/predicate — so every cached query is
    // marked stale (and active observers refetch).
    const filters = client.invalidateQueries.mock.calls[0][0];
    expect(filters).toEqual({});
    expect(Object.keys(filters)).toHaveLength(0);
  });
});
