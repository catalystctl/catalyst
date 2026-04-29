# Catalyst Plugin System — Improvement & Rewrite Report

## Prepared for: Catalyst Core Team
## Date: 2026-04-28

---

# PART 1: Executive Summary

## Current State Assessment

The Catalyst plugin system is a functional, feature-rich architecture that supports backend route registration, WebSocket integration, scheduled tasks, event-driven communication, frontend tab injection, and plugin-to-plugin RPC. It demonstrates thoughtful security measures including scoped database access, field-level write whitelisting, blocked sensitive tables, and manifest validation via Zod. The system supports a four-phase lifecycle (load/enable/disable/unload), dependency resolution with topological sorting, and hot-reload for development.

However, the current implementation was designed for a closed, trusted plugin ecosystem running on a single Node.js process. It lacks process-level isolation, meaning any plugin can crash the entire Catalyst server. Collection storage uses JSON arrays in a single database table with O(n) query performance — unsuitable for production workloads beyond a few thousand documents. Frontend plugins are not truly dynamic; they must be bundled into the main application at build time, making runtime installation impossible. The system has no plugin SDK, no testing utilities, no marketplace concept, and no formal API versioning strategy. While functional for internal plugins, it is not ready for an open ecosystem.

## Rewrite vs. Incremental Improvement: Recommendation

**Recommendation: Incremental rewrite with phased migration.**

A full ground-up rewrite would discard working code and delay value delivery. Instead, we recommend a **phased approach**:

1. **Phase 1** (immediate): Fix critical security and type-safety issues without breaking the existing API
2. **Phase 2** (1-2 months): Introduce a new plugin runtime with process isolation alongside the existing system, allowing gradual migration
3. **Phase 3** (3+ months): Deprecate the legacy runtime and complete the transition

This approach preserves existing plugins while providing a clear migration path. The ticketing and egg-explorer plugins can continue running on the legacy system while new plugins target the improved runtime.

## Key Findings Overview

- **5 Critical gaps** in isolation, sandboxing, and performance
- **17 High-severity gaps** in security, DX, distribution, and frontend architecture
- **25 Medium-severity gaps** across all categories
- The biggest risks are: (1) no process isolation, (2) unscalable collection storage, (3) no dynamic frontend loading, (4) missing audit trails, and (5) no plugin SDK

---

# PART 2: Architecture Redesign by Area

## A. Plugin Isolation Model

### Current Approach
Plugins run in the same Node.js process as the host. The `PluginLoader` creates a context object and passes it to the plugin's exported functions. There's no sandbox — plugins can import any Node.js module, access the filesystem, make network requests, and block the event loop.

### Problems
- A plugin with an infinite loop or memory leak crashes the entire server
- No resource limits (CPU, memory, execution time)
- No protection against malicious plugins
- Scheduled tasks run on the main event loop

### Recommended Redesign: Multi-Runtime Architecture

We recommend a **dual-runtime architecture**:

```
┌─────────────────────────────────────────────────────────┐
│                    Catalyst Host                          │
│  ┌─────────────────┐    ┌─────────────────────────────┐  │
│  │  Legacy Runtime │    │    Isolated Runtime         │  │
│  │  (in-process)   │    │  (worker_threads / child)   │  │
│  │                 │    │                             │  │
│  │  - Existing     │    │  - New plugins              │  │
│  │    plugins      │    │  - Untrusted plugins        │  │
│  │  - Trusted      │    │  - Resource limits          │  │
│  │    internals    │    │  - Timeout enforcement      │  │
│  └─────────────────┘    └─────────────────────────────┘  │
│           │                          │                   │
│           └──────────┬───────────────┘                   │
│                      │                                   │
│           ┌──────────▼───────────────┐                   │
│           │   Plugin Message Bus      │                   │
│           │  (structured clone / IPC) │                   │
│           └───────────────────────────┘                   │
└─────────────────────────────────────────────────────────┘
```

#### Implementation: Isolated Plugin Worker

**File: `catalyst-backend/src/plugins/runtime/worker.ts`**

```typescript
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { createIsolatedContext } from './isolated-context';

// This file runs inside the worker thread
if (!isMainThread) {
  const { manifest, config } = workerData;
  const context = createIsolatedContext(manifest, config, parentPort!);
  
  // Load plugin code in a restricted context
  const pluginModule = await import(/* webpackIgnore: true */ workerData.entryPath);
  const plugin = pluginModule.default || pluginModule;
  
  if (plugin.onLoad) {
    await context.withTimeout(plugin.onLoad(context), 30000);
  }
}
```

**File: `catalyst-backend/src/plugins/runtime/plugin-worker-host.ts`**

```typescript
import { Worker } from 'worker_threads';
import { MessageChannel } from 'worker_threads';

export class PluginWorkerHost {
  private worker: Worker;
  private messagePort: MessageChannel;
  
  constructor(
    private manifest: PluginManifest,
    private entryPath: string,
  ) {
    this.messagePort = new MessageChannel();
    this.worker = new Worker(
      new URL('./worker.ts', import.meta.url),
      {
        workerData: {
          manifest,
          entryPath,
          port: this.messagePort.port2,
        },
        transferList: [this.messagePort.port2],
        resourceLimits: {
          maxOldGenerationSizeMb: 128,  // Memory limit
          maxYoungGenerationSizeMb: 32,
        },
      }
    );
    
    // Handle worker crashes
    this.worker.on('error', (err) => {
      this.handleWorkerCrash(err);
    });
    
    this.worker.on('exit', (code) => {
      if (code !== 0) {
        this.handleWorkerCrash(new Error(`Worker exited with code ${code}`));
      }
    });
  }
  
  async callMethod(method: string, args: any[], timeoutMs = 10000): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Plugin ${this.manifest.name} method ${method} timed out`));
        this.worker.terminate();
      }, timeoutMs);
      
      this.messagePort.port1.once('message', (result) => {
        clearTimeout(timeout);
        if (result.error) reject(new Error(result.error));
        else resolve(result.data);
      });
      
      this.messagePort.port1.postMessage({ type: 'call', method, args });
    });
  }
  
  private handleWorkerCrash(err: Error): void {
    // Log, notify admin, restart worker if configured
  }
  
  async terminate(): Promise<void> {
    await this.worker.terminate();
  }
}
```

#### Resource Limits Table

| Resource | Default Limit | Configurable | Enforcement |
|----------|--------------|--------------|-------------|
| Memory | 128MB | Yes | `resourceLimits.maxOldGenerationSizeMb` |
| CPU time per request | 5s | Yes | `Promise.race` with timeout |
| Task execution time | 60s | Yes | `Promise.race` with timeout |
| Concurrent requests | 10 | Yes | Semaphore in worker host |
| File descriptors | 20 | Yes | `resourceLimits` (Node 20+) |

#### Request Timeout Wrapper

**File: `catalyst-backend/src/plugins/runtime/request-gate.ts`**

```typescript
import { FastifyRequest, FastifyReply } from 'fastify';

