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
    const response = await apiClient.get('/api/dashboard/stats');
    return response.data?.data ?? response.data;
  },

  getActivity: async (limit = 5): Promise<DashboardActivity[]> => {
    const response = await apiClient.get('/api/dashboard/activity', {
      params: { limit },
    });
    return response.data?.data ?? response.data;
  },

  getResourceStats: async (): Promise<ResourceStats> => {
    const response = await apiClient.get('/api/dashboard/resources');
    return response.data?.data ?? response.data;
  },
};

export default dashboardApi;
