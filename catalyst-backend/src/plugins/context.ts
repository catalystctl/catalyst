import type { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { FastifyRequest, FastifyReply, RouteOptions } from 'fastify';
import type { WebSocketGateway } from '../websocket/gateway';
import type {
  PluginManifest,
  PluginBackendContext,
  PluginMiddlewareHandler,
  PluginWebSocketHandler,
  PluginTaskHandler,
  PluginEventHandler,
} from './types';
import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import EventEmitter from 'events';

/**
 * Creates plugin context for backend plugins
 */
export function createPluginContext(
  manifest: PluginManifest,
  prisma: PrismaClient,
  logger: Logger,
  wsGateway: WebSocketGateway,
  routes: RouteOptions[],
  middlewares: PluginMiddlewareHandler[],
  wsHandlers: Map<string, PluginWebSocketHandler>,
  tasks: Map<string, { cron: string; handler: PluginTaskHandler; job?: ScheduledTask }>,
  eventHandlers: Map<string, Set<PluginEventHandler>>,
  eventEmitter: EventEmitter
): PluginBackendContext {
  const pluginLogger = logger.child({ plugin: manifest.name });
  
  const context: PluginBackendContext = {
    manifest,
    db: prisma,
    logger: pluginLogger,
    wsGateway,
    
    registerRoute(options: RouteOptions) {
      // Prefix route path with plugin namespace
      const prefixedPath = `/api/plugins/${manifest.name}${options.url}`;
      routes.push({
        ...options,
        url: prefixedPath,
      });
      pluginLogger.info({ route: prefixedPath, method: options.method }, 'Registered route');
    },
    
    registerMiddleware(handler: PluginMiddlewareHandler) {
      middlewares.push(handler);
      pluginLogger.info('Registered middleware');
    },
    
    onWebSocketMessage(type: string, handler: PluginWebSocketHandler) {
      wsHandlers.set(type, handler);
      pluginLogger.info({ type }, 'Registered WebSocket handler');
    },
    
    sendWebSocketMessage(target: string, message: any) {
      // Try to send to specific client ID
      const client = (wsGateway as any).clients?.get?.(target);
      if (client) {
        try {
          client.socket.send(JSON.stringify(message));
        } catch (error: any) {
          pluginLogger.error({ error: error.message, target }, 'Failed to send WebSocket message');
        }
      } else {
        pluginLogger.warn({ target }, 'WebSocket client not found');
      }
    },
    
    scheduleTask(cronExpression: string, handler: PluginTaskHandler) {
      const taskId = `${manifest.name}:${cronExpression}`;
      
      // Validate cron expression
      if (!cron.validate(cronExpression)) {
        throw new Error(`Invalid cron expression: ${cronExpression}`);
      }
      
      const job = cron.schedule(cronExpression, async () => {
        try {
          await handler();
        } catch (error: any) {
          pluginLogger.error({ error: error.message }, 'Task execution failed');
        }
      });
      
      tasks.set(taskId, { cron: cronExpression, handler, job });
      pluginLogger.info({ cron: cronExpression }, 'Scheduled task');
    },
    
    on(event: string, handler: PluginEventHandler) {
      if (!eventHandlers.has(event)) {
        eventHandlers.set(event, new Set());
      }
      eventHandlers.get(event)!.add(handler);
      
      // Register with event emitter
      eventEmitter.on(event, handler);
      pluginLogger.info({ event }, 'Registered event handler');
    },
    
    emit(event: string, data: any) {
      eventEmitter.emit(event, data);
      pluginLogger.debug({ event }, 'Emitted event');
    },
    
    getConfig<T = any>(key: string): T | undefined {
      return manifest.config?.[key] as T | undefined;
    },
    
    async setConfig<T = any>(key: string, value: T): Promise<void> {
      // Update plugin config in database
      await prisma.plugin.update({
        where: { name: manifest.name },
        data: {
          config: {
            ...(manifest.config || {}),
            [key]: value,
          },
        },
      });
      
      // Update in-memory config
      if (!manifest.config) {
        manifest.config = {};
      }
      manifest.config[key] = value;
      
      pluginLogger.info({ key }, 'Updated config');
    },
    
    async getStorage<T = any>(key: string): Promise<T | null> {
      const storage = await prisma.pluginStorage.findUnique({
        where: {
          pluginName_key: {
            pluginName: manifest.name,
            key,
          },
        },
      });
      
      return storage ? (storage.value as T) : null;
    },
    
    async setStorage<T = any>(key: string, value: T): Promise<void> {
      await prisma.pluginStorage.upsert({
        where: {
          pluginName_key: {
            pluginName: manifest.name,
            key,
          },
        },
        create: {
          pluginName: manifest.name,
          key,
          value: value as any,
        },
        update: {
          value: value as any,
        },
      });
      
      pluginLogger.debug({ key }, 'Updated storage');
    },
    
    async deleteStorage(key: string): Promise<void> {
      await prisma.pluginStorage.deleteMany({
        where: {
          pluginName: manifest.name,
          key,
        },
      });
      
      pluginLogger.debug({ key }, 'Deleted storage');
    },
  };
  
  return context;
}
