import { createReadStream, createWriteStream } from "fs";
import * as fs from "fs/promises";
import path from "path";
import type { Readable } from "stream";
import crypto from "crypto";
import { Client as SftpClient } from "ssh2";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import type { WebSocketGateway } from "../websocket/gateway";
import { decryptBackupConfig } from "./backup-credentials";

export type BackupStorageMode = "local" | "s3" | "sftp" | "stream";

const BACKUP_DIR = process.env.BACKUP_DIR || "/var/lib/catalyst/backups";
const STREAM_DIR = process.env.BACKUP_STREAM_DIR || "/tmp/catalyst-backup-stream";
const TRANSFER_DIR = process.env.BACKUP_TRANSFER_DIR || "/tmp/catalyst-backup-transfer";

let cachedS3Client: S3Client | null = null;

type S3Config = {
  client: S3Client;
  bucket: string;
};

// Timeouts so a hung S3 TCP connection cannot block backup_complete
// handlers (and their sockets) forever. requestTimeout caps the whole
// request/response; connectionTimeout caps the TCP connect phase.
// Passed as v3-style NodeHttpHandlerOptions — the SDK builds a fresh
// handler per client, so evictStaleS3Clients()' client.destroy() cannot
// poison a shared handler. throwOnRequestTimeout makes the 120s cap
// actually abort the request instead of only logging a warning.
const S3_REQUEST_HANDLER_OPTIONS = {
  requestTimeout: 120_000,
  connectionTimeout: 10_000,
  throwOnRequestTimeout: true,
} as const;

const buildS3Client = (config?: {
  bucket?: string | null;
  region?: string | null;
  endpoint?: string | null;
  accessKeyId?: string | null;
  secretAccessKey?: string | null;
  pathStyle?: boolean | null;
}) => {
  const bucket = config?.bucket || process.env.BACKUP_S3_BUCKET;
  const region = config?.region || process.env.BACKUP_S3_REGION;
  const accessKeyId = config?.accessKeyId || process.env.BACKUP_S3_ACCESS_KEY;
  const secretAccessKey = config?.secretAccessKey || process.env.BACKUP_S3_SECRET_KEY;
  const endpoint = config?.endpoint || process.env.BACKUP_S3_ENDPOINT || undefined;
  const pathStyle = config?.pathStyle ?? (process.env.BACKUP_S3_PATH_STYLE === "true");
  if (!bucket || !region || !accessKeyId || !secretAccessKey) {
    throw new Error("S3 backup configuration is missing");
  }
  return {
    client: new S3Client({
      region,
      endpoint,
      forcePathStyle: pathStyle,
      credentials: { accessKeyId, secretAccessKey },
      requestHandler: S3_REQUEST_HANDLER_OPTIONS,
    }),
    bucket,
  };
};

const ensureS3Config = (): S3Config => {
  if (!cachedS3Client) {
    const { client, bucket } = buildS3Client();
    cachedS3Client = client;
    return { client, bucket };
  }
  const bucket = process.env.BACKUP_S3_BUCKET;
  if (!bucket) {
    throw new Error("S3 backup configuration is missing");
  }
  return { client: cachedS3Client, bucket };
};

// Per-server S3 client cache to avoid creating a new S3Client on every call.
// Each entry is keyed by a hash of the config and includes lastAccess for LRU eviction.
const perServerS3Clients = new Map<string, S3Config & { lastAccess: number }>();
const MAX_S3_CLIENT_CACHE = 50;

const evictStaleS3Clients = () => {
  if (perServerS3Clients.size <= MAX_S3_CLIENT_CACHE) return;
  const entries = [...perServerS3Clients.entries()].sort(
    (a, b) => a[1].lastAccess - b[1].lastAccess
  );
  const toEvict = entries.slice(0, entries.length - MAX_S3_CLIENT_CACHE);
  for (const [key, value] of toEvict) {
    value.client.destroy();
    perServerS3Clients.delete(key);
  }
};

