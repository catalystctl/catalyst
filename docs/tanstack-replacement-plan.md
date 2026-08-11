> **Status (v1.18.1):** Implemented. Frontend uses **Catalyst Sync (`csync`)**; `@tanstack/*` is **not** a runtime dependency. Keep this file as historical design notes; do not treat inventory counts below as current.

# Eliminate TanStack entirely — Catalyst Sync (csync)

**Status:** Implemented in frontend (csync drop-in + virtualizer + SSE patch-first for server_state). Full domain tag redesign can continue iteratively.
**Scope:** `catalyst-frontend` only — no TanStack in plugins/packages today  
**Goal:** Zero `@tanstack/*` deps, and a server-state layer that is *materially better* for a realtime control panel — not a lateral SWR swap.

---

## 1. Inventory (verified)

| Package | Version | Role |
|---|---|---|
| `@tanstack/react-query` | ~5.100.7 | Server state, cache, mutations |
| `@tanstack/react-query-devtools` | ~5.100.7 | Devtools in `main.tsx` |
| `@tanstack/react-virtual` | ~3.13.24 | Console (dynamic height) + file list (44px) |

**Not used:** TanStack Router / Table / Form / infinite queries / suspense queries.

| Metric | Count |
|---|---|
| Files importing `@tanstack/react-query` | **79** |
| `invalidateQueries` call sites | **~343** |
| `setQueryData` / `setQueriesData` | **~21** |
| Files importing singleton `queryClient` | **~35** |
| Virtualizer call sites | **3** (`useConsoleVirtualizer`, `useFileListVirtualizer`, `CustomConsole`) |
| Plugin / package TanStack usage | **0** |
| RQ test mocks | **0** |

### Core infra
- `src/lib/queryClient.ts` — defaults (`staleTime 60s`, `gcTime 10m`, `retry 2`, no focus refetch) + `MutationCache.onError` → `reportSystemError`
- `src/lib/queryKeys.ts` — ~202-line hierarchical `qk.*` factory (prefix invalidation contract)
- `src/lib/queryUtils.ts` — `optimisticSet` / `optimisticInvalidate` + prefix matcher
- `src/main.tsx` — `QueryClientProvider` + `ReactQueryDevtools`
- `vite.config.ts` — `manualChunks['vendor-query'] = ['@tanstack/react-query']`

### Pain that makes RQ the wrong abstraction here
1. **SSE → invalidate storms.** `useSseAdminEvents` alone has ~100 RQ touchpoints; even `useServerStateUpdates` *patches then still invalidates* lists/details → refetch thrash.
2. **`as any` + predicate spaghetti** for list-vs-detail key shapes.
3. **343 invalidations** instead of “event applied to entity, views recompute.”
4. **Polling as primary truth** for transitional statuses (2s/10s) because cache updates aren’t trusted end-to-end.
5. **Zustand already owns client state** — RQ is a second global brain fighting SSE.

---

## 2. Decision: build **Catalyst Sync (`csync`)**, drop TanStack

### Ranked alternatives (subagent consensus)

| Rank | Option | Verdict for Catalyst |
|---|---|---|
| **1** | **Custom csync** (normalized entity + view + tag cache, patch-first SSE) | **Winner.** Fits realtime ops UI; deletes invalidation culture; full control; smaller long-term surface. |
| 2 | SWR | Lateral move. Keys still stringly; weak multi-view entity patch; still “revalidate” mindset. |
| 3 | RTK Query | Redux tax; heavy; wrong stack (we use Zustand for client). |
| 4 | Legend-State / Jotai atom families | Powerful, but steeper team skill + less “resource/tag” vocabulary for REST+SSE. |
| 5 | tRPC | Requires BE rewrite; out of scope for “kill TanStack.” |
| 6 | Bare React 19 `use()` + fetch cache | No mutation/SSE story at this scale. |

