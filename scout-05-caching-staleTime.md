# Cache & StaleTime Audit Findings

## Executive Summary

Out of ~85 total useQuery calls audited across 30+ files, **~25 have configuration issues** spanning 4 categories:

1. **Missing `refetchIntervalInBackground: false`** — 9 queries with refetchInterval but no background-control flag
2. **Reference data with staleTime < 5min** — 7 queries where config/data metadata should persist longer
3. **refetchInterval on rarely-changing data** — 6 queries that should use mutation-driven invalidation
4. **Missing staleTime** on modal/conditional queries — 6 queries relying on 30s default

---

## Category 1: Missing `refetchIntervalInBackground: false`

### 1a. `hooks/useFileManager.ts` — line 26–34
```ts
const listQuery = useQuery({
  queryKey: qk.files(serverId!, path),
  queryFn: () => filesApi.list(serverId, path),
  enabled: Boolean(serverId),
  refetchInterval: 10000,  // ← polling every 10s
  staleTime: 30_000,
  // MISSING: refetchIntervalInBackground: false
});
```
**Issue:** Polls in background even when user has navigated away from file manager. **Fix:** Add `refetchIntervalInBackground: false`.

### 1b. `components/files/FileTree.tsx` — line 45–51 (FileTreeNode component)
```ts
const { data, isLoading } = useQuery({
  queryKey: qk.files(serverId, entry.path),
  queryFn: () => filesApi.list(serverId, entry.path),
  enabled: Boolean(serverId) && isExpanded,
  refetchOnWindowFocus: false,
  staleTime: 30_000,
  refetchInterval: 15_000,
  // MISSING: refetchIntervalInBackground: false
});
```
**Issue:** Each expanded directory node polls every 15s in background. Multiple expanded folders compound the issue. **Fix:** Add `refetchIntervalInBackground: false`.

### 1c. `components/servers/tabs/ServerModManagerTab.tsx` — line 364 (installed mods query)
```ts
const { data: installedMods = [] } = useQuery({
  queryKey: qk.modManagerInstalled(serverId ?? '', modTarget),
  queryFn: () => modManagerApi.installed(serverId ?? '', modTarget),
  enabled: Boolean(serverId && modManagerConfig),
  refetchInterval: 10000,
  // MISSING: staleTime AND refetchIntervalInBackground: false
});
```
**Issue:** Polls installed mods every 10s with no staleTime AND no background flag. This is a tab that users leave for hours. **Fix:** Add `staleTime: 300_000` and `refetchIntervalInBackground: false`.

### 1d. `components/servers/tabs/ServerPluginManagerTab.tsx` — line 297 (installed plugins query)
```ts
const { data: installedPlugins = [] } = useQuery({
  queryKey: qk.pluginManagerInstalled(serverId ?? ''),
  queryFn: () => pluginManagerApi.installed(serverId ?? ''),
  enabled: Boolean(serverId && pluginManagerConfig),
  refetchInterval: 10000,
  // MISSING: staleTime AND refetchIntervalInBackground: false
});
```
**Issue:** Same as 1c — polls installed plugins every 10s with no staleTime and no background flag. **Fix:** Add `staleTime: 300_000` and `refetchIntervalInBackground: false`.

### 1e. `components/files/SftpConnectionInfo.tsx` — line 55–62
```ts
const { data: sftpInfo, isLoading } = useQuery({
  queryKey: qk.sftpConnectionInfo(serverId),
  queryFn: () => serversApi.getSftpConnectionInfo(serverId, selectedTtl),
  staleTime: 30_000,
  refetchInterval: 15_000,
  // MISSING: refetchIntervalInBackground: false
});
```
**Issue:** Polls SFTP connection info (with token) every 15s in background. SFTP tokens are sensitive and don't change frequently — only need refresh on mount or token expiry UI. **Fix:** Add `refetchIntervalInBackground: false`, or consider removing refetchInterval entirely and using mutation-driven invalidation.

### 1f. `hooks/useDashboard.ts` — `useDashboardStats()` — line 6–12
```ts
export function useDashboardStats() {
  return useQuery({
    queryKey: qk.dashboardStats(),
    queryFn: dashboardApi.getStats,
    refetchInterval: 15_000,
    staleTime: 10_000,
    refetchIntervalInBackground: false,  // ← this one IS present
  });
}
```
**Note:** This one is correctly configured. ✅

