# TanStack Query Audit — Missing Queries, Dead Code & Structural Issues

## Summary

The TanStack Query setup is **well-structured overall**. All `useQuery` calls have both `queryKey` and `queryFn`. The global `QueryClient` configuration is sensible. No circular dependencies exist. However, several structural issues were found.

---

## Issue 1: Raw `fetch` Calls in Page Event Handlers (Should Be Wrapped in useMutation/useQuery)

### 1A. `UsersPage.tsx` — Raw fetch in `handleEditUser` (lines 785–802)

**File:** `catalyst-frontend/src/pages/admin/UsersPage.tsx`
**Lines:** 785–802

```ts
const response = await fetch(`/api/roles/users/${nextId}/nodes`, {
  headers: { 'Content-Type': 'application/json' },
});
const data = await response.json();
// ... sets setSelectedNodeIds()
```

This is inside the `handleEditUser` callback — a data-fetching operation triggered by user action (opening the edit modal). It should either:
- Be wrapped in a `useQuery` hook called when the edit modal opens, **or**
- Be a `useMutation` that sets the result on success.

Currently, this bypasses the TanStack Query cache entirely, meaning:
- No loading state
- No automatic retry
- No deduplication of concurrent requests
- No caching for subsequent opens

**Recommended fix:** Create a `useUserNodeAssignments(userId)` hook (similar to `useRoleNodeAssignments(roleId)` already in `NodeAssignmentsSelector.tsx`) and call it when the edit modal opens.

### 1B. `RolesPage.tsx` — Raw fetch in `startEdit` (lines 719–731)

**File:** `catalyst-frontend/src/pages/admin/RolesPage.tsx`
**Lines:** 719–731

```ts
const response = await fetch(`/api/roles/${role.id}/nodes`, {
  headers: { 'Content-Type': 'application/json' },
});
const data = await response.json();
// ... sets setSelectedNodeIds()
```

Same pattern as above. This is an "on-edit-open" data fetch that should use a query hook.

**Recommended fix:** Same as 1A — use a query/mutation hook.

### 1C. `TemplateCreateModal.tsx` — Raw `fetch` for URL import (line 489)

**File:** `catalyst-frontend/src/components/templates/TemplateCreateModal.tsx`
**Line:** 489

```ts
const response = await fetch(url);
const content = await response.text();
const parsed = parseEggContent(content);
```

This is inside `handleImportUrl` — a user-triggered action. It should be a `useMutation`.

**Recommended fix:** Wrap in a `useMutation` with `mutationFn: () => fetchAndParseTemplate(url)`.

### 1D. Example Plugin — Raw `fetch` in `useEffect` (lines 12–14)

**File:** `catalyst-frontend/src/plugins/example-plugin/components.tsx`
**Lines:** 12–14

```ts
React.useEffect(() => {
  fetch('/api/plugins/example-plugin/stats')
    .then(res => res.json())
    .then(data => setStats(data.stats))
    .catch(err => console.error('Failed to fetch stats:', err));
}, []);
```

This is a data-fetching pattern (`useState` + `useEffect`) that should use `useQuery`. However, this is inside the plugin system (a separate runtime layer), so wrapping it in TanStack Query would require plugin-aware query hooks. This is a **lower-priority** concern since it's inside the plugin ecosystem.

---

## Issue 2: Dead `qk` Factory Method — `qk.session()` Defined But Never Used

**File:** `catalyst-frontend/src/lib/queryKeys.ts`
**Line:** 19

```ts
// ── Auth ──────────────────────────────────────────────────────────
session: () => ['session'] as const,
```

`qk.session()` is defined in the query keys factory but is **never referenced anywhere** in the codebase. There is no `useQuery` call using `qk.session()`, and no `invalidateQueries({ queryKey: qk.session() })` anywhere.

If the session query was intended to be used, there's no corresponding hook. If it was intended for `session.invalidateQueries()`, it's also unused since auth uses `useAuthStore` (zustand) directly.

**Recommended fix:** Either:
- **Remove** `qk.session()` from `queryKeys.ts` (cleanup), **or**
- **Create** a `useSession()` hook that wraps `authApi.me()` and uses `qk.session()`, then use it in places that currently call `authApi.me()` directly (e.g., `useAuthInit.ts`).

---

## Issue 3: Missing `qk` Factory Entries (Keys Used in Invalidation But Not Defined)

All `qk` method calls found in invalidation operations (`invalidateQueries`, `setQueriesData`, etc.) correspond to defined factory methods. **No missing entries found.**

Specifically verified:
- `qk.serverActivity()` — defined, used in `ServerActivityLogTab.tsx:33`
- `qk.databaseHosts()` — defined, used in `useSseAdminEvents.ts:291`
- `qk.migrationSteps()` — defined, used in `MigrationPage.tsx:761` and `useSseAdminEvents.ts:340`
- `qk.invitePreview()` — defined, used in `InvitesPage.tsx:25`
- `qk.session()` — defined, but never used (see Issue 2)

---

## Issue 4: `useQuery` Calls Missing `queryKey`

**None found.** Every `useQuery` call in the codebase has an explicit `queryKey` property.

---

## Issue 5: `useQuery` Calls Missing `queryFn`

**None found.** Every `useQuery` call in the codebase has an explicit `queryFn` property.

---

## Issue 6: Components Using `queryClient` Directly

The codebase correctly uses `queryClient.invalidateQueries()` in `onSettled`/`onSuccess` callbacks of mutations to cache invalidation — this is the **recommended TanStack Query pattern** (not a code smell).

However, there are two cases worth noting:

