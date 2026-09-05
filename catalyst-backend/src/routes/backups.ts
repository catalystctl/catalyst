import { prisma } from '../db.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { PrismaClient } from "@prisma/client";
import { createReadStream } from "fs";
import * as fs from "fs/promises";
import { describeError } from '../utils/describe-error.js';
import { PassThrough } from "stream";
import * as path from "path";
import {
  resolveBackupStorageMode,
  buildBackupPaths,
  openStorageStream,
  deleteBackupFromStorage,
  uploadStreamToAgent,
} from "../services/backup-storage";
import { randomUUID } from "crypto";
import { serialize } from '../utils/serialize';
import { captureSystemError } from '../services/error-logger';
import { hasNodeAccess } from '../lib/permissions';
import { ServerState } from '../shared-types';
import { createServerBackup } from '../services/create-backup';

export async function backupRoutes(app: FastifyInstance) {
  // Using shared prisma instance from db.ts
  const BACKUP_DIR = process.env.BACKUP_DIR || "/var/lib/catalyst/backups";
  const STREAM_DIR = process.env.BACKUP_STREAM_DIR || "/tmp/catalyst-backup-stream";
  const TRANSFER_DIR = process.env.BACKUP_TRANSFER_DIR || "/tmp/catalyst-backup-transfer";

  const buildServerDir = (serverUuid: string) => {
    const serverDir = process.env.SERVER_DATA_DIR || "/var/lib/catalyst/servers";
    return `${serverDir}/${serverUuid}`;
  };

  const sanitizeBackupName = (value?: string) => {
    const trimmed = (value || "").trim();
    if (!trimmed) return "";
    const cleaned = trimmed.replace(/[^a-z0-9._-]/gi, "_");
    return cleaned.slice(0, 120);
  };

  const isAllowedLocalBackupPath = (target: string) => {
    const candidates = [BACKUP_DIR, STREAM_DIR, TRANSFER_DIR].map((dir) =>
      path.resolve(dir)
    );
    const resolved = path.resolve(target);
    return candidates.some((base) => {
      const basePrefix = base.endsWith(path.sep) ? base : `${base}${path.sep}`;
      return resolved === base || resolved.startsWith(basePrefix);
    });
  };

  const ensureBackupAccess = async (
    serverId: string,
    userId: string,
    reply: FastifyReply,
    permission: string
  ) => {
    const server = await prisma.server.findUnique({
      where: { id: serverId },
      select: { id: true, ownerId: true, suspendedAt: true, suspensionReason: true, nodeId: true },
    });
    if (!server) {
      reply.status(404).send({ error: "Server not found" });
      return null;
    }
    if (process.env.SUSPENSION_ENFORCED !== "false" && server.suspendedAt) {
      reply.status(423).send({
        error: "Server is suspended",
        suspendedAt: server.suspendedAt,
        suspensionReason: server.suspensionReason ?? null,
      });
      return null;
    }
    if (server.ownerId === userId) {
      return server;
    }
    const access = await prisma.serverAccess.findFirst({
      where: {
        serverId,
        userId,
        permissions: { has: permission },
      },
    });
    // Server-scoped role resolution: global roles + RoleServerGrant +
    // RoleNodeGrant rows covering this server (mirrors decideServerAccess's
    // requiredPermission branch).
    const { resolveServerPermissions } = await import("../lib/permissions-catalog.js");
    const rolePerms = await resolveServerPermissions(userId, serverId, server.nodeId);
    const roleAllowed =
      rolePerms.includes("*") ||
      rolePerms.includes("admin.write") ||
      rolePerms.includes(permission);
    // SECURITY: bare node assignment must NOT grant backup operations
    // (read/download = full cross-tenant data exfiltration, restore/delete =
    // destruction). Mirror decideServerAccess: the node path only counts when
    // paired with the node.update management permission.
    const hasNodeAccessToServer =
      rolePerms.includes("node.update") &&
      (await hasNodeAccess(prisma, userId, server.nodeId));
    if (!access && !hasNodeAccessToServer && !roleAllowed) {
      reply.status(403).send({ error: "Forbidden" });
      return null;
    }
    return server;
  };

  // Create a backup
  app.post(
    "/:serverId/backups",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const { name } = request.body as { name?: string };
      const userId = request.user.userId;
      const accessServer = await ensureBackupAccess(serverId, userId, reply, "backup.create");
      if (!accessServer) return;

      // Get server
      const server = await prisma.server.findUnique({
        where: { id: serverId },
        include: { node: true, template: true },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      const gateway = app.wsGateway;
      if (!gateway) {
        return reply.status(500).send({ error: "Gateway not available" });
      }

      const result = await createServerBackup({
        prisma,
        logger: request.log,
        server,
        name,
        sendToAgent: (nodeId, message) => gateway.sendToAgent(nodeId, message),
        onStarted: async ({ serverId: sid, backupId, backupName }) => {
          if (gateway.routeToClients) {
            await gateway.routeToClients(sid, {
              type: 'backup_started',
              serverId: sid,
              backupId,
              backupName,
              timestamp: Date.now(),
            }).catch(() => {});
          }
        },
      });

      if (!result.ok) {
        if (result.statusCode === 423) {
          return reply.status(423).send({
            error: result.error,
            suspendedAt: server.suspendedAt,
            suspensionReason: server.suspensionReason ?? null,
          });
        }
        return reply.status(result.statusCode).send({ error: result.error });
      }

      reply.send(serialize({
        success: true,
        message: "Backup creation started",
        backupName: result.backupName,
        backupId: result.backupId,
      }));
    }
  );

  // List backups for a server
  app.get(
    "/:serverId/backups",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const { limit = "50", page = "1" } = request.query as {
        limit?: string;
        page?: string;
      };
      const userId = request.user.userId;
      const accessServer = await ensureBackupAccess(serverId, userId, reply, "backup.read");
      if (!accessServer) return;

      const parsedLimit = parseInt(limit);
      const parsedPage = parseInt(page);
      const limitNum = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 50;
      const pageNum = Number.isFinite(parsedPage) ? Math.max(parsedPage, 1) : 1;
      const skip = (pageNum - 1) * limitNum;

      if (process.env.SUSPENSION_ENFORCED !== "false") {
        const server = await prisma.server.findUnique({
          where: { id: serverId },
          select: { suspendedAt: true, suspensionReason: true },
        });
        if (server?.suspendedAt) {
          return reply.status(423).send({
            error: "Server is suspended",
            suspendedAt: server.suspendedAt,
            suspensionReason: server.suspensionReason ?? null,
          });
        }
      }

      const [backups, total] = await Promise.all([
        prisma.backup.findMany({
          where: { serverId },
          orderBy: { createdAt: "desc" },
          take: limitNum,
          skip,
        }),
        prisma.backup.count({ where: { serverId } }),
      ]);

      const normalizedBackups = await Promise.all(
        backups.map(async (backup) => {
          if (backup.sizeMb > 0) return backup;
          // Local mode backups live on the agent — skip stat attempt on backend FS
          if (backup.storageMode === "local") return backup;
          try {
            if (!isAllowedLocalBackupPath(backup.path)) {
              return backup;
            }
            const stats = await fs.stat(backup.path);
            if (!stats.isFile() || stats.size <= 0) return backup;
            const sizeMb = stats.size / (1024 * 1024);
            const updated = await prisma.backup.update({
              where: { id: backup.id },
              data: { sizeMb },
            });
            return updated;
          } catch (err: any) {
            captureSystemError({
              level: 'warn',
              component: 'BackupRoutes',
              message: `Failed to read backup size: ${describeError(err)}`,
              stack: err?.stack,
              metadata: { backupId: backup.id, path: backup.path },
            }).catch(() => {});
            request.log?.warn(
              { backupId: backup.id, path: backup.path },
              "Failed to read backup size",
            );
            return backup;
          }
        }),
      );

      reply.send(serialize({
        backups: normalizedBackups,
        total,
        page: pageNum,
        pageSize: limitNum,
        totalPages: Math.ceil(total / limitNum),
      }));
    }
  );

  // Get a specific backup
  app.get(
    "/:serverId/backups/:backupId",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId, backupId } = request.params as {
        serverId: string;
        backupId: string;
      };
      const userId = request.user.userId;
      const accessServer = await ensureBackupAccess(serverId, userId, reply, "backup.read");
      if (!accessServer) return;

      const backup = await prisma.backup.findFirst({
        where: {
          id: backupId,
          serverId,
        },
      });

      if (!backup) {
        return reply.status(404).send({ error: "Backup not found" });
      }

      if (process.env.SUSPENSION_ENFORCED !== "false") {
        const server = await prisma.server.findUnique({
          where: { id: serverId },
          select: { suspendedAt: true, suspensionReason: true },
        });
        if (server?.suspendedAt) {
          return reply.status(423).send({
            error: "Server is suspended",
            suspendedAt: server.suspendedAt,
            suspensionReason: server.suspensionReason ?? null,
          });
        }
      }

      reply.send(backup);
    }
  );

  // Restore from backup
  app.post(
    "/:serverId/backups/:backupId/restore",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId, backupId } = request.params as {
        serverId: string;
        backupId: string;
      };
      const userId = request.user.userId;
      const accessServer = await ensureBackupAccess(serverId, userId, reply, "backup.restore");
      if (!accessServer) return;

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        include: { node: true },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (process.env.SUSPENSION_ENFORCED !== "false" && server.suspendedAt) {
        return reply.status(423).send({
          error: "Server is suspended",
          suspendedAt: server.suspendedAt,
          suspensionReason: server.suspensionReason ?? null,
        });
      }

      const backup = await prisma.backup.findFirst({
        where: {
          id: backupId,
          serverId,
        },
      });

      if (!backup) {
        return reply.status(404).send({ error: "Backup not found" });
      }

      // Atomically transition server to RESTORING to prevent concurrent
      // start operations during the restore (TOCTOU fix). Only allowed from STOPPED.
      const lockResult = await prisma.server.updateMany({
        where: { id: serverId, status: ServerState.STOPPED },
        data: { status: ServerState.RESTORING },
      });
      if (lockResult.count === 0) {
        const current = await prisma.server.findUnique({
          where: { id: serverId },
          select: { status: true },
        });
        if (current?.status === ServerState.RESTORING) {
          return reply.status(409).send({ error: "A restore is already in progress" });
        }
        return reply.status(409).send({
          error: `Server must be stopped before restoring (current: ${current?.status ?? "unknown"})`,
        });
      }

      // Check if node is online
      if (!server.node.isOnline) {
        // Revert status since we can't proceed
        await prisma.server.update({ where: { id: serverId }, data: { status: ServerState.STOPPED } });
        return reply.status(503).send({ error: "Node is offline" });
      }

      const serverDir = buildServerDir(server.uuid);

      const gateway = app.wsGateway;
      if (!gateway) {
        await prisma.server.update({ where: { id: serverId }, data: { status: ServerState.STOPPED } });
        return reply.status(500).send({ error: "Gateway not available" });
      }
       let restorePath = backup.path;
       if (backup.storageMode === "s3" || backup.storageMode === "sftp") {
         const { storageKey, agentPath } = backup.metadata as { storageKey?: string; agentPath?: string };
         if (!storageKey) {
           await prisma.server.update({ where: { id: serverId }, data: { status: ServerState.STOPPED } });
           return reply
             .status(500)
             .send({ error: `Missing ${backup.storageMode?.toUpperCase() || "remote"} storage key` });
         }
         try {
           const { stream } = await openStorageStream(backup, server);
           const targetPath = agentPath || `backups/${server.uuid}/${backup.name}.tar.gz`;
           await uploadStreamToAgent(gateway, server.nodeId, server.id, server.uuid, targetPath, stream);
           restorePath = targetPath;
         } catch (dlError: any) {
           await prisma.server.update({ where: { id: serverId }, data: { status: ServerState.STOPPED } });
           return reply.status(500).send({ error: dlError?.message || "Failed to stream backup to agent" });
         }
       }

      // Resolve encryption key for encrypted backups
      const isEncrypted = (backup.metadata as any)?.encrypted === true;
      let encryptionKey: string | undefined;
      if (isEncrypted) {
        const rawKey = process.env.BACKUP_ENCRYPTION_KEY;
        if (!rawKey) {
          await prisma.server.update({ where: { id: serverId }, data: { status: ServerState.STOPPED } });
          return reply.status(400).send({ error: "Backup is encrypted but no encryption key is configured" });
        }
        encryptionKey = rawKey;
      }

      // Send restore request to agent
      const success = await gateway.sendToAgent(server.nodeId, {
        type: "restore_backup",
        serverId: server.id,
        serverUuid: server.uuid,
        backupPath: restorePath,
        backupId: backup.id,
        serverDir,
        ...(encryptionKey ? { encryptionKey } : {}),
      });

      if (!success) {
        await prisma.server.update({ where: { id: serverId }, data: { status: ServerState.STOPPED } });
        return reply.status(503).send({ error: "Failed to send restore request to agent" });
      }

      // Note: restoredAt is updated in the gateway's backup_restore_complete handler,
      // not here, so it only gets set after the agent actually finishes restoring.

      reply.send(serialize({
        success: true,
        message: "Backup restoration started",
      }));

      const wsGatewayRestore = app.wsGateway;
      if (wsGatewayRestore?.routeToClients) {
        wsGatewayRestore.routeToClients(server.id, {
          type: 'backup_restore_started',
          serverId: server.id,
          backupId,
          timestamp: Date.now(),
        }).catch(() => {});
      }
    }
  );

  // Delete a backup
  app.delete(
    "/:serverId/backups/:backupId",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId, backupId } = request.params as {
        serverId: string;
        backupId: string;
      };
      const userId = request.user.userId;
      const accessServer = await ensureBackupAccess(serverId, userId, reply, "backup.delete");
      if (!accessServer) return;

      const backup = await prisma.backup.findFirst({
        where: {
          id: backupId,
          serverId,
        },
      });

      if (!backup) {
        return reply.status(404).send({ error: "Backup not found" });
      }

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        include: { node: true },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (process.env.SUSPENSION_ENFORCED !== "false" && server.suspendedAt) {
        return reply.status(423).send({
          error: "Server is suspended",
          suspendedAt: server.suspendedAt,
          suspensionReason: server.suspensionReason ?? null,
        });
      }

      const gateway = app.wsGateway;
      if (!gateway) {
        return reply.status(500).send({ error: "Gateway not available" });
      }
       await deleteBackupFromStorage(gateway, backup, {
         id: server.id,
         uuid: server.uuid,
         nodeId: server.nodeId,
         node: server.node,
         backupS3Config: (server as any).backupS3Config,
         backupSftpConfig: (server as any).backupSftpConfig,
       });

      // Delete backup record
      await prisma.backup.delete({ where: { id: backupId } });

      reply.send({ success: true, message: "Backup deleted" });

      const wsGatewayDelete = app.wsGateway;
      if (wsGatewayDelete?.routeToClients) {
        wsGatewayDelete.routeToClients(server.id, {
          type: 'backup_delete_started',
          serverId: server.id,
          backupId,
          timestamp: Date.now(),
        }).catch(() => {});
      }
    }
  );

  // Download a backup
  app.get(
    "/:serverId/backups/:backupId/download",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId, backupId } = request.params as {
        serverId: string;
        backupId: string;
      };
      const userId = request.user.userId;
      const downloadServer = await ensureBackupAccess(serverId, userId, reply, "backup.download");
      if (!downloadServer) {
        const fallback = await ensureBackupAccess(serverId, userId, reply, "backup.read");
        if (!fallback) return;
        (request.log ?? app.log).warn({ serverId, userId }, "backup.download fallback to backup.read; backfill grants");
      }

      const backup = await prisma.backup.findFirst({
        where: {
          id: backupId,
          serverId,
        },
      });

      if (!backup) {
        return reply.status(404).send({ error: "Backup not found" });
      }

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        include: { node: true },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (process.env.SUSPENSION_ENFORCED !== "false" && server.suspendedAt) {
        return reply.status(423).send({
          error: "Server is suspended",
          suspendedAt: server.suspendedAt,
          suspensionReason: server.suspensionReason ?? null,
        });
      }

      if (backup.storageMode === "s3" || backup.storageMode === "sftp") {
        try {
          const { stream, contentLength } = await openStorageStream(backup, server);
          if (contentLength) {
            reply.header("Content-Length", contentLength.toString());
          }
          reply.header("Content-Type", "application/gzip");
          reply.header(
            "Content-Disposition",
            `attachment; filename="${backup.name}.tar.gz"`,
          );
          return reply.send(stream);
        } catch (error: any) {
          return reply.status(500).send({ error: error?.message || "Failed to download backup" });
        }
      }

      // For local mode backups, the file lives on the agent — skip the
      // local filesystem check and stream directly from the agent.
      if (backup.storageMode !== "local") {
        // stream mode: check if the file exists on the backend filesystem
        try {
          if (!isAllowedLocalBackupPath(backup.path)) {
            throw new Error("Invalid backup path");
          }
          await fs.access(backup.path);
          const stats = await fs.stat(backup.path);
          const stream = createReadStream(backup.path);

          reply.header("Content-Type", "application/gzip");
          reply.header("Content-Length", stats.size.toString());
          reply.header(
            "Content-Disposition",
            `attachment; filename="${backup.name}.tar.gz"`
          );

          return reply.send(stream);
        } catch {
          // fall through to agent streaming below
        }
      }

      // Stream from agent (used for local mode and when backend file is missing)
      if (!server || !server.node.isOnline) {
        return reply.status(404).send({ error: "Backup file not found on disk" });
      }

      const gateway = app.wsGateway;
      if (!gateway) {
        return reply.status(500).send({ error: "Gateway not available" });
      }
      const stream = new PassThrough();
      let bytesWritten = 0;
      const finalize = (error?: Error) => {
        if (error) {
          request.log.error({ err: error, serverId, backupId }, "Backup download failed");
          captureSystemError({
            level: 'error',
            component: 'BackupService',
            message: `Backup download failed: ${backupId}`,
            stack: error.stack,
            metadata: { serverId, backupId },
          }).catch(() => {});
        }
        if (!reply.raw.writableEnded) {
          stream.end();
        }
      };
      request.raw.on("close", () => finalize());

      reply.header("Content-Type", "application/gzip");
      reply.header(
        "Content-Disposition",
        `attachment; filename="${backup.name}.tar.gz"`
      );
      reply.send(stream);

      try {
        const agentPath =
          (backup.metadata as { agentPath?: string })?.agentPath || backup.path;
        const response = await gateway.requestFromAgent(server.nodeId, {
          type: "download_backup_start",
          serverId: server.id,
          serverUuid: server.uuid,
          backupPath: agentPath,
        });
        const requestId = response?.requestId as string | undefined;
        if (!requestId) {
          throw new Error("Missing download requestId");
        }
        await gateway.streamBinaryFromAgent(
          server.nodeId,
          {
            type: "download_backup",
            serverId: server.id,
            serverUuid: server.uuid,
            backupPath: agentPath,
            requestId,
          },
          (chunk: Buffer) => {
            bytesWritten += chunk.length;
            stream.write(chunk);
          },
        );
        if (bytesWritten === 0) {
          stream.end();
          return;
        }
        stream.end();
        return;
      } catch (error: any) {
        finalize(error);
        if (bytesWritten === 0 && !reply.raw.headersSent) {
          return reply.status(500).send({ error: error?.message || "Failed to download backup" });
        }
      }
    }
  );
}
