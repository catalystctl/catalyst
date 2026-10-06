// @vitest-environment jsdom
/**
 * Remediation-plan (REALTIME_AUDIT.md §8) regression tests.
 *
 * P0.1  useQuery().refetch() always hits the network
 * P0.4  failed background refetch with cached data is visible (isError && data)
 *       while data-backed UI (isSuccess) keeps rendering, and clears on success
 * P2.1  refetchOnWindowFocus default + tab-return catch-up (stale + interval)
 * P3    freshness exposure on UseQueryResult + QueryClient.getLatestDataUpdatedAt
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  setFallbackQueryClient,
  hashQueryKey,
} from '../index';
import { queryClient as appQueryClient } from '@/lib/queryClient';

function createWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client, children });
  };
}

function makeClient(opts: Record<string, unknown> = {}) {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 60_000, gcTime: 5000, ...opts },
    } as never,
    mutationCache: { notifyError: vi.fn(), subscribe: () => () => {} } as never,
  });
}

/** Age a cached query's dataUpdatedAt without touching anything else. */
function ageQuery(client: QueryClient, queryKey: readonly unknown[], ms: number) {
  const query = client.getQueryCache().get(hashQueryKey(queryKey));
  if (!query) throw new Error(`query ${JSON.stringify(queryKey)} not in cache`);
  query.state.dataUpdatedAt = Date.now() - ms;
  return query;
}

function focusWindow() {
  act(() => {
    window.dispatchEvent(new Event('focus'));
  });
}

describe('remediation P0.1 — manual refetch is forced', () => {
  let client: QueryClient;

  beforeEach(() => {
    client = makeClient();
    setFallbackQueryClient(client);
  });

  afterEach(() => {
    client.clear();
    setFallbackQueryClient(null);
  });

  it('useQuery().refetch() performs a network call even when data is fresh', async () => {
    const queryFn = vi.fn(async () => ({ n: 1 }));
    const { result } = renderHook(
      () => useQuery({ queryKey: ['p01', 'fresh'], queryFn, staleTime: Infinity }),
      { wrapper: createWrapper(client) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryFn).toHaveBeenCalledTimes(1);
    // staleTime is Infinity — anything but a forced call would be a no-op here.
    await act(async () => {
      await result.current.refetch();
    });
    expect(queryFn).toHaveBeenCalledTimes(2);
    expect(result.current.dataUpdatedAt).toBeGreaterThan(0);
  });

  it('fetchQuery keeps its stale gate for non-forced callers', async () => {
    const seeded = vi.fn(async () => 'network');
    await client.fetchQuery({ queryKey: ['p01', 'gated'], queryFn: seeded });
    expect(seeded).toHaveBeenCalledTimes(1);

    const other = vi.fn(async () => 'other');
    const value = await client.fetchQuery({ queryKey: ['p01', 'gated'], queryFn: other });
    expect(value).toBe('network');
    expect(other).not.toHaveBeenCalled();
  });
});

describe('remediation P0.4 — background refetch failures are visible', () => {
  let client: QueryClient;

  beforeEach(() => {
    client = makeClient({ staleTime: 0 });
    setFallbackQueryClient(client);
  });

  afterEach(() => {
    client.clear();
    setFallbackQueryClient(null);
  });

  /** Seeds cached data, then fails the background refetch the mount effect runs. */
  async function mountWithFailingBackgroundRefetch(key: string) {
    client.setQueryData([key], { v: 1 });
    const queryFn = vi.fn(async () => {
      throw new Error('bg refresh failed');
    });
    const hook = renderHook(
      () => useQuery({ queryKey: [key], queryFn, staleTime: 0, retry: false }),
      { wrapper: createWrapper(client) },
    );
    await waitFor(() => expect(hook.result.current.isError).toBe(true));
    return { ...hook, queryFn };
  }

  it('failed background refetch with cached data makes isError && data true', async () => {
    const { result } = await mountWithFailingBackgroundRefetch('p04-banner');

    // Cached payload survives…
    expect(result.current.data).toEqual({ v: 1 });
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.errorUpdatedAt).toBeGreaterThan(0);
    // …and the exact banner condition used by ServersPage/EnvironmentPage renders.
    expect(result.current.isError && Boolean(result.current.data)).toBe(true);
    expect(result.current.status).toBe('error');
  });

  it('keeps isSuccess true so data-backed UI does not blank out', async () => {
    const { result } = await mountWithFailingBackgroundRefetch('p04-success');

    expect(result.current.data).toEqual({ v: 1 });
    expect(result.current.isSuccess).toBe(true);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isPending).toBe(false);
  });

  it('a subsequent successful fetch clears the error', async () => {
    client.setQueryData(['p04-recover'], { v: 1 });
    let failing = true;
    const queryFn = vi.fn(async () => {
      if (failing) throw new Error('bg refresh failed');
      return { v: 2 };
    });
    const { result } = renderHook(
      () => useQuery({ queryKey: ['p04-recover'], queryFn, staleTime: 0, retry: false }),
      { wrapper: createWrapper(client) },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));

    failing = false;
    await act(async () => {
      await result.current.refetch();
    });

    await waitFor(() => expect(result.current.isError).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.data).toEqual({ v: 2 });
    expect(result.current.isSuccess).toBe(true);
    expect(result.current.status).toBe('success');
  });
});