### 1g. `hooks/useDashboard.ts` — `useDashboardActivity()` — line 16–22
```ts
export function useDashboardActivity(limit = 5) {
  return useQuery({
    queryKey: qk.dashboardActivity({ limit } as Record<string, unknown>),
    queryFn: () => dashboardApi.getActivity(limit),
    staleTime: 30_000,
    refetchInterval: 30_000,
    // MISSING: refetchIntervalInBackground: false
  });
}
```
**Issue:** Dashboard activity feed polls every 30s in background. **Fix:** Add `refetchIntervalInBackground: false`.

### 1h. `hooks/useDashboard.ts` — `useResourceStats()` — line 26–32
```ts
export function useResourceStats() {
  return useQuery({
    queryKey: qk.dashboardResources(),
    queryFn: dashboardApi.getResourceStats,
    refetchInterval: 10_000,
    staleTime: 5_000,
    // MISSING: refetchIntervalInBackground: false
  });
}
```
**Issue:** Dashboard resource stats poll every 10s in background. **Fix:** Add `refetchIntervalInBackground: false`.

### 1i. `components/servers/tabs/ServerActivityLogTab.tsx` — line 32–38
```ts
const { data, isLoading, isError, error } = useQuery<ServerActivityLogResponse>({
  queryKey: qk.serverActivity(serverId, { page, limit }),
  queryFn: () => serversApi.activity(serverId, { page, limit }),
  enabled: Boolean(serverId),
  staleTime: 30_000,
  refetchInterval: 10_000,
  // MISSING: refetchIntervalInBackground: false
});
```
**Issue:** Activity log polls every 10s with no background flag. **Fix:** Add `refetchIntervalInBackground: false`.

---

## Category 2: Reference Data with staleTime < 5min

These are queries for configuration/reference data (roles, presets, nests, locations, server databases, permissions) that should persist in cache for at least 5 minutes since they rarely change.

### 2a. `hooks/useAdmin.ts` — `useAdminRoles()` — line 40–46
```ts
export function useAdminRoles() {
  return useQuery({
    queryKey: qk.adminRoles(),
    queryFn: adminApi.listRoles,
    staleTime: 60_000,        // ← 1 minute, reference data
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}
```
**Issue:** Roles are reference data that rarely change. 60s staleTime + 30s refetchInterval is excessive for this data type. **Fix:** Change `staleTime` to `5 * 60 * 1000` and remove `refetchInterval` (mutation-driven invalidation is used in RolesPage.tsx).

### 2b. `pages/admin/RolesPage.tsx` — line 618–621 (roles query)
```ts
const { data: roles = [], isLoading } = useQuery({
  queryKey: qk.adminRoles(),
  queryFn: rolesApi.list,
  staleTime: 60_000,
  // refetchInterval not set — uses default 30s windowFocus refetch
});
```
**Issue:** Same as 2a — roles page uses its own staleTime of 60s. **Fix:** Change to `staleTime: 5 * 60 * 1000`.

### 2c. `pages/admin/RolesPage.tsx` — line 625–628 (presets query)
```ts
const { data: presets = [] } = useQuery({
  queryKey: qk.rolePresets(),
  queryFn: rolesApi.getPresets,
  staleTime: 60_000,
});
```
**Issue:** Presets are reference data. 1min staleTime. **Fix:** Change to `staleTime: 10 * 60 * 1000`.

### 2d. `pages/servers/ServerDetailsPage.tsx` — line 240–245
```ts
const { data: permissionsData } = useQuery<ServerPermissionsResponse>({
  queryKey: qk.serverPermissions(serverId ?? ''),
  queryFn: () => serversApi.permissions(serverId ?? ''),
  enabled: Boolean(serverId),
  staleTime: 60_000,
});
```
**Issue:** Server permissions rarely change after creation. 1min staleTime. **Fix:** Change to `staleTime: 5 * 60 * 1000`.

