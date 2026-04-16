import apiClient from './client';

export interface DashboardStats {
  servers: number;
  serversOnline: number;
  nodes: number;
  nodesOnline: number;
  alerts: number;
  alertsUnacknowledged: number;
}

export interface DashboardActivity {
  id: string;
  title: string;
  detail: string;
  time: string;
  type: 'server' | 'backup' | 'node' | 'alert' | 'user';
}

export interface ResourceStats {
  cpuUtilization: number;
  memoryUtilization: number;
  networkThroughput: number;
}

const dashboardApi = {
  getStats: async (): Promise<DashboardStats> => {
    const data = await apiClient.get<{ success?: boolean; data?: DashboardStats }>('/api/dashboard/stats');
    return data.data ?? (data as unknown as DashboardStats);
  },

  getActivity: async (limit = 5): Promise<DashboardActivity[]> => {
    const data = await apiClient.get<{ success?: boolean; data?: DashboardActivity[] }>('/api/dashboard/activity', {
      params: { limit },
    });
    return data.data ?? (data as unknown as DashboardActivity[]);
  },

  getResourceStats: async (): Promise<ResourceStats> => {
    const data = await apiClient.get<{ success?: boolean; data?: ResourceStats }>('/api/dashboard/resources');
    return data.data ?? (data as unknown as ResourceStats);
  },
};

export default dashboardApi;
