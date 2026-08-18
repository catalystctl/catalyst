import { useAuthStore } from '../../stores/authStore';
import { queryClient } from '../../lib/queryClient';
import { reportSystemError } from './systemErrors';

/** Module-level guard set by authStore.login() to suppress the 401 interceptor
 *  while a login request is in flight.  Without this, a stale server-side
 *  sign-out (from a previous logout) can destroy the brand-new session cookie,
 *  causing /api/auth/me or page-level API calls to 401 and the interceptor
 *  to wipe isAuthenticated — bouncing the user back to /login.
 *  Uses reference counting so overlapping login/refresh calls don't race.
 */
class AuthGuard {
  private count = 0;
  get active() { return this.count > 0; }
  enter() { this.count++; }
  exit() { this.count = Math.max(0, this.count - 1); }
}
export const loginGuard = new AuthGuard();

const normalizeBaseUrl = (value?: string) => {
  if (!value) return '';
  if (value === '/api') return '';
  return value.replace(/\/api\/?$/, '');
};

const BASE_URL = normalizeBaseUrl(import.meta.env.VITE_API_URL) || '';

export interface ApiError {
  response?: {
    status?: number;
    data?: {
      code?: string;
      message?: string;
      error?: string;
    };
    headers?: Record<string, string>;
  };
  status?: number;
  retryAfterMs?: number;
  message?: string;
}

function parseRetryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const t = value.trim();
  if (!t) return undefined;
  if (/^\d+(\.\d+)?$/.test(t)) {
    const s = Number(t);
    if (Number.isFinite(s) && s >= 0) return Math.min(s * 1000, 5 * 60 * 1000);
  }
  const d = Date.parse(t);
  if (!Number.isNaN(d)) {
    const diff = d - Date.now();
    if (diff > 0) return Math.min(diff, 5 * 60 * 1000);
    return 0;
  }
  return undefined;
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
      onDownloadProgress?: (event: { loaded: number; total?: number }) => void;
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

    // Add CSRF token header
    const csrfToken = document.cookie
      .split('; ')
      .find(row => row.startsWith('csrf-token='))
      ?.split('=')[1];
    if (csrfToken) {
      // Strip CRLF to prevent theoretical HTTP header injection
      authHeaders['X-CSRF-Token'] = decodeURIComponent(csrfToken).replace(/[\r\n]/g, '');
    }

    // Only set Content-Type when there's a body to send.
    // Fastify 5 rejects POST/PUT/PATCH with Content-Type: application/json
    // but no body (FST_ERR_CTP_EMPTY_JSON_BODY → 400).
    const hasBody = body !== undefined && method !== 'GET' && method !== 'HEAD';
    const finalHeaders: Record<string, string> = {
      ...authHeaders,
      ...headers,
    };
    if (hasBody && !finalHeaders['Content-Type']) {
      finalHeaders['Content-Type'] = 'application/json';
    }
    // If Content-Type was explicitly set to empty string, remove it entirely.
    // This allows FormData to set the correct multipart/form-data boundary.
    if (finalHeaders['Content-Type'] === '') {
      delete finalHeaders['Content-Type'];
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: finalHeaders,
        credentials,
        body: hasBody
          ? (body instanceof FormData ? body : typeof body === 'string' ? body : JSON.stringify(body))
          : undefined,
        signal,
      });
    } catch (networkError: any) {
      reportSystemError({
        level: 'error',
        component: 'ApiClient',
        message: networkError?.message || 'Network error',
        metadata: { path, method },
      });
      throw networkError;
    }

    // Handle errors — read body once, then throw with full error info
    if (!response.ok) {
      let errorData: { code?: string; message?: string; error?: string };
      try {
        errorData = await response.json();
      } catch {
        // not JSON — use status text
        errorData = { message: response.statusText || `HTTP ${response.status}` };
      }

      // Global 401 handling — clears auth state, privileged cache, and redirects
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
          // Drop any privileged React Query cache so stale admin/server data
          // cannot flash after the session dies.
          queryClient.clear();
          if (typeof window !== 'undefined') {
            const path = window.location.pathname + window.location.search;
            // Avoid redirect loops on the login page itself.
            if (!path.startsWith('/login') && !path.startsWith('/two-factor')) {
              const returnTo = encodeURIComponent(path);
              window.location.assign(`/login?from=${returnTo}`);
            }
          }
        }
      }

      if (response.status >= 500) {
        reportSystemError({
          level: 'error',
          component: 'ApiClient',
          message: errorData.message || errorData.error || `HTTP ${response.status}`,
          metadata: { path, status: response.status, method },
        });
      }

      const retryAfterMs = parseRetryAfterMs(response.headers.get('Retry-After'));
      const hdr: Record<string, string> = {};
      const raw = response.headers.get('Retry-After');
      if (raw) hdr['retry-after'] = raw;
      const error: ApiError = {
        status: response.status,
        retryAfterMs,
        response: {
          status: response.status,
          data: errorData,
          headers: Object.keys(hdr).length ? hdr : undefined,
        },
        message: errorData.message || errorData.error || `HTTP ${response.status}`,
      };
      throw error;
    }

    switch (responseType) {
      case 'blob': {
        if (options?.onDownloadProgress && response.body) {
          const total = Number(response.headers.get('Content-Length')) || undefined;
          const reader = response.body.getReader();
          const chunks: BlobPart[] = [];
          let loaded = 0;
          // ponytail: stream the body so onDownloadProgress can report incremental progress
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              chunks.push(value);
              loaded += value.length;
              options.onDownloadProgress({ loaded, total });
            }
          }
          return Promise.resolve(new Blob(chunks)) as Promise<T>;
        }
        return response.blob() as Promise<T>;
      }
      case 'text':
        return response.text() as Promise<T>;
      default:
        return response.json() as Promise<T>;
    }
  }

  get<T>(path: string, options?: { params?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string>; credentials?: RequestCredentials; signal?: AbortSignal; responseType?: 'json' | 'blob' | 'text'; onDownloadProgress?: (event: { loaded: number; total?: number }) => void }): Promise<T> {
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
