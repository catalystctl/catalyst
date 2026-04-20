import type { PluginManifest, LoadedPlugin, PluginRouteConfig, PluginTabConfig, PluginComponentSlot } from './types';

/**
 * Dynamically load plugin frontend components at runtime.
 *
 * Each plugin lives under src/plugins/{plugin-name}/components.tsx and can export:
 *   - AdminTab   → tab injected into the admin panel sidebar
 *   - ServerTab  → tab injected into server detail pages
 *   - UserPage   → standalone page at /${manifest.name} (or custom route from manifest)
 *   - slots      → Record<string, React.ComponentType> for component slot injection
 *
 * New plugins only need their components.tsx placed in
 * src/plugins/{name}/components.tsx — no changes to this loader required.
 */
export async function loadPluginFrontend(manifest: PluginManifest): Promise<LoadedPlugin> {
  const tabs: PluginTabConfig[] = [];
  const routes: PluginRouteConfig[] = [];
  const components: PluginComponentSlot[] = [];

  if (!manifest.enabled || !manifest.hasFrontend) {
    return { manifest, routes: [], tabs, components };
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
      // Use custom route from manifest if provided, otherwise default to /${manifest.name}
      // For backward compatibility, check manifest.routes?.['UserPage'] first
      const customPath = manifest.routes?.['UserPage'];
      const defaultPath = `/${manifest.name}`;

      routes.push({
        path: customPath || defaultPath,
        component: mod.UserPage,
      });
    }

    // Load component slots if the plugin exports them
    if (mod.slots && typeof mod.slots === 'object') {
      for (const [slotName, component] of Object.entries(mod.slots)) {
        if (typeof component === 'function') {
          components.push({
            slot: slotName,
            component: component as React.ComponentType<any>,
            order: 50,
          });
        } else if (component && typeof component === 'object' && 'component' in component) {
          const slotConfig = component as { component: React.ComponentType<any>; order?: number };
          components.push({
            slot: slotName,
            component: slotConfig.component,
            order: slotConfig.order ?? 50,
          });
        }
      }
    }

    // Also check for registerSlots function (imperative registration)
    if (typeof mod.registerSlots === 'function') {
      const registeredSlots = mod.registerSlots();
      if (Array.isArray(registeredSlots)) {
        for (const entry of registeredSlots) {
          if (entry && entry.slot && entry.component) {
            components.push({
              slot: entry.slot,
              component: entry.component,
              order: entry.order ?? 50,
            });
          }
        }
      }
    }
  } catch (error) {
    console.error(`[PluginLoader] Failed to load frontend for "${manifest.name}":`, error);
  }

  return { manifest, routes, tabs, components };
}