const resolveS3Config = (server?: { backupS3Config?: any }) => {
  const decrypted = decryptBackupConfig(server?.backupS3Config as any);
  const config = decrypted as {
    bucket?: string | null;
    region?: string | null;
    endpoint?: string | null;
    accessKeyId?: string | null;
    secretAccessKey?: string | null;
    pathStyle?: boolean | null;
  } | null;
  if (
    config?.bucket ||
    config?.region ||
    config?.accessKeyId ||
    config?.secretAccessKey ||
    config?.endpoint
  ) {
    const cacheKey = `${config.bucket ?? ""}:${config.region ?? ""}:${
      config.accessKeyId ?? ""
    }:${config.endpoint ?? "default"}:${config.pathStyle ?? ""}`;
    const cached = perServerS3Clients.get(cacheKey);
    if (cached) {
      cached.lastAccess = Date.now();
      return { client: cached.client, bucket: cached.bucket };
    }
    const result = buildS3Client({
      bucket: config.bucket,
      region: config.region,
      endpoint: config.endpoint,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      pathStyle: config.pathStyle,
    });
    perServerS3Clients.set(cacheKey, { ...result, lastAccess: Date.now() });
    evictStaleS3Clients();
    return result;
  }
  return ensureS3Config();
};

const resolveSftpConfig = (server?: { backupSftpConfig?: any }) => {
  const decrypted = decryptBackupConfig(server?.backupSftpConfig as any);
  const config = decrypted as {
    host?: string | null;
    port?: number | null;
    username?: string | null;
    password?: string | null;
    privateKey?: string | null;
    privateKeyPassphrase?: string | null;
    basePath?: string | null;
  } | null;
  if (!config?.host || !config?.username) {
    throw new Error("SFTP backup configuration is missing");
  }
  if (!config.password && !config.privateKey) {
    throw new Error("SFTP backup configuration is missing credentials");
  }
  return {
    host: config.host,
    port: config.port ?? 22,
    username: config.username,
    password: config.password ?? undefined,
    privateKey: config.privateKey ?? undefined,
    privateKeyPassphrase: config.privateKeyPassphrase ?? undefined,
    basePath: config.basePath ?? "/",
  };
};

const connectSftp = async (config: ReturnType<typeof resolveSftpConfig>) =>
  await new Promise<any>((resolve, reject) => {
    const client = new SftpClient();
    const connectConfig: any = {
      host: config.host,
      port: config.port,
      username: config.username,
    };
    if (config.password) {
      connectConfig.password = config.password;
      connectConfig.tryKeyboard = true;
      connectConfig.authHandler = ["password", "keyboard-interactive"];
    }
    if (config.privateKey) {
      connectConfig.privateKey = config.privateKey;
      if (config.privateKeyPassphrase) {
        connectConfig.passphrase = config.privateKeyPassphrase;
      }
    }
    if (connectConfig.tryKeyboard) {
      client.on("keyboard-interactive", (_name, _instructions, _lang, prompts, finish) => {
        if (config.password) {
          finish(prompts.map(() => config.password as string));
          return;
        }
        finish([]);
      });
    }
    client
      .on("ready", () =>
        client.sftp((err, sftpClient) => {
          if (err) {
            client.end();
            reject(err);
            return;
          }
          resolve({ client, sftp: sftpClient });
        })
      )
      .on("error", reject)
      .connect(connectConfig);
  });

export const resolveBackupStorageMode = (server?: { backupStorageMode?: string | null }) => {
  const raw = (server?.backupStorageMode || process.env.BACKUP_STORAGE_MODE || "local").toLowerCase();
  if (raw === "s3" || raw === "stream" || raw === "local" || raw === "sftp") {
    return raw as BackupStorageMode;
  }
  return "local";
};

export const resolveRetentionPolicy = (server?: {
  backupRetentionCount?: number | null;
  backupRetentionDays?: number | null;
}) => ({
  count: Math.max(0, server?.backupRetentionCount ?? 0),
  days: Math.max(0, server?.backupRetentionDays ?? 0),
});