describe('remediation P2.1 — refetch on tab return', () => {
  let client: QueryClient;

  beforeEach(() => {
    // Mirrors lib/queryClient.ts app defaults (P2.1: focus refetch on).
    client = makeClient({ refetchOnWindowFocus: true });
    setFallbackQueryClient(client);
  });

  afterEach(() => {
    client.clear();
    setFallbackQueryClient(null);
  });

  it('the app-wide default opts queries into focus refetch', () => {
    expect(appQueryClient.getDefaultOptions().queries?.refetchOnWindowFocus).toBe(true);
  });

  it('default focus refetches stale queries', async () => {
    const queryFn = vi.fn(async () => ({ n: 1 }));
    const { result } = renderHook(
      () => useQuery({ queryKey: ['p21', 'stale'], queryFn }),
      { wrapper: createWrapper(client) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryFn).toHaveBeenCalledTimes(1);

    ageQuery(client, ['p21', 'stale'], 120_000); // past the 60s staleTime
    focusWindow();
    await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2));

    // Fresh data must not be refetched by a second focus.
    focusWindow();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(queryFn).toHaveBeenCalledTimes(2);
  });

  it('a query with refetchOnWindowFocus:false is skipped', async () => {
    const optedOut = vi.fn(async () => ({ n: 1 }));
    const optedIn = vi.fn(async () => ({ n: 2 }));
    const { unmount: unmountOut } = renderHook(
      () =>
        useQuery({
          queryKey: ['p21', 'opt-out'],
          queryFn: optedOut,
          refetchOnWindowFocus: false,
        }),
      { wrapper: createWrapper(client) },
    );
    const { unmount: unmountIn } = renderHook(
      () => useQuery({ queryKey: ['p21', 'opt-in'], queryFn: optedIn }),
      { wrapper: createWrapper(client) },
    );
    await waitFor(() => expect(optedOut).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(optedIn).toHaveBeenCalledTimes(1));

    ageQuery(client, ['p21', 'opt-out'], 120_000);
    ageQuery(client, ['p21', 'opt-in'], 120_000);
    focusWindow();

    await waitFor(() => expect(optedIn).toHaveBeenCalledTimes(2));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(optedOut).toHaveBeenCalledTimes(1);

    unmountOut();
    unmountIn();
  });

  it('interval query older than its interval force-refetches on focus after hidden time', async () => {
    // Function variant: effectiveRefetchInterval() must evaluate it.
    const intervalFn = vi.fn(async () => ({ n: 1 }));
    const freshInterval = vi.fn(async () => ({ n: 1 }));
    const { unmount: unmountAged } = renderHook(
      () =>
        useQuery({
          queryKey: ['p21', 'interval-aged'],
          queryFn: intervalFn,
          refetchInterval: (() => 30_000) as never,
        }),
      { wrapper: createWrapper(client) },
    );
    const { unmount: unmountFresh } = renderHook(
      () =>
        useQuery({
          queryKey: ['p21', 'interval-fresh'],
          queryFn: freshInterval,
          refetchInterval: 30_000 as never,
        }),
      { wrapper: createWrapper(client) },
    );
    await waitFor(() => expect(intervalFn).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(freshInterval).toHaveBeenCalledTimes(1));

    // 40s old: still inside the 60s staleTime (so the stale path would skip)
    // but past the 30s interval (missed tick while the tab was hidden).
    ageQuery(client, ['p21', 'interval-aged'], 40_000);
    focusWindow();

    await waitFor(() => expect(intervalFn).toHaveBeenCalledTimes(2));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    // Data newer than the interval => no catch-up.
    expect(freshInterval).toHaveBeenCalledTimes(1);

    unmountAged();
    unmountFresh();
  });
});