### 2e. `pages/servers/ServerDetailsPage.tsx` — line 246–253
```ts
const { data: invites = [] } = useQuery<ServerInvite[]>({
  queryKey: qk.serverInvites(serverId ?? ''),
  queryFn: () => serversApi.listInvites(serverId ?? ''),
  enabled: Boolean(serverId),
  staleTime: 30_000,
  refetchInterval: 30_000,
});
```
**Issue:** Invites are reference data (only change via mutations). 30s staleTime + 30s refetchInterval is wasteful. **Fix:** Change to `staleTime: 10 * 60 * 1000`, remove `refetchInterval`.

### 2f. `hooks/useServerDatabases.ts` — line 7–19
```ts
export function useServerDatabases(serverId?: string) {
  return useQuery({
    queryKey: qk.serverDatabases(serverId!),
    queryFn: () => databasesApi.list(serverId),
    enabled: Boolean(serverId),
    placeholderData: (prev) => prev,
    staleTime: 60_000,
  });
}
```
**Issue:** Server databases rarely change (only via mutations). 1min staleTime is too short. **Fix:** Change to `staleTime: 5 * 60 * 1000`.

### 2g. `pages/admin/NodeAllocationsPage.tsx` — line 98–112
```ts
const { data: allocations = [] } = useQuery<NodeAllocation[]>({
  queryKey: qk.adminNodeAllocations(nodeId!),
  queryFn: async () => { ... },
  enabled: !!nodeId,
  staleTime: 30_000,
  refetchInterval: 30_000,
});
const { data: allPools = [] } = useQuery({
  queryKey: qk.adminIpPools(nodeId!),
  queryFn: adminApi.listIpPools,
  staleTime: 30_000,
  refetchInterval: 30_000,
});
```
**Issue:** Allocations and IP pools are infrastructure config data. 30s staleTime + 30s refetch is excessive. **Fix:** Change to `staleTime: 5 * 60 * 1000`, remove `refetchInterval`.

---

## Category 3: `refetchInterval` on Rarely-Changing Data (Should Use Mutation Invalidation)

### 3a. `pages/admin/PluginsPage.tsx` — line 394–399
```ts
const { data: plugins, isLoading } = useQuery({
  queryKey: qk.adminPlugins(),
  queryFn: fetchPlugins,
  staleTime: 60_000,
  refetchInterval: 30_000,
});
```
**Issue:** Plugin list changes only when user enables/disables/reloads via mutations. The 30s refetch is unnecessary — mutations already call `queryClient.invalidateQueries`. **Fix:** Remove `refetchInterval: 30_000`. Let staleTime (60s) handle background freshness.

### 3b. `pages/nodes/NodeDetailsPage.tsx` — `apiKeyStatus` query — line 132–138
```ts
const { data: apiKeyStatus } = useQuery({
  queryKey: qk.nodeApiKey(nodeId!),
  queryFn: () => nodesApi.checkApiKey(nodeId!),
  enabled: !!nodeId,
  staleTime: 30_000,
  refetchInterval: 30_000,
});
```
**Issue:** Checks whether an API key exists. Changes only when user regenerates key (mutation). **Fix:** Remove `refetchInterval`. Add `placeholderData: (prev) => prev` for navigation.

### 3c. `pages/nodes/NodeDetailsPage.tsx` — `unregisteredContainers` query — line 192–199
```ts
const { data: unregisteredContainers = [] } = useQuery({
  queryKey: qk.unregisteredContainers(nodeId!),
  queryFn: () => nodesApi.getUnregisteredContainers(nodeId!),
  enabled: !!nodeId,
  staleTime: 60_000,
  refetchInterval: 30_000,
});
```
**Issue:** Discovered containers change only via container events, not 30s polling. **Fix:** Remove `refetchInterval`. Use SSE/events for invalidation.

### 3d. `pages/admin/MigrationPage.tsx` — `catalystNodes` query — line 721–726
```ts
const { data: catalystNodes = [] } = useQuery<CatalystNodeOption[]>({
  queryKey: qk.catalystNodes(),
  queryFn: migrationApi.getCatalystNodes,
  staleTime: 30_000,
  refetchInterval: 30_000,
});
```
**Issue:** Migration target nodes list changes rarely. **Fix:** Change to `staleTime: 5 * 60 * 1000`, remove `refetchInterval`.

