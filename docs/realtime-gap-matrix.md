# Catalyst Realtime / Polling Gap Matrix

**Date:** 2026-08-10  
**Method:** 8 parallel scouts (FE polls, FE SSE, BE emit, migration/agent, server ops, admin/dashboard, gateway protocol, residual debt)  
**Status:** P0/P1 bulk implementation landed (see § Implementation progress)

## Implementation progress (2026-08-10)

| Item | Status |
|------|--------|
| P0.1 SSE multiplexer (`sse-hub.ts`) | **Done** — shared ref-counted EventSource |
| P0.2 Metrics → `/metrics/stream` | **Done** — `createServerMetricsStream` |
| P0.3 Duplicate admin ES | **Done** — SystemErrors uses shared hub |
| P0.4 Plugin FE WS | **Done** — connects to main `/ws` |
| P0.5 Admin SSE coalesce | **Done** — rAF/microtask scheduler |
| P0.6 Node health fanout | **Done** — `node_metrics_updated` from health_report |
| P0.7 Agent log stream | **Done** — `GET .../agent/logs/stream` + FE SSE tail |
| P1 path-scoped files | **Done** |
| P1 residual poll reductions | **Done** (nodes, profile, plugins, audit, allocs) |
| Console via SSE hub | **Done** |
| Agent logs via SSE hub | **Done** |
| Plugin host realtime helpers | **Done** — `subscribeServerRealtime` / `subscribeAdminRealtime` |
| P2 multi-tab leader election | **Done** — BroadcastChannel leader in `sse-hub.ts` |
| Dense install/transfer % | **Done** — `server_operation_progress` SSE + badge UI |
| Agent `agent_update_progress` | **Done** — agent emits progress during update |
| Dense cluster metrics | **Done** — live patch from `node_metrics_updated` |

---

## Executive summary

Catalyst is **mostly event-driven** for server power, admin CRUD, console, live gauges, backups complete, tasks, migration, and agent update start/fail. Remaining debt clusters into:

All previously listed residual “limited issues” are implemented:
1. **Install/transfer/clone %** — backend emits `server_operation_progress`; FE patches cache + badge
2. **Agent update progress** — agent pushes `agent_update_progress` during download/apply
3. **Cluster live metrics** — `node_metrics_updated` patches cluster cache; 60s safety poll only

Minor residual: some admin list paths still coalesce-invalidate rather than full entity patch; network MB/s on cluster still needs two samples for rate.

---

## Severity legend

| Tag | Meaning |
|-----|---------|
| **P0** | Broken live UX, wasted connections, or silent drop of important state |
| **P1** | Feels stale vs Ptero/competitors; should be live |
| **P2** | Polish / multi-tab / density |
| **OK** | Poll is appropriate (or transitional safety only) |

---

## 1. Full surface scorecard

| Surface | Mechanism today | Live? | Severity | Notes |
|---------|-----------------|-------|----------|-------|
| Server power / status | Global SSE patch + transitional poll | **Yes** | OK | Best path in the product |
| Server list idle | No poll; SSE patch | **Yes** | OK | |
| Console output | Console SSE + 2s poll if down | **Yes** | OK / P2 | Fallback poll fine |
| Live CPU/RAM gauges | Per-server `/events` (full multiplex) | **Partial** | P0 | Works but wrong stream; multi-ES |
| Metrics history charts | 30s poll | OK | OK | History ≠ live |
| File manager / tree | `server_files_changed` + 60s safety | **Partial** | P1 | Invalidate-all; no path scope |
| Backups list | started/complete SSE + 5s while processing | **Partial** | P1 | Weak mid-progress % |
| Tasks / schedules | task_progress/complete SSE + safety | **Partial** | P1 | Often invalidate-only |
| Activity log | 60s + lifecycle invalidate | **Partial** | P1 | No dedicated activity event |
| Plugin/mod manager | complete SSE; no fixed poll | **Partial** | P1 | Patch install state possible |
| Databases / invites / allocations | REST + mutation invalidate; allocations **30s poll** | **No** | P1 | Allocations blind poll |
| Transfer / clone | Transitional status SSE | **Partial** | P2 | No dense progress % |
| Migration job/steps | Admin SSE + 10s safety | **Yes** | OK | Recently wired |
| Agent status | node_updated + 60s safety | **Partial** | P1 | Uptime/runtime still polled |
| Agent update | admin SSE start/fail + poll while updating | **Partial** | P1 | `progress` never emitted by agent |
| Agent logs “stream” | **2s REST poll** | **No** | **P0** | Labeled stream, is poll |
| Node stats / metrics graphs | **10s / 15s hard poll** | **No** | **P0** | `health_report` never fanned out |
| Cluster / dashboard resources | 30–60s poll | **No** | P1 | No dense cluster SSE |
| Admin users/roles/servers/nodes | Admin SSE; many lists poll:false | **Yes** | OK | Invalidate-heavy |
| Admin system errors | Admin SSE + **duplicate** ES on page | **Yes** | P0 | Double admin connection |
| Audit logs “live” | **15s poll toggle** | **No** | P1 | `audit_log_created` exists |
| Alerts | SSE, poll false | **Yes** | OK | |
| API keys list | SSE | **Yes** | OK | Usage still light poll |
| Profile / sessions | 30s + 60s dual poll | **No** | P1 | Overlap with profileSync |
| Plugins page / update settings | 30s poll | **Partial** | P1 | |
| Ticketing / plugin boards | FE WS defaults **off** | **No** | **P0** | BE can broadcast; FE dead |
| Multi-tab | N tabs × M EventSources | **No** | P2 | Only auth BroadcastChannel |

