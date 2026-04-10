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
        set({ isLoading: true, error: null });
        try {
          const { user } = await authApi.login(values, options);
          // Cookie-based authentication - tokens stored in HttpOnly cookies
          set({
            user,
            token: null, // No longer storing token in memory
            rememberMe: Boolean(values.rememberMe),
            isAuthenticated: true,
            isLoading: false,
            isReady: true,
            error: null,
          });
        } catch (err: any) {
          if (err.code === 'TWO_FACTOR_REQUIRED' || err.code === 'PASSKEY_REQUIRED') {
            set({ isLoading: false, error: null, token: null, rememberMe: Boolean(values.rememberMe) });
            throw err;
          }
          const rawError = err.response?.data?.error;
          const message = (typeof rawError === 'string' ? rawError : rawError?.message || rawError?.error) || err.message || 'Login failed';
          set({ isLoading: false, error: message });
          throw err;
        }
      },
      register: async (values) => {
        set({ isLoading: true, error: null });
        try {
          const { user } = await authApi.register(values);
          // Cookie-based authentication - tokens stored in HttpOnly cookies
          set({ user, token: null, isAuthenticated: true, isLoading: false, isReady: true, error: null });
        } catch (err: any) {
          const rawError = err.response?.data?.error;
          const message = (typeof rawError === 'string' ? rawError : rawError?.message || rawError?.error) || err.message || 'Registration failed';
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
              token: null,
              user,
              isAuthenticated: true,
              isRefreshing: false,
              isReady: true,
              error: null,
            });
          } catch (error: any) {
          const rawError = error.response?.data?.error;
          const message = (typeof rawError === 'string' ? rawError : rawError?.message || rawError?.error) || error.message || 'Session expired';
          // Clean up any remaining localStorage items
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
        localStorage.removeItem('catalyst-remember-me');
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
          const { user } = await authApi.verifyTwoFactor(payload);
          // Cookie-based authentication - tokens stored in HttpOnly cookies
          set({
            user,
            token: null,
            rememberMe: Boolean(payload.rememberMe),
            isAuthenticated: true,
            isLoading: false,
            isReady: true,
            error: null,
          });
        } catch (err: any) {
          const rawError = err.response?.data?.error;
          const message = (typeof rawError === 'string' ? rawError : rawError?.message || rawError?.error) || err.message || 'Two-factor verification failed';
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
        isAuthenticated: state.isAuthenticated,
        rememberMe: state.rememberMe,
        // Do NOT store token - using HttpOnly cookies instead
      }),
    },
  ),
);
