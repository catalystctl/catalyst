import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { qk } from '../lib/queryKeys';
import { adminApi } from '../services/api/admin';

export function useAdminStats() {
  return useQuery({
    queryKey: qk.adminStats(),
    queryFn: adminApi.stats,
    staleTime: 60_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}

export function useAdminHealth() {
  return useQuery({
    queryKey: qk.adminHealth(),
    queryFn: adminApi.health,
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}

export function useAdminUsers(params?: { page?: number; limit?: number; search?: string }) {
  return useQuery({
    queryKey: qk.adminUsers(params as Record<string, unknown> | undefined),
    queryFn: () => adminApi.listUsers(params),
    staleTime: 60_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}

export function useAdminRoles() {
  return useQuery({
    queryKey: qk.adminRoles(),
    queryFn: adminApi.listRoles,
    staleTime: 5 * 60 * 1000,
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
    staleTime: 60_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}

export function useAdminNodes(params?: { search?: string }) {
  return useQuery({
    queryKey: qk.adminNodes(params as Record<string, unknown> | undefined),
    queryFn: () => adminApi.listNodes(params),
    staleTime: 60_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
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
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}

export function useDatabaseHosts() {
  return useQuery({
    queryKey: qk.adminDatabaseHosts(),
    queryFn: adminApi.listDatabaseHosts,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });
}

export function useDatabaseHostPing(hostId: string | null) {
  return useQuery({
    queryKey: qk.adminDatabaseHostPing(hostId!),
    queryFn: () => adminApi.pingDatabaseHost(hostId!),
    enabled: !!hostId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useDbStatus() {
  return useQuery({
    queryKey: qk.adminDbStatus(),
    queryFn: adminApi.getDbStatus,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });
}

export function useSmtpSettings() {
  return useQuery({
    queryKey: qk.adminSmtp(),
    queryFn: adminApi.getSmtpSettings,
    staleTime: 10 * 60 * 1000,
    placeholderData: (prev) => prev,
  });
}

export function useSecuritySettings() {
  return useQuery({
    queryKey: qk.adminSecuritySettings(),
    queryFn: adminApi.getSecuritySettings,
    staleTime: 10 * 60 * 1000,
    placeholderData: (prev) => prev,
  });
}

export function useModManagerSettings() {
  return useQuery({
    queryKey: qk.adminModManager(),
    queryFn: adminApi.getModManagerSettings,
    staleTime: 10 * 60 * 1000,
    placeholderData: (prev) => prev,
  });
}

export function useAuthLockouts(params?: { page?: number; limit?: number; search?: string }) {
  return useQuery({
    queryKey: qk.adminAuthLockouts(params as Record<string, unknown> | undefined),
    queryFn: () => adminApi.listAuthLockouts(params),
    staleTime: 60_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}

export function useThemeSettings() {
  return useQuery({
    queryKey: qk.adminThemeSettings(),
    queryFn: adminApi.getThemeSettings,
    staleTime: 10 * 60 * 1000,
    placeholderData: (prev) => prev,
  });
}

export function useOidcConfig() {
  return useQuery({
    queryKey: qk.adminOidcConfig(),
    queryFn: adminApi.getOidcConfig,
    staleTime: 10 * 60 * 1000,
    placeholderData: (prev) => prev,
  });
}

export function useDnsSettings() {
  return useQuery({
    queryKey: qk.adminDnsSettings(),
    queryFn: adminApi.getDnsSettings,
    staleTime: 10 * 60 * 1000,
    placeholderData: (prev) => prev,
  });
}

export function useSystemErrors(params?: {
  page?: number;
  limit?: number;
  level?: string;
  component?: string;
  nodeId?: string;
  resolved?: boolean;
  from?: string;
  to?: string;
}) {
  return useQuery({
    queryKey: qk.adminSystemErrors(params as Record<string, unknown> | undefined),
    queryFn: () => adminApi.listSystemErrors(params),
    staleTime: 60_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}

export function useResolveSystemError() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => adminApi.resolveSystemError(id),
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: qk.adminSystemErrors() });
      const previousData = queryClient.getQueriesData({ queryKey: qk.adminSystemErrors() });
      queryClient.setQueriesData(
        { queryKey: qk.adminSystemErrors() },
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
      queryClient.invalidateQueries({ queryKey: qk.adminSystemErrors() });
    },
  });
}
