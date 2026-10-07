# Stored-Permissions Compat Inventory

Auditor: `audit-admin-people`. Audit only — no source files modified. Companion to `admin-people.md`.
Purpose: complete map of every place permission strings are STORED, PRE-SET, or VALIDATED, so vocabulary changes (new perms like `server.kill` / `mod.*` / `file.sftp`, the `apikey` split, renames) orphan nothing.

## 1. Storage locations (schema.prisma)

RBAC vocabulary (all Postgres `TEXT[]` scalar-list columns or scalars — no DB-level defaults):

| # | Location | Schema cite | Contents / semantics |
|---|---|---|---|
| S1 | `Role.permissions` | prisma/schema.prisma:187 | global role permission array; may contain `*` (seeded Administrator) |
| S2 | `RoleServerGrant.permissions` | prisma/schema.prisma:217 | server-scoped grants ("Subset of ALL_SERVER_PERMISSIONS", wizard-managed) |
| S3 | `RoleNodeGrant.permissions` | prisma/schema.prisma:234 | node-scoped grants (nodeId null = all nodes) |
| S4 | `ServerAccess.permissions` | prisma/schema.prisma:248 | per-user subuser grants for one server |
| S5 | `ServerAccessInvite.permissions` | prisma/schema.prisma:263 | permissions pre-set on a pending invite; copied into S4 on accept (routes/servers/invites.ts:402-410) |
| S6 | `apikey.permissions` + `apikey.allPermissions` | prisma/schema.prisma:166-167 | API key scope array; `allPermissions=true` = inherit creator's **live** perms at auth time (src/server.ts:483-491) |
| S7 | `User.role` (`String?`) | prisma/schema.prisma:21 | legacy better-auth admin channel: `'administrator'` unlocks better-auth admin-plugin endpoints (src/auth.ts:282-299); independent of the RBAC relation (`User.roles`, schema.prisma:42) |

`ServerRole` (schema.prisma:198-207) is role↔server linkage only — no permission column. `NodeAssignment` (schema.prisma:276) is linkage only.

Adjacent but NOT the RBAC vocabulary (do not migrate together; naming-collision caution only): `Plugin.grantedPermissions` (Json, schema.prisma:1009) and `Plugin.safetyAcceptedPermissions` (Json, schema.prisma:1002) hold **plugin-manifest** permission strings (`normalizePermissionList(plugin.manifest.permissions)`, routes/plugins.ts:172-174), a separate namespace consumed by src/plugins/context.ts:658-707.

### `User.role` (S7) full read/write map
Writes: prisma/seed-admin.ts:73, prisma/seed.ts:354, src/routes/setup.ts:300 and 596 (all set `'administrator'`), scripts/bootstrap-production.ts:121.
Reads: better-auth admin plugin role matching (src/auth.ts:297 `adminRoles: ["administrator"]`) and src/routes/setup.ts:296 (`userRecord.role !== "administrator"` re-arm check). Read-only diagnostics: scripts/diagnose-admin-rbac.mjs:19-29.
Panel role mutations (PUT /api/admin/users:693-717; roles.ts:879-884, 950-955) never touch it — the demotion-survival hole flagged in admin-people.md §3.4.

## 2. Seeds / defaults creating roles + permission arrays

| Source | Roles created / arrays written | Cite |
|---|---|---|
| prisma/seed.ts | Administrator `["*"]`; Moderator (17 perms, node/location/template/user/server/file/console/alert set); User `["server.read"]`; sets `User.role='administrator'` | prisma/seed.ts:267-347 (Administrator upsert 268-278, Moderator 281-327, User 330-347, user update 350-357) |
| prisma/seed-admin.ts | Administrator `["*"]` + `User.role='administrator'` | prisma/seed-admin.ts:60-77 |
| src/routes/setup.ts (first-run + re-arm) | Administrator `["*"]`; **User role with 8 perms** (`server.read/start/stop`, `file.read/write`, `console.read/write`) — diverges from seed.ts's User `["server.read"]`; sets `User.role='administrator'` twice (300, 596) | src/routes/setup.ts:243-283, 528-538 |
| scripts/bootstrap-production.ts | Administrator with explicit 15-perm array **including `'*'` plus concrete perms** (server.start/stop/read, file/console, server.create/delete/suspend, admin.read/write) + `User.role='administrator'` | scripts/bootstrap-production.ts:33-48, 51-62, 121-122 |
| scripts/diagnose-admin-rbac.mjs | read-only diagnostics, no writes | scripts/diagnose-admin-rbac.mjs:19-29 |

