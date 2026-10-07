# Adversarial Verification — P0 Claims (team findings cross-check)

Method: for each claim I read the cited code plus the surrounding call path, looking specifically for mitigating checks elsewhere. Verdicts: **12 CONFIRMED, 3 NUANCED, 0 REFUTED.** Line numbers refer to the current main tree.

---

## Claim 1 — canManageUsers uses raw perms.includes → admin.read/admin.write locked out of user endpoints

**VERDICT: CONFIRMED**

Decisive code (admin.ts:84-88):
```ts
const canManageUsers = (request: any, action: 'read' | 'create' | 'update' | 'delete' | 'ban' | 'unban' | 'set_roles' = 'read') => {
  const perms: string[] = request.user?.permissions ?? [];
  if (perms.includes('*')) return true;
  return perms.includes(`user.${action}`);
};
```
- Raw `includes`: a role holding only `admin.read` fails `user.read`; a role holding only `admin.write` fails `user.create/update/delete/ban/unban/set_roles`. Only `*` or the exact `user.*` bit passes.
- Endpoint count verified: **12 endpoints / 13 check sites** — GET /users (184), POST /users (309), PUT /users/:userId (571 set_roles + 580 update), GET /users/:userId (883), POST /users/:userId/delete (933), POST /users/:userId/ban (1094), POST /users/:userId/unban (1171), DELETE /users/:userId/passkeys (1221), DELETE /users/:userId/two-factor (1250), PUT /users/:userId/enforce-2fa (1280), DELETE /users/:userId/accounts/:accountId (1316), PUT /users/:userId/verify-email (1355).
- Mitigation search: none. The same file defines a correct `checkPerm` via `hasGrant` (admin.ts:73-76) and its comment (70-72) even claims "admin.write satisfies any concrete permission; admin.read any read" — but `canManageUsers` does not use it. Spot-checked GET /users (179-186) and POST /users (303-311): `canManageUsers` is the only gate.

**Fix stands:** route `canManageUsers` through `hasGrant` (e.g. `checkPerm(request, \`user.${action}\`)`), which restores admin.read→reads / admin.write→writes per the owner's contract.

---

## Claim 2 — POST /api/nodes/assign-wildcard: node.assign alone grants wildcard to anyone incl. self

**VERDICT: CONFIRMED**

Decisive code (nodes.ts:2508-2512, then 2520-2584):
```ts
app.post("/assign-wildcard", { onRequest: [app.authenticate] }, async (request, reply) => {
  if (!ensurePermission(request, reply, "node.assign")) return;
  ...
  const assignment = await assignNode(prisma, null /* wildcard */, targetType, targetId, request.user.userId, expirationDate);
```
- The only gates are `node.assign` (raw-includes check, nodes.ts:57-66), body-shape validation (targetType/targetId/expiresAt, 2520-2556), target existence (2530-2544), and duplicate-wildcard (2558-2574). **No self-target guard** (targetId may be `request.user.userId` — contrast roles.ts:817-819/946-948 which block self-assignment), **no hasNodeAccess precondition**, **no hierarchy guard** (target role id may be the Administrator role or any role the caller does not administer).
- `assignNode` (lib/permissions.ts:1087-1150) performs no permission checks — only wildcard/specific reconciliation and cache invalidation.
- Escalation impact verified: a wildcard assignment makes `hasNodeAccess` true for every node (permissions.ts:657-674); paired with `node.update` it activates the `node_manage` branch of `decideServerAccess` (lib/server-access.ts:64-66) and `getEffectiveServerPermissions` returns the **full server permission set on every server** (_helpers.ts:1404-1409). So a role with `[node.assign, node.update]` can self-assign the wildcard and gain console.write/file.write/backup.* on the whole fleet.
- The DELETE variant (nodes.ts:2619-2663) is equally bare: `node.assign` alone removes anyone's wildcard.
- Mitigation search: none found in the route, in `assignNode`, or in any hook.