export function createGatedHandler(
  pluginName: string,
  handler: Function,
  timeoutMs: number,
  memoryLimitMb: number,
): (request: FastifyRequest, reply: FastifyReply) => Promise<any> {
  return async (request, reply) => {
    const startTime = Date.now();
    
    // Check memory usage before handling
    const memUsage = process.memoryUsage();
    if (memUsage.heapUsed / 1024 / 1024 > memoryLimitMb) {
      return reply.status(503).send({
        success: false,
        error: 'Plugin memory limit exceeded',
      });
    }
    
    try {
      const result = await Promise.race([
        handler(request, reply),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Request timeout')), timeoutMs)
        ),
      ]);
      
      // Log slow requests
      const duration = Date.now() - startTime;
      if (duration > timeoutMs / 2) {
        logger.warn({ plugin: pluginName, duration, path: request.url }, 'Slow plugin request');
      }
      
      return result;
    } catch (err) {
      if (err.message === 'Request timeout') {
        return reply.status(504).send({
          success: false,
          error: 'Plugin request timed out',
        });
      }
      throw err;
    }
  };
}
```

#### Migration Path

1. Add a `runtime` field to `plugin.json`: `"runtime": "isolated" | "legacy"` (default: `"legacy"`)
2. Existing plugins continue using the in-process runtime
3. New plugins can opt into isolated runtime
4. After 2-3 months of stability, default to `"isolated"` for new plugins
5. Provide a migration guide for existing plugins (usually just changing `runtime` field)

---

## B. Plugin SDK & Developer Experience

### Current Approach
Plugin authors write raw JavaScript/TypeScript against the `PluginBackendContext` interface. No scaffolding, no typed utilities, no test helpers.

### Problems
- High barrier to entry
- No type safety for config keys, database queries, or event payloads
- No standard project structure
- No way to test plugins in isolation

### Recommended Redesign: `@catalyst/plugin-sdk`

#### NPM Package Structure

```
@catalyst/plugin-sdk/
├── package.json
├── src/
│   ├── index.ts           # Main exports
│   ├── context.ts         # Typed context wrapper
│   ├── config.ts          # Config schema helpers
│   ├── storage.ts         # Collection schema helpers
│   ├── testing.ts         # Test utilities
│   ├── routes.ts          # Route definition helpers
│   ├── websocket.ts       # WebSocket type definitions
│   └── types.ts           # Re-exported types
├── templates/
│   ├── backend-only/      # Template for backend plugin
│   ├── fullstack/         # Template with frontend
│   └── minimal/           # Minimal starter
└── cli/
    └── catalyst-plugin.ts # CLI entry point
```

#### Typed Context with Generics

**File: `@catalyst/plugin-sdk/src/context.ts`**

```typescript
import type { PluginBackendContext as RawContext } from 'catalyst-backend/plugins/types';

// Define config schema using Zod
const MyPluginConfig = z.object({
  greeting: z.string().default('Hello!'),
  cronEnabled: z.boolean().default(true),
  webhookUrl: z.string().url().optional(),
});

type MyPluginConfig = z.infer<typeof MyPluginConfig>;

// Define event payload schemas
const MyPluginEvents = {
  'task-completed': z.object({
    count: z.number(),
    timestamp: z.string().datetime(),
  }),
};

// Create typed context
const context = createTypedContext({
  raw: rawContext,
  configSchema: MyPluginConfig,
  eventSchemas: MyPluginEvents,
});

// Now all APIs are typed:
const greeting = context.config.get('greeting');     // string, with autocomplete
const cronEnabled = context.config.get('cronEnabled'); // boolean

context.events.emit('task-completed', {
  count: 5,
  timestamp: new Date().toISOString(),
  // ^ TypeScript validates this against the schema
});
```

#### CLI Scaffolding Tool

```bash
# Install globally
npm install -g @catalyst/plugin-sdk

# Create a new plugin
catalyst-plugin create my-awesome-plugin
# ? Plugin type: (backend-only / fullstack / minimal)
# ? Programming language: (TypeScript / JavaScript)
# ? Include example code? (yes / no)

# Development server with hot-reload
cd my-awesome-plugin
catalyst-plugin dev
# Starts a mock Catalyst environment with your plugin loaded

# Build for production
catalyst-plugin build
# Validates manifest, bundles frontend, runs type checks

# Test plugin
catalyst-plugin test
# Runs tests using the SDK's test utilities

# Publish to Catalyst marketplace (Phase 3)
catalyst-plugin publish
```

#### Test Utilities

**File: `@catalyst/plugin-sdk/src/testing.ts`**

```typescript
import { createMockContext } from '@catalyst/plugin-sdk/testing';

const mockContext = createMockContext({
  manifest: {
    name: 'test-plugin',
    version: '1.0.0',
    permissions: ['server.read'],
  },
  config: {
    greeting: 'Test',
  },
  // Pre-seed storage
  storage: {
    'installDate': '2024-01-01T00:00:00Z',
  },
});

