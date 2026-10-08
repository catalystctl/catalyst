import { randomUUID } from "crypto";
import fs from "fs";
import { promises as fsp } from "fs";
import os from "os";
import path from "path";
import type { Logger } from "pino";
import { getSecuritySettings } from "./mailer";
import { prisma } from "../db.js";
import { captureSystemError } from "../services/error-logger";

export interface FileTunnelRequest {
  requestId: string;
  nodeId: string;
  operation: string;
  serverUuid: string;
  path: string;
  data?: Record<string, unknown>;
  /** Upload data is stored on disk; this field is kept for backward compatibility */
  uploadData?: Buffer;
}

export interface FileTunnelResponse {
  requestId: string;
  success: boolean;
  data?: unknown;
  error?: string;
  contentType?: string;
  /** Streamed binary body (for download responses) */
  body?: Buffer;
}

interface PendingRequest {
  request: FileTunnelRequest;
  nodeId: string;
  resolve: (response: FileTunnelResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  createdAt: number;
}

interface WaitingPoller {
  resolve: (requests: FileTunnelRequest[]) => void;
  timer: ReturnType<typeof setTimeout>;
}

const REQUEST_TIMEOUT_MS = 60_000;
const POLL_TIMEOUT_MS = 30_000;
export const MAX_UPLOAD_TRANSFER_MS = 8 * 60 * 60 * 1000;
const MAX_QUEUE_PER_NODE = 100;
const MAX_POLLERS_PER_NODE = 10;

/** Worst-case transfer budget so a multi-GB transfer does not die at 60s. */
export function uploadTransferTimeoutMs(sizeBytes: number): number {
  const assumedBps = 1 * 1024 * 1024;
  return Math.min(
    MAX_UPLOAD_TRANSFER_MS,
    Math.max(REQUEST_TIMEOUT_MS, Math.ceil(sizeBytes / assumedBps) * 1000 + REQUEST_TIMEOUT_MS),
  );
}

export class FileTunnelService {
  /** Pending requests waiting for agent response, keyed by requestId */
  private pending = new Map<string, PendingRequest>();
  /** Admission counts include both queued and in-flight requests. */
  private pendingByNode = new Map<string, number>();
  /** Queued requests per node waiting for agent to poll */
  private queues = new Map<string, FileTunnelRequest[]>();
  /** Agents currently long-polling, keyed by nodeId */
  private pollers = new Map<string, WaitingPoller[]>();
  private uploads = new Map<string, { filePath: string; size: number; nodeId: string; createdAt: number; expiresAt: number }>();
  private logger: Logger;
  private cleanupTimer: ReturnType<typeof setInterval>;
  private tempDir: string;

  constructor(logger: Logger) {
    this.logger = logger.child({ service: "file-tunnel" });
    this.tempDir = path.join(os.tmpdir(), "catalyst-uploads");
    try {
      void fsp.mkdir(this.tempDir, { recursive: true }).catch((err) => {
        captureSystemError({ level: 'error', component: 'FileTunnel', message: 'Failed to create upload temp directory', stack: err instanceof Error ? err.stack : undefined }).catch(() => {});
        this.logger.error({ err }, "Failed to create upload temp directory");
      });
    } catch (err) {
      captureSystemError({ level: 'error', component: 'FileTunnel', message: 'Failed to create upload temp directory', stack: err instanceof Error ? err.stack : undefined }).catch(() => {});
      this.logger.error({ err }, "Failed to create upload temp directory");
    }
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
  }
  createStagingPath(): string {
    return path.join(this.tempDir, `${randomUUID()}.bin`);
  }

