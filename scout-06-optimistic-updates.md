# Optimistic Update Pattern Audit — Findings

## Executive Summary

**5 properly implemented optimistic updates** (with correct onMutate → onError → onSettled chain)
**8+ mutations missing optimistic updates** where they'd provide clear UX benefit
**1 structural issue** — cancel/update scope mismatch in NodeDeleteDialog

All mutations use `onSettled` → `invalidateQueries` pattern correctly — this part is consistent. The issues are about *what happens during the mutation* (optimism level), not about eventual consistency.

---

## Properly Implemented (✅ Correct)

### 1. `hooks/useApiKeys.ts` — `useDeleteApiKey` (lines 117–137)
```typescript
// Line 119-126
onMutate: async (id: string) => {
  await queryClient.cancelQueries({ queryKey: qk.apiKeys() });
  const previous = queryClient.getQueryData<ApiKey[]>(qk.apiKeys());
  queryClient.setQueryData<ApiKey[]>(qk.apiKeys(), (old) =>
    old ? old.filter((key) => key.id !== id) : old,
  );
  return { previous };
},
// Line 130-133
onError: (_error, _id, context) => {
  if (context?.previous) {
    queryClient.setQueryData(qk.apiKeys(), context.previous);
  }
},
// Line 135-137
onSettled: () => {
  queryClient.invalidateQueries({ queryKey: qk.apiKeys() });
},
```
**Verdict: ✅ Correct** — Cancels → snapshots → applies → returns context → rolls back on error → invalidates on settled.

### 2. `hooks/useAdmin.ts` — `useResolveSystemError` (lines 200–230)
```typescript
// Lines 202-218
onMutate: async (id: string) => {
  await queryClient.cancelQueries({ queryKey: qk.adminSystemErrors() });
  const previousData = queryClient.getQueriesData({ queryKey: qk.adminSystemErrors() });
  queryClient.setQueriesData({ queryKey: qk.adminSystemErrors() }, (prev: any) => {
    if (!prev || typeof prev !== 'object') return prev;
    if ('errors' in prev && Array.isArray(prev.errors)) {
      return { ...prev, errors: prev.errors.map((e: any) =>
        e.id === id ? { ...e, resolved: true } : e,
      )};
    }
    return prev;
  });
  return { previousData };
},
// Lines 222-227
onError: (_err, _id, context: any) => {
  if (context?.previousData) {
    for (const [queryKey, data] of context.previousData) {
      queryClient.setQueryData(queryKey, data);
    }
  }
},
// Lines 229-231
onSettled: () => {
  queryClient.invalidateQueries({ queryKey: qk.adminSystemErrors() });
},
```
**Verdict: ✅ Correct** — Uses `setQueriesData` for paginated list, properly rolls back all cached pages.

### 3. `components/servers/ServerControls.tsx` — start/stop/restart/kill (lines 50–115)
```typescript
// Lines 52-61 (start mutation, same pattern for stop/restart/kill)
onMutate: () => { return snapshotAndOptimistic(OPTIMISTIC_STATUS.start); },
onError: (_err, _vars, prev) => {
  if (prev) queryClient.setQueryData(qk.server(serverId), prev);
  optimisticInvalidate(queryClient, qk.servers());
  notifyError('Failed to start server');
},
onSettled: () => {
  optimisticInvalidate(queryClient, qk.server(serverId));
  optimisticInvalidate(queryClient, qk.servers());
},
```
`snapshotAndOptimistic` (lines 43-50) cancels `qk.server(serverId)` and `qk.servers()`, snapshots, then applies via `optimisticSet`.

**Verdict: ✅ Correct** — Cancels both specific and list queries, snapshots single server (not full list), returns for rollback, uses helper functions for multi-query updates.

### 4. `lib/queryUtils.ts` — `optimisticSet` helper (lines 50–58)
```typescript
export function optimisticSet<T>(
  queryClient: any,
  queryKeys: readonly unknown[],
  updater: (cached: T) => T,
) {
  queryClient.setQueriesData(
    { predicate: (q: any) => matchQueryKeys(q.queryKey, queryKeys) },
    updater,
  );
}
```
**Verdict: ✅ Correct** — Predicate-based update that handles `null` suffix normalization properly.

