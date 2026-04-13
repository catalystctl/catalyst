import type { LoadedPlugin, PluginManifest, PluginTabConfig, PluginRouteConfig } from './types';

/**
 * Dynamically load plugin frontend components at runtime.
 *
 * Each plugin lives under src/plugins/{plugin-name}/components.tsx and can export:
 *   - AdminTab   → tab injected into the admin panel sidebar
 *   - ServerTab  → tab injected into server detail pages
 *   - UserPage   → standalone page at /tickets (or plugin-specific path)
 *
 * New plugins only need their components.tsx placed in
 * src/plugins/{name}/components.tsx — no changes to this loader required.
 */
export async function loadPluginFrontend(manifest: PluginManifest): Promise<LoadedPlugin> {
  const tabs: PluginTabConfig[] = [];
  const routes: PluginRouteConfig[] = [];

  if (!manifest.enabled || !manifest.hasFrontend) {
    return { manifest, routes: [], tabs, components: [] };
  }

  try {
    const mod = await import(`./${manifest.name}/components.tsx`);

    if (mod.AdminTab) {
      tabs.push({
        id: `${manifest.name}-admin`,
        label: manifest.displayName,
        component: mod.AdminTab,
        location: 'admin',
        order: 50,
        requiredPermissions: ['admin.read'],
      });
    }

    if (mod.ServerTab) {
      tabs.push({
        id: `${manifest.name}-server`,
        label: manifest.displayName,
        component: mod.ServerTab,
        location: 'server',
        order: 50,
        requiredPermissions: ['server.read'],
      });
    }

    if (mod.UserPage) {
      routes.push({
        path: `/tickets`,
        component: mod.UserPage,
      });
    }
  } catch (error) {
    console.error(`[PluginLoader] Failed to load frontend for "${manifest.name}":`, error);
  }

  return { manifest, routes, tabs, components: [] };
}
