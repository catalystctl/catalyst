/**
 * P2.2 — app-wide missed-event repair for the shared SSE hub.
 *
 * A dropped EventSource reconnects (browser auto-retry, or the hub's P0.5
 * backoff re-open), but nothing re-synchronises the query cache afterwards, so
 * every event emitted during the outage is lost until some unrelated
 * invalidation or poll happens to fire. This hook closes that gap for *all*
 * shared streams at once — admin, global, per-server, metrics, console — from a
 * single mount, instead of each SSE hook growing its own repair path.
 *
 * It is deliberately silent: no toasts, no copy, no i18n.
 */
import { useEffect, useRef } from 'react';
import { subscribeSharedStatus, type StreamStatus } from '../services/api/sse-hub';
import type { QueryClient } from '../csync';
import { queryClient } from '../lib/queryClient';

/**
 * Coalescing window for reconnect storms.
 *
 * A flaky link (VPN flap, laptop sleep, proxy recycle) can emit several
 * connected↔reconnecting transitions in a few seconds. Each one re-syncs the
 * whole cache, and `invalidateQueries` aborts in-flight fetches, so an
 * unthrottled hook would multiply round trips precisely when the network is
 * least healthy. 5 s is long enough to swallow a reconnect burst and short
 * enough that a genuine second outage (which lasts > a heartbeat) is not
 * delayed. Leading-edge: the first recovery re-syncs immediately; a recovery
 * that lands inside the window is remembered and replayed once at the window's
 * end (trailing catch-up), so a transition that flapped *out* again is still
 * repaired exactly once.
 */
export const RECOVERY_DEBOUNCE_MS = 5000;

type RecoveryDebug = {
  /** Recoveries observed since mount (before coalescing). */
  observed: number;
  /** Full re-syncs actually issued. */
  resyncs: number;
};

/**
 * Structural slice of `QueryClient` the hook needs — keeps the hook and its
 * tests free of the full client (mirrors `InvalidateTarget` in invalidateOnce).
 */
export type RecoveryTarget = Pick<QueryClient, 'invalidateQueries'>;

export function useStreamRecovery(client: RecoveryTarget = queryClient): RecoveryDebug {
  const debug = useRef<RecoveryDebug>({ observed: 0, resyncs: 0 });

  useEffect(() => {
    let lastSyncAt = 0;
    let trailingTimer: ReturnType<typeof setTimeout> | null = null;
    /**
     * Per-URL ledger of streams seen in a non-'connected' state since mount
     * (P2-12 "wasDisconnected" semantics).
     *
     * A `connected` notification only counts as a recovery when this URL was
     * previously *observed* outside `connected` — the hub seeds fresh streams
     * at `'connecting'` without notifying, so a page-load initial connect (and
     * a stream re-created after navigation teardown, announced as `'closed'`)
     * never enters the set and cannot masquerade as a recovery. `'closed'` is
     * deliberately excluded: it is an intentional refCount-0 teardown, not a
     * connection loss. Tracking per URL keeps the rule correct with several
     * shared streams live at once (admin, global, per-server, …).
     */
    const leftConnected = new Set<string>();

    // One full re-sync. `invalidateQueries` with no filters is the right tool
    // here: it marks *every* query stale and refetches active observers, which
    // is exactly "catch up on whatever the outage missed" — we cannot know which
    // keys were affected. The `invalidateOnce` per-tick dedupe (audit F11) is
    // keyed on a query identity; a bare invalidate-all has none, and the 5 s
    // window above — not the tick — is the correct coalescing boundary, so we
    // deliberately call the client directly.
    const resync = () => {
      lastSyncAt = Date.now();
      debug.current.resyncs += 1;
      void client.invalidateQueries({});
    };

    const onStatus = (url: string, status: StreamStatus, prev: StreamStatus) => {
      if (status !== 'connected') {
        // Any lost/degraded state arms the URL — except 'closed', which is an
        // intentional teardown (navigation), not a connection loss.
        if (status !== 'closed') leftConnected.add(url);
        return;
      }
      // Entering `connected` is only a genuine recovery if this URL was seen
      // outside `connected` at some point since mount.
      if (!leftConnected.has(url)) return;
      leftConnected.delete(url);
      if (prev === 'connected') return;
      debug.current.observed += 1;

      const elapsed = Date.now() - lastSyncAt;
      if (lastSyncAt === 0 || elapsed >= RECOVERY_DEBOUNCE_MS) {
        resync();
        return;
      }

      // Inside the window: remember the recovery and replay once when the
      // window closes, but only if no fresh sync already happened meanwhile.
      if (trailingTimer !== null) return;
      trailingTimer = setTimeout(() => {
        trailingTimer = null;
        if (Date.now() - lastSyncAt >= RECOVERY_DEBOUNCE_MS) resync();
      }, RECOVERY_DEBOUNCE_MS - elapsed);
    };

    const unsubscribe = subscribeSharedStatus(onStatus);
    return () => {
      unsubscribe();
      if (trailingTimer !== null) {
        clearTimeout(trailingTimer);
        trailingTimer = null;
      }
    };
  }, [client]);

  return debug.current;
}

export default useStreamRecovery;
