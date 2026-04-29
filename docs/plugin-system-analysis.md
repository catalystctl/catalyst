# Catalyst Plugin System — Deep Architectural Analysis

## 1. Plugin Types & Interfaces

### Core Type System (`catalyst-backend/src/plugins/types.ts`)

The type system is extensive (500+ lines) and defines the contract between Catalyst and its plugins. It is organized into several conceptual layers:

#### 1.1 Scoped Database Interface (`ScopedPluginDB`)
The most critical abstraction. Instead of giving plugins raw `PrismaClient` access, Catalyst exposes a narrowed interface:

```typescript
interface ScopedPluginDB {
  servers: { findMany, findUnique, count, update };
  users: { findMany, findUnique, count, update };
  pluginStorage: { findUnique, upsert, deleteMany, findMany };
  plugin: { findUnique, update }; // Note: update is blocked at runtime
  collection(name: string): PluginCollectionAPI;
}
```

**Key decisions:**
- `any` types on `findMany`/`findUnique` args allow plugins to pass Prisma query objects while hiding the actual Prisma types. This is pragmatic but loses type safety.
- `update` operations on `servers` and `users` require specific `server.write`/`user.write` permissions and enforce a field-level whitelist.
- `collection()` provides a MongoDB-like document API backed by Prisma's JSON field storage.

#### 1.2 PluginCollectionAPI
A document-oriented API layered on top of relational storage:

```typescript
interface PluginCollectionAPI {
  find(filter?: any, options?: PluginCollectionOptions): Promise<any[]>;
  findOne(filter: any): Promise<any | null>;
  insert(doc: any): Promise<any>;
  update(filter: any, update: any): Promise<number>;
  delete(filter: any): Promise<number>;
  count(filter?: any): Promise<number>;
}
```

**Trade-off:** This provides a familiar NoSQL API for plugin developers but stores everything in a single `pluginStorage` table as JSON arrays, which has severe scalability implications (see Section 3).

#### 1.3 PluginManifest
The single source of truth for plugin metadata:

```typescript
interface PluginManifest {
  name: string;              // Plugin identifier (kebab-case)
  version: string;           // Semver
  displayName: string;
  description: string;
  author: string;
  catalystVersion: string;   // Compatibility requirement
  permissions: string[];     // Declared permission scopes
  backend?: { entry: string };
  frontend?: { entry: string };
  dependencies?: Record<string, string>;
  config?: Record<string, any>;
  events?: Record<string, PluginEventSchema>;
}
```

**Design decisions:**
- `config` is a free-form `Record<string, any>` rather than a typed schema, meaning the admin UI must infer types.
- `permissions` is a flat string array (`['server.read', 'user.write']`) with no hierarchy or inheritance.
- `catalystVersion` supports simple semver range operators (`>=`, `>`, `=`, `<`, `<=`).

#### 1.4 PluginBackendContext
The primary API surface for backend plugins — 30+ methods:

```typescript
interface PluginBackendContext {
  manifest: PluginManifest;
  originalConfig?: Record<string, any>;  // Immutable reference to schema
  db: ScopedPluginDB;
  logger: Logger;
  wsGateway: WebSocketGateway;
  registerRoute(options: RouteOptions): void;
  registerMiddleware(handler: any, options?: { scope?: 'global' | 'route' }): void;
  onWebSocketMessage(type: string, handler: PluginWebSocketHandler): void;
  sendWebSocketMessage(target: string, message: any): void;
  scheduleTask(cron: string, handler: PluginTaskHandler): void;
  on(event: string, handler: PluginEventHandler): void;
  emit(event: string, data: any): void;
  getConfig<T = any>(key: string): T | undefined;
  setConfig<T = any>(key: string, value: T): Promise<void>;
  getStorage/setStorage/deleteStorage: Promise<T>;
  collection(name: string): PluginCollectionAPI;
  getDeclaredEvents(): Record<string, PluginEventSchema> | undefined;
  emitTyped(event: string, data: any): void;
  exposeApi(name: string, handler: (params: any) => Promise<any>): void;
  callPluginApi(pluginName: string, apiName: string, params?: any): Promise<any>;
}
```

