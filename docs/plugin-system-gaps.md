# Catalyst Plugin System — Gap Analysis

## Methodology
This gap analysis evaluates the current plugin system against industry best practices for extensible architecture. Each gap is rated by severity (Critical/High/Medium/Low) and impact. Where applicable, references are made to comparable systems (WordPress, VS Code, Fastify plugins, Figma plugins).

---

## 1. Isolation & Sandboxing

### 1.1 No Process-Level Isolation
**Severity: CRITICAL**
**Current state:** All plugins run in the same Node.js process as the host application.
**Impact:** A single plugin with an infinite loop, memory leak, or unhandled exception can crash the entire Catalyst server. A plugin can also block the event loop, causing all other requests to timeout.
**Evidence:** The `example-plugin` middleware uses `next()` callback style but measures timing synchronously. The `ticketing-plugin` loads entire collections into memory. There's no `worker_threads` or `child_process` usage anywhere in the plugin system.
**Comparable:** VS Code extensions run in a separate Extension Host process. Figma plugins run in a sandboxed iframe with a strict API bridge.

### 1.2 No Resource Limits
**Severity: CRITICAL**
**Current state:** Plugins have no CPU, memory, or execution time limits.
**Impact:**
- A plugin can consume unlimited memory (e.g., loading a 100MB JSON collection)
- A plugin route handler can hang indefinitely (no request timeout for plugin routes)
- A scheduled task can run for hours, blocking other cron jobs
**Evidence:** `scheduleTask()` wraps the handler in a try/catch but has no timeout. Route handlers are wrapped with middleware but no overall request timeout.
**Comparable:** AWS Lambda has configurable memory and timeout limits. Cloudflare Workers have CPU time limits (50ms/10ms).

### 1.3 No Plugin Sandbox
**Severity: CRITICAL**
**Current state:** Plugins have full access to Node.js APIs — `fs`, `child_process`, `net`, etc.
**Impact:** A malicious or compromised plugin can:
- Read arbitrary files on the filesystem
- Make network requests to internal services
- Execute shell commands
- Access environment variables containing secrets
- Tamper with other plugins' storage
**Evidence:** The `egg-explorer` plugin imports `fs`, `path`, `crypto` directly. Any plugin can do the same. There is no VM sandbox (vm2, isolated-vm, or QuickJS).
**Comparable:** WordPress uses PHP's inherent process-per-request model. Deno Deploy uses permission flags. VS Code uses a restricted API surface.

### 1.4 Missing Request Timeout for Plugin Routes
**Severity: HIGH**
**Current state:** Plugin routes are registered directly on the Fastify instance but no timeout wrapper is applied.
**Impact:** A slow plugin route can hold HTTP connections open indefinitely, exhausting the connection pool.
**Evidence:** In `loadPlugin()`, routes are registered with `this.fastify.route(route)` with only middleware wrapping and enabled-check.

---

## 2. Developer Experience (DX)

### 2.1 No Plugin SDK / CLI Tool
**Severity: HIGH**
**Current state:** Plugin authors must manually create directory structures, write `plugin.json`, and understand the context API.
**Impact:** High barrier to entry. No standardized way to create, build, test, or publish plugins.
**Evidence:** The example plugin's `package.json` only has `"build": "tsc"`. No scaffolding, no dev server, no watch mode.
**Comparable:**
- `create-vite` for Vite projects
- `yo code` for VS Code extensions
- `npx create-fastify-plugin` (hypothetical)

### 2.2 Poor Type Safety for Plugin Context
**Severity: HIGH**
**Current state:** `PluginBackendContext` is a wide interface with many `any` types. Plugin authors lose IntelliSense and compile-time safety.
**Impact:**
- `db.servers.findMany(args?: any)` — no query autocompletion
- `collection(name).find(filter?: any)` — no filter type checking
- `getConfig<T = any>(key: string)` — config keys are not validated
- `registerRoute(options: RouteOptions)` — route options from Fastify are complex
**Evidence:** The ticketing plugin uses `request.body || {}` everywhere without validation. The example plugin uses `ctx.getConfig('greeting')` with no type checking on the key.

### 2.3 No Plugin Testing Utilities
**Severity: HIGH**
**Current state:** No mock context, no test harness, no fixture utilities.
**Impact:** Plugin authors cannot write unit tests without mocking the entire Catalyst runtime.
**Evidence:** No test files in any plugin directory. The `catalyst-backend` has vitest tests but no plugin-specific test utilities.

