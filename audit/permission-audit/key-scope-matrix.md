# API-Key Scope Enforcement Matrix — all backend routes

Scope: every HTTP endpoint registered under `catalyst-backend/src/routes/**` — 309 total: all 296 operations in `api/openapi.json` plus 13 non-OpenAPI endpoints (env 5, MCP 3, console stream/command 2, metrics SSE 1, per-server events SSE 1, plugin assets 1). Audit-only; no source modified.

## 1. How API-key auth works (mechanics, end-to-end)

**Identity → permissions** (`src/server.ts:442-595`, `authenticate`):
- **API key** (`Authorization: Bearer catalyst…`): the key record is verified, then `request.user = { userId, email, username, apiKeyId, permissions }` where `permissions` is **the key's own scoped set** (server.ts:482-517). Two flavors: scoped keys keep their stored set (validated live as a subset of the owner's current role permissions, server.ts:494-508 — this bounds keys *above*, never *below*); `allPermissions` keys inherit the owner's live full set (server.ts:483-492) — full power by design.
- **Session cookie**: `request.user.permissions` = the user's full role-resolved set (server.ts:572-585).
- So **`request.user.permissions` is the key's scope for key auth, and the owner's full set for sessions.** There is no global key-scope hook; the only onRequest hook is a `/docs` gate (server.ts:842-848).

**The key-scope enforcement primitive** — `enforceKeyScope(actor, permission)` (`src/routes/servers/_helpers.ts:487-493`): no-op unless `actor.apiKeyId` is set; otherwise requires `hasGrant(actor.permissions, permission)` (i.e. the **key itself** must hold the permission; `*`/exact/`admin.write`-implies-all/`admin.read`-implies-reads apply, permissions.ts:143-149).

**Where it is threaded** — `ensureServerAccess(serverId, userId, permission, reply, actor?)` (_helpers.ts:495-558) computes the *user-level* decision from the DB (owner / ServerAccess row / global+scoped role perms / node-assignment+`node.update`) and then applies `enforceKeyScope(actor, permission)` as a final conjunction at _helpers.ts:553-556. **The `actor` parameter is optional** — omitting it (4 args) skips the key check entirely. Same for `ensureDatabasePermission` (actor at _helpers.ts:1446-1515) and `requireFileAccess` (files.ts:76-82).

**The other (inherently key-scoped) check family** — anything that reads `request.user.permissions` directly:
- `rbac.requirePermission/requireAny/All` (middleware/rbac.ts:57-61, 90-94, 123-127) short-circuit on `requestPermissions(request)` — which authenticate() always populates — so **middleware-gated routes are key-scoped by construction**;
- request-based helpers: `checkPerm`/`checkAnyPerm`/`checkIsAdmin` (_helpers.ts:1254-1267), local copies (admin.ts:73-80, nodes.ts:57-66, env.ts:28-32, update.ts:32-35, plugins.ts:45-74, bulk-servers.ts:30-44, dashboard.ts:22), `hasPermission(request,…)`/`isAdmin(request)` from permissions-catalog (permissions-catalog.ts:200-211, used by api-keys.ts:47,167).

**The bypass class** = DB-resolved checks that never consult `request.user`: `ensureServerAccess` without actor, `canAccessServer` (_helpers.ts:1305-1348), `canManageSubusers` (_helpers.ts:469-485), `ensurePowerAccess` (power.ts:56-95), `ensureBackupAccess` (backups.ts:43-95), tasks helpers (tasks.ts:20-112), metrics inline logic (metrics.ts:75-90, 341-356), console-stream gates (console-stream.ts:48-79, 175-205), invites/network/variables/stats/core inline DB logic, and the DB-permission family `hasPermission(prisma, userId, …)` / `hasAnyPermission(prisma, userId, …)` / `getUserPermissions` (roles.ts:208, templates.ts:64-76, locations.ts:11-22, nests.ts:13-25, alerts.ts:12-27) — the last family is the **ADMIN-KEY-AMPLIFIED** class: the gate itself resolves the owner's roles from the DB, so *any* valid key, however narrow, from a user who holds the gate permission passes.