**Virtualization winner:** **[virtua](https://github.com/inokawa/virtua)**  
- Tiny, React 19–friendly, excellent dynamic sizing (console) + fixed rows (files).  
- Drop-in enough for our two wrappers; no need for react-virtuoso weight or home-grown math.

**Zustand policy (locked):**  
- **Client-only** — auth, theme, plugins, ephemeral UI.  
- **Never** put server entities in Zustand slices. csync is the server-state runtime.

---

## 3. Target architecture — Catalyst Sync

```
┌─────────────────────────────────────────────────────────────┐
│  React components / domain hooks                            │
│    useQuery(view, params)  useEntity(resource, id)          │
│    useMutation(def)        useSyncStatus()                  │
└────────────────────────────┬────────────────────────────────┘
                             │ useSyncExternalStore
┌────────────────────────────▼────────────────────────────────┐
│  SyncClient (singleton, usable outside React)               │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────────┐  │
│  │ Entity   │ │ View     │ │ Tag      │ │ Scheduler      │  │
│  │ Store    │ │ Store    │ │ Index    │ │ (coalesce 1    │  │
│  │ id→data  │ │ key→data │ │ tag→keys │ │  frame / 50ms) │  │
│  └────▲─────┘ └────▲─────┘ └────▲─────┘ └───────▲────────┘  │
│       │ patch      │ revalidate │               │ notify    │
│  ┌────┴────────────┴────────────┴───────────────┴────────┐  │
│  │ SSE Bridge  (server-events, admin-events, …)          │  │
│  │  patchEntity → fan-out views; revalidateTags only if  │  │
│  │  payload insufficient                                 │  │
│  └───────────────────────────────────────────────────────┘  │
│  Mutations: onMutate patch → settle → tag affects           │
│  Transitions: installing|starting|… → safety poll fallback  │
│  Global: onMutationError → reportSystemError; clear() auth  │
└─────────────────────────────────────────────────────────────┘
         services/api/* (unchanged REST clients)
```

### Modules (`catalyst-frontend/src/csync/`)

| Path | Responsibility |
|---|---|
| `core/createSync.ts` | Factory: stores + scheduler + public client API |
| `core/entityStore.ts` | `resource/id → entity`, version/updatedAt |
| `core/viewStore.ts` | Cached view results (list/detail projections) |
| `core/tagIndex.ts` | tag → set of view keys / entities |
| `core/scheduler.ts` | Batch notifications; coalesce revalidates |
| `react/SyncProvider.tsx` | Context + optional dev overlay |
| `react/useQuery.ts` | Subscribe to view; fetch if missing/stale |
| `react/useEntity.ts` | Subscribe to single normalized entity |
| `react/useMutation.ts` | mutate + lifecycle + `isPending` |
| `react/useClient.ts` | Imperative client (SSE, dialogs, auth) |
| `resources/*.ts` | `defineResource` / `defineView` per domain |
| `sse/bridge.ts` | Map wire events → `patch` / `remove` / `revalidateTags` |
| `virtual/useVirtList.ts` | Thin virtua wrappers (console + files) |
| `devtools.ts` | `window.__CSYNC__.dump()` |

### Public API sketch

```ts
// resources/server.ts
export const serverResource = defineResource<Server>({
  name: 'server',
  getId: (s) => s.id,
  tags: (s) => ['servers', `server:${s.id}`, `node:${s.nodeId}`],
  transitions: {
    when: (s) => ['installing','starting','stopping','transferring','cloning'].includes(s.status),
    pollMs: 2000,          // safety only
    idlePollMs: false,     // prefer SSE; optional slow poll if desired
  },
});

export const serverList = defineView({
  name: 'serverList',
  resource: serverResource,
  key: (params?: ServerListParams) => ['serverList', params ?? null],
  tags: ['servers'],
  queryFn: (params) => serversApi.list(params),
  // Project entities into this view when patches arrive
  project: (entities, params) => filterSort(entities, params),
});

export const serverDetail = defineView({
  name: 'serverDetail',
  resource: serverResource,
  key: (id: string) => ['serverDetail', id],
  tags: (id) => ['servers', `server:${id}`],
  queryFn: (id) => serversApi.get(id),
  entityId: (id) => id,
});

// hooks/useServers.ts — after migration
export function useServers(params?: ServerListParams) {
  return useQuery(serverList, params);
}

// SSE — patch is source of truth
client.patchEntity(serverResource, serverId, {
  status: nextState,
  portBindings: data.portBindings,
});
// NO automatic invalidateQueries(['servers'])

// Mutation
const power = useMutation({
  mutationFn: ({ id, action }) => serversApi.power(id, action),
  onMutate: ({ id, action }) => {
    const status = action === 'start' ? 'starting' : action === 'stop' ? 'stopping' : undefined;
    if (status) client.patchEntity(serverResource, id, { status });
  },
  affects: () => [], // SSE finalizes; no refetch spaghetti
});

// Auth / 401
client.clear(); // wipes entities + views (security)
```

### Tags vs hierarchical `qk` keys

| Old (RQ) | New (csync) |
|---|---|
| `qk.servers()` → `['servers']` prefix match | tag `servers` on resource + views |
| `qk.server(id)` | entity id + tag `server:${id}` + view `serverDetail` |
| `predicate` list-vs-detail hacks | entity store is canonical; views are projections |
| `invalidateQueries({ queryKey })` | `revalidateTags(['servers'])` **only when needed** |
| `setQueriesData(predicate, …)` | `patchEntity` → fan-out to subscribed views |

Keep a temporary `qk` → tags map during dual-run so SSE bridges can cut over gradually.

### What “1000% better” means (success metrics)

| Metric | Today (RQ) | Target (csync) |
|---|---|---|
| SSE `server_state` list behavior | patch **+** invalidate → refetch | **patch only**; 0 forced list refetches |
| Admin bulk event | many parallel invalidates | ≤1 coalesced revalidate / tag / 50ms |
| Bundle | RQ + devtools + virtual | csync + virtua (drop ~30–50KB gz class + complexity) |
| `as any` on cache | common in SSE | **zero** |
| Transitional UX | 2s poll primary | SSE patch &lt;100ms; poll is safety net |
| Invalidation declarations | scattered 343 call sites | on resource / mutation `affects` |
| Devtools | RQ panel | `__CSYNC__.dump` + optional light overlay |

---

## 4. Replacement must-support matrix (migration safety)

Any facade / csync v1 must cover what scout found in the wild:

**Hooks:** `useQuery`, `useMutation`, imperative client (ex-`useQueryClient`)  
**Client:** `invalidate`/`revalidateTags`, `set`/`patch`, `get`, multi-match update, `cancel`, `remove`, `clear`, cache subscribe (for `useProfileSync`)  
**Query opts:** `enabled`, `staleTime`, `gcTime`, `retry`, `refetchInterval: number | false | fn`, `refetchIntervalInBackground`, keep-previous (`placeholderData`)  
**Mutation opts:** `onMutate` + context rollback, `onError`/`onSuccess`/`onSettled`, `mutationKey`, `isPending`  
**Globals:** mutation error → `reportSystemError`; singleton outside React (API 401, authStore logout, dialogs)  
**Not required today:** infinite query, suspense query, hydration, `select`, `useQueries`

---

## 5. Phased migration

### Phase 0 — Foundations (2–3 eng-days)
1. Add `src/csync/` skeleton: EntityStore, ViewStore, TagIndex, Scheduler, `createSync()`.
2. React: `SyncProvider`, `useQuery`, `useEntity`, `useMutation`, `useClient`.
3. `window.__CSYNC__.dump`; unit tests: patch fans out to two list views **without** refetch.
4. Mount `SyncProvider` **beside** `QueryClientProvider` (dual-run).
5. Feature flag: `CSYNC_SERVERS=1` (env or localStorage).

**Do not** remove TanStack yet.

### Phase 1 — Virtualization (0.5–1 day, independent PR)
1. Add `virtua`.
2. Rewrite `useConsoleVirtualizer` + `useFileListVirtualizer` (+ direct usage in `CustomConsole`).
3. Remove `@tanstack/react-virtual`.
4. Manual QA: long console scroll, stick-to-bottom, file lists 1k+ entries.

### Phase 2 — SSE write path (2–3 days) — **highest leverage**
1. Implement `csync/sse/bridge.ts`.
2. Dual-write from `useServerStateUpdates`: RQ setQueriesData **and** `patchEntity` (or flag-cut).
3. Stop **post-patch invalidates** for server_state once csync views prove correct.
4. Port admin SSE entity events that already use `setQueriesData` (users/templates/errors) to `patch`/`remove`.
5. Measure: Network tab refetch count on power start/stop and admin user edit.

### Phase 3 — Domain cutover (order = SSE pain first) (~8–12 days)

| Wave | Domains | Notes |
|---|---|---|
| 3a | servers list/detail, power controls, delete | optimistic + SSE; hardest UX |
| 3b | backups, tasks, server metrics | transitional polling patterns |
| 3c | nodes, locations, allocations, agent | NodeDeleteDialog predicates |
| 3d | admin users/roles/plugins/system/security/theme | bulk mutations |
| 3e | dashboard, alerts, api-keys, profile, invites | profileSync cache subscribe |
| 3f | files, databases, templates/nests, migration, mod/plugin managers | MigrationPage dynamic intervals |

**Per domain checklist**
- [ ] `defineResource` + `defineView`s
- [ ] Replace hooks (`useServers`, …)
- [ ] Mutations: `affects` tags or pure SSE
- [ ] SSE bridge cases
- [ ] Drop RQ imports in those files
- [ ] Smoke: list, detail, create, update, delete, realtime

### Phase 4 — Compatibility burn-down (1–2 days)
1. Delete leftover `useQuery` from `@tanstack/*`.
2. Remove `queryClient.ts`, `queryKeys.ts`, `queryUtils.ts` (or reduce keys file to tag constants).
3. `authStore` + `services/api/client.ts`: `queryClient.clear()` → `sync.clear()`.
4. `useProfileSync`: subscribe to csync instead of `getQueryCache()`.
5. Drop Provider/devtools from `main.tsx`; remove `vendor-query` chunk.

### Phase 5 — Docs & lockfile (0.5 day)
1. `package.json`: remove all three `@tanstack/*`.
2. pnpm install / lockfile clean.
3. Update `CONTRIBUTING.md` (server state = csync; client = Zustand).
4. Update `docs/development.md` / architecture notes if they mention RQ.
5. CI grep gate: fail if `@tanstack` appears under `catalyst-frontend/`.

### Optional Phase 6 — Backend SSE enrichment (parallel, big multiplier)
Enrich events with partial entities so the client almost never revalidates:
- `server_state_update`: include fields UI already patches (status, ports, exitCode) — already partial; extend for list columns that still refetch.
- Admin CRUD events: include the new/updated row DTO, not just ids.
- Delete events: id + type only is enough for `removeEntity`.

---

## 6. Incremental shim strategy

During dual-run, optional thin facade reduces codemod risk:

```ts
// temporary — NOT a permanent RQ clone
export function useQuery_compat(options) {
  if (isCsyncView(options.queryKey)) return useCsyncQuery(...);
  return rqUseQuery(options); // until wave complete
}
```

Prefer **wave-by-wave hook rewrites** over a perfect RQ emulator — emulating predicates forever recreates the problem. Freeze csync v1 features: entities, views, tags, mutations, transitions, SSE bridge, virt list. No infinite-query primitives until needed.

Codemod shape:
- `useQuery({ queryKey: qk.X, queryFn })` → `useQuery(xView, params)`
- `invalidateQueries({ queryKey: qk.Y })` → `revalidateTags([...])` or mutation `affects`
- `setQueriesData` / optimistic helpers → `patchEntity` / `removeEntity`

---

## 7. Risk hotspots (must be deliberate)

| Risk | File(s) | Mitigation |
|---|---|---|
| Admin SSE matrix | `useSseAdminEvents.ts` | Event→tag/entity table; dual-write; golden tests per event type |
| Server state debounce | `useServerStateUpdates.ts` | Move batching into csync scheduler; kill post-patch invalidate |
| Optimistic power/delete | `ServerControls`, `DeleteServerDialog`, `NodeDeleteDialog` | onMutate patch + rollback snapshots in entity store |
| Auth clear | `api/client.ts`, `authStore.ts` | Single `sync.clear()`; multi-tab broadcast unchanged |
| Profile bridge | `useProfileSync.ts` | csync subscribe → zustand display fields |
| Filtered lists after status patch | server list views | view `project` refilter **or** tag revalidate for search/pagination pages |
| Migration polling | `MigrationPage.tsx` | `refetchInterval` fn support in useQuery |
| Over-normalization | one-off admin blobs (SMTP/theme) | allow tag-only views without entity |

---

## 8. Test plan

### Unit (vitest)
- Entity patch updates N subscribed views without `queryFn` call.
- `revalidateTags` coalesces within scheduler window.
- Mutation onMutate → error → rollback.
- `clear()` drops all entities/views.
- Tag index: remove entity drops tags.
- Transition poll starts/stops with status changes.

### Integration
- `useServers` + mock SSE `server_state` → status flip, no extra list fetch.
- Delete server → detail removed, list row gone.
- 401/logout → cache empty (spy fetch count after clear).

### E2E (Playwright hot paths)
1. Server list → start/stop → status badge without full refresh flake.
2. Console: stream lines, scroll performance, stick-to-bottom.
3. File manager: large dir virtualize, navigate, mutate file, list refresh.
4. Admin users: create/edit; second tab/SSE sees update.
5. Backup create in-progress polling/safety until SSE.

### Definition of done
- [ ] No `@tanstack/*` in any `package.json` or lockfile
- [ ] No imports / comments requiring TanStack APIs
- [ ] No `vendor-query` chunk
- [ ] CONTRIBUTING + dev docs updated
- [ ] CI grep gate green
- [ ] Success metrics §3 measurable on staging (SSE power path = 0 list refetch)

---

## 9. Effort estimate

| Phase | Eng-days |
|---|---|
| 0 Foundations | 2–3 |
| 1 Virtual (virtua) | 0.5–1 |
| 2 SSE write path | 2–3 |
| 3 Domain waves | 8–12 |
| 4 Burn-down | 1–2 |
| 5 Docs/lockfile/CI | 0.5 |
| **Total** | **~14–22** |
| Optional BE SSE enrichment | +2–5 (high ROI) |

One focused engineer ~3–4 weeks; two engineers can parallelize Phase 1 + Phase 3 waves after Phase 0.

---

## 10. Quick wins *during* migration (better before “done”)

1. **Stop invalidate-after-patch** in `useServerStateUpdates` once patch coverage is trusted (even on RQ) — instant quieter network.
2. **Coalesce admin SSE invalidates** by tag with 50ms `queueMicrotask` batching.
3. **Declare mutation `affects`** in one map instead of copy-paste `Promise.all([invalidate…])`.
4. **Safety-poll only transitional rows**, not entire admin tables on fixed 5–10s where SSE exists.
5. **Ship virtua first** — small PR, drops one TanStack package immediately.

---

## 11. What NOT to do

- ❌ Swap RQ → SWR and call it done (same invalidation culture, weaker entity patch).
- ❌ Dump server lists into Zustand “because we already have it.”
- ❌ Build a 1:1 RQ clone with predicates forever (mini-TanStack maintenance trap).
- ❌ Big-bang rewrite of all 79 files in one PR.
- ❌ Remove `clear()` on 401/logout.
- ❌ Infinite-query abstractions “for later” with zero call sites.
- ❌ Put csync inside `packages/` before the FE design stabilizes.

---

## 12. Suggested first implementation prompt

```
Implement csync v0 skeleton under catalyst-frontend/src/csync/:
- core EntityStore/ViewStore/TagIndex/Scheduler + createSync()
- React SyncProvider, useQuery, useEntity, useMutation (useSyncExternalStore)
- resources/server.ts with serverList + serverDetail
- sse/bridge + server_state_update patch handler
- dual-run: useServers reads csync behind flag CSYNC_SERVERS=1; keep RQ default
- window.__CSYNC__.dump
- unit tests: patch fan-out to two list views without refetch
Do NOT migrate all call sites yet. Do NOT put server entities in Zustand.
```

---

## 13. Subagent synthesis credit

| Agent | Contribution |
|---|---|
| **scout** | API surface, hotspot risk matrix, 79 files / 343 invalidates, zero plugin usage |
| **researcher** | Alternative ranking; virtua; reject SWR/RTK as primary |
| **oracle** | csync architecture, tags vs keys, Zustand boundary, example rewrites |
| **planner** | Phased dual-run plan, effort, DoD, test plan |

**Executive recommendation:** Build **Catalyst Sync** + **virtua**. Delete all `@tanstack/*`. Keep Zustand for client state only. Make SSE **patch-first** so the control panel feels live instead of “refetch-driven.”