Divergence note: three different "User"-role defaults exist (seed.ts `["server.read"]` vs setup.ts 8 perms) and two different Administrator shapes (`["*"]` vs bootstrap's `'*'`+14 concrete). A vocabulary rename must update **all four files** or freshly seeded/production-bootstrapped panels get orphaned strings.

## 3. Presets in code (hardcoded permission arrays)

| Preset | Contents | Cite | Where stored/used |
|---|---|---|---|
| `PERMISSION_PRESETS` (backend) | administrator `['*']`; moderator (17); user `['server.read']`; support (9 read perms) | catalyst-backend/src/lib/permissions.ts:551-602 | served by GET /api/roles/presets (routes/roles.ts:1038-1054); **frontend RolesPage duplicates its own copy** (see below) |
| `DEFAULT_PERMISSION_PRESETS` (server subuser) | readOnly (5), power (22), full (27, incl. `backup.download`, `server.delete`) | catalyst-backend/src/routes/servers/_helpers.ts:24-89 | served by GET /:serverId/permissions (invites.ts:39-72); UI presets for invites/subuser editing |
| `OWNER_SERVER_PERMISSIONS` | = `DEFAULT_PERMISSION_PRESETS.full` (27 perms) | routes/servers/_helpers.ts:92-94 | **stored into ServerAccess** on server create (servers/core.ts:821-826), clone (services/server-clone.ts:1293), ownership transfer (routes/servers/admin-ops.ts:783-787) |
| Admin user-create/update default ServerAccess set | 13 perms **including `server.delete`, `file.write`, `console.write`** (flagged E-BROAD in admin-people.md §3.6) | routes/admin.ts:440-453 (create), 766-782 (update), 1009-1014 (delete-with-transfer) | **stored into ServerAccess** |
| Frontend `PERMISSION_CATEGORIES` (RolesPage) | 3rd copy of the catalog — mirrors the **stale** backend copy: server cat lacks `server.update/install/reinstall/rebuild`, backup cat lacks `backup.download` | catalyst-frontend/src/pages/admin/RolesPage.tsx:64-177 | role wizard/editor grid |
| Frontend `PERMISSION_PRESETS` (RolesPage) | administrator `['*']`, moderator (18 — **includes `node.assign`**, unlike backend's 17), user, support | catalyst-frontend/src/pages/admin/RolesPage.tsx:179-208 | role wizard preset buttons |
| Frontend `FALLBACK_SERVER_PERMISSIONS` | 25 perms — **missing `backup.download`** (backend ALL_SERVER_PERMISSIONS has 27) | catalyst-frontend/src/lib/serverPermissions.ts:25-51 | offline fallback for subuser checklist + role wizard scope step (header comment 1-15) |
| Frontend `ADMIN_PERMISSIONS` (ProtectedRoute) | 4th vocabulary copy: 43 admin-panel permission strings (admin/user/role/node/location/template/server-admin/backup/alert/apikey.manage) + a **reimplemented `hasGrant`** (admin.write/admin.read logic at lines 67-68) | catalyst-frontend/src/components/auth/ProtectedRoute.tsx:7-50, 54-70 | gates all `/admin` routes |
| Frontend feature gates | `server.start/stop/install/reinstall` (ServerControls.tsx:49-54), `admin.write`/`server.create` (CloneServerDialog.tsx:60, 193), `apikey.manage` (ApiKeysPage.tsx:308) | as cited | button-level UI gating |
| i18n label keys | `admin-access.json roles.permissionLabels.*` = 54 keys; `common.json serverPermissions.*` = 25 keys (**no backupDownload** — renders raw identifier today) | catalyst-frontend/src/i18n/locales/en/admin-access.json:324+, en/common.json:104-130 (×3 locales: en/fr/zh-CN) | every user-visible permission label; i18n:check requires all locales at 100% |

## 4. Validation paths (what rejects unknown permission strings TODAY)

| Gate | Location | What it accepts / rejects |
|---|---|---|
| **Scoped-grant wizard — the ONLY strict catalog gate** | routes/roles.ts:110-118 (`applyRoleScope`) | REJECTS any permission not in `ALL_SERVER_PERMISSIONS` (27 strings). Does NOT accept `*`, `admin.write`, or any non-server perm. Multi-segment `file.sftp` would be rejected today (not in the list). Rejection is a thrown 400 (respondScopeError, roles.ts:188-196). |
| Role create/update/permission-add | routes/roles.ts:356-373 (create), 489-507 (update), 649-655 (add-perm) | NOT catalog-checked. Gate = "editor must literally hold every requested permission" (raw `includes`, `'*'` bypasses, roles.ts:362-373). For non-wildcard editors this indirectly rejects unknown strings; a `'*'` superadmin can store **arbitrary/typo strings** into `Role.permissions`. Array-ness checked only (roles.ts:356-358, 490-492). |
| Role-scope escalation guard | routes/roles.ts:127-135 | editor-must-hold for scoped perms (raw includes, `'*'` bypass) — in addition to the strict vocab check above. |
| API key create | routes/api-keys.ts:82-96 | creator-must-hold (raw includes, `'*'` bypass) — no catalog check. `allPermissions:true` skips validation entirely (safe only because src/server.ts:483-491 clamps to the creator's **live** perms at auth time and rejects stale perms, server.ts:492-505). |
| API key auth-time clamp | src/server.ts:483-505 | rejects a key's perms that the user no longer holds (scoped keys); allPermissions keys resolve to live user perms. Unknown strings in a key die at first use, not at creation. |
| Server invite create | routes/servers/invites.ts:150-172 | trim + non-empty (150-154); inviter-must-hold via `getEffectiveServerPermissions` (157-171, `'*'` bypass — but effective perms for owners/admins are the 27-perm vocabulary, see below). No direct catalog check. |
| Subuser access update | routes/servers/invites.ts:659-681 | same shape as invite create (trim 659-663, requester-must-hold 664-681). |
| Invite accept | routes/servers/invites.ts:402-410, 430 | stores `invite.permissions` verbatim into `ServerAccess` — inherits whatever passed at invite creation. |
| Admin user create/update serverPermissions | routes/admin.ts:421-434, 750-764 | requester-must-hold (raw includes, `'*'` bypass only). Hardcoded default set (see §3) bypasses validation entirely. |
| `permissionSchema` / `roleCreateSchema` — **DEAD CODE** | src/lib/validation.ts:229-244 | The natural shape-gate: accepts `'*'`, `resource.action`, `resource.action:resourceId`, **explicitly allows multi-segment resources (comment: "Multi-segment resources allowed (e.g. admin.read, file.sftp)")**. ZERO consumers in backend or frontend (grep: only definition site) — roles.ts does its own inline checks. Wiring it in would give shape validation but not vocabulary validation. |

**Net answer:** only ONE gate rejects unknown strings outright (the scoped-grant wizard, roles.ts:110-118). Every other write path is an editor-must-hold check that degrades to "anything goes" for `'*'` holders; `ServerAccess`/`ServerAccessInvite`/`Role.permissions`/`apikey.permissions` can all carry strings outside any catalog today. Renames therefore must migrate data (§6), not just code — existing rows are not guaranteed catalog-clean.

Effective-permissions note: `getEffectiveServerPermissions` (routes/servers/_helpers.ts:1374-1435) returns the full 27-perm vocabulary for owner / `*` / `admin.write` / node-manage actors (1383, 1403-1412) and filters global role perms to the vocabulary for regular users (1414-1417); `admin.read` maps to the `.read` + `backup.download` subset (1418-1423). So the invite guard is vocabulary-bounded for owners even though it never consults the catalog.

## 5. Consumers of the catalog / vocab constants

### Backend
| Consumer | Import / use | Cite |
|---|---|---|
| `PERMISSION_CATEGORIES` (live catalog) | api-keys.ts — served by GET /api/admin/api-keys/permissions-catalog; also `hasPermission`/`isAdmin` helpers from same module | routes/api-keys.ts:5, 55-59 |
| `PERMISSION_CATEGORIES` (STALE duplicate) | exported from lib/permissions.ts; consumed only by `src/__tests__/rbac.test.ts` (493-526). Missing `server.update/install/reinstall/rebuild`, `backup.download`, `server.schedule` is present; drift risk | lib/permissions.ts:432-546; rbac.test.ts:493-526 |
| `ALL_PERMISSIONS` (flat list) | derived in permissions-catalog.ts:172-174 — **zero consumers** anywhere (backend or frontend). Free to extend/remove. | permissions-catalog.ts:172-174 |
| `ALL_SERVER_PERMISSIONS` | websocket/gateway.ts:15,5440 (console WS allowlist filter); routes/servers/_helpers.ts:1356-1357 (re-export + effective-perm resolution); routes/servers/core.ts:4,1491,1670-1672,1757 (effective-perm responses + filter); routes/roles.ts:23 (scoped-grant validation) | as cited |
| `getPermissionLabel` / `getPermissionCategory` (backend) | **no backend consumers** (frontend has its own copies) | permissions-catalog.ts:177-192 |
| `resolveUserPermissions` / `resolveServerPermissions` / `resolveUserPermissionsLive` | permission *resolution* on every request path (server.ts:34, session-user.ts:5, servers routes, metrics.ts, alerts.ts, console-stream.ts, backups.ts, tasks.ts, sse-events.ts, gateway) — vocab-agnostic (union of whatever is stored), so unknown strings flow through harmlessly | broad; e.g. server.ts:477, metrics.ts:5 |
| MCP tools | `list_permissions_catalog` proxies the catalog endpoint; `create_role`/`update_role`/`create_api_key` proxy the HTTP routes, so they inherit the route gates (incl. the editor-must-hold behavior) | src/mcp/tools.ts:135-139, 1130-1146, 1243-1244; roleScopeSchema 1014-1024 (free-form `arr(str())`, no vocab check) |
| Admin SSE stream | requires `admin.read` via lib/permissions.hasPermission | routes/admin-events.ts:124-125 |

### Frontend
| Consumer | Behavior | Cite |
|---|---|---|
| services/apiKeys.ts + ApiKeysPage | fetches the **live backend catalog** (GET /api/admin/api-keys/permissions-catalog); local `getPermissionLabel`/`getPermissionCategory` helpers over fetched data — dynamic, rename-safe except `apikey.manage` hardcode at ApiKeysPage.tsx:308 | services/apiKeys.ts:136-152; ApiKeysPage.tsx:19, 127, 305-308 |
| RolesPage | **hardcoded** catalog + presets (see §3) — must be hand-updated on every vocab change | RolesPage.tsx:64-208 |
| ProtectedRoute | hardcoded `ADMIN_PERMISSIONS` + reimplemented `hasGrant`/`isReadPermission` (mirrors backend lib/permissions.ts semantics, incl. `node.view_stats`/`backup.download` read specials) | ProtectedRoute.tsx:7-70 |
| lib/serverPermissions.ts | dynamic list from GET /api/permissions/server + stale 25-perm fallback + `serverPermissionLabel` switch (unknown perms render as identifier — graceful) | serverPermissions.ts:1-80 |
| ServerDetailsPage / ServerUsersTab / role wizard scope step | consume the shared server-permission list (API + fallback) | ServerDetailsPage.tsx:410-411 |
| Tests | `src/__tests__/rbac-permissions.test.tsx` enumerates permission strings (frontend guard tests) | rbac-permissions.test.tsx:18-89 |
| Demo data | src/demo/fixtures.ts carries permission strings (dev-only) | demo/fixtures.ts |
| i18n catalogs | 54 `roles.permissionLabels.*` keys (admin-access.json, ×3 locales) + 25 `serverPermissions.*` keys (common.json, ×3 locales) — every new perm needs a key in en/fr/zh-CN in the same change (AGENTS.md i18n rules; `pnpm i18n:check` enforces 100%) | en/admin-access.json:324+; en/common.json:104-130 |

## 6. Migration surface per planned change

General rule: permission arrays are `TEXT[]` **values**, not schema — adding/renaming/splitting permission strings never changes schema.prisma, so no *schema* migration is required; the repo rule "schema changes need committed migrations" (AGENTS.md) is not triggered. All 19 existing migrations under prisma/migrations/ are pure DDL — **no data-migration precedent exists**, but `prisma migrate deploy` executes arbitrary SQL, so a standard `migration.sql` with `UPDATE` statements is deployable the same way (a one-off versioned script is the alternative; a migration is safer because containers only run `migrate deploy` at startup, per AGENTS.md / docker-entrypoint).

Postgres array rewrite pattern for renames (repeat per table):
```sql
UPDATE "Role" SET "permissions" = array_replace("permissions", 'old.name', 'new.name');
-- same for "RoleServerGrant", "RoleNodeGrant", "ServerAccess", "ServerAccessInvite", "apikey"
```

| Planned change | Storage impact | Required action |
|---|---|---|
| **Add `server.kill` / `mod.*` / `file.sftp` (new names)** | none — new strings only appear when granted | Code only: catalog (permissions-catalog.ts:18-169), `ALL_SERVER_PERMISSIONS` if server-scoped (permissions-catalog.ts:238-247), isReadPermission additions if read-type (lib/permissions.ts:130-136), frontend copies (RolesPage.tsx:64-208, ProtectedRoute.tsx:7-50, serverPermissions.ts:25-51+switch), i18n keys ×3 locales, seeds/presets if defaulted. The dead `permissionSchema` regex already accepts multi-segment names like `file.sftp` (validation.ts:225-234). No prisma migration. |
| **`apikey.manage` split** (e.g. apikey.read/create/update/delete) | `Role.permissions` rows containing `apikey.manage`; `apikey.permissions` arrays containing it (keys minted by manage-holders); ServerAccess/invites can also contain it (any vocab string can land there — see §4) | Catalog additions are code-only. If `apikey.manage` is **removed**: needs a data migration mapping it to the new set in S1 (Role) and S6 (apikey) at minimum, plus S4/S5 defensively (`array_replace` cannot expand one value into four — use `array_cat` with a `NOT ('apikey.manage' = ANY(...))` guard, or a plpgsql DO block). If it stays as a legacy alias accepted by `hasGrant`, no migration. Frontend hardcode: ApiKeysPage.tsx:308, ProtectedRoute.tsx:50, RolesPage.tsx:177, i18n `apikeyManage` keys ×3. |
| **Rename an existing perm** (e.g. server.suspend → server.kill) | all five array tables (S1-S5) + S6 | Data migration with `array_replace` per table (S2/S3 only carry the 27 server perms, so server-side renames touch them; S1 can carry anything). Plus every code consumer in §3/§5 (seeds ×4 files, presets ×6, frontend ×4 copies, i18n ×3 locales, tests ×2). Missing the data migration silently revokes access (strings stop matching route requirements). |
| **Remove a perm** (retire from catalog) | rows keep the string; it becomes inert (no route requires it) but UI renders raw identifiers (frontend fallbacks render unknown keys as the identifier — serverPermissions.ts:52-55, RolesPage formatPermission 214-215) | Optional cleanup data migration (`array_remove`). Low risk: orphans are non-functional, not security holes. |
| **Fix the legacy `User.role` channel** (admin-people.md §3.4) | `User.role` column on User | If the better-auth admin surface is disabled or the role is derived live: no migration (code only). If syncing the column from RBAC state on every role mutation: code only (write paths listed in §1). Optional data backfill script `UPDATE "User" SET role = NULL` (or 'administrator' for `*`-holders) — schema unchanged. |
| **Scope syntax (`perm:resourceId`)** | stored today in S1 (permissionMatches supports it, lib/permissions.ts:160-206); S2-S6 vocabulary never contains scopes (validated/originated from unscoped lists) | No migration; keep `parseScopedPermission` (lib/permissions.ts:99-110) and the frontend mirror (ProtectedRoute.tsx:63-65) in sync. |

### Orphan-risk summary (what breaks silently if missed)
1. Four seed/setup/bootstrap files with different default arrays (§2) — a rename missed in one seeds orphaned strings into fresh installs.
2. Four frontend vocabulary copies (RolesPage, ProtectedRoute, serverPermissions fallback, i18n ×3 locales) — no single source; the backend catalog endpoint exists but only ApiKeysPage uses it.
3. `Role.permissions` / `ServerAccess` / `apikey.permissions` are not catalog-validated on write (§4) — DB contents are not guaranteed clean, so `array_replace` migrations must be idempotent and tolerant of unknown strings.
4. `Plugin.grantedPermissions` (Json) is a different namespace — do not sweep it into an RBAC rename.
5. `User.role` must be handled deliberately (keep, sync, or kill) as part of the apikey/admin vocabulary work, or the better-auth admin channel keeps diverging from RBAC.
