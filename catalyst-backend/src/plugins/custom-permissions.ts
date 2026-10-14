/**
 * Plugin-declared user permissions, as the role editor sees them.
 *
 * A plugin's `permissions` array is its own API-capability vocabulary (see
 * plugins/safety.ts): those tokens are granted to the *plugin*, not to panel
 * users, and must not be offered as role permissions. `userPermissions` is the
 * separate, role-facing list: tokens a plugin invents to gate its own tabs,
 * pages and slot components (`requiredPermissions` on the frontend side).
 *
 * Nothing in the built-in catalog lists them, so without this module an admin
 * could not grant them — the plugin's UI would be permanently invisible to
 * everyone but `*` holders. This turns the live plugin registry into one extra
 * catalog category.
 *
 * Tokens that are also built-in permissions are left to the built-in
 * categories; the extra category carries only what the panel would otherwise
 * not show.
 */

import { ALL_PERMISSIONS, type PermissionCategory } from '../lib/permissions-catalog.js';

const BUILTIN_TOKENS = new Set(ALL_PERMISSIONS);

/** A permission a plugin exposes for panel roles. */
export interface PluginUserPermission {
  id: string;
  label: string;
  description?: string;
}

/** The registry surface this module needs; keeps it testable without a loader. */
export interface DeclaredPermissionSource {
  manifest: {
    name: string;
    displayName: string;
    userPermissions?: PluginUserPermission[];
  };
  status: string;
}

export interface PluginPermissionSource {
  getRegistry(): { getAll(): DeclaredPermissionSource[] };
}

/**
 * Build the `plugins` catalog category, or null when no enabled plugin
 * exposes a usable permission.
 *
 * Only enabled plugins contribute: a disabled plugin's UI does not render, so
 * offering its tokens would grant access to nothing.
 */
export function buildPluginPermissionCategory(
  loader?: PluginPermissionSource | null,
): PermissionCategory | null {
  // Defensive: a Fastify register options object can land here, and a missing
  // registry must degrade to the built-in catalog, not fail the request.
  if (!loader || typeof loader.getRegistry !== 'function') return null;

  const tokens = new Map<string, string>();
  for (const plugin of loader.getRegistry().getAll()) {
    if (plugin.status !== 'enabled') continue;
    for (const permission of plugin.manifest.userPermissions ?? []) {
      if (!permission?.id || BUILTIN_TOKENS.has(permission.id) || tokens.has(permission.id)) {
        continue;
      }
      // Author copy when provided; otherwise name the plugin, so a reviewer can
      // tell where an unfamiliar token comes from.
      tokens.set(
        permission.id,
        permission.label || `${plugin.manifest.displayName} (${plugin.manifest.name})`,
      );
    }
  }

  if (tokens.size === 0) return null;

  return {
    id: 'plugins',
    label: 'Plugins',
    description: 'Permissions exposed by installed plugins.',
    permissions: [...tokens.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([value, label]) => ({ value, label })),
  };
}