### 5. `lib/queryUtils.ts` — `optimisticInvalidate` helper (lines 61–67)
```typescript
export function optimisticInvalidate(queryClient: any, queryKeys: readonly unknown[]) {
  queryKeys.forEach((key) => {
    const effectiveKey = Array.isArray(key) && key[key.length - 1] === null ? key.slice(0, -1) : key;
    queryClient.invalidateQueries({ queryKey: effectiveKey });
  });
}
```
**Verdict: ✅ Correct** — Strips trailing `null` before invalidating, matching TanStack Query's behavior.

---

## Issues Found

### ISSUE 1: `components/nodes/NodeDeleteDialog.tsx` — Cancel/update scope mismatch

**File:** `components/nodes/NodeDeleteDialog.tsx`
**Lines:** 26–39

**Current code:**
```typescript
onMutate: async () => {
  await queryClient.cancelQueries({ queryKey: qk.nodes() });        // only cancels ['nodes', null]
  const prev = queryClient.getQueryData(qk.nodes());
  queryClient.setQueriesData(
    { predicate: (q: any) => Array.isArray(q.queryKey) && q.queryKey[0] === 'nodes' },  // updates ALL ['nodes', ...] queries
    (nodes: any[]) => Array.isArray(nodes) ? nodes.filter((n: any) => n.id !== nodeId) : nodes,
  );
  return { prev };
},
onError: (_err, _vars, ctx) => {
  if (ctx?.prev) queryClient.setQueryData(qk.nodes(), ctx.prev);  // only rolls back ['nodes', null]
  // BUG: ['nodes', nodeId] (qk.node(nodeId)) was also optimistically updated but NOT rolled back!
},
onSettled: () => {
  Promise.all([
    queryClient.invalidateQueries({ queryKey: qk.nodes() }),
    queryClient.invalidateQueries({ queryKey: qk.adminNodes() }),  // admin-nodes not optimistically updated, but invalidated — fine
  ]);
},
```

**Problem:** The optimistic update via `setQueriesData` with predicate `q.queryKey[0] === 'nodes'` updates ALL queries starting with `['nodes', ...]` — including `qk.node(nodeId)` (`['nodes', '<id>']`). But:
1. `cancelQueries` only targets `qk.nodes()` (`['nodes', null]`), not `qk.node(nodeId)`. If `qk.node(nodeId)` was in-flight, its response will overwrite the optimistic delete.
2. `onError` only rolls back `qk.nodes()`, not `qk.node(nodeId)` which was also optimistically modified.

**Recommended fix:**
```typescript
onMutate: async () => {
  // Cancel ALL queries that will be optimistically modified
  await queryClient.cancelQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === 'nodes' });
  const prev = queryClient.getQueriesData({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === 'nodes' });
  queryClient.setQueriesData(
    { predicate: (q: any) => Array.isArray(q.queryKey) && q.queryKey[0] === 'nodes' },
    (nodes: any[]) => Array.isArray(nodes) ? nodes.filter((n: any) => n.id !== nodeId) : nodes,
  );
  return { prev };
},
onError: (_err, _vars, ctx) => {
  if (ctx?.prev) {
    for (const [queryKey, data] of ctx.prev) {
      queryClient.setQueryData(queryKey, data);
    }
  }
},
```

---

### ISSUE 2: `components/servers/DeleteServerDialog.tsx` — Missing optimistic delete

**File:** `components/servers/DeleteServerDialog.tsx`
**Lines:** 29–43

**Current code:**
```typescript
const mutation = useMutation({
  mutationFn: () => serversApi.delete(serverId),
  onSuccess: () => { notifySuccess('Server deleted'); setOpen(false); onDeleted?.(); },
  onSettled: () => {
    queryClient.invalidateQueries({ queryKey: qk.servers() });
    queryClient.invalidateQueries({ queryKey: qk.adminServers() });
    queryClient.removeQueries({ queryKey: qk.server(serverId) });
  },
  onError: () => notifyError('Failed to delete server'),
});
```

**Problem:** The server card remains visible during the network request, causing a flicker when the mutation succeeds. Delete mutations are ideal candidates for optimistic removal.

