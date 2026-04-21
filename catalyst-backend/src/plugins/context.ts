import type { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { FastifyRequest, FastifyReply, RouteOptions } from 'fastify';
import type { WebSocketGateway } from '../websocket/gateway';
import type {
  PluginManifest,
  PluginBackendContext,
  PluginMiddlewareEntry,
  PluginWebSocketHandler,
  PluginTaskHandler,
  PluginEventHandler,
  PluginCollectionAPI,
  PluginCollectionOptions,
  PluginEventSchema,
  ScopedPluginDB,
} from './types';
import type { PluginRegistry } from './registry';
import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import EventEmitter from 'events';

// ── Simple unique ID generator ──────────────────────────────────────────────
function generateId(): string {
  const timestamp = Date.now().toString(36);
  const counter = ((Math.random() * 1679616) | 0).toString(36).padStart(4, '0');
  const random = Math.random().toString(36).substring(2, 10);
  return `${timestamp}${counter}${random}`;
}

// ── Filter matching engine for collection queries ───────────────────────────
function matchFilter(doc: any, filter: any): boolean {
  if (!filter || typeof filter !== 'object') return true;

  for (const [key, value] of Object.entries(filter)) {
    if (key === '$or') {
      if (!Array.isArray(value) || !(value as any[]).some((sub) => matchFilter(doc, sub)))
        return false;
    } else if (key === '$and') {
      if (!Array.isArray(value) || !(value as any[]).every((sub) => matchFilter(doc, sub)))
        return false;
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      // Comparison operators
      const op = value as Record<string, any>;
      const docValue = doc[key];
      if (op.$eq !== undefined && docValue !== op.$eq) return false;
      if (op.$ne !== undefined && docValue === op.$ne) return false;
      if (op.$gt !== undefined && !(docValue > op.$gt)) return false;
      if (op.$gte !== undefined && !(docValue >= op.$gte)) return false;
      if (op.$lt !== undefined && !(docValue < op.$lt)) return false;
      if (op.$lte !== undefined && !(docValue <= op.$lte)) return false;
      if (op.$in !== undefined && !Array.isArray(op.$in)) return false;
      if (op.$in !== undefined && !(op.$in as any[]).includes(docValue)) return false;
      if (op.$nin !== undefined && !Array.isArray(op.$nin)) return false;
      if (op.$nin !== undefined && (op.$nin as any[]).includes(docValue)) return false;
      if (op.$exists !== undefined) {
        const exists = docValue !== undefined && docValue !== null;
        if (op.$exists !== exists) return false;
      }
      if (op.$regex !== undefined) {
        const regex = typeof op.$regex === 'string' ? new RegExp(op.$regex, op.$flags || '') : op.$regex;
        if (!regex.test(String(docValue ?? ''))) return false;
      }
    } else {
      // Equality check
      if (doc[key] !== value) return false;
    }
  }

  return true;
}

// ── Field whitelist for write operations ────────────────────────────────────
const SERVER_WRITE_WHITELIST = new Set(['status']);
const USER_WRITE_WHITELIST = new Set(['roleIds']);

/**
 * Scoped database wrapper that limits plugin access to safe operations only.
 * Plugins should only access what they declare in their manifest permissions.
 */
class ScopedPluginDBClient implements ScopedPluginDB {
  private prisma: PrismaClient;
  private pluginName: string;
  private logger: Logger;
  private allowedTables: Set<string>;
  private permissions: Set<string>;

  constructor(
    prisma: PrismaClient,
    pluginName: string,
    logger: Logger,
    allowedTables: string[],
    permissions: string[],
  ) {
    this.prisma = prisma;
    this.pluginName = pluginName;
    this.logger = logger;
    this.allowedTables = new Set(allowedTables);
    this.permissions = new Set(permissions);
  }

  // Server operations - READ ONLY by default, write with field whitelist
  get servers() {
    if (!this.allowedTables.has('servers')) {
      this.logger.warn({ plugin: this.pluginName }, 'Plugin attempted to access servers without permission');
      throw new Error('Permission denied: servers access not declared in manifest');
    }
    this.logger.debug({ plugin: this.pluginName }, 'Plugin accessed servers (read)');
    const prisma = this.prisma;
    const permissions = this.permissions;
    const pluginName = this.pluginName;
    const logger = this.logger;
    return {
      findMany: async (args?: any) =>
        prisma.server.findMany({
          ...args,
          select: {
            id: true,
            name: true,
            uuid: true,
            description: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            ...(args?.select || {}),
          },
          ...(args?.where ? { where: args.where } : {}),
          ...(args?.take ? { take: args.take } : {}),
          ...(args?.skip ? { skip: args.skip } : {}),
          ...(args?.orderBy ? { orderBy: args.orderBy } : {}),
        }),
      findUnique: async (args: any) => {
        const result = await prisma.server.findUnique({
          ...args,
          select: {
            id: true,
            name: true,
            uuid: true,
            description: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            ...(args?.select || {}),
          },
        });
        return result;
      },
      count: async (args?: any) => prisma.server.count(args),
      update: async (id: string, data: Record<string, any>) => {
        if (!permissions.has('server.write') && !permissions.has('*')) {
          logger.warn({ plugin: pluginName }, 'Plugin attempted server.update without server.write permission');
          throw new Error('Permission denied: server.write permission required for updates');
        }
        const filtered: Record<string, any> = {};
        for (const key of Object.keys(data)) {
          if (SERVER_WRITE_WHITELIST.has(key)) {
            filtered[key] = data[key];
          } else {
            logger.warn(
              { plugin: pluginName, field: key },
              'Plugin attempted to update non-whitelisted server field',
            );
          }
        }
        if (Object.keys(filtered).length === 0) {
          throw new Error('No whitelisted fields in update data. Allowed fields: status');
        }
        logger.info({ plugin: pluginName, serverId: id, fields: Object.keys(filtered) }, 'Plugin updated server');
        return prisma.server.update({ where: { id }, data: filtered });
      },
    };
  }

  // User operations - VERY LIMITED, basic info only, NO credentials or API keys
  get users() {
    if (!this.allowedTables.has('users')) {
      this.logger.warn({ plugin: this.pluginName }, 'Plugin attempted to access users without permission');
      throw new Error('Permission denied: users access not declared in manifest');
    }
    this.logger.debug({ plugin: this.pluginName }, 'Plugin accessed users (read, limited)');
    const prisma = this.prisma;
    const permissions = this.permissions;
    const pluginName = this.pluginName;
    const logger = this.logger;
    return {
      findMany: async (args?: any) =>
        prisma.user.findMany({
          ...args,
          select: {
            id: true,
            username: true,
            email: true,
            name: true,
            image: true,
            banned: true,
            createdAt: true,
            ...(args?.select || {}),
          },
          ...(args?.where ? { where: args.where } : {}),
          ...(args?.take ? { take: args.take } : {}),
          ...(args?.skip ? { skip: args.skip } : {}),
          ...(args?.orderBy ? { orderBy: args.orderBy } : {}),
        }),
      findUnique: async (args: any) => {
        const result = await prisma.user.findUnique({
          ...args,
          select: {
            id: true,
            username: true,
            email: true,
            name: true,
            image: true,
            banned: true,
            createdAt: true,
            ...(args?.select || {}),
          },
        });
        return result;
      },
      count: async (args?: any) => prisma.user.count(args),
      update: async (id: string, data: Record<string, any>) => {
        if (!permissions.has('user.write') && !permissions.has('*')) {
          logger.warn({ plugin: pluginName }, 'Plugin attempted user.update without user.write permission');
          throw new Error('Permission denied: user.write permission required for updates');
        }
        const filtered: Record<string, any> = {};
        for (const key of Object.keys(data)) {
          if (USER_WRITE_WHITELIST.has(key)) {
            filtered[key] = data[key];
          } else {
            logger.warn(
              { plugin: pluginName, field: key },
              'Plugin attempted to update non-whitelisted user field',
            );
          }
        }
        if (Object.keys(filtered).length === 0) {
          throw new Error('No whitelisted fields in update data. Allowed fields: roleIds');
        }
        logger.info({ plugin: pluginName, userId: id, fields: Object.keys(filtered) }, 'Plugin updated user');
        return prisma.user.update({ where: { id }, data: filtered });
      },
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
    const prisma = this.prisma;
    const pluginName = this.pluginName;
    return {
      findUnique: async (args: any) =>
        prisma.pluginStorage.findUnique({
          ...args,
          where: { ...args.where, pluginName },
        }),
      upsert: async (args: any) =>
        prisma.pluginStorage.upsert({
          ...args,
          create: { ...args.create, pluginName },
          update: args.update,
          where: { ...args.where, pluginName },
        }),
      deleteMany: async (args: any) =>
        prisma.pluginStorage.deleteMany({
          ...args,
          where: { ...args.where, pluginName },
        }),
      findMany: async (args?: any) =>
        prisma.pluginStorage.findMany({
          ...args,
          where: { ...args?.where, pluginName },
        }),
    };
  }

  // Plugin config - read-only, write requires explicit method
  get plugin() {
    return {
      findUnique: async (args: any) => this.prisma.plugin.findUnique(args),
      update: async (args: any) => {
        this.logger.warn(
          { plugin: this.pluginName },
          'Plugin attempted to modify plugin config directly - BLOCKED. Use context.setConfig() instead',
        );
        throw new Error(
          'Direct plugin config modification is prohibited. Use context.setConfig() method.',
        );
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
    return new Proxy(
      {},
      {
        get: () => {
          this.logger.error(
            { plugin: this.pluginName },
            'Plugin attempted to access undeclared table - BLOCKED',
          );
          throw new Error(
            'Access to this resource is not allowed. Declare required permissions in your manifest.',
          );
        },
      },
    );
  }

  // Structured collection storage
  collection(name: string): PluginCollectionAPI {
    return new PluginCollectionImpl(name, this.pluginName, this.prisma, this.logger);
  }
}

// ── Collection implementation ────────────────────────────────────────────────
class PluginCollectionImpl implements PluginCollectionAPI {
  private storageKey: string;

  constructor(
    private name: string,
    private pluginName: string,
    private prisma: PrismaClient,
    private logger: Logger,
  ) {
    this.storageKey = `collection:${name}`;
  }

  private async loadDocs(): Promise<any[]> {
    const storage = await this.prisma.pluginStorage.findUnique({
      where: {
        pluginName_key: { pluginName: this.pluginName, key: this.storageKey },
      },
    });
    return storage ? (Array.isArray(storage.value) ? storage.value : []) : [];
  }

  private async saveDocs(docs: any[]): Promise<void> {
    await this.prisma.pluginStorage.upsert({
      where: {
        pluginName_key: { pluginName: this.pluginName, key: this.storageKey },
      },
      create: {
        pluginName: this.pluginName,
        key: this.storageKey,
        value: docs as any,
      },
      update: {
        value: docs as any,
      },
    });
  }

  async find(filter?: any, options?: PluginCollectionOptions): Promise<any[]> {
    let docs = await this.loadDocs();

    if (filter) {
      docs = docs.filter((d) => matchFilter(d, filter));
    }

    if (options?.sort) {
      for (const [sortField, sortOrder] of Object.entries(options.sort)) {
        docs.sort((a, b) => {
          const aVal = a[sortField];
          const bVal = b[sortField];
          if (aVal === null && bVal === null) return 0;
          if (aVal === null) return 1 * sortOrder;
          if (bVal === null) return -1 * sortOrder;
          if (aVal < bVal) return -1 * sortOrder;
          if (aVal > bVal) return 1 * sortOrder;
          return 0;
        });
      }
    }

    if (options?.skip) {
      docs = docs.slice(options.skip);
    }

    if (options?.limit) {
      docs = docs.slice(0, options.limit);
    }

    if (options?.projection) {
      docs = docs.map((d) => {
        const projected: any = { _id: d._id };
        for (const [field, include] of Object.entries(options?.projection ?? {})) {
          if (include && d[field] !== undefined) {
            projected[field] = d[field];
          }
        }
        return projected;
      });
    }

    return docs;
  }

  async findOne(filter: any): Promise<any | null> {
    const docs = await this.loadDocs();
    const match = docs.find((d) => matchFilter(d, filter));
    return match || null;
  }

  async insert(doc: any): Promise<any> {
    const docs = await this.loadDocs();
    const now = new Date().toISOString();
    const newDoc = {
      ...doc,
      _id: generateId(),
      _createdAt: now,
      _updatedAt: now,
    };
    docs.push(newDoc);
    await this.saveDocs(docs);
    this.logger.debug({ plugin: this.pluginName, collection: this.name, _id: newDoc._id }, 'Collection document inserted');
    return newDoc;
  }

  async update(filter: any, updateData: any): Promise<number> {
    const docs = await this.loadDocs();
    let count = 0;

    for (let i = 0; i < docs.length; i++) {
      if (matchFilter(docs[i], filter)) {
        const now = new Date().toISOString();

        // Apply update operators
        if (updateData.$set) {
          Object.assign(docs[i], updateData.$set);
        }
        if (updateData.$unset) {
          for (const key of Object.keys(updateData.$unset)) {
            delete docs[i][key];
          }
        }
        if (updateData.$inc) {
          for (const [key, value] of Object.entries(updateData.$inc)) {
            docs[i][key] = (docs[i][key] || 0) + (value as number);
          }
        }
        if (updateData.$push) {
          for (const [key, value] of Object.entries(updateData.$push)) {
            if (!Array.isArray(docs[i][key])) docs[i][key] = [];
            docs[i][key].push(value);
          }
        }
        if (updateData.$pull) {
          for (const [key, value] of Object.entries(updateData.$pull)) {
            if (Array.isArray(docs[i][key])) {
              if (typeof value === 'object' && value !== null) {
                docs[i][key] = docs[i][key].filter((item: any) => !matchFilter(item, value));
              } else {
                docs[i][key] = docs[i][key].filter((item: any) => item !== value);
              }
            }
          }
        }

        // If no operators, treat entire update as $set
        if (!updateData.$set && !updateData.$unset && !updateData.$inc && !updateData.$push && !updateData.$pull) {
          Object.assign(docs[i], updateData);
        }

        docs[i]._updatedAt = now;
        count++;
      }
    }

    if (count > 0) {
      await this.saveDocs(docs);
      this.logger.debug(
        { plugin: this.pluginName, collection: this.name, count },
        'Collection documents updated',
      );
    }
    return count;
  }

  async delete(filter: any): Promise<number> {
    const docs = await this.loadDocs();
    const filtered = docs.filter((d) => !matchFilter(d, filter));
    const count = docs.length - filtered.length;
    if (count > 0) {
      await this.saveDocs(filtered);
      this.logger.debug(
        { plugin: this.pluginName, collection: this.name, count },
        'Collection documents deleted',
      );
    }
    return count;
  }

  async count(filter?: any): Promise<number> {
    const docs = await this.loadDocs();
    if (filter) return docs.filter((d) => matchFilter(d, filter)).length;
    return docs.length;
  }
}

// Permission to table mapping
const PERMISSION_TO_TABLES: Record<string, string[]> = {
  'server.read': ['servers'],
  'server.write': [], // Write ops require explicit field whitelisting, not table-level access
  'user.read': ['users'],
  'user.write': [], // Write ops require explicit field whitelisting, not table-level access
  'admin.read': [], // Admin read is for admin routes, not direct DB access
  'admin.write': [], // Admin write is for admin routes, not direct DB access
};

function getAllowedTablesForPermissions(permissions: string[]): string[] {
  const allowed: string[] = [];
  for (const perm of permissions) {
    if (perm === '*') {
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
 * Creates plugin context for backend plugins.
 *
 * @param registry - PluginRegistry for RPC storage (must be passed for exposeApi/callPluginApi)
 */
export function createPluginContext(
  manifest: PluginManifest,
  originalConfig: Record<string, any> | undefined,
  prisma: PrismaClient,
  logger: Logger,
  wsGateway: WebSocketGateway,
  routes: RouteOptions[],
  middlewares: PluginMiddlewareEntry[],
  wsHandlers: Map<string, PluginWebSocketHandler>,
  tasks: Map<string, { cron: string; handler: PluginTaskHandler; job?: ScheduledTask }>,
  eventHandlers: Map<string, Set<PluginEventHandler>>,
  eventEmitter: EventEmitter,
  authenticate?: Function,
  registry?: PluginRegistry,
): PluginBackendContext {
  const pluginLogger = logger.child({ plugin: manifest.name });

  // Create scoped database wrapper based on declared permissions
  const allowedTables = getAllowedTablesForPermissions(manifest.permissions || []);
  const scopedDb = new ScopedPluginDBClient(
    prisma,
    manifest.name,
    pluginLogger,
    allowedTables,
    manifest.permissions || [],
  );

  const context: PluginBackendContext = {
    manifest,
    originalConfig,
    db: scopedDb,
    logger: pluginLogger,
    wsGateway,

    registerRoute(options: RouteOptions) {
      // Prefix route path with plugin namespace
      const prefixedPath = `/api/plugins/${manifest.name}/${options.url.replace(/^\//, '')}`;
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

    registerMiddleware(handler: any, options?: { scope?: 'global' | 'route' }) {
      const scope = options?.scope || 'global';
      middlewares.push({ handler, scope });
      pluginLogger.info({ scope }, 'Registered middleware');
    },

    onWebSocketMessage(type: string, handler: PluginWebSocketHandler) {
      // Store locally for backward compat
      wsHandlers.set(type, handler);
      // Also register with gateway using prefixed type for dispatch
      const prefixedType = `plugin:${manifest.name}:${type}`;
      if (wsGateway.registerPluginWsHandler) {
        wsGateway.registerPluginWsHandler(prefixedType, handler, manifest.name);
      }
      pluginLogger.info({ type, prefixedType }, 'Registered WebSocket handler');
    },

    sendWebSocketMessage(target: string, message: any) {
      if (target === '*') {
        // Broadcast to all authenticated clients
        if (wsGateway.broadcastToAuthenticated) {
          wsGateway.broadcastToAuthenticated(message);
        }
        return;
      }
      // Send to specific client
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
      eventHandlers.get(event)?.add(handler);

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

    // ── Structured storage ─────────────────────────────────────────────────
    collection(name: string): PluginCollectionAPI {
      return scopedDb.collection(name);
    },

    // ── Event type safety ──────────────────────────────────────────────────
    getDeclaredEvents(): Record<string, PluginEventSchema> | undefined {
      return manifest.events;
    },

    emitTyped(event: string, data: any): void {
      const declaredEvents = manifest.events;
      if (declaredEvents && declaredEvents[event]) {
        const schema = declaredEvents[event];
        // Validate payload against declared schema - warn on mismatch, don't throw
        if (schema.payload) {
          for (const [field, _type] of Object.entries(schema.payload)) {
            if (data && typeof data === 'object' && !(field in data)) {
              pluginLogger.warn(
                { event, field, declaredFields: Object.keys(schema.payload), providedFields: Object.keys(data) },
                'emitTyped: event payload missing declared field',
              );
            }
          }
        }
      } else if (declaredEvents) {
        pluginLogger.warn({ event, declared: Object.keys(declaredEvents) }, 'emitTyped: event not declared in manifest');
      }
      // Emit regardless of validation result
      eventEmitter.emit(event, data);
      pluginLogger.debug({ event }, 'Emitted typed event');
    },

    // ── Plugin-to-plugin RPC ──────────────────────────────────────────────
    exposeApi(name: string, handler: (params: any) => Promise<any>): void {
      if (!registry) {
        pluginLogger.warn('Cannot expose API: no registry available');
        return;
      }
      registry.registerExposedApi(manifest.name, name, handler);
      pluginLogger.info({ api: name }, 'Exposed API for plugin-to-plugin RPC');
    },

    async callPluginApi(pluginName: string, apiName: string, params?: any): Promise<any> {
      if (!registry) {
        throw new Error('Cannot call plugin API: no registry available');
      }

      // Permission check
      if (!manifest.permissions.includes('plugin.rpc') && !manifest.permissions.includes('*')) {
        pluginLogger.warn(
          { targetPlugin: pluginName, api: apiName },
          'Plugin attempted RPC without plugin.rpc permission',
        );
        throw new Error('Permission denied: plugin.rpc permission required');
      }

      const api = registry.getExposedApi(pluginName, apiName);
      if (!api) {
        throw new Error(`Plugin "${pluginName}" does not expose API: "${apiName}"`);
      }

      // Call with 10s timeout
      const timeoutMs = 10000;
      return Promise.race([
        api(params),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`RPC call to ${pluginName}.${apiName} timed out`)), timeoutMs),
        ),
      ]);
    },
  };

  return context;
}

/**
 * Run a middleware handler, supporting both Express-style (3 params with next) and
 * Fastify-style (2 params, async). Used by the loader when wrapping route handlers.
 */
export async function runMiddleware(
  handler: (...args: any[]) => any,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (handler.length >= 3) {
    // Express-style: (req, reply, next) - next is error-first callback
    await new Promise<void>((resolve, reject) => {
      const done = (err?: any) => {
        if (err) reject(err instanceof Error ? err : new Error(String(err)));
        else resolve();
      };
      try {
        const result = handler(request, reply, done);
        if (result && typeof result === 'object' && typeof result.then === 'function') {
          result.catch(reject);
        }
      } catch (err) {
        reject(err);
      }
    });
  } else {
    // Fastify-style: (req, reply) => Promise<void> | void
    const result = handler(request, reply);
    if (result && typeof result === 'object' && typeof result.then === 'function') {
      await result;
    }
  }
}
