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
    localStorage.clear();
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

    // Critical: first paint must NOT claim setup is done, and must not claim a
    // fresh install either — only a successful response decides.
    expect(result.current.isLoading).toBe(true);
    expect(result.current.setupRequired).toBe(false);
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

  it('reports unreachable (not a fresh install) on network / 5xx errors after retries', async () => {
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
      const { result, unmount } = renderHook(() => useSetupStatus(), {
        wrapper: createWrapper(client),
      });

      // Bounded advance (NOT runAllTimersAsync): the unreachable auto-poll
      // interval would keep firing forever under runAllTimers.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(8000);
      });

      expect(result.current.isLoading).toBe(false);
      // A backend that cannot answer is NOT a fresh install: never open the
      // wizard, show the retry state instead.
      expect(result.current.unreachable).toBe(true);
      expect(result.current.setupRequired).toBe(false);
      expect(result.current.error).toBeTruthy();
      // Initial attempt + one retry (failureCount < 1 → 2 attempts)
      expect(getMock.mock.calls.length).toBeGreaterThanOrEqual(2);
      unmount();
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('never opens the wizard on an error, with or without prior setup memory', async () => {
    // Even a browser that never saw "setup complete" must not be sent to the
    // OOBE wizard just because the backend was briefly unavailable.
    vi.useFakeTimers();
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
      const { result, unmount } = renderHook(() => useSetupStatus(), {
        wrapper: createWrapper(client),
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(8000);
      });

      expect(result.current.isLoading).toBe(false);
      expect(result.current.setupRequired).toBe(false);
      expect(result.current.unreachable).toBe(true);
      unmount();
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

    // Wait for the first fetch to settle — setupRequired becomes true only
    // after the backend actually answers.
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

  it('persists install memory after a successful setupRequired=false', async () => {
    getMock.mockResolvedValue({ setupRequired: false });
    const { result } = renderHook(() => useSetupStatus(), {
      wrapper: createWrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(localStorage.getItem('catalyst:setup-installed:v1')).toBe('1');
  });

  it('routes immediately from install memory while the network answer is still pending', async () => {
    // The login page must never block behind a booting/restarting backend
    // once this browser has seen a completed install.
    localStorage.setItem('catalyst:setup-installed:v1', '1');
    getMock.mockImplementation(() => new Promise(() => {})); // never resolves

    const { result } = renderHook(() => useSetupStatus(), {
      wrapper: createWrapper(client),
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.setupRequired).toBe(false);
    expect(result.current.unreachable).toBe(false);
  });

  it('clears install memory and routes to the wizard when a revalidation says setup is required', async () => {
    // Database wiped behind a browser with stale install memory: the
    // revalidation flips the answer and the app must land on /setup.
    localStorage.setItem('catalyst:setup-installed:v1', '1');
    getMock.mockResolvedValue({ setupRequired: true });
    const { result } = renderHook(() => useSetupStatus(), {
      wrapper: createWrapper(client),
    });

    await waitFor(() => expect(result.current.setupRequired).toBe(true));
    expect(localStorage.getItem('catalyst:setup-installed:v1')).toBeNull();
  });

  it('auto-heals: keeps polling while unreachable and recovers when the backend answers', async () => {
    vi.useFakeTimers();
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
      getMock
        .mockRejectedValueOnce({ response: { status: 502 }, message: 'Bad Gateway' })
        .mockRejectedValueOnce({ response: { status: 502 }, message: 'Bad Gateway' })
        .mockResolvedValue({ setupRequired: false });
      const { result, unmount } = renderHook(() => useSetupStatus(), {
        wrapper: createWrapper(client),
      });

      // Initial attempt + 1 retry fail (~1s backoff); the unreachable poll
      // has not fired yet at t=2s.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(result.current.unreachable).toBe(true);

      // The 3s auto-poll fires without any user interaction...
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4000);
      });
      // ...and the app recovers as soon as the backend answers.
      expect(result.current.unreachable).toBe(false);
      expect(result.current.setupRequired).toBe(false);
      expect(result.current.isLoading).toBe(false);
      unmount();
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
