import { useQuery } from '@/csync';
import { qk } from '../lib/queryKeys';
import { alertsApi } from '../services/api/alerts';

export function useAlerts() {
  return useQuery({
    queryKey: qk.alerts(),
    queryFn: () => alertsApi.list({ resolved: false, scope: 'mine' }),
    staleTime: 30_000,
    // alert / alert_* events invalidate via server + admin SSE streams.
    refetchInterval: false,
    refetchIntervalInBackground: false,
  });
}
