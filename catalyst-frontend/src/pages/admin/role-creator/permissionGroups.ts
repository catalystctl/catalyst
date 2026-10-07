/**
 * Grouping model for the role creator.
 *
 * The panel has exactly two permission layers, and this module is what keeps
 * the role editor honest about them:
 *
 *   - **Resource permissions** — the canonical `ALL_SERVER_PERMISSIONS` set,
 *     served by `GET /api/permissions/server`. A role only holds these inside
 *     the access boundary it selects; the backend rejects any other value in a
 *     `RoleServerGrant`/`RoleNodeGrant` (see `applyRoleScope` in
 *     catalyst-backend/src/routes/roles.ts).
 *   - **Panel-wide permissions** — everything else in the catalog
 *     (`GET /api/roles/permissions-catalog`). They are global and cannot be
 *     scoped, so the editor must never imply otherwise.
 *
 * Which layer a resource permission lands in depends on the boundary: with a
 * node/server boundary it is written to the scoped grant, with "panel
 * administration only" it is written to the role's global permission list.
 * That is the same split the backend accepts, so the editor can move a chip
 * between layers as the boundary changes without ever losing it.
 *
 * Nothing here hardcodes permission data: values and labels come from the
 * backend catalog, and scope membership comes from the server-permission
 * endpoint. The local catalog in RolesPage is only a fallback for when the
 * backend is unreachable.
 */

/** Which permission layer a group belongs to. */
export type PermissionGroupKind = 'resource' | 'global';

/** A permission value plus the backend-provided label. */
export interface PermissionEntry {
  value: string;
  label: string;
}

/** One rendered permission group (a card of chips). */
export interface PermissionGroup {
  id: string;
  kind: PermissionGroupKind;
  permissions: PermissionEntry[];
}

/** Minimal shape of a catalog category (`GET /api/roles/permissions-catalog`). */
export interface CatalogCategory {
  id: string;
  label: string;
  description?: string;
  permissions: { value: string; label: string }[];
}

/**
 * Catalog category id → group id.
 *
 * The `servers` category is deliberately absent: it is the one category that
 * spans both layers (`server.create`/`server.delete` are fleet-wide, the rest
 * are resource permissions), so it is split below.
 */
const CATEGORY_GROUP: Record<string, string> = {
  admin: 'system',
  apikeys: 'apikeys',
  nodes: 'infrastructure',
  locations: 'infrastructure',
  templates: 'infrastructure',
  users: 'access',
  roles: 'access',
  backups: 'backups',
  files: 'files',
  console: 'console',
  databases: 'databases',
  alerts: 'alerts',
  'server-content': 'content',
  operations: 'system',
};

/**
 * Panel-wide group for `servers`-category values the backend cannot scope
 * (`server.create`, and the `server.suspend` legacy alias). Everything else in
 * that category is a resource permission.
 */
const FLEET_GROUP = 'fleet';

/** Group for permissions a plugin adds that the shipped catalog does not know. */
const UNKNOWN_GROUP = 'other';

/**
 * Render order. Resource groups come first because the access boundary is the
 * role's most consequential decision; panel-wide groups follow, so the two
 * layers never read as one flat list.
 */
const GROUP_ORDER = [
  'server-operations',
  'files',
  'console',
  'backups',
  'databases',
  'alerts',
  'content',
  'fleet',
  'infrastructure',
  'access',
  'apikeys',
  'system',
] as const;

/** Kind of a group id, before scope membership is considered. */
/**
 * The `servers` category splits by scope; every other category keeps its group.
 * Scope membership is the only test, so a permission the backend starts
 * accepting in a grant moves groups without a code change.
 */
function groupForValue(categoryId: string, isScoped: boolean): string {
  if (categoryId === 'servers') {
    return isScoped ? 'server-operations' : FLEET_GROUP;
  }
  return CATEGORY_GROUP[categoryId] ?? UNKNOWN_GROUP;
}

/**
 * Build the grouped permission list.
 *
 * @param catalog      Backend catalog (or the local fallback).
 * @param scopedValues Values the backend accepts in a scoped grant
 *   (`ALL_SERVER_PERMISSIONS` via `GET /api/permissions/server`).
 * @param labelFor     Optional label override — the panel translates
 *   permission names locally instead of showing the backend's English labels.
 */
