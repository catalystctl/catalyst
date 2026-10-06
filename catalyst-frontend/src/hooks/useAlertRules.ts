import { useQuery } from '@/csync';
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
    staleTime: 60_000,
    // Rule CRUD SSE is admin-only; 60s safety poll keeps non-admin rules fresh.
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}
