import { useQuery } from '@tanstack/react-query';
import { qk } from '../lib/queryKeys';
import { alertsApi } from '../services/api/alerts';

export function useAlerts() {
  return useQuery({
    queryKey: qk.alerts(),
    queryFn: () => alertsApi.list({ resolved: false, scope: 'mine' }),
  });
}