### 2.4 Config Schema Type Mismatch
**Severity: MEDIUM**
**Current state:** Backend stores config as `Record<string, any>`. Frontend expects `Record<string, PluginConfigField>` with typed fields (`string`, `number`, `boolean`, `select`, `text`, `password`).
**Impact:** The admin UI must guess the field type from the stored value. A config value `"true"` (string) vs `true` (boolean) causes UI confusion.
**Evidence:** `PluginManifestSchema` in validator.ts defines `config` as `z.record(z.string(), z.any())`. The frontend types define `PluginConfigField` with `type`, `default`, `description`, `label`, `options`.

### 2.5 No Plugin Documentation Generator
**Severity: LOW**
**Current state:** Plugin authors must manually write READMEs.
**Impact:** Inconsistent documentation quality across plugins.
**Comparable:** JSDoc/TypeDoc auto-generation, VS Code's contribution points documentation.

---

## 3. Versioning & Compatibility

### 3.1 Limited Semver Range Support
**Severity: MEDIUM**
**Current state:** `isVersionCompatible()` only supports `>=`, `>`, `=`, `<`, `<=`. No `^`, `~`, or range syntax.
**Impact:** Plugin authors cannot express common compatibility patterns like `"^1.0.0"` (any 1.x version).
**Evidence:**
```typescript
const match = required.match(/^([><=]+)?\s*(\d+\.\d+\.\d+)$/);
// Only simple operators supported
```

### 3.2 No Plugin API Versioning
**Severity: HIGH**
**Current state:** The `PluginBackendContext` interface is not versioned. Changes to the context API are breaking changes for ALL plugins.
**Impact:** Catalyst cannot evolve its plugin API without breaking existing plugins. There's no mechanism for deprecation or migration.
**Evidence:** The `CATALYST_VERSION` is hardcoded as `'1.0.0'` in `loader.ts`. No plugin API version separate from Catalyst version.
**Comparable:** VS Code uses `engines.vscode` in `package.json` and maintains backward compatibility. WordPress uses hook-based extensibility which is inherently more stable.

### 3.3 No Migration Path for Breaking Changes
**Severity: MEDIUM**
**Current state:** If Catalyst changes the context API, plugins must be manually updated.
**Impact:** Plugin ecosystem fragmentation — old plugins break, authors may abandon them.

---

## 4. Security

### 4.1 No Row-Level Security
**Severity: HIGH**
**Current state:** Permission scopes are table-level (`server.read`, `user.read`). A plugin with `server.read` can see ALL servers.
**Impact:** Multi-tenant plugins (ticketing by server, per-user dashboards) cannot restrict data access naturally.
**Evidence:** `ScopedPluginDBClient.servers.findMany()` returns all servers with no filtering. There's no `where` clause injection for row-level restrictions.

### 4.2 Field-Level Read Control Bypass
**Severity: HIGH**
**Current state:** The `findMany`/`findUnique` methods on `servers` and `users` hardcode a `select` object but then spread `...(args?.select || {})`, allowing plugins to override and request sensitive fields.
**Evidence:**
```typescript
findMany: async (args?: any) =>
  prisma.server.findMany({
    ...args,
    select: {
      id: true, name: true, uuid: true, // ... base fields
      ...(args?.select || {}), // <-- OVERRIDE!
    },
  }),
```
A plugin could pass `{ select: { credentials: true } }` to bypass field restrictions.

### 4.3 Audit Trail Gaps
**Severity: HIGH**
**Current state:** Plugin actions are logged via `captureSystemError()` for blocked access attempts, but:
- No audit log of successful plugin data modifications
- No audit trail of config changes
- No record of plugin-to-plugin RPC calls
- No tracking of which plugin accessed which data
**Impact:** Compliance and security investigations cannot determine what a plugin did.
**Evidence:** `ScopedPluginDBClient.servers.update()` logs at `info` level but doesn't write to the `auditLogs` table (which is blocked for plugins).

### 4.4 Plugin Route Authentication
**Severity: MEDIUM**
**Current state:** Routes are auto-injected with `authenticate` middleware if available, but plugins can bypass this by setting their own `preHandler` or `onRequest`.
**Evidence:**
```typescript
registerRoute(options: RouteOptions) {
  if (authenticate && !options.preHandler && !options.onRequest) {
    (routeOptions as any).preHandler = [authenticate];
  }
}
```
A plugin could set `preHandler: []` to disable auth.

### 4.5 No Plugin Code Signing
**Severity: MEDIUM**
**Current state:** Plugins are loaded from the filesystem with no verification of authenticity.
**Impact:** A compromised server could have malicious plugins installed. No mechanism to verify plugin integrity.