**Analysis:** This is a "god object" context — convenient for plugin authors but tightly couples plugins to Catalyst internals. No inversion of control; plugins depend directly on the provided implementation.

#### 1.5 LoadedPlugin
The runtime representation of a loaded plugin:

```typescript
interface LoadedPlugin {
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
  originalHandlers?: Map<string, RouteOptions['handler']>;
  enabledRef?: { value: boolean };
}
```

**Key design:** The `enabledRef` is a mutable object reference used as a gate for route handlers — when disabled, routes return 503. This is clever but means route handlers are always wrapped with a runtime check, adding overhead to every request.

#### 1.6 PluginBackend Lifecycle

```typescript
interface PluginBackend {
  onLoad?(context: PluginBackendContext): Promise<void> | void;
  onEnable?(context: PluginBackendContext): Promise<void> | void;
  onDisable?(context: PluginBackendContext): Promise<void> | void;
  onUnload?(context: PluginBackendContext): Promise<void> | void;
}
```

Four lifecycle hooks. `onLoad` is called before the server starts (route registration happens here). `onEnable` is called when the admin enables the plugin. This two-phase loading enables "install without enable" semantics.

#### 1.7 Frontend Types (`catalyst-frontend/src/plugins/types.ts`)

```typescript
interface PluginManifest {
  name: string;
  version: string;
  displayName: string;
  description: string;
  author: string;
  status: string;
  enabled: boolean;
  loadedAt?: string;
  enabledAt?: string;
  error?: string;
  permissions: string[];
  hasBackend: boolean;
  hasFrontend: boolean;
  config?: Record<string, PluginConfigField>;
  dependencies?: string[];
  events?: PluginEventConfig[];
  routes?: Record<string, string>;
}
```

**Notable divergence:** The frontend `PluginManifest` has a different `config` type (`PluginConfigField`) than the backend (`Record<string, any>`), indicating a type mismatch between backend and frontend representations. This suggests the config schema is inferred by the frontend rather than validated by the backend.

---

## 2. PluginLoader

### 2.1 Architecture

`PluginLoader` is a singleton orchestrator class that manages the entire plugin lifecycle. It is initialized in `catalyst-backend/src/index.ts` with:

```typescript
const pluginLoader = new PluginLoader(
  path.join(__dirname, '..', '..', '..', 'catalyst-plugins'),
  prisma, logger, wsGateway, fastify,
  { hotReload: true }
);
```

**Design decision:** Hardcoded `../../..` path traversal to reach `catalyst-plugins` from `dist/index.js`. This is fragile and assumes a specific directory structure.

### 2.2 Discovery Algorithm (Three-Pass)

The discovery process is sophisticated:

1. **Pass 1 — Read manifests:** Read all `plugin.json` files, validate with Zod, check version compatibility against `CATALYST_VERSION` (hardcoded `'1.0.0'`).
2. **Pass 2 — Validate dependencies:** Check that all declared dependencies exist and versions are compatible using `validateDependencies()`.
3. **Pass 3 — Topological sort:** Uses Kahn's algorithm with cycle detection. Circular dependencies are logged but plugins are still loaded in partial order.

```typescript
private topologicalSort(entries): typeof entries {
  // Kahn's algorithm
  // If cycle detected, logs error and adds cycle members anyway
}
```

**Trade-off:** Loading plugins with circular dependencies (rather than failing entirely) is pragmatic for development but dangerous in production.

### 2.3 Plugin Loading (`loadPlugin`)

The loading process:

1. Path traversal prevention: `path.resolve()` check against canonical base
2. Read and validate manifest
3. Version compatibility check (redundant — already checked in discovery)
4. Create `LoadedPlugin` instance with `enabledRef = { value: false }`
5. Snapshot `originalConfig` via `JSON.parse(JSON.stringify(manifest.config))`
6. Upsert plugin record in database
7. **Create plugin context** via `createPluginContext()`
8. Load backend module via dynamic `import()`
9. Call `onLoad()` lifecycle hook
10. **Apply middleware wrapping to routes:**
   - For each route, wrap handler with:
     - Global middleware chain execution
     - Enabled check via `enabledRef.value`
     - Original handler call
