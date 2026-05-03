import { useQuery } from '@tanstack/react-query';
import { qk } from '../lib/queryKeys';
import apiClient from '../services/api/client';

export interface UpdateCheckResponse {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
}

export function useUpdateCheck() {
  return useQuery<UpdateCheckResponse>({
    queryKey: qk.updateCheck(),
    queryFn: async () => {
      const data = await apiClient.get<UpdateCheckResponse>('/api/update/check');
      return data;
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
}
