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
  /** Declared plugin permissions; may be omitted by older/partial payloads */
  permissions?: string[];
  hasBackend: boolean;
  hasFrontend: boolean;

  // ── Safety consent & effective grants (admin endpoints) ────────────────

  /** All permissions declared in plugin.json */
  declaredPermissions?: string[];
  /** Permissions currently granted (declared minus revoked) */
  grantedPermissions?: string[];
  /** Declared permissions the admin has revoked */
  revokedPermissions?: string[];
  /**
   * Author-provided reviewer descriptions for declared scopes (custom ones).
   * Validated subset of declared at discovery time.
   */
  permissionDescriptions?: Record<string, string>;
  /** Fully-resolved reviewer-facing copy per declared scope. */
  permissionSummaries?: CapabilitySummary[];
  /** True when enabling requires accepting the safety disclaimer first */
  consentRequired?: boolean;
  /** Why consent is required: never_accepted | plugin_updated | permissions_grew | disclaimer_updated */
  consentReason?: 'never_accepted' | 'plugin_updated' | 'permissions_grew' | 'disclaimer_updated' | null;
  /** Disclaimer version the backend will accept */
  disclaimerVersion?: string;
  /** When the safety disclaimer was last accepted for this plugin */
  safetyAcceptedAt?: string | null;
  /**
   * Legacy/backfill acceptance — plugin was enabled before disclaimers existed.
   * Kept running by policy, flagged for permission review.
   */
  legacyAcceptance?: boolean;

  /** Aggregate capability counts from the list endpoint */
  capabilityCounts?: {
    routes: number;
    tasks: number;
    wsHandlers: number;
    events: number;
  };

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
 * Reviewer-facing summary of one plugin capability, resolved server-side
 * (builtin copy merged with any plugin-provided description).
 */
export interface CapabilitySummary {
  token: string;
  label: string;
  description: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  source: 'builtin' | 'plugin' | 'fallback';
}

/**
 * Detailed plugin payload returned by GET /api/plugins/:name
 * (list fields plus full capability inventory).
 */
export interface PluginDetails extends PluginManifest {
  catalystVersion?: string;
  configSchema?: Record<string, unknown>;
  capabilities?: {
    routes: { method: string; url: string }[];
    tasks: { cron: string }[];
    wsHandlers: string[];
    events?: Record<string, { payload?: Record<string, string>; description?: string }> | null;
    exposedApis: string[];
  };
}

/**
 * A single configuration field schema for a plugin.
 */
export interface PluginConfigField {
  type: 'string' | 'number' | 'boolean' | 'select' | 'text' | 'password';
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
