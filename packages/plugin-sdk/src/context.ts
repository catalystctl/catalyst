/**
 * Typed plugin context wrapper.
 *
 * Wraps the raw `PluginBackendContext` from the Catalyst host and provides
 * strongly-typed config, event, storage, and collection APIs.
 */

import type { ZodType } from 'zod';
import type {
  PluginManifest,
  PluginBackendContext,
  PluginRouteHandler,
  PluginMiddlewareHandler,
  PluginWebSocketHandler,
  PluginTaskHandler,
  PluginCollectionAPI,
  ScopedPluginDB,
} from './types';
import type { TypedPluginContext, LoggerLike } from './types';
import { createTypedCollection } from './storage';

/**
 * Wraps a raw PluginBackendContext with typed Config and Events generics.
 *
 * @example
 * const MyConfig = z.object({ greeting: z.string().default('Hello!') });
 * const MyEvents = { 'task-done': z.object({ id: z.string() }) };
 *
 * const ctx = createTypedContext(rawCtx, MyConfig, MyEvents);
 * const greeting = ctx.getConfig('greeting'); // string
 * ctx.emit('task-done', { id: 'abc' }); // typed
 */
export function createTypedContext<
  Config extends Record<string, unknown>,
  Events extends Record<string, unknown>,
>(
  raw: PluginBackendContext,
  configSchema?: Record<string, ZodType>,
  eventSchemas?: Record<string, ZodType>,
): TypedPluginContext<Config, Events> {
  // Validate config on load
  if (configSchema) {
    for (const [key, schema] of Object.entries(configSchema)) {
      const rawValue = raw.getConfig(key);
      if (rawValue !== undefined) {
        const result = schema.safeParse(rawValue);
        if (!result.success) {
          raw.logger.warn(
            { key, errors: result.error.errors },
            `Plugin config value for "${key}" does not match schema`,
          );
        }
      }
    }
  }

  return {
    // ── Metadata ────────────────────────────────────────────────────
    get manifest() {
      return raw.manifest;
    },

    // ── Typed Config ────────────────────────────────────────────────
    getConfig<K extends keyof Config>(key: K): Config[K] | undefined {
      return raw.getConfig(key as string) as Config[K] | undefined;
    },

    async setConfig<K extends keyof Config>(key: K, value: Config[K]): Promise<void> {
      // Validate before setting
      if (configSchema && configSchema[key as string]) {
        const schema = configSchema[key as string];
        const result = schema.safeParse(value);
        if (!result.success) {
          const msg = `Config "${String(key)}" validation failed: ${result.error.message}`;
          raw.logger.error({ key, value, errors: result.error.errors }, msg);
          throw new Error(msg);
        }
      }
      return raw.setConfig(key as string, value);
    },

    // ── Typed Events ────────────────────────────────────────────────
    on<E extends keyof Events>(
      event: E extends string ? E : never,
      handler: (data: Events[E]) => void | Promise<void>,
    ): void {
      raw.on(event as string, async (data: unknown) => {
        // Validate event payload if schema exists
        if (eventSchemas && eventSchemas[event as string]) {
          const schema = eventSchemas[event as string];
          const result = schema.safeParse(data);
          if (!result.success) {
            raw.logger.warn(
              { event, data, errors: result.error.errors },
              `Event payload for "${event as string}" does not match schema`,
            );
          }
        }
        await handler(data as Events[E]);
      });
    },

    emit<E extends keyof Events>(event: E extends string ? E : never, data: Events[E]): void {
      // Validate before emitting
      if (eventSchemas && eventSchemas[event as string]) {
        const schema = eventSchemas[event as string];
        const result = schema.safeParse(data);
        if (!result.success) {
          const msg = `Cannot emit event "${event as string}" — payload validation failed: ${result.error.message}`;
          raw.logger.error({ event, data, errors: result.error.errors }, msg);
          throw new Error(msg);
        }
      }
      raw.emit(event as string, data);
    },

    // ── Storage ─────────────────────────────────────────────────────
    getStorage<T = unknown>(key: string): Promise<T | null> {
      return raw.getStorage(key);
    },

    setStorage<T = unknown>(key: string, value: T): Promise<void> {
      return raw.setStorage(key, value);
    },

    deleteStorage(key: string): Promise<void> {
      return raw.deleteStorage(key);
    },

    // ── Database ────────────────────────────────────────────────────
    get db(): ScopedPluginDB {
      return raw.db;
    },

    // ── Routes ──────────────────────────────────────────────────────
    registerRoute(options: Parameters<PluginBackendContext['registerRoute']>[0]): void {
      raw.registerRoute(options);
    },

    registerMiddleware(handler: PluginMiddlewareHandler, options?: { scope?: 'global' | 'route' }): void {
      raw.registerMiddleware(handler, options);
    },

    // ── WebSocket ───────────────────────────────────────────────────
    onWebSocketMessage(type: string, handler: PluginWebSocketHandler): void {
      raw.onWebSocketMessage(type, handler);
    },

    sendWebSocketMessage(target: string, message: unknown): void {
      raw.sendWebSocketMessage(target, message);
    },

    // ── Tasks ───────────────────────────────────────────────────────
    scheduleTask(cron: string, handler: PluginTaskHandler): void {
      raw.scheduleTask(cron, handler);
    },

    // ── Logging ─────────────────────────────────────────────────────
    get logger(): LoggerLike {
      return raw.logger as LoggerLike;
    },

    // ── RPC ─────────────────────────────────────────────────────────
    exposeApi(name: string, handler: (params: unknown) => Promise<unknown>): void {
      raw.exposeApi(name, handler);
    },

    callPluginApi(pluginName: string, apiName: string, params?: unknown): Promise<unknown> {
      return raw.callPluginApi(pluginName, apiName, params);
    },
  };
}

/**
 * Convenience helper that creates a typed context with full type inference.
 *
 * @example
 * const config = { greeting: z.string().default('Hello!') };
 * const events = { 'ping': z.object({ count: z.number() }) };
 *
 * createTypedContext(raw, config, events);
 * // Infers: TypedPluginContext<{ greeting: string }, { ping: { count: number } }>
 */
export function defineTypedContext<
  ConfigSchema extends Record<string, ZodType>,
  EventSchema extends Record<string, ZodType>,
>(
  raw: PluginBackendContext,
  options: {
    config?: ConfigSchema;
    events?: EventSchema;
  },
): TypedPluginContext<
  { [K in keyof ConfigSchema]: ConfigSchema[K]['_output'] },
  { [K in keyof EventSchema]: EventSchema[K]['_output'] }
> {
  return createTypedContext(raw, options.config, options.events) as any;
}
