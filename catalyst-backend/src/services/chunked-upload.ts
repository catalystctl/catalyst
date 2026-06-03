import { randomUUID } from "crypto";
import { createReadStream, createWriteStream } from "fs";
import fs from "fs";
import os from "os";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import type { Logger } from "pino";
import { getSecuritySettings } from "./mailer";
import { captureSystemError } from "./error-logger";
import type { FileTunnelService } from "./file-tunnel";

const DEFAULT_CHUNK_SIZE = 8 * 1024 * 1024; // 8MB
const MIN_CHUNK_SIZE = 1 * 1024 * 1024; // 1MB
const MAX_CHUNK_SIZE = 128 * 1024 * 1024; // 128MB
const DEFAULT_MAX_FILE_SIZE_MB = 5120; // 5GB
const HARD_MAX_FILE_SIZE_MB = 51200; // 50GB
const DEFAULT_SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour
const CLEANUP_INTERVAL_MS = 60_000; // 1 minute

export type ChunkedUploadStatus =
  | "uploading"
  | "assembling"
  | "completed"
  | "failed"
  | "cancelled";

export interface ChunkedUploadSession {
  uploadId: string;
  userId: string;
  serverId: string;
  serverUuid: string;
  nodeId: string;
  /** Destination directory on the agent (relative to server root) */
  targetDir: string;
  /** Filename within targetDir */
  filename: string;
  totalSize: number;
  chunkSize: number;
  totalChunks: number;
  receivedBytes: number;
  receivedChunks: Set<number>;
  /** Path of each received chunk on disk, keyed by chunk index */
  chunkPaths: Map<number, string>;
  status: ChunkedUploadStatus;
  errorMessage?: string;
  createdAt: number;
  lastActivity: number;
  /** Absolute path of the session directory on the backend */
  tempDir: string;
  /** Optional SHA-256 hex of the final file for client-side integrity checks */
  expectedSha256?: string;
}

export interface ChunkedUploadInitInput {
  userId: string;
  serverId: string;
  serverUuid: string;
  nodeId: string;
  targetDir: string;
  filename: string;
  totalSize: number;
  chunkSize?: number;
  totalChunks?: number;
  expectedSha256?: string;
}

export interface ChunkedUploadStatusInfo {
  uploadId: string;
  status: ChunkedUploadStatus;
  totalChunks: number;
  totalSize: number;
  receivedChunks: number[];
  receivedBytes: number;
  filename: string;
  targetDir: string;
  expiresAt: number;
  errorMessage?: string;
}

/**
 * Manages resumable / chunked file uploads on the backend.
 *
 * Workflow:
 *   1. Client calls init() → gets uploadId + chunkSize
 *   2. Client posts each chunk; missing chunks can be re-sent (resume)
 *   3. Client calls status() to find the first missing chunk
 *   4. Client calls complete() to assemble and deliver to the agent
 *   5. Stale sessions are garbage-collected by a periodic sweep
 *
 * Assembled files are pushed to the agent via the existing FileTunnelService
 * using streaming so 1GB+ files do not require buffering the full payload
 * in memory on the backend.
 */
export class ChunkedUploadService {
  private sessions = new Map<string, ChunkedUploadSession>();
  /** Index of session IDs per user for fast limit checks. */
  private sessionsByUser = new Map<string, Set<string>>();
  private logger: Logger;
  private rootDir: string;
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor(logger: Logger, fileTunnel?: FileTunnelService) {
    this.logger = logger.child({ service: "chunked-upload" });
    this.rootDir = path.join(os.tmpdir(), "catalyst-chunked-uploads");
    try {
      fs.mkdirSync(this.rootDir, { recursive: true });
    } catch (err) {
      captureSystemError({
        level: "error",
        component: "ChunkedUpload",
        message: "Failed to create chunked upload temp directory",
        stack: err instanceof Error ? err.stack : undefined,
        metadata: { rootDir: this.rootDir },
      }).catch(() => {});
      this.logger.error({ err, rootDir: this.rootDir }, "Failed to create chunked upload temp directory");
    }
    this.fileTunnel = fileTunnel;
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
    // Allow the process to exit naturally during shutdown / tests
    if (typeof this.cleanupTimer.unref === "function") {
      this.cleanupTimer.unref();
    }
  }

