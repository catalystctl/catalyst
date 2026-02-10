import apiClient from './client';
import type { NodeInfo, NodeMetricsResponse, NodeStats, NodeAllocation } from '../../types/node';

type ApiResponse<T> = {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
};

export type NodeAssignment = {
  id: string;
  nodeId: string;
  nodeName: string;
  userId?: string | null;
  roleId?: string | null;
  roleName?: string | null;
  assignedBy: string;
  assignedAt: Date;
  expiresAt?: Date | null;
  source: 'user' | 'role';
};

export const nodesApi = {
  list: async () => {
    const { data } = await apiClient.get<ApiResponse<NodeInfo[]>>('/api/nodes');
    return data.data || [];
  },
  get: async (nodeId: string) => {
    const { data } = await apiClient.get<ApiResponse<NodeInfo>>(`/api/nodes/${nodeId}`);
    return data.data;
  },
  stats: async (nodeId: string) => {
    const { data } = await apiClient.get<ApiResponse<NodeStats>>(`/api/nodes/${nodeId}/stats`);
    return data.data;
  },
  metrics: async (nodeId: string, params?: { hours?: number; limit?: number }) => {
    const { data } = await apiClient.get<ApiResponse<NodeMetricsResponse>>(
      `/api/nodes/${nodeId}/metrics`,
      { params },
    );
    return data.data;
  },
  create: async (payload: {
    name: string;
    description?: string;
    locationId: string;
    hostname: string;
    publicAddress: string;
    maxMemoryMb: number;
    maxCpuCores: number;
    serverDataDir?: string;
  }) => {
    const { data } = await apiClient.post<ApiResponse<NodeInfo>>('/api/nodes', payload);
    return data.data;
  },
  update: async (
    nodeId: string,
    payload: {
      name?: string;
      description?: string;
      hostname?: string;
      publicAddress?: string;
      maxMemoryMb?: number;
      maxCpuCores?: number;
      serverDataDir?: string;
    },
  ) => {
    const { data } = await apiClient.put<ApiResponse<NodeInfo>>(`/api/nodes/${nodeId}`, payload);
    return data.data;
  },
  remove: async (nodeId: string) => {
    const { data } = await apiClient.delete<ApiResponse<void>>(`/api/nodes/${nodeId}`);
    return data;
  },
  deploymentToken: async (nodeId: string) => {
    const { data } = await apiClient.post<
      ApiResponse<{
        deploymentToken: string;
        secret: string;
        apiKey: string | null;
        deployUrl: string;
        expiresAt: string;
      }>
    >(`/api/nodes/${nodeId}/deployment-token`);
    return data.data;
  },
  ipPools: async (nodeId: string) => {
    const { data } = await apiClient.get<
      ApiResponse<Array<{ id: string; networkName: string; cidr: string; availableCount: number }>>
    >(`/api/nodes/${nodeId}/ip-pools`);
    return data.data || [];
  },
  availableIps: async (nodeId: string, networkName: string, limit = 200) => {
    const { data } = await apiClient.get<ApiResponse<string[]>>(
      `/api/nodes/${nodeId}/ip-availability`,
      { params: { networkName, limit } },
    );
    return data.data || [];
  },
  allocations: async (nodeId: string, params?: { search?: string; serverId?: string }) => {
    const { data } = await apiClient.get<ApiResponse<NodeAllocation[]>>(
      `/api/nodes/${nodeId}/allocations`,
      { params },
    );
    return data.data || [];
  },
  createAllocations: async (
    nodeId: string,
    payload: { ip: string; ports: string; alias?: string; notes?: string },
  ) => {
    const { data } = await apiClient.post<ApiResponse<{ created: number }>>(
      `/api/nodes/${nodeId}/allocations`,
      payload,
    );
    return data.data;
  },
  updateAllocation: async (
    nodeId: string,
    allocationId: string,
    payload: { alias?: string; notes?: string },
  ) => {
    const { data } = await apiClient.patch<ApiResponse<NodeAllocation>>(
      `/api/nodes/${nodeId}/allocations/${allocationId}`,
      payload,
    );
    return data.data;
  },
  deleteAllocation: async (nodeId: string, allocationId: string) => {
    const { data } = await apiClient.delete<ApiResponse<void>>(
      `/api/nodes/${nodeId}/allocations/${allocationId}`,
    );
    return data;
  },
  checkApiKey: async (nodeId: string) => {
    const { data } = await apiClient.get<
      ApiResponse<{
        exists: boolean;
        apiKey: {
          id: string;
          name: string;
          preview: string | null;
          createdAt: string;
          enabled: boolean;
        } | null;
      }>
    >(`/api/nodes/${nodeId}/api-key`);
    return data.data;
  },
  generateApiKey: async (nodeId: string, regenerate?: boolean) => {
    const { data } = await apiClient.post<
      ApiResponse<{
        apiKey: string;
        nodeId: string;
        regenerated?: boolean;
      }>
    >(`/api/nodes/${nodeId}/api-key`, { regenerate });
    return data.data;
  },

  // Node Assignment APIs
  getAssignments: async (nodeId: string) => {
    const { data } = await apiClient.get<ApiResponse<NodeAssignment[]>>(
      `/api/nodes/${nodeId}/assignments`,
    );
    return data.data || [];
  },

  assignNode: async (
    nodeId: string,
    payload: {
      targetType: 'user' | 'role';
      targetId: string;
      expiresAt?: string;
    },
  ) => {
    const { data } = await apiClient.post<ApiResponse<NodeAssignment>>(
      `/api/nodes/${nodeId}/assign`,
      payload,
    );
    return data.data;
  },

  removeAssignment: async (nodeId: string, assignmentId: string) => {
    const { data } = await apiClient.delete<ApiResponse<void>>(
      `/api/nodes/${nodeId}/assignments/${assignmentId}`,
    );
    return data;
  },

  getAccessibleNodes: async () => {
    const { data } = await apiClient.get<ApiResponse<NodeInfo[]>>('/api/nodes/accessible');
    return data.data || [];
  },

  // Wildcard assignment - assign all nodes (current and future)
  assignWildcard: async (payload: {
    targetType: 'user' | 'role';
    targetId: string;
    expiresAt?: string;
  }) => {
    const { data } = await apiClient.post<ApiResponse<NodeAssignment>>(
      '/api/nodes/assign-wildcard',
      payload,
    );
    return data.data;
  },

  // Remove wildcard assignment
  removeWildcard: async (targetType: 'user' | 'role', targetId: string) => {
    const { data } = await apiClient.delete<ApiResponse<void>>(
      `/api/nodes/assign-wildcard/${targetType}/${targetId}`,
    );
    return data;
  },
};
