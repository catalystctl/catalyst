/**
 * Catalyst - Unified Authentication Middleware
 *
 * Composite middleware ensuring authentication + authorization.
 * Prevents authentication bypass by always checking both.
 * This replaces inconsistent usage of app.authenticate vs rbac.requirePermission.
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { createRbacMiddleware } from "./rbac";

/**
 * Composite middleware ensuring authentication + authorization
 * Prevents authentication bypass by always checking both
 *
 * @param prisma - Prisma client instance
 * @param permission - Required permission string
 * @param resourceIdParam - Optional request param name containing resource ID
 * @returns Array of Fastify middleware functions
 */
export const requireAuthAndPermission = (
  prisma: PrismaClient,
  permission: string,
  resourceIdParam?: string
) => {
  const rbac = createRbacMiddleware(prisma);

  return [
    // First verify identity
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        return reply.status(401).send({ error: "Unauthorized" });
      }
    },
    // Then check authorization
    rbac.requirePermission(permission, resourceIdParam)
  ];
};

/**
 * Require any of the specified permissions with authentication check
 *
 * @param prisma - Prisma client instance
 * @param permissions - Array of required permissions (OR logic)
 * @param resourceIdParam - Optional request param name containing resource ID
 * @returns Array of Fastify middleware functions
 */
export const requireAuthAndAnyPermission = (
  prisma: PrismaClient,
  permissions: string[],
  resourceIdParam?: string
) => {
  const rbac = createRbacMiddleware(prisma);

  return [
    // First verify identity
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        return reply.status(401).send({ error: "Unauthorized" });
      }
    },
    // Then check authorization
    rbac.requireAnyPermission(permissions, resourceIdParam)
  ];
};

/**
 * Require all of the specified permissions with authentication check
 *
 * @param prisma - Prisma client instance
 * @param permissions - Array of required permissions (AND logic)
 * @param resourceIdParam - Optional request param name containing resource ID
 * @returns Array of Fastify middleware functions
 */
export const requireAuthAndAllPermissions = (
  prisma: PrismaClient,
  permissions: string[],
  resourceIdParam?: string
) => {
  const rbac = createRbacMiddleware(prisma);

  return [
    // First verify identity
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        return reply.status(401).send({ error: "Unauthorized" });
      }
    },
    // Then check authorization
    rbac.requireAllPermissions(permissions, resourceIdParam)
  ];
};

/**
 * Require admin read access with authentication check
 *
 * @param prisma - Prisma client instance
 * @returns Array of Fastify middleware functions
 */
export const requireAuthAndAdminRead = (prisma: PrismaClient) => {
  return requireAuthAndAnyPermission(
    prisma,
    ["admin.read", "admin.write", "*"]
  );
};

/**
 * Require admin write access with authentication check
 *
 * @param prisma - Prisma client instance
 * @returns Array of Fastify middleware functions
 */
export const requireAuthAndAdminWrite = (prisma: PrismaClient) => {
  return requireAuthAndAnyPermission(
    prisma,
    ["admin.write", "*"]
  );
};
