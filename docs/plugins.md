# Plugin System

Catalyst plugins extend the platform with custom backend routes, frontend UI components, scheduled tasks, WebSocket handlers, and server-side data persistence. This document covers the complete plugin system — from architecture and types to building and deploying your own plugins.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Plugin Manifest](#plugin-manifest)
- [Plugin Lifecycle](#plugin-lifecycle)
  - [Lifecycle Hooks](#lifecycle-hooks)
  - [Loading vs. Enabling](#loading-vs-enabling)
- [Backend API](#backend-api)
  - [Route Registration](#route-registration)
  - [Plugin Context](#plugin-context)
  - [Scoped Database](#scoped-database)
  - [Event System](#event-system)
  - [WebSocket Integration](#websocket-integration)
  - [Task Scheduling](#task-scheduling)
  - [RPC (Plugin-to-Plugin)](#rpc-plugin-to-plugin)
- [Frontend Integration](#frontend-integration)
  - [Admin Tabs](#admin-tabs)
  - [Server Tabs](#server-tabs)
  - [Dynamic Routes](#dynamic-routes)
  - [Component Slots](#component-slots)
  - [Plugin Store (Zustand)](#plugin-store-zustand)
  - [React Hooks](#react-hooks)
- [Plugin SDK](#plugin-sdk)
  - [Installation & Scaffolding](#installation--scaffolding)
  - [SDK Exports](#sdk-exports)
  - [Typed Collections](#typed-collections)
  - [Config Definitions](#config-definitions)
  - [Route Builder](#route-builder)
  - [Testing Utilities](#testing-utilities)
- [Plugin Security](#plugin-security)
  - [Permission Model](#permission-model)
  - [Database Scoping](#database-scoping)
  - [Path Validation](#path-validation)
  - [Error Isolation](#error-isolation)
  - [Frontend Error Handling](#frontend-error-handling)
- [Hot Reload](#hot-reload)
- [Known Limitations](#known-limitations)
- [Example Plugins](#example-plugins)
  - [Example Plugin](#example-plugin)
  - [Ticketing Plugin](#ticketing-plugin)
  - [Egg Explorer Plugin](#egg-explorer-plugin)
- [Development Workflow](#development-workflow)
- [Cross-References](#cross-references)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                    Frontend (React)                  │
│                                                      │
│  ┌──────────────┐  ┌───────────┐  ┌──────────────┐  │
│  │ Admin Tabs   │  │ Server    │  │ Custom       │  │
│  │ (sidebar)    │  │ Tabs      │  │ Routes       │  │
│  └──────┬───────┘  └────┬──────┘  └──────┬───────┘  │
│         │               │                │           │
│  ┌──────▼───────────────▼▼────────────────▼───────┐  │
│  │            PluginProvider + PluginStore         │  │
│  │   Zustand state + React hooks (usePlugins,     │  │
│  │   usePluginTabs, usePluginRoutes,              │  │
│  │   usePluginComponents)                         │  │
│  └──────────────────────┬────────────────────────┘  │
└─────────────────────────┼───────────────────────────┘
                          │ fetchPlugins()
                          │ POST /api/plugins/:name/enable
                          │ PUT /api/plugins/:name/config
                          ▼
┌─────────────────────────────────────────────────────┐
│                    Backend (Fastify)                 │
│                                                      │
│  ┌─────────────────────────────────────────────┐     │
│  │              PluginLoader (singleton)        │     │
│  │  • Discovery (3-pass: manifests, deps, topo) │     │
│  │  • Manifest validation (Zod)                 │     │
│  │  • Hot reload (chokidar file watcher)        │     │
│  │  • Registry (Map<string, LoadedPlugin>)      │     │
│  └───────────────┬─────────────────────────────┘     │
│                  │                                   │
│  ┌───────────────▼─────────────────────────────┐     │
│  │           PluginRegistry + Context           │     │
│  │  • ScopedPluginDB (Prisma with field-level   │     │
│  │    whitelisting)                             │     │
│  │  • Event system (EventEmitter)               │     │
│  │  • WebSocket gateway integration             │     │
│  │  • Task scheduler (node-cron)                │     │
│  │  • RPC system (plugin-to-plugin API calls)  │     │
│  └───────────────┬─────────────────────────────┘     │
│                  │                                   │
│  ┌───────────────▼─────────────────────────────┐     │
│  │              Plugin Routes                   │     │
│  │  GET    /api/plugins                         │     │
│  │  GET    /api/plugins/:name                   │     │
│  │  POST   /api/plugins/:name/enable            │     │
│  │  POST   /api/plugins/:name/reload            │     │
│  │  PUT    /api/plugins/:name/config            │     │
│  │  GET    /api/plugins/:name/frontend-manifest │     │
│  │  Custom routes registered by each plugin     │     │
│  └─────────────────────────────────────────────┘     │
│                                                      │
│  ┌─────────────────────────────────────────────┐     │
│  │         catalyst-plugins/                    │     │
│  │  • example-plugin/    • ticketing-plugin/   │     │
│  │  • egg-explorer/                      │     │
│  └─────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────┘
```

### Key Design Decisions

| Decision | Rationale | Implication |
|----------|-----------|-------------|
| Plugins share the Node.js process | Simplicity — no need for worker isolation | A crashing plugin can take down the entire server |
| Routes registered at `onLoad` time | Fastify requires routes before `listen()` | Routes are always present but gated by `enabledRef` |
| Frontend code bundled at build time | ESM cache clearing doesn't work reliably | Plugins must be present at build time; no true runtime loading |
| JSON arrays for plugin storage | Simple key-value storage without separate tables | O(n) queries — not suitable for large datasets |
| Scoped DB with field-level whitelists | Security — plugins shouldn't access `apiKeys` or `credentials` tables | Plugins have very limited write access (only `status` on servers, `roleIds` on users) |

---

## Plugin Manifest

Every plugin must have a `plugin.json` file at its root. This is the single source of truth validated by Zod.

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "displayName": "My Plugin",
  "description": "A plugin that does something useful",
  "author": "Developer Name",
  "catalystVersion": ">=1.0.0",
  "permissions": [
    "server.read",
    "admin.read"
  ],
  "backend": {
    "entry": "backend/index.js"
  },
  "frontend": {
    "entry": "frontend/index.ts"
  },
  "dependencies": {
    "other-plugin": "1.0.0"
  },
  "config": {
    "apiKey": {
      "type": "string",
      "default": "",
      "description": "API key for external service"
    }
  },
  "events": {
    "my-event": {
      "payload": { "data": "string" },
      "description": "Description of this event"
    }
  }
}
```

### Manifest Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | ✅ | Unique identifier. Must match `^[a-z0-9-]+$`, 1-50 chars. |
| `version` | `string` | ✅ | Semver format `^\d+\.\d+\.\d+$`. |
| `displayName` | `string` | ✅ | Human-readable name shown in admin UI (max 100 chars). |
| `description` | `string` | ✅ | Brief description (max 500 chars). |
| `author` | `string` | ✅ | Author name (max 100 chars). |
| `catalystVersion` | `string` | ✅ | Minimum compatible Catalyst version. Supports `>=`, `>`, `=`, `<`, `<=`. |
| `permissions` | `string[]` | ❌ | Permission scopes the plugin requests. See [Permission Model](#permission-model). |
| `backend` | `object` | ❌ | `{ "entry": "backend/index.js" }` — path to backend module. |
| `frontend` | `object` | ❌ | `{ "entry": "frontend/index.ts" }` — path to frontend module. |
| `dependencies` | `Record<string, string>` | ❌ | Plugin name → version map. Validated at discovery. |
| `config` | `Record<string, any>` | ❌ | Free-form config schema. Types inferred by admin UI. |
| `events` | `Record<string, object>` | ❌ | Event name → `{ payload: object, description?: string }`. |

### Config Field Types

The admin UI infers field types from the config schema. Supported types:

| Type | UI Widget | Example |
|------|-----------|---------|
| `string` | Text input | `{"type":"string","default":"hello"}` |
| `number` | Number input | `{"type":"number","default":42}` |
| `boolean` | Toggle switch | `{"type":"boolean","default":true}` |
| `select` | Dropdown | `{"type":"select","options":[{"label":"A","value":"a"},{"label":"B","value":"b"}]}` |
| `text` | Textarea | `{"type":"text","default":"long text"}` |
| `password` | Password field (masked) | `{"type":"password","default":""}` |

> **Note:** The backend config is `Record<string, any>` (untyped). The SDK provides `defineConfig()` and `configField()` helpers for type-safe config definitions.

---

## Plugin Lifecycle

### Lifecycle Hooks

Each plugin backend module exports an object with up to four lifecycle hooks:

```javascript
// backend/index.js
export default {
  async onLoad(context) { /* ... */ },
  async onEnable(context) { /* ... */ },
  async onDisable(context) { /* ... */ },
  async onUnload(context) { /* ... */ },
};
```

| Hook | Called When | Use Case | Can Register Routes? | Can Modify DB? |
|------|-------------|----------|---------------------|----------------|
| `onLoad` | Plugin is discovered and loaded (before server starts) | Route registration, initial storage setup | ✅ Yes | ✅ Yes |
| `onEnable` | Admin enables the plugin (or server starts with plugin pre-enabled) | Start cron tasks, register WS handlers, initialize connections | ❌ No | ✅ Yes |
| `onDisable` | Admin disables the plugin | Stop tasks, close connections, cleanup | ❌ No | ✅ Yes |
| `onUnload` | Plugin is being removed from the registry | Final cleanup | ❌ No | ✅ Yes |

### Loading vs. Enabling

Plugins have a **two-phase loading** model:

1. **Load** → Routes are registered with Fastify, but they return `503 Service Unavailable` because `enabledRef.value = false`.
2. **Enable** → `enabledRef.value = true`, routes begin responding normally.

This means:
- Routes are always present in Fastify's route table (disabled or not).
- Disabling a plugin doesn't unregister routes — it just flips the gate.
- You can install (load) a plugin without enabling it, useful for development and staged rollouts.

### Discovery Process

The PluginLoader performs a three-pass discovery on startup and via file watching:

1. **Pass 1 — Read manifests**: Scans the plugins directory for `plugin.json` files. Validates each with Zod. Checks version compatibility against `CATALYST_VERSION` (`"1.0.0"`).
2. **Pass 2 — Validate dependencies**: Ensures all declared dependencies exist and their versions are compatible using semver comparison.
3. **Pass 3 — Topological sort**: Uses Kahn's algorithm with cycle detection. Plugins are loaded in dependency order. Circular dependencies are logged but not fatal — plugins in a cycle still load.

---

## Backend API

### Route Registration

Plugins register routes using `context.registerRoute()`. Routes support both Express-style and Fastify-style handlers:

```javascript
// Fastify-style (recommended)
ctx.registerRoute({
  method: 'GET',
  url: '/hello',
  handler: async (request, reply) => {
    return { success: true, message: 'Hello!' };
  },
});

// Express-style (legacy)
ctx.registerRoute({
  method: 'POST',
  url: '/echo',
  handler: async (request, reply, next) => {
    // request, reply, next (express-style)
    next();
  },
});
```

Route URL paths are **scoped under** `/api/plugins/{plugin-name}/`. For example, a route at `url: '/hello'` becomes `GET /api/plugins/my-plugin/hello`.

### Plugin Context

The `PluginBackendContext` object passed to all lifecycle hooks is a "god object" containing 30+ methods and properties:

| Property | Type | Description |
|----------|------|-------------|
| `manifest` | `PluginManifest` | Plugin metadata and config |
| `originalConfig` | `Record<string, any>` | Immutable snapshot of the original config schema |
| `db` | `ScopedPluginDB` | Database with table-level gating and field whitelists |
| `logger` | `Pino.Logger` | Structured logger |
| `wsGateway` | `WebSocketGateway` | WebSocket gateway (for custom handlers) |

| Method | Signature | Description |
|--------|-----------|-------------|
| `registerRoute()` | `(options: RouteOptions) => void` | Register an API route |
| `registerMiddleware()` | `(handler, options?) => void` | Register middleware (global or per-route) |
| `onWebSocketMessage()` | `(type: string, handler) => void` | Register WebSocket message handler (prefixed with `plugin:{name}:`) |
| `sendWebSocketMessage()` | `(target: string, message: any) => void` | Send message to a client (broadcast with `*` or specific client ID) |
| `scheduleTask()` | `(cron: string, handler) => void` | Register a cron task using `node-cron` syntax |
| `on()` | `(event: string, handler) => void` | Listen to Catalyst events |
| `emit()` | `(event: string, data: any) => void` | Emit a Catalyst event |
| `emitTyped()` | `(event: string, data: any) => void` | Emit with schema validation (warns, doesn't throw) |
| `getConfig()` | `(key: string) => any` | Get plugin config value |
| `setConfig()` | `(key: string, value: any) => Promise<void>` | Update plugin config value |
| `getStorage()` | `(key: string) => Promise<any>` | Persistent key-value storage |
| `setStorage()` | `(key: string, value: any) => Promise<void>` | Persistent key-value storage |
| `deleteStorage()` | `(key: string) => Promise<void>` | Remove storage key |
| `collection()` | `(name: string) => PluginCollectionAPI` | Create a typed collection (MongoDB-like API) |
| `getDeclaredEvents()` | `() => Record<string, any>` | Get declared event schemas |
| `exposeApi()` | `(name: string, handler) => void` | Expose a plugin-to-plugin RPC API |
| `callPluginApi()` | `(pluginName, apiName, params?) => Promise<any>` | Call another plugin's API |

### Scoped Database

The `ScopedPluginDB` provides a narrowed interface to the Prisma client. It's the most sophisticated security feature of the plugin system.

#### Table-Level Gating

Tables are accessed via getters that throw if permissions aren't granted:

```typescript
interface ScopedPluginDB {
  servers: PrismaServerSelect;   // requires server.read / server.write
  users: PrismaUserSelect;       // requires user.read / user.write
  pluginStorage: PrismaPluginStorage;
  plugin: PluginModel;           // read-only (update blocked at runtime)
  collection(name: string): PluginCollectionAPI;
}
```

**Blocked tables** (throw `Error` at `critical` level):
- `credentials`
- `apiKeys`
- `auditLogs`

**Blocked tables** (throw `Error` at `warn` level):
- `node`, `role`, `session`, `invite`

Any access to an unknown table falls through to a proxy that throws:
```typescript
// This throws: "Access to this resource is not allowed"
context.db.$doesNotExist;
```

#### Field-Level Write Whitelists

Even with `server.write` or `user.write` permissions, plugins can only modify specific fields:

```typescript
const SERVER_WRITE_WHITELIST = new Set(['status']);
const USER_WRITE_WHITELIST = new Set(['roleIds']);
```

#### Collection API

Collections provide a MongoDB-like document API backed by JSON arrays in the `pluginStorage` table:

```javascript
const tickets = context.db.collection('tickets');

// Find all open tickets for a server
const openTickets = await tickets.find({
  serverId: 'srv_123',
  status: 'open'
});

// Insert a new ticket
const ticket = await tickets.insert({
  serverId: 'srv_123',
  subject: 'Help!',
  body: 'My server is down',
  status: 'open',
  priority: 'high'
});

// Update with operators
await tickets.update(
  { _id: ticket._id },
  { $set: { status: 'resolved' } }
);

// Count
const count = await tickets.count({ status: 'open' });
```

Supported operators: `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$exists`, `$regex`, `$or`, `$and` (match engine)

Update operators: `$set`, `$unset`, `$inc`, `$push`, `$pull`

> ⚠️ **Scalability Warning:** Collections load the entire JSON array into memory for every query. For collections with thousands of documents, this can cause performance issues. Consider pagination at the application level.

#### SDK Typed Collections

The Plugin SDK provides `createTypedCollection<T>()` for type-safe collections:

```typescript
import { createTypedCollection } from '@catalyst/plugin-sdk';

interface Ticket {
  _id?: string;
  _createdAt?: string;
  _updatedAt?: string;
  serverId: string;
  subject: string;
  body: string;
  status: 'open' | 'resolved' | 'closed';
}

const tickets = createTypedCollection<Ticket>('tickets', context.db.collection('tickets'));

// Type-safe find
const result = await tickets.find({ serverId: 'srv_123' });
// result: Ticket[]
```

### Event System

Plugins can exchange events using a shared `EventEmitter`:

```javascript
// Listen to Catalyst events
ctx.on('server:started', async (data) => {
  ctx.logger.info(`Server ${data.serverId} started`);
});

ctx.on('server:stopped', async (data) => {
  ctx.logger.info(`Server ${data.serverId} stopped`);
});

// Emit custom events
ctx.emit('my-plugin:data-ready', { serverId: 'srv_123', count: 42 });

// Type-safe emit (validates against declared schema)
ctx.emitTyped('my-plugin:data-ready', { serverId: 'srv_123', count: 42 });
```

**Declared events** in the manifest enable schema validation:

```json
{
  "events": {
    "ticket:created": {
      "payload": { "ticketId": "string", "ticketNumber": "string" },
      "description": "A new ticket was created"
    }
  }
}
```

### WebSocket Integration

Plugin WebSocket messages are **namespaced** to prevent collisions:

```javascript
ctx.onWebSocketMessage('ping', async (data, clientId) => {
  // Messages arrive as `plugin:my-plugin:ping`
  ctx.sendWebSocketMessage(clientId, {
    type: 'pong',
    timestamp: new Date().toISOString(),
  });
});
```

- `ctx.sendWebSocketMessage('*', message)` — broadcast to all connected clients
- `ctx.sendWebSocketMessage(clientId, message)` — send to a specific client
- Message types are automatically prefixed: `plugin:{pluginName}:{type}`

### Task Scheduling

Tasks use `node-cron` for scheduling:

```javascript
// Runs every 5 minutes
ctx.scheduleTask('*/5 * * * *', async () => {
  ctx.logger.info('Running scheduled task');
  // Do work here
});
```

> ⚠️ **Ephemeral Tasks:** Tasks are registered in memory only. If the server restarts, tasks must be re-registered in `onEnable()`. There is no task persistence or retry logic.

### RPC (Plugin-to-Plugin)

Plugins can call each other's APIs via the registry:

```javascript
// Expose an API
ctx.exposeApi('getTickets', async (params) => {
  const tickets = await context.db.collection('tickets').find(params);
  return tickets;
});

// Call another plugin's API
const result = await ctx.callPluginApi('ticketing-plugin', 'getTickets', {
  serverId: 'srv_123',
});
```

Requirements:
- The calling plugin must declare the `plugin.rpc` permission
- Calls have a hardcoded 10-second timeout
- No retry or circuit breaker logic
- Errors propagate raw (no wrapping)

---

## Frontend Integration

### Admin Tabs

Plugins can add tabs to the admin panel sidebar. Each tab is a React component:

```typescript
// frontend/index.ts
import { AdminTab } from './components';

export const tabs = [
  {
    id: 'my-plugin-admin',
    label: 'My Plugin',
    icon: 'Puzzle',
    component: AdminTab,
    location: 'admin',
    order: 100,
    requiredPermissions: ['admin.read'],
  },
];
```

Tab properties:

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `id` | `string` | ✅ | Unique tab identifier |
| `label` | `string` | ✅ | Display name in sidebar |
| `icon` | `string` | ❌ | Lucide icon name |
| `component` | `React.ComponentType` | ✅ | The tab's React component |
| `location` | `'admin'` or `'server'` | ✅ | Where the tab appears |
| `order` | `number` | ❌ | Sort order (lower = first). Default: 50 |
| `requiredPermissions` | `string[]` | ❌ | Permissions required to see the tab |

### Server Tabs

Server tabs appear in server detail pages and receive a `serverId` prop:

```typescript
export const tabs = [
  {
    id: 'my-plugin-server',
    label: 'Plugin Panel',
    icon: 'Zap',
    component: ServerTab,
    location: 'server',
    order: 100,
    requiredPermissions: ['server.read'],
  },
];
```

The component receives `serverId` as a prop:

```tsx
export function ServerTab({ serverId }: { serverId: string }) {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    fetch(`/api/plugins/my-plugin/server-data/${serverId}`)
      .then(r => r.json())
      .then(setData);
  }, [serverId]);

  return <div>Server {serverId} data: {JSON.stringify(data)}</div>;
}
```

### Dynamic Routes

Plugins can register standalone pages accessible via `/{plugin-name}`:

```typescript
export const routes = [
  {
    path: '/my-plugin',
    component: UserPage,
    requiredPermissions: ['server.read'],
  },
];
```

Routes are rendered by `PluginRoutePage` which matches the route name against the registered routes:

```tsx
// PluginRoutePage.tsx
export default function PluginRoutePage() {
  const { pluginRouteName } = useParams<{ pluginRouteName: string }>();
  const routes = usePluginRoutes();
  const matched = routes.find((r) => r.path === `/${pluginRouteName}`);
  if (!matched) return <Navigate to="/dashboard" replace />;
  const Component = matched.component;
  return <Component />;
}
```

### Component Slots

Plugins can inject React components into designated areas (slots) in the host application:

```typescript
// frontend/index.ts
export const slots = {
  'server.header': HeaderComponent,
  'server.footer': FooterComponent,
};
```

Or use imperative registration:

```typescript
export function registerSlots() {
  return [
    { slot: 'server.header', component: HeaderComponent, order: 10 },
    { slot: 'server.footer', component: FooterComponent, order: 90 },
  ];
}
```

Slot components are sorted by `order` (lower first) and rendered in designated `usePluginSlots(slot)` locations throughout the app.

### Plugin Store (Zustand)

The frontend uses a Zustand store for plugin state:

```typescript
import { usePluginStore } from '~/plugins/store';

// Access state
const plugins = usePluginStore((state) => state.plugins);
const loading = usePluginStore((state) => state.loading);
const error = usePluginStore((state) => state.error);

// Actions
const setPlugins = usePluginStore((state) => state.setPlugins);
const addPlugin = usePluginStore((state) => state.addPlugin);
const removePlugin = usePluginStore((state) => state.removePlugin);
const updatePluginConfig = usePluginStore((state) => state.updatePluginConfig);

// Selectors
const getPlugin = usePluginStore((state) => state.getPlugin);
const getPluginsByLocation = usePluginStore((state) => state.getPluginsByLocation);
const getEnabledPlugins = usePluginStore((state) => state.getEnabledPlugins);
```

Config updates are **optimistic**: they call the API first, then update local state on success. There is no rollback on failure.

### React Hooks

| Hook | Return Type | Description |
|------|-------------|-------------|
| `usePlugins()` | `LoadedPlugin[]` | All loaded plugins |
| `useEnabledPlugins()` | `LoadedPlugin[]` | Enabled plugins only |
| `usePlugin(name)` | `LoadedPlugin \| undefined` | Specific plugin by name |
| `usePluginRoutes()` | `PluginRouteConfig[]` | All routes from enabled plugins |
| `usePluginTabs(location)` | `PluginTabConfig[]` | Tabs for `'admin'` or `'server'` location |
| `usePluginComponents(slot)` | `React.ComponentType[]` | Components for a slot |
| `usePluginLoading()` | `{ loading: boolean, error: string \| null }` | Loading state |
| `usePluginContext()` | `PluginContextValue` | Full context (throw if outside Provider) |

All hooks use `useMemo()` for performance. Components returned from `usePluginComponents()` are sorted by `order`.

---

## Plugin SDK

### Installation & Scaffolding

The Plugin SDK lives in `packages/plugin-sdk/` and provides scaffolding, types, and utilities.

```bash
# Scaffold a new plugin
cd packages/plugin-sdk
npx @catalyst/plugin-sdk create my-plugin --template fullstack
```

### SDK Templates

| Template | Description | Use Case |
|----------|-------------|----------|
| `backend-only` | API routes + WebSocket handlers only | Backend integrations, data processing |
| `fullstack` | Backend + frontend tabs + components | Interactive plugins with UI |
| `minimal` | Single manifest + entry point | Simple functionality |

### SDK Exports

From `@catalyst/plugin-sdk`:

| Export | Type | Description |
|--------|------|-------------|
| `PluginManifest` | interface | Plugin manifest type |
| `PluginLifecycle` | interface | Lifecycle hook types |
| `PluginCollectionAPI` | interface | Raw collection API |
| `PluginRouteHandler` | type | Route handler signature |
| `PluginMiddlewareHandler` | type | Middleware handler signature |
| `PluginWebSocketHandler` | type | WS handler signature |
| `PluginTaskHandler` | type | Cron task handler signature |
| `PluginEventHandler` | type | Event handler signature |

#### Config Definitions

```typescript
import { defineConfig, configField } from '@catalyst/plugin-sdk/config';

const config = defineConfig({
  apiKey: configField({
    type: 'string',
    default: '',
    description: 'API key for external service',
  }),
  enabled: configField({
    type: 'boolean',
    default: true,
    description: 'Enable the plugin',
  }),
  maxItems: configField({
    type: 'number',
    default: 100,
    min: 1,
    max: 1000,
  }),
  priority: configField({
    type: 'select',
    default: 'medium',
    options: [
      { label: 'Critical', value: 'critical' },
      { label: 'High', value: 'high' },
      { label: 'Medium', value: 'medium' },
      { label: 'Low', value: 'low' },
    ],
  }),
});

// Convert to Zod schema for validation
import { createConfigSchema } from '@catalyst/plugin-sdk/config';
const zodSchema = createConfigSchema(config);
```

#### Route Builder

```typescript
import { defineRoutes } from '@catalyst/plugin-sdk/routes';

const routes = defineRoutes((router) => {
  router
    .get('/hello', async (req, reply) => ({ message: 'Hello!' }))
    .post('/echo', async (req, reply) => ({ echoed: req.body }))
    .put('/update', async (req, reply) => ({ updated: true }))
    .del('/delete', async (req, reply) => ({ deleted: true }));
});
```

#### Typed Collections

```typescript
import { createTypedCollection } from '@catalyst/plugin-sdk/storage';

interface Ticket {
  _id?: string;
  _createdAt?: string;
  _updatedAt?: string;
  subject: string;
  status: 'open' | 'closed';
}

const tickets = createTypedCollection<Ticket>('tickets', collection);

// Type-safe operations
const open = await tickets.find({ status: 'open' });
const created = await tickets.insert({ subject: 'Help', status: 'open' });
const updated = await tickets.update({ _id: created._id }, { $set: { status: 'closed' } });
```

### Testing Utilities

```typescript
import {
  createTestPlugin,
  createMockLogger,
  createMockContext,
  TestPluginHarness,
} from '@catalyst/plugin-sdk/testing';

// Create a mock context with scoped DB, logger, etc.
const mockContext = createMockContext();

// Create a test harness
const harness = createTestPlugin(myPlugin, manifest, config);
const loaded = await harness.load();

// Assert routes were registered
assert(loaded.context.registerRoute.calls.length > 0);

// Test lifecycle
await harness.enable();
await harness.disable();
await harness.unload();
```

---

## Plugin Security

### Permission Model

Plugins declare required permissions in their manifest. The scoped DB enforces these at runtime via table-level gating.

| Permission | Tables Accessible | Fields Modifiable |
|------------|-------------------|-------------------|
| `server.read` | `servers` (read only) | None |
| `server.write` | `servers` (read + limited write) | `status` only |
| `user.read` | `users` (read only) | None |
| `user.write` | `users` (read + limited write) | `roleIds` only |
| `admin.read` | Admin data (read) | None |
| `admin.write` | Admin data (read + limited write) | None |
| `plugin.rpc` | Enables plugin-to-plugin API calls | N/A |

**Wildcard permissions** (`server.*`) apply to user-level permissions but NOT to plugin permissions (which use exact matching).

### Database Scoping

The `ScopedPluginDBClient` enforces security through:

1. **Getter-based table access** — Unknown tables throw `Access denied`.
2. **Whitelist-based writes** — Only `status` on servers and `roleIds` on users are writable.
3. **Explicitly blocked tables** — `credentials`, `apiKeys`, `auditLogs` are never accessible.
4. **Proxy catch-all** — Any unknown property access falls through to a proxy that throws.

> ⚠️ **Security Gap:** The `select` spread in `findMany`/`findUnique` allows plugins to override restricted field selections. A plugin with `server.read` can potentially read fields beyond the whitelisted projection.

### Error Isolation

**Backend:**
- Each plugin runs in the same Node.js process. A plugin that throws an unhandled exception can crash the entire server.
- Route handlers are wrapped with `enabledRef` checks, but errors within handlers propagate up to Fastify's error handler.
- The `onEnable`/`onDisable` lifecycle hooks don't have try/catch wrapping — errors there toggle the enabled ref back but may leave partial state.

**Frontend:**
- Plugin frontend components share the main React tree. A crash in a plugin component can crash the entire page.
- No error boundaries are placed around dynamically loaded plugin components.
- The `PluginProvider` does catch errors during frontend loading and reports them via `reportSystemError()`, but the failed component is not rendered (it returns empty arrays for tabs/routes/components).

### Path Validation

Plugin entry paths in the manifest are NOT validated for path traversal at the frontend discovery level. The `loader.ts` uses `import.meta.glob()` which is resolved at build time. Backend entry paths are validated via `path.resolve()` against the canonical plugins directory before loading.

---

## Hot Reload

The PluginLoader uses `chokidar` to watch the plugins directory for file changes:

```typescript
this.watcher = watch(this.pluginsDir, {
  persistent: true,
  ignoreInitial: true,
  depth: 2,
});
```

When a file changes, the loader:
1. Extracts the plugin name from the file path
2. Unloads the plugin (calls `onUnload`)
3. Clears the Node.js module cache (`delete require.cache[...]`)
4. Re-imports the backend module
5. Re-registers routes and handlers
6. Re-enables the plugin if it was previously enabled

**Known limitations:**
- ESM modules cannot be reliably cache-invalidated (Node.js doesn't expose a public API for this). Hot-reload works inconsistently for ESM plugins.
- A full server restart is recommended after making structural changes to ESM plugins.
- The path extraction (`path.basename(path.dirname(filePath))`) is fragile for deeply nested files.

To enable hot reload, ensure the PluginLoader is initialized with `hotReload: true`.

---

## Known Limitations

| Issue | Impact | Workaround |
|-------|--------|------------|
| No true process isolation | A plugin crash can take down the server | Write defensive error handling in plugins |
| Frontend bundled at build time | Cannot install new plugins without rebuilding | Pre-bundle all plugins; use filesystem discovery |
| ESM hot-reload unreliable | Changes may not reload without restart | Use CJS for dev; restart for prod changes |
| Collection storage not scalable | O(n) queries over JSON arrays | Limit collection size; implement pagination |
| No row-level security | Plugins with `server.read` see ALL servers | Filter results at the application level |
| Task scheduling is ephemeral | Tasks lost on server restart | Re-register tasks in `onEnable()` |
| No plugin marketplace | Plugins only discovered from filesystem | Maintain a curated list of plugins |
| Config type mismatch | Backend uses `Record<string, any>`, frontend expects `Record<string, PluginConfigField>` | Ensure consistency between backend and frontend config types |
| No plugin testing harness (in production) | No built-in way to test plugins against a real DB | Use the SDK's `createTestPlugin` in dev |
| No circuit breaker for RPC | A slow plugin can block the caller for 10s | Keep plugin APIs fast; implement timeouts |

---

## Example Plugins

### Example Plugin

Location: `catalyst-plugins/example-plugin/`

Demonstrates all plugin capabilities:

**Features:**
- 3 custom API routes (`/hello`, `/echo`, `/stats`)
- WebSocket message handler (`plugin_example_ping` → `plugin_example_pong`)
- Cron task (runs every 5 minutes)
- Event listeners (`server:started`, `server:stopped`)
- Express-style middleware
- Frontend admin tab with stats display
- Frontend server tab with echo test
- Persistent storage (`initialized`, `installDate`, `taskRunCount`, `lastTaskRun`)

**Manifest:**
```json
{
  "name": "example-plugin",
  "version": "1.0.0",
  "displayName": "Example Plugin",
  "permissions": ["server.read", "server.write", "admin.read", "console.read"],
  "config": {
    "greeting": { "type": "string", "default": "Hello from Example Plugin!" },
    "cronEnabled": { "type": "boolean", "default": true },
    "webhookUrl": { "type": "string", "default": "" }
  }
}
```

### Ticketing Plugin

Location: `catalyst-plugins/ticketing-plugin/`

A production-grade ticketing system demonstrating complex plugin patterns:

**Features:**
- Full CRUD for tickets, comments, tags, templates
- Activity logging system
- SLA tracking with configurable deadlines
- Bulk operations
- CSV/JSON export
- Auto-assignment logic
- Status transition validation
- WebSocket broadcasting for real-time updates
- 9 declared typed events
- Admin UI tabs for ticket management

**Manifest:**
```json
{
  "name": "ticketing-plugin",
  "version": "2.0.0",
  "permissions": ["server.read", "user.read"],
  "config": {
    "autoAssignEnabled": { "type": "boolean", "default": false },
    "autoCloseDays": { "type": "number", "default": 30 },
    "defaultPriority": { "type": "select", "options": ["critical","high","medium","low","minimal"] },
    "responseSlaHours": { "type": "number", "default": 4 },
    "resolutionSlaHours": { "type": "number", "default": 48 }
  }
}
```

**Events declared:**
- `ticket:created`, `ticket:updated`, `ticket:deleted`, `ticket:comment-added`
- `ticket:status-changed`, `ticket:assigned`, `ticket:escalated`
- `ticket:sla-breached`, `ticket:bulk-updated`

**Backend size:** ~1,471 lines (one of the most complex plugins)

### Egg Explorer Plugin

Location: `catalyst-plugins/egg-explorer/`

A data-fetching plugin that integrates with external APIs:

**Features:**
- GitHub API client with rate-limit handling
- Background indexing with tree SHA caching
- Token-based authentication (config key `ghToken`)
- Cron-scheduled sync
- Self-throttling based on API rate limits
- Graceful degradation (cached data when API unavailable)

**Patterns demonstrated:**
- Using `ctx.getStorage()` for caching (tree SHA, blob SHAs, egg index)
- Module-level state (`let eggIndex = null`, `let isSyncing = false`)
- Rate limit monitoring and throttling

---

## Development Workflow

### Project Structure

```
catalyst-plugins/my-plugin/
├── plugin.json           # Manifest (required)
├── README.md             # Documentation (recommended)
├── backend/
│   └── index.js          # Lifecycle hooks + route registration
├── frontend/
│   ├── index.ts          # Tab/route/slot definitions
│   └── components.tsx    # React components
└── package.json          # Plugin dependencies (optional)
```

### Development Steps

1. **Create the manifest** — Define name, version, permissions, config, and entry points.
2. **Implement backend** — Register routes in `onLoad`, register handlers in `onEnable`.
3. **Implement frontend** — Export tabs, routes, or slot components.
4. **Test** — Enable the plugin in the admin panel and verify routes/handlers.
5. **Hot reload** — File changes are detected automatically (ESM plugins may require restart).

### Deployment Steps

1. Place the plugin directory in `catalyst-plugins/` (or ensure it's on the plugins search path).
2. Ensure the manifest is valid (Zod validation on discovery).
3. Restart the backend to trigger discovery (or use the API to reload).
4. Enable the plugin via admin panel or API: `POST /api/plugins/{name}/enable`.

### Plugin Directory Location

The PluginLoader is initialized with a hardcoded path traversal (`../../..`) to reach `catalyst-plugins` from `dist/index.js`. This assumes:
- The plugin directory is at the monorepo root level
- The backend builds from `catalyst-backend/dist/`

> ⚠️ **Fragility:** This path is hardcoded. Moving the plugins directory requires updating the path in `catalyst-backend/src/index.ts`.

---

## Cross-References

- [Plugin System Analysis](./plugin-system-analysis.md) — Internal architecture deep dive
- [Plugin System Gaps](./plugin-system-gaps.md) — Identified gaps and recommended improvements
- [Plugin System Improvement Report](./plugin-system-improvement-report.md) — Detailed improvement plan
- [API Reference](./api-reference.md) — Plugin management endpoints (`/api/plugins/*`)
- [Architecture Overview](./architecture.md) — System design and component relationships
- [Security Policy](./SECURITY.md) — Security model for the entire platform
