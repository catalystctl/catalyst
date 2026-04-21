import type { FastifyInstance, FastifyRequest, FastifyReply, RouteOptions } from 'fastify';
import type { Logger } from 'pino';
import type { WebSocketGateway } from '../websocket/gateway';

/**
 * Scoped database interface describing what plugins actually receive.
 * Replaces the raw PrismaClient typing that was incorrect.
 */
export interface ScopedPluginDB {
  servers: {
    findMany(args?: any): Promise<any>;
    findUnique(args: any): Promise<any>;
    count(args?: any): Promise<number>;
    update(id: string, data: Record<string, any>): Promise<any>;
  };
  users: {
    findMany(args?: any): Promise<any>;
    findUnique(args: any): Promise<any>;
    count(args?: any): Promise<number>;
    update(id: string, data: Record<string, any>): Promise<any>;
  };
  pluginStorage: {
    findUnique(args: any): Promise<any>;
    upsert(args: any): Promise<any>;
    deleteMany(args: any): Promise<any>;
    findMany(args?: any): Promise<any>;
  };
  plugin: {
    findUnique(args: any): Promise<any>;
    update(args: any): Promise<any>;
  };
  collection(name: string): PluginCollectionAPI;
}

/**
 * Structured collection API for plugin storage.
 * Each collection is backed by a single PluginStorage key storing a JSON array.
 */
export interface PluginCollectionAPI {
  find(filter?: any, options?: PluginCollectionOptions): Promise<any[]>;
  findOne(filter: any): Promise<any | null>;
  insert(doc: any): Promise<any>;
  update(filter: any, update: any): Promise<number>;
  delete(filter: any): Promise<number>;
  count(filter?: any): Promise<number>;
}

/**
 * Options for collection queries.
 */
export interface PluginCollectionOptions {
  sort?: Record<string, 1 | -1>;
  limit?: number;
  skip?: number;
  projection?: Record<string, 0 | 1>;
}

/**
 * Plugin component slot configuration for UI integration.
 */
export interface PluginComponentSlotConfig {
  slot: string;
  component: string;
  props?: Record<string, any>;
  order?: number;
  requiredPermissions?: string[];
}

/**
 * Typed plugin config schema definition.
 */
export interface PluginConfigSchema {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  default?: any;
  description?: string;
  required?: boolean;
  enum?: any[];
  min?: number;
  max?: number;
}

/**
 * Schema for a declared plugin event.
 */
export interface PluginEventSchema {
  payload: Record<string, any>;
  description?: string;
}

/**
 * Plugin manifest structure from plugin.json
 */
export interface PluginManifest {
  name: string;
  version: string;
  displayName: string;
  description: string;
  author: string;
  catalystVersion: string;
  permissions: string[];
  backend?: {
    entry: string;
  };
  frontend?: {
    entry: string;
  };
  dependencies?: Record<string, string>;
  config?: Record<string, any>;
  events?: Record<string, PluginEventSchema>;
}

/**
 * Plugin state in database
 */
export interface PluginState {
  name: string;
  enabled: boolean;
  version: string;
  installedAt: Date;
  enabledAt?: Date;
  config?: Record<string, any>;
}

/**
 * Plugin lifecycle status
 */
export enum PluginStatus {
  UNLOADED = 'unloaded',
  LOADING = 'loading',
  LOADED = 'loaded',
  ENABLED = 'enabled',
  DISABLED = 'disabled',
  ERROR = 'error',
}

/**
 * Route handler type
 */
export type PluginRouteHandler = (
  request: FastifyRequest,
  reply: FastifyReply
) => Promise<any> | any;

/**
 * Middleware handler type - Fastify hook style with error-first done callback.
 * Supports both new Fastify-style (req, reply, done) and legacy Express-style (req, reply, next)
 * at runtime via parameter count detection.
 */
export type PluginMiddlewareHandler = (
  request: FastifyRequest,
  reply: FastifyReply,
  done: (err?: Error) => void
) => Promise<void> | void;

/**
 * Internal middleware entry storing handler and scope.
 * Uses Function type for runtime backward compatibility with both old and new middleware.
 */
