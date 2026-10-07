# Permission Model Core Audit (audit-admin-system, assignment 2)

Scope: the enforcement engine + vocabulary. Files: `lib/permissions.ts`, `lib/permissions-catalog.ts`, `lib/server-access.ts`, `routes/servers/_helpers.ts`, `middleware/rbac.ts`, `middleware/auth.ts`, `shared-types.ts`, `lib/validation.ts`, `services/api-key-service.ts`, plus call-site sweeps across `routes/`, `websocket/gateway.ts`, `server.ts`, tests, and `scripts/diagnose-admin-rbac.mjs`. Companion deliverable: `TARGET-VOCABULARY-PROPOSAL.md`. Route-by-route endpoint verdicts live in `admin-system.md` (mine) and the other auditors' files.

## 1. Executive summary

- The core grant semantics are **correct and contract-faithful**: `hasGrant` (permissions.ts:143-149) makes `*` grant everything, `admin.write` satisfy any concrete permission, and `admin.read` satisfy read permissions via `isReadPermission` (permissions.ts:130-136). RBAC middleware (rbac.ts:25-30, 57-61) goes through `permissionMatches` (permissions.ts:160-206), which honors the same implications, including refusing resource-scoped admin bits (permissions.ts:174-177).
- The engine's real problems are **at the edges, not the core**: (1) `getUserAccessibleNodes`/`hasNodeAccess` require *write-level* admin (permissions.ts:648, 781), silently excluding `admin.read` from every visibility decision built on it; (2) the server-access contract is **re-implemented 8+ times** with diverging branches; (3) `isReadPermission` is suffix-sniffing, so any future read permission not named `*.read` breaks `admin.read` invisibly.
- **API-key scope enforcement (`enforceKeyScope`) exists and is correct** (_helpers.ts:487-493) but is applied inconsistently: `mod-plugins.ts` (17 call sites) and `cs2.ts` never pass the actor; `backups.ts`, `alerts.ts`, the SFTP endpoints, and all `canAccessServer` consumers have no key-scope at all.
- **Dual-catalog drift confirmed**: `lib/permissions.ts:432-602` exports a stale `PERMISSION_CATEGORIES`/`PERMISSION_PRESETS` missing `server.update/install/reinstall/rebuild/suspend` + `backup.download`; only its own test consumes it. The `shared-types.ts` `Permission` enum (44-115) matches the canonical catalog today but is a third hand-maintained copy.
- **No permission is validated against the catalog at creation time** for global roles or API keys — only format (validation.ts:229-233, which even advertises a non-existent `file.sftp`) and raw-`includes` escalation guards (roles.ts:365, 499; api-keys.ts:85-87).
- Mechanical cross-check: **0 enforced-but-uncataloged and 0 cataloged-but-never-enforced** permission strings in the role namespace; the plugin system has a *separate* permission namespace with colliding names (`admin.read`, `server.read`, … — plugins/safety.ts:60-120), which is a documentation hazard, not an RBAC bug.

## 2. Engine findings

### 2.1 hasGrant / permissionMatches / isReadPermission — core

- `hasGrant` (permissions.ts:143-149) and `permissionMatches` (permissions.ts:160-206) implement the owner's contract exactly; `permissionMatches` additionally honors scoped grants (`node.delete:node_1`) and correctly refuses to widen resource-scoped admin bits (`admin.read:node1` grants nothing — permissions.ts:174-177). Tests pin this matrix (server-access.test.ts:297-330).
- **isReadPermission is shape-dependent** (permissions.ts:130-136): `endsWith('.read')` plus exactly two exceptions (`node.view_stats`, `backup.download`). It works for today's vocabulary, but:
  - any new read permission not ending in `.read` (e.g. `diagnostics.download`, `file.sftp`, `server.metrics`) silently becomes a *write* for `admin.read` purposes;
  - the same predicate is **duplicated locally** in `getEffectiveServerPermissions` (_helpers.ts:1421-1424) as `p.endsWith('.read') || p === 'backup.download'` — it happens to agree only because `node.view_stats` is not in `ALL_SERVER_PERMISSIONS`.
  - Recommendation: a declarative READ permission set in the catalog (single source), consumed by `isReadPermission`, `getEffectiveServerPermissions`, and the vocabulary doc. See proposal §3.