11. Register routes with Fastify
12. Register in `PluginRegistry`

**Key security decision:** Routes are registered with Fastify immediately, but the `enabledRef` gate means they return 503 until `enablePlugin()` is called. This is safer than dynamically registering/unregistering Fastify routes.

### 2.4 Plugin Enablement (`enablePlugin`)

```typescript
async enablePlugin(name: string): Promise<void> {
  // 1. Toggle enabledRef.value = true
  // 2. Call onEnable()
  // 3. Update database: enabled=true
}
```

**Race condition risk:** If `onEnable()` throws, the enabled ref is toggled back to false, but partial state changes (like scheduled task registration) may not be fully cleaned up.

### 2.5 Plugin Disabling (`disablePlugin`)

```typescript
async disablePlugin(name: string): Promise<void> {
  // 1. Toggle enabledRef.value = false
  // 2. Call onDisable()
  // 3. Stop scheduled tasks
  // 4. Unregister WS handlers
  // 5. Update database
}
```

**Inconsistency:** WS handlers are unregistered from the gateway on disable, but routes remain registered (just gated by `enabledRef`). This means a disabled plugin's routes still consume Fastify's route table.

### 2.6 Hot-Reload Implementation

Uses `chokidar` to watch the plugins directory:

```typescript
enableHotReload(): void {
  this.watcher = watch(this.pluginsDir, {
    persistent: true,
    ignoreInitial: true,
    depth: 2,
  });
  this.watcher.on('change', async (filePath) => {
    const pluginName = path.basename(path.dirname(filePath));
    await this.reloadPlugin(pluginName);
  });
}
```

**Critical issues:**
- `pluginName` extraction is fragile: `path.basename(path.dirname(filePath))` only works for files exactly 2 levels deep. The code has a fallback regex check but it's not reliable for all directory structures.
- No debouncing — every file change triggers a full reload (unload + clear module cache + load + re-enable if was enabled).
- ESM cache clearing is not supported by Node.js. The code attempts `delete require.cache[...]` but for ESM modules, this does nothing. The comment even admits: "For full ESM cache invalidation, a server restart is recommended."

### 2.7 Module Cache Clearing

```typescript
// Try CJS cache clearing
delete require.cache[require.resolve(backendPath)];
// Note: ESM cache clearing is limited. Node.js does not expose a public API...
```

**Impact:** Hot-reload is unreliable for ESM plugins (which is the default since the backend is `"type": "module"`). In practice, hot-reload mostly works for development but requires server restart for some changes.

---

## 3. PluginContext & ScopedDB

### 3.1 createPluginContext Factory

`createPluginContext()` is a factory function that constructs the `PluginBackendContext` object. It takes 11 parameters — a code smell indicating excessive coupling.

### 3.2 ScopedPluginDBClient

The database security layer is the most sophisticated part of the plugin system. Key mechanisms:

**Table-level gating via getters:**
```typescript
get servers() {
  if (!this.allowedTables.has('servers')) {
    throw new Error('Permission denied: servers access not declared');
  }
  // Return narrowed Prisma client
}
```

**Blocked tables:** `credentials`, `apiKeys`, `auditLogs` are explicitly blocked with `captureSystemError()` logging at `critical` level. `node`, `role`, `session`, `invite` are blocked at `warn` level.

**Field-level write whitelisting:**
```typescript
const SERVER_WRITE_WHITELIST = new Set(['status']);
const USER_WRITE_WHITELIST = new Set(['roleIds']);
```

Only `status` on servers and `roleIds` on users can be modified by plugins with write permissions. This is extremely restrictive but safe.

**Proxy-based catch-all:**
```typescript
get $() {
  return new Proxy({}, {
    get: () => { throw new Error('Access to this resource is not allowed'); }
  });
}
```

