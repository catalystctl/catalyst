import apiClient from './client';
import type { CreateIpPoolPayload, IpPool } from '../../types/ipam';
import type {
  AdminHealthResponse,
  AdminRolesResponse,
  AdminServerAction,
  AdminServerActionResponse,
  AdminServersResponse,
  AdminStats,
  AdminUsersResponse,
  AdminNodesResponse,
  AuditLogsResponse,
  DatabaseHost,
  ModManagerSettings,
  SmtpSettings,
  SecuritySettings,
  AuthLockout,
  AuthLockoutsResponse,
  Role,
  RolePreset,
} from '../../types/admin';

type ApiResponse<T> = {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
};

export const adminApi = {
  stats: async () => {
    const { data } = await apiClient.get<AdminStats>('/api/admin/stats');
    return data;
  },
  health: async () => {
    const { data } = await apiClient.get<AdminHealthResponse>('/api/admin/health');
    return data;
  },
  listUsers: async (params?: { page?: number; limit?: number; search?: string }) => {
    const { data } = await apiClient.get<AdminUsersResponse>('/api/admin/users', { params });
    return data;
  },
  listRoles: async () => {
    const { data } = await apiClient.get<AdminRolesResponse>('/api/admin/roles');
    return data.roles;
  },
  createUser: async (payload: {
    email: string;
    username: string;
    password: string;
    roleIds?: string[];
    serverIds?: string[];
  }) => {
    const { data } = await apiClient.post<AdminUsersResponse['users'][number]>(
      '/api/admin/users',
      payload,
    );
    return data;
  },
  updateUser: async (
    userId: string,
    payload: {
      email?: string;
      username?: string;
      password?: string;
      roleIds?: string[];
      serverIds?: string[];
    },
  ) => {
    const { data } = await apiClient.put<AdminUsersResponse['users'][number]>(
      `/api/admin/users/${userId}`,
      payload,
    );
    return data;
  },
  getUserServers: async (userId: string) => {
    const { data } = await apiClient.get<{ serverIds: string[] }>(`/api/admin/users/${userId}/servers`);
    return data.serverIds;
  },
  deleteUser: async (userId: string) => {
    const { data } = await apiClient.delete<{ success: boolean }>(`/api/admin/users/${userId}`);
    return data;
  },
  listServers: async (params?: {
    page?: number;
    limit?: number;
    status?: string;
    search?: string;
    owner?: string;
  }) => {
    const { data } = await apiClient.get<AdminServersResponse>('/api/admin/servers', { params });
    return data;
  },
  bulkServerAction: async (payload: {
    serverIds: string[];
    action: AdminServerAction;
    reason?: string;
  }) => {
    const { data } = await apiClient.post<AdminServerActionResponse>('/api/admin/servers/actions', payload);
    return data;
  },
  listNodes: async (params?: { search?: string }) => {
    const { data } = await apiClient.get<AdminNodesResponse>('/api/admin/nodes', { params });
    return data;
  },
  suspendServer: async (serverId: string, reason?: string) => {
    const { data } = await apiClient.post<ApiResponse<void>>(`/api/servers/${serverId}/suspend`, {
      reason,
    });
    return data;
  },
  unsuspendServer: async (serverId: string) => {
    const { data } = await apiClient.post<ApiResponse<void>>(`/api/servers/${serverId}/unsuspend`);
    return data;
  },
  listAuditLogs: async (params?: {
    page?: number;
    limit?: number;
    userId?: string;
    action?: string;
    resource?: string;
    from?: string;
    to?: string;
  }) => {
    const { data } = await apiClient.get<AuditLogsResponse>('/api/admin/audit-logs', { params });
    return data;
  },
  listIpPools: async () => {
    const { data } = await apiClient.get<ApiResponse<IpPool[]>>('/api/admin/ip-pools');
    return data.data || [];
  },
  createIpPool: async (payload: CreateIpPoolPayload) => {
    const { data } = await apiClient.post<ApiResponse<IpPool>>('/api/admin/ip-pools', payload);
    return data.data;
  },
  updateIpPool: async (poolId: string, payload: Partial<CreateIpPoolPayload>) => {
    const { data } = await apiClient.put<ApiResponse<IpPool>>(
      `/api/admin/ip-pools/${poolId}`,
      payload,
    );
    return data.data;
  },
  deleteIpPool: async (poolId: string) => {
    const { data } = await apiClient.delete<ApiResponse<void>>(`/api/admin/ip-pools/${poolId}`);
    return data;
  },
  listDatabaseHosts: async () => {
    const { data } = await apiClient.get<ApiResponse<DatabaseHost[]>>('/api/admin/database-hosts');
    return data.data || [];
  },
  createDatabaseHost: async (payload: {
    name: string;
    host: string;
    port?: number;
    username: string;
    password: string;
  }) => {
    const { data } = await apiClient.post<ApiResponse<DatabaseHost>>(
      '/api/admin/database-hosts',
      payload,
    );
    return data.data;
  },
  updateDatabaseHost: async (
    hostId: string,
    payload: {
      name?: string;
      host?: string;
      port?: number;
      username?: string;
      password?: string;
    },
  ) => {
    const { data } = await apiClient.put<ApiResponse<DatabaseHost>>(
      `/api/admin/database-hosts/${hostId}`,
      payload,
    );
    return data.data;
  },
  deleteDatabaseHost: async (hostId: string) => {
    const { data } = await apiClient.delete<ApiResponse<void>>(`/api/admin/database-hosts/${hostId}`);
    return data;
  },
  getSmtpSettings: async () => {
    const { data } = await apiClient.get<ApiResponse<SmtpSettings>>('/api/admin/smtp');
    return data.data;
  },
  updateSmtpSettings: async (payload: SmtpSettings) => {
    const { data } = await apiClient.put<ApiResponse<void>>('/api/admin/smtp', payload);
    return data;
  },
  getSecuritySettings: async () => {
    const { data } = await apiClient.get<ApiResponse<SecuritySettings>>('/api/admin/security-settings');
    return data.data;
  },
  updateSecuritySettings: async (payload: SecuritySettings) => {
    const { data } = await apiClient.put<ApiResponse<void>>('/api/admin/security-settings', payload);
    return data;
  },
  getModManagerSettings: async () => {
    const { data } = await apiClient.get<ApiResponse<ModManagerSettings>>('/api/admin/mod-manager');
    return data.data;
  },
  updateModManagerSettings: async (payload: ModManagerSettings) => {
    const { data } = await apiClient.put<ApiResponse<void>>('/api/admin/mod-manager', payload);
    return data;
  },
  listAuthLockouts: async (params?: { page?: number; limit?: number; search?: string }) => {
    const { data } = await apiClient.get<AuthLockoutsResponse>('/api/admin/auth-lockouts', {
      params,
    });
    return data;
  },
  clearAuthLockout: async (lockoutId: string) => {
    const { data } = await apiClient.delete<ApiResponse<void>>(`/api/admin/auth-lockouts/${lockoutId}`);
    return data;
  },
  exportAuditLogs: async (params?: {
    userId?: string;
    action?: string;
    resource?: string;
    from?: string;
    to?: string;
    format?: 'csv' | 'json';
  }) => {
    const { data } = await apiClient.get('/api/admin/audit-logs/export', {
      params,
      responseType: 'text',
    });
    return data;
  },
  getThemeSettings: async () => {
    const { data } = await apiClient.get<ApiResponse<any>>('/api/admin/theme-settings');
    return data.data;
  },
  updateThemeSettings: async (payload: any) => {
    const { data } = await apiClient.patch<ApiResponse<any>>('/api/admin/theme-settings', payload);
    return data.data;
  },
  // Ban a user
  banUser: async (userId: string, reason?: string) => {
    const { data } = await apiClient.post<ApiResponse<void>>(
      `/api/admin/users/${userId}/ban`,
      { reason }
    );
    return data;
  },
  // Unban a user
  unbanUser: async (userId: string) => {
    const { data } = await apiClient.post<ApiResponse<void>>(
      `/api/admin/users/${userId}/unban`
    );
    return data;
  },
  // Get user roles
  getUserRoles: async (userId: string) => {
    const { data } = await apiClient.get<ApiResponse<{ roles: Role[]; permissions: string[] }>>(
      `/api/roles/users/${userId}/roles`
    );
    return data.data;
  },
  // Assign role to user
  assignRole: async (roleId: string, userId: string) => {
    const { data } = await apiClient.post<ApiResponse<void>>(
      `/api/roles/${roleId}/users/${userId}`
    );
    return data;
  },
  // Remove role from user
  removeRole: async (roleId: string, userId: string) => {
    const { data } = await apiClient.delete<ApiResponse<void>>(
      `/api/roles/${roleId}/users/${userId}`
    );
    return data;
  },
  // Get role presets
  getRolePresets: async () => {
    const { data } = await apiClient.get<ApiResponse<RolePreset[]>>('/api/roles/presets');
    return data.data || [];
  },
};