### 6A. `useProfileSync.ts` — Bypasses TanStack Query for polling

**File:** `catalyst-frontend/src/hooks/useProfileSync.ts`
**Lines:** 27–52

```ts
const unsubscribe = queryClient.getQueryCache().subscribe(...)
// + setInterval(pollProfile, SYNC_INTERVAL)
```

This hook exists because `invalidateQueries` only affects active observers, and the `['profile']` query only has an active observer on `/profile`. So this hook implements a custom polling mechanism as a workaround.

**Not a bug**, but it's a **structural concern**: the pattern creates a duplicate data-fetching path (SSE cache updates + direct polling) that could be consolidated. Consider adding a "keep-queries-alive" strategy or using `refetchInterval` on the profile query in the auth store init.

### 6B. `useServerStateUpdates.ts` — Uses `as any` casts on `queryClient`

**File:** `catalyst-frontend/src/hooks/useServerStateUpdates.ts`
**Lines:** 56–90

```ts
const q = queryClient as any;
q.setQueriesData(...)
q.invalidateQueries(...)
```

This is needed because `setQueriesData` requires a predicate function that TanStack Query's public API doesn't expose cleanly. The `as any` cast suppresses type errors but could be improved with a type-safe wrapper in `lib/queryUtils.ts`.

---

## Issue 7: Global QueryClient Configuration Assessment

**File:** `catalyst-frontend/src/lib/queryClient.ts`

```ts
staleTime: 30_000,       // 30 seconds — aggressive default
gcTime: 5 * 60 * 1000,   // 5 minutes — reasonable
retry: 2,                // Good default
refetchOnWindowFocus: false, // Good for real-time apps
mutations: { retry: 0 }  // Correct — mutations shouldn't retry silently
```

### Assessment:
| Setting | Value | Rating | Note |
|---------|-------|--------|------|
| `staleTime` | 30s | ⚠️ Low | Most individual hooks override this with 60s+. Could be bumped to 60s for consistency. |
| `gcTime` | 5 min | ✅ OK | Reasonable. Could bump to 10 min for better cache retention during page navigation. |
| `retry` | 2 | ✅ Good | Standard default for transient failures. |
| `refetchOnWindowFocus` | false | ✅ Good | Correct for SSE-driven real-time apps. |
| `mutation retry` | 0 | ✅ Good | Correct — mutations should not retry silently. |

### Mutation Cache Error Handler:
The global `MutationCache.onError` handler in `queryClient.ts:16-25` correctly reports errors via `reportSystemError`. This is a good pattern.

---

## Issue 8: Circular Dependencies in Query Layer

**None found.** The hooks directory has no circular imports.

Cross-file references:
- `useClusterMetrics.ts` → `import { useAdminNodes } from './useAdmin'` (forward reference, no cycle)
- `useAdmin.ts` → imports from `../services/api/admin` (no cycle)
- `useFileManager.ts` → `import { useQuery }` from TanStack (no cycle)

---

## Issue 9: Duplicate Query Patterns (Minor)

### 9A. `useAccessibleNodes()` hook exists but isn't used

**File:** `catalyst-frontend/src/hooks/useNodes.ts`
**Lines:** 14–27

```ts
export function useAccessibleNodes() {
  return useQuery({
    queryKey: qk.accessibleNodes(),
    queryFn: async () => {
      const response = await fetch('/api/nodes/accessible', { ... });
```

This hook is defined but only used internally by `CloneServerDialog.tsx` (which duplicates the fetch logic inline at line 41–51). The dialog uses its own inline `fetch` + `useQuery` instead of the existing `useAccessibleNodes()` hook.

**Recommended fix:** Replace the inline fetch in `CloneServerDialog.tsx:41-51` with `useAccessibleNodes()`.

### 9B. Raw `fetch` in `CloneServerDialog.tsx` for accessible nodes (lines 41–51)

**File:** `catalyst-frontend/src/components/servers/CloneServerDialog.tsx`
**Lines:** 41–51

```ts
const { data: accessibleNodesData } = useQuery({
  queryKey: qk.accessibleNodes(),
  queryFn: async () => {
    const res = await fetch('/api/nodes/accessible', { ... });
    // ...
  },
  enabled: open,
});
```

This duplicates the fetch logic already in `useAccessibleNodes()`.

**Recommended fix:** Use the existing `useAccessibleNodes()` hook.

---

## Complete Checklist

| # | Check | Result |
|---|-------|--------|
| 1 | API calls outside useQuery/useMutation | **4 found** (Issues 1A-1D) |
| 2 | Dead qk factory methods | **1 found** (Issue 2: `qk.session()`) |
| 3 | Missing qk factory entries | **None** (all used keys defined) |
| 4 | useQuery missing queryKey | **None** |
| 5 | useQuery missing queryFn | **None** |
| 6 | queryClient misuse | **2 noted** (6A, 6B) |
| 7 | QueryClient config | **Good** (minor staleTime/GC tuning) |
| 8 | Circular dependencies | **None** |
| 9 | Duplicate query patterns | **2 found** (Issues 9A-9B) |

---

## Prioritized Recommendations

1. **High priority:** Wrap raw `fetch` calls in 1A, 1B, 1C into `useMutation` hooks for proper error handling, loading states, and cache integration.
2. **Medium priority:** Remove or implement `qk.session()` (Issue 2).
3. **Medium priority:** Deduplicate `useAccessibleNodes` logic (Issues 9A-9B).
4. **Low priority:** Consider bumping global `staleTime` to 60s and `gcTime` to 10 min (Issue 7).
