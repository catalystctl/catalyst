# Target Permission Vocabulary Proposal (audit-admin-system)

Companion to `core-model.md`. Owner's contract (unchanged): `admin.read` = READ over the entire panel and every server; `admin.write` = READ+WRITE over the entire panel and every server; `*` = superadmin wildcard; every other permission narrowly scoped and targeted. All citations are file:line in `catalyst-backend/src`.

## 1. Design rules

1. `admin.read`, `admin.write`, `*` keep their exact current semantics (`hasGrant`, permissions.ts:143-149) — no redefinition, no `settings.read`/`settings.write` duplicates of the admin bits.
2. Every non-admin permission targets one capability. Where one value currently spans unrelated capabilities, split it (§3). Where a route surface has no value, add one (§4).
3. **Naming: every read permission ends in `.read`.** `isReadPermission` (permissions.ts:130-136) is suffix-based today; instead of more exceptions, the new vocabulary declares a single explicit read-set (§5) and every future read perm must match the convention.
4. Panel-infrastructure surfaces (SMTP, security, theme, OIDC, MCP, localization, env, db-status, health, update reads, migration reads, diagnostics) stay on `admin.read`/`admin.write` — they are what the admin bits mean. Targeted perms exist only where a *delegation persona* exists (node operator, subuser, support).
5. Scoped forms (`perm:resourceId`) remain legal for rbac-routed resources (permissions.ts:99-110) but are rejected in Role.permissions global lists until decideServerAccess is scope-aware (core-model §2.4).

## 2. Unchanged core

| value | R/W | capability | checked by |
|---|---|---|---|
| `*` | all | Superadmin wildcard | hasGrant (permissions.ts:144) |
| `admin.read` | read | READ the entire panel + every server | hasGrant/isReadPermission (permissions.ts:130-149); admin routes, dashboard, SSE/WS admin channels (gateway.ts:1450) |
| `admin.write` | read+write | WRITE (and read) the entire panel + every server | hasGrant (permissions.ts:146) |

## 3. Splits of over-broad permissions

### 3.1 `apikey.manage` → `apikey.read` + `apikey.write`

Today one value gates the whole API-key surface (api-keys.ts:37/47). Split by persona (a monitoring key lister vs a key creator):

| value | label | R/W | exact capability | endpoints |
|---|---|---|---|---|
| `apikey.read` | View API keys | read | List/view **own** keys, read the permission catalog and own effective permissions | GET /api/admin/api-keys (own), GET …/permissions-catalog (api-keys.ts:55), GET …/my-permissions (api-keys.ts:64) |
| `apikey.write` | Manage API keys | write | Create, rename, enable/disable, revoke **own** keys (never above own live permission set) | POST /api/admin/api-keys (api-keys.ts:73), PATCH/DELETE /api/admin/api-keys/:id (api-keys.ts:268/338 for own) |

