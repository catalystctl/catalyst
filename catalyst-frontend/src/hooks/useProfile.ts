import { useQuery } from '@tanstack/react-query';
import { profileApi } from '../services/api/profile';

export function useProfile() {
  return useQuery({
    queryKey: ['profile'],
    queryFn: profileApi.getProfile,
  });
}

export function useProfileSsoAccounts() {
  return useQuery({
    queryKey: ['profile-sso-accounts'],
    queryFn: profileApi.listSsoAccounts,
  });
}

export function useSessions() {
  return useQuery({
    queryKey: ['profile-sessions'],
    queryFn: profileApi.listSessions,
    refetchInterval: 30_000,
  });
}

export function useAuditLog(limit = 50, offset = 0) {
  return useQuery({
    queryKey: ['profile-audit-log', limit, offset],
    queryFn: () => profileApi.getAuditLog(limit, offset),
  });
}

export function useProfileApiKeys() {
  return useQuery({
    queryKey: ['profile-api-keys'],
    queryFn: profileApi.getApiKeys,
  });
}
