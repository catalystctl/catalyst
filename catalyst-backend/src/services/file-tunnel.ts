import { randomUUID } from "crypto";
import type { Logger } from "pino";
import { getSecuritySettings } from "./mailer";

export interface FileTunnelRequest {
  requestId: string;
  nodeId: string;
  operation: string;
  serverUuid: string;
  path: string;
  data?: Record<string, unknown>;
  /** Raw binary payload stored separately for upload operations */
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
const UPLOAD_TTL_MS = 5 * 60_000;

export class FileTunnelService {
  /** Pending requests waiting for agent response, keyed by requestId */
  private pending = new Map<string, PendingRequest>();
  /** Queued requests per node waiting for agent to poll */
  private queues = new Map<string, FileTunnelRequest[]>();
  /** Agents currently long-polling, keyed by nodeId */
  private pollers = new Map<string, WaitingPoller[]>();
  /** Upload data keyed by requestId - includes nodeId for validation */
  private uploads = new Map<string, { data: Buffer; nodeId: string; createdAt: number }>();
  private logger: Logger;
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor(logger: Logger) {
    this.logger = logger.child({ service: "file-tunnel" });
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
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
    uploadData?: Buffer
  ): Promise<FileTunnelResponse> {
    const settings = await getSecuritySettings();

    // Check pending request limit per node
    const pendingCount = Array.from(this.pending.values()).filter(p => p.nodeId === nodeId).length;
    const queueLength = this.queues.get(nodeId)?.length ?? 0;
    if (pendingCount + queueLength >= settings.fileTunnelMaxPendingPerNode) {
      throw new Error(`Too many pending requests for node ${nodeId}`);
    }

    // Check upload size limit
    if (uploadData) {
      const maxSizeBytes = settings.fileTunnelMaxUploadMb * 1024 * 1024;
      if (uploadData.length > maxSizeBytes) {
        throw new Error(`Upload size ${uploadData.length} exceeds limit ${maxSizeBytes}`);
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

    if (uploadData) {
      this.uploads.set(requestId, { data: uploadData, nodeId, createdAt: Date.now() });
    }

    return new Promise<FileTunnelResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        this.uploads.delete(requestId);
        reject(new Error("Agent file operation timed out"));
      }, REQUEST_TIMEOUT_MS);

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

    // Wait for new requests
    return new Promise<FileTunnelRequest[]>((resolve) => {
      const timer = setTimeout(() => {
        const pollerList = this.pollers.get(nodeId);
        if (pollerList) {
          const idx = pollerList.findIndex((p) => p.resolve === resolve);
          if (idx !== -1) pollerList.splice(idx, 1);
          if (pollerList.length === 0) this.pollers.delete(nodeId);
        }
        resolve([]);
      }, POLL_TIMEOUT_MS);

      const poller: WaitingPoller = { resolve, timer };
      const pollerList = this.pollers.get(nodeId);
      if (pollerList) {
        pollerList.push(poller);
      } else {
        this.pollers.set(nodeId, [poller]);
      }
    });
  }

  /**
   * Agent sends the result of a file operation.
   * Now validates that the responding node matches the request's target node.
   */
  resolveRequest(requestId: string, nodeId: string, response: FileTunnelResponse): boolean {
    const pending = this.pending.get(requestId);
    if (!pending) {
      this.logger.warn({ requestId }, "Received response for unknown request");
      return false;
    }

    // Verify the responding node matches the request's target node
    if (pending.nodeId !== nodeId) {
      this.logger.warn({ requestId, expectedNodeId: pending.nodeId, actualNodeId: nodeId },
        "Node attempted to resolve request destined for another node");
      return false;
    }

    clearTimeout(pending.timer);
    this.pending.delete(requestId);
    this.uploads.delete(requestId);
    pending.resolve(response);
    return true;
  }

  /**
   * Get upload data for a request (agent pulls upload content).
   * Now validates that the requesting node matches the upload's target node.
   */
  getUploadData(requestId: string, nodeId: string): Buffer | null {
    const entry = this.uploads.get(requestId);
    if (!entry) {
      return null;
    }

    // Verify the requesting node matches the upload's target node
    if (entry.nodeId !== nodeId) {
      this.logger.warn({ requestId, expectedNodeId: entry.nodeId, actualNodeId: nodeId },
        "Node attempted to access upload destined for another node");
      return null;
    }

    return entry.data;
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
    const queue = this.queues.get(nodeId) ?? [];
    let inflight = 0;
    for (const p of this.pending.values()) {
      if (p.nodeId === nodeId) inflight++;
    }
    return queue.length + inflight;
  }

  private cleanup() {
    const now = Date.now();
    // Clean expired uploads
    for (const [id, entry] of this.uploads) {
      if (now - entry.createdAt > UPLOAD_TTL_MS) {
        this.uploads.delete(id);
      }
    }

    // Clean expired pending requests (those that have timed out but weren't cleaned)
    for (const [id, pending] of this.pending) {
      if (now - pending.createdAt > REQUEST_TIMEOUT_MS * 2) {
        this.pending.delete(id);
        this.uploads.delete(id);
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
    // Resolve all pollers with empty arrays
    for (const [, pollerList] of this.pollers) {
      for (const poller of pollerList) {
        clearTimeout(poller.timer);
        poller.resolve([]);
      }
    }
    this.pollers.clear();
    this.queues.clear();
    this.uploads.clear();
  }
}
