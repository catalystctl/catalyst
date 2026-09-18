import type { LoadedPlugin, PluginManifest } from './types';

/** Provider entry served by the public /api/auth/oauth-providers endpoint. */
export interface PublicAuthProvider {
  /** Plugin implementing the provider (route namespace owner). */
  plugin: string;
  id: string;
  label: string;
  /** Panel path that starts the sign-in flow. */
  authorizeUrl: string;
}

type ProviderSource = Pick<LoadedPlugin, 'manifest' | 'status'>;

/**
 * Collect the sign-in providers declared by enabled plugins
 * (manifest.authProviders). Pure — takes registry entries, returns the public
 * payload. Only enabled plugins are listed: a disabled plugin's authorize
 * routes 503, so its button must not render.
 */
export function collectAuthProviders(plugins: ProviderSource[]): PublicAuthProvider[] {
  const out: PublicAuthProvider[] = [];
  for (const p of plugins) {
    if (p.status !== 'enabled') continue;
    const declared = (p.manifest as PluginManifest).authProviders;
    if (!Array.isArray(declared)) continue;
    for (const provider of declared) {
      if (!provider || typeof provider.id !== 'string' || typeof provider.label !== 'string') continue;
      const path = (provider.authorizePath ?? 'authorize').replace(/^\//, '');
      out.push({
        plugin: p.manifest.name,
        id: provider.id,
        label: provider.label,
        authorizeUrl: `/api/plugins/${p.manifest.name}/${path}`,
      });
    }
  }
  return out;
}