  private fileTunnel?: FileTunnelService;
  /** Optional hook to surface progress events to listeners. */
  private progressListeners = new Set<(s: ChunkedUploadStatusInfo) => void>();
  /** Max concurrent uploading sessions per user (per-user cap to prevent abuse). */
  private static readonly MAX_SESSIONS_PER_USER = 100;

  onProgress(listener: (s: ChunkedUploadStatusInfo) => void): () => void {
    this.progressListeners.add(listener);
    return () => this.progressListeners.delete(listener);
  }

  private emitProgress(session: ChunkedUploadSession): void {
    if (this.progressListeners.size === 0) return;
    const info = this.toStatusInfo(session);
    for (const listener of this.progressListeners) {
      try {
        listener(info);
      } catch (err) {
        this.logger.warn({ err }, "Progress listener threw");
      }
    }
  }

  /**
   * Resolves the effective maximum file size and chunk size for an upload
   * based on admin-configurable security settings.
   */
  private async resolveLimits(): Promise<{ maxFileSize: number; chunkSize: number; sessionTtlMs: number }> {
    const settings = await getSecuritySettings();
    const maxFileMb = Math.min(
      Math.max(1, settings.chunkedUploadMaxFileMb ?? DEFAULT_MAX_FILE_SIZE_MB),
      HARD_MAX_FILE_SIZE_MB,
    );
    const chunkMb = Math.min(
      MAX_CHUNK_SIZE / 1024 / 1024,
      Math.max(MIN_CHUNK_SIZE / 1024 / 1024, settings.chunkedUploadChunkMb ?? 0),
    );
    const chunkSize = chunkMb > 0 ? Math.round(chunkMb * 1024 * 1024) : DEFAULT_CHUNK_SIZE;
    const sessionTtlMs = Math.max(
      60_000,
      settings.chunkedUploadSessionTtlMs ?? DEFAULT_SESSION_TTL_MS,
    );
    return {
      maxFileSize: maxFileMb * 1024 * 1024,
      chunkSize,
      sessionTtlMs,
    };
  }

  /**
   * Create a new chunked upload session and reserve its on-disk directory.
   */
  async init(input: ChunkedUploadInitInput): Promise<{
    uploadId: string;
    chunkSize: number;
    maxFileSize: number;
    expiresAt: number;
  }> {
    const limits = await this.resolveLimits();
    if (input.totalSize <= 0) {
      throw new Error("totalSize must be greater than 0");
    }
    if (input.totalSize > limits.maxFileSize) {
      throw new Error(
        `File size ${input.totalSize} exceeds maximum of ${limits.maxFileSize} bytes`,
      );
    }
    if (!input.filename || /[\/\\\x00]/.test(input.filename)) {
      throw new Error("Invalid filename");
    }

    // Enforce per-user session cap
    const userSet = this.sessionsByUser.get(input.userId) ?? new Set();
    if (userSet.size >= ChunkedUploadService.MAX_SESSIONS_PER_USER) {
      throw new Error("Too many concurrent chunked upload sessions");
    }

    const chunkSize = input.chunkSize ?? limits.chunkSize;
    if (
      !Number.isFinite(chunkSize) ||
      chunkSize < MIN_CHUNK_SIZE ||
      chunkSize > MAX_CHUNK_SIZE
    ) {
      throw new Error(
        `chunkSize must be between ${MIN_CHUNK_SIZE} and ${MAX_CHUNK_SIZE} bytes`,
      );
    }

    const totalChunks = Math.max(1, Math.ceil(input.totalSize / chunkSize));
    const uploadId = randomUUID();
    const tempDir = path.join(this.rootDir, uploadId);
    try {
      fs.mkdirSync(tempDir, { recursive: true });
    } catch (err) {
      captureSystemError({
        level: "error",
        component: "ChunkedUpload",
        message: "Failed to create session temp directory",
        stack: err instanceof Error ? err.stack : undefined,
        metadata: { uploadId, tempDir },
      }).catch(() => {});
      throw new Error("Failed to initialize upload session");
    }

    const now = Date.now();
    const session: ChunkedUploadSession = {
      uploadId,
      userId: input.userId,
      serverId: input.serverId,
      serverUuid: input.serverUuid,
      nodeId: input.nodeId,
      targetDir: input.targetDir,
      filename: input.filename,
      totalSize: input.totalSize,
      chunkSize,
      totalChunks,
      receivedBytes: 0,
      receivedChunks: new Set(),
      chunkPaths: new Map(),
      status: "uploading",
      createdAt: now,
      lastActivity: now,
      tempDir,
      expectedSha256: input.expectedSha256,
    };

    this.sessions.set(uploadId, session);
    userSet.add(uploadId);
    this.sessionsByUser.set(input.userId, userSet);

    this.logger.info(
      {
        uploadId,
        userId: input.userId,
        serverId: input.serverId,
        totalSize: input.totalSize,
        totalChunks,
        chunkSize,
      },
      "Initialized chunked upload session",
    );

    return {
      uploadId,
      chunkSize,
      maxFileSize: limits.maxFileSize,
      expiresAt: now + limits.sessionTtlMs,
    };
  }

