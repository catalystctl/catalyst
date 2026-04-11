import { useQuery } from '@tanstack/react-query';
import { serversApi } from '../services/api/servers';

export interface MetricsTimeRange {
  hours: number;
  limit: number;
  label: string;
}

export function useServerMetricsHistory(serverId?: string, timeRange?: MetricsTimeRange) {
  const range = timeRange || { hours: 1, limit: 60, label: '1 hour' };

  return useQuery({
    queryKey: ['server-metrics', serverId, range.hours, range.limit],
    queryFn: () =>
      serverId
        ? serversApi.metrics(serverId, { hours: range.hours, limit: range.limit })
        : Promise.reject(new Error('missing server id')),
    enabled: Boolean(serverId),
    staleTime: 10 * 1000, // 10 seconds - data is considered fresh for 10 seconds
    refetchInterval: 30 * 1000, // Refetch every 30 seconds
    refetchIntervalInBackground: false, // Don't refetch when tab is not focused
  });
}
