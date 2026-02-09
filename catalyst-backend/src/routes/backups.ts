import { prisma } from '../db.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { PrismaClient } from "@prisma/client";
import { createReadStream, createWriteStream } from "fs";
import * as fs from "fs/promises";
import { PassThrough } from "stream";
import * as path from "path";
import {
  resolveBackupStorageMode,
  buildBackupPaths,
  openStorageStream,
  deleteBackupFromStorage,
} from "../services/backup-storage";
import { randomUUID } from "crypto";
import { serialize } from '../utils/serialize';

export async function backupRoutes(app: FastifyInstance) {
  // Using shared prisma instance from db.ts
  const BACKUP_DIR = process.env.BACKUP_DIR || "/var/lib/catalyst/backups";
  const STREAM_DIR = process.env.BACKUP_STREAM_DIR || "/tmp/catalyst-backup-stream";
  const TRANSFER_DIR = process.env.BACKUP_TRANSFER_DIR || "/tmp/catalyst-backup-transfer";

  const buildServerDir = (serverUuid: string) => {
    const serverDir = process.env.SERVER_DATA_PATH || "/tmp/catalyst-servers";
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
      select: { id: true, ownerId: true, suspendedAt: true, suspensionReason: true },
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
    if (!access) {
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
      const accessServer = await ensureBackupAccess(serverId, userId, reply, "file.write");
      if (!accessServer) return;

      // Get server
      const server = await prisma.server.findUnique({
        where: { id: serverId },
        include: { node: true, template: true },
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

      // Check if node is online
      if (!server.node.isOnline) {
        return reply.status(503).send({ error: "Node is offline" });
      }

       const mode = resolveBackupStorageMode(server);
       const allocationMb = server.backupAllocationMb ?? 0;
       const hasExternalStorage = mode === "s3" || mode === "sftp";
       if (allocationMb <= 0 && !hasExternalStorage) {
         return reply.status(403).send({
           error: "Backup allocation disabled. Configure S3 or SFTP to enable backups.",
         });
       }

       // Generate backup name
       const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
       const cleanedName = sanitizeBackupName(name);
       const backupName = cleanedName || `backup-${timestamp}`;
       const { agentPath, storagePath, storageKey } = buildBackupPaths(
         server.uuid,
         backupName,
         mode,
         server,
       );
       const serverDir = buildServerDir(server.uuid);

       if (mode === "s3" && !storageKey) {
         return reply.status(500).send({ error: "Missing S3 storage key" });
       }
       if (mode === "sftp" && !storageKey) {
         return reply.status(500).send({ error: "Missing SFTP storage key" });
       }

      const backupRecord = await prisma.backup.create({
        data: {
          serverId: server.id,
          name: backupName,
          path: storagePath,
          storageMode: mode,
          sizeMb: 0,
          metadata: {
            agentPath,
            storageKey,
          },
        },
      });

      // Send backup request to agent
      const gateway = (app as any).wsGateway;
      const success = await gateway.sendToAgent(server.nodeId, {
        type: "create_backup",
        serverId: server.id,
        serverUuid: server.uuid,
        serverDir,
        backupName,
        backupPath: agentPath,
        backupId: backupRecord.id,
      });

      if (!success) {
        await prisma.backup.delete({ where: { id: backupRecord.id } });
        return reply.status(503).send({ error: "Failed to send backup request to agent" });
      }

      reply.send(serialize({
        success: true,
        message: "Backup creation started",
        backupName,
        backupId: backupRecord.id,
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
      const accessServer = await ensureBackupAccess(serverId, userId, reply, "file.read");
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
          } catch {
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
      const accessServer = await ensureBackupAccess(serverId, userId, reply, "file.read");
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
      const accessServer = await ensureBackupAccess(serverId, userId, reply, "file.write");
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

      // Check if server is stopped
      if (server.status !== "stopped") {
        return reply.status(400).send({
          error: "Server must be stopped before restoring",
        });
      }

      // Check if node is online
      if (!server.node.isOnline) {
        return reply.status(503).send({ error: "Node is offline" });
      }

      const serverDir = buildServerDir(server.uuid);

      const gateway = (app as any).wsGateway;
       let restorePath = backup.path;
       if (backup.storageMode === "s3" || backup.storageMode === "sftp") {
         const { storageKey } = backup.metadata as { storageKey?: string };
         if (!storageKey) {
           return reply
             .status(500)
             .send({ error: `Missing ${backup.storageMode?.toUpperCase() || "remote"} storage key` });
         }
          const tmpPath = `${BACKUP_DIR}/${server.uuid}/${backup.name}.tar.gz`;
          await fs.mkdir(`${BACKUP_DIR}/${server.uuid}`, { recursive: true });
          const { stream } = await openStorageStream(backup, server);
         await new Promise<void>((resolve, reject) => {
           const writeStream = createWriteStream(tmpPath);
           stream.pipe(writeStream);
           stream.on("error", reject);
           writeStream.on("finish", () => resolve());
           writeStream.on("error", reject);
         });
         restorePath = tmpPath;
       }

      // Send restore request to agent
      const success = await gateway.sendToAgent(server.nodeId, {
        type: "restore_backup",
        serverId: server.id,
        serverUuid: server.uuid,
        backupPath: restorePath,
        backupId: backup.id,
        serverDir,
      });

      if (!success) {
        return reply.status(503).send({ error: "Failed to send restore request to agent" });
      }

      // Update backup record
      await prisma.backup.update({
        where: { id: backupId },
        data: { restoredAt: new Date() },
      });

      reply.send(serialize({
        success: true,
        message: "Backup restoration started",
      }));
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
      const accessServer = await ensureBackupAccess(serverId, userId, reply, "file.write");
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

      const gateway = (app as any).wsGateway;
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
      const accessServer = await ensureBackupAccess(serverId, userId, reply, "file.read");
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

      // Check if backup file exists locally; otherwise request from agent.
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
        const server = await prisma.server.findUnique({
          where: { id: serverId },
          include: { node: true },
        });

        if (!server || !server.node.isOnline) {
          return reply.status(404).send({ error: "Backup file not found on disk" });
        }

         const gateway = (app as any).wsGateway;
         const stream = new PassThrough();
        let bytesWritten = 0;
        const finalize = (error?: Error) => {
          if (error) {
            request.log.error({ err: error, serverId, backupId }, "Backup download failed");
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
    }
  );
}
