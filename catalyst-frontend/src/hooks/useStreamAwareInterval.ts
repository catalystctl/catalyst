/**
 * P1-24 — stream-aware refetchInterval.
 *
 * Event-driven queries (refetchInterval: false) freeze completely when the
 * SSE hub is down: no events arrive, and nothing polls. This hook watches the
 * shared streams and returns `baseMs` while a RELEVANT stream sits in a
 * hard-failure state (error), otherwise `false` — so safety polling only exists
 * during outages and the steady-state cost is unchanged. Teardown
 * announcements ('closed') drop the stream from the ledger; they are
 * intentional, not failures.
 *
 * C4 (audit 2026-11-24 §C4): scope. The verdict used to be the worst status
 * across EVERY shared stream, so one dead console/metrics socket (~one per open
 * server tab) switched on 30-60s polling for servers, alerts, roles, profile
 * and mod lists at the same time. Callers that know which stream carries their
 * data pass `urls`, and only those streams decide.
 *
 * A scoped caller also keeps its safety net when its streams are not open at
 * all: no live stream means no realtime path, so the poll runs at `baseMs`
 * (this is the non-admin fallback — the admin stream only opens for literal
 * `admin.read`). An unscoped caller keeps the previous all-streams behaviour
 * exactly, so no existing call site gets worse.
 *
 * Severity map mirrors DataFreshness.tsx: error/closed = 3,
 * reconnecting/connecting = 2, connected = 1. Transient states (2) do NOT
 * trigger polling — the hub reconnects on its own and useStreamRecovery
 * re-syncs the cache afterwards; only hard failures do.
 */
import { useEffect, useRef, useState } from 'react';
import { getSharedStreamSnapshot, subscribeSharedStatus, type StreamStatus } from '../services/api/sse-hub';

const SEVERITY: Record<StreamStatus, number> = {
  error: 3,
  closed: 3,
  reconnecting: 2,
  connecting: 2,
  connected: 1,
};

/** Hard-failure threshold: error/closed. */
const OUTAGE_SEVERITY = 3;

/**
 * Should the safety poll run?
 * - unscoped: any stream in outage (the original P1-24 semantics);
 * - scoped: none of the named streams is open (no realtime path) OR one of
 *   them is in outage.
 */
function computePoll(
  streams: Map<string, StreamStatus>,
  urls: readonly string[] | undefined,
): boolean {
  if (urls === undefined) {
    for (const status of streams.values()) {
      if (SEVERITY[status] >= OUTAGE_SEVERITY) return true;
    }
    return false;
  }
  let anyPresent = false;
  for (const url of urls) {
    const status = streams.get(url);
    if (status === undefined) continue;
    anyPresent = true;
    if (SEVERITY[status] >= OUTAGE_SEVERITY) return true;
  }
  return !anyPresent;
}

export function useStreamAwareInterval(
  baseMs: number,
  urls?: readonly string[],
): number | false {
  // Per-URL ledger: each stream's latest status replaces its own previous one,
  // so a recovered stream stops counting (a flat worst-wins merge would latch).
  const streamsRef = useRef<Map<string, StreamStatus> | null>(null);
  // Hooks are called with a fresh array literal; keep the newest scope without
  // re-subscribing on every render. The initial state is computed with the same
  // scope in the render the ledger is created.
  const urlsRef = useRef<readonly string[] | undefined>(urls);
  urlsRef.current = urls;
  if (streamsRef.current === null) {
    const streams = new Map<string, StreamStatus>();
    for (const entry of getSharedStreamSnapshot()) {
      if (entry.status !== 'closed') streams.set(entry.url, entry.status);
    }
    streamsRef.current = streams;
  }
  const [poll, setPoll] = useState(() => computePoll(streamsRef.current!, urls));

  useEffect(
    () =>
      subscribeSharedStatus((url, status) => {
        const streams = streamsRef.current;
        if (!streams) return;
        // 'closed' is the hub's intentional-teardown announcement (last
        // subscriber went away, e.g. navigation). Drop the entry instead of
        // recording severity 3, or a torn-down stream would latch outage
        // polling on forever.
        if (status === 'closed') streams.delete(url);
        else streams.set(url, status);
        const scope = urlsRef.current;
        // Out-of-scope churn must not re-render this hook at all.
        if (scope !== undefined && !scope.includes(url)) return;
        setPoll(computePoll(streams, scope));
      }),
    [],
  );

  return poll ? baseMs : false;
}

export default useStreamAwareInterval;
