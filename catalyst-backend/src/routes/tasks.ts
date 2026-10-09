import { prisma } from '../db.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import cron from 'node-cron';
import { CronExpressionParser } from 'cron-parser';
import { serialize } from '../utils/serialize';
import { hasNodeAccess } from '../lib/permissions';
import { Actor, enforceKeyScope, ensureServerAccess } from './servers/_helpers.js';
import { apiError } from "../lib/http-error";
import { ErrorCodes } from "../shared-types";
import { config } from "../config.js";
import { parsePaginationParams, buildPaginationMeta } from '../lib/pagination.js';

/** Allowed scheduled-task actions (create + update). */
const TASK_ACTIONS = ['restart', 'stop', 'start', 'backup', 'command'] as const;
type TaskAction = (typeof TASK_ACTIONS)[number];

function isValidTaskAction(action: string): action is TaskAction {
  return (TASK_ACTIONS as readonly string[]).includes(action);
}

/**
 * Per-action permission requirements: a scheduled task executes its action
 * server-side without re-checking the creator's rights at fire time, so the
 * creator must hold the same permission the direct route would demand.
 * "restart" needs start AND stop (power-route all-of contract); "command"
 * keeps the console.write double-check.
 */
const TASK_ACTION_PERMISSIONS: Record<TaskAction, readonly string[]> = {
  start: ['server.start'],
  stop: ['server.stop'],
  restart: ['server.start', 'server.stop'],
  backup: ['backup.create'],
  command: ['console.write'],
};
export async function taskRoutes(app: FastifyInstance) {
  // Using shared prisma instance from db.ts
  const authenticate = (app as any).authenticate;
  const ensureSchedulePermission = async (
    userId: string,
    serverId: string,
    reply: FastifyReply,
    message: string,
    // Mandatory actor: the key-scope ceiling below must never be silently
    // skipped. System/cron callers pass SYSTEM_ACTOR.
    actor: Actor,
  ) => {
    // Key-scope ceiling: an API key must itself hold server.schedule.
    if (!enforceKeyScope(actor, 'server.schedule')) {
      apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, message);
      return false;
    }
    const server = await prisma.server.findUnique({
      where: { id: serverId },
      select: { ownerId: true, suspendedAt: true, suspensionReason: true, nodeId: true },
    });

    if (!server) {
      apiError(reply, 404, ErrorCodes.SERVER_NOT_FOUND, 'Server not found');
      return false;
    }

    if (config.suspension.enforced && server.suspendedAt) {
      reply.status(423).send({
        error: 'Server is suspended',
        code: ErrorCodes.SERVER_SUSPENDED,
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
    const { hasGrant } = await import('../lib/permissions.js');
    const rolePerms = await resolveServerPermissions(userId, serverId, server.nodeId);
    const roleAllowed = hasGrant(rolePerms, 'server.schedule');

    // SECURITY: a bare node assignment must NOT grant scheduling (tasks can
    // run arbitrary console commands via action "command" in ANY server's
    // container on the node). Node access only counts when paired with the
    // node-manage capability — mirrors decideServerAccess (legacy
    // node.update or its split value node.server_manage).
    const hasNodeAccessToServer =
      nodeGrant &&
      (rolePerms.includes('node.update') || rolePerms.includes('node.server_manage'));

    if (!serverAccess && !hasNodeAccessToServer && !roleAllowed) {
      apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, message);
      return false;
    }

    if (!hasNodeAccessToServer && !roleAllowed && !serverAccess?.permissions.includes('server.schedule')) {
      apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, message);
      return false;
    }

    return true;
  };
  /**
   * Action-capability double-check: the task's action must be backed by the
   * matching server permission (row grant, role grant, or node-manage), not
   * just server.schedule. Owner always passes.
   */
  const ensureActionPermission = async (
    userId: string,
    serverId: string,
    nodeId: string,
    action: TaskAction,
    reply: FastifyReply,
    // Mandatory actor: the key-scope ceiling below must never be silently
    // skipped. System/cron callers pass SYSTEM_ACTOR.
    actor: Actor,
  ) => {
    const required = TASK_ACTION_PERMISSIONS[action];
    // Key-scope ceiling: an API key must itself hold every required
    // permission (all-of, so restart needs both start and stop).
    if (!required.every((p) => enforceKeyScope(actor, p))) {
      apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, `You do not have permission to schedule ${action} tasks on this server`);
      return false;
    }
    const server = await prisma.server.findUnique({
      where: { id: serverId },
      select: { ownerId: true },
    });
    if (server?.ownerId === userId) return true;
    const access = await prisma.serverAccess.findFirst({
      where: { serverId, userId, permissions: { hasEvery: [...required] } },
    });
    if (access) return true;
    const { resolveServerPermissions } = await import('../lib/permissions-catalog.js');
    const { hasGrant } = await import('../lib/permissions.js');
    const rolePerms = await resolveServerPermissions(userId, serverId, nodeId);
    if (required.every((p) => hasGrant(rolePerms, p))) {
      return true;
    }
    if ((await hasNodeAccess(prisma, userId, nodeId)) && (rolePerms.includes('node.update') || rolePerms.includes('node.server_manage'))) {
      return true;
    }
    apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, action === 'command'
      ? 'You do not have permission to run console commands on this server'
      : `You do not have permission to schedule ${action} tasks on this server`);
    return false;
  };

  // Create a scheduled task
  app.post(
    '/:serverId/tasks',
    { preHandler: authenticate, config: { requiredPermission: 'server.schedule' }, schema: { summary: 'Create a scheduled task', description: 'Create a scheduled server task.', tags: ['Tasks'], params: { type: 'object', required: ['serverId'], properties: { serverId: { type: 'string' } } }, body: { type: 'object', required: ['name', 'action', 'schedule'], properties: { name: { type: 'string' }, description: { type: 'string' }, action: { type: 'string', enum: ['restart', 'stop', 'start', 'backup', 'command'] }, payload: {}, schedule: { type: 'string' } } }, response: { 200: { type: 'object', additionalProperties: true } } } },
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
        return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, 'Missing required fields: name, action, schedule');
      }

      // Validate cron expression
      if (!cron.validate(schedule)) {
        return apiError(reply, 400, ErrorCodes.TASK_INVALID_CRON, 'Invalid cron expression. Use standard cron format (e.g., "0 3 * * *")');
      }

      // Validate action
      if (!isValidTaskAction(action)) {
        return apiError(reply, 400, ErrorCodes.TASK_INVALID_ACTION, `Invalid action. Must be one of: ${TASK_ACTIONS.join(', ')}`, { params: { actions: TASK_ACTIONS.join(', ') } });
      }

      const canSchedule = await ensureSchedulePermission(
        user.userId,
        serverId,
        reply,
        'You do not have permission to schedule tasks for this server',
        request.user,
      );
      if (!canSchedule) return;

      {
        const serverRow = await prisma.server.findUnique({ where: { id: serverId }, select: { nodeId: true } });
        if (!serverRow || !(await ensureActionPermission(user.userId, serverId, serverRow.nodeId, action, reply, request.user))) {
          if (serverRow) return;
          return apiError(reply, 404, ErrorCodes.SERVER_NOT_FOUND, 'Server not found');
        }
      }

      let nextRunAt: Date | null = null;
      try {
        const interval = CronExpressionParser.parse(schedule, {
          currentDate: new Date(),
          tz: config.timezone.tz,
        });
        nextRunAt = interval.next().toDate();
      } catch (error) {
        return apiError(reply, 400, ErrorCodes.TASK_INVALID_CRON, 'Invalid cron expression');
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

      // Broadcast task_created event — admin + global + per-server stream.
      const wsGatewayTaskCreated = app.wsGateway;
      const taskCreatedEvent = {
        type: 'task_created',
        serverId,
        taskId: task.id,
        taskName: task.name,
        createdBy: user.userId,
        timestamp: new Date().toISOString(),
      };
      if (wsGatewayTaskCreated?.pushToAdminSubscribers) {
        wsGatewayTaskCreated.pushToAdminSubscribers('task_created', taskCreatedEvent);
      }
      if (wsGatewayTaskCreated?.pushToGlobalSubscribers) {
        wsGatewayTaskCreated.pushToGlobalSubscribers('task_created', taskCreatedEvent);
      }
      if (wsGatewayTaskCreated?.routeToClients) {
        void wsGatewayTaskCreated.routeToClients(serverId, taskCreatedEvent).catch(() => {});
      }
    }
  );

  // List scheduled tasks for a server
  // Reads gate on server.read like every other server read (A-READ-GAP:
  // task listings previously demanded server.schedule, locking read-tier
  // subusers and admin.read roles out of viewing their own tasks).
  app.get(
    '/:serverId/tasks',
    { preHandler: authenticate, config: { requiredPermission: 'server.read' }, schema: { summary: 'List scheduled tasks', description: 'List scheduled tasks for a server.', tags: ['Tasks'], params: { type: 'object', required: ['serverId'], properties: { serverId: { type: 'string' } } }, response: { 200: { type: 'object', additionalProperties: true } } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user;
      const { serverId } = request.params as { serverId: string };
      const { page, limit } = request.query as { page?: number | string; limit?: number | string };
      // Use standardized pagination helper (page/limit pattern with max 100)
      const { pageNumber, pageSize, skip, paginated } = parsePaginationParams(page, limit);

      if (!(await ensureServerAccess(serverId, user.userId, 'server.read', reply, request.user))) return;

      const taskQuery = {
        where: { serverId },
        orderBy: { createdAt: 'desc' },
        ...(paginated ? { skip, take: pageSize } : {}),
      } as const;
      const [tasks, total] = await Promise.all([
        prisma.scheduledTask.findMany(taskQuery),
        paginated ? prisma.scheduledTask.count({ where: { serverId } }) : Promise.resolve(0),
      ]);

      reply.send(serialize({
        tasks,
        ...(paginated
          ? { pagination: buildPaginationMeta(pageNumber, pageSize, total) }
          : {}),
      }));
    }
  );

  // Get a specific task
  app.get(
    '/:serverId/tasks/:taskId',
    { preHandler: authenticate, config: { requiredPermission: 'server.read' }, schema: { summary: 'Get a scheduled task', description: 'Get a scheduled task for a server.', tags: ['Tasks'], params: { type: 'object', required: ['serverId', 'taskId'], properties: { serverId: { type: 'string' }, taskId: { type: 'string' } } }, response: { 200: { type: 'object', additionalProperties: true } } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user;
      const { serverId, taskId } = request.params as { serverId: string; taskId: string };

      if (!(await ensureServerAccess(serverId, user.userId, 'server.read', reply, request.user))) return;

      const task = await prisma.scheduledTask.findFirst({
        where: {
          id: taskId,
          serverId,
        },
      });

      if (!task) {
        return apiError(reply, 404, ErrorCodes.TASK_NOT_FOUND, 'Task not found');
      }

      reply.send(serialize({ task }));
    }
  );

  // Update a scheduled task
  app.put(
    '/:serverId/tasks/:taskId',
    { preHandler: authenticate, config: { requiredPermission: 'server.schedule' }, schema: { summary: 'Update a scheduled task', description: 'Update a scheduled task.', tags: ['Tasks'], params: { type: 'object', required: ['serverId', 'taskId'], properties: { serverId: { type: 'string' }, taskId: { type: 'string' } } }, body: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, action: { type: 'string', enum: ['restart', 'stop', 'start', 'backup', 'command'] }, payload: {}, schedule: { type: 'string' }, enabled: { type: 'boolean' } } }, response: { 200: { type: 'object', additionalProperties: true } } } },
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
        request.user,
      );
      if (!canSchedule) return;
      // Re-check the effective action's capability: the new action when the
      // body changes it, otherwise the stored one (guards payload injection
      // into an existing command/power/backup task, not just action flips).
      let effectiveAction: TaskAction | undefined;
      if (action !== undefined) {
        effectiveAction = isValidTaskAction(action) ? action : undefined;
      } else {
        const existingTask = await prisma.scheduledTask.findFirst({
          where: { id: taskId, serverId },
          select: { action: true },
        });
        effectiveAction = existingTask?.action as TaskAction | undefined;
      }
      if (effectiveAction) {
        const serverRow = await prisma.server.findUnique({ where: { id: serverId }, select: { nodeId: true } });
        if (!serverRow || !(await ensureActionPermission(user.userId, serverId, serverRow.nodeId, effectiveAction, reply, request.user))) {
          if (serverRow) return;
          return apiError(reply, 404, ErrorCodes.SERVER_NOT_FOUND, 'Server not found');
        }
      }

      // Re-validate action against the same allowlist as create
      if (action !== undefined && !isValidTaskAction(action)) {
        return apiError(reply, 400, ErrorCodes.TASK_INVALID_ACTION, `Invalid action. Must be one of: ${TASK_ACTIONS.join(', ')}`, { params: { actions: TASK_ACTIONS.join(', ') } });
      }

      // Validate cron expression if provided
      if (schedule && !cron.validate(schedule)) {
        return apiError(reply, 400, ErrorCodes.TASK_INVALID_CRON, 'Invalid cron expression');
      }

      let nextRunAt: Date | undefined;
      if (schedule) {
        try {
          const interval = CronExpressionParser.parse(schedule, {
            currentDate: new Date(),
            tz: config.timezone.tz,
          });
          nextRunAt = interval.next().toDate();
        } catch (error) {
          return apiError(reply, 400, ErrorCodes.TASK_INVALID_CRON, 'Invalid cron expression');
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
        return apiError(reply, 404, ErrorCodes.TASK_NOT_FOUND, 'Task not found');
      }

      // Reload task in scheduler
      const scheduler = (app as any).taskScheduler;
      if (scheduler) {
        const updatedTask = await prisma.scheduledTask.findUnique({
          where: { id: taskId },
        });
        if (!updatedTask) {
          return apiError(reply, 404, ErrorCodes.TASK_NOT_FOUND, 'Task not found');
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

      // Broadcast task_updated event — admin + global + per-server (see task_created).
      const wsGatewayTaskUpdated = app.wsGateway;
      const taskUpdatedEvent = {
        type: 'task_updated',
        serverId,
        taskId,
        taskName: reloadedTask?.name,
        updatedBy: user.userId,
        timestamp: new Date().toISOString(),
      };
      if (wsGatewayTaskUpdated?.pushToAdminSubscribers) {
        wsGatewayTaskUpdated.pushToAdminSubscribers('task_updated', taskUpdatedEvent);
      }
      if (wsGatewayTaskUpdated?.pushToGlobalSubscribers) {
        wsGatewayTaskUpdated.pushToGlobalSubscribers('task_updated', taskUpdatedEvent);
      }
      if (wsGatewayTaskUpdated?.routeToClients) {
        void wsGatewayTaskUpdated.routeToClients(serverId, taskUpdatedEvent).catch(() => {});
      }
    }
  );

  // Delete a scheduled task
  app.delete(
    '/:serverId/tasks/:taskId',
    { preHandler: authenticate, config: { requiredPermission: 'server.schedule' } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user;
      const { serverId, taskId } = request.params as { serverId: string; taskId: string };

      const canSchedule = await ensureSchedulePermission(
        user.userId,
        serverId,
        reply,
        'You do not have permission to delete tasks for this server',
        request.user,
      );
      if (!canSchedule) return;

      // SECURITY: scope the delete to this server (see update handler note).
      const deleted = await prisma.scheduledTask.deleteMany({
        where: { id: taskId, serverId },
      });

      if (deleted.count === 0) {
        return apiError(reply, 404, ErrorCodes.TASK_NOT_FOUND, 'Task not found');
      }

      // Unschedule in scheduler
      const scheduler = (app as any).taskScheduler;
      if (scheduler) {
        scheduler.unscheduleTask(taskId);
      }

      reply.send({ success: true, message: 'Task deleted' });

      // Broadcast task_deleted event — admin + global + per-server (see task_created).
      const wsGatewayTaskDeleted = app.wsGateway;
      const taskDeletedEvent = {
        type: 'task_deleted',
        serverId,
        taskId,
        deletedBy: user.userId,
        timestamp: new Date().toISOString(),
      };
      if (wsGatewayTaskDeleted?.pushToAdminSubscribers) {
        wsGatewayTaskDeleted.pushToAdminSubscribers('task_deleted', taskDeletedEvent);
      }
      if (wsGatewayTaskDeleted?.pushToGlobalSubscribers) {
        wsGatewayTaskDeleted.pushToGlobalSubscribers('task_deleted', taskDeletedEvent);
      }
      if (wsGatewayTaskDeleted?.routeToClients) {
        void wsGatewayTaskDeleted.routeToClients(serverId, taskDeletedEvent).catch(() => {});
      }
    }
  );

  // Execute a task immediately (one-time run)
  app.post(
    '/:serverId/tasks/:taskId/execute',
    { preHandler: authenticate, config: { requiredPermission: 'server.schedule' } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user;
      const { serverId, taskId } = request.params as { serverId: string; taskId: string };

      const canSchedule = await ensureSchedulePermission(
        user.userId,
        serverId,
        reply,
        'You do not have permission to execute tasks for this server',
        request.user,
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
        return apiError(reply, 404, ErrorCodes.TASK_NOT_FOUND, 'Task not found');
      }
      {
        // The stored action's capability must be backed at execute time too
        // (execute runs the action immediately, same as the direct routes).
        const serverRow = await prisma.server.findUnique({ where: { id: serverId }, select: { nodeId: true } });
        if (!serverRow || !(await ensureActionPermission(user.userId, serverId, serverRow.nodeId, task.action as TaskAction, reply, request.user))) {
          if (serverRow) return;
          return apiError(reply, 404, ErrorCodes.SERVER_NOT_FOUND, 'Server not found');
        }
      }

      // Execute immediately
      const scheduler = (app as any).taskScheduler;
      if (scheduler) {
        await scheduler.executeTask(task);
        reply.send({ success: true, message: 'Task executed' });
      } else {
        apiError(reply, 500, ErrorCodes.TASK_SCHEDULER_UNAVAILABLE, 'Task scheduler not available');
      }
    }
  );
}
