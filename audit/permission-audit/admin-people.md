# Permission Audit — admin-people (users / roles / api-keys / auth)

Auditor: `audit-admin-people`. Scope: `catalyst-backend/src/routes/admin.ts` (user mgmt, role list, audit-logs), `roles.ts`, `api-keys.ts`, `auth.ts`. Audit only — no source files were modified.

## 1. Executive summary

- The target contract is broken at its root by `canManageUsers()` (admin.ts:84-88), which uses raw `perms.includes('user.<action>')` instead of `hasGrant`: **`admin.read` cannot read the user list, and `admin.write` cannot manage users at all** (12 endpoints). `checkPerm()` (admin.ts:73-76) does honor the contract; admin.ts mixes the two styles.
- All escalation guards use raw string comparison too, which is mostly *stricter* than needed, but they have **holes**: admin-demotion protection exists only in `PUT /api/admin/users/:userId`, and `roles.ts` routes (role removal, role-permission removal, role edit) can demote every administrator with just `user.set_roles` or `role.update`, with **no last-admin guard**.
- A **parallel legacy admin channel** exists: better-auth's admin plugin is gated by the `User.role === 'administrator'` column (src/auth.ts:282-299), set only by seeds/setup, never maintained by panel role edits — seeded admins keep impersonation/ban/set-password powers **after demotion**.
- `apikey.manage` is a mega-permission (read all gate excluded; create/update/delete/see catalog) but route-level ownership scoping keeps it contained; a split is still proposed.
- `admin.read` cannot reach 4 read endpoints (GET /users, GET /users/:id/servers, GET /audit-logs/export, GET api-keys/:id/usage). No C-NO-CHECK endpoints found in scope. Verdict counts: **OK 37, A-READ-GAP 4, B-WRITE-LEAK 12, C-NO-CHECK 0, D-CATALOG 1, E-BROAD 1** (row-level; systemic findings listed separately).

## 2. Endpoint table

Verdicts: `OK` / `A-READ-GAP` (read that `admin.read` cannot reach) / `B-WRITE-LEAK` (write reachable with something broader than intended, or guard bypass) / `C-NO-CHECK` / `D-CATALOG` / `E-BROAD`. `CG-1` = systemic contract gap from `canManageUsers` (see §3.1): targeted perms work, but `admin.write` is not honored as a superset.

### 2.1 admin.ts — user management

