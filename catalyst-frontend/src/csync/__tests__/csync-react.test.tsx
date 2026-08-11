/**
 * Catalyst Sync React hook tests (useQuery / useMutation / provider).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useMutation,
  useQueryClient,
  setFallbackQueryClient,
} from '../index';

function createWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client, children });
  };
}

describe('csync react hooks', () => {
  let client: QueryClient;

  beforeEach(() => {
    client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 0 } },
      mutationCache: {
        notifyError: vi.fn(),
        subscribe: () => () => {},
      } as any,
    });
    setFallbackQueryClient(client);
  });

  afterEach(() => {
    client.clear();
    setFallbackQueryClient(null);
  });

  it('useQuery loads data and exposes success state', async () => {
    const queryFn = vi.fn(async () => ({ ok: true }));
    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ['hook-test'],
          queryFn,
        }),
      { wrapper: createWrapper(client) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ ok: true });
    expect(queryFn).toHaveBeenCalled();
  });

  it('useQuery respects enabled: false', async () => {
    const queryFn = vi.fn(async () => 1);
    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ['disabled'],
          queryFn,
          enabled: false,
        }),
      { wrapper: createWrapper(client) },
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(queryFn).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('useQueryClient returns the provider client', () => {
    const { result } = renderHook(() => useQueryClient(), {
      wrapper: createWrapper(client),
    });
    expect(result.current).toBe(client);
  });

  it('useQuery.refetch identity is stable across re-renders (no effect spam)', async () => {
    // Regression: queryKey arrays are recreated every render; depending on queryKey
    // (not its hash) made refetch a new function every time → effects that listed
    // refetch as a dep hammered the network (console /logs?lines=2000 spam).
    const queryFn = vi.fn(async () => ({ n: 1 }));
    const { result, rerender } = renderHook(
      () =>
        useQuery({
          queryKey: ['servers', 'abc', 'logs', 2000],
          queryFn,
          staleTime: 60_000,
        }),
      { wrapper: createWrapper(client) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const first = result.current.refetch;
    rerender();
    rerender();
    expect(result.current.refetch).toBe(first);
    // initial fetch only — re-renders must not auto-refetch via identity churn
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it('useMutation runs mutateAsync and onSuccess', async () => {
    const onSuccess = vi.fn();
    const { result } = renderHook(
      () =>
        useMutation({
          mutationFn: async (n: number) => n * 2,
          onSuccess,
        }),
      { wrapper: createWrapper(client) },
    );

    let value = 0;
    await act(async () => {
      value = await result.current.mutateAsync(21);
    });
    expect(value).toBe(42);
    expect(onSuccess).toHaveBeenCalled();
    expect(result.current.isSuccess).toBe(true);
  });

  it('useMutation surfaces errors and calls onError', async () => {
    const onError = vi.fn();
    const { result } = renderHook(
      () =>
        useMutation({
          mutationFn: async () => {
            throw new Error('boom');
          },
          onError,
        }),
      { wrapper: createWrapper(client) },
    );

    await act(async () => {
      await result.current.mutateAsync().catch(() => undefined);
    });
    expect(result.current.isError).toBe(true);
    expect(onError).toHaveBeenCalled();
  });

  it('useQuery select normalizes data on every read (including setQueryData)', async () => {
    // Regression: task list cache can hold `{ tasks: [...] }` from raw API/SSE
    // writers. select must run on every observer read so consumers always get arrays.
    const queryFn = vi.fn(async () => ({ tasks: [{ id: 'a' }] }));
    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ['servers', 's1', 'tasks'],
          queryFn,
          staleTime: 60_000,
          select: (data: unknown) => {
            if (Array.isArray(data)) return data;
            if (data && typeof data === 'object' && Array.isArray((data as any).tasks)) {
              return (data as any).tasks;
            }
            return [];
          },
        }),
      { wrapper: createWrapper(client) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(Array.isArray(result.current.data)).toBe(true);
    expect(result.current.data).toEqual([{ id: 'a' }]);

    // Simulate a non-array cache write (what a buggy SSE patch might do)
    act(() => {
      client.setQueryData(['servers', 's1', 'tasks'], { tasks: [{ id: 'b' }, { id: 'c' }] });
    });

    await waitFor(() => expect(result.current.data).toEqual([{ id: 'b' }, { id: 'c' }]));
    expect(Array.isArray(result.current.data)).toBe(true);
    // .find must not throw — same contract ServerTasksTab relies on
    expect(result.current.data!.find((t: any) => t.id === 'c')).toEqual({ id: 'c' });
  });

  it('setQueryData triggers useQuery observers', async () => {
    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ['live'],
          queryFn: async () => ({ v: 1 }),
          staleTime: Infinity,
        }),
      { wrapper: createWrapper(client) },
    );

    await waitFor(() => expect(result.current.data).toEqual({ v: 1 }));

    act(() => {
      client.setQueryData(['live'], { v: 2 });
      client.flush();
    });

    await waitFor(() => expect(result.current.data).toEqual({ v: 2 }));
  });
});
