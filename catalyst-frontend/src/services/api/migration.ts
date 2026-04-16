import apiClient from './client';
import type {
  MigrationJob,
  MigrationStepsResponse,
  PterodactylTestResult,
  CatalystNodeOption,
} from '../../types/migration';

export const migrationApi = {
  testConnection: async (url: string, key: string, clientApiKey?: string) => {
    const data = await apiClient.post<PterodactylTestResult>('/api/admin/migration/test', { url, key, clientApiKey });
    return data;
  },

  start: async (payload: {
    url: string;
    key: string;
    clientApiKey?: string;
    scope: 'full' | 'node' | 'server';
    nodeMappings: Record<string, string>;
    serverMappings: Record<string, string>;
  }) => {
    const data = await apiClient.post<{ jobId: string }>('/api/admin/migration/start', payload);
    return data;
  },

  getStatus: async (jobId: string) => {
    const data = await apiClient.get<MigrationJob>(`/api/admin/migration/${jobId}`);
    return data;
  },

  listJobs: async () => {
    const data = await apiClient.get<MigrationJob[]>('/api/admin/migration');
    return data;
  },

  getCatalystNodes: async () => {
    const data = await apiClient.get<CatalystNodeOption[]>('/api/admin/migration/catalyst-nodes');
    return data;
  },

  pause: async (jobId: string) => {
    const { data } = await apiClient.post(`/api/admin/migration/${jobId}/pause`);
    return data;
  },

  resume: async (jobId: string) => {
    const { data } = await apiClient.post(`/api/admin/migration/${jobId}/resume`);
    return data;
  },

  cancel: async (jobId: string) => {
    const { data } = await apiClient.post(`/api/admin/migration/${jobId}/cancel`);
    return data;
  },

  getSteps: async (
    jobId: string,
    params?: { phase?: string; status?: string; page?: number; limit?: number }
  ) => {
    const data = await apiClient.get<MigrationStepsResponse>(
      `/api/admin/migration/${jobId}/steps`,
      { params }
    );
    return data;
  },

  retryStep: async (jobId: string, stepId: string) => {
    const { data } = await apiClient.post(`/api/admin/migration/${jobId}/retry/${stepId}`);
    return data;
  },
};
