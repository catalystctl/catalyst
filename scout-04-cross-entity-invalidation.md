# Cross-Entity Invalidation Audit — `catalyst-frontend/src`

## Summary

**Total mutations audited:** ~70+
**Cross-entity violations found:** 2 definite + 3 conditional

The codebase has excellent SSE-based invalidation coverage (`useSseAdminEvents` and `useServerStateUpdates` handle most cross-entity gaps). However, 2 mutations have **definite cross-entity gaps** that are not covered by the mutation's own `onSettled` callback — they rely solely on SSE as a safety net.

---

## Violations

### V-01 (DEFINITE) — Admin bulk actions don't invalidate user server list
**File:** `catalyst-frontend/src/pages/admin/ServersPage.tsx`
**Lines:** 213–248 (bulkActionMutation)

```typescript
const bulkActionMutation = useMutation({
  mutationFn: (payload: { serverIds: string[]; action: AdminServerAction; reason?: string }) =>
    adminApi.bulkServerAction(payload),
  onSettled: () => {
    queryClient.invalidateQueries({ queryKey: qk.adminServers() });
  },
  // ❌ MISSING: qk.servers()
});
```

**What it invalidates:** `qk.adminServers()`
**What it SHOULD also invalidate:** `qk.servers()`

**Why:** Admin bulk actions (start/stop/restart/delete) change server status. Non-admin users viewing their personal server list will see stale data until the SSE `server_updated` event fires.

**Impact:** Moderate. Users could see servers as "running" when they've been bulk-stopped by an admin, or vice versa. The SSE hook (`useServerStateUpdates`) will correct this asynchronously.

---

### V-02 (DEFINITE) — Server power controls don't invalidate admin server list
**File:** `catalyst-frontend/src/components/servers/ServerControls.tsx`
**Lines:** 54–131 (start, stop, restart, kill mutations)

```typescript
onSettled: () => {
  optimisticInvalidate(queryClient, qk.server(serverId));
  optimisticInvalidate(queryClient, qk.servers());
},
// ❌ MISSING: qk.adminServers()
```

**What it invalidates:** `qk.server(serverId)`, `qk.servers()` (via `optimisticInvalidate`)
**What it SHOULD also invalidate:** `qk.adminServers()`

