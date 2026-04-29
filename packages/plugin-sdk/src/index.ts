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
} from './types';

// Config
export { defineConfig, configField, createConfigSchema } from './config';
export type { ConfigFieldDef } from './config';

// Storage
export { createTypedCollection } from './storage';
export type { TypedCollection } from './storage';

// Routes
export { defineRoutes, PluginRouteBuilder } from './routes';
export type { RouteDefinition } from './routes';

// Testing
export {
  createMockLogger,
  createMockCollection,
  createMockContext,
  createTestPlugin,
  TestPluginHarness,
} from './testing';
export type { MockContext } from './testing';
