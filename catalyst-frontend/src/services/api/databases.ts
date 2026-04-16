import apiClient from './client';
import type { ServerDatabase } from '../../types/database';

type ApiResponse<T> = {
  success: boolean;
  data?: T;
  error?: string;
};

export const databasesApi = {
  list: async (serverId: string) => {
    const data = await apiClient.get<ApiResponse<ServerDatabase[]>>(
      `/api/servers/${serverId}/databases`,
    );
    return data.data || [];
  },
  create: async (serverId: string, payload: { name?: string; hostId: string }) => {
    const data = await apiClient.post<ApiResponse<ServerDatabase>>(
      `/api/servers/${serverId}/databases`,
      payload,
    );
    return data.data;
  },
  rotatePassword: async (serverId: string, databaseId: string) => {
    const data = await apiClient.post<ApiResponse<ServerDatabase>>(
      `/api/servers/${serverId}/databases/${databaseId}/rotate`,
    );
    return data.data;
  },
  remove: async (serverId: string, databaseId: string) => {
    const data = await apiClient.delete<ApiResponse<void>>(
      `/api/servers/${serverId}/databases/${databaseId}`,
    );
    return data;
  },
};
