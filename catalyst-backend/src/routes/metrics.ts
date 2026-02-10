import { prisma } from '../db.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { PrismaClient } from "@prisma/client";
import { serialize } from '../utils/serialize';
import { hasNodeAccess } from '../lib/permissions';

export async function metricsRoutes(app: FastifyInstance) {
  // Using shared prisma instance from db.ts

  // Get server metrics
  app.get(
    "/servers/:serverId/metrics",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const startTime = Date.now();
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;
      const { hours, limit } = request.query as { hours?: string; limit?: string };

      // Calculate time range upfront
      const parsedHours = hours ? parseInt(hours) : 1;
      const parsedLimit = limit ? parseInt(limit) : 100;
      const hoursBack = Number.isFinite(parsedHours) ? Math.min(Math.max(parsedHours, 1), 168) : 1;
      const maxRecords = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 1000) : 100;
      const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

      // Run ALL queries in parallel - server, metrics, and access all at once
      const queryStart = Date.now();
      // fetchLimit: get more raw points than `maxRecords` so bucketization uses
      // data across the whole requested window instead of only the newest N rows.
      const fetchLimit = Math.min(10000, Math.max(maxRecords * 25, maxRecords));
      const [server, metrics, access] = await Promise.all([
        prisma.server.findUnique({
          where: { id: serverId },
          select: { id: true, ownerId: true, nodeId: true, suspendedAt: true, suspensionReason: true },
        }),
        prisma.serverMetrics.findMany({
          where: {
            serverId,
            timestamp: { gte: since },
          },
          orderBy: { timestamp: "desc" },
          take: fetchLimit,
          select: {
            cpuPercent: true,
            memoryUsageMb: true,
            diskIoMb: true,
            diskUsageMb: true,
            networkRxBytes: true,
            networkTxBytes: true,
            timestamp: true,
          },
        }),
        // Run permission check in parallel
        prisma.serverAccess.findUnique({
          where: {
            userId_serverId: {
              userId,
              serverId,
            },
          },
          select: { permissions: true },
        }),
      ]);
      const queryTime = Date.now() - queryStart;
      app.log.info({ serverId, queryMs: queryTime }, "Metrics query time");

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (process.env.SUSPENSION_ENFORCED !== "false" && server.suspendedAt) {
        return reply.status(423).send({
          error: "Server is suspended",
          suspendedAt: server.suspendedAt,
          suspensionReason: server.suspensionReason ?? null,
        });
      }

      // Check permissions - owner, explicit access, or node assignment
      const hasNodeAccessToServer = await hasNodeAccess(prisma, userId, server.nodeId);
      if (server.ownerId !== userId && !access?.permissions?.includes("server.read") && !hasNodeAccessToServer) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      // Return early if no metrics
      if (metrics.length === 0) {
        return reply.send(serialize({
          success: true,
          data: {
            latest: null,
            averages: null,
            history: [],
            count: 0,
          },
        }));
      }

      // Aggregate into evenly spaced buckets across the requested time range.
      // This ensures long time windows (eg 24h, 7d) expose spikes (we use max for memory)
      // instead of returning only the last N rows which can bias recent data.
      const nowMs = Date.now();
      const sinceMs = since.getTime();
      const bucketCount = Math.max(1, maxRecords);
      const rangeMs = Math.max(1, nowMs - sinceMs);
      const bucketSizeMs = Math.ceil(rangeMs / bucketCount);

      type Bucket = {
        count: number;
        sumCpu: number;
        maxMemory: number | null;
        sumDiskIo: number;
        maxDiskUsage: number | null;
        firstNetRx: bigint | null;
        lastNetRx: bigint | null;
        firstNetTx: bigint | null;
        lastNetTx: bigint | null;
        lastTimestamp: number | null;
      };

      const buckets: Bucket[] = Array.from({ length: bucketCount }, () => ({
        count: 0,
        sumCpu: 0,
        maxMemory: null,
        sumDiskIo: 0,
        maxDiskUsage: null,
        firstNetRx: null,
        lastNetRx: null,
        firstNetTx: null,
        lastNetTx: null,
        lastTimestamp: null,
      }));

      // metrics returned in descending order - iterate and place into buckets
      for (const m of metrics) {
        const t = m.timestamp.getTime();
        let idx = Math.floor((t - sinceMs) / bucketSizeMs);
        if (idx < 0) idx = 0;
        if (idx >= bucketCount) idx = bucketCount - 1;
        const b = buckets[idx];
        b.count += 1;
        b.sumCpu += m.cpuPercent;
        b.maxMemory = b.maxMemory === null ? m.memoryUsageMb : Math.max(b.maxMemory, m.memoryUsageMb);
        b.sumDiskIo += m.diskIoMb ?? 0;
        b.maxDiskUsage = b.maxDiskUsage === null ? m.diskUsageMb : Math.max(b.maxDiskUsage, m.diskUsageMb);

        const rx = BigInt(Math.max(0, Number(m.networkRxBytes ?? 0)));
        const tx = BigInt(Math.max(0, Number(m.networkTxBytes ?? 0)));
        if (b.firstNetRx === null) b.firstNetRx = rx;
        b.lastNetRx = rx;
        if (b.firstNetTx === null) b.firstNetTx = tx;
        b.lastNetTx = tx;

        b.lastTimestamp = Math.max(b.lastTimestamp ?? 0, t);
      }

      // Build normalized history array - chronological order
      const normalizedMetrics = buckets.map((b, i) => {
        if (b.count === 0) {
          return {
            cpuPercent: null,
            memoryUsageMb: null,
            diskIoMb: null,
            diskUsageMb: null,
            networkRxBytes: null,
            networkTxBytes: null,
            timestamp: new Date(sinceMs + i * bucketSizeMs),
          };
        }
        const cpu = Math.round((b.sumCpu / b.count) * 10) / 10;
        const diskIo = Math.round(b.sumDiskIo / b.count);
        const rx = b.lastNetRx ?? BigInt(0);
        const tx = b.lastNetTx ?? BigInt(0);
        return {
          cpuPercent: cpu,
          memoryUsageMb: b.maxMemory as number,
          diskIoMb: diskIo,
          diskUsageMb: b.maxDiskUsage as number,
          networkRxBytes: rx.toString(),
          networkTxBytes: tx.toString(),
          timestamp: new Date(b.lastTimestamp ?? (sinceMs + i * bucketSizeMs)),
        };
      });

      // Calculate averages over non-empty buckets
      const nonEmpty = normalizedMetrics.filter((m) => m.cpuPercent !== null);
      const avg = nonEmpty.length
        ? {
            cpuPercent: Math.round((nonEmpty.reduce((s, m) => s + (m.cpuPercent as number), 0) / nonEmpty.length) * 10) / 10,
            memoryUsageMb: Math.round(nonEmpty.reduce((s, m) => s + (m.memoryUsageMb as number), 0) / nonEmpty.length),
            diskIoMb: Math.round(nonEmpty.reduce((s, m) => s + (m.diskIoMb as number), 0) / nonEmpty.length),
            diskUsageMb: Math.round(nonEmpty.reduce((s, m) => s + (m.diskUsageMb as number), 0) / nonEmpty.length),
          }
        : null;

      // Get latest raw metric (most recent by timestamp)
      const latestRaw = metrics[0] || null;
      const latest = latestRaw
        ? {
            cpuPercent: latestRaw.cpuPercent,
            memoryUsageMb: latestRaw.memoryUsageMb,
            diskIoMb: latestRaw.diskIoMb ?? 0,
            diskUsageMb: latestRaw.diskUsageMb,
            networkRxBytes: latestRaw.networkRxBytes.toString(),
            networkTxBytes: latestRaw.networkTxBytes.toString(),
            timestamp: latestRaw.timestamp,
          }
        : null;

      const totalTime = Date.now() - startTime;
      app.log.info({ serverId, totalMs: totalTime }, "Total metrics endpoint time");

      reply.send(serialize({
        success: true,
        data: {
          latest,
          averages: avg,
          history: normalizedMetrics, // chronological
          count: normalizedMetrics.length,
        },
      }));
    }
  );

  // Get current server stats (latest only)
  app.get(
    "/servers/:serverId/stats",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;

      // Run queries in parallel
      const [server, latest, access] = await Promise.all([
        prisma.server.findUnique({
          where: { id: serverId },
          select: {
            id: true,
            name: true,
            status: true,
            ownerId: true,
            nodeId: true,
            allocatedMemoryMb: true,
            allocatedCpuCores: true,
            suspendedAt: true,
            suspensionReason: true,
          },
        }),
        prisma.serverMetrics.findFirst({
          where: { serverId },
          orderBy: { timestamp: "desc" },
          select: {
            cpuPercent: true,
            memoryUsageMb: true,
            diskIoMb: true,
            diskUsageMb: true,
            networkRxBytes: true,
            networkTxBytes: true,
            timestamp: true,
          },
        }),
        // Run permission check in parallel
        prisma.serverAccess.findUnique({
          where: {
            userId_serverId: {
              userId,
              serverId,
            },
          },
          select: { permissions: true },
        }),
      ]);

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (process.env.SUSPENSION_ENFORCED !== "false" && server.suspendedAt) {
        return reply.status(423).send({
          error: "Server is suspended",
          suspendedAt: server.suspendedAt,
          suspensionReason: server.suspensionReason ?? null,
        });
      }

      // Check permissions - owner, explicit access, or node assignment
      const hasNodeAccessToServer = await hasNodeAccess(prisma, userId, server.nodeId);
      if (server.ownerId !== userId && !access?.permissions?.includes("server.read") && !hasNodeAccessToServer) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      if (!latest) {
        return reply.send(serialize({
          success: true,
          data: {
            message: "No metrics available yet",
            server: {
              id: server.id,
              name: server.name,
              status: server.status,
              allocatedMemoryMb: server.allocatedMemoryMb,
              allocatedCpuCores: server.allocatedCpuCores,
            },
          },
        }));
      }

      reply.send(serialize({
        success: true,
        data: {
          cpuPercent: latest.cpuPercent,
          memoryUsageMb: latest.memoryUsageMb,
          memoryAllocatedMb: server.allocatedMemoryMb,
          memoryPercentage: (latest.memoryUsageMb / server.allocatedMemoryMb) * 100,
          diskIoMb: latest.diskIoMb ?? 0,
          diskUsageMb: latest.diskUsageMb,
          networkRxBytes: latest.networkRxBytes.toString(),
          networkTxBytes: latest.networkTxBytes.toString(),
          timestamp: latest.timestamp,
          server: {
            id: server.id,
            name: server.name,
            status: server.status,
          },
        },
      }));
    }
  );

  // Get node metrics
  app.get(
    "/nodes/:nodeId/metrics",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const roles = await prisma.role.findMany({
        where: { users: { some: { id: request.user.userId } } },
        select: { permissions: true },
      });
      const permissions = roles.flatMap((role) => role.permissions);
      const isAdmin =
        permissions.includes("*") ||
        permissions.includes("admin.write") ||
        permissions.includes("admin.read");
      if (!isAdmin) {
        return reply.status(403).send({ error: "Admin access required" });
      }
      const { nodeId } = request.params as { nodeId: string };
      const { hours, limit } = request.query as { hours?: string; limit?: string };

      const node = await prisma.node.findUnique({
        where: { id: nodeId },
      });

      if (!node) {
        return reply.status(404).send({ error: "Node not found" });
      }

      // Calculate time range
      const hoursBack = hours ? parseInt(hours) : 1;
      const maxRecords = limit ? parseInt(limit) : 100;
      const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

      const fetchNodeLimit = Math.min(10000, Math.max(maxRecords * 25, maxRecords));
      const metrics = await prisma.nodeMetrics.findMany({
        where: {
          nodeId,
          timestamp: { gte: since },
        },
        orderBy: { timestamp: "desc" },
        take: fetchNodeLimit,
      });

      // Calculate averages
      const avg = metrics.length > 0 ? {
        cpuPercent: metrics.reduce((sum, m) => sum + m.cpuPercent, 0) / metrics.length,
        memoryUsageMb: Math.round(metrics.reduce((sum, m) => sum + m.memoryUsageMb, 0) / metrics.length),
        diskUsageMb: Math.round(metrics.reduce((sum, m) => sum + m.diskUsageMb, 0) / metrics.length),
        containerCount: Math.round(metrics.reduce((sum, m) => sum + m.containerCount, 0) / metrics.length),
      } : null;

      // Get latest metrics
      const latest = metrics[0] || null;

      reply.send(serialize({
        success: true,
        data: {
          latest,
          averages: avg,
          history: metrics.reverse(),
          count: metrics.length,
          node: {
            id: node.id,
            name: node.name,
            maxMemoryMb: node.maxMemoryMb,
            maxCpuCores: node.maxCpuCores,
            isOnline: node.isOnline,
          },
        },
      }));
    }
  );
}
