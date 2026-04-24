import apiClient from './client';
import { reportSystemError } from './systemErrors';
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
  /**
   * Sign in via the custom /api/auth/login route (NOT the built-in
   * better-auth /sign-in/email route). The custom route provides:
   *   - brute-force protection & account lockout
   *   - audit logging
   *   - case-insensitive email lookup
   *   - anti-enumeration (constant-time dummy hash for unknown accounts)
   *   - Catalyst permissions in the response
   *   - full user profile (firstName, lastName, name, image)
   */
  async login(
    values: LoginSchema,
    options?: { forcePasskeyFallback?: boolean },
  ): Promise<{ token: string; user: User; rememberMe?: boolean }> {
    try {
      const response = await apiClient.post<{
        success: boolean;
        data?: {
          userId: string;
          email: string;
          username: string;
          name?: string | null;
          firstName?: string | null;
          lastName?: string | null;
          image?: string | null;
          role?: string;
          permissions: string[];
          token: string | null;
          twoFactorRequired?: boolean;
        };
        error?: string;
      }>('/api/auth/login', {
        email: values.email,
        password: values.password,
        rememberMe: values.rememberMe,
      });

      // HTTP 202 — two-factor required (apiClient doesn't throw for 2xx)
      if (!response.success && response.data?.twoFactorRequired) {
        reportSystemError({
          level: 'error',
          component: 'ApiAuth',
          message: 'Two-factor authentication required',
          metadata: { action: 'login', code: 'TWO_FACTOR_REQUIRED' },
        });
        throw Object.assign(new Error('Two-factor authentication required'), {
          code: 'TWO_FACTOR_REQUIRED' as const,
          token: response.data.token,
        }) satisfies TwoFactorRequiredError;
      }

      if (!response.success || !response.data) {
        reportSystemError({
          level: 'error',
          component: 'ApiAuth',
          message: response.error || 'Login failed',
          metadata: { action: 'login' },
        });
        throw new Error(response.error || 'Login failed');
      }

      const d = response.data;
      return {
        token: d.token || '',
        rememberMe: values.rememberMe,
        user: {
          id: d.userId,
          email: d.email,
          username: d.username,
          name: d.name ?? undefined,
          firstName: d.firstName ?? undefined,
          lastName: d.lastName ?? undefined,
          image: d.image ?? undefined,
          role: (d.role as User['role']) || 'user',
          permissions: d.permissions ?? [],
        },
      };
    } catch (error: unknown) {
      // Passkey-required errors come as HTTP 403 from the custom route.
      const err = error as { response?: { data?: { code?: string } }; code?: string; message?: string };
      if (err.response?.data?.code === 'PASSKEY_REQUIRED' || err.code === 'PASSKEY_REQUIRED' || err.message === 'Passkey required') {
        reportSystemError({
          level: 'error',
          component: 'ApiAuth',
          message: 'Passkey required',
          metadata: { action: 'login', code: 'PASSKEY_REQUIRED' },
        });
        throw createPasskeyRequiredError();
      }
      reportSystemError({
        level: 'error',
        component: 'ApiAuth',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        metadata: { action: 'login' },
      });
      throw error;
    }
  },

  /**
   * Register via the custom /api/auth/register route (NOT the built-in
   * better-auth /sign-up/email route). The custom route provides:
   *   - Zod validation with detailed error messages
   *   - duplicate email/username check (409)
   *   - welcome email
   *   - Catalyst permissions in the response
   *   - full user profile (firstName, lastName, name, image)
   *   - auto-sign-in (session cookie set via set-cookie header)
   */
  async register(values: RegisterSchema): Promise<{ token: string; user: User }> {
    const response = await apiClient.post<{
      success: boolean;
      data?: {
        userId: string;
        email: string;
        username: string;
        name?: string | null;
        firstName?: string | null;
        lastName?: string | null;
        image?: string | null;
        role?: string;
        permissions: string[];
        token: string | null;
      };
      error?: string;
      details?: Array<{ field: string; message: string }>;
    }>('/api/auth/register', {
      email: values.email,
      password: values.password,
      username: values.username,
    });

    if (!response.success || !response.data) {
      const msg = response.details
        ? response.details.map(d => `${d.field}: ${d.message}`).join(', ')
        : response.error || 'Registration failed';
      reportSystemError({
        level: 'error',
        component: 'ApiAuth',
        message: msg,
        metadata: { action: 'register' },
      });
      throw new Error(msg);
    }

    const d = response.data;
    return {
      token: d.token || '',
      user: {
        id: d.userId,
        email: d.email,
        username: d.username,
        name: d.name ?? undefined,
        firstName: d.firstName ?? undefined,
        lastName: d.lastName ?? undefined,
        image: d.image ?? undefined,
        role: (d.role as User['role']) || 'user',
        permissions: d.permissions ?? [],
      },
    };
  },

  async refresh(): Promise<{ user: User }> {
    const data = await apiClient.get<{ success: boolean; data?: { id: string; email: string; username: string; name?: string; firstName?: string; lastName?: string; image?: string; role?: string; permissions?: string[] }; error?: string }>('/api/auth/me');
    if (!data?.success || !data?.data) {
      reportSystemError({
        level: 'error',
        component: 'ApiAuth',
        message: data?.error || 'Refresh failed',
        metadata: { action: 'refresh' },
      });
      throw new Error(data?.error || 'Refresh failed');
    }
    return {
      user: {
        id: data.data.id,
        email: data.data.email,
        username: data.data.username,
        name: data.data.name,
        firstName: data.data.firstName,
        lastName: data.data.lastName,
        image: data.data.image,
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
      reportSystemError({
        level: 'error',
        component: 'ApiAuth',
        message: 'Two-factor verification failed',
        metadata: { action: 'verifyTwoFactor' },
      });
      throw new Error('Two-factor verification failed');
    }

    let hydratedUser: User | null = null;
    try {
      hydratedUser = (await authApi.refresh()).user;
    } catch {
      // Use null to fall back to data.user below
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
    const frontendOrigin = typeof window !== 'undefined' ? window.location.origin : '';
    const response = await authClient.signIn.oauth2({
      providerId,
      callbackURL: `${frontendOrigin}/servers`,
    });
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
    const data = await apiClient.post<{ success: boolean; error?: string }>('/api/auth/forgot-password', { email });
    if (!data?.success) {
      reportSystemError({
        level: 'error',
        component: 'ApiAuth',
        message: data?.error || 'Failed to send reset email',
        metadata: { action: 'forgotPassword' },
      });
      throw new Error(data?.error || 'Failed to send reset email');
    }
  },

  async validateResetToken(token: string): Promise<boolean> {
    const data = await apiClient.get<{ success: boolean; valid?: boolean; error?: string }>(`/api/auth/reset-password/validate?token=${encodeURIComponent(token)}`);
    if (!data?.success || !data?.valid) {
      reportSystemError({
        level: 'error',
        component: 'ApiAuth',
        message: 'Invalid or expired token',
        metadata: { action: 'validateResetToken' },
      });
      throw new Error('Invalid or expired token');
    }
    return true;
  },

  async resetPassword(token: string, password: string): Promise<void> {
    const data = await apiClient.post<{ success: boolean; error?: string }>('/api/auth/reset-password', { token, password });
    if (!data?.success) {
      reportSystemError({
        level: 'error',
        component: 'ApiAuth',
        message: data?.error || 'Failed to reset password',
        metadata: { action: 'resetPassword' },
      });
      throw new Error(data?.error || 'Failed to reset password');
    }
  },
};