export interface PluginMiddlewareEntry {
  handler: (...args: any[]) => any;
  scope: 'global' | 'route';
}

/**
 * WebSocket message handler
 */
export type PluginWebSocketHandler = (data: any, clientId?: string) => Promise<void> | void;

/**
 * Task handler for scheduled tasks
 */
export type PluginTaskHandler = () => Promise<void> | void;

/**
 * Event handler
 */
export type PluginEventHandler = (data: any) => Promise<void> | void;

/**
 * Plugin backend context provided to plugins
 */
export interface PluginBackendContext {
  // Plugin metadata
  manifest: PluginManifest;
  /** Original config schema from plugin.json (never mutated by setConfig) */
  originalConfig?: Record<string, any>;

  // Core services
  db: ScopedPluginDB;
  logger: Logger;
  wsGateway: WebSocketGateway;

  // Route registration
  registerRoute(options: RouteOptions): void;

  // Middleware registration - accepts both old and new style handlers
  registerMiddleware(handler: any, options?: { scope?: 'global' | 'route' }): void;

  // WebSocket hooks
  onWebSocketMessage(type: string, handler: PluginWebSocketHandler): void;
  sendWebSocketMessage(target: string, message: any): void;

  // Task scheduling
  scheduleTask(cron: string, handler: PluginTaskHandler): void;

  // Events
  on(event: string, handler: PluginEventHandler): void;
  emit(event: string, data: any): void;

  // Configuration
  getConfig<T = any>(key: string): T | undefined;
  setConfig<T = any>(key: string, value: T): Promise<void>;

  // Storage (plugin-scoped key-value store)
  getStorage<T = any>(key: string): Promise<T | null>;
  setStorage<T = any>(key: string, value: T): Promise<void>;
  deleteStorage(key: string): Promise<void>;

  // Structured storage - collection API
  collection(name: string): PluginCollectionAPI;

  // Event type safety
  getDeclaredEvents(): Record<string, PluginEventSchema> | undefined;
  emitTyped(event: string, data: any): void;

  // Plugin-to-plugin RPC
  exposeApi(name: string, handler: (params: any) => Promise<any>): void;
  callPluginApi(pluginName: string, apiName: string, params?: any): Promise<any>;
}

/**
 * Plugin backend entry point
 */
export interface PluginBackend {
  onLoad?(context: PluginBackendContext): Promise<void> | void;
  onEnable?(context: PluginBackendContext): Promise<void> | void;
  onDisable?(context: PluginBackendContext): Promise<void> | void;
  onUnload?(context: PluginBackendContext): Promise<void> | void;
}

/**
 * Loaded plugin instance
 */
export interface LoadedPlugin {
  manifest: PluginManifest;
  status: PluginStatus;
  context: PluginBackendContext;
  backend?: PluginBackend;
  routes: RouteOptions[];
  middlewares: PluginMiddlewareEntry[];
  wsHandlers: Map<string, PluginWebSocketHandler>;
  tasks: Map<string, { cron: string; handler: PluginTaskHandler; job?: any }>;
  eventHandlers: Map<string, Set<PluginEventHandler>>;
  error?: Error;
  loadedAt?: Date;
  enabledAt?: Date;
  /** Original route handlers stored for disable/enable lifecycle */
  originalHandlers?: Map<string, RouteOptions['handler']>;
  /** Runtime ref toggled on enable/disable to gate route handlers */
  enabledRef?: { value: boolean };
}

/**
 * Plugin frontend tab configuration
 */
export interface PluginTabConfig {
  id: string;
  label: string;
  icon?: string;
  component: string;
  location: 'admin' | 'server';
  order?: number;
  requiredPermissions?: string[];
}

/**
 * Plugin frontend route configuration
 */
export interface PluginRouteConfig {
  path: string;
  component: string;
  requiredPermissions?: string[];
}

/**
 * Plugin frontend manifest
 */
export interface PluginFrontendManifest {
  routes?: PluginRouteConfig[];
  tabs?: PluginTabConfig[];
  components?: Record<string, string>;
}
