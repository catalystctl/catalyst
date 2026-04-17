import apiClient from './api/client';

// ── Types ──

export interface PermissionItem {
  value: string;
  label: string;
}

export interface PermissionCategory {
  id: string;
  label: string;
  description: string;
  permissions: PermissionItem[];
}

export interface ApiKey {
  id: string;
  name: string | null;
  prefix: string | null;
  start: string | null;
  enabled: boolean;
  expiresAt: string | null;
  lastRequest: string | null;
  requestCount: number;
  remaining: number | null;
  rateLimitMax: number;
  rateLimitTimeWindow: number;
  allPermissions: boolean;
  permissions: string[];
  metadata: Record<string, any> | null;
  createdAt: string;
  updatedAt: string;
  userId: string;
  user?: {
    id: string;
    username: string;
    email: string;
  };
}

export interface CreateApiKeyRequest {
  name: string;
  expiresIn?: number;
  allPermissions?: boolean;
  permissions?: string[];
  metadata?: Record<string, any>;
  rateLimitMax?: number;
  rateLimitTimeWindow?: number;
}

export interface CreateApiKeyResponse {
  id: string;
  name: string;
  key: string; // Full key — only shown once
  prefix: string;
  allPermissions: boolean;
  permissions: string[];
  expiresAt: string | null;
  createdAt: string;
  userId: string;
}

export interface UpdateApiKeyRequest {
  name?: string;
  enabled?: boolean;
}

export interface ApiKeyUsage {
  totalRequests: number;
  remaining: number | null;
  lastUsed: string | null;
  rateLimit: {
    max: number;
    windowMs: number;
  };
  createdAt: string;
}

// ── Service ──

export const apiKeyService = {
  /** List all API keys (admin only) */
  async list(): Promise<ApiKey[]> {
    const data = await apiClient.get<{ data: ApiKey[] }>('/api/admin/api-keys');
    return data.data;
  },

  /** Get a specific API key by ID */
  async get(id: string): Promise<ApiKey> {
    const data = await apiClient.get<{ data: ApiKey }>(`/api/admin/api-keys/${id}`);
    return data.data;
  },

  /** Create a new API key */
  async create(payload: CreateApiKeyRequest): Promise<CreateApiKeyResponse> {
    const result = await apiClient.post<{ data: CreateApiKeyResponse }>('/api/admin/api-keys', payload);
    return result.data;
  },

  /** Update an API key (name, enabled status) */
  async update(id: string, payload: UpdateApiKeyRequest): Promise<ApiKey> {
    const result = await apiClient.patch<{ data: ApiKey }>(`/api/admin/api-keys/${id}`, payload);
    return result.data;
  },

  /** Delete (revoke) an API key */
  async delete(id: string): Promise<void> {
    await apiClient.delete(`/api/admin/api-keys/${id}`);
  },

  /** Get usage statistics for an API key */
  async getUsage(id: string): Promise<ApiKeyUsage> {
    const data = await apiClient.get<{ data: ApiKeyUsage }>(`/api/admin/api-keys/${id}/usage`);
    return data.data;
  },

  /** Get the full permissions catalog (categories + individual permissions) */
  async getPermissionsCatalog(): Promise<PermissionCategory[]> {
    const data = await apiClient.get<{ data: PermissionCategory[] }>('/api/admin/api-keys/permissions-catalog');
    return data.data;
  },

  /** Get the current user's effective permissions */
  async getMyPermissions(): Promise<string[]> {
    const data = await apiClient.get<{ data: string[] }>('/api/admin/api-keys/my-permissions');
    return data.data;
  },
};

// ── Helpers ──

/** Look up a human-readable label for a permission value. */
export function getPermissionLabel(value: string, categories: PermissionCategory[]): string {
  if (value === '*') return 'Super Admin';
  for (const cat of categories) {
    const perm = cat.permissions.find((p) => p.value === value);
    if (perm) return perm.label;
  }
  return value;
}

/** Find which category a permission belongs to. */
export function getPermissionCategory(value: string, categories: PermissionCategory[]): PermissionCategory | undefined {
  return categories.find((cat) => cat.permissions.some((p) => p.value === value));
}
