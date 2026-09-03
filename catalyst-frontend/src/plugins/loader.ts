import { reportSystemError } from '../services/api/systemErrors';
import { describeError } from '../utils/errors';
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
// Alias form (resolved via the @plugins alias) plus the equivalent relative
// form. Some Vite versions do not resolve aliases inside glob patterns, which
// silently yields an empty map and every external plugin falls back to the
// runtime bundle. Registering both covers either behavior; the map dedupes.
const pluginFrontendsAlias = import.meta.glob<FrontendModule>('@plugins/**/frontend/index.ts');
const pluginFrontendsRelative = import.meta.glob<FrontendModule>('../../../catalyst-plugins/*/frontend/index.ts');

function buildFrontendMap() {
  const map = new Map<string, () => Promise<FrontendModule>>();

  for (const [path, importer] of Object.entries(embeddedFrontends)) {
    const match = path.match(/\.\/(.+)\/components\.tsx$/);
    if (match) map.set(match[1], importer);
  }

  for (const frontends of [pluginFrontendsAlias, pluginFrontendsRelative]) {
    for (const [path, importer] of Object.entries(frontends)) {
      const match = path.match(/(?:catalyst-plugins\/|@plugins\/)([^/]+)\/frontend\/index\.ts$/);
      if (match && !map.has(match[1])) map.set(match[1], importer);
    }
  }

  return map;
}

const frontendMap = buildFrontendMap();

/**
 * Load a marketplace-installed plugin's self-contained ESM bundle.
 * Cache-busted by version so an update is not stuck on a previously imported module.
 * forceReload adds a timestamp for same-version reloads (backend changed, version did not).
 */
async function loadRuntimeFrontend(
  manifest: PluginManifest,
  opts: { forceReload?: boolean } = {},
): Promise<FrontendModule | null> {
  const API_BASE = import.meta.env.VITE_API_URL ?? '';
  const version = encodeURIComponent(manifest.version || '0');
  const cacheBuster = opts.forceReload ? `&t=${Date.now()}` : '';
  const runtimeUrl = `${API_BASE}/plugins-assets/${encodeURIComponent(manifest.name)}/frontend.mjs?v=${version}${cacheBuster}`;
  try {
    return (await import(/* @vite-ignore */ runtimeUrl)) as FrontendModule;
  } catch {
    return null;
  }
}

export async function loadPluginFrontend(
  manifest: PluginManifest,
  opts: { forceReload?: boolean } = {},
): Promise<LoadedPlugin> {
  const empty: LoadedPlugin = { manifest, routes: [], tabs: [], components: [] };

  if (!manifest.enabled || !manifest.hasFrontend) {
    return empty;
  }

  const importer = frontendMap.get(manifest.name);

  // Prefer the build-time module in every environment: it shares the host
  // React copy, so hooks work. A self-contained runtime bundle inlines its
  // own React whose hooks dispatcher is never set by the host renderer —
  // any hook call in it throws (null dispatcher). The runtime bundle is
  // only a fallback for plugins with no build-time copy (third-party
  // marketplace installs).
  if (importer) {
    try {
      const mod = await importer();
      return registerFrontendModule(mod, manifest);
    } catch (error) {
      reportSystemError({
        level: 'error',
        component: 'loader',
        message: describeError(error),
        stack: error instanceof Error ? error.stack : undefined,
        metadata: { context: 'Failed to load plugin frontend' },
      });
      console.error(`[PluginLoader] Failed to load frontend for "${manifest.name}":`, error);
    }
  }

  const runtimeMod = await loadRuntimeFrontend(manifest, opts);
  if (runtimeMod) return registerFrontendModule(runtimeMod, manifest);

  console.warn(`[PluginLoader] No frontend found for plugin "${manifest.name}"`);
  return empty;
}

/**
 * Register tabs/routes/slots/lifecycle from a loaded frontend module — shared
 * by build-time imports and runtime-installed plugin bundles.
 */
function registerFrontendModule(mod: FrontendModule, manifest: PluginManifest): LoadedPlugin {
  const tabs: PluginTabConfig[] = [];
  const routes: PluginRouteConfig[] = [];
  const components: PluginComponentSlot[] = [];

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
            templateFilter: tab.templateFilter,
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

      // Lifecycle: fire onMount once when the frontend module is first loaded
      if (typeof definition.onMount === 'function') {
        try {
          const maybe = definition.onMount();
          if (maybe && typeof (maybe as Promise<void>).then === 'function') {
            (maybe as Promise<void>).catch((err) => {
              console.error(`[PluginLoader] onMount failed for "${manifest.name}":`, err);
            });
          }
        } catch (err) {
          console.error(`[PluginLoader] onMount threw for "${manifest.name}":`, err);
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

  return { manifest, routes, tabs, components, module: mod };
}

/**
 * Run a previously loaded frontend module's onUnmount (if it defines one)
 * before it is replaced by a hot-reloaded copy.
 */
export function unmountPluginFrontend(loaded: LoadedPlugin): void {
  const mod = (loaded as LoadedPlugin & { module?: any }).module;
  const definition = mod?.default ?? mod;
  if (definition && typeof definition.onUnmount === 'function') {
    try {
      const maybe = definition.onUnmount();
      if (maybe && typeof (maybe as Promise<void>).then === 'function') {
        (maybe as Promise<void>).catch((err) => {
          console.error(`[PluginLoader] onUnmount failed for "${loaded.manifest.name}":`, err);
        });
      }
    } catch (err) {
      console.error(`[PluginLoader] onUnmount threw for "${loaded.manifest.name}":`, err);
    }
  }
}
