# @catalyst/plugin-sdk

Official SDK for building Catalyst plugins (backend + frontend).

## Installation

The SDK is **not published to npm** — it is a workspace package inside this
monorepo, and plugins consume it in two ways:

- **Frontend plugin code** imports `@catalyst/plugin-sdk/frontend`. The panel's
  Vite config aliases that specifier to `packages/plugin-sdk/src/frontend/index.ts`
  (`catalyst-frontend/vite.config.ts`), so plugin frontends bundled by the panel
  need no install step.
- **Authoring / standalone builds** use the built package. Build it first:

  ```bash
  pnpm install
  pnpm --filter @catalyst/plugin-sdk run build        # tsc → packages/plugin-sdk/dist
  pnpm --dir packages/plugin-sdk/cli run build       # → packages/plugin-sdk/cli/dist
  ```

  Backend plugin code receives its `context` from the host and needs no SDK
  import at runtime.

Peer dependencies (both optional): `fastify` ^5, `react` ^19.

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
| `@catalyst/plugin-sdk/licensing` | `activateLicense`, `loadLicensedModule` (uses `node:crypto`; not re-exported from the root) |

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
  // Host slots: dashboard-widgets, server-header-stats, profile-connections
  components: [
    { slot: 'dashboard-widgets', component: MyWidget, order: 50 },
  ],
  onMount: () => console.log('frontend loaded'),
});
```

## CLI

The CLI lives in `packages/plugin-sdk/cli` (`@catalyst/plugin-sdk-cli`, bin
`catalyst-plugin`) and is not published. Build it, then run it from the repo:

```bash
pnpm --dir packages/plugin-sdk/cli run build

node packages/plugin-sdk/cli/dist/index.js create my-plugin --template fullstack
# templates: backend-only (default) | fullstack | minimal
node packages/plugin-sdk/cli/dist/index.js build
node packages/plugin-sdk/cli/dist/index.js test
node packages/plugin-sdk/cli/dist/index.js pack      # → <name>-<version>.catpkg.zip + .sha256
```

Drop the plugin directory into `catalyst-plugins/` and restart the panel to load
it.

## Storage engines

`createTypedCollection` writes through one of two per-plugin engines: `legacy`
(the default, one JSON array per collection) or `"storageEngine": "dedicated"`
(one row per document). Filters and the `$set`/`$unset`/`$inc`/`$push`/`$pull`
operators behave identically on both — see
[catalyst-backend/src/plugins/storage/README.md](../../catalyst-backend/src/plugins/storage/README.md).

## Isolation

`"runtime": "isolated"` is **rejected at load time**. The backend refuses to
import a plugin that declares it, because worker-thread isolation cannot yet
proxy the full plugin context (`catalyst-backend/src/plugins/loader.ts`). Ship
plugins without a `runtime` field, or set `"runtime": "legacy"`.

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
