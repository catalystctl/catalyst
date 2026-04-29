/**
 * Typed API client for browser-side plugins.
 * Zero Node.js dependencies — uses native fetch, works in any modern browser.
 */

import type { PluginApiResponse } from './types.js';

const API_BASE = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_URL) || '';

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
      } catch { /* use default */ }
      return { success: false, error: errorMsg };
    }

    const data = await res.json();
    if (data && typeof data === 'object' && 'success' in data) {
      return data as PluginApiResponse<T>;
    }
    return { success: true, data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error';
    return { success: false, error: message };
  }
}

/**
 * Create a typed API client scoped to a specific plugin.
 *
 * @example
 * const api = createPluginApi('egg-explorer');
 * const eggs = await api.get<EggListResponse>('');
 * const created = await api.post('sync', {});
 */
export function createPluginApi<T = any>(pluginName: string) {
  return {
    get<R = T>(path: string): Promise<PluginApiResponse<R>> {
      return pluginFetch<R>(pluginName, path);
    },
    post<R = T>(path: string, body?: unknown): Promise<PluginApiResponse<R>> {
      return pluginFetch<R>(pluginName, path, { method: 'POST', body });
    },
    put<R = T>(path: string, body?: unknown): Promise<PluginApiResponse<R>> {
      return pluginFetch<R>(pluginName, path, { method: 'PUT', body });
    },
    del<R = T>(path: string): Promise<PluginApiResponse<R>> {
      return pluginFetch<R>(pluginName, path, { method: 'DELETE' });
    },
    patch<R = T>(path: string, body?: unknown): Promise<PluginApiResponse<R>> {
      return pluginFetch<R>(pluginName, path, { method: 'PATCH', body });
    },
  };
}
