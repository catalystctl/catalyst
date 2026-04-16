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
 * Scoped database wrapper that limits plugin access to safe operations only.
 * Plugins should only access what they declare in their manifest permissions.
 */
class ScopedPluginDBClient {
  private prisma: PrismaClient;
  private pluginName: string;
  private logger: Logger;
  private allowedTables: Set<string>;
  
  constructor(prisma: PrismaClient, pluginName: string, logger: Logger, allowedTables: string[] = []) {
    this.prisma = prisma;
    this.pluginName = pluginName;
    this.logger = logger;
    this.allowedTables = new Set(allowedTables);
  }
  
  // Server operations - READ ONLY, no credentials or sensitive data
  get servers() {
    if (!this.allowedTables.has('servers')) {
      this.logger.warn({ plugin: this.pluginName }, 'Plugin attempted to access servers without permission');
      throw new Error('Permission denied: servers access not declared in manifest');
    }
    this.logger.debug({ plugin: this.pluginName }, 'Plugin accessed servers (read)');
    return {
      findMany: async (args?: any) => this.prisma.server.findMany({
        ...args,
        select: {
          id: true,
          name: true,
          type: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          // Exclude: ownerId, config, ip, port
        },
        ...(args?.where ? { where: args.where } : {}),
        ...(args?.take ? { take: args.take } : {}),
        ...(args?.skip ? { skip: args.skip } : {}),
        ...(args?.orderBy ? { orderBy: args.orderBy } : {}),
      }),
      findUnique: async (args: any) => {
        const result = await this.prisma.server.findUnique({
          ...args,
          select: {
            id: true,
            name: true,
            type: true,
            status: true,
            createdAt: true,
            updatedAt: true,
          },
        });
        return result;
      },
      count: async (args?: any) => this.prisma.server.count(args),
    };
  }
  
  // User operations - VERY LIMITED, basic info only, NO credentials or API keys
  get users() {
    if (!this.allowedTables.has('users')) {
      this.logger.warn({ plugin: this.pluginName }, 'Plugin attempted to access users without permission');
      throw new Error('Permission denied: users access not declared in manifest');
    }
    this.logger.debug({ plugin: this.pluginName }, 'Plugin accessed users (read, limited)');
    return {
      findMany: async (args?: any) => this.prisma.user.findMany({
        ...args,
        select: {
          id: true,
          username: true,
          email: true,
          roleIds: true,
          createdAt: true,
          // Exclude: password, apiKeys, mfaSecret, lastLoginAt
        },
      }),
      findUnique: async (args: any) => {
        const result = await this.prisma.user.findUnique({
          ...args,
          select: {
            id: true,
            username: true,
            email: true,
            roleIds: true,
            createdAt: true,
          },
        });
        return result;
      },
      count: async (args?: any) => this.prisma.user.count(args),
    };
  }
  
  // BLOCKED: credentials, apiKeys, auditLogs - never accessible to plugins
  get credentials() {
    this.logger.error({ plugin: this.pluginName }, 'Plugin attempted to access credentials - BLOCKED');
    throw new Error('Access to credentials is prohibited for security reasons');
  }
  
  get apiKeys() {
    this.logger.error({ plugin: this.pluginName }, 'Plugin attempted to access apiKeys - BLOCKED');
    throw new Error('Access to API keys is prohibited for security reasons');
  }
  
  get auditLogs() {
    this.logger.error({ plugin: this.pluginName }, 'Plugin attempted to access auditLogs - BLOCKED');
    throw new Error('Access to audit logs is prohibited for security reasons');
  }
  
