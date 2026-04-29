/**
 * Frontend plugin definition factory — in-monorepo SDK.
 *
 * Mirrors the `@catalyst/plugin-sdk/frontend` API for plugins inside
 * `src/plugins/{name}/`. This module is the canonical frontend SDK for
 * first-party Catalyst plugins. External plugin authors use the npm package
 * `@catalyst/plugin-sdk/frontend` which shares the same interface.
 *
 * @example
 * import { createFrontendPlugin, PluginErrorBoundary } from '@/plugins/plugin-definition';
 * import { EggExplorer } from './components/EggExplorer';
 *
 * export default createFrontendPlugin({
 *   manifest: { name: 'egg-explorer', version: '1.0.0', displayName: 'Egg Explorer', ... },
 *   tabs: [{ id: 'egg-explorer', label: 'Egg Explorer', component: EggExplorer, location: 'admin' }],
 * });
 */

// ── Types (mirrors @catalyst/plugin-sdk/frontend) ──────────────────────

export interface FrontendPluginManifest {
  name: string;
  version: string;
  displayName: string;
  description: string;
  author: string;
}

export interface FrontendTabConfig {
  id: string;
  label: string;
  icon?: string;
  component: React.ComponentType<any>;
  location: 'admin' | 'server';
  order?: number;
  requiredPermissions?: string[];
}

export interface FrontendRouteConfig {
  path: string;
  component: React.ComponentType<any>;
  requiredPermissions?: string[];
}

export interface FrontendComponentSlot {
  slot: string;
  component: React.ComponentType<any>;
  order?: number;
}

export interface FrontendPluginDefinition {
  manifest: FrontendPluginManifest;
  tabs?: FrontendTabConfig[];
  routes?: FrontendRouteConfig[];
  components?: FrontendComponentSlot[];
  onMount?: () => void | Promise<void>;
  onUnmount?: () => void | Promise<void>;
}

export interface FrontendPluginOptions {
  manifest: FrontendPluginManifest;
  tabs?: FrontendTabConfig[];
  routes?: FrontendRouteConfig[];
  components?: FrontendComponentSlot[];
  onMount?: () => void | Promise<void>;
  onUnmount?: () => void | Promise<void>;
}

export interface PluginApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface PluginErrorFallbackProps {
  pluginName: string;
  error: Error;
  resetError: () => void;
}

// ── Re-exports from the existing frontend plugin system ─────────────────

export { createPluginApiClient as createPluginApi } from './plugin-api';

// ── Plugin definition factory ───────────────────────────────────────────

/**
 * Define a frontend plugin using the Catalyst SDK pattern.
 *
 * Returns a `FrontendPluginDefinition` that the plugin loader recognises
 * when exported as the module's `default` export.
 */
export function createFrontendPlugin(
  options: FrontendPluginOptions,
): FrontendPluginDefinition {
  return {
    manifest: options.manifest,
    tabs: options.tabs,
    routes: options.routes,
    components: options.components,
    onMount: options.onMount,
    onUnmount: options.onUnmount,
  };
}
