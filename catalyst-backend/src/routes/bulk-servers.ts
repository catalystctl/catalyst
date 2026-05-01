/**
 * Bulk Server Operations Routes
 *
 * Provides bulk suspend, unsuspend, and delete endpoints for billing panel integrations.
 * All operations are performed with proper permission checks and audit logging.
 */

import { prisma } from '../db.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { serialize } from '../utils/serialize';
import { hasNodeAccess, getUserAccessibleNodes } from '../lib/permissions';

interface BulkResult {
  success: string[];
  failed: Array<{ id: string; error: string }>;
}

export async function bulkServerRoutes(app: FastifyInstance) {
  const authenticate = (app as any).authenticate;

  /**
   * Helper: check if user has admin/suspend permission.
   */
  const ensureBulkPermission = (request: any, reply: FastifyReply) => {
    const perms: string[] = request.user?.permissions ?? [];
    if (
      perms.includes('*') ||
      perms.includes('admin.write') ||
      perms.includes('admin.read') ||
      perms.includes('server.suspend')
    ) {
      return true;
    }
    reply.status(403).send({ error: 'Admin access required for bulk operations' });
    return false;
  };

  /**
   * Helper: check if user has access to a specific server for bulk operations.
   * Returns true if user is admin, server owner, or has specific server permission.
   */
  const hasServerAccess = async (
    prismaClient: typeof prisma,
    request: any,
    serverId: string,
    requiredPermissions: string[]
  ): Promise<boolean> => {
    // Check permissions from request.user.permissions
    const userPermissions = new Set(request.user?.permissions ?? []);

    // Admins have access
    if (userPermissions.has('*') || userPermissions.has('admin.write') || userPermissions.has('admin.read')) {
      return true;
    }

    // Check if user has any of the required permissions
    for (const perm of requiredPermissions) {
      if (userPermissions.has(perm)) return true;
    }

    // Check server access table
    const access = await prismaClient.serverAccess.findUnique({
      where: { userId_serverId: { userId: request.user.userId, serverId } },
      select: { permissions: true },
    });

    if (access) {
      const accessPerms = new Set(access.permissions as string[]);
      for (const perm of requiredPermissions) {
        if (accessPerms.has(perm)) return true;
      }
    }

    // Check node access
    const server = await prismaClient.server.findUnique({
      where: { id: serverId },
      select: { nodeId: true, ownerId: true },
    });

    if (server) {
      const nodeAccess = await hasNodeAccess(prismaClient, request.user.userId, server.nodeId);
      if (nodeAccess) return true;
    }

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

      if (!(ensureBulkPermission(request, reply))) return;

      const webhookService = (app as any).webhookService as import('../services/webhook-service').WebhookService | undefined;
      const scheduler = (app as any).taskScheduler;
      const gateway = (app as any).wsGateway;
      const shouldStop = stopServer !== false;

      const result: BulkResult = { success: [], failed: [] };

      // Fetch all servers in one query
      const servers = await prisma.server.findMany({
        where: { id: { in: serverIds } },
        select: { id: true, name: true, suspendedAt: true, status: true, nodeId: true, uuid: true, ownerId: true, node: { select: { isOnline: true } } },
      });

      const serverMap = new Map(servers.map((s) => [s.id, s]));
      const auditLogs: Array<{ userId: string; action: string; resource: string; resourceId: string; details: any }> = [];

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

        // Check if user has permission for this specific server
        const hasServerPermission = server.ownerId === userId || 
          await hasServerAccess(prisma, request, serverId, ['server.suspend', 'server.update']);
        if (!hasServerPermission) {
          result.failed.push({ id: serverId, error: 'Not authorized' });
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

          auditLogs.push({
            userId,
            action: 'server.bulk_suspend',
            resource: 'server',
            resourceId: serverId,
            details: { reason: reason?.trim() || undefined },
          });

          result.success.push(serverId);
        } catch (err: any) {
          result.failed.push({ id: serverId, error: err.message || 'Unknown error' });
        }
      }

      if (auditLogs.length > 0) {
        await prisma.auditLog.createMany({ data: auditLogs });
      }

      // Fire webhook
      if (webhookService && result.success.length > 0) {
        webhookService.serverBulkSuspended(result.success, reason, userId).catch(() => {});
      }

      // Broadcast server_suspended events for each successfully suspended server
      const wsGatewayBulkSuspend = (app as any).wsGateway;
      if (wsGatewayBulkSuspend?.pushToAdminSubscribers) {
        for (const id of result.success) {
          wsGatewayBulkSuspend.pushToAdminSubscribers('server_suspended', {
            type: 'server_suspended',
            serverId: id,
            bulk: true,
            triggeredBy: userId,
            timestamp: new Date().toISOString(),
          });
        }
      }
      if (wsGatewayBulkSuspend?.pushToGlobalSubscribers) {
        for (const id of result.success) {
          wsGatewayBulkSuspend.pushToGlobalSubscribers('server_suspended', {
            type: 'server_suspended',
            serverId: id,
            bulk: true,
            triggeredBy: userId,
            timestamp: new Date().toISOString(),
          });
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

      if (!(ensureBulkPermission(request, reply))) return;

      const scheduler = (app as any).taskScheduler;
      const result: BulkResult = { success: [], failed: [] };

      const servers = await prisma.server.findMany({
        where: { id: { in: serverIds } },
        select: { id: true, name: true, suspendedAt: true, ownerId: true },
      });
      const serverMap = new Map(servers.map((s) => [s.id, s]));
      const auditLogs: Array<{ userId: string; action: string; resource: string; resourceId: string; details: any }> = [];

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

        // Check if user has permission for this specific server
        const hasServerPermission = server.ownerId === userId || 
          await hasServerAccess(prisma, request, serverId, ['server.suspend', 'server.update']);
        if (!hasServerPermission) {
          result.failed.push({ id: serverId, error: 'Not authorized' });
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

          auditLogs.push({
            userId,
            action: 'server.bulk_unsuspend',
            resource: 'server',
            resourceId: serverId,
            details: {},
          });

          result.success.push(serverId);
        } catch (err: any) {
          result.failed.push({ id: serverId, error: err.message || 'Unknown error' });
        }
      }

      if (auditLogs.length > 0) {
        await prisma.auditLog.createMany({ data: auditLogs });
      }

      // Broadcast server_unsuspended events for each successfully unsuspended server
      const wsGatewayBulkUnsuspend = (app as any).wsGateway;
      if (wsGatewayBulkUnsuspend?.pushToAdminSubscribers) {
        for (const id of result.success) {
          wsGatewayBulkUnsuspend.pushToAdminSubscribers('server_unsuspended', {
            type: 'server_unsuspended',
            serverId: id,
            bulk: true,
            triggeredBy: userId,
            timestamp: new Date().toISOString(),
          });
        }
      }
      if (wsGatewayBulkUnsuspend?.pushToGlobalSubscribers) {
        for (const id of result.success) {
          wsGatewayBulkUnsuspend.pushToGlobalSubscribers('server_unsuspended', {
            type: 'server_unsuspended',
            serverId: id,
            bulk: true,
            triggeredBy: userId,
            timestamp: new Date().toISOString(),
          });
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

      if (!(ensureBulkPermission(request, reply))) return;

      const webhookService = (app as any).webhookService as import('../services/webhook-service').WebhookService | undefined;
      const gateway = (app as any).wsGateway;
      const result: BulkResult = { success: [], failed: [] };

      const deletableStates = new Set(['stopped', 'error', 'crashed', 'installing']);
      const { releaseIpForServer } = await import('../utils/ipam');

      const servers = await prisma.server.findMany({
        where: { id: { in: serverIds } },
        select: { id: true, name: true, status: true, nodeId: true, uuid: true, suspendedAt: true, ownerId: true, node: { select: { isOnline: true } } },
      });
      const serverMap = new Map(servers.map((s) => [s.id, s]));
      const auditLogs: Array<{ userId: string; action: string; resource: string; resourceId: string; details: any }> = [];

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

        // Check if user has permission for this specific server
        const hasServerPermission = server.ownerId === userId || 
          await hasServerAccess(prisma, request, serverId, ['server.delete', 'server.update']);
        if (!hasServerPermission) {
          result.failed.push({ id: serverId, error: 'Not authorized' });
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

          auditLogs.push({
            userId,
            action: 'server.bulk_delete',
            resource: 'server',
            resourceId: serverId,
            details: { serverName: server.name },
          });

          result.success.push(serverId);
        } catch (err: any) {
          result.failed.push({ id: serverId, error: err.message || 'Unknown error' });
        }
      }

      if (auditLogs.length > 0) {
        await prisma.auditLog.createMany({ data: auditLogs });
      }

      // Fire webhook
      if (webhookService && result.success.length > 0) {
        webhookService.serverBulkDeleted(result.success, userId).catch(() => {});
      }

      // Broadcast server_deleted events for each successfully deleted server
      const wsGatewayBulkDelete = (app as any).wsGateway;
      if (wsGatewayBulkDelete?.pushToAdminSubscribers) {
        for (const id of result.success) {
          wsGatewayBulkDelete.pushToAdminSubscribers('server_deleted', {
            type: 'server_deleted',
            serverId: id,
            bulk: true,
            triggeredBy: userId,
            timestamp: new Date().toISOString(),
          });
        }
      }
      if (wsGatewayBulkDelete?.pushToGlobalSubscribers) {
        for (const id of result.success) {
          wsGatewayBulkDelete.pushToGlobalSubscribers('server_deleted', {
            type: 'server_deleted',
            serverId: id,
            bulk: true,
            triggeredBy: userId,
            timestamp: new Date().toISOString(),
          });
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

      // Get user's accessible nodes for filtering
      const accessibleNodes = await getUserAccessibleNodes(prisma, userId);
      const hasAccessToAllNodes = accessibleNodes.hasWildcard;
      const allowedNodeIds = accessibleNodes.nodeIds;

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
          ownerId: true,
        },
      });

      // Check if user has admin permissions (can see all servers)
      const perms: string[] = request.user?.permissions ?? [];
      const isAdmin = perms.includes('*') || perms.includes('admin.write') || perms.includes('admin.read');

      // Filter servers based on authorization
      const filteredServers = servers.filter((server) => {
        // Admins can see all servers
        if (isAdmin) return true;

        // Users can see their own servers
        if (server.ownerId === userId) return true;

        // Check if user has access via node assignment
        if (hasAccessToAllNodes || allowedNodeIds.includes(server.nodeId)) return true;

        // Check server access table
        return false; // Will be filtered out
      });

      const serverMap = new Map(filteredServers.map((s) => [s.id, s]));
      const data = serverIds.map((id) => {
        const server = serverMap.get(id);
        if (!server) {
          // Return minimal info for unauthorized servers
          return { id, status: 'not_found' };
        }
        // Return full data for authorized servers
        return server;
      });

      reply.send(serialize({ success: true, data }));
    }
  );
}