### 3e. `hooks/useUpdateCheck.ts` — line 13–22
```ts
export function useUpdateCheck() {
  return useQuery<UpdateCheckResponse>({
    queryKey: qk.updateCheck(),
    queryFn: async () => { /* ... */ },
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
}
```
**Issue:** When `staleTime === refetchInterval`, the behavior is: query fetches once, then after 5min the interval fires. Since staleTime is also 5min, the refetch effectively just refreshes the cache at the same rate. This works but `refetchInterval` is redundant — `staleTime: 5 * 60 * 1000` alone with default `refetchOnWindowFocus` achieves the same result. **Fix:** Remove `refetchInterval`. Let the 5min staleTime + window focus refetch handle it.

### 3f. `components/files/SftpConnectionInfo.tsx` — `tokens` query — line 62–67
```ts
const { data: tokens = [] } = useQuery({
  queryKey: qk.sftpTokens(serverId),
  queryFn: () => serversApi.listSftpTokens(serverId),
  staleTime: 30_000,
});
```
**Issue:** No refetchInterval here, but the adjacent `sftpInfo` query above (line 55) has `refetchInterval: 15_000`. The tokens themselves rarely change. **No action needed** for this specific query.

---

## Category 4: Missing `staleTime` on Modal/Conditional Queries

### 4a. `components/servers/CloneServerDialog.tsx` — 3 queries missing staleTime
```ts
// Line 41
const { data: accessibleNodesData } = useQuery({
  queryKey: qk.accessibleNodes(),
  queryFn: /* ... */,
  enabled: open,
  // MISSING: staleTime
});

// Line 54
const { data: allNodes } = useQuery({
  queryKey: qk.nodes(),
  queryFn: () => nodesApi.list(),
  enabled: open && isAdmin,
  // MISSING: staleTime
});

// Line 66
const { data: usersData } = useQuery({
  queryKey: qk.adminUsers({ limit: 200 }),
  queryFn: () => adminApi.listUsers({ limit: 200 }),
  enabled: open && isAdmin,
  // MISSING: staleTime
});
```
**Issue:** All 3 use the 30s default staleTime. These are modal-only queries (`enabled: open`) that shouldn't poll indefinitely. **Fix:** Add `staleTime: 5 * 60 * 1000` to all three — once the modal closes, the stale data is harmless and there's no need to keep the query fresh.

### 4b. `components/nodes/ServerImportModal.tsx` — 2 queries missing staleTime
```ts
// Line 61
const { data: templates = [] } = useQuery({
  queryKey: qk.templates(),
  queryFn: () => templatesApi.list(),
  enabled: open,
  // MISSING: staleTime
});

// Line 68
const { data: usersData } = useQuery({
  queryKey: qk.adminUsers(),
  queryFn: () => adminApi.listUsers(),
  enabled: open,
  // MISSING: staleTime
});
```
**Issue:** Same as 4a — modal queries without explicit staleTime. **Fix:** Add `staleTime: 5 * 60 * 1000` to both.

### 4c. `components/templates/TemplateEditModal.tsx` — line 122–126
```ts
const { data: nests = [] } = useQuery({
  queryKey: qk.nests(),
  queryFn: nestsApi.list,
  // MISSING: staleTime
});
```
**Issue:** Nests query in edit modal has no staleTime. `TemplateCreateModal.tsx` line 111 already has `staleTime: 5 * 60 * 1000` for the same query. **Fix:** Add `staleTime: 5 * 60 * 1000` for consistency.

---

## Category 5: `placeholderData` Missing on Detail Pages / Tabs

### 5a. `pages/nodes/NodeDetailsPage.tsx` — `apiKeyStatus` query — line 132
```ts
const { data: apiKeyStatus } = useQuery({
  queryKey: qk.nodeApiKey(nodeId!),
  queryFn: () => nodesApi.checkApiKey(nodeId!),
  enabled: !!nodeId,
  staleTime: 30_000,
  refetchInterval: 30_000,
  // MISSING: placeholderData
});
```
**Issue:** Navigating to a node details page will show empty state on first load before API returns. **Fix:** Add `placeholderData: (prev) => prev`.

