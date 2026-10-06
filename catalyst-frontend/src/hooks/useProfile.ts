import { useQuery } from '@/csync';
import { profileApi } from '../services/api/profile';
import { qk } from '../lib/queryKeys';
import { useStreamAwareInterval } from './useStreamAwareInterval';

export function useProfile() {
  // P1-24: user_updated/permissions_updated arrive via SSE — poll only during
  // stream outages so the header/sidebar cannot freeze on stale identity data.
  const outagePoll = useStreamAwareInterval(60_000);
  return useQuery({
    queryKey: qk.profile(),
    queryFn: profileApi.getProfile,
    staleTime: 60_000,
    refetchInterval: outagePoll, // user_updated / profileSync SSE+poll
    refetchIntervalInBackground: false,
  });
}

export function useProfileSsoAccounts() {
  return useQuery({
    queryKey: qk.profileSsoAccounts(),
    queryFn: profileApi.listSsoAccounts,
    staleTime: 60_000,
    // SSO changes are not pushed to non-admins; 60s safety poll (U7).
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}

export function useSessions() {
  return useQuery({
    queryKey: qk.profileSessions(),
    queryFn: profileApi.listSessions,
    staleTime: 60_000,
    // Sessions are not pushed to non-admins; 60s safety poll (U7).
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}

export function useAuditLog(limit = 50, offset = 0) {
  return useQuery({
    queryKey: qk.profileAuditLog(limit, offset),
    queryFn: () => profileApi.getAuditLog(limit, offset),
    staleTime: 60_000,
    // Own-activity audit entries are not pushed to non-admins; 60s safety poll (U7).
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}

export function useProfileApiKeys() {
  return useQuery({
    queryKey: qk.profileApiKeys(),
    queryFn: profileApi.getApiKeys,
    staleTime: 60_000,
    // API key changes are not pushed to non-admins; 60s safety poll (U7/U8).
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}
