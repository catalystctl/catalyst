# Permission Audit — server-extras scope

Files audited (main tree only): `catalyst-backend/src/routes/servers/mod-plugins.ts` (16 endpoints), `catalyst-backend/src/routes/servers/invites.ts` (10), `catalyst-backend/src/routes/servers/cs2.ts` (6), `catalyst-backend/src/routes/tasks.ts` (6), `catalyst-backend/src/routes/metrics.ts` (3). 41 endpoints total.

## 1. Executive summary

- **A-READ-GAP (4):** task listings require write-level `server.schedule` (tasks.ts:223-229, 248-254) and both server metrics endpoints lock out `admin.read` *and* bare `admin.write` via exact-match `rolePerms.includes("server.read")` (metrics.ts:83-90, 349-356) — only `*` or roles that also hold `server.read`/`node.update` pass.
- **B-WRITE-LEAK (20):** 18 endpoints across all five files never pass the `actor` argument to the access helpers, so an API key's own permission scope is ignored — a key scoped to `server.read` (or nothing) performs `file.write`-class writes (mod/plugin install/uninstall/update), task CRUD+execute (incl. console-command tasks), and invite minting, acting with the owner user's full DB-resolved access. 2 low-severity: `check-updates` POSTs persist DB state yet are gated on read-level `server.read`, reachable by `admin.read`.
- **E-BROAD (1):** `GET /api/servers/:id/invites` returns raw invite **tokens** to *any* subuser (gate is `canAccessServer`, not the manage path).
- **C-NO-CHECK (0), D-CATALOG (0):** every permission string enforced in these files exists in `lib/permissions-catalog.ts`. New targeted permissions are needed (mods/plugins, subusers) — see §3.
- Cross-cutting: `server.schedule` subsumes power/backup actions without their own permissions; node metrics ignore the catalog's `node.view_stats`; a second, drifted `PERMISSION_CATEGORIES` exists in `lib/permissions.ts:432`.
- Verdict counts: **OK 16 · A-READ-GAP 4 · B-WRITE-LEAK 20 · C-NO-CHECK 0 · D-CATALOG 0 · E-BROAD 1**.

## 2. Endpoint table

Legend: verdicts per mission (OK / A-READ-GAP / B-WRITE-LEAK / C-NO-CHECK / D-CATALOG / E-BROAD). "key-scope" = the route resolves access from the owning **user's** DB state and never checks `request.user.permissions`, so an API key's own scope is not enforced (`enforceKeyScope` never runs — compare files.ts:115 and metrics-stream.ts:55 which pass `request.user`).

Reference contracts: `hasGrant` (permissions.ts:143-149: `*`→all, `admin.write`→any concrete, `admin.read`→any read), `isReadPermission` (permissions.ts:130-136), `decideServerAccess` (server-access.ts:33-68), `ensureServerAccess` (servers/_helpers.ts:495-558), `enforceKeyScope` (_helpers.ts:487-493), auth attaches the **key's** perms to `request.user.permissions` for API-key auth (server.ts:473-517).

### 2.1 `routes/servers/mod-plugins.ts` (prefix `/api/servers`, server.ts:1072-1084)