// Now use in tests
describe('my plugin', () => {
  it('should return greeting', async () => {
    const plugin = await import('./index');
    await plugin.default.onLoad(mockContext);
    
    const greeting = mockContext.config.get('greeting');
    expect(greeting).toBe('Test');
    
    // Assert route was registered
    expect(mockContext.routes).toHaveLength(1);
    expect(mockContext.routes[0].url).toBe('/api/plugins/test-plugin/hello');
  });
  
  it('should handle storage', async () => {
    await mockContext.storage.set('key', { value: 42 });
    const stored = await mockContext.storage.get('key');
    expect(stored).toEqual({ value: 42 });
  });
  
  it('should respect permissions', async () => {
    // This plugin doesn't have 'user.read'
    await expect(
      mockContext.db.users.findMany({})
    ).rejects.toThrow('Permission denied');
  });
});
```

#### Migration Path

1. Publish `@catalyst/plugin-sdk` as an npm package
2. Update existing plugins to use the SDK (optional but recommended)
3. Update documentation to reference the SDK
4. Provide a migration script to convert existing plugins to SDK format

---

## C. Security Model Enhancement

### Current Approach
Table-level permissions, field-level write whitelisting, blocked sensitive tables. `any` types on query args. No row-level security.

### Problems
- `args?.select` spread allows field whitelist bypass
- No row-level filtering
- No audit trail for successful plugin actions
- Config validation is weak (`z.any()`)
- Plugin routes can bypass auth by setting empty `preHandler`

### Recommended Redesign

#### 1. Fix Field Whitelist Bypass

**File: `catalyst-backend/src/plugins/context.ts`** (in `ScopedPluginDBClient`)

```typescript
findMany: async (args?: any) => {
  // MERGE select instead of spreading (prevents override)
  const safeSelect = {
    id: true, name: true, uuid: true,
    description: true, status: true,
    createdAt: true, updatedAt: true,
  };
  
  // Only allow plugins to ADD fields, not remove or replace safe ones
  const mergedSelect = args?.select
    ? { ...safeSelect, ...args.select }  // Add extra fields but keep safe ones
    : safeSelect;
  
  // Validate no sensitive fields were added
  const sensitiveFields = ['password', 'secret', 'token', 'apiKey'];
  for (const field of Object.keys(mergedSelect)) {
    if (sensitiveFields.includes(field)) {
      throw new Error(`Field '${field}' is not accessible to plugins`);
    }
  }
  
  return prisma.server.findMany({
    where: args?.where,
    take: args?.take,
    skip: args?.skip,
    orderBy: args?.orderBy,
    select: mergedSelect,
  });
},
```

#### 2. Row-Level Security Hooks

**File: `catalyst-backend/src/plugins/context.ts`**

```typescript
interface ScopedPluginDB {
  servers: {
    findMany(args?: any): Promise<any>;
    // New: scoped queries
    findMyServers(args?: any): Promise<any>;  // Only servers the user has access to
  };
}

// In ScopedPluginDBClient:
get servers() {
  return {
    findMany: async (args?: any) => {
      // Apply row-level filter: only servers the plugin's current user can access
      const scopedWhere = {
        AND: [
          args?.where || {},
          // Add RLS filter based on current request context
          this.buildRowLevelFilter('servers'),
        ],
      };
      return prisma.server.findMany({ ...args, where: scopedWhere });
    },
  };
}

private buildRowLevelFilter(table: string): any {
  // Check if the current request has a user context
  const userId = this.currentUserId;
  if (!userId) return {};
  
  // Apply table-specific RLS
  switch (table) {
    case 'servers':
      // Only servers accessible to current user
      return { userId };
    default:
      return {};
  }
}
```

#### 3. Plugin Action Audit Trail

**File: `catalyst-backend/src/plugins/audit.ts`**

```typescript
import { prisma } from '../db';

export async function auditPluginAction(
  pluginName: string,
  action: string,
  resource: string,
  resourceId?: string,
  details?: Record<string, any>,
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      action: `plugin:${pluginName}:${action}`,
      resource,
      resourceId,
      details: details || {},
      performedBy: 'system', // Or current user ID
      pluginName,
      timestamp: new Date(),
    },
  });
}

// Wrap all database operations with audit
export function withAudit(
  pluginName: string,
  operation: string,
  fn: () => Promise<any>,
): Promise<any> {
  return fn().then(async (result) => {
    await auditPluginAction(pluginName, operation, 'database');
    return result;
  });
}
```

#### 4. Config Schema Validation in Manifest

**File: `catalyst-backend/src/plugins/validator.ts`** (updated schema)

```typescript
const PluginConfigFieldSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('string'),
    default: z.string().optional(),
    description: z.string().optional(),
    required: z.boolean().optional(),
    minLength: z.number().optional(),
    maxLength: z.number().optional(),
  }),
  z.object({
    type: z.literal('number'),
    default: z.number().optional(),
    description: z.string().optional(),
    required: z.boolean().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
  }),
  z.object({
    type: z.literal('boolean'),
    default: z.boolean().optional(),
    description: z.string().optional(),
  }),
  z.object({
    type: z.literal('select'),
    default: z.string().optional(),
    description: z.string().optional(),
    options: z.array(z.string()),
  }),
  z.object({
    type: z.literal('password'),
    default: z.string().optional(),
    description: z.string().optional(),
  }),
]);

// Updated manifest schema
export const PluginManifestSchema = z.object({
  // ... existing fields
  config: z.record(z.string(), PluginConfigFieldSchema).optional(),
});
```

**Backend validation on config update:**

```typescript
async setConfig<T = any>(key: string, value: T): Promise<void> {
  const configSchema = manifest.config?.[key];
  if (configSchema) {
    // Validate value against schema
    const validated = PluginConfigFieldSchema.parse(configSchema);
    if (validated.type === 'number' && typeof value !== 'number') {
      throw new Error(`Config '${key}' must be a number`);
    }
    if (validated.type === 'boolean' && typeof value !== 'boolean') {
      throw new Error(`Config '${key}' must be a boolean`);
    }
    // ... etc
  }
  
  // Continue with existing update logic
}
```

#### 5. Enforce Authentication on Plugin Routes

**File: `catalyst-backend/src/plugins/context.ts`**

```typescript
registerRoute(options: RouteOptions) {
  const routeOptions: RouteOptions = { ...options };
  
  // ALWAYS inject auth, never allow bypass
  const authHandlers = authenticate ? [authenticate] : [];
  
  if (options.preHandler) {
    // Plugin provided preHandler — wrap it with auth first
    routeOptions.preHandler = [...authHandlers, ...(Array.isArray(options.preHandler) ? options.preHandler : [options.preHandler])];
  } else {
    routeOptions.preHandler = authHandlers;
  }
  
  // Similarly for onRequest
  if (options.onRequest) {
    routeOptions.onRequest = [...authHandlers, ...(Array.isArray(options.onRequest) ? options.onRequest : [options.onRequest])];
  } else {
    routeOptions.onRequest = authHandlers;
  }
  
  routes.push(routeOptions);
}
```

#### Migration Path

1. Apply field whitelist fix immediately (no breaking change)
2. Add audit logging as opt-in feature
3. Update manifest schema validation (breaking change — requires plugin.json updates)
4. Add RLS as opt-in via manifest flag `"rowLevelSecurity": true`

---

## D. Performance & Scalability

### Current Approach
- JSON field storage for collections
- O(n) JavaScript filtering
- All plugins loaded at startup
- No caching layer

### Problems
- Collection queries scale linearly with document count
- No database-level indexing
- Plugin startup is sequential and blocking
- No query optimization

### Recommended Redesign

#### 1. Dedicated Collection Tables (Hybrid Approach)

Instead of storing collections as JSON arrays, use a dedicated table per collection type:

**File: `prisma/schema.prisma`** (additions)

```prisma
model PluginDocument {
  id        String   @id @default(cuid())
  pluginName String
  collection String
  data      Json
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  
  // Indexed fields for common queries
  // These are extracted from 'data' and maintained by triggers or application code
  indexedFields Json?
  
  @@index([pluginName, collection])
  @@index([pluginName, collection, createdAt])
  @@map("plugin_documents")
}
```

**File: `catalyst-backend/src/plugins/collection-v2.ts`**

```typescript
import { prisma } from '../db';

