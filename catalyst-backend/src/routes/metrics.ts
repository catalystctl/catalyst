import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { apiError } from "../lib/http-error.js";
import { ErrorCodes } from "../shared-types.js";
import { serialize } from "../utils/serialize.js";
import { resolveServerPermissions } from "../lib/permissions-catalog.js";
import { hasNodeAccess, hasGrant } from "../lib/permissions.js";
import { SimpleCache } from "../lib/cache.js";
import { config } from "../config.js";

type ServerMetricBucket = {
  bucket: number;
  count: bigint;
  avgCpu: number | null;
  maxMemory: number | null;
  avgDiskIo: number | null;
  maxDiskUsage: number | null;
  newestRx: bigint | null;
  newestTx: bigint | null;
  newestTimestamp: Date | null;
};

type NodeMetricBucket = {
  bucket: number;
  count: bigint;
  avgCpu: number | null;
  maxMemory: number | null;
  avgDiskUsage: number | null;
  avgMemoryTotal: number | null;
  avgDiskTotal: number | null;
  newestRx: bigint | null;
  newestTx: bigint | null;
  newestTimestamp: Date | null;
};

async function queryServerMetricBuckets(
  serverId: string,
  since: Date,
  until: Date,
  bucketCount: number,
  bucketSizeMs: number,
) {
  return prisma.$queryRaw<ServerMetricBucket[]>(Prisma.sql`
    WITH buckets AS (
      SELECT generate_series(0, ${bucketCount - 1}) AS bucket
    )
    SELECT
      b.bucket::int AS bucket,
      COUNT(m.id)::bigint AS count,
      AVG(m."cpuPercent")::float8 AS "avgCpu",
      MAX(m."memoryUsageMb")::int AS "maxMemory",
      AVG(m."diskIoMb")::float8 AS "avgDiskIo",
      MAX(m."diskUsageMb")::int AS "maxDiskUsage",
      (array_agg(m."networkRxBytes" ORDER BY m.timestamp DESC) FILTER (WHERE m.id IS NOT NULL))[1] AS "newestRx",
      (array_agg(m."networkTxBytes" ORDER BY m.timestamp DESC) FILTER (WHERE m.id IS NOT NULL))[1] AS "newestTx",
      MAX(m.timestamp) AS "newestTimestamp"
    FROM buckets b
    LEFT JOIN "ServerMetrics" m
      ON m."serverId" = ${serverId}
       AND m.timestamp >= CAST(${since} AS timestamp) + (b.bucket * ${bucketSizeMs}) * interval '1 millisecond'
       AND m.timestamp < CAST(${since} AS timestamp) + ((b.bucket + 1) * ${bucketSizeMs}) * interval '1 millisecond'
      AND m.timestamp <= ${until}
    GROUP BY b.bucket
    ORDER BY b.bucket
  `);
}

async function queryNodeMetricBuckets(
  nodeId: string,
  since: Date,
  until: Date,
  bucketCount: number,
  bucketSizeMs: number,
) {
  return prisma.$queryRaw<NodeMetricBucket[]>(Prisma.sql`
    WITH buckets AS (
      SELECT generate_series(0, ${bucketCount - 1}) AS bucket
    )
    SELECT
      b.bucket::int AS bucket,
      COUNT(m.id)::bigint AS count,
      AVG(m."cpuPercent")::float8 AS "avgCpu",
      MAX(m."memoryUsageMb")::int AS "maxMemory",
      AVG(m."diskUsageMb")::float8 AS "avgDiskUsage",
      AVG(m."memoryTotalMb")::float8 AS "avgMemoryTotal",
      AVG(m."diskTotalMb")::float8 AS "avgDiskTotal",
      (array_agg(m."networkRxBytes" ORDER BY m.timestamp DESC) FILTER (WHERE m.id IS NOT NULL))[1] AS "newestRx",
      (array_agg(m."networkTxBytes" ORDER BY m.timestamp DESC) FILTER (WHERE m.id IS NOT NULL))[1] AS "newestTx",
      MAX(m.timestamp) AS "newestTimestamp"
    FROM buckets b
    LEFT JOIN "NodeMetrics" m
      ON m."nodeId" = ${nodeId}
       AND m.timestamp >= CAST(${since} AS timestamp) + (b.bucket * ${bucketSizeMs}) * interval '1 millisecond'
       AND m.timestamp < CAST(${since} AS timestamp) + ((b.bucket + 1) * ${bucketSizeMs}) * interval '1 millisecond'
      AND m.timestamp <= ${until}
    GROUP BY b.bucket
    ORDER BY b.bucket
  `);
}

