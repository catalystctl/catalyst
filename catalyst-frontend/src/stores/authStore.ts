import { create } from 'zustand';
import { persist } from 'zustand/middleware';
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
  login: (values: LoginSchema, options?: { forcePasskeyFallback?: boolean }) => Promise<void>;
  register: (values: RegisterSchema) => Promise<void>;
  refresh: () => Promise<void>;
  init: () => Promise<void>;
  logout: () => void;
  setUser: (user: User | null) => void;
  setSession: (payload: { user: User }) => void;
  verifyTwoFactor: (payload: { code: string; trustDevice?: boolean }) => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => {
      const rememberMe = localStorage.getItem('catalyst-remember-me') === 'true';
      const token =
        sessionStorage.getItem('catalyst-session-token') ||
        (rememberMe ? localStorage.getItem('catalyst-auth-token') : null);
      return {
      user: null,
      token,
      rememberMe,
      isAuthenticated: false,
      isReady: false,
      isLoading: false,
      isRefreshing: false,
      error: null,
      login: async (values, options) => {
        console.log('[authStore.login] Starting login for:', values.email);
        set({ isLoading: true, error: null });
        try {
          console.log('[authStore.login] Calling authApi.login');
          const { user, token } = await authApi.login(values, options);
          console.log('[authStore.login] authApi.login returned successfully');
          if (token && values.rememberMe) {
            localStorage.setItem('catalyst-auth-token', token);
            sessionStorage.removeItem('catalyst-session-token');
          } else if (token) {
            sessionStorage.setItem('catalyst-session-token', token);
            localStorage.removeItem('catalyst-auth-token');
          } else {
            sessionStorage.removeItem('catalyst-session-token');
            localStorage.removeItem('catalyst-auth-token');
          }
          set({
            user,
            token: token || null,
            rememberMe: Boolean(values.rememberMe),
            isAuthenticated: true,
            isLoading: false,
            isReady: true,
            error: null,
          });
        } catch (err: any) {
          if (err.code === 'TWO_FACTOR_REQUIRED' || err.code === 'PASSKEY_REQUIRED') {
            const token = err.token || null;
            if (token) {
              if (values.rememberMe) {
                localStorage.setItem('catalyst-auth-token', token);
                sessionStorage.removeItem('catalyst-session-token');
              } else {
                sessionStorage.setItem('catalyst-session-token', token);
                localStorage.removeItem('catalyst-auth-token');
              }
            }
            set({ isLoading: false, error: null, token, rememberMe: Boolean(values.rememberMe) });
            throw err;
          }
          const message = err.response?.data?.error || err.message || 'Login failed';
          set({ isLoading: false, error: message });
          throw err;
        }
      },
      register: async (values) => {
        set({ isLoading: true, error: null });
        try {
          const { user, token } = await authApi.register(values);
          if (token) {
            localStorage.setItem('catalyst-auth-token', token);
          } else {
            localStorage.removeItem('catalyst-auth-token');
            sessionStorage.removeItem('catalyst-session-token');
          }
          set({ user, token: token || null, isAuthenticated: true, isLoading: false, isReady: true, error: null });
        } catch (err: any) {
          const message = err.response?.data?.error || err.message || 'Registration failed';
          set({ isLoading: false, error: message });
          throw err;
        }
      },
        refresh: async () => {
          // With cookie-based auth, always try to refresh - cookies are sent automatically
          set({ isRefreshing: true, error: null, isReady: true });
          try {
            const { user } = await authApi.refresh();
            set({
              token: get().token,
              user,
              isAuthenticated: true,
              isRefreshing: false,
              isReady: true,
              error: null,
            });
          } catch (error: any) {
          const message = error.response?.data?.error || error.message || 'Session expired';
          localStorage.removeItem('catalyst-auth-token');
          sessionStorage.removeItem('catalyst-session-token');
          set({
            token: null,
            user: null,
            isAuthenticated: false,
            isRefreshing: false,
            isReady: true,
            error: message,
            rememberMe: false,
            });
            throw error;
          } finally {
            set({ isRefreshing: false, isReady: true });
          }
        },
        init: () => {
          set({ isReady: true });
          // Always try to refresh - cookie-based auth doesn't need stored token
          void get().refresh();
        },
      logout: () => {
        localStorage.removeItem('catalyst-auth-token');
        localStorage.removeItem('catalyst-remember-me');
        sessionStorage.removeItem('catalyst-session-token');
        localStorage.removeItem('catalyst-auth');
        set({ user: null, token: null, isAuthenticated: false, isReady: true, rememberMe: false });
        void authApi.logout().catch(() => {
          // Ignore network errors after local logout
        });
      },
      setUser: (user) => set({ user, isAuthenticated: Boolean(user) }),
        setSession: ({ user }) => {
          set({
            user,
            token: get().token,
            rememberMe: get().rememberMe,
            isAuthenticated: true,
            isLoading: false,
            isReady: true,
            error: null,
          });
        },
      verifyTwoFactor: async (payload) => {
        set({ isLoading: true, error: null });
        try {
          const { user, token } = await authApi.verifyTwoFactor(payload);
          if (token && payload.rememberMe) {
            localStorage.setItem('catalyst-auth-token', token);
            sessionStorage.removeItem('catalyst-session-token');
          } else if (token) {
            sessionStorage.setItem('catalyst-session-token', token);
            localStorage.removeItem('catalyst-auth-token');
          } else {
            sessionStorage.removeItem('catalyst-session-token');
            localStorage.removeItem('catalyst-auth-token');
          }
          set({
            user,
            token: token || null,
            rememberMe: Boolean(payload.rememberMe),
            isAuthenticated: true,
            isLoading: false,
            isReady: true,
            error: null,
          });
        } catch (err: any) {
          const message = err.response?.data?.error || err.message || 'Two-factor verification failed';
          set({ isLoading: false, error: message });
          throw err;
        }
      },
    };
    },
    {
      name: 'catalyst-auth',
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        isAuthenticated: state.isAuthenticated,
        rememberMe: state.rememberMe,
      }),
    },
  ),
);
