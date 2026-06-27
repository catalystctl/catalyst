// Types
export type {
  PluginManifest,
  PluginLifecycle,
  PluginCollectionAPI,
  PluginCollectionOptions,
  PluginRouteHandler,
  PluginMiddlewareHandler,
  PluginWebSocketHandler,
  PluginTaskHandler,
  PluginEventHandler,
} from './types.js';

// Config
export { defineConfig, configField, createConfigSchema } from './config.js';
export type { ConfigFieldDef } from './config.js';

// Storage
export { createTypedCollection } from './storage.js';
export type { TypedCollection } from './storage.js';

// Routes
export { defineRoutes, PluginRouteBuilder } from './routes.js';
export type { RouteDefinition } from './routes.js';

// Testing
export {
  createMockLogger,
  createMockCollection,
  createMockContext,
  createTestPlugin,
  TestPluginHarness,
} from './testing.js';
export type { MockContext } from './testing.js';
