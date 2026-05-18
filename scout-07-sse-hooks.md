# SSE Hooks Audit — TanStack Query Invalidation Patterns

## Executive Summary

Found **13 issues** across 4 SSE hooks:
- **6 bugs** (dead invalidation, missing invalidation, stale cache reads)
- **5 race conditions** (optimistic `setQueriesData` vs mutation refetch ordering)
- **2 architectural concerns** (missing event handlers, empty-string invalidation)

All 4 hooks use `qk` factory calls — no hardcoded arrays found in any invalidation. ✓

---

## 1. useSseAdminEvents.ts — 9 Issues Found

### BUG-01: Dead invalidation — `qk.serverPermissions('')` on role_updated

**File:** `hooks/useSseAdminEvents.ts`, line 237
**Event type:** `role_updated`

```ts
// Line 237
q.invalidateQueries({ queryKey: qk.serverPermissions('') }),
```

`qk.serverPermissions('')` produces `['servers', '', 'permissions']`. All actual server permissions queries use real IDs: `['servers', serverId, 'permissions']`. Since TanStack Query invalidation uses prefix matching, `['servers', '', 'permissions']` does NOT match `['servers', '123', 'permissions']`. This invalidation never fires on any real query.

**Impact:** When a role is updated, the ServerAdminTab and ServerDetailsPage will show stale permissions until the user navigates away and back.

**Fix:** Iterate over all known server IDs or invalidate a broader key like `qk.servers()` (expensive). A better approach: use a predicate:
```ts
queryClient.invalidateQueries({
  predicate: (query) =>
    Array.isArray(query.queryKey) &&
    query.queryKey[0] === 'servers' &&
    query.queryKey[2] === 'permissions',
});
```

---

### BUG-02: Dead invalidation — `qk.nodeApiKey('')` on api_key events

**File:** `hooks/useSseAdminEvents.ts`, line 267
**Event types:** `api_key_created`, `api_key_updated`, `api_key_deleted`

```ts
q.invalidateQueries({ queryKey: qk.nodeApiKey('') }),
```

Same problem as BUG-01. `qk.nodeApiKey('')` produces `['nodes', '', 'api-key']`, which never matches actual queries like `['nodes', 'abc', 'api-key']`.

**Impact:** Node API key changes are never reflected in the UI without a full page reload.

**Fix:** Same predicate-based approach:
```ts
queryClient.invalidateQueries({
  predicate: (query) =>
    Array.isArray(query.queryKey) &&
    query.queryKey[0] === 'nodes' &&
    query.queryKey[2] === 'api-key',
});
```

---

### BUG-03: Missing invalidation — `server_updated` in useServerStateUpdates only invalidates the list

**File:** `hooks/useServerStateUpdates.ts`, lines 100–104
**Event types:** `server_created`, `server_updated`, `server_suspended`, `server_unsuspended`

```ts
if (type === 'server_created' || type === 'server_updated' || type === 'server_suspended' || type === 'server_unsuspended') {
  const q = queryClient as any;
  Promise.all([
    q.invalidateQueries({ queryKey: qk.servers() }),
  ]);
  return;
}
```

Compared to `useSseAdminEvents.ts` which (correctly) invalidates server detail, permissions, invites, and allocations, this hook only invalidates the servers list. The server detail page, allocation page, and other detail pages will show stale data.

**Impact:** After a server is updated/suspended/unsuspended via the all-servers stream, the server detail page and all child detail queries remain stale.

**Fix:**
```ts
if (type === 'server_created' || type === 'server_updated' || type === 'server_suspended' || type === 'server_unsuspended') {
  const serverId = String(data.serverId ?? '');
  const q = queryClient as any;
  if (serverId) {
    Promise.all([
      q.invalidateQueries({ queryKey: qk.servers() }),
      q.invalidateQueries({ queryKey: qk.server(serverId) }),
      q.invalidateQueries({ queryKey: qk.serverAllocations(serverId) }),
      q.invalidateQueries({ queryKey: qk.serverPermissions(serverId) }),
    ]);
  }
  return;
}
```

---

### BUG-04: Missing invalidation — `server_deleted` in useServerStateUpdates doesn't remove detail query

**File:** `hooks/useServerStateUpdates.ts`, lines 84–95
**Event type:** `server_deleted`

```ts
q.setQueriesData(
  { predicate: (query: Query) =>
    Array.isArray(query.queryKey) && query.queryKey[0] === 'servers' },
  (prev: any) => {
    if (!Array.isArray(prev)) return prev;
    return prev.filter((srv: any) => srv?.id !== serverId && srv?.uuid !== serverId);
  },
);
q.removeQueries({ queryKey: qk.server(serverId) });
q.invalidateQueries({ queryKey: qk.servers() });
```