| METHOD+PATH | Check (file:line) | R/W | Current logic | VERDICT | Proposed fix |
|---|---|---|---|---|---|
| GET `/:sid/mod-manager/game-versions` | mod-plugins.ts:64 | R | `ensureServerAccess(sid, uid, "server.read")` — owner / ServerAccess w/ server.read / role server.read / admin(`*`,admin.write) / admin.read(read) / node+node.update. | OK | none behaviorally; pass `request.user` as `actor` for key-scope; long-term gate on `mod.read` |
| GET `/:sid/mod-manager/search` | mod-plugins.ts:134 | R | same as above (rate-limited) | OK | same |
| GET `/:sid/mod-manager/versions` | mod-plugins.ts:276 | R | same | OK | same |
| POST `/:sid/mod-manager/install` | mod-plugins.ts:341 | W | `ensureServerAccess(sid, uid, "file.write")` — file.write-class write (downloads remote URL into container via tunnel, :410; upserts InstalledMod, :427). `admin.read` correctly denied; but **no `actor` → any API key owned by an authorized user bypasses the key's own scope** (key scoped to server.read or ∅ installs mods). | **B-WRITE-LEAK (key-scope)** | pass `request.user` as 5th arg; introduce targeted `mod.write` (§3.1) |
| GET `/:sid/plugin-manager/game-versions` | mod-plugins.ts:495 | R | `ensureServerAccess(..., "server.read")` | OK | key-scope + `mod.read` |
| GET `/:sid/plugin-manager/search` | mod-plugins.ts:558 | R | same | OK | same |
| GET `/:sid/plugin-manager/versions` | mod-plugins.ts:680 | R | same | OK | same |
| POST `/:sid/plugin-manager/install` | mod-plugins.ts:744 | W | `ensureServerAccess(..., "file.write")` — remote jar written into plugins dir (:860), InstalledMod upsert (:871). Same key-scope bypass. | **B-WRITE-LEAK (key-scope)** | same as install above |
| GET `/:sid/mod-manager/installed` | mod-plugins.ts:933 | R | `server.read` — but performs a file-tunnel **directory listing** (:941); files.ts:115 requires `file.read` for the same operation, so `server.read`-only subusers enumerate mod filenames. | OK (note) | gate listing on `file.read`/`mod.read` for consistency |
| GET `/:sid/plugin-manager/installed` | mod-plugins.ts:982 | R | same pattern (:989) | OK (note) | same |
| POST `/:sid/mod-manager/uninstall` | mod-plugins.ts:1036 | W | `file.write`; deletes file via tunnel (:1047) + DB rows (:1051). Key-scope bypass. | **B-WRITE-LEAK (key-scope)** | actor arg + `mod.write` |
| POST `/:sid/plugin-manager/uninstall` | mod-plugins.ts:1101 | W | `file.write`; delete via tunnel (:1111). Key-scope bypass. | **B-WRITE-LEAK (key-scope)** | same |
| POST `/:sid/mod-manager/check-updates` | mod-plugins.ts:1158 | R (+persist) | gated on **`server.read`** but the handler **writes** InstalledMod rows (latestVersionId/hasUpdate, :1246-1254) — a persisting POST reachable by `admin.read` and any `server.read` subuser. | **B-WRITE-LEAK (LOW)** | treat as documented read-refresh, or gate on `mod.read` once introduced |
| POST `/:sid/plugin-manager/check-updates` | mod-plugins.ts:1275 | R (+persist) | same; writes :1353-1361 | **B-WRITE-LEAK (LOW)** | same |
| POST `/:sid/mod-manager/update` | mod-plugins.ts:1387 | W | `file.write`; deletes old file + installs new (:1461-1470), updates DB (:1474-1483). Key-scope bypass. | **B-WRITE-LEAK (key-scope)** | actor arg + `mod.write` |
| POST `/:sid/plugin-manager/update` | mod-plugins.ts:1528 | W | `file.write`; same pattern (:1590-1600) | **B-WRITE-LEAK (key-scope)** | same |

(Trailing dead comment "Download server file" mod-plugins.ts:1644-1645 — no endpoint.)

### 2.2 `routes/servers/invites.ts` (prefix `/api/servers`)

`canManageSubusers` (defined _helpers.ts:469-485): owner OR role-perms `*`/`admin.write` OR node-access+`node.update`. Deliberately excludes ServerAccess rows, scoped role grants, and `admin.read` — correct ownership-level semantics for minting. `canAccessServer` (_helpers.ts:1305-1348): owner / any ServerAccess row / `*`/admin.write / `admin.read` (extra check :1346) / any scoped server-perm grant / node+node.update.

