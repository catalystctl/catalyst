import type {
  PluginManifest,
  PluginCollectionAPI,
  PluginWebSocketHandler,
  PluginTaskHandler,
  PluginEventHandler,
  LoggerLike,
} from './types.js';

export interface MockContext {
  manifest: PluginManifest;
  db: {
    servers: any;
    users: any;
    pluginStorage: any;
    plugin: any;
    collection: (name: string) => PluginCollectionAPI;
  };
  logger: LoggerLike;
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
  getUserId: (request: any) => string | null;
  hasPermission: (request: any, ...required: string[]) => boolean;
  requirePermission: (...required: string[]) => (request: any, reply: any) => Promise<any>;
}

function getByPath(doc: any, path: string): unknown {
  if (!doc || typeof doc !== 'object') return undefined;
  if (!path.includes('.')) return doc[path];
  let cur: any = doc;
  for (const part of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return cur;
}

function setByPath(doc: any, path: string, value: unknown): void {
  if (!path.includes('.')) {
    doc[path] = value;
    return;
  }
  const parts = path.split('.');
  let cur: any = doc;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function matchFilter(doc: any, filter: any): boolean {
  if (!filter || typeof filter !== 'object') return true;
  for (const [key, value] of Object.entries(filter)) {
    if (key === '$or') {
      if (!Array.isArray(value) || !(value as any[]).some((s) => matchFilter(doc, s))) return false;
      continue;
    }
    if (key === '$and') {
      if (!Array.isArray(value) || !(value as any[]).every((s) => matchFilter(doc, s))) return false;
      continue;
    }
    const docValue = getByPath(doc, key);
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const op = value as Record<string, any>;
      const opKeys = Object.keys(op);
      if (opKeys.length > 0 && opKeys.every((k) => k.startsWith('$'))) {
        if (op.$eq !== undefined && docValue !== op.$eq) return false;
        if (op.$ne !== undefined && docValue === op.$ne) return false;
        if (op.$gt !== undefined && !((docValue as any) > op.$gt)) return false;
        if (op.$gte !== undefined && !((docValue as any) >= op.$gte)) return false;
        if (op.$lt !== undefined && !((docValue as any) < op.$lt)) return false;
        if (op.$lte !== undefined && !((docValue as any) <= op.$lte)) return false;
        if (op.$in !== undefined && !(Array.isArray(op.$in) && op.$in.includes(docValue))) return false;
        if (op.$nin !== undefined && Array.isArray(op.$nin) && op.$nin.includes(docValue)) return false;
        if (op.$exists !== undefined) {
          const exists = docValue !== undefined && docValue !== null;
          if (op.$exists !== exists) return false;
        }
        if (op.$regex !== undefined) {
          const regex = typeof op.$regex === 'string' ? new RegExp(op.$regex, op.$flags || '') : op.$regex;
          if (!regex.test(String(docValue ?? ''))) return false;
        }
        continue;
      }
    }
    if (docValue !== value) return false;
  }
  return true;
}

function applyUpdate(target: any, update: any): void {
  if (!update || typeof update !== 'object') return;
  const hasOps = update.$set || update.$unset || update.$inc || update.$push || update.$pull;
  if (update.$set) {
    for (const [k, v] of Object.entries(update.$set)) setByPath(target, k, v);
  }
  if (update.$unset) {
    for (const k of Object.keys(update.$unset)) {
      if (!k.includes('.')) delete target[k];
      else {
        const parts = k.split('.');
        let cur = target;
        for (let i = 0; i < parts.length - 1; i++) cur = cur?.[parts[i]];
        if (cur && typeof cur === 'object') delete cur[parts[parts.length - 1]];
      }
    }
  }
  if (update.$inc) {
    for (const [k, v] of Object.entries(update.$inc)) {
      const cur = getByPath(target, k);
      setByPath(target, k, (typeof cur === 'number' ? cur : 0) + (v as number));
    }
  }
  if (update.$push) {
    for (const [k, v] of Object.entries(update.$push)) {
      const cur = getByPath(target, k);
      const arr = Array.isArray(cur) ? cur : [];
      arr.push(v);
      setByPath(target, k, arr);
    }
  }
  if (update.$pull) {
    for (const [k, v] of Object.entries(update.$pull)) {
      const cur = getByPath(target, k);
      if (!Array.isArray(cur)) continue;
      setByPath(
        target,
        k,
        typeof v === 'object' && v !== null
          ? cur.filter((item: any) => !matchFilter(item, v))
          : cur.filter((item: any) => item !== v),
      );
    }
  }
  if (!hasOps) {
    for (const [k, v] of Object.entries(update)) {
      if (k.startsWith('$')) continue;
      setByPath(target, k, v);
    }
  }
}

function resolveConfigValue(value: unknown): unknown {
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof (value as any).type === 'string' &&
    ['string', 'number', 'boolean', 'select', 'text', 'password', 'object', 'array'].includes(
      (value as any).type,
    )
  ) {
    const keys = Object.keys(value as object);
    const meta = new Set(['type', 'default', 'description', 'options', 'required', 'enum', 'min', 'max', 'label']);
    if (keys.length === 1 && keys[0] === 'type') return (value as any).default;
    if (keys.some((k) => k !== 'type' && meta.has(k)) && keys.every((k) => meta.has(k))) {
      return (value as any).default;
    }
  }
  return value;
}