---

## 2. Backend emit ↔ subscribe gaps

### Critical: emitted but not (or poorly) reaching the browser

| Event / message | Emitted? | In SSE filter? | Browser sees? | Gap |
|-----------------|----------|----------------|---------------|-----|
| `health_report` (agent) | Yes | No fanout | **No** | DB only → forces node poll |
| `agent_update_progress` | **Agent never sends** | Admin yes | **No** | Orphan subscription |
| `discovered_servers` | Yes | No | **No** | Memory only |
| Install progress | Via console lines only | Console | Console only | No `%` event type |
| `backup_upload_chunk_response` | Yes | Intentionally ignored | No | OK internal |
| `clone_files_complete` | requestId only | No stream | No | API waiter only |
| Node metrics time series | Persisted from health | No push | Poll only | P0 product gap |

### Recently fixed / healthy

| Event | Status |
|-------|--------|
| `server_files_changed`, `backup_*_started` | In server `EVENT_TYPES` |
| `migration_job_updated`, `migration_step_updated` | Admin emit + FE handler |
| `agent_update_started/failed` | Gateway → admin SSE + FE |
| `server_state_*`, backups complete, tasks, resource_stats | routeToClients → /events |
| Admin CRUD (users, nodes, templates, …) | pushToAdminSubscribers |

### Orphans / FE dead listeners (examples)

- FE may listen for types with no BE emit (scout 2/3): treat contract tests as source of truth going forward
- Console types on general `/events` vs console-only stream — don’t expect console on multiplex

---

## 3. Frontend polling inventory (condensed)

### MUST_BE_LIVE or SHOULD_BE_LIVE (still polling hard)

| Location | Interval | Data |
|----------|----------|------|
| `useNodes.ts` useNodeStats | **10s** | Node capacity |
| `useNodes.ts` useNodeMetrics | **15s** | Node charts |
| `useDashboard` resources | **30s** | Cluster tiles |
| `AgentControlPanel` logs stream | **2s** | Fake live tail |
| `ServerDetailsPage` allocations | **30s** | Ports/allocs |
| `AuditLogsPage` live mode | **15s** | Audit |
| `useProfile` + `useProfileSync` | **30s + 60s** | Dual /auth/me |
| `PluginsPage` / `UpdateSettings` | **30s** | Plugin/update state |
| `SftpConnectionInfo` | **15s** | Creds (OK near expiry only) |

### OK — transitional / safety only

| Location | Behavior |
|----------|----------|
| useServers / useServer | 2s only if transitional status |
| useBackups | 5s only if in_progress |
| useTasks | 5s only if running/pending |
| MigrationPage | 10s only if active job |
| Agent update status | 3s only while updating |
| File manager | 60s safety; SSE primary |
| useAdminHealth | 30s — health not evented by design |
| useServerMetricsHistory | 30s — historical |

---

## 4. Connection fanout (P0 structural)

On a typical **server details** view a single tab can open:

1. `/api/servers/all-servers/events` (AppLayout)
2. `/api/admin/events` (admin AppLayout)
3. `/api/servers/:id/events` × N (`useServerMetrics`, `useBackups`, `useEulaPrompt`, `useSseResizeComplete`, …)
4. `/api/servers/:id/console/stream` (console)
5. **Extra** `/api/admin/events` on SystemErrorsPage

**Backend already has** `/api/servers/:id/metrics/stream` — FE live gauges **do not use it** (still full `/events`).