**Why:** When an admin clicks start/stop/restart/kill on a server (they have permissions for but don't own), the admin servers page will not immediately reflect the new status. The `optimisticInvalidate` function strips trailing `null` and invalidates queries starting with `['servers']` — but `qk.adminServers()` starts with `['admin-servers', ...]` which is a different prefix.

**Impact:** Moderate. Admins managing many servers could see stale status in the admin list while working on individual server details.

---

### V-03 (CONDITIONAL) — Profile passkey mutations missing `qk.profile()` invalidation
**File:** `catalyst-frontend/src/pages/ProfilePage.tsx`
**Lines:** 190–205 (`addPkMutation`, `delPkMutation`, `updPkMutation`)

```typescript
// addPkMutation
onSettled: () => {
  queryClient.invalidateQueries({ queryKey: qk.profileAuditLog() });
},
// delPkMutation
onSettled: () => {
  queryClient.invalidateQueries({ queryKey: qk.profileAuditLog() });
},
// updPkMutation
onSettled: () => {
  queryClient.invalidateQueries({ queryKey: qk.profileAuditLog() });
},
```

**What they invalidate:** `qk.profileAuditLog()`
**Might also need:** `qk.profile()` — if the profile API response includes passkey count/data

**Note:** These mutations DO call `refreshPasskeys()` on success, so the passkey list is updated locally. If `qk.profile()` does not include passkey data, this is not a violation.

---

### V-04 (CONDITIONAL) — Backup generation missing `qk.profile()` invalidation
**File:** `catalyst-frontend/src/pages/ProfilePage.tsx`
**Line:** 184 (`genCodesMutation`)

```typescript
onSettled: () => {
  queryClient.invalidateQueries({ queryKey: qk.profileAuditLog() });
},
```

**What it invalidates:** `qk.profileAuditLog()`
**Might also need:** `qk.profile()` — generating 2FA backup codes is a significant auth state change

**Note:** Similar to V-03, depends on whether profile includes 2FA state.

---

### V-05 (CONDITIONAL) — Profile API key delete missing global `qk.apiKeys()` invalidation
**File:** `catalyst-frontend/src/pages/ProfilePage.tsx`
**Line:** 64 (`deleteMutation`)

```typescript
onSettled: () => {
  queryClient.invalidateQueries({ queryKey: qk.profileApiKeys() });
  queryClient.invalidateQueries({ queryKey: qk.profileAuditLog() });
},
```

**What it invalidates:** `qk.profileApiKeys()`, `qk.profileAuditLog()`
**Might also need:** `qk.apiKeys()` — if the user views both the profile page and global API keys page simultaneously

**Note:** The `useDeleteApiKey()` hook from `useApiKeys.ts` already handles `qk.apiKeys()` invalidation. This is only relevant if the profile page's `deleteMutation` and the global API keys page's hook are independent — they may be, which is fine.

---

## All Other Mutations — PASS ✓

The following categories were audited and found to have proper cross-entity invalidation:

### Server Mutations ✅
| File | Mutation | Invalidates | Cross-entities covered |
|------|----------|-------------|----------------------|
| `CreateServerModal.tsx` | create | `qk.servers()`, `qk.adminServers()` | ✅ Both |
| `DeleteServerDialog.tsx` | delete | `qk.servers()`, `qk.adminServers()`, removes `qk.server(id)` | ✅ Both |
| `UpdateServerModal.tsx` | update | `qk.server(id)`, `qk.servers()` | ✅ Both via SSE |
| `TransferServerModal.tsx` | transfer | `qk.server(id)`, `qk.servers()` | ✅ Both via SSE |
| `CloneServerDialog.tsx` | clone | `qk.servers()`, `qk.server(source)`, `qk.server(new)` | ✅ Both via SSE |
| `ServerDetailsPage.tsx` | suspend/unsuspend/rename/restartPolicy/resetCrashCount | `qk.server(id)`, `qk.servers()` | ✅ Both via SSE |
| `ServerDetailsPage.tsx` | add/remove/setPrimary allocation | `qk.serverAllocations(id)`, `qk.server(id)` | ✅ |
| `ServerDetailsPage.tsx` | create/delete/rotate database | `qk.serverDatabases(id)` | ✅ (SSE covers admin) |
| `ServerDetailsPage.tsx` | pause/delete task | `qk.tasks(id)` | ✅ |
| `ServerDetailsPage.tsx` | create/cancel invite | `qk.serverInvites(id)` | ✅ |
| `ServerDetailsPage.tsx` | save/remove access | `qk.serverPermissions(id)` | ✅ |
| `ServerDetailsPage.tsx` | rename/startupCommand (direct API call) | `qk.server(id)` | ✅ via SSE for admin |
| `ServerConfigurationTab.tsx` | config save | `qk.files(id, '/')` | ✅ (file-related) |
| `ServerStartupVariablesSection.tsx` | update variables | `qk.serverVariables(id)`, `qk.server(id)` | ✅ |
| `ServerSettingsTab.tsx` | subdomain/reinstall | `qk.server(id)`, `qk.servers()` | ✅ |
| `ServerAdminTab.tsx` | env vars | `qk.server(id)`, `qk.servers()` | ✅ |
| `ServerModManagerTab.tsx` | install/uninstall mod | `qk.modManagerInstalled(id, target)` | ✅ |
| `ServerPluginManagerTab.tsx` | install/uninstall plugin | `qk.pluginManagerInstalled(id)` | ✅ |

### Node Mutations ✅
| File | Mutation | Invalidates | Cross-entities covered |
|------|----------|-------------|----------------------|
| `NodeCreateModal.tsx` | create | `qk.nodes()`, `qk.adminNodes()` | ✅ Both |
| `NodeUpdateModal.tsx` | update | `qk.nodes()`, `qk.node(id)`, `qk.adminNodes()` | ✅ Both |
| `NodeDeleteDialog.tsx` | delete | `qk.nodes()`, `qk.adminNodes()` | ✅ Both |
| `NodesPage.tsx` | bulk delete | `qk.adminNodes()` | ✅ (SSE covers `qk.nodes()`) |
| `NodeDetailsPage.tsx` | deploy/api key | `qk.nodeApiKey(id)` | ✅ |
| `NodeAssignmentModal.tsx` | assign | `qk.nodeAssignments(id)` | ✅ |
| `NodeAssignmentsList.tsx` | remove | `qk.nodeAssignments(id)` | ✅ |
| `ServerImportModal.tsx` | import | `qk.node(id)`, `qk.nodeStats(id)`, `qk.unregisteredContainers(id)`, `qk.servers()`, `qk.adminServers()` | ✅ All |

### User Mutations ✅
| File | Mutation | Invalidates | Cross-entities covered |
|------|----------|-------------|----------------------|
| `UsersPage.tsx` | create | `qk.adminUsers()` | ✅ |
| `UsersPage.tsx` | update | `qk.adminUsers()`, `qk.adminRoles()` | ✅ |
| `UsersPage.tsx` | delete/bulkDelete | `qk.adminUsers()`, `qk.adminRoles()` | ✅ |
| `UsersPage.tsx` | ban/unban/wipePasskeys/wipe2fa/enforce2fa/unlinkAccount/verifyEmail | `qk.adminUsers()` | ✅ (SSE covers all) |

### Backup Mutations ✅
| File | Mutation | Invalidates | Cross-entities covered |
|------|----------|-------------|----------------------|
| `CreateBackupModal.tsx` | create | `qk.backups(serverId)` | ✅ |
| `DeleteBackupDialog.tsx` | delete | `qk.backups(serverId)` | ✅ |
| `RestoreBackupDialog.tsx` | restore | `qk.backups(serverId)`, `qk.server(serverId)` | ✅ Both |

### Database Mutations ✅
| File | Mutation | Invalidates | Cross-entities covered |
|------|----------|-------------|----------------------|
| `DatabasePage.tsx` | create/update/delete host | `qk.adminDatabaseHosts()` | ✅ (SSE covers `qk.databaseHosts()`) |

### Template/Nest Mutations ✅
| File | Mutation | Invalidates | Cross-entities covered |
|------|----------|-------------|----------------------|
| `TemplateCreateModal.tsx` | create | `qk.templates()`, `qk.nests()` | ✅ |
| `TemplateEditModal.tsx` | update | `qk.templates()`, `qk.template(id)` | ✅ |
| `TemplateDeleteDialog.tsx` | delete | `qk.templates()`, `qk.template(id)` | ✅ |
| `TemplatesPage.tsx` | bulk delete | `qk.templates()` | ✅ (no nest impact) |
| `NestsManagerModal.tsx` | create/update/delete | `qk.nests()`, `qk.templates()` | ✅ |

### Location Mutations ✅
| File | Mutation | Invalidates | Cross-entities covered |
|------|----------|-------------|----------------------|
| `LocationsManagerModal.tsx` | create/update/delete | `qk.locations()`, `qk.nodes()`, `qk.adminNodes()` | ✅ All |

### Node Allocations Mutations ✅
| File | Mutation | Invalidates | Cross-entities covered |
|------|----------|-------------|----------------------|
| `NodeAllocationsPage.tsx` | create/delete port | `qk.adminNodeAllocations(nodeId)` | ✅ |
| `NodeAllocationsPage.tsx` | create/delete pool | `qk.adminIpPools(nodeId)` | ✅ |

### Task Mutations ✅
| File | Mutation | Invalidates | Cross-entities covered |
|------|----------|-------------|----------------------|
| `CreateTaskModal.tsx` | create | `qk.tasks(serverId)` | ✅ |
| `EditTaskModal.tsx` | update | `qk.tasks(serverId)` | ✅ |

### Alert Mutations ✅
| File | Mutation | Invalidates | Cross-entities covered |
|------|----------|-------------|----------------------|
| `AlertsPage.tsx` | create/update/delete rule | `qk.alertRules()` | ✅ |
| `AlertsPage.tsx` | resolve/bulkResolve | `qk.alerts()`, `qk.alertStats()`, `qk.alertRules()` | ✅ |

### Settings Mutations ✅
| File | Mutation | Invalidates | Cross-entities covered |
|------|----------|-------------|----------------------|
| `SecurityPage.tsx` | update security | `qk.adminSecuritySettings()` | ✅ |
| `SecurityPage.tsx` | clear lockout | `qk.adminAuthLockouts()` | ✅ |
| `SystemPage.tsx` | SMTP/DNS/modManager | respective settings queries | ✅ |
| `ThemeSettingsPage.tsx` | OIDC | `qk.adminThemeSettings()`, `qk.adminOidcConfig()` | ✅ |
| `ThemeSettingsPage.tsx` | update theme | `qk.adminThemeSettings()` | ✅ |
| `UpdateSettings.tsx` | trigger update | `qk.adminUpdateStatus()` | ✅ |

### Plugin Mutations ✅
| File | Mutation | Invalidates | Cross-entities covered |
|------|----------|-------------|----------------------|
| `PluginsPage.tsx` | update/toggle/reload | `qk.adminPlugins()`, `qk.adminPlugin(name)` | ✅ |

### API Key Mutations ✅
| File | Mutation | Invalidates | Cross-entities covered |
|------|----------|-------------|----------------------|
| `useApiKeys.ts` | create | `qk.apiKeys()` | ✅ |
| `useApiKeys.ts` | update | `qk.apiKeys()`, `qk.apiKeyVariable(id)` | ✅ |
| `useApiKeys.ts` | delete | `qk.apiKeys()` (with optimistic delete) | ✅ |

### Profile Mutations ✅
| File | Mutation | Invalidates | Cross-entities covered |
|------|----------|-------------|----------------------|
| `ProfilePage.tsx` | avatar upload/remove | `qk.profile()` | ✅ |
| `ProfilePage.tsx` | update profile | `qk.profile()`, `qk.profileAuditLog()` | ✅ |
| `ProfilePage.tsx` | changePassword/setPassword | `qk.profile()`, `qk.profileSessions()` | ✅ |
| `ProfilePage.tsx` | enable/disable TFA | `qk.profile()`, `qk.profileAuditLog()` | ✅ |
| `ProfilePage.tsx` | revoke session/all | `qk.profileSessions()`, `qk.profileAuditLog()` | ✅ |
| `ProfilePage.tsx` | API key delete | `qk.profileApiKeys()`, `qk.profileAuditLog()` | ✅ |

### Invite Mutations ✅
| File | Mutation | Invalidates | Cross-entities covered |
|------|----------|-------------|----------------------|
| `InvitesPage.tsx` | accept/register | `qk.servers()` | ✅ |

### Migration Mutations ✅
| File | Mutation | Invalidates | Cross-entities covered |
|------|----------|-------------|----------------------|
| `MigrationPage.tsx` | test/start/pause/resume/cancel/retry | `qk.migrationJobs()`, `qk.migrationJob(id)`, `qk.migrationSteps(id)` | ✅ |

---

## SSE Safety Net Coverage

The following SSE hooks provide additional cross-entity invalidation that covers many mutation gaps:

### `useSseAdminEvents` (AdminEntity)
Handles: user created/updated/deleted, server created/deleted/updated/suspended/unsuspended, node created/deleted/updated, template created/updated/deleted, role created/updated/deleted, alert rule/alert instance events, API key events, location/nest events, database host events, IP pool events, settings events, plugin events, audit log events, auth lockout events, task events, database events, node assignment events, mod/plugin manager events, system error events.

### `useServerStateUpdates` (ServerEntity)
Handles: server state changes, server deletion, server lifecycle (create/update/suspend/unsuspend), backup events, file changes, task events, mod/plugin manager events.

### `useSseResizeComplete`
Handles: `storage_resize_complete` → `qk.server(serverId)`, `qk.servers()`, `qk.dashboardResources()`, `qk.dashboardStats()`

### Backup SSE (`useBackups`)
Handles: `backup_complete`, `backup_restore_complete`, `backup_delete_complete` → `qk.backups(serverId)`

---

## Recommended Fix Order

1. **V-01** (highest priority) — Add `qk.servers()` to `bulkActionMutation.onSettled` in `ServersPage.tsx`
2. **V-02** (high priority) — Add `qk.adminServers()` to `ServerControls.onSettled` in `ServerControls.tsx`
3. **V-03/V-04** (low priority) — Add `qk.profile()` invalidation to passkey and genCodes mutations if the profile API includes those fields
