/**
 * SSE (Server-Sent Events) console streaming endpoint.
 *
 * Architecture:
 *   - GET  /api/servers/:serverId/console/stream  → SSE stream (real-time output)
 *   - POST /api/servers/:serverId/console/command  → Send command (HTTP)
 *
 * Why SSE over WebSocket?
 *   - HTTP/2 native, works through all proxies and load balancers out of the box
 *   - Automatic browser reconnection with EventSource API
 *   - Simpler connection lifecycle — no WebSocket handshake complexity
 *   - Works over HTTP/3 natively
 *   - Easy to debug with curl: curl -N http://localhost:3000/api/servers/xxx/console/stream
 */
import type { FastifyInstance } from 'fastify';
import type { WebSocketGateway } from '../websocket/gateway';
import { prisma } from '../db.js';
import { hasNodeAccess } from '../lib/permissions.js';
import { captureSystemError } from '../services/error-logger.js';
import { describeError } from '../utils/describe-error.js';
import { ErrorCodes } from '../shared-types.js';
import { checkIsAdmin } from './servers/_helpers.js';
import { openSseStream, formatSse as formatSseMessage } from '../utils/sse.js';

interface ConsoleCommandBody {
  command: string;
}

export function consoleStreamRoutes(app: FastifyInstance, wsGateway: WebSocketGateway) {
  // ── SSE Stream ─────────────────────────────────────────────────────────────

  app.get<{ Params: { serverId: string } }>(
    '/:serverId/console/stream',
    {
      onRequest: [(app as any).authenticate],
      config: { rateLimit: false }, // SSE streams are long-lived; per-user rate limits are checked via auth
    },
    async (request, reply) => {
      const { serverId } = request.params;
      const userId = request.user?.userId;

      if (!userId) {
        reply.status(401).send({ error: 'Unauthorized' });
        return;
      }

      // Check server access with proper permission checks
      const server = await prisma.server.findUnique({
        where: { id: serverId },
        include: {
          access: { select: { userId: true, permissions: true } },
        },
      });

      if (!server) {
        reply.status(404).send({ error: 'Server not found' });
        return;
      }

      const access = server.access.find((a) => a.userId === userId);
      const hasConsoleRead = access?.permissions?.includes('console.read');
      const isOwner = server.ownerId === userId;
      const isAdmin = checkIsAdmin(request, 'admin.read');
      // Server-scoped resolution: global roles + RoleServerGrant +
      // RoleNodeGrant rows covering this server (mirrors
      // getEffectiveServerPermissions / decideServerAccess).
      const { resolveServerPermissions } = await import('../lib/permissions-catalog.js');
      const rolePerms = await resolveServerPermissions(userId, serverId, server.nodeId);
      const hasRoleConsoleRead = rolePerms.includes('console.read');
      const hasNodeAccessResult = await hasNodeAccess(prisma, userId, server.nodeId);

      if (!isOwner && !hasConsoleRead && !isAdmin && !hasNodeAccessResult && !hasRoleConsoleRead) {
        reply.status(403).send({ error: 'Access denied' });
        return;
      }

      // Cap check before hijacking so we can still send a JSON 503.
      const MAX_SSE_CONSOLE_PER_SERVER = 50;
      if (wsGateway.getSseSubscriberCount(serverId) >= MAX_SSE_CONSOLE_PER_SERVER) {
        reply.status(503).send({ error: 'Too many console viewers. Please try again later.' });
        return;
      }

      const sse = openSseStream(request, reply);
      sse.comment('connected');
      sse.push('connected', { serverId, timestamp: new Date().toISOString() });

      // Register SSE subscriber — pushes events to this HTTP connection
      const { unsubscribe, touch } = wsGateway.addSseSubscriber(serverId, (event, data) => {
        // data may already be a JSON string from the gateway
        sse.write(formatSseMessage(event, data));
      });

      // Keep-alive heartbeat every 25s (below most proxy 30s timeouts)
      const heartbeat = setInterval(() => {
        try {
          sse.comment('heartbeat');
          // Touch the subscriber so the backend sweep knows this connection is
          // still alive even when the agent is offline and no console data is
          // flowing. Without this, subscribers are deleted after 5 min of agent
          // downtime, creating a zombie SSE connection that receives heartbeats
          // but no actual console output.
          touch();
        } catch {
          // Connection already dead
          clearInterval(heartbeat);
        }
      }, 25_000);

      // Clean up when client disconnects (browser close, tab switch, network loss)
      request.raw.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
      });

      // Don't close the Fastify reply — let it stream until the client disconnects.
      // Returning here would close the response prematurely.
    },
  );

  // ── Command Input ──────────────────────────────────────────────────────────

  app.post<{ Params: { serverId: string }; Body: ConsoleCommandBody }>(
    '/:serverId/console/command',
    {
      onRequest: [(app as any).authenticate],
    },
    async (request, reply) => {
      const { serverId } = request.params;
      const { command } = request.body ?? {};
      const userId = request.user?.userId;

      if (!command || typeof command !== 'string' || !command.trim()) {
        reply.status(400).send({ error: 'Command is required' });
        return;
      }

      const trimmed = command.trim();
      if (trimmed.length > 4096) {
        reply.status(400).send({ error: 'Command exceeds maximum length (4096 characters)' });
        return;
      }

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        include: {
          access: { select: { userId: true, permissions: true } },
        },
      });

      if (!server) {
        reply.status(404).send({ error: 'Server not found' });
        return;
      }

      const hasNodeAccessResult = await hasNodeAccess(prisma, userId, server.nodeId);
      const isAdmin = checkIsAdmin(request, 'admin.read');
      const access = server.access.find((a) => a.userId === userId);
      // Server-scoped resolution: global roles + RoleServerGrant +
      // RoleNodeGrant rows covering this server.
      const { resolveServerPermissions } = await import('../lib/permissions-catalog.js');
      const rolePerms = await resolveServerPermissions(userId, serverId, server.nodeId);
      const hasRoleConsoleWrite = rolePerms.includes('console.write');
      const hasWritePermission =
        access?.permissions?.includes('console.write') ||
        server.ownerId === userId ||
        isAdmin ||
        hasNodeAccessResult ||
        hasRoleConsoleWrite;

      if (!hasWritePermission) {
        reply.status(403).send({ error: ErrorCodes.PERMISSION_DENIED });
        return;
      }

      if (server.suspendedAt) {
        reply.status(403).send({ error: 'Server is suspended' });
        return;
      }

      // Forward the command to the agent via the WebSocket gateway
      // The gateway handles rate limiting, authentication, and routing to the agent
      const payload = trimmed.endsWith('\n') ? trimmed : `${trimmed}\n`;

      try {
        await wsGateway.sendConsoleCommand(serverId, userId, payload);
        return reply.status(202).send({ success: true, timestamp: new Date().toISOString() });
      } catch (err: any) {
        app.log.error({ err, serverId, userId }, 'Failed to send console command via SSE route');
        captureSystemError({
          level: 'error',
          component: 'ConsoleStream',
          message: describeError(err) || 'Failed to send console command via SSE route',
          stack: err.stack,
          metadata: { serverId, userId },
        }).catch(() => {});
        reply.status(500).send({ error: describeError(err) || 'Failed to send command' });
      }
    },
  );
}
