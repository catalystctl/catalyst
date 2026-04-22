import { useQuery } from '@tanstack/react-query';
import { qk } from '../lib/queryKeys';
import { adminApi } from '../services/api/admin';

export function useAdminStats() {
  return useQuery({
    queryKey: qk.adminStats(),
    queryFn: adminApi.stats,
    refetchInterval: 30000,
  });
}

export function useAdminHealth() {
  return useQuery({
    queryKey: qk.adminHealth(),
    queryFn: adminApi.health,
    refetchInterval: 15000,
  });
}

export function useAdminUsers(params?: { page?: number; limit?: number; search?: string }) {
  return useQuery({
    queryKey: qk.adminUsers(params as Record<string, unknown> | undefined),
    queryFn: () => adminApi.listUsers(params),
  });
}

export function useAdminRoles() {
  return useQuery({
    queryKey: qk.adminRoles(),
    queryFn: adminApi.listRoles,
  });
}

export function useAdminServers(params?: {
  page?: number;
  limit?: number;
  status?: string;
  search?: string;
  owner?: string;
}) {
  return useQuery({
    queryKey: qk.adminServers(params as Record<string, unknown> | undefined),
    queryFn: () => adminApi.listServers(params),
  });
}

export function useAdminNodes(params?: { search?: string }) {
  return useQuery({
    queryKey: qk.adminNodes(params as Record<string, unknown> | undefined),
    queryFn: () => adminApi.listNodes(params),
    refetchInterval: 30000,
  });
}

export function useAuditLogs(params?: {
  page?: number;
  limit?: number;
  userId?: string;
  action?: string;
  resource?: string;
  from?: string;
  to?: string;
}) {
  return useQuery({
    queryKey: qk.adminAuditLogs(params as Record<string, unknown> | undefined),
    queryFn: () => adminApi.listAuditLogs(params),
    refetchInterval: 15000,
  });
}

export function useDatabaseHosts() {
  return useQuery({
    queryKey: qk.adminDatabaseHosts(),
    queryFn: adminApi.listDatabaseHosts,
  });
}

export function useSmtpSettings() {
  return useQuery({
    queryKey: qk.adminSmtp(),
    queryFn: adminApi.getSmtpSettings,
    staleTime: 300_000,
  });
}

export function useSecuritySettings() {
  return useQuery({
    queryKey: qk.adminSecuritySettings(),
    queryFn: adminApi.getSecuritySettings,
    staleTime: 300_000,
  });
}

export function useModManagerSettings() {
  return useQuery({
    queryKey: qk.adminModManager(),
    queryFn: adminApi.getModManagerSettings,
    staleTime: 300_000,
  });
}

export function useAuthLockouts(params?: { page?: number; limit?: number; search?: string }) {
  return useQuery({
    queryKey: qk.adminAuthLockouts(params as Record<string, unknown> | undefined),
    queryFn: () => adminApi.listAuthLockouts(params),
  });
}

export function useThemeSettings() {
  return useQuery({
    queryKey: qk.adminThemeSettings(),
    queryFn: adminApi.getThemeSettings,
    staleTime: 300_000,
  });
}

export function useOidcConfig() {
  return useQuery({
    queryKey: qk.adminOidcConfig(),
    queryFn: adminApi.getOidcConfig,
    staleTime: 300_000,
  });
}
