import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../../db.js";
import { checkIsAdmin, hasNodeAccess } from './_helpers.js';

export async function serverStatsRoutes(app: FastifyInstance) {
  app.get(
    "/:serverId/stats/history",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;
      const query = request.query as {
        from?: string;
        to?: string;
        interval?: string;
      };

      // Verify server access
      const server = await prisma.server.findUnique({
        where: { id: serverId },
        include: { access: true },
      });
      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }
      const hasAccess =
        server.ownerId === userId ||
        server.access.some((a) => a.userId === userId) ||
        (await hasNodeAccess(prisma, userId, server.nodeId));
      if (!hasAccess) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      // Parse time range — default to last 24 hours
      const now = new Date();
      const to = query.to ? new Date(query.to) : now;
      const from = query.from
        ? new Date(query.from)
        : new Date(now.getTime() - 24 * 60 * 60 * 1000);

      if (isNaN(from.getTime()) || isNaN(to.getTime())) {
        return reply.status(400).send({ error: "Invalid date format. Use ISO 8601." });
      }
      if (from >= to) {
        return reply.status(400).send({ error: "'from' must be before 'to'" });
      }

      // Limit query window to 7 days max
      const maxWindow = 7 * 24 * 60 * 60 * 1000;
      if (to.getTime() - from.getTime() > maxWindow) {
        return reply.status(400).send({ error: "Query window cannot exceed 7 days" });
      }

      // Parse interval (seconds) for downsampling
      const interval = Math.max(1, Math.min(Number(query.interval) || 60, 3600));

      const stats = await prisma.serverStat.findMany({
        where: {
          serverId,
          createdAt: { gte: from, lte: to },
        },
        orderBy: { createdAt: "asc" },
      });

      // Downsample: take one point per interval bucket
      const downsampled: typeof stats = [];
      let bucketStart = from.getTime();
      const intervalMs = interval * 1000;
      let bucket: typeof stats = [];

      for (const stat of stats) {
        const t = stat.createdAt.getTime();
        while (t >= bucketStart + intervalMs && bucket.length) {
          downsampled.push(bucket[0]); // keep first point in bucket
          bucket = [];
          bucketStart += intervalMs;
        }
        bucket.push(stat);
      }
      if (bucket.length) {
        downsampled.push(bucket[0]);
      }

      reply.send({
        success: true,
        data: downsampled,
        meta: { from: from.toISOString(), to: to.toISOString(), interval, totalRaw: stats.length, returned: downsampled.length },
      });
    }
  );

  // Update server
  app.get(
    "/:serverId/activity",
    { onRequest: [app.authenticate] },
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
        return reply.status(404).send({ error: "Server not found" });
      }

      // Permission check: owner, admin, or server.read access
      if (server.ownerId !== userId && !checkIsAdmin(request, "admin.read")) {
        const access = await prisma.serverAccess.findFirst({
          where: {
            userId,
            serverId,
            permissions: { has: "server.read" },
          },
        });
        const hasNodeAccessToServer = await hasNodeAccess(prisma, userId, server.nodeId);
        if (!access && !hasNodeAccessToServer) {
          return reply.status(403).send({ error: "Forbidden" });
        }
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
