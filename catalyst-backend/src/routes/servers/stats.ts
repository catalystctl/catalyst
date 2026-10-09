import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../../db.js";
import { serialize } from "../../utils/serialize.js";
import { canAccessServer } from './_helpers.js';
import { apiError } from "../../lib/http-error";
import { ErrorCodes } from "../../shared-types";
import { Prisma } from "@prisma/client";

export async function serverStatsRoutes(app: FastifyInstance) {
  app.get(
    "/:serverId/stats/history",
    { schema: { summary: "Retrieve history for stats", description: "Retrieve history for stats.", tags: ["Stats"], params: { type: "object", required: ['serverId'], properties: { serverId: { type: "string" } } }, response: { 200: { type: "object", additionalProperties: true } } },  onRequest: [app.authenticate], config: { requiredPermission: "server.read" } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;
      const query = request.query as {
        from?: string;
        to?: string;
        interval?: string;
      };

      // Verify server access (owner | ServerAccess | node+node.update | admin.write/*)
      const server = await prisma.server.findUnique({
        where: { id: serverId },
        select: { id: true, ownerId: true, nodeId: true },
      });
      if (!server) {
        return apiError(reply, 404, ErrorCodes.SERVER_NOT_FOUND, "Server not found");
      }
      if (!(await canAccessServer(userId, server, request.user))) {
        return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "Forbidden");
      }

      // Parse time range — default to last 24 hours
      const now = new Date();
      const to = query.to ? new Date(query.to) : now;
      const from = query.from
        ? new Date(query.from)
        : new Date(now.getTime() - 24 * 60 * 60 * 1000);

      if (isNaN(from.getTime()) || isNaN(to.getTime())) {
        return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, "Invalid date format. Use ISO 8601.");
      }
      if (from >= to) {
        return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, "'from' must be before 'to'");
      }

      // Limit query window to 7 days max
      const maxWindow = 7 * 24 * 60 * 60 * 1000;
      if (to.getTime() - from.getTime() > maxWindow) {
        return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, "Query window cannot exceed 7 days");
      }

      // Parse interval (seconds) for downsampling
      const interval = Math.max(1, Math.min(Number(query.interval) || 60, 3600));

      const bucketRows = await prisma.$queryRaw<Array<{
        id: string;
        serverId: string;
        cpuPercent: number;
        memoryUsed: bigint;
        memoryLimit: bigint;
        diskUsed: bigint | null;
        netRx: number | null;
        netTx: number | null;
        blockRead: number | null;
        blockWrite: number | null;
        createdAt: Date;
        totalRaw: bigint;
      }>>(Prisma.sql`
        WITH ranked AS (
          SELECT s.*, COUNT(*) OVER () AS "totalRaw",
            ROW_NUMBER() OVER (
              PARTITION BY FLOOR(EXTRACT(EPOCH FROM (s."createdAt" - ${from})) / ${interval})
              ORDER BY s."createdAt" ASC
            ) AS row_number
          FROM "ServerStat" s
          WHERE s."serverId" = ${serverId}
            AND s."createdAt" >= ${from}
            AND s."createdAt" <= ${to}
        )
        SELECT "id", "serverId", "cpuPercent", "memoryUsed", "memoryLimit", "diskUsed",
          "netRx", "netTx", "blockRead", "blockWrite", "createdAt", "totalRaw"
        FROM ranked
        WHERE row_number = 1
        ORDER BY "createdAt" ASC
      `);
      const totalRaw = bucketRows.length > 0 ? Number(bucketRows[0].totalRaw) : 0;

      // BigInt byte columns serialize to strings via serialize(); keep the
      // wire shape numeric (bytes fit safely in a JS number well past TiBs)
      // so charts do not flatline or string-concat.
      const toNum = (v: unknown) => (typeof v === "bigint" ? Number(v) : (v as number));
      const data = bucketRows.map((s) => {
        const { totalRaw: _totalRaw, ...stat } = s;
        return {
        ...stat,
        memoryUsed: toNum((s as unknown as Record<string, unknown>).memoryUsed),
        memoryLimit: toNum((s as unknown as Record<string, unknown>).memoryLimit),
        diskUsed:
          (s as unknown as Record<string, unknown>).diskUsed === null ||
          (s as unknown as Record<string, unknown>).diskUsed === undefined
            ? null
            : toNum((s as unknown as Record<string, unknown>).diskUsed),
        };
      });

      reply.send(
        serialize({
          success: true,
          data,
          meta: { from: from.toISOString(), to: to.toISOString(), interval, totalRaw, returned: data.length },
        }),
      );
    }
  );

  // Server activity log (audit trail, paginated)
  app.get(
    "/:serverId/activity",
    { schema: { summary: "Retrieve activity", description: "Retrieve activity.", tags: ["Stats"], params: { type: "object", required: ['serverId'], properties: { serverId: { type: "string" } } }, response: { 200: { type: "object", additionalProperties: true } } },  onRequest: [app.authenticate], config: { requiredPermission: "server.read" } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;
      const { page = "1", limit = "25" } = request.query as { page?: string; limit?: string };
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));
      const skip = (pageNum - 1) * limitNum;

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        select: { id: true, ownerId: true, nodeId: true },
      });
      if (!server) {
        return apiError(reply, 404, ErrorCodes.SERVER_NOT_FOUND, "Server not found");
      }

      // Permission check: decideServerAccess contract (not bare node assignment)
      if (!(await canAccessServer(userId, server, request.user))) {
        return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "Forbidden");
      }

      const [items, total] = await Promise.all([
        prisma.auditLog.findMany({
          where: { resource: "server", resourceId: serverId },
          orderBy: { timestamp: "desc" },
          skip,
          take: limitNum,
          include: {
            user: {
              select: { id: true, username: true, email: true, name: true },
            },
          },
        }),
        prisma.auditLog.count({
          where: { resource: "server", resourceId: serverId },
        }),
      ]);

      return reply.send({
        success: true,
        data: items,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      });
    }
  );

  // ============================================================================
  // SERVER STARTUP VARIABLES
  // ============================================================================

  /**
   * Parse and validate a rule string against a value.
   * Supported rules:
   *   - between:min,max   (numeric range, inclusive)
   *   - regex:pattern     (string regex match)
   *   - in:opt1,opt2,...  (allowed values)
   */

}
