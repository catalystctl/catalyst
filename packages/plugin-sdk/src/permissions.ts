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
 * One permission a plugin exposes to the panel's role editor.
 *
 * These are NOT plugin capabilities: `definePermissions` tokens are granted to
 * the plugin by an admin, while these are granted to panel users through a
 * role. The plugin's frontend gates its own tabs, pages and slot components on
 * the same ids via `requiredPermissions`.
 */
export interface UserPermissionDefinition {
  /** Token the plugin checks, e.g. "tickets.view". Max 64 chars. */
  id: string;
  /** Role-editor label, e.g. "View the ticket queue". Max 64 chars. */
  label: string;
  /** Optional role-editor sentence, max 200 chars. */
  description?: string;
}

export interface UserPermissionsManifestFragment {
  /** Entry list for manifest `userPermissions`. */
  userPermissions: UserPermissionDefinition[];
}

/**
 * Expose permissions panel roles can be granted.
 *
 * ```ts
 * export const exposedPermissions = defineUserPermissions(
 *   { id: 'tickets.view', label: 'View the ticket queue' },
 *   { id: 'tickets.reply', label: 'Reply to tickets', description: 'Also sends the reply email.' },
 * );
 * // → { userPermissions: [{ id: 'tickets.view', label: 'View the ticket queue' }, ...] }
 * ```
 *
 * The panel lists these under **Plugins** in the role editor. Ids that are
 * also built-in permissions are ignored there — use the built-in directly.
 */
export function defineUserPermissions(
  ...defs: UserPermissionDefinition[]
): UserPermissionsManifestFragment {
  const userPermissions: UserPermissionDefinition[] = [];
  const seen = new Set<string>();

  for (const def of defs) {
    if (!def?.id || def.id === '*' || seen.has(def.id)) continue;
    seen.add(def.id);
    userPermissions.push({
      id: def.id,
      label: def.label || def.id,
      ...(def.description ? { description: def.description.slice(0, 200) } : {}),
    });
  }

  return { userPermissions };
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