  /**
   * Verify that a session is owned by the requesting user and bound to a server.
   * Returns the session or null if not found / not owned.
   */
  private getOwnedSession(
    uploadId: string,
    userId: string,
    serverId: string,
  ): ChunkedUploadSession | null {
    const session = this.sessions.get(uploadId);
    if (!session) return null;
    if (session.userId !== userId) return null;
    if (session.serverId !== serverId) return null;
    return session;
  }

  /**
   * Write a chunk to disk and update session state.
   *
   * @param stream Readable stream of the chunk body. Caller is responsible for
   *               closing it (the function will end the stream on completion).
   * @param index Zero-based chunk index.
   */
  async writeChunk(
    uploadId: string,
    userId: string,
    serverId: string,
    index: number,
    body: Buffer | NodeJS.ReadableStream,
  ): Promise<{ received: number; total: number; receivedBytes: number }> {
    const session = this.getOwnedSession(uploadId, userId, serverId);
    if (!session) {
      throw new ChunkedUploadError("Upload session not found", 404);
    }
    if (session.status !== "uploading") {
      throw new ChunkedUploadError(
        `Cannot write chunk: session is ${session.status}`,
        409,
      );
    }
    if (!Number.isInteger(index) || index < 0 || index >= session.totalChunks) {
      throw new ChunkedUploadError(
        `Chunk index ${index} out of range (0..${session.totalChunks - 1})`,
        400,
      );
    }
    if (session.receivedChunks.has(index)) {
      throw new ChunkedUploadError(
        `Chunk ${index} already received`,
        409,
      );
    }

    const stream: NodeJS.ReadableStream =
      Buffer.isBuffer(body) ? Readable.from(body) : body;

    const expectedSize =
      index === session.totalChunks - 1
        ? session.totalSize - index * session.chunkSize
        : session.chunkSize;
    const chunkPath = path.join(session.tempDir, `chunk-${index}.part`);
    const writeStream = createWriteStream(chunkPath, { flags: "wx" });

    let bytesWritten = 0;
    let limitExceeded = false;

    stream.on("data", (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytesWritten += buf.length;
      if (bytesWritten > expectedSize) {
        limitExceeded = true;
        // Stop accepting more data
        stream.pause();
        // Force-pause downstream by destroying the write stream so pipeline ends
        writeStream.destroy(
          new ChunkedUploadError(
            `Chunk ${index} exceeds expected size ${expectedSize}`,
            413,
          ),
        );
        // Drop the socket
        (stream as import("stream").Readable).destroy(
          new ChunkedUploadError(
            `Chunk ${index} exceeds expected size ${expectedSize}`,
            413,
          ),
        );
      }
    });

    try {
      await pipeline(stream, writeStream);
    } catch (err: any) {
      // Clean up partial chunk file
      try { fs.unlinkSync(chunkPath); } catch { /* no-op */ }
      if (err instanceof ChunkedUploadError) throw err;
      if (limitExceeded) {
        throw new ChunkedUploadError(
          `Chunk ${index} exceeds expected size ${expectedSize}`,
          413,
        );
      }
      throw new ChunkedUploadError(
        `Failed to write chunk ${index}: ${err?.message ?? "unknown"}`,
        400,
      );
    }

    if (bytesWritten !== expectedSize) {
      try { fs.unlinkSync(chunkPath); } catch { /* no-op */ }
      throw new ChunkedUploadError(
        `Chunk ${index} has wrong size: got ${bytesWritten}, expected ${expectedSize}`,
        400,
      );
    }

    session.chunkPaths.set(index, chunkPath);
    session.receivedChunks.add(index);
    session.receivedBytes += bytesWritten;
    session.lastActivity = Date.now();

    this.logger.debug(
      {
        uploadId,
        index,
        bytesWritten,
        received: session.receivedChunks.size,
        total: session.totalChunks,
      },
      "Chunk stored",
    );

    this.emitProgress(session);

    return {
      received: session.receivedChunks.size,
      total: session.totalChunks,
      receivedBytes: session.receivedBytes,
    };
  }

