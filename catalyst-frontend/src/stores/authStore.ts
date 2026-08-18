import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { StateCreator } from 'zustand/vanilla';
import { authApi } from '../services/api/auth';
import { reportSystemError } from '../services/api/systemErrors';
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
  /** @internal BroadcastChannel for cross-tab logout sync */
  _broadcast?: BroadcastChannel;
  login: (values: LoginSchema) => Promise<void>;
  register: (values: RegisterSchema) => Promise<void>;
  refresh: () => Promise<void>;
  init: () => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: User | null) => void;
  setSession: (payload: { user: User }) => void;
  verifyTwoFactor: (payload: { code: string; trustDevice?: boolean }) => Promise<void>;
}

type AuthSet = (
  partial: AuthState | Partial<AuthState> | ((state: AuthState) => AuthState | Partial<AuthState>),
  replace?: boolean | undefined,
) => void;
type AuthGet = () => AuthState;

const ALLOWED_IMAGE_PROTOCOLS = ['data:', 'https:'];
const ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
function sanitizeImageUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (!ALLOWED_IMAGE_PROTOCOLS.includes(parsed.protocol)) return undefined;
    if (parsed.protocol === 'data:' && !ALLOWED_IMAGE_MIME.some(m => parsed.pathname.startsWith(m))) {
      return undefined;
    }
    return url;
  } catch { return undefined; }
}