  /**
   * Queue a file operation for an agent and wait for the response.
   * Called by the backend route handlers (servers.ts).
   */
  async queueRequest(
    nodeId: string,
    operation: string,
    serverUuid: string,
    filePath: string,
    data?: Record<string, unknown>,
    uploadData?: Buffer,
    options?: { bypassToken?: string; stagedFile?: { filePath: string; size: number } }
  ): Promise<FileTunnelResponse> {
    const settings = await getSecuritySettings();

    // Check pending request limit per node
    const pendingCount = this.pendingByNode.get(nodeId) ?? 0;
    const queueLength = this.queues.get(nodeId)?.length ?? 0;
    if (pendingCount >= settings.fileTunnelMaxPendingPerNode) {
      throw new Error(`Too many pending requests for node ${nodeId}`);
    }

    // Enforce hard queue cap
    if (queueLength >= MAX_QUEUE_PER_NODE) {
      throw new Error(`File tunnel queue full for node ${nodeId}`);
    }

    const staged = options?.stagedFile;
    const uploadSize = staged?.size ?? uploadData?.length ?? 0;
    if (uploadSize > 0) {
      const maxSizeBytes = settings.fileTunnelMaxUploadMb * 1024 * 1024;
      if (uploadSize > maxSizeBytes) {
        if (options?.bypassToken) {
          const valid = await prisma.migrationJob.findFirst({
            where: {
              bypassToken: options.bypassToken,
              status: { in: ["running", "validating"] },
            },
            select: { id: true },
          });
          if (!valid) {
            throw new Error(
              `Upload size ${uploadSize} exceeds limit ${maxSizeBytes} and migration bypass token is invalid or expired`
            );
          }
          this.logger.warn(
            { nodeId, sizeBytes: uploadSize, maxSizeBytes, jobId: valid.id },
            "File tunnel upload bypassing size limit (active migration job)"
          );
        } else {
          throw new Error(`Upload size ${uploadSize} exceeds limit ${maxSizeBytes}`);
        }
      }
    }

    const requestId = randomUUID();
    const request: FileTunnelRequest = {
      requestId,
      nodeId,
      operation,
      serverUuid,
      path: filePath,
      data,
    };

    const now = Date.now();
    const timeoutMs = uploadSize > 0 ? uploadTransferTimeoutMs(uploadSize) : REQUEST_TIMEOUT_MS;
    const expiresAt = now + timeoutMs + 60_000;

    if (staged) {
      this.uploads.set(requestId, {
        filePath: staged.filePath,
        size: staged.size,
        nodeId,
        createdAt: now,
        expiresAt,
      });
    } else if (uploadData) {
      const stagedPath = path.join(this.tempDir, `${requestId}.bin`);
      try {
        await fsp.writeFile(stagedPath, uploadData);
        this.uploads.set(requestId, {
          filePath: stagedPath,
          size: uploadData.length,
          nodeId,
          createdAt: now,
          expiresAt,
        });
      } catch (err) {
        captureSystemError({ level: 'error', component: 'FileTunnel', message: 'Failed to write upload temp file', stack: err instanceof Error ? err.stack : undefined, metadata: { requestId } }).catch(() => {});
        this.logger.error({ err, requestId }, "Failed to write upload temp file");
        throw new Error("Failed to stage upload data");
      }
    }

    const currentCount = this.pendingByNode.get(nodeId) ?? 0;
    this.pendingByNode.set(nodeId, currentCount + 1);
    return new Promise<FileTunnelResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        const uploadEntry = this.uploads.get(requestId);
        if (uploadEntry) {
          this.uploads.delete(requestId);
          void fsp.unlink(uploadEntry.filePath).catch(() => {});
        }
        this.decrementPending(nodeId);
        reject(new Error("Agent file operation timed out"));
      }, timeoutMs);

      this.pending.set(requestId, {
        request,
        nodeId,
        resolve,
        reject,
        timer,
        createdAt: Date.now(),
      });

      // Try to deliver to a waiting poller immediately
      const pollers = this.pollers.get(nodeId);
      if (pollers && pollers.length > 0) {
        const poller = pollers.shift();
        if (poller) {
          clearTimeout(poller.timer);
          if (pollers.length === 0) this.pollers.delete(nodeId);
          poller.resolve([request]);
          return;
        }
      }

