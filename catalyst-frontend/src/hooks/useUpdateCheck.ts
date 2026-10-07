import { useQuery } from '@/csync';
import { qk } from '../lib/queryKeys';
import apiClient from '../services/api/client';

export interface UpdateCheckResponse {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  isDocker: boolean;
}

// `enabled` mirrors the backend admin.read gate (hasGrant: admin.read,
// admin.write, '*') — callers without it would only produce 403 noise.
export function useUpdateCheck(enabled = true) {
  return useQuery<UpdateCheckResponse>({
    queryKey: qk.updateCheck(),
    queryFn: async () => {
      const data = await apiClient.get<UpdateCheckResponse>('/api/update/check');
      return data;
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}