// History payloads are polled frequently per open server tab and each miss
// scans up to 10k metric rows. TTL is short (time-series data: TTL-only,
// no invalidation possible). Entries are pre-serialized response strings.
const metricsHistoryCache = new SimpleCache<string, unknown>(10_000, 500);
// Latest-stats snapshot, polled every few seconds per open tab. 2s TTL
// coalesces bursts without visible staleness; entries are response strings.
const serverStatsCache = new SimpleCache<string, string>(2_000, 1000);

export async function metricsRoutes(app: FastifyInstance) {
  // Using shared prisma instance from db.ts

  // Get server metrics
  app.get(
    "/servers/:serverId/metrics",
    { onRequest: [app.authenticate], config: { requiredPermission: "server.read" }, schema: { summary: "Get server metrics history", description: "Get bucketed server metrics for a bounded time window.", tags: ["Metrics"], params: { type: "object", required: ["serverId"], properties: { serverId: { type: "string" } } }, querystring: { type: "object", properties: { hours: { type: "string" }, limit: { type: "string" } } }, response: { 200: { type: "object", additionalProperties: true } } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;
      const { hours, limit } = request.query as { hours?: string; limit?: string };

      // Calculate time range upfront
      const parsedHours = hours ? parseInt(hours) : 1;
      const parsedLimit = limit ? parseInt(limit) : 100;
      const hoursBack = Number.isFinite(parsedHours) ? Math.min(Math.max(parsedHours, 1), 168) : 1;
      const maxRecords = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 1000) : 100;
      const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

      // Cache key is serverId + requested window. Authz is checked first
      // below, so a cache hit can never bypass permission checks.
      const cacheKey = `${serverId}:${hoursBack}h:${maxRecords}`;

      // Authz-first, cache-second, metrics-query-only-on-miss: a warm hit
      // pays just the lean server + access reads instead of the up-to-10k-row
      // metrics scan that used to run on every poll.
      const [server, access] = await Promise.all([
        prisma.server.findUnique({
          where: { id: serverId },
          select: { id: true, ownerId: true, nodeId: true, suspendedAt: true, suspensionReason: true },
        }),
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
        return apiError(reply, 404, ErrorCodes.SERVER_NOT_FOUND, "Server not found");
      }

      if (config.suspension.enforced && server.suspendedAt) {
        return reply.status(423).send({
          error: "Server is suspended",
          code: ErrorCodes.SERVER_SUSPENDED,
          suspendedAt: server.suspendedAt,
          suspensionReason: server.suspensionReason ?? null,
        });
      }

      // Check permissions — owner, explicit access, global role grant
      // (server.read / admin), or node assignment
      const rolePerms = await resolveServerPermissions(userId, serverId, server.nodeId);
      // SECURITY: bare node assignment must not expose other tenants'
      // metrics — require the node-manage pairing (mirrors
      // decideServerAccess: legacy node.update or its split value
      // node.server_manage).
      const hasNodeAccessToServer =
        (await hasNodeAccess(prisma, userId, server.nodeId)) &&
        (rolePerms.includes("node.update") ||
          rolePerms.includes("node.server_manage") ||
          rolePerms.includes("*"));
      // hasGrant: admin.read and bare admin.write roles also satisfy
      // server.read (the exact-match include previously locked them out).
      const canReadMetrics =
        server.ownerId === userId ||
        Boolean(access?.permissions?.includes("server.read")) ||
        hasGrant(rolePerms, "server.read") ||
        hasNodeAccessToServer;
      if (!canReadMetrics) {
        return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "Forbidden");
      }

      const cached = metricsHistoryCache.get(cacheKey);
      if (cached !== undefined) {
        reply.header("content-type", "application/json; charset=utf-8");
        return reply.send(cached as string);
      }

      const nowMs = Date.now();
      const sinceMs = since.getTime();
      const bucketCount = Math.max(1, maxRecords);
      const rangeMs = Math.max(1, nowMs - sinceMs);
      const bucketSizeMs = Math.ceil(rangeMs / bucketCount);
      const [buckets, latestRaw] = await Promise.all([
        queryServerMetricBuckets(serverId, since, new Date(nowMs), bucketCount, bucketSizeMs),
        prisma.serverMetrics.findFirst({ where: { serverId, timestamp: { gte: since, lte: new Date(nowMs) } }, orderBy: { timestamp: "desc" }, select: { cpuPercent: true, memoryUsageMb: true, diskIoMb: true, diskUsageMb: true, networkRxBytes: true, networkTxBytes: true, timestamp: true } }),
      ]);

      // Build normalized history array - chronological order with network deltas
      let prevSrvRx = BigInt(0);
      let prevSrvTx = BigInt(0);
      let prevSrvTs = 0;
      const normalizedMetrics = buckets.map((b, i) => {
        if (b.count === BigInt(0)) {
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
        const cpu = Math.round((Number(b.avgCpu) * 10)) / 10;
        const diskIo = Math.round(Number(b.avgDiskIo ?? 0));
        const rx = b.newestRx ?? BigInt(0);
        const tx = b.newestTx ?? BigInt(0);
        const bTs = b.newestTimestamp?.getTime() ?? (sinceMs + i * bucketSizeMs);
        const elapsedSec = prevSrvTs > 0 ? Math.max(1, (bTs - prevSrvTs) / 1000) : 0;
        const rxRate = elapsedSec > 0 && prevSrvRx > BigInt(0)
          ? Math.max(0, Math.round(Number(rx - prevSrvRx) / elapsedSec / (1024 * 1024) * 100) / 100)
          : 0;
        const txRate = elapsedSec > 0 && prevSrvTx > BigInt(0)
          ? Math.max(0, Math.round(Number(tx - prevSrvTx) / elapsedSec / (1024 * 1024) * 100) / 100)
          : 0;
        prevSrvRx = rx;
        prevSrvTx = tx;
        prevSrvTs = bTs;
        return {
          cpuPercent: cpu,
          memoryUsageMb: b.maxMemory as number,
          diskIoMb: diskIo,
          diskUsageMb: b.maxDiskUsage as number,
          networkRxBytes: rxRate, // MB/s
          networkTxBytes: txRate, // MB/s
          timestamp: new Date(bTs),
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

      const hasSamples = buckets.some((bucket) => bucket.count > BigInt(0));
      const payload = {
        latest,
        averages: avg,
        history: hasSamples ? normalizedMetrics : [], // chronological
        count: hasSamples ? normalizedMetrics.length : 0,
      };
      // Cache + serve the fully serialized response string so warm hits skip
      // the BigInt-safe serialize() round trip AND Fastify's stringify.
      const responseStr = JSON.stringify(serialize({ success: true, data: payload }));
      metricsHistoryCache.set(cacheKey, responseStr);
      reply.header("content-type", "application/json; charset=utf-8");
      reply.send(responseStr);
    }
  );

  // Get current server stats (latest only)
  app.get(
    "/servers/:serverId/stats",
    { onRequest: [app.authenticate], config: { requiredPermission: "server.read" }, schema: { summary: "Get current server stats", description: "Get the latest available server metrics.", tags: ["Metrics"], params: { type: "object", required: ["serverId"], properties: { serverId: { type: "string" } } }, response: { 200: { type: "object", additionalProperties: true } } } },
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
        return apiError(reply, 404, ErrorCodes.SERVER_NOT_FOUND, "Server not found");
      }

      if (config.suspension.enforced && server.suspendedAt) {
        return reply.status(423).send({
          error: "Server is suspended",
          code: ErrorCodes.SERVER_SUSPENDED,
          suspendedAt: server.suspendedAt,
          suspensionReason: server.suspensionReason ?? null,
        });
      }

      // Check permissions — owner, explicit access, global role grant
      // (server.read / admin), or node assignment
      const rolePerms = await resolveServerPermissions(userId, serverId, server.nodeId);
      // SECURITY: bare node assignment must not expose other tenants'
      // metrics — require the node-manage pairing (mirrors
      // decideServerAccess: legacy node.update or its split value
      // node.server_manage).
      const hasNodeAccessToServer =
        (await hasNodeAccess(prisma, userId, server.nodeId)) &&
        (rolePerms.includes("node.update") ||
          rolePerms.includes("node.server_manage") ||
          rolePerms.includes("*"));
      // hasGrant: admin.read and bare admin.write roles also satisfy
      // server.read (the exact-match include previously locked them out).
      const canReadMetrics =
        server.ownerId === userId ||
        Boolean(access?.permissions?.includes("server.read")) ||
        hasGrant(rolePerms, "server.read") ||
        hasNodeAccessToServer;
      if (!canReadMetrics) {
        return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "Forbidden");
      }

      const cachedStats = serverStatsCache.get(serverId);
      if (cachedStats !== undefined) {
        reply.header("content-type", "application/json; charset=utf-8");
        return reply.send(cachedStats);
      }

      const data = !latest
        ? {
            message: "No metrics available yet",
            server: {
              id: server.id,
              name: server.name,
              status: server.status,
              allocatedMemoryMb: server.allocatedMemoryMb,
              allocatedCpuCores: server.allocatedCpuCores,
            },
          }
        : {
            cpuPercent: latest.cpuPercent,
            memoryUsageMb: latest.memoryUsageMb,
            memoryAllocatedMb: server.allocatedMemoryMb,
            memoryPercentage: server.allocatedMemoryMb > 0
              ? (latest.memoryUsageMb / server.allocatedMemoryMb) * 100
              : 0,
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
          };
      const responseStr = JSON.stringify(serialize({ success: true, data }));
      serverStatsCache.set(serverId, responseStr);
      reply.header("content-type", "application/json; charset=utf-8");
      reply.send(responseStr);
    }
  );

  // Get node metrics
  app.get(
    "/nodes/:nodeId/metrics",
    { onRequest: [app.authenticate], schema: { summary: "Get node metrics history", description: "Get bucketed node metrics for a bounded time window.", tags: ["Metrics"], params: { type: "object", required: ["nodeId"], properties: { nodeId: { type: "string" } } }, querystring: { type: "object", properties: { hours: { type: "string" }, limit: { type: "string" } } }, response: { 200: { type: "object", additionalProperties: true } } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const perms: string[] = request.user?.permissions ?? [];
      // hasGrant admits node.view_stats (the targeted permission for node
      // statistics) as well as the admin bits: admin.read is read-classified
      // for node.view_stats, and admin.write satisfies any concrete permission.
      if (!hasGrant(perms, "node.view_stats")) {
        return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "Admin access required");
      }
      const { nodeId } = request.params as { nodeId: string };
      const { hours, limit } = request.query as { hours?: string; limit?: string };

      const node = await prisma.node.findUnique({
        where: { id: nodeId },
      });

      if (!node) {
        return apiError(reply, 404, ErrorCodes.NODE_NOT_FOUND, "Node not found");
      }

      // Calculate time range (clamped like the server route so a bad or
      // hostile query cannot request an unbounded bucket array).
      const parsedNodeHours = hours ? parseInt(hours) : 1;
      const parsedNodeLimit = limit ? parseInt(limit) : 100;
      const hoursBack = Number.isFinite(parsedNodeHours) ? Math.min(Math.max(parsedNodeHours, 1), 168) : 1;
      const maxRecords = Number.isFinite(parsedNodeLimit) ? Math.min(Math.max(parsedNodeLimit, 1), 1000) : 100;
      const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

      const nowMs = Date.now();
      const sinceMs = since.getTime();
      const bucketCount = Math.max(1, maxRecords);
      const rangeMs = Math.max(1, nowMs - sinceMs);
      const bucketSizeMs = Math.ceil(rangeMs / bucketCount);
      const [buckets, latestRaw] = await Promise.all([
        queryNodeMetricBuckets(nodeId, since, new Date(nowMs), bucketCount, bucketSizeMs),
        prisma.nodeMetrics.findFirst({ where: { nodeId, timestamp: { gte: since, lte: new Date(nowMs) } }, orderBy: { timestamp: "desc" } }),
      ]);

      // Build chronological history with network deltas (MB/s rates derived
      // from cumulative byte counters).
      let prevNetRx = BigInt(0);
      let prevNetTx = BigInt(0);
      let prevTimestamp = 0;
      const history = buckets.map((b, i) => {
        const ts = b.newestTimestamp?.getTime() ?? (sinceMs + i * bucketSizeMs);
        if (b.count === BigInt(0)) {
          return {
            cpuPercent: null,
            memoryUsageMb: null,
            memoryTotalMb: null,
            diskUsageMb: null,
            diskTotalMb: null,
            networkRxBytes: null,
            networkTxBytes: null,
            timestamp: new Date(sinceMs + i * bucketSizeMs),
          };
        }
        const cpu = Math.round(Number(b.avgCpu ?? 0) * 10) / 10;
        const rx = b.newestRx ?? BigInt(0);
        const tx = b.newestTx ?? BigInt(0);
        const elapsedSec = prevTimestamp > 0 ? Math.max(1, (ts - prevTimestamp) / 1000) : 0;
        const rxRate = elapsedSec > 0 && prevNetRx > BigInt(0)
          ? Math.max(0, Number(rx - prevNetRx) / elapsedSec / (1024 * 1024))
          : 0;
        const txRate = elapsedSec > 0 && prevNetTx > BigInt(0)
          ? Math.max(0, Number(tx - prevNetTx) / elapsedSec / (1024 * 1024))
          : 0;
        prevNetRx = rx;
        prevNetTx = tx;
        prevTimestamp = ts;
        return {
          cpuPercent: cpu,
          memoryUsageMb: b.maxMemory as number,
          memoryTotalMb: Math.round(Number(b.avgMemoryTotal ?? 0)),
          diskUsageMb: Math.round(Number(b.avgDiskUsage ?? 0)),
          diskTotalMb: Math.round(Number(b.avgDiskTotal ?? 0)),
          networkRxBytes: Math.round(rxRate * 100) / 100,
          networkTxBytes: Math.round(txRate * 100) / 100,
          timestamp: new Date(ts),
        };
      });

      // Calculate averages over non-empty buckets
      const nonEmpty = history.filter((m) => m.cpuPercent !== null);
      const avg = nonEmpty.length > 0 ? {
        cpuPercent: Math.round((nonEmpty.reduce((s, m) => s + (m.cpuPercent as number), 0) / nonEmpty.length) * 10) / 10,
        memoryUsageMb: Math.round(nonEmpty.reduce((s, m) => s + (m.memoryUsageMb as number), 0) / nonEmpty.length),
        diskUsageMb: Math.round(nonEmpty.reduce((s, m) => s + (m.diskUsageMb as number), 0) / nonEmpty.length),
        containerCount: 0,
      } : null;

      // Latest is the most recent raw point
      const latest = latestRaw
        ? {
            cpuPercent: latestRaw.cpuPercent,
            memoryUsageMb: latestRaw.memoryUsageMb,
            memoryTotalMb: latestRaw.memoryTotalMb,
            diskUsageMb: latestRaw.diskUsageMb,
            diskTotalMb: latestRaw.diskTotalMb,
            networkRxBytes: latestRaw.networkRxBytes.toString(),
            networkTxBytes: latestRaw.networkTxBytes.toString(),
            containerCount: latestRaw.containerCount,
            timestamp: latestRaw.timestamp,
          }
        : null;

      reply.send(serialize({
        success: true,
        data: {
          latest,
          averages: avg,
          history,
          count: history.length,
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