Any unknown table access falls through to the proxy.

**Limitations:**
- The `findMany`/`findUnique` on servers/users hardcodes a `select` object, but then spreads `...(args?.select || {})` which means plugins CAN override the restricted fields. This is a potential security bypass.
- The `any` typing on query args means the compiler can't catch unsafe queries.
- No row-level security — a plugin with `server.read` can read ALL servers, not just assigned ones.

### 3.3 PluginCollectionImpl

Collections are stored as JSON arrays in `pluginStorage` table:

```typescript
class PluginCollectionImpl implements PluginCollectionAPI {
  private storageKey: string;
  
  private async loadDocs(): Promise<any[]> {
    const storage = await this.prisma.pluginStorage.findUnique({
      where: { pluginName_key: { pluginName: this.pluginName, key: this.storageKey } },
    });
    return storage ? (Array.isArray(storage.value) ? storage.value : []) : [];
  }
}
```

**Scalability issue:** Every `find()` loads the ENTIRE collection into memory, filters in JavaScript, then optionally slices. For a collection with 10,000 documents, this loads the full 10K JSON array into memory every query.

**Match engine:** Custom `matchFilter()` implementation supports `$or`, `$and`, `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$exists`, `$regex` operators. This is impressive for a hand-rolled query engine but:
- `$regex` creates a new `RegExp` on every comparison
- No indexing — every query is O(n) over the full collection
- No query planner or optimization

**Update operators:** `$set`, `$unset`, `$inc`, `$push`, `$pull` are supported, similar to MongoDB.

### 3.4 Middleware Runner

```typescript
export async function runMiddleware(
  handler: (...args: any[]) => any,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (handler.length >= 3) {
    // Express-style: (req, res, next) with error-first callback
    await new Promise<void>((resolve, reject) => {
      const done = (err?: any) => {
        if (err) reject(err instanceof Error ? err : new Error(String(err)));
        else resolve();
      };
      // ...
    });
  } else {
    // Fastify-style: async (req, res) => void
    const result = handler(request, reply);
    if (result && typeof result === 'object' && typeof result.then === 'function') {
      await result;
    }
  }
}
```

**Dual-style support:** Both Express and Fastify middleware styles are supported via parameter count detection (`handler.length >= 3`). This is pragmatic for backward compatibility but fragile — arrow functions have `length === 0` regardless of actual parameters.

### 3.5 Event System

Plugins get access to a shared `EventEmitter` instance:

```typescript
on(event: string, handler: PluginEventHandler) {
  if (!eventHandlers.has(event)) {
    eventHandlers.set(event, new Set());
  }
  eventHandlers.get(event)?.add(handler);
  eventEmitter.on(event, handler);
}

emit(event: string, data: any) {
  eventEmitter.emit(event, data);
}
```

**Design:** Shared EventEmitter means plugins can emit events that other plugins listen to. The `emitTyped()` method does basic schema validation but only warns, never throws.

### 3.6 RPC System

Plugin-to-plugin RPC uses the `PluginRegistry` as a registry:

```typescript
exposeApi(name: string, handler: (params: any) => Promise<any>): void {
  registry.registerExposedApi(manifest.name, name, handler);
}

async callPluginApi(pluginName: string, apiName: string, params?: any): Promise<any> {
  if (!manifest.permissions.includes('plugin.rpc')) {
    throw new Error('Permission denied: plugin.rpc permission required');
  }
  // 10s timeout via Promise.race
}
```

**Limitations:**
- RPC is synchronous request/response only — no streaming, no callbacks
- 10s hardcoded timeout
- No circuit breaker or retry logic
- Error handling is basic — if the callee throws, the error propagates raw

### 3.7 WebSocket Integration

```typescript
onWebSocketMessage(type: string, handler: PluginWebSocketHandler) {
  const prefixedType = `plugin:${manifest.name}:${type}`;
  wsGateway.registerPluginWsHandler(prefixedType, handler, manifest.name);
}
```

