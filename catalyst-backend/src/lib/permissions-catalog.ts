/**
 * Permissions Catalog
 *
 * Central definition of all permission categories and their individual permissions.
 * Used by:
 *   - API key creation (frontend selector + backend validation)
 *   - Role management UI
 *   - Permission display throughout the app
 */

export interface PermissionCategory {
  id: string;
  label: string;
  description: string;
  permissions: { value: string; label: string }[];
}

export const PERMISSION_CATEGORIES: PermissionCategory[] = [
  {
    id: 'admin',
    label: 'Administration',
    description: 'Full admin access to all system features',
    permissions: [
      { value: '*', label: 'Super Admin (all permissions)' },
      { value: 'admin.read', label: 'View admin panel' },
      { value: 'admin.write', label: 'Manage admin settings' },
    ],
  },
  {
    id: 'servers',
    label: 'Servers',
    description: 'Create, manage, and delete game servers',
    permissions: [
      { value: 'server.read', label: 'View servers' },
      { value: 'server.create', label: 'Create servers' },
      { value: 'server.start', label: 'Start servers' },
      { value: 'server.stop', label: 'Stop servers' },
      { value: 'server.delete', label: 'Delete servers' },
      { value: 'server.suspend', label: 'Suspend servers' },
      { value: 'server.transfer', label: 'Transfer ownership' },
      { value: 'server.schedule', label: 'Manage schedules/tasks' },
      { value: 'server.update', label: 'Update server settings' },
      { value: 'server.install', label: 'Install servers' },
      { value: 'server.reinstall', label: 'Reinstall servers' },
      { value: 'server.rebuild', label: 'Rebuild servers' },
    ],
  },
  {
    id: 'nodes',
    label: 'Nodes',
    description: 'Manage compute nodes',
    permissions: [
      { value: 'node.read', label: 'View nodes' },
      { value: 'node.create', label: 'Create nodes' },
      { value: 'node.update', label: 'Update nodes' },
      { value: 'node.delete', label: 'Delete nodes' },
      { value: 'node.view_stats', label: 'View node statistics' },
      { value: 'node.manage_allocation', label: 'Manage allocations' },
      { value: 'node.assign', label: 'Assign nodes' },
    ],
  },
  {
    id: 'locations',
    label: 'Locations',
    description: 'Manage server locations',
    permissions: [
      { value: 'location.read', label: 'View locations' },
      { value: 'location.create', label: 'Create locations' },
      { value: 'location.update', label: 'Update locations' },
      { value: 'location.delete', label: 'Delete locations' },
    ],
  },
  {
    id: 'templates',
    label: 'Templates',
    description: 'Manage game server templates',
    permissions: [
      { value: 'template.read', label: 'View templates' },
      { value: 'template.create', label: 'Create templates' },
      { value: 'template.update', label: 'Update templates' },
      { value: 'template.delete', label: 'Delete templates' },
    ],
  },
  {
    id: 'users',
    label: 'Users',
    description: 'Manage user accounts',
    permissions: [
      { value: 'user.read', label: 'View users' },
      { value: 'user.create', label: 'Create users' },
      { value: 'user.update', label: 'Update users' },
      { value: 'user.delete', label: 'Delete users' },
      { value: 'user.ban', label: 'Ban users' },
      { value: 'user.unban', label: 'Unban users' },
      { value: 'user.set_roles', label: 'Assign roles' },
    ],
  },
  {
    id: 'roles',
    label: 'Roles',
    description: 'Manage permission roles',
    permissions: [
      { value: 'role.read', label: 'View roles' },
      { value: 'role.create', label: 'Create roles' },
      { value: 'role.update', label: 'Update roles' },
      { value: 'role.delete', label: 'Delete roles' },
    ],
  },
  {
    id: 'backups',
    label: 'Backups',
    description: 'Manage server backups',
    permissions: [
      { value: 'backup.read', label: 'View backups' },
      { value: 'backup.create', label: 'Create backups' },
      { value: 'backup.delete', label: 'Delete backups' },
      { value: 'backup.restore', label: 'Restore backups' },
      { value: 'backup.download', label: 'Download backups' },
    ],
  },
  {
    id: 'files',
    label: 'Files',
    description: 'Access server file manager',
    permissions: [
      { value: 'file.read', label: 'Read files' },
      { value: 'file.write', label: 'Write files' },
    ],
  },
  {
    id: 'console',
    label: 'Console',
    description: 'Access server console',
    permissions: [
      { value: 'console.read', label: 'View console' },
      { value: 'console.write', label: 'Send commands' },
    ],
  },
  {
    id: 'databases',
    label: 'Databases',
    description: 'Manage server databases',
    permissions: [
      { value: 'database.read', label: 'View databases' },
      { value: 'database.create', label: 'Create databases' },
      { value: 'database.delete', label: 'Delete databases' },
      { value: 'database.rotate', label: 'Rotate passwords' },
    ],
  },
  {
    id: 'alerts',
    label: 'Alerts',
    description: 'Manage server alerts',
    permissions: [
      { value: 'alert.read', label: 'View alerts' },
      { value: 'alert.create', label: 'Create alerts' },
      { value: 'alert.update', label: 'Update alerts' },
      { value: 'alert.delete', label: 'Delete alerts' },
    ],
  },
  {
    id: 'apikeys',
    label: 'API Keys',
    description: 'Manage API keys',
    permissions: [
      { value: 'apikey.manage', label: 'Create and manage API keys' },
    ],
  },
];

