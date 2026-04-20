/**
 * Plugin manifest from backend
 */
export interface PluginManifest {
  name: string;
  version: string;
  displayName: string;
  description: string;
  author: string;
  status: string;
  enabled: boolean;
  loadedAt?: string;
  enabledAt?: string;
  error?: string;
  permissions: string[];
  hasBackend: boolean;
  hasFrontend: boolean;

  /** Plugin configuration schema for admin UI editing */
  config?: Record<string, PluginConfigField>;

  /** Other plugins this plugin depends on */
  dependencies?: string[];

  /** Events this plugin emits or listens for */
  events?: PluginEventConfig[];

  /** Custom route paths from manifest (overrides default /${name}) */
  routes?: Record<string, string>;
}

/**
 * A single configuration field schema for a plugin.
 */
export interface PluginConfigField {
  type: 'string' | 'number' | 'boolean' | 'select' | 'text';
  default?: any;
  description?: string;
  label?: string;
  options?: { label: string; value: string | number }[];
}

/**
 * Event configuration for a plugin
 */
export interface PluginEventConfig {
  name: string;
  direction: 'emit' | 'listen';
  description?: string;
}

/**
 * Plugin tab configuration
 */
export interface PluginTabConfig {
  id: string;
  label: string;
  icon?: string;
  component: React.ComponentType<any>;
  location: 'admin' | 'server';
  order?: number;
  requiredPermissions?: string[];
}

/**
 * Plugin route configuration
 */
export interface PluginRouteConfig {
  path: string;
  component: React.ComponentType<any>;
  requiredPermissions?: string[];
}

/**
 * Plugin component slot
 */
export interface PluginComponentSlot {
  slot: string;
  component: React.ComponentType<any>;
  order?: number;
}

/**
 * Loaded plugin state
 */
export interface LoadedPlugin {
  manifest: PluginManifest;
  routes: PluginRouteConfig[];
  tabs: PluginTabConfig[];
  components: PluginComponentSlot[];
  module?: any;
}
