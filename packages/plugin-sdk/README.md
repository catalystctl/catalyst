# @catalyst/plugin-sdk

Official SDK for building Catalyst plugins (backend + frontend).

## Installation

```bash
npm install @catalyst/plugin-sdk
# peer (optional): fastify, react
```

## Package entry points

| Import | Purpose |
|--------|---------|
| `@catalyst/plugin-sdk` | Config, routes, typed collections, typed context, types |
| `@catalyst/plugin-sdk/frontend` | `createFrontendPlugin`, `createPluginApi`, `PluginErrorBoundary` |
| `@catalyst/plugin-sdk/testing` | Mock context + lifecycle harness |
| `@catalyst/plugin-sdk/config` | `defineConfig`, `configField`, `createConfigSchema` |
| `@catalyst/plugin-sdk/routes` | `defineRoutes`, `PluginRouteBuilder` |
| `@catalyst/plugin-sdk/storage` | `createTypedCollection` |
| `@catalyst/plugin-sdk/context` | `createTypedContext`, `defineTypedContext` |

## Quick start (backend)

```typescript
import { defineRoutes } from '@catalyst/plugin-sdk';

export default {
  async onLoad(context) {
    const routes = defineRoutes((router) => {
      router.get('/hello', async () => {
        // getConfig returns resolved VALUES (defaults), not schema objects
        const greeting = context.getConfig('greeting') ?? 'Hello!';
        return { success: true, message: greeting };
      });
    });
    for (const route of routes) context.registerRoute(route);
  },

  async onEnable(context) {
    // Host emits server:started / server:stopped from power routes
    context.on('server:started', async ({ serverId }) => {
      context.logger.info({ serverId }, 'server up');
    });

    // Prefer context.getUserId(request) — host auth uses request.user.userId
    context.scheduleTask('*/5 * * * *', async () => {
      /* … */
    });
  },
};
```

### Auth + permissions helpers

```typescript
context.registerRoute({
  method: 'POST',
  url: '/admin-action',
  preHandler: context.requirePermission('admin.write'),
  handler: async (request, reply) => {
    const userId = context.getUserId(request);
    return { success: true, userId };
  },
});
```

### Typed context

```typescript
import { z } from 'zod';
import { createTypedContext } from '@catalyst/plugin-sdk';

const configSchema = { greeting: z.string().default('Hi') };
const events = { 'task-done': z.object({ id: z.string() }) };

export default {
  async onLoad(raw) {
    const ctx = createTypedContext(raw, configSchema, events);
    ctx.getConfig('greeting'); // string
  },
};
```

## Quick start (frontend)

```typescript
import { createFrontendPlugin, createPluginApi } from '@catalyst/plugin-sdk/frontend';
import { AdminTab } from './components';

const api = createPluginApi('my-plugin');

export default createFrontendPlugin({
  manifest: {
    name: 'my-plugin',
    version: '1.0.0',
    displayName: 'My Plugin',
    description: '…',
    author: 'You',
  },
  tabs: [
    { id: 'my-plugin', label: 'My Plugin', component: AdminTab, location: 'admin' },
  ],
  // Host slots: dashboard-widgets, sidebar-bottom
  components: [
    { slot: 'dashboard-widgets', component: MyWidget, order: 50 },
  ],
  onMount: () => console.log('frontend loaded'),
});
```

## CLI

```bash
npx @catalyst/plugin-sdk-cli create my-plugin --template fullstack
cd my-plugin && npm install && npm run build
# drop into catalyst-plugins/ and restart the panel
```

## Storage engines

| Engine | Manifest | Notes |
|--------|----------|-------|
| `legacy` (default) | omit | JSON array in one PluginStorage row — fine under ~1k docs |
| `dedicated` | `"storageEngine": "dedicated"` | One Postgres row per document — use for production CRUD |

Collection filters support dotted paths (`sla.resolutionBreached`) and `$set` with dotted keys.

## Isolation

`"runtime": "isolated"` is **accepted in the manifest but forced to in-process** today.
Worker-thread isolation is not production-ready; do not rely on process isolation for security.

## Testing

```typescript
import { createTestPlugin } from '@catalyst/plugin-sdk/testing';

const harness = createTestPlugin(myPlugin, manifest, {
  greeting: { type: 'string', default: 'Hi' }, // schema objects are unwrapped
});
const ctx = await harness.load();
await harness.enable();
```

## Known host contracts

1. **Config** — `getConfig` returns plain values; admin UI still gets the schema via `configSchema`.
2. **Auth** — `request.user.userId` (use `context.getUserId`).
3. **Routes** — registered relative (`/hello`); host prefixes `/api/plugins/<name>/`.
4. **Cron** — re-register in `onEnable`; host stops + clears on disable.
5. **Frontend** — build-time `import.meta.glob`; plugins must be present when the panel frontend is built.
