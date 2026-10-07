/**
 * Pure permission vocabulary data — no imports, no DB, no caches.
 *
 * Kept dependency-free so lib/permissions.ts can consume it without the
 * import cycle a direct permissions-catalog.ts import would create
 * (permissions-catalog.ts imports hasGrant from lib/permissions.ts).
 * permissions-catalog.ts re-exports everything here; it remains the public
 * single source (audit/permission-audit/TARGET-VOCABULARY.md).
 */

/**
 * Canonical read-permission set: everything `admin.read` may satisfy.
 * Every future read permission ends in '.read' or joins this set explicitly
 * (permissions.ts:isReadPermission delegates here).
 */
export const READ_PERMISSIONS: ReadonlySet<string> = new Set([
  'admin.read', 'apikey.read',
  'server.read', 'backup.read', 'file.read', 'console.read',
  'database.read', 'alert.read', 'node.read', 'location.read',
  'template.read', 'user.read', 'role.read',
  'node.view_stats', 'backup.download', 'diagnostics.download',
]);

/**
 * Split aliases (TARGET-VOCABULARY.md §3): a granted legacy value keeps
 * satisfying the values it was split into. One-directional by design —
 * new narrow values never satisfy the old broad checks. Routes switch to
 * the new values in wave 2, stored grants are rewritten in wave 3, and the
 * aliases are removed one release after the migration reports zero legacy
 * values.
 */
export const LEGACY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  'apikey.manage': ['apikey.read', 'apikey.write'],
  'server.update': ['server.network', 'server.storage'],
  'node.update': ['node.server_manage', 'node.agent_control'],
  'server.suspend': ['server.archive'],
  'server.transfer': ['server.migrate'],
  'server.create': ['server.clone'],
  'server.stop': ['server.kill'],
};

/** True when `granted` is a legacy split value covering `required`. */
export function satisfiesLegacyAlias(granted: string, required: string): boolean {
  const aliases = (LEGACY_ALIASES as Record<string, readonly string[] | undefined>)[granted];
  return Array.isArray(aliases) && aliases.includes(required);
}

/**
 * A stored value plus its split targets (scope suffix preserved):
 * 'server.stop' → ['server.stop', 'server.kill'];
 * 'node.update:node_1' → ['node.update:node_1', 'node.server_manage:node_1',
 * 'node.agent_control:node_1']. Used by effective-set mapping so unmigrated
 * legacy rows keep rendering their new capabilities (mirrors what hasGrant
 * would enforce for those rows).
 */
export function expandPermissionAliases(stored: string): string[] {
  const colonIndex = stored.indexOf(':');
  const base = colonIndex === -1 ? stored : stored.slice(0, colonIndex);
  const suffix = colonIndex === -1 ? '' : stored.slice(colonIndex);
  const targets = (LEGACY_ALIASES as Record<string, readonly string[] | undefined>)[base];
  return targets ? [stored, ...targets.map((t) => `${t}${suffix}`)] : [stored];
}

/**
 * Canonical role presets (replaces the stale copy that used to live in
 * lib/permissions.ts). Served by GET /api/roles/presets and re-exported by
 * both permissions.ts and permissions-catalog.ts.
 */
export const PERMISSION_PRESETS = {
  administrator: {
    label: 'Administrator',
    description: 'Full system access',
    permissions: ['*'],
  },
  moderator: {
    label: 'Moderator',
    description: 'Can manage most resources but not users/roles',
    permissions: [
      'node.read',
      'node.update',
      'node.server_manage',
      'node.view_stats',
      'location.read',
      'template.read',
      'user.read',
      'server.read',
      'server.start',
      'server.stop',
      'server.kill',
      'file.read',
      'file.write',
      'console.read',
      'console.write',
      'alert.read',
      'alert.create',
      'alert.update',
      'alert.delete',
    ],
  },
  user: {
    label: 'User',
    description: 'Basic access to own servers',
    permissions: ['server.read'],
  },
  support: {
    label: 'Support',
    description: 'Read-only access for support staff',
    permissions: [
      'node.read',
      'node.view_stats',
      'location.read',
      'template.read',
      'server.read',
      'file.read',
      'console.read',
      'alert.read',
      'user.read',
      'diagnostics.download',
    ],
  },
} as const;