Messages are namespaced with `plugin:{pluginName}:{type}` to prevent collisions.

**sendWebSocketMessage:** Supports broadcast (`target === '*'`) or individual client targeting. The individual client targeting directly accesses `(wsGateway as any).clients?.get?.(target)` — type unsafe and depends on internal gateway structure.

### 3.8 Task Scheduling

Uses `node-cron` for cron-based task scheduling:

```typescript
scheduleTask(cronExpression: string, handler: PluginTaskHandler) {
  const job = cron.schedule(cronExpression, async () => {
    try {
      await handler();
    } catch (error) {
      // Log and continue
    }
  });
}
```

**Issues:**
- No task persistence — if the server restarts, scheduled tasks are lost unless plugins re-register them in `onEnable()`
- No task history or retry logic
- Tasks run in the main event loop — a long-running task blocks other operations
- No rate limiting or concurrency control on tasks

---

## 4. Validator

### 4.1 Manifest Schema (Zod)

```typescript
export const PluginManifestSchema = z.object({
  name: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  displayName: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  author: z.string().min(1).max(100),
  catalystVersion: z.string().min(1),
  permissions: z.array(z.string()).default([]),
  backend: z.object({ entry: z.string() }).optional(),
  frontend: z.object({ entry: z.string() }).optional(),
  dependencies: z.record(z.string(), z.string().regex(/^\d+\.\d+\.\d+$/)).optional(),
  config: z.record(z.string().regex(CONFIG_KEY_REGEX), z.any()).optional(),
  events: z.record(z.string(), z.object({ payload: z.record(z.string(), z.any()), description: z.string().optional() })).optional(),
});
```

**Strengths:**
- Comprehensive validation with clear error messages
- Config keys validated with regex (`^[a-zA-Z][a-zA-Z0-9_-]{0,50}$`)
- Dependency versions strictly require semver format

**Weaknesses:**
- `z.any()` for config values and event payloads means no deep validation
- No validation that backend/frontend entry paths are safe (path traversal risk in entry path)
- `permissions` is just an array of strings — no validation against known permission set

### 4.2 Version Compatibility

```typescript
export function isVersionCompatible(required: string, current: string): boolean {
  const match = required.match(/^([><=]+)?\s*(\d+\.\d+\.\d+)$/);
  // Supports >=, >, =, <, <=
}
```

**Limitation:** Does not support caret (`^`) or tilde (`~`) semver ranges. Plugins must specify exact operators.

### 4.3 Permission Checking

```typescript
export function hasPermission(userPermissions: string[], requiredPermissions: string[]): boolean {
  if (userPermissions.includes('*')) return true;
  return requiredPermissions.every((required) => {
    if (userPermissions.includes(required)) return true;
    // Check wildcard permissions (e.g., 'server.*' matches 'server.start')
    const parts = required.split('.');
    for (let i = parts.length; i > 0; i--) {
      const wildcardPerm = `${parts.slice(0, i).join('.')}.*`;
      if (userPermissions.includes(wildcardPerm)) return true;
    }
    return false;
  });
}
```

**Issue:** Wildcard checking is only implemented for user permissions, not for the plugin permission system. The `ScopedPluginDBClient` uses exact permission matching (`permissions.has('server.write')`).

### 4.4 Circular Dependency Detection

`detectCircularDependencies()` uses DFS with recursion stack tracking. It's defined but NOT used in `PluginLoader` — the loader uses Kahn's algorithm instead. The function appears to be dead code.

---

## 5. Registry

### 5.1 PluginRegistry

`PluginRegistry extends EventEmitter` and stores plugins in a `Map<string, LoadedPlugin>`.

**Key methods:**
- `register(plugin)` — emits `plugin:registered`
- `unregister(name)` — removes plugin and all exposed APIs, emits `plugin:unregistered`
- `get(name)`, `getAll()`, `getByStatus(status)`, `has(name)`
- `updateStatus(name, status)` — emits `plugin:status-changed`
- `getEnabled()`, `getManifests()`
- `clear()` — clears all plugins and APIs

