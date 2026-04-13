import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { StateCreator } from 'zustand/vanilla';
import { authApi } from '../services/api/auth';
import type { User } from '../types/user';
import type { LoginSchema, RegisterSchema } from '../validators/auth';

interface AuthState {
  user: User | null;
  token: string | null;
  rememberMe: boolean;
  isAuthenticated: boolean;
  isLoading: boolean;
  isReady: boolean;
  isRefreshing: boolean;
  error: string | null;
  /** @internal AbortController for an in-flight server sign-out request */
  _pendingLogoutController?: AbortController;
  login: (values: LoginSchema, options?: { forcePasskeyFallback?: boolean }) => Promise<void>;
  register: (values: RegisterSchema) => Promise<void>;
  refresh: () => Promise<void>;
  init: () => Promise<void>;
  logout: () => void;
  setUser: (user: User | null) => void;
  setSession: (payload: { user: User }) => void;
  verifyTwoFactor: (payload: { code: string; trustDevice?: boolean }) => Promise<void>;
}

type AuthSet = (
  partial: AuthState | Partial<AuthState> | ((state: AuthState) => AuthState | Partial<AuthState>),
  replace?: boolean | undefined,
) => void;
type AuthGet = () => AuthState;

const createAuthState: StateCreator<AuthState, [['zustand/persist', unknown]], [], AuthState> = (set, get) => {
  const rememberMe = localStorage.getItem('catalyst-remember-me') === 'true';
  return {
    user: null,
    token: null, // No longer using localStorage tokens
    rememberMe,
    isAuthenticated: false,
    isReady: false,
    isLoading: false,
    isRefreshing: false,
    error: null,
    login: async (values, options) => {
      // Abort any in-flight server sign-out from a previous logout — otherwise
      // it can destroy the new session cookie we're about to create.
      (get as AuthGet)()._pendingLogoutController?.abort();
      // Suppress the 401 interceptor while login is in flight so that a stale
      // sign-out (or any transient 401) doesn't wipe isAuthenticated before
      // we've finished setting it.
      const { loginGuard } = await import('../services/api/client');
      loginGuard.active = true;
      (set as AuthSet)({ isLoading: true, error: null });
      try {
        const { user } = await authApi.login(values, options);
        // Cookie-based authentication - tokens stored in HttpOnly cookies
        (set as AuthSet)({
          user,
          token: null, // No longer storing token in memory
          rememberMe: Boolean(values.rememberMe),
          isAuthenticated: true,
          isLoading: false,
          isReady: true,
          error: null,
        });
        // If the inline refresh inside authApi.login failed, the user object
        // may lack Catalyst permissions.  Kick off a background refresh so
        // permission-gated UI (admin routes, etc.) works without a reload.
        // Keep the login-in-progress flag true during this window so transient
        // 401s from a stale sign-out don't bounce the user.
        const clearFlag = () => { loginGuard.active = false; };
        if (user.permissions && user.permissions.length === 0) {
          setTimeout(async () => {
            try {
              const { user: hydrated } = await authApi.refresh();
              if (hydrated.permissions && hydrated.permissions.length > 0) {
                (set as AuthSet)({ user: hydrated });
              }
            } catch {
              // Best-effort — will retry on next navigation
            } finally {
              clearFlag();
            }
          }, 2_000);
        } else {
          // No delayed refresh needed — clear after a short grace period for
          // any in-flight page-level API calls that might 401 transiently.
          setTimeout(clearFlag, 3_000);
        }
      } catch (err: unknown) {
        const error = err as { code?: string; response?: { data?: { error?: unknown } }; message?: string };
        if (error.code === 'TWO_FACTOR_REQUIRED' || error.code === 'PASSKEY_REQUIRED') {
          (set as AuthSet)({ isLoading: false, error: null, token: null, rememberMe: Boolean(values.rememberMe) });
          throw err;
        }
        const rawError = error.response?.data?.error;
        const message = (typeof rawError === 'string' ? rawError : (rawError as { message?: string; error?: string })?.message || (rawError as { message?: string; error?: string })?.error) || error.message || 'Login failed';
        (set as AuthSet)({ isLoading: false, error: message as string });
        loginGuard.active = false;
        throw err;
      }
    },
    register: async (values) => {
      (set as AuthSet)({ isLoading: true, error: null });
      try {
        const { user } = await authApi.register(values);
        // Cookie-based authentication - tokens stored in HttpOnly cookies
        (set as AuthSet)({ user, token: null, isAuthenticated: true, isLoading: false, isReady: true, error: null });
      } catch (err: unknown) {
        const error = err as { response?: { data?: { error?: unknown } }; message?: string };
        const rawError = error.response?.data?.error;
        const message = (typeof rawError === 'string' ? rawError : (rawError as { message?: string; error?: string })?.message || (rawError as { message?: string; error?: string })?.error) || error.message || 'Registration failed';
        (set as AuthSet)({ isLoading: false, error: message as string });
        throw err;
      }
    },
    refresh: async () => {
      // With cookie-based auth, always try to refresh - cookies are sent automatically
      (set as AuthSet)({ isRefreshing: true, error: null, isReady: true });
      try {
        const { user } = await authApi.refresh();
        (set as AuthSet)({
          token: null,
          user,
          isAuthenticated: true,
          isRefreshing: false,
          isReady: true,
          error: null,
        });
      } catch (error: unknown) {
        const err = error as { response?: { data?: { error?: unknown } }; message?: string };
        const rawError = err.response?.data?.error;
        const message = (typeof rawError === 'string' ? rawError : (rawError as { message?: string; error?: string })?.message || (rawError as { message?: string; error?: string })?.error) || err.message || 'Session expired';
        // Clean up any remaining localStorage items from previous token-based auth
        localStorage.removeItem('catalyst-auth-token');
        localStorage.removeItem('catalyst-session-token');
        sessionStorage.removeItem('catalyst-auth-token');
        sessionStorage.removeItem('catalyst-session-token');
        (set as AuthSet)({
          token: null,
          user: null,
          isAuthenticated: false,
          isRefreshing: false,
          isReady: true,
          error: message as string,
          rememberMe: false,
        });
        throw error;
      } finally {
        (set as AuthSet)({ isRefreshing: false, isReady: true });
      }
    },
    init: async () => {
      // Don't set isReady until refresh completes to prevent flashing authenticated
      // content with a potentially expired server-side session.
      try {
        await (get as AuthGet)().refresh();
      } finally {
        (set as AuthSet)({ isReady: true });
      }
    },
    logout: () => {
      localStorage.removeItem('catalyst-remember-me');
      localStorage.removeItem('catalyst-auth');
      (set as AuthSet)({ user: null, token: null, isAuthenticated: false, isReady: true, rememberMe: false });
      // Fire-and-forget server sign-out, but abort it if the user logs back in
      // before it completes — otherwise the delayed sign-out response destroys
      // the brand-new session cookie, causing an immediate redirect to /login.
      const controller = new AbortController();
      void authApi.logout({ signal: controller.signal }).catch(() => {});
      (get as AuthGet)()._pendingLogoutController = controller;
    },
    setUser: (user) => (set as AuthSet)({ user, isAuthenticated: Boolean(user) }),
    setSession: ({ user }) => {
      const current = get as AuthGet;
      (set as AuthSet)({
        user,
        token: current().token,
        rememberMe: current().rememberMe,
        isAuthenticated: true,
        isLoading: false,
        isReady: true,
        error: null,
      });
    },
    verifyTwoFactor: async (payload) => {
      (set as AuthSet)({ isLoading: true, error: null });
      try {
        const { user } = await authApi.verifyTwoFactor(payload);
        // Cookie-based authentication - tokens stored in HttpOnly cookies
        (set as AuthSet)({
          user,
          token: null,
          isAuthenticated: true,
          isLoading: false,
          isReady: true,
          error: null,
        });
      } catch (err: unknown) {
        const error = err as { response?: { data?: { error?: unknown } }; message?: string };
        const rawError = error.response?.data?.error;
        const message = (typeof rawError === 'string' ? rawError : (rawError as { message?: string; error?: string })?.message || (rawError as { message?: string; error?: string })?.error) || error.message || 'Two-factor verification failed';
        (set as AuthSet)({ isLoading: false, error: message as string });
        throw err;
      }
    },
  };
};

export const useAuthStore = create<AuthState>()(
  persist(createAuthState, {
    name: 'catalyst-auth',
    partialize: (state: AuthState) => ({
      user: state.user,
      isAuthenticated: state.isAuthenticated,
      rememberMe: state.rememberMe,
      // Do NOT store token - using HttpOnly cookies instead
    }),
  }),
);
