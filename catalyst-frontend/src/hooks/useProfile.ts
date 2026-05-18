import { useQuery } from '@tanstack/react-query';
import { profileApi } from '../services/api/profile';
import { qk } from '../lib/queryKeys';

export function useProfile() {
  return useQuery({
    queryKey: qk.profile(),
    queryFn: profileApi.getProfile,
    staleTime: 60_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}

export function useProfileSsoAccounts() {
  return useQuery({
    queryKey: qk.profileSsoAccounts(),
    queryFn: profileApi.listSsoAccounts,
    staleTime: 60_000,
  });
}

export function useSessions() {
  return useQuery({
    queryKey: qk.profileSessions(),
    queryFn: profileApi.listSessions,
    staleTime: 60_000,
  });
}

export function useAuditLog(limit = 50, offset = 0) {
  return useQuery({
    queryKey: qk.profileAuditLog(limit, offset),
    queryFn: () => profileApi.getAuditLog(limit, offset),
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}

export function useProfileApiKeys() {
  return useQuery({
    queryKey: qk.profileApiKeys(),
    queryFn: profileApi.getApiKeys,
    staleTime: 60_000,
  });
}
