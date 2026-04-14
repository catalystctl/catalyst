/**
 * Bulk Server Operations Routes
 *
 * Provides bulk suspend, unsuspend, and delete endpoints for billing panel integrations.
 * All operations are performed with proper permission checks and audit logging.
 */

import { prisma } from '../db.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { serialize } from '../utils/serialize';
import { hasNodeAccess } from '../lib/permissions';

interface BulkResult {
  success: string[];
  failed: Array<{ id: string; error: string }>;
}

export async function bulkServerRoutes(app: FastifyInstance) {
  const authenticate = (app as any).authenticate;

  /**
   * Helper: check if user has admin/suspend permission.
   */
  const ensureBulkPermission = async (userId: string, reply: FastifyReply) => {
    const { prisma: p } = await import('../db.js');
    const roles = await p.role.findMany({
      where: { users: { some: { id: userId } } },
      select: { permissions: true },
    });
    const permissions = roles.flatMap((r) => r.permissions);
    if (
      permissions.includes('*') ||
      permissions.includes('admin.write') ||
      permissions.includes('admin.read') ||
      permissions.includes('server.suspend')
    ) {
      return true;
    }
    reply.status(403).send({ error: 'Admin access required for bulk operations' });
    return false;
  };

  /**
   * Bulk Suspend Servers
   *
   * POST /api/servers/bulk/suspend
   * Body: { serverIds: string[], reason?: string, stopServer?: boolean }
   */
  app.post(
    '/bulk/suspend',
    { onRequest: [authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user.userId;
      const { serverIds, reason, stopServer } = request.body as {
        serverIds?: string[];
        reason?: string;
        stopServer?: boolean;
      };

      if (!Array.isArray(serverIds) || serverIds.length === 0) {
        return reply.status(400).send({ error: 'serverIds must be a non-empty array' });
      }

      if (serverIds.length > 100) {
        return reply.status(400).send({ error: 'Maximum 100 servers per bulk operation' });
      }

      if (!(await ensureBulkPermission(userId, reply))) return;

      const webhookService = (app as any).webhookService as import('../services/webhook-service').WebhookService | undefined;
      const scheduler = (app as any).taskScheduler;
      const gateway = (app as any).wsGateway;
      const shouldStop = stopServer !== false;

      const result: BulkResult = { success: [], failed: [] };

      // Fetch all servers in one query
      const servers = await prisma.server.findMany({
        where: { id: { in: serverIds } },
        select: { id: true, name: true, suspendedAt: true, status: true, nodeId: true, uuid: true, node: { select: { isOnline: true } } },
      });

      const serverMap = new Map(servers.map((s) => [s.id, s]));

      for (const serverId of serverIds) {
        const server = serverMap.get(serverId);
        if (!server) {
          result.failed.push({ id: serverId, error: 'Server not found' });
          continue;
        }

        if (server.suspendedAt) {
          result.failed.push({ id: serverId, error: 'Already suspended' });
          continue;
        }

        try {
          await prisma.server.update({
            where: { id: serverId },
            data: {
              status: 'suspended',
              suspendedAt: new Date(),
              suspendedByUserId: userId,
              suspensionReason: reason?.trim() || null,
            },
          });

          // Stop server if running and stopServer !== false
          if (shouldStop && (server.status === 'running' || server.status === 'starting')) {
            if (gateway && server.node?.isOnline) {
              await gateway.sendToAgent(server.nodeId, {
                type: 'stop_server',
                serverId: server.id,
                serverUuid: server.uuid,
              });
            }
          }

          // Disable scheduled tasks
          await prisma.scheduledTask.updateMany({
            where: { serverId, enabled: true },
            data: { enabled: false },
          });
          const tasks = await prisma.scheduledTask.findMany({
            where: { serverId, enabled: false },
            select: { id: true },
          });
          for (const task of tasks) {
            if (scheduler) scheduler.unscheduleTask(task.id);
          }

          await prisma.auditLog.create({
            data: {
              userId,
              action: 'server.bulk_suspend',
              resource: 'server',
              resourceId: serverId,
              details: { reason: reason?.trim() || undefined },
            },
          });

          result.success.push(serverId);
        } catch (err: any) {
          result.failed.push({ id: serverId, error: err.message || 'Unknown error' });
        }
      }

      // Fire webhook
      if (webhookService && result.success.length > 0) {
        webhookService.serverBulkSuspended(result.success, reason, userId).catch(() => {});
      }

      reply.send(serialize({
        success: true,
        data: result,
        summary: {
          total: serverIds.length,
          succeeded: result.success.length,
          failed: result.failed.length,
        },
      }));
    }
  );

  /**
   * Bulk Unsuspend Servers
   *
   * POST /api/servers/bulk/unsuspend
   * Body: { serverIds: string[] }
   */
  app.post(
    '/bulk/unsuspend',
    { onRequest: [authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user.userId;
      const { serverIds } = request.body as { serverIds?: string[] };

      if (!Array.isArray(serverIds) || serverIds.length === 0) {
        return reply.status(400).send({ error: 'serverIds must be a non-empty array' });
      }

      if (serverIds.length > 100) {
        return reply.status(400).send({ error: 'Maximum 100 servers per bulk operation' });
      }

      if (!(await ensureBulkPermission(userId, reply))) return;

      const scheduler = (app as any).taskScheduler;
      const result: BulkResult = { success: [], failed: [] };

      const servers = await prisma.server.findMany({
        where: { id: { in: serverIds } },
        select: { id: true, name: true, suspendedAt: true },
      });
      const serverMap = new Map(servers.map((s) => [s.id, s]));

      for (const serverId of serverIds) {
        const server = serverMap.get(serverId);
        if (!server) {
          result.failed.push({ id: serverId, error: 'Server not found' });
          continue;
        }

        if (!server.suspendedAt) {
          result.failed.push({ id: serverId, error: 'Not suspended' });
          continue;
        }

        try {
          await prisma.server.update({
            where: { id: serverId },
            data: {
              status: 'stopped',
              suspendedAt: null,
              suspendedByUserId: null,
              suspensionReason: null,
            },
          });

          // Re-enable scheduled tasks
          const reEnabled = await prisma.scheduledTask.updateMany({
            where: { serverId, enabled: false },
            data: { enabled: true },
          });
          if (reEnabled.count > 0) {
            const tasks = await prisma.scheduledTask.findMany({ where: { serverId, enabled: true } });
            for (const task of tasks) {
              if (scheduler) scheduler.scheduleTask(task);
            }
          }

          await prisma.auditLog.create({
            data: {
              userId,
              action: 'server.bulk_unsuspend',
              resource: 'server',
              resourceId: serverId,
              details: {},
            },
          });

          result.success.push(serverId);
        } catch (err: any) {
          result.failed.push({ id: serverId, error: err.message || 'Unknown error' });
        }
      }

      reply.send(serialize({
        success: true,
        data: result,
        summary: {
          total: serverIds.length,
          succeeded: result.success.length,
          failed: result.failed.length,
        },
      }));
    }
  );

  /**
   * Bulk Delete Servers
   *
   * DELETE /api/servers/bulk
   * Body: { serverIds: string[] }
   */
  app.delete(
    '/bulk',
    { onRequest: [authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user.userId;
      const { serverIds } = request.body as { serverIds?: string[] };

      if (!Array.isArray(serverIds) || serverIds.length === 0) {
        return reply.status(400).send({ error: 'serverIds must be a non-empty array' });
      }

      if (serverIds.length > 100) {
        return reply.status(400).send({ error: 'Maximum 100 servers per bulk operation' });
      }

      if (!(await ensureBulkPermission(userId, reply))) return;

      const webhookService = (app as any).webhookService as import('../services/webhook-service').WebhookService | undefined;
      const gateway = (app as any).wsGateway;
      const result: BulkResult = { success: [], failed: [] };

      const deletableStates = new Set(['stopped', 'error', 'crashed', 'installing']);
      const { releaseIpForServer } = await import('../utils/ipam');

      const servers = await prisma.server.findMany({
        where: { id: { in: serverIds } },
        select: { id: true, name: true, status: true, nodeId: true, uuid: true, suspendedAt: true, node: { select: { isOnline: true } } },
      });
      const serverMap = new Map(servers.map((s) => [s.id, s]));

      for (const serverId of serverIds) {
        const server = serverMap.get(serverId);
        if (!server) {
          result.failed.push({ id: serverId, error: 'Server not found' });
          continue;
        }

        if (!deletableStates.has(server.status)) {
          result.failed.push({ id: serverId, error: `Server must be stopped (current: ${server.status})` });
          continue;
        }

        try {
          const { releaseIpForServer: rip } = await import('../utils/ipam');

          await prisma.$transaction(async (tx) => {
            await rip(tx, serverId);
            await tx.server.delete({ where: { id: serverId } });
          });

          // Tell agent to clean up
          if (gateway && server.nodeId) {
            const sent = await gateway.sendToAgent(server.nodeId, {
              type: 'delete_server',
              serverId: server.id,
              serverUuid: server.uuid,
            });
            if (!sent) {
              app.log.warn(
                { serverId: server.id, nodeId: server.nodeId },
                'Agent offline during bulk delete — container cleanup skipped'
              );
            }
          }

          await prisma.auditLog.create({
            data: {
              userId,
              action: 'server.bulk_delete',
              resource: 'server',
              resourceId: serverId,
              details: { serverName: server.name },
            },
          });

          result.success.push(serverId);
        } catch (err: any) {
          result.failed.push({ id: serverId, error: err.message || 'Unknown error' });
        }
      }

      // Fire webhook
      if (webhookService && result.success.length > 0) {
        webhookService.serverBulkDeleted(result.success, userId).catch(() => {});
      }

      reply.send(serialize({
        success: true,
        data: result,
        summary: {
          total: serverIds.length,
          succeeded: result.success.length,
          failed: result.failed.length,
        },
      }));
    }
  );

  /**
   * Bulk Get Server Status
   *
   * POST /api/servers/bulk/status
   * Body: { serverIds: string[] }
   */
  app.post(
    '/bulk/status',
    { onRequest: [authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user.userId;
      const { serverIds } = request.body as { serverIds?: string[] };

      if (!Array.isArray(serverIds) || serverIds.length === 0) {
        return reply.status(400).send({ error: 'serverIds must be a non-empty array' });
      }

      if (serverIds.length > 200) {
        return reply.status(400).send({ error: 'Maximum 200 servers per status check' });
      }

      const servers = await prisma.server.findMany({
        where: { id: { in: serverIds } },
        select: {
          id: true,
          name: true,
          status: true,
          suspendedAt: true,
          suspensionReason: true,
          allocatedMemoryMb: true,
          allocatedCpuCores: true,
          primaryPort: true,
          primaryIp: true,
          nodeId: true,
          createdAt: true,
        },
      });

      const serverMap = new Map(servers.map((s) => [s.id, s]));
      const data = serverIds.map((id) => serverMap.get(id) || { id, status: 'not_found' });

      reply.send(serialize({ success: true, data }));
    }
  );
}
