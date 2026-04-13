import apiClient from './client';
import type { LoginSchema, RegisterSchema } from '../../validators/auth';
import type { User } from '../../types/user';
import { authClient } from '../authClient';

interface PasskeyRequiredError extends Error {
  code: 'PASSKEY_REQUIRED';
}

const createPasskeyRequiredError = (): PasskeyRequiredError => {
  const error = Object.assign(new Error('Passkey required'), {
    code: 'PASSKEY_REQUIRED' as const,
  });
  return error;
};

interface TwoFactorRequiredError extends Error {
  code: 'TWO_FACTOR_REQUIRED';
  token: string;
}

/** better-auth responses can have data nested under .data or be flat */
interface BetterAuthResponse {
  data?: Record<string, unknown>;
  token?: string;
  session?: { token?: string };
  user?: Record<string, unknown>;
  error?: { message?: string; error?: string } | string;
  twoFactorRedirect?: boolean;
  code?: string;
  redirect?: boolean;
  url?: string;
  success?: boolean;
  valid?: boolean;
}

function extractResponse(response: unknown): BetterAuthResponse {
  if (response && typeof response === 'object') {
    // better-fetch returns { data: ..., error: ... } on failures (data may be null)
    const r = response as Record<string, unknown>;
    const data = r.data ?? {};
    const error = r.error ?? undefined;
    return {
      ...(typeof data === 'object' ? data : {}),
      ...(error !== undefined ? { error } : {}),
    } as BetterAuthResponse;
  }
  return (response ?? {}) as BetterAuthResponse;
}

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
          callbackURL: window.location.origin,
        },
        {
          fetchOptions: {
            headers: forceFallback || values.allowPasskeyFallback
              ? { 'X-Allow-Passkey-Fallback': 'true' }
              : undefined,
          },
          onSuccess(context) {
            token = context.response?.headers?.get?.('set-auth-token') || '';
          },
        },
      );
      const data = extractResponse(response);
      token = token || data.token || data.session?.token || '';
      if (data.twoFactorRedirect) {
        const error = Object.assign(new Error('Two-factor authentication required'), {
          code: 'TWO_FACTOR_REQUIRED' as const,
          token,
        }) satisfies TwoFactorRequiredError;
        throw error;
      }
      if (data.code === 'PASSKEY_REQUIRED') {
        throw createPasskeyRequiredError();
      }
      if (!data.user) {
        const errorMsg = typeof data.error === 'string'
          ? data.error
          : data.error?.message || data.error?.error || null;
        throw new Error(errorMsg || 'Login failed');
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

      const userData = data.user;
      return {
        token,
        rememberMe: values.rememberMe,
        user:
          hydratedUser ?? ({
            id: String(userData.id),
            email: String(userData.email),
            username: String(userData.username),
            role: 'user',
            permissions: (Array.isArray(userData.permissions) ? userData.permissions : []) as string[],
          } satisfies User),
      };
    } catch (error: unknown) {
      const err = error as { response?: { data?: { code?: string } }; code?: string };
      if (err.response?.data?.code === 'PASSKEY_REQUIRED' || err.code === 'PASSKEY_REQUIRED') {
        throw createPasskeyRequiredError();
      }
      throw error;
    }
  },

  async register(values: RegisterSchema): Promise<{ token: string; user: User }> {
    let token = '';
    const response = await authClient.signUp.email({
      email: values.email,
      password: values.password,
      name: values.username,
      username: values.username,
    }, {
      onSuccess(context) {
        token = context.response?.headers?.get?.('set-auth-token') || '';
      },
    });
    const data = extractResponse(response);
    token = token || data.token || data.session?.token || '';
    if (!data.user) {
      const errorMsg = typeof data.error === 'string'
        ? data.error
        : data.error?.message || data.error?.error || null;
      throw new Error(errorMsg || 'Registration failed');
    }

    let hydratedUser: User | null = null;
    try {
      hydratedUser = (await authApi.refresh()).user;
    } catch {
      hydratedUser = null;
    }
    const userData = data.user;
    return {
      token,
      user:
        hydratedUser ?? ({
          id: String(userData.id),
          email: String(userData.email),
          username: String(userData.username),
          role: 'user',
          permissions: (Array.isArray(userData.permissions) ? userData.permissions : []) as string[],
        } satisfies User),
    };
  },

  async refresh(): Promise<{ user: User }> {
    const response = await apiClient.get<{ success: boolean; data?: { id: string; email: string; username: string; role?: string; permissions?: string[] }; error?: string }>('/api/auth/me');
    const data = response.data;
    if (!data?.success || !data?.data) {
      throw new Error(data?.error || 'Refresh failed');
    }
    return {
      user: {
        id: data.data.id,
        email: data.data.email,
        username: data.data.username,
        role: (data.data.role as User['role']) || 'user',
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
    const data = extractResponse(response);
    const token = data.token || data.session?.token || '';
    if (!data.user || !token) {
      throw new Error('Two-factor verification failed');
    }

    let hydratedUser: User | null = null;
    try {
      hydratedUser = (await authApi.refresh()).user;
    } catch {
      hydratedUser = null;
    }
    const userData = data.user;
    return {
      token,
      rememberMe: payload.rememberMe,
      user:
        hydratedUser ?? ({
          id: String(userData.id),
          email: String(userData.email),
          username: String(userData.username),
          role: 'user',
          permissions: (Array.isArray(userData.permissions) ? userData.permissions : []) as string[],
        } satisfies User),
    };
  },

  async signInWithProvider(providerId: 'whmcs' | 'paymenter') {
    const response = await authClient.signIn.oauth2({ providerId });
    const data = extractResponse(response);
    if (data.redirect && data.url) {
      window.location.href = data.url;
    }
    return data;
  },

  async logout(options?: { signal?: AbortSignal }): Promise<void> {
    await authClient.signOut({
      fetchOptions: options?.signal ? { signal: options.signal } : undefined,
    });
  },

  async forgotPassword(email: string): Promise<void> {
    const response = await apiClient.post<{ success: boolean; error?: string }>('/api/auth/forgot-password', { email });
    const data = response.data;
    if (!data?.success) {
      throw new Error(data?.error || 'Failed to send reset email');
    }
  },

  async validateResetToken(token: string): Promise<boolean> {
    const response = await apiClient.get<{ success: boolean; valid?: boolean; error?: string }>(`/api/auth/reset-password/validate?token=${encodeURIComponent(token)}`);
    const data = response.data;
    if (!data?.success || !data?.valid) {
      throw new Error('Invalid or expired token');
    }
    return true;
  },

  async resetPassword(token: string, password: string): Promise<void> {
    const response = await apiClient.post<{ success: boolean; error?: string }>('/api/auth/reset-password', { token, password });
    const data = response.data;
    if (!data?.success) {
      throw new Error(data?.error || 'Failed to reset password');
    }
  },
};
