import apiClient from './client';
import type {
  Role,
  RoleCreateInput,
  RoleUpdateInput,
  RolePreset,
  RoleUsersResponse,
} from '../../types/admin';

type ApiResponse<T> = {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
};

export const rolesApi = {
  // List all roles
  list: async () => {
    const { data } = await apiClient.get<ApiResponse<Role[]>>('/api/roles');
    return data.data || [];
  },

  // Get a single role by ID
  get: async (roleId: string) => {
    const { data } = await apiClient.get<ApiResponse<Role>>(`/api/roles/${roleId}`);
    return data.data;
  },

  // Create a new role
  create: async (input: RoleCreateInput) => {
    const { data } = await apiClient.post<ApiResponse<Role>>('/api/roles', input);
    return data.data;
  },

  // Update an existing role
  update: async (roleId: string, input: RoleUpdateInput) => {
    const { data } = await apiClient.put<ApiResponse<Role>>(`/api/roles/${roleId}`, input);
    return data.data;
  },

  // Delete a role
  delete: async (roleId: string) => {
    const { data } = await apiClient.delete<ApiResponse<void>>(`/api/roles/${roleId}`);
    return data;
  },

  // Add permission to role
  addPermission: async (roleId: string, permission: string) => {
    const { data } = await apiClient.post<ApiResponse<Role>>(
      `/api/roles/${roleId}/permissions`,
      { permission }
    );
    return data.data;
  },

  // Remove permission from role
  removePermission: async (roleId: string, permission: string) => {
    const { data } = await apiClient.delete<ApiResponse<Role>>(
      `/api/roles/${roleId}/permissions/${encodeURIComponent(permission)}`
    );
    return data.data;
  },

  // Assign role to user
  assignToUser: async (roleId: string, userId: string) => {
    const { data } = await apiClient.post<ApiResponse<void>>(
      `/api/roles/${roleId}/users/${userId}`
    );
    return data;
  },

  // Remove role from user
  removeFromUser: async (roleId: string, userId: string) => {
    const { data } = await apiClient.delete<ApiResponse<void>>(
      `/api/roles/${roleId}/users/${userId}`
    );
    return data;
  },

  // Get user roles and permissions
  getUserRoles: async (userId: string) => {
    const { data } = await apiClient.get<ApiResponse<RoleUsersResponse>>(
      `/api/roles/users/${userId}/roles`
    );
    return data.data;
  },

  // Get role presets
  getPresets: async () => {
    const { data } = await apiClient.get<ApiResponse<RolePreset[]>>('/api/roles/presets');
    return data.data || [];
  },
};
