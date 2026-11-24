import { useQuery } from '@/csync';
import { qk } from '../lib/queryKeys';
import dashboardApi from '../services/api/dashboard';
import { useStreamAwareInterval } from './useStreamAwareInterval';

/**
 * C4 — the dashboard's own streams.
 *
 * - `/api/servers/all-servers/events` reaches every signed-in user (AppLayout
 *   mounts useServerStateUpdates) and carries server lifecycle + resource_stats.
 * - `/api/admin/events` only opens for literal `admin.read`.
 *
 * Both feed the cards below, so both decide the outage poll; an unrelated dead
 * socket (a console or a per-server metrics stream) no longer starts it.
 */
const DASHBOARD_STREAMS = ['/api/admin/events', '/api/servers/all-servers/events'] as const;

export function useDashboardStats() {
  // Safety poll keeps its 60s cadence but now runs only while the dashboard's
  // own streams are down (or not open at all — the non-admin fallback).
  const outagePoll = useStreamAwareInterval(60_000, DASHBOARD_STREAMS);
  return useQuery({
    queryKey: qk.dashboardStats(),
    queryFn: dashboardApi.getStats,
    // SSE invalidations for this key live in the admin-gated hook plus the
    // server-state hook (power transitions, create/delete).
    refetchInterval: outagePoll,
    staleTime: 15_000,
    refetchIntervalInBackground: false,
  });
}

export function useDashboardActivity(limit = 5) {
  return useQuery({
    queryKey: qk.dashboardActivity({ limit } as Record<string, unknown>),
    queryFn: () => dashboardApi.getActivity(limit),
    staleTime: 30_000,
    // Deliberately NOT stream-aware: audit entries only reach the admin stream,
    // so for everyone else this 60s poll IS the freshness path (U10). Gating it
    // on a stream their account never opens would freeze the feed.
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}

export function useResourceStats() {
  // C2: `resource_stats` now patches this cache directly
  // (hooks/useServerStateUpdates.ts flushMetrics), so the 30s poll is the
  // fallback for when the fleet stream is not open or has failed.
  const outagePoll = useStreamAwareInterval(30_000, DASHBOARD_STREAMS);
  return useQuery({
    queryKey: qk.dashboardResources(),
    queryFn: dashboardApi.getResourceStats,
    refetchInterval: outagePoll,
    staleTime: 10_000,
    refetchIntervalInBackground: false,
  });
}