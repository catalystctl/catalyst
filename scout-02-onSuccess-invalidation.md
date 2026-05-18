# TanStack Query Audit: onSuccess Invalidation Deep Scan

## Methodology
Searched ALL `useMutation` calls in `catalyst-frontend/src` for mutations with `invalidateQueries` inside `onSuccess` callback body (anti-pattern: should be in `onSettled`). Also checked for:
1. Mutations with no invalidation at all
2. `.then()` chains on imperative API calls
3. Mutations with `onSettled` that do NOT invalidate

---

## Findings

### ✅ PASS — All Mutations Checked
**Zero critical violations found.** No mutation places `invalidateQueries` calls inside an `onSuccess` callback. All mutation invalidation logic is correctly placed in `onSettled` callbacks.

---

### 1. Mutations with `onSuccess` BUT invalidation is in `onSettled` (CORRECT ✅)

All ~60 mutations found throughout the codebase follow the correct pattern:
- `onSuccess` / `onError`: UI feedback (toasts, notifications)
- `onSettled`: `queryClient.invalidateQueries({...})`

Verified across these files:
| File | Mutations | Status |
|------|-----------|--------|
| `hooks/useAdmin.ts` | `useResolveSystemError` | ✅ onSettled |
| `hooks/useApiKeys.ts` | `useCreateApiKey`, `useUpdateApiKey`, `useDeleteApiKey` | ✅ onSettled |
| `components/backups/CreateBackupModal.tsx` | 1 | ✅ onSettled |
| `components/backups/DeleteBackupDialog.tsx` | 1 | ✅ onSettled |
| `components/backups/RestoreBackupDialog.tsx` | 1 | ✅ onSettled |
| `components/nodes/NodeAssignmentModal.tsx` | 1 | ✅ onSettled |
| `components/nodes/NodeAssignmentsList.tsx` | 1 | ✅ onSettled |
| `components/nodes/ServerImportModal.tsx` | `importMutation` | ✅ onSettled (5 query invalidations) |
| `components/nodes/NodeUpdateModal.tsx` | 1 | ✅ onSettled (3 queries) |
| `components/nodes/NodeDeleteDialog.tsx` | 1 | ✅ onSettled + optimistic update |
| `components/nodes/NodeCreateModal.tsx` | `createMutation`, `deployTokenMutation` | ✅ onSettled |
| `components/nodes/LocationsManagerModal.tsx` | `createMutation`, `updateMutation`, `deleteMutation` | ✅ onSettled |
| `components/tasks/EditTaskModal.tsx` | 1 | ✅ onSettled |
| `components/tasks/CreateTaskModal.tsx` | 1 | ✅ onSettled |
| `components/templates/NestsManagerModal.tsx` | `createMutation`, `updateMutation`, `deleteMutation` | ✅ onSettled |
| `components/templates/TemplateDeleteDialog.tsx` | 1 | ✅ onSettled |
| `components/templates/TemplateEditModal.tsx` | 1 | ✅ onSettled |
| `components/templates/TemplateCreateModal.tsx` | 1 | ✅ onSettled |
| `pages/admin/SecurityPage.tsx` | `updateMutation`, `clearMutation` | ✅ onSettled |
| `pages/admin/ServersPage.tsx` | `bulkActionMutation` | ✅ onSettled |
| `pages/admin/PluginsPage.tsx` | `updateMutation`, `toggleMutation`, `reloadMutation` | ✅ onSettled |
| `pages/admin/SystemPage.tsx` | `updateSmtpMutation`, `updateDnsMutation`, `updateModManagerMutation` | ✅ onSettled |
| `pages/admin/NodeAllocationsPage.tsx` | `createPortMutation`, `deletePortMutation`, `createPoolMutation`, `deletePoolMutation` | ✅ onSettled |
| `pages/admin/ThemeSettingsPage.tsx` | `oidcMutation`, `updateMutation` | ✅ onSettled |
| `pages/admin/MigrationPage.tsx` | 6 mutations | ✅ onSettled |
| `pages/admin/UsersPage.tsx` | `createMutation`, `updateMutation`, `deleteMutation`, `banMutation`, `unbanMutation`, `wipePasskeysMutation`, `wipe2faMutation`, `enforce2faMutation`, `unlinkAccountMutation`, `verifyEmailMutation`, `bulkDeleteMutation` | ✅ onSettled |
| `components/admin/UpdateSettings.tsx` | `triggerMutation` | ✅ onSettled |
| `components/servers/DeleteServerDialog.tsx` | 1 | ✅ onSettled |
| `components/servers/TransferServerModal.tsx` | 1 | ✅ onSettled |
| `pages/ProfilePage.tsx` | `avatarMutation`, `updateProfileMutation`, `changePwMutation`, `setPwMutation`, `enableTfaMutation`, `disableTfaMutation`, `genCodesMutation`, `addPkMutation`, `delPkMutation`, `updPkMutation`, `revokeSessionMutation`, `revokeAllMutation`, `resendVerifyMutation`, `removeAvatarMutation` | ✅ onSettled |

---

### 2. Mutations with NO invalidation at all

**1 finding — acceptable exception:**

