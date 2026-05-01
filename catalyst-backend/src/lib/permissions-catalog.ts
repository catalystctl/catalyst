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

// 30-second TTL cache for resolved user permissions
const permissionsCache = new SimpleCache<string, string[]>(30_000);

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
 * Invalidate cached permissions for a specific user.
 */
export function invalidateUserPermissions(userId: string): void {
  permissionsCache.delete(userId);
}

/**
 * Flush the entire permissions cache.
 */
export function flushPermissionsCache(): void {
  permissionsCache.clear();
}