**RPC API storage:**
```typescript
private exposedApis: Map<string, Map<string, (params: any) => Promise<any>>> = new Map();
```

**Design:** Simple nested Map structure. No versioning of APIs, no deprecation mechanism, no usage tracking.

---

## 6. Plugin Routes (Backend API)

`catalyst-backend/src/routes/plugins.ts` provides the admin REST API for plugin management.

### 6.1 Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/plugins` | GET | admin.read | List all plugins |
| `/api/plugins/:name` | GET | admin.read | Plugin details |
| `/api/plugins/:name/enable` | POST | admin.write | Enable/disable |
| `/api/plugins/:name/reload` | POST | admin.write | Hot-reload |
| `/api/plugins/:name/config` | PUT | admin.write | Update config |
| `/api/plugins/:name/frontend-manifest` | GET | authenticated | Frontend manifest |

### 6.2 Admin Permission Check

```typescript
const ensureAdmin = (request: any, reply: FastifyReply, requiredPermission: 'admin.read' | 'admin.write' = 'admin.read') => {
  const perms: string[] = request.user?.permissions ?? [];
  const isAdmin = perms.includes('*') || perms.includes('admin.write') || (requiredPermission === 'admin.read' && perms.includes('admin.read'));
  // ...
};
```

**Issue:** `request: any` — the request object is untyped, losing all Fastify type safety.

### 6.3 WebSocket Notifications

After enable/disable/reload/config-update operations, the route attempts to push notifications to admin subscribers:

```typescript
try {
  const wsGateway = getWsGateway();
  wsGateway?.pushToAdminSubscribers('plugin_updated', { name, action: 'enabled' });
} catch { /* ignore — WS push is best-effort */ }
```

---

## 7. Frontend Plugin System

### 7.1 Frontend Plugin Loader (`catalyst-frontend/src/plugins/loader.ts`)

```typescript
export async function loadPluginFrontend(manifest: PluginManifest): Promise<LoadedPlugin> {
  const mod = await import(`./${manifest.name}/components.tsx`);
  
  if (mod.AdminTab) { /* register admin tab */ }
  if (mod.ServerTab) { /* register server tab */ }
  if (mod.UserPage) { /* register route */ }
  if (mod.slots) { /* register component slots */ }
  if (typeof mod.registerSlots === 'function') { /* imperative slot registration */ }
}
```

**Critical design flaw:** Plugins are loaded via dynamic imports from `./{plugin-name}/components.tsx` — this means ALL plugin frontend code must be bundled into the main frontend application at build time. There is NO runtime loading of plugin frontends. The plugins are not actually "dynamic" — they're just conditionally imported from hardcoded paths.

**This means:**
- Plugins cannot be installed without rebuilding the frontend
- The "frontend" entry in `plugin.json` is misleading — it doesn't point to an external file
- Plugin frontend code is part of the main bundle

### 7.2 PluginProvider (`catalyst-frontend/src/plugins/PluginProvider.tsx`)

```typescript
export function PluginProvider({ children }: { children: React.ReactNode }) {
  const [initialized, setInitialized] = useState(false);
  
  const loadPlugins = async () => {
    const manifests = await fetchPlugins();
    const loadedPlugins = await Promise.all(
      manifests.map(async (manifest) => {
        if (manifest.enabled && manifest.hasFrontend) {
          return await loadPluginFrontend(manifest);
        }
        return { manifest, routes: [], tabs: [], components: [] };
      })
    );
    setPlugins(loadedPlugins);
    setInitialized(true);
  };

  useEffect(() => {
    if (!initialized && isAuthenticated) {
      loadPlugins();
    }
  }, [initialized, isAuthenticated]);
}
```

**Design:** Fetches plugin manifests from backend API, then loads frontend components. Only loads when `isAuthenticated` is true.

**Issue:** If `isAuthenticated` becomes false (logout), plugins are not cleaned up. The `useEffect` dependency array doesn't include `loadPlugins` (it's defined inside the component without `useCallback`), but in this case it's called on mount only.

