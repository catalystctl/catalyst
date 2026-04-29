/**
 * Factory for defining frontend plugins using the Catalyst SDK pattern.
 */

import type {
  FrontendPluginDefinition,
  FrontendPluginManifest,
  FrontendTabConfig,
  FrontendRouteConfig,
  FrontendComponentSlot,
} from './types.js';
import { createPluginApi } from './api.js';

export interface FrontendPluginOptions {
  manifest: FrontendPluginManifest;
  tabs?: FrontendTabConfig[];
  routes?: FrontendRouteConfig[];
  components?: FrontendComponentSlot[];
  /** Called when the plugin is first mounted in the UI. */
  onMount?: () => void | Promise<void>;
  /** Called when the plugin is unmounted from the UI. */
  onUnmount?: () => void | Promise<void>;
}

/**
 * Defines a frontend plugin with typed API client and lifecycle hooks.
 *
 * @example
 * export default createFrontendPlugin({
 *   manifest: {
 *     name: 'my-plugin',
 *     version: '1.0.0',
 *     displayName: 'My Plugin',
 *     description: 'A great plugin',
 *     author: 'Me',
 *   },
 *   tabs: [
 *     { id: 'my-plugin', label: 'My Plugin', component: MyComponent, location: 'admin' },
 *   ],
 *   onMount: () => console.log('Plugin mounted'),
 * });
 */
export function createFrontendPlugin(options: FrontendPluginOptions): FrontendPluginDefinition {
  return {
    manifest: options.manifest,
    tabs: options.tabs,
    routes: options.routes,
    components: options.components,
    onMount: options.onMount,
    onUnmount: options.onUnmount,
  };
}
