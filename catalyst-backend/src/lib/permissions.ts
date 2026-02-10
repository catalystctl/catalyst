/**
 * Catalyst - RBAC Permission Utilities
 *
 * Provides permission checking with scoped permission support.
 *
 * Scope format: "permission:resourceId"
 * - "*" = wildcard, grants all permissions
 * - "node.delete" = grants delete access to ALL nodes
 * - "node.delete:node_abc123" = grants delete access ONLY to node_abc123
 *
 * Checking "node.delete" for "node_xyz789":
 * 1. Check for "node.delete:*" (wildcard resource)
 * 2. Check for "node.delete:node_xyz789" (specific resource)
 * 3. Check for "node.delete" (all resources)
 */

import type { PrismaClient } from "@prisma/client";
import type { Permission } from "../shared-types";

/**
 * Parse a permission string with optional scope
 * @param perm - Permission string like "node.delete" or "node.delete:node_abc123"
 * @returns Parsed permission and optional resource ID
 */
export function parseScopedPermission(
  perm: string
): { permission: string; resourceId?: string } {
  const colonIndex = perm.indexOf(":");
  if (colonIndex === -1) {
    return { permission: perm };
  }
  return {
    permission: perm.slice(0, colonIndex),
    resourceId: perm.slice(colonIndex + 1) || undefined,
  };
}

/**
 * Build a scoped permission string
 * @param permission - Base permission
 * @param resourceId - Optional resource ID for scoping
 * @returns Scoped permission string
 */
export function buildScopedPermission(
  permission: string,
  resourceId?: string
): string {
  if (!resourceId) return permission;
  return `${permission}:${resourceId}`;
}

/**
 * Check if a permission string matches a required permission
 * Handles wildcards and scoping
 *
 * @param userPermission - Permission from user's roles (e.g., "node.delete:node_abc123")
 * @param requiredPermission - Required permission (e.g., "node.delete")
 * @param resourceId - Optional specific resource to check
 * @returns True if permission matches
 */
export function permissionMatches(
  userPermission: string,
  requiredPermission: string,
  resourceId?: string
): boolean {
  const { permission: userPerm, resourceId: userResourceId } =
    parseScopedPermission(userPermission);

  // Wildcard grants all permissions
  if (userPerm === "*") return true;

  // Exact permission match
  if (userPerm === requiredPermission) {
    // If we have a scoped user permission, check if it applies to the resource
    if (userResourceId) {
      // User permission is scoped to a specific resource
      // It only matches if:
      // 1. We're checking for that specific resource
      // 2. The user has wildcard resource access
      if (userResourceId === "*") {
        return true;
      }
      // If checking without resourceId, a scoped permission does NOT grant access
      if (resourceId === undefined) {
        return false;
      }
      return userResourceId === resourceId;
    }
    // User permission applies to all resources (no scoping)
    return true;
  }

  // If user permission is scoped with wildcard resource
  if (userResourceId === "*" && userPerm === requiredPermission) {
    return true;
  }

  return false;
}

/**
 * Check if a user has a specific permission
 *
 * @param prisma - Prisma client
 * @param userId - User ID to check
 * @param requiredPermission - Required permission string
 * @param resourceId - Optional resource ID for scoped permission check
 * @returns True if user has the permission
 */
