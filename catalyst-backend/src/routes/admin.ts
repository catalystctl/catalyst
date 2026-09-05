import { prisma } from '../db.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { fromNodeHeaders } from 'better-auth/node';
import { auth } from '../auth';
import { ServerState } from '../shared-types';
import { ServerStateMachine } from '../services/state-machine';
import { normalizeHostIp, releaseIpForServer, summarizePool } from '../utils/ipam';
import { describeError } from '../utils/describe-error.js';
import { createAuditLog, buildServerAuditDetails, enrichAuditDetails, resolveActorDetails } from '../middleware/audit';
import { revokeSftpTokensForUser } from '../services/sftp-token-manager';
import {
  hasNodeAccess,
  invalidateAdminUserCache,
  invalidateNodeAccessCache,
} from '../lib/permissions.js';
import { invalidateUserPermissions } from '../lib/permissions-catalog.js';
import { captureSystemError } from '../services/error-logger';
// Permission checks use request.user.permissions (populated by auth middleware)
// No DB queries needed — works for both session and API key auth.
import {
  DEFAULT_SECURITY_SETTINGS,
  getModManagerSettings,
  getSecuritySettings,
  getSmtpSettings,
  upsertModManagerSettings,
  upsertSecuritySettings,
  upsertSmtpSettings,
  isValidTimeWindowMs,
  MAX_UPLOAD_MB_CEILING,
  sanitizeMaxUploadMb,
  maxUploadBytesFromMb,
} from '../services/mailer';
import { serialize } from '../utils/serialize';
import { withRegistrationBypass } from '../lib/registration-gate.js';

