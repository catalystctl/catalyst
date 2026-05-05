import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
    refetchInterval: 10000,
  });
}

export function useAdminRoles() {
  return useQuery({
    queryKey: qk.adminRoles(),
    queryFn: adminApi.listRoles,
    refetchInterval: 10000,
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
    refetchInterval: 10000,
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
    refetchInterval: 15000,
  });
}

export function useSmtpSettings() {
  return useQuery({
    queryKey: qk.adminSmtp(),
    queryFn: adminApi.getSmtpSettings,
    refetchInterval: 30000,
  });
}

export function useSecuritySettings() {
  return useQuery({
    queryKey: qk.adminSecuritySettings(),
    queryFn: adminApi.getSecuritySettings,
    refetchInterval: 30000,
  });
}

export function useModManagerSettings() {
  return useQuery({
    queryKey: qk.adminModManager(),
    queryFn: adminApi.getModManagerSettings,
    refetchInterval: 30000,
  });
}

export function useAuthLockouts(params?: { page?: number; limit?: number; search?: string }) {
  return useQuery({
    queryKey: qk.adminAuthLockouts(params as Record<string, unknown> | undefined),
    queryFn: () => adminApi.listAuthLockouts(params),
    refetchInterval: 15000,
  });
}

export function useThemeSettings() {
  return useQuery({
    queryKey: qk.adminThemeSettings(),
    queryFn: adminApi.getThemeSettings,
    refetchInterval: 30000,
  });
}

export function useOidcConfig() {
  return useQuery({
    queryKey: qk.adminOidcConfig(),
    queryFn: adminApi.getOidcConfig,
    refetchInterval: 30000,
  });
}

export function useDnsSettings() {
  return useQuery({
    queryKey: qk.adminDnsSettings(),
    queryFn: adminApi.getDnsSettings,
    refetchInterval: 30000,
  });
}

export function useSystemErrors(params?: {
  page?: number;
  limit?: number;
  level?: string;
  component?: string;
  resolved?: boolean;
  from?: string;
  to?: string;
}) {
  return useQuery({
    queryKey: qk.adminSystemErrors(params as Record<string, unknown> | undefined),
    queryFn: () => adminApi.listSystemErrors(params),
    refetchInterval: 15000,
  });
}

export function useResolveSystemError() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => adminApi.resolveSystemError(id),
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({
        predicate: (query) =>
          Array.isArray(query.queryKey) && query.queryKey[0] === 'admin-system-errors',
      });
      const previousData = queryClient.getQueriesData({
        predicate: (query) =>
          Array.isArray(query.queryKey) && query.queryKey[0] === 'admin-system-errors',
      });
      queryClient.setQueriesData(
        {
          predicate: (query) =>
            Array.isArray(query.queryKey) && query.queryKey[0] === 'admin-system-errors',
        },
        (prev: any) => {
          if (!prev || typeof prev !== 'object') return prev;
          if ('errors' in prev && Array.isArray(prev.errors)) {
            return {
              ...prev,
              errors: prev.errors.map((e: any) =>
                e.id === id ? { ...e, resolved: true } : e,
              ),
            };
          }
          return prev;
        },
      );
      return { previousData };
    },
    onError: (_err, _id, context: any) => {
      if (context?.previousData) {
        for (const [queryKey, data] of context.previousData) {
          queryClient.setQueryData(queryKey, data);
        }
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        predicate: (query) =>
          Array.isArray(query.queryKey) && query.queryKey[0] === 'admin-system-errors',
      });
    },
  });
}