- `isAdmin` (permissions-catalog.ts:208-211) treats `admin.read` as "admin" — used by api-keys.ts:47 to let read-admins list keys; fine, but note it means `admin.read` holders pass `isAdmin()` gates.

### 2.2 isAdminUser / hasNodeAccess / getUserAccessibleNodes — the admin-visibility split

- `isAdminUser(prisma, userId, requireWrite=false)` (permissions.ts:359-401) checks only permission bits. **Docstring drift**: permissions.ts:348-358 claims "A role named 'Administrator' (case-insensitive)" grants admin; the code (376-397) implements no name check. `_helpers.ts:1283-1296` has an uncached twin that explicitly documents "permission bits only — never role names" — two implementations, one lying doc.
- **`hasNodeAccess` (permissions.ts:638-652) and `getUserAccessibleNodes` (permissions.ts:773-790) hard-code `isAdminUser(prisma, userId, true)` — write-level admin.** Consequences (the systemic root of several A-READ-GAPs):
  - `admin.read` users are NOT "wildcard" for node visibility → their `GET /api/servers` list (core.ts:1582-1591, built from `accessibleNodeIds`) contains only owned/subuser/assigned servers, and the dashboard `/stats` global server count falls back to the same scoped set (dashboard.ts:56-78 — the A-READ-GAP I confirmed in admin-system.md).
  - `admin.write`/`*` users DO get wildcard (isAdminUser requireWrite=true) — so the engine treats read-admins as non-admins everywhere visibility is computed, while treating them as admins wherever `checkIsAdmin(request,'admin.read')` is used (_helpers.ts:1264-1267). Two different admin definitions.
  - Fix: add a `requireWrite`/read-mode parameter to both functions (or an explicit admin-read wildcard), then verify consumers (dashboard.ts:65, core.ts list, sse-events.ts:225, console-stream.ts:74-76, gateway.ts:3590-3592).
- Legacy identity drift: the `user.role` column is not synced with RBAC (server.ts:1471-1474; scripts/diagnose-admin-rbac.mjs:19-25 documents the failure mode: a better-auth admin with no Role rows resolves to `[]` and 403s everywhere). Ops footgun, worth a doc/health check.

### 2.3 decideServerAccess — branch-by-branch (server-access.ts:33-68)

| Branch | Behavior | Assessment |
|---|---|---|
| owner (42-44) | always allowed | OK |
| server_access (45-47) | row *containing the permission* — as threaded by `ensureServerAccess` (permissions `has: permission`, _helpers.ts:517-524) | OK when threaded; **callers that pass row-existence instead over-grant** — core.ts:2278-2280 (storage resize: ANY ServerAccess row, even `console.read`-only, grants disk resize) and canAccessServer (_helpers.ts:1313-1317, visibility-only by design) |
| admin (48-50) | `*`/`admin.write` | OK |
| admin_read (53-59) | **requires `requiredPermission` AND `isReadPermission(requiredPermission)`** | The trap: read callers that omit `requiredPermission` silently deny `admin.read`. Omitters: canManageSubusers (by design, _helpers.ts:477-483 — ownership-level), core.ts:2285-2288 (resize — a write, correct outcome), stats.ts/network.ts/invites.ts (via canAccessServer which compensates at _helpers.ts:1346) |
| role_permission (60-62) | raw `includes(requiredPermission)` | OK for unscoped grants; a role storing a **scope-suffixed** string (`server.start:xyz`) is silently inert here (only `hasPermission`/`permissionMatches` paths honor scopes) — edge case, see §5 |
| node_manage (64-66) | node assignment + `node.update` → full manage | Deliberate but **over-broad pairing**: `node.update` is "edit node config", yet assignment+`node.update` yields ALL_SERVER_PERMISSIONS on that node's servers (getEffectiveServerPermissions _helpers.ts:1404-1409), including delete/backup exfiltration. Proposal: split `node.server_manage`. Consumers are inconsistent about even having this branch (§3) |

`isFullAdminRole`/`canManageViaNode` (server-access.ts:71-81) mirror branches 3/6 — fine.

### 2.4 Scoped-permission semantics (edge cases)

