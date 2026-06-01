import apiClient from './client';
import type {
  AgentStatus,
  AgentLogEntry,
  AgentConfig,
  AgentUpdateStatus,
} from '../../types/agent';

type ApiResponse<T> = {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
};

export const agentApi = {
  /**
   * Get detailed agent status — connection state, versions, OS info, runtime.
   */
  getStatus: async (nodeId: string): Promise<AgentStatus | null> => {
    const data = await apiClient.get<ApiResponse<AgentStatus>>(
      `/api/nodes/${nodeId}/agent/status`,
    );
    return data.data ?? null;
  },

  /**
   * Get recent agent log entries (paginated, server-side buffer).
   */
  getLogs: async (
    nodeId: string,
    params?: { lines?: number; level?: string; seek?: string },
  ): Promise<AgentLogEntry[]> => {
    const data = await apiClient.get<ApiResponse<AgentLogEntry[]>>(
      `/api/nodes/${nodeId}/agent/logs`,
      { params },
    );
    return Array.isArray(data.data) ? data.data : [];
  },

  /**
   * Send restart command to agent via WS gateway.
   * The agent will gracefully shut down and restart (systemd or exec).
   */
  restart: async (nodeId: string): Promise<boolean> => {
    const data = await apiClient.post<ApiResponse<{ sent: boolean }>>(
      `/api/nodes/${nodeId}/agent/restart`,
    );
    return data.data?.sent ?? false;
  },

  /**
   * Trigger agent update to a specific version (or latest if omitted).
   * Sends update_agent command via WS gateway.
   */
  triggerUpdate: async (
    nodeId: string,
    targetVersion?: string,
  ): Promise<boolean> => {
    const data = await apiClient.post<ApiResponse<{ sent: boolean }>>(
      `/api/nodes/${nodeId}/agent/update`,
      { targetVersion },
    );
    return data.data?.sent ?? false;
  },

  /**
   * Get current update status/progress.
   */
  getUpdateStatus: async (nodeId: string): Promise<AgentUpdateStatus | null> => {
    const data = await apiClient.get<ApiResponse<AgentUpdateStatus>>(
      `/api/nodes/${nodeId}/agent/update-status`,
    );
    return data.data ?? null;
  },

  /**
   * Get agent configuration file content.
   */
  getConfig: async (nodeId: string): Promise<AgentConfig | null> => {
    const data = await apiClient.get<ApiResponse<AgentConfig>>(
      `/api/nodes/${nodeId}/agent/config`,
    );
    return data.data ?? null;
  },

  /**
   * Update agent configuration file.
   */
  updateConfig: async (
    nodeId: string,
    content: string,
  ): Promise<boolean> => {
    const data = await apiClient.put<ApiResponse<{ saved: boolean }>>(
      `/api/nodes/${nodeId}/agent/config`,
      { content },
    );
    return data.data?.saved ?? false;
  },

  /**
   * Send a ping/health-request to the agent and wait for response.
   */
  ping: async (nodeId: string): Promise<{ latencyMs: number } | null> => {
    const data = await apiClient.post<ApiResponse<{ latencyMs: number }>>(
      `/api/nodes/${nodeId}/agent/ping`,
    );
    return data.data ?? null;
  },
};
