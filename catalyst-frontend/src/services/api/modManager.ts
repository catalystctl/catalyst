import apiClient from './client';

export type ModManagerSearchResponse = {
  hits?: any[];
  data?: any[];
  total_hits?: number;
  totalCount?: number;
};

export type InstalledMod = {
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

export const modManagerApi = {
  search: async (
    serverId: string,
    params: {
      provider: string;
      game?: string;
      query?: string;
      target?: 'mods' | 'datapacks' | 'modpacks';
      loader?: string;
      gameVersion?: string;
      page?: number;
    },
  ) => {
    const data = await apiClient.get<{ success: boolean; data?: ModManagerSearchResponse }>(
      `/api/servers/${serverId}/mod-manager/search`,
      { params },
    );
    return data.data;
  },
  versions: async (
    serverId: string,
    params: { provider: string; game?: string; projectId: string },
  ) => {
    const data = await apiClient.get<{ success: boolean; data?: any }>(
      `/api/servers/${serverId}/mod-manager/versions`,
      { params },
    );
    return data.data;
  },
  install: async (
    serverId: string,
    payload: {
      provider: string;
      game?: string;
      projectId: string;
      versionId: string | number;
      target: 'mods' | 'datapacks' | 'modpacks';
      projectName?: string;
    },
  ) => {
    const data = await apiClient.post<{ success: boolean; data?: { path: string } }>(
      `/api/servers/${serverId}/mod-manager/install`,
      payload,
    );
    return data.data;
  },
  installed: async (serverId: string, target?: string) => {
    const data = await apiClient.get<{ success: boolean; data: InstalledMod[] }>(
      `/api/servers/${serverId}/mod-manager/installed`,
      { params: { target } },
    );
    return data.data ?? [];
  },
  uninstall: async (serverId: string, filename: string, target?: string) => {
    const data = await apiClient.post<{ success: boolean }>(
      `/api/servers/${serverId}/mod-manager/uninstall`,
      { filename, target },
    );
    return data;
  },
  checkUpdates: async (serverId: string) => {
    const data = await apiClient.post<{
      success: boolean;
      data: { checked: number; updatesAvailable: number };
    }>(`/api/servers/${serverId}/mod-manager/check-updates`);
    return data.data;
  },
  update: async (serverId: string, filenames: string[]) => {
    const data = await apiClient.post<{
      success: boolean;
      data: { filename: string; success: boolean; error?: string }[];
    }>(`/api/servers/${serverId}/mod-manager/update`, { filenames });
    return data.data;
  },
};
