import type { PluginManifest } from './types';

const API_BASE = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '' : 'http://localhost:3000');

async function apiFetch<T>(
  path: string,
  options?: {
    method?: string;
    body?: unknown;
  },
): Promise<T> {
  const { method = 'GET', body } = options ?? {};
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: 'include',
    headers:
      body !== undefined && !(body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : {},
    body:
      body !== undefined
        ? body instanceof FormData
          ? body
          : JSON.stringify(body)
        : undefined,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

/**
 * Fetch all plugins
 */
export async function fetchPlugins(): Promise<PluginManifest[]> {
  const data = await apiFetch<{ data: PluginManifest[] }>('/api/plugins');
  return data.data;
}

/**
 * Fetch plugin details
 */
export async function fetchPluginDetails(name: string): Promise<any> {
  const data = await apiFetch<{ data: any }>(`/api/plugins/${name}`);
  return data.data;
}

/**
 * Enable or disable plugin
 */
export async function togglePlugin(name: string, enabled: boolean): Promise<void> {
  await apiFetch(`/api/plugins/${name}/enable`, {
    method: 'POST',
    body: { enabled },
  });
}

/**
 * Reload plugin
 */
export async function reloadPlugin(name: string): Promise<void> {
  await apiFetch(`/api/plugins/${name}/reload`, { method: 'POST' });
}

/**
 * Update plugin config
 */
export async function updatePluginConfig(
  name: string,
  config: Record<string, any>,
): Promise<void> {
  await apiFetch(`/api/plugins/${name}/config`, {
    method: 'PUT',
    body: { config },
  });
}

/**
 * Fetch plugin frontend manifest
 */
export async function fetchPluginFrontendManifest(name: string): Promise<any> {
  const data = await apiFetch<{ data: any }>(`/api/plugins/${name}/frontend-manifest`);
  return data.data;
}
