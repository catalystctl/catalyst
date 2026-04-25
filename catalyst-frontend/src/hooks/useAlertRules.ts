import { useQuery } from '@tanstack/react-query';
import { qk } from '../lib/queryKeys';
import { alertsApi } from '../services/api/alerts';

export function useAlertRules(params?: {
  type?: string;
  enabled?: boolean;
  target?: string;
  targetId?: string;
  scope?: 'mine' | 'all';
}) {
  return useQuery({
    queryKey: qk.alertRules(params as Record<string, unknown> | undefined),
    queryFn: () => alertsApi.listRules(params),
    refetchInterval: 10000,
  });
}