/** All valid permission values (flat list) */
export const ALL_PERMISSIONS = PERMISSION_CATEGORIES.flatMap((c) =>
  c.permissions.map((p) => p.value),
);

/** Get human-readable label for a permission value */
export function getPermissionLabel(value: string): string {
  if (value === '*') return 'Super Admin';
  for (const cat of PERMISSION_CATEGORIES) {
    const perm = cat.permissions.find((p) => p.value === value);
    if (perm) return perm.label;
  }
  return value;
}

/** Get category for a permission value */
export function getPermissionCategory(value: string): PermissionCategory | undefined {
  for (const cat of PERMISSION_CATEGORIES) {
    if (cat.permissions.some((p) => p.value === value)) return cat;
  }
  return undefined;
}

/**
 * Check if a request's user has a specific permission.
 * Uses request.user.permissions which is populated by the auth middleware
 * for both session and API key authentication.
 */
export function hasPermission(request: any, permission: string): boolean {
  const perms: string[] = request.user?.permissions ?? [];
  return perms.includes('*') || perms.includes(permission);
}

/**
 * Check if a request's user has admin-level access.
 */
export function isAdmin(request: any): boolean {
  const perms: string[] = request.user?.permissions ?? [];
  return perms.includes('*') || perms.includes('admin.write') || perms.includes('admin.read');
}

/**
 * Check if a request's user has any of the specified permissions.
 */
export function hasAnyPermission(request: any, permissions: string[]): boolean {
  const perms: string[] = request.user?.permissions ?? [];
  if (perms.includes('*')) return true;
  return permissions.some((p) => perms.includes(p));
}

import { prisma } from '../db';
import { SimpleCache } from './cache';
import { broadcastCacheInvalidate, onCacheInvalidate } from './cache-bus';

/**
 * The canonical server-scoped permission set — the "subuser permission list".
 *
 * Single source of truth for:
 *   - ServerAccess (subuser) grants
 *   - Role-scoped grants (RoleServerGrant / RoleNodeGrant validation)
 *   - getEffectiveServerPermissions mapping
 *   - GET /api/permissions/server → the frontend permission checklist
 *     (subuser UI + role wizard consume this, so new permissions appear
 *     in both automatically)
 */
export const ALL_SERVER_PERMISSIONS = [
  'server.read', 'server.start', 'server.stop', 'server.install',
  'server.reinstall', 'server.rebuild', 'server.update',
  'server.transfer', 'server.delete', 'server.schedule',
  'console.read', 'console.write',
  'file.read', 'file.write',
  'backup.read', 'backup.create', 'backup.restore', 'backup.delete', 'backup.download',
  'database.read', 'database.create', 'database.rotate', 'database.delete',
  'alert.read', 'alert.create', 'alert.update', 'alert.delete',
] as const;

