/**
 * Typed permission declarations for plugin manifests.
 *
 * Declaring capabilities through this helper keeps a plugin's requested
 * scopes and their reviewer-facing descriptions in one place and produces a
 * manifest fragment that spreads directly into `plugin.json` at build time
 * (or serves as the source of truth for codegen).
 */

/** One declared capability with optional reviewer-facing copy. */
export interface PermissionDefinition {
  /** Raw permission token, e.g. "server.read" or a custom "tickets.read". */
  token: string;
  /**
   * Short reviewer-facing sentence describing what granting this token lets
   * the plugin do. Built-in panel scopes already ship copy — supply this for
   * custom scopes (or to refine wording). Max 200 chars; validated keys must
   * be declared permissions.
   */
  description?: string;
}

export interface PermissionsManifestFragment {
  /** Token list for manifest `permissions`. */
  permissions: string[];
  /** Description map for manifest `permissionDescriptions`. */
  permissionDescriptions?: Record<string, string>;
}

/**
 * Declare a plugin's capabilities.
 *
 * ```ts
 * export const manifestPermissions = definePermissions(
 *   { token: 'server.read' },
 *   { token: 'tickets.read', description: 'Read all support tickets' },
 * );
 * // → { permissions: ['server.read', 'tickets.read'],
 * //     permissionDescriptions: { 'tickets.read': 'Read all support tickets' } }
 * ```
 */
export function definePermissions(...defs: Array<string | PermissionDefinition>): PermissionsManifestFragment {
  const permissions: string[] = [];
  const permissionDescriptions: Record<string, string> = {};

  for (const def of defs) {
    const entry: PermissionDefinition =
      typeof def === 'string' ? { token: def } : def;
    if (!entry.token || permissions.includes(entry.token)) continue;
    permissions.push(entry.token);
    if (entry.description) {
      permissionDescriptions[entry.token] = entry.description.slice(0, 200);
    }
  }

  return {
    permissions,
    ...(Object.keys(permissionDescriptions).length > 0 ? { permissionDescriptions } : {}),
  };
}