| METHOD+PATH | Check (file:line) | R/W | Current logic | VERDICT | Proposed fix |
|---|---|---|---|---|---|
| GET `/:sid/permissions` | invites.ts:54 | R | `canAccessServer` — admin.read reaches; any subuser sees the full subuser list + each row's perms. | OK | key-scope enforcement for API keys (currently DB-only) |
| GET `/:sid/invites` | invites.ts:93 | R | `canAccessServer` — **any subuser with any ServerAccess row** (even server.read-only) receives the full invite rows *including the raw `token` field* (no `select`, invites.ts:97-102; token is a model column, schema.prisma:262). Exposing live invite tokens to non-manage paths. | **E-BROAD** | gate on `canManageSubusers` (or at minimum strip `token` from the listing) |
| POST `/:sid/invites` | invites.ts:133 | W | `canManageSubusers` (:133) — admin.write/`*` reach, admin.read denied (correct). Anti-escalation: inviter must hold every granted perm via `getEffectiveServerPermissions` (:159-172). Key-scope bypass (no `request.user` check). Permission strings **not validated** against ALL_SERVER_PERMISSIONS (:150-172). | **B-WRITE-LEAK (key-scope)** | enforce key scope; validate payload ⊆ ALL_SERVER_PERMISSIONS (reject `admin.*`, `*`, `node.*`) |
| POST `/:sid/invites/:inviteId/regenerate` | invites.ts:257 | W | `canManageSubusers`; mints a fresh token (:271-276). Key-scope bypass. | **B-WRITE-LEAK (key-scope)** | key-scope; keep manage-path gate |
| DELETE `/:sid/invites/:inviteId` | invites.ts:340 | W | `canManageSubusers`; cancels invite (:352-355). Key-scope bypass. | **B-WRITE-LEAK (key-scope)** | key-scope |
| POST `/invites/accept` | invites.ts:447 | W (self) | auth + token; invite must be pending/expiry-valid and **match the caller's email** (invites.ts:395-399); upserts ServerAccess (:401-417). Self-service by design. | OK | none |
| POST `/invites/register` | invites.ts:466-478 | W (self) | **unauthenticated by design** — token bearer + email-locked registration (`withRegistrationBypass`, :504-517); rate-limited 20/min (:468); rejects existing email/username (:497-502). | OK-UNAUTH | none (token is the bearer credential) |
| GET `/invites/:token` | invites.ts:581-588 | R | **unauthenticated by design** — token-gated preview leaking invitee email, server name, granted permissions (:609-617); rate-limited 60/min. | OK-UNAUTH | acceptable; consider hiding `permissions` detail pre-auth |
| POST `/:sid/access` | invites.ts:646 | W | `canManageSubusers` (:646) + grantable-perms check (:666-679); owner row protected (:650-651). Key-scope bypass; unvalidated strings. | **B-WRITE-LEAK (key-scope)** | key-scope; allowlist validation |
| DELETE `/:sid/access/:targetUserId` | invites.ts:726 | W | `canManageSubusers`; deletes ServerAccess + revokes SFTP tokens (:734-739). Key-scope bypass. | **B-WRITE-LEAK (key-scope)** | key-scope |

(Trailing dead comment "List server databases" invites.ts:759-760 — no endpoint.)

### 2.3 `routes/servers/cs2.ts` (prefix `/api/servers`)

All routes use the local `ensureAccess` wrapper (cs2.ts:177-180) which calls `ensureServerAccess(serverId, userId, perm, reply)` — **no `actor`**, same key-scope bypass as mod-plugins.

| METHOD+PATH | Check (file:line) | R/W | Current logic | VERDICT | Proposed fix |
|---|---|---|---|---|---|
| GET `/:sid/cs2/frameworks` | cs2.ts:204 | R | `server.read`; also probes filesystem via tunnel `list` (getInstalledFrameworks, :75-166). | OK | key-scope; `mod.read` |
| GET `/:sid/cs2/frameworks/:fid/releases` | cs2.ts:242 | R | `server.read`; fetches GitHub releases (public data). | OK | key-scope; `mod.read` |
| POST `/:sid/cs2/frameworks/:fid/install` | cs2.ts:280 | W | `file.write`; downloads archive into container, decompresses to `/game/csgo`, **patches `gameinfo.gi`** (installFrameworkArchive :528-583, ensureGameInfoPatch :587-631). Key-scope bypass. | **B-WRITE-LEAK (key-scope)** | actor arg; `mod.write` |
| POST `/:sid/cs2/frameworks/:fid/uninstall` | cs2.ts:384 | W | `file.write`; deletes framework dirs, reverts gameinfo patch (:389-423). Key-scope bypass. | **B-WRITE-LEAK (key-scope)** | same |
| GET `/:sid/cs2/plugins` | cs2.ts:461 | R | `server.read`; directory listing via tunnel (:467) — same file.read-consistency note as mod `installed`. | OK (note) | `file.read`/`mod.read` |
| POST `/:sid/cs2/plugins/uninstall` | cs2.ts:494 | W | `file.write`; deletes plugin path (:501-505). Key-scope bypass. | **B-WRITE-LEAK (key-scope)** | actor arg; `mod.write` |