**Fix stands, sharpened:** require `admin.write`/`*` (or `node.assign` + proof the caller administers the target, e.g. role-admin guard), block self-target, and add a hierarchy guard when the target user/role holds admin-equivalent grants.

---

## Claim 3 — DELETE /api/roles/:roleId/users/:userId demotes admins with only user.set_roles

**VERDICT: CONFIRMED** (citation detail corrected)

Decisive code (roles.ts:917-985):
```ts
app.delete('/:roleId/users/:userId', { onRequest: [authenticate] }, async (request, reply) => {
  const currentUserId = request.user.userId;
  if (!(await checkPermission(currentUserId, 'user.set_roles', reply))) return;   // 923
  ...
  if (userId === currentUserId) { ... 'Cannot remove roles from yourself' }      // 946-948
  await prisma.user.update({ where: { id: userId }, data: { roles: { disconnect: { id: roleId } } } }); // 950-955
```
- Only gates: `user.set_roles` (via the DB-based `checkPermission`, roles.ts:203-214 — hasGrant semantics, so plain `user.set_roles` suffices), existence, has-role, self-removal. **No admin-target guard, no `*` requirement, no last-admin count.**
- The guards it bypasses are real and live in admin.ts: PUT /users/:userId requires `*` to strip the Administrator role and refuses the last admin (admin.ts:603-620) and requires `*` to reset an admin's password (596-598); POST /users/:userId/delete has hierarchy + last-admin guards (951-970). Removing a custom `*`-permission role is unguarded in both places, but the roles.ts route is unguarded for the Administrator role too.
- Citation correction: the claim's "roles.ts:603-618" is the **role.delete** route body (roles.ts:566-631; it blocks deleting a role with members at 589-593) — not a demotion guard on this path. The operative guards are admin.ts:596-620 and 951-970.
- Mitigation search: the sibling assign route (roles.ts:792-914) is well guarded (escalation checks 821-865, self-assignment 816-819) — but nothing guards *removal*.

