import { useState, useEffect } from 'react';
import apiClient from '../services/api/client';
import { reportSystemError } from '../services/api/systemErrors';

interface SetupStatus {
  setupRequired: boolean;
  isLoading: boolean;
  error: string | null;
}

export function useSetupStatus(): SetupStatus {
  const [setupRequired, setSetupRequired] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const checkSetup = async () => {
      try {
        const data = await apiClient.get<{ setupRequired: boolean }>('/api/setup/status');
        setSetupRequired(data.setupRequired ?? false);
      } catch (err: any) {
        reportSystemError({
          level: 'error',
          component: 'useSetupStatus',
          message: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
          metadata: { context: 'checkSetup' },
        });
        // If endpoint doesn't exist (old backend), assume setup not needed
        if (err.response?.status === 404) {
          setSetupRequired(false);
        } else {
          setError(err.message || 'Failed to check setup status');
        }
      } finally {
        setIsLoading(false);
      }
    };
    checkSetup();
  }, []);

  return { setupRequired, isLoading, error };
}
