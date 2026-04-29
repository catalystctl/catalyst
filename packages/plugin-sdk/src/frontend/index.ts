/**
 * Frontend plugin SDK for Catalyst.
 *
 * Import from `@catalyst/plugin-sdk/frontend` when building browser-side plugins.
 * Zero Node.js dependencies — safe for any modern bundler.
 *
 * @example
 * import { createFrontendPlugin, createPluginApi, PluginErrorBoundary } from '@catalyst/plugin-sdk/frontend';
 */

export { createFrontendPlugin } from './plugin.js';
export { createPluginApi } from './api.js';
export { PluginErrorBoundary } from './error-boundary.js';

export type {
  FrontendPluginDefinition,
  FrontendPluginManifest,
  FrontendTabConfig,
  FrontendRouteConfig,
  FrontendComponentSlot,
  PluginApiResponse,
  FrontendPluginOptions,
  PluginErrorFallbackProps,
} from './types.js';

export type { FrontendPluginOptions } from './plugin.js';