### 2.4 `routes/tasks.ts` (prefix `/api/servers`, server.ts:1098)

`ensureSchedulePermission` (tasks.ts:20-85): owner → allow; else allow iff (ServerAccess row **containing** `server.schedule`, :79) OR `hasGrant(rolePerms, 'server.schedule')` (:65 — `*`/`admin.write`/`server.schedule` only; **admin.read never**, since `server.schedule` is not a read perm) OR node-access+`node.update` (:72). `ensureCommandPermission` (:86-112): owner OR ServerAccess w/ `console.write` OR `hasGrant(rolePerms,'console.write')` OR node+`node.update`.

| METHOD+PATH | Check (file:line) | R/W | Current logic | VERDICT | Proposed fix |
|---|---|---|---|---|---|
| POST `/:sid/tasks` | tasks.ts:144-150 (+152-158) | W | `ensureSchedulePermission`; `command` actions additionally require `console.write` (:152-158) — good. But `start`/`stop`/`restart`/`backup` actions need **no** matching permission: a `server.schedule`-only subuser can schedule power/backup ops they could never trigger directly. Key-scope bypass (never touches `request.user`). | **B-WRITE-LEAK (key-scope)** | key-scope; require `server.start`/`server.stop`/`backup.create` matching the action (§3.2) |
| GET `/:sid/tasks` | tasks.ts:223-229 | R | **`ensureSchedulePermission` on a read** — listing tasks requires write-level `server.schedule`; `admin.read` (and `server.read` subusers) get 403. Violates target contract item 1 ("task listings"). | **A-READ-GAP** | gate reads on `server.read` (admin.read then passes via `isReadPermission`); keep `server.schedule` for writes |
| GET `/:sid/tasks/:taskId` | tasks.ts:248-254 | R | same write-level gate on a read | **A-READ-GAP** | same |
| PUT `/:sid/tasks/:taskId` | tasks.ts:287-293 (+294-300) | W | `ensureSchedulePermission` (+console.write for command). Update correctly scoped to `{id, serverId}` (IDOR fix, :338-341). Key-scope bypass. | **B-WRITE-LEAK (key-scope)** | key-scope; action-matching perms |
| DELETE `/:sid/tasks/:taskId` | tasks.ts:399-405 | W | `ensureSchedulePermission`; delete scoped `{id, serverId}` (:408-410). Key-scope bypass. | **B-WRITE-LEAK (key-scope)** | key-scope |
| POST `/:sid/tasks/:taskId/execute` | tasks.ts:453-459 (+472-478) | W | `ensureSchedulePermission` (+console.write for command). Immediate execution — a `server.schedule`-only subuser executes stop/restart/backup tasks without those permissions. Key-scope bypass. | **B-WRITE-LEAK (key-scope)** | key-scope; action-matching perms |

### 2.5 `routes/metrics.ts` (prefix `/api`, server.ts:1089)

