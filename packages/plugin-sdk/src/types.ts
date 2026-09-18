// Re-exported types from catalyst-backend plugin system
export interface PluginManifest {
  name: string;
  version: string;
  displayName: string;
  description: string;
  author: string;
  catalystVersion: string;
  permissions: string[];
  /**
   * Author-provided reviewer copy for declared scopes (esp. custom ones).
   * Keys must be declared permissions; see `definePermissions()`.
   */
  permissionDescriptions?: Record<string, string>;
  backend?: { entry: string };
  frontend?: { entry: string };
  dependencies?: Record<string, string>;
  config?: Record<string, any>;
  events?: Record<string, { payload: Record<string, any>; description?: string }>;
  storageEngine?: 'legacy' | 'dedicated';
  runtime?: 'legacy' | 'isolated';
  /**
   * External sign-in providers implemented by this plugin (OAuth, SSO).
   * Declared providers are listed on the public /api/auth/oauth-providers
   * endpoint (login-page buttons) while the plugin is enabled.
   */
  authProviders?: {
    id: string;
    label: string;
    /** Route path (relative to the plugin namespace) starting the flow. Default "/authorize". */
    authorizePath?: string;
  }[];
}

export interface PluginLifecycle {
  onLoad?(context: any): Promise<void> | void;
  onEnable?(context: any): Promise<void> | void;
  onDisable?(context: any): Promise<void> | void;
  onUnload?(context: any): Promise<void> | void;
}

export interface PluginCollectionAPI {
  find(filter?: any, options?: PluginCollectionOptions): Promise<any[]>;
  findOne(filter: any): Promise<any | null>;
  insert(doc: any): Promise<any>;
  update(filter: any, update: any): Promise<number>;
  delete(filter: any): Promise<number>;
  count(filter?: any): Promise<number>;
}

export interface PluginCollectionOptions {
  sort?: Record<string, 1 | -1>;
  limit?: number;
  skip?: number;
  projection?: Record<string, 0 | 1>;
}

export type PluginRouteHandler = (request: any, reply: any) => Promise<any> | any;
export type PluginMiddlewareHandler = (request: any, reply: any, done: (err?: Error) => void) => Promise<void> | void;
export type PluginWebSocketHandler = (data: any, clientId?: string) => Promise<void> | void;
export type PluginTaskHandler = () => Promise<void> | void;
export type PluginEventHandler = (data: any) => Promise<void> | void;

/**
 * Awaited file-operation RPC against a node's server directory, backed by the
 * panel's file tunnel (agent long-poll + HTTP staging). Requests are
 * permission-checked, capped per node, and time out after 60s (longer for
 * large uploads).
 *
 * Binary payloads are typed as Node's Buffer. The SDK compiles with
 * "types": [] (environment-neutral), so Buffer is referenced structurally
 * via the Uint8Array base class it extends at runtime — every Buffer is a
 * Uint8Array, and Buffer.isArray/members used by plugins operate on it.
 */
export interface PluginFileTunnel {
  queueRequest(
    nodeId: string,
    operation: 'list' | 'download' | 'upload' | 'write' | 'create' | 'delete' | 'rename' | 'permissions' | 'compress' | 'decompress' | string,
    serverUuid: string,
    filePath: string,
    data?: Record<string, unknown>,
    uploadData?: Uint8Array,
  ): Promise<{ requestId: string; success: boolean; data?: unknown; error?: string; body?: Uint8Array }>;
}

/**
 * Minimal pino-compatible logger surface used by the typed context wrapper.
 * Structural subset of `pino.Logger` so the SDK does not hard-depend on pino.
 */
export interface LoggerLike {
  info(obj: unknown, msg: string): void;
  info(msg: string): void;
  warn(obj: unknown, msg: string): void;
  warn(msg: string): void;
  error(obj: unknown, msg: string): void;
  error(msg: string): void;
  debug(obj: unknown, msg: string): void;
  debug(msg: string): void;
  trace(obj: unknown, msg: string): void;
  trace(msg: string): void;
  child(bindings: Record<string, unknown>): LoggerLike;
}

/**
 * Scoped database interface describing what plugins actually receive.
 * Mirrors `catalyst-backend`'s `ScopedPluginDB` (standalone copy).
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
 * Route registration options. Standalone copy of the Fastify `RouteOptions`
 * subset the plugin host accepts (kept `any`-ish to avoid a hard fastify dep).
 *
 * `config.auth` controls host authentication for the route:
 *   - 'required' (default) — host auth middleware rejects unauthenticated calls
 *   - 'optional' — a valid session populates request.user; anonymous callers pass
 *   - 'public'   — never authenticated (OAuth redirects/callbacks)
 * Non-required modes require the live `routes.public` permission grant.
 */
export interface PluginRouteOptions {
  method: string | string[];
  url: string;
  handler: PluginRouteHandler;
  config?: { auth?: 'required' | 'optional' | 'public'; [key: string]: any };
  [key: string]: any;
}

/**
 * Plugin backend context provided to plugins by the Catalyst host.
 * Mirrors `catalyst-backend`'s `PluginBackendContext` (standalone copy).
 */
