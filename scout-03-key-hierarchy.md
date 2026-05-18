# Query Key Hierarchy & Invalidation Audit

## Executive Summary

**1 CRITICAL BUG + 2 MODERATE ISSUES + 1 LOW ISSUE found.**

The query key hierarchy itself is well-designed, but there's a **critical mismatch** between how `qk.servers()` builds its key (with `null` as the second element) and how TanStack Query v5 matches keys, causing server detail queries to not be invalidated on `server_deleted` and `server_updated` SSE events.

---

## 1. Query Key Hierarchy Definitions (from `lib/queryKeys.ts`)

### Servers — ✅ Correct hierarchy

```
qk.servers()              → ['servers', null]
qk.server(id)             → ['servers', id]
qk.serverPermissions(id)  → ['servers', id, 'permissions']
qk.serverInvites(id)      → ['servers', id, 'invites']
qk.serverAllocations(id)  → ['servers', id, 'allocations']
qk.serverActivity(id)     → ['servers', id, 'activity', params??null]
qk.serverVariables(id)    → ['servers', id, 'variables']
qk.serverMetrics(id)      → ['servers', id, 'metrics', params??null]
qk.serverLogs(id)         → ['servers', id, 'logs', initialLines??null]
qk.serverDatabases(id)    → ['servers', id, 'databases']
qk.backups(serverId)      → ['servers', serverId, 'backups', {page, limit}]
qk.tasks(serverId)        → ['servers', serverId, 'tasks']
qk.files(serverId)        → ['servers', serverId, 'files', path]
```

All sub-entities correctly nest under `['servers', id]`. ✅

### Nodes — ✅ Correct hierarchy

```
qk.nodes()                → ['nodes', null]
qk.node(id)               → ['nodes', id]
qk.nodeAssignments(id)    → ['nodes', id, 'assignments']
qk.nodeApiKey(id)         → ['nodes', id, 'api-key']
qk.accessibleNodes()      → ['nodes', 'accessible']
qk.nodeStats(id)          → ['nodes', id, 'stats']
qk.nodeMetrics(id)        → ['nodes', id, 'metrics']
qk.unregisteredContainers(id) → ['nodes', id, 'unregistered-containers']
```

All sub-entities correctly nest under `['nodes', id]`. ✅

### Other entities — Design inconsistencies (non-breaking)

| Query Key | Actual Return | Issue |
|-----------|--------------|-------|
| `qk.adminUsers()` | `['admin-users', params??null]` | Flat key, not nested under `'admin'` |
| `qk.adminNodes()` | `['admin-nodes', params??null]` | Flat key, not nested under `'admin'` |
| `qk.adminServers()` | `['admin-servers', params??null]` | Flat key, not nested under `'admin'` |
| `qk.adminRoles()` | `['admin-roles']` | Flat key |
| `qk.dashboardStats()` | `['dashboard-stats']` | Flat key |
| `qk.clusterMetrics()` | `['cluster-metrics', ...]` | Flat key |
| `qk.dashboardActivity()` | `['dashboard-activity', ...]` | Flat key |
| `qk.apiKeys()` | `['api-keys']` | Flat key |
| `qk.alertRules()` | `['alert-rules', ...]` | Flat key |
| `qk.alertStats()` | `['alerts-stats', ...]` | Flat key |
| `qk.adminIpPools(nodeId)` | `['ip-pools', nodeId]` | Nested under `'ip-pools'` not `'admin'` |
| `qk.adminNodeAllocations(nodeId)` | `['node-allocations', nodeId]` | Nested under `'node-allocations'` not `'admin'` |

**Impact**: These are naming/design inconsistencies but **not functional bugs** since all invalidations are explicitly targeted to specific keys (not relying on parent-prefix invalidation).

---

## 2. 🔴 CRITICAL BUG: `null` Wildcard Mismatch (TanStack Query v5)

**Location**: `qk.servers()` at `lib/queryKeys.ts:14`

```typescript
// Current (BUG):
servers: (filters?: Record<string, unknown>) => ['servers', filters ?? null] as const,
// Returns ['servers', null] when called without args
```

