export default {
  async onLoad(context) {
    context.logger.info('{{PluginName}} loaded');
  },
  async onEnable(context) {
    context.logger.info('{{PluginName}} enabled');
  },
};