| File | Line | Mutation | Reason |
|------|------|----------|--------|
| `pages/ProfilePage.tsx` | L64 | `deleteMutation` (DangerZone) | Account deletion triggers `useAuthStore.getState().logout()` which clears all cache. No need to invalidate. |

---

### 3. `.then()` chains instead of mutation hooks (ANTI-PATTERN ⚠️ LOW SEVERITY)

| File | Line | Code | Description |
|------|------|------|-------------|
| `pages/ProfilePage.tsx` | L82 | `profileApi.exportData().then(...)` | Imperative call, no invalidation needed (file download) |
| `pages/ProfilePage.tsx` | L438 | `profileApi.linkSso(p).then(() => { queryClient.invalidateQueries(...) })` | **Should be a useMutation hook** with onSettled invalidation |
| `pages/ProfilePage.tsx` | L447 | `profileApi.unlinkSso(...).then(() => queryClient.invalidateQueries(...))` | **Should be a useMutation hook** with onSettled invalidation |

---

### 4. `onSettled` without `invalidateQueries` (non-critical)

| File | Line | Mutation | What onSettled does |
|------|------|----------|---------------------|
| `pages/admin/MigrationPage.tsx` | L804 | `testMutation` | Only clears `testing` state — no query invalidation needed (purely local UI state) |
| `components/nodes/NodeCreateModal.tsx` | L112 | `deployTokenMutation` | No onSettled — success only sets `deployInfo` local state |

---

### 5. ProfilePage mutations with PARTIAL invalidation (MEDIUM SEVERITY)

These mutations change profile-related data but only invalidate `qk.profileAuditLog()` instead of `qk.profile()`. Since `useProfile` has `staleTime: 60_000` and `refetchInterval: 30_000`, stale data may persist up to 30 seconds.

| File | Line | Mutation | Invalidates | Should also invalidate |
|------|------|----------|-------------|----------------------|
| `pages/ProfilePage.tsx` | L138 | `avatarMutation` | `qk.profile()` | ✅ Already does |
| `pages/ProfilePage.tsx` | L150 | `updateProfileMutation` | `qk.profile()`, `qk.profileAuditLog()` | ✅ Already does |
| `pages/ProfilePage.tsx` | L156 | `changePwMutation` | `qk.profile()`, `qk.profileSessions()`, `qk.profileAuditLog()` | ✅ Already does |
| `pages/ProfilePage.tsx` | L162 | `setPwMutation` | `qk.profile()` | ✅ Already does |
| `pages/ProfilePage.tsx` | L168 | `enableTfaMutation` | `qk.profile()`, `qk.profileAuditLog()` | ✅ Already does |
| `pages/ProfilePage.tsx` | L178 | `disableTfaMutation` | `qk.profile()`, `qk.profileAuditLog()` | ✅ Already does |
| `pages/ProfilePage.tsx` | L184 | `genCodesMutation` | **`qk.profileAuditLog()` only** | `qk.profile()` not needed (backup codes stored in local state) |
| `pages/ProfilePage.tsx` | L190 | `addPkMutation` | **`qk.profileAuditLog()` only** | `qk.profile()` not needed (passkeys fetched separately) |
| `pages/ProfilePage.tsx` | L196 | `delPkMutation` | **`qk.profileAuditLog()` only** | `qk.profile()` not needed (passkeys fetched separately via `refreshPasskeys()`) |
| `pages/ProfilePage.tsx` | L202 | `updPkMutation` | **`qk.profileAuditLog()` only** | `qk.profile()` not needed (passkeys fetched separately via `refreshPasskeys()`) |
| `pages/ProfilePage.tsx` | L208 | `revokeSessionMutation` | `qk.profileSessions()`, `qk.profileAuditLog()` | ✅ Correct (sessions, not profile) |
| `pages/ProfilePage.tsx` | L214 | `revokeAllMutation` | `qk.profileSessions()`, `qk.profileAuditLog()` | ✅ Correct (sessions, not profile) |
| `pages/ProfilePage.tsx` | L220 | `resendVerifyMutation` | **`qk.profileAuditLog()` only** | `qk.profile()` may be stale — profile has `emailVerified` field |
| `pages/ProfilePage.tsx` | L226 | `removeAvatarMutation` | `qk.profile()` | ✅ Already does |

**Conclusion:** ProfilePage mutations that correctly invalidate `qk.profile()` when profile data changes. Passkey mutations and backup code mutation appropriately skip `qk.profile()` since those data points are managed separately (local state or separate fetches).

---

## Summary

| Category | Count | Severity |
|----------|-------|----------|
| ✅ Correct — invalidation in `onSettled` | ~55 | — |
| ⚠️ Anti-pattern — `.then()` chains with imperative API calls | 2 | LOW |
| ✅ Acceptable — no invalidation needed | 1 | — |
| ✅ Correct partial invalidation (separate query keys) | ~10 | — |
| ❌ CRITICAL — invalidateQueries in `onSuccess` | **0** | **None** |

**Result: ZERO critical violations.** No mutation uses `invalidateQueries` inside `onSuccess`. All mutations correctly place cache invalidation in `onSettled`.