| METHOD+PATH | Check (file:line) | R/W | Current logic | VERDICT | Proposed fix |
|---|---|---|---|---|---|
| GET `/servers/:sid/metrics` | metrics.ts:83-90 | R | inline: owner OR ServerAccess row containing `server.read` OR **exact** `rolePerms.includes("server.read")` OR (hasNodeAccess && (`node.update`‖`*`)). **`admin.read` fails** (no server.read string, hasNodeAccess=false — isAdminUser(requireWrite) at permissions.ts:648 rejects admin.read). **Bare `admin.write` also fails**: hasNodeAccess=true but the pairing (:80-82) demands `node.update` or `*` in rolePerms, which admin.write-only roles lack. Only `*` (or roles additionally holding server.read/node.update) pass. Violates contract items 1 *and* 2. | **A-READ-GAP** | replace `rolePerms.includes("server.read")` with `hasGrant(rolePerms, "server.read")` (covers admin.read + admin.write + `*`); or reuse `ensureServerAccess(sid, uid, "server.read", reply, request.user)` |
| GET `/servers/:sid/stats` | metrics.ts:349-356 | R | identical inline logic (:341-353, node pairing :346-348) | **A-READ-GAP** | same fix |
| GET `/nodes/:nodeId/metrics` | metrics.ts:405-412 | R | `request.user.permissions` includes `*`‖`admin.write`‖`admin.read` — admin.read and admin.write both reach (contract OK; key scope naturally enforced since it reads the key's perms). But the targeted catalog perm `node.view_stats` ("View node statistics", permissions-catalog.ts:57) is **unused** — roles like the shipped Support/Moderator presets (permissions.ts:587-601, 557-579 include node.view_stats) are denied node metrics; route falls back to admin bits. | OK (E note) | allow `node.view_stats` (or node.read) in addition to admin bits |

## 3. Vocabulary findings

### 3.1 Mod/plugin manager — no permission of its own (E/D-family)

Today: reads (search/versions/game-versions/installed/check-updates) ride `server.read`; writes (install/uninstall/update, incl. all cs2 framework routes) ride `file.write`. Consequences:

- `file.write` is over-broad as the mod gate: it grants *arbitrary* file writes; conversely there is no way to grant "manage mods" without granting the whole file tree. A subuser with only `file.write` (or the shipped `power`/`full` presets, _helpers.ts:30-81) can install arbitrary provider-hosted jars into the container — functionally a remote-file-write primitive.
- Read listings ride `server.read` while the equivalent files route requires `file.read` (files.ts:115) — inconsistent enumeration gate.
- No catalog entry exists, so roles cannot express mod-management at all; API-key scopes likewise.

**Proposed family** (add to `PERMISSION_CATEGORIES` permissions-catalog.ts + `ALL_SERVER_PERMISSIONS` :238-247, so subuser grants, role wizard and API-key scopes pick it up automatically):

| Permission | Capability | Endpoints |
|---|---|---|
| `mod.read` | browse providers, versions, game-version tags; list installed mods/plugins/frameworks; check updates (read+bookkeeping) | all GETs in mod-plugins.ts + cs2.ts; `*/check-updates` |
| `mod.write` | install, update, uninstall mods/plugins/CS2 frameworks (writes mod dirs + gameinfo patches) | all mod-manager/plugin-manager/cs2 POSTs except check-updates |

Naming `mod.write` (single write bit) rather than mod.install/mod.uninstall: install and uninstall are the same trust decision (changing the mod set = changing what code the server loads); splitting them buys no practical scoping and doubles grant surface. `mod.read` ends with `.read`, so `isReadPermission` (permissions.ts:130-136) covers `admin.read` automatically, and `hasGrant` covers `admin.write`/`*`. Migration: accept `file.write` OR `mod.write` during a deprecation window (`checkAnyPerm`), then tighten.

### 3.2 Scheduled tasks — `server.schedule` is both too narrow (reads) and too broad (actions)

- **Too narrow:** the two GET routes use the write check (tasks.ts:223-229, 248-254), so `admin.read` and `server.read` subusers cannot list tasks — the only listing in the panel that behaves this way. Fix: reads gated on `server.read`; writes stay on `server.schedule`.
- **Too broad:** `server.schedule` subsumes power and backup actions — creating/executing a `start`/`stop`/`restart`/`backup` task requires no `server.start`/`server.stop`/`backup.create` (only `command` gets the extra `console.write` check, tasks.ts:152-158, 294-300, 472-478). A schedule-only subuser can stop any server at 3 a.m. Fix: validate the action's matching permission on create/update/execute, mirroring the existing command gate. No new permission string needed — the targeted ones already exist in the catalog.

### 3.3 Subuser/invite management — no targeted permission (optional)

`canManageSubusers` (owner | `*`/admin.write | node+node.update) is deliberate ownership-level design (_helpers.ts:461-468). If delegation is wanted, add **`server.subusers`** to `ALL_SERVER_PERMISSIONS`: capability = create/regenerate/cancel invites, grant/edit/remove ServerAccess (the five manage-path routes in invites.ts); the existing grantable-subset anti-escalation (invites.ts:159-172, 666-679) already bounds what it can grant. It is a write (not `.read`), so `admin.read` stays out — correct. Until then, the interim key-scope fix for these routes is requiring API keys to hold `admin.write` via `enforceKeyScope`.

### 3.4 Node metrics — targeted perm unused

`node.view_stats` exists (permissions-catalog.ts:57) and is even in the shipped Support/Moderator presets, but `GET /api/nodes/:id/metrics` requires raw admin bits (metrics.ts:405-412). This is the "route falls back to admin-level grants" anti-pattern. Fix: `hasAnyPermission(request, ['node.view_stats', 'node.read']) || admin` (admin bits remain as fallback).

### 3.5 Hardening / catalog hygiene

- **Unvalidated permission payloads:** invite create and access grant accept arbitrary strings (invites.ts:150-172, 659-685) — e.g. `admin.write`, `node.update`, `*` can be stuffed into ServerAccess rows; `getEffectiveServerPermissions` returns them verbatim (_helpers.ts:1427-1434) into consumers. Validate ⊆ ALL_SERVER_PERMISSIONS and reject `admin.*`/`*`/`node.*`.
- **Token exposure in listings:** `GET /:sid/invites` returns the raw `token` column (invites.ts:97-102; schema.prisma:262) to any subuser — tokens are bearer credentials for accepting the invite.
- **Dual catalog drift:** `lib/permissions.ts:432` exports a *second* `PERMISSION_CATEGORIES` missing `server.update`, `server.install`, `server.reinstall`, `server.rebuild`, `backup.download`, `apikey.manage` (vs. permissions-catalog.ts:18-169) and `PERMISSION_PRESETS` (permissions.ts:551-602) whose moderator preset lacks those same perms. Delete the duplicate or derive it from the canonical catalog.
- Adjacent (out-of-scope but hinted): `GET /api/providers/status` (provider-keys.ts:14-29) is auth-only by documented design (booleans only) — acceptable OK-UNAUTH-ish; no change required.

## 4. Fix list (priority order)

**P0 — target-contract violations**
1. `metrics.ts:83-90` and `:349-356` — swap `rolePerms.includes("server.read")` → `hasGrant(rolePerms, "server.read")` (and keep/derive the node-manage pairing); restores admin.read AND bare admin.write on `/servers/:id/metrics` + `/stats`. Alternatively call `ensureServerAccess(sid, uid, "server.read", reply, request.user)`.
2. `tasks.ts:223-229, 248-254` — gate the two GET task routes on `server.read` (via a read variant of the helper or `ensureServerAccess`), not `ensureSchedulePermission`; keeps writes on `server.schedule`.

**P1 — API-key scope bypass (systemic, 18 endpoints)**
3. `mod-plugins.ts` (all 16 call sites: :64, :134, :276, :341, :495, :558, :680, :744, :933, :982, :1036, :1101, :1158, :1275, :1387, :1528) and `cs2.ts` wrapper `:177-180` — pass `request.user` as the `actor` argument (mirrors files.ts:115, metrics-stream.ts:55).
4. `tasks.ts` — thread `request.user` into `ensureSchedulePermission`/`ensureCommandPermission` and run `enforceKeyScope(request.user, 'server.schedule' | 'console.write')`.
5. `invites.ts` — enforce key scope on the five manage-path writes (interim: `enforceKeyScope(request.user, 'admin.write')`; clean: the new `server.subusers` permission).

**P2 — breadth and hygiene**
6. `invites.ts:93-102` — gate the invite listing on `canManageSubusers` and/or strip `token` from the response payload.
7. `tasks.ts:144-158, 287-300, 453-478` — require the action-matching permission (`server.start`/`server.stop`/`backup.create`) on create/update/execute, like the existing `console.write` gate.
8. `metrics.ts:405-412` — accept `node.view_stats`/`node.read` in addition to admin bits for node metrics.
9. Introduce the `mod.read`/`mod.write` family (§3.1): catalog + `ALL_SERVER_PERMISSIONS` + route gates (with a `file.write`-acceptance window); re-gate the mod/cs2 listings off `server.read`.
10. `invites.ts:150-172, 659-685` — validate permission payloads against `ALL_SERVER_PERMISSIONS` (reject `admin.*`, `*`, `node.*`).
11. Decide on `check-updates` (mod-plugins.ts:1158, :1275): document as read-refresh (read verdict OK) or move to `mod.read`.
12. Deduplicate `PERMISSION_CATEGORIES` (lib/permissions.ts:432-546) against the canonical permissions-catalog.ts.
