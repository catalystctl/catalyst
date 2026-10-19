import apiClient from './client';

/** Phases the backend reports while a modpack installs. */
export type ModpackInstallPhase =
  | 'extracting'
  | 'installing-files'
  | 'applying-overrides'
  | 'finalizing';

export type ModpackInstallStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface ModpackInstallProgress {
  phase: ModpackInstallPhase;
  completed: number;
  total: number;
}

export interface ModpackInstallResult {
  format: 'mrpack' | 'curseforge' | 'generic-zip' | 'tar' | 'unknown';
  container: 'zip' | 'tar' | 'unknown';
  name?: string;
  version?: string;
  gameVersion?: string;
  modLoader?: string;
  installedFiles: string[];
  installedOverrides: number;
  skipped: Array<{ path: string; reason: string }>;
  warnings: string[];
}

export interface ModpackInstallJob {
  id: string;
  status: ModpackInstallStatus;
  progress: ModpackInstallProgress | null;
  result: ModpackInstallResult | null;
  error: string | null;
  code: string | null;
  filename: string;
}

type JobEnvelope = { success: boolean; data?: ModpackInstallJob };

export const modpackApi = {
  /** Install from an uploaded archive (multipart). */
  installUpload: async (
    serverId: string,
    file: File,
    options?: { path?: string },
  ): Promise<ModpackInstallJob | undefined> => {
    const form = new FormData();
    form.append('file', file, file.name);
    if (options?.path) form.append('path', options.path);
    const response = await apiClient.post<JobEnvelope>(
      `/api/servers/${serverId}/modpack-manager/install`,
      form,
      // Uploads of a few hundred MB outlive the default request timeout.
      { timeoutMs: 10 * 60 * 1000 },
    );
    return response.data;
  },

  /** Install from a URL the backend hands to the node agent. */
  installUrl: async (
    serverId: string,
    url: string,
    options?: { filename?: string; path?: string },
  ): Promise<ModpackInstallJob | undefined> => {
    const response = await apiClient.post<JobEnvelope>(
      `/api/servers/${serverId}/modpack-manager/install`,
      { url, filename: options?.filename, path: options?.path },
    );
    return response.data;
  },

  job: async (serverId: string, jobId: string): Promise<ModpackInstallJob | undefined> => {
    const response = await apiClient.get<JobEnvelope>(
      `/api/servers/${serverId}/modpack-manager/jobs/${jobId}`,
    );
    return response.data;
  },
};
