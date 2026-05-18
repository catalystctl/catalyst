# TanStack Query Hardcoded Key Audit — Results

## Executive Summary

**ZERO hardcoded query key violations found.** Every query key in the entire `catalyst-frontend/src` codebase uses the `qk` factory from `@/lib/queryKeys`.

---

## Files Scanned

### All files with TanStack Query usage (verified individually):

#### Hooks (17 files)
| File | Query calls | All use qk? |
|---|---|---|
| `hooks/useAdmin.ts` | 18 useQuery + 1 useMutation + cancelQueries/setQueriesData | ✅ |
| `hooks/useApiKeys.ts` | 5 useQuery + 3 useMutation + cancelQueries/setQueryData | ✅ |
| `hooks/useAlertRules.ts` | 1 useQuery | ✅ |
| `hooks/useAlerts.ts` | 1 useQuery | ✅ |
| `hooks/useBackups.ts` | 1 useQuery + SSE invalidateQueries | ✅ |
| `hooks/useClusterMetrics.ts` | 2 useQuery | ✅ |
| `hooks/useDashboard.ts` | 3 useQuery | ✅ |
| `hooks/useFileManager.ts` | 1 useQuery | ✅ |
| `hooks/useNodes.ts` | 5 useQuery | ✅ |
| `hooks/useProfile.ts` | 6 useQuery | ✅ |
| `hooks/useServer.ts` | 1 useQuery | ✅ |
| `hooks/useServerDatabases.ts` | 1 useQuery | ✅ |
| `hooks/useServerMetrics.ts` | 0 (SSE-based state only) | N/A |
| `hooks/useServerMetricsHistory.ts` | 1 useQuery | ✅ |
| `hooks/useServers.ts` | 1 useQuery | ✅ |
| `hooks/useSseAdminEvents.ts` | 30+ invalidateQueries/removeQueries + setQueriesData | ✅ |
| `hooks/useSseConsole.ts` | 1 useQuery | ✅ |
| `hooks/useTasks.ts` | 1 useQuery | ✅ |
| `hooks/useTemplates.ts` | 2 useQuery | ✅ |
| `hooks/useUpdateCheck.ts` | 1 useQuery | ✅ |
| `hooks/useServerStateUpdates.ts` | setQueriesData/invalidateQueries/removeQueries | ✅ |

#### Pages (11 files)
| File | Query calls | All use qk? |
|---|---|---|
| `pages/InvitesPage.tsx` | 1 useQuery + 2 useMutation + invalidateQueries | ✅ |
| `pages/ProfilePage.tsx` | 1 useMutation + 18 invalidateQueries | ✅ |
| `pages/admin/MigrationPage.tsx` | 4 useQuery + 7 useMutation + invalidateQueries | ✅ |
| `pages/admin/NodeAllocationsPage.tsx` | 2 useQuery + 4 useMutation + invalidateQueries | ✅ |
| `pages/admin/NodesPage.tsx` | 1 useQuery + 1 useMutation + invalidateQueries | ✅ |
| `pages/admin/PluginsPage.tsx` | 2 useQuery + 3 useMutation + invalidateQueries | ✅ |
| `pages/admin/RolesPage.tsx` | 2 useQuery + 3 useMutation + invalidateQueries | ✅ |
| `pages/admin/ServersPage.tsx` | 1 useMutation + invalidateQueries | ✅ |
| `pages/admin/SecurityPage.tsx` | 2 useMutation + invalidateQueries | ✅ |
| `pages/admin/SystemPage.tsx` | 3 useMutation + invalidateQueries | ✅ |
| `pages/admin/ThemeSettingsPage.tsx` | 2 useMutation + invalidateQueries | ✅ |
| `pages/admin/UsersPage.tsx` | 2 useQuery + 12 useMutation + invalidateQueries | ✅ |
| `pages/admin/DatabasePage.tsx` | 3 useMutation + invalidateQueries | ✅ |
| `pages/alerts/AlertsPage.tsx` | 2 useQuery + 5 useMutation + invalidateQueries | ✅ |
| `pages/servers/ServerDetailsPage.tsx` | 5 useQuery + 2 useMutation + invalidateQueries | ✅ |

