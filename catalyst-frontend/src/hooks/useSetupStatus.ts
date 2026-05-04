import { useState, useEffect, useCallback } from 'react';
import apiClient from '../services/api/client';
import { reportSystemError } from '../services/api/systemErrors';

interface SetupStatus {
  setupRequired: boolean;
  isLoading: boolean;
  error: string | null;
  recheck: () => void;
}

export function useSetupStatus(): SetupStatus {
  const [setupRequired, setSetupRequired] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const recheck = useCallback(async () => {
    setIsLoading(true);
    setError(null);
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
  }, []);

  useEffect(() => {
    recheck();
  }, []);

  useEffect(() => {
    const handleSetupComplete = () => {
      recheck();
    };
    window.addEventListener('catalyst:setup-complete', handleSetupComplete);
    return () => {
      window.removeEventListener('catalyst:setup-complete', handleSetupComplete);
    };
  }, [recheck]);

  return { setupRequired, isLoading, error, recheck };
}