### 4.6 Config Validation Weakness
**Severity: MEDIUM**
**Current state:** Config values in `plugin.json` are validated as `z.any()` — no runtime type checking.
**Impact:** A plugin declaring `config: { port: { type: 'number', default: 3000 } }` could receive a string value, causing runtime errors.

---

## 5. Performance

### 5.1 Collection Storage Scalability
**Severity: CRITICAL**
**Current state:** Plugin collections store entire document arrays in a single `pluginStorage` JSON field.
**Impact:**
- Every `find()` loads the ENTIRE collection into memory
- No database-level indexing — all queries are O(n) JavaScript filters
- No pagination at the database level
- Concurrent modifications risk race conditions (no locking)
**Evidence:** The ticketing plugin stores all tickets, comments, activities, tags, templates in collections. For a busy ticketing system, this could mean 100K+ documents in a single JSON field.
**Calculation:** A 100KB JSON document loaded 100 times/day = 10MB/day of JSON parsing overhead. At 10K documents, each find() parses 5-10MB of JSON.

### 5.2 Memory Overhead Per Plugin
**Severity: MEDIUM**
**Current state:** Each loaded plugin holds references to: routes, middlewares, WS handlers, tasks, event handlers, original handlers map, enabled ref.
**Impact:** With 100+ plugins, the memory overhead of `Map`, `Set`, and closure references adds up.
**Evidence:** `LoadedPlugin` has 10+ fields, many of which are Maps/Sets. The `PluginLoader` holds a `PluginRegistry` which holds all `LoadedPlugin` instances.

### 5.3 Hot-Reload Impact on Uptime
**Severity: MEDIUM**
**Current state:** Hot-reload does `unloadPlugin()` then `loadPlugin()`, which includes:
- Calling `onUnload()` and `onLoad()` lifecycle hooks
- Clearing and re-registering routes, middlewares, tasks
- Full module re-import
**Impact:** During reload, the plugin is temporarily unavailable. For a plugin handling real-time WebSocket messages, this means dropped messages.

### 5.4 No Lazy Loading for Frontend Plugins
**Severity: MEDIUM**
**Current state:** All plugin frontend code is bundled into the main application bundle.
**Impact:** Initial page load includes code for ALL plugins, even disabled ones. The manifest is fetched but components are already in the bundle.

### 5.5 Route Handler Wrapping Overhead
**Severity: LOW**
**Current state:** Every plugin route handler is wrapped with:
1. Global middleware loop (forEach over middleware array)
2. Enabled check (`if (!enabledRef.value)`)
3. Original handler call
**Impact:** Adds ~2-3 function calls per request. Negligible for most cases but measurable under high load.

---

## 6. Frontend Architecture

### 6.1 No True Dynamic Loading
**Severity: CRITICAL**
**Current state:** Frontend plugins use `import(\`./${manifest.name}/components.tsx\`)` which is resolved at BUILD time by Vite.
**Impact:**
- Cannot install a plugin without rebuilding the frontend
- Plugin frontend code is bundled into the main app bundle
- No runtime plugin marketplace concept is possible
**Evidence:**
```typescript
const mod = await import(`./${manifest.name}/components.tsx`);
```
This works because Vite's build-time analysis resolves these paths. It would NOT work for a plugin installed after build.

### 6.2 No Error Boundaries
**Severity: HIGH**
**Current state:** `PluginTabPage` and `PluginRoutePage` render plugin components directly without React error boundaries.
**Impact:** A crashing plugin tab crashes the entire React application.
**Evidence:**
```typescript
const TabComponent = tab.component;
return <TabComponent serverId={serverId} />;
// No <ErrorBoundary> wrapper
```

### 6.3 No CSS Isolation
**Severity: MEDIUM**
**Current state:** Plugin components use global CSS classes (Tailwind utility classes). No CSS Modules, Shadow DOM, or scoped styles.
**Impact:** Plugin CSS can conflict with host application styles and with other plugins.

### 6.4 State Isolation Between Plugins
**Severity: MEDIUM**
**Current state:** All plugins share the same Zustand store and React context.
**Impact:** A plugin could accidentally (or maliciously) modify another plugin's state.

---

## 7. Plugin Distribution

### 7.1 No Registry or Marketplace
**Severity: HIGH**
**Current state:** Plugins are discovered from a filesystem directory (`catalyst-plugins/`).
**Impact:**
- No way to browse/install plugins from a central repository
- No version management for distributed plugins
- No plugin ratings, reviews, or trust signals
**Comparable:** WordPress has wordpress.org/plugins. VS Code has the Marketplace. npm is the de facto registry for Node.js packages.

