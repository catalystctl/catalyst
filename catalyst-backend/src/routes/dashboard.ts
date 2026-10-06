import { prisma } from '../db.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { SimpleCache } from '../lib/cache.js';
import { getUserAccessibleNodes } from '../lib/permissions.js';

// Per-viewer+permission-shape cache (10s TTL). A single-entry slot thrashed
// to 0% hit rate with two alternating users; a capped multi-entry map keeps
// every dashboard viewer's poll on-cache. Entries are pre-serialized
// response strings so warm hits skip re-stringification.
const dashboardCache = new SimpleCache<string, string>(10_000, 200);
// Recent-activity feed (5s TTL, key: viewer scope + limit). Polled by every
// open dashboard; entries are pre-serialized response strings.
const activityCache = new SimpleCache<string, string>(5_000, 200);

// /resources aggregates are fleet-global (identical for every viewer) and
// polled every 30s per open dashboard. A shared 10s cache turns N viewers
// into ~1 query set per interval instead of N.
let resourcesCache: { data: any; timestamp: number } | null = null;
const RESOURCES_CACHE_TTL = 10_000;

function buildCacheKey(user: any): string {
  const perms: string[] = user?.permissions ?? [];
  return `${user?.userId ?? 'anon'}:${perms.sort().join(',')}`;
}