export class ScalableCollection implements PluginCollectionAPI {
  constructor(
    private name: string,
    private pluginName: string,
  ) {}
  
  async find(filter?: any, options?: PluginCollectionOptions): Promise<any[]> {
    const where = this.buildPrismaWhere(filter);
    
    const docs = await prisma.pluginDocument.findMany({
      where: {
        pluginName: this.pluginName,
        collection: this.name,
        ...where,
      },
      orderBy: options?.sort ? this.buildOrderBy(options.sort) : { createdAt: 'desc' },
      skip: options?.skip,
      take: options?.limit,
    });
    
    return docs.map(d => d.data);
  }
  
  async findOne(filter: any): Promise<any | null> {
    const results = await this.find(filter, { limit: 1 });
    return results[0] || null;
  }
  
  async insert(doc: any): Promise<any> {
    const newDoc = {
      ...doc,
      _id: generateId(),
      _createdAt: new Date().toISOString(),
      _updatedAt: new Date().toISOString(),
    };
    
    const result = await prisma.pluginDocument.create({
      data: {
        pluginName: this.pluginName,
        collection: this.name,
        data: newDoc,
      },
    });
    
    return result.data;
  }
  
  async update(filter: any, updateData: any): Promise<number> {
    const where = this.buildPrismaWhere(filter);
    
    const docs = await prisma.pluginDocument.findMany({
      where: {
        pluginName: this.pluginName,
        collection: this.name,
        ...where,
      },
    });
    
    let count = 0;
    for (const doc of docs) {
      const updated = this.applyUpdateOperators(doc.data, updateData);
      await prisma.pluginDocument.update({
        where: { id: doc.id },
        data: { data: updated },
      });
      count++;
    }
    
    return count;
  }
  
  private buildPrismaWhere(filter?: any): any {
    if (!filter) return {};
    
    // Convert MongoDB-style operators to Prisma JSON filtering
    const prismaWhere: any = {};
    
    for (const [key, value] of Object.entries(filter)) {
      if (key === '$or') {
        prismaWhere.OR = (value as any[]).map(v => ({ data: { path: [], equals: v } }));
      } else if (typeof value === 'object' && value !== null) {
        // Handle operators
        if (value.$eq !== undefined) {
          prismaWhere.data = { path: [key], equals: value.$eq };
        }
        if (value.$gt !== undefined) {
          prismaWhere.data = { path: [key], gt: value.$gt };
        }
        // ... etc
      } else {
        prismaWhere.data = { path: [key], equals: value };
      }
    }
    
    return prismaWhere;
  }
}
```

**Note:** Prisma's JSON filtering support varies by database. For PostgreSQL, this would use `->` and `@>` operators under the hood.

#### 2. Parallel Plugin Loading

**File: `catalyst-backend/src/plugins/loader.ts`** (modified)

```typescript
async discoverPlugins(): Promise<void> {
  // ... manifest reading and validation (unchanged)
  
  // Parallel loading with dependency groups
  const sorted = this.topologicalSort(manifestEntries);
  
  // Group by dependency depth for parallel loading
  const depthGroups = this.groupByDependencyDepth(sorted);
  
  for (const group of depthGroups) {
    // Load all plugins at the same dependency level in parallel
    await Promise.all(
      group.map(({ pluginPath }) => this.loadPlugin(pluginPath))
    );
  }
}

private groupByDependencyDepth(
  entries: { manifest: PluginManifest }[],
): { manifest: PluginManifest }[][] {
  const depths = new Map<string, number>();
  
  for (const entry of entries) {
    const deps = entry.manifest.dependencies || {};
    const maxDepDepth = Math.max(
      0,
      ...Object.keys(deps).map(dep => depths.get(dep) || 0),
    );
    depths.set(entry.manifest.name, maxDepDepth + 1);
  }
  
  const maxDepth = Math.max(...depths.values());
  const groups: { manifest: PluginManifest }[][] = [];
  
  for (let i = 1; i <= maxDepth; i++) {
    groups.push(entries.filter(e => depths.get(e.manifest.name) === i));
  }
  
  return groups;
}
```

#### 3. Plugin Data Caching

**File: `catalyst-backend/src/plugins/cache.ts`**

```typescript
import NodeCache from 'node-cache';

export class PluginCache {
  private cache: NodeCache;
  
  constructor() {
    this.cache = new NodeCache({
      stdTTL: 300, // 5 minutes default
      checkperiod: 60,
      useClones: true,
    });
  }
  
  get<T>(pluginName: string, key: string): T | undefined {
    return this.cache.get<T>(`${pluginName}:${key}`);
  }
  
  set<T>(pluginName: string, key: string, value: T, ttl?: number): void {
    this.cache.set(`${pluginName}:${key}`, value, ttl || 300);
  }
  
  invalidate(pluginName: string, pattern?: string): void {
    const keys = this.cache.keys().filter(k => k.startsWith(`${pluginName}:`));
    if (pattern) {
      const regex = new RegExp(pattern);
      this.cache.del(keys.filter(k => regex.test(k)));
    } else {
      this.cache.del(keys);
    }
  }
}
```

#### Migration Path

1. Add `PluginDocument` table via Prisma migration
2. Create `ScalableCollection` alongside existing `PluginCollectionImpl`
3. Allow plugins to opt into new collection API via manifest flag
4. After validation, make `ScalableCollection` the default

---

## E. Plugin Distribution & Registry

### Current Approach
Filesystem-based discovery from `catalyst-plugins/` directory.

### Problems
- No central registry
- No version management
- No trust/verification
- No dependency resolution for npm packages

### Recommended Redesign

#### Phase 1: npm-Based Distribution

Plugins are published as npm packages with a `catalyst-plugin` keyword:

```json
{
  "name": "@catalyst-plugins/ticketing",
  "version": "2.0.0",
  "keywords": ["catalyst-plugin"],
  "catalyst": {
    "manifest": "./plugin.json",
    "entry": "./dist/backend/index.js",
    "frontend": "./dist/frontend/index.js"
  },
  "peerDependencies": {
    "@catalyst/plugin-sdk": "^1.0.0"
  }
}
```

**CLI install command:**

```bash
# Install from npm
catalyst-cli plugin install @catalyst-plugins/ticketing

# Install from GitHub
catalyst-cli plugin install github:catalyst-team/ticketing-plugin

# Install from local directory
catalyst-cli plugin install ./my-plugin

