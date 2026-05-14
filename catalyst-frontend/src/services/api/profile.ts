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
  impersonatedBy?: string | null;
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
    const res = await authClient.changePassword(payload);
    if (res.error) throw new Error(res.error.message || 'Failed to change password');
    return res.data;
  },
  async setPassword(payload: { newPassword: string }) {
    const res = await authClient.setPassword({ newPassword: payload.newPassword });
    if (res.error) throw new Error(res.error.message || 'Failed to set password');
    return res.data;
  },

  // ── 2FA ──
  async enableTwoFactor(payload: { password: string }) {
    const res = await authClient.twoFactor.enable({ password: payload.password });
    if (res.error) throw new Error(res.error.message || 'Failed to enable 2FA');
    return res.data;
  },
  async disableTwoFactor(payload: { password: string }) {
    const res = await authClient.twoFactor.disable({ password: payload.password });
    if (res.error) throw new Error(res.error.message || 'Failed to disable 2FA');
    return res.data;
  },
  async generateBackupCodes(payload: { password: string }) {
    const res = await authClient.twoFactor.generateBackupCodes({ password: payload.password });
    if (res.error) throw new Error(res.error.message || 'Failed to generate backup codes');
    return res.data;
  },

  // ── Passkeys ──
  async listPasskeys(): Promise<Passkey[]> {
    const res = await (authClient as any).passkey.listPasskeys();
    if (res.error) {
      reportSystemError({ level: 'error', component: 'ApiProfile', message: 'Failed to load passkeys', metadata: { action: 'listPasskeys' } });
      throw new Error('Failed to load passkeys');
    }
    return (res.data ?? []) as Passkey[];
  },
  async createPasskey(payload: { name?: string; authenticatorAttachment?: 'platform' | 'cross-platform' }) {
    const res = await authClient.passkey.addPasskey({
      name: payload.name,
      authenticatorAttachment: payload.authenticatorAttachment,
    });
    if (res.error) {
      const err = res.error as { message?: string } | string | null;
      const msg = typeof err === 'string' ? err : err?.message || 'Failed to add passkey';
      reportSystemError({ level: 'error', component: 'ApiProfile', message: msg, metadata: { action: 'createPasskey' } });
      throw new Error(msg);
    }
    return res;
  },
  async deletePasskey(id: string) {
    const res = await (authClient as any).passkey.deletePasskey({ id });
    if (res.error) throw new Error(res.error.message || 'Failed to delete passkey');
    return res.data;
  },
  async updatePasskey(id: string, name: string) {
    const res = await (authClient as any).passkey.updatePasskey({ id, name });
    if (res.error) throw new Error(res.error.message || 'Failed to update passkey');
    return res.data;
  },

  // ── Avatar ──
  async uploadAvatar(file: File) {
    const form = new FormData();
    form.append('file', file);
    // apiClient sets Content-Type: application/json by default for POST,
    // but FormData must let the browser set multipart/form-data with the
    // correct boundary.  We explicitly unset Content-Type to allow this.
    const { data } = await apiClient.post<{ success: boolean; data: { image: string } }>(
      '/api/auth/profile/avatar',
      form,
      { headers: { 'Content-Type': '' } },
    );
    return data;
  },
  async removeAvatar() {
    const data = await apiClient.delete('/api/auth/profile/avatar');
    return data;
  },

  // ── Email ──
  async resendVerification() {
    const res = await authClient.sendVerificationEmail();
    if (res.error) throw new Error(res.error.message || 'Failed to send verification email');
    return res.data;
  },

  // ── Sessions ──
  async listSessions(): Promise<UserSession[]> {
    const res = await authClient.listSessions();
    if (res.error) {
      reportSystemError({ level: 'error', component: 'ApiProfile', message: 'Failed to load sessions', metadata: { action: 'listSessions' } });
      throw new Error('Failed to load sessions');
    }
    return (res.data ?? []) as UserSession[];
  },
  async revokeSession(id: string) {
    // Better Auth's revokeSession takes a session token or id
    const res = await authClient.revokeSession({ token: id });
    if (res.error) throw new Error(res.error.message || 'Failed to revoke session');
    return res.data;
  },
  async revokeAllSessions() {
    const res = await authClient.revokeSessions();
    if (res.error) throw new Error(res.error.message || 'Failed to revoke sessions');
    return res.data;
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
    // Use apiClient with responseType: 'blob' to download the GDPR export.
    // apiClient handles CSRF tokens and credentials automatically.
    const blob = await apiClient.get<Blob>('/api/auth/profile/export', {
      responseType: 'blob',
    });
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
    const res = await (authClient as any).listUserAccounts();
    if (res.error) {
      reportSystemError({ level: 'error', component: 'ApiProfile', message: 'Failed to load SSO accounts', metadata: { action: 'listSsoAccounts' } });
      throw new Error('Failed to load SSO accounts');
    }
    return (res.data ?? []) as ProfileAccount[];
  },
  async linkSso(providerId: string) {
    const frontendOrigin = typeof window !== 'undefined' ? window.location.origin : '';
    const res = await (authClient as any).linkSocialAccount({
      providerId,
      callbackURL: `${frontendOrigin}/profile`,
    });
    if (res.error) throw new Error(res.error.message || 'Failed to link SSO account');
    const data = res.data as any;
    if (data?.redirect && data?.url) {
      // Validate redirect origin to prevent open-redirect attacks
      const trusted = new URL(data.url);
      const allowed = [frontendOrigin, import.meta.env.VITE_BETTER_AUTH_URL].filter(Boolean);
      if (!allowed.some(o => trusted.origin === new URL(o).origin)) {
        throw new Error('Untrusted redirect URL from SSO link');
      }
      window.location.href = data.url;
    }
    return data;
  },
  async unlinkSso(providerId: string, accountId?: string) {
    const { data } = await apiClient.post('/api/auth/profile/sso/unlink', { providerId, accountId });
    return data;
  },
};
