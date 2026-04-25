import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../../db.js";
import { allocateIpForServer, checkIsAdmin, decryptBackupConfig, encryptBackupConfig, ensureNotSuspended, ensureServerAccess, ensureSuspendPermission, hasNodeAccess, path, redactBackupConfig, releaseIpForServer, shouldUseIpam } from './_helpers.js';

export async function serverAdminopsRoutes(app: FastifyInstance) {
  app.patch(
    "/:id/restart-policy",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { restartPolicy, maxCrashCount } = request.body as {
        restartPolicy?: string;
        maxCrashCount?: number;
      };

      // Validate restart policy
      const validPolicies = ["always", "on-failure", "never"];
      if (restartPolicy && !validPolicies.includes(restartPolicy)) {
        return reply.status(400).send({
          error: `Invalid restart policy. Must be one of: ${validPolicies.join(", ")}`,
        });
      }

      // Validate max crash count
      if (maxCrashCount !== undefined && (maxCrashCount < 0 || maxCrashCount > 100)) {
        return reply.status(400).send({
          error: "maxCrashCount must be between 0 and 100",
        });
      }

      const server = await prisma.server.findUnique({
        where: { id },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (!ensureNotSuspended(server, reply)) {
        return;
      }

      const canUpdate = await ensureServerAccess(
        id,
        request.user.userId,
        "server.start",
        reply
      );
      if (!canUpdate) return;

      // Update server
      const updated = await prisma.server.update({
        where: { id },
        data: {
          restartPolicy: restartPolicy || server.restartPolicy,
          maxCrashCount: maxCrashCount ?? server.maxCrashCount,
        },
      });

      const wsGateway = app.wsGateway;
      if (wsGateway?.pushToAdminSubscribers) {
        wsGateway.pushToAdminSubscribers('server_updated', {
          type: 'server_updated',
          serverId: id,
          updatedBy: request.user.userId,
          change: 'restart_policy_updated',
          timestamp: new Date().toISOString(),
        });
      }
      if (wsGateway?.pushToGlobalSubscribers) {
        wsGateway.pushToGlobalSubscribers('server_updated', {
          type: 'server_updated',
          serverId: id,
          updatedBy: request.user.userId,
          change: 'restart_policy_updated',
          timestamp: new Date().toISOString(),
        });
      }

      reply.send({
        success: true,
        restartPolicy: updated.restartPolicy,
        maxCrashCount: updated.maxCrashCount,
      });
    }
  );

  // Reset crash count
  app.post(
    "/:id/reset-crash-count",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const server = await prisma.server.findUnique({
        where: { id },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (!ensureNotSuspended(server, reply)) {
        return;
      }

      const canUpdate = await ensureServerAccess(
        id,
        request.user.userId,
        "server.start",
        reply
      );
      if (!canUpdate) return;

      await prisma.server.update({
        where: { id },
        data: {
          crashCount: 0,
          lastCrashAt: null,
        },
      });

      const wsGateway = app.wsGateway;
      if (wsGateway?.pushToAdminSubscribers) {
        wsGateway.pushToAdminSubscribers('server_updated', {
          type: 'server_updated',
          serverId: id,
          updatedBy: request.user.userId,
          change: 'crash_count_reset',
          timestamp: new Date().toISOString(),
        });
      }
      if (wsGateway?.pushToGlobalSubscribers) {
        wsGateway.pushToGlobalSubscribers('server_updated', {
          type: 'server_updated',
          serverId: id,
          updatedBy: request.user.userId,
          change: 'crash_count_reset',
          timestamp: new Date().toISOString(),
        });
      }

      reply.send({ success: true, message: "Crash count reset" });
    }
  );

  // Update backup settings
  app.patch(
    "/:id/backup-settings",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const {
        storageMode,
        retentionCount,
        retentionDays,
        s3Config,
        sftpConfig,
      } = request.body as {
        storageMode?: string;
        retentionCount?: number;
        retentionDays?: number;
        s3Config?: {
          bucket?: string | null;
          region?: string | null;
          endpoint?: string | null;
          accessKeyId?: string | null;
          secretAccessKey?: string | null;
          pathStyle?: boolean | null;
        } | null;
        sftpConfig?: {
          host?: string | null;
          port?: number | null;
          username?: string | null;
          password?: string | null;
          privateKey?: string | null;
          privateKeyPassphrase?: string | null;
          basePath?: string | null;
        } | null;
      };

      const validModes = ["local", "s3", "sftp", "stream"];
      if (storageMode && !validModes.includes(storageMode)) {
        return reply.status(400).send({
          error: `Invalid storage mode. Must be one of: ${validModes.join(", ")}`,
        });
      }

      if (
        retentionCount !== undefined &&
        (!Number.isFinite(retentionCount) || retentionCount < 0 || retentionCount > 1000)
      ) {
        return reply.status(400).send({ error: "retentionCount must be between 0 and 1000" });
      }

      if (
        retentionDays !== undefined &&
        (!Number.isFinite(retentionDays) || retentionDays < 0 || retentionDays > 3650)
      ) {
        return reply.status(400).send({ error: "retentionDays must be between 0 and 3650" });
      }

      const server = await prisma.server.findUnique({
        where: { id },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (!ensureNotSuspended(server, reply)) {
        return;
      }

      const canUpdate = await ensureServerAccess(
        id,
        request.user.userId,
        "server.start",
        reply
      );
      if (!canUpdate) return;

      const encryptedS3Config = s3Config ? encryptBackupConfig(s3Config) : undefined;
      const encryptedSftpConfig = sftpConfig ? encryptBackupConfig(sftpConfig) : undefined;
      const updated = await prisma.server.update({
        where: { id },
        data: {
          backupStorageMode: storageMode || server.backupStorageMode,
          backupRetentionCount:
            retentionCount !== undefined ? retentionCount : server.backupRetentionCount,
          backupRetentionDays:
            retentionDays !== undefined ? retentionDays : server.backupRetentionDays,
          backupS3Config: (encryptedS3Config ?? server.backupS3Config) as any,
          backupSftpConfig: (encryptedSftpConfig ?? server.backupSftpConfig) as any,
        },
      });

      const wsGateway = app.wsGateway;
      if (wsGateway?.pushToAdminSubscribers) {
        wsGateway.pushToAdminSubscribers('server_updated', {
          type: 'server_updated',
          serverId: id,
          updatedBy: request.user.userId,
          change: 'backup_settings_updated',
          timestamp: new Date().toISOString(),
        });
      }
      if (wsGateway?.pushToGlobalSubscribers) {
        wsGateway.pushToGlobalSubscribers('server_updated', {
          type: 'server_updated',
          serverId: id,
          updatedBy: request.user.userId,
          change: 'backup_settings_updated',
          timestamp: new Date().toISOString(),
        });
      }

      reply.send({
        success: true,
        backupStorageMode: updated.backupStorageMode,
        backupRetentionCount: updated.backupRetentionCount,
        backupRetentionDays: updated.backupRetentionDays,
        backupS3Config: redactBackupConfig(decryptBackupConfig(updated.backupS3Config as any)),
        backupSftpConfig: redactBackupConfig(decryptBackupConfig(updated.backupSftpConfig as any)),
      });
    }
  );

  // Transfer server to another node
  app.post(
    "/:id/transfer",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { targetNodeId } = request.body as {
        targetNodeId: string;
      };

      if (!targetNodeId) {
        return reply.status(400).send({ error: "targetNodeId is required" });
      }

      // Get server with current node
      const server = await prisma.server.findUnique({
        where: { id },
        include: { node: true },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (!ensureNotSuspended(server, reply)) {
        return;
      }


      // Check if user has permission
      const hasExplicitAccess = await prisma.serverAccess.findFirst({
        where: {
          serverId: id,
          userId: request.user.userId,
        },
      });

      const hasNodeAccessToServer = await hasNodeAccess(prisma, request.user.userId, server.nodeId);

      if (server.ownerId !== request.user.userId) {
        if (!hasExplicitAccess || !hasExplicitAccess.permissions.includes("server.transfer")) {
          if (!hasNodeAccessToServer) {
            return reply.status(403).send({
              error: "You do not have permission to transfer this server",
            });
          }
        }
      }

      // Check if already on target node
      if (server.nodeId === targetNodeId) {
        return reply.status(400).send({
          error: "Server is already on the target node",
        });
      }

      // Get target node
      const targetNode = await prisma.node.findUnique({
        where: { id: targetNodeId },
      });

      if (!targetNode) {
        return reply.status(404).send({ error: "Target node not found" });
      }

      // Check if target node is online
      if (!targetNode.isOnline) {
        return reply.status(400).send({
          error: "Target node is offline",
        });
      }

      // Check if target node has enough resources
      const serversOnTarget = await prisma.server.findMany({
        where: { nodeId: targetNodeId },
      });

      const usedMemory = serversOnTarget.reduce(
        (sum, s) => sum + s.allocatedMemoryMb,
        0
      );
      const usedCpu = serversOnTarget.reduce(
        (sum, s) => sum + s.allocatedCpuCores,
        0
      );

      if (
        usedMemory + server.allocatedMemoryMb > targetNode.maxMemoryMb ||
        usedCpu + server.allocatedCpuCores > targetNode.maxCpuCores
      ) {
        return reply.status(400).send({
          error: "Target node does not have enough resources",
          available: {
            memory: targetNode.maxMemoryMb - usedMemory,
            cpu: targetNode.maxCpuCores - usedCpu,
          },
          required: {
            memory: server.allocatedMemoryMb,
            cpu: server.allocatedCpuCores,
          },
        });
      }

      // Server must be stopped to transfer
      if (server.status !== "stopped") {
        return reply.status(400).send({
          error: "Server must be stopped before transfer",
          currentStatus: server.status,
        });
      }

      // Create a log entry
      await prisma.serverLog.create({
        data: {
          serverId: id,
          stream: "system",
          data: `Transfer initiated from node ${server.node.name} to ${targetNode.name}`,
        },
      });

      // Update server status to transferring
      await prisma.server.update({
        where: { id },
        data: { status: "transferring" },
      });

      // Get WebSocket gateway
      const wsGateway = (app as any).wsGateway;

      try {
        // Step 1: Create backup on source node
        await prisma.serverLog.create({
          data: {
            serverId: id,
            stream: "system",
            data: `Creating backup on source node...`,
          },
        });

        const backupName = `transfer-${Date.now()}`;
        const requestId = crypto.randomUUID();

        await prisma.backup.create({
          data: {
            serverId: server.id,
            name: backupName,
            path: `stream://${server.uuid}/${backupName}`,
            storageMode: "stream",
            sizeMb: 0,
          },
        });

        // Step 2: Prepare restore on target agent (spawn tar -xf -)
        const prepareResult = await wsGateway.requestFromAgent(
          targetNodeId,
          {
            type: "prepare_restore_stream",
            requestId,
            serverId: id,
            serverUuid: server.uuid,
            serverDir: `${targetNode.serverDataDir || "/var/lib/catalyst/servers"}/${server.uuid}`,
          },
          15000,
        );

        if (!prepareResult?.success) {
          throw new Error(
            prepareResult?.error || "Target agent failed to prepare restore stream",
          );
        }

        await prisma.serverLog.create({
          data: {
            serverId: id,
            stream: "system",
            data: `Restoring on target node ${targetNode.name}...`,
          },
        });

        // Step 3: Start backup stream on source agent and relay to target.
        // Binary frames flow: Agent 1 → Backend → Agent 2 (zero-copy relay).
        // Backend just forwards bytes — never touches the data.
        const relayPromise = wsGateway.relayBackupStream(
          server.nodeId,
          targetNodeId,
        );

        // Tell source agent to start streaming tar output as binary frames.
        // This is fire-and-forget — the relay promise resolves when
        // the source sends backup_stream_complete.
        wsGateway.sendToAgent(server.nodeId, {
          type: "start_backup_stream",
          requestId,
          serverId: id,
          serverUuid: server.uuid,
        });

        // Wait for the relay to complete (source finishes streaming)
        try {
          await relayPromise;
        } catch (err: any) {
          throw new Error(`Backup stream relay failed: ${err.message}`);
        }

        // Step 4: Tell target agent to close stdin and finish restore
        const finishResult = await wsGateway.requestFromAgent(
          targetNodeId,
          {
            type: "finish_restore_stream",
            requestId,
            serverId: id,
            serverUuid: server.uuid,
          },
          30000,
        );

        if (!finishResult?.success) {
          throw new Error(
            finishResult?.error || "Target agent failed to finish restore stream",
          );
        }

        await prisma.serverLog.create({
          data: {
            serverId: id,
            stream: "system",
            data: `Transfer complete`,
          },
        });

        // Step 5: Update server's nodeId and reassign IP if using IPAM
        await prisma.$transaction(async (tx) => {
          let nextEnvironment = server.environment as Record<string, string>;
          let nextPrimaryIp: string | null = server.primaryIp;

          if (shouldUseIpam(server.networkMode)) {
            await releaseIpForServer(tx, id);
            const allocatedIp = await allocateIpForServer(tx, {
              nodeId: targetNodeId,
              networkName: server.networkMode,
              serverId: id,
            });

            if (!allocatedIp) {
              throw new Error("No IP pool configured for target node network");
            }

            nextPrimaryIp = allocatedIp;
            nextEnvironment = {
              ...(server.environment as Record<string, string>),
              CATALYST_NETWORK_IP: allocatedIp,
            };
          }

          await tx.server.update({
            where: { id },
            data: {
              nodeId: targetNodeId,
              primaryIp: nextPrimaryIp,
              environment: nextEnvironment,
              status: "stopped",
              containerId: null, // Will be regenerated on new node
              containerName: null,
            },
          });
        });

        await prisma.serverLog.create({
          data: {
            serverId: id,
            stream: "system",
            data: `Transfer complete! Server is now on ${targetNode.name}`,
          },
        });

        reply.send({
          success: true,
          message: "Server transferred successfully",
          server: {
            id: server.id,
            name: server.name,
            previousNode: server.node.name,
            currentNode: targetNode.name,
          },
        });

        // Broadcast server_updated event (node transfer)
        const wsGatewayTransfer = (app as any).wsGateway;
        if (wsGatewayTransfer?.pushToAdminSubscribers) {
          wsGatewayTransfer.pushToAdminSubscribers('server_updated', {
            type: 'server_updated',
            serverId: id,
            updatedBy: request.user.userId,
            change: 'node_transferred',
            timestamp: new Date().toISOString(),
          });
        }
      } catch (error: any) {
        // Rollback on error
        await prisma.server.update({
          where: { id },
          data: { status: "stopped" },
        });

        await prisma.serverLog.create({
          data: {
            serverId: id,
            stream: "system",
            data: `Transfer failed: ${error.message}`,
          },
        });

        return reply.status(500).send({
          error: "Transfer failed",
          message: error.message,
        });
      }
    }
  );

  // Suspend server
  app.post(
    "/:serverId/transfer-ownership",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;
      const { newOwnerId } = request.body as { newOwnerId?: string };

      if (!newOwnerId) {
        return reply.status(400).send({ error: "newOwnerId is required" });
      }

      // Only the current owner or an admin can transfer ownership
      const server = await prisma.server.findUnique({
        where: { id: serverId },
        select: { id: true, name: true, ownerId: true },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      const isAdmin = checkIsAdmin(request, "admin.write");
      if (server.ownerId !== userId && !isAdmin) {
        return reply.status(403).send({ error: "Only the server owner or an admin can transfer ownership" });
      }

      if (newOwnerId === server.ownerId) {
        return reply.status(400).send({ error: "Cannot transfer ownership to the current owner" });
      }

      // Validate target user exists
      const targetUser = await prisma.user.findUnique({ where: { id: newOwnerId } });
      if (!targetUser) {
        return reply.status(404).send({ error: "Target user not found" });
      }

      // Transfer ownership and ensure the new owner has full access
      const updated = await prisma.$transaction(async (tx) => {
        const s = await tx.server.update({
          where: { id: serverId },
          data: { ownerId: newOwnerId },
        });
        // Ensure the new owner has a ServerAccess row with full permissions
        await tx.serverAccess.upsert({
          where: { userId_serverId: { userId: newOwnerId, serverId } },
          create: {
            userId: newOwnerId,
            serverId,
            permissions: [
              "server.start", "server.stop", "server.read", "server.install",
              "alert.read", "alert.create", "alert.update", "alert.delete",
              "file.read", "file.write", "console.read", "console.write",
              "server.delete",
            ],
          },
          update: {}, // Keep existing permissions
        });
        return s;
      });

      await prisma.auditLog.create({
        data: {
          userId,
          action: "server.transfer_ownership",
          resource: "server",
          resourceId: serverId,
          details: {
            previousOwnerId: server.ownerId,
            newOwnerId,
            serverName: server.name,
          },
        },
      });

      await prisma.serverLog.create({
        data: {
          serverId,
          stream: "system",
          data: `Ownership transferred to ${targetUser.username || targetUser.email}`,
        },
      });

      // Broadcast server_updated event (ownership transfer)
      const wsGatewayOwnership = (app as any).wsGateway;
      if (wsGatewayOwnership?.pushToAdminSubscribers) {
        wsGatewayOwnership.pushToAdminSubscribers('server_updated', {
          type: 'server_updated',
          serverId,
          updatedBy: userId,
          change: 'ownership_transferred',
          timestamp: new Date().toISOString(),
        });
      }
      if (wsGatewayOwnership?.pushToGlobalSubscribers) {
        wsGatewayOwnership.pushToGlobalSubscribers('server_updated', {
          type: 'server_updated',
          serverId,
          updatedBy: userId,
          change: 'ownership_transferred',
          timestamp: new Date().toISOString(),
        });
      }

      return reply.send({ success: true, data: updated });
    }
  );

  // Archive server
  app.post(
    "/:serverId/archive",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;

      if (!(ensureSuspendPermission(request, reply, "Admin access required"))) {
        return;
      }

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        include: { node: true },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (server.status === "archived") {
        return reply.status(409).send({ error: "Server is already archived" });
      }

      // Only allow archiving from stopped state (stop if running first)
      if (server.status === "running" || server.status === "starting") {
        const gateway = (app as any).wsGateway;
        if (gateway && server.node?.isOnline) {
          await gateway.sendToAgent(server.nodeId, {
            type: "stop_server",
            serverId: server.id,
            serverUuid: server.uuid,
          });
        }
      }

      const updated = await prisma.server.update({
        where: { id: serverId },
        data: { status: "archived" },
      });

      await prisma.auditLog.create({
        data: {
          userId,
          action: "server.archive",
          resource: "server",
          resourceId: serverId,
          details: {},
        },
      });

      await prisma.serverLog.create({
        data: {
          serverId,
          stream: "system",
          data: "Server archived",
        },
      });

      // Broadcast server_updated event (archived)
      const wsGatewayArchive = (app as any).wsGateway;
      if (wsGatewayArchive?.pushToAdminSubscribers) {
        wsGatewayArchive.pushToAdminSubscribers('server_updated', {
          type: 'server_updated',
          serverId,
          updatedBy: userId,
          change: 'archived',
          timestamp: new Date().toISOString(),
        });
      }
      if (wsGatewayArchive?.pushToGlobalSubscribers) {
        wsGatewayArchive.pushToGlobalSubscribers('server_updated', {
          type: 'server_updated',
          serverId,
          updatedBy: userId,
          change: 'archived',
          timestamp: new Date().toISOString(),
        });
      }

      return reply.send({ success: true, data: updated });
    }
  );

  // Restore server from archive
  app.post(
    "/:serverId/restore",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;

      if (!(ensureSuspendPermission(request, reply, "Admin access required"))) {
        return;
      }

      const server = await prisma.server.findUnique({
        where: { id: serverId },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (server.status !== "archived") {
        return reply.status(409).send({ error: "Server is not archived" });
      }

      const updated = await prisma.server.update({
        where: { id: serverId },
        data: { status: "stopped" },
      });

      await prisma.auditLog.create({
        data: {
          userId,
          action: "server.restore",
          resource: "server",
          resourceId: serverId,
          details: {},
        },
      });

      await prisma.serverLog.create({
        data: {
          serverId,
          stream: "system",
          data: "Server restored from archive",
        },
      });

      // Broadcast server_updated event (restored from archive)
      const wsGatewayRestore = (app as any).wsGateway;
      if (wsGatewayRestore?.pushToAdminSubscribers) {
        wsGatewayRestore.pushToAdminSubscribers('server_updated', {
          type: 'server_updated',
          serverId,
          updatedBy: userId,
          change: 'restored',
          timestamp: new Date().toISOString(),
        });
      }
      if (wsGatewayRestore?.pushToGlobalSubscribers) {
        wsGatewayRestore.pushToGlobalSubscribers('server_updated', {
          type: 'server_updated',
          serverId,
          updatedBy: userId,
          change: 'restored',
          timestamp: new Date().toISOString(),
        });
      }

      return reply.send({ success: true, data: updated });
    }
  );

  // ============================================================================
  // PER-SERVER ACTIVITY LOG
  // ============================================================================

}
