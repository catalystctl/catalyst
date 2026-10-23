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
import {
  getBackupSecondarySettings,
  planSecondaryBackupPath,
  resolveSecondaryBackupRoot,
} from "./backup-secondary";
import { ServerState } from "../shared-types";
import type { ErrorCode } from "../shared-types";
import { getWsGateway } from "../websocket/gateway";

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
   * Whether the agent should gzip the archive. Defaults to true (the
   * historical behaviour); false stores a plain `.tar`.
   */
  compressed?: boolean;
  /**
   * Pin the backup: the retention job (count and age) never prunes it and it
   * does not consume a "keep last N" slot. Callers must have verified the
   * `backup.pin` permission before setting this.
   */
  pinned?: boolean;
  /**
   * Scheduled "backup & start": once the agent confirms the backup finished,
   * the panel starts the server again. Recorded on the Backup row's metadata so
   * the intent survives a panel restart between dispatch and completion.
   */
  startAfterBackup?: boolean;
  /**
   * Also copy the finished archive to the admin-configured secondary drive
   * (services/backup-secondary.ts). The destination path is never supplied by
   * the caller — only this opt-in flag is. Callers must have verified the
   * `backup.create` permission.
   */
  secondaryDrive?: boolean;
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
      /** Absolute path on the panel host when the secondary drive was requested. */
      secondaryPath: string | null;
    }
  | {
      ok: false;
      statusCode: number;
      error: string;
      /** Stable error code; defaults to BACKUP_CREATE_FAILED in the route. */
      code?: ErrorCode;
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
  // Compression is opt-out: an absent flag keeps the gzip default.
  const useCompression = params.compressed !== false;

  // Best-effort per-server state push for backup lock transitions (P1-29).
  const emitStateUpdate = (state: string) => {
    try {
      const gateway = getWsGateway();
      if (typeof gateway?.routeToClients === "function") {
        void gateway
          .routeToClients(serverId, {
            type: "server_state_update",
            serverId,
            state,
            timestamp: new Date().toISOString(),
          })
          .catch(() => {});
      }
    } catch { /* WS push is best-effort */ }
  };

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

  const mode = resolveBackupStorageMode(server);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const cleanedName = sanitizeBackupName(name);
  const backupName = cleanedName || `backup-${timestamp}`;
  const fileName = `${backupName}.${useCompression ? "tar.gz" : "tar"}`;

  // Resolve the secondary destination before taking the server lock: an
  // unavailable drive (disabled, unmounted, or misconfigured) must fail fast
  // instead of flipping the server to CREATING_BACKUP and back.
  let secondaryPath: string | null = null;
  if (params.secondaryDrive === true) {
    try {
      if (mode !== "local" && mode !== "stream") {
        return {
          ok: false,
          statusCode: 400,
          error: "The secondary drive copies local archives only; it is not available for S3 or SFTP storage",
          code: "BACKUP_SECONDARY_UNAVAILABLE",
        };
      }
      const settings = await getBackupSecondarySettings();
      const root = settings.enabled && settings.path ? await resolveSecondaryBackupRoot() : null;
      if (!root) {
        return {
          ok: false,
          statusCode: 400,
          error: "The secondary backup drive is not enabled",
          code: "BACKUP_SECONDARY_UNAVAILABLE",
        };
      }
      secondaryPath = planSecondaryBackupPath(root, server.uuid, fileName);
    } catch (err: any) {
      logger?.warn({ err: err?.message, serverId }, "secondary backup drive unavailable");
      return {
        ok: false,
        statusCode: 400,
        error: err?.message || "The secondary backup drive is unavailable",
        code: "BACKUP_SECONDARY_UNAVAILABLE",
      };
    }
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
  emitStateUpdate(ServerState.CREATING_BACKUP);

  const revertToStopped = async () => {
    const reverted = await prisma.server
      .update({
        where: { id: serverId },
        data: { status: ServerState.STOPPED },
      })
      .then(() => true)
      .catch(() => false);
    if (reverted) emitStateUpdate(ServerState.STOPPED);
  };

  try {
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

    const { agentPath, storagePath, storageKey } = buildBackupPaths(
      server.uuid,
      backupName,
      mode,
      server,
      useCompression,
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
        compressed: useCompression,
        pinned: params.pinned === true,
        metadata: {
          agentPath,
          storageKey,
          encrypted: !!encryptionKey,
          // Absolute path on the panel host; re-validated against the configured
          // root whenever it is read, written or deleted.
          ...(secondaryPath ? { secondaryPath } : {}),
          // Durable intent for a scheduled "backup & start": the gateway reads
          // this when the agent's backup_complete arrives and starts the server.
          ...(params.startAfterBackup ? { startAfterBackup: true } : {}),
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
      compressed: useCompression,
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
      secondaryPath,
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