### 5b. `pages/nodes/NodeDetailsPage.tsx` — `unregisteredContainers` query — line 192
```ts
const { data: unregisteredContainers = [] } = useQuery({
  queryKey: qk.unregisteredContainers(nodeId!),
  queryFn: () => nodesApi.getUnregisteredContainers(nodeId!),
  enabled: !!nodeId,
  staleTime: 60_000,
  refetchInterval: 30_000,
  // MISSING: placeholderData (defaults to [] which is OK, but could be (prev) => prev)
});
```
**Issue:** Already destructured with `= []` default, so this is low risk. No change needed. ✅

### 5c. `components/servers/tabs/ServerActivityLogTab.tsx` — line 32
```ts
const { data, isLoading, isError, error } = useQuery<ServerActivityLogResponse>({
  queryKey: qk.serverActivity(serverId, { page, limit }),
  queryFn: () => serversApi.activity(serverId, { page, limit }),
  enabled: Boolean(serverId),
  staleTime: 30_000,
  refetchInterval: 10_000,
  // MISSING: placeholderData
});
```
**Issue:** Tab component — navigating back to this tab will show loading state on each entry. **Fix:** Add `placeholderData: (prev) => prev`.

---

## Summary Table

| # | File | Line(s) | Issue Type | Severity |
|---|------|---------|------------|----------|
| 1a | `hooks/useFileManager.ts` | 26–34 | Missing `refetchIntervalInBackground: false` | Medium |
| 1b | `components/files/FileTree.tsx` | 45–51 | Missing `refetchIntervalInBackground: false` | Medium |
| 1c | `components/servers/tabs/ServerModManagerTab.tsx` | 364 | Missing both `staleTime` and `refetchIntervalInBackground: false` | Medium |
| 1d | `components/servers/tabs/ServerPluginManagerTab.tsx` | 297 | Missing both `staleTime` and `refetchIntervalInBackground: false` | Medium |
| 1e | `components/files/SftpConnectionInfo.tsx` | 55–62 | Missing `refetchIntervalInBackground: false` | Low |
| 1g | `hooks/useDashboard.ts` — `useDashboardActivity` | 16–22 | Missing `refetchIntervalInBackground: false` | Low |
| 1h | `hooks/useDashboard.ts` — `useResourceStats` | 26–32 | Missing `refetchIntervalInBackground: false` | Low |
| 1i | `components/servers/tabs/ServerActivityLogTab.tsx` | 32–38 | Missing `refetchIntervalInBackground: false` | Low |
| 2a | `hooks/useAdmin.ts` — `useAdminRoles` | 40–46 | staleTime 1min, reference data | Low |
| 2b | `pages/admin/RolesPage.tsx` | 618–621 | staleTime 1min, reference data | Low |
| 2c | `pages/admin/RolesPage.tsx` | 625–628 | staleTime 1min, reference data | Low |
| 2d | `pages/servers/ServerDetailsPage.tsx` | 240–245 | staleTime 1min, reference data | Low |
| 2e | `pages/servers/ServerDetailsPage.tsx` | 246–253 | staleTime 30s + refetchInterval on reference data | Medium |
| 2f | `hooks/useServerDatabases.ts` | 7–19 | staleTime 1min, reference data | Low |
| 2g | `pages/admin/NodeAllocationsPage.tsx` | 98–112 | staleTime 30s + refetchInterval on reference data | Medium |
| 3a | `pages/admin/PluginsPage.tsx` | 394–399 | refetchInterval on rarely-changing data | Low |
| 3b | `pages/nodes/NodeDetailsPage.tsx` | 132–138 | refetchInterval on rarely-changing data | Low |
| 3c | `pages/nodes/NodeDetailsPage.tsx` | 192–199 | refetchInterval on rarely-changing data | Low |
| 3d | `pages/admin/MigrationPage.tsx` | 721–726 | refetchInterval on rarely-changing data | Low |
| 3e | `hooks/useUpdateCheck.ts` | 13–22 | Redundant refetchInterval | Low |
| 4a | `components/servers/CloneServerDialog.tsx` | 41, 54, 66 | Missing staleTime on modal queries | Low |
| 4b | `components/nodes/ServerImportModal.tsx` | 61, 68 | Missing staleTime on modal queries | Low |
| 4c | `components/templates/TemplateEditModal.tsx` | 122–126 | Missing staleTime | Low |
| 5a | `pages/nodes/NodeDetailsPage.tsx` | 132–138 | Missing placeholderData | Low |
| 5c | `components/servers/tabs/ServerActivityLogTab.tsx` | 32–38 | Missing placeholderData | Low |

