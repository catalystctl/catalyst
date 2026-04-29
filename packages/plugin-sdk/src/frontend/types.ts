/**
 * Frontend-specific types for Catalyst plugins.
 * Pure types with zero Node.js dependencies — browser-compatible.
 */

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

/** What a frontend plugin module exports. */
export interface FrontendPluginDefinition {
  manifest: FrontendPluginManifest;
  tabs?: FrontendTabConfig[];
  routes?: FrontendRouteConfig[];
  components?: FrontendComponentSlot[];
  /** Called when the plugin is first mounted in the UI. */
  onMount?: () => void | Promise<void>;
  /** Called when the plugin is unmounted from the UI. */
  onUnmount?: () => void | Promise<void>;
}

/** Standard API response envelope from plugin backend routes. */
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

/** Props passed to a custom error fallback component. */
export interface PluginErrorFallbackProps {
  pluginName: string;
  error: Error;
  resetError: () => void;
}
