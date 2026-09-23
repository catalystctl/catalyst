import { z } from 'zod';
import type { Logger } from 'pino';
import { captureSystemError } from '../services/error-logger';
import { describeError } from '../utils/describe-error.js';

// Config key validation - must be alphanumeric with hyphens/underscores, max 50 chars
const CONFIG_KEY_REGEX = /^[a-zA-Z][a-zA-Z0-9_-]{0,50}$/;

// Dependency version validation - must be valid semver
const VERSION_REGEX = /^\d+\.\d+\.\d+$/;

/** Plugin directory / route names: lowercase alphanumeric with hyphens. */
export const PLUGIN_NAME_REGEX = /^[a-z0-9-]+$/;

export function isValidPluginName(name: string): boolean {
  return typeof name === 'string' && name.length > 0 && name.length <= 50 && PLUGIN_NAME_REGEX.test(name);
}

// Permission description values — single reviewer-facing sentence.
const PERMISSION_DESCRIPTION_MAX = 200;

// ── Third-party licensing declaration ────────────────────────────────────────
const LICENSE_URL_MAX = 500;
const CONTACT_HOSTNAME_REGEX = /^[a-z0-9.-]{1,253}$/i;
export const PLUGIN_LICENSING_CONTACT_MAX = 8;

/**
 * `https` only, except loopback — so local development works and a shipped
 * plugin cannot quietly phone home over cleartext.
 */
function isLicenseUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol === 'https:') return true;
  if (url.protocol !== 'http:') return false;
  const host = url.hostname.toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

const licenseUrl = z
  .string()
  .min(1)
  .max(LICENSE_URL_MAX)
  .refine(isLicenseUrl, {
    message: 'must be an https URL (http is accepted only for localhost / 127.0.0.1)',
  });

/**
 * Declared licensing behaviour. Catalyst never issues or validates keys — this
 * block exists so the phone-home is *declared* (and therefore disclosable to
 * the admin before enablement) instead of happening silently inside plugin
 * code that already has unrestricted network access.
 */
export const PluginLicensingSchema = z.object({
  licenseServer: licenseUrl,
  buyUrl: licenseUrl.optional(),
  contact: z
    .array(z.string().regex(CONTACT_HOSTNAME_REGEX, 'must be a bare hostname'))
    .max(PLUGIN_LICENSING_CONTACT_MAX)
    .optional(),
  encrypted: z.boolean().optional(),
  /** Only meaningful when `encrypted` is false: an encrypted plugin cannot fall open. */
  failMode: z.enum(['closed', 'open']).optional(),
  cacheTtlHours: z.number().int().min(1).max(8760).optional(),
});

/**
 * Zod schema for plugin manifest validation
 */
export const PluginManifestSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(50)
    .regex(PLUGIN_NAME_REGEX, 'Plugin name must be lowercase alphanumeric with hyphens'),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Version must follow semver (e.g., 1.0.0)'),
  displayName: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  author: z.string().min(1).max(100),
  catalystVersion: z.string().min(1),
  permissions: z.array(z.string()).default([]),
  /**
   * Author-supplied reviewer descriptions for DECLARED permission scopes.
   * Built-in scopes come with panel-provided copy; authors only need this for
   * custom scopes (or to refine wording). Keys must be declared permissions —
   * enforced below so typos surface at discovery time, not in review UIs.
   */
  permissionDescriptions: z
    .record(z.string(), z.string().min(1).max(PERMISSION_DESCRIPTION_MAX))
    .optional(),
  // Isolation / storage engine flags — must be kept (not stripped) so loader can activate them.
  runtime: z.enum(['legacy', 'isolated']).optional(),
  storageEngine: z.enum(['legacy', 'dedicated']).optional(),
  backend: z
    .object({
      entry: z.string(),
    })
    .optional(),
  frontend: z
    .object({
      entry: z.string(),
      hasTabs: z.boolean().optional(),
      hasComponents: z.boolean().optional(),
    })
    .optional(),
  dependencies: z
    .record(
      z.string(),
      z.string().regex(/^\d+\.\d+\.\d+$/, 'Dependency versions must follow semver format (e.g., 1.0.0)'),
    )
    .optional(),
  config: z
    .record(
      z.string().regex(CONFIG_KEY_REGEX, 'Config keys must be alphanumeric with optional hyphens/underscores, max 50 chars'),
      z.any(),
    )
    .optional(),
  events: z
    .record(
      z.string(),
      z.object({
        payload: z.record(z.string(), z.any()),
        description: z.string().optional(),
      }),
    )
    .optional(),
  /**
   * External sign-in providers this plugin implements (e.g. Discord OAuth).
   * Declared providers are listed by the public /api/auth/oauth-providers
   * endpoint so the login page can render their buttons; each provider's
   * authorize route must exist and be registered with `config.auth`.
   */
  authProviders: z
    .array(
      z.object({
        id: z.string().min(1).max(32),
        label: z.string().min(1).max(64),
        authorizePath: z.string().regex(/^\/?[a-zA-Z0-9/_-]{1,120}$/).optional(),
      }),
    )
    .max(8)
    .optional(),
  /**
   * Vendor-owned licensing declaration. Presence of this block is the flag
   * that the plugin contacts an external license server (and optionally ships
   * an encrypted backend payload). Catalyst neither issues nor validates keys.
   */
  licensing: PluginLicensingSchema.optional(),
}).superRefine((manifest, ctx) => {
  // permissionDescriptions keys must reference DECLARED permissions. Failing
  // loudly here gives authors an immediate, actionable error during discovery
  // instead of silently-missing copy in the admin consent/review UIs.
  const descriptions = manifest.permissionDescriptions;
  if (!descriptions) return;
  const declared = new Set(manifest.permissions ?? []);
  for (const key of Object.keys(descriptions)) {
    if (!declared.has(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['permissionDescriptions', key],
        message: `permissionDescriptions key "${key}" is not declared in "permissions"`,
      });
    }
  }
});

