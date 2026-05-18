import { useQuery } from '@tanstack/react-query';
import { qk } from '../lib/queryKeys';
import dashboardApi from '../services/api/dashboard';

export function useDashboardStats() {
  return useQuery({
    queryKey: qk.dashboardStats(),
    queryFn: dashboardApi.getStats,
    refetchInterval: 15_000,
    staleTime: 10_000,
    refetchIntervalInBackground: false,
  });
}

export function useDashboardActivity(limit = 5) {
  return useQuery({
    queryKey: qk.dashboardActivity({ limit } as Record<string, unknown>),
    queryFn: () => dashboardApi.getActivity(limit),
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}

export function useResourceStats() {
  return useQuery({
    queryKey: qk.dashboardResources(),
    queryFn: dashboardApi.getResourceStats,
    refetchInterval: 10_000,
    staleTime: 5_000,
    refetchIntervalInBackground: false,
  });
}