export async function dashboardRoutes(app: FastifyInstance) {
  const authenticate = (app as any).authenticate;

  // Get dashboard statistics
  app.get(
    '/stats',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user;
      const cacheKey = buildCacheKey(user);

      const cachedStats = dashboardCache.get(cacheKey);
      if (cachedStats !== undefined) {
        reply.header('content-type', 'application/json; charset=utf-8');
        return reply.send(cachedStats);
      }

      const perms: string[] = user?.permissions ?? [];

      // Check if user has any relevant permission
      const canReadServers = perms.includes('*') || perms.includes('server.read');
      const canReadNodes = perms.includes('*') || perms.includes('node.read');
      const canReadAlerts = perms.includes('*') || perms.includes('alert.read');
      // Global server list / counts require admin.write or * — server.read alone is not global.
      const isGlobalAdmin = perms.includes('*') || perms.includes('admin.write');
      const isAdmin = isGlobalAdmin || perms.includes('admin.read');

      // Scope server counts to accessible servers unless the caller has global admin write/*.
      // server.read alone must NOT expose panel-wide inventory.
      let serverWhere: Record<string, unknown>;
      if (isGlobalAdmin) {
        serverWhere = {};
      } else {
        const accessRows = await prisma.serverAccess.findMany({
          where: { userId: user.userId },
          select: { serverId: true },
        });
        const accessIds = accessRows.map((r) => r.serverId);
        // Include nodes the user is assigned to (node operators managing those hosts).
        const accessible = await getUserAccessibleNodes(prisma, user.userId);
        const orClauses: Array<Record<string, unknown>> = [{ ownerId: user.userId }];
        if (accessIds.length > 0) {
          orClauses.push({ id: { in: accessIds } });
        }
        if (accessible.hasWildcard) {
          // Node wildcard still does not mean global panel admin for inventory —
          // only count servers on assigned nodes when we have concrete ids; if
          // hasWildcard with empty nodeIds, fall back to owner+access only.
        } else if (accessible.nodeIds.length > 0) {
          orClauses.push({ nodeId: { in: accessible.nodeIds } });
        }
        serverWhere = { OR: orClauses };
      }

      // canReadServers kept for backward-compat of other UI gates; counts always scoped above.
      void canReadServers;

      const wantNodes = canReadNodes || isAdmin;
      const wantAlerts = canReadAlerts || isAdmin;

      // One round trip for the fleet-global counts (scalar subqueries)
      // instead of one count() query per figure. Scoped server counts below
      // still use Prisma's where builder for the per-user OR clauses.
      // $queryRaw resolves to the array of result rows — take the first row.
      const globalCounts =
        isGlobalAdmin || wantNodes || wantAlerts
          ? (
              await prisma.$queryRaw<{
                servers: number;
                servers_online: number;
                nodes: number;
                nodes_online: number;
                alerts: number;
                alerts_unack: number;
              }>`
                SELECT
                  (SELECT COUNT(*)::int FROM "Server") AS servers,
                  (SELECT COUNT(*)::int FROM "Server" WHERE status = 'running') AS servers_online,
                  (SELECT COUNT(*)::int FROM "Node") AS nodes,
                  (SELECT COUNT(*)::int FROM "Node" WHERE "isOnline" = true) AS nodes_online,
                  (SELECT COUNT(*)::int FROM "Alert") AS alerts,
                  (SELECT COUNT(*)::int FROM "Alert" WHERE resolved = false) AS alerts_unack
              `
            )[0]
          : null;

      // The ternary above guarantees a row whenever any of the three flags
      // is set, so the ?? 0 fallbacks below are unreachable-defensive only.
      const [serverCount, serversOnline] = isGlobalAdmin
        ? [globalCounts?.servers ?? 0, globalCounts?.servers_online ?? 0]
        : await Promise.all([
            prisma.server.count({ where: serverWhere }),
            prisma.server.count({ where: { ...serverWhere, status: 'running' } }),
          ]);
      const nodeCount = wantNodes ? globalCounts?.nodes ?? 0 : 0;
      const nodesOnline = wantNodes ? globalCounts?.nodes_online ?? 0 : 0;
      const alertCount = wantAlerts ? globalCounts?.alerts ?? 0 : 0;
      const alertsUnacknowledged = wantAlerts ? globalCounts?.alerts_unack ?? 0 : 0;

      const data = {
        servers: serverCount,
        serversOnline,
        nodes: nodeCount,
        nodesOnline,
        alerts: alertCount,
        alertsUnacknowledged,
      };

      const responseStr = JSON.stringify({ data });
      dashboardCache.set(cacheKey, responseStr);

      reply.header('content-type', 'application/json; charset=utf-8');
      return reply.send(responseStr);
    }
  );

  // Get recent activity
  app.get(
    '/activity',
    { preHandler: authenticate },
    async (request: FastifyRequest<{ Querystring: { limit?: string } }>, reply: FastifyReply) => {
      const user = request.user;
      const limit = Math.min(20, parseInt(request.query.limit || '5', 10));
      const perms: string[] = user?.permissions ?? [];
      const isAdmin = perms.includes('*') || perms.some(p => ['admin.read', 'admin.write'].includes(p));

      const activityCacheKey = `${isAdmin ? 'admin' : 'user'}:${user.userId}:${limit}`;
      const cachedActivity = activityCache.get(activityCacheKey);
      if (cachedActivity !== undefined) {
        reply.header('content-type', 'application/json; charset=utf-8');
        return reply.send(cachedActivity);
      }

      // Get recent audit logs as activity
      const auditWhere = isAdmin ? {} : { userId: user.userId };

      const recentLogs = await prisma.auditLog.findMany({
        where: auditWhere,
        take: limit,
        orderBy: { timestamp: 'desc' },
        include: {
          user: { select: { username: true } },
        },
      });

      const activities = recentLogs.map((log) => {
        const timeAgo = getTimeAgo(log.timestamp);

        return {
          id: log.id,
          title: formatAction(log.action),
          detail: log.resourceId
            ? `${log.resource}: ${shortId(log.resourceId)}`
            : formatDetails(log.details) ?? 'System action',
          // `time` stays for API compatibility; clients format `timestamp`
          // themselves so it follows the active interface language.
          time: timeAgo,
          timestamp: log.timestamp,
          type: getResourceType(log.resource),
        };
      });

      const responseStr = JSON.stringify({ data: activities });
      activityCache.set(activityCacheKey, responseStr);
      reply.header('content-type', 'application/json; charset=utf-8');
      return reply.send(responseStr);
    }
  );

  // Get resource utilization (aggregated across nodes)
  app.get(
    '/resources',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user;
      const perms: string[] = user?.permissions ?? [];

      const canReadNodes = perms.includes('*') || perms.includes('node.read');
      const isAdmin = perms.includes('*') || perms.some(p => ['admin.read', 'admin.write'].includes(p));

      if (!canReadNodes && !isAdmin) {
        return reply.send({
          data: {
            cpuUtilization: 0,
            memoryUtilization: 0,
            networkThroughput: 0,
          },
        });
      }

      if (resourcesCache && Date.now() - resourcesCache.timestamp < RESOURCES_CACHE_TTL) {
        return reply.send({ data: resourcesCache.data });
      }

      // Get nodes with their latest resource usage metrics.
      const nodes = await prisma.node.findMany({
        where: { isOnline: true },
        select: {
          maxCpuCores: true,
          maxMemoryMb: true,
          metrics: {
            select: {
              cpuPercent: true,
              memoryUsageMb: true,
              memoryTotalMb: true,
              networkRxBytes: true,
              networkTxBytes: true,
              timestamp: true,
            },
            orderBy: { timestamp: 'desc' },
            take: 2,
          },
        },
      });

      // Calculate aggregate utilization
      let totalCpuUsed = 0;
      let totalCpuLimit = 0;
      let totalMemoryUsed = 0;
      let totalMemoryLimit = 0;
      // Sum of per-node RX+TX rates (MB/s) derived from the last two
      // cumulative counters per node. Nodes with <2 samples contribute 0
      // (unknown, not idle); counter resets clamp at 0.
      let networkThroughput = 0;

      for (const node of nodes) {
        const latestMetrics = node.metrics[0];

        const cpuLimitCores = node.maxCpuCores ?? 0;
        const cpuPercent = latestMetrics?.cpuPercent ?? 0;

        totalCpuUsed += (cpuPercent / 100) * cpuLimitCores;
        totalCpuLimit += cpuLimitCores;

        const memoryLimitMb = latestMetrics?.memoryTotalMb ?? node.maxMemoryMb ?? 0;
        const memoryUsedMb = latestMetrics?.memoryUsageMb ?? 0;

        totalMemoryUsed += memoryUsedMb;
        totalMemoryLimit += memoryLimitMb;

        const newest = node.metrics[0];
        const older = node.metrics[1];
        if (newest && older) {
          const elapsedSec = Math.max(1, (newest.timestamp.getTime() - older.timestamp.getTime()) / 1000);
          const rxDelta = Number(newest.networkRxBytes - older.networkRxBytes) / elapsedSec / (1024 * 1024);
          const txDelta = Number(newest.networkTxBytes - older.networkTxBytes) / elapsedSec / (1024 * 1024);
          if (Number.isFinite(rxDelta) && rxDelta > 0) networkThroughput += rxDelta;
          if (Number.isFinite(txDelta) && txDelta > 0) networkThroughput += txDelta;
        }
      }

      const cpuUtilization = totalCpuLimit > 0 ? clampPercent((totalCpuUsed / totalCpuLimit) * 100) : 0;
      const memoryUtilization = totalMemoryLimit > 0 ? clampPercent((totalMemoryUsed / totalMemoryLimit) * 100) : 0;
      networkThroughput = Math.round(networkThroughput * 100) / 100;

      const payload = {
        cpuUtilization,
        memoryUtilization,
        networkThroughput,
      };
      resourcesCache = { data: payload, timestamp: Date.now() };

      return reply.send({ data: payload });
    }
  );
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function shortId(id: string): string {
  const prefix = id.length > 8 ? `${id.slice(0, 8)}...` : id;
  return prefix;
}