  // Plugin-scoped data only - plugins can always access their own storage
  get pluginStorage() {
    this.logger.debug({ plugin: this.pluginName }, 'Plugin accessed pluginStorage');
    return {
      findUnique: async (args: any) => this.prisma.pluginStorage.findUnique({
        ...args,
        where: {
          ...args.where,
          pluginName: this.pluginName, // Force plugin-scoped access
        },
      }),
      upsert: async (args: any) => this.prisma.pluginStorage.upsert({
        ...args,
        create: { ...args.create, pluginName: this.pluginName },
        update: args.update,
        where: { ...args.where, pluginName: this.pluginName },
      }),
      deleteMany: async (args: any) => this.prisma.pluginStorage.deleteMany({
        ...args,
        where: { ...args.where, pluginName: this.pluginName },
      }),
      findMany: async (args?: any) => this.prisma.pluginStorage.findMany({
        ...args,
        where: { ...args?.where, pluginName: this.pluginName },
      }),
    };
  }
  
  // Plugin config - read-only, write requires explicit method
  get plugin() {
    return {
      findUnique: async (args: any) => this.prisma.plugin.findUnique(args),
      update: async (args: any) => {
        this.logger.warn({ plugin: this.pluginName }, 'Plugin attempted to modify plugin config directly - BLOCKED. Use context.setConfig() instead');
        throw new Error('Direct plugin config modification is prohibited. Use context.setConfig() method.');
      },
    };
  }
  
  // Block all other tables
  get node() {
    this.logger.error({ plugin: this.pluginName }, 'Plugin attempted to access node - BLOCKED');
    throw new Error('Access to nodes is prohibited');
  }
  
  get role() {
    this.logger.error({ plugin: this.pluginName }, 'Plugin attempted to access role - BLOCKED');
    throw new Error('Access to roles is prohibited');
  }
  
  get session() {
    this.logger.error({ plugin: this.pluginName }, 'Plugin attempted to access session - BLOCKED');
    throw new Error('Access to sessions is prohibited');
  }
  
  get invite() {
    this.logger.error({ plugin: this.pluginName }, 'Plugin attempted to access invite - BLOCKED');
    throw new Error('Access to invites is prohibited');
  }
  
  // Catch-all for any other tables
  get $() {
    return new Proxy({}, {
      get: () => {
        this.logger.error({ plugin: this.pluginName }, 'Plugin attempted to access undeclared table - BLOCKED');
        throw new Error('Access to this resource is not allowed. Declare required permissions in your manifest.');
      }
    });
  }
}

// Permission to table mapping
const PERMISSION_TO_TABLES: Record<string, string[]> = {
  'server.read': ['servers'],
  'server.write': [], // Write operations on servers should require explicit consent
  'user.read': ['users'],
  'user.write': [], // User modification should be highly restricted
};

function getAllowedTablesForPermissions(permissions: string[]): string[] {
  const allowed: string[] = [];
  for (const perm of permissions) {
    if (perm === '*') {
      // Wildcard permission grants all basic read access (but still blocks sensitive tables)
      allowed.push('servers', 'users');
      continue;
    }
    const tables = PERMISSION_TO_TABLES[perm];
    if (tables) {
      allowed.push(...tables);
    }
  }
  return [...new Set(allowed)];
}

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
  eventEmitter: EventEmitter,
  authenticate?: Function
): PluginBackendContext {
  const pluginLogger = logger.child({ plugin: manifest.name });
  
  // Create scoped database wrapper based on declared permissions
  const allowedTables = getAllowedTablesForPermissions(manifest.permissions || []);
  const scopedDb = new ScopedPluginDBClient(prisma, manifest.name, pluginLogger, allowedTables);
  
  const context: PluginBackendContext = {
    manifest,
    db: scopedDb as any, // Expose scoped DB wrapper instead of raw Prisma client
    logger: pluginLogger,
    wsGateway,
    
    registerRoute(options: RouteOptions) {
      // Prefix route path with plugin namespace
      const prefixedPath = `/api/plugins/${manifest.name}${options.url}`;
      const routeOptions: RouteOptions = {
        ...options,
        url: prefixedPath,
      };
      // Auto-inject auth middleware if authenticate is available and route doesn't already have it
      if (authenticate && !options.preHandler && !options.onRequest) {
        (routeOptions as any).preHandler = [authenticate];
      }
      routes.push(routeOptions);
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