export const buildBackupPaths = (
  serverUuid: string,
  backupName: string,
  mode: BackupStorageMode,
  server?: { backupS3Config?: any; backupSftpConfig?: any }
) => {
  const fileName = `${backupName}.tar.gz`;
  const agentPath =
    mode === "stream"
      ? path.join(STREAM_DIR, serverUuid, fileName)
      : path.join(BACKUP_DIR, serverUuid, fileName);

  if (mode === "s3") {
    const { bucket } = resolveS3Config(server);
    const storageKey = `backups/${serverUuid}/${fileName}`;
    return {
      agentPath,
      storagePath: `s3://${bucket}/${storageKey}`,
      storageKey,
    };
  }

  if (mode === "sftp") {
    const config = resolveSftpConfig(server);
    const safeBase = config.basePath?.startsWith("/") ? config.basePath : `/${config.basePath}`;
    const storageKey = path.posix.join(safeBase || "/", "backups", serverUuid, fileName);
    return {
      agentPath,
      storagePath: `sftp://${config.host}:${config.port}${storageKey}`,
      storageKey,
    };
  }

  return {
    agentPath,
    storagePath: path.join(BACKUP_DIR, serverUuid, fileName),
    storageKey: null as string | null,
  };
};

const ensureLocalDir = async (targetPath: string) => {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
};

export const streamAgentBackupToLocal = async (
  gateway: WebSocketGateway,
  nodeId: string,
  serverId: string,
  serverUuid: string,
  agentPath: string,
  destinationPath: string,
) => {
  await ensureLocalDir(destinationPath);
  const response = await gateway.requestFromAgent(nodeId, {
    type: "download_backup_start",
    serverId,
    serverUuid,
    backupPath: agentPath,
  });
  const requestId = response?.requestId as string | undefined;
  if (!requestId) {
    throw new Error("Missing download requestId");
  }
  const writeStream = createWriteStream(destinationPath);
  try {
    await gateway.streamBinaryFromAgent(
      nodeId,
      { type: "download_backup", serverId, serverUuid, backupPath: agentPath, requestId },
      (chunk) => {
        writeStream.write(chunk);
      },
    );
    writeStream.end();
    await new Promise<void>((resolve, reject) => {
      writeStream.on("finish", () => resolve());
      writeStream.on("error", reject);
    });
  } catch (err) {
    writeStream.destroy();
    try { await fs.unlink(destinationPath); } catch { /* clean up partial file */ }
    throw err;
  }
};

export const streamAgentBackupToS3 = async (
  gateway: WebSocketGateway,
  nodeId: string,
  serverId: string,
  serverUuid: string,
  agentPath: string,
  storageKey: string,
  server?: { backupS3Config?: any },
) => {
  const { client, bucket } = resolveS3Config(server);
  const tmpPath = path.join(TRANSFER_DIR, serverUuid, path.basename(storageKey));
  await streamAgentBackupToLocal(gateway, nodeId, serverId, serverUuid, agentPath, tmpPath);
  try {
    const stats = await fs.stat(tmpPath);
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: storageKey,
        Body: createReadStream(tmpPath),
        ContentLength: stats.size,
        ContentType: "application/gzip",
      }),
    );
  } finally {
    await fs.unlink(tmpPath).catch(() => {});
  }
};

