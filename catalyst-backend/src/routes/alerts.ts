import { prisma } from '../db.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { serialize } from '../utils/serialize';
import { hasNodeAccess } from '../lib/permissions';

export async function alertRoutes(app: FastifyInstance) {
  // Using shared prisma instance from db.ts
  const authenticate = (app as any).authenticate;
  const isAdminUser = async (userId: string) => {
    const userRoles = await prisma.role.findMany({
      where: {
        users: {
          some: { id: userId },
        },
      },
    });

    const permissions = userRoles.flatMap((role) => role.permissions);
    if (permissions.includes('*') || permissions.includes('admin.read')) {
      return true;
    }

    return userRoles.some((role) => role.name.toLowerCase() === 'administrator');
  };
  const ensureServerAccess = async ({
    userId,
    serverId,
    reply,
    isAdmin,
    requiredPermissions,
  }: {
    userId: string;
    serverId: string;
    reply: FastifyReply;
    isAdmin: boolean;
    requiredPermissions: string[];
  }) => {
    const server = await prisma.server.findUnique({
      where: { id: serverId },
      select: { id: true, ownerId: true, nodeId: true },
    });
    if (!server) {
      reply.status(404).send({ error: 'Server not found' });
      return null;
    }
    if (isAdmin || server.ownerId === userId) {
      return server;
    }
    const access = await prisma.serverAccess.findFirst({
      where: {
        serverId,
        userId,
        permissions: { hasSome: requiredPermissions },
      },
    });
    if (access) {
      return server;
    }
    // Check for node access
    const hasNodeAccessToServer = await hasNodeAccess(prisma, userId, server.nodeId);
    if (hasNodeAccessToServer) {
      return server;
    }
    reply.status(403).send({ error: 'Forbidden' });
    return null;
  };

  // Create an alert rule
  app.post(
    '/alert-rules',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;
      const isAdmin = await isAdminUser(user.userId);
      const { name, description, type, target, targetId, conditions, actions, enabled } = request.body as {
        name: string;
        description?: string;
        type: string;
        target: string;
        targetId?: string;
        conditions: any;
        actions: any;
        enabled?: boolean;
      };

      // Validation
      if (!name || !type || !target || !conditions || !actions) {
        return reply.status(400).send({
          error: 'Missing required fields: name, type, target, conditions, actions',
        });
      }

      // Validate type
      const validTypes = ['resource_threshold', 'node_offline', 'server_crashed'];
      if (!validTypes.includes(type)) {
        return reply.status(400).send({
          error: `Invalid type. Must be one of: ${validTypes.join(', ')}`,
        });
      }

      // Validate target
      const validTargets = ['server', 'node', 'global'];
      if (!validTargets.includes(target)) {
        return reply.status(400).send({
          error: `Invalid target. Must be one of: ${validTargets.join(', ')}`,
        });
      }

      // Validate targetId
      if ((target === 'server' || target === 'node') && !targetId) {
        return reply.status(400).send({ error: 'targetId is required for server or node rules' });
      }

      if (target === 'server' && targetId) {
        const server = await ensureServerAccess({
          userId: user.userId,
          serverId: targetId,
          reply,
          isAdmin,
          requiredPermissions: ['alert.create'],
        });
        if (!server) {
          return;
        }
      }

      if (target === 'node' && targetId) {
        const node = await prisma.node.findUnique({ where: { id: targetId }, select: { id: true } });
        if (!node) {
          return reply.status(404).send({ error: 'Node not found' });
        }
      }

      // Check admin permissions for global rules
      if ((target === 'global' || target === 'node') && !isAdmin) {
        return reply.status(403).send({ error: 'Admin access required for this alert rule target' });
      }

      // Create alert rule
      const rule = await prisma.alertRule.create({
        data: {
          userId: user.userId,
          name,
          description,
          type,
          target,
          targetId,
          conditions,
          actions,
          enabled: enabled !== undefined ? enabled : true,
        },
      });

      reply.send(serialize({ success: true, rule }));
    }
  );

  // List alert rules
  app.get(
    '/alert-rules',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;
      const { type, enabled, scope, target, targetId } = request.query as {
        type?: string;
        enabled?: string;
        scope?: 'mine' | 'all';
        target?: string;
        targetId?: string;
      };
      const isAdmin = await isAdminUser(user.userId);

      const where: any = {};
      if (type) where.type = type;
      if (enabled !== undefined) where.enabled = enabled === 'true';
      if (target) where.target = target;
      if (targetId) where.targetId = targetId;
      if (!isAdmin || scope !== 'all') {
        where.userId = user.userId;
      }

      const rules = await prisma.alertRule.findMany({
        where,
        orderBy: { createdAt: 'desc' },
      });

      reply.send(serialize({ rules }));
    }
  );

  // Get a specific alert rule
  app.get(
    '/alert-rules/:ruleId',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;
      const isAdmin = await isAdminUser(user.userId);
      const { ruleId } = request.params as { ruleId: string };

      const rule = await prisma.alertRule.findUnique({
        where: { id: ruleId },
      });

      if (!rule) {
        return reply.status(404).send({ error: 'Alert rule not found' });
      }
      if (!isAdmin && rule.userId !== user.userId) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      reply.send(serialize({ rule }));
    }
  );

  // Update an alert rule
  app.put(
    '/alert-rules/:ruleId',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;
      const isAdmin = await isAdminUser(user.userId);
      const { ruleId } = request.params as { ruleId: string };
      const { name, description, conditions, actions, enabled } = request.body as {
        name?: string;
        description?: string;
        conditions?: any;
        actions?: any;
        enabled?: boolean;
      };

      const existing = await prisma.alertRule.findUnique({ where: { id: ruleId } });
      if (!existing) {
        return reply.status(404).send({ error: 'Alert rule not found' });
      }
      if (!isAdmin && existing.userId !== user.userId) {
        return reply.status(403).send({ error: 'Forbidden' });
      }
      if ((existing.target === 'global' || existing.target === 'node') && !isAdmin) {
        return reply.status(403).send({ error: 'Admin access required for this alert rule target' });
      }
      if (existing.target === 'server' && existing.targetId) {
        const server = await ensureServerAccess({
          userId: user.userId,
          serverId: existing.targetId,
          reply,
          isAdmin,
          requiredPermissions: ['alert.update'],
        });
        if (!server) {
          return;
        }
      }

      const updateData: any = {};
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (conditions !== undefined) updateData.conditions = conditions;
      if (actions !== undefined) updateData.actions = actions;
      if (enabled !== undefined) updateData.enabled = enabled;

      const rule = await prisma.alertRule.update({
        where: { id: ruleId },
        data: updateData,
      });

      reply.send(serialize({ success: true, rule }));
    }
  );

  // Delete an alert rule
  app.delete(
    '/alert-rules/:ruleId',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;
      const isAdmin = await isAdminUser(user.userId);
      const { ruleId } = request.params as { ruleId: string };

      const existing = await prisma.alertRule.findUnique({ where: { id: ruleId } });
      if (!existing) {
        return reply.status(404).send({ error: 'Alert rule not found' });
      }
      if (!isAdmin && existing.userId !== user.userId) {
        return reply.status(403).send({ error: 'Forbidden' });
      }
      if ((existing.target === 'global' || existing.target === 'node') && !isAdmin) {
        return reply.status(403).send({ error: 'Admin access required for this alert rule target' });
      }
      if (existing.target === 'server' && existing.targetId) {
        const server = await ensureServerAccess({
          userId: user.userId,
          serverId: existing.targetId,
          reply,
          isAdmin,
          requiredPermissions: ['alert.delete'],
        });
        if (!server) {
          return;
        }
      }

      await prisma.alertRule.delete({ where: { id: ruleId } });

      reply.send({ success: true, message: 'Alert rule deleted' });
    }
  );

  // Get alert deliveries for an alert
  app.get(
    '/alerts/:alertId/deliveries',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;
      const isAdmin = await isAdminUser(user.userId);
      const { alertId } = request.params as { alertId: string };
      const alert = await prisma.alert.findUnique({ where: { id: alertId }, select: { id: true, userId: true, serverId: true } });
      if (!alert) {
        return reply.status(404).send({ error: 'Alert not found' });
      }
      if (!isAdmin && alert.userId !== user.userId) {
        return reply.status(403).send({ error: 'Forbidden' });
      }
      if (alert.serverId && !isAdmin) {
        const server = await ensureServerAccess({
          userId: user.userId,
          serverId: alert.serverId,
          reply,
          isAdmin,
          requiredPermissions: ['alert.read'],
        });
        if (!server) {
          return;
        }
      }
      const deliveries = await prisma.alertDelivery.findMany({
        where: { alertId },
        orderBy: { createdAt: 'desc' },
      });
      reply.send({ deliveries });
    }
  );

  // List alerts
  app.get(
    '/alerts',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;
      const {
        page = 1,
        limit = 50,
        serverId,
        nodeId,
        type,
        severity,
        resolved,
        scope,
      } = request.query as {
        page?: number;
        limit?: number;
        serverId?: string;
        nodeId?: string;
        type?: string;
        severity?: string;
        resolved?: string;
        scope?: 'mine' | 'all';
      };
      const isAdmin = await isAdminUser(user.userId);
      if (serverId && !isAdmin) {
        const server = await ensureServerAccess({
          userId: user.userId,
          serverId,
          reply,
          isAdmin,
          requiredPermissions: ['alert.read'],
        });
        if (!server) {
          return;
        }
      }

      const skip = (Number(page) - 1) * Number(limit);

      const where: any = {};
      if (serverId) where.serverId = serverId;
      if (nodeId) where.nodeId = nodeId;
      if (type) where.type = type;
      if (severity) where.severity = severity;
      if (resolved !== undefined) where.resolved = resolved === 'true';
      if (!isAdmin || scope !== 'all') {
        where.userId = user.userId;
      }

      const [alerts, total] = await Promise.all([
        prisma.alert.findMany({
          where,
          skip,
          take: Number(limit),
          include: {
            rule: { select: { id: true, name: true } },
            server: {
              select: { id: true, name: true },
            },
            node: {
              select: { id: true, name: true },
            },
          },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.alert.count({ where }),
      ]);

      reply.send({
        alerts,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / Number(limit)),
        },
      });
    }
  );

  // Get a specific alert
  app.get(
    '/alerts/:alertId',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;
      const isAdmin = await isAdminUser(user.userId);
      const { alertId } = request.params as { alertId: string };

      const alert = await prisma.alert.findUnique({
        where: { id: alertId },
        include: {
          rule: { select: { id: true, name: true } },
          server: {
            select: { id: true, name: true },
          },
          node: {
            select: { id: true, name: true },
          },
          deliveries: {
            orderBy: { createdAt: 'desc' },
          },
        },
      });

      if (!alert) {
        return reply.status(404).send({ error: 'Alert not found' });
      }
      if (!isAdmin && alert.userId !== user.userId) {
        return reply.status(403).send({ error: 'Forbidden' });
      }
      if (alert.server?.id && !isAdmin) {
        const server = await ensureServerAccess({
          userId: user.userId,
          serverId: alert.server.id,
          reply,
          isAdmin,
          requiredPermissions: ['alert.read'],
        });
        if (!server) {
          return;
        }
      }

      reply.send(serialize({ alert }));
    }
  );

  // Resolve an alert
  app.post(
    '/alerts/:alertId/resolve',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;
      const isAdmin = await isAdminUser(user.userId);
      const { alertId } = request.params as { alertId: string };
      const alert = await prisma.alert.findUnique({
        where: { id: alertId },
        select: { id: true, userId: true, serverId: true },
      });
      if (!alert) {
        return reply.status(404).send({ error: 'Alert not found' });
      }
      if (!isAdmin && alert.userId !== user.userId) {
        return reply.status(403).send({ error: 'Forbidden' });
      }
      if (alert.serverId && !isAdmin) {
        const server = await ensureServerAccess({
          userId: user.userId,
          serverId: alert.serverId,
          reply,
          isAdmin,
          requiredPermissions: ['alert.update'],
        });
        if (!server) {
          return;
        }
      }

      const alertService = (app as any).alertService;
      if (alertService) {
        await alertService.resolveAlert(alertId, user.userId);
      } else {
        await prisma.alert.update({
          where: { id: alertId },
          data: {
            resolved: true,
            resolvedAt: new Date(),
            resolvedBy: user.userId,
          },
        });
      }

      reply.send({ success: true, message: 'Alert resolved' });
    }
  );

  // Bulk resolve alerts
  app.post(
    '/alerts/bulk-resolve',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;
      const isAdmin = await isAdminUser(user.userId);
      const { alertIds } = request.body as { alertIds: string[] };

      if (!alertIds || !Array.isArray(alertIds)) {
        return reply.status(400).send({ error: 'alertIds must be an array' });
      }

      if (!isAdmin) {
        const alerts = await prisma.alert.findMany({
          where: { id: { in: alertIds } },
          select: { id: true, userId: true, serverId: true },
        });
        const invalid = alerts.some((alert) => alert.userId !== user.userId);
        if (invalid) {
          return reply.status(403).send({ error: 'Forbidden' });
        }
        const serverIds = Array.from(
          new Set(alerts.map((alert) => alert.serverId).filter((serverId): serverId is string => Boolean(serverId))),
        ) as string[];
        for (const serverId of serverIds) {
          const server = await ensureServerAccess({
            userId: user.userId,
            serverId,
            reply,
            isAdmin,
            requiredPermissions: ['alert.update'],
          });
          if (!server) {
            return;
          }
        }
      }

      await prisma.alert.updateMany({
        where: { id: { in: alertIds } },
        data: {
          resolved: true,
          resolvedAt: new Date(),
          resolvedBy: user.userId,
        },
      });

      reply.send({ success: true, message: `${alertIds.length} alerts resolved` });
    }
  );

  // Get alert statistics
  app.get(
    '/alerts/stats',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;
      const { scope } = request.query as { scope?: 'mine' | 'all' };
      const isAdmin = await isAdminUser(user.userId);
      const where = !isAdmin || scope !== 'all' ? { userId: user.userId } : {};
      const [total, unresolved, bySeverity, byType] = await Promise.all([
        prisma.alert.count({ where }),
        prisma.alert.count({ where: { ...where, resolved: false } }),
        prisma.alert.groupBy({
          by: ['severity'],
          _count: true,
          where: { ...where, resolved: false },
        }),
        prisma.alert.groupBy({
          by: ['type'],
          _count: true,
          where: { ...where, resolved: false },
        }),
      ]);

      reply.send({
        total,
        unresolved,
        bySeverity: Object.fromEntries(bySeverity.map((s) => [s.severity, s._count])),
        byType: Object.fromEntries(byType.map((t) => [t.type, t._count])),
      });
    }
  );
}