### 7.3 Hooks (`catalyst-frontend/src/plugins/hooks.ts`)

Five hooks provided:
- `usePlugins()` — all plugins
- `useEnabledPlugins()` — enabled only
- `usePlugin(name)` — specific plugin
- `usePluginRoutes()` — all routes from enabled plugins
- `usePluginTabs(location)` — tabs for admin/server location
- `usePluginComponents(slot)` — components for a slot
- `usePluginLoading()` — loading/error state

All use `useMemo()` for performance. Clean, simple API.

### 7.4 Store (`catalyst-frontend/src/plugins/store.ts`)

Zustand store with basic CRUD operations:

```typescript
export const usePluginStore = create<PluginStore>((set, get) => ({
  plugins: [], loading: false, error: null,
  setPlugins, addPlugin, removePlugin, updatePlugin, setLoading, setError,
  updatePluginConfig: async (name, config) => {
    await apiUpdateConfig(name, config);
    // Optimistic update of local state
  },
  getPlugin, getPluginsByLocation, getEnabledPlugins,
}));
```

**Notable:** `updatePluginConfig` does an optimistic update — calls API then updates local state. No rollback on failure.

### 7.5 Component Slots (`usePluginSlots.tsx`)

```typescript
export function usePluginSlots(slot: string): React.ComponentType<any>[] {
  const plugins = usePluginStore((state) => state.plugins);
  return useMemo(() => {
    return plugins
      .filter((p) => p.manifest.enabled)
      .flatMap((p) => p.components)
      .filter((c) => c.slot === slot)
      .sort((a, b) => (a.order ?? 50) - (b.order ?? 50))
      .map((c) => c.component);
  }, [plugins, slot]);
}
```

**Design:** Slot-based component injection similar to WordPress hooks or Drupal regions. Components are React components that get rendered in designated areas.

### 7.6 Plugin Tab Page (`PluginTabPage.tsx`)

```typescript
export default function PluginTabPage({ location, serverId }: PluginTabPageProps) {
  const { pluginTabId } = useParams<{ pluginTabId: string }>();
  const pluginTabs = usePluginTabs(location);
  const tab = pluginTabs.find((t) => t.id === pluginTabId);
  const TabComponent = tab.component;
  return <TabComponent serverId={serverId} />;
}
```

Simple tab renderer. Passes `serverId` prop to server tabs. No error boundary — if a plugin tab component throws, it crashes the whole page.

### 7.7 Plugin Route Page (`PluginRoutePage.tsx`)

```typescript
export default function PluginRoutePage() {
  const { pluginRouteName } = useParams<{ pluginRouteName: string }>();
  const routes = usePluginRoutes();
  const currentPath = `/${pluginRouteName}`;
  const matched = routes.find((r) => r.path === currentPath);
  if (!matched) return <Navigate to="/dashboard" replace />;
  const Component = matched.component;
  return <Component />;
}
```

Same concern — no error boundary around dynamically loaded components.

---

## 8. Example Plugins

### 8.1 Example Plugin (`example-plugin`)

**Manifest:** Demonstrates all features — config schema, backend entry, frontend entry, permissions, dependencies.

**Backend (`backend/index.js`):**
- Exports a default object with `onLoad`, `onEnable`, `onDisable`, `onUnload`
- Registers 3 routes: `/hello` (GET), `/echo` (POST), `/stats` (GET)
- Uses `ctx.getConfig()`, `ctx.getStorage()`, `ctx.setStorage()`
- Registers WebSocket handler for `plugin_example_ping`
- Schedules a cron task `*/5 * * * *`
- Listens to `server:started` and `server:stopped` events
- Registers Express-style middleware

**Frontend (`frontend/index.ts` & `components.tsx`):**
- Exports `tabs` array with admin and server tab definitions
- Admin tab fetches stats from plugin API
- Server tab receives `serverId` prop and demonstrates echo functionality

