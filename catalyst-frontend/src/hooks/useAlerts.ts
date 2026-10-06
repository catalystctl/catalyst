import { useQuery } from '@/csync';
import { qk } from '../lib/queryKeys';
import { alertsApi } from '../services/api/alerts';
import { useStreamAwareInterval } from './useStreamAwareInterval';

export function useAlerts() {
  // P1-24: alerts are event-driven — poll only while the SSE streams are down.
  const outagePoll = useStreamAwareInterval(60_000);
  return useQuery({
    queryKey: qk.alerts(),
    queryFn: () => alertsApi.list({ resolved: false, scope: 'mine' }),
    staleTime: 30_000,
    // alert / alert_* events invalidate via server + admin SSE streams.
    refetchInterval: outagePoll,
    refetchIntervalInBackground: false,
  });
}