- Parse/validate: `parseScopedPermission` (permissions.ts:99-110) splits at the first colon; multi-colon resource ids survive (rbac.test.ts:45).
- Honored in: `hasPermission`/`hasAnyPermission`/`hasAllPermissions` (permissions.ts:217-298) and therefore rbac middleware + `enforceKeyScope` (hasGrant is scope-blind — a granted `file.write:server_1` does NOT satisfy hasGrant `file.write`; _helpers.ts:492 — keys with scoped strings effectively hold nothing for hasGrant checks. Note for API-key minting: scoped strings in keys are legal per validation.ts:226-227 but only useful on rbac-resource routes).
- NOT honored in: `decideServerAccess` (raw includes, server-access.ts:60), `resolveServerPermissions` merge (permissions-catalog.ts:334-343 — merges verbatim), escalation guards (raw includes), prisma `permissions: { has: p }` filters. So scope-suffixed values in `Role.permissions` are dead weight on all server routes. Either reject them at role-creation or make decideServerAccess scope-aware; today's split behavior is undocumented.

## 3. Helper drift matrix — the same contract implemented 8 times

The decideServerAccess contract (owner | row-perm | admin | admin_read | role_permission | node_manage, × API-key scope) exists as:

| # | Implementation | admin.read | admin.write | node_manage | role perm | API-key scope |
|---|---|---|---|---|---|---|
| 1 | `ensureServerAccess` (_helpers.ts:495-558) | ✓ (threads perm) | ✓ | ✓ | ✓ | ✓ (553) |
| 2 | `ensureDatabasePermission` (_helpers.ts:1446-1515) | **✗** (1502-1512: only `*`/`admin.write`/exact) | ✓ | **✗** | ✓ | ✓ |
| 3 | alerts-local `ensureServerAccess` (alerts.ts:24-76) | ✓ (via route-level `isAdmin` param, alerts.ts:209 etc.; writes pass 'admin.write', alerts.ts:84) | ✓ | ✓ (68-73) | ✓ (hasSome, 52) | **✗** |
| 4 | `ensureBackupAccess` (backups.ts:43-96) | ✓ (hasGrant on role perms, 78-83) | ✓ | ✓ (88-90) | ✓ (83) | **✗** |
| 5 | `canAccessServer` (_helpers.ts:1305-1348) | ✓ (1346) | n/a (visibility) | ✓ (via decideServerAccess) | ✓ (hasScopedGrant 1330-1333) | **✗** (no actor concept) |
| 6 | SFTP connection-info/rotate (server.ts:1511-1618, 1621-1690) | ✓ (decideServerAccess with `requiredPermission:'server.read'`, 1559-1565) | ✓ | ✓ | ✓ | **✗** |
| 7 | Agent SFTP validate (server.ts:1440-1505) | **✗** — permissions = `['*']` for `*`/`admin.write` (1483-1488) else **ServerAccess-row perms only**; admin.read users and role-granted `file.read` holders get an EMPTY permission set for their SFTP session | (as `['*']`) | **✗** (role perms ignored) | ✗ (rows only) | n/a (token system) |
| 8 | per-file inline gates: metrics.ts:73-90, console-stream.ts:61-81, network.ts:134-150, admin-ops.ts:389-410, core.ts:1878-1893, tasks.ts:65-107, variables.ts:33-40 | metrics: **✗ admin.read**; console-stream: ✓ (checkIsAdmin 'admin.read', 64); others: write routes, admin.write via checkIsAdmin ✓ | ✓ | ✓ (node.update pairing) | ✓ | mostly ✗ (metrics/console-stream decide from DB only) |

Specific bugs this drift produces:

1. **`ensureDatabasePermission` denies `admin.read` database reads** (GET /api/servers/:id/databases → 403 for a read-everything admin; _helpers.ts:1502-1512) — A-READ-GAP, violates contract item 1.
2. **metrics.ts:83-87 has no admin.read branch**: `canReadMetrics = owner || row server.read || role server.read || nodeManage`. admin.read users get 403 on per-server metrics. (A fleet-level route does accept admin.read — metrics.ts:408-409 — so the file itself is inconsistent.) A-READ-GAP.
3. **core.ts storage resize accepts ANY ServerAccess row** (2278-2288) — a `console.read`-only subuser can resize a server's disk. Over-grant (write reachable with less than the intended grant).
4. **Agent SFTP validation ignores role-granted permissions entirely** (server.ts:1486-1488): a global role with `file.read` (valid on every HTTP file route via decideServerAccess role_permission) gets an empty SFTP session — and admin.read users likewise. The HTTP↔SFTP contracts disagree.
5. **Server list `effectivePermissions` mapping omits the admin.read subset**: core.ts:1668-1679 (rows: admin.write/'*' → full, node.manage → full, row+grants, grants, else []) vs `getEffectiveServerPermissions` (_helpers.ts:1421-1425) which adds the read subset. Same API surface, two answers.

### 3.1 API-key scope enforcement — pattern analysis (lead's question)

The correct pattern exists and is unit-tested: `enforceKeyScope(actor, permission)` (_helpers.ts:487-493; authz-fixes.test.ts:90-94) — session actors pass; API-key actors must additionally hold the permission in the **key's** set. Correct call sites pass `request.user` as actor: files.ts (`requireFileAccess` → ensureServerAccess, files.ts:82), power.ts:483, metrics-stream.ts:55, admin-ops.ts:66/114/218, core.ts:1827, `ensureDatabasePermission` (databases.ts:48-108), plus two inline variants: admin.ts:1594 (servers actions) and nodes.ts:783-784 (`apiKeyPerms.includes(...)`).

