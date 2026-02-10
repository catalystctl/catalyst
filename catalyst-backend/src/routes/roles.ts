/**
 * Catalyst - Role Management API Routes
 *
 * Endpoints for managing roles and their permissions.
 * All routes require appropriate permissions.
 */

import { prisma } from '../db.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createAuditLog } from '../middleware/audit';
import {
  hasPermission,
  getUserRoles,
  getUserPermissions,
  PERMISSION_PRESETS,
} from '../lib/permissions';
import { serialize } from '../utils/serialize';

export async function roleRoutes(app: FastifyInstance) {
  const authenticate = (app as any).authenticate;

  // Helper to check permissions
  const checkPermission = async (
    userId: string,
    permission: string,
    reply: FastifyReply
  ): Promise<boolean> => {
    const has = await hasPermission(prisma, userId, permission);
    if (!has) {
      reply.status(403).send({ error: 'Insufficient permissions' });
      return false;
    }
    return true;
  };

  // GET /api/roles - List all roles
  app.get(
    '/',
    { onRequest: [authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = (request as any).user.userId;

      if (!(await checkPermission(userId, 'role.read', reply))) return;

      const roles = await prisma.role.findMany({
        orderBy: { name: 'asc' },
        include: {
          _count: {
            select: { users: true },
          },
        },
      });

      reply.send({
        success: true,
        data: roles.map((role) => ({
          id: role.id,
          name: role.name,
          description: role.description,
          permissions: role.permissions,
          userCount: role._count.users,
          createdAt: role.createdAt,
          updatedAt: role.updatedAt,
        })),
      });
    }
  );

  // GET /api/roles/:roleId - Get role details
  app.get(
    '/:roleId',
    { onRequest: [authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = (request as any).user.userId;

      if (!(await checkPermission(userId, 'role.read', reply))) return;

      const { roleId } = request.params as { roleId: string };

      const role = await prisma.role.findUnique({
        where: { id: roleId },
        include: {
          _count: {
            select: { users: true },
          },
          users: {
            select: {
              id: true,
              email: true,
              username: true,
            },
            orderBy: { username: 'asc' },
          },
        },
      });

      if (!role) {
        return reply.status(404).send({ error: 'Role not found' });
      }

      reply.send(serialize({
        success: true,
        data: {
          id: role.id,
          name: role.name,
          description: role.description,
          permissions: role.permissions,
          userCount: role._count.users,
          users: role.users,
          createdAt: role.createdAt,
          updatedAt: role.updatedAt,
        },
      }));
    }
  );

  // POST /api/roles - Create role
  app.post(
    '/',
    { onRequest: [authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = (request as any).user.userId;

      if (!(await checkPermission(userId, 'role.create', reply))) return;

      const { name, description, permissions } = request.body as {
        name: string;
        description?: string;
        permissions: string[];
      };

      if (!name || name.trim().length === 0) {
        return reply.status(400).send({ error: 'Role name is required' });
      }

      if (!Array.isArray(permissions)) {
        return reply.status(400).send({ error: 'Permissions must be an array' });
      }

      // Check for duplicate name
      const existing = await prisma.role.findFirst({
        where: { name: { equals: name.trim(), mode: 'insensitive' } },
      });

      if (existing) {
        return reply.status(409).send({ error: 'Role with this name already exists' });
      }

      const role = await prisma.role.create({
        data: {
          name: name.trim(),
          description: description?.trim() || null,
          permissions,
        },
      });

      await createAuditLog(userId, {
        action: 'role.create',
        resource: 'role',
        resourceId: role.id,
        details: { name: role.name, permissions },
      });

      reply.status(201).send(serialize({
        success: true,
        data: role,
      }));
    }
  );

  // PUT /api/roles/:roleId - Update role
  app.put(
    '/:roleId',
    { onRequest: [authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = (request as any).user.userId;

      if (!(await checkPermission(userId, 'role.update', reply))) return;

      const { roleId } = request.params as { roleId: string };
      const { name, description, permissions } = request.body as {
        name?: string;
        description?: string;
        permissions?: string[];
      };

      const role = await prisma.role.findUnique({
        where: { id: roleId },
      });

      if (!role) {
        return reply.status(404).send({ error: 'Role not found' });
      }

      // Check for duplicate name
      if (name && name.trim() !== role.name) {
        const existing = await prisma.role.findFirst({
          where: {
            name: { equals: name.trim(), mode: 'insensitive' },
            id: { not: roleId },
          },
        });

        if (existing) {
          return reply.status(409).send({ error: 'Role with this name already exists' });
        }
      }

      const updateData: any = {};
      if (name !== undefined) updateData.name = name.trim();
      if (description !== undefined) updateData.description = description?.trim() || null;
      if (permissions !== undefined) {
        if (!Array.isArray(permissions)) {
          return reply.status(400).send({ error: 'Permissions must be an array' });
        }
        updateData.permissions = permissions;
      }

      const updated = await prisma.role.update({
        where: { id: roleId },
        data: updateData,
      });

      await createAuditLog(userId, {
        action: 'role.update',
        resource: 'role',
        resourceId: roleId,
        details: { changes: updateData },
      });

      reply.send(serialize({
        success: true,
        data: updated,
      }));
    }
  );

  // DELETE /api/roles/:roleId - Delete role
  app.delete(
    '/:roleId',
    { onRequest: [authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = (request as any).user.userId;

      if (!(await checkPermission(userId, 'role.delete', reply))) return;

      const { roleId } = request.params as { roleId: string };

      const role = await prisma.role.findUnique({
        where: { id: roleId },
        include: {
          _count: {
            select: { users: true },
          },
        },
      });

      if (!role) {
        return reply.status(404).send({ error: 'Role not found' });
      }

      if (role._count.users > 0) {
        return reply.status(409).send({
          error: 'Cannot delete role with assigned users',
          userCount: role._count.users,
        });
      }

      await prisma.role.delete({
        where: { id: roleId },
      });

      await createAuditLog(userId, {
        action: 'role.delete',
        resource: 'role',
        resourceId: roleId,
        details: { name: role.name },
      });

      reply.send({ success: true });
    }
  );

  // POST /api/roles/:roleId/permissions - Add permission to role
  app.post(
    '/:roleId/permissions',
    { onRequest: [authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = (request as any).user.userId;

      if (!(await checkPermission(userId, 'role.update', reply))) return;

      const { roleId } = request.params as { roleId: string };
      const { permission } = request.body as { permission: string };

      if (!permission || typeof permission !== 'string') {
        return reply.status(400).send({ error: 'Permission is required' });
      }

      const role = await prisma.role.findUnique({
        where: { id: roleId },
      });

      if (!role) {
        return reply.status(404).send({ error: 'Role not found' });
      }

      if (role.permissions.includes(permission)) {
        return reply.status(409).send({ error: 'Role already has this permission' });
      }

      const updated = await prisma.role.update({
        where: { id: roleId },
        data: {
          permissions: [...role.permissions, permission],
        },
      });

      await createAuditLog(userId, {
        action: 'role.permission.add',
        resource: 'role',
        resourceId: roleId,
        details: { permission },
      });

      reply.send(serialize({
        success: true,
        data: updated,
      }));
    }
  );

  // DELETE /api/roles/:roleId/permissions/:permission - Remove permission from role
  // We need to encode the permission in the URL path
  app.delete(
    '/:roleId/permissions/*',
    { onRequest: [authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = (request as any).user.userId;

      if (!(await checkPermission(userId, 'role.update', reply))) return;

      const { roleId } = request.params as { roleId: string };
      // Get the wildcard param which contains our permission
      const permission = (request.params as any)['*'];

      if (!permission) {
        return reply.status(400).send({ error: 'Permission is required' });
      }

      const role = await prisma.role.findUnique({
        where: { id: roleId },
      });

      if (!role) {
        return reply.status(404).send({ error: 'Role not found' });
      }

      if (!role.permissions.includes(permission)) {
        return reply.status(404).send({ error: 'Role does not have this permission' });
      }

      const updated = await prisma.role.update({
        where: { id: roleId },
        data: {
          permissions: role.permissions.filter((p) => p !== permission),
        },
      });

      await createAuditLog(userId, {
        action: 'role.permission.remove',
        resource: 'role',
        resourceId: roleId,
        details: { permission },
      });

      reply.send(serialize({
        success: true,
        data: updated,
      }));
    }
  );

  // POST /api/roles/:roleId/users/:userId - Assign role to user
  app.post(
    '/:roleId/users/:userId',
    { onRequest: [authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const currentUserId = (request as any).user.userId;

      if (!(await checkPermission(currentUserId, 'user.set_roles', reply))) return;

      const { roleId, userId } = request.params as { roleId: string; userId: string };

      const [role, user] = await Promise.all([
        prisma.role.findUnique({ where: { id: roleId } }),
        prisma.user.findUnique({ where: { id: userId } }),
      ]);

      if (!role) {
        return reply.status(404).send({ error: 'Role not found' });
      }

      if (!user) {
        return reply.status(404).send({ error: 'User not found' });
      }

      // Check if user already has this role
      const existingRole = await prisma.user.findFirst({
        where: {
          id: userId,
          roles: { some: { id: roleId } },
        },
      });

      if (existingRole) {
        return reply.status(409).send({ error: 'User already has this role' });
      }

      await prisma.user.update({
        where: { id: userId },
        data: {
          roles: { connect: { id: roleId } },
        },
      });

      await createAuditLog(currentUserId, {
        action: 'user.role.assign',
        resource: 'user',
        resourceId: userId,
        details: { roleId, roleName: role.name },
      });

      reply.send({ success: true });
    }
  );

  // DELETE /api/roles/:roleId/users/:userId - Remove role from user
  app.delete(
    '/:roleId/users/:userId',
    { onRequest: [authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const currentUserId = (request as any).user.userId;

      if (!(await checkPermission(currentUserId, 'user.set_roles', reply))) return;

      const { roleId, userId } = request.params as { roleId: string; userId: string };

      const role = await prisma.role.findUnique({ where: { id: roleId } });

      if (!role) {
        return reply.status(404).send({ error: 'Role not found' });
      }

      // Check if user has this role
      const userWithRole = await prisma.user.findFirst({
        where: {
          id: userId,
          roles: { some: { id: roleId } },
        },
      });

      if (!userWithRole) {
        return reply.status(404).send({ error: 'User does not have this role' });
      }

      await prisma.user.update({
        where: { id: userId },
        data: {
          roles: { disconnect: { id: roleId } },
        },
      });

      await createAuditLog(currentUserId, {
        action: 'user.role.remove',
        resource: 'user',
        resourceId: userId,
        details: { roleId, roleName: role.name },
      });

      reply.send({ success: true });
    }
  );

  // GET /api/users/:userId/roles - Get user roles
  app.get(
    '/users/:userId/roles',
    { onRequest: [authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const currentUserId = (request as any).user.userId;

      if (!(await checkPermission(currentUserId, 'user.read', reply))) return;

      const { userId } = request.params as { userId: string };

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          username: true,
          roles: {
            select: {
              id: true,
              name: true,
              description: true,
              permissions: true,
            },
          },
        },
      });

      if (!user) {
        return reply.status(404).send({ error: 'User not found' });
      }

      // Also return aggregated permissions from all roles
      const permissions = await getUserPermissions(prisma, userId);

      reply.send(serialize({
        success: true,
        data: {
          user: {
            id: user.id,
            email: user.email,
            username: user.username,
          },
          roles: user.roles,
          permissions: Array.from(permissions),
        },
      }));
    }
  );

  // GET /api/roles/presets - Get available role presets
  app.get(
    '/presets',
    { onRequest: [authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = (request as any).user.userId;

      if (!(await checkPermission(userId, 'role.read', reply))) return;

      reply.send({
        success: true,
        data: Object.entries(PERMISSION_PRESETS).map(([key, preset]) => ({
          key,
          ...preset,
        })),
      });
    }
  );
}