/**
 * Validate plugin manifest
 */
export function validateManifest(data: unknown): z.infer<typeof PluginManifestSchema> {
  try {
    return PluginManifestSchema.parse(data);
  } catch (error: any) {
    captureSystemError({
      level: 'warn',
      component: 'PluginValidator',
      message: `Manifest validation error: ${describeError(error)}`,
      stack: error?.stack,
    }).catch(() => {});
    throw error;
  }
}

/**
 * Validate config key format
 * Keys must be alphanumeric with optional hyphens/underscores, max 50 chars
 */
export function validateConfigKey(key: string): boolean {
  return CONFIG_KEY_REGEX.test(key);
}

/**
 * Check if plugin has required permissions
 */
export function hasPermission(userPermissions: string[], requiredPermissions: string[]): boolean {
  if (userPermissions.includes('*')) return true;

  return requiredPermissions.every((required) => {
    // Check exact match
    if (userPermissions.includes(required)) return true;

    // Check wildcard permissions (e.g., 'server.*' matches 'server.start')
    const parts = required.split('.');
    for (let i = parts.length; i > 0; i--) {
      const wildcardPerm = `${parts.slice(0, i).join('.')}.*`;
      if (userPermissions.includes(wildcardPerm)) return true;
    }

    return false;
  });
}

/**
 * Validate Catalyst version compatibility
 */
export function isVersionCompatible(required: string, current: string): boolean {
  // Simple semver range check (supports >=, >, =, <, <=)
  const match = required.match(/^([><=]+)?\s*(\d+\.\d+\.\d+)$/);
  if (!match) return false;

  const operator = match[1] || '=';
  const requiredVersion = match[2];

  const compare = compareVersions(current, requiredVersion);

  switch (operator) {
    case '>=':
      return compare >= 0;
    case '>':
      return compare > 0;
    case '=':
    case '==':
      return compare === 0;
    case '<':
      return compare < 0;
    case '<=':
      return compare <= 0;
    default:
      return false;
  }
}

/**
 * Compare two semver versions
 * Returns: -1 if a < b, 0 if a === b, 1 if a > b
 */
export function compareVersions(a: string, b: string): number {
  const aParts = a.split('.').map(Number);
  const bParts = b.split('.').map(Number);

  for (let i = 0; i < 3; i++) {
    if (aParts[i] > bParts[i]) return 1;
    if (aParts[i] < bParts[i]) return -1;
  }

  return 0;
}

/**
 * Validate plugin dependencies
 * Ensures all dependencies exist in registry and versions are compatible
 */
export function validateDependencies(
  dependencies: Record<string, string> | undefined,
  registryPlugins: string[],
  registryVersions: Map<string, string>,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!dependencies) {
    return { valid: true, errors: [] };
  }

  for (const [name, version] of Object.entries(dependencies)) {
    // Check dependency exists
    if (!registryPlugins.includes(name)) {
      errors.push(`Missing dependency: ${name}@${version} (plugin not found)`);
      continue;
    }

    // Check version compatibility
    const installedVersion = registryVersions.get(name);
    if (installedVersion && !isVersionCompatible(version, installedVersion)) {
      errors.push(
        `Dependency version mismatch: ${name} requires ${version}, found ${installedVersion}`,
      );
    }

    // Validate version format
    if (!VERSION_REGEX.test(version)) {
      errors.push(`Invalid dependency version format: ${name}@${version} (must be semver)`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Detect circular dependencies in a dependency graph.
 * Returns an array of plugin names that participate in cycles (if any).
 */
export function detectCircularDependencies(
  dependencies: Record<string, Record<string, string> | undefined>,
): string[] {
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const cycleMembers = new Set<string>();

  function dfs(pluginName: string): boolean {
    visited.add(pluginName);
    recursionStack.add(pluginName);

    const deps = dependencies[pluginName] || {};
    for (const dep of Object.keys(deps)) {
      if (!visited.has(dep)) {
        if (dfs(dep)) {
          cycleMembers.add(pluginName);
          return true;
        }
      } else if (recursionStack.has(dep)) {
        cycleMembers.add(pluginName);
        cycleMembers.add(dep);
        return true;
      }
    }

    recursionStack.delete(pluginName);
    return false;
  }

  for (const pluginName of Object.keys(dependencies)) {
    if (!visited.has(pluginName)) {
      dfs(pluginName);
    }
  }

  return Array.from(cycleMembers);
}

/**
 * Log warning when plugin uses API not declared in permissions
 */
export function warnUndeclaredPermissionUsage(
  pluginName: string,
  declaredPermissions: string[],
  attemptedAccess: string,
  logger: Logger,
): void {
  if (!declaredPermissions.includes('*') && !declaredPermissions.includes(attemptedAccess)) {
    logger.warn(
      { plugin: pluginName, attemptedAccess, declaredPermissions },
      'Plugin attempted to use API not declared in manifest permissions',
    );
  }
}
