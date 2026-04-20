import apiClient from './client';

export interface Location {
  id: string;
  name: string;
  description?: string | null;
  createdAt?: string;
  nodeCount?: number;
}

type ApiResponse<T> = {
  success: boolean;
  data?: T;
  error?: string;
};

export const locationsApi = {
  list: async (): Promise<Location[]> => {
    const data = await apiClient.get<ApiResponse<Location[]>>('/api/locations');
    return data.data || [];
  },
  create: async (payload: { name: string; description?: string }) => {
    const data = await apiClient.post<ApiResponse<Location>>('/api/locations', payload);
    return data.data;
  },
  update: async (locationId: string, payload: { name?: string; description?: string }) => {
    const data = await apiClient.put<ApiResponse<Location>>(
      `/api/locations/${locationId}`,
      payload,
    );
    return data.data;
  },
  remove: async (locationId: string) => {
    await apiClient.delete(`/api/locations/${locationId}`);
  },
};
