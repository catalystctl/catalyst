/**
 * Catalyst - RBAC Middleware
 *
 * Middleware functions for protecting routes with RBAC permissions.
 * Supports scoped permissions and resource-based access control.
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import type { PrismaClient } from "@prisma/client";
import {
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  isAdminUser,
  permissionMatches,
} from "../lib/permissions";
import { apiError } from "../lib/http-error";
import { ErrorCodes } from "../shared-types";

function requestPermissions(request: FastifyRequest): string[] | null {
  const perms = (request as unknown as { user?: { permissions?: unknown } }).user?.permissions;
  return Array.isArray(perms) ? (perms as string[]) : null;
}

function matchesAny(perms: string[], required: string, resourceId?: string): boolean {
  for (const p of perms) {
    if (permissionMatches(p, required, resourceId)) return true;
  }
  return false;
}

/**
 * Create a middleware factory that closes over prisma instance
 */
export function createRbacMiddleware(prisma: PrismaClient) {
  /**
   * Require a specific permission
   * @param permission - Required permission string
   * @param resourceIdFromParam - Optional request param name containing resource ID
   * @returns Fastify middleware function
   */
  function requirePermission(
    permission: string,
    resourceIdFromParam?: string
  ) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        return apiError(reply, 401, ErrorCodes.AUTH_INVALID_TOKEN, "Unauthorized");
      }

      // Get resource ID from params if specified
      const resourceId = resourceIdFromParam
        ? (request.params as Record<string, string>)?.[resourceIdFromParam]
        : undefined;

      const cached = requestPermissions(request);
      const hasPerm =
        cached !== null
          ? matchesAny(cached, permission, resourceId)
          : await hasPermission(prisma, userId, permission, resourceId);
      if (!hasPerm) {
        return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "Forbidden");
      }

      return; // Permission granted
    };
  }

  /**
   * Require any of the specified permissions (OR logic)
   * @param permissions - Array of required permissions
   * @param resourceIdFromParam - Optional request param name containing resource ID
   * @returns Fastify middleware function
   */
  function requireAnyPermission(
    permissions: string[],
    resourceIdFromParam?: string
  ) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        return apiError(reply, 401, ErrorCodes.AUTH_INVALID_TOKEN, "Unauthorized");
      }

      const resourceId = resourceIdFromParam
        ? (request.params as Record<string, string>)?.[resourceIdFromParam]
        : undefined;

      const cachedAny = requestPermissions(request);
      const hasPerm =
        cachedAny !== null
          ? permissions.some((p) => matchesAny(cachedAny, p, resourceId))
          : await hasAnyPermission(prisma, userId, permissions, resourceId);
      if (!hasPerm) {
        return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "Forbidden");
      }

      return; // Permission granted
    };
  }

  /**
   * Require all of the specified permissions (AND logic)
   * @param permissions - Array of required permissions
   * @param resourceIdFromParam - Optional request param name containing resource ID
   * @returns Fastify middleware function
   */
  function requireAllPermissions(
    permissions: string[],
    resourceIdFromParam?: string
  ) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        return apiError(reply, 401, ErrorCodes.AUTH_INVALID_TOKEN, "Unauthorized");
      }

      const resourceId = resourceIdFromParam
        ? (request.params as Record<string, string>)?.[resourceIdFromParam]
        : undefined;

      const cachedAll = requestPermissions(request);
      const hasPerm =
        cachedAll !== null
          ? permissions.every((p) => matchesAny(cachedAll, p, resourceId))
          : await hasAllPermissions(prisma, userId, permissions, resourceId);
      if (!hasPerm) {
        return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "Forbidden");
      }

      return; // Permission granted
    };
  }

  /**
   * Require admin read access
   */
  function requireAdminRead() {
    return requireAnyPermission(["admin.read", "admin.write", "*"]);
  }

  /**
   * Require admin write access
   */
  function requireAdminWrite() {
    return requireAnyPermission(["admin.write", "*"]);
  }

  /**
   * Require role management access
   */
  function requireRoleManagement() {
    return requireAnyPermission(["role.create", "role.update", "role.delete", "admin.write", "*"]);
  }

  /**
   * Require user management access
   */
  function requireUserManagement() {
    return requireAnyPermission(["user.create", "user.update", "user.delete", "user.set_roles", "admin.write", "*"]);
  }

  /**
   * Check if user is admin (for legacy compatibility)
   * @deprecated Use requirePermission with specific permissions instead
   */
  async function isAdmin(
    userId: string,
    required: "admin.read" | "admin.write" = "admin.read"
  ): Promise<boolean> {
    return isAdminUser(prisma, userId, required === "admin.write");
  }

  return {
    requirePermission,
    requireAnyPermission,
    requireAllPermissions,
    requireAdminRead,
    requireAdminWrite,
    requireRoleManagement,
    requireUserManagement,
    isAdmin,
  };
}


