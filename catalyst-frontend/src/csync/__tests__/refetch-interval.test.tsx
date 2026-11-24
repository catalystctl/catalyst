// @vitest-environment jsdom
/**
 * Regression tests: a set refetchInterval must keep polling regardless of
 * staleTime (TanStack semantics). Previously the interval tick called
 * fetchQuery, which serves cached data while fresh — so any poll with an
 * interval shorter than staleTime (e.g. the update progress modal polling
 * every 2s with the 60s default staleTime) froze after the first fetch and
 * only a page reload showed new data.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQuery, setFallbackQueryClient } from '../index';
import { useStreamAwareInterval } from '../../hooks/useStreamAwareInterval';
import {
  __resetSharedEventSources,
  __emitSharedStatusForTests as emitStatus,
  type StreamStatus,
} from '../../services/api/sse-hub';

function createWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client, children });
  };
}

function makeClient() {
  return new QueryClient({
    // Mirrors app defaults: 60s staleTime, no per-query staleTime override.
    defaultOptions: { queries: { retry: false, staleTime: 60_000, gcTime: 5000 } } as never,
    mutationCache: { notifyError: vi.fn(), subscribe: () => () => {} } as never,
  });
}

describe('refetchInterval ignores staleTime', () => {
  let client: QueryClient;

  beforeEach(() => {
    client = makeClient();
    setFallbackQueryClient(client);
  });

  afterEach(() => {
    client.clear();
    setFallbackQueryClient(null);
    vi.useRealTimers();
  });

  it('interval keeps fetching and updating data with default staleTime', async () => {
    let n = 0;
    const fn = vi.fn(async () => ({ logs: [`line-${++n}`] }));
    const { result, unmount } = renderHook(
      () => useQuery({ queryKey: ['live'], queryFn: fn, refetchInterval: 20 as never }),
      { wrapper: createWrapper(client) },
    );
    await waitFor(() => expect(fn.mock.calls.length).toBeGreaterThanOrEqual(3), { timeout: 2000 });
    const seen = (result.current.data as { logs: string[] }).logs[0];
    await waitFor(
      () => expect((result.current.data as { logs: string[] }).logs[0]).not.toBe(seen),
      { timeout: 2000 },
    );
    unmount();
  });

  it('two observers on one key: closed modal does not stop the open one polling', async () => {
    let n = 0;
    const fn = vi.fn(async () => ({ logs: [`line-${++n}`] }));
    // Closed modal: enabled false, no interval (e.g. global UpdateNotification).
    const closed = renderHook(
      () =>
        useQuery({
          queryKey: ['upd'],
          queryFn: fn,
          enabled: false,
          refetchInterval: false as never,
        }),
      { wrapper: createWrapper(client) },
    );
    // Open modal with a conditional interval (e.g. UpdateSettings progress).
    const { result, unmount } = renderHook(
      ({ open }: { open: boolean }) =>
        useQuery({
          queryKey: ['upd'],
          queryFn: fn,
          enabled: open,
          refetchInterval: (open ? 20 : false) as never,
        }),
      { wrapper: createWrapper(client), initialProps: { open: true } },
    );
    await waitFor(() => expect(fn.mock.calls.length).toBeGreaterThanOrEqual(3), { timeout: 2000 });
    const seen = (result.current.data as { logs: string[] } | undefined)?.logs[0];
    await act(async () => {
      await new Promise((r) => setTimeout(r, 80));
    });
    expect(fn.mock.calls.length).toBeGreaterThan(3);
    expect((result.current.data as { logs: string[] }).logs[0]).not.toBe(seen);
    unmount();
    closed.unmount();
  });

  it('closed -> open starts polling with a conditional interval', async () => {
    const fn = vi.fn(async () => 'v');
    const { result, rerender, unmount } = renderHook(
      ({ open }: { open: boolean }) =>
        useQuery({
          queryKey: ['upd2'],
          queryFn: fn,
          enabled: open,
          refetchInterval: (open ? 20 : false) as never,
        }),
      { wrapper: createWrapper(client), initialProps: { open: false } },
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(fn).not.toHaveBeenCalled();
    rerender({ open: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await waitFor(() => expect(fn.mock.calls.length).toBeGreaterThanOrEqual(2), { timeout: 2000 });
    unmount();
  });
});

/**
 * C4 (audit 2026-11-24 §C4): useStreamAwareInterval used the worst status
 * across EVERY shared stream, so one dead console/metrics socket switched on
 * 30-60s polling for servers, alerts, roles, profile and mod lists at once.
 * The optional `urls` scope makes only the named streams decide; callers that
 * pass nothing keep the previous all-streams behaviour.
 */
