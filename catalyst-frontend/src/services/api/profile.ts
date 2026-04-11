import apiClient from './client';
import { authClient } from '../authClient';

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
  twoFactorEnabled: boolean;
  hasPassword: boolean;
  createdAt: string;
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

export const profileApi = {
  async getProfile(): Promise<ProfileSummary> {
    const { data } = await apiClient.get<{ success: boolean; data: ProfileSummary }>('/api/auth/profile');
    if (!data?.success) {
      throw new Error('Failed to load profile');
    }
    return data.data;
  },
  async changePassword(payload: { currentPassword: string; newPassword: string; revokeOtherSessions?: boolean }) {
    const { data } = await apiClient.post('/api/auth/profile/change-password', payload);
    return data;
  },
  async setPassword(payload: { newPassword: string }) {
    const { data } = await apiClient.post('/api/auth/profile/set-password', payload);
    return data;
  },
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
  async listPasskeys(): Promise<Passkey[]> {
    const { data } = await apiClient.get('/api/auth/profile/passkeys');
    if (!data?.success) {
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
      throw new Error(typeof err === 'string' ? err : err?.message || 'Failed to add passkey');
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
  async listSsoAccounts(): Promise<ProfileAccount[]> {
    const { data } = await apiClient.get('/api/auth/profile/sso/accounts');
    if (!data?.success) {
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
