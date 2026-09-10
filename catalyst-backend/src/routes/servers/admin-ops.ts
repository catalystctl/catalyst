import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../../db.js";
import { createAuditLog, buildServerAuditDetails } from "../../middleware/audit.js";
import { allocateIpForServer, canAccessServer, checkIsAdmin, decryptBackupConfig, encryptBackupConfig, ensureNotSuspended, ensureServerAccess, ensureSuspendPermission, OWNER_SERVER_PERMISSIONS, path, redactBackupConfig, releaseIpForServer, ServerState, shouldUseIpam } from './_helpers.js';
import { emitServerOperationProgress } from "../../lib/server-operation-progress.js";
import { publishCacheInvalidate } from "../../lib/event-bus.js";
import { requestedCgroupMemoryMb, SERVER_CGROUP_MEMORY_SELECT, sumCgroupMemoryMb } from "../../utils/java-memory.js";
import { apiError } from "../../lib/http-error";
import { ErrorCodes } from "../../shared-types";

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
        return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, `Invalid restart policy. Must be one of: ${validPolicies.join(", ")}`, { params: { options: validPolicies.join(", ") } });
      }

      // Validate max crash count
      if (maxCrashCount !== undefined && (maxCrashCount < 0 || maxCrashCount > 100)) {
        return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, "maxCrashCount must be between 0 and 100");
      }

      const server = await prisma.server.findUnique({
        where: { id },
      });

      if (!server) {
        return apiError(reply, 404, ErrorCodes.SERVER_NOT_FOUND, "Server not found");
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
        return apiError(reply, 404, ErrorCodes.SERVER_NOT_FOUND, "Server not found");
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
        backupAllocationMb,
        s3Config,
        sftpConfig,
      } = request.body as {
        storageMode?: string;
        retentionCount?: number;
        retentionDays?: number;
        backupAllocationMb?: number;
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
        return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, `Invalid storage mode. Must be one of: ${validModes.join(", ")}`, { params: { options: validModes.join(", ") } });
      }

      if (
        retentionCount !== undefined &&
        (!Number.isFinite(retentionCount) || retentionCount < 0 || retentionCount > 1000)
      ) {
        return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, "retentionCount must be between 0 and 1000");
      }

      if (
        retentionDays !== undefined &&
        (!Number.isFinite(retentionDays) || retentionDays < 0 || retentionDays > 3650)
      ) {
        return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, "retentionDays must be between 0 and 3650");
      }

      if (
        backupAllocationMb !== undefined &&
        (!Number.isFinite(backupAllocationMb) || backupAllocationMb < 0 || backupAllocationMb > 1048576)
      ) {
        return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, "backupAllocationMb must be between 0 and 1048576");
      }

      const server = await prisma.server.findUnique({
        where: { id },
      });

      if (!server) {
        return apiError(reply, 404, ErrorCodes.SERVER_NOT_FOUND, "Server not found");
      }

      if (!ensureNotSuspended(server, reply)) {
        return;
      }

      // SECURITY: backup settings include storage destination and S3/SFTP
      // credentials — a subuser holding only server.start could previously
      // redirect every future backup to an attacker-controlled endpoint
      // (full server exfiltration). Backup-management permission is required;
      // credential changes additionally demand the admin/node-manage path.
      const canUpdate = await ensureServerAccess(
        id,
        request.user.userId,
        "backup.create",
        reply
      );
      if (!canUpdate) return;

      const credentialChange =
        (storageMode !== undefined && storageMode !== server.backupStorageMode) ||
        s3Config !== undefined ||
        sftpConfig !== undefined;
      if (credentialChange) {
        const credServer = await prisma.server.findUnique({
          where: { id },
          select: { ownerId: true, nodeId: true },
        });
        const { decideServerAccess } = await import("../../lib/server-access.js");
        const { resolveServerPermissions } = await import(
          "../../lib/permissions-catalog.js"
        );
        const serverAccessRow = await prisma.serverAccess.findFirst({
          where: { serverId: id, userId: request.user.userId },
          select: { permissions: true },
        });
        const rolePerms = await resolveServerPermissions(
          request.user.userId,
          id,
          credServer?.nodeId ?? null
        );
        const nodeManagePath = credServer?.nodeId
          ? (await import("../../lib/permissions.js").then((m) =>
              m.hasNodeAccess(prisma, request.user.userId, credServer.nodeId)
            )) && rolePerms.includes("node.update")
          : false;
        const decision = decideServerAccess({
          isOwner: credServer?.ownerId === request.user.userId,
          hasExplicitServerAccess: Boolean(serverAccessRow),
          rolePermissions: rolePerms,
          hasNodeAccess: nodeManagePath,
          requiredPermission: "backup.create",
        });
        if (
          !decision.allowed ||
          decision.reason === "server_access" ||
          decision.reason === "role_permission"
        ) {
          apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "Storage/credential changes require admin or node-manage access");
          return;
        }
      }

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
          backupAllocationMb:
            backupAllocationMb !== undefined ? backupAllocationMb : server.backupAllocationMb,
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
        return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, "targetNodeId is required");
      }

      // Get server with current node
      const server = await prisma.server.findUnique({
        where: { id },
        include: { node: true, template: true },
      });

      if (!server) {
        return apiError(reply, 404, ErrorCodes.SERVER_NOT_FOUND, "Server not found");
      }

      if (!ensureNotSuspended(server, reply)) {
        return;
      }


      // Check permission: owner | ServerAccess(server.transfer) | node+node.update | admin.write/*
      // Bare node assignment alone is NOT enough.
      if (server.ownerId !== request.user.userId) {
        const hasExplicitAccess = await prisma.serverAccess.findFirst({
          where: {
            serverId: id,
            userId: request.user.userId,
            permissions: { has: "server.transfer" },
          },
        });
        if (!hasExplicitAccess && !checkIsAdmin(request, "admin.write")) {
          const { resolveServerPermissions } = await import("../../lib/permissions-catalog.js");
          const { hasNodeAccess } = await import("../../lib/permissions.js");
          const rolePerms = await resolveServerPermissions(request.user.userId, server.id, server.nodeId);
          const nodeManage =
            (await hasNodeAccess(prisma, request.user.userId, server.nodeId)) &&
            rolePerms.includes("node.update");
          if (!rolePerms.includes("server.transfer") && !rolePerms.includes("*") && !nodeManage) {
            return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "You do not have permission to transfer this server");
          }
        }
      }

      // Check if already on target node
      if (server.nodeId === targetNodeId) {
        return apiError(reply, 400, ErrorCodes.SERVER_ALREADY_ON_NODE, "Server is already on the target node");
      }

      // Get target node
      const targetNode = await prisma.node.findUnique({
        where: { id: targetNodeId },
      });

      if (!targetNode) {
        return apiError(reply, 404, ErrorCodes.NODE_NOT_FOUND, "Target node not found");
      }

      // Check if target node is online
      if (!targetNode.isOnline) {
        return apiError(reply, 400, ErrorCodes.NODE_OFFLINE, "Target node is offline");
      }

      const serversOnTarget = await prisma.server.findMany({
        where: { nodeId: targetNodeId },
        select: {
          allocatedCpuCores: true,
          ...SERVER_CGROUP_MEMORY_SELECT,
        },
      });

      const usedMemory = sumCgroupMemoryMb(serversOnTarget);
      const usedCpu = serversOnTarget.reduce(
        (sum, s) => sum + s.allocatedCpuCores,
        0
      );
      const requiredMemory = requestedCgroupMemoryMb(server.allocatedMemoryMb, {
        startup: server.startupCommand || server.template?.startup,
        image: server.template?.image,
        environment: server.environment,
      });

      const effectiveMaxMemory = targetNode.memoryOverallocatePercent === -1 ? Infinity : Math.floor(targetNode.maxMemoryMb * (1 + targetNode.memoryOverallocatePercent / 100));
      const effectiveMaxCpu = targetNode.cpuOverallocatePercent === -1 ? Infinity : targetNode.maxCpuCores * (1 + targetNode.cpuOverallocatePercent / 100);

      if (
        usedMemory + requiredMemory > effectiveMaxMemory ||
        usedCpu + server.allocatedCpuCores > effectiveMaxCpu
      ) {
        return reply.status(400).send({
          error: "Target node does not have enough resources",
          code: ErrorCodes.INSUFFICIENT_RESOURCES,
          available: {
            memory: effectiveMaxMemory === Infinity ? "unlimited" : effectiveMaxMemory - usedMemory,
            cpu: effectiveMaxCpu === Infinity ? "unlimited" : effectiveMaxCpu - usedCpu,
          },
          required: {
            memory: requiredMemory,
            cpu: server.allocatedCpuCores,
          },
        });
      }

      // Server must be stopped to transfer. Claim TRANSFERRING atomically so
      // concurrent transfers (or transfer vs power/delete) cannot both proceed.
      if (server.status !== "stopped") {
        return reply.status(400).send({
          error: "Server must be stopped before transfer",
          code: ErrorCodes.SERVER_NOT_STOPPED,
          currentStatus: server.status,
        });
      }
      const claimed = await prisma.server.updateMany({
        where: { id, status: "stopped" },
        data: { status: ServerState.TRANSFERRING },
      });
      if (claimed.count === 0) {
        const fresh = await prisma.server.findUnique({ where: { id }, select: { status: true } });
        return reply.status(409).send({
          error: "Server state changed before transfer could start",
          code: ErrorCodes.SERVER_TRANSFER_STATE_CHANGED,
          currentStatus: fresh?.status ?? "unknown",
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


      emitServerOperationProgress((app as any).wsGateway, {
        serverId: id,
        operation: "transfer",
        stage: "Transfer started",
        progress: 5,
        state: ServerState.TRANSFERRING,
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


        emitServerOperationProgress((app as any).wsGateway, {
          serverId: id,
          operation: "transfer",
          stage: "Creating backup on source",
          progress: 20,
          state: ServerState.TRANSFERRING,
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


        emitServerOperationProgress((app as any).wsGateway, {
          serverId: id,
          operation: "transfer",
          stage: `Streaming to ${targetNode.name}`,
          progress: 55,
          state: ServerState.TRANSFERRING,
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

        emitServerOperationProgress((app as any).wsGateway, {
          serverId: id,
          operation: "transfer",
          stage: "Finalizing transfer",
          progress: 90,
          state: ServerState.TRANSFERRING,
        });

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

        emitServerOperationProgress((app as any).wsGateway, {
          serverId: id,
          operation: "transfer",
          stage: "Transfer finished",
          progress: 100,
          state: "stopped",
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
          code: ErrorCodes.SERVER_TRANSFER_FAILED,
          message: error.message,
        });
      }
    }
  );

  // Search users eligible as transfer-ownership targets (owner or admin.write)
  app.get(
    "/:serverId/transfer-candidates",
    { onRequest: [app.authenticate], config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;
      const { search, limit } = request.query as { search?: string; limit?: string | number };

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        select: { id: true, ownerId: true },
      });
      if (!server) {
        return apiError(reply, 404, ErrorCodes.SERVER_NOT_FOUND, "Not found");
      }

      const isAdmin = checkIsAdmin(request, "admin.write");
      if (server.ownerId !== userId && !isAdmin) {
        return apiError(reply, 404, ErrorCodes.SERVER_NOT_FOUND, "Not found");
      }

      const searchQuery = typeof search === "string" ? search.trim() : "";
      if (searchQuery.length < 3) {
        return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, "Invalid request");
      }
      const take = Math.min(Math.max(Number(limit) || 10, 1), 10);

      const users = await prisma.user.findMany({
        where: {
          id: { not: server.ownerId },
          banned: false,
          OR: [
            { username: { contains: searchQuery, mode: "insensitive" as const } },
            { name: { contains: searchQuery, mode: "insensitive" as const } },
          ],
        },
        select: {
          id: true,
          username: true,
          name: true,
          ...(isAdmin ? { email: true } : {}),
        },
        orderBy: { username: "asc" },
        take,
      });

      reply.send({ success: true, data: users });
    }
  );

  // Transfer ownership
  app.post(
    "/:serverId/transfer-ownership",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;
      const { newOwnerId } = request.body as { newOwnerId?: string };

      if (!newOwnerId) {
        return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, "newOwnerId is required");
      }

      // Only the current owner or an admin can transfer ownership
      const server = await prisma.server.findUnique({
        where: { id: serverId },
        select: { id: true, name: true, ownerId: true },
      });

      if (!server) {
        return apiError(reply, 404, ErrorCodes.SERVER_NOT_FOUND, "Server not found");
      }

      const isAdmin = checkIsAdmin(request, "admin.write");
      if (server.ownerId !== userId && !isAdmin) {
        return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "Only the server owner or an admin can transfer ownership");
      }

      if (newOwnerId === server.ownerId) {
        return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, "Cannot transfer ownership to the current owner");
      }

      // Validate target user exists
      const targetUser = await prisma.user.findUnique({ where: { id: newOwnerId } });
      if (!targetUser) {
        return apiError(reply, 404, ErrorCodes.USER_NOT_FOUND, "Target user not found");
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
            permissions: [...OWNER_SERVER_PERMISSIONS],
          },
          update: {
            // Merge full owner set so transfer always grants reinstall/rebuild/backup/db/etc.
            permissions: [...OWNER_SERVER_PERMISSIONS],
          },
        });
        return s;
      });

      await createAuditLog(userId, {
        action: "server.transfer_ownership",
        resource: "server",
        resourceId: serverId,
        request,
        details: buildServerAuditDetails(server, {
          previousOwnerId: server.ownerId,
          newOwnerId,
          newOwnerUsername: targetUser.username ?? undefined,
          newOwnerEmail: targetUser.email ?? undefined,
          serverName: server.name,
        }),
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
      // SECURITY: the previous owner must stop receiving console/stream
      // fan-out immediately, not when the 30s access cache expires.
      wsGatewayOwnership?.invalidateServerAccess?.(serverId);
      try {
        publishCacheInvalidate('server-access', { serverId });
      } catch { /* degraded */ }
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
        return apiError(reply, 404, ErrorCodes.SERVER_NOT_FOUND, "Server not found");
      }

      if (server.status === "archived") {
        return apiError(reply, 409, ErrorCodes.SERVER_ALREADY_ARCHIVED, "Server is already archived");
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

      await createAuditLog(userId, {
        action: "server.archive",
        resource: "server",
        resourceId: serverId,
        request,
        details: buildServerAuditDetails(server, {
          previousStatus: server.status,
          newStatus: "archived",
          stoppedBeforeArchive: server.status === "running" || server.status === "starting",
        }),
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
        return apiError(reply, 404, ErrorCodes.SERVER_NOT_FOUND, "Server not found");
      }

      if (server.status !== "archived") {
        return apiError(reply, 409, ErrorCodes.SERVER_NOT_ARCHIVED, "Server is not archived");
      }

      const updated = await prisma.server.update({
        where: { id: serverId },
        data: { status: "stopped" },
      });

      await createAuditLog(userId, {
        action: "server.restore",
        resource: "server",
        resourceId: serverId,
        request,
        details: buildServerAuditDetails(server, {
          previousStatus: server.status,
          newStatus: "stopped",
          restoredFrom: "archived",
        }),
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
