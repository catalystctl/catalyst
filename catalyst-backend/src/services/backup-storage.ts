import { createReadStream, createWriteStream } from "fs";
import * as fs from "fs/promises";
import path from "path";
import type { Readable } from "stream";
import { PassThrough } from "stream";
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
  if (config?.bucket || config?.region || config?.accessKeyId || config?.secretAccessKey || config?.endpoint) {
    return buildS3Client({
      bucket: config.bucket,
      region: config.region,
      endpoint: config.endpoint,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      pathStyle: config.pathStyle,
    });
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
  const passThrough = new PassThrough();
  const upload = client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: storageKey,
      Body: passThrough,
      ContentType: "application/gzip",
    }),
  );

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

  await gateway.streamBinaryFromAgent(
    nodeId,
    { type: "download_backup", serverId, serverUuid, backupPath: agentPath, requestId },
    (chunk) => {
      passThrough.write(chunk);
    },
  );
  passThrough.end();
  await upload;
};

export const streamAgentBackupToSftp = async (
  gateway: WebSocketGateway,
  nodeId: string,
  serverId: string,
  serverUuid: string,
  agentPath: string,
  storageKey: string,
  server?: { backupSftpConfig?: any },
) => {
  const config = resolveSftpConfig(server);
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

  const sftp = await connectSftp(config);

  const ensureDir = async (dirPath: string) => {
    const parts = dirPath.split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current = `${current}/${part}`;
      // Check existence to avoid masking permission errors.
      const exists = await new Promise<boolean>((resolve, reject) => {
        sftp.sftp.stat(current, (err) => {
          if (!err) return resolve(true);
          if ((err as any).code === 2) return resolve(false);
          return reject(err);
        });
      });
      if (exists) continue;
      await new Promise<void>((resolve, reject) => {
        sftp.sftp.mkdir(current, (err) => {
          if (err && (err as any).code !== 4 && (err as any).code !== 11) {
            return reject(err);
          }
          resolve();
        });
      });
    }
  };

  const directory = path.posix.dirname(storageKey);
  await ensureDir(directory);
  const writeStream = sftp.sftp.createWriteStream(storageKey);
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
  } finally {
    writeStream.destroy();
    sftp.client.end();
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
    return;
  }

  if (mode === "sftp") {
    if (!server) throw new Error("Server required for SFTP storage operations");
    const config = resolveSftpConfig(server);
    const storageKey = backup.metadata?.storageKey as string | undefined;
    if (storageKey) {
      const sftp = await connectSftp(config);
      await new Promise<void>((resolve) => {
        sftp.sftp.unlink(storageKey, () => resolve());
      });
      sftp.client.end();
    }
    return;
  }

  try {
    await fs.unlink(backup.path);
    return;
  } catch {
    // ignore if local path doesn't exist
  }

  const agentPath = backup.metadata?.agentPath as string | undefined;
  if (server?.node?.isOnline && agentPath) {
    await gateway.sendToAgent(server.nodeId, {
      type: "delete_backup",
      serverId: server.id,
      serverUuid: server.uuid,
      backupPath: agentPath,
    });
  }
};

const BACKUP_CHUNK_SIZE = 256 * 1024; // 256 KB per binary frame

/**
 * Stream a backup file to an agent using binary WebSocket frames.
 *
 * Binary protocol:
 *   - First 16 bytes: requestId (UUID, UTF-8, zero-padded)
 *   - Remaining bytes: raw file data
 *
 * This avoids the 33% base64 overhead of JSON text frames and eliminates
 * per-chunk JSON parsing / ack round-trips.
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

  // Encode requestId once as a 16-byte header for every binary frame
  const header = Buffer.alloc(16, 0);
  Buffer.from(requestId, "utf-8").copy(header);

  for await (const chunk of source) {
    if (!chunk || chunk.length === 0) continue;
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    let offset = 0;
    while (offset < buf.length) {
      const slice = buf.subarray(offset, offset + BACKUP_CHUNK_SIZE);
      const frame = Buffer.concat([header, slice]);
      gateway.sendBinaryToAgent(nodeId, frame);
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