Actually this one DOES call `q.removeQueries({ queryKey: qk.server(serverId) })` — that's correct. However, it doesn't remove related detail queries: `serverAllocations`, `serverPermissions`, `serverInvites`, `serverActivity`, `backups`, `tasks`, `files`. These would linger in the cache until they time out.

**Fix:** Add related query removals:
```ts
q.removeQueries({ queryKey: qk.server(serverId) });
q.removeQueries({ queryKey: qk.serverPermissions(serverId) });
q.removeQueries({ queryKey: qk.serverInvites(serverId) });
q.removeQueries({ queryKey: qk.serverAllocations(serverId) });
q.removeQueries({ queryKey: qk.backups(serverId) });
q.removeQueries({ queryKey: qk.tasks(serverId) });
q.removeQueries({ queryKey: qk.files(serverId, '') });
```

---

### BUG-05: Missing SSE event handler — `alert` event type not handled

**File:** `hooks/useServerStateUpdates.ts`
**Event type:** `alert` (exists in `ServerEventType`, lines 28)

The `alert` event is registered in the server-events.ts EVENT_TYPES list but is never handled in `useServerStateUpdates.ts`. This means alert events sent via the server-scoped SSE stream are silently ignored.

**Impact:** Alerts triggered on a specific server don't update the alerts list in real-time (unless the admin SSE also broadcasts them).

**Fix:** Add handler:
```ts
if (type === 'alert') {
  (queryClient as any).invalidateQueries({ queryKey: qk.alerts() });
}
```

---

### BUG-06: Missing SSE event handler — `resource_stats` not handled

**File:** `hooks/useServerStateUpdates.ts`
**Event type:** `resource_stats` (exists in `ServerEventType`, line 32)

The `resource_stats` event is registered but never handled. Server metrics pages that depend on `qk.serverMetrics(serverId)` would not be updated in real-time.

**Impact:** Server metrics pages in the admin UI or server detail would show stale metrics.

**Fix:** Add handler:
```ts
if (type === 'resource_stats') {
  const serverId = String(data.serverId ?? '');
  if (serverId) {
    (queryClient as any).invalidateQueries({ queryKey: qk.serverMetrics(serverId) });
  }
}
```

---

### RACE-01: `template_created`/`template_deleted` use `setQueriesData` (optimistic) without refetch

**File:** `hooks/useSseAdminEvents.ts`, lines 99–118 and 140–150

`template_created` uses `setQueriesData` to insert into the templates list. `template_deleted` uses `setQueriesData` to remove from the list. The create event has duplicate-checking (good), but both operations are purely optimistic and never trigger a refetch.

**Risk:** If the backend state differs from the SSE event (e.g., SSE fires but mutation failed server-side, creating a race), the cache would be in an inconsistent state. For `template_deleted`, if the SSE delete event fires before the backend processes the delete, subsequent refetches could restore the deleted template.

**Recommendation:** After `setQueriesData` for create/delete, also call `invalidateQueries` to trigger a refetch and reconcile with the server:
```ts
// After setQueriesData:
q.invalidateQueries({ queryKey: qk.templates() });
```

For template updates, the code already uses `invalidateQueries` (line 108-112), which is the correct approach.

---

### RACE-02: `system_error` uses `setQueriesData` for optimistic prepend

**File:** `hooks/useSseAdminEvents.ts`, lines 362–375

Same pattern as template_created — uses `setQueriesData` to prepend a system error without triggering a refetch. Race with mutation error suppression or other SSE events could cause issues.

**Fix:** Add `invalidateQueries({ queryKey: qk.adminSystemErrors() })` after the `setQueriesData`.

---

## 2. useServerStateUpdates.ts — 2 Issues Found

### RACE-03: Batched `setQueriesData` can overwrite mutation-driven refetches

**File:** `hooks/useServerStateUpdates.ts`, `processUpdates()` function (lines 27–68)

The debounce-batched `processUpdates()` function:
1. Calls `setQueriesData` on single-server queries (optimistic state update)
2. Calls `setQueriesData` on the servers list
3. Calls `invalidateQueries({ queryKey: qk.servers() })` to trigger refetch

Step 3 triggers a refetch. If the refetch is in flight when steps 1-2 complete, the refetched data would overwrite the optimistic `setQueriesData` — which is correct.

However, if another mutation invalidates `qk.servers()` between step 3 and the refetch completing, a second refetch could fire. The final state would be from the refetch, but the visual experience would be: stale → optimistic → refetch → refetch.

**Impact:** Low severity — data integrity is preserved, but there could be visual flickering.

**Recommendation:** This is an inherent limitation of the SSE + mutation pattern. To fully prevent it, you'd need to suspend the refetch while the batch is processing, which is complex. The current approach is acceptable but document the trade-off.