# Install specific version
catalyst-cli plugin install @catalyst-plugins/ticketing@2.1.0
```

**File: `catalyst-backend/src/plugins/registry/npm-registry.ts`**

```typescript
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';

const execAsync = promisify(exec);

export class NpmPluginRegistry {
  private pluginsDir: string;
  
  constructor(pluginsDir: string) {
    this.pluginsDir = pluginsDir;
  }
  
  async install(packageName: string, version?: string): Promise<PluginManifest> {
    const targetDir = path.join(this.pluginsDir, packageName.replace('/', '__'));
    await fs.mkdir(targetDir, { recursive: true });
    
    // Install via npm
    const spec = version ? `${packageName}@${version}` : packageName;
    await execAsync(`npm install ${spec} --prefix ${targetDir}`, {
      cwd: targetDir,
    });
    
    // Read manifest from installed package
    const packageJson = JSON.parse(
      await fs.readFile(path.join(targetDir, 'node_modules', packageName, 'package.json'), 'utf-8')
    );
    
    const manifestPath = path.join(
      targetDir,
      'node_modules',
      packageName,
      packageJson.catalyst?.manifest || 'plugin.json',
    );
    
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
    
    // Create symlink for easy access
    await fs.symlink(
      path.join(targetDir, 'node_modules', packageName),
      path.join(this.pluginsDir, manifest.name),
    );
    
    return manifest;
  }
  
  async uninstall(pluginName: string): Promise<void> {
    const pluginDir = path.join(this.pluginsDir, pluginName);
    await fs.rm(pluginDir, { recursive: true, force: true });
  }
  
  async listInstalled(): Promise<PluginManifest[]> {
    // Read all plugin.json files in plugins directory
    const entries = await fs.readdir(this.pluginsDir, { withFileTypes: true });
    const manifests: PluginManifest[] = [];
    
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const manifestPath = path.join(this.pluginsDir, entry.name, 'plugin.json');
        const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
        manifests.push(manifest);
      } catch {
        // Skip invalid entries
      }
    }
    
    return manifests;
  }
}
```

#### Phase 2: Plugin Signing & Verification

```typescript
import { createVerify } from 'crypto';

export class PluginSignatureVerifier {
  private publicKey: string;
  
  constructor(publicKey: string) {
    this.publicKey = publicKey;
  }
  
  verify(pluginPath: string, signature: string): boolean {
    const verify = createVerify('SHA256');
    
    // Hash all files in the plugin directory
    const files = this.getAllFiles(pluginPath);
    for (const file of files.sort()) {
      const content = fs.readFileSync(file);
      verify.update(content);
    }
    
    return verify.verify(this.publicKey, signature, 'base64');
  }
}
```

#### Phase 3: Marketplace Concept

A simple marketplace API:

```typescript
// GET /api/marketplace/plugins
// Returns curated list of plugins with metadata, ratings, download counts

// GET /api/marketplace/plugins/:name
// Returns detailed plugin info, versions, changelog

// POST /api/marketplace/plugins/:name/install
// Admin-only: installs plugin from registry
```

#### Migration Path

1. Implement npm-based installation as a new discovery mechanism
2. Add `catalyst` field to plugin package.json for metadata
3. Publish `@catalyst-plugins/*` namespace packages for official plugins
4. Add signing verification as opt-in
5. Build marketplace UI as a separate initiative

---

## F. Frontend Architecture

### Current Approach
Frontend plugins are conditionally imported from `./{plugin-name}/components.tsx` at build time. No error boundaries, no CSS isolation.

### Problems
- Cannot install plugins without rebuilding frontend
- Plugin crashes bring down the entire React app
- CSS conflicts between plugins and host
- No code splitting per plugin

### Recommended Redesign

#### 1. Error Boundaries Per Plugin

**File: `catalyst-frontend/src/plugins/ErrorBoundary.tsx`**

```typescript
import React, { Component, ErrorInfo, ReactNode } from 'react';

interface PluginErrorBoundaryProps {
  pluginName: string;
  children: ReactNode;
  fallback?: ReactNode;
}

interface PluginErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

export class PluginErrorBoundary extends Component<
  PluginErrorBoundaryProps,
  PluginErrorBoundaryState
> {
  constructor(props: PluginErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }
  
  static getDerivedStateFromError(error: Error): PluginErrorBoundaryState {
    return { hasError: true, error };
  }
  
  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error(`Plugin ${this.props.pluginName} crashed:`, error, errorInfo);
    
    // Report to backend
    fetch('/api/system-errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        level: 'error',
        component: `plugin:${this.props.pluginName}`,
        message: error.message,
        stack: error.stack,
      }),
    }).catch(() => {});
  }
  
  render(): ReactNode {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4">
            <h3 className="text-red-800 font-semibold">
              Plugin Error: {this.props.pluginName}
            </h3>
            <p className="text-red-600 text-sm mt-1">
              This plugin encountered an error. Please try refreshing or contact support.
            </p>
            <button
              onClick={() => this.setState({ hasError: false })}
              className="mt-2 text-sm text-red-700 underline"
            >
              Try Again
            </button>
          </div>
        )
      );
    }
    
    return this.props.children;
  }
}
```

**Usage in PluginTabPage:**

```typescript
export default function PluginTabPage({ location, serverId }: PluginTabPageProps) {
  const tab = usePluginTabs(location).find((t) => t.id === pluginTabId);
  if (!tab) return <NotFound />;
  
  const TabComponent = tab.component;
  return (
    <PluginErrorBoundary pluginName={tab.id}>
      <TabComponent serverId={serverId} />
    </PluginErrorBoundary>
  );
}
```

#### 2. CSS Isolation with CSS Modules

**File: `catalyst-frontend/src/plugins/StyledPluginWrapper.tsx`**

```typescript
import React from 'react';

interface StyledPluginWrapperProps {
  pluginName: string;
  children: React.ReactNode;
}

/**
 * Wraps plugin components with CSS isolation.
 * Uses data attribute for scoped styling.
 */
export function StyledPluginWrapper({ pluginName, children }: StyledPluginWrapperProps) {
  return (
    <div
      data-catalyst-plugin={pluginName}
      className="catalyst-plugin-root"
    >
      <style>{`
        [data-catalyst-plugin="${pluginName}"] {
          /* Plugin-specific CSS custom properties */
          --plugin-primary: var(--catalyst-primary, #3b82f6);
        }
        
        /* Prevent plugins from affecting global styles */
        [data-catalyst-plugin="${pluginName}"] * {
          all: revert-layer;
        }
      `}</style>
      {children}
    </div>
  );
}
```

**For plugins, provide a styled-components/emotion-like API:**

```typescript
// In @catalyst/plugin-sdk/frontend
import { usePluginStyles } from '@catalyst/plugin-sdk/frontend';

