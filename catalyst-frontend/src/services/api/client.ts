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

const BASE_URL = normalizeBaseUrl(import.meta.env.VITE_API_URL) || '';

interface ApiError {
  response?: {
    status?: number;
    data?: {
      code?: string;
      message?: string;
      error?: string;
    };
  };
  message?: string;
}

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    method: string,
    path: string,
    options?: {
      params?: Record<string, string | number | boolean | undefined | null>;
      body?: unknown;
      headers?: Record<string, string>;
      credentials?: RequestCredentials;
      signal?: AbortSignal;
      responseType?: 'json' | 'blob' | 'text';
    },
  ): Promise<T> {
    const {
      params,
      body,
      headers = {},
      credentials = 'include',
      signal,
      responseType = 'json',
    } = options ?? {};

    // Build URL with query params
    let url = `${this.baseUrl}${path}`;
    if (params) {
      const searchParams = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          searchParams.set(key, String(value));
        }
      });
      const queryString = searchParams.toString();
      if (queryString) {
        url += `?${queryString}`;
      }
    }

    // Add Authorization header for API keys
    const token = useAuthStore.getState().token;
    const authHeaders: Record<string, string> = {};
    if (token && token.startsWith('catalyst_')) {
      authHeaders['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': headers['Content-Type'] || 'application/json',
        ...authHeaders,
        ...headers,
      },
      credentials,
      body: body !== undefined && method !== 'GET' && method !== 'HEAD'
        ? (typeof body === 'string' ? body : JSON.stringify(body))
        : undefined,
      signal,
    });

    // Handle errors — read body once, then throw with full error info
    if (!response.ok) {
      let errorData: { code?: string; message?: string; error?: string };
      try {
        errorData = await response.json();
      } catch {
        // not JSON — use status text
        errorData = { message: response.statusText || `HTTP ${response.status}` };
      }

      // Global 401 handling — clears auth state and redirects to login
      if (response.status === 401 && !loginGuard.active) {
        const code = errorData.code;
        if (code !== 'TWO_FACTOR_REQUIRED' && code !== 'PASSKEY_REQUIRED') {
          useAuthStore.setState({
            user: null,
            token: null,
            isAuthenticated: false,
            isReady: true,
            rememberMe: false,
          });
        }
      }

      const error: ApiError = {
        response: {
          status: response.status,
          data: errorData,
        },
        message: errorData.message || errorData.error || `HTTP ${response.status}`,
      };
      throw error;
    }

    switch (responseType) {
      case 'blob':
        return response.blob() as Promise<T>;
      case 'text':
        return response.text() as Promise<T>;
      default:
        return response.json() as Promise<T>;
    }
  }

  get<T>(path: string, options?: { params?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string>; credentials?: RequestCredentials; signal?: AbortSignal }): Promise<T> {
    return this.request<T>('GET', path, options);
  }

  post<T>(path: string, body?: unknown, options?: { params?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string>; credentials?: RequestCredentials; signal?: AbortSignal }): Promise<T> {
    return this.request<T>('POST', path, { ...options, body });
  }

  put<T>(path: string, body?: unknown, options?: { headers?: Record<string, string>; credentials?: RequestCredentials; signal?: AbortSignal }): Promise<T> {
    return this.request<T>('PUT', path, { ...options, body });
  }

  patch<T>(path: string, body?: unknown, options?: { headers?: Record<string, string>; credentials?: RequestCredentials; signal?: AbortSignal }): Promise<T> {
    return this.request<T>('PATCH', path, { ...options, body });
  }

  delete<T>(path: string, options?: { params?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string>; credentials?: RequestCredentials; signal?: AbortSignal }): Promise<T> {
    return this.request<T>('DELETE', path, options);
  }
}

export const apiClient = new ApiClient(BASE_URL);
export default apiClient;
