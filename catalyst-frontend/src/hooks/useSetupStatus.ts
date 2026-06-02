import { useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import apiClient from '../services/api/client';

interface SetupStatus {
  setupRequired: boolean;
  isLoading: boolean;
  error: string | null;
  recheck: () => void;
}

export function useSetupStatus(): SetupStatus {
  const queryClient = useQueryClient();

  const {
    data: setupRequired = false,
    isLoading,
    error: queryError,
    refetch,
  } = useQuery({
    queryKey: ['setup', 'status'],
    queryFn: async () => {
      try {
        const data = await apiClient.get<{ setupRequired: boolean }>('/api/setup/status');
        return data.setupRequired ?? false;
      } catch (err: any) {
        // If endpoint doesn't exist (old backend), assume setup not needed
        if (err.response?.status === 404) {
          return false;
        }
        throw err;
      }
    },
    retry: false,
    refetchOnWindowFocus: false,
  });

  const recheck = useCallback(() => {
    refetch();
  }, [refetch]);

  useEffect(() => {
    const handleSetupComplete = () => {
      queryClient.invalidateQueries({ queryKey: ['setup', 'status'] });
    };
    window.addEventListener('catalyst:setup-complete', handleSetupComplete);
    return () => {
      window.removeEventListener('catalyst:setup-complete', handleSetupComplete);
    };
  }, [queryClient]);

  const error = queryError
    ? queryError instanceof Error
      ? queryError.message
      : 'Failed to check setup status'
    : null;

  return { setupRequired, isLoading, error, recheck };
}
