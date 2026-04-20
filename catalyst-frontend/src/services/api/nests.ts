import apiClient from './client';
import type { Nest } from '../../types/template';
export type { Nest } from '../../types/template';

type ApiResponse<T> = {
  success: boolean;
  data?: T;
  error?: string;
};

export const nestsApi = {
  list: async (): Promise<Nest[]> => {
    const data = await apiClient.get<ApiResponse<Nest[]>>('/api/nests');
    return data.data || [];
  },
  create: async (payload: {
    name: string;
    description?: string;
    icon?: string;
    author?: string;
  }) => {
    const data = await apiClient.post<ApiResponse<Nest>>('/api/nests', payload);
    return data.data;
  },
  update: async (
    nestId: string,
    payload: { name?: string; description?: string; icon?: string; author?: string },
  ) => {
    const data = await apiClient.put<ApiResponse<Nest>>(`/api/nests/${nestId}`, payload);
    return data.data;
  },
  remove: async (nestId: string) => {
    await apiClient.delete(`/api/nests/${nestId}`);
  },
};
