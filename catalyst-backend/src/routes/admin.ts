import { prisma } from '../db.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { fromNodeHeaders } from 'better-auth/node';
import { ServerState } from '../shared-types';
import { ServerStateMachine } from '../services/state-machine';
import { normalizeHostIp, releaseIpForServer, summarizePool } from '../utils/ipam';
import { createAuditLog } from '../middleware/audit';
import { hasPermission, hasAnyPermission } from '../lib/permissions';
import {
  DEFAULT_SECURITY_SETTINGS,
  getModManagerSettings,
  getSecuritySettings,
  getSmtpSettings,
  upsertModManagerSettings,
  upsertSecuritySettings,
  upsertSmtpSettings,
} from '../services/mailer';
import { serialize } from '../utils/serialize';

export async function adminRoutes(app: FastifyInstance) {
  // Using shared prisma instance from db.ts
  const authenticate = (app as any).authenticate;
  const auth = (app as any).auth;

  const isSuspensionEnforced = () => process.env.SUSPENSION_ENFORCED !== "false";
  const isSuspensionDeleteBlocked = () => process.env.SUSPENSION_DELETE_BLOCKED !== "false";

  // Helper to check if user has admin permissions
  const isAdminUser = async (userId: string, required: 'admin.read' | 'admin.write' = 'admin.read') => {
    return hasPermission(prisma, userId, required);
  };

  // Helper to check user management permissions
  const canManageUsers = async (userId: string, action: 'read' | 'create' | 'update' | 'delete' | 'ban' | 'set_roles' = 'read') => {
    const permission = `user.${action}` as string;
    return hasPermission(prisma, userId, permission);
  };

  const parseStoredPortBindings = (value: unknown): Record<number, number> => {
    if (!value || typeof value !== 'object') {
      return {};
    }
    const bindings: Record<number, number> = {};
    for (const [containerKey, hostValue] of Object.entries(value as Record<string, unknown>)) {
      const containerPort = typeof containerKey === 'string' ? Number(containerKey) : Number.NaN;
      const hostPort = typeof hostValue === 'string' ? Number(hostValue) : Number(hostValue);
      if (!Number.isInteger(containerPort) || !Number.isInteger(hostPort)) {
        continue;
      }
      bindings[containerPort] = hostPort;
    }
    return bindings;
  };

  const resolveTemplateImage = (
    template: { image: string; images?: any; defaultImage?: string | null },
    environment: Record<string, string>
  ) => {
    const options = Array.isArray(template.images) ? template.images : [];
    if (!options.length) return template.image;
    const requested = environment.IMAGE_VARIANT;
    if (requested) {
      const match = options.find((option) => option?.name === requested);
      if (match?.image) {
        return match.image;
      }
    }
    if (template.defaultImage) {
      const defaultMatch = options.find((option) => option?.image === template.defaultImage);
      if (defaultMatch?.image) {
        return defaultMatch.image;
      }
      return template.defaultImage;
    }
    return template.image;
  };

  // Get system-wide stats (requires any admin permission)
  app.get(
    '/stats',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;

      // Check if user has any admin permission
      const hasAny = await hasAnyPermission(prisma, user.userId, [
        'admin.read', 'user.read', 'role.read', 'node.read', 'location.read',
        'template.read', 'server.read', 'apikey.manage'
      ]);
      if (!hasAny) {
        return reply.status(403).send({ error: 'Admin read permission required' });
      }

      // Get system statistics
      const [userCount, serverCount, nodeCount, activeServers] = await Promise.all([
        prisma.user.count(),
        prisma.server.count(),
        prisma.node.count(),
        prisma.server.count({ where: { status: 'running' } }),
      ]);

      reply.send({
        users: userCount,
        servers: serverCount,
        nodes: nodeCount,
        activeServers,
      });
    }
  );

  // Get all users (requires user.read)
  app.get(
    '/users',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;

      if (!(await canManageUsers(user.userId, 'read'))) {
        return reply.status(403).send({ error: 'User read permission required' });
      }

      const { page = 1, limit = 20, search } = request.query as {
        page?: number;
        limit?: number;
        search?: string;
      };

      const searchQuery = typeof search === 'string' ? search.trim() : '';
      const where = searchQuery
        ? {
            OR: [
              { email: { contains: searchQuery, mode: 'insensitive' as const } },
              { username: { contains: searchQuery, mode: 'insensitive' as const } },
            ],
          }
        : undefined;

      const skip = (Number(page) - 1) * Number(limit);

      const [users, total] = await Promise.all([
        prisma.user.findMany({
          skip,
          take: Number(limit),
          where,
          select: {
            id: true,
            email: true,
            username: true,
            createdAt: true,
            updatedAt: true,
            roles: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        }),
        prisma.user.count({ where }),
      ]);

      reply.send({
        users,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / Number(limit)),
        },
      });
    }
  );

  // Create user (requires user.create)
  app.post(
    '/users',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;

      if (!(await canManageUsers(user.userId, 'create'))) {
        return reply.status(403).send({ error: 'User create permission required' });
      }

      const { email, username, password, roleIds, serverIds, serverPermissions } = request.body as {
        email: string;
        username: string;
        password: string;
        roleIds?: string[];
        serverIds?: string[];
        serverPermissions?: string[];
      };

      if (!email || !username || !password) {
        return reply.status(400).send({ error: 'email, username, and password are required' });
      }

      if (password.length < 8) {
        return reply.status(400).send({ error: 'Password must be at least 8 characters' });
      }

      const existing = await prisma.user.findFirst({
        where: { OR: [{ email }, { username }] },
      });

      if (existing) {
        return reply.status(409).send({ error: 'Email or username already in use' });
      }

      const rolesToAssign = roleIds?.length
        ? await prisma.role.findMany({ where: { id: { in: roleIds } } })
        : [];

      if (roleIds?.length && rolesToAssign.length !== roleIds.length) {
        return reply.status(400).send({ error: 'One or more roles are invalid' });
      }

      let serverAccessIds: string[] = [];
      let defaultPermissions: string[] | undefined;
      if (serverIds?.length) {
        const uniqueServerIds = Array.from(new Set(serverIds));
        const existingServers = await prisma.server.findMany({
          where: { id: { in: uniqueServerIds } },
          select: { id: true },
        });

        if (existingServers.length !== uniqueServerIds.length) {
          return reply.status(400).send({ error: 'One or more servers are invalid' });
        }

        serverAccessIds = uniqueServerIds;
        defaultPermissions =
          serverPermissions && serverPermissions.length > 0
            ? serverPermissions
            : [
                'server.start',
                'server.stop',
                'server.read',
                'alert.read',
                'alert.create',
                'alert.update',
                'alert.delete',
                'file.read',
                'file.write',
                'console.read',
                'console.write',
                'server.delete',
              ];
      }

      const signUpResponse = await auth.api.signUpEmail({
        headers: fromNodeHeaders(request.headers as Record<string, string | string[] | undefined>),
        body: {
          email,
          password,
          name: username,
          username,
        } as any,
        returnHeaders: true,
      });

      const signUpData =
        'headers' in signUpResponse && signUpResponse.response
          ? signUpResponse.response
          : (signUpResponse as any);
      const created = signUpData?.user;
      if (!created) {
        return reply.status(400).send({ error: 'User creation failed' });
      }

      const emailWarning: string | null = null;

      const createdUser = await prisma.user.update({
        where: { id: created.id },
        data: {
          roles: rolesToAssign.length
            ? { connect: rolesToAssign.map((role) => ({ id: role.id })) }
            : undefined,
          servers: serverAccessIds.length
            ? {
                create: serverAccessIds.map((serverIdEntry) => ({
                  serverId: serverIdEntry,
                  permissions: defaultPermissions ?? [],
                })),
              }
            : undefined,
        },
        select: {
          id: true,
          email: true,
          username: true,
          createdAt: true,
          updatedAt: true,
          roles: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      await createAuditLog(user.userId, {
        action: 'user_create',
        resource: 'user',
        resourceId: created.id,
        details: {
          email: createdUser.email,
          username: createdUser.username,
          roleIds: createdUser.roles.map((role) => role.id),
          serverIds: serverIds ?? undefined,
        },
      });

      return reply.status(201).send({ ...createdUser, warning: emailWarning });
    }
  );

  // Update user (requires user.update and user.set_roles for role changes)
  app.put(
    '/users/:userId',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;

      const { userId } = request.params as { userId: string };
      const {
        email,
        username,
        password,
        roleIds,
        serverIds,
        serverPermissions,
      } = request.body as {
        email?: string;
        username?: string;
        password?: string;
        roleIds?: string[];
        serverIds?: string[];
        serverPermissions?: string[];
      };

      // Check if updating roles
      if (roleIds) {
        if (!(await canManageUsers(user.userId, 'set_roles'))) {
          return reply.status(403).send({ error: 'User set_roles permission required' });
        }
      } else {
        if (!(await canManageUsers(user.userId, 'update'))) {
          return reply.status(403).send({ error: 'User update permission required' });
        }
      }

      const existingUser = await prisma.user.findUnique({
        where: { id: userId },
        include: { roles: { select: { id: true } } },
      });

      if (!existingUser) {
        return reply.status(404).send({ error: 'User not found' });
      }

      if (password && password.length < 8) {
        return reply.status(400).send({ error: 'Password must be at least 8 characters' });
      }

      const rolesToAssign = roleIds?.length
        ? await prisma.role.findMany({ where: { id: { in: roleIds } } })
        : [];

      if (roleIds?.length && rolesToAssign.length !== roleIds.length) {
        return reply.status(400).send({ error: 'One or more roles are invalid' });
      }

      if (email || username) {
        const duplicate = await prisma.user.findFirst({
          where: {
            id: { not: userId },
            OR: [email ? { email } : undefined, username ? { username } : undefined].filter(
              Boolean,
            ) as Array<{ email?: string; username?: string }>,
          },
        });
        if (duplicate) {
          return reply.status(409).send({ error: 'Email or username already in use' });
        }
      }

      if (password) {
        await auth.api.setUserPassword({
          headers: fromNodeHeaders(request.headers as Record<string, string | string[] | undefined>),
          body: { newPassword: password, userId },
        });
      }

      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: {
          email: email ?? undefined,
          username: username ?? undefined,
          roles: roleIds
            ? {
                set: rolesToAssign.map((role) => ({ id: role.id })),
              }
            : undefined,
        },
        select: {
          id: true,
          email: true,
          username: true,
          createdAt: true,
          updatedAt: true,
          roles: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      if (serverIds) {
        const uniqueServerIds = Array.from(new Set(serverIds));
        const existingServers = await prisma.server.findMany({
          where: { id: { in: uniqueServerIds } },
          select: { id: true },
        });

        if (existingServers.length !== uniqueServerIds.length) {
          return reply.status(400).send({ error: 'One or more servers are invalid' });
        }

        const defaultPermissions =
          serverPermissions && serverPermissions.length > 0
            ? serverPermissions
            : [
                'server.start',
                'server.stop',
                'server.read',
                'alert.read',
                'alert.create',
                'alert.update',
                'alert.delete',
                'file.read',
                'file.write',
                'console.read',
                'console.write',
                'server.delete',
              ];

        await prisma.serverAccess.deleteMany({
          where: { userId, serverId: { notIn: uniqueServerIds } },
        });
        const existingAccess = await prisma.serverAccess.findMany({
          where: { userId, serverId: { in: uniqueServerIds } },
          select: { serverId: true, permissions: true },
        });
        await prisma.serverAccess.createMany({
          data: uniqueServerIds.map((serverIdEntry) => ({
            userId,
            serverId: serverIdEntry,
            permissions: defaultPermissions,
          })),
          skipDuplicates: true,
        });
        await Promise.all(
          existingAccess
            .filter((entry) => entry.permissions.join(',') !== defaultPermissions.join(','))
            .map((entry) =>
              prisma.serverAccess.update({
                where: { userId_serverId: { userId, serverId: entry.serverId } },
                data: { permissions: defaultPermissions },
              }),
            ),
        );
      }

      await createAuditLog(user.userId, {
        action: 'user_update',
        resource: 'user',
        resourceId: userId,
        details: {
          email: updatedUser.email,
          username: updatedUser.username,
          roleIds: updatedUser.roles.map((role) => role.id),
          serverIds: serverIds ?? undefined,
        },
      });

      return reply.send(updatedUser);
    }
  );

  // Get user server access (requires user.read)
  app.get(
    '/users/:userId/servers',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;

      if (!(await canManageUsers(user.userId, 'read'))) {
        return reply.status(403).send({ error: 'User read permission required' });
      }

      const { userId } = request.params as { userId: string };
      const existingUser = await prisma.user.findUnique({ where: { id: userId } });
      if (!existingUser) {
        return reply.status(404).send({ error: 'User not found' });
      }

      const accessEntries = await prisma.serverAccess.findMany({
        where: { userId },
        select: { serverId: true },
      });

      return reply.send({ serverIds: accessEntries.map((entry) => entry.serverId) });
    }
  );

  // List roles (requires role.read)
  app.get(
    '/roles',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;

      if (!(await hasPermission(prisma, user.userId, 'role.read'))) {
        return reply.status(403).send({ error: 'Role read permission required' });
      }

      const roles = await prisma.role.findMany({
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          description: true,
          permissions: true,
        },
      });

      return reply.send({ roles });
    }
  );

  // Delete user (requires user.delete)
  app.delete(
    '/users/:userId',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;

      if (!(await canManageUsers(user.userId, 'delete'))) {
        return reply.status(403).send({ error: 'User delete permission required' });
      }

      const { userId } = request.params as { userId: string };

      if (userId === user.userId) {
        return reply.status(400).send({ error: 'Cannot delete the current user' });
      }

      const existingUser = await prisma.user.findUnique({ where: { id: userId } });
      if (!existingUser) {
        return reply.status(404).send({ error: 'User not found' });
      }

      await prisma.user.delete({ where: { id: userId } });

      await createAuditLog(user.userId, {
        action: 'user_delete',
        resource: 'user',
        resourceId: userId,
        details: {
          email: existingUser.email,
          username: existingUser.username,
        },
      });

      return reply.send({ success: true });
    }
  );

  // Get all nodes with details (requires node.read)
  app.get(
    '/nodes',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;

      if (!(await hasPermission(prisma, user.userId, 'node.read'))) {
        return reply.status(403).send({ error: 'Node read permission required' });
      }

      const { search } = request.query as {
        search?: string;
      };

      const searchQuery = typeof search === 'string' ? search.trim() : '';
      const where = searchQuery
        ? {
            OR: [
              { name: { contains: searchQuery, mode: 'insensitive' as const } },
              { hostname: { contains: searchQuery, mode: 'insensitive' as const } },
            ],
          }
        : undefined;

      const nodes = await prisma.node.findMany({
        where,
        include: {
          location: true,
          servers: {
            select: {
              id: true,
              name: true,
              status: true,
            },
          },
          _count: {
            select: {
              servers: true,
            },
          },
        },
      });

      // Explicitly serialize to avoid Fastify v5 + Prisma v7 serialization issues
      return reply.send(JSON.parse(JSON.stringify({ nodes })));
    }
  );

  // Get all servers across nodes (requires server.read)
  app.get(
    '/servers',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;

      if (!(await hasPermission(prisma, user.userId, 'server.read'))) {
        return reply.status(403).send({ error: 'Server read permission required' });
      }

      const { page = 1, limit = 20, status, search, owner } = request.query as {
        page?: number;
        limit?: number;
        status?: string;
        search?: string;
        owner?: string;
      };

      const skip = (Number(page) - 1) * Number(limit);

      const searchQuery = typeof search === 'string' ? search.trim() : '';
      const ownerQuery = typeof owner === 'string' ? owner.trim() : '';
      const ownerMatches = ownerQuery
        ? await prisma.user.findMany({
            where: {
              OR: [
                { username: { contains: ownerQuery, mode: 'insensitive' } },
                { email: { contains: ownerQuery, mode: 'insensitive' } },
              ],
            },
            select: { id: true },
            take: 50,
          })
        : [];
      const ownerFilterIds = ownerMatches.map((entry) => entry.id);
      if (ownerQuery && ownerFilterIds.length === 0) {
        return reply.send({
          servers: [],
          pagination: {
            page: Number(page),
            limit: Number(limit),
            total: 0,
            totalPages: 0,
          },
        });
      }
      const where = {
        ...(status ? { status } : {}),
        ...(searchQuery
          ? {
              OR: [
                { name: { contains: searchQuery, mode: 'insensitive' as const } },
                { id: { contains: searchQuery, mode: 'insensitive' as const } },
                { node: { name: { contains: searchQuery, mode: 'insensitive' as const } } },
              ],
            }
          : {}),
        ...(ownerFilterIds.length ? { ownerId: { in: ownerFilterIds } } : {}),
      };

        const [servers, total] = await Promise.all([
          prisma.server.findMany({
            where,
            skip,
            take: Number(limit),
            include: {
              node: {
                select: {
                  id: true,
                  name: true,
                  hostname: true,
                },
              },
              template: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          }),
          prisma.server.count({ where }),
        ]);

        const ownerIds = Array.from(new Set(servers.map((server) => server.ownerId).filter(Boolean)));
        const owners = ownerIds.length
          ? await prisma.user.findMany({
              where: { id: { in: ownerIds } },
              select: { id: true, username: true, email: true },
            })
          : [];
        const ownerMap = new Map(owners.map((owner) => [owner.id, owner]));
        const serversWithOwners = servers.map((server) => ({
          ...server,
          owner: ownerMap.get(server.ownerId) ?? null,
        }));

      // Explicitly serialize to avoid Fastify v5 + Prisma v7 serialization issues
      return reply.send(JSON.parse(JSON.stringify({
        servers: serversWithOwners,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / Number(limit)),
        },
      })));
    }
  );

  // Bulk server actions (requires appropriate server permissions)
  app.post(
    '/servers/actions',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;

      const { serverIds, action, reason } = request.body as {
        serverIds?: string[];
        action?: 'start' | 'stop' | 'kill' | 'restart' | 'suspend' | 'unsuspend' | 'delete';
        reason?: string;
      };

      if (!serverIds || serverIds.length === 0) {
        return reply.status(400).send({ error: 'serverIds is required' });
      }

      // Map actions to required permissions
      const actionPermissions: Record<string, string> = {
        start: 'server.start',
        stop: 'server.stop',
        kill: 'server.stop',
        restart: 'server.start',
        suspend: 'server.suspend',
        unsuspend: 'server.suspend',
        delete: 'server.delete',
      };

      const requiredPerm = action ? actionPermissions[action] || 'server.read' : 'server.read';
      if (!(await hasPermission(prisma, user.userId, requiredPerm))) {
        return reply.status(403).send({ error: `Server ${action} permission required` });
      }

      if (!Array.isArray(serverIds) || serverIds.length === 0) {
        return reply.status(400).send({ error: 'serverIds are required' });
      }

      const uniqueServerIds = Array.from(new Set(serverIds.filter((id) => typeof id === 'string')));
      if (uniqueServerIds.length === 0) {
        return reply.status(400).send({ error: 'serverIds are required' });
      }

      const allowedActions = new Set(['start', 'stop', 'kill', 'restart', 'suspend', 'unsuspend', 'delete']);
      if (!action || !allowedActions.has(action)) {
        return reply.status(400).send({ error: 'Invalid action' });
      }

      const servers = await prisma.server.findMany({
        where: { id: { in: uniqueServerIds } },
        include: { node: true, template: true },
      });

      const serverMap = new Map(servers.map((server) => [server.id, server]));
      const missing = uniqueServerIds.filter((id) => !serverMap.has(id));
      if (missing.length) {
        return reply.status(404).send({ error: 'One or more servers were not found', missing });
      }

      const gateway = (app as any).wsGateway;
      const results = await Promise.all(
        servers.map(async (server) => {
          try {
            if (action === 'start') {
              if (!ServerStateMachine.canStart(server.status as ServerState)) {
                return { serverId: server.id, status: 'skipped', error: 'Invalid server state' };
              }
              if (!server.node?.isOnline) {
                return { serverId: server.id, status: 'skipped', error: 'Node is offline' };
              }
              if (!gateway) {
                return { serverId: server.id, status: 'failed', error: 'WebSocket gateway not available' };
              }
              const serverDir = process.env.SERVER_DATA_PATH || '/tmp/catalyst-servers';
              const fullServerDir = `${serverDir}/${server.uuid}`;
              const templateVariables = (server.template?.variables as any[]) || [];
              const templateDefaults = templateVariables.reduce((acc, variable) => {
                if (variable?.name && variable?.default !== undefined) {
                  acc[variable.name] = String(variable.default);
                }
                return acc;
              }, {} as Record<string, string>);
              const environment: Record<string, string> = {
                ...templateDefaults,
                ...(server.environment as Record<string, string>),
                SERVER_DIR: fullServerDir,
              };
              if (server.template?.image) {
                const resolvedImage = resolveTemplateImage(server.template as any, environment);
                if (resolvedImage) {
                  environment.TEMPLATE_IMAGE = resolvedImage;
                }
              }
              if (server.primaryIp && !environment.CATALYST_NETWORK_IP) {
                environment.CATALYST_NETWORK_IP = server.primaryIp;
              }
              if (server.networkMode === 'host' && !environment.CATALYST_NETWORK_IP) {
                try {
                  environment.CATALYST_NETWORK_IP = normalizeHostIp(server.node.publicAddress) || "";
                } catch (error: any) {
                  return { serverId: server.id, status: 'failed', error: error.message };
                }
              }
              const success = await gateway.sendToAgent(server.nodeId, {
                type: 'start_server',
                serverId: server.id,
                serverUuid: server.uuid,
                template: server.template,
                environment,
                allocatedMemoryMb: server.allocatedMemoryMb,
                allocatedCpuCores: server.allocatedCpuCores,
                allocatedDiskMb: server.allocatedDiskMb,
                primaryPort: server.primaryPort,
                portBindings: parseStoredPortBindings(server.portBindings),
                networkMode: server.networkMode,
              });
              if (!success) {
                return { serverId: server.id, status: 'failed', error: 'Failed to send command to agent' };
              }
              await prisma.server.update({
                where: { id: server.id },
                data: { status: 'starting' },
              });
              await prisma.auditLog.create({
                data: {
                  userId: user.userId,
                  action: 'server.start',
                  resource: 'server',
                  resourceId: server.id,
                  details: {},
                },
              });
              return { serverId: server.id, status: 'success' };
            }

            if (action === 'stop') {
              if (!ServerStateMachine.canStop(server.status as ServerState)) {
                return { serverId: server.id, status: 'skipped', error: 'Invalid server state' };
              }
              if (!server.node?.isOnline) {
                return { serverId: server.id, status: 'skipped', error: 'Node is offline' };
              }
              if (!gateway) {
                return { serverId: server.id, status: 'failed', error: 'WebSocket gateway not available' };
              }
              const success = await gateway.sendToAgent(server.nodeId, {
                type: 'stop_server',
                serverId: server.id,
                serverUuid: server.uuid,
                template: server.template,
              });
              if (!success) {
                return { serverId: server.id, status: 'failed', error: 'Failed to send command to agent' };
              }
              await prisma.server.update({
                where: { id: server.id },
                data: { status: 'stopping' },
              });
              await prisma.auditLog.create({
                data: {
                  userId: user.userId,
                  action: 'server.stop',
                  resource: 'server',
                  resourceId: server.id,
                  details: {},
                },
              });
              return { serverId: server.id, status: 'success' };
            }

            if (action === 'kill') {
              const canKill =
                ServerStateMachine.canStop(server.status as ServerState) ||
                server.status === ServerState.STOPPING;
              if (!canKill) {
                return { serverId: server.id, status: 'skipped', error: 'Invalid server state' };
              }
              if (!server.node?.isOnline) {
                return { serverId: server.id, status: 'skipped', error: 'Node is offline' };
              }
              if (!gateway) {
                return { serverId: server.id, status: 'failed', error: 'WebSocket gateway not available' };
              }
              const success = await gateway.sendToAgent(server.nodeId, {
                type: 'kill_server',
                serverId: server.id,
                serverUuid: server.uuid,
                template: server.template,
              });
              if (!success) {
                return { serverId: server.id, status: 'failed', error: 'Failed to send command to agent' };
              }
              await prisma.server.update({
                where: { id: server.id },
                data: { status: 'stopping' },
              });
              await prisma.auditLog.create({
                data: {
                  userId: user.userId,
                  action: 'server.stop',
                  resource: 'server',
                  resourceId: server.id,
                  details: { force: true },
                },
              });
              return { serverId: server.id, status: 'success' };
            }

            if (action === 'restart') {
              if (!ServerStateMachine.canRestart(server.status as ServerState)) {
                return { serverId: server.id, status: 'skipped', error: 'Invalid server state' };
              }
              if (!server.node?.isOnline) {
                return { serverId: server.id, status: 'skipped', error: 'Node is offline' };
              }
              if (!gateway) {
                return { serverId: server.id, status: 'failed', error: 'WebSocket gateway not available' };
              }
              if (server.status === ServerState.RUNNING) {
                await gateway.sendToAgent(server.nodeId, {
                  type: 'stop_server',
                  serverId: server.id,
                  serverUuid: server.uuid,
                  template: server.template,
                });
                await prisma.server.update({
                  where: { id: server.id },
                  data: { status: 'stopping' },
                });
              }
              const serverDir = process.env.SERVER_DATA_PATH || '/tmp/catalyst-servers';
              const fullServerDir = `${serverDir}/${server.uuid}`;
              const environment: Record<string, string> = {
                ...(server.environment as Record<string, string>),
                SERVER_DIR: fullServerDir,
              };
              if (server.template?.image) {
                const resolvedImage = resolveTemplateImage(server.template as any, environment);
                if (resolvedImage) {
                  environment.TEMPLATE_IMAGE = resolvedImage;
                }
              }
              if (server.primaryIp && !environment.CATALYST_NETWORK_IP) {
                environment.CATALYST_NETWORK_IP = server.primaryIp;
              }
              if (server.networkMode === 'host' && !environment.CATALYST_NETWORK_IP) {
                try {
                  environment.CATALYST_NETWORK_IP = normalizeHostIp(server.node.publicAddress) || "";
                } catch (error: any) {
                  return { serverId: server.id, status: 'failed', error: error.message };
                }
              }
              const success = await gateway.sendToAgent(server.nodeId, {
                type: 'restart_server',
                serverId: server.id,
                serverUuid: server.uuid,
                template: server.template,
                environment,
                allocatedMemoryMb: server.allocatedMemoryMb,
                allocatedCpuCores: server.allocatedCpuCores,
                allocatedDiskMb: server.allocatedDiskMb,
                primaryPort: server.primaryPort,
                portBindings: parseStoredPortBindings(server.portBindings),
                networkMode: server.networkMode,
              });
              if (!success) {
                return { serverId: server.id, status: 'failed', error: 'Failed to send command to agent' };
              }
              await prisma.auditLog.create({
                data: {
                  userId: user.userId,
                  action: 'server.restart',
                  resource: 'server',
                  resourceId: server.id,
                  details: {},
                },
              });
              return { serverId: server.id, status: 'success' };
            }

            if (action === 'suspend') {
              if (server.suspendedAt) {
                return { serverId: server.id, status: 'skipped', error: 'Server already suspended' };
              }
              if ((server.status === 'running' || server.status === 'starting') && gateway) {
                if (!server.node?.isOnline) {
                  return { serverId: server.id, status: 'skipped', error: 'Node is offline' };
                }
                await gateway.sendToAgent(server.nodeId, {
                  type: 'stop_server',
                  serverId: server.id,
                  serverUuid: server.uuid,
                });
              }
              await prisma.server.update({
                where: { id: server.id },
                data: {
                  status: 'suspended',
                  suspendedAt: new Date(),
                  suspendedByUserId: user.userId,
                  suspensionReason: reason?.trim() || null,
                },
              });
              await prisma.auditLog.create({
                data: {
                  userId: user.userId,
                  action: 'server.suspend',
                  resource: 'server',
                  resourceId: server.id,
                  details: { reason: reason?.trim() || undefined },
                },
              });
              await prisma.serverLog.create({
                data: {
                  serverId: server.id,
                  stream: 'system',
                  data: `Server suspended${reason?.trim() ? `: ${reason.trim()}` : ''}`,
                },
              });
              return { serverId: server.id, status: 'success' };
            }

            if (action === 'unsuspend') {
              if (!server.suspendedAt) {
                return { serverId: server.id, status: 'skipped', error: 'Server is not suspended' };
              }
              await prisma.server.update({
                where: { id: server.id },
                data: {
                  status: 'stopped',
                  suspendedAt: null,
                  suspendedByUserId: null,
                  suspensionReason: null,
                },
              });
              await prisma.auditLog.create({
                data: {
                  userId: user.userId,
                  action: 'server.unsuspend',
                  resource: 'server',
                  resourceId: server.id,
                  details: {},
                },
              });
              await prisma.serverLog.create({
                data: {
                  serverId: server.id,
                  stream: 'system',
                  data: 'Server unsuspended',
                },
              });
              return { serverId: server.id, status: 'success' };
            }

            if (action === 'delete') {
              if (isSuspensionEnforced() && server.suspendedAt && isSuspensionDeleteBlocked()) {
                return { serverId: server.id, status: 'skipped', error: 'Server is suspended' };
              }
              if (server.status !== 'stopped') {
                return { serverId: server.id, status: 'skipped', error: 'Server must be stopped' };
              }
              await prisma.$transaction(async (tx) => {
                await releaseIpForServer(tx, server.id);
                await tx.server.delete({ where: { id: server.id } });
              });
              await prisma.auditLog.create({
                data: {
                  userId: user.userId,
                  action: 'server.delete',
                  resource: 'server',
                  resourceId: server.id,
                  details: {},
                },
              });
              return { serverId: server.id, status: 'success' };
            }

            return { serverId: server.id, status: 'skipped', error: 'Unsupported action' };
          } catch (error: any) {
            return {
              serverId: server.id,
              status: 'failed',
              error: error?.message || 'Action failed',
            };
          }
        }),
      );

      const summary = results.reduce(
        (acc, entry) => {
          acc[entry.status] = (acc[entry.status] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );

      return reply.send({ success: true, results, summary });
    },
  );

  // Get audit logs (requires admin.read)
  app.get(
    '/audit-logs',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;

      if (!(await hasPermission(prisma, user.userId, 'admin.read'))) {
        return reply.status(403).send({ error: 'Admin read permission required' });
      }

      const {
        page = 1,
        limit = 50,
        userId,
        action,
        resource,
        from,
        to,
      } = request.query as {
        page?: number;
        limit?: number;
        userId?: string;
        action?: string;
        resource?: string;
        from?: string;
        to?: string;
      };

      const skip = (Number(page) - 1) * Number(limit);

      const where: any = {};
      if (userId) where.userId = userId;
      if (action) where.action = { contains: action };
      if (resource) where.resource = resource;
      if (from || to) {
        const parsedFrom = from ? new Date(from) : undefined;
        const parsedTo = to ? new Date(to) : undefined;
        if (parsedFrom && Number.isNaN(parsedFrom.getTime())) {
          return reply.status(400).send({ error: 'Invalid from timestamp' });
        }
        if (parsedTo && Number.isNaN(parsedTo.getTime())) {
          return reply.status(400).send({ error: 'Invalid to timestamp' });
        }
        where.timestamp = {
          ...(parsedFrom ? { gte: parsedFrom } : {}),
          ...(parsedTo ? { lte: parsedTo } : {}),
        };
      }

      const [logs, total] = await Promise.all([
        prisma.auditLog.findMany({
          where,
          skip,
          take: Number(limit),
          include: {
            user: {
              select: {
                id: true,
                username: true,
                email: true,
              },
            },
          },
          orderBy: {
            timestamp: 'desc',
          },
        }),
        prisma.auditLog.count({ where }),
      ]);

      reply.send({
        logs,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / Number(limit)),
        },
      });
    }
  );

  // Export audit logs (admin only)
  app.get(
    '/audit-logs/export',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;

      if (!(await hasPermission(prisma, user.userId, 'admin.write'))) {
        return reply.status(403).send({ error: 'Admin write permission required' });
      }

      const {
        userId,
        action,
        resource,
        from,
        to,
        format = 'csv',
      } = request.query as {
        userId?: string;
        action?: string;
        resource?: string;
        from?: string;
        to?: string;
        format?: string;
      };

      const where: any = {};
      if (userId) where.userId = userId;
      if (action) where.action = { contains: action };
      if (resource) where.resource = resource;
      if (from || to) {
        const parsedFrom = from ? new Date(from) : undefined;
        const parsedTo = to ? new Date(to) : undefined;
        if (parsedFrom && Number.isNaN(parsedFrom.getTime())) {
          return reply.status(400).send({ error: 'Invalid from timestamp' });
        }
        if (parsedTo && Number.isNaN(parsedTo.getTime())) {
          return reply.status(400).send({ error: 'Invalid to timestamp' });
        }
        where.timestamp = {
          ...(parsedFrom ? { gte: parsedFrom } : {}),
          ...(parsedTo ? { lte: parsedTo } : {}),
        };
      }

      const logs = await prisma.auditLog.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              username: true,
              email: true,
            },
          },
        },
        orderBy: { timestamp: 'desc' },
        take: 2000,
      });

      if (format !== 'csv' && format !== 'json') {
        return reply.status(400).send({ error: 'Invalid export format' });
      }

      if (format === 'json') {
        reply.type('application/json').send({ logs });
        return;
      }

      const rows = ['id,timestamp,action,resource,resourceId,userId,username,email,details'];
      for (const log of logs) {
        const details = log.details ? JSON.stringify(log.details).replace(/"/g, '""') : '';
        rows.push(
          [
            log.id,
            log.timestamp.toISOString(),
            log.action,
            log.resource,
            log.resourceId ?? '',
            log.userId ?? '',
            log.user?.username ?? '',
            log.user?.email ?? '',
            `"${details}"`,
          ].join(','),
        );
      }
      reply.type('text/csv').send(rows.join('\n'));
    }
  );

  // Security settings (admin only)
  app.get(
    '/security-settings',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;

      if (!(await hasPermission(prisma, user.userId, 'admin.read'))) {
        return reply.status(403).send({ error: 'Admin read permission required' });
      }

      const settings = await getSecuritySettings();
      reply.send(serialize({ success: true, data: settings }));
    }
  );

  app.put(
    '/security-settings',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;

      if (!(await hasPermission(prisma, user.userId, 'admin.read'))) {
        return reply.status(403).send({ error: 'Admin read permission required' });
      }

      const {
        authRateLimitMax = DEFAULT_SECURITY_SETTINGS.authRateLimitMax,
        fileRateLimitMax = DEFAULT_SECURITY_SETTINGS.fileRateLimitMax,
        consoleRateLimitMax = DEFAULT_SECURITY_SETTINGS.consoleRateLimitMax,
        consoleOutputLinesMax = DEFAULT_SECURITY_SETTINGS.consoleOutputLinesMax,
        consoleOutputByteLimitBytes = DEFAULT_SECURITY_SETTINGS.consoleOutputByteLimitBytes,
        agentMessageMax = DEFAULT_SECURITY_SETTINGS.agentMessageMax,
        agentMetricsMax = DEFAULT_SECURITY_SETTINGS.agentMetricsMax,
        serverMetricsMax = DEFAULT_SECURITY_SETTINGS.serverMetricsMax,
        lockoutMaxAttempts = DEFAULT_SECURITY_SETTINGS.lockoutMaxAttempts,
        lockoutWindowMinutes = DEFAULT_SECURITY_SETTINGS.lockoutWindowMinutes,
        lockoutDurationMinutes = DEFAULT_SECURITY_SETTINGS.lockoutDurationMinutes,
        auditRetentionDays = DEFAULT_SECURITY_SETTINGS.auditRetentionDays,
        maxBufferMb = DEFAULT_SECURITY_SETTINGS.maxBufferMb,
        fileTunnelRateLimitMax = DEFAULT_SECURITY_SETTINGS.fileTunnelRateLimitMax,
        fileTunnelMaxUploadMb = DEFAULT_SECURITY_SETTINGS.fileTunnelMaxUploadMb,
        fileTunnelMaxPendingPerNode = DEFAULT_SECURITY_SETTINGS.fileTunnelMaxPendingPerNode,
        fileTunnelConcurrentMax = DEFAULT_SECURITY_SETTINGS.fileTunnelConcurrentMax,
      } = request.body as Partial<typeof DEFAULT_SECURITY_SETTINGS>;

      const numericFields = [
        authRateLimitMax,
        fileRateLimitMax,
        consoleRateLimitMax,
        consoleOutputLinesMax,
        consoleOutputByteLimitBytes,
        agentMessageMax,
        agentMetricsMax,
        serverMetricsMax,
        lockoutMaxAttempts,
        lockoutWindowMinutes,
        lockoutDurationMinutes,
        auditRetentionDays,
        maxBufferMb,
        fileTunnelRateLimitMax,
        fileTunnelMaxUploadMb,
        fileTunnelMaxPendingPerNode,
        fileTunnelConcurrentMax,
      ];
      if (numericFields.some((value) => !Number.isFinite(value) || Number(value) <= 0)) {
        return reply.status(400).send({ error: 'Security settings must be positive numbers' });
      }

      await upsertSecuritySettings({
        authRateLimitMax: Number(authRateLimitMax),
        fileRateLimitMax: Number(fileRateLimitMax),
        consoleRateLimitMax: Number(consoleRateLimitMax),
        consoleOutputLinesMax: Number(consoleOutputLinesMax),
        consoleOutputByteLimitBytes: Number(consoleOutputByteLimitBytes),
        agentMessageMax: Number(agentMessageMax),
        agentMetricsMax: Number(agentMetricsMax),
        serverMetricsMax: Number(serverMetricsMax),
        lockoutMaxAttempts: Number(lockoutMaxAttempts),
        lockoutWindowMinutes: Number(lockoutWindowMinutes),
        lockoutDurationMinutes: Number(lockoutDurationMinutes),
        auditRetentionDays: Number(auditRetentionDays),
        maxBufferMb: Number(maxBufferMb),
        fileTunnelRateLimitMax: Number(fileTunnelRateLimitMax),
        fileTunnelMaxUploadMb: Number(fileTunnelMaxUploadMb),
        fileTunnelMaxPendingPerNode: Number(fileTunnelMaxPendingPerNode),
        fileTunnelConcurrentMax: Number(fileTunnelConcurrentMax),
      });

      await createAuditLog(user.userId, {
        action: 'security.settings.update',
        resource: 'system',
        details: {
          authRateLimitMax,
          fileRateLimitMax,
          consoleRateLimitMax,
          consoleOutputLinesMax,
          consoleOutputByteLimitBytes,
          agentMessageMax,
          agentMetricsMax,
          serverMetricsMax,
          lockoutMaxAttempts,
          lockoutWindowMinutes,
          lockoutDurationMinutes,
          auditRetentionDays,
          maxBufferMb,
          fileTunnelRateLimitMax,
          fileTunnelMaxUploadMb,
          fileTunnelMaxPendingPerNode,
          fileTunnelConcurrentMax,
        },
      });

      reply.send({ success: true });
    }
  );

  // System health check (admin only)
  app.get(
    '/health',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;

      // Check admin permissions
      const userRoles = await prisma.role.findMany({
        where: {
          users: {
            some: { id: user.userId },
          },
        },
      });

      const permissions = userRoles.flatMap((role) => role.permissions);
      const isAdmin = permissions.includes('*') || permissions.includes('admin.read');

      if (!isAdmin) {
        return reply.status(403).send({ error: 'Admin access required' });
      }

      // Check database connectivity
      const dbHealthy = await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);

      // Check node connectivity
      const nodes = await prisma.node.findMany({
        select: {
          id: true,
          name: true,
          isOnline: true,
          lastSeenAt: true,
        },
      });

      const onlineNodes = nodes.filter((n) => n.isOnline).length;
      const offlineNodes = nodes.length - onlineNodes;

      // Check for stale nodes (no heartbeat in 5 minutes)
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const staleNodes = nodes.filter((n) => n.lastSeenAt && n.lastSeenAt < fiveMinutesAgo);

      reply.send({
        status: dbHealthy && offlineNodes === 0 ? 'healthy' : 'degraded',
        database: dbHealthy ? 'connected' : 'disconnected',
        nodes: {
          total: nodes.length,
          online: onlineNodes,
          offline: offlineNodes,
          stale: staleNodes.length,
        },
        timestamp: new Date().toISOString(),
      });
    }
  );

  // IPAM: list pools
  app.get(
    '/ip-pools',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;

      if (!(await hasPermission(prisma, user.userId, 'admin.read'))) {
        return reply.status(403).send({ error: 'Admin read permission required' });
      }

      const pools = await prisma.ipPool.findMany({
        include: {
          node: true,
          allocations: {
            where: { releasedAt: null },
            include: {
              server: {
                select: {
                  id: true,
                  name: true,
                  status: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      const data = pools.map((pool) => {
        const summary = summarizePool(pool);
        const usedCount = pool.allocations.length;
        const availableCount = Math.max(
          0,
          summary.total - summary.reservedCount - usedCount
        );
        return {
          id: pool.id,
          nodeId: pool.nodeId,
          nodeName: pool.node.name,
          networkName: pool.networkName,
          cidr: pool.cidr,
          gateway: pool.gateway,
          startIp: pool.startIp,
          endIp: pool.endIp,
          reserved: pool.reserved,
          rangeStart: summary.rangeStart,
          rangeEnd: summary.rangeEnd,
          total: summary.total,
          reservedCount: summary.reservedCount,
          usedCount,
          availableCount,
          createdAt: pool.createdAt,
          updatedAt: pool.updatedAt,
          allocations: pool.allocations.map((alloc) => ({
            id: alloc.id,
            ip: alloc.ip,
            serverId: alloc.serverId,
            serverName: alloc.server?.name,
            serverStatus: alloc.server?.status,
            createdAt: alloc.createdAt,
          })),
        };
      });

      reply.send({ success: true, data });
    }
  );

  // Node interface listing (admin)

  // IPAM: create pool
  app.post(
    '/ip-pools',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;

      if (!(await hasPermission(prisma, user.userId, 'admin.read'))) {
        return reply.status(403).send({ error: 'Admin read permission required' });
      }

      const {
        nodeId,
        networkName,
        cidr,
        gateway,
        startIp,
        endIp,
        reserved,
      } = request.body as {
        nodeId: string;
        networkName: string;
        cidr: string;
        gateway?: string;
        startIp?: string;
        endIp?: string;
        reserved?: string[];
      };

      if (!nodeId || !networkName || !cidr) {
        return reply.status(400).send({ error: 'nodeId, networkName, and cidr are required' });
      }

      const node = await prisma.node.findUnique({ where: { id: nodeId } });
      if (!node) {
        return reply.status(404).send({ error: 'Node not found' });
      }

      try {
        summarizePool({
          cidr,
          startIp: startIp || null,
          endIp: endIp || null,
          gateway: gateway || null,
          reserved: reserved || [],
        });
      } catch (error: any) {
        return reply.status(400).send({ error: error.message });
      }

      const pool = await prisma.ipPool.create({
        data: {
          nodeId,
          networkName,
          cidr,
          gateway: gateway || null,
          startIp: startIp || null,
          endIp: endIp || null,
          reserved: reserved || [],
        },
      });

      // Send network creation request to agent
      const wsGateway = (app as any).wsGateway;
      if (wsGateway) {
        await wsGateway.sendToAgent(nodeId, {
          type: 'create_network',
          networkName,
          cidr,
          gateway: gateway || undefined,
          rangeStart: startIp || undefined,
          rangeEnd: endIp || undefined,
        }).catch((err: Error) => {
          console.error(`Failed to send network creation to agent ${nodeId}:`, err);
        });
      }

      reply.status(201).send({ success: true, data: pool });
    }
  );

  // IPAM: update pool
  app.put(
    '/ip-pools/:poolId',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;

      if (!(await hasPermission(prisma, user.userId, 'admin.write'))) {
        return reply.status(403).send({ error: 'Admin write permission required' });
      }

      const { poolId } = request.params as { poolId: string };

      const pool = await prisma.ipPool.findUnique({
        where: { id: poolId },
      });

      if (!pool) {
        return reply.status(404).send({ error: 'IP pool not found' });
      }

      const {
        cidr,
        gateway,
        startIp,
        endIp,
        reserved,
      } = request.body as {
        cidr?: string;
        gateway?: string | null;
        startIp?: string | null;
        endIp?: string | null;
        reserved?: string[];
      };

      try {
        summarizePool({
          cidr: cidr ?? pool.cidr,
          startIp: startIp ?? pool.startIp,
          endIp: endIp ?? pool.endIp,
          gateway: gateway ?? pool.gateway,
          reserved: reserved ?? pool.reserved,
        });
      } catch (error: any) {
        return reply.status(400).send({ error: error.message });
      }

      const updated = await prisma.ipPool.update({
        where: { id: poolId },
        data: {
          cidr: cidr ?? pool.cidr,
          gateway: gateway ?? pool.gateway,
          startIp: startIp ?? pool.startIp,
          endIp: endIp ?? pool.endIp,
          reserved: (reserved ?? pool.reserved) as any,
        },
      });

      // Send network update request to agent
      const wsGateway = (app as any).wsGateway;
      if (wsGateway) {
        await wsGateway.sendToAgent(pool.nodeId, {
          type: 'update_network',
          oldName: pool.networkName,
          networkName: updated.networkName,
          cidr: updated.cidr,
          gateway: updated.gateway || undefined,
          rangeStart: updated.startIp || undefined,
          rangeEnd: updated.endIp || undefined,
        }).catch((err: Error) => {
          console.error(`Failed to send network update to agent ${pool.nodeId}:`, err);
        });
      }

      reply.send(serialize({ success: true, data: updated }));
    }
  );

  // IPAM: delete pool
  app.delete(
    '/ip-pools/:poolId',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;

      if (!(await hasPermission(prisma, user.userId, 'admin.write'))) {
        return reply.status(403).send({ error: 'Admin write permission required' });
      }

      const { poolId } = request.params as { poolId: string };

      const activeAllocations = await prisma.ipAllocation.count({
        where: { poolId, releasedAt: null },
      });

      if (activeAllocations > 0) {
        return reply.status(409).send({
          error: 'Pool has active allocations',
        });
      }

      // Get pool info before deletion for agent notification
      const pool = await prisma.ipPool.findUnique({
        where: { id: poolId },
      });

      await prisma.ipPool.delete({ where: { id: poolId } });

      // Send network deletion request to agent
      if (pool) {
        const wsGateway = (app as any).wsGateway;
        if (wsGateway) {
          await wsGateway.sendToAgent(pool.nodeId, {
            type: 'delete_network',
            networkName: pool.networkName,
          }).catch((err: Error) => {
            console.error(`Failed to send network deletion to agent ${pool.nodeId}:`, err);
          });
        }
      }

      reply.send({ success: true });
    }
  );

  // Database hosts: list
  app.get(
    '/database-hosts',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;

      if (!(await hasPermission(prisma, user.userId, 'admin.read'))) {
        return reply.status(403).send({ error: 'Admin read permission required' });
      }

      const hosts = await prisma.databaseHost.findMany({
        orderBy: { createdAt: 'desc' },
      });

      reply.send(serialize({ success: true, data: hosts }));
    }
  );

  // Database hosts: create
  app.post(
    '/database-hosts',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;

      if (!(await hasPermission(prisma, user.userId, 'admin.write'))) {
        return reply.status(403).send({ error: 'Admin write permission required' });
      }

      const { name, host, port, username, password } = request.body as {
        name: string;
        host: string;
        port?: number;
        username: string;
        password: string;
      };

      if (!name || !host || !username || !password) {
        return reply.status(400).send({ error: 'name, host, username, and password are required' });
      }

      if (name.trim().length < 3) {
        return reply.status(400).send({ error: 'name must be at least 3 characters' });
      }

      if (port !== undefined && (port <= 0 || port > 65535)) {
        return reply.status(400).send({ error: 'port must be between 1 and 65535' });
      }
      const trimmedHost = host.trim();
      if (!/^[a-z0-9.-]+$/i.test(trimmedHost)) {
        return reply.status(400).send({ error: 'host must be a valid hostname or IP' });
      }

      try {
        const created = await prisma.databaseHost.create({
          data: {
            name: name.trim(),
            host: trimmedHost,
            port: port ?? (Number(process.env.DATABASE_HOST_PORT_DEFAULT) || 3306),
            username: username.trim(),
            password,
          },
        });

        await createAuditLog(user.userId, {
          action: 'database.host.create',
          resource: 'database_host',
          resourceId: created.id,
          details: { name: created.name, host: created.host, port: created.port },
        });

        reply.status(201).send({ success: true, data: created });
      } catch (error: any) {
        return reply.status(409).send({ error: 'Database host name already exists' });
      }
    }
  );

  // Database hosts: update
  app.put(
    '/database-hosts/:hostId',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;

      if (!(await hasPermission(prisma, user.userId, 'admin.write'))) {
        return reply.status(403).send({ error: 'Admin write permission required' });
      }

      const { hostId } = request.params as { hostId: string };
      const { name, host, port, username, password } = request.body as {
        name?: string;
        host?: string;
        port?: number;
        username?: string;
        password?: string;
      };

      const existing = await prisma.databaseHost.findUnique({
        where: { id: hostId },
      });

      if (!existing) {
        return reply.status(404).send({ error: 'Database host not found' });
      }

      if (name !== undefined && name.trim().length < 3) {
        return reply.status(400).send({ error: 'name must be at least 3 characters' });
      }

      if (port !== undefined && (port <= 0 || port > 65535)) {
        return reply.status(400).send({ error: 'port must be between 1 and 65535' });
      }
      if (host !== undefined) {
        const trimmedHost = host.trim();
        if (!/^[a-z0-9.-]+$/i.test(trimmedHost)) {
          return reply.status(400).send({ error: 'host must be a valid hostname or IP' });
        }
      }

      try {
        const updated = await prisma.databaseHost.update({
          where: { id: hostId },
          data: {
            name: name !== undefined ? name.trim() : existing.name,
            host: host !== undefined ? host.trim() : existing.host,
            port: port ?? existing.port,
            username: username !== undefined ? username.trim() : existing.username,
            password: password ?? existing.password,
          },
        });

        await createAuditLog(user.userId, {
          action: 'database.host.update',
          resource: 'database_host',
          resourceId: updated.id,
          details: { name: updated.name, host: updated.host, port: updated.port },
        });

        reply.send(serialize({ success: true, data: updated }));
      } catch (error: any) {
        return reply.status(409).send({ error: 'Database host name already exists' });
      }
    }
  );

  // Database hosts: delete
  app.delete(
    '/database-hosts/:hostId',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;

      if (!(await hasPermission(prisma, user.userId, 'admin.write'))) {
        return reply.status(403).send({ error: 'Admin write permission required' });
      }

      const { hostId } = request.params as { hostId: string };

      const databasesCount = await prisma.serverDatabase.count({
        where: { hostId },
      });

      if (databasesCount > 0) {
        return reply.status(409).send({ error: 'Database host has active databases' });
      }

      const deleted = await prisma.databaseHost.delete({ where: { id: hostId } });

      await createAuditLog(user.userId, {
        action: 'database.host.delete',
        resource: 'database_host',
        resourceId: hostId,
        details: { name: deleted.name },
      });

      reply.send({ success: true });
    }
  );

  app.get(
    '/smtp',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;
      if (!(await hasPermission(prisma, user.userId, 'admin.read'))) {
        return reply.status(403).send({ error: 'Admin read permission required' });
      }
      const settings = await getSmtpSettings();
      reply.send(serialize({ success: true, data: settings }));
    }
  );

  app.put(
    '/smtp',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;
      if (!(await hasPermission(prisma, user.userId, 'admin.write'))) {
        return reply.status(403).send({ error: 'Admin write permission required' });
      }
      const {
        host,
        port,
        username,
        password,
        from,
        replyTo,
        secure,
        requireTls,
        pool,
        maxConnections,
        maxMessages,
      } = request.body as {
        host?: string;
        port?: number;
        username?: string;
        password?: string;
        from?: string;
        replyTo?: string;
        secure?: boolean;
        requireTls?: boolean;
        pool?: boolean;
        maxConnections?: number;
        maxMessages?: number;
      };

      if (host === '' || username === '' || from === '' || replyTo === '') {
        return reply.status(400).send({ error: 'SMTP fields cannot be empty strings' });
      }

      if (port !== undefined && (!Number.isInteger(port) || port <= 0 || port > 65535)) {
        return reply.status(400).send({ error: 'Invalid SMTP port' });
      }

      await upsertSmtpSettings({
        host: host ?? null,
        port: port ?? null,
        username: username ?? null,
        password: password ?? null,
        from: from ?? null,
        replyTo: replyTo ?? null,
        secure: secure ?? false,
        requireTls: requireTls ?? false,
        pool: pool ?? false,
        maxConnections: maxConnections ?? null,
        maxMessages: maxMessages ?? null,
      });

      await createAuditLog(user.userId, {
        action: 'smtp_update',
        resource: 'system',
        details: {
          host: host ?? null,
          port: port ?? null,
          username: username ?? null,
          from: from ?? null,
          replyTo: replyTo ?? null,
          secure: secure ?? false,
          requireTls: requireTls ?? false,
          pool: pool ?? false,
          maxConnections: maxConnections ?? null,
          maxMessages: maxMessages ?? null,
        },
      });

      reply.send({ success: true });
    }
  );

  app.get(
    '/mod-manager',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;
      if (!(await hasPermission(prisma, user.userId, 'admin.write'))) {
        return reply.status(403).send({ error: 'Admin write permission required' });
      }
      const settings = await getModManagerSettings();
      reply.send(serialize({ success: true, data: settings }));
    }
  );

  app.put(
    '/mod-manager',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;
      if (!(await hasPermission(prisma, user.userId, 'admin.write'))) {
        return reply.status(403).send({ error: 'Admin write permission required' });
      }
      const { curseforgeApiKey, modrinthApiKey } = request.body as {
        curseforgeApiKey?: string | null;
        modrinthApiKey?: string | null;
      };

      if (curseforgeApiKey === '' || modrinthApiKey === '') {
        return reply.status(400).send({ error: 'Mod manager keys cannot be empty strings' });
      }

      await upsertModManagerSettings({
        curseforgeApiKey: curseforgeApiKey ?? null,
        modrinthApiKey: modrinthApiKey ?? null,
      });

      await createAuditLog(user.userId, {
        action: 'mod_manager.settings.update',
        resource: 'system',
        details: {
          curseforgeConfigured: Boolean(curseforgeApiKey),
          modrinthConfigured: Boolean(modrinthApiKey),
        },
      });

      reply.send({ success: true });
    }
  );

  // Theme settings: get
  app.get(
    '/theme-settings',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;
      if (!(await hasPermission(prisma, user.userId, 'admin.read'))) {
        return reply.status(403).send({ error: 'Admin read permission required' });
      }

      let settings = await prisma.themeSettings.findUnique({
        where: { id: 'default' },
      });

      if (!settings) {
        settings = await prisma.themeSettings.create({
          data: { id: 'default' },
        });
      }

      reply.send(serialize({ success: true, data: settings }));
    }
  );

  // Theme settings: update
  app.patch(
    '/theme-settings',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;
      if (!(await hasPermission(prisma, user.userId, 'admin.write'))) {
        return reply.status(403).send({ error: 'Admin write permission required' });
      }

      const {
        panelName,
        logoUrl,
        faviconUrl,
        defaultTheme,
        enabledThemes,
        customCss,
        primaryColor,
        secondaryColor,
        accentColor,
        metadata,
      } = request.body as {
        panelName?: string;
        logoUrl?: string | null;
        faviconUrl?: string | null;
        defaultTheme?: string;
        enabledThemes?: string[];
        customCss?: string | null;
        primaryColor?: string;
        secondaryColor?: string;
        accentColor?: string;
        metadata?: any;
      };

      // Validation
      if (panelName !== undefined && panelName.trim().length < 1) {
        return reply.status(400).send({ error: 'Panel name cannot be empty' });
      }

      if (defaultTheme !== undefined && !['light', 'dark', 'system'].includes(defaultTheme)) {
        return reply.status(400).send({ error: 'Invalid default theme' });
      }

      if (enabledThemes !== undefined) {
        if (!Array.isArray(enabledThemes) || enabledThemes.length === 0) {
          return reply.status(400).send({ error: 'At least one theme must be enabled' });
        }
        const validThemes = ['light', 'dark'];
        if (!enabledThemes.every((t) => validThemes.includes(t))) {
          return reply.status(400).send({ error: 'Invalid theme in enabledThemes' });
        }
      }

      const colorRegex = /^#[0-9A-Fa-f]{6}$/;
      if (primaryColor !== undefined && !colorRegex.test(primaryColor)) {
        return reply.status(400).send({ error: 'Invalid primary color format' });
      }
      if (secondaryColor !== undefined && !colorRegex.test(secondaryColor)) {
        return reply.status(400).send({ error: 'Invalid secondary color format' });
      }
      if (accentColor !== undefined && !colorRegex.test(accentColor)) {
        return reply.status(400).send({ error: 'Invalid accent color format' });
      }

      if (customCss !== undefined && customCss !== null && customCss.length > 100000) {
        return reply.status(400).send({ error: 'Custom CSS too large (max 100KB)' });
      }

      const updateData: any = {};
      if (panelName !== undefined) updateData.panelName = panelName.trim();
      if (logoUrl !== undefined) updateData.logoUrl = logoUrl;
      if (faviconUrl !== undefined) updateData.faviconUrl = faviconUrl;
      if (defaultTheme !== undefined) updateData.defaultTheme = defaultTheme;
      if (enabledThemes !== undefined) updateData.enabledThemes = enabledThemes;
      if (customCss !== undefined) updateData.customCss = customCss;
      if (primaryColor !== undefined) updateData.primaryColor = primaryColor;
      if (secondaryColor !== undefined) updateData.secondaryColor = secondaryColor;
      if (accentColor !== undefined) updateData.accentColor = accentColor;
      if (metadata !== undefined) updateData.metadata = metadata;

      const settings = await prisma.themeSettings.upsert({
        where: { id: 'default' },
        update: updateData,
        create: { id: 'default', ...updateData },
      });

      await createAuditLog(user.userId, {
        action: 'theme_settings.update',
        resource: 'system',
        details: updateData,
      });

      reply.send(serialize({ success: true, data: settings }));
    }
  );
}
