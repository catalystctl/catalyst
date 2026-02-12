import { prisma } from '../db.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { hasPermission, hasAnyPermission } from '../lib/permissions';

export async function dashboardRoutes(app: FastifyInstance) {
  const authenticate = (app as any).authenticate;

  // Get dashboard statistics
  app.get(
    '/stats',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;

      // Check if user has any relevant permission
      const canReadServers = await hasPermission(prisma, user.userId, 'server.read');
      const canReadNodes = await hasPermission(prisma, user.userId, 'node.read');
      const canReadAlerts = await hasPermission(prisma, user.userId, 'alert.read');
      const isAdmin = await hasAnyPermission(prisma, user.userId, ['admin.read', 'admin.write']);

      // Get server count - for non-admins, only count their own servers
      const serverWhere = isAdmin || canReadServers ? {} : { ownerId: user.userId };

      const [serverCount, serversOnline, nodeCount, nodesOnline, alertCount, alertsUnacknowledged] = await Promise.all([
        prisma.server.count({ where: serverWhere }),
        prisma.server.count({ where: { ...serverWhere, status: 'running' } }),
        // Only show node count to users with node permission
        canReadNodes || isAdmin ? prisma.node.count() : 0,
        canReadNodes || isAdmin ? prisma.node.count({ where: { isOnline: true } }) : 0,
        // Only show alert count to users with alert permission
        canReadAlerts || isAdmin ? prisma.alert.count() : 0,
        // The schema uses `resolved` rather than `acknowledged`.
        canReadAlerts || isAdmin ? prisma.alert.count({ where: { resolved: false } }) : 0,
      ]);

      return reply.send({
        data: {
          servers: serverCount,
          serversOnline,
          nodes: nodeCount,
          nodesOnline,
          alerts: alertCount,
          alertsUnacknowledged,
        },
      });
    }
  );

  // Get recent activity
  app.get(
    '/activity',
    { preHandler: authenticate },
    async (request: FastifyRequest<{ Querystring: { limit?: string } }>, reply: FastifyReply) => {
      const user = (request as any).user;
      const limit = Math.min(20, parseInt(request.query.limit || '5', 10));

      const isAdmin = await hasAnyPermission(prisma, user.userId, ['admin.read', 'admin.write']);

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
          time: timeAgo,
          type: getResourceType(log.resource),
        };
      });

      return reply.send({ data: activities });
    }
  );

  // Get resource utilization (aggregated across nodes)
  app.get(
    '/resources',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;

      const canReadNodes = await hasPermission(prisma, user.userId, 'node.read');
      const isAdmin = await hasAnyPermission(prisma, user.userId, ['admin.read', 'admin.write']);

      if (!canReadNodes && !isAdmin) {
        return reply.send({
          data: {
            cpuUtilization: 0,
            memoryUtilization: 0,
            networkThroughput: 0,
          },
        });
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
              timestamp: true,
            },
            orderBy: { timestamp: 'desc' },
            take: 1,
          },
        },
      });

      // Calculate aggregate utilization
      let totalCpuUsed = 0;
      let totalCpuLimit = 0;
      let totalMemoryUsed = 0;
      let totalMemoryLimit = 0;

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
      }

      const cpuUtilization = totalCpuLimit > 0 ? clampPercent((totalCpuUsed / totalCpuLimit) * 100) : 0;
      const memoryUtilization = totalMemoryLimit > 0 ? clampPercent((totalMemoryUsed / totalMemoryLimit) * 100) : 0;

      // Network throughput would require real-time metrics from agents
      // For now, return a placeholder based on running servers
      const runningServers = await prisma.server.count({ where: { status: 'running' } });
      const networkThroughput = Math.min(100, runningServers * 5); // Placeholder calculation

      return reply.send({
        data: {
          cpuUtilization,
          memoryUtilization,
          networkThroughput,
        },
      });
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
