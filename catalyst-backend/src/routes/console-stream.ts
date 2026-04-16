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
import { auth } from '../auth.js';
import { fromNodeHeaders } from 'better-auth/node';
import { hasNodeAccess } from '../lib/permissions.js';
import { ErrorCodes } from '../shared-types.js';

interface ConsoleCommandBody {
  command: string;
}

function formatSseMessage(event: string, data: unknown): string {
  const json = typeof data === 'string' ? data : JSON.stringify(data);
  return `event: ${event}\ndata: ${json.replace(/\n/g, '\\n')}\n\n`;
}

function formatSseComment(comment: string): string {
  return `: ${comment}\n\n`;
}

export function consoleStreamRoutes(app: FastifyInstance, wsGateway: WebSocketGateway) {
  // ── SSE Stream ─────────────────────────────────────────────────────────────

  app.get<{ Params: { serverId: string } }>(
    '/:serverId/console/stream',
    {
      config: { rateLimit: false }, // SSE streams are long-lived; per-user rate limits are checked via auth
    },
    async (request, reply) => {
      const { serverId } = request.params;

      // Authenticate via session cookie
      let userId: string | null = null;
      try {
        const session = await auth.api.getSession({
          headers: fromNodeHeaders(request.headers as Record<string, string | string[] | undefined>),
        });
        if (!session) {
          reply.status(401).send({ error: 'Unauthorized' });
          return;
        }
        userId = session.user.id;
      } catch {
        reply.status(401).send({ error: 'Unauthorized' });
        return;
      }

      // Check server access
      const server = await prisma.server.findUnique({
        where: { id: serverId },
        include: {
          access: { select: { userId: true } },
        },
      });

      if (!server) {
        reply.status(404).send({ error: 'Server not found' });
        return;
      }

      const allowedUsers = [server.ownerId, ...server.access.map((a) => a.userId)];
      if (!userId || !allowedUsers.includes(userId)) {
        const isAdmin = await hasNodeAccess(prisma, userId, server.nodeId);
        if (!isAdmin) {
          reply.status(403).send({ error: 'Access denied' });
          return;
        }
      }

      // Build SSE response
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no', // Disable nginx buffering for SSE
        'Access-Control-Allow-Origin': request.headers.origin || '*',
        'Access-Control-Allow-Credentials': 'true',
      });

      // Send initial heartbeat to establish connection
      reply.raw.write(formatSseComment('connected'));
      reply.raw.write(formatSseMessage('connected', { serverId, timestamp: new Date().toISOString() }));

      // Register SSE subscriber — pushes events to this HTTP connection
      const unsubscribe = wsGateway.addSseSubscriber(serverId, (event, data) => {
        try {
          reply.raw.write(formatSseMessage(event, data));
        } catch {
          // Connection closed — unsubscribe will be called via 'close' event
        }
      });

      // Keep-alive heartbeat every 25s (below most proxy 30s timeouts)
      const heartbeat = setInterval(() => {
        try {
          reply.raw.write(formatSseComment('heartbeat'));
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
      preHandler: async (request, reply) => {
        // Authenticate
        let userId: string | null = null;
        try {
          const session = await auth.api.getSession({
            headers: fromNodeHeaders(request.headers as Record<string, string | string[] | undefined>),
          });
          if (!session) {
            reply.status(401).send({ error: 'Unauthorized' });
            return;
          }
          userId = session.user.id;
        } catch {
          reply.status(401).send({ error: 'Unauthorized' });
          return;
        }

        // Attach userId to request for downstream use
        (request as any).authUserId = userId;
      },
    },
    async (request, reply) => {
      const { serverId } = request.params;
      const { command } = request.body ?? {};
      const userId = (request as any).authUserId;

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

      const isAdmin = await hasNodeAccess(prisma, userId, server.nodeId);
      const access = server.access.find((a) => a.userId === userId);
      const hasWritePermission =
        access?.permissions?.includes('console.write') ||
        server.ownerId === userId ||
        isAdmin;

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
        reply.status(500).send({ error: err.message || 'Failed to send command' });
      }
    },
  );
}