describe('remediation P3 — freshness exposure', () => {
  let client: QueryClient;

  beforeEach(() => {
    client = makeClient();
    setFallbackQueryClient(client);
  });

  afterEach(() => {
    client.clear();
    setFallbackQueryClient(null);
  });

  it('useQuery exposes dataUpdatedAt / errorUpdatedAt / isStale without churning identity', async () => {
    const queryFn = vi.fn(async () => ({ n: 1 }));
    const { result, rerender } = renderHook(
      ({ staleTime }: { staleTime: number }) =>
        useQuery({ queryKey: ['p3', 'expose'], queryFn, staleTime }),
      { wrapper: createWrapper(client), initialProps: { staleTime: 60_000 } },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.dataUpdatedAt).toBeGreaterThan(0);
    expect(result.current.errorUpdatedAt).toBe(0);
    expect(result.current.isStale).toBe(false);

    // The three new fields are part of the identity memo — no-op re-renders
    // must keep returning the very same object.
    const first = result.current;
    rerender({ staleTime: 60_000 });
    rerender({ staleTime: 60_000 });
    expect(result.current).toBe(first);

    // Per-observer staleTime decides staleness (0 => always stale).
    rerender({ staleTime: 0 });
    expect(result.current.isStale).toBe(true);
    expect(result.current.dataUpdatedAt).toBe(first.dataUpdatedAt);
  });

  it('exposes errorUpdatedAt after a failed fetch', async () => {
    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ['p3', 'error'],
          queryFn: async () => {
            throw new Error('nope');
          },
          staleTime: 60_000,
          retry: false,
        }),
      { wrapper: createWrapper(client) },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.errorUpdatedAt).toBeGreaterThan(0);
    expect(result.current.dataUpdatedAt).toBe(0);
    expect(result.current.isStale).toBe(true);
  });

  it('getLatestDataUpdatedAt returns the newest dataUpdatedAt over matching queries', async () => {
    client.setQueryData(['freshness', 'a'], 1);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    client.setQueryData(['freshness', 'b'], 2);
    // A query that never loaded must not drag the maximum to 0.
    client.ensureQuery({ queryKey: ['freshness', 'never'] });

    const newest = client.getQueryCache().get(hashQueryKey(['freshness', 'b']))!.state.dataUpdatedAt;

    // Scoped reads select only their prefix, so `b` is unambiguously newest.
    expect(client.getLatestDataUpdatedAt({ queryKey: ['freshness'] })).toBe(newest);

    // Whole-cache max is the newest stamp anywhere; `other:c` is written after
    // `b` and may share or exceed its millisecond, so compare against the cache
    // rather than assuming `b` wins (that assumption was a clock race).
    client.setQueryData(['other', 'c'], 3);
    const cStamp = client.getQueryCache().get(hashQueryKey(['other', 'c']))!.state.dataUpdatedAt;
    expect(client.getLatestDataUpdatedAt()).toBe(Math.max(newest, cStamp));
    // The whole-cache max must never fall below any scoped max.
    expect(client.getLatestDataUpdatedAt()).toBeGreaterThanOrEqual(newest);

    // Unmatched / never-loaded scopes report 0 ("nothing refreshed yet").
    expect(client.getLatestDataUpdatedAt({ queryKey: ['does-not-exist'] })).toBe(0);
    expect(client.getLatestDataUpdatedAt({ queryKey: ['freshness', 'never'] })).toBe(0);
  });
});