  /**
   * Return the current state of an upload session, including which chunks
   * have been received. Used by the client to resume after a disconnect.
   */
  getStatus(
    uploadId: string,
    userId: string,
    serverId: string,
  ): ChunkedUploadStatusInfo | null {
    const session = this.getOwnedSession(uploadId, userId, serverId);
    if (!session) return null;
    return this.toStatusInfo(session);
  }

  private toStatusInfo(session: ChunkedUploadSession): ChunkedUploadStatusInfo {
    return {
      uploadId: session.uploadId,
      status: session.status,
      totalChunks: session.totalChunks,
      totalSize: session.totalSize,
      receivedChunks: Array.from(session.receivedChunks).sort((a, b) => a - b),
      receivedBytes: session.receivedBytes,
      filename: session.filename,
      targetDir: session.targetDir,
      expiresAt: session.createdAt + DEFAULT_SESSION_TTL_MS,
      errorMessage: session.errorMessage,
    };
  }

  /**
   * Cancel an in-progress upload and release its on-disk resources.
   */
  async cancel(
    uploadId: string,
    userId: string,
    serverId: string,
  ): Promise<boolean> {
    const session = this.getOwnedSession(uploadId, userId, serverId);
    if (!session) return false;
    if (session.status === "completed") return false;
    session.status = "cancelled";
    this.removeSession(session);
    this.logger.info({ uploadId, userId }, "Chunked upload cancelled");
    return true;
  }