export const streamAgentBackupToSftp = async (
  gateway: WebSocketGateway,
  nodeId: string,
  serverId: string,
  serverUuid: string,
  agentPath: string,
  storageKey: string,
  server?: { backupSftpConfig?: unknown },
) => {
  const config = resolveSftpConfig(server);
  const tmpPath = path.join(TRANSFER_DIR, serverUuid, path.basename(storageKey));
  await streamAgentBackupToLocal(gateway, nodeId, serverId, serverUuid, agentPath, tmpPath);
  const sftp = await connectSftp(config);
  const sftpErrCode = (err: unknown): number | undefined => {
    if (err && typeof err === "object" && "code" in err && typeof err.code === "number") {
      return err.code;
    }
    return undefined;
  };
  try {
    const ensureDir = async (dirPath: string) => {
      const parts = dirPath.split("/").filter(Boolean);
      let current = "";
      for (const part of parts) {
        current = `${current}/${part}`;
        const exists = await new Promise<boolean>((resolve, reject) => {
          sftp.sftp.stat(current, (err: unknown) => {
            if (!err) return resolve(true);
            if (sftpErrCode(err) === 2) return resolve(false);
            reject(err);
          });
        });
        if (exists) continue;
        await new Promise<void>((resolve, reject) => {
          sftp.sftp.mkdir(current, (err: unknown) => {
            const code = sftpErrCode(err);
            if (err && code !== 4 && code !== 11) {
              reject(err);
              return;
            }
            resolve();
          });
        });
      }
    };
    await ensureDir(path.posix.dirname(storageKey));
    await new Promise<void>((resolve, reject) => {
      sftp.sftp.fastPut(tmpPath, storageKey, (err: Error | undefined) => {
        if (err) reject(err);
        else resolve();
      });
    });
  } finally {
    sftp.client.end();
    await fs.unlink(tmpPath).catch(() => {});
  }
};

export const openStorageStream = async (
  backup: { path: string; storageMode?: string; metadata?: any },
  server?: { backupS3Config?: any; backupSftpConfig?: any },
) => {
  const mode = (backup.storageMode || "local") as BackupStorageMode;
  if (mode === "s3") {
    const { client, bucket } = resolveS3Config(server);
    const storageKey = backup.metadata?.storageKey as string | undefined;
    if (!storageKey) {
      throw new Error("Missing S3 storage key");
    }
    const response = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: storageKey,
      }),
    );
    return {
      stream: response.Body as Readable,
      contentLength: response.ContentLength,
    };
  }

  if (mode === "sftp") {
    const config = resolveSftpConfig(server);
    const storageKey = backup.metadata?.storageKey as string | undefined;
    if (!storageKey) {
      throw new Error("Missing SFTP storage key");
    }
    const sftp = await connectSftp(config);
    const stream = sftp.sftp.createReadStream(storageKey);
    stream.on("close", () => {
      sftp.client.end();
    });
    stream.on("error", () => {
      sftp.client.end();
    });
    return {
      stream,
      contentLength: undefined,
    };
  }

  return {
    stream: createReadStream(backup.path),
    contentLength: undefined,
  };
};

export const deleteBackupFromStorage = async (
  gateway: WebSocketGateway,
  backup: { id: string; path: string; storageMode?: string; metadata?: any },
  server: {
    id: string;
    uuid: string;
    nodeId: string;
    node?: { isOnline: boolean };
    backupS3Config?: any;
    backupSftpConfig?: any;
  } | null,
) => {
  const mode = (backup.storageMode || "local") as BackupStorageMode;

  // Step 1: Delete from remote/local storage
  if (mode === "s3") {
    if (!server) throw new Error("Server required for S3 storage operations");
    const { client, bucket } = resolveS3Config(server);
    const storageKey = backup.metadata?.storageKey as string | undefined;
    if (storageKey) {
      await client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: storageKey,
        }),
      );
    }
  } else if (mode === "sftp") {
    if (!server) throw new Error("Server required for SFTP storage operations");
    const config = resolveSftpConfig(server);
    const storageKey = backup.metadata?.storageKey as string | undefined;
    if (storageKey) {
      const sftp = await connectSftp(config);
      try {
        await new Promise<void>((resolve, reject) => {
          sftp.sftp.unlink(storageKey, (err: any) => {
            if (err) return reject(err);
            resolve();
          });
        });
      } finally {
        sftp.client.end();
      }
    }
  } else {
    // Local mode: if the owning node is offline, the agent-side copy of the
    // tar cannot be cleaned up below. Throw instead of pretending success so
    // callers (delete route, retention) defer and retry later instead of
    // orphaning the agent-side file while deleting the DB row.
    const localAgentPath = backup.metadata?.agentPath as string | undefined;
    if (server?.node?.isOnline === false && localAgentPath) {
      throw new Error("Node is offline; backup deletion deferred");
    }
    // Local mode: try backend FS first
    try {
      await fs.unlink(backup.path);
    } catch {
      // ignore if local path doesn't exist
    }
  }

  // Step 2: ALWAYS attempt to delete agent-local copy ( Bugs #3, #4, #7 )
  const agentPath = backup.metadata?.agentPath as string | undefined;
  if (server?.node?.isOnline && agentPath) {
    try {
      await gateway.sendToAgent(server.nodeId, {
        type: "delete_backup",
        serverId: server.id,
        serverUuid: server.uuid,
        backupPath: agentPath,
      });
    } catch {
      // Agent delete is best-effort — don't block the overall operation
    }
  }
};

