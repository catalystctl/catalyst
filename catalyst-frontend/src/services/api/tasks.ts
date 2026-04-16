import apiClient from './client';
import type { Task } from '../../types/task';

export type CreateTaskPayload = {
  name: string;
  description?: string;
  action: Task['action'];
  payload?: Record<string, unknown>;
  schedule: string;
};

export type UpdateTaskPayload = {
  name?: string;
  description?: string;
  action?: Task['action'];
  payload?: Record<string, unknown>;
  schedule?: string;
  enabled?: boolean;
};

export const tasksApi = {
  list: async (serverId: string) => {
    const data = await apiClient.get<{ tasks: Task[] }>(`/api/servers/${serverId}/tasks`);
    return data.tasks ?? [];
  },
  create: async (serverId: string, payload: CreateTaskPayload) => {
    const data = await apiClient.post<{ success: boolean; task: Task }>(
      `/api/servers/${serverId}/tasks`,
      payload,
    );
    return data.task;
  },
  update: async (serverId: string, taskId: string, payload: UpdateTaskPayload) => {
    const data = await apiClient.put<{ success: boolean; task: Task }>(
      `/api/servers/${serverId}/tasks/${taskId}`,
      payload,
    );
    return data.task;
  },
  remove: async (serverId: string, taskId: string) => {
    const data = await apiClient.delete<{ success: boolean; message?: string }>(
      `/api/servers/${serverId}/tasks/${taskId}`,
    );
    return data;
  },
};
