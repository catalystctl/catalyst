import { useQuery } from '@tanstack/react-query';
import { adminApi } from '../services/api/admin';

export function useAdminStats() {
  return useQuery({
    queryKey: ['admin-stats'],
    queryFn: adminApi.stats,
    refetchInterval: 30000,
  });
}

export function useAdminHealth() {
  return useQuery({
    queryKey: ['admin-health'],
    queryFn: adminApi.health,
    refetchInterval: 15000,
  });
}

export function useAdminUsers(params?: { page?: number; limit?: number; search?: string }) {
  return useQuery({
    queryKey: ['admin-users', params],
    queryFn: () => adminApi.listUsers(params),
  });
}

export function useAdminRoles() {
  return useQuery({
    queryKey: ['admin-roles'],
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
    queryKey: ['admin-servers', params],
    queryFn: () => adminApi.listServers(params),
  });
}

export function useAdminNodes(params?: { search?: string }) {
  return useQuery({
    queryKey: ['admin-nodes', params],
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
    queryKey: ['admin-audit-logs', params],
    queryFn: () => adminApi.listAuditLogs(params),
    refetchInterval: 15000,
  });
}

export function useDatabaseHosts() {
  return useQuery({
    queryKey: ['admin-database-hosts'],
    queryFn: adminApi.listDatabaseHosts,
  });
}

export function useSmtpSettings() {
  return useQuery({
    queryKey: ['admin-smtp'],
    queryFn: adminApi.getSmtpSettings,
  });
}

export function useSecuritySettings() {
  return useQuery({
    queryKey: ['admin-security-settings'],
    queryFn: adminApi.getSecuritySettings,
  });
}

export function useModManagerSettings() {
  return useQuery({
    queryKey: ['admin-mod-manager'],
    queryFn: adminApi.getModManagerSettings,
  });
}

export function useAuthLockouts(params?: { page?: number; limit?: number; search?: string }) {
  return useQuery({
    queryKey: ['admin-auth-lockouts', params],
    queryFn: () => adminApi.listAuthLockouts(params),
  });
}

export function useThemeSettings() {
  return useQuery({
    queryKey: ['admin-theme-settings'],
    queryFn: adminApi.getThemeSettings,
  });
}