describe('useStreamAwareInterval scope (C4)', () => {
  beforeEach(() => {
    __resetSharedEventSources();
  });

  afterEach(() => {
    __resetSharedEventSources();
  });

  /** Drive the hub's global status subscribers for one URL. */
  function emit(url: string, status: StreamStatus) {
    emitStatus(url, status);
  }

  it('ignores an outage on a stream outside the requested scope', async () => {
    const { result } = renderHook(() => useStreamAwareInterval(30_000, ['/api/servers/all-servers/events']));
    // No scoped stream is open yet → the poll is the only freshness path.
    expect(result.current).toBe(30_000);

    act(() => {
      emit('/api/servers/all-servers/events', 'connected');
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toBe(false);

    act(() => {
      // A per-server console/metrics socket dies: irrelevant to this caller.
      emit('/api/servers/abc/metrics/stream', 'error');
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toBe(false);

    // Its own stream failing DOES turn the poll on.
    act(() => {
      emit('/api/servers/all-servers/events', 'error');
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toBe(30_000);
  });

  it('keeps polling while the scoped streams are not open at all (non-admin fallback)', async () => {
    // Nothing has subscribed anything: without a live stream only polling can
    // refresh the data (the admin stream never opens for non-admins).
    const { result } = renderHook(() => useStreamAwareInterval(60_000, ['/api/admin/events']));
    expect(result.current).toBe(60_000);

    act(() => {
      emit('/api/admin/events', 'connected');
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toBe(false);

    // The stream is torn down (navigation away, last subscriber gone): the
    // realtime path is gone with it, so the poll comes back.
    act(() => {
      emit('/api/admin/events', 'closed');
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toBe(60_000);
  });

  it('recovers when the scoped stream reconnects, ignoring unrelated failures', async () => {
    const { result } = renderHook(() => useStreamAwareInterval(60_000, ['/api/admin/events']));
    act(() => {
      emit('/api/admin/events', 'connected');
    });
    act(() => {
      emit('/api/admin/events', 'error');
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toBe(60_000);

    act(() => {
      emit('/api/servers/abc/events', 'error'); // still irrelevant
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toBe(60_000);

    act(() => {
      emit('/api/admin/events', 'connected');
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toBe(false);
  });

  it('keeps the unscoped default: any stream outage turns the poll on', async () => {
    const { result } = renderHook(() => useStreamAwareInterval(30_000));
    // Unscoped and nothing open: no poll (unchanged P1-24 semantics).
    expect(result.current).toBe(false);
    act(() => {
      emit('/api/servers/abc/metrics/stream', 'error');
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toBe(30_000);
  });

  it('does not trigger polling on transient (non-outage) statuses in scope', async () => {
    const { result } = renderHook(() => useStreamAwareInterval(30_000, ['/api/admin/events']));
    act(() => {
      emit('/api/admin/events', 'connected');
    });
    act(() => {
      emit('/api/admin/events', 'reconnecting');
    });
    await act(async () => {
      await Promise.resolve();
    });
    // The hub reconnects on its own; only hard failures poll.
    expect(result.current).toBe(false);
  });
});
