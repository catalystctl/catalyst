import apiClient from './client';
import type { Alert, AlertDelivery, AlertRule } from '../../types/alert';

type ApiResponse<T> = {
  success?: boolean;
  data?: T;
  error?: string;
  message?: string;
};

export const alertsApi = {
  list: async (params?: {
    page?: number;
    limit?: number;
    serverId?: string;
    nodeId?: string;
    type?: string;
    severity?: string;
    resolved?: boolean;
    scope?: 'mine' | 'all';
  }) => {
    const data = await apiClient.get<{ alerts: Alert[]; pagination: any }>('/api/alerts', { params });
    return data;
  },
  stats: async () => {
    const data = await apiClient.get<{
      total: number;
      unresolved: number;
      bySeverity: Record<string, number>;
      byType: Record<string, number>;
    }>('/api/alerts/stats');
    return data;
  },
  statsScoped: async (params?: { scope?: 'mine' | 'all' }) => {
    const data = await apiClient.get<{
      total: number;
      unresolved: number;
      bySeverity: Record<string, number>;
      byType: Record<string, number>;
    }>('/api/alerts/stats', { params });
    return data;
  },
  get: async (alertId: string) => {
    const data = await apiClient.get<{ alert: Alert }>(`/api/alerts/${alertId}`);
    return data.alert;
  },
  resolve: async (alertId: string) => {
    const data = await apiClient.post<ApiResponse<void>>(`/api/alerts/${alertId}/resolve`);
    return data;
  },
  bulkResolve: async (alertIds: string[]) => {
    const data = await apiClient.post<ApiResponse<void>>('/api/alerts/bulk-resolve', { alertIds });
    return data;
  },
  deliveries: async (alertId: string) => {
    const data = await apiClient.get<{ deliveries: AlertDelivery[] }>(`/api/alerts/${alertId}/deliveries`);
    return data.deliveries;
  },
  listRules: async (params?: {
    type?: string;
    enabled?: boolean;
    target?: string;
    targetId?: string;
    scope?: 'mine' | 'all';
  }) => {
    const data = await apiClient.get<{ rules: AlertRule[] }>('/api/alert-rules', { params });
    return data.rules;
  },
  createRule: async (payload: {
    name: string;
    description?: string;
    type: AlertRule['type'];
    target: AlertRule['target'];
    targetId?: string | null;
    conditions: Record<string, unknown>;
    actions: Record<string, unknown>;
    enabled?: boolean;
  }) => {
    const data = await apiClient.post<{ success: boolean; rule: AlertRule }>('/api/alert-rules', payload);
    return data.rule;
  },
  updateRule: async (
    ruleId: string,
    payload: Partial<{
      name: string;
      description: string;
      conditions: Record<string, unknown>;
      actions: Record<string, unknown>;
      enabled: boolean;
    }>,
  ) => {
    const data = await apiClient.put<{ success: boolean; rule: AlertRule }>(
      `/api/alert-rules/${ruleId}`,
      payload,
    );
    return data.rule;
  },
  deleteRule: async (ruleId: string) => {
    const data = await apiClient.delete<ApiResponse<void>>(`/api/alert-rules/${ruleId}`);
    return data;
  },
};