### 7.2 No Package-Based Distribution
**Severity: HIGH**
**Current state:** Plugins are raw directories with `plugin.json` and source files.
**Impact:**
- No dependency management (beyond Catalyst plugin dependencies)
- No build step for compiled plugins (TypeScript, SCSS, etc.)
- No versioning beyond the manifest version field
**Evidence:** Example plugin's `package.json` has no dependencies and a minimal build script.

### 7.3 No Plugin Signing or Verification
**Severity: MEDIUM**
**Current state:** No cryptographic verification of plugin integrity.
**Impact:** Man-in-the-middle or supply chain attacks could inject malicious plugins.

---

## 8. Testing & Reliability

### 8.1 No Plugin Test Harness
**Severity: HIGH**
**Current state:** No mock `PluginBackendContext`, no test fixtures, no isolated test environment.
**Impact:** Plugin authors cannot write automated tests. The only way to test is manual integration testing against a running Catalyst instance.

### 8.2 No Rollback on Load Failure
**Severity: MEDIUM**
**Current state:** If `onLoad()` throws, the plugin is registered in `ERROR` state but partial state changes may remain.
**Evidence:** In `loadPlugin()`, the plugin record is upserted to the database BEFORE `onLoad()` is called. If `onLoad()` fails, the DB record remains.

### 8.3 Lifecycle Error Handling Inconsistencies
**Severity: MEDIUM**
**Current state:**
- `onLoad()` errors → plugin registered as ERROR state
- `onEnable()` errors → plugin status set to error, enabledRef toggled back
- `onDisable()` errors → thrown to caller, partial cleanup
- `onUnload()` errors → logged but not handled gracefully
**Impact:** Inconsistent state after lifecycle errors. A plugin may be half-enabled or half-disabled.

### 8.4 No Health Check System
**Severity: MEDIUM**
**Current state:** No way to check if a plugin is healthy beyond its status string.
**Impact:** A plugin in `enabled` state may have broken routes, failed tasks, or disconnected WebSocket handlers.

---

## 9. Observability

### 9.1 No Per-Plugin Metrics
**Severity: MEDIUM**
**Current state:** No request counters, error rates, or latency histograms per plugin.
**Impact:** Cannot identify which plugin is causing performance issues.

### 9.2 Limited Crash Reporting
**Severity: MEDIUM**
**Current state:** Errors are logged via `captureSystemError()` which appears to write to a database table.
**Impact:** No stack trace aggregation, no error grouping, no alerting.

### 9.3 No Plugin Performance Dashboard
**Severity: LOW**
**Current state:** Admin panel shows plugin status but no performance data.
**Impact:** Administrators cannot make informed decisions about plugin usage.

---

## 10. Lifecycle Gaps

### 10.1 Race Condition in Hot-Reload
**Severity: HIGH**
**Current state:** The file watcher callback is `async` but not awaited or debounced.
**Impact:** Rapid file changes (e.g., `git checkout`, build tools) can trigger overlapping reloads, causing state corruption.
**Evidence:**
```typescript
this.watcher.on('change', async (filePath) => {
  // No debouncing, no lock
  await this.reloadPlugin(pluginName);
});
```

### 10.2 Slow Plugin Startup Blocking
**Severity: MEDIUM**
**Current state:** `initialize()` calls `discoverPlugins()` which is fully synchronous — it awaits each plugin load sequentially.
**Impact:** A single slow plugin (e.g., one that makes external API calls in `onLoad()`) delays server startup for all subsequent plugins.
**Evidence:**
```typescript
for (const { pluginPath } of sorted) {
  await this.loadPlugin(pluginPath); // Sequential, not parallel
}
```

### 10.3 No Dependency Startup Ordering
**Severity: MEDIUM**
**Current state:** While topological sort orders loading, there's no enforcement that dependencies must be `enabled` before dependents.
**Impact:** A plugin B that depends on plugin A could be enabled while A is still in `loaded` state.

---

## 11. Plugin-to-Plugin Communication

### 11.1 RPC Limitations
**Severity: MEDIUM**
**Current state:** Synchronous request/response only, 10s hardcoded timeout.
**Impact:**
- No streaming or large payload support
- No callback or async notification pattern
- Caller is blocked waiting for response
**Evidence:**
```typescript
return Promise.race([
  api(params),
  new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`RPC call timed out`)), 10000),
  ),
]);
```

