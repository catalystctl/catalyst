# SSE Hook Bugs — Fix Report

## Summary
Fixed 7 bugs + 5 cleanup items across 2 SSE hook files. All changes verified — 0 new TypeScript errors.

## Files Modified
1. `catalyst-frontend/src/hooks/useSseAdminEvents.ts`
2. `catalyst-frontend/src/hooks/useServerStateUpdates.ts`

## Bugs Fixed

### BUG-01: Dead invalidation — `qk.serverPermissions('')` on role_updated
**Before:** `q.invalidateQueries({ queryKey: qk.serverPermissions('') })` → produced `['servers', '', 'permissions']`, never matched real queries.
**After:** Predicate-based invalidation matching all queries with `queryKey[0] === 'servers' && queryKey[2] === 'permissions'`.

### BUG-02: Dead invalidation — `qk.nodeApiKey('')` on API key events
**Before:** `q.invalidateQueries({ queryKey: qk.nodeApiKey('') })` → produced `['nodes', '', 'api-key']`, never matched real queries.
**After:** Predicate-based invalidation matching all queries with `queryKey[0] === 'nodes' && queryKey[2] === 'api-key'`.

### BUG-03: `server_updated` in useServerStateUpdates only invalidated list
**Before:** Only `q.invalidateQueries({ queryKey: qk.servers() })`.
**After:** Also invalidates `qk.server(serverId)`, `qk.serverAllocations(serverId)`, `qk.serverPermissions(serverId)` when serverId is available.

### BUG-04: `server_deleted` didn't remove related detail queries
**Before:** Only `q.removeQueries({ queryKey: qk.server(serverId) })`.
**After:** Also removes `serverPermissions`, `serverInvites`, `serverAllocations`, `backups`, `tasks` for the deleted server. Applied to both `useServerStateUpdates.ts` and `useSseAdminEvents.ts`.

### BUG-07: `server_state_update` didn't invalidate detail query
**Before:** Batched `processUpdates()` only called `q.invalidateQueries({ queryKey: qk.servers() })`.
**After:** Also calls `q.invalidateQueries({ queryKey: qk.server(serverId) })` for each updated server in the batch.

### RACE-01: `template_created`/`template_deleted` used `setQueriesData` without refetch
**Before:** Optimistic insert/remove into templates list, no `invalidateQueries` to reconcile.
**After:** Added `q.invalidateQueries({ queryKey: qk.templates() })` after each `setQueriesData` call.

### RACE-02: `system_error` used `setQueriesData` without refetch
**Before:** Optimistic prepend of new system error, no `invalidateQueries` to reconcile.
**After:** Added `q.invalidateQueries({ queryKey: qk.adminSystemErrors() })` after the `setQueriesData` call.

## Cleanup Items

### Empty-string key cleanup — `qk.adminIpPools('')`
**Before:** `q.invalidateQueries({ queryKey: qk.adminIpPools('') })` → dead invalidation when no nodeId.
**After:** If nodeId available from event data, use it. Otherwise use predicate matching `queryKey[0] === 'ip-pools'`.

### Empty-string key cleanup — `qk.adminNodeAllocations(String(data.nodeId ?? ''))`
**Before:** Passed empty string as key argument when nodeId was missing → no-op invalidation.
**After:** Extract nodeId to variable, use conditional spread `...(nodeId ? [q.invalidateQueries(...)] : [])` to skip when empty.

### Node deletion missing child query removal
**Before:** `node_deleted` only removed `qk.node(nodeId)` and `qk.adminNodeAllocations(nodeId)`.
**After:** Also removes `qk.nodeStats(nodeId)` and `qk.nodeMetrics(nodeId)` (matching `node_updated` behavior).

### Server deletion in useSseAdminEvents missing child query removal
**Before:** Only removed `qk.server(serverId)`.
**After:** Also removes `serverPermissions`, `serverInvites`, `serverAllocations`, `backups`, `tasks`.

## Validation
- TypeScript: 0 new errors (182 pre-existing)
- No remaining `qk.xxx('')` patterns in either file
- All `String(data.xxx ?? '')` key arguments guarded by conditional spreads or `if` checks