**MCP note**: `POST/GET/DELETE /api/mcp` authenticates a Bearer API key and proxies tools via `app.inject` with the **same raw key** (mcp.ts:128-137) — upstream REST routes see the key's auth, so MCP tools inherit exactly the per-route behavior below. Fixing the REST matrix fixes MCP; until then every bypass below is also reachable through MCP tools.

## 2. Classification rules

| Class | Meaning |
|---|---|
| **KEY-SCOPE-ENFORCED** | the effective gate consults `request.user.permissions` (key's set): request-based check, rbac middleware, or `actor`-threaded `ensureServerAccess`/`ensureDatabasePermission`/`requireFileAccess` |
| **KEY-SCOPE-BYPASSED** | server-scoped gate resolves the **owner's** DB state (ServerAccess/roles/grants/node) and never consults `request.user` — a narrow key inherits the owner's per-server powers |
| **ADMIN-KEY-AMPLIFIED** | global route whose admin/role gate resolves the **owner's** roles from the DB — a key scoped to e.g. `server.read` from a privileged user hits the full admin surface |
| **NOT-APPLICABLE** | self-scoped (acts only on the caller's own account), agent-credential routes, session-cookie-only SSE (API keys cannot authenticate), auth-only-by-design |
| **OK-UNAUTH** | unauthenticated by design |

## 3. Matrix by file (309 endpoints)

Legend: E = KEY-SCOPE-ENFORCED, B = KEY-SCOPE-BYPASSED, A = ADMIN-KEY-AMPLIFIED, N/A = NOT-APPLICABLE, U = OK-UNAUTH.

### 3.1 `routes/admin.ts` — 52 endpoints — **all E** (`/api/admin/*`)
Gate idiom: local `checkPerm`/`checkAnyPerm` reading `request.user.permissions` (admin.ts:73-80) — key must hold each route's own permission. Verified gate lines: stats:153, users:185/310/572/581/884, roles-list:908, user-delete:934/959, ban:1095/1112, unban:1172, passkeys:1222/1229, 2fa-delete:1251/1258, enforce-2fa:1281/1317, accounts:1281, verify-email:1356, nodes:1403, servers:1452, actions:1585, audit-logs:2223/2315, system-errors:2405/2480/2593/2752/2786, security-settings:2849/2864, mcp-settings:3001/3015, localization:3056/3070, health:3114 (`['*','admin.read']`), ip-pools:3215/3287/3398/3505, db-hosts:3578/3599/3690/3794/3840, db-status:3947, smtp:4007/4027, mod-manager:4119/4134, theme:4177/4192/4220, lockouts:4327/4379, oidc:4419/4456, upload-limit: after :4543 (same idiom). Escalation guards also read `request.user.permissions` (admin.ts:352-360, 422-429, 640-648, 737-759, 1593).

### 3.2 `routes/api-keys.ts` — 4 — **all E**
`hasPermission(request,'apikey.manage')` + `isAdmin(request)` (permissions-catalog request-based; api-keys.ts:31-32, 47, 167). Routes: permissions-catalog:55, my-permissions:64, create:73, list:163.

### 3.3 `routes/nodes.ts` — 37 — **36 E, 1 N/A**
`ensurePermission` reads `request.user.permissions` (nodes.ts:57-66) on every route (verified per-route: auto-update:276, create:357/844, list:569 + inline admin filter 574-578, get:634, deployment-token:672/688, api-key get/post:778-785/862, update:995/997-999, stats:1140, delete:1411/1413-1415, ip-pools:1497, ip-availability:1543, allocations:1587/1663/1731/1775/1809, assignments:1870/1904/2037, accessible:2102, unregistered:2146/2193, import-server:2324, assign-wildcard:2512/2623, agent routes:2690/2781/2824/2948/2995/3071/3075/3129/3165/3203, host-network: after :3282 same idiom). N/A: `POST /:nodeId/heartbeat` (nodes.ts:1267) — agent token auth (`x-catalyst-node-token`), not user keys.

### 3.4 `routes/plugins.ts` — 15 — **14 E, 1 N/A**
`ensureAdmin(request, reply, 'admin.read'|'admin.write')` reads `request.user.permissions` (plugins.ts:45-50, 66-74; gates at 246, 274, 296, 343, 385, 429, 493, 734, 825, 871, 966). N/A: `GET /plugins-assets/:name/:filename` (plugins.ts:568) — authenticate-only static assets.

### 3.5 `routes/update.ts` — 6 — **all E**
`checkPerm(request,'admin.write')` (update.ts:32-35; gates 42, 73, 99, 167, 187, 212).

### 3.6 `routes/migration.ts` — 10 — **all E**
`requireAdmin` reads `request.user.permissions` (`*`/`admin.write`) (migration.ts:35-44) on all 10 routes (:52, :101, :142, :356, :372, :393, :410, :427, :445, :484).

### 3.7 `routes/env.ts` — 5 (not in OpenAPI) — **all E**
Local `checkPerm` on `request.user.permissions` (env.ts:28-32): GET /:34 (admin.read), GET /restart-status:55, PUT /:64, DELETE /:key:103, POST /restart:137 (`RESTART_PERMISSION`).

### 3.8 `routes/mcp.ts` — 3 (not in OpenAPI) — **E (by proxy)**
POST/GET/DELETE `/api/mcp` (mcp.ts:157, 201, 246): Bearer-key auth (mcp.ts:71-110) + upstream calls re-inject the same key (mcp.ts:128-137) — key scope = whatever the upstream route enforces (see those rows).

### 3.9 `routes/dashboard.ts` — 3 — **all E**
Reads `request.user.permissions` (dashboard.ts:22, 43-51, 149-152) for stats/activity/resources.

### 3.10 `routes/bulk-servers.ts` — 4 — **all E**
`ensureBulkPermission` + `hasServerAccess` read `request.user.permissions` first (bulk-servers.ts:30-44, 51-97): suspend:118, unsuspend:301, delete:457, status:627/665-673.

### 3.11 `routes/servers/files.ts` — 12 — **all E**
`requireFileAccess(..., request.user)` on every route (files.ts:76-82; calls 115, 163, 206, 309, 363, 415, 464, 510 (logs/console.read), 589, 653, 720, 777) → `enforceKeyScope` runs for keys.

### 3.12 `routes/servers/databases.ts` — 5 — **4 E, 1 B**
E: list/create/rotate/delete — `ensureDatabasePermission(..., request.user)` (databases.ts:48-54, 102-108, 283-289, 395-401) → `enforceKeyScope` (_helpers.ts:1502-1512). **B**: `GET /database-hosts` (databases.ts:10-40) — gate is `resolveServerPermissions(userId,"","")` + DB ownership/ServerAccess counts; a key scoped to anything (or nothing) from a user who owns one server lists DB hosts (host+port). Fix: consult `request.user.permissions` (require any `database.*`/`server.read`-class perm).

### 3.13 `routes/servers/power.ts` — 11 — **3 E, 8 B**
E: `POST /eula` (power.ts:467→483, `ensureServerAccess(..., request.user)`); suspend:1331→1339 and unsuspend:1507→1514 via `ensureSuspendPermission` (_helpers.ts:1269-1279, request-based `['*','admin.write','server.suspend']`).
**B** (all via `ensurePowerAccess`, power.ts:56-95 — owner fast-path, DB ServerAccess/roles/node; only the `checkIsAdmin` branch at :65 is key-checked): install:170→193, reinstall:267→290, cancel-install:364→387, rebuild:532→555, start:688→712, stop:889→913, kill:1025→1048, restart:1156→1180. A `server.read`-scoped key from the owner (or any power-authorized user) starts/stops/**kills** servers. Fix: append `enforceKeyScope(request.user, <route perm>)` after the fast paths, or thread `request.user` like files.ts.

### 3.14 `routes/servers/admin-ops.ts` — 8 — **4 E, 4 B**
E: restart-policy:33→66-72, reset-crash-count:96→114-120 (`ensureServerAccess(..., request.user)`); archive:830→838 and restore:900→908 via `ensureSuspendPermission` (request-based).
**B**: `PATCH /:id/backup-settings` (139→218) — `ensureServerAccess(id,userId,'backup.create',reply)` **without actor**; rewrites S3/SFTP backup credentials (the file's own comment at 215-217 warns this can redirect backups to an attacker endpoint). `POST /:id/transfer` (361→399-412): owner/ServerAccess/role/node DB paths, only `checkIsAdmin` key-checked. `GET /:serverId/transfer-candidates` (683→699): owner path bypasses. `POST /:serverId/transfer-ownership` (734→756): owner path bypasses — a narrow key transfers ownership. Fix: thread `request.user` (as :66-72 already does) / add `enforceKeyScope`.

### 3.15 `routes/servers/core.ts` — 9 — **5 E, 4 B**
E: create:291→339/349 (`checkPerm(request,'server.create')`/`user.create`), clone-preflight:889→897, clone:955→1000, clone-retry:1307→1314, PUT:1803→1827 (`ensureServerAccess(..., request.user)`). (Clone source-visibility uses `canAccessServer` :908/1014/1322 — DB; the primary gate is still request-based.)
**B**: `GET /` (1428; per-server filter `canAccessServer` DB + `checkIsAdmin` fast path :1443), `GET /:serverId` (1706; DB decision :1733-1760 — returns server detail + connection info), `POST /storage/resize` (2248; owner/ServerAccess/roles DB :2273-2290), `DELETE /:serverId` (2396; owner/ServerAccess DB :2424-2435, only `checkIsAdmin` key-checked). Fix: `enforceKeyScope(request.user, 'server.read'|'server.update'|'server.delete')` respectively, or route through `ensureServerAccess` with actor.

### 3.16 `routes/servers/stats.ts` — 2 — **both B**
`canAccessServer` (stats.ts:29, 129) — DB owner resolution; a narrow key reads stats-history/activity for every server the owner can see. Fix: `enforceKeyScope(request.user,'server.read')`.

### 3.17 `routes/servers/variables.ts` — 2 — **both B**
GET:9→24-41 (owner/ServerAccess server.read DB; `checkIsAdmin('admin.read')` key-checked is only one branch); PATCH:63→86-110 (owner/ServerAccess server.update/roles DB, no request consult). PATCH rewrites server environment (startup variables). Fix: `enforceKeyScope` with `server.read`/`server.update`.

### 3.18 `routes/servers/network.ts` — 4 — **all B**
GET allocations:33→57 (`canAccessServer`); POST:106→134-150, DELETE:348→369-385, primary:474→493-509 (owner || ServerAccess `server.update` DB || `checkIsAdmin` key-checked || roles/node DB). A narrow key rewires port allocations. Fix: `enforceKeyScope(request.user,'server.update')`.

### 3.19 `routes/backups.ts` — 6 — **all B**
`ensureBackupAccess(serverId, userId, reply, permission)` (backups.ts:43-95) — **no actor parameter exists**; owner fast-path :64, ServerAccess DB :65-73, `hasGrant(rolePerms,…)` DB :76-87. Affected: create:99, list:165, get:254, restore:297, delete:456, download:528. A `server.read` key from an authorized user **downloads** backups (cross-tenant exfil, per the file's own comment :83-85), **restores** (overwrites server files) and **deletes** them. Fix: add actor param + `enforceKeyScope` (mirror files.ts), or gate via `ensureServerAccess(..., request.user)`.

### 3.20 `routes/tasks.ts` — 6 — **all B**
`ensureSchedulePermission`/`ensureCommandPermission` (tasks.ts:20-85, 86-112) never touch `request.user`. create:115→144, list:216→223, get:241→248, update:272→287, delete:392→399, execute:446→453. A narrow key creates/updates/**executes** scheduled tasks incl. console-command tasks (execute runs arbitrary container commands). Fix: `enforceKeyScope(request.user,'server.schedule')` (+`console.write` for command tasks).

### 3.21 `routes/servers/mod-plugins.ts` — 16 — **all B** (detailed in server-extras.md)
All 16 `ensureServerAccess(…, reply)` calls omit actor (:64, :134, :276, :341, :495, :558, :680, :744, :933, :982, :1036, :1101, :1158, :1275, :1387, :1528). A `server.read` key installs/uninstalls/updates mods & plugins (file.write-class writes). Fix: pass `request.user`.

### 3.22 `routes/servers/cs2.ts` — 6 — **all B** (detailed in server-extras.md)
`ensureAccess` wrapper (cs2.ts:177-180) drops the actor. frameworks:198→204, releases:232→242, fw-install:269→280, fw-uninstall:375→384, plugins:455→461, plugins-uninstall:486→494. Fix: pass `request.user`.

### 3.23 `routes/servers/invites.ts` — 10 — **7 B, 1 N/A, 2 U**
B (DB-resolved `canAccessServer`/`canManageSubusers`, no request consult): GET permissions:38→54, GET invites:77→93, POST invites:107→133, regenerate:240→257, DELETE invite:324→340, POST access:622→646, DELETE access:707→726. A narrow key from the owner/admin mints subuser invites and edits access grants. N/A: POST /invites/accept:445 (self-service, email-locked :395-399). U: POST /invites/register:466, GET /invites/:token:581 (token-gated by design). Fix: `enforceKeyScope(request.user, …)` on the 7 auth'd routes (interim `admin.write` for manage-path routes).

### 3.24 `routes/metrics.ts` — 3 — **2 B, 1 E**
B: GET /servers/:id/metrics:22→83-90 and /stats:278→349-356 — inline DB resolution (`rolePerms.includes("server.read")`, node pairing :80-82/:346-348); narrow keys read other tenants' metrics where the owner can. E: GET /nodes/:id/metrics:401→405-412 — reads `request.user.permissions` (`*`/`admin.write`/`admin.read`) so the key must hold the admin bit. Fix: `enforceKeyScope(request.user,'server.read')` on the two server routes.

### 3.25 `routes/alerts.ts` — 11 — **all A (ADMIN-KEY-AMPLIFIED)**
Local `isAdminUser(userId)` → `getUserPermissions(prisma,userId)` = **owner's** DB perms (alerts.ts:12-27); per-server paths also DB (ServerAccess/roles/node, alerts.ts:29-75). alert-rules create:79→84, list:197→209, get:230→235, update:254→259, delete:319→324, deliveries:361→366, alerts list:396→420, get:488→493, resolve:536→519 area, bulk-resolve:597, stats:669. A `server.read`-scoped key from an alert-admin mutates alert rules and resolves alerts. Fix: replace the DB admin check with request-based `checkIsAdmin(request,…)`; per-server paths append `enforceKeyScope(request.user, requiredPerm)`.

### 3.26 `routes/roles.ts` — 13 — **all A**
Route gate `hasPermission(prisma, userId, permission)` (roles.ts:206-211) — DB owner perms (escalation guards deliberately resolve live, :65-71 — keep those, they're anti-escalation, but the *gate* must be request-based). list:217, get:252, create:338, update:440, delete:566, add-perm:632, remove-perm:718, assign-user:793, remove-user:917, user-roles:988, presets:1038, role-nodes:1057, user-nodes:1164. A narrow key from a role-admin **creates/edits roles** (panel-wide privilege surface). Fix: gate on `hasPermission(request, permission)` (permissions-catalog request-based) — key must hold `role.*`.

### 3.27 `routes/templates.ts` — 7 — **all A**
`ensurePermission` → `hasPermission(prisma, userId, …)` DB (templates.ts:64-76). list:83, get:157, create:188, update:308, delete:442, import:481, import-batch:598. Fix: request-based check (key must hold `template.*`).

### 3.28 `routes/locations.ts` — 5 / `routes/nests.ts` — 5 — **all A**
`ensureAnyPermission(userId,…)` → `hasAnyPermission(prisma, userId, …)` DB (locations.ts:11-22; nests.ts:13-25). Locations: 25/55/90/143/204; nests: 26/52/79/130/188. Fix: request-based check (`location.*` / `template.*`).

### 3.29 `routes/auth.ts` — 15 — **4 U, 11 N/A (self-scoped)**
U: register:94, login:217, forgot-password:749, reset-password/validate:776. N/A self-scoped (act on `request.user.userId`, no permission gate): me:358, profile:402, sso/unlink:438, PATCH profile:480 (username/names only — no password/email), preferences:565, avatar POST/DELETE:594/642, audit-log:658, export:679, api-keys list:731, profile/delete:802 (**password required** :812-823 — a key alone cannot delete the account). Hardening note: `GET /profile/api-keys` (731) lets any scoped key enumerate the owner's other keys' metadata, and sso/unlink + avatar mutations are account changes a narrow key can perform — consider requiring a session for account mutations.

### 3.30 Session-only SSE / agent / auth-only / unauth
- `routes/admin-events.ts` GET /api/admin/events:105 — **N/A**: session-cookie auth only (admin-events.ts:107-124, `auth.api.getSession`); API keys are rejected outright (admin gate is DB `hasPermission(prisma,…)` :126-129, moot for keys).
- `routes/sse-events.ts` GET /api/servers/:serverId/events:122 (incl. `all-servers`) — **N/A**: session-only (sse-events.ts:130-146); per-server/global authz DB-resolved (:150-215) but unreachable with keys.
- `routes/metrics-stream.ts` GET /api/servers/:id/metrics/stream:41 — **E**: `ensureServerAccess(...,'server.read',reply,(request as any).user)` (metrics-stream.ts:55).
- `routes/console-stream.ts` — 2, **both B**: GET /:serverId/console/stream:33 (gate :48-79 — owner/ServerAccess console.read DB, `checkIsAdmin('admin.read')` key-checked branch, roles/node DB) and **POST /:serverId/console/command:151 (gate :175-205)** — a narrow key from any console-authorized user **executes arbitrary console commands**. Fix: `enforceKeyScope(request.user,'console.read'/'console.write')`. (Neither route is in OpenAPI.)
- `routes/file-tunnel.ts` — 4 — **N/A**: agent allowlist/node-token auth (file-tunnel.ts:67, 107, 150, 209), not user keys.
- `routes/provider-keys.ts` GET /api/providers/status:14 — **N/A**: authenticate-only booleans (documented, provider-keys.ts:5-12).
- `routes/settings.ts` GET /api/settings/locale:30 — **U** (display-only, pre-login; settings.ts:14-18).
- `routes/setup.ts` — 3 — **U** by design (status:161, environment:213, complete:383; gated on setup-incomplete state).

## 4. Totals

| Classification | Count | Files |
|---|---|---|
| KEY-SCOPE-ENFORCED | **167** | admin 52, nodes 36, plugins 14, files 12, migration 10, update 6, api-keys 4, bulk 4, admin-ops 4, core 5, databases 4, power 3, dashboard 3, env 5, mcp 3, metrics(node) 1, metrics-stream 1 |
| KEY-SCOPE-BYPASSED | **70** | mod-plugins 16, cs2 6, invites 7, tasks 6, backups 6, power 8, admin-ops 4, core 4, network 4, console-stream 2, variables 2, stats 2, metrics 2, databases 1 |
| ADMIN-KEY-AMPLIFIED | **41** | roles 13, alerts 11, templates 7, locations 5, nests 5 |
| OK-UNAUTH | **10** | auth 4, setup 3, invites 2, settings 1 |
| NOT-APPLICABLE | **21** | auth self 11, file-tunnel 4, heartbeat 1, admin-events 1, sse-events 1, provider-keys 1, plugins-assets 1, invites accept 1 |
| **Total** | **309** | (296 OpenAPI + 13 non-OpenAPI) |

## 5. Five worst bypasses

1. **`POST /api/servers/:id/console/command`** — console-stream.ts:151, gate :175-205 — arbitrary command execution in the server container; key scope never consulted (DB ServerAccess/roles/owner paths). A `server.read`-scoped key from the owner runs any command.
2. **Backups family** — backups.ts:43-95 helper (no actor param at all) over routes :99/:165/:254/:297/:456/:528 — a narrow key can **download** (cross-tenant exfiltration), **restore** (overwrite server files) and **delete** backups.
3. **`PATCH /api/servers/:id/backup-settings`** — admin-ops.ts:139, gate :218 (ensureServerAccess **without** actor) — rewrites S3/SFTP backup credentials; the code's own comment (:215-217) flags credential redirect as full-server exfiltration.
4. **Power operations** — power.ts `ensurePowerAccess` :56-95 for install/reinstall/cancel-install/rebuild/start/stop/**kill**/restart (:193/:290/:387/:555/:712/:913/:1048/:1180) — narrow keys inherit the owner's power rights; only the `checkIsAdmin` branch is key-checked.
5. **Ownership transfer + server deletion** — admin-ops.ts:734→756 (owner path bypasses) and core.ts:2396→2424-2435 (owner/ServerAccess DB, only the admin branch key-checked) — a narrow key from the owner **transfers ownership** or **deletes the server**. (Same class, previously reported: tasks execute, mod/plugin installs, invite minting.)

## 6. Recommended canonical fix (systemic, not 100 patches)

**Why the current enforced pattern works** (evaluate): `enforceKeyScope(actor, permission)` (_helpers.ts:487-493) is a *conjunction*: the DB decision (owner/ServerAccess/roles) authorizes the **user**, then the key check authorizes the **key**. Files that pass `request.user` — files.ts:76-82+:115, metrics-stream.ts:55, databases.ts:48-54, admin-ops.ts:66-72, core.ts:1827, power.ts:483 — get both layers. It fails as a *pattern* only because the parameter is optional and five sibling helper families never grew an actor at all.

**Canonical design — two layers, one choke point each:**

1. **Route-declarative key-scope hook (the systemic fix).** Register one global hook right where `authenticate` is decorated (server.ts:595):
   ```ts
   app.addHook("preHandler", async (request, reply) => {
     if (!request.user?.apiKeyId) return;                       // sessions unaffected
     const required = (request.routeOptions?.config as any)?.requiredPermission;
     if (!required) return;
     if (!hasGrant(request.user.permissions ?? [], required))   // _helpers.ts:487 logic
       return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "Forbidden");
   });
   ```
   Each route then declares `{ onRequest: [app.authenticate], config: { requiredPermission: "file.write" } }` — the same config-object style the codebase already uses for `rateLimit` (e.g. mod-plugins.ts:115). One shared enforcement point; per-route cost is one config line; forgetting it is visible in the route table (and testable). Multi-permission routes use `requiredPermissions: string[]` with `checkAnyPerm` semantics.
2. **Harden the helper layer (backfill for the 70 B / 41 A rows).**
   - Make `ensureServerAccess`'s `actor` **required** (TypeScript: non-optional; runtime: throw) — the compiler lights up every omission site at once (_helpers.ts:495-558). Add the same actor parameter to `ensureBackupAccess` (backups.ts:43), `ensureSchedulePermission`/`ensureCommandPermission` (tasks.ts:20/86), and `ensurePowerAccess` (power.ts:56 — insert the key check after the owner/admin fast paths).
   - `canAccessServer` / `canManageSubusers` (_helpers.ts:1305/469): accept `actor` and end with `enforceKeyScope(actor, 'server.read')` (reads) / the manage-path equivalent.
   - DB-gated global routes (A class): swap `hasPermission(prisma, userId, p)` / `hasAnyPermission(prisma, userId, …)` / `getUserPermissions` in the **route gates** for the request-based `hasPermission(request, p)` / `checkIsAdmin(request, …)` (permissions-catalog.ts:200-211, _helpers.ts:1254-1267) — roles.ts:206-211, templates.ts:64-76, locations.ts:11-22, nests.ts:13-25, alerts.ts:12-27. Keep roles.ts's *escalation* guards on live DB resolution (roles.ts:65-71) — that is anti-escalation, not a route gate.
   - Inline-DB routes (metrics.ts:83-90/349-356, core GET/DELETE/resize, network, variables, stats, invites, console-stream, databases /database-hosts): either migrate to `ensureServerAccess(..., request.user)` or append `if (!enforceKeyScope(request.user, PERM)) return 403`.
3. **Keep what already works**: rbac middleware (rbac.ts:57-61) and all request-based checkers are already key-scoped — no change. The `allPermissions` key flavor (server.ts:483-492) intentionally carries full owner power — document it as such.
4. **CI guard against regression**: a test asserting (a) no `ensureServerAccess(`/`ensureDatabasePermission(` call site passes only 4 positional args, and (b) every authenticated route either carries `requiredPermission` config or routes through an actor-threaded helper. The repo already has source-pattern regression tests to model this on (e.g. `src/__tests__/security-wave2-regression.test.ts:257-259` greps source text).

Rollout order: hook + config on the 70 BYPASSED routes first (severity-ranked: console command, backups, backup-settings, power, destructive owner ops), then the 41 AMPLIFIED gates, then the helper signature hardening (compile-driven), then the CI guard.
