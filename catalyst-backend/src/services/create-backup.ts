/**
 * Shared backup creation logic used by:
 *  - HTTP POST /:serverId/backups
 *  - Scheduled task action "backup"
 *
 * Ensures both paths apply the same STOPPED → CREATING_BACKUP lock,
 * allocation/quota checks, Backup DB row, and agent payload.
 */
import type { PrismaClient, Server, Node } from "@prisma/client";
import type { Logger } from "pino";
import {
  resolveBackupStorageMode,
  buildBackupPaths,
} from "./backup-storage";
import { ServerState } from "../shared-types";

export type BackupServer = Server & {
  node: Node;
  template?: unknown;
};

export interface CreateBackupParams {
  prisma: PrismaClient;
  /** Accept pino or FastifyBaseLogger (duck-typed). */
  logger?: Pick<Logger, "warn" | "error" | "info" | "debug">;
  server: BackupServer;
  /** Optional display name; sanitized the same way as HTTP create. */
  name?: string;
  /**
   * sendToAgent implementation (usually wsGateway.sendToAgent).
   * Returns false when the agent is unreachable.
   */
  sendToAgent: (nodeId: string, message: Record<string, unknown>) => Promise<boolean>;
  /**
   * Optional client notifier for backup_started (HTTP path).
   */
  onStarted?: (info: {
    serverId: string;
    backupId: string;
    backupName: string;
  }) => void | Promise<void>;
}

export type CreateBackupResult =
  | {
      ok: true;
      backupId: string;
      backupName: string;
      agentPath: string;
      storagePath: string;
    }
  | {
      ok: false;
      statusCode: number;
      error: string;
    };

const sanitizeBackupName = (value?: string) => {
  const trimmed = (value || "").trim();
  if (!trimmed) return "";
  const cleaned = trimmed.replace(/[^a-z0-9._-]/gi, "_");
  return cleaned.slice(0, 120);
};

const buildServerDir = (serverUuid: string) => {
  const serverDir = process.env.SERVER_DATA_DIR || "/var/lib/catalyst/servers";
  return `${serverDir}/${serverUuid}`;
};

/**
 * Create a backup with the same locking / quota / DB / agent contract as HTTP.
 */
export async function createServerBackup(
  params: CreateBackupParams,
): Promise<CreateBackupResult> {
  const { prisma, logger, server, name, sendToAgent, onStarted } = params;
  const serverId = server.id;

  if (process.env.SUSPENSION_ENFORCED !== "false" && server.suspendedAt) {
    return {
      ok: false,
      statusCode: 423,
      error: "Server is suspended",
    };
  }

  if (!server.node?.isOnline) {
    return { ok: false, statusCode: 503, error: "Node is offline" };
  }

  // Atomically transition STOPPED → CREATING_BACKUP (TOCTOU-safe lock).
  const lockResult = await prisma.server.updateMany({
    where: { id: serverId, status: ServerState.STOPPED },
    data: { status: ServerState.CREATING_BACKUP },
  });
  if (lockResult.count === 0) {
    const current = await prisma.server.findUnique({
      where: { id: serverId },
      select: { status: true },
    });
    if (current?.status === ServerState.CREATING_BACKUP) {
      return {
        ok: false,
        statusCode: 409,
        error: "A backup is already in progress",
      };
    }
    return {
      ok: false,
      statusCode: 409,
      error: `Server must be stopped before creating a backup (current: ${current?.status ?? "unknown"})`,
    };
  }

  const revertToStopped = async () => {
    await prisma.server
      .update({
        where: { id: serverId },
        data: { status: ServerState.STOPPED },
      })
      .catch(() => {});
  };

  try {
    const mode = resolveBackupStorageMode(server);
    const allocationMb = server.backupAllocationMb ?? 0;
    const hasExternalStorage = mode === "s3" || mode === "sftp";
    if (allocationMb <= 0 && !hasExternalStorage) {
      await revertToStopped();
      return {
        ok: false,
        statusCode: 403,
        error:
          "Backup allocation disabled. Configure S3 or SFTP to enable backups.",
      };
    }

    if (allocationMb > 0 && mode === "local") {
      const existingBackups = await prisma.backup.findMany({
        where: { serverId, sizeMb: { gt: 0 } },
        select: { sizeMb: true },
      });
      const totalUsedMb = existingBackups.reduce((sum, b) => sum + b.sizeMb, 0);
      if (totalUsedMb >= allocationMb) {
        await revertToStopped();
        return {
          ok: false,
          statusCode: 403,
          error: `Backup allocation exceeded (${totalUsedMb.toFixed(1)} MB used of ${allocationMb} MB). Delete existing backups to create a new one.`,
        };
      }
    }

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
      await revertToStopped();
      return { ok: false, statusCode: 500, error: "Missing S3 storage key" };
    }
    if (mode === "sftp" && !storageKey) {
      await revertToStopped();
      return { ok: false, statusCode: 500, error: "Missing SFTP storage key" };
    }

    const encryptionKey = process.env.BACKUP_ENCRYPTION_KEY;

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
          encrypted: !!encryptionKey,
        },
      },
    });

    const success = await sendToAgent(server.nodeId, {
      type: "create_backup",
      serverId: server.id,
      serverUuid: server.uuid,
      serverDir,
      backupName,
      backupPath: agentPath,
      backupId: backupRecord.id,
      ...(encryptionKey ? { encryptionKey } : {}),
    });

    if (!success) {
      await prisma.backup.delete({ where: { id: backupRecord.id } }).catch(() => {});
      await revertToStopped();
      return {
        ok: false,
        statusCode: 503,
        error: "Failed to send backup request to agent",
      };
    }

    try {
      await onStarted?.({
        serverId: server.id,
        backupId: backupRecord.id,
        backupName,
      });
    } catch (err: any) {
      logger?.warn(
        { err: err?.message, backupId: backupRecord.id },
        "backup onStarted callback failed",
      );
    }

    return {
      ok: true,
      backupId: backupRecord.id,
      backupName,
      agentPath,
      storagePath,
    };
  } catch (err: any) {
    logger?.error(
      { err: err?.message, serverId },
      "createServerBackup failed; reverting status",
    );
    await revertToStopped();
    return {
      ok: false,
      statusCode: 500,
      error: err?.message || "Backup creation failed",
    };
  }
}
