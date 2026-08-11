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
    const data = await apiClient.get<{ tasks?: Task[] } | Task[]>(`/api/servers/${serverId}/tasks`);
    // Backend sends `{ tasks: [...] }`; tolerate a bare array or nested shapes.
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.tasks)) return data.tasks;
    const nested = (data as any)?.data;
    if (Array.isArray(nested)) return nested;
    if (nested && Array.isArray(nested.tasks)) return nested.tasks;
    return [];
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