function formatDetails(details: unknown): string | null {
  if (details === null || details === undefined) return null;
  if (typeof details === 'string') return details;
  if (typeof details === 'number' || typeof details === 'boolean') return String(details);
  try {
    const json = JSON.stringify(details);
    return json.length > 120 ? `${json.slice(0, 117)}...` : json;
  } catch {
    return String(details);
  }
}

function getTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function formatAction(action: string): string {
  const actionMap: Record<string, string> = {
    'server.start': 'Server started',
    'server.stop': 'Server stopped',
    'server.create': 'Server created',
    'server.delete': 'Server deleted',
    'backup.create': 'Backup created',
    'backup.restore': 'Backup restored',
    'user.login': 'User logged in',
    'user.create': 'User created',
    'node.connect': 'Node connected',
    'node.disconnect': 'Node disconnected',
  };

  if (actionMap[action]) return actionMap[action];

  // Default: accept either `foo.bar` or `foo_bar`.
  return action
    .split(/[._]/g)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function getResourceType(resourceType: string | null): 'server' | 'backup' | 'node' | 'alert' | 'user' {
  if (!resourceType) return 'server';

  const normalized = resourceType.toLowerCase();

  const typeMap: Record<string, 'server' | 'backup' | 'node' | 'alert' | 'user'> = {
    server: 'server',
    backup: 'backup',
    node: 'node',
    alert: 'alert',
    user: 'user',
    role: 'user',
  };

  return typeMap[normalized] || 'server';
}
