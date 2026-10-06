import { useQuery } from '@/csync';
import { qk } from '../lib/queryKeys';
import dashboardApi from '../services/api/dashboard';

export function useDashboardStats() {
  return useQuery({
    queryKey: qk.dashboardStats(),
    queryFn: dashboardApi.getStats,
    // SSE invalidations for this key live in the admin-gated hook only;
    // this 60s safety poll is the freshness path for everyone else.
    refetchInterval: 60_000,
    staleTime: 15_000,
    refetchIntervalInBackground: false,
  });
}

export function useDashboardActivity(limit = 5) {
  return useQuery({
    queryKey: qk.dashboardActivity({ limit } as Record<string, unknown>),
    queryFn: () => dashboardApi.getActivity(limit),
    staleTime: 30_000,
    // SSE invalidations for this key (audit_log_created, server lifecycle)
    // live in the admin-gated hook only; this 60s safety poll is the
    // freshness path for non-admins (U10).
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}

export function useResourceStats() {
  return useQuery({
    queryKey: qk.dashboardResources(),
    queryFn: dashboardApi.getResourceStats,
    // No dense cluster SSE yet — keep a moderate poll for capacity tiles.
    refetchInterval: 30_000,
    staleTime: 10_000,
    refetchIntervalInBackground: false,
  });
}