  /**
   * Assemble all received chunks into a single temporary file and deliver it
   * to the agent via the file tunnel.
   *
   * Returns the final relative path on the agent (targetDir/filename) on success.
   */
  async complete(
    uploadId: string,
    userId: string,
    serverId: string,
  ): Promise<{ path: string; size: number }> {
    const session = this.getOwnedSession(uploadId, userId, serverId);
    if (!session) {
      throw new ChunkedUploadError("Upload session not found", 404);
    }
    if (session.status === "completed") {
      throw new ChunkedUploadError("Upload already completed", 409);
    }
    if (session.status === "cancelled") {
      throw new ChunkedUploadError("Upload was cancelled", 410);
    }
    if (session.receivedChunks.size !== session.totalChunks) {
      const missing: number[] = [];
      for (let i = 0; i < session.totalChunks; i++) {
        if (!session.receivedChunks.has(i)) missing.push(i);
      }
      throw new ChunkedUploadError(
        `Cannot complete: missing chunks [${missing.slice(0, 20).join(", ")}${missing.length > 20 ? ", ..." : ""}]`,
        400,
      );
    }
    if (!this.fileTunnel) {
      throw new ChunkedUploadError("File tunnel not available", 500);
    }

    session.status = "assembling";
    this.emitProgress(session);

    // Stream-assemble chunks into a single file in the session dir.
    const assembledPath = path.join(session.tempDir, "assembled");
    try {
      const out = createWriteStream(assembledPath, { flags: "wx" });
      let totalAssembled = 0;
      for (let i = 0; i < session.totalChunks; i++) {
        const chunkPath = session.chunkPaths.get(i);
        if (!chunkPath) {
          out.destroy();
          throw new ChunkedUploadError(
            `Missing chunk ${i} during assembly`,
            500,
          );
        }
        const stat = await fs.promises.stat(chunkPath);
        const inStream = createReadStream(chunkPath);
        inStream.on("data", (buf: Buffer) => {
          totalAssembled += buf.length;
        });
        await pipeline(inStream, out, { end: i === session.totalChunks - 1 });
      }
      if (totalAssembled !== session.totalSize) {
        throw new ChunkedUploadError(
          `Assembled size ${totalAssembled} does not match expected ${session.totalSize}`,
          500,
        );
      }
    } catch (err) {
      session.status = "failed";
      session.errorMessage = err instanceof Error ? err.message : String(err);
      this.emitProgress(session);
      // Clean up session but keep status queryable briefly
      setTimeout(() => this.removeSession(session), 30_000).unref?.();
      if (err instanceof ChunkedUploadError) throw err;
      throw new ChunkedUploadError(
        `Assembly failed: ${err instanceof Error ? err.message : String(err)}`,
        500,
      );
    }

    // Push to agent via the file tunnel using the staged file path.
    // We move the file into the tunnel's upload staging dir to avoid
    // loading it into memory on the backend, then have the tunnel stream
    // it to the agent chunk by chunk.
    const targetFile = path.posix.join(session.targetDir, session.filename);
    try {
      await this.fileTunnel.queueRequest(
        session.nodeId,
        "upload",
        session.serverUuid,
        targetFile,
        { filename: session.filename, chunked: true, totalSize: session.totalSize },
        undefined,
        { sourcePath: assembledPath },
      );
    } catch (err) {
      session.status = "failed";
      session.errorMessage = err instanceof Error ? err.message : String(err);
      this.emitProgress(session);
      setTimeout(() => this.removeSession(session), 30_000).unref?.();
      throw new ChunkedUploadError(
        `Failed to deliver to agent: ${err instanceof Error ? err.message : String(err)}`,
        502,
      );
    }

    session.status = "completed";
    this.emitProgress(session);

    // Best-effort cleanup of assembled file; keep session record briefly.
    try { fs.unlinkSync(assembledPath); } catch { /* no-op */ }
    setTimeout(() => this.removeSession(session), 30_000).unref?.();

    this.logger.info(
      {
        uploadId,
        userId,
        serverId,
        totalSize: session.totalSize,
        path: targetFile,
      },
      "Chunked upload completed",
    );

    return { path: targetFile, size: session.totalSize };
  }

  private removeSession(session: ChunkedUploadSession): void {
    if (!this.sessions.has(session.uploadId)) return;
    this.sessions.delete(session.uploadId);
    const userSet = this.sessionsByUser.get(session.userId);
    if (userSet) {
      userSet.delete(session.uploadId);
      if (userSet.size === 0) this.sessionsByUser.delete(session.userId);
    }
    // Remove chunk files and session dir
    try {
      fs.rmSync(session.tempDir, { recursive: true, force: true });
    } catch (err) {
      this.logger.warn(
        { err, tempDir: session.tempDir },
        "Failed to remove chunked upload session directory",
      );
    }
  }

  /**
   * Sweep stale / orphaned sessions and remove their temp directories.
   * Called periodically by the cleanup timer.
   */
  private cleanup(): void {
    const now = Date.now();
    const toRemove: ChunkedUploadSession[] = [];
    for (const session of this.sessions.values()) {
      const age = now - session.lastActivity;
      // Hard cap: any session older than 2x TTL is removed
      if (age > DEFAULT_SESSION_TTL_MS * 2) {
        toRemove.push(session);
      }
    }
    for (const session of toRemove) {
      this.logger.info(
        { uploadId: session.uploadId, status: session.status },
        "Garbage-collecting stale chunked upload session",
      );
      this.removeSession(session);
    }
  }

  destroy(): void {
    clearInterval(this.cleanupTimer);
    // Remove all sessions
    const all = Array.from(this.sessions.values());
    for (const session of all) {
      this.removeSession(session);
    }
    // Remove the root directory if empty
    try { fs.rmSync(this.rootDir, { recursive: true, force: true }); } catch { /* no-op */ }
  }
}

/**
 * Thrown by ChunkedUploadService for expected client-facing errors.
 * Includes an HTTP-style status code so route handlers can map it.
 */
export class ChunkedUploadError extends Error {
  readonly statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "ChunkedUploadError";
    this.statusCode = statusCode;
  }
}
