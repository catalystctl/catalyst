import apiClient from './client';
import type { Template } from '../../types/template';

type ApiResponse<T> = {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
};

export const templatesApi = {
  list: async () => {
    const data = await apiClient.get<ApiResponse<Template[]>>('/api/templates');
    return data.data || [];
  },
  get: async (templateId: string) => {
    const data = await apiClient.get<ApiResponse<Template>>(`/api/templates/${templateId}`);
    return data.data;
  },
  create: async (payload: {
    name: string;
    description?: string;
    author: string;
    version: string;
    image: string;
    images?: Template['images'];
    defaultImage?: string;
    installImage?: string;
    startup: string;
    stopCommand: string;
    sendSignalTo: string;
    variables: Template['variables'];
    installScript?: string;
    supportedPorts: number[];
    allocatedMemoryMb: number;
    allocatedCpuCores: number;
    features?: Template['features'];
    nestId?: string | null;
    srvService?: string | null;
    srvProtocol?: string | null;
  }) => {
    const data = await apiClient.post<ApiResponse<Template>>('/api/templates', payload);
    return data.data;
  },
  update: async (
    templateId: string,
    payload: Partial<{
      name: string;
      description?: string;
      author: string;
      version: string;
      image: string;
      images?: Template['images'];
      defaultImage?: string;
      installImage?: string;
      startup: string;
      stopCommand: string;
      sendSignalTo: string;
      variables: Template['variables'];
      installScript?: string;
      supportedPorts: number[];
      allocatedMemoryMb: number;
      allocatedCpuCores: number;
      features?: Template['features'];
      nestId?: string | null;
      srvService?: string | null;
      srvProtocol?: string | null;
    }>,
  ) => {
    const data = await apiClient.put<ApiResponse<Template>>(
      `/api/templates/${templateId}`,
      payload,
    );
    return data.data;
  },
  remove: async (templateId: string) => {
    const data = await apiClient.delete<ApiResponse<void>>(`/api/templates/${templateId}`);
    return data;
  },
};
