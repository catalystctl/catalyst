export { usePlugins, useEnabledPlugins, usePlugin, usePluginRoutes, usePluginTabs, usePluginComponents, usePluginLoading } from './hooks';
export { PluginProvider } from './PluginProvider';
export { usePluginContext } from './usePluginContext';
export { usePluginSlots } from './usePluginSlots';
export { PluginSlot } from './PluginSlot';
export { usePluginWebSocket } from './usePluginWebSocket';
export { createPluginApiClient, fetchPluginApi } from './plugin-api';
export { default as PluginErrorBoundary } from './PluginErrorBoundary';
export type { PluginManifest, PluginTabConfig, PluginRouteConfig, PluginComponentSlot, LoadedPlugin } from './types';

// ── Plugin SDK definition factory (new plugin system) ──
// NOTE: plugin-definition is kept minimal on purpose — it must not
// re-export hooks or PluginProvider to avoid breaking the React context
// tree when dynamically imported by the plugin loader.
export { createFrontendPlugin, createPluginApi } from './plugin-definition';
export type {
  FrontendPluginDefinition,
  FrontendPluginManifest,
  FrontendPluginOptions,
  FrontendTabConfig,
  FrontendRouteConfig,
  FrontendComponentSlot,
  PluginApiResponse,
  PluginErrorFallbackProps,
} from './plugin-definition';
export * from './plugin-ui';