const BACKUP_CHUNK_SIZE = 256 * 1024; // 256 KB per binary frame

/**
 * Encode a backup binary-frame header for agent upload chunks.
 *
 * Current protocol (length-prefixed full requestId):
 *   [u16 BE idLen][id UTF-8 bytes][payload]
 *
 * Legacy agents only understood a fixed 16-byte zero-padded prefix of the
 * UUID. Length-prefixed frames are unambiguous for full UUIDs (36 chars)
 * and are preferred by current agents; agents still accept the legacy
 * 16-byte form for compatibility with older panels.
 */
export const encodeBackupBinaryHeader = (requestId: string): Buffer => {
  const idBuf = Buffer.from(requestId, "utf-8");
  if (idBuf.length === 0 || idBuf.length > 0xffff) {
    throw new Error(`Invalid backup requestId length: ${idBuf.length}`);
  }
  const header = Buffer.allocUnsafe(2 + idBuf.length);
  header.writeUInt16BE(idBuf.length, 0);
  idBuf.copy(header, 2);
  return header;
};

/**
 * Stream a backup file to an agent using binary WebSocket frames.
 *
 * Binary protocol (v2):
 *   - u16 BE length of requestId
 *   - requestId UTF-8 bytes (full UUID)
 *   - Remaining bytes: raw file data
 *
 * This avoids the 33% base64 overhead of JSON text frames and eliminates
 * per-chunk JSON parsing / ack round-trips. It also fixes the legacy
 * 16-byte truncation that could not uniquely address full UUID sessions.
 */
export const uploadStreamToAgent = async (
  gateway: WebSocketGateway,
  nodeId: string,
  serverId: string,
  serverUuid: string,
  targetPath: string,
  source: Readable,
) => {
  const requestId = crypto.randomUUID();
  await gateway.requestFromAgent(nodeId, {
    type: "upload_backup_start",
    requestId,
    serverId,
    serverUuid,
    backupPath: targetPath,
  });

  // Length-prefixed full requestId header on every binary frame
  const header = encodeBackupBinaryHeader(requestId);

  for await (const chunk of source) {
    if (!chunk || chunk.length === 0) continue;
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    let offset = 0;
    while (offset < buf.length) {
      const slice = buf.subarray(offset, offset + BACKUP_CHUNK_SIZE);
      const frame = Buffer.concat([header, slice]);
      const sent = gateway.sendBinaryToAgent(nodeId, frame);
      if (!sent) {
        throw new Error("Failed to send binary data to agent — connection may be closed");
      }
      offset += slice.length;
    }
  }

  await gateway.requestFromAgent(nodeId, {
    type: "upload_backup_complete",
    requestId,
    serverId,
    serverUuid,
  });
};

export const buildTransferBackupPath = (serverUuid: string, backupName: string) =>
  path.join(TRANSFER_DIR, serverUuid, `${backupName}.tar.gz`);
