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
} from "../lib/permissions";

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
      const userId = (request as any).user?.userId;
      if (!userId) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      // Get resource ID from params if specified
      const resourceId = resourceIdFromParam
        ? (request.params as Record<string, string>)?.[resourceIdFromParam]
        : undefined;

      const hasPerm = await hasPermission(prisma, userId, permission, resourceId);
      if (!hasPerm) {
        return reply.status(403).send({ error: "Forbidden" });
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
      const userId = (request as any).user?.userId;
      if (!userId) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      const resourceId = resourceIdFromParam
        ? (request.params as Record<string, string>)?.[resourceIdFromParam]
        : undefined;

      const hasPerm = await hasAnyPermission(prisma, userId, permissions, resourceId);
      if (!hasPerm) {
        return reply.status(403).send({ error: "Forbidden" });
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
      const userId = (request as any).user?.userId;
      if (!userId) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      const resourceId = resourceIdFromParam
        ? (request.params as Record<string, string>)?.[resourceIdFromParam]
        : undefined;

      const hasPerm = await hasAllPermissions(prisma, userId, permissions, resourceId);
      if (!hasPerm) {
        return reply.status(403).send({ error: "Forbidden" });
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

/**
 * Legacy RBAC middleware class for backward compatibility
 * @deprecated Use createRbacMiddleware() instead
 */
export class RbacMiddleware {
  constructor(private prisma: PrismaClient) {}

  async checkPermission(
    userId: string,
    serverId: string,
    requiredPermission: string
  ): Promise<boolean> {
    const access = await this.prisma.serverAccess.findUnique({
      where: {
        userId_serverId: { userId, serverId },
      },
    });

    if (!access) {
      return false;
    }

    return access.permissions.includes(requiredPermission as any);
  }

  async checkAnyPermission(
    userId: string,
    serverId: string,
    permissions: string[]
  ): Promise<boolean> {
    const access = await this.prisma.serverAccess.findUnique({
      where: {
        userId_serverId: { userId, serverId },
      },
    });

    if (!access) {
      return false;
    }

    return permissions.some((p) => access.permissions.includes(p as any));
  }

  async grantPermission(
    userId: string,
    serverId: string,
    permission: string
  ): Promise<void> {
    const access = await this.prisma.serverAccess.findUnique({
      where: {
        userId_serverId: { userId, serverId },
      },
    });

    if (!access) {
      await this.prisma.serverAccess.create({
        data: {
          userId,
          serverId,
          permissions: [permission as any],
        },
      });
    } else if (!access.permissions.includes(permission as any)) {
      await this.prisma.serverAccess.update({
        where: { id: access.id },
        data: {
          permissions: [...access.permissions, permission as any],
        },
      });
    }
  }

  async revokePermission(
    userId: string,
    serverId: string,
    permission: string
  ): Promise<void> {
    const access = await this.prisma.serverAccess.findUnique({
      where: {
        userId_serverId: { userId, serverId },
      },
    });

    if (access) {
      const updated = access.permissions.filter((p) => p !== permission);
      if (updated.length === 0) {
        await this.prisma.serverAccess.delete({ where: { id: access.id } });
      } else {
        await this.prisma.serverAccess.update({
          where: { id: access.id },
          data: { permissions: updated },
        });
      }
    }
  }
}

export function createAuthDecorator(rbac: RbacMiddleware) {
  return (permission: string) => {
    return async (request: any, reply: any) => {
      if (!request.user?.userId) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      const userId = request.user.userId;
      const serverId = request.params.serverId;

      if (serverId) {
        const hasPermission = await rbac.checkPermission(
          userId,
          serverId,
          permission
        );
        if (!hasPermission) {
          return reply.status(403).send({ error: "Forbidden" });
        }
      }
    };
  };
}
