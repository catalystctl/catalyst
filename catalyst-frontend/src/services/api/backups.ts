import apiClient from './client';
import type { BackupListResponse, Backup } from '../../types/backup';

export const backupsApi = {
  list: async (serverId: string, params?: { page?: number; limit?: number }) => {
    const data = await apiClient.get<BackupListResponse>(`/api/servers/${serverId}/backups`, {
      params,
    });
    return data;
  },
  create: async (serverId: string, payload: { name?: string }) => {
    const data = await apiClient.post<{ success: boolean; message?: string; backupName?: string }>(
      `/api/servers/${serverId}/backups`,
      payload,
    );
    return data;
  },
  restore: async (serverId: string, backupId: string) => {
    const data = await apiClient.post<{ success: boolean; message?: string }>(
      `/api/servers/${serverId}/backups/${backupId}/restore`,
    );
    return data;
  },
  remove: async (serverId: string, backupId: string) => {
    const data = await apiClient.delete<{ success: boolean; message?: string }>(
      `/api/servers/${serverId}/backups/${backupId}`,
    );
    return data;
  },
  download: async (
    serverId: string,
    backupId: string,
    onProgress?: (progress: { loaded: number; total?: number }) => void,
  ) => {
    const response = await apiClient.get<Blob>(
      `/api/servers/${serverId}/backups/${backupId}/download`,
      {
        responseType: 'blob',
        onDownloadProgress: (event) => {
          if (!onProgress) return;
          const total = Number.isFinite(event.total) && event.total && event.total > 0 ? event.total : undefined;
          onProgress({ loaded: event.loaded, total });
        },
      },
    );
    return response.data;
  },
  get: async (serverId: string, backupId: string) => {
    const data = await apiClient.get<Backup>(`/api/servers/${serverId}/backups/${backupId}`);
    return data;
  },
};
