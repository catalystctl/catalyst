import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { PrismaClient } from "@prisma/client";
import type { Logger } from "pino";
import crypto from "crypto";
import type { FileTunnelService, FileTunnelResponse } from "../services/file-tunnel";
import { getSecuritySettings } from "../services/mailer";

/**
 * Internal routes used by agents to poll for and respond to file operations.
 * Auth: X-Node-Id + X-Node-Secret headers validated against DB.
 * All routes have configurable rate limiting.
 */
export function fileTunnelRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  logger: Logger,
  fileTunnel: FileTunnelService
) {
  const log = logger.child({ module: "file-tunnel-routes" });

  /** Authenticate agent via headers with constant-time comparison. Returns nodeId or sends 401. */
  async function authenticateAgent(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<string | null> {
    const nodeId = request.headers["x-node-id"] as string;
    const secret = request.headers["x-node-secret"] as string;

    if (!nodeId || !secret) {
      reply.status(401).send({ error: "Missing authentication headers" });
      return null;
    }

    const node = await prisma.node.findUnique({ where: { id: nodeId } });
    if (!node) {
      reply.status(401).send({ error: "Unknown node" });
      return null;
    }

    // Constant-time comparison that also handles length safely
    const secretMatches = constantTimeEqual(secret, node.secret);

    if (!secretMatches) {
      reply.status(401).send({ error: "Invalid credentials" });
      return null;
    }

    return nodeId;
  }

  /**
   * Constant-time string comparison to prevent timing attacks.
   * Handles length mismatches in constant time as well.
   */
  function constantTimeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) {
      // Still do full comparison but with a dummy to maintain constant time
      const dummy = Buffer.alloc(a.length, 0);
      const aBuf = Buffer.from(a);
      return crypto.timingSafeEqual(aBuf, dummy) && false;
    }
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  }

  /**
   * Rate limiter key generator for file tunnel routes.
   * Uses nodeId for authenticated requests to allow legitimate traffic.
   */
  async function fileTunnelKeyGenerator(request: FastifyRequest): Promise<string> {
    const nodeId = request.headers["x-node-id"] as string;
    const secret = request.headers["x-node-secret"] as string;

    if (nodeId && secret) {
      // Verify credentials first to use authenticated key
      const node = await prisma.node.findUnique({ where: { id: nodeId } });
      if (node && constantTimeEqual(secret, node.secret)) {
        return `node:${nodeId}`;
      }
    }

    // Fallback to IP for unauthenticated requests
    return request.ip;
  }

  /**
   * GET /api/internal/file-tunnel/poll
   * Agent long-polls for pending file operation requests.
   * Returns array of requests or empty array after timeout.
   */
  app.get(
    "/api/internal/file-tunnel/poll",
    {
      config: {
        rateLimit: {
          max: async () => {
            const settings = await getSecuritySettings();
            return settings.fileTunnelRateLimitMax;
          },
          timeWindow: '1 minute',
          keyGenerator: fileTunnelKeyGenerator,
          skipOnError: false,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const nodeId = await authenticateAgent(request, reply);
      if (!nodeId) return;

      try {
        const requests = await fileTunnel.pollRequests(nodeId);
        reply.send({ requests });
      } catch (error) {
        log.error({ err: error, nodeId }, "Poll error");
        reply.status(500).send({ error: "Internal error" });
      }
    }
  );

  /**
   * POST /api/internal/file-tunnel/response/:requestId
   * Agent sends file operation result (JSON metadata).
   */
  app.post(
    "/api/internal/file-tunnel/response/:requestId",
    {
      config: {
        rateLimit: {
          max: async () => {
            const settings = await getSecuritySettings();
            return settings.fileTunnelRateLimitMax;
          },
          timeWindow: '1 minute',
          keyGenerator: fileTunnelKeyGenerator,
          skipOnError: false,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const nodeId = await authenticateAgent(request, reply);
      if (!nodeId) return;

      const { requestId } = request.params as { requestId: string };
      const body = request.body as FileTunnelResponse;

      const resolved = fileTunnel.resolveRequest(requestId, nodeId, {
        requestId,
        success: body.success,
        data: body.data,
        error: body.error,
        contentType: body.contentType,
      });

      if (!resolved) {
        return reply.status(404).send({ error: "Unknown or expired request" });
      }

      reply.send({ success: true });
    }
  );

  /**
   * POST /api/internal/file-tunnel/response/:requestId/stream
   * Agent sends binary file data (for download responses).
   * Body is raw binary; metadata in headers.
   */
  app.post(
    "/api/internal/file-tunnel/response/:requestId/stream",
    {
      config: {
        rateLimit: {
          max: async () => {
            const settings = await getSecuritySettings();
            return settings.fileTunnelRateLimitMax;
          },
          timeWindow: '1 minute',
          keyGenerator: fileTunnelKeyGenerator,
          skipOnError: false,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const nodeId = await authenticateAgent(request, reply);
      if (!nodeId) return;

      const { requestId } = request.params as { requestId: string };
      const success = request.headers["x-tunnel-success"] !== "false";
      const error = request.headers["x-tunnel-error"] as string | undefined;
      const contentType =
        (request.headers["x-tunnel-content-type"] as string) || "application/octet-stream";

      const body = request.body as Buffer;

      const resolved = fileTunnel.resolveRequest(requestId, nodeId, {
        requestId,
        success,
        error,
        contentType,
        body: Buffer.isBuffer(body) ? body : Buffer.from(body || []),
      });

      if (!resolved) {
        return reply.status(404).send({ error: "Unknown or expired request" });
      }

      reply.send({ success: true });
    }
  );

  /**
   * GET /api/internal/file-tunnel/upload/:requestId
   * Agent fetches upload data for a write/upload operation.
   */
  app.get(
    "/api/internal/file-tunnel/upload/:requestId",
    {
      config: {
        rateLimit: {
          max: async () => {
            const settings = await getSecuritySettings();
            return settings.fileTunnelRateLimitMax;
          },
          timeWindow: '1 minute',
          keyGenerator: fileTunnelKeyGenerator,
          skipOnError: false,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const nodeId = await authenticateAgent(request, reply);
      if (!nodeId) return;

      const { requestId } = request.params as { requestId: string };
      const data = fileTunnel.getUploadData(requestId, nodeId);

      if (!data) {
        return reply.status(404).send({ error: "Upload data not found or expired" });
      }

      reply.type("application/octet-stream").send(data);
    }
  );
}
