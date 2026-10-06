/**
 * P1-24 — stream-aware refetchInterval.
 *
 * Event-driven queries (refetchInterval: false) freeze completely when the
 * SSE hub is down: no events arrive, and nothing polls. This hook watches
 * every shared stream through `subscribeSharedStatus` and returns `baseMs`
 * while ANY stream sits in a hard-failure state (error), otherwise `false` —
 * so the safety polling only exists during outages and the steady-state cost
 * is unchanged. Teardown announcements ('closed') drop the stream from the
 * ledger; they are intentional, not failures.
 *
 * Severity map mirrors DataFreshness.tsx: error/closed = 3,
 * reconnecting/connecting = 2, connected = 1. Transient states (2) do NOT
 * trigger polling — the hub reconnects on its own and useStreamRecovery
 * re-syncs the cache afterwards; only hard failures do.
 */
import { useEffect, useRef, useState } from 'react';
import { subscribeSharedStatus, type StreamStatus } from '../services/api/sse-hub';

const SEVERITY: Record<StreamStatus, number> = {
  error: 3,
  closed: 3,
  reconnecting: 2,
  connecting: 2,
  connected: 1,
};

/** Hard-failure threshold: error/closed. */
const OUTAGE_SEVERITY = 3;

export function useStreamAwareInterval(baseMs: number): number | false {
  // Per-URL ledger: each stream's latest status replaces its own previous one,
  // so a recovered stream stops counting (a flat worst-wins merge would latch).
  const streamsRef = useRef(new Map<string, StreamStatus>());
  const [outage, setOutage] = useState(false);

  useEffect(
    () =>
      subscribeSharedStatus((url, status) => {
        // 'closed' is the hub's intentional-teardown announcement (last
        // subscriber went away, e.g. navigation). Drop the entry instead of
        // recording severity 3, or a torn-down stream would latch outage
        // polling on forever.
        if (status === 'closed') streamsRef.current.delete(url);
        else streamsRef.current.set(url, status);
        let worst = 0;
        for (const s of streamsRef.current.values()) {
          if (SEVERITY[s] > worst) worst = SEVERITY[s];
        }
        setOutage(worst >= OUTAGE_SEVERITY);
      }),
    [],
  );

  return outage ? baseMs : false;
}

export default useStreamAwareInterval;
