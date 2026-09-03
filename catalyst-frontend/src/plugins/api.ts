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
    // Prefer the structured error body (e.g. SAFETY_CONSENT_REQUIRED payloads)
    // over a bare status string when the backend provides one.
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      /* non-JSON error body */
    }
    const err = new Error(body?.error || `HTTP ${res.status}`) as Error & { code?: string; payload?: any };
    if (body?.code) err.code = body.code;
    err.payload = body;
    throw err;
  }
  return res.json() as Promise<T>;
}

/**
 * Fetch all plugins
 */
export async function fetchPlugins(): Promise<PluginManifest[]> {
  const data = await apiFetch<{ data: PluginManifest[] }>('/api/plugins');
  // Normalize partial payloads so UI never crashes on missing arrays
  return (data.data ?? []).map((plugin) => ({
    ...plugin,
    permissions: plugin.permissions ?? [],
  }));
}

/**
 * Fetch plugin details
 */
export async function fetchPluginDetails(name: string): Promise<any> {
  const data = await apiFetch<{ data: any }>(`/api/plugins/${name}`);
  return data.data;
}

/**
 * Enable or disable plugin.
 * When enabling a plugin that has not accepted the current safety disclaimer,
 * pass `acceptSafetyVersion` (must match the server's DISCLAIMER_VERSION) to
 * record the acceptance in the same request.
 */
export async function togglePlugin(
  name: string,
  enabled: boolean,
  opts?: { acceptSafetyVersion?: string },
): Promise<void> {
  await apiFetch(`/api/plugins/${name}/enable`, {
    method: 'POST',
    body: {
      enabled,
      ...(opts?.acceptSafetyVersion
        ? { safety: { disclaimerVersion: opts.acceptSafetyVersion } }
        : {}),
    },
  });
}

/** Structured error thrown by apiFetch when the enable endpoint gates on consent. */
export interface SafetyConsentRequiredError extends Error {
  code: 'SAFETY_CONSENT_REQUIRED';
  /** Full response body ({ reason, requestedCapabilities, disclaimerVersion, … }). */
  payload?: {
    reason?: string;
    requestedPermissions?: string[];
    requestedCapabilities?: import('./types').CapabilitySummary[];
    disclaimerVersion?: string;
    author?: string;
    version?: string;
    [key: string]: unknown;
  };
}

/**
 * Replace the admin-controlled permission grants for a plugin. Grants must be
 * a subset of the manifest's declared permissions; revocations take effect
 * immediately for the plugin's data access.
 */
export async function updatePluginPermissions(name: string, granted: string[]): Promise<void> {
  await apiFetch(`/api/plugins/${name}/permissions`, {
    method: 'PUT',
    body: { granted },
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

// ── Marketplace ──────────────────────────────────────────────────────────────

export interface MarketplaceEntry {
  name: string;
  displayName?: string;
  description?: string;
  author?: string;
  version?: string;
  downloadUrl: string;
  sha256?: string;
  homepage?: string;
  tags?: string[];
  sourceUrl?: string;
  installed?: boolean;
  installedVersion?: string | null;
  updateAvailable?: boolean;
}

export interface MarketplaceBrowseResult {
  sources: { url: string; ok: boolean; error?: string; entryCount: number }[];
  entries: MarketplaceEntry[];
}

/** A configured marketplace index and where it came from. */
export interface MarketplaceSource {
  id: string;
  url: string;
  label?: string | null;
  enabled: boolean;
  origin: 'official' | 'env' | 'custom';
  removable: boolean;
}

/** Browse configured marketplace indexes (5-minute server-side cache). */
export async function fetchMarketplace(forceRefresh = false): Promise<MarketplaceBrowseResult> {
  const data = await apiFetch<{ data: MarketplaceBrowseResult }>(
    `/api/plugins/marketplace${forceRefresh ? '?forceRefresh=true' : ''}`,
  );
  return data.data ?? { sources: [], entries: [] };
}

/** List every marketplace source for the in-panel source manager. */
export async function fetchMarketplaceSources(): Promise<MarketplaceSource[]> {
  const data = await apiFetch<{ data: MarketplaceSource[] }>('/api/plugins/marketplace/sources');
  return data.data ?? [];
}

/** Add a marketplace index from the panel — no env edit or restart needed. */
export async function addMarketplaceSource(url: string, label?: string): Promise<MarketplaceSource> {
  const data = await apiFetch<{ data: MarketplaceSource }>('/api/plugins/marketplace/sources', {
    method: 'POST',
    body: { url, ...(label?.trim() ? { label: label.trim() } : {}) },
  });
  return data.data;
}

/** Enable or disable a panel-added marketplace source. */
export async function updateMarketplaceSource(id: string, enabled: boolean): Promise<MarketplaceSource> {
  const data = await apiFetch<{ data: MarketplaceSource }>(`/api/plugins/marketplace/sources/${id}`, {
    method: 'PATCH',
    body: { enabled },
  });
  return data.data;
}

/** Remove a panel-added marketplace source. */
export async function deleteMarketplaceSource(id: string): Promise<void> {
  await apiFetch(`/api/plugins/marketplace/sources/${id}`, { method: 'DELETE' });
}

/**
 * Download, verify and stage a plugin package. Code lands inert until an
 * admin accepts the safety disclaimer and enables it.
 */
export async function installPlugin(url: string, sha256?: string): Promise<{ name: string; version: string; upgraded: boolean }> {
  const data = await apiFetch<{
    success: boolean;
    data: { name: string; version: string; upgraded: boolean };
  }>(`/api/plugins/install`, {
    method: 'POST',
    body: { url, ...(sha256 ? { sha256 } : {}) },
  });
  return data.data;
}

/** Uninstall a plugin; optionally purge its persisted storage rows. */
export async function uninstallPlugin(name: string, purgeData = false): Promise<void> {
  await apiFetch(`/api/plugins/${name}/uninstall`, {
    method: 'POST',
    body: { purgeData },
  });
}