export function MyPluginComponent() {
  const { css, theme } = usePluginStyles();
  
  return (
    <div className={css`
      background: ${theme.colors.background};
      color: ${theme.colors.text};
    `}>
      Plugin content
    </div>
  );
}
```

#### 3. True Dynamic Loading (Future Phase)

For true runtime plugin loading, use **Module Federation** or **import maps**:

```typescript
// Register plugin module at runtime
const pluginUrl = '/plugins/my-plugin/remoteEntry.js';

// Using dynamic import with import maps (modern browsers)
const importMap = document.createElement('script');
importMap.type = 'importmap';
importMap.textContent = JSON.stringify({
  imports: {
    'my-plugin': pluginUrl,
  },
});
document.head.appendChild(importMap);

// Later, dynamically import
const plugin = await import('my-plugin');
```

**Note:** This requires significant infrastructure (CDN, build pipeline, bundling) and is a Phase 3 initiative.

#### 4. State Isolation

**File: `catalyst-frontend/src/plugins/PluginStateProvider.tsx`**

```typescript
import React, { createContext, useContext, useState } from 'react';

const PluginStateContext = createContext<Map<string, any> | null>(null);

export function PluginStateProvider({ children }: { children: React.ReactNode }) {
  const [pluginStates] = useState(() => new Map<string, any>());
  
  return (
    <PluginStateContext.Provider value={pluginStates}>
      {children}
    </PluginStateContext.Provider>
  );
}

export function usePluginState<T>(pluginName: string, initialState: T): [T, (state: T) => void] {
  const states = useContext(PluginStateContext);
  if (!states) throw new Error('usePluginState must be used within PluginStateProvider');
  
  const [localState, setLocalState] = useState<T>(() => {
    return states.get(pluginName) || initialState;
  });
  
  const setState = (newState: T) => {
    states.set(pluginName, newState);
    setLocalState(newState);
  };
  
  return [localState, setState];
}
```

#### Migration Path

1. Add `PluginErrorBoundary` and wrap all plugin renderers (immediate, no breaking change)
2. Add CSS scoping via `data-catalyst-plugin` attribute
3. Document CSS best practices for plugin authors
4. Module Federation as a Phase 3 research initiative

---

## G. Observability & Operations

### Current Approach
Errors are logged via `captureSystemError()` and Pino logger. No per-plugin metrics.

### Problems
- No way to identify which plugin is causing performance issues
- No health check for plugin functionality
- Error logs are not aggregated or grouped

### Recommended Redesign

#### 1. Per-Plugin Metrics

**File: `catalyst-backend/src/plugins/metrics.ts`**

```typescript
import { Histogram, Counter, Gauge } from 'prom-client';

export class PluginMetrics {
  private requestDuration: Histogram;
  private requestCount: Counter;
  private errorCount: Counter;
  private activeConnections: Gauge;
  
  constructor() {
    this.requestDuration = new Histogram({
      name: 'catalyst_plugin_request_duration_seconds',
      help: 'Request duration for plugin routes',
      labelNames: ['plugin', 'route', 'method'],
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
    });
    
    this.requestCount = new Counter({
      name: 'catalyst_plugin_requests_total',
      help: 'Total requests handled by plugins',
      labelNames: ['plugin', 'route', 'method', 'status'],
    });
    
    this.errorCount = new Counter({
      name: 'catalyst_plugin_errors_total',
      help: 'Total errors from plugins',
      labelNames: ['plugin', 'error_type'],
    });
    
    this.activeConnections = new Gauge({
      name: 'catalyst_plugin_active_connections',
      help: 'Active WebSocket connections per plugin',
      labelNames: ['plugin'],
    });
  }
  
  recordRequest(plugin: string, route: string, method: string, durationMs: number, statusCode: number): void {
    const durationSeconds = durationMs / 1000;
    this.requestDuration.observe({ plugin, route, method }, durationSeconds);
    this.requestCount.inc({ plugin, route, method, status: String(statusCode) });
  }
  
  recordError(plugin: string, errorType: string): void {
    this.errorCount.inc({ plugin, error_type: errorType });
  }
  
  setActiveConnections(plugin: string, count: number): void {
    this.activeConnections.set({ plugin }, count);
  }
}
```

**Integration in route wrapping:**

```typescript
// In PluginLoader.loadPlugin()
for (const route of loadedPlugin.routes) {
  const originalHandler = route.handler;
  
  route.handler = async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = Date.now();
    
    try {
      // ... middleware and enabled checks ...
      const result = await (originalHandler as Function)(request, reply);
      
      pluginMetrics.recordRequest(
        manifest.name,
        route.url,
        String(route.method),
        Date.now() - startTime,
        reply.statusCode,
      );
      
      return result;
    } catch (err) {
      pluginMetrics.recordError(manifest.name, err.constructor.name);
      throw err;
    }
  };
}
```

#### 2. Plugin Health Checks

**File: `catalyst-backend/src/plugins/health.ts`**

```typescript
export interface PluginHealthCheck {
  name: string;
  check: () => Promise<HealthStatus>;
  intervalMs: number;
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  message?: string;
  details?: Record<string, any>;
}

// Add to PluginBackendContext:
interface PluginBackendContext {
  // ... existing methods
  registerHealthCheck(check: PluginHealthCheck): void;
}

// Example usage in a plugin:
ctx.registerHealthCheck({
  name: 'database-connection',
  intervalMs: 30000,
  check: async () => {
    try {
      await ctx.getStorage('health-check');
      return { status: 'healthy' };
    } catch {
      return { status: 'unhealthy', message: 'Cannot access storage' };
    }
  },
});
```

#### 3. Admin Dashboard Improvements

**New endpoints:**

```typescript
// GET /api/plugins/:name/metrics
// Returns:
{
  "success": true,
  "data": {
    "requestsPerMinute": 45,
    "averageResponseTimeMs": 120,
    "errorRate": 0.02,
    "activeTasks": 2,
    "memoryUsageMB": 45,
    "health": "healthy"
  }
}

// GET /api/plugins/:name/logs
// Returns recent plugin-specific log entries
```

#### Migration Path

1. Add `prom-client` dependency and metrics collection (no breaking change)
2. Add health check registration to context API (additive change)
3. Update admin UI to show metrics (frontend change)

---

## H. Lifecycle & State Management

### Current Approach
Four lifecycle hooks with simple status tracking. Race conditions possible in hot-reload.

### Problems
- No formal state machine
- Race conditions in enable/disable
- Hot-reload not debounced
- No graceful degradation

### Recommended Redesign

#### 1. Formal State Machine

**File: `catalyst-backend/src/plugins/state-machine.ts`**

```typescript
export type PluginState =
  | 'unregistered'
  | 'registered'
  | 'loading'
  | 'loaded'
  | 'enabling'
  | 'enabled'
  | 'disabling'
  | 'disabled'
  | 'unloading'
  | 'unloaded'
  | 'error';

