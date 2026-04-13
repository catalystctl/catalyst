import axios from 'axios';
import { useAuthStore } from '../../stores/authStore';

/** Module-level flag set by authStore.login() to suppress the 401 interceptor
 *  while a login request is in flight.  Without this, a stale server-side
 *  sign-out (from a previous logout) can destroy the brand-new session cookie,
 *  causing /api/auth/me or page-level API calls to 401 and the interceptor
 *  to wipe isAuthenticated — bouncing the user back to /login.
 */
export const loginGuard = { active: false };

const normalizeBaseUrl = (value?: string) => {
  if (!value) return '';
  if (value === '/api') return '';
  return value.replace(/\/api\/?$/, '');
};

const apiClient = axios.create({
  baseURL: normalizeBaseUrl(import.meta.env.VITE_API_URL) || '',
  timeout: 30000, // 30 seconds - increased for Fastify v5
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
  // Prevent axios from aborting requests prematurely
  validateStatus: (status) => status < 500,
});

apiClient.interceptors.request.use((config) => {
  // Session auth is handled via cookies (withCredentials: true)
  // Only add Authorization header for API keys (catalyst_ prefix)
  const token = useAuthStore.getState().token;
  if (token && token.startsWith('catalyst_')) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const code = error.response?.data?.code;
      if (code !== 'TWO_FACTOR_REQUIRED' && !loginGuard.active) {
        // Only clear local auth state — do NOT call the server-side sign-out
        // endpoint. Calling sign-out here invalidates the session cookie, which
        // causes a vicious cycle during login: signIn creates a session → a
        // subsequent 401 (e.g. from /api/auth/me racing before the cookie is
        // committed) triggers sign-out → session destroyed → user kicked back
        // to login.  The server session will expire on its own; we just need
        // to reset the client-side state so the ProtectedRoute redirects.
        //
        // Also skip while login is in progress — a stale fire-and-forget
        // sign-out from a previous logout may destroy the new session cookie,
        // causing transient 401s.  The login caller handles the error and sets
        // isAuthenticated itself.
        useAuthStore.setState({
          user: null,
          token: null,
          isAuthenticated: false,
          isReady: true,
          rememberMe: false,
        });
      }
    }
    return Promise.reject(error);
  },
);

export default apiClient;
