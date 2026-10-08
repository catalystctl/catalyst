/**
 * Bulk Server Operations Routes
 *
 * Provides bulk suspend, unsuspend, and delete endpoints for billing panel integrations.
 * All operations are performed with proper permission checks and audit logging.
 */

import { prisma } from '../db.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { serialize } from '../utils/serialize';
import { getUserAccessibleNodes, hasGrant } from '../lib/permissions';
import { enrichAuditDetails, resolveActorDetails, buildServerAuditDetails } from '../middleware/audit.js';
import { apiError } from "../lib/http-error";
import { ErrorCodes } from "../shared-types";

interface BulkResult {
  success: string[];
  failed: Array<{ id: string; error: string }>;
}

const BULK_CONCURRENCY = 8;

export async function bulkServerRoutes(app: FastifyInstance) {
  const authenticate = (app as any).authenticate;

  /**
   * Helper: check the global permission for a bulk operation class.
   * Suspend/unsuspend require server.suspend (same as the single-server
   * routes); delete requires server.delete. hasGrant semantics: admin.write
   * and `*` satisfy any required permission. The gate is intentionally
   * panel-global — there is no per-server scoping layer for bulk actions.
   */
  const ensureBulkPermission = (request: any, reply: FastifyReply, required: string[]) => {
    const perms: string[] = request.user?.permissions ?? [];
    if (required.some((p) => hasGrant(perms, p))) {
      return true;
    }
    apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, 'Admin access required for bulk operations');
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
    { onRequest: [authenticate], config: { requiredPermission: 'server.suspend' } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user.userId;
      const { serverIds, reason, stopServer } = request.body as {
        serverIds?: string[];
        reason?: string;
        stopServer?: boolean;
      };

      if (!Array.isArray(serverIds) || serverIds.length === 0) {
        return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, 'serverIds must be a non-empty array');
      }

      if (serverIds.length > 100) {
        return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, 'Maximum 100 servers per bulk operation');
      }

      if (!(ensureBulkPermission(request, reply, ['server.suspend']))) return;

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
      const actorDetails = await resolveActorDetails(userId);
      const auditLogs: Array<{ userId: string; action: string; resource: string; resourceId: string; details: any }> = [];

      for (let offset = 0; offset < serverIds.length; offset += BULK_CONCURRENCY) {
        const batch = serverIds.slice(offset, offset + BULK_CONCURRENCY);
        await Promise.all(batch.map(async (serverId) => {
        const server = serverMap.get(serverId);
        if (!server) {
          result.failed.push({ id: serverId, error: 'Server not found' });
          return;
        }

        if (server.suspendedAt) {
          result.failed.push({ id: serverId, error: 'Already suspended' });
          return;
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

          // Read the affected tasks before updating them, so we only notify the
          // scheduler about tasks changed by this operation.
          const tasks = await prisma.scheduledTask.findMany({
            where: { serverId, enabled: true },
            select: { id: true },
          });
          const disabledBulkTasks = await prisma.scheduledTask.updateMany({
            where: { serverId, enabled: true },
            data: { enabled: false },
          });
          for (const task of tasks) {
            if (scheduler) scheduler.unscheduleTask(task.id);
          }
          if (disabledBulkTasks.count > 0) {
            // One aggregate event — FE invalidates the whole tasks(serverId) key.
            const bulkTaskEvent = {
              type: 'task_updated',
              serverId,
              timestamp: new Date().toISOString(),
            };
            if (gateway?.pushToGlobalSubscribers) {
              gateway.pushToGlobalSubscribers('task_updated', bulkTaskEvent);
            }
            if (gateway?.routeToClients) {
              void gateway.routeToClients(serverId, bulkTaskEvent).catch(() => {});
            }
          }

          auditLogs.push({
            userId,
            action: 'server.bulk_suspend',
            resource: 'server',
            resourceId: serverId,
            details: await enrichAuditDetails({
              userId,
              action: 'server.bulk_suspend',
              resource: 'server',
              resourceId: serverId,
              request,
              actorDetails,
              details: buildServerAuditDetails(server, {
                bulk: true,
                reason: reason?.trim() || undefined,
                stopServer: shouldStop,
                newStatus: 'suspended',
                previousStatus: server.status,
                serverName: server.name,
              }),
            }),
          });

          result.success.push(serverId);
        } catch (err: any) {
          result.failed.push({ id: serverId, error: err.message || 'Unknown error' });
        }
        }));
      }

      const order = new Map(serverIds.map((id, index) => [id, index]));
      result.success.sort((a, b) => (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER));
      result.failed.sort((a, b) => (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER));

      if (auditLogs.length > 0) {
        await prisma.auditLog.createMany({ data: auditLogs });
      }

      // Fire webhook
      if (webhookService && result.success.length > 0) {
        webhookService.serverBulkSuspended(result.success, reason, userId).catch(() => {});
      }

      // Broadcast server_suspended events for each successfully suspended server
      // on all three scopes: admin, global, and the server's own stream.
      const wsGatewayBulkSuspend = (app as any).wsGateway;
      for (const id of result.success) {
        const event = {
          type: 'server_suspended',
          serverId: id,
          nodeId: serverMap.get(id)?.nodeId,
          bulk: true,
          triggeredBy: userId,
          timestamp: new Date().toISOString(),
        };
        if (wsGatewayBulkSuspend?.pushToAdminSubscribers) {
          wsGatewayBulkSuspend.pushToAdminSubscribers('server_suspended', event);
        }
        if (wsGatewayBulkSuspend?.pushToGlobalSubscribers) {
          wsGatewayBulkSuspend.pushToGlobalSubscribers('server_suspended', event);
        }
        if (wsGatewayBulkSuspend?.routeToClients) {
          void wsGatewayBulkSuspend.routeToClients(id, event).catch(() => {});
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
    { onRequest: [authenticate], config: { requiredPermission: 'server.suspend' } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user.userId;
      const { serverIds } = request.body as { serverIds?: string[] };

      if (!Array.isArray(serverIds) || serverIds.length === 0) {
        return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, 'serverIds must be a non-empty array');
      }

      if (serverIds.length > 100) {
        return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, 'Maximum 100 servers per bulk operation');
      }

      if (!(ensureBulkPermission(request, reply, ['server.suspend']))) return;

      const scheduler = (app as any).taskScheduler;
      const result: BulkResult = { success: [], failed: [] };

      const servers = await prisma.server.findMany({
        where: { id: { in: serverIds } },
        select: { id: true, name: true, suspendedAt: true, ownerId: true, nodeId: true },
      });
      const serverMap = new Map(servers.map((s) => [s.id, s]));
      const actorDetails = await resolveActorDetails(userId);
      const auditLogs: Array<{ userId: string; action: string; resource: string; resourceId: string; details: any }> = [];

      for (let offset = 0; offset < serverIds.length; offset += BULK_CONCURRENCY) {
        const batch = serverIds.slice(offset, offset + BULK_CONCURRENCY);
        await Promise.all(batch.map(async (serverId) => {
        const server = serverMap.get(serverId);
        if (!server) {
          result.failed.push({ id: serverId, error: 'Server not found' });
          return;
        }

        if (!server.suspendedAt) {
          result.failed.push({ id: serverId, error: 'Not suspended' });
          return;
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

            // Read the affected tasks before updating them, avoiding a second
            // broad task read and ensuring only tasks changed here are queued.
            const tasks = await prisma.scheduledTask.findMany({
              where: { serverId, enabled: false },
              select: {
                id: true, serverId: true, name: true, description: true, action: true,
                payload: true, schedule: true, timeOffset: true, sequenceId: true,
                enabled: true, lastRunAt: true, nextRunAt: true, lastStatus: true,
                lastError: true, runCount: true, createdAt: true, updatedAt: true,
              },
            });
            const reEnabled = await prisma.scheduledTask.updateMany({
            where: { serverId, enabled: false },
            data: { enabled: true },
          });
          if (reEnabled.count > 0) {
            for (const task of tasks) {
              if (scheduler) scheduler.scheduleTask(task);
            }
            // One aggregate event — FE invalidates the whole tasks(serverId) key.
            const bulkGateway = (app as any).wsGateway;
            const bulkTaskEvent = {
              type: 'task_updated',
              serverId,
              timestamp: new Date().toISOString(),
            };
            if (bulkGateway?.pushToGlobalSubscribers) {
              bulkGateway.pushToGlobalSubscribers('task_updated', bulkTaskEvent);
            }
            if (bulkGateway?.routeToClients) {
              void bulkGateway.routeToClients(serverId, bulkTaskEvent).catch(() => {});
            }
          }

          auditLogs.push({
            userId,
            action: 'server.bulk_unsuspend',
            resource: 'server',
            resourceId: serverId,
            details: await enrichAuditDetails({
              userId,
              action: 'server.bulk_unsuspend',
              resource: 'server',
              resourceId: serverId,
              request,
              actorDetails,
              details: buildServerAuditDetails(server, {
                bulk: true,
                newStatus: 'stopped',
                serverName: server.name,
              }),
            }),
          });

          result.success.push(serverId);
        } catch (err: any) {
          result.failed.push({ id: serverId, error: err.message || 'Unknown error' });
        }
        }));
      }

      const order = new Map(serverIds.map((id, index) => [id, index]));
      result.success.sort((a, b) => (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER));
      result.failed.sort((a, b) => (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER));

      if (auditLogs.length > 0) {
        await prisma.auditLog.createMany({ data: auditLogs });
      }

      // Broadcast server_unsuspended events for each successfully unsuspended server
      // on all three scopes: admin, global, and the server's own stream.
      const wsGatewayBulkUnsuspend = (app as any).wsGateway;
      for (const id of result.success) {
        const event = {
          type: 'server_unsuspended',
          serverId: id,
          nodeId: serverMap.get(id)?.nodeId,
          bulk: true,
          triggeredBy: userId,
          timestamp: new Date().toISOString(),
        };
        if (wsGatewayBulkUnsuspend?.pushToAdminSubscribers) {
          wsGatewayBulkUnsuspend.pushToAdminSubscribers('server_unsuspended', event);
        }
        if (wsGatewayBulkUnsuspend?.pushToGlobalSubscribers) {
          wsGatewayBulkUnsuspend.pushToGlobalSubscribers('server_unsuspended', event);
        }
        if (wsGatewayBulkUnsuspend?.routeToClients) {
          void wsGatewayBulkUnsuspend.routeToClients(id, event).catch(() => {});
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
    { onRequest: [authenticate], config: { requiredPermission: 'server.delete' } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user.userId;
      // DELETE bodies are optional in Fastify — guard before destructuring
      // (a bodiless request must 400, not 500).
      const { serverIds } = (request.body ?? {}) as { serverIds?: string[] };

      if (!Array.isArray(serverIds) || serverIds.length === 0) {
        return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, 'serverIds must be a non-empty array');
      }

      if (serverIds.length > 100) {
        return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, 'Maximum 100 servers per bulk operation');
      }

      if (!(ensureBulkPermission(request, reply, ['server.delete']))) return;

      const webhookService = (app as any).webhookService as import('../services/webhook-service').WebhookService | undefined;
      const gateway = (app as any).wsGateway;
      const result: BulkResult = { success: [], failed: [] };

      const deletableStates = new Set(['stopped', 'error', 'crashed', 'installing']);

      const servers = await prisma.server.findMany({
        where: { id: { in: serverIds } },
        select: { id: true, name: true, status: true, nodeId: true, uuid: true, suspendedAt: true, ownerId: true, node: { select: { isOnline: true } } },
      });
      const serverMap = new Map(servers.map((s) => [s.id, s]));
      const actorDetails = await resolveActorDetails(userId);
      const auditLogs: Array<{ userId: string; action: string; resource: string; resourceId: string; details: any }> = [];

      for (let offset = 0; offset < serverIds.length; offset += BULK_CONCURRENCY) {
        const batch = serverIds.slice(offset, offset + BULK_CONCURRENCY);
        await Promise.all(batch.map(async (serverId) => {
        const server = serverMap.get(serverId);
        if (!server) {
          result.failed.push({ id: serverId, error: 'Server not found' });
          return;
        }

        if (!deletableStates.has(server.status)) {
          result.failed.push({ id: serverId, error: `Server must be stopped (current: ${server.status})` });
          return;
        }

        try {
          const { releaseIpForServer: rip } = await import('../utils/ipam');
          const { dropDatabase } = await import('../services/mysql');

          // Drop provisioned MySQL DBs before cascade-deleting the Server row.
          const serverDatabases = await prisma.serverDatabase.findMany({
            where: { serverId },
            select: {
              id: true,
              name: true,
              username: true,
              host: true,
            },
          });
          for (const database of serverDatabases) {
            try {
              await dropDatabase(database.host, database.name, database.username);
            } catch (err: any) {
              app.log.warn(
                { serverId, databaseId: database.id, error: err?.message },
                'Failed to drop server database during bulk delete — continuing',
              );
            }
          }

          // Best-effort agent cleanup before cascade delete so offline status is known.
          let agentOffline = false;
          if (gateway && server.nodeId) {
            if (gateway.removeDiscoveredContainer) {
              gateway.removeDiscoveredContainer(server.nodeId, server.id);
            }
            const sent = await gateway.sendToAgent(server.nodeId, {
              type: 'delete_server',
              serverId: server.id,
              serverUuid: server.uuid,
            });
            if (!sent) {
              agentOffline = true;
              app.log.warn(
                { serverId: server.id, nodeId: server.nodeId },
                'Agent offline during bulk delete — container cleanup skipped',
              );
            }
          }

          // Per-server viewers get server_deleted while the row still exists —
          // routeToClients re-checks access against it, so a push after the
          // delete below would find no server and silently drop the event.
          const bulkDeletedEvent = {
            type: 'server_deleted',
            serverId,
            nodeId: server.nodeId,
            bulk: true,
            triggeredBy: userId,
            timestamp: new Date().toISOString(),
          };
          if (gateway?.routeToClients) {
            void gateway.routeToClients(serverId, bulkDeletedEvent).catch(() => {});
          }

          await prisma.$transaction(async (tx) => {
            await rip(tx, serverId);
            await tx.server.delete({ where: { id: serverId } });
          });

          auditLogs.push({
            userId,
            action: 'server.bulk_delete',
            resource: 'server',
            resourceId: serverId,
            details: await enrichAuditDetails({
              userId,
              action: 'server.bulk_delete',
              resource: 'server',
              resourceId: serverId,
              request,
              actorDetails,
              details: buildServerAuditDetails(server, {
                bulk: true,
                serverName: server.name,
                previousStatus: server.status,
                ...(agentOffline ? { agentCleanup: false, warning: 'agent offline' } : { agentCleanup: true }),
              }),
            }),
          });

          result.success.push(serverId);
        } catch (err: any) {
          result.failed.push({ id: serverId, error: err.message || 'Unknown error' });
        }
        }));
      }

      const order = new Map(serverIds.map((id, index) => [id, index]));
      result.success.sort((a, b) => (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER));
      result.failed.sort((a, b) => (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER));

      if (auditLogs.length > 0) {
        await prisma.auditLog.createMany({ data: auditLogs });
      }

      // Fire webhook
      if (webhookService && result.success.length > 0) {
        webhookService.serverBulkDeleted(result.success, userId).catch(() => {});
      }

      // Broadcast server_deleted events for each successfully deleted server.
      // The per-server leg was already emitted pre-delete inside the loop.
      const wsGatewayBulkDelete = (app as any).wsGateway;
      for (const id of result.success) {
        const event = {
          type: 'server_deleted',
          serverId: id,
          nodeId: serverMap.get(id)?.nodeId,
          bulk: true,
          triggeredBy: userId,
          timestamp: new Date().toISOString(),
        };
        if (wsGatewayBulkDelete?.pushToAdminSubscribers) {
          wsGatewayBulkDelete.pushToAdminSubscribers('server_deleted', event);
        }
        if (wsGatewayBulkDelete?.pushToGlobalSubscribers) {
          wsGatewayBulkDelete.pushToGlobalSubscribers('server_deleted', event);
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
    { onRequest: [authenticate], config: { requiredPermission: 'server.read' } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user.userId;
      const { serverIds } = request.body as { serverIds?: string[] };

      if (!Array.isArray(serverIds) || serverIds.length === 0) {
        return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, 'serverIds must be a non-empty array');
      }

      if (serverIds.length > 200) {
        return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, 'Maximum 200 servers per status check');
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

      // Check if user has admin read permissions (can see all servers).
      // hasGrant: admin.read admits admin.write and `*` too — the read
      // everything contract covers bulk status.
      const perms: string[] = request.user?.permissions ?? [];
      const isAdmin = hasGrant(perms, 'admin.read');
      const canManageNode = (nodeId: string) =>
        (hasAccessToAllNodes || allowedNodeIds.includes(nodeId)) &&
        hasGrant(perms, 'node.update');
      const grantedServerIds = isAdmin
        ? new Set<string>()
        : new Set(
            (
              await prisma.serverAccess.findMany({
                where: { userId, serverId: { in: serverIds } },
                select: { serverId: true },
              })
            ).map((r) => r.serverId),
          );

      // Filter servers based on authorization
      const filteredServers = servers.filter((server) => {
        // Admins can see all servers
        if (isAdmin) return true;

        // Users can see their own servers
        if (server.ownerId === userId) return true;

        // Explicit per-server grant.
        if (grantedServerIds.has(server.id)) return true;

        // Node assignment alone is not enough; require the node.update pairing.
        if (canManageNode(server.nodeId)) return true;

        return false;
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