#### Components (5 files)
| File | Query calls | All use qk? |
|---|---|---|
| `components/admin/RoleSelector.tsx` | 1 useQuery | ✅ |
| `components/admin/UpdateSettings.tsx` | 1 useQuery + invalidateQueries | ✅ |
| `components/backups/CreateBackupModal.tsx` | 1 useMutation + invalidateQueries | ✅ |
| `components/backups/BackupSection.tsx` | invalidateQueries | ✅ |
| `components/backups/DeleteBackupDialog.tsx` | invalidateQueries | ✅ |
| `components/backups/RestoreBackupDialog.tsx` | invalidateQueries | ✅ |
| `components/nodes/NodeDeleteDialog.tsx` | cancelQueries/setQueriesData | ✅ |
| `components/servers/DeleteServerDialog.tsx` | removeQueries | ✅ |
| `components/servers/ServerControls.tsx` | cancelQueries/setQueryData | ✅ |

#### Hooks & Utilities
| File | Query calls | All use qk? |
|---|---|---|
| `lib/queryUtils.ts` | Documentation examples + matchQueryKeys helper | ✅ |
| `hooks/useSseAdminEvents.ts` | SSE event handler | ✅ |
| `hooks/useServerStateUpdates.ts` | SSE event handler | ✅ |

#### Plugin Hooks
| File | Query calls | All use qk? |
|---|---|---|
| `plugins/hooks.ts` | zustand-based (no TanStack Query) | N/A |
| `plugins/ticketing-plugin/hooks/useTicketingData.ts` | zustand-based (no TanStack Query) | N/A |

---

## Patterns Searched (ALL returned zero violations)

1. ✅ `queryKey: ['string']` — No hardcoded string arrays in useQuery/useMutation options
2. ✅ `queryKey: ['string']` in invalidateQueries — None found
3. ✅ `queryKey: ['string']` in setQueryData — None found
4. ✅ `queryKey: ['string']` in cancelQueries — None found
5. ✅ `queryKey: ['string']` in removeQueries — None found
6. ✅ `mutationKey: ['string']` in useMutation — None found (all use `qk.mutation.*`)
7. ✅ Template literals in query keys like `` [`something-${id}`] `` — None found
8. ✅ Concatenated keys like `['prefix-' + variable]` — None found
9. ✅ Variables holding hardcoded arrays — None found
10. ✅ Inline key arrays in options objects — None found

---

## Edge Cases Verified

- **Predicate-based setQueriesData**: Used correctly in SSE hooks (useServerStateUpdates, useSseAdminEvents) — these are the correct pattern for predicate-based cache matching
- **mutationKey**: All mutations use `qk.mutation.*` factory (e.g., `qk.mutation.adminDatabaseHostCreate()`)
- **No `prefetchQuery` calls** exist in the codebase
- **No `useInfiniteQuery`** calls exist in the codebase

---

## Conclusion

The codebase is **100% clean** — every single query key reference (approximately 150+ total across all files) uses the `qk` factory from `@/lib/queryKeys`. No hardcoded key arrays were found anywhere.

The qk factory is comprehensive and covers all entities: servers, nodes, locations, nests, templates, backups, tasks, files, databases, alerts, API keys, permissions, invites, roles, admin stats/settings, profile, migration, plugin manager, mod manager, and more.

---

## qk Factory Coverage

All entities with qk methods have corresponding qk entries:

- **Servers**: `server`, `servers`, `serverPermissions`, `serverInvites`, `serverAllocations`, `serverActivity`, `serverVariables`, `tasks`, `files`, `serverDatabases`, `backups`, `pluginManager*`, `modManager*`, `sftpTokens`, `sftpConnectionInfo`
- **Nodes**: `node`, `nodes`, `nodeStats`, `nodeMetrics`, `nodeAssignments`, `nodeApiKey`, `accessibleNodes`, `unregisteredContainers`
- **Admin**: All `admin*` prefixed methods (stats, health, users, roles, servers, nodes, plugins, audit logs, auth lockouts, system errors, database hosts, smtp, theme, security, oidc, dns, mod manager, update status, ip pools, node allocations)
- **General**: `session`, `locations`, `nests`, `templates`, `dashboard*`, `alerts*`, `apiKeys*`, `permissionsCatalog`, `myPermissions`, `invitePreview`, `rolePresets`, `catalystNodes`, `profile*`, `migration*`
- **Mutation keys**: `qk.mutation.adminDatabaseHostCreate/Update/Delete`, `qk.mutation.adminUserBan/Unban`
