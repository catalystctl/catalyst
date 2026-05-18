# Worker 2: Key Hierarchy Fix — Findings

## Changes Made

### 1. `lib/queryKeys.ts` — Fixed all `?? null` patterns to conditional inclusion

**Before (BROKEN):**
```ts
servers: (filters?) => ['servers', filters ?? null]  // → ['servers', null] — prefix match FAILS
```

**After (FIXED):**
```ts
servers: (filters?) => filters ? ['servers', filters] : ['servers']  // → ['servers'] — prefix match WORKS
```

**All keys changed:**
- `servers`, `nodes` — the most critical ones (used for broad invalidation)
- `adminUsers`, `adminNodes`, `adminServers`, `adminPlugins`, `adminAuditLogs`, `adminAuthLockouts`, `adminSystemErrors` — admin collection keys
- `alerts`, `alertRules`, `alertStats` — alert collection keys
- `clusterMetrics`, `dashboardActivity` — dashboard collection keys
- `serverMetrics`, `serverLogs`, `serverActivity` — server sub-entity keys with optional params
- `profileAuditLog` — special case: uses `(limit || offset)` conditional since both default to undefined

**How prefix matching now works:**
- `invalidateQueries({ queryKey: ['servers'] })` matches ALL: `['servers']`, `['servers', id]`, `['servers', id, 'permissions']`, etc.
- `invalidateQueries({ queryKey: ['servers', {status:'run'}] })` matches only filtered list
- This is the correct TanStack Query v5 behavior

### 2. `lib/queryUtils.ts` — Simplified after null-suffix removal

- Removed `optimisticMutation` helper (dead code — never imported)
- Removed null-stripping logic in `optimisticInvalidate` — no longer needed since keys don't have `null` suffix
- Simplified `matchQueryKeys` — removed null-stripping from prefix matcher

### 3. `pages/admin/ServersPage.tsx` — V-01 fix

Added `qk.servers()` to `bulkActionMutation.onSettled` so admin bulk actions (start/stop/restart/suspend/unsuspend/delete) also invalidate the user-facing server list.

### 4. `components/servers/ServerControls.tsx` — V-02 fix

Added `qk.adminServers()` to all 4 power control mutations (start/stop/restart/kill) in their `onSettled` callbacks, so server power controls also invalidate the admin server list.

### 5. `hooks/useSseAdminEvents.ts` — Multiple fixes

**node_deleted handler:**
- Added `q.removeQueries({ queryKey: qk.nodeStats(nodeId) })` 
- Added `q.removeQueries({ queryKey: qk.nodeMetrics(nodeId) })`
- Now matches `node_updated` handler's cleanup completeness

**server_deleted handler:**
- Added `q.removeQueries` for `serverPermissions`, `serverInvites`, `serverAllocations`, `backups`, `tasks`
- Prevents stale child queries lingering after server deletion

**Dead invalidation fixes (from scout report):**
- `qk.serverPermissions('')` → replaced with predicate-based invalidation matching `queryKey[0] === 'servers' && queryKey[2] === 'permissions'`
- `qk.nodeApiKey('')` → replaced with predicate matching `queryKey[0] === 'nodes' && queryKey[2] === 'api-key'`
- `qk.adminIpPools('')` → replaced with predicate matching `queryKey[0] === 'ip-pools'`

**Race condition fixes:**
- `template_created` — added `q.invalidateQueries({ queryKey: qk.templates() })` after optimistic `setQueriesData`
- `template_deleted` — same reconciliation invalidation
- `system_error` — added `q.invalidateQueries({ queryKey: qk.adminSystemErrors() })` after optimistic prepend

**Empty-string guard fixes:**
- `qk.adminNodeAllocations(String(data.nodeId ?? ''))` → conditional `...(nodeId ? [...] : [])` pattern to avoid no-op invalidations with empty string

## Validation

- **TypeScript**: 0 new errors introduced. All TS errors in modified files are pre-existing.
- **Prefix matching**: `qk.servers()` now returns `['servers']` which correctly prefix-matches `['servers', id]`, `['servers', id, 'permissions']`, etc. in TanStack Query v5.
- **Backward compat**: `optimisticInvalidate` no longer strips `null` but the null-stripping code is no longer needed since no keys have trailing `null` (except `profileAuditLog` which keeps it for `limit`/`offset` params when present).

## Files Changed

1. `catalyst-frontend/src/lib/queryKeys.ts` — 56 lines changed
2. `catalyst-frontend/src/lib/queryUtils.ts` — 57 lines changed (removed dead code)
3. `catalyst-frontend/src/pages/admin/ServersPage.tsx` — 1 line added
4. `catalyst-frontend/src/components/servers/ServerControls.tsx` — 4 lines added
5. `catalyst-frontend/src/hooks/useSseAdminEvents.ts` — 62 lines changed

## Open Risks

- **Cache key shape change**: `qk.servers()` now returns `['servers']` instead of `['servers', null]`. Any code that directly compared query keys by equality (e.g., `queryKey === ['servers', null]`) would break, but TanStack Query's `invalidateQueries` uses prefix matching which works correctly with `['servers']`.
- **profileAuditLog**: Still uses `null` for `limit`/`offset` when only one is provided: `['profile-audit-log', null, offset]`. This is acceptable since audit log invalidation uses `qk.profileAuditLog()` (no args) which returns `['profile-audit-log']` — a valid prefix.