---

### BUG-07: `server_state_update` only does `setQueriesData` — no detail invalidation

**File:** `hooks/useServerStateUpdates.ts`, lines 59–72

When a server state changes (running/stopped/offline), the hook updates single-server queries via `setQueriesData` and the list via `setQueriesData`, then invalidates `qk.servers()`. It does NOT invalidate `qk.server(serverId)` detail.

**Impact:** Server detail pages that fetch data from the detail query (not just the list) won't pick up the status change without a manual refetch or navigation away-and-back.

**Fix:** Add `q.invalidateQueries({ queryKey: qk.server(serverId) })` inside the batched update:
```ts
q.invalidateQueries({ queryKey: qk.server(serverId) });
```

---

## 3. useSseResizeComplete.ts — 1 Issue Found

### CONCERN-01: No SSE reconnection awareness

**File:** `hooks/useSseResizeComplete.ts`, entire file

The SSE connection for resize-complete events uses `createServerEventsStream` which has native EventSource reconnection. But the hook passes `() => {}` as the status handler, completely ignoring reconnection events. If the connection drops during a resize operation:
1. SSE events won't be received during the disconnect
2. When it reconnects, a stale `storage_resize_complete` event might fire with old data
3. There's no timestamp/sequence check to ignore stale events

**Impact:** If the network drops during a resize, the user might see a stale success/failure toast.

**Fix:** Add a timestamp check in the event handler:
```ts
if (type !== 'storage_resize_complete') return;
const eventTimestamp = data.timestamp;
if (eventTimestamp && eventTimestamp < lastResizeTimestamp) return; // stale
```

---

## 4. useSseConsole.ts — 1 Issue Found

### CONCERN-02: Module-level `lastConnectedServerId` state leak

**File:** `hooks/useSseConsole.ts`, line 40

```ts
let lastConnectedServerId: string | undefined = undefined;
```

This module-level variable survives component unmounts and only resets when the actual `serverId` prop changes. While the code comment explains this is intentional (survives remounts), it means:
1. If the same server is unmounted and remounted in a different tab/route context, the old log entries persist
2. If the server ID is garbage-collected from the module scope (unlikely but possible in HMR), the variable retains stale references

**Impact:** Very low — this is the intended behavior for console log persistence. But it's worth documenting as a deliberate trade-off.

---

## Summary Table

| # | Severity | File | Line(s) | Issue |
|---|----------|------|---------|-------|
| BUG-01 | High | useSseAdminEvents.ts | 237 | Dead invalidation: `qk.serverPermissions('')` never matches real queries |
| BUG-02 | High | useSseAdminEvents.ts | 267 | Dead invalidation: `qk.nodeApiKey('')` never matches real queries |
| BUG-03 | Medium | useServerStateUpdates.ts | 100-104 | `server_updated` only invalidates list, not detail |
| BUG-04 | Medium | useServerStateUpdates.ts | 84-95 | `server_deleted` doesn't remove related detail queries |
| BUG-05 | Low | useServerStateUpdates.ts | — | `alert` SSE event type has no handler |
| BUG-06 | Low | useServerStateUpdates.ts | — | `resource_stats` SSE event type has no handler |
| RACE-01 | Medium | useSseAdminEvents.ts | 99-118, 140-150 | `template_created/deleted` use setQueriesData without refetch |
| RACE-02 | Medium | useSseAdminEvents.ts | 362-375 | `system_error` uses setQueriesData without refetch |
| RACE-03 | Low | useServerStateUpdates.ts | 27-68 | Batched setQueriesData can flicker against mutation refetches |
| BUG-07 | Medium | useServerStateUpdates.ts | 59-72 | `server_state_update` doesn't invalidate detail query |
| CONCERN-01 | Low | useSseResizeComplete.ts | — | No stale event filtering on SSE reconnection |
| CONCERN-02 | Info | useSseConsole.ts | 40 | Module-level `lastConnectedServerId` persists across unmounts |

---

## Start Here

1. **`hooks/useSseAdminEvents.ts`** — Start at line 237 (BUG-01) and line 267 (BUG-02). These are the highest-severity issues — dead code that silently fails to invalidate. Fix both by replacing empty-string invalidations with predicate-based invalidation.

2. **`hooks/useServerStateUpdates.ts`** — Start at line 100 (BUG-03) where `server_updated` only invalidates the list. Add server detail invalidation to match what `useSseAdminEvents.ts` does.

3. **`hooks/useSseAdminEvents.ts`** — After fixing the dead invalidations, add `invalidateQueries` calls after `setQueriesData` for template_created/deleted (RACE-01) and system_error (RACE-02) to trigger reconciliation refetches.