export async function hasPermission(
  prisma: PrismaClient,
  userId: string,
  requiredPermission: string,
  resourceId?: string
): Promise<boolean> {
  // Get user's roles and their permissions
  const userRoles = await prisma.role.findMany({
    where: {
      users: {
        some: { id: userId },
      },
    },
    select: {
      permissions: true,
    },
  });

  // Aggregate all permissions from all roles
  const allPermissions = new Set<string>();
  for (const role of userRoles) {
    for (const perm of role.permissions) {
      allPermissions.add(perm);
    }
  }

  // Check if any permission matches the required permission
  for (const userPerm of allPermissions) {
    if (permissionMatches(userPerm, requiredPermission, resourceId)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a user has any of the specified permissions (OR logic)
 *
 * @param prisma - Prisma client
 * @param userId - User ID to check
 * @param requiredPermissions - Array of required permissions
 * @param resourceId - Optional resource ID for scoped permission check
 * @returns True if user has any of the permissions
 */
export async function hasAnyPermission(
  prisma: PrismaClient,
  userId: string,
  requiredPermissions: string[],
  resourceId?: string
): Promise<boolean> {
  for (const perm of requiredPermissions) {
    if (await hasPermission(prisma, userId, perm, resourceId)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a user has all of the specified permissions (AND logic)
 *
 * @param prisma - Prisma client
 * @param userId - User ID to check
 * @param requiredPermissions - Array of required permissions
 * @param resourceId - Optional resource ID for scoped permission check
 * @returns True if user has all of the permissions
 */
export async function hasAllPermissions(
  prisma: PrismaClient,
  userId: string,
  requiredPermissions: string[],
  resourceId?: string
): Promise<boolean> {
  for (const perm of requiredPermissions) {
    if (!(await hasPermission(prisma, userId, perm, resourceId))) {
      return false;
    }
  }
  return true;
}

/**
 * Get all permissions for a user (including role permissions)
 *
 * @param prisma - Prisma client
 * @param userId - User ID
 * @returns Set of all permission strings
 */
export async function getUserPermissions(
  prisma: PrismaClient,
  userId: string
): Promise<Set<string>> {
  const userRoles = await prisma.role.findMany({
    where: {
      users: {
        some: { id: userId },
      },
    },
    select: {
      permissions: true,
    },
  });

  const allPermissions = new Set<string>();
  for (const role of userRoles) {
    for (const perm of role.permissions) {
      allPermissions.add(perm);
    }
  }

  return allPermissions;
}

/**
 * Get all roles for a user with their permissions
 *
 * @param prisma - Prisma client
 * @param userId - User ID
 * @returns Array of roles with permissions
 */
export async function getUserRoles(
  prisma: PrismaClient,
  userId: string
): Promise<Array<{ id: string; name: string; description: string | null; permissions: string[] }>> {
  return prisma.role.findMany({
    where: {
      users: {
        some: { id: userId },
      },
    },
    select: {
      id: true,
      name: true,
      description: true,
      permissions: true,
    },
  });
}

/**
 * Check if a user is an administrator
 * An admin has either:
 * - The "*" wildcard permission
 * - The "admin.write" permission
 * - A role named "Administrator" (case-insensitive)
 *
 * @param prisma - Prisma client
 * @param userId - User ID
 * @param requireWrite - Whether to require admin.write (vs admin.read)
 * @returns True if user is an admin
 */
export async function isAdminUser(
  prisma: PrismaClient,
  userId: string,
  requireWrite: boolean = false
): Promise<boolean> {
  const userRoles = await prisma.role.findMany({
    where: {
      users: {
        some: { id: userId },
      },
    },
  });

  // Check for wildcard or admin permissions
  for (const role of userRoles) {
    const permissions = role.permissions;

    // Wildcard grants admin access
    if (permissions.includes("*")) return true;

    // admin.write grants all admin access
    if (permissions.includes("admin.write")) return true;

    // admin.read grants read-only admin access
    if (!requireWrite && permissions.includes("admin.read")) return true;
  }

  // Check for Administrator role name (legacy support)
  const hasAdminRole = userRoles.some(
    (role) => role.name.toLowerCase() === "administrator"
  );

  return hasAdminRole;
}

/**
 * Filter permissions based on resource ownership
 * For permissions scoped to specific resources, check if user owns the resource
 *
 * @param prisma - Prisma client
 * @param userId - User ID
 * @param requiredPermission - Permission to check
 * @param resourceOwnerId - Owner of the resource
 * @param ownsAllResource - If user can manage all resources of this type
 * @returns True if user has permission for this resource
 */
export async function hasResourcePermission(
  prisma: PrismaClient,
  userId: string,
  requiredPermission: string,
  resourceOwnerId?: string,
  ownsAllResource?: boolean
): Promise<boolean> {
  // If user owns all resources of this type, check for global permission
  if (ownsAllResource) {
    return hasPermission(prisma, userId, requiredPermission);
  }

  // Check if user is the resource owner
  if (resourceOwnerId && resourceOwnerId === userId) {
    return true; // Owner can access their own resources
  }

  // Check for scoped permission to this specific resource
  return hasPermission(prisma, userId, requiredPermission);
}

/**
 * Permission categories for UI organization
 */
export const PERMISSION_CATEGORIES = {
  server: {
    label: "Server",
    permissions: [
      "server.read",
      "server.create",
      "server.start",
      "server.stop",
      "server.delete",
      "server.suspend",
      "server.transfer",
      "server.schedule",
    ],
  },
  node: {
    label: "Node",
    permissions: [
      "node.read",
      "node.create",
      "node.update",
      "node.delete",
      "node.view_stats",
      "node.manage_allocation",
    ],
  },
  location: {
    label: "Location",
    permissions: [
      "location.read",
      "location.create",
      "location.update",
      "location.delete",
    ],
  },
  template: {
    label: "Template",
    permissions: [
      "template.read",
      "template.create",
      "template.update",
      "template.delete",
    ],
  },
  user: {
    label: "User Management",
    permissions: [
      "user.read",
      "user.create",
      "user.update",
      "user.delete",
      "user.ban",
      "user.unban",
      "user.set_roles",
    ],
  },
  role: {
    label: "Role Management",
    permissions: [
      "role.read",
      "role.create",
      "role.update",
      "role.delete",
    ],
  },
  backup: {
    label: "Backup",
    permissions: [
      "backup.read",
      "backup.create",
      "backup.delete",
      "backup.restore",
    ],
  },
  files: {
    label: "File Management",
    permissions: [
      "file.read",
      "file.write",
    ],
  },
  console: {
    label: "Console",
    permissions: [
      "console.read",
      "console.write",
    ],
  },
  database: {
    label: "Database",
    permissions: [
      "database.create",
      "database.read",
      "database.delete",
      "database.rotate",
    ],
  },
  alerts: {
    label: "Alerts",
    permissions: [
      "alert.read",
      "alert.create",
      "alert.update",
      "alert.delete",
    ],
  },
  admin: {
    label: "System Administration",
    permissions: [
      "admin.read",
      "admin.write",
      "apikey.manage",
    ],
  },
} as const;

/**
 * Permission presets for quick role setup
 */
export const PERMISSION_PRESETS = {
  administrator: {
    label: "Administrator",
    description: "Full system access",
    permissions: ["*"],
  },
  moderator: {
    label: "Moderator",
    description: "Can manage most resources but not users/roles",
    permissions: [
      "node.read",
      "node.update",
      "node.view_stats",
      "location.read",
      "template.read",
      "user.read",
      "server.read",
      "server.start",
      "server.stop",
      "file.read",
      "file.write",
      "console.read",
      "console.write",
      "alert.read",
      "alert.create",
      "alert.update",
      "alert.delete",
    ],
  },
  user: {
    label: "User",
    description: "Basic access to own servers",
    permissions: [
      "server.read",
    ],
  },
  support: {
    label: "Support",
    description: "Read-only access for support staff",
    permissions: [
      "node.read",
      "node.view_stats",
      "location.read",
      "template.read",
      "server.read",
      "file.read",
      "console.read",
      "alert.read",
      "user.read",
    ],
  },
} as const;