const createAuthState: StateCreator<AuthState, [['zustand/persist', unknown]], [], AuthState> = (set, get) => {
  return {
    user: null,
    token: null, // No longer using localStorage tokens
    rememberMe: false,
    isAuthenticated: false,
    isReady: false,
    isLoading: false,
    isRefreshing: false,
    error: null,
    login: async (values) => {
      // Abort any in-flight server sign-out from a previous logout — otherwise
      // it can destroy the new session cookie we're about to create.
      (get as AuthGet)()._pendingLogoutController?.abort();
      // Suppress the 401 interceptor while login is in flight so that a stale
      // sign-out (or any transient 401) doesn't wipe isAuthenticated before
      // we've finished setting it.
      const { loginGuard } = await import('../services/api/client');
      loginGuard.enter();
      (set as AuthSet)({ isLoading: true, error: null });
      try {
        let { user } = await authApi.login(values);
        // If login returned an empty permission set, await a refresh before
        // resolving so ProtectedRoute / Sidebar see real grants immediately
        // (avoids the empty-permissions race on first navigation).
        if (!user.permissions || user.permissions.length === 0) {
          try {
            const hydrated = await authApi.refresh();
            if (hydrated.user.permissions && hydrated.user.permissions.length > 0) {
              user = hydrated.user;
            }
          } catch {
            // Best-effort — keep the login user object as-is.
          }
        }
        // Cookie-based authentication - tokens stored in HttpOnly cookies
        (set as AuthSet)({
          user: { ...user, image: sanitizeImageUrl(user.image) },
          token: null, // No longer storing token in memory
          rememberMe: Boolean(values.rememberMe),
          isAuthenticated: true,
          isLoading: false,
          isReady: true,
          error: null,
        });
        // Keep the login-in-progress flag true briefly so transient 401s from
        // a stale sign-out don't bounce the user after navigation.
        setTimeout(() => { loginGuard.exit(); }, 3_000);
      } catch (err: unknown) {
        const error = err as { code?: string; response?: { data?: { error?: unknown } }; message?: string };
        if (error.code === 'TWO_FACTOR_REQUIRED' || error.code === 'PASSKEY_REQUIRED') {
          (set as AuthSet)({ isLoading: false, error: null, token: null, rememberMe: Boolean(values.rememberMe) });
          // Release guard so subsequent 2FA / passkey flows aren't blocked, but
          // keep a short grace window for any in-flight cookie handoff.
          setTimeout(() => { loginGuard.exit(); }, 3_000);
          reportSystemError({
            level: 'error',
            component: 'AuthStore:login',
            message: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
          });
          throw err;
        }
        const rawError = error.response?.data?.error;
        const message = (typeof rawError === 'string' ? rawError : (rawError as { message?: string; error?: string })?.message || (rawError as { message?: string; error?: string })?.error) || error.message || 'Login failed';
        (set as AuthSet)({ isLoading: false, error: message as string });
        loginGuard.exit();
        reportSystemError({
          level: 'error',
          component: 'AuthStore:login',
          message: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
        throw err;
      }
    },
    register: async (values) => {
      const { loginGuard } = await import('../services/api/client');
      loginGuard.enter();
      (set as AuthSet)({ isLoading: true, error: null });
      try {
        const { user } = await authApi.register(values);
        // Cookie-based authentication - tokens stored in HttpOnly cookies
        (set as AuthSet)({ user: { ...user, image: sanitizeImageUrl(user.image) }, token: null, isAuthenticated: true, isLoading: false, isReady: true, error: null });
      } catch (err: unknown) {
        const error = err as { response?: { data?: { error?: unknown } }; message?: string };
        const rawError = error.response?.data?.error;
        const message = (typeof rawError === 'string' ? rawError : (rawError as { message?: string; error?: string })?.message || (rawError as { message?: string; error?: string })?.error) || error.message || 'Registration failed';
        (set as AuthSet)({ isLoading: false, error: message as string });
        loginGuard.exit();
        reportSystemError({
          level: 'error',
          component: 'AuthStore:register',
          message: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
        throw err;
      } finally {
        setTimeout(() => { loginGuard.exit(); }, 3_000);
      }
    },
    refresh: async () => {
      // With cookie-based auth, always try to refresh - cookies are sent automatically
      (set as AuthSet)({ isRefreshing: true, error: null, isReady: true });
      try {
        const { user } = await authApi.refresh();
        (set as AuthSet)({
          token: null,
          user: { ...user, image: sanitizeImageUrl(user.image) },
          isAuthenticated: true,
          isRefreshing: false,
          isReady: true,
          error: null,
        });
      } catch (error: unknown) {
        const { loginGuard } = await import('../services/api/client');
        if (loginGuard.active) {
          (set as AuthSet)({ isRefreshing: false, isReady: true });
          return;
        }
        const e = error as { status?: number; response?: { status?: number }; retryAfterMs?: number; message?: string };
        const status = e.status ?? e.response?.status;
        const isTransient = status === 429 || status === 408 || (typeof status === 'number' && status >= 500) || status === undefined;
        const isCooldown = e.message === 'Refresh cooldown active';
        if (isTransient || isCooldown) {
          (set as AuthSet)({ isRefreshing: false, isReady: true });
          reportSystemError({
            level: 'warn',
            component: 'AuthStore:refresh',
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          });
          throw error;
        }
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
          error: null,
          rememberMe: false,
        });
        reportSystemError({
          level: 'error',
          component: 'AuthStore:refresh',
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        throw error;
      } finally {
        (set as AuthSet)({ isRefreshing: false, isReady: true });
      }
    },
    init: async () => {
      // Don't set isReady until refresh completes to prevent flashing authenticated
      // content with a potentially expired server-side session.
      // Guard: if login is in-flight (loginGuard.active), skip the refresh
      // entirely — login() will set isAuthenticated once it completes, and
      // we must not overwrite that with a stale 401 from the old session.
      const { loginGuard } = await import('../services/api/client');
      if (loginGuard.active) {
        (set as AuthSet)({ isReady: true });
        return;
      }
      try {
        await (get as AuthGet)().refresh();
      } finally {
        (set as AuthSet)({ isReady: true });
      }
    },
    logout: async () => {
      localStorage.removeItem('catalyst-auth');
      (set as AuthSet)({ user: null, token: null, isAuthenticated: false, isReady: true, rememberMe: false });
      // Drop privileged React Query cache so admin/server data cannot flash
      // if the user signs back in as a different principal.
      try {
        const { queryClient } = await import('../lib/queryClient');
        queryClient.clear();
      } catch {
        // queryClient may not be available in rare bootstrap failures
      }
      const bc = (get as AuthGet)()._broadcast;
      if (bc) bc.postMessage({ type: 'logout' });
      // Fire-and-forget server sign-out, but abort it if the user logs back in
      // before it completes — otherwise the delayed sign-out response destroys
      // the brand-new session cookie, causing an immediate redirect to /login.
      const controller = new AbortController();
      (get as AuthGet)()._pendingLogoutController = controller;
      try {
        await authApi.logout({ signal: controller.signal });
      } catch {
        // Network/sign-out failure after local clear: do NOT reload (that can
        // rehydrate a still-valid cookie and bounce the user back in). Navigate
        // to login instead.
      } finally {
        if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
          window.location.assign('/login');
        }
      }
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
      const { loginGuard } = await import('../services/api/client');
      loginGuard.enter();
      (set as AuthSet)({ isLoading: true, error: null });
      try {
        const { user } = await authApi.verifyTwoFactor(payload);
        // Cookie-based authentication - tokens stored in HttpOnly cookies
        (set as AuthSet)({
          user: { ...user, image: sanitizeImageUrl(user.image) },
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
        loginGuard.exit();
        reportSystemError({
          level: 'error',
          component: 'AuthStore:verify2FA',
          message: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
        throw err;
      } finally {
        setTimeout(() => { loginGuard.exit(); }, 3_000);
      }
    },
  };
};

export const useAuthStore = create<AuthState>()(
  persist(createAuthState, {
    name: 'catalyst-auth',
    partialize: (state: AuthState) => ({
      rememberMe: state.rememberMe,
    }),
  }),
);

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === 'catalyst-auth') {
      useAuthStore.getState().init();
    }
  });

  const channel = new BroadcastChannel('catalyst-auth');
  channel.onmessage = (event) => {
    if (event.data?.type === 'logout') {
      useAuthStore.setState({
        user: null, token: null, isAuthenticated: false, isReady: true, rememberMe: false,
      });
      // Best-effort cache clear so other tabs don't flash privileged data.
      import('../lib/queryClient')
        .then(({ queryClient }) => queryClient.clear())
        .catch(() => {});
      window.location.href = '/login';
    }
  };
  (useAuthStore.getState() as any)._broadcast = channel;
}
