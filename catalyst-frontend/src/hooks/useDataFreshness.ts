import { useEffect, useRef, useState } from 'react';
import { queryClient } from '@/lib/queryClient';
import { partialMatchKey, type QueryKey } from '@/csync';
import {
  getSharedStreamSnapshot,
  subscribeSharedStatus,
  type StreamStatus,
} from '@/services/api/sse-hub';

/**
 * Shared freshness primitives behind the shell chip and per-page
 * <LastUpdated /> stamps (REALTIME_AUDIT.md §6).
 *
 * Freshness age is `max(dataUpdatedAt)` over the csync cache (optionally
 * filtered to a key prefix). State re-syncs on cache events — instant when an
 * SSE patch or refetch lands — plus an adaptive ticker so the relative age
 * visibly advances while the tab idles.
 */

const TICK_MS = 1_000;
const SLOW_TICK_MS = 15_000;
/** Age past which the first-minute cadence slows down. */
const FRESH_WINDOW_MS = 60_000;

/** Worst live status wins across streams, so one broken socket is visible. */
const SEVERITY: Record<StreamStatus, number> = {
  error: 3,
  closed: 3,
  reconnecting: 2,
  connecting: 2,
  connected: 1,
};

/**
 * Per-URL map, because the aggregate can only be right if each stream's latest
 * status replaces its own previous one — a flat worst-wins merge would latch on
 * the first alarm and never recover to live.
 */
function aggregate(statuses: Map<string, StreamStatus>): StreamStatus {
  let worst: StreamStatus | null = null;
  for (const status of statuses.values()) {
    if (worst === null || SEVERITY[status] > SEVERITY[worst]) worst = status;
  }
  return worst ?? 'connecting';
}

/** Self-scheduling adaptive tick: 1s while the reading is fresh, 15s after. */
function useAdaptiveNow(updatedAt: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const fresh = updatedAt === 0 || Date.now() - updatedAt < FRESH_WINDOW_MS;
    const timer = window.setTimeout(() => setNow(Date.now()), fresh ? TICK_MS : SLOW_TICK_MS);
    return () => window.clearTimeout(timer);
  }, [updatedAt, now]);
  return now;
}

export interface QueryFreshness {
  /** Newest dataUpdatedAt across the (filtered) cache; 0 = never fetched. */
  updatedAt: number;
  /** True while any matching query is fetching. */
  isFetching: boolean;
  /** Wall-clock reference for relative formatting; advances on the ticker. */
  now: number;
}

/**
 * Cache freshness for one query-key prefix (or the whole cache when omitted).
 * Cheap enough for several instances per page: a cache event re-reads the
 * filtered max, no polling beyond the display ticker.
 */
export function useQueryFreshness(queryKey?: QueryKey): QueryFreshness {
  const filters = queryKey ? { queryKey } : undefined;
  const read = (): { updatedAt: number; isFetching: boolean } => ({
    updatedAt: queryClient.getLatestDataUpdatedAt(filters),
    isFetching: queryClient.isFetching(filters) > 0,
  });
  const [state, setState] = useState(read);

  useEffect(() => {
    const sync = (event?: { query?: { queryKey?: QueryKey } }) => {
      if (queryKey && event?.query?.queryKey && !partialMatchKey(event.query.queryKey, queryKey)) return;
      setState((previous) => {
        const next = read();
        return previous.updatedAt === next.updatedAt && previous.isFetching === next.isFetching ? previous : next;
      });
    };
    sync();
    return queryClient.getQueryCache().subscribe(sync as (event: import('@/csync/types').QueryCacheNotifyEvent) => void);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read() is stable via queryKey identity
  }, [queryKey]);

  const now = useAdaptiveNow(state.updatedAt);
  return { ...state, now };
}

export interface DataFreshnessState extends QueryFreshness {
  /** Worst status across every live shared EventSource. */
  streamStatus: StreamStatus;
}

/**
 * Whole-app freshness: cache-wide newest data + aggregate shared-stream health.
 *
 * Streams reporting 'closed' are dropped from the ledger: the hub announces
 * 'closed' on intentional teardown (last subscriber went away, e.g. navigation),
 * and keeping the entry would latch the chip to "offline" forever. Genuine
 * failures surface as 'error'/'reconnecting'. The ledger is seeded from the
 * hub snapshot so a remounting chip does not flash "connecting" while healthy
 * streams already exist.
 */
export function useDataFreshness(): DataFreshnessState {
  const cache = useQueryFreshness();
  const [streamStatus, setStreamStatus] = useState<StreamStatus>(() => {
    const seed = new Map<string, StreamStatus>();
    for (const entry of getSharedStreamSnapshot()) {
      if (entry.status !== 'closed') seed.set(entry.url, entry.status);
    }
    return aggregate(seed);
  });
  const streamsRef = useRef<Map<string, StreamStatus> | null>(null);
  if (streamsRef.current === null) {
    const seed = new Map<string, StreamStatus>();
    for (const entry of getSharedStreamSnapshot()) {
      if (entry.status !== 'closed') seed.set(entry.url, entry.status);
    }
    streamsRef.current = seed;
  }

  useEffect(
    () =>
      subscribeSharedStatus((url, status) => {
        const streams = streamsRef.current;
        if (!streams) return;
        if (status === 'closed') streams.delete(url);
        else streams.set(url, status);
        setStreamStatus(aggregate(streams));
      }),
    [],
  );

  return { ...cache, streamStatus };
}

export { SEVERITY as STREAM_SEVERITY, aggregate as aggregateStreamStatus };