**Recommended fix:**
```typescript
const mutation = useMutation({
  mutationFn: () => serversApi.delete(serverId),
  onMutate: async () => {
    await queryClient.cancelQueries({ queryKey: qk.servers() });
    const prev = queryClient.getQueryData(qk.servers());
    queryClient.setQueryData(qk.servers(), (servers: Server[]) =>
      servers?.filter((s) => s.id !== serverId) ?? [],
    );
    queryClient.removeQueries({ queryKey: qk.server(serverId) });
    return { prev };
  },
  onSuccess: () => { notifySuccess('Server deleted'); setOpen(false); onDeleted?.(); },
  onError: (_err, _vars, ctx) => {
    if (ctx?.prev) queryClient.setQueryData(qk.servers(), ctx.prev);
    notifyError('Failed to delete server');
  },
  onSettled: () => {
    queryClient.invalidateQueries({ queryKey: qk.servers() });
    queryClient.invalidateQueries({ queryKey: qk.adminServers() });
  },
});
```

---

### ISSUE 3: `pages/servers/ServerDetailsPage.tsx` — `deleteTaskMutation` missing optimistic delete

**File:** `pages/servers/ServerDetailsPage.tsx`
**Lines:** 392–407

**Current code:**
```typescript
const deleteTaskMutation = useMutation({
  mutationFn: (taskId: string) => tasksApi.remove(server.id, taskId),
  onSuccess: () => notifySuccess('Task deleted'),
  onSettled: () => {
    if (server?.id) queryClient.invalidateQueries({ queryKey: qk.tasks(server.id) });
  },
  onError: (error: any) => notifyError(error?.response?.data?.error || 'Failed to update task'),
});
```

**Recommended fix:** Add `onMutate` that removes the task from the tasks list optimistically.

---

### ISSUE 4: `pages/servers/ServerDetailsPage.tsx` — `deleteDatabaseMutation` missing optimistic delete

**File:** `pages/servers/ServerDetailsPage.tsx`
**Lines:** 459–474

**Current code:**
```typescript
const deleteDatabaseMutation = useMutation({
  mutationFn: (databaseId: string) => databasesApi.remove(server.id, databaseId),
  onSuccess: () => notifySuccess('Database deleted'),
  onSettled: () => {
    if (server?.id) queryClient.invalidateQueries({ queryKey: qk.serverDatabases(server.id) });
  },
  onError: (error: any) => notifyError(error?.response?.data?.error || 'Failed to delete database'),
});
```

**Recommended fix:** Add `onMutate` that removes the database from the databases list optimistically.

---

### ISSUE 5: `pages/servers/ServerDetailsPage.tsx` — `removeAllocationMutation` missing optimistic delete

**File:** `pages/servers/ServerDetailsPage.tsx`
**Lines:** 557–573

**Current code:**
```typescript
const removeAllocationMutation = useMutation({
  mutationFn: async (containerPort: number) => serversApi.removeAllocation(serverId, containerPort),
  onSuccess: () => notifySuccess('Allocation removed'),
  onSettled: () => {
    queryClient.invalidateQueries({ queryKey: qk.serverAllocations(serverId) });
    queryClient.invalidateQueries({ queryKey: qk.server(serverId) });
  },
  onError: (error: any) => notifyError(...),
});
```

**Recommended fix:** Add `onMutate` that removes the allocation from `qk.serverAllocations(serverId)` optimistically.

---

### ISSUE 6: `pages/admin/UsersPage.tsx` — `deleteMutation` missing optimistic delete

**File:** `pages/admin/UsersPage.tsx`
**Lines:** 548–562

**Current code:**
```typescript
const deleteMutation = useMutation({
  mutationFn: (userId: string) => adminApi.deleteUser(userId),
  onSuccess: () => notifySuccess('User deleted'),
  onSettled: () => {
    queryClient.invalidateQueries({ queryKey: qk.adminUsers() });
    queryClient.invalidateQueries({ queryKey: qk.adminRoles() });
  },
  onError: (error: any) => {
    const rawError = error?.response?.data?.error;
    // ...
  },
});
```

**Recommended fix:** Add `onMutate` that removes user from `qk.adminUsers()` list optimistically.

---

### ISSUE 7: `pages/admin/NodesPage.tsx` — Bulk `deleteMutation` missing optimistic updates

**File:** `pages/admin/NodesPage.tsx`
**Lines:** 449–467