export async function adminRoutes(app: FastifyInstance) {
  // Using shared prisma instance from db.ts
  const authenticate = (app as any).authenticate;

  const isSuspensionEnforced = () => process.env.SUSPENSION_ENFORCED !== "false";
  const isSuspensionDeleteBlocked = () => process.env.SUSPENSION_DELETE_BLOCKED !== "false";

  // Check permissions from request.user.permissions (populated by auth middleware)
  // Works for both session and API key auth without extra DB queries.
  const checkPerm = (request: any, permission: string): boolean => {
    const perms: string[] = request.user?.permissions ?? [];
    return perms.includes('*') || perms.includes(permission);
  };

  const checkAnyPerm = (request: any, permissions: string[]): boolean => {
    const perms: string[] = request.user?.permissions ?? [];
    if (perms.includes('*')) return true;
    return permissions.some((p) => perms.includes(p));
  };

  // Helper to check if user has admin permissions (uses request.user.permissions
  // populated by auth middleware — works for both session and API key auth)
  const isAdminUser = (request: any, required: 'admin.read' | 'admin.write' = 'admin.read') => {
    const perms: string[] = request.user?.permissions ?? [];
    if (perms.includes('*')) return true;
    // Exact match: admin.read must not satisfy an admin.write check.
    return perms.includes(required);
  };

  // Helper to check user management permissions
  const canManageUsers = (request: any, action: 'read' | 'create' | 'update' | 'delete' | 'ban' | 'unban' | 'set_roles' = 'read') => {
    const perms: string[] = request.user?.permissions ?? [];
    if (perms.includes('*')) return true;
    return perms.includes(`user.${action}`);
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
      const user = request.user;

      // Check if user has any admin permission
      const hasAny = checkAnyPerm(request, [
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
      const user = request.user;

      if (!(canManageUsers(request, 'read'))) {
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
            banned: true,
            banReason: true,
            banExpires: true,
            emailVerified: true,
            twoFactorEnabled: true,
            lastSuccessfulLogin: true,
            roles: {
              select: {
                id: true,
                name: true,
              },
            },
            accounts: {
              select: {
                id: true,
                providerId: true,
                accountId: true,
              },
            },
            passkeys: {
              select: {
                id: true,
                name: true,
                createdAt: true,
              },
            },
            twoFactor: {
              select: {
                id: true,
              },
            },
            _count: {
              select: {
                passkeys: true,
                sessions: true,
              },
            },
            sessions: {
              select: {
                id: true,
                ipAddress: true,
                createdAt: true,
              },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        }),
        prisma.user.count({ where }),
      ]);

      // Enrich users with last sign-in IP from most recent session
      const usersWithLastIp = users.map((u: any) => {
        const lastIp = u.sessions?.length > 0
          ? [...u.sessions].sort((a: any, b: any) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
            )[0]?.ipAddress
          : null;
        const { sessions, ...rest } = u;
        return { ...rest, lastSignInIp: lastIp ?? null };
      });

      reply.send({
        users: usersWithLastIp,
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
      const user = request.user;

      if (!(canManageUsers(request, 'create'))) {
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

      // Validate that the acting user can grant all permissions in the assigned roles
      // This prevents privilege escalation: an admin with user.create but not *
      // should not be able to create a user with a role that has permissions they don't have.
      if (roleIds?.length) {
        const actingPerms: string[] = user?.permissions ?? [];
        const actingHasWildcard = actingPerms.includes('*');
        if (!actingHasWildcard) {
          for (const role of rolesToAssign) {
            const cantGrant = (role.permissions as string[]).filter(
              (p) => !actingPerms.includes(p),
            );
            if (cantGrant.length > 0) {
              return reply.status(403).send({
                error: `Cannot assign role with permissions you don't have: ${cantGrant.join(', ')}`,
              });
            }
          }
          // SECURITY: scoped grants (RoleServerGrant / RoleNodeGrant) carry
          // permissions the global role.permissions array never shows. Same
          // authority rule as the roles-assignment route: the creator must
          // hold every scoped permission too.
          const scopedGrants = await prisma.roleServerGrant.findMany({
            where: { roleId: { in: roleIds } },
            select: { permissions: true },
          });
          const scopedNodeGrants = await prisma.roleNodeGrant.findMany({
            where: { roleId: { in: roleIds } },
            select: { permissions: true },
          });
          const scopedPerms = [
            ...new Set(
              [...scopedGrants, ...scopedNodeGrants].flatMap((g) => g.permissions),
            ),
          ];
          const cantGrantScoped = scopedPerms.filter(
            (p) => !actingPerms.includes(p),
          );
          if (cantGrantScoped.length > 0) {
            return reply.status(403).send({
              error: `Cannot assign role with scoped permissions you don't have: ${cantGrantScoped.join(', ')}`,
            });
          }
        }
      }

      let serverAccessIds: string[] = [];
      let defaultPermissions: string[] | undefined;
      if (serverIds?.length) {
        const uniqueServerIds = Array.from(new Set(serverIds));
        const existingServers = await prisma.server.findMany({
          where: { id: { in: uniqueServerIds } },
          select: { id: true, ownerId: true, nodeId: true },
        });

        if (existingServers.length !== uniqueServerIds.length) {
          return reply.status(400).send({ error: 'One or more servers are invalid' });
        }

        // Validate requesting user can grant access to these servers
        const isAdmin = checkPerm(request, 'admin.write');
        if (!isAdmin) {
          for (const server of existingServers) {
            const canGrant = server.ownerId === user.userId ||
              await hasNodeAccess(prisma, user.userId, server.nodeId);
            if (!canGrant) {
              return reply.status(403).send({
                error: `Cannot grant access to server ${server.id}`,
              });
            }
          }
        }

        // Validate server permissions don't exceed what the requester has
        if (serverPermissions && serverPermissions.length > 0) {
          const requesterPerms: string[] = request.user?.permissions ?? [];
          const hasWildcard = requesterPerms.includes('*');
          if (!hasWildcard) {
            const cantGrant = serverPermissions.filter(
              (p) => !requesterPerms.includes(p),
            );
            if (cantGrant.length > 0) {
              return reply.status(403).send({
                error: `Cannot grant server permissions you don't have: ${cantGrant.join(', ')}`,
              });
            }
          }
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

      const signUpResponse = await withRegistrationBypass(() =>
        auth.api.signUpEmail({
          headers: fromNodeHeaders(request.headers as Record<string, string | string[] | undefined>),
          body: {
            email,
            password,
            name: username,
            username,
          } as any,
          returnHeaders: true,
        }),
      );

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

      if (rolesToAssign.length) {
        invalidateUserPermissions(created.id);
        invalidateAdminUserCache(created.id);
        invalidateNodeAccessCache(created.id);
      }

      await createAuditLog(user.userId, {
        request,
        action: 'user_create',
        resource: 'user',
        resourceId: created.id,
        details: {
          email: createdUser.email,
          username: createdUser.username,
          roles: createdUser.roles.map((role) => role.name),
          roleIds: createdUser.roles.map((role) => role.id),
          serverIds: serverIds ?? undefined,
        },
      });

      // Broadcast user_created event to all admin SSE subscribers
      const wsGateway = (app as any).wsGateway;
      if (wsGateway?.pushToAdminSubscribers) {
        wsGateway.pushToAdminSubscribers('user_created', {
          type: 'user_created',
          user: createdUser,
          createdBy: user.userId,
          timestamp: new Date().toISOString(),
        });
      }

      return reply.status(201).send({ ...createdUser, warning: emailWarning });
    }
  );

  // Update user (requires user.update and user.set_roles for role changes)
  app.put(
    '/users/:userId',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user;

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
        if (!(canManageUsers(request, 'set_roles'))) {
          return reply.status(403).send({ error: 'User set_roles permission required' });
        }

        // Prevent self-modification: users cannot change their own roles
        if (userId === user.userId) {
          return reply.status(403).send({ error: 'Cannot modify your own roles' });
        }
      } else {
        if (!(canManageUsers(request, 'update'))) {
          return reply.status(403).send({ error: 'User update permission required' });
        }
      }

      const existingUser = await prisma.user.findUnique({
        where: { id: userId },
        include: { roles: { select: { id: true, permissions: true } } },
      });

      if (!existingUser) {
        return reply.status(404).send({ error: 'User not found' });
      }
      const targetPerms = existingUser.roles.flatMap((role) => (role.permissions as string[]) ?? []);
      const targetIsAdminEquivalent =
        targetPerms.includes('*') || targetPerms.includes('admin.write');
      if (password && targetIsAdminEquivalent && !(user.permissions ?? []).includes('*')) {
        return reply.status(403).send({ error: 'Insufficient permissions to reset this user password' });
      }

      // Role-change guards for Administrator demotion: removing the
      // Administrator role from a user who currently holds it requires the
      // wildcard permission and must never remove the last administrator.
      if (roleIds) {
        const adminRole = await prisma.role.findUnique({ where: { name: 'Administrator' } });
        if (adminRole) {
          const targetHasAdmin = existingUser.roles.some((role) => role.id === adminRole.id);
          const newRolesIncludeAdmin = roleIds.includes(adminRole.id);
          if (targetHasAdmin && !newRolesIncludeAdmin) {
            if (!(user.permissions ?? []).includes('*')) {
              return reply.status(403).send({ error: 'Insufficient permissions to demote this administrator' });
            }
            const adminCount = await prisma.user.count({
              where: { roles: { some: { name: 'Administrator' } } },
            });
            if (adminCount <= 1) {
              return reply.status(409).send({ error: 'Cannot remove the last administrator' });
            }
          }
        }
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

      // Validate that the acting user can grant all permissions in the assigned roles
      // This prevents privilege escalation: an admin with user.set_roles but not *
      // should not be able to assign a role with permissions they don't have.
      if (roleIds?.length) {
        const actingPerms: string[] = user?.permissions ?? [];
        const actingHasWildcard = actingPerms.includes('*');
        if (!actingHasWildcard) {
          for (const role of rolesToAssign) {
            const cantGrant = (role.permissions as string[]).filter(
              (p) => !actingPerms.includes(p),
            );
            if (cantGrant.length > 0) {
              return reply.status(403).send({
                error: `Cannot assign role with permissions you don't have: ${cantGrant.join(', ')}`,
              });
            }
          }
        }
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
        // Change the target user's password via better-auth's admin plugin.
        // setUserPassword({ userId, newPassword }) derives the session context
        // internally from the acting admin's headers — the previous
        // auth.api.setPassword call was an invalid method (it does not exist).
        try {
          // (admin plugin endpoints are not reflected on auth.api's type —
          // same convention as banUser/unbanUser below)
          await (auth.api as any).setUserPassword({
            headers: fromNodeHeaders(request.headers as Record<string, string | string[] | undefined>),
            body: { userId, newPassword: password },
          });
        } catch (err: any) {
          request.log.error({ err }, 'Failed to set user password');
          return reply.status(400).send({
            error: err?.message || 'Failed to update user password',
          });
        }
        // Invalidate the target user's existing sessions after a password change.
        await prisma.session.deleteMany({ where: { userId } }).catch(() => {});
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

      if (roleIds) {
        invalidateUserPermissions(userId);
        invalidateAdminUserCache(userId);
        invalidateNodeAccessCache(userId);
      }

      if (serverIds) {
        const uniqueServerIds = Array.from(new Set(serverIds));
        const existingServers = await prisma.server.findMany({
          where: { id: { in: uniqueServerIds } },
          select: { id: true, ownerId: true, nodeId: true },
        });

        if (existingServers.length !== uniqueServerIds.length) {
          return reply.status(400).send({ error: 'One or more servers are invalid' });
        }

        // Validate requesting user can grant access to these servers
        const isAdmin = checkPerm(request, 'admin.write');
        if (!isAdmin) {
          for (const server of existingServers) {
            const canGrant = server.ownerId === user.userId ||
              await hasNodeAccess(prisma, user.userId, server.nodeId);
            if (!canGrant) {
              return reply.status(403).send({
                error: `Cannot grant access to server ${server.id}`,
              });
            }
          }
        }

        // Validate server permissions don't exceed what the requester has
        if (serverPermissions && serverPermissions.length > 0) {
          const requesterPerms: string[] = request.user?.permissions ?? [];
          const hasWildcard = requesterPerms.includes('*');
          if (!hasWildcard) {
            const cantGrant = serverPermissions.filter(
              (p) => !requesterPerms.includes(p),
            );
            if (cantGrant.length > 0) {
              return reply.status(403).send({
                error: `Cannot grant server permissions you don't have: ${cantGrant.join(', ')}`,
              });
            }
          }
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

        const removedAccess = await prisma.serverAccess.findMany({
          where: { userId, serverId: { notIn: uniqueServerIds } },
          select: { serverId: true },
        });
        await prisma.serverAccess.deleteMany({
          where: { userId, serverId: { notIn: uniqueServerIds } },
        });
        // Instantly revoke SFTP tokens for all removed server assignments
        for (const removed of removedAccess) {
          revokeSftpTokensForUser(userId, removed.serverId);
        }
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
        request,
        action: 'user_update',
        resource: 'user',
        resourceId: userId,
        details: {
          email: updatedUser.email,
          username: updatedUser.username,
          roles: updatedUser.roles.map((role) => role.name),
          roleIds: updatedUser.roles.map((role) => role.id),
          serverIds: serverIds ?? undefined,
        },
      });

      // Broadcast user_updated event
      const wsGatewayUserUpdated = (app as any).wsGateway;
      if (wsGatewayUserUpdated?.pushToAdminSubscribers) {
        wsGatewayUserUpdated.pushToAdminSubscribers('user_updated', {
          type: 'user_updated',
          userId: updatedUser.id,
          email: updatedUser.email,
          username: updatedUser.username,
          roles: updatedUser.roles,
          updatedBy: user.userId,
          timestamp: new Date().toISOString(),
        });
      }

      return reply.send(updatedUser);
    }
  );

  // Get user server access (requires user.read)
  app.get(
    '/users/:userId/servers',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user;

      if (!(canManageUsers(request, 'read'))) {
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
      const user = request.user;

      if (!(checkPerm(request, 'role.read'))) {
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
  app.post(
    '/users/:userId/delete',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user;

      if (!(canManageUsers(request, 'delete'))) {
        return reply.status(403).send({ error: 'User delete permission required' });
      }

      const { userId } = request.params as { userId: string };

      if (userId === user.userId) {
        return reply.status(400).send({ error: 'Cannot delete the current user' });
      }

      const existingUser = await prisma.user.findUnique({
        where: { id: userId },
        include: { roles: true },
      });
      if (!existingUser) {
        return reply.status(404).send({ error: 'User not found' });
      }

      // Hierarchy guard: deleting an admin-equivalent user (Administrator role
      // or admin.write permission via any role) requires the wildcard permission.
      const targetEffectivePerms = existingUser.roles.flatMap(
        (role) => (role.permissions as string[]) ?? [],
      );
      const targetIsAdminEquivalent = existingUser.roles.some((role) => role.name === 'Administrator') ||
        targetEffectivePerms.includes('admin.write');
      if (targetIsAdminEquivalent && !(user.permissions ?? []).includes('*')) {
        return reply.status(403).send({ error: 'Insufficient permissions to delete this user' });
      }

      // Last-admin guard: never allow deleting the final Administrator.
      if (existingUser.roles.some((role) => role.name === 'Administrator')) {
        const adminCount = await prisma.user.count({
          where: { roles: { some: { name: 'Administrator' } } },
        });
        if (adminCount <= 1) {
          return reply.status(409).send({ error: 'Cannot delete the last administrator' });
        }
      }

      // Check if the user owns any servers — block deletion unless force-transferring
      const ownedServers = await prisma.server.findMany({
        where: { ownerId: userId },
        select: { id: true, name: true },
      });

      if (ownedServers.length > 0) {
        const { force, transferToUserId } = request.body as { force?: boolean; transferToUserId?: string };

        if (force && transferToUserId) {
          // Validate target user exists
          const targetUser = await prisma.user.findUnique({ where: { id: transferToUserId } });
          if (!targetUser) {
            return reply.status(400).send({ error: 'Transfer target user not found' });
          }
          if (transferToUserId === userId) {
            return reply.status(400).send({ error: 'Cannot transfer servers to the user being deleted' });
          }

          // Transfer ownership of all servers
          const serverIds = ownedServers.map(s => s.id);
          await prisma.$transaction([
            ...serverIds.map(id =>
              prisma.server.update({
                where: { id },
                data: { ownerId: transferToUserId },
              }),
            ),
          ]);

          // Ensure the target user has ServerAccess for each transferred server
          for (const id of serverIds) {
            await prisma.serverAccess.upsert({
              where: { userId_serverId: { userId: transferToUserId, serverId: id } },
              create: {
                userId: transferToUserId,
                serverId: id,
                permissions: [
                  'server.start', 'server.stop', 'server.read', 'server.install',
                  'alert.read', 'alert.create', 'alert.update', 'alert.delete',
                  'file.read', 'file.write', 'console.read', 'console.write',
                  'server.delete',
                ],
              },
              update: {}, // Keep existing permissions
            });
          }
        } else {
          // Return helpful error with server list
          return reply.status(409).send({
            error: `User owns ${ownedServers.length} server(s). Transfer ownership first or use { force: true, transferToUserId: "..." } to auto-transfer.`,
            ownedServers: ownedServers.map(s => ({ id: s.id, name: s.name })),
          });
        }
      }

      // Revoke all SFTP tokens for this user across all servers
      revokeSftpTokensForUser(userId);

      // Disconnect all WebSocket sessions for this user
      const wsGateway = (app as any).wsGateway;
      if (wsGateway?.disconnectUser) {
        wsGateway.disconnectUser(userId);
      }

      // Delete the user (cascades: sessions, apikeys, passkeys, 2fa, serverAccess, nodeAssignments, etc.)
      await prisma.user.delete({ where: { id: userId } });

      await createAuditLog(user.userId, {
        request,
        action: 'user_delete',
        resource: 'user',
        resourceId: userId,
        details: {
          email: existingUser.email,
          username: existingUser.username,
          banned: existingUser.banned,
          twoFactorEnabled: existingUser.twoFactorEnabled,
          ownedServerCount: ownedServers.length,
          ownedServers: ownedServers.map(s => s.name),
        },
      });

      // Fire webhook
      const webhookService: any = (app as any).webhookService;
      if (webhookService) {
        webhookService.userDeleted(userId, existingUser.email, existingUser.username, user.userId).catch(() => {});
      }

      // Broadcast user_deleted event to all admin SSE subscribers
      if (wsGateway?.pushToAdminSubscribers) {
        wsGateway.pushToAdminSubscribers('user_deleted', {
          type: 'user_deleted',
          userId,
          email: existingUser.email,
          username: existingUser.username,
          deletedBy: user.userId,
          timestamp: new Date().toISOString(),
        });
      }

      return reply.send({ success: true });
    }
  );

  // Ban a user (requires user.ban permission)
  // Uses Better Auth's admin plugin banUser() for DB updates + session revocation,
  // then Catalyst-specific post-processing (SFTP revocation, WebSocket disconnect,
  // audit log, admin broadcast) runs via the after hook in auth.ts.
  app.post(
    '/users/:userId/ban',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!canManageUsers(request, 'ban')) {
        return reply.status(403).send({ error: 'User ban permission required' });
      }

      const { userId } = request.params as { userId: string };
      const { reason, expiresInSeconds } = request.body as { reason?: string; expiresInSeconds?: number } || {};
      const user = request.user;

      if (userId === user.userId) {
        return reply.status(400).send({ error: 'Cannot ban yourself' });
      }

      const existingUser = await prisma.user.findUnique({ where: { id: userId }, include: { roles: { select: { permissions: true } } } });
      if (!existingUser) {
        return reply.status(404).send({ error: 'User not found' });
      }
      const banTargetPerms = existingUser.roles.flatMap((role) => (role.permissions as string[]) ?? []);
      if ((banTargetPerms.includes('*') || banTargetPerms.includes('admin.write')) && !(user.permissions ?? []).includes('*')) {
        return reply.status(403).send({ error: 'Insufficient permissions to ban this user' });
      }

      if (existingUser.banned) {
        return reply.status(400).send({ error: 'User is already banned' });
      }

      // Delegate to Better Auth's admin plugin — sets banned/banReason/banExpires
      // and revokes all sessions.  Catalyst-specific post-processing (SFTP token
      // revocation, WebSocket disconnect, audit log, admin broadcast) is handled
      // by the after hook in auth.ts.
      try {
        await (auth.api as any).banUser({
          headers: fromNodeHeaders(request.headers as Record<string, string | string[] | undefined>),
          body: {
            userId,
            banReason: reason || 'No reason',
            ...(expiresInSeconds ? { banExpiresIn: expiresInSeconds } : {}),
          },
        });
      } catch (err: any) {
        // Better Auth may throw FORBIDDEN if the session user lacks admin plugin
        // permissions.  Since Catalyst uses its own permission system, fall back
        // to direct Prisma update + session revocation if the plugin rejects.
        if (err?.status === 403 || err?.statusCode === 403) {
          await prisma.user.update({
            where: { id: userId },
            data: {
              banned: true,
              banReason: reason || null,
              ...(expiresInSeconds ? { banExpires: new Date(Date.now() + expiresInSeconds * 1000) } : {}),
            },
          });
          await prisma.session.deleteMany({ where: { userId } });
        } else {
          throw err;
        }
      }

      return reply.send({ success: true });
    },
  );

  // Unban a user (requires user.unban permission)
  // Uses Better Auth's admin plugin unbanUser() for DB updates.
  // Catalyst-specific post-processing (audit log, admin broadcast) runs via
  // the after hook in auth.ts.
  app.post(
    '/users/:userId/unban',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!canManageUsers(request, 'unban')) {
        return reply.status(403).send({ error: 'User unban permission required' });
      }

      const { userId } = request.params as { userId: string };
      const user = request.user;

      const existingUser = await prisma.user.findUnique({ where: { id: userId } });
      if (!existingUser) {
        return reply.status(404).send({ error: 'User not found' });
      }

      if (!existingUser.banned) {
        return reply.status(400).send({ error: 'User is not banned' });
      }

      // Delegate to Better Auth's admin plugin — clears banned/banReason/banExpires.
      // Catalyst-specific post-processing (audit log, admin broadcast) is handled
      // by the after hook in auth.ts.
      try {
        await (auth.api as any).unbanUser({
          headers: fromNodeHeaders(request.headers as Record<string, string | string[] | undefined>),
          body: { userId },
        });
      } catch (err: any) {
        // Better Auth may throw FORBIDDEN if the session user lacks admin plugin
        // permissions.  Since Catalyst uses its own permission system, fall back
        // to direct Prisma update if the plugin rejects.
        if (err?.status === 403 || err?.statusCode === 403) {
          await prisma.user.update({
            where: { id: userId },
            data: { banned: false, banReason: null, banExpires: null },
          });
        } else {
          throw err;
        }
      }

      return reply.send({ success: true });
    },
  );

  // ── User security management endpoints ──

  // Wipe all passkeys for a user (requires user.update)
  app.delete(
    '/users/:userId/passkeys',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!(canManageUsers(request, 'update'))) {
        return reply.status(403).send({ error: 'User update permission required' });
      }
      const { userId } = request.params as { userId: string };
      const existingUser = await prisma.user.findUnique({ where: { id: userId }, include: { roles: { select: { permissions: true } } } });
      if (!existingUser) return reply.status(404).send({ error: 'User not found' });
      const targetPerms = existingUser.roles.flatMap((role) => (role.permissions as string[]) ?? []);
      if ((targetPerms.includes('*') || targetPerms.includes('admin.write')) && !((request.user as any).permissions ?? []).includes('*')) {
        return reply.status(403).send({ error: 'Insufficient permissions to modify this user' });
      }

      const result = await prisma.passkey.deleteMany({ where: { userId } });
      await createAuditLog((request.user as any).userId, {
        request,
        action: 'user_passkeys_wiped',
        resource: 'user',
        resourceId: userId,
        details: { username: existingUser.username, count: result.count },
      });
      return reply.send({ success: true, wiped: result.count });
    }
  );

  // Wipe 2FA for a user (requires user.update)
  app.delete(
    '/users/:userId/two-factor',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!(canManageUsers(request, 'update'))) {
        return reply.status(403).send({ error: 'User update permission required' });
      }
      const { userId } = request.params as { userId: string };
      const existingUser = await prisma.user.findUnique({ where: { id: userId }, include: { roles: { select: { permissions: true } } } });
      if (!existingUser) return reply.status(404).send({ error: 'User not found' });
      const targetPerms = existingUser.roles.flatMap((role) => (role.permissions as string[]) ?? []);
      if ((targetPerms.includes('*') || targetPerms.includes('admin.write')) && !((request.user as any).permissions ?? []).includes('*')) {
        return reply.status(403).send({ error: 'Insufficient permissions to modify this user' });
      }

      await prisma.twoFactor.deleteMany({ where: { userId } });
      await prisma.user.update({ where: { id: userId }, data: { twoFactorEnabled: false } });
      await createAuditLog((request.user as any).userId, {
        request,
        action: 'user_2fa_wiped',
        resource: 'user',
        resourceId: userId,
        details: { username: existingUser.username },
      });
      return reply.send({ success: true });
    }
  );

  // Enforce 2FA for a user (requires user.update)
  app.put(
    '/users/:userId/enforce-2fa',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!(canManageUsers(request, 'update'))) {
        return reply.status(403).send({ error: 'User update permission required' });
      }
      const { userId } = request.params as { userId: string };
      const { enforce } = request.body as { enforce?: boolean };
      const existingUser = await prisma.user.findUnique({
        where: { id: userId },
        include: { twoFactor: true },
      });
      if (!existingUser) return reply.status(404).send({ error: 'User not found' });

      if (enforce && !existingUser.twoFactor.length) {
        return reply.status(400).send({ error: 'Cannot enforce 2FA: user has not set up 2FA yet. Set it up first, then enforce.' });
      }

      await prisma.user.update({
        where: { id: userId },
        data: { twoFactorEnabled: !!enforce },
      });
      await createAuditLog((request.user as any).userId, {
        request,
        action: enforce ? 'user_2fa_enforced' : 'user_2fa_unenforced',
        resource: 'user',
        resourceId: userId,
        details: { username: existingUser.username, twoFactorEnabled: !!enforce },
      });
      return reply.send({ success: true, twoFactorEnabled: !!enforce });
    }
  );

  // Unlink an SSO account from a user (requires user.update)
  app.delete(
    '/users/:userId/accounts/:accountId',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!(canManageUsers(request, 'update'))) {
        return reply.status(403).send({ error: 'User update permission required' });
      }
      const { userId, accountId } = request.params as { userId: string; accountId: string };
      const existingUser = await prisma.user.findUnique({
        where: { id: userId },
        include: { accounts: true },
      });
      if (!existingUser) return reply.status(404).send({ error: 'User not found' });

      const account = existingUser.accounts.find((a: any) => a.id === accountId);
      if (!account) return reply.status(404).send({ error: 'Account not found' });

      // Prevent unlinking if this is the only authentication method (no password and no other accounts)
      const hasPassword = existingUser.accounts.some((a: any) => a.providerId === 'credential');
      const otherAccounts = existingUser.accounts.filter((a: any) => a.id !== accountId);
      if (!hasPassword && otherAccounts.length === 0) {
        return reply.status(400).send({ error: 'Cannot unlink: this is the only authentication method. Set a password first.' });
      }

      await prisma.account.delete({ where: { id: accountId } });
      await createAuditLog((request.user as any).userId, {
        request,
        action: 'user_sso_unlinked',
        resource: 'user',
        resourceId: userId,
        details: { providerId: account.providerId, accountId: account.accountId },
      });
      return reply.send({ success: true });
    }
  );

  // Manually verify a user's email address (requires user.update)
  // Marks the user's email as verified without sending an email.
  app.put(
    '/users/:userId/verify-email',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!(canManageUsers(request, 'update'))) {
        return reply.status(403).send({ error: 'User update permission required' });
      }
      const { userId } = request.params as { userId: string };
      const existingUser = await prisma.user.findUnique({ where: { id: userId } });
      if (!existingUser) return reply.status(404).send({ error: 'User not found' });

      if (existingUser.emailVerified) {
        return reply.status(400).send({ error: 'Email is already verified' });
      }

      await prisma.user.update({
        where: { id: userId },
        data: { emailVerified: true },
      });

      await createAuditLog((request.user as any).userId, {
        request,
        action: 'user_email_verified',
        resource: 'user',
        resourceId: userId,
        details: { email: existingUser.email, username: existingUser.username, method: 'admin_manual' },
      });

      // Broadcast user_updated event
      try {
        const { getWsGateway } = await import('../websocket/gateway');
        const wsGateway = getWsGateway();
        if (wsGateway?.pushToAdminSubscribers) {
          wsGateway.pushToAdminSubscribers('user_updated', {
            type: 'user_updated',
            userId,
            emailVerified: true,
            timestamp: new Date().toISOString(),
          });
        }
      } catch { /* non-critical */ }

      return reply.send({ success: true });
    }
  );

  // Get all nodes with details (requires node.read)
  app.get(
    '/nodes',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user;

      if (!(checkPerm(request, 'node.read'))) {
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
      const user = request.user;

      if (!(checkPerm(request, 'server.read'))) {
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
      const user = request.user;

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
      if (!(checkPerm(request, requiredPerm))) {
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

      // Validate per-server access for non-admin users
      const isAdmin = checkPerm(request, 'admin.write');
      if (!isAdmin) {
        for (const server of servers) {
          const access = await prisma.serverAccess.findUnique({
            where: { userId_serverId: { userId: user.userId, serverId: server.id } },
          });
          const hasExplicitPerm = access?.permissions.includes(requiredPerm);
          const canAccess = server.ownerId === user.userId || hasExplicitPerm ||
            await hasNodeAccess(prisma, user.userId, server.nodeId);
          if (!canAccess) {
            return reply.status(403).send({
              error: `Cannot perform ${action} on server ${server.id}: access denied`,
            });
          }
        }
      }

      const serverMap = new Map(servers.map((server) => [server.id, server]));
      const missing = uniqueServerIds.filter((id) => !serverMap.has(id));
      if (missing.length) {
        return reply.status(404).send({ error: 'One or more servers were not found', missing });
      }

      const gateway = app.wsGateway;
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
              const serverDir = process.env.SERVER_DATA_DIR || '/var/lib/catalyst/servers';
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
              await createAuditLog(user.userId, {
                action: 'server.start',
                resource: 'server',
                resourceId: server.id,
                request,
                details: buildServerAuditDetails(server, {
                  bulk: true,
                  bulkAction: action,
                  newStatus: 'starting',
                  nodeOnline: server.node?.isOnline,
                }),
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
              await createAuditLog(user.userId, {
                action: 'server.stop',
                resource: 'server',
                resourceId: server.id,
                request,
                details: buildServerAuditDetails(server, {
                  bulk: true,
                  bulkAction: action,
                  force: false,
                  newStatus: 'stopping',
                }),
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
              await createAuditLog(user.userId, {
                action: 'server.kill',
                resource: 'server',
                resourceId: server.id,
                request,
                details: buildServerAuditDetails(server, {
                  bulk: true,
                  bulkAction: action,
                  force: true,
                  newStatus: 'stopping',
                }),
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
              const serverDir = process.env.SERVER_DATA_DIR || '/var/lib/catalyst/servers';
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
              await createAuditLog(user.userId, {
                action: 'server.restart',
                resource: 'server',
                resourceId: server.id,
                request,
                details: buildServerAuditDetails(server, {
                  bulk: true,
                  bulkAction: action,
                  wasRunning: server.status === ServerState.RUNNING,
                  newStatus: 'starting',
                }),
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
              await createAuditLog(user.userId, {
                action: 'server.suspend',
                resource: 'server',
                resourceId: server.id,
                request,
                details: buildServerAuditDetails(server, {
                  bulk: true,
                  bulkAction: action,
                  reason: reason?.trim() || undefined,
                  newStatus: 'suspended',
                  previousStatus: server.status,
                }),
              });
              await prisma.serverLog.create({
                data: {
                  serverId: server.id,
                  stream: 'system',
                  data: `Server suspended${reason?.trim() ? `: ${reason.trim()}` : ''}`,
                },
              });

              // Broadcast server_suspended event for bulk action
              const wsGatewayBulkSuspend = (app as any).wsGateway;
              if (wsGatewayBulkSuspend?.pushToAdminSubscribers) {
                wsGatewayBulkSuspend.pushToAdminSubscribers('server_suspended', {
                  type: 'server_suspended',
                  serverId: server.id,
                  serverName: server.name,
                  suspendedBy: user.userId,
                  timestamp: new Date().toISOString(),
                });
              }
              if (wsGatewayBulkSuspend?.pushToGlobalSubscribers) {
                wsGatewayBulkSuspend.pushToGlobalSubscribers('server_suspended', {
                  type: 'server_suspended',
                  serverId: server.id,
                  serverName: server.name,
                  suspendedBy: user.userId,
                  timestamp: new Date().toISOString(),
                });
              }

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
              await createAuditLog(user.userId, {
                action: 'server.unsuspend',
                resource: 'server',
                resourceId: server.id,
                request,
                details: buildServerAuditDetails(server, {
                  bulk: true,
                  bulkAction: action,
                  previousSuspensionReason: server.suspensionReason ?? undefined,
                  newStatus: 'stopped',
                }),
              });
              await prisma.serverLog.create({
                data: {
                  serverId: server.id,
                  stream: 'system',
                  data: 'Server unsuspended',
                },
              });

              // Broadcast server_unsuspended event for bulk action
              const wsGatewayBulkUnsuspend = (app as any).wsGateway;
              if (wsGatewayBulkUnsuspend?.pushToAdminSubscribers) {
                wsGatewayBulkUnsuspend.pushToAdminSubscribers('server_unsuspended', {
                  type: 'server_unsuspended',
                  serverId: server.id,
                  serverName: server.name,
                  unsuspendedBy: user.userId,
                  timestamp: new Date().toISOString(),
                });
              }
              if (wsGatewayBulkUnsuspend?.pushToGlobalSubscribers) {
                wsGatewayBulkUnsuspend.pushToGlobalSubscribers('server_unsuspended', {
                  type: 'server_unsuspended',
                  serverId: server.id,
                  serverName: server.name,
                  unsuspendedBy: user.userId,
                  timestamp: new Date().toISOString(),
                });
              }

              return { serverId: server.id, status: 'success' };
            }

            if (action === 'delete') {
              if (isSuspensionEnforced() && server.suspendedAt && isSuspensionDeleteBlocked()) {
                return { serverId: server.id, status: 'skipped', error: 'Server is suspended' };
              }
              if (server.status !== 'stopped') {
                return { serverId: server.id, status: 'skipped', error: 'Server must be stopped' };
              }

              // Drop provisioned MySQL databases BEFORE cascade-deleting the Server row,
              // otherwise host-side DB/user rows are orphaned permanently.
              const { dropDatabase } = await import('../services/mysql.js');
              const serverDatabases = await prisma.serverDatabase.findMany({
                where: { serverId: server.id },
                include: { host: true },
              });
              const dbDropFailures: Array<{ id: string; name: string; error: string }> = [];
              for (const database of serverDatabases) {
                try {
                  await dropDatabase(database.host, database.name, database.username);
                } catch (error: any) {
                  const msg = describeError(error);
                  dbDropFailures.push({ id: database.id, name: database.name, error: msg });
                  app.log?.warn?.({
                    serverId: server.id,
                    databaseId: database.id,
                    error: msg,
                  }, 'Failed to drop server database during admin bulk delete — continuing');
                  captureSystemError({
                    level: 'warn',
                    component: 'AdminRoutes',
                    message: `dropDatabase failed during admin bulk delete: ${msg}`,
                    metadata: {
                      serverId: server.id,
                      databaseId: database.id,
                      databaseName: database.name,
                    },
                  }).catch(() => {});
                }
              }

              // Best-effort agent cleanup before cascade delete.
              const wsGatewayDel = (app as any).wsGateway;
              let agentOffline = false;
              if (wsGatewayDel && server.nodeId) {
                if (wsGatewayDel.removeDiscoveredContainer) {
                  wsGatewayDel.removeDiscoveredContainer(server.nodeId, server.id);
                }
                if (typeof wsGatewayDel.sendToAgent === 'function') {
                  const sent = await wsGatewayDel.sendToAgent(server.nodeId, {
                    type: 'delete_server',
                    serverId: server.id,
                    serverUuid: server.uuid,
                  });
                  if (!sent) {
                    agentOffline = true;
                    app.log?.warn?.({
                      serverId: server.id,
                      nodeId: server.nodeId,
                    }, 'Agent offline during admin bulk delete — container cleanup skipped');
                  }
                }
              }

              await prisma.$transaction(async (tx) => {
                await releaseIpForServer(tx, server.id);
                await tx.server.delete({ where: { id: server.id } });
              });

              await createAuditLog(user.userId, {
                action: 'server.delete',
                resource: 'server',
                resourceId: server.id,
                request,
                details: buildServerAuditDetails(server, {
                  bulk: true,
                  bulkAction: action,
                  serverName: server.name,
                  ...(agentOffline ? { agentCleanup: false, warning: 'agent offline' } : { agentCleanup: true }),
                  ...(dbDropFailures.length > 0
                    ? { databaseWarnings: dbDropFailures }
                    : {}),
                }),
              });

              const wsGateway = (app as any).wsGateway;
              if (wsGateway?.pushToAdminSubscribers) {
                wsGateway.pushToAdminSubscribers('server_deleted', { type: 'server_deleted', serverId: server.id, serverName: server.name, deletedBy: user.userId, timestamp: new Date().toISOString() });
              }
              if (wsGateway?.pushToGlobalSubscribers) {
                wsGateway.pushToGlobalSubscribers('server_deleted', { type: 'server_deleted', serverId: server.id, serverName: server.name, deletedBy: user.userId, timestamp: new Date().toISOString() });
              }
              return {
                serverId: server.id,
                status: 'success',
                ...(agentOffline ? { agentCleanup: false } : {}),
                ...(dbDropFailures.length > 0
                  ? {
                      databaseWarnings: dbDropFailures,
                      warning: `${dbDropFailures.length} database(s) could not be dropped on the host and may need manual cleanup.`,
                    }
                  : {}),
              };
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
      const user = request.user;

      if (!(checkPerm(request, 'admin.read'))) {
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

      // Expose details under both `details` and `metadata` so FE/clients never miss payload.
      reply.send({
        logs: logs.map((log) => ({
          ...log,
          details: log.details ?? null,
          metadata: log.details ?? null,
          // Convenience top-level IP when present in details
          ipAddress:
            (log.details && typeof log.details === 'object' && !Array.isArray(log.details)
              ? ((log.details as any).ip || (log.details as any)?._request?.ip)
              : null) ?? null,
        })),
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
      const user = request.user;

      if (!(checkPerm(request, 'admin.write'))) {
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

  // Get system errors (requires admin.read)
  app.get(
    '/system-errors',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user;

      if (!(checkPerm(request, 'admin.read'))) {
        return reply.status(403).send({ error: 'Admin read permission required' });
      }

      const {
        page = 1,
        limit = 50,
        level,
        component,
        nodeId,
        resolved,
        from,
        to,
      } = request.query as {
        page?: number;
        limit?: number;
        level?: string;
        component?: string;
        nodeId?: string;
        resolved?: string;
        from?: string;
        to?: string;
      };

      const skip = (Number(page) - 1) * Number(limit);

      const where: any = {};
      if (level) where.level = level;
      if (component) where.component = { contains: component };
      if (nodeId) where.nodeId = { contains: nodeId };
      if (resolved !== undefined) where.resolved = resolved === 'true';
      if (from || to) {
        const parsedFrom = from ? new Date(from) : undefined;
        const parsedTo = to ? new Date(to) : undefined;
        if (parsedFrom && Number.isNaN(parsedFrom.getTime())) {
          return reply.status(400).send({ error: 'Invalid from timestamp' });
        }
        if (parsedTo && Number.isNaN(parsedTo.getTime())) {
          return reply.status(400).send({ error: 'Invalid to timestamp' });
        }
        where.createdAt = {
          ...(parsedFrom ? { gte: parsedFrom } : {}),
          ...(parsedTo ? { lte: parsedTo } : {}),
        };
      }

      const [errors, total] = await Promise.all([
        prisma.systemError.findMany({
          where,
          skip,
          take: Number(limit),
          orderBy: {
            createdAt: 'desc',
          },
        }),
        prisma.systemError.count({ where }),
      ]);

      reply.send({
        errors,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / Number(limit)),
        },
      });
    }
  );

  // Export system errors (requires admin.read)
  app.get(
    '/system-errors/export',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!(checkPerm(request, 'admin.read'))) {
        return reply.status(403).send({ error: 'Admin read permission required' });
      }

      const {
        level,
        component,
        nodeId,
        resolved,
        from,
        to,
        format = 'json',
      } = request.query as {
        level?: string;
        component?: string;
        nodeId?: string;
        resolved?: string;
        from?: string;
        to?: string;
        format?: string;
      };

      if (format !== 'json' && format !== 'markdown') {
        return reply.status(400).send({ error: 'Invalid export format' });
      }

      const where: any = {};
      if (level) where.level = level;
      if (component) where.component = { contains: component };
      if (nodeId) where.nodeId = { contains: nodeId };
      if (resolved !== undefined) where.resolved = resolved === 'true';
      if (from || to) {
        const parsedFrom = from ? new Date(from) : undefined;
        const parsedTo = to ? new Date(to) : undefined;
        if (parsedFrom && Number.isNaN(parsedFrom.getTime())) {
          return reply.status(400).send({ error: 'Invalid from timestamp' });
        }
        if (parsedTo && Number.isNaN(parsedTo.getTime())) {
          return reply.status(400).send({ error: 'Invalid to timestamp' });
        }
        where.createdAt = {
          ...(parsedFrom ? { gte: parsedFrom } : {}),
          ...(parsedTo ? { lte: parsedTo } : {}),
        };
      }

      const errors = await prisma.systemError.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 5000,
      });

      if (format === 'json') {
        reply.send({
          exportedAt: new Date().toISOString(),
          count: errors.length,
          filters: { level, component, nodeId, resolved, from, to },
          errors,
        });
        return;
      }

      const fence = (value: string) => value.replace(/```/g, "'''");
      const lines: string[] = [];
      lines.push(`# System Errors Export`);
      lines.push(``);
      lines.push(`Exported: ${new Date().toISOString()}`);
      lines.push(`Count: ${errors.length}`);
      lines.push(``);
      for (const error of errors) {
        lines.push(`## [${error.level}] ${error.component}`);
        lines.push(`- ID: ${error.id}`);
        lines.push(`- Status: ${error.resolved ? 'Resolved' : 'Unresolved'}`);
        lines.push(`- Timestamp: ${error.createdAt.toISOString()}`);
        if (error.requestId) lines.push(`- Request ID: ${error.requestId}`);
        if (error.userId) lines.push(`- User ID: ${error.userId}`);
        if (error.nodeId) lines.push(`- Node ID: ${error.nodeId}`);
        lines.push(``);
        lines.push(`Message:`);
        lines.push('```');
        lines.push(fence(error.message));
        lines.push('```');
        if (error.stack) {
          lines.push(``);
          lines.push(`Stack:`);
          lines.push('```');
          lines.push(fence(error.stack));
          lines.push('```');
        }
        if (error.metadata && typeof error.metadata === 'object' && Object.keys(error.metadata as object).length > 0) {
          lines.push(``);
          lines.push(`Metadata:`);
          lines.push('```json');
          lines.push(fence(JSON.stringify(error.metadata, null, 2)));
          lines.push('```');
        }
        lines.push(``);
        lines.push(`---`);
        lines.push(``);
      }
      reply.type('text/markdown').send(lines.join('\n'));
    }
  );

  // Resolve a system error (requires admin.write)
  app.post(
    '/system-errors/:id/resolve',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user;

      if (!(checkPerm(request, 'admin.write'))) {
        return reply.status(403).send({ error: 'Admin write permission required' });
      }

      const { id } = request.params as { id: string };

      const error = await prisma.systemError.findUnique({ where: { id } });
      if (!error) {
        return reply.status(404).send({ error: 'System error not found' });
      }

      const updated = await prisma.systemError.update({
        where: { id },
        data: { resolved: true },
      });

      reply.send({ success: true, error: updated });
    }
  );

  // Resolve all matching system errors (requires admin.write)
  app.post(
    '/system-errors/resolve-all',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!(checkPerm(request, 'admin.write'))) {
        return reply.status(403).send({ error: 'Admin write permission required' });
      }

      const { level, component, nodeId, resolved, from, to } = (request.body ?? {}) as {
        level?: string;
        component?: string;
        nodeId?: string;
        resolved?: string | boolean;
        from?: string;
        to?: string;
      };

      const where: any = {};
      if (level) where.level = level;
      if (component) where.component = { contains: component };
      if (nodeId) where.nodeId = { contains: nodeId };
      if (resolved !== undefined && resolved !== '' && resolved !== null) {
        where.resolved = resolved === true || resolved === 'true';
      } else {
        where.resolved = false;
      }
      if (from || to) {
        const parsedFrom = from ? new Date(from) : undefined;
        const parsedTo = to ? new Date(to) : undefined;
        if (parsedFrom && Number.isNaN(parsedFrom.getTime())) {
          return reply.status(400).send({ error: 'Invalid from timestamp' });
        }
        if (parsedTo && Number.isNaN(parsedTo.getTime())) {
          return reply.status(400).send({ error: 'Invalid to timestamp' });
        }
        where.createdAt = {
          ...(parsedFrom ? { gte: parsedFrom } : {}),
          ...(parsedTo ? { lte: parsedTo } : {}),
        };
      }

      const result = await prisma.systemError.updateMany({
        where,
        data: { resolved: true },
      });

      reply.send({ success: true, resolvedCount: result.count });
    }
  );

  // Security settings (admin only)
  app.get(
    '/security-settings',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user;

      if (!(checkPerm(request, 'admin.read'))) {
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
      const user = request.user;

      if (!(checkPerm(request, 'admin.write'))) {
        return reply.status(403).send({ error: 'Admin write permission required' });
      }

      const {
        authRateLimitMax = DEFAULT_SECURITY_SETTINGS.authRateLimitMax,
        authRateLimitWindowMs = DEFAULT_SECURITY_SETTINGS.authRateLimitWindowMs,
        fileRateLimitMax = DEFAULT_SECURITY_SETTINGS.fileRateLimitMax,
        fileRateLimitWindowMs = DEFAULT_SECURITY_SETTINGS.fileRateLimitWindowMs,
        consoleRateLimitMax = DEFAULT_SECURITY_SETTINGS.consoleRateLimitMax,
        consoleRateLimitWindowMs = DEFAULT_SECURITY_SETTINGS.consoleRateLimitWindowMs,
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
        fileTunnelRateLimitWindowMs = DEFAULT_SECURITY_SETTINGS.fileTunnelRateLimitWindowMs,
        fileTunnelMaxUploadMb = DEFAULT_SECURITY_SETTINGS.fileTunnelMaxUploadMb,
        fileTunnelMaxPendingPerNode = DEFAULT_SECURITY_SETTINGS.fileTunnelMaxPendingPerNode,
        fileTunnelConcurrentMax = DEFAULT_SECURITY_SETTINGS.fileTunnelConcurrentMax,
        requireEmailVerification = DEFAULT_SECURITY_SETTINGS.requireEmailVerification,
        registrationEnabled = DEFAULT_SECURITY_SETTINGS.registrationEnabled,
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
      if (Number(fileTunnelMaxUploadMb) > MAX_UPLOAD_MB_CEILING) {
        return reply.status(400).send({
          error: `Max upload size cannot exceed ${MAX_UPLOAD_MB_CEILING}MB`,
        });
      }

      const windowFields = [authRateLimitWindowMs, fileRateLimitWindowMs, consoleRateLimitWindowMs, fileTunnelRateLimitWindowMs];
      if (windowFields.some((value) => !Number.isFinite(value) || !isValidTimeWindowMs(Number(value)))) {
        return reply.status(400).send({ error: 'Time windows must be valid (1000, 60000, 3600000, 86400000, or 2592000000 ms)' });
      }

      await upsertSecuritySettings({
        authRateLimitMax: Number(authRateLimitMax),
        authRateLimitWindowMs: Number(authRateLimitWindowMs),
        fileRateLimitMax: Number(fileRateLimitMax),
        fileRateLimitWindowMs: Number(fileRateLimitWindowMs),
        consoleRateLimitMax: Number(consoleRateLimitMax),
        consoleRateLimitWindowMs: Number(consoleRateLimitWindowMs),
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
        fileTunnelRateLimitWindowMs: Number(fileTunnelRateLimitWindowMs),
        fileTunnelMaxUploadMb: sanitizeMaxUploadMb(Number(fileTunnelMaxUploadMb)),
        fileTunnelMaxPendingPerNode: Number(fileTunnelMaxPendingPerNode),
        fileTunnelConcurrentMax: Number(fileTunnelConcurrentMax),
        requireEmailVerification: Boolean(requireEmailVerification),
        registrationEnabled: Boolean(registrationEnabled),
      });

      await createAuditLog(user.userId, {
        request,
        action: 'security.settings.update',
        resource: 'system',
        details: {
          authRateLimitMax,
          authRateLimitWindowMs,
          fileRateLimitMax,
          fileRateLimitWindowMs,
          consoleRateLimitMax,
          consoleRateLimitWindowMs,
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
          fileTunnelRateLimitWindowMs,
          fileTunnelMaxUploadMb,
          fileTunnelMaxPendingPerNode,
          fileTunnelConcurrentMax,
          requireEmailVerification,
          registrationEnabled,
        },
      });

      try {
        const wsGateway = (app as any).wsGateway;
        const maxUploadBytes = maxUploadBytesFromMb(Number(fileTunnelMaxUploadMb));
        wsGateway?.broadcastToAgents?.({ type: 'file_upload_limit', maxUploadBytes });
        wsGateway?.pushToAdminSubscribers('security_settings_updated', { updatedBy: user.userId });
      } catch { /* ignore — WS push is best-effort */ }
      reply.send({ success: true });
    }
  );

  // System health check (admin only)
  app.get(
    '/health',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user;

      // Check admin permissions
      if (!(checkAnyPerm(request, ['*', 'admin.read']))) {
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
      const user = request.user;

      if (!(checkPerm(request, 'admin.read'))) {
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
      const user = request.user;

      if (!(checkPerm(request, 'admin.write'))) {
        return reply.status(403).send({ error: 'Admin write permission required' });
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

      // Wait for agent ack so panel knows CNI create succeeded/failed.
      const wsGateway = app.wsGateway;
      if (wsGateway?.requestFromAgent) {
        try {
          const agentResult = await wsGateway.requestFromAgent(nodeId, {
            type: 'create_network',
            networkName,
            cidr,
            gateway: gateway || undefined,
            rangeStart: startIp || undefined,
            rangeEnd: endIp || undefined,
          }, 30000);
          if (agentResult && agentResult.success === false) {
            captureSystemError({
              level: 'warn',
              component: 'AdminRoutes',
              message: `Agent failed to create network: ${agentResult.error || 'unknown'}`,
              metadata: { nodeId, networkName, error: agentResult.error },
            }).catch(() => {});
            console.error('Agent failed to create network', { nodeId, networkName, error: agentResult.error });
          }
        } catch (err: any) {
          captureSystemError({
            level: 'warn',
            component: 'AdminRoutes',
            message: `Failed to create network on agent: ${err?.message || err}`,
            stack: err?.stack,
            metadata: { nodeId, error: err?.message },
          }).catch(() => {});
          console.error('Failed to create network on agent', { nodeId, error: err?.message });
        }
      }

      reply.status(201).send({ success: true, data: pool });

      // Broadcast ip_pool_created event
      const wsGatewayIpPoolCreated = (app as any).wsGateway;
      if (wsGatewayIpPoolCreated?.pushToAdminSubscribers) {
        wsGatewayIpPoolCreated.pushToAdminSubscribers('ip_pool_created', {
          type: 'ip_pool_created',
          poolId: pool.id,
          nodeId,
          createdBy: user.userId,
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  // IPAM: update pool
  app.put(
    '/ip-pools/:poolId',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user;

      if (!(checkPerm(request, 'admin.write'))) {
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

      // Wait for agent ack so panel knows CNI update succeeded/failed.
      const wsGateway = app.wsGateway;
      if (wsGateway?.requestFromAgent) {
        try {
          const agentResult = await wsGateway.requestFromAgent(pool.nodeId, {
            type: 'update_network',
            oldName: pool.networkName,
            networkName: updated.networkName,
            cidr: updated.cidr,
            gateway: updated.gateway || undefined,
            rangeStart: updated.startIp || undefined,
            rangeEnd: updated.endIp || undefined,
          }, 30000);
          if (agentResult && agentResult.success === false) {
            captureSystemError({
              level: 'warn',
              component: 'AdminRoutes',
              message: `Agent failed to update network: ${agentResult.error || 'unknown'}`,
              metadata: { nodeId: pool.nodeId, error: agentResult.error },
            }).catch(() => {});
            console.error(`Agent failed to update network on ${pool.nodeId}:`, agentResult.error);
          }
        } catch (err: any) {
          captureSystemError({
            level: 'warn',
            component: 'AdminRoutes',
            message: `Failed to update network on agent ${pool.nodeId}: ${err?.message || err}`,
            stack: err?.stack,
            metadata: { nodeId: pool.nodeId, error: err?.message },
          }).catch(() => {});
          console.error(`Failed to update network on agent ${pool.nodeId}:`, err);
        }
      }

      reply.send(serialize({ success: true, data: updated }));

      // Broadcast ip_pool_updated event
      const wsGatewayIpPoolUpdated = (app as any).wsGateway;
      if (wsGatewayIpPoolUpdated?.pushToAdminSubscribers) {
        wsGatewayIpPoolUpdated.pushToAdminSubscribers('ip_pool_updated', {
          type: 'ip_pool_updated',
          poolId,
          updatedBy: user.userId,
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  // IPAM: delete pool
  app.delete(
    '/ip-pools/:poolId',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user;

      if (!(checkPerm(request, 'admin.write'))) {
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

      // Wait for agent ack so panel knows CNI delete succeeded/failed.
      if (pool) {
        const wsGateway = app.wsGateway;
        if (wsGateway?.requestFromAgent) {
          try {
            const agentResult = await wsGateway.requestFromAgent(pool.nodeId, {
              type: 'delete_network',
              networkName: pool.networkName,
            }, 30000);
            if (agentResult && agentResult.success === false) {
              captureSystemError({
                level: 'warn',
                component: 'AdminRoutes',
                message: `Agent failed to delete network: ${agentResult.error || 'unknown'}`,
                metadata: { nodeId: pool.nodeId, error: agentResult.error },
              }).catch(() => {});
              console.error(`Agent failed to delete network on ${pool.nodeId}:`, agentResult.error);
            }
          } catch (err: any) {
            captureSystemError({
              level: 'warn',
              component: 'AdminRoutes',
              message: `Failed to delete network on agent ${pool.nodeId}: ${err?.message || err}`,
              stack: err?.stack,
              metadata: { nodeId: pool.nodeId, error: err?.message },
            }).catch(() => {});
            console.error(`Failed to delete network on agent ${pool.nodeId}:`, err);
          }
        }
      }

      reply.send({ success: true });

      // Broadcast ip_pool_deleted event
      const wsGatewayIpPoolDeleted = (app as any).wsGateway;
      if (wsGatewayIpPoolDeleted?.pushToAdminSubscribers) {
        wsGatewayIpPoolDeleted.pushToAdminSubscribers('ip_pool_deleted', {
          type: 'ip_pool_deleted',
          poolId,
          deletedBy: user.userId,
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  // Database hosts: list
  app.get(
    '/database-hosts',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user;

      if (!(checkPerm(request, 'admin.read'))) {
        return reply.status(403).send({ error: 'Admin read permission required' });
      }

      const hosts = await prisma.databaseHost.findMany({
        orderBy: { createdAt: 'desc' },
        omit: { password: true },
        include: { _count: { select: { databases: true } } },
      });

      reply.send(serialize({ success: true, data: hosts }));
    }
  );

  // Database hosts: create
  app.post(
    '/database-hosts',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user;

      if (!(checkPerm(request, 'admin.write'))) {
        return reply.status(403).send({ error: 'Admin write permission required' });
      }

      const { name, host, port, username, password, engine, database } = request.body as {
        name: string;
        host: string;
        port?: number;
        username: string;
        password: string;
        engine?: string;
        database?: string;
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

      const validEngines = ['mysql', 'postgresql', 'postgres'];
      const resolvedEngine = engine?.toLowerCase();
      if (resolvedEngine && !validEngines.includes(resolvedEngine)) {
        return reply.status(400).send({ error: `engine must be one of: ${validEngines.join(', ')}` });
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
            port: port ?? (resolvedEngine === 'postgresql' || resolvedEngine === 'postgres' ? 5432 : 3306),
            username: username.trim(),
            password,
            engine: resolvedEngine === 'postgres' ? 'postgresql' : (resolvedEngine || 'mysql'),
            database: database?.trim() || (resolvedEngine === 'postgresql' || resolvedEngine === 'postgres' ? 'postgres' : undefined),
          },
          omit: { password: true },
        });

        await createAuditLog(user.userId, {
        request,
          action: 'database.host.create',
          resource: 'database_host',
          resourceId: created.id,
          details: { name: created.name, host: created.host, port: created.port, engine: created.engine, username: created.username },
        });

        // Broadcast database_host_created event
        const wsGatewayDbHostCreated = (app as any).wsGateway;
        if (wsGatewayDbHostCreated?.pushToAdminSubscribers) {
          wsGatewayDbHostCreated.pushToAdminSubscribers('database_host_created', {
            type: 'database_host_created',
            hostId: created.id,
            hostName: created.name,
            createdBy: user.userId,
            timestamp: new Date().toISOString(),
          });
        }

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
      const user = request.user;

      if (!(checkPerm(request, 'admin.write'))) {
        return reply.status(403).send({ error: 'Admin write permission required' });
      }

      const { hostId } = request.params as { hostId: string };
      const { name, host, port, username, password, engine, database } = request.body as {
        name?: string;
        host?: string;
        port?: number;
        username?: string;
        password?: string;
        engine?: string;
        database?: string;
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

      const validEngines = ['mysql', 'postgresql', 'postgres'];
      const resolvedEngine = engine?.toLowerCase();
      if (resolvedEngine && !validEngines.includes(resolvedEngine)) {
        return reply.status(400).send({ error: `engine must be one of: ${validEngines.join(', ')}` });
      }

      if (host !== undefined) {
        const trimmedHost = host.trim();
        if (!/^[a-z0-9.-]+$/i.test(trimmedHost)) {
          return reply.status(400).send({ error: 'host must be a valid hostname or IP' });
        }
      }

      try {
        // Password preservation: the list endpoints never return the plaintext
        // password, so a masked or empty value must keep the stored password.
        const passwordToStore =
          password === undefined || password === '' || password === '********'
            ? existing.password
            : password;
        const updated = await prisma.databaseHost.update({
          where: { id: hostId },
          data: {
            name: name !== undefined ? name.trim() : existing.name,
            host: host !== undefined ? host.trim() : existing.host,
            port: port ?? existing.port,
            username: username !== undefined ? username.trim() : existing.username,
            password: passwordToStore,
            engine: resolvedEngine === 'postgres' ? 'postgresql' : (resolvedEngine || existing.engine),
            database: database !== undefined ? database.trim() : existing.database,
          },
          omit: { password: true },
        });

        await createAuditLog(user.userId, {
        request,
          action: 'database.host.update',
          resource: 'database_host',
          resourceId: updated.id,
          details: { name: updated.name, host: updated.host, port: updated.port, engine: updated.engine, username: updated.username },
        });

        // Broadcast database_host_updated event
        const wsGatewayDbHostUpdated = (app as any).wsGateway;
        if (wsGatewayDbHostUpdated?.pushToAdminSubscribers) {
          wsGatewayDbHostUpdated.pushToAdminSubscribers('database_host_updated', {
            type: 'database_host_updated',
            hostId: updated.id,
            updatedBy: user.userId,
            timestamp: new Date().toISOString(),
          });
        }

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
      const user = request.user;

      if (!(checkPerm(request, 'admin.write'))) {
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
        request,
        action: 'database.host.delete',
        resource: 'database_host',
        resourceId: hostId,
        details: { name: deleted.name },
      });

      reply.send({ success: true });

      // Broadcast database_host_deleted event
      const wsGatewayDbHostDeleted = (app as any).wsGateway;
      if (wsGatewayDbHostDeleted?.pushToAdminSubscribers) {
        wsGatewayDbHostDeleted.pushToAdminSubscribers('database_host_deleted', {
          type: 'database_host_deleted',
          hostId,
          deletedBy: user.userId,
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  // Database host: test connection (ping)
  app.get(
    '/database-hosts/:hostId/ping',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!(checkPerm(request, 'admin.read'))) {
        return reply.status(403).send({ error: 'Admin read permission required' });
      }

      const { hostId } = request.params as { hostId: string };
      const host = await prisma.databaseHost.findUnique({ where: { id: hostId } });
      if (!host) {
        return reply.status(404).send({ error: 'Database host not found' });
      }

      const engine = host.engine || 'mysql';
      const start = Date.now();

      try {
        if (engine === 'postgresql' || engine === 'postgres') {
          // PostgreSQL connection test
          const { Client } = await import('pg');
          const client = new Client({
            host: host.host,
            port: host.port,
            user: host.username,
            password: host.password,
            database: host.database || 'postgres',
            connectionTimeoutMillis: 5000,
          });

          await client.connect();

          const versionResult = await client.query('SELECT version() AS version');
          const dbResult = await client.query(
            "SELECT COUNT(*)::int AS count FROM pg_database WHERE datistemplate = false AND datname NOT IN ('postgres')"
          );
          const tableResult = await client.query(
            "SELECT COUNT(*)::int AS count FROM information_schema.tables WHERE table_schema NOT IN ('information_schema', 'pg_catalog')"
          );

          await client.end();
          const latency = Date.now() - start;

          return reply.send(serialize({
            success: true,
            data: {
              connected: true,
              latency,
              version: versionResult.rows?.[0]?.version || null,
              databaseCount: dbResult.rows?.[0]?.count ?? 0,
              tableCount: tableResult.rows?.[0]?.count ?? 0,
              engine: 'postgresql',
            },
          }));
        } else {
          // MySQL connection test
          const mysql = await import('mysql2/promise');
          const connection = await mysql.createConnection({
            host: host.host,
            port: host.port,
            user: host.username,
            password: host.password,
            connectTimeout: 5000,
          });

          const [versionRows] = await connection.query('SELECT VERSION() AS version') as any;
          const [dbRows] = await connection.query(
            "SELECT COUNT(*) AS count FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')"
          ) as any;
          const [tableRows] = await connection.query(
            "SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')"
          ) as any;

          await connection.end();
          const latency = Date.now() - start;

          return reply.send(serialize({
            success: true,
            data: {
              connected: true,
              latency,
              version: versionRows?.[0]?.version || null,
              databaseCount: Number(dbRows?.[0]?.count ?? 0),
              tableCount: Number(tableRows?.[0]?.count ?? 0),
              engine: 'mysql',
            },
          }));
        }
      } catch (err: any) {
        const latency = Date.now() - start;
        return reply.send(serialize({
          success: true,
          data: {
            connected: false,
            latency,
            error: err.message || 'Connection failed',
            version: null,
            databaseCount: 0,
            tableCount: 0,
            engine,
          },
        }));
      }
    },
  );

  // Catalyst internal database status
  app.get(
    '/db-status',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!(checkPerm(request, 'admin.read'))) {
        return reply.status(403).send({ error: 'Admin read permission required' });
      }

      const start = Date.now();
      try {
        const dbHealthy = await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
        const latency = Date.now() - start;

        // Count tables in the Catalyst database
        const tableCount = await prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public'` as any;

        // Get database size
        const dbSize = await prisma.$queryRaw`SELECT pg_database_size(current_database())::bigint AS size` as any;

        // Get active connections count
        const connections = await prisma.$queryRaw`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database()` as any;

        // Count rows per major table
        const [users, servers, nodes, sessions] = await Promise.all([
          prisma.user.count(),
          prisma.server.count(),
          prisma.node.count(),
          prisma.session.count(),
        ]);

        return reply.send(serialize({
          success: true,
          data: {
            connected: dbHealthy,
            latency,
            engine: 'postgresql',
            tableCount: tableCount?.[0]?.count ?? 0,
            sizeBytes: Number(dbSize?.[0]?.size ?? 0),
            activeConnections: Number(connections?.[0]?.count ?? 0),
            rowCounts: { users, servers, nodes, sessions },
          },
        }));
      } catch (err: any) {
        return reply.send(serialize({
          success: true,
          data: {
            connected: false,
            latency: Date.now() - start,
            engine: 'postgresql',
            error: err.message || 'Connection failed',
            tableCount: 0,
            sizeBytes: 0,
            activeConnections: 0,
            rowCounts: { users: 0, servers: 0, nodes: 0, sessions: 0 },
          },
        }));
      }
    },
  );

  app.get(
    '/smtp',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user;
      if (!(checkPerm(request, 'admin.read'))) {
        return reply.status(403).send({ error: 'Admin read permission required' });
      }
      const settings = await getSmtpSettings();
      // Never return the plaintext SMTP password — send a mask sentinel instead.
      reply.send(serialize({
        success: true,
        data: {
          ...settings,
          password: settings.password ? '********' : null,
        },
      }));
    }
  );

  app.put(
    '/smtp',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user;
      if (!(checkPerm(request, 'admin.write'))) {
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

      // Password preservation: the client never sees the plaintext password
      // (GET returns a '********' mask), so an omitted, empty, or masked
      // password must keep the stored value instead of wiping it. Explicit
      // null still clears the stored password.
      const existingSmtp = await getSmtpSettings();
      const passwordToStore =
        password === undefined || password === '' || password === '********'
          ? existingSmtp.password
          : password;

      await upsertSmtpSettings({
        host: host ?? null,
        port: port ?? null,
        username: username ?? null,
        password: passwordToStore ?? null,
        from: from ?? null,
        replyTo: replyTo ?? null,
        secure: secure ?? false,
        requireTls: requireTls ?? false,
        pool: pool ?? false,
        maxConnections: maxConnections ?? null,
        maxMessages: maxMessages ?? null,
      });

      await createAuditLog(user.userId, {
        request,
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

      try {
        const wsGateway = (app as any).wsGateway;
        wsGateway?.pushToAdminSubscribers('smtp_settings_updated', { updatedBy: user.userId });
      } catch { /* ignore — WS push is best-effort */ }

      reply.send({ success: true });
    }
  );

  app.get(
    '/mod-manager',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user;
      if (!(checkPerm(request, 'admin.read'))) {
        return reply.status(403).send({ error: 'Admin read permission required' });
      }
      const settings = await getModManagerSettings();
      const mask = (v: string | null | undefined) =>
        !v ? null : { configured: true, last4: v.slice(-4), length: v.length };
      reply.send(serialize({ success: true, data: { curseforgeApiKey: mask(settings.curseforgeApiKey), modrinthApiKey: mask(settings.modrinthApiKey) } }));
    }
  );

  app.put(
    '/mod-manager',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user;
      if (!(checkPerm(request, 'admin.write'))) {
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
        request,
        action: 'mod_manager.settings.update',
        resource: 'system',
        details: {
          curseforgeConfigured: Boolean(curseforgeApiKey),
          modrinthConfigured: Boolean(modrinthApiKey),
        },
      });

      try {
        const wsGateway = (app as any).wsGateway;
        wsGateway?.pushToAdminSubscribers('system_settings_updated', { updatedBy: user.userId });
      } catch { /* ignore — WS push is best-effort */ }

      reply.send({ success: true });
    }
  );

  // Theme settings: get
  app.get(
    '/theme-settings',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user;
      if (!(checkPerm(request, 'admin.read'))) {
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
      const user = request.user;
      if (!(checkPerm(request, 'admin.write'))) {
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
        request,
        action: 'theme_settings.update',
        resource: 'system',
        details: updateData,
      });

      try {
        const wsGateway = (app as any).wsGateway;
        wsGateway?.pushToAdminSubscribers('theme_settings_updated', { updatedBy: user.userId });
      } catch { /* ignore — WS push is best-effort */ }

      reply.send(serialize({ success: true, data: settings }));
    }
  );

  // ── Auth Lockouts ────────────────────────────────────────────────────────────
  // List auth lockouts
  app.get(
    '/auth-lockouts',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user;
      if (!(checkPerm(request, 'admin.read'))) {
        return reply.status(403).send({ error: 'Admin read permission required' });
      }

      const {
        page = 1,
        limit = 20,
        search,
      } = request.query as {
        page?: number;
        limit?: number;
        search?: string;
      };

      const skip = (Number(page) - 1) * Number(limit);
      const where: any = {};

      if (search) {
        where.OR = [
          { email: { contains: search, mode: 'insensitive' } },
          { ipAddress: { contains: search, mode: 'insensitive' } },
        ];
      }

      const [lockouts, total] = await Promise.all([
        prisma.authLockout.findMany({
          where,
          skip,
          take: Number(limit),
          orderBy: { lastFailedAt: 'desc' },
        }),
        prisma.authLockout.count({ where }),
      ]);

      reply.send({
        lockouts,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / Number(limit)),
        },
      });
    }
  );

  // Delete a specific auth lockout
  app.delete(
    '/auth-lockouts/:lockoutId',
    { preHandler: authenticate },
    async (request: FastifyRequest<{ Params: { lockoutId: string } }>, reply: FastifyReply) => {
      const user = request.user;
      if (!(checkPerm(request, 'admin.write'))) {
        return reply.status(403).send({ error: 'Admin write permission required' });
      }

      const { lockoutId } = request.params;

      const lockout = await prisma.authLockout.findUnique({
        where: { id: lockoutId },
      });

      if (!lockout) {
        return reply.status(404).send({ error: 'Lockout not found' });
      }

      await prisma.authLockout.delete({
        where: { id: lockoutId },
      });

      await createAuditLog(user.userId, {
        request,
        action: 'auth_lockout.delete',
        resource: 'auth_lockout',
        resourceId: lockoutId,
        details: { email: lockout.email, ipAddress: lockout.ipAddress },
      });

      try {
        const wsGateway = (app as any).wsGateway;
        wsGateway?.pushToAdminSubscribers('auth_lockout_cleared', { lockoutId });
      } catch { /* ignore — WS push is best-effort */ }

      reply.send({ success: true });
    }
  );

  // ── OIDC Provider Configuration ─────────────────────────────────────
  app.get(
    '/oidc-config',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!checkPerm(request, 'admin.read')) {
        return reply.status(403).send({ error: 'Admin read permission required' });
      }

      const settings = await prisma.themeSettings.findUnique({ where: { id: 'default' } });
      const meta = (settings?.metadata as Record<string, any>) || {};
      const stored = (meta.oidcProviders as Record<string, { clientId?: string; clientSecret?: string; discoveryUrl?: string }>) || {};

      // Merge: env vars as defaults, DB overrides, mask secrets
      const result: Record<string, { clientId: string; clientSecret: string; discoveryUrl: string; source: string }> = {};
      for (const provider of ['whmcs', 'paymenter'] as const) {
        const envClientId = process.env[`${provider.toUpperCase()}_OIDC_CLIENT_ID`] || '';
        const envSecret = process.env[`${provider.toUpperCase()}_OIDC_CLIENT_SECRET`] || '';
        const envDiscovery = process.env[`${provider.toUpperCase()}_OIDC_DISCOVERY_URL`] || '';
        const db = stored[provider] || {};
        const clientId = db.clientId || envClientId;
        const clientSecret = db.clientSecret || envSecret;
        const discoveryUrl = db.discoveryUrl || envDiscovery;

        result[provider] = {
          clientId,
          clientSecret: clientSecret
            ? clientSecret.slice(0, 4) + '•'.repeat(Math.max(0, clientSecret.length - 4))
            : '',
          discoveryUrl,
          source: db.clientId ? 'database' : (envClientId ? 'env' : 'none'),
        };
      }

      reply.send(serialize({ success: true, data: result }));
    }
  );

  app.patch(
    '/oidc-config',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!checkPerm(request, 'admin.write')) {
        return reply.status(403).send({ error: 'Admin write permission required' });
      }

      const { whmcs, paymenter } = request.body as {
        whmcs?: { clientId?: string; clientSecret?: string; discoveryUrl?: string };
        paymenter?: { clientId?: string; clientSecret?: string; discoveryUrl?: string };
      };

      const settings = await prisma.themeSettings.findUnique({ where: { id: 'default' } });
      const meta = { ...(settings?.metadata as Record<string, any> || {}) };
      meta.oidcProviders = { ...(meta.oidcProviders || {}) };

      // Validate and update each provider
      for (const [provider, config] of Object.entries({ whmcs, paymenter })) {
        if (!config) continue;
        const existing = (meta.oidcProviders[provider] as Record<string, string>) || {};

        if (config.clientId !== undefined) {
          if (config.clientId.trim().length === 0) {
            // Empty string = clear DB value, fall back to env
            delete existing.clientId;
          } else {
            existing.clientId = config.clientId.trim();
          }
        }

        if (config.clientSecret !== undefined) {
          if (config.clientSecret.trim().length === 0) {
            delete existing.clientSecret;
          } else if (!config.clientSecret.includes('•')) {
            // Only update if not masked
            existing.clientSecret = config.clientSecret.trim();
          }
          // If it contains •, user didn't change it — keep existing
        }

        if (config.discoveryUrl !== undefined) {
          if (config.discoveryUrl.trim().length === 0) {
            delete existing.discoveryUrl;
          } else {
            // Validate URL format
            if (!config.discoveryUrl.match(/^https?:\/\/[^\s]+$/)) {
              return reply.status(400).send({ error: `Invalid discovery URL for ${provider}` });
            }
            existing.discoveryUrl = config.discoveryUrl.trim();
          }
        }

        meta.oidcProviders[provider] = existing;
      }

      await prisma.themeSettings.upsert({
        where: { id: 'default' },
        update: { metadata: meta },
        create: { id: 'default', metadata: meta },
      });

      // Bootstrap env vars for current process
      for (const [key, cfg] of Object.entries(meta.oidcProviders as Record<string, Record<string, string>>)) {
        const prefix = key.toUpperCase();
        if (cfg.clientId) process.env[`${prefix}_OIDC_CLIENT_ID`] = cfg.clientId;
        if (cfg.clientSecret) process.env[`${prefix}_OIDC_CLIENT_SECRET`] = cfg.clientSecret;
        if (cfg.discoveryUrl) process.env[`${prefix}_OIDC_DISCOVERY_URL`] = cfg.discoveryUrl;
      }

      await createAuditLog(request.user.userId, {
        request,
        action: 'oidc_config.update',
        resource: 'oidc_config',
        details: { providers: Object.keys(meta.oidcProviders) },
      });

      try {
        const wsGateway = (app as any).wsGateway;
        wsGateway?.pushToAdminSubscribers('oidc_settings_updated', { updatedBy: request.user.userId });
      } catch { /* ignore — WS push is best-effort */ }

      reply.send(serialize({ success: true, message: 'OIDC configuration updated. Restart required for changes to take full effect.' }));
    }
  );

  // File tunnel upload size limit (available to all authenticated users)
  app.get(
    '/settings/file-tunnel-upload-limit',
    { preHandler: authenticate },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const settings = await getSecuritySettings();
      reply.send({
        success: true,
        data: { maxUploadMb: settings.fileTunnelMaxUploadMb },
      });
    },
  );
}

