import { reportSystemError } from '../services/api/systemErrors';
import type { PluginManifest, LoadedPlugin, PluginRouteConfig, PluginTabConfig, PluginComponentSlot } from './types';

// ── Build-time discovery of plugin frontends ──────────────────────────────
// Embedded plugins live in src/plugins/{name}/components.tsx (legacy monorepo location).
// External plugins live in catalyst-plugins/{name}/frontend/index.ts (canonical location).

type FrontendModule = {
  default?: any;
  AdminTab?: any;
  ServerTab?: any;
  UserPage?: any;
  slots?: any;
  registerSlots?: any;
};

const embeddedFrontends = import.meta.glob<FrontendModule>('./*/components.tsx');
const pluginFrontends = import.meta.glob<FrontendModule>('@plugins/**/frontend/index.ts');

function buildFrontendMap() {
  const map = new Map<string, () => Promise<FrontendModule>>();

  for (const [path, importer] of Object.entries(embeddedFrontends)) {
    const match = path.match(/\.\/(.+)\/components\.tsx$/);
    if (match) map.set(match[1], importer);
  }

  for (const [path, importer] of Object.entries(pluginFrontends)) {
    const match = path.match(/catalyst-plugins\/([^/]+)\/frontend\/index\.ts$/);
    if (match) map.set(match[1], importer);
  }

  return map;
}

const frontendMap = buildFrontendMap();

/**
 * Dynamically load plugin frontend components at runtime.
 *
 * Discovers frontends at build time via import.meta.glob from two locations:
 *   - src/plugins/{name}/components.tsx          (embedded, legacy)
 *   - catalyst-plugins/{name}/frontend/index.ts  (external, canonical)
 *
 * Each module can export:
 *   - default FrontendPluginDefinition  → SDK pattern (tabs, routes, components)
 *   - AdminTab   → tab injected into the admin panel sidebar
 *   - ServerTab  → tab injected into server detail pages
 *   - UserPage   → standalone page at /${manifest.name}
 *   - slots      → Record<string, React.ComponentType> for component slot injection
 */
export async function loadPluginFrontend(manifest: PluginManifest): Promise<LoadedPlugin> {
  const tabs: PluginTabConfig[] = [];
  const routes: PluginRouteConfig[] = [];
  const components: PluginComponentSlot[] = [];

  if (!manifest.enabled || !manifest.hasFrontend) {
    return { manifest, routes: [], tabs, components };
  }

  const importer = frontendMap.get(manifest.name);
  if (!importer) {
    console.warn(`[PluginLoader] No frontend found for plugin "${manifest.name}"`);
    return { manifest, routes: [], tabs, components };
  }

  try {
    const mod = await importer();

    // ── New SDK pattern: default export is a FrontendPluginDefinition ──
    const definition = mod.default ?? mod;
    const isSdkDefinition =
      definition &&
      typeof definition === 'object' &&
      'manifest' in definition &&
      definition.manifest &&
      typeof definition.manifest === 'object';

    if (isSdkDefinition) {
      // Tabs from SDK definition
      if (Array.isArray(definition.tabs)) {
        for (const tab of definition.tabs) {
          tabs.push({
            id: tab.id || `${manifest.name}-${tab.location}`,
            label: tab.label || manifest.displayName,
            icon: tab.icon,
            component: tab.component,
            location: tab.location,
            order: tab.order ?? 50,
            requiredPermissions: tab.requiredPermissions ??
              (tab.location === 'admin' ? ['admin.read'] : ['server.read']),
          });
        }
      }

      // Routes from SDK definition
      if (Array.isArray(definition.routes)) {
        for (const route of definition.routes) {
          routes.push({
            path: route.path,
            component: route.component,
            requiredPermissions: route.requiredPermissions,
          });
        }
      }

      // Component slots from SDK definition
      if (Array.isArray(definition.components)) {
        for (const slot of definition.components) {
          components.push({
            slot: slot.slot,
            component: slot.component,
            order: slot.order ?? 50,
          });
        }
      }
    }

    // ── Legacy pattern: individual named exports ──
    // Only used when the plugin does NOT export a FrontendPluginDefinition.
    if (!isSdkDefinition) {
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
    }
  } catch (error) {
    reportSystemError({
      level: 'error',
      component: 'loader',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      metadata: { context: 'Failed to load plugin frontend' },
    });
    console.error(`[PluginLoader] Failed to load frontend for "${manifest.name}":`, error);
  }

  return { manifest, routes, tabs, components };
}
