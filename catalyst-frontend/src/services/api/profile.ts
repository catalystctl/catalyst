import apiClient from './client';
import { reportSystemError } from './systemErrors';
import { authClient } from '../authClient';

// ── Types ──

export interface ProfileAccount {
  id: string;
  providerId: string;
  accountId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileSummary {
  id: string;
  email: string;
  username: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  image: string | null;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  hasPassword: boolean;
  createdAt: string;
  failedLoginAttempts: number;
  lastFailedLogin: string | null;
  lastSuccessfulLogin: string | null;
  preferences: Record<string, unknown>;
  accounts: ProfileAccount[];
}

export interface Passkey {
  id: string;
  name?: string;
  userId: string;
  credentialID: string;
  deviceType: string;
  backedUp: boolean;
  transports?: string;
  createdAt: string;
  aaguid?: string;
}

export interface UserSession {
  id: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  token: string;
}

export interface AuditLogEntry {
  id: string;
  action: string;
  resource: string;
  resourceId: string | null;
  details: unknown;
  timestamp: string;
}

export interface ApiKeySummary {
  id: string;
  name: string | null;
  prefix: string | null;
  start: string | null;
  enabled: boolean;
  allPermissions: boolean;
  permissions: string[];
  lastRequest: string | null;
  requestCount: number;
  expiresAt: string | null;
  createdAt: string;
}

// ── Service ──

export const profileApi = {
  // ── Profile ──
  async getProfile(): Promise<ProfileSummary> {
    const data = await apiClient.get<{ success: boolean; data: ProfileSummary }>('/api/auth/profile');
    if (!data?.success) {
      reportSystemError({
        level: 'error',
        component: 'ApiProfile',
        message: 'Failed to load profile',
        metadata: { action: 'getProfile' },
      });
      throw new Error('Failed to load profile');
    }
    return data.data;
  },
  async updateProfile(payload: { username?: string; firstName?: string; lastName?: string }) {
    const { data } = await apiClient.patch('/api/auth/profile', payload);
    return data;
  },
  async updatePreferences(prefs: Record<string, unknown>) {
    const data = await apiClient.patch('/api/auth/profile/preferences', prefs);
    return data;
  },

  // ── Password ──
  async changePassword(payload: { currentPassword: string; newPassword: string; revokeOtherSessions?: boolean }) {
    const { data } = await apiClient.post('/api/auth/profile/change-password', payload);
    return data;
  },
  async setPassword(payload: { newPassword: string }) {
    const { data } = await apiClient.post('/api/auth/profile/set-password', payload);
    return data;
  },

  // ── 2FA ──
  async getTwoFactorStatus() {
    const { data } = await apiClient.get('/api/auth/profile/two-factor');
    return data;
  },
  async enableTwoFactor(payload: { password: string }) {
    const { data } = await apiClient.post('/api/auth/profile/two-factor/enable', payload);
    return data;
  },
  async disableTwoFactor(payload: { password: string }) {
    const { data } = await apiClient.post('/api/auth/profile/two-factor/disable', payload);
    return data;
  },
  async generateBackupCodes(payload: { password: string }) {
    const { data } = await apiClient.post('/api/auth/profile/two-factor/generate-backup-codes', payload);
    return data;
  },

  // ── Passkeys ──
  async listPasskeys(): Promise<Passkey[]> {
    const { data } = await apiClient.get('/api/auth/profile/passkeys');
    if (!data?.success) {
      reportSystemError({
        level: 'error',
        component: 'ApiProfile',
        message: 'Failed to load passkeys',
        metadata: { action: 'listPasskeys' },
      });
      throw new Error('Failed to load passkeys');
    }
    return data.data as Passkey[];
  },
  async createPasskey(payload: { name?: string; authenticatorAttachment?: 'platform' | 'cross-platform' }) {
    const response = await authClient.passkey.addPasskey({
      name: payload.name,
      authenticatorAttachment: payload.authenticatorAttachment,
    });
    const resp = response as Record<string, unknown> | null;
    if (resp && typeof resp === 'object' && 'error' in resp && resp.error) {
      const err = resp.error as { message?: string } | string | null;
      const msg = typeof err === 'string' ? err : err?.message || 'Failed to add passkey';
      reportSystemError({
        level: 'error',
        component: 'ApiProfile',
        message: msg,
        metadata: { action: 'createPasskey' },
      });
      throw new Error(msg);
    }
    return response;
  },
  async deletePasskey(id: string) {
    const { data } = await apiClient.delete(`/api/auth/profile/passkeys/${id}`);
    return data;
  },
  async updatePasskey(id: string, name: string) {
    const { data } = await apiClient.patch(`/api/auth/profile/passkeys/${id}`, { name });
    return data;
  },

  // ── Avatar ──
  async uploadAvatar(file: File) {
    const form = new FormData();
    form.append('file', file);
    const response = await fetch('/api/auth/profile/avatar', {
      method: 'POST',
      body: form,
      credentials: 'include',
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: 'Upload failed' }));
      reportSystemError({
        level: 'error',
        component: 'ApiProfile',
        message: err.error || 'Upload failed',
        metadata: { action: 'uploadAvatar' },
      });
      throw new Error(err.error || 'Upload failed');
    }
    return response.json();
  },
  async removeAvatar() {
    const data = await apiClient.delete('/api/auth/profile/avatar');
    return data;
  },

  // ── Email ──
  async resendVerification() {
    const data = await apiClient.post('/api/auth/profile/resend-verification');
    return data;
  },

  // ── Sessions ──
  async listSessions(): Promise<UserSession[]> {
    const data = await apiClient.get<{ success: boolean; data: UserSession[] }>('/api/auth/profile/sessions');
    if (!data?.success) {
      reportSystemError({
        level: 'error',
        component: 'ApiProfile',
        message: 'Failed to load sessions',
        metadata: { action: 'listSessions' },
      });
      throw new Error('Failed to load sessions');
    }
    return data.data;
  },
  async revokeSession(id: string) {
    const data = await apiClient.delete<{ success: boolean }>(`/api/auth/profile/sessions/${id}`);
    return data;
  },
  async revokeAllSessions() {
    const data = await apiClient.delete<{ success: boolean; revoked: number }>('/api/auth/profile/sessions');
    return data;
  },

  // ── Audit Log ──
  async getAuditLog(limit = 50, offset = 0): Promise<{ logs: AuditLogEntry[]; total: number }> {
    const data = await apiClient.get<{ success: boolean; data: { logs: AuditLogEntry[]; total: number } }>(
      `/api/auth/profile/audit-log?limit=${limit}&offset=${offset}`,
    );
    if (!data?.success) {
      reportSystemError({
        level: 'error',
        component: 'ApiProfile',
        message: 'Failed to load audit log',
        metadata: { action: 'getAuditLog' },
      });
      throw new Error('Failed to load audit log');
    }
    return data.data;
  },

  // ── Export ──
  async exportData(): Promise<void> {
    const response = await fetch('/api/auth/profile/export', {
      headers: { ...(document.cookie ? { Cookie: document.cookie } : {}) },
    });
    if (!response.ok) {
      reportSystemError({
        level: 'error',
        component: 'ApiProfile',
        message: 'Export failed',
        metadata: { action: 'exportData' },
      });
      throw new Error('Export failed');
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'catalyst-account-export.json';
    a.click();
    URL.revokeObjectURL(url);
  },

  // ── API Keys overview ──
  async getApiKeys(): Promise<ApiKeySummary[]> {
    const data = await apiClient.get<{ success: boolean; data: ApiKeySummary[] }>('/api/auth/profile/api-keys');
    if (!data?.success) {
      reportSystemError({
        level: 'error',
        component: 'ApiProfile',
        message: 'Failed to load API keys',
        metadata: { action: 'getApiKeys' },
      });
      throw new Error('Failed to load API keys');
    }
    return data.data;
  },

  // ── Delete Account ──
  async deleteAccount() {
    const data = await apiClient.post<{ success: boolean }>('/api/auth/profile/delete', { confirm: 'DELETE' });
    return data;
  },

  // ── SSO ──
  async listSsoAccounts(): Promise<ProfileAccount[]> {
    const { data } = await apiClient.get('/api/auth/profile/sso/accounts');
    if (!data?.success) {
      reportSystemError({
        level: 'error',
        component: 'ApiProfile',
        message: 'Failed to load SSO accounts',
        metadata: { action: 'listSsoAccounts' },
      });
      throw new Error('Failed to load SSO accounts');
    }
    return data.data;
  },
  async linkSso(providerId: string) {
    const { data } = await apiClient.post('/api/auth/profile/sso/link', { providerId });
    if (data?.data?.redirect && data?.data?.url) {
      window.location.href = data.data.url;
    }
    return data;
  },
  async unlinkSso(providerId: string, accountId?: string) {
    const { data } = await apiClient.post('/api/auth/profile/sso/unlink', { providerId, accountId });
    return data;
  },
};