### 11.2 No Pub/Sub Broker
**Severity: MEDIUM**
**Current state:** The EventEmitter is shared but:
- No message persistence
- No guaranteed delivery
- No subscription management
- No topic patterns (wildcards)
**Impact:** Unreliable cross-plugin communication. A plugin that emits an event while another is reloading will miss the event.

---

## 12. Code Quality Issues

### 12.1 Pervasive `any` Types
**Severity: MEDIUM**
**Current state:** Multiple `any` annotations weaken TypeScript's value:
- `PluginBackendContext` has `originalConfig?: Record<string, any>`
- `PluginManifestSchema` has `z.any()` for config values and event payloads
- `captureSystemError` metadata is `Record<string, any>`
- Route handlers use `request: any` in plugin routes
**Impact:** Runtime errors that TypeScript could have caught at compile time.

### 12.2 Magic Strings
**Severity: LOW**
**Current state:** Hardcoded strings scattered throughout:
- `CATALYST_VERSION = '1.0.0'` in loader.ts
- `CONFIG_KEY_REGEX = /^[a-zA-Z][a-zA-Z0-9_-]{0,50}$/` in validator.ts
- Permission strings like `'server.read'`, `'admin.write'` are literals
**Impact:** Typos in permission strings won't be caught by the compiler.

### 12.3 Inconsistent Error Handling
**Severity: MEDIUM**
**Current state:** Some errors are thrown, some are logged, some are captured to the error logger, some are silently swallowed.
**Evidence:**
```typescript
// In context.ts
try {
  const users = await context.db.users.findMany({ where: { ... } });
} catch { /* read-only may not support findMany with where */ }
// Silently swallows ALL errors, not just "unsupported where"
```

### 12.4 Use of `Function` Type
**Severity: LOW**
**Current state:**
```typescript
export interface PluginMiddlewareEntry {
  handler: (...args: any[]) => any;
  scope: 'global' | 'route';
}
```
**Impact:** Loses parameter type information for middleware handlers.

---

## 13. Database & Storage

### 13.1 No Transactions for Collection Operations
**Severity: HIGH**
**Current state:** Collection operations (find, insert, update, delete) are not atomic.
**Impact:**
- Concurrent updates to the same collection can corrupt data
- A plugin crash during update leaves data in an inconsistent state
**Evidence:** `PluginCollectionImpl.update()` loads docs, modifies in memory, then saves. If two concurrent updates happen, the second overwrites the first.

### 13.2 No Indexing for Collections
**Severity: HIGH**
**Current state:** The `matchFilter()` function does a linear scan over all documents.
**Impact:** O(n) query performance for all collection operations. At 10K documents, a findOne() scans all 10K.

### 13.3 JSON Field Size Limits
**Severity: MEDIUM**
**Current state:** PostgreSQL's JSONB has practical limits (~1GB per field, but performance degrades much sooner).
**Impact:** Large collections will cause slow queries and high memory usage.

### 13.4 No Collection Schema Validation
**Severity: MEDIUM**
**Current state:** Collection documents are untyped `any`.
**Impact:** No validation that inserted documents match expected structure. No migration support when document schemas change.

---

## Gap Severity Summary

| Category | Critical | High | Medium | Low |
|----------|----------|------|--------|-----|
| Isolation & Sandboxing | 3 | 1 | 0 | 0 |
| Developer Experience | 0 | 3 | 1 | 1 |
| Versioning & Compatibility | 0 | 1 | 2 | 0 |
| Security | 0 | 4 | 3 | 0 |
| Performance | 1 | 1 | 3 | 1 |
| Frontend Architecture | 1 | 1 | 2 | 0 |
| Plugin Distribution | 0 | 2 | 1 | 0 |
| Testing & Reliability | 0 | 1 | 3 | 0 |
| Observability | 0 | 0 | 2 | 1 |
| Lifecycle | 0 | 1 | 2 | 0 |
| Plugin Communication | 0 | 0 | 2 | 0 |
| Code Quality | 0 | 0 | 2 | 2 |
| Database & Storage | 0 | 2 | 2 | 0 |
| **TOTAL** | **5** | **17** | **25** | **6** |

**Key takeaways:**
- 5 critical gaps, all in isolation/sandboxing and performance — these are foundational issues
- 17 high-severity gaps across security, DX, distribution, and frontend
- The system works for a small number of trusted plugins but would not scale to an open ecosystem
- The biggest risks are: no process isolation (any plugin can crash the server), collection storage scalability (O(n) queries), and frontend bundling (no true dynamic loading)