export function buildPermissionGroups(
  catalog: CatalogCategory[],
  scopedValues: readonly string[],
  labelFor?: (value: string, backendLabel: string) => string,
): PermissionGroup[] {
  const scoped = new Set(scopedValues);
  const buckets = new Map<string, PermissionEntry[]>();
  const seen = new Set<string>();

  for (const category of catalog) {
    for (const permission of category.permissions ?? []) {
      const value = permission?.value;
      // '*' is not a chip — the editor renders it as the super-admin switch —
      // and it is not a valid scoped grant.
      if (!value || value === '*' || seen.has(value)) continue;
      seen.add(value);
      const backendLabel = permission.label ?? value;
      const groupId = groupForValue(category.id, scoped.has(value));
      const bucket = buckets.get(groupId) ?? [];
      bucket.push({ value, label: labelFor ? labelFor(value, backendLabel) : backendLabel });
      buckets.set(groupId, bucket);
    }
  }

  const result: PermissionGroup[] = [];
  const emit = (id: string, permissions: PermissionEntry[], kind: PermissionGroupKind) => {
    if (permissions.length === 0) return;
    result.push({
      id,
      kind,
      permissions: permissions.slice().sort((a, b) => a.label.localeCompare(b.label)),
    });
  };

  const push = (id: string) => {
    const bucket = buckets.get(id);
    if (!bucket?.length) return;
    // The layer is decided by scope membership, never by the category name, so
    // the two sections always match what the backend will actually store.
    const scopedPart = bucket.filter((p) => scoped.has(p.value));
    const globalPart = bucket.filter((p) => !scoped.has(p.value));
    if (scopedPart.length > 0 && globalPart.length > 0) {
      // Only reachable for a plugin category that mixes both layers; the
      // shipped categories are homogeneous. Both parts keep the group's title
      // and land in different sections.
      emit(id, scopedPart, 'resource');
      emit(id, globalPart, 'global');
      return;
    }
    emit(id, bucket, scopedPart.length > 0 ? 'resource' : 'global');
  };

  for (const id of GROUP_ORDER) push(id);
  push(UNKNOWN_GROUP);

  return result;
}

/** Split groups into the two rendered sections. */
export function partitionGroups(groups: PermissionGroup[]): {
  resource: PermissionGroup[];
  global: PermissionGroup[];
} {
  return {
    resource: groups.filter((g) => g.kind === 'resource'),
    global: groups.filter((g) => g.kind === 'global'),
  };
}

/** Every permission value in the given groups, in render order. */
export function groupPermissionValues(groups: PermissionGroup[]): string[] {
  return groups.flatMap((g) => g.permissions.map((p) => p.value));
}

/** Every permission value the catalog offers. */
export function catalogValues(catalog: CatalogCategory[]): Set<string> {
  const values = new Set<string>();
  for (const category of catalog) {
    for (const permission of category.permissions ?? []) {
      if (permission?.value && permission.value !== '*') values.add(permission.value);
    }
  }
  return values;
}

/** Quick-fill presets offered in the permissions toolbar. */
export interface RolePresetFill {
  id: 'viewer' | 'operator' | 'manager';
  permissions: string[];
}

// Scoped values only: a quick fill must never add a permission the backend
// would reject inside an access boundary.
const PRESET_VIEWER = [
  'server.read',
  'file.read',
  'console.read',
  'backup.read',
  'database.read',
  'alert.read',
];

const PRESET_OPERATOR = [
  ...PRESET_VIEWER,
  'server.start',
  'server.stop',
  'server.kill',
  'server.update',
  'console.write',
  'file.write',
];

const PRESET_MANAGER = [
  ...PRESET_OPERATOR,
  'server.install',
  'server.reinstall',
  'server.rebuild',
  'server.network',
  'server.storage',
  'server.archive',
  'server.schedule',
  'server.clone',
  'backup.create',
  'backup.restore',
  'backup.delete',
  'database.create',
  'database.rotate',
  'database.delete',
  'alert.create',
  'alert.update',
  'alert.delete',
  'mods.manage',
  'plugins.manage',
];

export const PRESET_FILLS: RolePresetFill[] = [
  { id: 'viewer', permissions: PRESET_VIEWER },
  { id: 'operator', permissions: PRESET_OPERATOR },
  { id: 'manager', permissions: PRESET_MANAGER },
];

/**
 * Split the flat chip selection into the two payload layers.
 *
 * Mirrors what the backend stores: with a boundary the resource permissions
 * become the scoped grant, without one they are ordinary global permissions.
 */
export function splitSelection(
  selected: ReadonlySet<string>,
  resourceValues: ReadonlySet<string>,
  scopeMode: 'none' | 'nodes' | 'servers',
): { global: string[]; scoped: string[] } {
  const global: string[] = [];
  const scoped: string[] = [];
  for (const value of selected) {
    if (scopeMode !== 'none' && resourceValues.has(value)) scoped.push(value);
    else global.push(value);
  }
  return { global: global.sort(), scoped: scoped.sort() };
}

/**
 * Rebuild a single chip selection from a stored role.
 *
 * `role.permissions` holds panel-wide grants; `scope.permissions` holds the
 * scoped ones. A value granted in both places appears once.
 */
export function mergeSelection(
  globalPermissions: readonly string[],
  scopedPermissions: readonly string[],
): Set<string> {
  return new Set([...globalPermissions, ...scopedPermissions]);
}
