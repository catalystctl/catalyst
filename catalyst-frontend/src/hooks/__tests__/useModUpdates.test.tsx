/**
 * useModUpdates.ts — audit D13 (updates badge).
 *
 * Pins the cross-workstream contract: the hook owns the exact key
 * `['mod-updates-summary', serverId]`, runs the existing check-updates API
 * once per stale window, stays disabled while nothing is installed, and
 * exposes `{ updates: number }` for the tab-bar badge (which reads the same
 * key with `enabled: false` and must find data already there).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@/csync';
import type { ReactNode } from 'react';

const checkUpdates = vi.fn();
vi.mock('../../services/api/modManager', () => ({
  modManagerApi: {
    checkUpdates: (...args: unknown[]) => checkUpdates(...args),
  },
}));

import { useModUpdatesSummary, MOD_UPDATES_STALE_MS } from '../useModUpdates';
import { qk } from '../../lib/queryKeys';

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
}

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  checkUpdates.mockReset();
});

describe('useModUpdatesSummary', () => {
  it('keys the summary exactly as the tab bar reads it', () => {
    // The badge reader hardcodes this literal and never imports the hook.
    expect(qk.modUpdatesSummary('srv-1')).toEqual(['mod-updates-summary', 'srv-1']);
  });

  it('reports updatesAvailable from the existing check-updates API', async () => {
    checkUpdates.mockResolvedValue({ checked: 4, updatesAvailable: 3 });
    const client = makeClient();
    const { result } = renderHook(() => useModUpdatesSummary('srv-1', 4), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.updates).toBe(3));
    expect(checkUpdates).toHaveBeenCalledWith('srv-1');
    // The tab bar resolves the same literal key to the same cached value.
    expect(client.getQueryData(['mod-updates-summary', 'srv-1'])).toEqual({ updates: 3 });
  });

  it('stays disabled while no mod is installed', async () => {
    const client = makeClient();
    const { result } = renderHook(() => useModUpdatesSummary('srv-1', 0), {
      wrapper: wrapper(client),
    });

    // Give the query a tick to (not) fire.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(checkUpdates).not.toHaveBeenCalled();
    expect(result.current.updates).toBe(0);
  });

  it('does nothing without a server id', async () => {
    const client = makeClient();
    const { result } = renderHook(() => useModUpdatesSummary(undefined, 5), {
      wrapper: wrapper(client),
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(checkUpdates).not.toHaveBeenCalled();
    expect(result.current.updates).toBe(0);
  });

  it('caches for five minutes so a tab remount is free', async () => {
    expect(MOD_UPDATES_STALE_MS).toBe(5 * 60 * 1000);
    checkUpdates.mockResolvedValue({ checked: 2, updatesAvailable: 1 });
    const client = makeClient();
    const first = renderHook(() => useModUpdatesSummary('srv-1', 2), {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(first.result.current.updates).toBe(1));

    // Remounting the tab (a fresh hook instance on the same client) must not
    // re-run the provider fan-out inside the stale window.
    const second = renderHook(() => useModUpdatesSummary('srv-1', 2), {
      wrapper: wrapper(client),
    });
    expect(second.result.current.updates).toBe(1);
    expect(checkUpdates).toHaveBeenCalledTimes(1);
  });

  it('degrades to zero updates instead of breaking the tab on failure', async () => {
    checkUpdates.mockRejectedValue(new Error('provider down'));
    const client = makeClient();
    const { result } = renderHook(() => useModUpdatesSummary('srv-1', 3), {
      wrapper: wrapper(client),
    });

    // One retry (1s backoff) before the terminal error, so allow headroom.
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 4000 });
    expect(result.current.updates).toBe(0);
  });
});