**Current code:**
```typescript
const deleteMutation = useMutation({
  mutationFn: (nodeIds: string[]) => Promise.all(nodeIds.map((nodeId) => nodesApi.remove(nodeId))),
  onSuccess: (_data, nodeIds) => {
    notifySuccess(`${nodeIds.length} node${nodeIds.length === 1 ? '' : 's'} deleted`);
    setSelectedIds([]);
    setDeleteTargets(null);
  },
  onSettled: () => {
    queryClient.invalidateQueries({ queryKey: qk.adminNodes() });
  },
  onError: (error: any) => {
    const message = error?.response?.data?.error || 'Failed to delete node(s)';
    notifyError(message);
  },
});
```

**Recommended fix:** Add `onMutate` that removes deleted nodes from `qk.adminNodes()` list. Note: this is a bulk operation, so rollback should restore the full previous list since partial rollbacks are complex with bulk deletes.

---

### ISSUE 8: `pages/servers/ServerDetailsPage.tsx` — `renameServerMutation` missing optimistic update

**File:** `pages/servers/ServerDetailsPage.tsx`
**Lines:** 655–678

**Current code:**
```typescript
const renameServerMutation = useMutation({
  mutationFn: () => serversApi.update(serverId, { name: nextName }),
  onSuccess: () => notifySuccess('Server name updated'),
  onSettled: () => {
    queryClient.invalidateQueries({ queryKey: qk.server(serverId) });
    queryClient.invalidateQueries({ queryKey: qk.servers() });
  },
  onError: (error: any) => notifyError(...),
});
```

**Recommended fix:** Add `onMutate` that sets the new name in both `qk.server(serverId)` and `qk.servers()` optimistically. Snapshot the old name for rollback.

---

### ISSUE 9: `pages/servers/ServerDetailsPage.tsx` — `suspendMutation`/`unsuspendMutation` missing optimistic updates

**File:** `pages/servers/ServerDetailsPage.tsx`
**Lines:** 478–520

**Current code:**
```typescript
const suspendMutation = useMutation({
  mutationFn: (reason?: string) => serversApi.suspend(server.id, reason),
  onSuccess: () => { notifySuccess('Server suspended'); setSuspendReason(''); },
  onSettled: () => {
    queryClient.invalidateQueries({ queryKey: qk.server(server?.id) });
    queryClient.invalidateQueries({ queryKey: qk.servers() });
  },
  onError: (error: any) => notifyError(...),
});
```

**Recommended fix:** Add `onMutate` that sets status to `suspended` optimistically. Same for `unsuspendMutation` → sets status back to `active`/previous status.

---

### ISSUE 10: `pages/servers/ServerDetailsPage.tsx` — `addAllocationMutation` could be optimistic

**File:** `pages/servers/ServerDetailsPage.tsx`
**Lines:** 519–555

**Current code:**
```typescript
const addAllocationMutation = useMutation({
  mutationFn: async () => serversApi.addAllocation(serverId, { containerPort, hostPort }),
  onSuccess: () => { setNewContainerPort(''); setNewHostPort(''); notifySuccess('Allocation added'); },
  onSettled: () => {
    queryClient.invalidateQueries({ queryKey: qk.serverAllocations(serverId) });
    queryClient.invalidateQueries({ queryKey: qk.server(serverId) });
  },
  onError: (error: any) => notifyError(...),
});
```

**Recommended fix:** Add `onMutate` that adds a temporary allocation entry to `qk.serverAllocations(serverId)` optimistically. This gives instant feedback.

---

## NOT Issues (Intentionally Non-Optimistic)

These do NOT need optimistic updates and are correctly implemented:

- **`pages/admin/PluginsPage.tsx`** — `toggleMutation`/`reloadMutation` use `onMutate` only for UI state (`setProcessingPlugin`), not cache manipulation. This is correct because the plugin list uses SSE via `reloadPlugins()` for real-time updates, and the UI spinner state is local React state.

- **`pages/admin/MigrationPage.tsx`** — `testMutation` uses `onMutate` only for UI state (`setTesting(true)`). Migration steps use SSE invalidation. No cache manipulation is needed.

- **All config/save mutations** (SystemPage, SecurityPage, ThemeSettingsPage, DatabasePage, etc.) — These mutate singular settings objects where the full object is refetched after. Optimistic partial updates would be error-prone since the server response typically returns the full updated settings object, not just the changed field.