**Key observation:** The backend uses ESM (`export default plugin`) while the manifest says `backend/index.js`. The loader does `const backendModule = await import(backendPath)` and handles both `backendModule.default` and `backendModule` as fallback.

### 8.2 Ticketing Plugin (`ticketing-plugin`)

A complex, production-grade plugin that demonstrates the system's capabilities and limitations:

**Manifest features:**
- Rich config schema with typed fields: `boolean`, `number`, `select`
- 9 declared events with typed payloads
- No `dependencies` declared

**Backend (`backend/index.js` — 1471 lines):**
- Full CRUD for tickets, comments, tags, templates
- Activity logging system
- SLA tracking with deadlines
- Bulk operations
- CSV/JSON export
- Auto-assignment logic
- Status transition validation
- WebSocket broadcasting for real-time updates

**Scalability concerns in ticketing plugin:**
- Uses `context.db.collection()` for ALL data storage
- Every ticket list operation loads the full ticket collection into memory
- Enrichment helpers (`enrichTickets`, `enrichComments`) make multiple DB calls per request
- No pagination at the database level — all filtering/sorting happens in JavaScript
- Bulk operations loop over ticket IDs with individual updates

**Code quality:**
- Uses `context.db.users.findMany({ where: { id: { in: [...ids] } } })` but catches errors silently (`catch { /* read-only may not support findMany with where */ }`)
- Heavy use of `request.body || {}` pattern without validation
- `normalizeId()` function manually strips `_id`, `_createdAt`, `_updatedAt` fields

### 8.3 Egg Explorer Plugin (`egg-explorer`)

A data-fetching plugin that demonstrates external API integration:

**Features:**
- GitHub API client with rate-limit handling
- Background indexing with tree SHA caching
- Token-based authentication (config key `ghToken`)
- Cron-scheduled sync

**Notable patterns:**
- Uses `ctx.getStorage()` for caching (tree SHA, blob SHAs, egg index)
- Self-throttles based on GitHub rate limits
- Graceful degradation: returns cached data when API is unavailable
- Module-level state (`let eggIndex = null`, `let isSyncing = false`)

---

## Summary of Key Findings

### Strengths
1. **Comprehensive lifecycle management** — Load → Enable → Disable → Unload with clear semantics
2. **Security-aware database scoping** — Field-level write whitelisting, blocked sensitive tables
3. **Flexible event system** — Shared EventEmitter with typed event declaration support
4. **Plugin-to-plugin RPC** — Cross-plugin communication via registry
5. **Hot-reload for development** — File watching with automatic reload
6. **Frontend slot system** — Component injection into host application areas
7. **Zod manifest validation** — Strict validation with clear error messages
8. **Topological dependency ordering** — Kahn's algorithm with cycle detection

### Weaknesses
1. **No true isolation** — Plugins run in the same Node.js process. A plugin can crash the entire server via unhandled exceptions or infinite loops.
2. **ESM cache clearing doesn't work** — Hot-reload is unreliable for ESM plugins.
3. **Frontend plugins are NOT dynamic** — They must be bundled into the frontend at build time.
4. **Collection storage is not scalable** — JSON arrays in a single table with O(n) queries.
5. **No row-level security** — Permission scopes are coarse-grained.
6. **Middleware parameter detection is fragile** — Arrow functions break the Express/Fastify detection.
7. **No plugin sandbox** — Plugins have full access to Node.js APIs, can make network requests, read filesystem, etc.
8. **Config type mismatch** — Backend uses `Record<string, any>`, frontend expects `Record<string, PluginConfigField>`.
9. **Hardcoded paths** — `../../..` path to plugins directory.
10. **No testing infrastructure** — No test harness, mock context, or testing utilities for plugins.
11. **Task scheduling is ephemeral** — Tasks don't survive server restart.
12. **No plugin marketplace/distribution** — Only filesystem-based discovery.
13. **Error boundaries missing** — Frontend plugin components can crash the entire React tree.
14. **`any` types pervasive** — Multiple uses of `any` weaken type safety across the system.
