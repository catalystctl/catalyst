import { prisma } from '../db.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import cron from 'node-cron';
import cronParser from 'cron-parser';
import { serialize } from '../utils/serialize';
import { hasNodeAccess } from '../lib/permissions';

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

    const hasNodeAccessToServer = await hasNodeAccess(prisma, userId, server.nodeId);

    if (!serverAccess && !hasNodeAccessToServer) {
      reply.status(403).send({ error: message });
      return false;
    }

    if (!hasNodeAccessToServer && !serverAccess?.permissions.includes('server.schedule')) {
      reply.status(403).send({ error: message });
      return false;
    }

    return true;
  };

  // Create a scheduled task
  app.post(
    '/:serverId/tasks',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;
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
      const validActions = ['restart', 'stop', 'start', 'backup', 'command'];
      if (!validActions.includes(action)) {
        return reply.status(400).send({
          error: `Invalid action. Must be one of: ${validActions.join(', ')}`,
        });
      }

      const canSchedule = await ensureSchedulePermission(
        user.userId,
        serverId,
        reply,
        'You do not have permission to schedule tasks for this server',
      );
      if (!canSchedule) return;

      let nextRunAt: Date | null = null;
      try {
        const interval = (cronParser as any).parseExpression(schedule, {
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
    }
  );

  // List scheduled tasks for a server
  app.get(
    '/:serverId/tasks',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;
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
      const user = (request as any).user;
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
      const user = (request as any).user;
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

      // Validate cron expression if provided
      if (schedule && !cron.validate(schedule)) {
        return reply.status(400).send({
          error: 'Invalid cron expression',
        });
      }

      let nextRunAt: Date | undefined;
      if (schedule) {
        try {
          const interval = (cronParser as any).parseExpression(schedule, {
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

      const task = await prisma.scheduledTask.update({
        where: { id: taskId },
        data: updateData,
      });

      // Reload task in scheduler
      const scheduler = (app as any).taskScheduler;
      if (scheduler) {
        if (task.enabled) {
          scheduler.scheduleTask(task);
        } else {
          scheduler.unscheduleTask(task.id);
        }
      }

      reply.send(serialize({ success: true, task }));
    }
  );

  // Delete a scheduled task
  app.delete(
    '/:serverId/tasks/:taskId',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;
      const { serverId, taskId } = request.params as { serverId: string; taskId: string };

      const canSchedule = await ensureSchedulePermission(
        user.userId,
        serverId,
        reply,
        'You do not have permission to delete tasks for this server',
      );
      if (!canSchedule) return;

      // Delete task
      await prisma.scheduledTask.delete({
        where: { id: taskId },
      });

      // Unschedule in scheduler
      const scheduler = (app as any).taskScheduler;
      if (scheduler) {
        scheduler.unscheduleTask(taskId);
      }

      reply.send({ success: true, message: 'Task deleted' });
    }
  );

  // Execute a task immediately (one-time run)
  app.post(
    '/:serverId/tasks/:taskId/execute',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;
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
