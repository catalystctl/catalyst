/**
 * Backup Retention Service
 *
 * Automatically enforces per-server backup retention policies:
 *   - backupRetentionCount: keep at most N backups (0 = unlimited)
 *   - backupRetentionDays: delete backups older than N days (0 = unlimited)
 *
 * Runs as a periodic job (every 6 hours) to clean up stale backups.
 */

import type { PrismaClient } from "@prisma/client";
import type pino from "pino";
import { captureSystemError } from "./error-logger";

const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

export function startBackupRetention(
  prisma: PrismaClient,
  logger: pino.Logger,
  intervalMs = DEFAULT_INTERVAL_MS,
): ReturnType<typeof setInterval> {
  const run = async () => {
    try {
      await enforceRetention(prisma, logger);
    } catch (err: any) {
      captureSystemError({ level: 'error', component: 'BackupRetention', message: 'Backup retention job failed', stack: err?.stack }).catch(() => {});
      logger.error({ err }, "Backup retention job failed");
    }
  };

  // Run once on start, then on interval
  setTimeout(run, 30_000).unref();
  return setInterval(run, intervalMs);
}

async function enforceRetention(prisma: PrismaClient, logger: pino.Logger) {
  const servers = await prisma.server.findMany({
    where: {
      OR: [
        { backupRetentionCount: { gt: 0 } },
        { backupRetentionDays: { gt: 0 } },
      ],
    },
    select: {
      id: true,
      uuid: true,
      nodeId: true,
      backupRetentionCount: true,
      backupRetentionDays: true,
      node: { select: { isOnline: true } },
    },
  });

  if (servers.length === 0) {
    return;
  }

  let totalDeleted = 0;

  for (const server of servers) {
    const backups = await prisma.backup.findMany({
      where: { serverId: server.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        path: true,
        storageMode: true,
        metadata: true,
        createdAt: true,
      },
    });

    if (backups.length === 0) continue;

    const toDelete: typeof backups = [];
    const now = new Date();

    for (let i = 0; i < backups.length; i++) {
      const backup = backups[i];
      let shouldDelete = false;
      const reason: string[] = [];

      // Count-based retention (skip the first N most recent)
      if (server.backupRetentionCount > 0 && i >= server.backupRetentionCount) {
        shouldDelete = true;
        reason.push(`exceeds count limit (${server.backupRetentionCount})`);
      }

      // Age-based retention
      if (server.backupRetentionDays > 0) {
        const ageMs = now.getTime() - backup.createdAt.getTime();
        const maxAgeMs = server.backupRetentionDays * 24 * 60 * 60 * 1000;
        if (ageMs > maxAgeMs) {
          shouldDelete = true;
          reason.push(`older than ${server.backupRetentionDays} days`);
        }
      }

      if (shouldDelete) {
        toDelete.push(backup);
      }
    }

    if (toDelete.length === 0) continue;

    logger.info(
      {
        serverId: server.id,
        serverUuid: server.uuid,
        deleting: toDelete.length,
        reasons: toDelete.map((b) => ({ id: b.id, name: b.name, createdAt: b.createdAt })),
      },
      "Applying backup retention policy",
    );

    for (const backup of toDelete) {
      try {
        // Delete from storage first
        if (backup.path) {
          const { default: fs } = await import("fs/promises");
          await fs.unlink(backup.path).catch(() => {
            // File may not exist locally (S3/stream mode)
          });
        }

        // Delete from database
        await prisma.backup.delete({ where: { id: backup.id } });
        totalDeleted++;
      } catch (err: any) {
        logger.warn(
          { backupId: backup.id, serverId: server.id, err: err.message },
          "Failed to delete backup during retention cleanup",
        );
      }
    }
  }

  if (totalDeleted > 0) {
    logger.info({ totalDeleted, serversProcessed: servers.length }, "Backup retention cleanup complete");
  }
}