**Problem**: TanStack Query v5 does **not** treat `null` as a wildcard. `['servers', null]` is a **strict key** that only matches queries with exactly `['servers', null]` as their key. It does NOT match:
- Detail queries: `['servers', 'abc123']`, `['servers', 'abc123', 'permissions']`
- Filtered list queries: `['servers', {status: 'running'}]`

**Proof**: TanStack Query's `matchQueryKey` compares element-by-element. `['servers', null]` has length 2, and the query `['servers', 'abc123']` also has length 2 — but `'null' !== 'abc123'` so it returns `false`.

**Affected files:**

| File | Line | Event | What's invalidated | What's NOT invalidated |
|------|------|-------|-------------------|----------------------|
| `components/servers/DeleteServerDialog.tsx` | 35-37 | Server delete mutation | `qk.servers()` → `['servers', null]` only | `qk.server(id)` is removed (OK), but detail queries remain stale if not caught by the remove |
| `hooks/useSseAdminEvents.ts` | 114-125 | `server_deleted` | `qk.servers()` → `['servers', null]` only | Detail queries: `['servers', serverId]`, nested: `['servers', serverId, 'permissions']`, etc. |
| `hooks/useSseAdminEvents.ts` | 133-148 | `server_updated` | `qk.servers()` → `['servers', null]` only | Filtered list queries like `['servers', {status: 'running'}]` |
| `hooks/useServerStateUpdates.ts` | 126 | `server_deleted` via SSE | `qk.servers()` → `['servers', null]` only | Same as above |
| `hooks/useSseResizeComplete.ts` | 40 | Storage resize complete | `qk.servers()` → `['servers', null]` only | Detail queries |

**Expected behavior**: `invalidateQueries({ queryKey: ['servers'] })` would match ALL queries starting with `['servers']` (detail, filtered lists, nested sub-entities).

---

## 3. ⚠️ MODERATE ISSUE: `server_deleted` missing explicit `serverDatabases` invalidation

**Location**: `hooks/useSseAdminEvents.ts` lines 114-125