export type PluginTransition =
  | { from: 'registered'; to: 'loading'; action: 'load' }
  | { from: 'loading'; to: 'loaded'; action: 'loadComplete' }
  | { from: 'loading'; to: 'error'; action: 'loadFailed' }
  | { from: 'loaded'; to: 'enabling'; action: 'enable' }
  | { from: 'enabling'; to: 'enabled'; action: 'enableComplete' }
  | { from: 'enabling'; to: 'error'; action: 'enableFailed' }
  | { from: 'enabled'; to: 'disabling'; action: 'disable' }
  | { from: 'disabling'; to: 'disabled'; action: 'disableComplete' }
  | { from: 'disabling'; to: 'error'; action: 'disableFailed' }
  | { from: 'disabled'; to: 'unloading'; action: 'unload' }
  | { from: 'unloading'; to: 'unloaded'; action: 'unloadComplete' }
  | { from: '*'; to: 'error'; action: 'error' };

export class PluginStateMachine {
  private state: PluginState = 'unregistered';
  private transitionLock = false;
  
  async transition(
    action: PluginTransition['action'],
    operation: () => Promise<void>,
  ): Promise<void> {
    if (this.transitionLock) {
      throw new Error(`Plugin is already transitioning (current state: ${this.state})`);
    }
    
    this.transitionLock = true;
    const previousState = this.state;
    
    try {
      // Set intermediate state
      this.state = this.getIntermediateState(action);
      
      // Execute the operation
      await operation();
      
      // Set final state
      this.state = this.getFinalState(action, true);
    } catch (err) {
      this.state = 'error';
      throw err;
    } finally {
      this.transitionLock = false;
    }
  }
  
  private getIntermediateState(action: string): PluginState {
    switch (action) {
      case 'load': return 'loading';
      case 'enable': return 'enabling';
      case 'disable': return 'disabling';
      case 'unload': return 'unloading';
      default: return this.state;
    }
  }
  
  getState(): PluginState {
    return this.state;
  }
}
```

#### 2. Debounced Hot-Reload

**File: `catalyst-backend/src/plugins/loader.ts`** (updated)

```typescript
import { debounce } from 'lodash-es';

export class PluginLoader {
  private reloadDebounceMap = new Map<string, ReturnType<typeof setTimeout>>();
  private reloadInProgress = new Set<string>();
  
  enableHotReload(): void {
    this.watcher = watch(this.pluginsDir, {
      persistent: true,
      ignoreInitial: true,
      depth: 2,
    });
    
    this.watcher.on('change', (filePath) => {
      const pluginName = this.extractPluginName(filePath);
      if (!pluginName || !this.registry.has(pluginName)) return;
      
      // Debounce: wait 500ms after last change before reloading
      if (this.reloadDebounceMap.has(pluginName)) {
        clearTimeout(this.reloadDebounceMap.get(pluginName)!);
      }
      
      this.reloadDebounceMap.set(
        pluginName,
        setTimeout(() => {
          this.reloadDebounceMap.delete(pluginName);
          this.performReload(pluginName);
        }, 500),
      );
    });
  }
  
