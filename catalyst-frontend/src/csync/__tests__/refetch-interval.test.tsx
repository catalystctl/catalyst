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
