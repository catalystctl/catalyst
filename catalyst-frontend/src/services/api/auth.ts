import apiClient from './client';
import type { LoginSchema, RegisterSchema } from '../../validators/auth';
import type { User } from '../../types/user';
import { authClient } from '../authClient';

const createPasskeyRequiredError = () => {
  const error: any = new Error('Passkey required');
  error.code = 'PASSKEY_REQUIRED';
  return error;
};

export const authApi = {
  async login(
    values: LoginSchema,
    options?: { forcePasskeyFallback?: boolean },
  ): Promise<{ token: string; user: User; rememberMe?: boolean }> {
    let token = '';
    try {
      const forceFallback = Boolean(options?.forcePasskeyFallback);
      const response = await authClient.signIn.email(
        {
          email: values.email,
          password: values.password,
          allowPasskeyFallback: forceFallback || Boolean(values.allowPasskeyFallback),
        },
        {
          headers: forceFallback || values.allowPasskeyFallback
            ? { 'X-Allow-Passkey-Fallback': 'true' }
            : undefined,
          onSuccess(context) {
            token = context.response?.headers?.get?.('set-auth-token') || '';
          },
        },
      );
      const data = (response as any)?.data ?? response;
      token = token || data?.token || data?.session?.token || '';
      if (data?.twoFactorRedirect) {
        const error: any = new Error('Two-factor authentication required');
        error.code = 'TWO_FACTOR_REQUIRED';
        error.token = token;
        throw error;
      }
      if (data?.code === 'PASSKEY_REQUIRED') {
        throw createPasskeyRequiredError();
      }
      if (!data?.user) {
        throw new Error(data?.error?.message || data?.error || 'Login failed');
      }

      // better-auth's sign-in response does not include Catalyst role permissions.
      // Immediately fetch the canonical user profile (with permissions) so admin UI
      // and ProtectedRoute checks work without requiring a full page refresh.
      let hydratedUser: User | null = null;
      try {
        hydratedUser = (await authApi.refresh()).user;
      } catch {
        hydratedUser = null;
      }

      return {
        token,
        rememberMe: values.rememberMe,
        user:
          hydratedUser ?? ({
            id: data.user.id,
            email: data.user.email,
            username: data.user.username,
            role: 'user',
            permissions: data.user.permissions ?? [],
          } satisfies User),
      };
    } catch (error: any) {
      if (error?.response?.data?.code === 'PASSKEY_REQUIRED') {
        throw createPasskeyRequiredError();
      }
      throw error;
    }
  },

  async register(values: RegisterSchema): Promise<{ token: string; user: User }> {
    let token = '';
    const response = await authClient.signUp.email(
      {
        email: values.email,
        password: values.password,
        name: values.username,
        username: values.username,
      } as any,
      {
        onSuccess(context) {
          token = context.response?.headers?.get?.('set-auth-token') || '';
        },
      },
    );
    const data = (response as any)?.data ?? response;
    token = token || data?.token || data?.session?.token || '';
    if (!data?.user) {
      throw new Error(data?.error?.message || data?.error || 'Registration failed');
    }

    let hydratedUser: User | null = null;
    try {
      hydratedUser = (await authApi.refresh()).user;
    } catch {
      hydratedUser = null;
    }
    return {
      token,
      user:
        hydratedUser ?? ({
          id: data.user.id,
          email: data.user.email,
          username: data.user.username,
          role: 'user',
          permissions: data.user.permissions ?? [],
        } satisfies User),
    };
  },

  async refresh(): Promise<{ user: User }> {
    const response = await apiClient.get<any>('/api/auth/me');
    const data = response.data;
    if (!data?.success || !data?.data) {
      throw new Error(data?.error || 'Refresh failed');
    }
    return {
      user: {
        id: data.data.id,
        email: data.data.email,
        username: data.data.username,
        role: 'user',
        permissions: data.data.permissions ?? [],
      },
    };
  },

  async verifyTwoFactor(payload: {
    code: string;
    trustDevice?: boolean;
    rememberMe?: boolean;
  }): Promise<{ token: string; user: User; rememberMe?: boolean }> {
    const response = await authClient.twoFactor.verifyTotp({
      code: payload.code,
      trustDevice: payload.trustDevice,
    });
    const data = (response as any)?.data ?? response;
    const token = data?.token || data?.session?.token || '';
    if (!data?.user || !token) {
      throw new Error('Two-factor verification failed');
    }

    let hydratedUser: User | null = null;
    try {
      hydratedUser = (await authApi.refresh()).user;
    } catch {
      hydratedUser = null;
    }
    return {
      token,
      rememberMe: payload.rememberMe,
      user:
        hydratedUser ?? ({
          id: data.user.id,
          email: data.user.email,
          username: data.user.username,
          role: 'user',
          permissions: data.user.permissions ?? [],
        } satisfies User),
    };
  },

  async signInWithProvider(providerId: 'whmcs' | 'paymenter') {
    const response = await authClient.signIn.oauth2({ providerId });
    const data = (response as any)?.data ?? response;
    if (data?.redirect && data?.url) {
      window.location.href = data.url;
    }
    return data;
  },

  async logout(): Promise<void> {
    await authClient.signOut();
  },

  async forgotPassword(email: string): Promise<void> {
    const response = await apiClient.post('/api/auth/forgot-password', { email });
    const data = response.data;
    if (!data?.success) {
      throw new Error(data?.error || 'Failed to send reset email');
    }
  },

  async validateResetToken(token: string): Promise<boolean> {
    const response = await apiClient.get(`/api/auth/reset-password/validate?token=${encodeURIComponent(token)}`);
    const data = response.data;
    if (!data?.success || !data?.valid) {
      throw new Error('Invalid or expired token');
    }
    return true;
  },

  async resetPassword(token: string, password: string): Promise<void> {
    const response = await apiClient.post('/api/auth/reset-password', { token, password });
    const data = response.data;
    if (!data?.success) {
      throw new Error(data?.error || 'Failed to reset password');
    }
  },
};
