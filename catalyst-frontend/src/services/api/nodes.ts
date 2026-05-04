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
    const data = await apiClient.get<ApiResponse<NodeInfo[]>>('/api/nodes');
    return data.data || [];
  },
  get: async (nodeId: string) => {
    const data = await apiClient.get<ApiResponse<NodeInfo>>(`/api/nodes/${nodeId}`);
    return data.data;
  },
  stats: async (nodeId: string) => {
    const data = await apiClient.get<ApiResponse<NodeStats>>(`/api/nodes/${nodeId}/stats`);
    return data.data;
  },
  metrics: async (nodeId: string, params?: { hours?: number; limit?: number }) => {
    const data = await apiClient.get<ApiResponse<NodeMetricsResponse>>(
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
    memoryOverallocatePercent?: number;
    cpuOverallocatePercent?: number;
    serverDataDir?: string;
  }) => {
    const data = await apiClient.post<ApiResponse<NodeInfo>>('/api/nodes', payload);
    return data.data;
  },
  update: async (
    nodeId: string,
    payload: {
      name?: string;
      description?: string;
      locationId?: string;
      hostname?: string;
      publicAddress?: string;
      maxMemoryMb?: number;
      maxCpuCores?: number;
      memoryOverallocatePercent?: number;
      cpuOverallocatePercent?: number;
      serverDataDir?: string;
    },
  ) => {
    const data = await apiClient.put<ApiResponse<NodeInfo>>(`/api/nodes/${nodeId}`, payload);
    return data.data;
  },
  remove: async (nodeId: string) => {
    const data = await apiClient.delete<ApiResponse<void>>(`/api/nodes/${nodeId}`);
    return data;
  },
  deploymentToken: async (nodeId: string) => {
    const data = await apiClient.post<
      ApiResponse<{
        deploymentToken: string;
        apiKey: string;
        deployUrl: string;
        expiresAt: string;
      }>
    >(`/api/nodes/${nodeId}/deployment-token`);
    return data.data;
  },
  ipPools: async (nodeId: string) => {
    const data = await apiClient.get<
      ApiResponse<Array<{ id: string; networkName: string; cidr: string; availableCount: number }>>
    >(`/api/nodes/${nodeId}/ip-pools`);
    return data.data || [];
  },
  availableIps: async (nodeId: string, networkName: string, limit = 200) => {
    const data = await apiClient.get<ApiResponse<string[]>>(
      `/api/nodes/${nodeId}/ip-availability`,
      { params: { networkName, limit } },
    );
    return data.data || [];
  },
  allocations: async (nodeId: string, params?: { search?: string; serverId?: string }) => {
    const data = await apiClient.get<ApiResponse<NodeAllocation[]>>(
      `/api/nodes/${nodeId}/allocations`,
      { params },
    );
    return data.data || [];
  },
  createAllocations: async (
    nodeId: string,
    payload: { ip: string; ports: string; alias?: string; notes?: string },
  ) => {
    const data = await apiClient.post<ApiResponse<{ created: number }>>(
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
    const data = await apiClient.patch<ApiResponse<NodeAllocation>>(
      `/api/nodes/${nodeId}/allocations/${allocationId}`,
      payload,
    );
    return data.data;
  },
  deleteAllocation: async (nodeId: string, allocationId: string) => {
    const data = await apiClient.delete<ApiResponse<void>>(
      `/api/nodes/${nodeId}/allocations/${allocationId}`,
    );
    return data;
  },
  checkApiKey: async (nodeId: string) => {
    const data = await apiClient.get<
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
    const data = await apiClient.post<
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
    const data = await apiClient.get<ApiResponse<NodeAssignment[]>>(
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
    const data = await apiClient.post<ApiResponse<NodeAssignment>>(
      `/api/nodes/${nodeId}/assign`,
      payload,
    );
    return data.data;
  },

  removeAssignment: async (nodeId: string, assignmentId: string) => {
    const data = await apiClient.delete<ApiResponse<void>>(
      `/api/nodes/${nodeId}/assignments/${assignmentId}`,
    );
    return data;
  },

  getAccessibleNodes: async () => {
    const data = await apiClient.get<ApiResponse<NodeInfo[]>>('/api/nodes/accessible');
    return data.data || [];
  },

  // Wildcard assignment - assign all nodes (current and future)
  assignWildcard: async (payload: {
    targetType: 'user' | 'role';
    targetId: string;
    expiresAt?: string;
  }) => {
    const data = await apiClient.post<ApiResponse<NodeAssignment>>(
      '/api/nodes/assign-wildcard',
      payload,
    );
    return data.data;
  },

  // Remove wildcard assignment
  removeWildcard: async (targetType: 'user' | 'role', targetId: string) => {
    const data = await apiClient.delete<ApiResponse<void>>(
      `/api/nodes/assign-wildcard/${targetType}/${targetId}`,
    );
    return data;
  },

  // Get unregistered containers on a node (containers not registered as servers)
  getUnregisteredContainers: async (nodeId: string) => {
    const data = await apiClient.get<
      ApiResponse<
        Array<{
          containerId: string;
          image: string;
          status: string;
          labels: Record<string, string>;
          networkMode?: string;
          memoryLimitMb?: number;
          cpuCores?: number;
          startupCommand?: string;
          envVarNames?: string[];
          discoveredAt: number;
        }>
      >
    >(`/api/nodes/${nodeId}/unregistered-containers`);
    return data.data || [];
  },

  // Suggest template match for an unregistered container
  suggestTemplate: async (nodeId: string, containerId: string) => {
    const data = await apiClient.get<
      ApiResponse<
        Array<{
          templateId: string;
          templateName: string;
          score: number;
          matchReasons: string[];
        }>
      >
    >(`/api/nodes/${nodeId}/unregistered-containers/${containerId}/suggest-template`);
    return data.data || [];
  },

  // Import a discovered container as a server
  importServer: async (
    nodeId: string,
    payload: {
      containerId: string;
      name: string;
      templateId: string;
      ownerId: string;
      allocatedMemoryMb?: number;
      allocatedCpuCores?: number;
      allocatedDiskMb?: number;
      primaryPort?: number;
      portBindings?: Record<number, number>;
      environment?: Record<string, string>;
    },
  ) => {
    const data = await apiClient.post<ApiResponse<any>>(
      `/api/nodes/${nodeId}/import-server`,
      payload,
    );
    return data.data;
  },
};
