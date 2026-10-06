/**
 * P0-D — removeQueries must not detach mounted observers.
 *
 * QueryCache.remove now REPLACES the entry with a fresh, empty, invalidated
 * query while observers are mounted; react's maybeResubscribe migrates the
 * observer onto the replacement, which then refetches and stays reachable by
 * cache-wide passes (invalidateQueries, focus/reconnect). These tests cover
 * the mounted-observer contract end to end through useQuery.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQuery, hashQueryKey } from '../index';

function createWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client, children });
  };
}

describe('removeQueries with mounted observers (P0-D)', () => {
  let client: QueryClient;

  beforeEach(() => {
    client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 60_000, gcTime: 60_000 } },
      mutationCache: { notifyError: vi.fn(), subscribe: () => () => {} } as any,
    });
  });

  afterEach(() => {
    client.clear();
  });

  it('replaces the cache entry and refetches for the mounted observer', async () => {
    let n = 0;
    const queryFn = vi.fn(async () => ({ n: ++n }));
    const { result } = renderHook(() => useQuery({ queryKey: ['p0d'], queryFn }), {
      wrapper: createWrapper(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryFn).toHaveBeenCalledTimes(1);

    const hash = hashQueryKey(['p0d']);
    const original = client.getQueryCache().get(hash)!;
    act(() => {
      client.removeQueries({ queryKey: ['p0d'] });
    });

    // Replaced, not deleted — and the observer migrated onto the replacement.
    const replacement = client.getQueryCache().get(hash)!;
    expect(replacement).toBeDefined();
    expect(replacement).not.toBe(original);
    expect(replacement.observers).toBe(1);
    expect(original.observers).toBe(0);

    // The replacement refetches even though staleTime has not elapsed.
    await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.data).toEqual({ n: 2 }));
    expect(result.current.isSuccess).toBe(true);
  });

  it('subsequent invalidateQueries reaches the mounted observer', async () => {
    let n = 0;
    const queryFn = vi.fn(async () => ({ n: ++n }));
    const { result } = renderHook(() => useQuery({ queryKey: ['p0d-inv'], queryFn }), {
      wrapper: createWrapper(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    act(() => {
      client.removeQueries({ queryKey: ['p0d-inv'] });
    });
    await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2));

    // Cache-wide invalidation still finds and refetches the observed query.
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['p0d-inv'] });
    });
    await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(result.current.data).toEqual({ n: 3 }));
  });

  it('two consecutive removeQueries do not strand the observer', async () => {
    let n = 0;
    const queryFn = vi.fn(async () => ({ n: ++n }));
    const { result } = renderHook(() => useQuery({ queryKey: ['p0d-twice'], queryFn }), {
      wrapper: createWrapper(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    act(() => {
      client.removeQueries({ queryKey: ['p0d-twice'] });
    });
    await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2));
    act(() => {
      client.removeQueries({ queryKey: ['p0d-twice'] });
    });
    await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(result.current.data).toEqual({ n: 3 }));

    const replacement = client.getQueryCache().get(hashQueryKey(['p0d-twice']))!;
    expect(replacement.observers).toBe(1);
  });

  it('keeps the poll timer alive on the replacement and detaches on unmount', async () => {
    let n = 0;
    const queryFn = vi.fn(async () => ({ n: ++n }));
    const { unmount } = renderHook(
      () => useQuery({ queryKey: ['p0d-poll'], queryFn, refetchInterval: 30 }),
      { wrapper: createWrapper(client) },
    );
    await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));

    act(() => {
      client.removeQueries({ queryKey: ['p0d-poll'] });
    });
    await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2));

    const replacement = client.getQueryCache().get(hashQueryKey(['p0d-poll']))!;
    // The interval was re-armed on the replacement and keeps polling.
    expect(replacement.refetchTimer).not.toBeNull();
    await waitFor(() => expect(queryFn.mock.calls.length).toBeGreaterThan(2), { timeout: 2_000 });

    // Unmount detaches the migrated observer: no zombie polling, GC armed.
    unmount();
    expect(replacement.observers).toBe(0);
    expect(replacement.refetchTimer).toBeNull();
  });
});