// 30-second TTL cache for resolved user permissions
const permissionsCache = new SimpleCache<string, string[]>(30_000);
// Shorter TTL for server-scoped resolutions (key `${userId}:${serverId}`);
// role-grant mutations flush this cache explicitly.
const scopedPermissionsCache = new SimpleCache<string, string[]>(15_000);

/**
 * Resolve a user's effective permissions from their roles.
 * Returns a flat array of unique permission strings.
 */
export async function resolveUserPermissions(
  userId: string,
): Promise<string[]> {
  const cached = permissionsCache.get(userId);
  if (cached) return cached;

  const roles = await prisma.role.findMany({
    where: { users: { some: { id: userId } } },
    select: { permissions: true },
  });
  const permissions = new Set<string>();
  for (const role of roles) {
    for (const perm of role.permissions) {
      permissions.add(perm);
    }
  }
  const result = [...permissions];
  permissionsCache.set(userId, result);
  return result;
}

/**
 * Pure merge of global role permissions with server-scoped and node-scoped
 * role grants (RoleServerGrant / RoleNodeGrant). Kept pure for unit tests.
 */
export function mergeServerPermissions(
  globalPerms: string[],
  serverGrantRows: string[][],
  nodeGrantRows: string[][],
): string[] {
  const set = new Set<string>(globalPerms);
  for (const row of serverGrantRows) for (const p of row) set.add(p);
  for (const row of nodeGrantRows) for (const p of row) set.add(p);
  return [...set];
}

/**
 * Resolve a user's effective permissions for a SPECIFIC server:
 * global role permissions UNION RoleServerGrant rows for this server
 * UNION RoleNodeGrant rows covering this server's node (wildcard
 * "all nodes" grants have nodeId null).
 *
 * Powers the requiredPermission branch of decideServerAccess and
 * getEffectiveServerPermissions, so role-scoped grants apply consistently
 * across every per-server check.
 */
export async function resolveServerPermissions(
  userId: string,
  serverId: string,
  nodeId: string | null,
): Promise<string[]> {
  const cacheKey = `${userId}:${serverId}`;
  const cached = scopedPermissionsCache.get(cacheKey);
  if (cached) return cached;

  const [globalPerms, serverGrants, nodeGrants] = await Promise.all([
    resolveUserPermissions(userId),
    prisma.roleServerGrant.findMany({
      where: {
        serverId,
        role: { users: { some: { id: userId } } },
      },
      select: { permissions: true },
    }),
    prisma.roleNodeGrant.findMany({
      where: {
        role: { users: { some: { id: userId } } },
        OR: [{ nodeId: null }, ...(nodeId ? [{ nodeId }] : [])],
      },
      select: { permissions: true },
    }),
  ]);

  const result = mergeServerPermissions(
    globalPerms,
    serverGrants.map((g) => g.permissions),
    nodeGrants.map((g) => g.permissions),
  );
  scopedPermissionsCache.set(cacheKey, result);
  return result;
}

/**
 * Invalidate cached permissions for a specific user.
 * Broadcasts to sibling workers when clustered.
 */
export function invalidateUserPermissions(userId: string): void {
  permissionsCache.delete(userId);
  broadcastCacheInvalidate('permissions', { userId });
}

/**
 * Flush the entire permissions cache (global + server-scoped).
 * Broadcasts to sibling workers when clustered.
 */
export function flushPermissionsCache(): void {
  permissionsCache.clear();
  scopedPermissionsCache.clear();
  broadcastCacheInvalidate('permissions', { flushAll: true });
}

// Multi-worker IPC handlers (local-only apply; broadcast already done by sender)
onCacheInvalidate('permissions', (payload) => {
  if (payload.flushAll || !payload.userId) {
    permissionsCache.clear();
    scopedPermissionsCache.clear();
  } else {
    permissionsCache.delete(payload.userId);
    // Scoped entries are keyed `${userId}:${serverId}` — no prefix scan on
    // SimpleCache, so a user-targeted invalidation clears the scoped map too.
    scopedPermissionsCache.clear();
  }
});