export interface PluginBackendContext {
  manifest: PluginManifest;
  originalConfig?: Record<string, any>;
  db: ScopedPluginDB;
  logger: LoggerLike;
  wsGateway: any;
  registerRoute(options: PluginRouteOptions): void;
  registerMiddleware(handler: any, options?: { scope?: 'global' | 'route' }): void;
  onWebSocketMessage(type: string, handler: PluginWebSocketHandler): void;
  sendWebSocketMessage(target: string, message: any): void;
  scheduleTask(cron: string, handler: PluginTaskHandler): void;
  on(event: string, handler: PluginEventHandler): void;
  emit(event: string, data: any): void;
  getConfig<T = any>(key: string): T | undefined;
  setConfig<T = any>(key: string, value: T): Promise<void>;
  getStorage<T = any>(key: string): Promise<T | null>;
  setStorage<T = any>(key: string, value: T): Promise<void>;
  deleteStorage(key: string): Promise<void>;
  collection(name: string): PluginCollectionAPI;
  getDeclaredEvents(): Record<string, { payload: Record<string, any>; description?: string }> | undefined;
  emitTyped(event: string, data: any): void;
  exposeApi(name: string, handler: (params: any) => Promise<any>): void;
  callPluginApi(pluginName: string, apiName: string, params?: any): Promise<any>;

  /** Host auth sets request.user.userId (not .id). */
  getUserId?(request: any): string | null;
  hasPermission?(request: any, ...required: string[]): boolean;
  requirePermission?(...required: string[]): (request: any, reply: any) => Promise<any> | any;
  /** Awaited file operations against node server directories (file tunnel). Present when the host provides it. */
  fileTunnel?: PluginFileTunnel;
  /**
   * Auth bridge for external sign-in plugins (OAuth/SSO). Every method is
   * live-gated on manifest permissions the admin can revoke:
   * `auth.sessions` → createSession, `auth.users` → findUser/createUser,
   * `roles.assign` → role operations. Present when the host provides it.
   */
  auth?: PluginAuthBridge;
}

/** User record returned by the plugin auth bridge. */
export interface PluginAuthUser {
  id: string;
  email: string;
  username: string;
  name: string;
  image: string | null;
  emailVerified: boolean;
  banned: boolean;
  lockedUntil: string | null;
}

/** Panel role descriptor used by the plugin auth bridge. */
export interface PluginAuthRole {
  id: string;
  name: string;
  description: string | null;
}

/** Session created by the plugin auth bridge (real better-auth session). */
export interface PluginAuthSession {
  token: string;
  expiresAt: Date;
}

/** Host-provided auth operations for external sign-in flows. */
export interface PluginAuthBridge {
  findUser(by: { userId?: string; email?: string; username?: string }): Promise<PluginAuthUser | null>;
  createUser(input: {
    email: string;
    username: string;
    name: string;
    emailVerified?: boolean;
    image?: string | null;
  }): Promise<PluginAuthUser>;
  createSession(
    userId: string,
    opts?: { rememberMe?: boolean; ipAddress?: string; userAgent?: string; reply?: any },
  ): Promise<PluginAuthSession>;
  listRoles(): Promise<PluginAuthRole[]>;
  listUserRoles(userId: string): Promise<PluginAuthRole[]>;
  assignRoles(userId: string, roleIds: string[], opts?: { reason?: string }): Promise<void>;
  removeRoles(userId: string, roleIds: string[], opts?: { reason?: string }): Promise<void>;
}

/**
 * Typed wrapper around `PluginBackendContext` with strongly-typed config and
 * events generics, as produced by `createTypedContext`.
 */
export interface TypedPluginContext<Config extends Record<string, unknown> = Record<string, unknown>, Events extends Record<string, unknown> = Record<string, unknown>> {
  manifest: PluginManifest;
  getConfig<K extends keyof Config>(key: K): Config[K] | undefined;
  setConfig<K extends keyof Config>(key: K, value: Config[K]): Promise<void>;
  on<E extends keyof Events>(event: E extends string ? E : never, handler: (data: Events[E]) => void | Promise<void>): void;
  emit<E extends keyof Events>(event: E extends string ? E : never, data: Events[E]): void;
  getStorage<T = unknown>(key: string): Promise<T | null>;
  setStorage<T = unknown>(key: string, value: T): Promise<void>;
  deleteStorage(key: string): Promise<void>;
  db: ScopedPluginDB;
  registerRoute(options: PluginRouteOptions): void;
  registerMiddleware(handler: PluginMiddlewareHandler, options?: { scope?: 'global' | 'route' }): void;
  onWebSocketMessage(type: string, handler: PluginWebSocketHandler): void;
  sendWebSocketMessage(target: string, message: unknown): void;
  scheduleTask(cron: string, handler: PluginTaskHandler): void;
  logger: LoggerLike;
  exposeApi(name: string, handler: (params: unknown) => Promise<unknown>): void;
  callPluginApi(pluginName: string, apiName: string, params?: unknown): Promise<unknown>;
}
