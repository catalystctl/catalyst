import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { PrismaClient } from "@prisma/client";
import type { Logger } from "pino";
import type { FileTunnelService, FileTunnelResponse } from "../services/file-tunnel";
import { getSecuritySettings } from "../services/mailer";
import { verifyAgentApiKey } from "../lib/agent-auth";
import { captureSystemError } from "../services/error-logger";
import { apiError } from "../lib/http-error";
import { ErrorCodes } from "../shared-types";

/**
 * Internal routes used by agents to poll for and respond to file operations.
 * Auth: X-Node-Id + X-Node-Api-Key headers validated against DB.
 * All routes have configurable rate limiting.
 */
export function fileTunnelRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  logger: Logger,
  fileTunnel: FileTunnelService
) {
  const log = logger.child({ module: "file-tunnel-routes" });

  /** Authenticate agent via headers. Returns nodeId or sends 401. */
  async function authenticateAgent(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<string | null> {
    const nodeId = request.headers["x-node-id"] as string;
    const apiKey = request.headers["x-node-api-key"] as string;

    if (!nodeId || !apiKey) {
      apiError(reply, 401, ErrorCodes.AGENT_AUTH_MISSING, "Missing authentication headers");
      return null;
    }

    const node = await prisma.node.findUnique({ where: { id: nodeId } });
    if (!node) {
      apiError(reply, 401, ErrorCodes.NODE_NOT_FOUND, "Unknown node");
      return null;
    }

    const apiKeyMatches = await verifyAgentApiKey(prisma, nodeId, apiKey);
    if (!apiKeyMatches) {
      apiError(reply, 401, ErrorCodes.AGENT_INVALID_CREDENTIALS, "Invalid credentials");
      return null;
    }

    return nodeId;
  }

  /**
   * Rate limiter allow-list: authenticated agents bypass rate limiting.
   */
  async function agentAllowList(request: FastifyRequest): Promise<boolean> {
    const nodeId = request.headers["x-node-id"] as string;
    const apiKey = request.headers["x-node-api-key"] as string;
    if (!nodeId || !apiKey) return false;
    return verifyAgentApiKey(prisma, nodeId, apiKey);
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
          timeWindow: async () => { const s = await getSecuritySettings(); return s.fileTunnelRateLimitWindowMs; },
          allowList: agentAllowList,
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
        captureSystemError({
          level: 'error',
          component: 'FileTunnelRoutes',
          message: error instanceof Error ? error.message : 'Poll error',
          stack: error instanceof Error ? error.stack : undefined,
          metadata: { nodeId, context: 'file_tunnel_poll' },
        }).catch(() => {});
        log.error({ err: error, nodeId }, "Poll error");
        apiError(reply, 500, ErrorCodes.INTERNAL_ERROR, "Internal error");
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
          timeWindow: async () => { const s = await getSecuritySettings(); return s.fileTunnelRateLimitWindowMs; },
          allowList: agentAllowList,
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
        return apiError(reply, 404, ErrorCodes.FILE_TUNNEL_REQUEST_NOT_FOUND, "Unknown or expired request");
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
      preHandler: async (request: FastifyRequest, reply: FastifyReply) => {
        // Dynamically enforce the admin-configurable upload size limit.
        // This ensures changes to the security setting take effect without restart.
        const contentLength = request.headers['content-length'];
        if (contentLength) {
          const settings = await getSecuritySettings();
          const maxBytes = settings.fileTunnelMaxUploadMb * 1024 * 1024;
          if (Number(contentLength) > maxBytes) {
            return apiError(reply, 413, ErrorCodes.FILE_TOO_LARGE, `Upload exceeds maximum size of ${settings.fileTunnelMaxUploadMb}MB`, { params: { maxMb: settings.fileTunnelMaxUploadMb } });
          }
        }
      },
      config: {
        rateLimit: {
          max: async () => {
            const settings = await getSecuritySettings();
            return settings.fileTunnelRateLimitMax;
          },
          timeWindow: async () => { const s = await getSecuritySettings(); return s.fileTunnelRateLimitWindowMs; },
          allowList: agentAllowList,
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
        return apiError(reply, 404, ErrorCodes.FILE_TUNNEL_REQUEST_NOT_FOUND, "Unknown or expired request");
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
          timeWindow: async () => { const s = await getSecuritySettings(); return s.fileTunnelRateLimitWindowMs; },
          allowList: agentAllowList,
          skipOnError: false,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const nodeId = await authenticateAgent(request, reply);
      if (!nodeId) return;

      const { requestId } = request.params as { requestId: string };
      const upload = fileTunnel.getUploadStream(requestId, nodeId);

      if (!upload) {
        return apiError(reply, 404, ErrorCodes.FILE_TUNNEL_UPLOAD_NOT_FOUND, "Upload data not found or expired");
      }

      reply.header("content-length", upload.size);
      return reply.type("application/octet-stream").send(upload.stream);
    }
  );
}