      // Otherwise, queue it for the next poll
      const queue = this.queues.get(nodeId);
      if (queue) {
        queue.push(request);
      } else {
        this.queues.set(nodeId, [request]);
      }
    });
  }

  /**
   * Agent long-polls for pending requests.
   * Returns immediately if requests are queued, otherwise waits up to POLL_TIMEOUT_MS.
   */
  pollRequests(nodeId: string): Promise<FileTunnelRequest[]> {
    // Drain any queued requests immediately
    const queue = this.queues.get(nodeId);
    if (queue && queue.length > 0) {
      const batch = queue.splice(0, queue.length);
      if (queue.length === 0) this.queues.delete(nodeId);
      return Promise.resolve(batch);
    }

    // Enforce poller cap — reject with empty array immediately if at limit
    const pollerList = this.pollers.get(nodeId);
    if (pollerList && pollerList.length >= MAX_POLLERS_PER_NODE) {
      return Promise.resolve([]);
    }

    // Wait for new requests
    return new Promise<FileTunnelRequest[]>((resolve) => {
      const timer = setTimeout(() => {
        const currentPollerList = this.pollers.get(nodeId);
        if (currentPollerList) {
          const idx = currentPollerList.findIndex((p) => p.resolve === resolve);
          if (idx !== -1) currentPollerList.splice(idx, 1);
          if (currentPollerList.length === 0) this.pollers.delete(nodeId);
        }
        resolve([]);
      }, POLL_TIMEOUT_MS);

      const poller: WaitingPoller = { resolve, timer };
      const currentPollerList = this.pollers.get(nodeId);
      if (currentPollerList) {
        currentPollerList.push(poller);
      } else {
        this.pollers.set(nodeId, [poller]);
      }
    });
  }
  /**
   * Stream staged upload bytes to the requesting agent.
   */
  getUploadStream(requestId: string, nodeId: string): { stream: fs.ReadStream; size: number } | null {
    const entry = this.uploads.get(requestId);
    if (!entry) {
      return null;
    }
    if (entry.nodeId !== nodeId) {
      this.logger.warn({ requestId, expectedNodeId: entry.nodeId, actualNodeId: nodeId },
        "Node attempted to access upload destined for another node");
      return null;
    }
    try {
      const stream = fs.createReadStream(entry.filePath);
      const remove = () => {
        stream.removeListener("close", remove);
        stream.removeListener("error", remove);
        const current = this.uploads.get(requestId);
        if (current === entry) {
          this.uploads.delete(requestId);
          void fsp.unlink(entry.filePath).catch(() => {});
        }
      };
      stream.once("close", remove);
      stream.once("error", remove);
      return { stream, size: entry.size };
    } catch (err) {
      captureSystemError({ level: 'error', component: 'FileTunnel', message: 'Failed to open upload temp file', stack: err instanceof Error ? err.stack : undefined, metadata: { requestId, filePath: entry.filePath } }).catch(() => {});
      this.logger.error({ err, requestId, filePath: entry.filePath }, "Failed to open upload temp file");
      return null;
    }
  }

  /**
   * Agent sends the result of a file operation.
   */
  resolveRequest(requestId: string, nodeId: string, response: FileTunnelResponse): boolean {
    const pending = this.pending.get(requestId);
    if (!pending) {
      this.logger.warn({ requestId }, "Received response for unknown request");
      return false;
    }
    if (pending.nodeId !== nodeId) {
      this.logger.warn({ requestId, expectedNodeId: pending.nodeId, actualNodeId: nodeId },
        "Node attempted to resolve request destined for another node");
      return false;
    }
    clearTimeout(pending.timer);
    this.pending.delete(requestId);
    this.decrementPending(nodeId);
    const uploadEntry = this.uploads.get(requestId);
    if (uploadEntry) {
      // The agent may still be reading a staged upload when it acknowledges
      // the operation. The read stream owns deletion and removes it on close.
      if (!this.uploads.has(requestId)) {
        void fsp.unlink(uploadEntry.filePath).catch(() => {});
      }
    }
    pending.resolve(response);
    return true;
  }

  /**
   * Check if a node has any active pollers (indicates agent tunnel is connected).
   */
  isNodeConnected(nodeId: string): boolean {
    const pollers = this.pollers.get(nodeId);
    return Boolean(pollers && pollers.length > 0);
  }

  /**
   * Check if there are pending requests for a node (for diagnostics).
   */
  getPendingCount(nodeId: string): number {
    return this.pendingByNode.get(nodeId) ?? 0;
  }

  private decrementPending(nodeId: string): void {
    const count = (this.pendingByNode.get(nodeId) ?? 1) - 1;
    if (count <= 0) this.pendingByNode.delete(nodeId);
    else this.pendingByNode.set(nodeId, count);
  }

  private cleanup() {
    const now = Date.now();
    for (const [id, entry] of this.uploads) {
      const expired = now >= entry.expiresAt;
      if (expired) {
        void fsp.unlink(entry.filePath).catch(() => {});
        this.uploads.delete(id);
      }
    }
    for (const [id, pending] of this.pending) {
      const uploadEntry = this.uploads.get(id);
      const limit = uploadEntry ? MAX_UPLOAD_TRANSFER_MS + 60_000 : REQUEST_TIMEOUT_MS * 2;
      if (now - pending.createdAt > limit) {
        this.pending.delete(id);
        this.decrementPending(pending.nodeId);
        if (uploadEntry) {
          void fsp.unlink(uploadEntry.filePath).catch(() => {});
          this.uploads.delete(id);
        }
      }
    }
  }

  destroy() {
    clearInterval(this.cleanupTimer);
    // Reject all pending requests
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error("File tunnel service destroyed"));
    }
    this.pending.clear();
    this.pendingByNode.clear();
    // Resolve all pollers with empty arrays
    for (const [, pollerList] of this.pollers) {
      for (const poller of pollerList) {
        clearTimeout(poller.timer);
        poller.resolve([]);
      }
    }
    this.pollers.clear();
    this.queues.clear();
    // Clean up temp files
    for (const [, entry] of this.uploads) {
      void fsp.unlink(entry.filePath).catch(() => {});
    }
    this.uploads.clear();
    // Attempt to remove temp directory
    void fsp.rm(this.tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
