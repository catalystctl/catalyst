import { prisma } from '../db.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import cron from 'node-cron';
import { CronExpressionParser } from 'cron-parser';
import { serialize } from '../utils/serialize';
import { hasNodeAccess } from '../lib/permissions';

/** Allowed scheduled-task actions (create + update). */
const TASK_ACTIONS = ['restart', 'stop', 'start', 'backup', 'command'] as const;
type TaskAction = (typeof TASK_ACTIONS)[number];

function isValidTaskAction(action: string): action is TaskAction {
  return (TASK_ACTIONS as readonly string[]).includes(action);
}
export async function taskRoutes(app: FastifyInstance) {
  // Using shared prisma instance from db.ts
  const authenticate = (app as any).authenticate;
  const ensureSchedulePermission = async (
    userId: string,
    serverId: string,
    reply: FastifyReply,
    message: string,
  ) => {
    const server = await prisma.server.findUnique({
      where: { id: serverId },
      select: { ownerId: true, suspendedAt: true, suspensionReason: true, nodeId: true },
    });

    if (!server) {
      reply.status(404).send({ error: 'Server not found' });
      return false;
    }

    if (process.env.SUSPENSION_ENFORCED !== 'false' && server.suspendedAt) {
      reply.status(423).send({
        error: 'Server is suspended',
        suspendedAt: server.suspendedAt,
        suspensionReason: server.suspensionReason ?? null,
      });
      return false;
    }

    if (server.ownerId === userId) {
      return true;
    }

    const serverAccess = await prisma.serverAccess.findFirst({
      where: {
        serverId,
        userId,
      },
    });

    const nodeGrant = await hasNodeAccess(prisma, userId, server.nodeId);

    // Server-scoped role resolution: global roles + RoleServerGrant +
    // RoleNodeGrant rows covering this server (mirrors decideServerAccess's
    // requiredPermission branch).
    const { resolveServerPermissions } = await import('../lib/permissions-catalog.js');
    const rolePerms = await resolveServerPermissions(userId, serverId, server.nodeId);
    const roleAllowed =
      rolePerms.includes('*') ||
      rolePerms.includes('admin.write') ||
      rolePerms.includes('server.schedule');

    // SECURITY: a bare node assignment must NOT grant scheduling (tasks can
    // run arbitrary console commands via action "command" in ANY server's
    // container on the node). Node access only counts when paired with the
    // node.update management permission — mirrors routes/backups.ts and
    // decideServerAccess's node-manage path.
    const hasNodeAccessToServer = nodeGrant && rolePerms.includes('node.update');

    if (!serverAccess && !hasNodeAccessToServer && !roleAllowed) {
      reply.status(403).send({ error: message });
      return false;
    }

    if (!hasNodeAccessToServer && !roleAllowed && !serverAccess?.permissions.includes('server.schedule')) {
      reply.status(403).send({ error: message });
      return false;
    }

    return true;
  };
  const ensureCommandPermission = async (
    userId: string,
    serverId: string,
    nodeId: string,
    reply: FastifyReply,
  ) => {
    const server = await prisma.server.findUnique({
      where: { id: serverId },
      select: { ownerId: true },
    });
    if (server?.ownerId === userId) return true;
    const access = await prisma.serverAccess.findFirst({
      where: { serverId, userId, permissions: { has: 'console.write' } },
    });
    if (access) return true;
    const { resolveServerPermissions } = await import('../lib/permissions-catalog.js');
    const rolePerms = await resolveServerPermissions(userId, serverId, nodeId);
    if (rolePerms.includes('*') || rolePerms.includes('admin.write') || rolePerms.includes('console.write')) {
      return true;
    }
    if ((await hasNodeAccess(prisma, userId, nodeId)) && rolePerms.includes('node.update')) {
      return true;
    }
    reply.status(403).send({ error: 'You do not have permission to run console commands on this server' });
    return false;
  };

  // Create a scheduled task
  app.post(
    '/:serverId/tasks',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user;
      const { serverId } = request.params as { serverId: string };
      const { name, description, action, payload, schedule } = request.body as {
        name: string;
        description?: string;
        action: string;
        payload?: any;
        schedule: string;
      };

      // Validation
      if (!name || !action || !schedule) {
        return reply.status(400).send({
          error: 'Missing required fields: name, action, schedule',
        });
      }

      // Validate cron expression
      if (!cron.validate(schedule)) {
        return reply.status(400).send({
          error: 'Invalid cron expression. Use standard cron format (e.g., "0 3 * * *")',
        });
      }

      // Validate action
      if (!isValidTaskAction(action)) {
        return reply.status(400).send({
          error: `Invalid action. Must be one of: ${TASK_ACTIONS.join(', ')}`,
        });
      }

      const canSchedule = await ensureSchedulePermission(
        user.userId,
        serverId,
        reply,
        'You do not have permission to schedule tasks for this server',
      );
      if (!canSchedule) return;

      if (action === 'command') {
        const serverRow = await prisma.server.findUnique({ where: { id: serverId }, select: { nodeId: true } });
        if (!serverRow || !(await ensureCommandPermission(user.userId, serverId, serverRow.nodeId, reply))) {
          if (serverRow) return;
          return reply.status(404).send({ error: 'Server not found' });
        }
      }

      let nextRunAt: Date | null = null;
      try {
        const interval = CronExpressionParser.parse(schedule, {
          currentDate: new Date(),
          tz: process.env.TZ || 'UTC',
        });
        nextRunAt = interval.next().toDate();
      } catch (error) {
        return reply.status(400).send({ error: 'Invalid cron expression' });
      }

      // Create task
      const task = await prisma.scheduledTask.create({
        data: {
          serverId,
          name,
          description,
          action,
          payload: payload || {},
          schedule,
          enabled: true,
          nextRunAt,
        },
      });

      // Notify scheduler to reload tasks
      const scheduler = (app as any).taskScheduler;
      if (scheduler) {
        scheduler.scheduleTask(task);
      }

      reply.send(serialize({ success: true, task }));

      // Broadcast task_created event
      const wsGatewayTaskCreated = (app as any).wsGateway;
      if (wsGatewayTaskCreated?.pushToAdminSubscribers) {
        wsGatewayTaskCreated.pushToAdminSubscribers('task_created', {
          type: 'task_created',
          serverId,
          taskId: task.id,
          taskName: task.name,
          createdBy: user.userId,
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  // List scheduled tasks for a server
  app.get(
    '/:serverId/tasks',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user;
      const { serverId } = request.params as { serverId: string };

      const canSchedule = await ensureSchedulePermission(
        user.userId,
        serverId,
        reply,
        'You do not have permission to view tasks for this server',
      );
      if (!canSchedule) return;

      const tasks = await prisma.scheduledTask.findMany({
        where: { serverId },
        orderBy: { createdAt: 'desc' },
      });

      reply.send(serialize({ tasks }));
    }
  );

  // Get a specific task
  app.get(
    '/:serverId/tasks/:taskId',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user;
      const { serverId, taskId } = request.params as { serverId: string; taskId: string };

      const canSchedule = await ensureSchedulePermission(
        user.userId,
        serverId,
        reply,
        'You do not have permission to view tasks for this server',
      );
      if (!canSchedule) return;

      const task = await prisma.scheduledTask.findFirst({
        where: {
          id: taskId,
          serverId,
        },
      });

      if (!task) {
        return reply.status(404).send({ error: 'Task not found' });
      }

      reply.send(serialize({ task }));
    }
  );

  // Update a scheduled task
  app.put(
    '/:serverId/tasks/:taskId',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user;
      const { serverId, taskId } = request.params as { serverId: string; taskId: string };
      const { name, description, action, payload, schedule, enabled } = request.body as {
        name?: string;
        description?: string;
        action?: string;
        payload?: any;
        schedule?: string;
        enabled?: boolean;
      };

      const canSchedule = await ensureSchedulePermission(
        user.userId,
        serverId,
        reply,
        'You do not have permission to modify tasks for this server',
      );
      if (!canSchedule) return;
      if (action === 'command') {
        const serverRow = await prisma.server.findUnique({ where: { id: serverId }, select: { nodeId: true } });
        if (!serverRow || !(await ensureCommandPermission(user.userId, serverId, serverRow.nodeId, reply))) {
          if (serverRow) return;
          return reply.status(404).send({ error: 'Server not found' });
        }
      }

      // Re-validate action against the same allowlist as create
      if (action !== undefined && !isValidTaskAction(action)) {
        return reply.status(400).send({
          error: `Invalid action. Must be one of: ${TASK_ACTIONS.join(', ')}`,
        });
      }

      // Validate cron expression if provided
      if (schedule && !cron.validate(schedule)) {
        return reply.status(400).send({
          error: 'Invalid cron expression',
        });
      }

      let nextRunAt: Date | undefined;
      if (schedule) {
        try {
          const interval = CronExpressionParser.parse(schedule, {
            currentDate: new Date(),
            tz: process.env.TZ || 'UTC',
          });
          nextRunAt = interval.next().toDate();
        } catch (error) {
          return reply.status(400).send({ error: 'Invalid cron expression' });
        }
      }

      // Update task
      const updateData: any = {};
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (action !== undefined) updateData.action = action;
      if (payload !== undefined) updateData.payload = payload;
      if (schedule !== undefined) updateData.schedule = schedule;
      if (nextRunAt) updateData.nextRunAt = nextRunAt;
      if (enabled !== undefined) updateData.enabled = enabled;

      // SECURITY: scope the write to this server — without serverId scoping a
      // caller with schedule rights on server A could rewrite (incl. injecting
      // a command payload) or delete any other server's task by ID (IDOR).
      const task = await prisma.scheduledTask.updateMany({
        where: { id: taskId, serverId },
        data: updateData,
      });

      if (task.count === 0) {
        return reply.status(404).send({ error: 'Task not found' });
      }

      // Reload task in scheduler
      const scheduler = (app as any).taskScheduler;
      if (scheduler) {
        const updatedTask = await prisma.scheduledTask.findUnique({
          where: { id: taskId },
        });
        if (!updatedTask) {
          return reply.status(404).send({ error: 'Task not found' });
        }
        if (updatedTask.enabled) {
          scheduler.scheduleTask(updatedTask);
        } else {
          scheduler.unscheduleTask(updatedTask.id);
        }
      }

      const reloadedTask = await prisma.scheduledTask.findUnique({
        where: { id: taskId },
      });

      reply.send(serialize({ success: true, task: reloadedTask }));

      // Broadcast task_updated event
      const wsGatewayTaskUpdated = (app as any).wsGateway;
      if (wsGatewayTaskUpdated?.pushToAdminSubscribers) {
        wsGatewayTaskUpdated.pushToAdminSubscribers('task_updated', {
          type: 'task_updated',
          serverId,
          taskId,
          taskName: reloadedTask?.name,
          updatedBy: user.userId,
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  // Delete a scheduled task
  app.delete(
    '/:serverId/tasks/:taskId',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user;
      const { serverId, taskId } = request.params as { serverId: string; taskId: string };

      const canSchedule = await ensureSchedulePermission(
        user.userId,
        serverId,
        reply,
        'You do not have permission to delete tasks for this server',
      );
      if (!canSchedule) return;

      // SECURITY: scope the delete to this server (see update handler note).
      const deleted = await prisma.scheduledTask.deleteMany({
        where: { id: taskId, serverId },
      });

      if (deleted.count === 0) {
        return reply.status(404).send({ error: 'Task not found' });
      }

      // Unschedule in scheduler
      const scheduler = (app as any).taskScheduler;
      if (scheduler) {
        scheduler.unscheduleTask(taskId);
      }

      reply.send({ success: true, message: 'Task deleted' });

      // Broadcast task_deleted event
      const wsGatewayTaskDeleted = (app as any).wsGateway;
      if (wsGatewayTaskDeleted?.pushToAdminSubscribers) {
        wsGatewayTaskDeleted.pushToAdminSubscribers('task_deleted', {
          type: 'task_deleted',
          serverId,
          taskId,
          deletedBy: user.userId,
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  // Execute a task immediately (one-time run)
  app.post(
    '/:serverId/tasks/:taskId/execute',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user;
      const { serverId, taskId } = request.params as { serverId: string; taskId: string };

      const canSchedule = await ensureSchedulePermission(
        user.userId,
        serverId,
        reply,
        'You do not have permission to execute tasks for this server',
      );
      if (!canSchedule) return;

      // Get task
      const task = await prisma.scheduledTask.findFirst({
        where: {
          id: taskId,
          serverId,
        },
      });

      if (!task) {
        return reply.status(404).send({ error: 'Task not found' });
      }
      if (task.action === 'command') {
        const serverRow = await prisma.server.findUnique({ where: { id: serverId }, select: { nodeId: true } });
        if (!serverRow || !(await ensureCommandPermission(user.userId, serverId, serverRow.nodeId, reply))) {
          if (serverRow) return;
          return reply.status(404).send({ error: 'Server not found' });
        }
      }

      // Execute immediately
      const scheduler = (app as any).taskScheduler;
      if (scheduler) {
        await scheduler.executeTask(task);
        reply.send({ success: true, message: 'Task executed' });
      } else {
        reply.status(500).send({ error: 'Task scheduler not available' });
      }
    }
  );
}
