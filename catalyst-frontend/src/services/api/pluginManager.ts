import apiClient from './client';

export type PluginManagerSearchResponse = {
  hits?: any[];
  data?: any[];
  total_hits?: number;
  totalCount?: number;
};

export type InstalledPlugin = {
  name: string;
  size: number;
  modifiedAt: string | null;
  provider: string | null;
  projectId: string | null;
  versionId: string | null;
  projectName: string | null;
  hasUpdate: boolean;
  latestVersionId: string | null;
  latestVersionName: string | null;
  updateCheckedAt: string | null;
};

export const pluginManagerApi = {
  gameVersions: async (serverId: string, provider: string) => {
    const data = await apiClient.get<{ success: boolean; data?: string[] }>(
      `/api/servers/${serverId}/plugin-manager/game-versions`,
      { params: { provider } },
    );
    return data.data ?? [];
  },
  search: async (
    serverId: string,
    params: {
      provider: string;
      query?: string;
      gameVersion?: string;
      page?: number;
    },
  ) => {
    const data = await apiClient.get<{ success: boolean; data?: PluginManagerSearchResponse }>(
      `/api/servers/${serverId}/plugin-manager/search`,
      { params },
    );
    return data.data;
  },
  versions: async (serverId: string, params: { provider: string; projectId: string }) => {
    const data = await apiClient.get<{ success: boolean; data?: any }>(
      `/api/servers/${serverId}/plugin-manager/versions`,
      { params },
    );
    return data.data;
  },
  install: async (
    serverId: string,
    payload: {
      provider: string;
      projectId: string;
      versionId: string | number;
      projectName?: string;
    },
  ) => {
    const data = await apiClient.post<{ success: boolean; data?: { path: string } }>(
      `/api/servers/${serverId}/plugin-manager/install`,
      payload,
    );
    return data.data;
  },
  installed: async (serverId: string) => {
    const data = await apiClient.get<{ success: boolean; data: InstalledPlugin[] }>(
      `/api/servers/${serverId}/plugin-manager/installed`,
    );
    return data.data ?? [];
  },
  uninstall: async (serverId: string, filename: string) => {
    const data = await apiClient.post<{ success: boolean }>(
      `/api/servers/${serverId}/plugin-manager/uninstall`,
      { filename },
    );
    return data;
  },
  checkUpdates: async (serverId: string) => {
    const data = await apiClient.post<{
      success: boolean;
      data: { checked: number; updatesAvailable: number };
    }>(`/api/servers/${serverId}/plugin-manager/check-updates`);
    return data.data;
  },
  update: async (serverId: string, filenames: string[]) => {
    const data = await apiClient.post<{
      success: boolean;
      data: { filename: string; success: boolean; error?: string }[];
    }>(`/api/servers/${serverId}/plugin-manager/update`, { filenames });
    return data.data;
  },
};
