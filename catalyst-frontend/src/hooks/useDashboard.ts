import { useQuery } from '@/csync';
import { qk } from '../lib/queryKeys';
import dashboardApi from '../services/api/dashboard';

export function useDashboardStats() {
  return useQuery({
    queryKey: qk.dashboardStats(),
    queryFn: dashboardApi.getStats,
    // server/node CRUD SSE invalidates this; light safety poll for online counts.
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
    // audit_log_created + server lifecycle SSE invalidate activity.
    refetchInterval: false,
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
