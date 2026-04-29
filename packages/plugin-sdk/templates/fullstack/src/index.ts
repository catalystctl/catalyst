import { defineRoutes } from '@catalyst/plugin-sdk';

export default {
  async onLoad(context) {
    context.logger.info('{{PluginName}} loaded');

    const routes = defineRoutes((router) => {
      router.get('/stats', async (request, reply) => {
        return {
          success: true,
          data: { requests: 0 },
        };
      });
    });

    for (const route of routes) {
      context.registerRoute(route);
    }
  },

  async onEnable(context) {
    context.logger.info('{{PluginName}} enabled');
  },

  async onDisable(context) {
    context.logger.info('{{PluginName}} disabled');
  },

  async onUnload(context) {
    context.logger.info('{{PluginName}} unloaded');
  },
};
