# TanStack Query Caching + Optimistic Update Fixes

## Summary

Fixed 16 caching/optimistic update issues across 14 files. All changes are targeted, minimal, and validated (0 new TypeScript errors).

---

## Caching Fixes (scout-05 findings)

### 1c/1d: ServerModManagerTab + ServerPluginManagerTab
- Added `staleTime: 300_000` (5min) to installed mods/plugins queries
- Added `refetchIntervalInBackground: false` to prevent background polling waste

### 1a: useFileManager
- Already had `refetchIntervalInBackground: false` ✅ (no change needed)

### 1b: FileTree.tsx (both instances)
- Added `refetchIntervalInBackground: false` to FileTreeNode query (line 39)
- Added `refetchIntervalInBackground: false` to FileTree root query (line 146)

### 1e: SftpConnectionInfo
- Added `refetchIntervalInBackground: false` to sftpInfo query

### 1g/1h: useDashboard
- Already had `refetchIntervalInBackground: false` on all 3 queries ✅ (no change needed)

### 1i: ServerActivityLogTab
- Added `refetchIntervalInBackground: false`
- Added `placeholderData: (prev) => prev` for instant tab-switch UI

### 2e: ServerDetailsPage invites query
- Changed `staleTime: 30_000` → `staleTime: 10 * 60 * 1000` (10min)
- Removed `refetchInterval: 30_000` (invites only change via mutations)

### 2g: NodeAllocationsPage allocations + IP pools
- Changed staleTime from 30s to 5min for both queries
- Removed `refetchInterval: 30_000` from both (mutation-driven invalidation only)

### 3b: NodeDetailsPage apiKeyStatus
- Removed `refetchInterval: 30_000` (only changes via mutation)
- Added `placeholderData: (prev) => prev` for smoother navigation

### 3c: NodeDetailsPage unregisteredContainers
- Removed `refetchInterval: 30_000` (changes via container events, not polling)

### 3d: MigrationPage catalystNodes
- Changed `staleTime: 30_000` → `staleTime: 5 * 60 * 1000`
- Removed `refetchInterval: 30_000` (migration targets rarely change)

### 4a: CloneServerDialog modal queries
- Added `staleTime: 5 * 60 * 1000` to `qk.nodes()` query
- Added `staleTime: 5 * 60 * 1000` to `qk.adminUsers({ limit: 200 })` query
- (accessibleNodes already uses `useAccessibleNodes()` hook with its own staleTime)

### 4b: ServerImportModal modal queries
- Added `staleTime: 5 * 60 * 1000` to `qk.templates()` query
- Added `staleTime: 5 * 60 * 1000` to `qk.adminUsers()` query

### 4c: TemplateEditModal nests query
- Added `staleTime: 5 * 60 * 1000` (was missing, causing unnecessary refetches)

### 5a/5c: Missing placeholderData
- NodeDetailsPage apiKeyStatus: added `placeholderData: (prev) => prev`
- ServerActivityLogTab: added `placeholderData: (prev) => prev`

---

## Optimistic Update Fixes (scout-06 findings)

### ISSUE 1: NodeDeleteDialog cancel/update scope mismatch
**Problem**: `cancelQueries` only targeted `qk.nodes()` but `setQueriesData` with predicate `queryKey[0] === 'nodes'` updated ALL node queries. `onError` rollback only restored `qk.nodes()`, not `qk.node(nodeId)`.

**Fix**:
- Changed `cancelQueries` to use predicate matching `queryKey[0] === 'nodes'` (covers all node queries)
- Changed snapshot from `getQueryData(qk.nodes())` to `getQueriesData` with predicate (captures all node query states)
- Changed `onError` rollback from `setQueryData(qk.nodes(), ctx.prev)` to iterating over all captured `[queryKey, data]` pairs and restoring each one

### ISSUE 2: DeleteServerDialog missing optimistic delete
**Problem**: Server card remained visible during network request, causing visual flicker.

**Fix**:
- Added `onMutate` that cancels `qk.servers()`, snapshots current list, filters out deleted server, removes `qk.server(serverId)` detail query
- Moved `queryClient.removeQueries({ queryKey: qk.server(serverId) })` from `onSettled` to `onMutate` (faster cleanup)
- Updated `onError` to restore snapshot via `setQueryData(qk.servers(), ctx.prev)`
- `onSettled` now only does `invalidateQueries` (server detail already removed in onMutate)

---

## Files Changed

| File | Changes |
|------|---------|
| `components/servers/tabs/ServerModManagerTab.tsx` | +staleTime, +refetchIntervalInBackground |
| `components/servers/tabs/ServerPluginManagerTab.tsx` | +staleTime, +refetchIntervalInBackground |
| `components/files/FileTree.tsx` | +refetchIntervalInBackground (×2) |
| `components/files/SftpConnectionInfo.tsx` | +refetchIntervalInBackground |
| `components/servers/tabs/ServerActivityLogTab.tsx` | +refetchIntervalInBackground, +placeholderData |
| `pages/servers/ServerDetailsPage.tsx` | invites: staleTime 10min, -refetchInterval |
| `pages/admin/NodeAllocationsPage.tsx` | allocations+pools: staleTime 5min, -refetchInterval |
| `pages/nodes/NodeDetailsPage.tsx` | apiKeyStatus: -refetchInterval, +placeholderData; unregisteredContainers: -refetchInterval |
| `pages/admin/MigrationPage.tsx` | catalystNodes: staleTime 5min, -refetchInterval |
| `components/servers/CloneServerDialog.tsx` | +staleTime 5min on 2 modal queries |
| `components/nodes/ServerImportModal.tsx` | +staleTime 5min on 2 modal queries |
| `components/templates/TemplateEditModal.tsx` | +staleTime 5min on nests query |
| `components/nodes/NodeDeleteDialog.tsx` | Fixed cancel/update scope mismatch, full rollback |
| `components/servers/DeleteServerDialog.tsx` | Added optimistic delete with onMutate + rollback |

## Validation
- TypeScript: 182 errors (all pre-existing, 0 new)
- ESLint: 0 new errors
