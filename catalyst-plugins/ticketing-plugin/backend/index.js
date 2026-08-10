/**
 * Catalyst Ticketing Plugin — Backend v3.0.0
 *
 * Modular rewrite of the legacy 1.4k-line monolith. Fixes:
 * - request.user.userId (host auth shape) instead of request.user.id
 * - SLA nested updates via full $set objects (no broken dotted keys)
 * - onEnable jobs import shared helpers instead of closing over onLoad locals
 * - Config schema objects unwrapped consistently
 * - Routes split into focused modules for maintainability
 */

import { registerRoutes } from './routes.js';
import { registerJobs } from './jobs.js';

const plugin = {
  async onLoad(context) {
    context.logger.info('Ticketing plugin loaded');
    registerRoutes(context);
  },

  async onEnable(context) {
    context.logger.info('Ticketing plugin enabling');
    registerJobs(context);

    // Lightweight subscription hooks (broadcasts go to all clients anyway)
    context.onWebSocketMessage('subscribe', (_msg, client) => {
      context.logger.debug({ clientId: client?.id }, 'Ticketing WS subscribe');
    });
    context.onWebSocketMessage('unsubscribe', (_msg, client) => {
      context.logger.debug({ clientId: client?.id }, 'Ticketing WS unsubscribe');
    });

    context.logger.info('Ticketing plugin enabled');
  },

  async onDisable(context) {
    context.logger.info('Ticketing plugin disabled');
  },

  async onUnload(context) {
    context.logger.info('Ticketing plugin unloaded');
  },
};

export default plugin;
