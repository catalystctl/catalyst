/**
 * DataFreshness — the shell "last refreshed + live stream" chip.
 *
 * The hub is mocked so the test drives status transitions directly instead of
 * standing up EventSource; the csync singleton is used for real so the cache
 * subscription and `getLatestDataUpdatedAt()` are exercised end to end.
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';

const h = vi.hoisted(() => ({
  listeners: new Set<(url: string, status: string, prev: string) => void>(),
}));

vi.mock('../../../services/api/sse-hub', () => ({
  subscribeSharedStatus: (cb: (url: string, status: string, prev: string) => void) => {
    h.listeners.add(cb);
    return () => h.listeners.delete(cb);
  },
  getSharedStreamSnapshot: () => [],
}));

import DataFreshness from '../DataFreshness';
import { queryClient } from '../../../lib/queryClient';

async function emit(status: string) {
  await act(async () => {
    for (const cb of [...h.listeners]) cb('/api/events', status, 'connecting');
  });
}

/** Seed a cache entry with an explicit `dataUpdatedAt` age. */
function seed(ageMs: number) {
  const query = queryClient.ensureQuery({ queryKey: ['freshness-test'] });
  query.setState({
    ...query.state,
    data: { value: 1 },
    status: 'success',
    dataUpdatedAt: Date.now() - ageMs,
  });
  queryClient.getQueryCache().notify({
    type: 'updated',
    query: query as unknown as import('../../../csync/types').Query<unknown, unknown>,
  });
}

beforeEach(() => {
  h.listeners.clear();
  queryClient.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('DataFreshness', () => {
  it('shows the never-refreshed state when the cache has no loaded data', () => {
    render(<DataFreshness />);
    expect(screen.getByLabelText(/Not yet refreshed/)).toBeTruthy();
  });

  it('displays the relative age of the newest loaded query', () => {
    seed(5 * 60_000);
    render(<DataFreshness />);
    expect(screen.getByText('Refreshed 5 minutes ago')).toBeTruthy();
  });

  it('advances the displayed age as time passes', async () => {
    vi.useFakeTimers();
    seed(61_000);
    render(<DataFreshness />);
    const initial = screen.getByText(/^Refreshed/).textContent;
    // The ticker is a self-scheduling timeout, so advance one step at a time
    // and let each render schedule the next tick.
    for (let i = 0; i < 70; i += 1) {
      await act(async () => {
        vi.advanceTimersByTime(1_000);
      });
    }
    expect(screen.getByText(/^Refreshed/).textContent).not.toBe(initial);
  });

  it('reflects a stream status transition in the rendered state', async () => {
    render(<DataFreshness />);
    expect(screen.getByLabelText(/Reconnecting/)).toBeTruthy();

    await emit('connected');
    expect(screen.getByLabelText(/Live/)).toBeTruthy();

    await emit('error');
    expect(screen.getByLabelText(/Live updates offline/)).toBeTruthy();
  });

  it('unsubscribes from the hub on unmount', () => {
    const { unmount } = render(<DataFreshness />);
    expect(h.listeners.size).toBe(1);
    unmount();
    expect(h.listeners.size).toBe(0);
  });
});
