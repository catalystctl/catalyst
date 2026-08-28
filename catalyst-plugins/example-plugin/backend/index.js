/**
 * Example Plugin Backend
 *
 * Demonstrates:
 * - Custom API routes (auto-prefixed to /api/plugins/example-plugin/…)
 * - Capability-gated routes: requirePermission() checks the REQUESTING USER,
 *   while the scoped db only honors the plugin's own granted permissions
 * - Scoped database reads and whitelisted writes (server status only)
 * - WebSocket message handlers
 * - Scheduled tasks (cron) registered in onEnable, cleared on disable
 * - Host lifecycle events (server:started / server:stopped)
 * - Fastify-style middleware
 * - Config via getConfig (returns resolved values, not schema objects)
 * - Persistent key-value storage
 */

let requestCount = 0;

const ALLOWED_STATUS_VALUES = new Set(['running', 'suspended']);

const plugin = {
  async onLoad(ctx) {
    ctx.logger.info('Example plugin loaded');

    const initialized = await ctx.getStorage('initialized');
    if (!initialized) {
      await ctx.setStorage('initialized', true);
      await ctx.setStorage('installDate', new Date().toISOString());
      ctx.logger.info('Plugin initialized for the first time');
    }

    // Routes must be registered in onLoad (before Fastify listen)
    ctx.registerRoute({
      method: 'GET',
      url: '/hello',
      handler: async () => {
        requestCount++;
        // getConfig returns the resolved default/value — not the schema object
        const greeting = ctx.getConfig('greeting') || 'Hello!';
        return {
          success: true,
          message: greeting,
          requestCount,
          timestamp: new Date().toISOString(),
        };
      },
    });

    // Scoped DB read — requires the plugin to hold a granted `server.read`
    // permission, and only returns whitelisted fields.
    ctx.registerRoute({
      method: 'GET',
      url: '/servers',
      preHandler: ctx.requirePermission?.('server.read'),
      handler: async () => {
        const servers = await ctx.db.servers.findMany({
          select: { id: true, name: true, status: true },
          orderBy: { name: 'asc' },
          take: 25,
        });
        return { success: true, count: servers.length, servers };
      },
    });

    // Scoped DB write — `server.write` may ONLY change the whitelisted
    // `status` field. Revoking that grant takes effect immediately, even on
    // already-mounted routes.
    ctx.registerRoute({
      method: 'POST',
      url: '/servers/:id/status',
      preHandler: ctx.requirePermission?.('server.write'),
      handler: async (request, reply) => {
        const { id } = request.params;
        const status = request.body?.status;
        if (!ALLOWED_STATUS_VALUES.has(status)) {
          return reply.status(400).send({
            success: false,
            error: "status must be one of: running, suspended",
          });
        }
        try {
          const server = await ctx.db.servers.update(id, { status });
          return { success: true, server };
        } catch (error) {
          return reply.status(403).send({ success: false, error: error.message });
        }
      },
    });

    ctx.registerRoute({
      method: 'POST',
      url: '/echo',
      handler: async (request) => {
        const body = request.body;
        ctx.logger.info({ body }, 'Echo request received');
        return {
          success: true,
          echoed: body,
          userId: ctx.getUserId?.(request) ?? null,
          timestamp: new Date().toISOString(),
        };
      },
    });

    ctx.registerRoute({
      method: 'GET',
      url: '/stats',
      handler: async () => {
        const installDate = await ctx.getStorage('installDate');
        const lastTaskRun = await ctx.getStorage('lastTaskRun');
        const taskRunCount = (await ctx.getStorage('taskRunCount')) || 0;
        return {
          success: true,
          stats: {
            requestCount,
            installDate,
            lastTaskRun,
            taskRunCount,
            uptime: process.uptime(),
          },
        };
      },
    });
  },

  async onEnable(ctx) {
    ctx.logger.info('Example plugin enabled');

    // WS types are auto-prefixed to plugin:example-plugin:<type> by the host
    ctx.onWebSocketMessage('plugin_example_ping', async (data, clientId) => {
      ctx.logger.info({ data, clientId }, 'Received ping from client');
      if (clientId) {
        ctx.sendWebSocketMessage(clientId, {
          type: 'plugin_example_pong',
          timestamp: new Date().toISOString(),
          originalData: data,
        });
      }
    });

    // cronEnabled is a resolved boolean (not a schema object)
    const cronEnabled = ctx.getConfig('cronEnabled');
    if (cronEnabled !== false) {
      ctx.scheduleTask('*/5 * * * *', async () => {
        ctx.logger.info('Example plugin scheduled task executed');
        const taskRunCount = (await ctx.getStorage('taskRunCount')) || 0;
        await ctx.setStorage('taskRunCount', taskRunCount + 1);
        await ctx.setStorage('lastTaskRun', new Date().toISOString());
        ctx.emit('example-plugin:task-completed', {
          count: taskRunCount + 1,
          timestamp: new Date().toISOString(),
        });
      });
    }

    // Host power routes emit these (see catalyst-backend plugins/host-events)
    ctx.on('server:started', async (data) => {
      ctx.logger.info({ serverId: data.serverId, status: data.status }, 'Server started event');
      const webhookUrl = ctx.getConfig('webhookUrl');
      if (webhookUrl) {
        ctx.logger.info({ webhookUrl, serverId: data.serverId }, 'Would send webhook');
      }
    });

    ctx.on('server:stopped', async (data) => {
      ctx.logger.info({ serverId: data.serverId, status: data.status }, 'Server stopped event');
    });

    // Middleware: Fastify-style hook signature (request, reply, done).
    // Errors: call done(error) — replies already sent short-circuit the chain.
    ctx.registerMiddleware(async (request, reply, done) => {
      const startTime = Date.now();
      reply.raw.on('finish', () => {
        ctx.logger.debug(
          { path: request.url, method: request.method, durationMs: Date.now() - startTime },
          'Plugin middleware observed request',
        );
      });
      done();
    });
  },

  async onDisable(ctx) {
    ctx.logger.info('Example plugin disabled');
    // Host stops + clears scheduled tasks automatically
  },

  async onUnload(ctx) {
    ctx.logger.info('Example plugin unloaded');
  },
};

export default plugin;
