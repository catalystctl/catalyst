/**
 * Example Plugin Backend
 *
 * Demonstrates:
 * - Custom API routes (auto-prefixed to /api/plugins/example-plugin/…)
 * - WebSocket message handlers
 * - Scheduled tasks (cron) registered in onEnable, cleared on disable
 * - Host lifecycle events (server:started / server:stopped)
 * - Config via getConfig (returns resolved values, not schema objects)
 * - Persistent key-value storage
 */

let requestCount = 0;

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

    // Middleware: prefer onResponse timing if available; this is a simple pre-handler demo
    ctx.registerMiddleware(async (request, _reply, next) => {
      const startTime = Date.now();
      // Express-style next — duration here is only setup time, not full response.
      // For real timing, use Fastify onResponse in a future host hook.
      next();
      ctx.logger.debug(
        { path: request.url, setupMs: Date.now() - startTime },
        'Plugin middleware ran',
      );
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
