import apiClient from './client';
import type {
  Server,
  ServerListParams,
  UpdateServerPayload,
  TransferServerPayload,
  CreateServerPayload,
  CloneServerPayload,
  ServerLogs,
  RestartPolicy,
  BackupStorageMode,
  ServerPermissionsResponse,
  ServerInvite,
  ServerAccessEntry,
  InviteDeliveryResult,
} from '../../types/server';

type ApiResponse<T> = {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
};

export const serversApi = {
  list: async (params?: ServerListParams) => {
    const merged: Record<string, string | number | boolean | null | undefined> = {
      ...(params ?? {}),
    };
    if (merged.withMetrics == null && merged.metrics == null) merged.withMetrics = 1;
    const data = await apiClient.get<ApiResponse<Server[]>>('/api/servers', { params: merged });
    return Array.isArray(data.data) ? data.data : [];
  },
  get: async (id: string) => {
    const data = await apiClient.get<ApiResponse<Server>>(`/api/servers/${id}`);
    return data.data;
  },
  create: async (payload: CreateServerPayload) => {
    const data = await apiClient.post<ApiResponse<Server>>('/api/servers', payload);
    return data.data;
  },
  clone: async (id: string, payload: CloneServerPayload) => {
    const data = await apiClient.post<ApiResponse<Server>>(`/api/servers/${id}/clone`, payload);
    return data.data;
  },
  update: async (id: string, payload: UpdateServerPayload) => {
    const data = await apiClient.put<ApiResponse<Server>>(`/api/servers/${id}`, payload);
    return data.data;
  },
  resizeStorage: async (id: string, allocatedDiskMb: number) => {
    const data = await apiClient.post<ApiResponse<void>>(`/api/servers/${id}/storage/resize`, {
      allocatedDiskMb,
    });
    return data;
  },
  transfer: async (id: string, payload: TransferServerPayload) => {
    const data = await apiClient.post<ApiResponse<void>>(`/api/servers/${id}/transfer`, payload);
    return data;
  },
  delete: async (id: string) => {
    const data = await apiClient.delete<ApiResponse<void>>(`/api/servers/${id}`);
    return data;
  },
  start: async (id: string) => {
    const data = await apiClient.post<ApiResponse<void>>(`/api/servers/${id}/start`);
    return data;
  },
  stop: async (id: string) => {
    const data = await apiClient.post<ApiResponse<void>>(`/api/servers/${id}/stop`);
    return data;
  },
  restart: async (id: string) => {
    const data = await apiClient.post<ApiResponse<void>>(`/api/servers/${id}/restart`);
    return data;
  },
  kill: async (id: string) => {
    const data = await apiClient.post<ApiResponse<void>>(`/api/servers/${id}/kill`);
    return data;
  },
  install: async (id: string) => {
    const data = await apiClient.post<ApiResponse<void>>(`/api/servers/${id}/install`);
    return data;
  },
  cancelInstall: async (id: string) => {
    const data = await apiClient.post<ApiResponse<void>>(`/api/servers/${id}/cancel-install`);
    return data;
  },
  suspend: async (id: string, reason?: string) => {
    const data = await apiClient.post<ApiResponse<void>>(`/api/servers/${id}/suspend`, {
      reason,
    });
    return data;
  },
  unsuspend: async (id: string) => {
    const data = await apiClient.post<ApiResponse<void>>(`/api/servers/${id}/unsuspend`);
    return data;
  },
  logs: async (id: string, params?: { lines?: number; stream?: string }) => {
    const data = await apiClient.get<ApiResponse<ServerLogs>>(
      `/api/servers/${id}/logs`,
      { params },
    );
    return Array.isArray(data.data?.logs) ? data.data.logs : [];
  },
  metrics: async (id: string, params?: { hours?: number; limit?: number }) => {
    const data = await apiClient.get<ApiResponse<any>>(`/api/servers/${id}/metrics`, { params });
    return data.data;
  },
  allocations: async (id: string) => {
    const data = await apiClient.get<ApiResponse<any> | any[]>(`/api/servers/${id}/allocations`);
    // Backend: { success, data: Allocation[] }. Tolerate bare array / nested shapes.
    if (Array.isArray(data)) return data;
    if (data && Array.isArray((data as any).data)) return (data as any).data;
    if (data && Array.isArray((data as any).allocations)) return (data as any).allocations;
    return [];
  },
  addAllocation: async (
    id: string,
    payload:
      | { allocationId: string; containerPort?: number }
      | { containerPort: number; hostPort: number },
  ) => {
    const data = await apiClient.post<ApiResponse<any>>(`/api/servers/${id}/allocations`, payload);
    return data.data;
  },
  removeAllocation: async (id: string, containerPort: number) => {
    const data = await apiClient.delete<ApiResponse<void>>(
      `/api/servers/${id}/allocations/${containerPort}`,
    );
    return data;
  },
  setPrimaryAllocation: async (id: string, containerPort: number) => {
    const data = await apiClient.post<ApiResponse<any>>(
      `/api/servers/${id}/allocations/primary`,
      { containerPort },
    );
    return data.data;
  },
  updateRestartPolicy: async (
    id: string,
    payload: { restartPolicy?: RestartPolicy; maxCrashCount?: number },
  ) => {
    const data = await apiClient.patch<ApiResponse<any>>(
      `/api/servers/${id}/restart-policy`,
      payload,
    );
    return data;
  },
  resetCrashCount: async (id: string) => {
    const data = await apiClient.post<ApiResponse<any>>(
      `/api/servers/${id}/reset-crash-count`,
      {},
    );
    return data;
  },
  updateBackupSettings: async (
    id: string,
    payload: {
      storageMode?: BackupStorageMode;
      retentionCount?: number;
      retentionDays?: number;
      backupAllocationMb?: number;
      s3Config?: Record<string, unknown>;
      sftpConfig?: Record<string, unknown>;
    },
  ) => {
    const data = await apiClient.patch<ApiResponse<any>>(
      `/api/servers/${id}/backup-settings`,
      payload,
    );
    return data;
  },
  permissions: async (id: string) => {
    const data = await apiClient.get<ServerPermissionsResponse>(`/api/servers/${id}/permissions`);
    return data;
  },
  listInvites: async (id: string) => {
    const data = await apiClient.get<ApiResponse<ServerInvite[]>>(`/api/servers/${id}/invites`);
    return Array.isArray(data.data) ? data.data : [];
  },
  createInvite: async (id: string, payload: { email: string; permissions: string[] }): Promise<InviteDeliveryResult> => {
    const data = await apiClient.post<
      ApiResponse<ServerInvite> & { inviteUrl: string; mailSent: boolean; mailConfigured: boolean }
    >(
      `/api/servers/${id}/invites`,
      payload,
    );
    return {
      invite: (data.data ?? null) as unknown as ServerInvite,
      inviteUrl: data.inviteUrl,
      mailSent: data.mailSent,
      mailConfigured: data.mailConfigured,
    };
  },
  regenerateInvite: async (id: string, inviteId: string): Promise<InviteDeliveryResult> => {
    const data = await apiClient.post<
      ApiResponse<ServerInvite> & { inviteUrl: string; mailSent: boolean; mailConfigured: boolean }
    >(`/api/servers/${id}/invites/${inviteId}/regenerate`);
    return {
      invite: (data.data ?? null) as unknown as ServerInvite,
      inviteUrl: data.inviteUrl,
      mailSent: data.mailSent,
      mailConfigured: data.mailConfigured,
    };
  },
  cancelInvite: async (id: string, inviteId: string) => {
    const data = await apiClient.delete<ApiResponse<void>>(
      `/api/servers/${id}/invites/${inviteId}`,
    );
    return data;
  },
  acceptInvite: async (token: string) => {
    const data = await apiClient.post<ApiResponse<void>>('/api/servers/invites/accept', {
      token,
    });
    return data;
  },
  registerInvite: async (payload: { token: string; username: string; password: string }) => {
    const data = await apiClient.post<ApiResponse<any>>('/api/servers/invites/register', payload);
    return data;
  },
  previewInvite: async (token: string) => {
    const data = await apiClient.get<ApiResponse<any>>(`/api/servers/invites/${token}`);
    return data;
  },
  upsertAccess: async (id: string, payload: { targetUserId: string; permissions: string[] }) => {
    const data = await apiClient.post<ApiResponse<ServerAccessEntry>>(
      `/api/servers/${id}/access`,
      payload,
    );
    return data.data;
  },
  removeAccess: async (id: string, targetUserId: string) => {
    const data = await apiClient.delete<ApiResponse<void>>(
      `/api/servers/${id}/access/${targetUserId}`,
    );
    return data;
  },

  getSftpConnectionInfo: async (serverId: string, ttlMs?: number) => {
    const params: Record<string, string | number | undefined> = { serverId };
    if (ttlMs) params.ttl = ttlMs;
    const data = await apiClient.get<ApiResponse<{
      enabled: boolean;
      host: string;
      port: number;
      /** SFTP login username when provided by the API; otherwise clients use serverId. */
      username?: string | null;
      sftpPassword: string | null;
      expiresAt: number;
      ttlMs: number;
      ttlOptions: Array<{ label: string; value: number }>;
    }>>(`/api/sftp/connection-info`, { params });
    return data.data;
  },

  rotateSftpToken: async (serverId: string, ttlMs?: number) => {
    const data = await apiClient.post<ApiResponse<{
      sftpPassword: string;
      expiresAt: number;
      ttlMs: number;
    }>>('/api/sftp/rotate-token', { serverId, ttlMs });
    return data.data;
  },

  listSftpTokens: async (serverId: string) => {
    const data = await apiClient.get<ApiResponse<Array<{
      userId: string;
      email: string;
      username: string | null;
      expiresAt: number;
      ttlMs: number;
      createdAt: number;
      token: string | null;
      isSelf: boolean;
    }>>>(`/api/sftp/tokens`, { params: { serverId } });
    return data.data;
  },

  revokeSftpToken: async (serverId: string, targetUserId: string) => {
    const data = await apiClient.delete<ApiResponse<void>>(
      `/api/sftp/tokens/${targetUserId}`,
      { params: { serverId } },
    );
    return data;
  },

  revokeAllSftpTokens: async (serverId: string) => {
    const data = await apiClient.delete<ApiResponse<{ revoked: number }>>(
      `/api/sftp/tokens`,
      { params: { serverId } },
    );
    return data.data;
  },

  respondEula: async (serverId: string, accepted: boolean) => {
    const data = await apiClient.post<ApiResponse<void>>('/api/servers/eula', {
      serverId,
      accepted,
    });
    return data;
  },

  rebuild: async (id: string) => {
    const data = await apiClient.post<ApiResponse<void>>(`/api/servers/${id}/rebuild`);
    return data;
  },

  transferOwnership: async (id: string, payload: { newOwnerId: string }) => {
    const data = await apiClient.post<ApiResponse<void>>(`/api/servers/${id}/transfer-ownership`, payload);
    return data;
  },

  transferCandidates: async (
    id: string,
    params?: { search?: string; limit?: number },
  ) => {
    type TransferCandidate = {
      id: string;
      email: string;
      username: string;
      name?: string | null;
    };
    const data = await apiClient.get<
      ApiResponse<TransferCandidate[]> | TransferCandidate[] | { users?: TransferCandidate[] }
    >(`/api/servers/${id}/transfer-candidates`, { params });
    // Backend: { success, data: User[] }. Tolerate bare array / nested shapes.
    if (Array.isArray(data)) return data;
    if (data && Array.isArray((data as any).data)) return (data as any).data;
    if (data && Array.isArray((data as any).users)) return (data as any).users;
    return [];
  },

  archive: async (id: string) => {
    const data = await apiClient.post<ApiResponse<void>>(`/api/servers/${id}/archive`);
    return data;
  },

  restore: async (id: string) => {
    const data = await apiClient.post<ApiResponse<void>>(`/api/servers/${id}/restore`);
    return data;
  },

  getBackupSettings: async (id: string) => {
    const data = await apiClient.get<ApiResponse<any>>(`/api/servers/${id}/backup-settings`);
    return data.data;
  },

  activity: async (id: string, params?: { page?: number; limit?: number }) => {
    const data = await apiClient.get<{
      success: boolean;
      data: import('../../types/server').ServerActivityLogEntry[];
      pagination: { page: number; limit: number; total: number; totalPages: number };
    }>(
      `/api/servers/${id}/activity`,
      { params },
    );
    return data;
  },

  getVariables: async (id: string) => {
    const data = await apiClient.get<ApiResponse<import('../../types/server').ServerStartupVariable[]>>(
      `/api/servers/${id}/variables`,
    );
    return Array.isArray(data.data) ? data.data : [];
  },

  updateVariables: async (id: string, payload: Record<string, string>) => {
    const data = await apiClient.patch<ApiResponse<Record<string, string>>>(
      `/api/servers/${id}/variables`,
      payload,
    );
    return data;
  },
};