---

## Prioritized Fixes

### High Impact (do first):
1. **1c, 1d** — ServerModManagerTab and ServerPluginManagerTab missing both `staleTime` and `refetchIntervalInBackground: false`. These poll every 10s with no background control — worst offenders for wasted bandwidth and CPU.

### Medium Impact:
2. **2e** — ServerDetailsPage invites query with 30s staleTime + 30s refetchInterval on reference data.
3. **2g** — NodeAllocationsPage allocations/IP pools with 30s staleTime + refetchInterval on infrastructure config.
4. **1a, 1b** — FileManager and FileTree polling in background.

### Low Impact:
5. **3a–3d** — refetchInterval removal on rarely-changing data (plugins, API key status, unregistered containers, migration nodes).
6. **4a, 4b, 4c** — Add `staleTime: 5 * 60 * 1000` to modal-only queries.
7. **2a, 2b, 2c, 2d, 2f** — Bump staleTime to 5+ min for reference data.
8. **5a, 5c** — Add `placeholderData: (prev) => prev` for smoother navigation.

---

## Correctly Configured Queries (✅ — no changes needed)

- `hooks/useServer.ts` — useServer: ✅ proper staleTime, refetchInterval, background flag
- `hooks/useBackups.ts` — useBackups: ✅ proper staleTime, dynamic refetchInterval, background flag
- `hooks/useAdmin.ts` — useAdminStats: ✅
- `hooks/useAdmin.ts` — useAdminHealth: ✅
- `hooks/useAdmin.ts` — useDatabaseHosts, useDatabaseHostPing, useDbStatus, useSmtpSettings, useSecuritySettings, useModManagerSettings, useThemeSettings, useOidcConfig, useDnsSettings: ✅ proper staleTime on settings data
- `hooks/useAdmin.ts` — useAuditLogs, useSystemErrors, useAuthLockouts: ✅ proper staleTime + refetchInterval
- `hooks/useNodes.ts` — useNodes, useAccessibleNodes, useNode: ✅ 5min staleTime on reference data
- `hooks/useNodes.ts` — useNodeStats, useNodeMetrics: ✅ 15s staleTime + refetchInterval on live metrics
- `hooks/useSseConsole.ts` — logsQuery: ✅ staleTime 30s, refetchOnWindowFocus: false, refetchOnReconnect: false
- `hooks/useServerMetricsHistory.ts` — ✅ 5s staleTime, 10s refetch on live metrics
- `hooks/useTemplates.ts` — useTemplates, useTemplate: ✅ 5min staleTime on reference data
- `hooks/useUpdateCheck.ts` — ✅ 5min staleTime (refetchInterval can be removed per 3e)
- `components/admin/RoleSelector.tsx` — ✅ 60s staleTime, used as reference in dropdown
- `components/admin/NodeAssignmentsSelector.tsx` — ✅ 60s staleTime on all 3 queries
- `components/nodes/NodeAssignmentModal.tsx` — ✅ 60s staleTime on modal queries
- `components/nodes/NodeCreateModal.tsx` — ✅ 5min staleTime on locations
- `components/nodes/NodeUpdateModal.tsx` — ✅ 5min staleTime on locations
- `components/nodes/LocationsManagerModal.tsx` — ✅ 60s staleTime on locations (could be 5min for consistency)
- `components/templates/NestsManagerModal.tsx` — ✅ 60s staleTime on nests (could be 5min)
- `components/templates/TemplateCreateModal.tsx` — ✅ 5min staleTime on nests
- `components/servers/tabs/ServerStartupVariablesSection.tsx` — ✅ 60s staleTime
- `components/nodes/NodeAssignmentsList.tsx` — ✅ 30s staleTime (acceptable for assignment state)