**Missing enforcement** (API keys minted with narrow scopes act with the user's full DB-role powers):
- `mod-plugins.ts` — all 17 `ensureServerAccess(...)` calls omit the actor argument (e.g. mod-plugins.ts:64, 341, 1036, 1528);
- `cs2.ts:179` — `ensureServerAccess(serverId, userId, perm, reply)` no actor;
- `backups.ts` (`ensureBackupAccess` has no actor param at all — the known bug; backups.ts:43-96);
- `alerts.ts` (local helper, no key-scope; alerts.ts:24-76);
- SFTP endpoints (server.ts:1511-1690) — decideServerAccess without actor;
- all `canAccessServer` consumers: stats.ts:29/129, network.ts:57, core.ts:908/1014/1322 (clone paths), invites.ts:54/93 — plus core.ts:2249 resize (also §3 item 3).

**Systematic fix**: make `actor` a required parameter of `ensureServerAccess`/`ensureDatabasePermission`; delete the hand-rolled helpers (alerts.ts:24-76, backups.ts:43-96) in favor of it; add an actor parameter to `canAccessServer`; convert `mod-plugins.ts`/`cs2.ts` call sites. One contract, one implementation, key scope always applied.

### 3.2 API-key minting & validation (api-key-service.ts, api-keys.ts)

- A key CAN hold `*` or `admin.write` — by design, containment is: creation-time subset check (api-keys.ts:82-96, raw `includes`; wildcard creators bypass it entirely at 84-86) plus **live** request-time revalidation (server.ts:483-508: allPermissions keys inherit live user perms; scoped keys 403 as soon as any key perm leaves the user's live set). The service docstring's "snapshot at creation time" (api-key-service.ts:9-11) is wrong — it's live. Doc drift only.
- **No catalog membership validation anywhere on this path**: `createApiKeySchema.permissions` is `z.array(z.string())` (api-keys.ts:15); a `*` creator can mint keys carrying arbitrary unknown strings (`foo.bar`, `file.sftp`) which then satisfy nothing but pollute the vocabulary and the audit log.
- The escalation guard is raw `includes` (api-keys.ts:85-87): an `admin.write`-only creator cannot mint a scoped key with any concrete permission (they can only make allPermissions keys); an `admin.read` creator cannot mint a `server.read` key. Creation-side contract gaps — hasGrant semantics would fix both.

## 4. Vocabulary & catalog drift

### 4.1 Dual catalog

- Canonical: `PERMISSION_CATEGORIES`/`ALL_PERMISSIONS` (permissions-catalog.ts:18-174) — 59 values incl. `*`.
- **Stale duplicate**: `PERMISSION_CATEGORIES` (permissions.ts:432-546, object form) missing `server.update`, `server.install`, `server.reinstall`, `server.rebuild`, `server.suspend`, `backup.download`; `PERMISSION_PRESETS` (permissions.ts:551-602) moderator preset likewise stale. Consumers: **only** rbac.test.ts:494/512/530 (production uses the canonical: api-keys.ts:5, roles.ts presets at 1048 use `PERMISSION_PRESETS` — from permissions.ts? roles.ts:14 imports `PERMISSION_PRESETS` from… the grep showed roles.ts:14 in the import block of lib/permissions — so the STALE presets feed the role-wizard preset listing (roles.ts:1048). Correction: the stale `PERMISSION_PRESETS` IS production-consumed via roles.ts:14/1048; only the stale `PERMISSION_CATEGORIES` object is test-only.)
- Consequence: the role wizard's preset list (GET /api/roles/presets) offers a moderator bundle that cannot express install/reinstall/rebuild/update/suspend or backup.download.
- `shared-types.ts` `Permission` enum (44-115): 58 concrete values, matches canonical exactly (no `*`). Third copy, runtime-unchecked; typed sites (shared-types.ts:347) are cosmetic.
- **Name collision with the plugin namespace**: plugins/safety.ts:60-120 declares plugin capabilities including `admin.read`, `admin.write`, `server.read`, `server.write`, `user.read`, `user.write` (plus `routes.public`, `plugin.rpc`, `auth.sessions`, `auth.users`, `roles.assign`). These are per-plugin grants (loader/route-table/context), NOT role permissions — but identical strings with different meanings. Document or prefix future plugin caps.

### 4.2 Mechanical cross-check (all of catalyst-backend/src, check contexts only)

- **Enforced-but-uncataloged (role namespace): none.** `file.sftp` appears only as a regex comment example (validation.ts:227). `routes.public` etc. are plugin-namespace (plugins/context.ts:771, route-table.ts:160).
- **Cataloged-but-never-enforced: none.** Every concrete value appears in a live check context (spot map: server.* → power.ts:193/290/387/555/712/913, core.ts, admin-ops.ts, network.ts, tasks.ts; node.view_stats/manage_allocation/assign → nodes.ts:1140/1587-1909; location.* → locations.ts:30-210; template.* → templates.ts:111-450, nests.ts:30-192; user.* → admin.ts canManageUsers:84-88; role.* → roles.ts:223-1044; backup.* → backups.ts:106-539; file.* → files.ts:115-777; console.* → console-stream.ts:62-198, gateway.ts:3597-5460; database.* → databases.ts:21-399, _helpers.ts:1446-1515; alert.* → alerts.ts:153-627; apikey.manage → api-keys.ts:37/47).
- **Reverse gap — capabilities with NO dedicated permission** (gated by reuse or admin bits): clone (`server.create` + canAccessServer, core.ts:897/1000/1314), force-kill (`server.stop`, power.ts:1048), EULA (`server.start`, power.ts:483 — documented reuse), storage resize (any ServerAccess row, core.ts:2278), mod/plugin manager (`server.read`/`file.write`, mod-plugins.ts:64-1528), migration (`admin.write`, migration.ts:38), panel update (`admin.write`, update.ts:42-212), diagnostics (`admin.read`, admin.ts:2593), SFTP channel (`server.read`, server.ts:1559-1565), panel settings (admin bits, admin.ts), database-hosts admin (admin bits, admin.ts:3578+). → these drive the proposal file.

### 4.3 Validation gaps (where unknown strings get in)

- `permissionSchema` (validation.ts:229-233): format-only; `roleCreateSchema` (validation.ts:238-245) uses it — so role create accepts unknown strings; `roleCreateSchema` is not even the gate used by routes/roles.ts (which hand-rolls checks at roles.ts:352-373/489-510 with the raw-includes escalation guard and no membership check).
- The ONLY membership validation in the codebase is for role-wizard **scoped grants** (roles.ts:110-118, against `ALL_SERVER_PERMISSIONS`).
- API keys: no format, no membership (api-keys.ts:15, 82-96).
- Recommendation: one `isValidPermission(value)` (catalog + `*` + explicit allow-list for scoped forms), applied in all four grant-creation paths (roles global, roles scoped, API keys, ServerAccess invite permissions), plus hasGrant-based escalation guards.

## 5. Test & tooling staleness

- `rbac-api.test.ts` — the "route protection" table (~30 routes, 167-279+) **tests permission resolution, not routes**: it calls `hasPermission(prisma, userId, route.permission)` and never issues HTTP requests. Stale rows: `/api/admin/stats` listed as `admin.read` (actual: 8-perm OR, admin.ts:153-156), `POST /api/servers` listed as `admin.write` (actual: `server.create`, core.ts:339). Coverage ≈30 of ~296 endpoints; the table is aspirational documentation.
- `server-access.test.ts` — the best contract coverage: decideServerAccess admin_read (241-265), hasGrant matrix incl. admin.write→apikey.manage and admin.read→backup.download/node.view_stats (297-330). Pins exactly the core this audit validated.
- `authz-fixes.test.ts:84-94` — unit-tests `enforceKeyScope` and `checkAnyPerm` semantics, but nothing asserts that routes actually pass the actor (the mod-plugins/alerts/backups gaps are untested).
- `power-access-rbac.test.ts` / `alerts-access-rbac.test.ts` / `gateway-ws-authz.test.ts` / `security-wave2-regression.test.ts` (60-261) — good targeted coverage of node_manage, bare-node denial, WS subscribe authz; wave2 even pins source text (`rolePerms.includes("node.update")`, security-wave2-regression.test.ts:261) — those pins will need updating when the helper is centralized.
- `scoped-permissions.test.ts` (5-54) — mergeServerPermissions + catalog integrity (ALL_SERVER_PERMISSIONS has no dupes/unknowns).
- `rbac.test.ts:492-539` — asserts the STALE duplicate's shape (imports from `../lib/permissions`, 494/512), i.e. tests bless the drift.
- Missing coverage: admin.read visibility for server list/dashboard/metrics; ensureDatabasePermission admin.read; SFTP session perms for role-granted file.read; API-key scope on mod-plugins/backups/alerts.
- `scripts/diagnose-admin-rbac.mjs` — accurate mirror of the resolution path; documents the legacy-column/role-row split (19-25). Keep; extend with an admin.read variant once visibility is fixed.

## 6. Fix list (priority)

1. **Unify server AuthZ**: make `actor` required on `ensureServerAccess`/`ensureDatabasePermission`; port alerts.ts:24-76 and backups.ts:43-96 onto it; add actor to `canAccessServer`; fix mod-plugins.ts (17 sites) and cs2.ts:179 to pass `request.user`. (Fixes the API-key scope class of bugs systematically.)
2. **Read-admin visibility**: add read-mode to `isAdminUser`/`getUserAccessibleNodes`/`hasNodeAccess` (permissions.ts:648, 781) and include `admin.read` in dashboard.ts:50 (see admin-system.md) and core.ts list admin branch (1640) + adminReadSubset mapping (1668-1679 → reuse getEffectiveServerPermissions).
3. **`ensureDatabasePermission`**: add the admin_read branch (and node_manage for parity) — _helpers.ts:1502-1512.
4. **metrics.ts:83-87**: accept `admin.read` (hasGrant or explicit).
5. **core.ts:2278-2288 (storage resize)**: require `server.update` (or new `server.storage`) in the ServerAccess row; thread requiredPermission; enforce key scope.
6. **SFTP validation** (server.ts:1486-1488): derive session perms from role-granted file.read/file.write too (resolveServerPermissions), and give admin.read users the file-read subset.
7. **Catalog membership validation** at all grant-creation paths + hasGrant-based escalation guards (roles.ts:365/499, api-keys.ts:85, roles.ts:128).
8. **Delete the stale duplicate** PERMISSION_CATEGORIES/PERMISSION_PRESETS (permissions.ts:432-602); re-point roles.ts:14/1048 presets to a canonical preset list; migrate rbac.test.ts:492-539 to the canonical catalog.
9. Fix docstring drifts (permissions.ts:348-358, api-key-service.ts:8-12) and the network.ts:108-114 stale comment claiming `server.update` is ungrantable (it is cataloged, permissions-catalog.ts:42).
10. Convert `isReadPermission` to a declarative set (see proposal) and deduplicate the local copy at _helpers.ts:1421-1424.
