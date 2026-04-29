// src/plugins/plugin-api.ts
// Shared API client that plugins can import instead of building their own fetch wrapper.

import { reportSystemError } from '../services/api/systemErrors';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

interface PluginApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface PluginApiOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

async function pluginFetch<T>(
  pluginName: string,
  path: string,
  options?: PluginApiOptions,
): Promise<PluginApiResponse<T>> {
  const { method = 'GET', body, headers: extraHeaders } = options ?? {};
  const url = `${API_BASE}/api/plugins/${pluginName}/${path.replace(/^\//, '')}`;

  try {
    const res = await fetch(url, {
      method,
      credentials: 'include',
      headers: {
        ...(body !== undefined && !(body instanceof FormData)
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...extraHeaders,
      },
      body:
        body !== undefined
          ? body instanceof FormData
            ? body
            : JSON.stringify(body)
          : undefined,
    });

    if (!res.ok) {
      let errorMsg = `HTTP ${res.status}`;
      try {
        const errBody = await res.json();
        errorMsg = errBody.error || errBody.message || errorMsg;
      } catch {
        // use default error message
      }
      return { success: false, error: errorMsg };
    }

    const data = await res.json();
    // If the backend already returns the plugin response shape, pass through
    // to avoid double-wrapping: { success: true, data: { success: true, data: [...] } }
    if (data && typeof data === 'object' && 'success' in data) {
      return data as PluginApiResponse<T>;
    }
    return { success: true, data };
  } catch (err: unknown) {
    reportSystemError({
      level: 'error',
      component: 'plugin-api',
      message: err instanceof Error ? err.message : 'Network error',
      stack: err instanceof Error ? err.stack : undefined,
      metadata: { context: 'Plugin fetch network error' },
    });
    const message = err instanceof Error ? err.message : 'Network error';
    return { success: false, error: message };
  }
}

/** Return type of createPluginApiClient — re-exported for plugin authors. */
export type PluginApiClient = ReturnType<typeof createPluginApiClient>;

/**
 * Create a scoped API client for a specific plugin.
 *
 * @example
 * const api = createPluginApiClient('ticketing-plugin');
 * const tickets = await api.get<Ticket[]>('tickets');
 * const newTicket = await api.post<Ticket>('tickets', { title: 'Bug' });
 */
export function createPluginApiClient(pluginName: string) {
  return {
    get<T>(path: string, options?: Omit<PluginApiOptions, 'method' | 'body'>) {
      return pluginFetch<T>(pluginName, path, { ...options, method: 'GET' });
    },

    post<T>(path: string, body?: unknown, options?: Omit<PluginApiOptions, 'method' | 'body'>) {
      return pluginFetch<T>(pluginName, path, { ...options, method: 'POST', body });
    },

    put<T>(path: string, body?: unknown, options?: Omit<PluginApiOptions, 'method' | 'body'>) {
      return pluginFetch<T>(pluginName, path, { ...options, method: 'PUT', body });
    },

    delete<T>(path: string, options?: Omit<PluginApiOptions, 'method' | 'body'>) {
      return pluginFetch<T>(pluginName, path, { ...options, method: 'DELETE' });
    },

    patch<T>(path: string, body?: unknown, options?: Omit<PluginApiOptions, 'method' | 'body'>) {
      return pluginFetch<T>(pluginName, path, { ...options, method: 'PATCH', body });
    },
  };
}

/**
 * One-off plugin API call.
 *
 * @example
 * const result = await fetchPluginApi<Ticket[]>('ticketing-plugin', 'tickets');
 */
export async function fetchPluginApi<T>(
  pluginName: string,
  path: string,
  options?: PluginApiOptions,
): Promise<PluginApiResponse<T>> {
  return pluginFetch<T>(pluginName, path, options);
}