When a server is deleted via SSE, the `server_deleted` handler invalidates:
- `qk.adminServers()` ✅
- `qk.servers()` ❌ (critical bug #1 — doesn't catch detail queries)
- `qk.adminNodeAllocations(...)` ✅
- Dashboard stats/activity ✅

**But does NOT explicitly invalidate:**
- `qk.serverDatabases(serverId)` — only the SSE `useServerStateUpdates` handler has `qk.serverDatabases(serverId)` invalidation (line 355)
- `qk.serverVariables(serverId)` — not invalidated anywhere for `server_deleted`
- `qk.serverMetrics(serverId)` — not invalidated anywhere for `server_deleted`

**Impact**: After a server delete, navigating to the server detail page could show stale data until the query refetches (which returns 404).

---

## 4. ⚠️ MODERATE ISSUE: Node deletion missing child query invalidation

**Location**: `hooks/useSseAdminEvents.ts` lines 152-170

The `node_deleted` handler:
- Invalidates `qk.adminNodes()`, `qk.nodes()`, `qk.accessibleNodes()`
- Removes `qk.node(nodeId)`, `qk.adminNodeAllocations(nodeId)`
- ❌ Does NOT invalidate `qk.nodeStats(nodeId)`, `qk.nodeMetrics(nodeId)`

Compare to `node_updated` handler (lines 175-189) which DOES explicitly invalidate:
- `qk.node(nodeId)` ✅
- `qk.nodeStats(nodeId)` ✅
- `qk.nodeMetrics(nodeId)` ✅
- `qk.adminNodeAllocations(nodeId)` ✅

**Inconsistency**: Update invalidates more than delete for nodes.

---

## 5. ⬇️ LOW ISSUE: Empty string query key patterns

**Location**: `hooks/useSseAdminEvents.ts` line 301

```typescript
q.invalidateQueries({ queryKey: qk.adminIpPools('') }),
```

`qk.adminIpPools('')` returns `['ip-pools', '']`. No actual query uses an empty string as nodeId, so this invalidation is a **no-op**. Same pattern appears at:
- `useSseAdminEvents.ts` line 267: `qk.nodeApiKey('')`
- `useSseAdminEvents.ts` line 237: `qk.serverPermissions('')`
- `useSseAdminEvents.ts` line 145: `qk.server('')`
- `useSseAdminEvents.ts` line 189: `qk.adminNodeAllocations(nodeId)` (empty string variant)

**These appear to be stale/unused invalidation calls** from code that was refactored.

---

## 6. Invalidation Chain Verification

### Server Delete Chain ✅ (with critical caveat)
```
DeleteServerDialog:
  removeQueries({ qk.server(serverId) })  → Removes exact server detail ✅
  invalidateQueries({ qk.servers() })    → Invalidates ['servers', null] only ⚠️

SSE server_deleted:
  setQueriesData (predicate: key[0] === 'servers')  → Removes from all list caches ✅
  removeQueries({ qk.server(serverId) })            → Removes detail ✅
  invalidateQueries({ qk.servers() })               → ['servers', null] only ⚠️

Missing from chain (but covered by list cache removal):
  - qk.serverAllocations(id) — removed by predicate
  - qk.serverDatabases(id)   — NOT removed by predicate (no servers predicate for it)
  - qk.backups(serverId)     — NOT removed
  - qk.tasks(serverId)       — NOT removed
  - qk.serverVariables(id)   — NOT removed
  - qk.serverMetrics(id)     — NOT removed
  - qk.serverLogs(id)        — NOT removed
  - qk.files(serverId)       — NOT removed
  - qk.pluginManagerInstalled(id) — NOT removed
  - qk.modManagerInstalled(id)    — NOT removed
```

**Note**: TanStack Query's `removeQueries` removes exact keys. `removeQueries({ queryKey: qk.server(id) })` only removes `['servers', id]` — it does NOT cascade to children like `['servers', id, 'permissions']`. The predicate-based `setQueriesData` handles list caches but not detail/nested queries.

### Node Delete Chain ⚠️ (incomplete)
```
SSE node_deleted:
  invalidateQueries({ qk.adminNodes() })  → ['admin-nodes', ...] ✅
  invalidateQueries({ qk.nodes() })       → ['nodes', null] only ⚠️
  invalidateQueries({ qk.accessibleNodes() }) → ['nodes', 'accessible'] ✅
  invalidateQueries({ qk.adminNodeAllocations(nodeId) }) ✅
  removeQueries({ qk.node(nodeId) })      → ['nodes', id] ✅
  removeQueries({ qk.adminNodeAllocations(nodeId) }) ✅
  
MISSING:
  - qk.nodeStats(nodeId)  → NOT invalidated ❌
  - qk.nodeMetrics(nodeId) → NOT invalidated ❌
```

### Admin User Update Chain ✅
```
SSE user_updated:
  invalidateQueries({ qk.adminUsers() })    → ['admin-users', ...] ✅
  invalidateQueries({ qk.profile() })       → ['profile'] ✅
  invalidateQueries({ qk.myPermissions() }) → ['my-permissions'] ✅
  invalidateQueries({ qk.dashboardActivity() }) ✅

  - qk.adminRoles() is NOT invalidated — CORRECT (roles aren't being updated) ✅
```

---

## 7. Files That Need Changes

1. **`lib/queryKeys.ts:14`** — `qk.servers()` should return `['servers']` (without `null` suffix) to act as a proper collection prefix for invalidation. Same fix needed for `qk.nodes()`.

2. **`hooks/useSseAdminEvents.ts:114-125`** — `server_deleted` should explicitly invalidate all child queries or use the fixed `qk.servers()` pattern.

3. **`hooks/useSseAdminEvents.ts:152-170`** — `node_deleted` should explicitly invalidate `qk.nodeStats(nodeId)` and `qk.nodeMetrics(nodeId)` to match `node_updated` behavior.

4. **`hooks/useSseAdminEvents.ts`** — Clean up no-op invalidations with empty string arguments (lines 237, 267, 301).

---

## 8. Architecture Notes

The `matchQueryKeys` utility in `lib/queryUtils.ts:84-95` strips trailing `null` for manual key matching:
```typescript
const effective = p[p.length - 1] === null ? p.slice(0, -1) : p;
```
This correctly handles the `['servers', null]` → `['servers']` prefix conversion for the custom matching logic used by `optimisticSet`/`optimisticInvalidate`, but **TanStack Query's native `invalidateQueries` does NOT perform this stripping**.
