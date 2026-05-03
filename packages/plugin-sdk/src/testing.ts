import type { Logger } from 'pino';
import type {
  PluginManifest,
  PluginCollectionAPI,
  PluginWebSocketHandler,
  PluginTaskHandler,
  PluginEventHandler,
} from './types';

export interface MockContext {
  manifest: PluginManifest;
  db: {
    servers: any;
    users: any;
    pluginStorage: any;
    plugin: any;
    collection: (name: string) => PluginCollectionAPI;
  };
  logger: Logger;
  wsGateway: any;
  registerRoute: (options: any) => void;
  registerMiddleware: (handler: any, options?: any) => void;
  onWebSocketMessage: (type: string, handler: PluginWebSocketHandler) => void;
  sendWebSocketMessage: (target: string, message: any) => void;
  scheduleTask: (cron: string, handler: PluginTaskHandler) => void;
  on: (event: string, handler: PluginEventHandler) => void;
  emit: (event: string, data: any) => void;
  getConfig: <T = any>(key: string) => T | undefined;
  setConfig: <T = any>(key: string, value: T) => Promise<void>;
  getStorage: <T = any>(key: string) => Promise<T | null>;
  setStorage: <T = any>(key: string, value: T) => Promise<void>;
  deleteStorage: (key: string) => Promise<void>;
  collection: (name: string) => PluginCollectionAPI;
}

export function createMockLogger(): Logger {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    trace: () => {},
    child: () => createMockLogger(),
  } as any;
}

export function createMockCollection(): PluginCollectionAPI {
  const data: any[] = [];
  return {
    async find(filter) {
      if (!filter) return data;
      return data.filter(d => Object.entries(filter).every(([k, v]) => d[k] === v));
    },
    async findOne(filter) {
      const results = await this.find(filter);
      return results[0] || null;
    },
    async insert(doc) {
      const item = { ...doc, _id: String(Date.now()), _createdAt: new Date().toISOString(), _updatedAt: new Date().toISOString() };
      data.push(item);
      return item;
    },
    async update(filter, update) {
      const items = data.filter(d => Object.entries(filter).every(([k, v]) => d[k] === v));
      items.forEach(item => Object.assign(item, update, { _updatedAt: new Date().toISOString() }));
      return items.length;
    },
    async delete(filter) {
      const before = data.length;
      for (let i = data.length - 1; i >= 0; i--) {
        if (Object.entries(filter).every(([k, v]) => data[i][k] === v)) {
          data.splice(i, 1);
        }
      }
      return before - data.length;
    },
    async count(filter) {
      if (!filter) return data.length;
      return (await this.find(filter)).length;
    },
  };
}

export function createMockContext(manifest: PluginManifest, config?: Record<string, any>): MockContext {
  const storage = new Map<string, any>();
  const routes: any[] = [];
  const middlewares: any[] = [];
  const events: any[] = [];

  return {
    manifest,
    db: {
      servers: { findMany: async () => [], findUnique: async () => null, count: async () => 0, update: async () => null },
      users: { findMany: async () => [], findUnique: async () => null, count: async () => 0, update: async () => null },
      pluginStorage: {
        findUnique: async () => null,
        upsert: async () => null,
        deleteMany: async () => null,
        findMany: async () => [],
      },
      plugin: {
        findUnique: async () => null,
        update: async () => null,
      },
      collection: (name: string) => createMockCollection(),
    },
    logger: createMockLogger(),
    wsGateway: { registerPluginWsHandler: () => {}, unregisterPluginWsHandlers: () => {} },
    registerRoute: (options) => routes.push(options),
    registerMiddleware: (handler, options) => middlewares.push({ handler, scope: options?.scope ?? 'global' }),
    onWebSocketMessage: () => {},
    sendWebSocketMessage: () => {},
    scheduleTask: () => {},
    on: (event, handler) => events.push({ event, handler }),
    emit: () => {},
    getConfig: (key) => (config || manifest.config || {})[key],
    setConfig: async (key, value) => {
      if (!config) config = {};
      config[key] = value;
    },
    getStorage: async (key) => storage.get(key) ?? null,
    setStorage: async (key, value) => { storage.set(key, value); },
    deleteStorage: async (key) => { storage.delete(key); },
    collection: (name) => createMockCollection(),
  };
}

export class TestPluginHarness<T extends { onLoad?: any; onEnable?: any; onDisable?: any; onUnload?: any }> {
  private plugin: T;
  private context: MockContext;

  constructor(plugin: T, manifest: PluginManifest, config?: Record<string, any>) {
    this.plugin = plugin;
    this.context = createMockContext(manifest, config);
  }

  async load() {
    if (this.plugin.onLoad) {
      await this.plugin.onLoad(this.context);
    }
    return this.context;
  }

  async enable() {
    if (this.plugin.onEnable) {
      await this.plugin.onEnable(this.context);
    }
    return this.context;
  }

  async disable() {
    if (this.plugin.onDisable) {
      await this.plugin.onDisable(this.context);
    }
    return this.context;
  }

  async unload() {
    if (this.plugin.onUnload) {
      await this.plugin.onUnload(this.context);
    }
    return this.context;
  }

  getContext() {
    return this.context;
  }
}

export function createTestPlugin<T extends { onLoad?: any; onEnable?: any; onDisable?: any; onUnload?: any }>(
  plugin: T,
  manifest: PluginManifest,
  config?: Record<string, any>,
): TestPluginHarness<T> {
  return new TestPluginHarness(plugin, manifest, config);
}
