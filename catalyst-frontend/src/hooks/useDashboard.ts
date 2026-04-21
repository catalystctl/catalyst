import { useQuery } from '@tanstack/react-query';
import { qk } from '../lib/queryKeys';
import dashboardApi from '../services/api/dashboard';

export function useDashboardStats() {
  return useQuery({
    queryKey: qk.dashboardStats(),
    queryFn: dashboardApi.getStats,
    refetchInterval: 30000, // Refresh every 30 seconds
    staleTime: 10000,
  });
}

export function useDashboardActivity(limit = 5) {
  return useQuery({
    queryKey: qk.dashboardActivity({ limit } as Record<string, unknown>),
    queryFn: () => dashboardApi.getActivity(limit),
    refetchInterval: 60000, // Refresh every minute
    staleTime: 30000,
  });
}

export function useResourceStats() {
  return useQuery({
    queryKey: qk.dashboardResources(),
    queryFn: dashboardApi.getResourceStats,
    refetchInterval: 15000, // Refresh every 15 seconds for live feel
    staleTime: 5000,
  });
}
