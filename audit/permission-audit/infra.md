# API Permission Audit — Infrastructure Scope (nodes, locations, nests, templates, node metrics)

Auditor: `audit-infra` · Repo: `/home/karutoil/catalyst` · Files: `catalyst-backend/src/routes/nodes.ts`, `locations.ts`, `nests.ts`, `templates.ts`, plus node-metrics-history in `routes/metrics.ts` (mission-listed; the handler lives there, registered as `GET /api/nodes/:nodeId/metrics` via the `/api` prefix, server.ts:1089).

## 1. Executive summary

- 55 endpoints audited (nodes.ts 37, locations.ts 5, nests.ts 5, templates.ts 7, metrics.ts node-history 1). Verdicts: **OK 18 · A-READ-GAP 16 · F-ADMIN-GAP 11 · B-WRITE-LEAK 3 · E-BROAD 7 · C-NO-CHECK 0 · D-CATALOG 0 (primary)**.
- locations.ts / nests.ts / templates.ts implement the owner contract correctly via `lib/permissions` `hasAnyPermission`/`hasPermission` (which route through `permissionMatches`/`hasGrant`): reads admit `admin.read`, writes admit `admin.write`, targeted perms work. All 18 OK.
- **nodes.ts is the systemic failure**: its file-local `ensurePermission` (nodes.ts:57-66) does raw `perms.includes(...)` and bypasses `hasGrant` — so `admin.read` cannot reach ANY nodes.ts read, and `admin.write` cannot reach 11 write endpoints. Inner checks that explicitly try to admit the admin bits (nodes.ts:691-694, 781-784, 865-868, 998, 1414) are dead code behind the raw outer gate.
- Worst leak: **`POST /api/nodes/assign-wildcard` (nodes.ts:2508-2512)** — `node.assign` alone (no node access, no self-target guard) lets any holder grant themselves/anyone wildcard access to every node → privilege escalation.
- `node.update` is over-broad: agent restart/update/config-write/host-network routes (2944-3348) require no `hasNodeAccess` at all, and `GET /:nodeId/agent/config` (3165-3169) hands sensitive agent config to bare `node.read` holders (e.g. the built-in "support" preset).
- `hasNodeAccess`'s admin path is write-only (`isAdminUser(..., requireWrite=true)`, permissions.ts:648): even with the gate fixed, `admin.read` would still be 403'd by every `hasNodeAccess`-guarded read.
- Node metrics history (metrics.ts:405-411) is the inverse gap: admin bits only — the targeted `node.view_stats` (granted by support/moderator presets) cannot reach it, while `GET /:nodeId/stats` (nodes.ts:1140) requires `node.view_stats` but not the admin bits. Same data, two disjoint gates.
- **Verdict extension `F-ADMIN-GAP`**: write endpoint that `admin.write` cannot reach because the check bypasses `hasGrant` (contract #2 violation). The canonical verdict list has no code for this mirror of A-READ-GAP, so it is recorded separately.
- No unauthenticated-by-design holes found: `POST /:nodeId/heartbeat` (nodes.ts:1267) is agent-API-key authenticated (OK-UNAUTH). No permission string enforced in these files is missing from `lib/permissions-catalog.ts` PERMISSION_CATEGORIES (D-CATALOG = 0 primary) — the missing-permission problems are *fallbacks to admin-level grants*, not uncataloged strings.

## 2. Endpoint table

Check locations cite the gate(s) in execution order. "raw" = nodes.ts `ensurePermission` (raw `includes`, ignores hasGrant admin-bit/scoped semantics). `hasNodeAccess` admin path = `*`/`admin.write` only (permissions.ts:648 → isAdminUser requireWrite=true).

### nodes.ts — registered under `/api/nodes` (server.ts:1071)

| # | METHOD + PATH | Check @ file:line | R/W | Essential current check logic | VERDICT | Proposed fix |
|---|---|---|---|---|---|---|
| 1 | PATCH /api/nodes/auto-update | nodes.ts:272; check :276 | W | raw `node.update`; NO hasNodeAccess — updateMany over any submitted ids | F-ADMIN-GAP (admin.write-only user 403s; also E: acts globally, unlike PUT /:nodeId which scopes non-admins via hasNodeAccess :995-1000) | Fix #1 (hasGrant); for non-write-admins filter nodeIds through getUserAccessibleNodes |
| 2 | POST /api/nodes | nodes.ts:353; check :357 | W | raw `node.create` | F-ADMIN-GAP | Fix #1 |
| 3 | GET /api/nodes | nodes.ts:565; check :569 (branch :575-578) | R | raw `node.read`; then `isAdmin` = `*`\|admin.write\|admin.read → all nodes, else accessible nodes | A-READ-GAP (admin.read-only 403 at :569 although the :577-578 branch was written for it; admin.write-only also 403) | Fix #1 |
| 4 | GET /api/nodes/:nodeId | nodes.ts:630; checks :634, :639 | R | raw `node.read` + hasNodeAccess (admin path = write-admin only) | A-READ-GAP (admin.read blocked twice: :634 raw, :639 write-admin) | Fix #1 + Fix #4 (read-mode hasNodeAccess) |
| 5 | POST /api/nodes/:nodeId/deployment-token | nodes.ts:668; checks :672, :687-694 | W | raw `node.create` AND hasNodeAccess AND rolePerms node.update\|*\|admin.write (rolePerms via resolveServerPermissions) | F-ADMIN-GAP (admin.write-only 403 at :672; the admin.write special-case :691-694 is unreachable for them); wrong verb: `node.create` gates an existing-node op | Fix #1; change required perm to `node.update` (matches nodeManage semantics) |
| 6 | GET /api/nodes/:nodeId/api-key | nodes.ts:774; checks :778, :781-785 | R | raw `node.read`; then isApiKeyAdmin = `*`\|admin.write\|admin.read OR hasNodeAccess | A-READ-GAP (admin.read-only 403 at :778 although :784 explicitly admits it) | Fix #1 |
| 7 | POST /api/nodes/:nodeId/api-key | nodes.ts:840; checks :844, :861-868 | W | raw `node.create` AND hasNodeAccess AND rolePerms node.update\|*\|admin.write | F-ADMIN-GAP (admin.write special-case :865-868 dead behind :844); mints agent API key = caller becomes valid agent | Fix #1; required perm → `node.update` |
| 8 | PUT /api/nodes/:nodeId | nodes.ts:991; checks :995, :998-1000 | W | raw `node.update`; then isNodeAdmin = `*`\|admin.write OR hasNodeAccess | F-ADMIN-GAP (admin.write-only 403 at :995 though :998 would admit) | Fix #1 |
| 9 | GET /api/nodes/:nodeId/stats | nodes.ts:1136; checks :1140, :1145 | R | raw `node.view_stats` + hasNodeAccess | A-READ-GAP (node.view_stats is explicitly read-class in isReadPermission, permissions.ts:133 — hasGrant would admit admin.read; raw check doesn't; also hasNodeAccess blocks admin.read) | Fix #1 + Fix #4 |
| 10 | POST /api/nodes/:nodeId/heartbeat | nodes.ts:1267; auth :1285-1307 | W | agent API key via verifyAgentApiKey(nodeId, key) | OK-UNAUTH (agent-auth by design) | none |
| 11 | DELETE /api/nodes/:nodeId | nodes.ts:1407; checks :1411, :1414-1416 | W | raw `node.delete`; then isNodeAdmin OR hasNodeAccess; deletes agent API keys :1440-1460 | F-ADMIN-GAP | Fix #1 |
| 12 | GET /api/nodes/:nodeId/ip-pools | nodes.ts:1493; checks :1497, :1502 | R | raw `node.read` + hasNodeAccess | A-READ-GAP | Fix #1 + Fix #4 |
| 13 | GET /api/nodes/:nodeId/ip-availability | nodes.ts:1539; checks :1543, :1548 | R | raw `node.read` + hasNodeAccess | A-READ-GAP | Fix #1 + Fix #4 |
| 14 | GET /api/nodes/:nodeId/allocations | nodes.ts:1583; checks :1587, :1592 | R | raw **`node.manage_allocation`** (a manage/write perm gates a list) + hasNodeAccess | A-READ-GAP (admin.read, node.read+assignment all 403; admin.write-only 403 too) | Fix #1 + admit `node.read` for the read variant (Fix #10) |
| 15 | POST /api/nodes/:nodeId/allocations | nodes.ts:1659; checks :1663, :1668 | W | raw `node.manage_allocation` + hasNodeAccess | F-ADMIN-GAP | Fix #1 |
| 16 | PATCH /api/nodes/:nodeId/allocations/:allocationId | nodes.ts:1727; checks :1731, :1739 | W | raw `node.manage_allocation` + hasNodeAccess | F-ADMIN-GAP | Fix #1 |
| 17 | DELETE /api/nodes/:nodeId/allocations/:allocationId | nodes.ts:1771; checks :1775, :1783 | W | raw `node.manage_allocation` + hasNodeAccess (refuses assigned allocations :1794) | F-ADMIN-GAP (creation and deletion share one perm — see vocabulary) | Fix #1 |
| 18 | POST /api/nodes/:nodeId/allocations/bulk-delete | nodes.ts:1805; checks :1809, :1813 | W | raw `node.manage_allocation` + hasNodeAccess | F-ADMIN-GAP | Fix #1 |
| 19 | GET /api/nodes/:nodeId/assignments | nodes.ts:1866; checks :1870, :1876 | R | raw **`node.assign`** (write perm gates a list) + hasNodeAccess | A-READ-GAP (admin.read, node.read 403) | Fix #1 + admit `node.read` (Fix #10) |
| 20 | POST /api/nodes/:nodeId/assign | nodes.ts:1900; checks :1904, :1924-1931 | W | raw `node.assign` + assigner hasNodeAccess | F-ADMIN-GAP (otherwise well-formed: assigner-access guard) | Fix #1 |
| 21 | DELETE /api/nodes/:nodeId/assignments/:assignmentId | nodes.ts:2033; check :2037 ONLY | W | raw `node.assign` — **no hasNodeAccess** | B-WRITE-LEAK (node.assign-only user with zero node access can revoke ANY assignment on ANY node; asymmetric with POST :1924 and GET :1876) | Add the same assigner hasNodeAccess check as POST /assign |
| 22 | GET /api/nodes/accessible | nodes.ts:2095; check :2102 | R | raw `node.read`; then getUserAccessibleNodes (admin path = write-admin only, permissions.ts:781) | A-READ-GAP (admin.read 403) | Fix #1 (+ read-mode in getUserAccessibleNodes for admin.read) |
| 23 | GET /api/nodes/:nodeId/unregistered-containers | nodes.ts:2142; check :2146 | R | raw **literal `admin.write`** | A-READ-GAP + admin-level fallback (admin.read 403; no targeted perm admits — mission's "fallback to admin-level grant" pattern) | Replace with `node.read` (hasGrant-fixed) + hasNodeAccess read-mode |
| 24 | GET /api/nodes/:nodeId/unregistered-containers/:containerId/suggest-template | nodes.ts:2189; check :2193 | R | raw literal `admin.write` | A-READ-GAP + admin-level fallback (pure computation, read-only) | Same as #23 |
| 25 | POST /api/nodes/:nodeId/import-server | nodes.ts:2320; check :2324 | W | raw literal `admin.write` (only `*`/admin.write pass; `server.create`/`node.update` holders cannot) | E-BROAD (admin-level fallback where a targeted permission should exist) | `node.update`+hasNodeAccess or new `node.import_server`; or keep admin.write but via hasGrant |
| 26 | POST /api/nodes/assign-wildcard | nodes.ts:2508; check :2512 ONLY | W | raw `node.assign` — **no hasNodeAccess, no self-target guard**; grants target access to ALL nodes | B-WRITE-LEAK (node.assign alone → self-assign wildcard → all-node access = privilege escalation; admin.write-only also 403) | Require write-admin (admin.write/\*) via hasGrant, forbid targeting self/own roles, audit-log already present |
| 27 | DELETE /api/nodes/assign-wildcard/:targetType/:targetId | nodes.ts:2619; check :2623 ONLY | W | raw `node.assign` — no hasNodeAccess | B-WRITE-LEAK (node.assign-only user can strip anyone's wildcard grant; access-DoS; asymmetric with POST /assign) | Same scoping as POST /assign / admin bits |
| 28 | GET /api/nodes/:nodeId/agent/status | nodes.ts:2686; check :2690 | R | raw `node.read` — **NO hasNodeAccess** (any node.read holder, e.g. support preset, queries ANY node: hostname, sftp port, config path, OS info) | A-READ-GAP (admin.read 403) with E note (node.read acts globally here, contradicting GET /:nodeId :639) | Fix #1 + add hasNodeAccess read-mode |
| 29 | GET /api/nodes/:nodeId/agent/logs | nodes.ts:2777; check :2781 | R | raw `node.read` — NO hasNodeAccess | A-READ-GAP + E note (cross-node agent logs for bare node.read) | Fix #1 + hasNodeAccess read-mode |
| 30 | GET /api/nodes/:nodeId/agent/logs/stream | nodes.ts:2817; check :2824 | R | raw `node.read` — NO hasNodeAccess (SSE) | A-READ-GAP + E note | Fix #1 + hasNodeAccess read-mode |
| 31 | POST /api/nodes/:nodeId/agent/restart | nodes.ts:2944; check :2948 | W | raw `node.update` — NO hasNodeAccess (restart any node's agent) | E-BROAD (node.update unscoped here; F too: admin.write-only 403) | Fix #1 + require hasNodeAccess for non-write-admins (mirror :995-1000) |
| 32 | POST /api/nodes/:nodeId/agent/update | nodes.ts:2991; check :2995 | W | raw `node.update` — NO hasNodeAccess (agent binary update, can break workloads) | E-BROAD (+ F) | Fix #1 + hasNodeAccess |
| 33 | GET /api/nodes/:nodeId/agent/update-status | nodes.ts:3071; check :3075 | R | raw `node.read` — NO hasNodeAccess | A-READ-GAP + E note | Fix #1 + hasNodeAccess read-mode |
| 34 | POST /api/nodes/:nodeId/agent/ping | nodes.ts:3125; check :3129 | R* | raw `node.read` — NO hasNodeAccess (read-only effect: latency) | A-READ-GAP + E note | Fix #1 + hasNodeAccess read-mode |
| 35 | GET /api/nodes/:nodeId/agent/config | nodes.ts:3165; check :3169 | R | raw `node.read` — NO hasNodeAccess; returns agent config.toml (comment :3236-3239: contains security-sensitive keys — release_repo, sftp, cni_\*, systemd, config_path) | E-BROAD (bare node.read — e.g. the "support" preset — reads ANY online node's sensitive agent config) + A note (admin.read 403) | Raise to `node.update` or new `node.agent_read` AND scope by hasNodeAccess |
| 36 | PUT /api/nodes/:nodeId/agent/config | nodes.ts:3203; check :3207 | W | raw `node.update` — NO hasNodeAccess (writes full agent config incl. sensitive keys, allowUnsafe opt-in :3240) | E-BROAD (+ F: admin.write-only 403) | Fix #1 + hasNodeAccess |
| 37 | POST /api/nodes/:nodeId/host-network | nodes.ts:3282; check :3286 | W | raw `node.update` — NO hasNodeAccess (live host-network policy change, persisted to config.toml) | E-BROAD (+ F) | Fix #1 + hasNodeAccess |

### locations.ts — `/api/locations` (server.ts:1088) — `ensureAnyPermission` → lib `hasAnyPermission` → `permissionMatches` (admin bits honored)

| # | METHOD + PATH | Check @ file:line | R/W | Essential current check logic | VERDICT | Proposed fix |
|---|---|---|---|---|---|---|
| L1 | GET /api/locations | locations.ts:25; check :29-33 | R | location.read \| admin.read \| admin.write | OK | none |
| L2 | GET /api/locations/:locationId | locations.ts:55; check :62-66 | R | same set; nodes included with `omit: secret` :74-78 | OK | none |
| L3 | POST /api/locations | locations.ts:90; check :95-98 | W | location.create \| admin.write (admin.read correctly excluded) | OK | none |
| L4 | PUT /api/locations/:locationId | locations.ts:143; check :148-151 | W | location.update \| admin.write | OK | none |
| L5 | DELETE /api/locations/:locationId | locations.ts:204; check :209-212 | W | location.delete \| admin.write; refuses when nodes exist :229-236 | OK | none |

### nests.ts — `/api/nests` (server.ts:1087) — same `hasAnyPermission` helper (admin bits honored)

| # | METHOD + PATH | Check @ file:line | R/W | Essential current check logic | VERDICT | Proposed fix |
|---|---|---|---|---|---|---|
| N1 | GET /api/nests | nests.ts:26; check :30 | R | template.read \| admin.read \| admin.write | OK | none |
| N2 | GET /api/nests/:nestId | nests.ts:52; check :56 | R | same set | OK | none |
| N3 | POST /api/nests | nests.ts:79; check :83 | W | template.create \| admin.write | OK | none (no nest.\* perms by design — comment :8-10; documented) |
| N4 | PUT /api/nests/:nestId | nests.ts:130; check :134 | W | template.update \| admin.write | OK | none |
| N5 | DELETE /api/nests/:nestId | nests.ts:188; check :192 | W | template.delete \| admin.write (disconnects templates first :208-213) | OK | none |

### templates.ts — `/api/templates` (server.ts:1086) — `ensurePermission` (templates.ts:63-75) → lib `hasPermission` → `permissionMatches` (admin bits honored)

| # | METHOD + PATH | Check @ file:line | R/W | Essential current check logic | VERDICT | Proposed fix |
|---|---|---|---|---|---|---|
| T1 | GET /api/templates | templates.ts:83; check :111 | R | `template.read` (hasGrant semantics) | OK | none (note: per-user response cache checked at :96-109 before the perm re-check — revocation lags ≤10s TTL; keyed by userId so no cross-user leak) |
| T2 | GET /api/templates/:templateId | templates.ts:157; check :161-166 | R | `template.read` | OK | none |
| T3 | POST /api/templates | templates.ts:188; check :192-197 | W | `template.create` | OK | none |
| T4 | PUT /api/templates/:templateId | templates.ts:308; check :312-317 | W | `template.update` | OK | none |
| T5 | DELETE /api/templates/:templateId | templates.ts:442; check :446-451 | W | `template.delete`; refuses when in use :456-462 | OK | none |
| T6 | POST /api/templates/import-pterodactyl | templates.ts:481; check :485-490 | W | `template.create`; auto-creates nests from egg category :539-551 | OK | optional: dedicated `template.import` (see vocabulary) |
| T7 | POST /api/templates/import-pterodactyl-batch | templates.ts:598; check :602-607 | W | `template.create`; fetches pinned api.github.com/raw.githubusercontent.com URLs :636-637, :680-682 | OK | same optional note as T6 |

### metrics.ts — node metrics history (mission scope; route is `GET /api/nodes/:nodeId/metrics`, registered via `/api` prefix, server.ts:1089)

| # | METHOD + PATH | Check @ file:line | R/W | Essential current check logic | VERDICT | Proposed fix |
|---|---|---|---|---|---|---|
| M1 | GET /api/nodes/:nodeId/metrics | metrics.ts:401; check :405-411 | R | raw `*` \| admin.write \| admin.read (literal includes) | E-BROAD (admin-only fallback: the targeted `node.view_stats` — granted by the built-in support & moderator presets (permissions.ts:562-565, 587-601) — and node.read+assignment cannot reach; inconsistent with the sibling stats route nodes.ts:1140 which requires node.view_stats but rejects admin bits) | Use hasGrant(perms, "node.view_stats") + hasNodeAccess read-mode (admits \*/admin.write/admin.read/node.view_stats+assignment) |

## 3. Vocabulary findings

**Enforced-in-code vs catalog:** every permission string enforced in the audited files (`node.read|create|update|delete|view_stats|manage_allocation|assign`, `admin.read`, `admin.write`, `location.*`, `template.*`) exists in `lib/permissions-catalog.ts` PERMISSION_CATEGORIES — no D-CATALOG violations. The problems are the inverse: routes with **no targeted permission wired**, falling back to admin bits (rows #23-25, M1), and **over-broad application** of existing targeted perms (rows #21, #26-37).

1. **`node.update` is overloaded (E-BROAD, systemic).** It currently authorizes: (a) node config edits on *assigned* nodes (PUT /:nodeId :995); (b) agent restart (:2948), agent binary update (:2995), agent-config write incl. sensitive keys (:3207), host-network toggle (:3286) on **ANY node with no hasNodeAccess**; (c) bulk auto-update opt-in for any nodes (:276); (d) full server management of every server on assigned nodes via the `node_manage` path (server-access.ts:64-66 — `hasNodeAccess && node.update` ⇒ owner-equivalent); (e) agent API-key minting on assigned nodes (:687-694, :861-868). Recommendation: keep `node.update` = node record/config edits, enforce hasNodeAccess on every node.update route, and split agent lifecycle control into a new permission.
   - **`node.agent_control`** (new): restart + binary-update an agent — POST /api/nodes/:nodeId/agent/restart, /agent/update. Guards workload-breaking operations separately from node metadata edits.
   - **`node.agent_config`** (new, or fold into agent_control): read/write agent config.toml + host-network policy — GET/PUT /agent/config, POST /host-network. Content is security-sensitive (nodes.ts:3236-3239), so a read of it should not ride on bare `node.read`.
2. **`node.view_stats` is enforced only once and inconsistently.** It gates GET /:nodeId/stats (:1140) but NOT node metrics history (metrics.ts:405-411, admin bits only), even though `isReadPermission` explicitly class-ifies it read (permissions.ts:133) and both presets grant it. It should be the single read gate for both.
3. **No read path for allocations / assignments.** GET /:nodeId/allocations requires `node.manage_allocation` (:1587) and GET /:nodeId/assignments requires `node.assign` (:1870) — write permissions gating reads, so `admin.read`, `node.read`+assignment users cannot list what they can otherwise inspect. Proposal: admit `node.read` (+node access) on both GET routes; keep the manage/assign perms for mutations.
4. **Creation vs deletion of allocations share `node.manage_allocation`.** Deletion is currently the safer op (refuses in-use allocations, :1794), creation is additive; a split `node.delete_allocation` is *optional* (low value today) — the reallocation of the read gate (finding 3) matters more. Record the decision either way.
5. **Assignment management vs `node.assign`.** `node.assign` is fine as the manage verb, but wildcard grant/revoke (rows #26-27) have no node-scoping and no self-target guard — a wildcard grant is panel-wide, so it should require write-admin, not a per-node verb.
6. **Egg import rides on `template.create`.** Single + batch import (templates.ts:485, :602) auto-create nests and bulk-write templates; a dedicated `template.import` would let operators delegate imports without granting template authorship. Optional — current behavior is safe (admin.write passes, admin.read correctly denied).
7. **Agent-key minting rides on `node.create`** (rows #5, #7) — wrong verb for an existing-node operation that provisions agent credentials; `node.update` (with hasNodeAccess, as the inner nodeManage check already demands) or a dedicated `node.manage_agent_keys` fits better.
8. **Scoped permissions are dead on nodes.ts.** `permissionMatches`/`hasGrant` support `perm:resourceId` (permissions.ts:160-206), but nodes.ts raw `includes` ignores them, and `hasNodeAccess` derives node scope from NodeAssignment rows instead — so a role-scoped `node.read:<id>` grant is silently worthless on every nodes.ts route while working on locations/nests/templates checks. Fix #1 restores this for free.
9. **Catalog drift (latent D):** `lib/permissions.ts:432-546` exports a second, stale `PERMISSION_CATEGORIES` (missing `server.update`, `server.install`, `server.reinstall`, `server.rebuild`, `backup.download`, `*`) alongside the real catalog in `permissions-catalog.ts:18-169`. Only `__tests__/rbac.test.ts:494-525` consumes the stale copy today; the serving route (api-keys.ts:5,58) uses the fresh one. Two sources of truth will drift again — delete the lib copy or re-export the catalog.

## 4. Fix list (priority order)

**P0 — security**
1. `routes/nodes.ts:57-66` — replace the raw body with `hasGrant` semantics: `import { hasGrant } from "../lib/permissions"; if (hasGrant(perms, requiredPermission)) return true;`. One-line-class change that admits `admin.read` to all 16 read rows, `admin.write` to all 11 F-ADMIN-GAP rows, and revives scoped perms (`node.read:<id>`).
2. `routes/nodes.ts:2508-2516` (POST /assign-wildcard) — require write-admin (`hasGrant(perms, "admin.write")` after fix #1, or an explicit `*`/admin.write check) instead of bare `node.assign`; optionally reject `targetId === request.user.userId` and roles the caller belongs to. Closes the self-escalation.
3. `routes/nodes.ts:2033-2055` (DELETE /:nodeId/assignments/:assignmentId) and `:2619-2643` (DELETE /assign-wildcard/...) — add the assigner `hasNodeAccess` guard used by POST /assign (:1924-1931), restoring symmetry.

**P1 — contract conformance**
4. `lib/permissions.ts:638-652` (`hasNodeAccess`) and `:773-790` (`getUserAccessibleNodes`) — add a read mode (parameter or wrapper, e.g. `hasNodeAccess(prisma, userId, nodeId, { read: true })` calling `isAdminUser(prisma, userId, false)` so `admin.read` counts) and use it in the read routes: nodes.ts:639, :785, :1145, :1502, :1548, :1592, :1876, :2105. Do **not** change the default — metrics.ts:80-82 and the server node_manage pairing intentionally require the write-admin path.
5. `routes/nodes.ts:2146, :2193` — replace the literal `admin.write` gate on the two unregistered-container READ routes with `node.read` + hasNodeAccess read-mode (post-fix #1 `admin.read` passes `node.read`).
6. `routes/metrics.ts:405-412` — replace raw admin includes with `hasGrant(perms, "node.view_stats")` + hasNodeAccess read-mode, aligning with nodes.ts:1140 (fixes the support/moderator-preset blind spot).
7. `routes/nodes.ts` agent cluster — add `hasNodeAccess` (non-write-admin fallback) to the node.update-gated writes :2948, :2995, :3207, :3286 (mirror the PUT /:nodeId pattern :995-1000), and hasNodeAccess read-mode to the node.read-gated reads :2690, :2781, :2824, :3075, :3129, :3169. Raise GET /agent/config (:3169) to `node.update` or a new `node.agent_config` read — its payload is security-sensitive.

**P2 — semantics / hygiene**
8. `routes/nodes.ts:672, :844` — change the required permission from `node.create` to `node.update` for deployment-token / agent API-key minting (existing-node operations; the inner nodeManage check at :687-694/:861-868 already demands node.update or admin).
9. `routes/nodes.ts:1587, :1870` — admit `node.read` on the two list reads (allocations, assignments) alongside the manage/assign perms.
10. `routes/nodes.ts:276` (PATCH /auto-update) — filter submitted nodeIds through `getUserAccessibleNodes` for non-write-admins, matching PUT /:nodeId scoping.
11. `routes/nodes.ts:2324` (POST /import-server) — either keep admin.write via hasGrant or introduce `node.import_server`; today `server.create`/`node.update` holders are locked out.
12. `lib/permissions.ts:432-546` — remove the stale duplicate `PERMISSION_CATEGORIES` (and refresh `PERMISSION_PRESETS` if kept) so `permissions-catalog.ts` is the single source of truth.
13. Optional vocabulary additions (see §3): `node.agent_control`, `node.agent_config`, `template.import`; decide and record the allocation create/delete split.
