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
import type { WebSocketGateway } from "../websocket/gateway";
import { ServerState } from "../shared-types";
import { deleteBackupFromStorage } from "./backup-storage";
import { captureSystemError } from "./error-logger";

const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const STUCK_BACKUP_STATE_INTERVAL_MS = parseInt(process.env.STUCK_BACKUP_STATE_INTERVAL_MS ?? "", 10) || 120_000;
const STUCK_BACKUP_STATE_TIMEOUT_MS = parseInt(process.env.STUCK_BACKUP_STATE_TIMEOUT_MS ?? "", 10) || 900_000;

export function startBackupRetention(
  prisma: PrismaClient,
  logger: pino.Logger,
  gateway?: WebSocketGateway,
  intervalMs = DEFAULT_INTERVAL_MS,
): ReturnType<typeof setInterval> {
  const run = async () => {
    try {
      await enforceRetention(prisma, logger, gateway);
    } catch (err: any) {
      captureSystemError({ level: 'error', component: 'BackupRetention', message: 'Backup retention job failed', stack: err?.stack }).catch(() => {});
      logger.error({ err }, "Backup retention job failed");
    }
  };

  // Run once on start, then on interval
  setTimeout(run, 30_000).unref();
  return setInterval(run, intervalMs);
}

async function enforceRetention(prisma: PrismaClient, logger: pino.Logger, gateway?: WebSocketGateway) {
  const servers = await prisma.server.findMany({
    where: {
      AND: [
        {
          OR: [
            { backupRetentionCount: { gt: 0 } },
            { backupRetentionDays: { gt: 0 } },
          ],
        },
        {
          // Skip servers currently creating a backup — their in-progress backup
          // has no size yet and could be incorrectly targeted for deletion.
          status: { not: ServerState.CREATING_BACKUP },
        },
      ],
    },
    select: {
      id: true,
      uuid: true,
      nodeId: true,
      backupRetentionCount: true,
      backupRetentionDays: true,
      node: { select: { isOnline: true } },
      backupS3Config: true,
      backupSftpConfig: true,
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
        if (gateway) {
          await deleteBackupFromStorage(gateway, backup, {
            id: server.id,
            uuid: server.uuid,
            nodeId: server.nodeId,
            node: server.node,
            backupS3Config: (server as any).backupS3Config,
            backupSftpConfig: (server as any).backupSftpConfig,
          });
        } else {
          // Gateway unavailable — cannot reliably clean up agent-local copies.
          // Defer this backup to the next retention cycle.
          logger.warn(
            { backupId: backup.id, serverId: server.id },
            "Gateway not available — deferring backup retention cleanup",
          );
          continue;
        }

        // Only delete DB record if storage cleanup succeeded.
        // Use deleteMany to avoid P2025 (RecordNotFound) when gateway inline
        // retention already deleted this backup between our findMany and here.
        const deleted = await prisma.backup.deleteMany({ where: { id: backup.id } });
        if (deleted.count > 0) totalDeleted++;
      } catch (err: any) {
        // Storage cleanup failed — keep DB record so we can retry next cycle
        logger.warn(
          { backupId: backup.id, serverId: server.id, err: err.message },
          "Failed to delete backup storage during retention — deferring",
        );
      }
    }
  }

  if (totalDeleted > 0) {
    logger.info({ totalDeleted, serversProcessed: servers.length }, "Backup retention cleanup complete");
  }
}

export function startStuckBackupStateWatchdog(
  prisma: PrismaClient,
  logger: pino.Logger,
  gateway?: WebSocketGateway,
  intervalMs = STUCK_BACKUP_STATE_INTERVAL_MS,
): ReturnType<typeof setInterval> {
  const run = async () => {
    try {
      await cleanupStuckBackupStates(prisma, logger, gateway);
    } catch (err: any) {
      captureSystemError({ level: 'error', component: 'StuckBackupStateWatchdog', message: 'Stuck backup state cleanup failed', stack: err?.stack }).catch(() => {});
      logger.error({ err }, "Stuck backup state cleanup failed");
    }
  };

  // Run once shortly after start, then on interval
  setTimeout(run, 10_000).unref();
  return setInterval(run, intervalMs);
}

async function cleanupStuckBackupStates(prisma: PrismaClient, logger: pino.Logger, gateway?: WebSocketGateway) {
  const timeoutMs = STUCK_BACKUP_STATE_TIMEOUT_MS;
  const cutoff = new Date(Date.now() - timeoutMs);

  const stuckServers = await prisma.server.findMany({
    where: {
      OR: [
        { status: ServerState.CREATING_BACKUP, updatedAt: { lt: cutoff } },
        { status: ServerState.RESTORING, updatedAt: { lt: cutoff } },
      ],
    },
    select: {
      id: true,
      uuid: true,
      status: true,
      updatedAt: true,
    },
  });

  if (stuckServers.length === 0) return;

  logger.info({ count: stuckServers.length, cutoff }, "Found stuck backup/restore states");

  for (const server of stuckServers) {
    try {
      await prisma.server.update({
        where: { id: server.id },
        data: { status: ServerState.ERROR },
      });

      await prisma.serverLog.create({
        data: {
          serverId: server.id,
          stream: "system",
          data: `[State Watchdog] Server was stuck in ${server.status} state for >${Math.round(timeoutMs / 60000)} minutes. Transitioned to ERROR.`,
        },
      });

      if (gateway?.routeToClients) {
        gateway.routeToClients(server.id, {
          type: "server_state_update",
          serverId: server.id,
          state: ServerState.ERROR,
          reason: `Stuck in ${server.status} state for >${Math.round(timeoutMs / 60000)} minutes`,
          timestamp: Date.now(),
        }).catch(() => {});
      }

      // Clean up orphaned in-progress backup records
      if (server.status === ServerState.CREATING_BACKUP) {
        const orphaned = await prisma.backup.findMany({
          where: {
            serverId: server.id,
            sizeMb: 0,
            createdAt: { gte: server.updatedAt },
          },
          select: { id: true },
        });
        for (const backup of orphaned) {
          await prisma.backup.delete({ where: { id: backup.id } }).catch(() => {});
        }
        if (orphaned.length > 0) {
          logger.info({ serverId: server.id, orphaned: orphaned.length }, "Deleted orphaned in-progress backup records");
        }
      }
    } catch (err: any) {
      logger.warn({ serverId: server.id, err: err.message }, "Failed to clean up stuck backup state");
    }
  }
}
