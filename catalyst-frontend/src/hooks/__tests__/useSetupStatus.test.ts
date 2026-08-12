/**
 * useSetupStatus — first-run / OOBE gate.
 *
 * Regression: after the csync migration, isLoading was false on the pre-fetch
 * first paint and on terminal errors, while setupRequired defaulted to false.
 * That sent fresh Docker installs straight to /login with zero users.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import {
  QueryClient,
  QueryClientProvider,
  setFallbackQueryClient,
} from '../../csync';

const getMock = vi.fn();

vi.mock('../../services/api/client', () => ({
  default: {
    get: (...args: unknown[]) => getMock(...args),
  },
}));

import { useSetupStatus } from '../useSetupStatus';

function createWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client, children });
  };
}

describe('useSetupStatus', () => {
  let client: QueryClient;

  beforeEach(() => {
    getMock.mockReset();
    client = new QueryClient({
      // Hook supplies its own retry policy — keep client defaults out of the way.
      defaultOptions: { queries: { retry: false, staleTime: 0 } },
    });
    setFallbackQueryClient(client);
  });

  afterEach(() => {
    client.clear();
    setFallbackQueryClient(null);
    vi.useRealTimers();
  });

  it('stays loading on first paint (does not default setupRequired to false)', () => {
    getMock.mockImplementation(() => new Promise(() => {})); // never resolves
    const { result } = renderHook(() => useSetupStatus(), {
      wrapper: createWrapper(client),
    });

    // Critical: first paint must NOT claim setup is done.
    expect(result.current.isLoading).toBe(true);
    // Fail-open toward setup while unknown — App.tsx only gates on isLoading,
    // but the boolean must not be a false "done" signal if loading is skipped.
    expect(result.current.setupRequired).toBe(true);
  });

  it('reports setupRequired=true when the backend says so', async () => {
    getMock.mockResolvedValue({ setupRequired: true });
    const { result } = renderHook(() => useSetupStatus(), {
      wrapper: createWrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.setupRequired).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('reports setupRequired=false when users already exist', async () => {
    getMock.mockResolvedValue({ setupRequired: false });
    const { result } = renderHook(() => useSetupStatus(), {
      wrapper: createWrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.setupRequired).toBe(false);
  });

  it('treats 404 (old backend) as setup not required', async () => {
    getMock.mockRejectedValue({ response: { status: 404 }, message: 'Not found' });
    const { result } = renderHook(() => useSetupStatus(), {
      wrapper: createWrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.setupRequired).toBe(false);
  });

  it('fails open to setupRequired=true on network / 5xx errors after retries', async () => {
    vi.useFakeTimers();
    // csync fires fetchQuery with `void` from useEffect, so terminal rejections
    // surface as unhandledRejection — swallow the expected 502 for this test.
    const onUnhandled = (reason: unknown) => {
      const msg =
        reason instanceof Error
          ? reason.message
          : typeof reason === 'object' && reason && 'message' in reason
            ? String((reason as { message?: unknown }).message)
            : String(reason);
      if (msg.includes('Bad Gateway')) return;
      throw reason;
    };
    process.on('unhandledRejection', onUnhandled);

    try {
      getMock.mockRejectedValue({
        response: { status: 502 },
        message: 'Bad Gateway',
      });
      const { result } = renderHook(() => useSetupStatus(), {
        wrapper: createWrapper(client),
      });

      // Advance through exponential backoff retries until the query settles.
      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(result.current.isLoading).toBe(false);
      expect(result.current.setupRequired).toBe(true);
      expect(result.current.error).toBeTruthy();
      // Initial attempt + retries (failureCount < 8 → up to 8 attempts)
      expect(getMock.mock.calls.length).toBeGreaterThan(1);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('rechecks after catalyst:setup-complete event', async () => {
    getMock
      .mockResolvedValueOnce({ setupRequired: true })
      .mockResolvedValueOnce({ setupRequired: false });

    const { result } = renderHook(() => useSetupStatus(), {
      wrapper: createWrapper(client),
    });

    // Wait for the first fetch to settle — setupRequired is true on first paint
    // (fail-open) so we must not treat that as "fetched".
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.setupRequired).toBe(true);
    });

    await act(async () => {
      window.dispatchEvent(new CustomEvent('catalyst:setup-complete'));
    });

    await waitFor(() => expect(result.current.setupRequired).toBe(false));
    expect(getMock).toHaveBeenCalledTimes(2);
  });
});