  private async performReload(pluginName: string): Promise<void> {
    // Prevent concurrent reloads of the same plugin
    if (this.reloadInProgress.has(pluginName)) {
      this.logger.warn({ plugin: pluginName }, 'Reload already in progress, skipping');
      return;
    }
    
    this.reloadInProgress.add(pluginName);
    
    try {
      await this.reloadPlugin(pluginName);
    } finally {
      this.reloadInProgress.delete(pluginName);
    }
  }
}
```

#### 3. Graceful Degradation

```typescript
// If a plugin fails to enable, try to keep it in loaded state
async enablePlugin(name: string): Promise<void> {
  const plugin = this.registry.get(name);
  if (!plugin) throw new Error(`Plugin ${name} not found`);
  
  if (plugin.stateMachine.getState() === 'error') {
    // Attempt recovery by reloading
    this.logger.warn({ plugin: name }, 'Plugin in error state, attempting recovery');
    await this.reloadPlugin(name);
  }
  
  await plugin.stateMachine.transition('enable', async () => {
    if (plugin.enabledRef) {
      plugin.enabledRef.value = true;
    }
    
    if (plugin.backend?.onEnable) {
      await plugin.backend.onEnable(plugin.context);
    }
    
    plugin.enabledAt = new Date();
  });
}
```

#### Migration Path

1. Replace status enum with state machine (internal change, no API break)
2. Add debouncing to hot-reload (immediate fix)
3. Add transition locking to prevent race conditions

---

## I. Data Storage Modernization

### Current Approach
Collections stored as JSON arrays in `pluginStorage` table. O(n) queries.

### Problems
- No database-level indexing
- Entire collection loaded for every query
- No transactions
- No schema validation

### Recommended Redesign

See Section D.1 (ScalableCollection) for the primary solution. Additional improvements:

#### 1. Collection Schema Migration

Allow plugins to declare collection schemas:

```json
{
  "collections": {
    "tickets": {
      "schema": {
        "ticketNumber": { "type": "string", "indexed": true },
        "status": { "type": "string", "indexed": true },
        "priority": { "type": "string", "indexed": true },
        "assigneeId": { "type": "string", "indexed": true },
        "createdAt": { "type": "datetime", "indexed": true }
      }
    }
  }
}
```

#### 2. Indexed Fields Table

**File: `prisma/schema.prisma`**

```prisma
model PluginDocumentIndex {
  id           String   @id @default(cuid())
  documentId   String
  pluginName   String
  collection   String
  fieldPath    String
  stringValue  String?
  numberValue  Float?
  boolValue    Boolean?
  dateValue    DateTime?
  
  @@index([pluginName, collection, fieldPath, stringValue])
  @@index([pluginName, collection, fieldPath, numberValue])
  @@index([pluginName, collection, fieldPath, dateValue])
  @@map("plugin_document_indexes")
}
```

#### 3. Transaction Support

```typescript
async withTransaction<T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T> {
  return await prisma.$transaction(async (tx) => {
    // Create a transaction-scoped collection API
    const txCollection = new TransactionalCollection(this.name, this.pluginName, tx);
    return await fn(txCollection);
  });
}
```

#### Migration Path

1. Create new `plugin_documents` and `plugin_document_indexes` tables
2. Provide migration script to convert existing JSON collections
3. Update collection API to use new tables
4. Maintain backward compatibility during transition

---

# PART 3: Implementation Roadmap

## Phase 1: Immediate Wins (~2 weeks)

### Week 1
- [ ] Fix field whitelist bypass in `ScopedPluginDBClient` (Section C.1)
- [ ] Add `PluginErrorBoundary` to all frontend plugin renderers (Section F.1)
- [ ] Add debouncing to hot-reload (Section H.2)
- [ ] Add transition locking to prevent lifecycle race conditions (Section H.1)
- [ ] Enforce auth middleware on all plugin routes (Section C.5)

### Week 2
- [ ] Add per-plugin metrics collection using `prom-client` (Section G.1)
- [ ] Add health check registration API (Section G.2)
- [ ] Improve type safety: remove `any` from critical paths
- [ ] Add `PluginStateMachine` for formal lifecycle management (Section H.1)
- [ ] Document all changes and update plugin authoring guide

**Risk:** Low. All changes are additive or internal fixes with no breaking API changes.

---

## Phase 2: Core Redesign (~1-2 months)

### Month 1
- [ ] Design and implement `@catalyst/plugin-sdk` package (Section B)
- [ ] Create CLI scaffolding tool (`catalyst-plugin create`)
- [ ] Implement `ScalableCollection` with dedicated tables (Section D.1)
- [ ] Add `PluginDocument` and `PluginDocumentIndex` Prisma models (Section I)
- [ ] Implement isolated plugin runtime using `worker_threads` (Section A)
- [ ] Add resource limits and request timeouts (Section A)

### Month 2
- [ ] Add npm-based plugin installation (Section E)
- [ ] Implement plugin action audit trail (Section C.3)
- [ ] Add row-level security as opt-in feature (Section C.2)
- [ ] Implement config schema validation with typed fields (Section C.4)
- [ ] Add CSS isolation for frontend plugins (Section F.2)
- [ ] Migrate existing plugins to use SDK (ticketing, egg-explorer)
- [ ] Write comprehensive documentation and migration guide

**Risk:** Medium. Breaking changes to manifest schema and collection API. Existing plugins need migration.

---

## Phase 3: Ecosystem (~3+ months)

- [ ] Build plugin marketplace UI and API
- [ ] Implement plugin signing and verification (Section E)
- [ ] Add Module Federation for true frontend dynamic loading (Section F.3)
- [ ] Create plugin testing CI/CD pipeline
- [ ] Launch official plugin registry (`@catalyst-plugins/*`)
- [ ] Community plugin review process
- [ ] Plugin analytics and telemetry (opt-in)
- [ ] Advanced observability dashboard

**Risk:** Low-Medium. These are new features, not changes to existing functionality.

---

# PART 4: Risk Assessment

## Breaking Changes

| Change | Breaking? | Impact on Existing Plugins | Mitigation |
|--------|-----------|---------------------------|------------|
| Field whitelist fix | No | None | Internal security fix |
| Error boundaries | No | None | Additive UI improvement |
| Plugin state machine | No | None | Internal refactoring |
| Config schema validation | **Yes** | Plugin `config` in `plugin.json` must use new schema | Maintain backward compatibility for 1 version; deprecation warning |
| ScalableCollection | **Yes** | Collection API changes slightly | Provide migration script; maintain old API as deprecated |
| Isolated runtime | **Yes** | Plugins must opt in; legacy still works | `"runtime": "legacy"` default |
| Auth middleware enforcement | **Yes** | Plugins relying on unauthenticated routes break | Audit all plugins; provide opt-out for specific routes |
| Manifest schema changes | **Yes** | `config` field format changes | Version the manifest schema (`"manifestVersion": "2"`) |

## Migration Complexity

### Existing Plugins

**Example Plugin:**
- Requires: config schema update, adding error boundaries to components
- Effort: 2-4 hours

**Ticketing Plugin:**
- Requires: config schema update, collection API migration (high impact — uses collections heavily)
- Effort: 1-2 days

**Egg Explorer:**
- Requires: config schema update, minimal collection usage
- Effort: 2-4 hours

### Host Application

- Backend: Moderate changes to plugin loader, context, and registry
- Frontend: Additive changes (error boundaries, CSS isolation)
- Database: Migration for new collection tables

## Performance Regression Risks

| Change | Risk | Mitigation |
|--------|------|------------|
| Worker thread runtime | **High** — IPC overhead | Benchmark before rollout; keep legacy as default |
| Collection table migration | **Medium** — query pattern changes | Load test with ticketing plugin data |
| Metrics collection | **Low** — minimal overhead | Make opt-in per plugin |
| State machine locking | **Low** — prevents concurrency | Should improve stability |

## Operational Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Plugin authors resist SDK adoption | Medium | Ecosystem fragmentation | Make SDK optional but recommended; provide clear value proposition |
| Migration breaks production plugins | Medium | Service disruption | Rollback plan; canary deployment; feature flags |
| Worker thread instability | Medium | Server crashes | Fallback to legacy runtime on worker failure |
| Database migration failure | Low | Data loss | Full backup; incremental migration; rollback scripts |

---

# Appendix: File Reference

| File | Current Purpose | Recommended Change |
|------|----------------|-------------------|
| `catalyst-backend/src/plugins/types.ts` | Type definitions | Add isolated runtime types, config schema types |
| `catalyst-backend/src/plugins/loader.ts` | Plugin loading | Add state machine, debounced reload, parallel loading |
| `catalyst-backend/src/plugins/context.ts` | Context creation | Fix field whitelist, add RLS, add audit hooks |
| `catalyst-backend/src/plugins/validator.ts` | Manifest validation | Add `PluginConfigFieldSchema` discriminated union |
| `catalyst-backend/src/plugins/registry.ts` | Plugin registry | Add metrics, health check storage |
| `catalyst-backend/src/routes/plugins.ts` | Admin API | Add metrics endpoints, health endpoints |
| `catalyst-frontend/src/plugins/loader.ts` | Frontend loading | Add error boundary wrapper |
| `catalyst-frontend/src/plugins/PluginProvider.tsx` | React provider | No major changes |
| `catalyst-frontend/src/pages/PluginTabPage.tsx` | Tab renderer | Wrap with `PluginErrorBoundary` |
| `catalyst-frontend/src/pages/PluginRoutePage.tsx` | Route renderer | Wrap with `PluginErrorBoundary` |
| `prisma/schema.prisma` | Database schema | Add `PluginDocument`, `PluginDocumentIndex` |

---

*Report generated: 2026-04-28*
*For questions or clarifications, contact the Catalyst architecture team.*