export function createMockLogger(): LoggerLike {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    trace: () => {},
    child: () => createMockLogger(),
  };
}

export function createMockCollection(): PluginCollectionAPI {
  const data: any[] = [];
  return {
    async find(filter?: any, options?: any) {
      let results = filter ? data.filter((d) => matchFilter(d, filter)) : [...data];
      if (options?.sort) {
        for (const [field, dir] of Object.entries(options.sort as Record<string, 1 | -1>)) {
          results.sort((a, b) => {
            const av = getByPath(a, field) as any;
            const bv = getByPath(b, field) as any;
            if (av === bv) return 0;
            return av < bv ? -dir : dir;
          });
        }
      }
      if (options?.skip) results = results.slice(options.skip);
      if (options?.limit) results = results.slice(0, options.limit);
      return results;
    },
    async findOne(filter: any) {
      const results = await this.find(filter, { limit: 1 });
      return results[0] || null;
    },
    async insert(doc: any) {
      const item = {
        ...doc,
        _id: String(Date.now()) + Math.random().toString(36).slice(2, 6),
        _createdAt: new Date().toISOString(),
        _updatedAt: new Date().toISOString(),
      };
      data.push(item);
      return item;
    },
    async update(filter: any, update: any) {
      const items = data.filter((d) => matchFilter(d, filter));
      for (const item of items) {
        applyUpdate(item, update);
        item._updatedAt = new Date().toISOString();
      }
      return items.length;
    },
    async delete(filter: any) {
      let count = 0;
      for (let i = data.length - 1; i >= 0; i--) {
        if (matchFilter(data[i], filter)) {
          data.splice(i, 1);
          count++;
        }
      }
      return count;
    },
    async count(filter?: any) {
      if (!filter) return data.length;
      return data.filter((d) => matchFilter(d, filter)).length;
    },
  };
}

export function createMockContext(manifest: PluginManifest, config?: Record<string, any>): MockContext {
  const storage = new Map<string, any>();
  const routes: any[] = [];
  const middlewares: any[] = [];
  const eventHandlers = new Map<string, Set<PluginEventHandler>>();
  const runtimeConfig: Record<string, any> = {};

  // Seed runtime config from plain values or schema defaults
  const seed = config || manifest.config || {};
  for (const [k, v] of Object.entries(seed)) {
    runtimeConfig[k] = resolveConfigValue(v);
  }

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
      collection: () => createMockCollection(),
    },
    logger: createMockLogger(),
    wsGateway: { registerPluginWsHandler: () => {}, unregisterPluginWsHandlers: () => {} },
    registerRoute: (options) => routes.push(options),
    registerMiddleware: (handler, options) => middlewares.push({ handler, scope: options?.scope ?? 'global' }),
    onWebSocketMessage: () => {},
    sendWebSocketMessage: () => {},
    scheduleTask: () => {},
    on: (event, handler) => {
      if (!eventHandlers.has(event)) eventHandlers.set(event, new Set());
      eventHandlers.get(event)!.add(handler);
    },
    emit: (event, data) => {
      for (const handler of eventHandlers.get(event) || []) {
        void handler(data);
      }
    },
    getConfig: (key) => runtimeConfig[key],
    setConfig: async (key, value) => {
      runtimeConfig[key] = value;
    },
    getStorage: async (key) => storage.get(key) ?? null,
    setStorage: async (key, value) => {
      storage.set(key, value);
    },
    deleteStorage: async (key) => {
      storage.delete(key);
    },
    collection: () => createMockCollection(),
    getUserId: (request) => request?.user?.userId || request?.user?.id || null,
    hasPermission: (request, ...required) => {
      const perms: string[] = request?.user?.permissions ?? [];
      if (perms.includes('*')) return true;
      return required.some((p) => perms.includes(p));
    },
    requirePermission: (...required) => {
      return async (request: any, reply: any) => {
        const perms: string[] = request?.user?.permissions ?? [];
        if (perms.includes('*') || required.some((p) => perms.includes(p))) return;
        return reply.status(403).send({ success: false, error: 'Permission denied' });
      };
    },
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