- **ProfilePage mutations** — All use `onSuccess` → local state update + `onSettled` → invalidate. These are correct because:
  - Account deletion triggers logout (cache is cleared anyway)
  - Password changes don't need optimistic updates (no list view affected)
  - 2FA/passkey changes use `refreshPasskeys()` which does a direct API fetch, not cache manipulation
  - Session revocations don't need optimism (list is typically small and doesn't flicker noticeably)

- **NodeDetailsPage `deployMutation`/`apiKeyMutation`** — These are "generate credential" operations that return new data. No cache manipulation needed; the `onSuccess` captures the response and stores it in local state, then invalidates the query for the next fetch.

---

### Dead Code: `optimisticMutation` helper

`lib/queryUtils.ts` line 32 defines `optimisticMutation<TData, TError, TVariables, TContext>()` but it is **never imported or used** anywhere in the codebase. It is an unfinished utility that merely passes through options. Only `optimisticSet` and `optimisticInvalidate` are imported (by `ServerControls.tsx` line 6).

**Recommendation:** Either remove `optimisticMutation` or implement it as a proper wrapper. Currently callers use the pattern manually (`ServerControls.tsx`, `useApiKeys.ts`, `useAdmin.ts`).


## `optimisticSet` / `optimisticInvalidate` Usage Audit

All usages are in `components/servers/ServerControls.tsx` (lines 43-115):

| Line | Call | Purpose | Correct? |
|------|------|---------|----------|
| 43 | `optimisticSet(queryClient, qk.server(serverId), ...)` | Update single server status | ✅ |
| 46 | `optimisticSet(queryClient, qk.servers(), ...)` | Update list view | ✅ |
| 61 | `optimisticInvalidate(queryClient, qk.servers())` | Refetch list after settle | ✅ |
| 65-66 | `optimisticInvalidate(queryClient, qk.server(serverId)); optimisticInvalidate(queryClient, qk.servers())` | Refetch both after settle | ✅ |
| 77 | `optimisticInvalidate(queryClient, qk.servers())` | After stop | ✅ |
| 81-82 | Same pattern for restart | ✅ |
| 93, 97-98 | Same pattern for kill | ✅ |
| 109, 114-115 | Same pattern for kill | ✅ |

No direct `queryClient.setQueryData` calls found outside of `onMutate`, `onError`, or the helper functions — **no bypass of the optimistic pattern**.

---

## `onSuccess` with `setQueryData` Audit

Checked ALL `onSuccess` handlers across the entire codebase. **Zero instances** of `onSuccess` calling `queryClient.setQueryData()` or `queryClient.setQueriesData()`. All cache updates via `setQueryData` correctly happen in `onMutate`. ✅

---

## Summary Table

| # | File:Line | Issue | Severity | Action |
|---|-----------|-------|----------|--------|
| 1 | `NodeDeleteDialog.tsx:26-39` | Cancel/update scope mismatch | 🔴 Medium | Fix cancel predicate + rollback |
| 2 | `DeleteServerDialog.tsx:29-43` | No optimistic delete | 🟡 Low | Add onMutate for list removal |
| 3 | `ServerDetailsPage.tsx:392-407` | deleteTaskMutation no optimistic delete | 🟡 Low | Add onMutate |
| 4 | `ServerDetailsPage.tsx:459-474` | deleteDatabaseMutation no optimistic delete | 🟡 Low | Add onMutate |
| 5 | `ServerDetailsPage.tsx:557-573` | removeAllocationMutation no optimistic delete | 🟡 Low | Add onMutate |
| 6 | `UsersPage.tsx:548-562` | deleteMutation no optimistic delete | 🟡 Low | Add onMutate |
| 7 | `NodesPage.tsx:449-467` | Bulk delete no optimistic update | 🟡 Low | Add onMutate |
| 8 | `ServerDetailsPage.tsx:655-678` | renameServerMutation no optimistic update | 🟡 Low | Add onMutate |
| 9 | `ServerDetailsPage.tsx:478-520` | suspend/unsuspend no optimistic update | 🟡 Low | Add onMutate |
| 10 | `ServerDetailsPage.tsx:519-555` | addAllocationMutation could be optimistic | 🟢 Info | Consider onMutate |

**Priority: Fix Issue 1 first** (structural bug), then tackle Issues 2-9 for UX polish. Issue 10 is optional.