**Fix stands:** mirror the admin.ts guards in the roles.ts remove route — removing a role from an admin-equivalent target (role holds `*`/`admin.write`, or target's effective perms include them) requires `*`; enforce last-admin count for the Administrator role.

---

## Claim 4 — role.update holder can edit the '*' Administrator role itself

**VERDICT: CONFIRMED**

Decisive code:
- PUT /:roleId (roles.ts:440-534): gates are `role.update` (446), self-assignment (464-470), name-duplicate (472-484), and a grant-subset guard (494-507). `permissions: []` produces an empty `cantGrant` list and **passes** — so any `role.update` holder not a member of the Administrator role can replace its `['*']` with `[]` (or any subset they hold) via `updateData.permissions = permissions` (509) → every admin is demoted in one request. No target-role guard, no last-admin check.
- DELETE /:roleId/permissions/* (roles.ts:718-759): removes a single permission (e.g. `*`) from any role with only `role.update` + not-self-assigned (742-748). No guard for wildcard-holding or Administrator roles.
- POST /:roleId/permissions (roles.ts:632-679): same gates; the grant-subset guard (649-655) does prevent *adding* permissions the editor lacks.
- Mitigation search: the self-assignment guard only protects roles the *editor* belongs to; role.delete refuses roles with members (589-593) but PUT/permission routes don't. Nothing else in the path re-checks target-role sensitivity.

**Fix stands:** treat editing (PUT permissions / permission add/remove) of a role that currently holds `*` or `admin.write` — or the named Administrator role with members — as requiring `*` plus a last-admin-equivalent count; the grant-subset guard already blocks escalation, this closes the destructive side.

---

## Claim 5 — Legacy better-auth /api/auth/admin/* gated by User.role column, unaffected by panel demotion

**VERDICT: CONFIRMED**

Decisive code:
- auth.ts:282-298 — the better-auth `admin()` plugin with `adminRoles: ["administrator"]` and an access-control "administrator" role granting `user: ["create","list","set-role","ban","impersonate","delete","set-password","get","update"]` + `session: ["list","revoke","delete"]` (285-292). better-auth gates its `/admin/*` endpoints on the **User.role column** matching an admin role (default field check; the `roles`/`adminRoles` config maps that column to the AC permissions).
- schema.prisma:21 — `role String?` on User, distinct from the panel `roles Role[]` relation (line 42).
- Seeding writes the column: seed-admin.ts:70-76 (`role: 'administrator'` + panel Administrator role), seed.ts:354, setup.ts:300 and 596.
- Panel demotion never touches it: grepping all `role: 'administrator'` / User.role writes in `src/` — only setup.ts and the seed/migration write the column; PUT /users/:userId sets only the `roles` relation (admin.ts:698-701). The auth.ts hooks on `/admin/*` paths (541-657) are pure post-processing (ban side effects, cache flushes, broadcasts) — **no panel-permission gate**.
- Consequence (both directions): a seeded admin demoted to a plain panel role keeps impersonate/ban/set-password/list-sessions via `/api/auth/admin/*`; conversely a panel `admin.write` holder whose User.role is null **cannot** use those endpoints (this matters for claim 6).

Caveat: `node_modules` is not fully installed in this checkout, so better-auth 1.7.x source was not directly inspected; the column-based check is the documented behavior of the admin plugin and is consistent with the config and the code comment at server.ts:1471-1474 ("the legacy `role` column is not synced with RBAC").

**Fix stands:** sync `User.role` (or a derived admin flag) whenever panel roles change, and/or add a `before` hook on `/admin/*` auth paths requiring live panel admin bits (`admin.write`/`*`) so the legacy channel can't outlive panel demotion.

---

## Claim 6 — PUT /api/admin/users/:userId body-shape bypass (roleIds truthy)

**VERDICT: NUANCED** — the structural bypass is real; the password-reset leg is blocked by a check the claim missed; the account-takeover leg survives via a different path.

Confirmed behavior (admin.ts:546-785):
- `if (roleIds)` (570) — an **empty array is truthy**, so `{ roleIds: [], password, email, username, serverIds }` takes the `set_roles` branch: only `user.set_roles` is checked (571-573); the `user.update` branch (579-583) is never reached even though password/email/username/serverIds are being mutated.
- Email/username change: gated only by duplicate check (656-668) then written (693-703) — **unlocked for a set_roles-only holder**.
- ServerAccess rewrite (725-784): gated per-server by owner-or-hasNodeAccess-or-admin.write (736-748) plus a permission-subset check (750-763) — unlocked whenever the caller owns the server or has node access.
- PUT's grant guard (639-654) checks only global `role.permissions` — **POST's scoped-grant guard is absent** (POST checks RoleServerGrant/RoleNodeGrant ⊆ acting perms at admin.ts:365-391). A set_roles holder can therefore assign a role whose global perms they hold but whose scoped grants (console.write/file.write on specific servers/nodes) they do not.
- `roleIds: []` also strips **all** the target's roles (698-701 `set: []`); on an admin-equivalent target the demotion guards do fire (596-598, 603-620) — those work.

Missed mitigation (password reset): the password leg calls `auth.api.setUserPassword` with the acting user's headers (admin.ts:678-681). That is the better-auth admin plugin's set-password endpoint, which enforces **its own admin check on User.role='administrator'** (claim 5's config, auth.ts:282-298). A `user.set_roles`-only caller without that column value fails inside better-auth (route returns 400 at 682-685), so password reset is *not* actually unlocked by the body-shape trick. Session deletion (687) and WS disconnect (690) only run after success.

Remaining severity: full **account takeover is still reachable** — the set_roles-only holder changes the victim's email (656-668/696), then uses the standard email reset flow (auth.ts has `sendResetPasswordEmail`, 240-247) to take over the non-admin victim's account. So the P0 stands; only the mechanism changes.

**Corrected fix:** (a) gate password/email/username/serverIds mutations on `user.update` independently of `roleIds` presence; (b) port POST's scoped-grant guard (365-391) into PUT's role-assignment guard; (c) do not rely on the better-auth internal check for the password path — replace `auth.api.setUserPassword` with a panel-permission-gated implementation (also fixes the reverse bug: panel `admin.write` holders without the User.role column currently cannot reset anyone's password).

---

## Claim 7 — GET /api/servers/:serverId/invites leaks raw invite tokens to any subuser

**VERDICT: CONFIRMED**

Decisive code (invites.ts:77-104):
```ts
if (!(await canAccessServer(userId, server))) { return apiError(...); }      // 93-95
const invites = await prisma.serverAccessInvite.findMany({
  where: { serverId, cancelledAt: null, acceptedAt: null, expiresAt: { gt: new Date() } },
  orderBy: { createdAt: "desc" },
});
reply.send({ success: true, data: invites });                                // 97-102
```
- `canAccessServer` (_helpers.ts:1305-1348) returns true for **any** `ServerAccess` row for the user (1311-1318) — a one-permission or empty-permission subuser qualifies.
- The query has **no `select`** — full `ServerAccessInvite` rows including the `token` column (schema.prisma:262, `token String @unique`) are serialized to the client.
- The token redeems server access with the invited permission set (which can be the full preset), so a read-only subuser can escalate by harvesting a pending token.
- Mitigation search: none. The create route correctly requires `canManageSubusers` (invites.ts:133-135); the list route does not.

**Fix stands:** gate the invites list on `canManageSubusers` (or at minimum `select` everything except `token`).

---

## Claim 8 — SFTP token minting/validate-token permission derivation

**VERDICT: NUANCED** — mechanism and admin-key `['*']` bypass confirmed; "owners get []" is only true for servers created outside the standard flows; "admin.read gets []" confirmed.

Confirmed:
- Minting gate (server.ts:1511-1568 connection-info, 1621-1676 rotate): `sftpHasFileAccess` = ServerAccess row containing `server.read` **or** `file.read` or `file.write` (1543-1547), else `decideServerAccess(requiredPermission: "server.read")` (1559-1568). So minting is gated at server-*visibility* level — "bare server.read" is accurate. Both routes authenticate via the `authenticate` middleware (1513, 1623) → **API keys accepted**.
- validate-token (server.ts:1471-1488): `rolePerms` from the **user's** roles (1475-1482); `isAdmin = rolePerms.includes("*") || rolePerms.includes("admin.write")` (1483-1485); `permissions = isAdmin ? ["*"] : serverAccess?.permissions ?? []` (1486-1488). Neither API-key scope nor `RoleServerGrant`/`RoleNodeGrant`/global-role `file.read` is consulted.
- **Narrow-scoped admin keys get full ['*']**: CONFIRMED — a key scoped to e.g. `["server.read"]` whose *user* holds `admin.write` mints (decision via user roles) and validates as `['*']`; the key's scope is never consulted on either side. The agent enforces per-op `file.read`/`file.write`/`*` (catalyst-agent/src/sftp_server.rs:399-400, 477-489, 636-640, …), so `['*']` = full SFTP read/write.
- **admin.read users get []**: CONFIRMED — `isAdmin` at 1483-1485 counts only `*`/`admin.write`; an admin.read user with no ServerAccess row gets `[]` → no SFTP anywhere (contradicts the read-everything contract).

Corrected framing (owners):
- Servers created through the normal flows **seed an owner ServerAccess row with the full permission set**: create (core.ts:821-828), clone (server-clone.ts:1289-1293), ownership transfer (admin-ops.ts:778-787), Pterodactyl migration (migration/index.ts:1039, 1367) — those owners get full SFTP perms, not `[]`.
- **Exception verified:** the node auto-import flow (nodes.ts import-container route, ~2380-2500) creates the Server row but **no** owner ServerAccess row (grep: zero `serverAccess` references in nodes.ts) — imported servers' owners validate as `[]` and cannot SFTP their own server. Any pre-row-seeding legacy servers are in the same state.

**Corrected fix:** derive SFTP permissions from `getEffectiveServerPermissions` (owner → full set; admin.read → read subset; roles + scoped grants honored; also fixes imported-server owners) and enforce key scope at mint time via `enforceKeyScope(request.user, 'file.read')`; consider gating mint on `file.read` rather than `server.read`.

---

## Claim 9 — enforceKeyScope honored on files/metrics, skipped across a route family

**VERDICT: CONFIRMED** — mechanism, both honored sites, and 11 of the claimed skip sites verified; the family is larger than claimed.

Mechanism (what passing `request.user`/actor changes):
- `enforceKeyScope` (routes/servers/_helpers.ts:487-493): `if (!actor?.apiKeyId) return true; return hasGrant(actor.permissions ?? [], permission);`
- For API-key requests, the `authenticate` middleware sets `request.user.permissions` to the **key's** scoped permission list (server.ts:482-517: `permissions = verification.key.permissions` for scoped keys; live user perms for allPermissions keys) and `apiKeyId` (515). So with the actor passed, `ensureServerAccess` additionally requires the key itself to hold the permission (via hasGrant: exact bit, `*`, `admin.write`, or `admin.read` for read perms). Without it, only user-level grants decide — **a scoped key inherits its owner's entire grant set**.

Honored sites (verified):
- files.ts:76-82 `requireFileAccess(..., actor)` → `ensureServerAccess(..., actor)`; e.g. GET /:serverId/files at files.ts:115 passes `request.user`.
- metrics-stream.ts:55 passes `(request as any).user`.
- Bonus honored sites the claim missed: core.ts:1827 (PUT server update), power.ts:483 (EULA start), admin-ops.ts:66-72 and 114-119 (restart-policy, crash-count).

Skipped sites (spot-verified — 11 of the claimed list):
1. **power.ts:56-95** `ensurePowerAccess` — no actor parameter; used by start/stop/kill/restart (712, 913, 1048, 1180). Only the `checkIsAdmin(request, "admin.write")` branch (65) is key-scoped; owner (64), ServerAccess row (75-78), rolePerms (70), node-manage (71) are all user-level.
2. **network.ts** inline gates — 134-150 (POST allocations; mirrored at 375, 499): owner ‖ row `server.update` ‖ `checkIsAdmin('admin.write')` ‖ user-role `server.update`/`*`/node-manage. Key scope bypassed on all non-admin branches.
3. **admin-ops.ts:218-223** (backup settings, incl. S3/SFTP backup credentials) — 4-arg `ensureServerAccess(...)`, no actor. (The claim's citation is precise: the two sibling routes at 66/114 *do* pass the actor.)
4. **mod-plugins.ts** — all **16** call sites are 4-arg (no actor): 64, 134, 276, 341, 495, 558, 680, 744, 933, 982, 1036, 1101, 1158, 1275, 1387, 1528 — mixes of `"server.read"` and `"file.write"` gates (mod/plugin install/uninstall/update = file writes to server data).
5. **tasks.ts** — `ensureScheduleAccess` (36-85) and `ensureCommandPermission` (86-112): owner ‖ ServerAccess row ‖ user-role `server.schedule`/`console.write` (hasGrant over user rolePerms) ‖ node-manage; no actor. Scheduled tasks with action `command` run arbitrary console commands (comment at 67-70), so a narrowly-scoped key can mint persistent command execution.
6. **invites.ts** manage paths — create/update/cancel gate on `canManageSubusers` (133-135) and `getEffectiveServerPermissions` (159+), both user-level; no actor.
7. **console-stream.ts** — GET 61-81 and POST 184-202 (verified in the realtime audit): only `checkIsAdmin` reflects key perms; owner/row/role branches don't; the gateway re-check (5432-5463) also uses userId only.
8. **backups.ts:43-96** — local `ensureBackupAccess(serverId, userId, reply, permission)` has **no actor parameter at all**: owner ‖ row-with-permission ‖ hasGrant over user rolePerms ‖ node-manage. Backup read/download = cross-tenant exfiltration; restore/delete = destruction.
9. **core.ts** DELETE /:serverId — 2423-2437: owner ‖ row `server.delete` ‖ `checkIsAdmin('admin.write')` ‖ user-role `server.delete`/`*`/node-manage.
10. **core.ts** POST /:serverId/storage/resize — 2273-2302: owner ‖ any row + write-capable perm ‖ `decideServerAccess("server.update")` on user roles.
11. **variables.ts:86-109** — owner ‖ row `server.update` ‖ user-role `*`/`admin.write`/`server.update` ‖ node-manage (environment variables, i.e. server secrets).

Additional unscoped sites beyond the claim's list: **alerts.ts** local `ensureServerAccess` (24-76, no actor param; 8 call sites) and `isAdminUser` (12-23, resolves **user** DB permissions — a scoped key of an admin.write user passes as admin); **cs2.ts:179** (4-arg). The skipped family is bigger than reported.

**Fix stands, broadened:** thread `request.user` as the actor through every `ensureServerAccess`-style helper (or centralize: make the helpers read an actor from the request), and convert the bespoke local helpers (backups, tasks, alerts, network, core, variables, console-stream, SFTP) to the canonical actor-aware check.

---

## Claim 10 — GET /api/servers/database-hosts exposes DB hostnames/ports without an admin gate

**VERDICT: CONFIRMED**

Decisive code (routes/servers/databases.ts:10-39):
```ts
const isPrivileged = rolePerms.includes("*") || rolePerms.includes("admin.write") ||
  rolePerms.includes("admin.read") || rolePerms.includes("database.read") ||
  rolePerms.includes("database.create") || rolePerms.includes("server.read");     // 17-23
const hasAnyServer = isPrivileged ? true : Boolean(
  (await prisma.server.count({ where: { ownerId: userId } })) > 0 ||
  (await prisma.serverAccess.count({ where: { userId } })) > 0);                  // 24-29
...
const hosts = await prisma.databaseHost.findMany({
  orderBy: { name: "asc" },
  select: { id: true, name: true, host: true, port: true },                        // 33-36
```
- Any user owning ≥1 server **or holding any ServerAccess row** (or any server.read role) receives every DatabaseHost's `host` and `port` — internal infrastructure metadata, cross-tenant. No admin gate for those fields. Credentials are not selected (mitigating, but host/port exposure stands — recon value for targeting the DB layer).

**Fix stands:** return `host`/`port` only to admin.read+/database-management holders; expose only `id`/`name` for picker contexts.

---

## Claim 11 — GET /api/update/check is auth-only while /api/admin/update/* requires admin bits

**VERDICT: CONFIRMED**

Decisive code:
- server.ts:1875-1892 — `app.get("/api/update/check", { preHandler: [(app as any).authenticate] ... })` with **no permission check anywhere in the handler**; returns `currentVersion`, `latestVersion`, `updateAvailable`, `isDocker` to any authenticated user (panel version disclosure + update-pending recon).
- routes/update.ts — every sibling route requires `checkPerm(request, 'admin.write')`: /status (38-44), /settings (69-75), PUT settings (95-99), trigger (163-167), 183-187, 208-212.
- Note: update.ts's `checkPerm` (32-35) is itself raw-includes — `*` or literal `admin.write` — so admin.read is denied there too (a read endpoint gated on a write bit; minor contract wrinkle, not part of the claim).

**Fix stands:** gate /api/update/check on `admin.read` via hasGrant, or fold it into /api/admin/update/status.

---

## Claim 12 — console command route gate uses admin.read; gateway re-check is the only correct layer

**VERDICT: CONFIRMED** (originally my own finding; re-verified as skeptic)

Decisive code:
- console-stream.ts:184 — `const isAdmin = checkIsAdmin(request, 'admin.read');` and 197-202: `hasWritePermission = access?.permissions?.includes('console.write') || server.ownerId === userId || isAdmin || hasNodeAccessResult || hasRoleConsoleWrite;` — an `admin.read`-only holder **passes the route gate** (checkIsAdmin definition: _helpers.ts:1264-1267 — true for `*`, `admin.write`, **or** `admin.read`).
- Mitigation (the decisive second layer): gateway.ts:5421-5463 `sendConsoleCommand` — `const isAdmin = await this.userHasAdminWrite(userId)` (5435; hasPermission(prisma, userId, "admin.write") — admin.read does not satisfy), and gates 5446-5463 throw 403 for a pure admin.read caller. The route's write check is therefore wrong-by-intent and the deep layer is what actually enforces the owner's contract.
- No other mitigation exists on the path; and the gateway check cannot see API-key scope (userId only), so the key-scope bypass (claim 9 family) applies here too.

**Fix stands:** change console-stream.ts:184 to `checkIsAdmin(request, 'admin.write')` and add `enforceKeyScope(request.user, 'console.write')`.

---

## Claim 13 — metrics.ts raw rolePerms.includes('server.read') denies admin.read and bare admin.write

**VERDICT: CONFIRMED**

Decisive code (metrics.ts:83-90; identical at 349-356):
```ts
const hasNodeAccessToServer =
  (await hasNodeAccess(prisma, userId, server.nodeId)) &&
  (rolePerms.includes("node.update") || rolePerms.includes("*"));   // 80-82 / 346-348
const canReadMetrics =
  server.ownerId === userId ||
  Boolean(access?.permissions?.includes("server.read")) ||
  rolePerms.includes("server.read") ||                              // raw includes
  hasNodeAccessToServer;
```
- `rolePerms` = `resolveServerPermissions(userId, ...)` — the user's actual permission strings; `admin.read` ≠ `server.read`, bare `admin.write` ≠ `server.read`.
- admin.read user on someone else's server: not owner, no row, no `server.read` in rolePerms, and `hasNodeAccess` = false (isAdminUser(requireWrite=true) excludes admin.read, permissions.ts:647-652) → **403**.
- Bare admin.write user: `hasNodeAccess` = true (isAdminUser(requireWrite=true) counts admin.write) but `rolePerms` has neither `node.update` nor `*` → `hasNodeAccessToServer` false → **403**.
- Only `*` sneaks through via the `hasNodeAccess && rolePerms.includes("*")` pairing (82/348).
- The comments at 73-74 and 339-340 ("global role grant (server.read / admin)") claim admins pass — the code does not match the comment. This is the same raw-includes family as claims 1 and 14.

**Fix stands:** evaluate `canReadMetrics` with `hasGrant(rolePerms, 'server.read')` (or delegate to decideServerAccess), which admits admin.read and admin.write.

---

## Claim 14 — nodes.ts ensurePermission raw includes → admin.read 403 on reads, admin.write on writes

**VERDICT: NUANCED** — substance confirmed; endpoint counts corrected.

Decisive code (nodes.ts:57-66):
```ts
const ensurePermission = (request, reply, requiredPermission): boolean => {
  const perms: string[] = request.user?.permissions ?? [];
  if (perms.includes("*") || perms.includes(requiredPermission)) return true;
  apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "Insufficient permissions");
  return false;
};
```
- Raw includes: `admin.read` fails every `node.read`/`node.view_stats` check (403 on all node reads); `admin.write` fails every `node.update`/`node.manage_allocation`/`node.assign`/`node.create`/`node.delete` check (403 on node writes); only `*` or the exact node bit passes.
- Count correction (measured): check-site usage is **12× `node.read` + 1× `node.view_stats`** (reads, across the 16 GET routes) and **6× `node.update` + 5× `node.manage_allocation` + 5× `node.assign` + 3× `node.create` + 1× `node.delete`** (writes across the 21 mutating routes) plus **3× literal `admin.write`** checks (which admin.read fails but admin.write passes). The claim's "16 reads / 11 writes" is endpoint-approximate; the mechanism and impact are exactly as stated.
- Mitigation search: none — this file never uses hasGrant; the raw check also means an `admin.write`-only role cannot manage nodes at all (contract point 2 violation), and `admin.read` cannot even list nodes (contract point 1).

**Fix stands:** replace ensurePermission's body with `hasGrant(perms, requiredPermission)` (import from lib/permissions).

---

## Claim 15 — dashboard.ts:50 isGlobalAdmin = `*` || admin.write only → admin.read scoped

**VERDICT: CONFIRMED** (with one nuance)

Decisive code (dashboard.ts:43-78):
```ts
const isGlobalAdmin = perms.includes('*') || perms.includes('admin.write');   // 50
const isAdmin = isGlobalAdmin || perms.includes('admin.read');                // 51
...
if (isGlobalAdmin) { serverWhere = {}; } else { /* owner + accessRows + assigned nodes */ }  // 56-78
```
- Global (unscoped) server counts/inventory require `*`/`admin.write`; an `admin.read`-only user gets server counts scoped to owned + shared + node-assigned servers — contradicting the owner's contract (admin.read = read the entire panel).
- Nuance: admin.read **does** receive global node and alert counts (`wantNodes`/`wantAlerts` at 83-84 drive the fleet-global `globalCounts` query at 90-110) — only the server inventory is scoped. Also note `perms` here is the request snapshot (key-scoped for API keys), and lines 46-48 use raw includes too (`server.read`/`node.read`/`alert.read` — but `isAdmin` at 51 covers admin.read for the node/alert flags).

**Fix stands:** include `admin.read` in `isGlobalAdmin` for the read-only server inventory (the counts are read-only data), keeping write actions elsewhere gated on admin.write.

---

## Summary

| # | Claim | Verdict |
|---|-------|---------|
| 1 | canManageUsers raw includes | CONFIRMED |
| 2 | assign-wildcard unguarded | CONFIRMED |
| 3 | roles.ts DELETE demotion bypass | CONFIRMED (citation corrected) |
| 4 | role.edit hierarchy gap | CONFIRMED |
| 5 | better-auth User.role channel | CONFIRMED |
| 6 | PUT users body-shape bypass | NUANCED (password leg blocked by better-auth; email-change takeover + scoped-grant gap real) |
| 7 | invites token leak | CONFIRMED |
| 8 | SFTP token derivation | NUANCED (owner-[] only for imported servers; admin-key ['*'] and admin.read-[] confirmed) |
| 9 | enforceKeyScope family | CONFIRMED (family larger than claimed) |
| 10 | database-hosts exposure | CONFIRMED |
| 11 | update/check auth-only | CONFIRMED |
| 12 | console command admin.read route gate | CONFIRMED |
| 13 | metrics.ts raw includes | CONFIRMED |
| 14 | nodes.ts ensurePermission | NUANCED (counts corrected; substance exact) |
| 15 | dashboard isGlobalAdmin | CONFIRMED |

**Changes to the P0 fix approach:**
1. Claim 6 — re-scope the P0: the `user.set_roles` account-takeover works via **email change + password-reset flow**, not via the in-route password reset (better-auth's own admin check blocks that leg). Any fix must gate profile fields on `user.update` independently of `roleIds`, and must NOT lean on the better-auth User.role check — which is itself unsynced (claim 5) and currently blocks *legit* panel admins from resetting passwords.
2. Claims 1/13/14/15 share one root cause — raw `perms.includes` instead of `hasGrant` in local helpers (admin.ts canManageUsers, nodes.ts ensurePermission, metrics.ts canReadMetrics, dashboard.ts flags, update.ts checkPerm). One mechanical sweep fixes four P0-contract violations at once.
3. Claim 9 — the key-scope fix should be centralized (actor-aware canonical helper) rather than patched per-route: verified skip sites span ≥ 11 files including two bespoke helpers with no actor parameter at all (backups.ts, alerts.ts), plus SFTP (claim 8) where the bypass yields `['*']` file R/W.