Design note in `server-events.ts`: *“one EventSource per hook, not singleton”* — this is the root tax.

---

## 5. Invalidate vs patch hotspots

| Path | Today | Better |
|------|-------|--------|
| server_state | **Patch** (good) | Keep |
| server_created/updated/suspended | Broad invalidate | Patch list row / detail fields |
| backup/task/mod/plugin complete | Invalidate | Patch status/progress from payload |
| server_files_changed | Invalidate all file keys | Path/dir-scoped invalidate |
| Admin SSE multi-entity | ~100 invalidates, **no debounce** | Coalesce 16–50ms + dedupe keys |
| Migration | Partial setQueryData + invalidate | Good enough; tighten later |

---

## 6. Agent protocol → browser (gateway)

| Agent message | Browser visibility |
|---------------|-------------------|
| resource_stats / batch | Yes (WS + /events + metrics SSE) |
| console_output | Console SSE only |
| server_state_* | Yes when status changes |
| backup_* complete | Yes |
| eula_required, storage_resize | Yes |
| agent_update_started/failed | Admin SSE |
| agent_update_progress | **Dead** (not sent by agent) |
| health_report | **Not realtime** (DB only) |
| discovered_servers | Not browser |
| install | Console lines only |
| SFTP | No SFTP realtime stream |

---

## 7. Prioritized roadmap

### P0 (~8–12 eng-days)

| # | Work | Est. |
|---|------|------|
| P0.1 | **SSE multiplexer** — ref-counted shared ES per URL; hooks subscribe to bus | 3–4d |
| P0.2 | Live gauges → **`/metrics/stream`** (or filtered shared bus) | 1d |
| P0.3 | Remove duplicate admin ES on SystemErrorsPage | 0.5d |
| P0.4 | **Plugin FE realtime** — real gateway path; ticketing live | 2–3d |
| P0.5 | Admin SSE **debounce + coalesce** invalidates | 1–1.5d |
| P0.6 | Fan out **node health/metrics** (or short node SSE) → drop 10s/15s hard polls | 2–3d |
| P0.7 | **Agent log true stream** (SSE/WS tail) | 2d |

### P1 (~10–14 eng-days)

| # | Work | Est. |
|---|------|------|
| P1.1 | Patch-first backups/tasks/mods/plugins | 2–3d |
| P1.2 | Path-scoped file invalidation | 1.5–2d |
| P1.3 | Cluster/dashboard live or slower safety-only | 2–3d |
| P1.4 | Audit live via `audit_log_created` prepend | 1d |
| P1.5 | Collapse profile dual-poll | 0.5–1d |
| P1.6 | Allocations event or invalidate-on-change | 1d |
| P1.7 | Agent actually emits `agent_update_progress` (+ install %) | 2d |

### P2 (~6–10 eng-days)

| # | Work | Est. |
|---|------|------|
| P2.1 | Cross-tab SSE leader election | 3–4d |
| P2.2 | BroadcastChannel for power/theme/plugins | 1–2d |
| P2.3 | Plugin host subscribe API over shared bus | 2d |
| P2.4 | Dense transfer/install progress | 2d |

**Total residual:** ~24–36 eng-days. **P0 alone** fixes “structurally realtime.”

---

## 8. Suggested sequence

1. Multiplexer (P0.1) — unblocks everything  
2. Metrics stream + drop duplicate admin ES (P0.2–0.3)  
3. Admin coalesce + patch-first high-churn (P0.5, P1.1)  
4. Node health fanout + agent log stream (P0.6–0.7)  
5. Plugin FE live (P0.4)  
6. Multi-tab leader (P2.1)

---

## 9. What is already in good shape

- Server power status: patch-first global SSE  
- Alerts: SSE, no idle poll  
- Migration job/steps: admin SSE + safety poll  
- Agent update start/fail: admin SSE  
- Console SSE design + rAF batching  
- Transitional-only polls on servers/tasks/backups  
- Auth cross-tab BroadcastChannel  
- Contract tests for server + admin EVENT_TYPES alignment  

---

## 10. Scout attribution

| Scout | Focus |
|-------|--------|
| 1 | FE polling inventory |
| 2 | FE SSE consumers / dead handlers |
| 3 | BE emit ↔ subscribe matrix |
| 4 | Migration / agent / node control plane |
| 5 | Server ops surfaces |
| 6 | Admin / dashboard / alerts |
| 7 | Gateway agent protocol visibility |
| 8 | Residual debt + roadmap |

*This document is the synthesis of those eight parallel audits.*
