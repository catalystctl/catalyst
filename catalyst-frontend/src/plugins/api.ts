import type { PluginManifest } from './types';

// In dev, defaults to relative URL (uses Vite proxy) unless VITE_API_URL is explicitly set.
// In prod, always uses relative URL (same-origin behind nginx).
import { reportSystemError } from '../services/api/systemErrors';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

// Warn if someone set VITE_API_URL to an absolute URL — that bypasses the
// Vite dev-server proxy and won't work through VS Code tunnels.
if (import.meta.env.DEV && API_BASE && !API_BASE.startsWith('/')) {
  console.warn(
    '[plugins/api] VITE_API_URL is an absolute URL (%s). ' +
    'This bypasses the Vite dev proxy and may not work via tunnels. ' +
    'Set VITE_API_URL to empty or omit it to use the proxy.',
    API_BASE,
  );
}

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
  if (!res.ok) {
    reportSystemError({ level: 'error', component: 'PluginApi', message: `HTTP ${res.status}`, metadata: { context: 'apiFetch' } });
    throw new Error(`HTTP ${res.status}`);
  }
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