| Endpoint | Check (file:line) | R/W | Current logic | Verdict | Fix |
|---|---|---|---|---|---|
| GET /api/admin/users | admin.ts:184 (`canManageUsers 'read'`) | R | raw `perms.includes('user.read') \|\| perms.includes('*')`; **admin.read fails, admin.write fails** | **A-READ-GAP** + CG-1 | `canManageUsers` → use `hasGrant` (admin.ts:84-88) |
| POST /api/admin/users | admin.ts:309 (`canManageUsers 'create'`), guard 348-391, server-grant auth 407-418 | W | raw `user.create`\|`*`; role-assignment guard requires actor to literally hold every role perm + scoped-grant perms (369-389) unless `*`; non-`*` actor may grant ServerAccess on own/node-assigned servers | OK + CG-1 | fix CG-1; note guard accepts only `*` (not admin.write) for granting — intentionally stricter, acceptable; **E-BROAD note**: default ServerAccess set at 440-453 includes `server.delete`, `file.write`, `console.write` |
| PUT /api/admin/users/:userId | admin.ts:570-583 (perm), 593-598 (pw guard), 603-620 (demotion guard), 639-654 (role guard), 737-764 (server grants) | W | `roleIds` truthy → only `user.set_roles` checked; else `user.update`. Password reset blocked for targets holding `*`/`admin.write` unless actor `*`; Administrator-role demotion needs `*` + last-admin; role guard checks global perms only — **no scoped-grant check (unlike POST)**; serverPermissions guard raw | **B-WRITE-LEAK** (3 issues: (a) `roleIds: []` is truthy → user.set_roles alone unlocks password reset of non-admin targets + email/username change + ServerAccess rewrites; (b) missing scoped-grant escalation guard; (c) pw guard misses `admin.read` targets → user.update holder can reset a read-admin's password) + CG-1 | (a) require `user.update` whenever password/email/username/serverIds present; (b) port the 369-389 scoped-grant check; (c) treat `admin.read` targets as admin-equivalent |
| GET /api/admin/users/:userId/servers | admin.ts:883 (`canManageUsers 'read'`) | R | raw `user.read`\|`*` | **A-READ-GAP** + CG-1 | CG-1 fix |
| POST /api/admin/users/:userId/delete | admin.ts:933 (`canManageUsers 'delete'`), guard 951-970 | W | raw `user.delete`\|`*`; delete blocked if target has Administrator role name or `admin.write` perm, unless actor `*`; last-admin guard counts role name only | **B-WRITE-LEAK** (guard at 956-957 checks `admin.write` + role *name* but not `*`: a superadmin whose `*` comes from a role not named "Administrator" can be deleted by a mere user.delete holder) + CG-1 | include `targetEffectivePerms.includes('*')` in the admin-equivalent test |
| POST /api/admin/users/:userId/ban | admin.ts:1094 (`canManageUsers 'ban'`), guard 1110-1113 | W | raw `user.ban`\|`*`; ban blocked for targets holding `*`/`admin.write` unless actor `*`; better-auth banUser with Prisma fallback (1136-1153) | OK + CG-1 | CG-1 fix (guard itself correct — covers both `*` and `admin.write`) |
| POST /api/admin/users/:userId/unban | admin.ts:1171 (`canManageUsers 'unban'`) | W | raw `user.unban`\|`*`; **no hierarchy guard** — can unban a banned admin (banned for cause by a `*` holder) | **B-WRITE-LEAK** + CG-1 | mirror the ban guard: unban of `*`/`admin.write` target requires `*` |
| DELETE /api/admin/users/:userId/passkeys | admin.ts:1221 (`canManageUsers 'update'`), guard 1227-1230 | W | raw `user.update`\|`*`; wipe blocked for `*`/`admin.write` targets unless actor `*` — but **`admin.read` targets are wipeable** | **B-WRITE-LEAK** (combined with the pw-reset hole: user.update holder resets password + wipes passkeys of an admin.read account → takeover of read-everything access) + CG-1 | include `admin.read` in the target guard |
| DELETE /api/admin/users/:userId/two-factor | admin.ts:1250 (`canManageUsers 'update'`), guard 1256-1259 | W | same shape as passkeys wipe | **B-WRITE-LEAK** (same admin.read-target hole) + CG-1 | same |
| PUT /api/admin/users/:userId/enforce-2fa | admin.ts:1280 (`canManageUsers 'update'`) | W | raw `user.update`\|`*`; **no hierarchy guard at all** — a user.update holder can set `twoFactorEnabled=false` on a `*` superadmin | **B-WRITE-LEAK** + CG-1 | block enforce/unenforce on `*`/`admin.write`/`admin.read` targets unless actor `*` (or admin.write) |
| DELETE /api/admin/users/:userId/accounts/:accountId | admin.ts:1316 (`canManageUsers 'update'`) | W | raw `user.update`\|`*`; no hierarchy guard (can unlink an admin's SSO); last-auth-method guard present (1329-1334) | **B-WRITE-LEAK** (weaker: auth-weakening only) + CG-1 | add hierarchy guard |
| PUT /api/admin/users/:userId/verify-email | admin.ts:1355 (`canManageUsers 'update'`) | W | raw `user.update`\|`*`; no hierarchy guard (impact low: marks email verified) | OK + CG-1 | CG-1 fix; hierarchy guard optional |

### 2.2 admin.ts — roles (mounted here) & audit logs

| Endpoint | Check (file:line) | R/W | Current logic | Verdict | Fix |
|---|---|---|---|---|---|
| GET /api/admin/roles | admin.ts:908 (`checkPerm 'role.read'`) | R | `hasGrant` → `admin.read`/`admin.write`/`*`/`role.read` all pass | OK | — (duplicate of roles.ts GET /; consider removing one) |
| GET /api/admin/audit-logs | admin.ts:2223 (`checkPerm 'admin.read'`) | R | `hasGrant`: `admin.read` passes | OK | — |
| GET /api/admin/audit-logs/export | admin.ts:2315 (`checkPerm 'admin.write'`) | R (export/download of log data — no mutation) | requires `admin.write`, although the sibling `/system-errors/export` (admin.ts:2480) requires only `admin.read` | **A-READ-GAP** | require `admin.read` (writing nothing) — align with system-errors export |

### 2.3 roles.ts (all under /api/roles)

`checkPermission()` (roles.ts:203-214) → `hasPermission` → `permissionMatches` (lib/permissions.ts:160-206): `admin.read` satisfies read checks, `admin.write` satisfies any concrete check — contract-compatible.

| Endpoint | Check (file:line) | R/W | Current logic | Verdict | Fix |
|---|---|---|---|---|---|
| GET /api/roles | roles.ts:223 (`role.read`) | R | hasGrant-style via DB resolve | OK | — |
| GET /api/roles/:roleId | roles.ts:258 (`role.read`) | R | role detail incl. member list (id/email/username, 268-275) and scoped grants | OK | note: exposes user emails to `role.read`-only holders; acceptable but consider `user.read` for the member list |
| POST /api/roles | roles.ts:344 (`role.create`), guard 360-373, scope guard 394-403 | W | fresh-perm escalation guard (69-75) — cannot grant perms not literally held unless `*`; `applyRoleScope` re-checks scoped perms (127-135) | OK | — |
| PUT /api/roles/:roleId | roles.ts:446 (`role.update`), guards 464-470 (self-assign), 494-507 (grant), 517-528 (scope) | W | self-assignment blocked; new permissions must be literally held (unless `*`); **no hierarchy guard for editing admin-equivalent roles** — a role.update holder can rename the Administrator role or replace its permission array with a subset they hold (demoting every admin), and can attach/detach scoped grants to it | **B-WRITE-LEAK** | block name/permission/scope edits on roles holding `*`/`admin.write` unless actor `*` |
| DELETE /api/roles/:roleId | roles.ts:572 (`role.delete`), guard 589-593 | W | in-use guard: cannot delete a role with assigned users | OK | — |
| POST /api/roles/:roleId/permissions | roles.ts:638 (`role.update`), guards 647-655 (grant), 665-671 (self-assign) | W | add permission; must hold it (unless `*`) | OK | — |
| DELETE /api/roles/:roleId/permissions/* | roles.ts:724 (`role.update`), guard 742-748 (self-assign) | W | remove a permission; **no grant/hierarchy guard needed to remove** — a role.update holder can strip `*` from the Administrator role (not self-assigned) → panel-wide demotion/lockout, no last-admin guard | **B-WRITE-LEAK** | block removal of `*`/`admin.write`/`admin.read` from admin-equivalent roles unless actor `*`; add last-admin check |
| POST /api/roles/:roleId/users/:userId | roles.ts:799 (`user.set_roles`), guards 816-865 (self-assign, global perms, scoped perms) | W | full escalation guards incl. RoleServerGrant/RoleNodeGrant (843-865) — best-guarded role-assignment route | OK | — |
| DELETE /api/roles/:roleId/users/:userId | roles.ts:923 (`user.set_roles`) | W | **only** user.set_roles + self-removal block; no admin-demotion guard, no last-admin guard — bypasses the `*`-required demotion + last-admin guards of admin.ts PUT /users (admin.ts:603-618) | **B-WRITE-LEAK** (user.set_roles holder can strip the Administrator role from every admin; combined with PUT /users hole can produce zero admins) | mirror admin.ts demotion + last-admin guards here |
| GET /api/roles/users/:userId/roles | roles.ts:994 (`user.read`) | R | returns roles + aggregated permissions | OK | — |
| GET /api/roles/presets | roles.ts:1044 (`role.read`) | R | static presets | OK | — |
| GET /api/roles/:roleId/nodes | roles.ts:1063 (`node.read`) | R | node assignments of a role | OK | — |
| GET /api/roles/users/:userId/nodes | roles.ts:1171-1173 (self or `node.read`) | R | own assignments visible to self | OK | — |

### 2.4 api-keys.ts (all under /api/admin/api-keys)

`requireApiKeyManage` (36-40) = `hasGrant('apikey.manage')` → satisfied by `apikey.manage`, `admin.write`, `*`; **not** by `admin.read`. `requireApiKeyRead` (46-50) = `apikey.manage` or `isAdmin` (incl. `admin.read`, permissions-catalog.ts:208-211). `isWriteAdmin` (30-33) = `*`/`admin.write`.

| Endpoint | Check (file:line) | R/W | Current logic | Verdict | Fix |
|---|---|---|---|---|---|
| GET …/permissions-catalog | api-keys.ts:55-59 (`requireApiKeyRead`) | R | apikey.manage or any admin | OK | — (this is the permission-catalog endpoint) |
| GET …/my-permissions | api-keys.ts:64-69 (`requireApiKeyRead`) | R | own effective perms | OK | — |
| POST /api/admin/api-keys | api-keys.ts:73-96 (`requireApiKeyManage`) + guard 82-96 | W | create key; scoped perms must be literally held unless `*`; `allPermissions:true` skips the guard but is clamped at auth time to the creator's **live** perms (server.ts:483-491) — no escalation | OK | keep a comment documenting the server.ts clamp; optionally require `allPermissions` keys to be admin-only |
| GET /api/admin/api-keys | api-keys.ts:163-169 (`requireApiKeyRead`) | R | admins see all; apikey.manage-only sees own | OK | — |
| GET /api/admin/api-keys/:id | api-keys.ts:210-233 (`requireApiKeyRead` + own-or-admin) | R | own or admin | OK | — |
| PATCH /api/admin/api-keys/:id | api-keys.ts:250-270 (`requireApiKeyManage` + own-or-`isWriteAdmin`) | W | non-admin apikey.manage holders mutate own keys only; admins any | OK | — |
| DELETE /api/admin/api-keys/:id | api-keys.ts:317-339 (same) | W | same ownership rule | OK | — |
| GET /api/admin/api-keys/:id/usage | api-keys.ts:381-383 preHandler `requireApiKeyManage`, in-handler 399-402 own-or-`isAdmin` (incl. admin.read) | R | **preHandler rejects `admin.read`** before the in-handler `isAdmin` check (which the 401 message "Requires admin.read permission" shows was intended to allow it) | **A-READ-GAP** | use `requireApiKeyRead` for this GET |

### 2.5 auth.ts (custom routes) + better-auth mounted handler

| Endpoint | Check (file:line) | R/W | Current logic | Verdict | Fix |
|---|---|---|---|---|---|
| POST /api/auth/register | auth.ts:94-115 (unauth; registrationEnabled gate) | W | OK-unauth by design; rate-limited | OK | — |
| POST /api/auth/login | auth.ts:217-259 (unauth; brute-force + banned/locked pre-checks) | R | OK-unauth by design | OK | — |
| POST /api/auth/forgot-password, /reset-password/validate | auth.ts:765-797 | R/W | unauth, rate-limited, enumeration-safe timing | OK | — |
| GET /api/auth/me | auth.ts:358-398 (authenticate only) | R | own data: profile + own roles' permissions (390); no cross-user leak | OK | — (this is the "me/permissions" surface; no separate endpoint exists) |
| GET /api/auth/profile | auth.ts:402-436 | R | own data incl. accounts | OK | — |
| POST /api/auth/profile/sso/unlink | auth.ts:438-477 | W | own account; last-sign-in-method guard | OK | — |
| PATCH /api/auth/profile | auth.ts:480-562 | W | own username/firstName/lastName | OK | — |
| PATCH /api/auth/profile/preferences | auth.ts:565-591 | W | own preferences, locale validated | OK | — |
| POST / DELETE /api/auth/profile/avatar | auth.ts:594-655 | W | own avatar, mime+magic+size validated | OK | — |
| GET /api/auth/profile/audit-log | auth.ts:658-675 | R | own audit entries only | OK | — |
| GET /api/auth/profile/export | auth.ts:679-731 | R | own sessions/accounts/keys/logs; ids stripped | OK | — |
| GET /api/auth/profile/api-keys | auth.ts:735-752 | R | own keys (incl. their permission arrays — own data) | OK | — |
| POST /api/auth/profile/delete | auth.ts:802-901 | W | own account; password re-verified; owned-servers guard; **no last-admin guard** — the seeded `*` superadmin can self-delete and leave the panel with zero admins | **B-WRITE-LEAK** (invariant break, self-inflicted) | refuse if actor is the last user holding `*`/`admin.write` |
| better-auth endpoints `/api/auth/admin/*` (list-users, set-user-role, ban/unban, set-password, impersonate, list/revoke sessions) | src/auth.ts:282-299 (admin plugin config) | W | gated by better-auth's own role system: `adminRoles: ["administrator"]` matched against the **`User.role` column** — set only by `prisma/seed-admin.ts:73`, `prisma/seed.ts:354`, `routes/setup.ts:300,596`; panel role mutations never touch it | **B-WRITE-LEAK + D-CATALOG** | see §3.4 — sync `User.role` from RBAC state or disable the better-auth admin endpoints |
| GET /api/permissions/server | server.ts:1696-1706 (authenticate only) | R | static ALL_SERVER_PERMISSIONS vocabulary, no secrets | OK | — |

## 3. Vocabulary findings

### 3.1 `canManageUsers` breaks the admin.read / admin.write contract (CG-1, systemic)
`canManageUsers` (admin.ts:84-88) checks `perms.includes('*')` then `perms.includes('user.' + action)` — raw equality, not `hasGrant`. Consequences across 12 user-management endpoints (§2.1): `admin.read` cannot read users; `admin.write` cannot create/update/delete/ban users unless the role also carries each literal `user.*` string. The neighboring `checkPerm` (admin.ts:73-76) uses `hasGrant` and behaves per contract — admin.ts internally inconsistent. One-line fix (plus tests).

### 3.2 `apikey.manage` mega-permission — split proposal
`apikey.manage` (catalog: permissions-catalog.ts:162-168) gates create+update+delete+catalog+my-permissions+usage; read-all is separately granted to admins via `isAdmin`. Route-level ownership scoping (api-keys.ts:258-270, 336-339) means a non-admin `apikey.manage` holder only manages **their own** keys — so the current blast radius is modest, but the permission is semantically one bit for five verbs. Proposed split (all names in catalog):
- `apikey.read` — list/view own + (admin.read → all), usage, catalog, my-permissions (read endpoints at api-keys.ts:55, 64, 163, 210, 381);
- `apikey.create` — POST (73);
- `apikey.update` — PATCH (250);
- `apikey.delete` — DELETE (317);
- keep `apikey.manage` as a deprecated alias mapping to the full set for one release. Fixes the usage-endpoint A-READ-GAP naturally (`apikey.read` is a read perm, so `admin.read` would satisfy it via `hasGrant`).

### 3.3 `user.set_roles` vs `role.update` boundary
Intent: `user.set_roles` assigns *existing* roles to users; `role.update` edits role *definitions*. Current breaches of that boundary:
1. PUT /api/admin/users/:userId checks **only** `user.set_roles` when `roleIds` is present — and `roleIds: []` is truthy (admin.ts:570-583), so a set_roles-only holder gets password reset, email/username change and ServerAccess rewrites (§2.1 row 3).
2. roles.ts DELETE /:roleId/users/:userId performs role removal (the same operation as admin.ts PUT roleIds) without admin.ts's demotion + last-admin guards (§2.3).
3. role.update can reshape the Administrator role itself (PUT 440 / DELETE permission 718) while user.set_roles cannot create such situations — the two routes must share one hierarchy-guard helper. Recommendation: extract a `assertCanAffectAdminRole(role, actor)` / `assertNotLastAdmin()` helper used by admin.ts PUT, roles.ts PUT/DELETE-permission, and roles.ts role-member removal.

### 3.4 Legacy better-auth `User.role` column — an untracked permission (D-CATALOG)
The better-auth admin plugin grants `user: create/list/set-role/ban/impersonate/delete/set-password/get/update` + `session: list/revoke/delete` to users whose `User.role` column equals `administrator` (src/auth.ts:282-299). That column is written only by seeds/setup and **never by the panel's role management** (PUT /users:693-717, roles.ts:879-884 connect/disconnect only the relation). Net effects: (a) a seeded admin demoted via the panel keeps impersonation/ban/set-password/ban-proof powers through `/api/auth/admin/*`; (b) a panel-appointed superadmin (`*` via relation) lacks them — inconsistent but fail-closed; (c) the "permission" enforced here (`User.role == 'administrator'`) appears in no catalog. Fix: derive the better-auth role from the relation at session time (custom `roles` resolution), or sync the column on every role mutation, or disable the plugin's HTTP surface and keep only the server-side `auth.api` calls (which admin.ts already falls back from, admin.ts:1136-1153).

### 3.5 Catalog hygiene
- Duplicate catalogs: `PERMISSION_CATEGORIES` exists in lib/permissions-catalog.ts:18-169 (live; used by api-keys.ts:58) **and** lib/permissions.ts:432-546 (used only by `src/__tests__/rbac.test.ts`). The old copy lacks `server.update`, `server.install`, `server.reinstall`, `server.rebuild`, `backup.download` — silent drift risk; delete the old export or re-export from the catalog.
- `isReadPermission` (lib/permissions.ts:130-136) treats `node.view_stats` and `backup.download` as reads — matches catalog labels; consistent.
- No permission strings enforced in my scope are missing from the catalog except the legacy `User.role` channel (§3.4). `server.suspend` (bulk actions, admin.ts:1579) is cataloged.

### 3.6 Over-broad default ServerAccess grant (E-BROAD)
When an admin creates/updates a user with `serverIds` but no explicit `serverPermissions`, the default subuser set is `server.start, server.stop, server.read, alert.*, file.read, file.write, console.read, console.write, server.delete` (admin.ts:440-453, 766-782, and the transfer path 1009-1014). Giving a fresh subuser `server.delete` (plus file/console write) by default is broader than "narrowly scoped" — trim to `server.read/start/stop` + alert.read and require explicit grants for the rest.

## 4. Fix list (priority order)

1. **P0 — admin.ts:84-88**: make `canManageUsers` use `hasGrant(perms, 'user.' + action)` (and `checkAnyPerm` for reads). Restores contract for 12 endpoints. Add tests: admin.read → GET /users 200; admin.write → POST /users 200.
2. **P0 — roles.ts:917-985** (`DELETE /api/roles/:roleId/users/:userId`): add the admin-demotion guard (actor `*` required when removing a role that is `Administrator`-named or holds `*`/`admin.write` from a user who has it) and the last-admin guard, mirroring admin.ts:603-618.
3. **P0 — roles.ts:440-528, 718-758**: hierarchy guard on role edits — editing permissions/scope of (or removing permissions from) an admin-equivalent role requires actor `*`; add a last-admin guard before stripping `*`/`admin.write` from the Administrator role.
4. **P0 — src/auth.ts:282-299 / role mutations**: eliminate the `User.role` legacy channel (§3.4) — sync it on every role connect/disconnect or resolve the better-auth role from the relation.
5. **P1 — admin.ts:546-583**: fix the PUT /users body-shape bypass — require `user.update` whenever `password`/`email`/`username`/`serverIds` are present (regardless of `roleIds`); port the scoped-grant guard from POST (369-389) into PUT; extend the password/2FA-wipe target guards (596, 1228, 1257) to `admin.read` targets.
6. **P1 — admin.ts:956-957**: delete-user guard — add `targetEffectivePerms.includes('*')` (currently only `admin.write` + role name "Administrator").
7. **P1 — admin.ts:1167-1173** (unban): add hierarchy guard mirroring ban (1110-1113). **P1 — admin.ts:1276-1308** (enforce-2fa) and **1312-1347** (account unlink): add hierarchy guards.
8. **P1 — api-keys.ts:381-383**: usage endpoint preHandler → `requireApiKeyRead` (fixes admin.read gap). **P1 — admin.ts:2315**: audit-logs/export → `admin.read`.
9. **P2 — auth.ts:802-901**: self-delete last-admin guard.
10. **P2 — admin.ts:440-453/766-782/1009-1014**: trim default ServerAccess set (drop `server.delete`, `file.write`, `console.write`).
11. **P2 — vocabulary**: split `apikey.manage` (§3.2); deduplicate `PERMISSION_CATEGORIES` (§3.5); document the server.ts:483-491 allPermissions clamp next to api-keys.ts:82.

## Appendix — admin.ts sections not deep-audited here

Covered by **audit-admin-system** (stats/system-errors/smtp/settings/update/diagnostics): `/stats` (147), `/system-errors` + `/system-errors/export` + `/:id/resolve` + `/resolve-all` (2400, 2476, 2747, 2782), `/diagnostics/export` (2589), `/security-settings` (2844/2858), `/mcp-settings` (2997/3009), `/localization-settings` (3052/3064), `/health` (3108), `/ip-pools` CRUD (3210/3281/3392/3499), `/database-hosts` CRUD + ping (3573/3593/3684/3788/3834), `/db-status` (3943), `/smtp` (4003/4022), `/mod-manager` (4115/4129), `/theme-settings` (4171/4215), `/auth-lockouts` (4323/4374), `/oidc-config` (4415/4452), `/settings/file-tunnel-upload-limit` (4543). Spot-check only: these consistently use `checkPerm('admin.read' | 'admin.write')` (hasGrant-based, contract-compatible).

Also outside my deep scope (server/node auditors): `/nodes` (1398, `checkPerm node.read`), `/servers` (1447, `checkPerm server.read`), `/servers/actions` (1557, `checkPerm` per-action + `decideServerAccess` per server + API-key scope check at 1594 — all correct on spot-check), `/api/permissions/server` (server.ts:1696, auth-only vocabulary, OK).

No admin-api-key routes exist in admin.ts; all live in api-keys.ts (§2.4). Session data for admins is embedded in GET /users (counts + last IP, admin.ts:261-269); dedicated session listing/revocation exists only via the better-auth admin channel (§3.4) — its guard is the legacy `User.role` column, flagged D-CATALOG.