Cross-user key administration (list/update/revoke another user's keys) stays `admin.write`-tier (api-keys.ts:231, 400). `admin.read` already satisfies `apikey.read` via hasGrant.

### 3.2 `server.update` → `server.update` + `server.network` + `server.storage`

Today `server.update` covers settings, allocations/ports, restart policy and (accidentally, via any-row) disk resize (core.ts:1827, network.ts:138, admin-ops.ts:66, core.ts:2249). Split:

| value | label | R/W | exact capability | endpoints |
|---|---|---|---|---|
| `server.update` | Update server settings | write | Edit server config: name/description, resources, startup variables, restart policy, crash settings, subuser grant editing | PUT /api/servers/:id (core.ts:1827/1879), /variables (variables.ts:101), admin-ops restart-policy/reset-crash (admin-ops.ts:66/114), server access grant routes (server.ts:1756-1862) |
| `server.network` | Manage network | write | Add/remove allocations, change primary port/port bindings, primary IP | POST/DELETE /:serverId/allocations, /primary (network.ts:106-155, 373, 497) |
| `server.storage` | Resize storage | write | Grow/shrink allocated disk | POST /:serverId/storage/resize (core.ts:2249) — must require this perm in the ServerAccess row (fixes the any-row bug, core-model §3 item 3) |

### 3.3 `node.update` node_manage side effect → `node.server_manage`

Today node assignment + `node.update` = full server manage on that node (server-access.ts:64-66; ALL_SERVER_PERMISSIONS at _helpers.ts:1404-1409). `node.update` itself stays "edit node config" only:

| value | label | R/W | exact capability | checked by |
|---|---|---|---|---|
| `node.update` | Update nodes | write | Edit node capacity/addresses/metadata | routes/nodes.ts update routes |
| `node.server_manage` | Manage servers on assigned nodes | write | Full server management (ALL_SERVER_PERMISSIONS) on servers hosted on **assigned** nodes | decideServerAccess node_manage (server-access.ts:64-66) and the ~14 inline node-manage pairings (network.ts:146, admin-ops.ts:405, core.ts:1888/2432, tasks.ts:72/107, alerts.ts:70, backups.ts:89, metrics.ts:82, console-stream.ts:76, sse-events.ts:225, gateway.ts:3592/3701/3830/5444, variables.ts:36/107) |

## 4. Additions the route surface demands

### 4.1 Server-scoped (add to `ALL_SERVER_PERMISSIONS`)

| value | label | R/W | exact capability | endpoints |
|---|---|---|---|---|
| `server.clone` | Clone servers | write | Clone a server (full or config-only), run clone preflight and retry | POST /:serverId/clone/preflight, /clone, /clone/:cloneId/retry (core.ts:890/956/1308; today gated on `server.create` + canAccessServer, core.ts:897/1000/1314) |
| `server.kill` | Force-kill servers | write | SIGKILL a stuck server process | POST /:id/kill (power.ts:1048; today reuses `server.stop`) |
| `mods.manage` | Manage mods | write | Install/uninstall mod-manager content (mods, datapacks, modpacks) on a server | mod-plugins.ts write routes (341, 744, 1036, 1101, 1387, 1528; today reuse `file.write`) — reads stay `server.read` |
| `plugins.manage` | Manage server plugins | write | Install/uninstall server plugins (CS2/etc. plugin manager) | mod-plugins.ts plugin routes + cs2.ts write routes (cs2.ts:280/384/494; today `file.write`) |
| `file.sftp` | Use SFTP channel | write (capability) | Mint SFTP tokens / open SFTP sessions for a server; session file ops remain bounded by `file.read`/`file.write` | GET /api/sftp/connection-info (server.ts:1511), POST /api/sftp/rotate-token (server.ts:1621) — today any `server.read` holder can mint (server.ts:1543-1565); agent-side session perms must also derive role-granted file perms (core-model §3 item 4) |

Deliberate **non-additions**: EULA stays `server.start` (documented lifecycle reuse, power.ts:481-483); metrics stays `server.read` (fix admin.read reachability in the engine, core-model §6.4); alert rules already covered by `alert.*` (alerts.ts:153-627); subuser/invite management stays ownership-level (canManageSubusers, _helpers.ts:469-485).

### 4.2 Admin-tier (panel-wide, targeted)

| value | label | R/W | exact capability | endpoints |
|---|---|---|---|---|
| `migration.manage` | Run migrations | write | Start/test/pause/resume/cancel/retry Pterodactyl migration jobs | migration.ts writes (102/143/394/411/428/485) — reads move to `admin.read` per contract (core-model §2.3; migration.ts:38 today requires admin.write for reads) |
| `update.trigger` | Trigger panel updates | write (disruptive) | Trigger the panel self-update and forced release checks | POST /api/admin/update/trigger (update.ts:183), POST /api/admin/update/check (update.ts:163) — status/settings/state reads move to `admin.read` |
| `diagnostics.download` | Download diagnostics | read | Download the cross-tenant diagnostics bundle | GET /api/admin/diagnostics/export (admin.ts:2589; default stays admin.read-satisfiable — this value exists to delegate bundle access to support without full read-admin) |

Optional tier-2 (not needed by a persona today; recommend NOT adding until one exists): `dbhost.read`/`dbhost.write` for database hosts (currently admin bits, admin.ts:3574+); panel settings remain admin-only (no `settings.read`/`settings.write`).

## 5. Canonical read set (replaces suffix sniffing)

`isReadPermission` becomes membership in a declared set (single source in permissions-catalog.ts), replacing permissions.ts:130-136 and the duplicate at _helpers.ts:1421-1424:

```
READ_PERMISSIONS = {
  admin.read, apikey.read,
  server.read, backup.read, file.read, console.read,
  database.read, alert.read, node.read, location.read,
  template.read, user.read, role.read,
  node.view_stats, backup.download, diagnostics.download,
}
```

Explicitly NOT read (write/capability): `file.sftp`, `server.clone`, `server.kill`, `server.network`, `server.storage`, `mods.manage`, `plugins.manage`, `node.server_manage`, `apikey.write`, `migration.manage`, `update.trigger`, and every other non-listed value. `node.view_stats` should also satisfy dashboard `/resources` (dashboard.ts:203, currently ignored).

## 6. COMPAT — storage, mapping, migration

### 6.1 Storage (prisma/schema.prisma)

All permission stores are plain `String[]` Postgres arrays — **no schema change, no Prisma migration file needed** for adds/renames: `Role.permissions` (187), `ApiKey.permissions` (168), `ServerAccess.permissions` (248), `ServerAccessInvite.permissions` (263), `RoleServerGrant.permissions` (217), `RoleNodeGrant.permissions` (234). (Per AGENTS.md a migration ships only with schema.prisma changes — none here.)

### 6.2 Old→new mapping (behavior-preserving)

| old value | maps to (union) | rationale |
|---|---|---|
| `apikey.manage` | `apikey.read` + `apikey.write` | old value gated the whole surface |
| `server.update` | `server.update` + `server.network` + `server.storage` | old value covered all three capabilities |
| `node.update` | `node.update` + `node.server_manage` | preserve the node_manage path for existing node operators |
| `server.create` | `server.create` + `server.clone` | clone was gated by create (core.ts:897) |
| `server.stop` | `server.stop` + `server.kill` | kill was gated by stop (power.ts:1048) |
| everything else | unchanged | — |

**Legacy alias window (recommended):** keep an `LEGACY_ALIASES` map in the catalog consulted by `hasGrant`/`isValidPermission`, so unmigrated rows keep working (`apikey.manage` satisfies `apikey.read`/`apikey.write` checks, etc.). This makes the data migration idempotent and non-urgent; drop aliases one release after the migration reports zero legacy values.

Deliberate behavior changes (narrowing, flagged for the owner): `mods.manage`/`plugins.manage` do NOT alias `file.write` (the current reuse is the over-broad behavior being fixed — subusers who need mod installs must be re-granted explicitly); `file.sftp` does not alias `server.read` (SFTP minting becomes opt-in — during rollout accept `server.read|file.read|file.write` OR `file.sftp` at the two mint endpoints, then remove the OR).

### 6.3 Data migration (needed for the six stores)

Ship a Node script (seed-admin.ts pattern; run via `pnpm --filter catalyst-backend run db:migrate-permissions`): for each of the six tables, `UPDATE`-style rewrite of the `permissions` array through the §6.2 map (append new values, keep old value too during the alias window, dedupe), logging counts; idempotent (re-running is a no-op). SQL variant for the fearless: `UPDATE "Role" SET permissions = (SELECT array_agg(DISTINCT m) FROM (SELECT unnest(permissions) AS p UNION SELECT map_value WHERE p = map_key) ...)` — the script is safer against array corner cases. `ServerAccessInvite.permissions` (263) and both grant tables (217/234) must be included so pending invites and scoped grants gain the split values.

### 6.4 Every place that must be updated

1. `lib/permissions-catalog.ts`: `PERMISSION_CATEGORIES` (18-169), `ALL_PERMISSIONS` (172-174), `ALL_SERVER_PERMISSIONS` (238-247) + new `READ_PERMISSIONS`, `LEGACY_ALIASES`, `isValidPermission`.
2. `lib/permissions.ts`: `isReadPermission` (130-136) delegates to the declared set; **delete the stale `PERMISSION_CATEGORIES` (432-546) and `PERMISSION_PRESETS` (551-602)** — first re-point `roles.ts:11-18` (presets list served at roles.ts:1048) to a canonical preset list; fix `isAdminUser` docstring (348-358).
3. `shared-types.ts`: `Permission` enum (44-115) + `permissions: Permission[]` (347).
4. `routes/setup.ts`: default "User" role creation (257-284, 543-570).
5. `routes/servers/_helpers.ts`: `OWNER_SERVER_PERMISSIONS` (85), `DEFAULT_PERMISSION_PRESETS` (22-79), adminReadSubset (1421-1424 → READ set), `ensureSuspendPermission` (1274), `ensureDatabasePermission` (1446: add admin_read/node_manage), `ensureServerAccess` (495: required actor param).
6. `lib/server-access.ts`: node_manage branch → `node.server_manage` (64-66); same for the ~14 inline pairings listed in §3.3.
7. `services/migration/types.ts` PERMISSION_MAP (348-367) + `services/migration/index.ts` subuser defaults (749, 1047-1067).
8. `lib/validation.ts`: `permissionSchema` (229-233) gains catalog membership (allow `*` + scoped forms of valid values); drop the `file.sftp` comment example (227) once the value is real.
9. Grant-creation guards become hasGrant-based and catalog-checked: roles.ts:365/499, api-keys.ts:85, roles.ts:110-118 (already membership-checked for scoped grants).
10. Frontend: permission selector/checklist types and any permission labels; role wizard preset UI (served by the stale presets today).
11. Tests: rbac.test.ts:492-539 (stale-copy assertions), rbac-api.test.ts route table (167-279: stale rows for /api/admin/stats and POST /api/servers), security-wave2-regression.test.ts:261 (pins `rolePerms.includes("node.update")` — will change with node.server_manage).
12. `scripts/diagnose-admin-rbac.mjs`: print legacy-value counts post-migration.

## 7. Sequencing

1. Add new values + `READ_PERMISSIONS` + `LEGACY_ALIASES` + membership validation (additive, no behavior change).
2. Switch route gates to the new values (keeping legacy ORs where noted in §6.2); fix the engine gaps from core-model §6 (admin.read visibility, unified helper with required actor).
3. Run the data migration (§6.3); monitor `diagnose-admin-rbac.mjs` for zero legacy values.
4. Remove aliases and legacy ORs; delete the stale duplicate catalog.
