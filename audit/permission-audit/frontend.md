# Frontend Permission-Usage Audit — catalyst-frontend/src

Scope: every permission literal, permission-check helper, permission-catalog data source, admin-UI gate, subuser/API-key selector, permission-bearing type, and i18n label in `catalyst-frontend/src`. Audit only; no source modified.
Target contract: `admin.read` = READ over the entire panel + all servers; `admin.write` = READ+WRITE over everything; `*` = superadmin; every other permission narrowly targeted.

## 1. Executive summary

- **435 permission-literal occurrences across 43 non-test files** (plus 39 raw `includes('*')` sites, 4 locale files, 3 type files, 1 test file pinning helper semantics). All inventoried below.
- The one canonical check helper — `hasAnyPermission`/`permissionMatches` in `components/auth/ProtectedRoute.tsx:61-87` — is a **faithful mirror of backend `hasGrant`** (scoped prefix match, admin.write⇒any, admin.read⇒read). Correctly used by routes, nav, search, dashboard.
- **Two hardcoded, stale permission catalogs** (D-CATALOG): the role editor (`pages/admin/RolesPage.tsx:64-179`) cannot grant `server.update`, `server.install`, `server.reinstall`, `server.rebuild`, `backup.download`; the subuser-checklist fallback (`lib/serverPermissions.ts:25-51`) misses `server.update` + `backup.download`. The API-key selector, by contrast, is backend-driven (`GET /api/admin/api-keys/permissions-catalog`) and stays current.
- Frontend adds **one small A-READ-GAP of its own** (FleetHeartbeat hides node counts from `admin.read`) and **mirrors two backend-owned read gaps** (update status, transfer-candidates is fine here). Several **admin.write "blind spots"** exist where raw `permissions.includes(...)` checks (bypassing the helper) hide write UI from admin.write-only roles — inverse gaps, not leaks.
- Route→permission maps are duplicated in **5 places** (App.tsx, AdminRedirect.tsx, navSections.ts, SearchPalette.tsx, Sidebar ADMIN_PRIMARY) — the main rename risk.
- Server-level UI is largely backend-driven (`effectivePermissions` from `GET /api/servers/:id`), so power/tab gating auto-adapts to backend splits — except `ServerControls.tsx:52` (`canKill = canStop`), which hardcodes the kill≡stop conflation.

## 2. INVENTORY TABLE

### 2.1 Core helpers (the frontend `hasGrant` mirror)

| Permission literal | file:line | What it gates | Note |
|---|---|---|---|
| `ADMIN_PERMISSIONS` (admin.read/write, user.*, role.*, node.*, location.*, template.*, server.create/delete/suspend/transfer/schedule, backup.read/create/delete/restore, alert.*, apikey.manage — 45 entries) | components/auth/ProtectedRoute.tsx:8-51 | `/admin` area access via `requireAdmin`/`hasAnyAdminPermission` | Deliberately excludes operator perms (server.read/start/stop) — comment at :6-7; pinned by `__tests__/rbac-permissions.test.tsx:156-239,224-229` (incl. `not.toContain('server.kill')`) |
| `isReadPermission` literals `node.view_stats`, `backup.download`, `.read` suffix | components/auth/ProtectedRoute.tsx:53-59 | admin.read ⇒ read grants | Exact mirror of backend permissions.ts:130-136 |
| `admin.write` ⇒ any, `admin.read` ⇒ read, scoped prefix `perm:resource` | components/auth/ProtectedRoute.tsx:61-70 | `permissionMatches` semantics | Faithful hasGrant mirror incl. scoped grants (`node.delete:node_123`) |
| `*` | components/auth/ProtectedRoute.tsx:62,74,83 | wildcard | 39 other raw `includes('*')` sites (see Divergence D5) duplicate this weakly |
| `admin.read`/`admin.write` (hasAdminReadPermission, incl. scoped-grant exclusion) | services/api/admin-events.ts:222-232 | admin SSE stream subscribe (`/api/admin/events`) | Exact client mirror of backend gate routes/admin-events.ts:105; avoids 403-poisoning the shared EventSource |
| `user.permissions` source | stores/authStore.ts:75-80 (login/refresh → `/api/auth/me`), types/user.ts:8 | every gate in this report | Session perms = global role perms only (backend auth.ts:130,299); per-server grants arrive only via `server.effectivePermissions` |

### 2.2 Route-level gates (App.tsx)

| Permission literal | file:line | What it gates | Note |
|---|---|---|---|
| `admin.read`,`admin.write` | App.tsx:391 (/admin), 447 (/admin/servers), 505 (database), 529 (security), 541 (environment), 586 (audit-logs), 598 (system-errors), 624 (migration), 636 (plugins), 648 (plugin/:id) | page access | read-OK pattern — admin.read included everywhere except the two write pages below |
| family perms + `admin.read`,`admin.write` | App.tsx:371-378 (templates/:id), 404-412 (users), 425-433 (roles), 462-469 (nodes), 483-490 (templates), 566-573 (alerts) | page access | e.g. `/admin/users` open to user.read holders AND admin.read ✓ |
| `requireAdminWrite` (`*`/admin.write only) | App.tsx:517 (/admin/system), 553 (/admin/theme-settings) | write pages | SystemPage embeds update-status reads (UpdateSettings) — mirrors backend admin.write gate (routes/update.ts:38-212); see D4 |
| `apikey.manage`,`admin.read`,`admin.write` | App.tsx:611 | /admin/api-keys | ✓ |
| `admin.read`/`admin.write`/`admin.read` | App.tsx:168-171 | admin custom-CSS bootstrap load | comment: theme endpoint requires admin.read exactly ✓ |
| `requireAdmin` | App.tsx:346,358 (nodes/:id, nodes/:id/allocations) | node detail pages | any ADMIN_PERMISSIONS member (incl. bare node.read) ✓ |

### 2.3 Duplicated route→permission maps (5 parallel copies — sync hazard)

| Permission literal | file:line | What it gates | Note |
|---|---|---|---|
| per-page perm arrays | components/auth/AdminRedirect.tsx:5-19 | /admin deep-link redirect target | **raw `includes`** matching at :36-38 — scoped grants (`node.read:x`) don't match; also `admin.write`-only users short-circuit to /admin ✓ |
| nav link perms | components/layout/navSections.ts:54-99 | sidebar/sections nav | e.g. :60 nodes, :61 allServers(admin.read+write), :71 api-keys, :79 system (admin.write), :99 theme (admin.write) |
| search item perms | components/search/SearchPalette.tsx:175-656 (~40 entries) | search-result visibility | read entries `X.read`+`admin.read` (:187-355,528-584,646); write entries `admin.write` only (:271,369-511,601-629) ✓ consistent |
| ADMIN_PRIMARY links | components/layout/Sidebar.tsx:45-55 + :287-313 | admin rail links, version chip, plugin rows | canViewVersion = `['admin.read','admin.write']` :287 ✓ |
| plugin tab rows | components/layout/NavSectionsMenu.tsx:38-55 | sections popover | same pattern ✓ |

### 2.4 Role editor & role wizard (the D-CATALOG core)

| Permission literal | file:line | What it gates | Note |
|---|---|---|---|
| hardcoded `PERMISSION_CATEGORIES`: server.read/create/start/stop/delete/suspend/transfer/schedule; node.* (7); location.* (4); template.* (4); user.* (7); role.* (4); backup.read/create/delete/restore; file.read/write; console.read/write; database.* (4); alert.* (4); admin.read/write + apikey.manage | pages/admin/RolesPage.tsx:64-179 | role permission checkboxes (the grant UI) | **HARDCODED and STALE vs backend catalog** (permissions-catalog.ts:34-45,118): missing `server.update`, `server.install`, `server.reinstall`, `server.rebuild`, `backup.download` — five backend perms are ungrantable through the role editor. D1 |
| hardcoded `PERMISSION_PRESETS` (administrator `*`; moderator incl. `node.assign`; user server.read; support) | RolesPage.tsx:182-212 | preset chips | Diverges from backend PERMISSION_PRESETS (lib/permissions.ts:551-602 — backend moderator has no node.assign) |
| `formatPermission` switch — 54 cases | RolesPage.tsx:215-272 | label rendering | Unknown perms fall back to `Server › Update` (:270); i18n keys `roles.permissionLabels.*` in admin-access.json |
| `useServerPermissionOptions()` | RolesPage.tsx:992 | scoped-access (role wizard) step options | backend `GET /api/permissions/server` ✓ + stale fallback (D2) |
| `serverPermissionLabel` | RolesPage.tsx:703 | scoped-perm chips | from lib/serverPermissions.ts ✓ |

### 2.5 Subuser checklist (ServerUsersTab) & shared server-permission list

| Permission literal | file:line | What it gates | Note |
|---|---|---|---|
| `FALLBACK_SERVER_PERMISSIONS` — 25 perms (server.read/start/stop/install/reinstall/rebuild/transfer/delete/schedule, console.*, file.*, backup.read/create/restore/delete, database.*, alert.*) | lib/serverPermissions.ts:25-51 | fallback for subuser invite/access editing + role wizard when API unreachable | **STALE vs backend ALL_SERVER_PERMISSIONS (27)**: missing `server.update` + `backup.download`. D2 |
| `useServerPermissionOptions` | lib/serverPermissions.ts:119-137 | fetch `GET /api/permissions/server` | ✓ backend-driven; `staleTime: Infinity` (catalog changes need new deploy) |
| `serverPermissionLabel` switch — 25 cases | lib/serverPermissions.ts:58-113 | checklist labels | i18n keys `common:serverPermissions.*`; no case for server.update/backup.download |
| options merge (shared + ServerAccess rows + presets) | pages/servers/ServerDetailsPage.tsx:409-425 | checklist options | presets come from backend `GET /api/servers/:id/permissions` ✓ (presets incl. server.update per DEFAULT_PERMISSION_PRESETS) |
| checklist rendering | components/servers/tabs/ServerUsersTab.tsx:116,176-184 | subuser invite/edit checkboxes | consumes merged options ✓ |

### 2.6 API-key creation form (backend-driven ✓)

| Permission literal | file:line | What it gates | Note |
|---|---|---|---|
| catalog fetch | hooks/useApiKeys.ts:55-61 → services/apiKeys.ts:121-124 (`GET /api/admin/api-keys/permissions-catalog`) | API-key permission selector | **BACKEND-DRIVEN** — no hardcoded list; new/split perms appear automatically |
| `useMyPermissions` | hooks/useApiKeys.ts:66-72 → apiKeys.ts:127-129 (`GET /api/admin/api-keys/my-permissions`) | grantable-perm filter | raw `myPermissions.includes(p.value)` at CreateApiKeyDialog.tsx:54-64 — admin.write-only user gets an **empty picker** (D5) |
| `'*'`, `apikey.manage` | pages/ApiKeysPage.tsx:305-308 | mutation UI (create/revoke buttons) | admin.write not included → admin.write-only role loses mutation UI (D5); read-admins get list-only view by design (:305-307 comment) |
| `PermissionCategory` type | services/apiKeys.ts + types/admin.ts:370-372 | catalog shape | mirrors backend catalog DTO |

### 2.7 Server-level UI (effectivePermissions-driven — backend-computed)

| Permission literal | file:line | What it gates | Note |
|---|---|---|---|
| `server.effectivePermissions` | types/server.ts:147-148; ServerDetailsPage.tsx:209-219 (`hasServerPerm`) | all server tabs/buttons | from `GET /api/servers/:id` (backend getEffectiveServerPermissions) ✓ — auto-adapts to backend perm changes |
| `server.start`,`server.stop`,`server.install`,`server.reinstall`,`*` | components/servers/ServerControls.tsx:47-54 | power buttons | **`canKill = canStop` (:52) — mirrors backend kill≡stop; must split when `server.kill` lands** (D7) |
| tab gates: console.read / file.read (×2, sftp) / backup.read / database.read / server.schedule / server.read / alert.read / server.delete / server.install+reinstall+start+stop+file.write / server.update+install+file.write | ServerDetailsPage.tsx:879-931 | tab visibility | ✓ effectivePermissions; 'users' tab via `server.delete||isAdmin||canAdminWrite` (:898-899) — visible to server.delete subusers though backend subuser-mgmt is owner/admin/node-manage (D6) |
| `isAdmin` fallback when effectivePermissions empty | ServerDetailsPage.tsx:213-219 | hasServerPerm fallback | admin.read users see full write controls while server loads; backend 403s actions (D6, cosmetic) |
| `admin.read` (not admin.write!) | ServerDetailsPage.tsx:280-287 `canManageDatabases` | databases tab manage UI | inverted blind spot: read-admin sees manage UI, write-admin doesn't (D5) |
| `console.write` | ServerDetailsPage.tsx:255-260 | console command send | ✓ |
| `backup.create/restore/delete`, `admin.write`, `admin.read`, `isOwner` | components/backups/BackupSection.tsx:115-133 | backup buttons | ✓ correct split; download button gated by `canRead` (:552) not `backup.download` — visible-then-403 for backup.read-only subusers (D6) |
| `server.reinstall`,`*` | components/servers/tabs/ServerSettingsTab.tsx:49-52 | reinstall button | ✓ |
| `canAdminWrite` guard | components/servers/tabs/ServerAdminTab.tsx:564 | admin tab content (env, rebuild, reinstall, force-kill, transfer, suspend) | ✓; kill at :478/760-767, suspend/unsuspend :1071-1105, node transfer :523, ownership transfer :1004-1053 |
| `server.update` (comment) | components/servers/tabs/ServerConfigurationTab.tsx:55 | config tab edit rights | ✓ backend-driven |
| transfer/kill/etc. API wrappers | services/api/servers.ts:95-142,364-407 | POST transfer/kill/suspend/unsuspend/eula/transfer-ownership/transfer-candidates/archive/restore | **`archive` (:401) and `restore` (:406) have no UI caller — endpoints are backend/MCP-only today** |

### 2.8 Admin-area pages & widgets

| Permission literal | file:line | What it gates | Note |
|---|---|---|---|
| `admin.write`,`admin.read`,`*` | pages/dashboard/DashboardPage.tsx:111-125 `isAdmin`; :123 canReadNodes | global dashboard stats | ✓ admin.read included; mirrors backend /dashboard/resources node-visibility gate |
| `node.create`,`template.create`,`server.create` | DashboardPage.tsx:137-139 | onboarding CTAs | via hasAnyPermission ✓ (admin.write implied correctly) |
| `*`,`admin.write` | pages/admin/AdminDashboardPage.tsx:19 | settings link | ✓; stats themselves visible to admin.read (page gate App.tsx:391; backend /api/admin/stats allows admin.read, admin.ts:147-159 ✓ — no dashboard-counts gap here) |
| `admin.write`,`*` | pages/admin/NodesPage.tsx:284-287 canWrite | node management | ✓ |
| `node.create`,`node.delete`,`*` | NodesPage.tsx:289-297 | create/delete buttons | raw includes — admin.write-only user loses buttons (D5); canDeleteAnyNode=canDelete&&canWrite |
| `admin.write`,`*` / `node.assign`,`*`,`admin.write` | pages/nodes/NodeDetailsPage.tsx:170-173,186-194 | node edit / assign | ✓ |
| `admin.write`,`*` | pages/templates/TemplatesPage.tsx:428-431; pages/templates/TemplateDetailsPage.tsx:48 | template edit | ✓ |
| `*`,`admin.write`,`admin.read` | pages/admin/AlertsPage.tsx:6-10 showAdminTargets | global/node alert targets | ✓ |
| `*`,`node.read` | components/layout/FleetHeartbeat.tsx:22-24 | fleet node-count heartbeat | **admin.read NOT included** — read-admins see server counts instead of node counts (D3; the comment at :15-17 expects admin.read to receive node events) |
| `*`,`admin.read`,`admin.write` | components/layout/EnvRestartNotice.tsx:51 | env-restart notice | ✓ |
| `admin.write`,`*` | components/shared/UpdateNotification.tsx:85 | update banner/trigger | mirrors backend admin.write gate on update status (D4) |
| `admin.write`,`*`,`server.create`,`user.create` | components/servers/CreateServerModal.tsx:54-59,104-105,128-130 | create-server modal, owner select, allocation manage | ✓ explicit admin.write everywhere |
| `admin.write` | components/servers/CloneServerDialog.tsx:60 | cross-node clone | ✓ (backend clone needs admin path cross-node) |
| plugin tab `requiredPermissions` via hasAnyPermission | pages/PluginTabPage.tsx:60; pages/PluginRoutePage.tsx:53 | plugin page/tabs | ✓ |
| plugin tab defaults `admin.read`/`server.read` | plugins/loader.ts:143,195,206 | plugin tab gates | ✓ |
| permission icon map (`server.create` etc.) | pages/ProfilePage.tsx:65 | profile permission badges | display-only |

### 2.9 Separate vocabulary — plugin scopes (NOT panel RBAC; do not "fix")

| Permission literal | file:line | What it gates | Note |
|---|---|---|---|
| `*`,`server.read`,`server.write`,`user.read`,`user.write`,`admin.read`,`admin.write`,`plugin.rpc` | pages/admin/plugins/permissionMeta.ts:6-15 | plugin consent/permission wording | client mirror of backend safety.ts PERMISSION_LABELS — a **different namespace** (plugin data scopes). An `apikey.manage` split must not collide with plugin-scope naming; renames here track backend safety.ts only |

### 2.10 Types, i18n, demo, tests, audit labels

| Item | file:line | What it carries | Note |
|---|---|---|---|
| `permissions: string[]` types | types/user.ts:8; types/admin.ts:12,19,66,330-372 (RoleScope, PermissionCategory, role wizard DTOs), types/server.ts:147-148,399-443 (ServerPermissionsResponse, presets) | permission arrays | plain `string[]` — **no string-literal unions**, so renames don't break types; admin.ts:330-331 documents "Subset of ALL_SERVER_PERMISSIONS (GET /api/permissions/server)" |
| `roles.permissionLabels.*` (54 keys) + `roles.presets.*` + `roles.permissionCategories.*` | i18n/locales/{en,fr,zh-CN}/admin-access.json | role editor labels | all 3 locales at 54 keys — parity ✓; missing keys for the 5 unlisted perms |
| `serverPermissions.*` (25 keys) | i18n/locales/{en,fr,zh-CN}/common.json | subuser checklist labels | 25 keys ×3 locales; missing server.update/backup.download labels |
| `PERMISSION_DENIED` | i18n/locales/{en,fr,zh-CN}/errors.json:159 (+context-specific servers.json:21 ×3 for clone) | 403 message | ✓ all locales; mapped via src/i18n/api-errors.ts |
| demo permission list (27 perms incl. server.update) | demo/fixtures.ts:11-20; demo/mockHandler.ts:129 | demo-mode catalogs | demo list is NEWER than FALLBACK_SERVER_PERMISSIONS (25) — drift evidence |
| audit-log action labels `server.kill`/`server.archive`/`server.suspend`/`server.transfer_ownership` | utils/logLabels.ts:114-152 | audit log wording | **action names, not permissions** — labels for the new perms' audit actions already exist |
| ADMIN_PERMISSIONS + hasAnyPermission semantics | __tests__/rbac-permissions.test.tsx:156-239,224-229 | helper contract | :228 asserts `server.kill` NOT in ADMIN_PERMISSIONS — keep operator perms out of admin area; update when ADMIN_PERMISSIONS changes |

## 3. DIVERGENCES from the target contract

- **D1 — D-CATALOG (role editor, high):** `RolesPage.tsx:64-179` hardcodes the grantable permission set and is missing `server.update`, `server.install`, `server.reinstall`, `server.rebuild`, `backup.download` (all in backend PERMISSION_CATEGORIES, permissions-catalog.ts:34-45,118). Roles cannot be granted these via UI — the exact "missing permission forces fallback to admin-level grants" failure the contract forbids. Notably `server.update` gates network allocation writes, storage resize, restart-policy — invisible to the role editor. Presets at :182-212 also diverge from backend PERMISSION_PRESETS.
- **D2 — D-CATALOG (subuser checklist fallback):** `lib/serverPermissions.ts:25-51` fallback (and its 25-case label switch + common.json keys) lacks `server.update` + `backup.download`. When `/api/permissions/server` is unreachable the checklist silently offers 25 of 27 perms; new perms also never appear offline. Primary path is backend-driven ✓.
- **D3 — frontend A-READ-GAP (minor):** FleetHeartbeat.tsx:22-24 `canSeeNodes = '*'||node.read` — an `admin.read` user (read-everything) sees server counts, not node counts, in the shell heartbeat, despite the component's own comment (:15-17) treating admin.read holders as node-event receivers. Fix: include `admin.read`.
- **D4 — mirrored A-READ-GAP (backend-owned):** update-status reads are gated `admin.write` in BOTH layers (backend routes/update.ts:38-212; frontend App.tsx:517 `requireAdminWrite`, UpdateNotification.tsx:85, SystemPage). Fixing requires backend first; frontend then follows (SystemPage read sections / update banner split by read vs write).
- **D5 — admin.write UI blind spots (inverse gaps; not leaks):** raw `permissions.includes()` checks that skip the hasGrant mirror hide write UI from admin.write-only roles (contract says admin.write = write everything): ApiKeysPage.tsx:308 (`apikey.manage` missing admin.write), NodesPage.tsx:289-297 (node.create/delete), CreateApiKeyDialog.tsx:54-64 (empty permission picker for admin.write-only), ServerDetailsPage.tsx:280-287 (`canManageDatabases` includes admin.read but NOT admin.write — doubly wrong), AdminRedirect.tsx:36-38 (raw includes also misses scoped grants). Backend correctly allows these users; only the UI hides capability.
- **D6 — UI shows what backend denies (minor, cosmetic):** 'users' tab visible via `server.delete` (ServerDetailsPage.tsx:898-899) though backend subuser management is owner/admin/node-manage (canManageSubusers); BackupSection download button gated by `canRead` (:552) instead of `backup.download`; `hasServerPerm` isAdmin fallback (:215) renders full write controls for admin.read while effectivePermissions loads. All end in backend 403s — bad UX, not security.
- **D7 — kill≡stop mirror:** ServerControls.tsx:52 `canKill = canStop` — the frontend duplicates the backend conflation; when `server.kill` is added, this line (and ServerAdminTab's force-kill, gated by canAdminWrite so unaffected) must split.
- **D8 — five duplicated route→perm maps:** App.tsx routes, AdminRedirect.tsx:5-19, navSections.ts:54-99, SearchPalette.tsx:175-656, Sidebar.tsx:45-55 — any perm split/rename must update all five or nav/search will advertise unreachable pages (or hide reachable ones).
- **D9 — vocabulary separation:** permissionMeta.ts plugin scopes (`server.write`, `user.write`, `plugin.rpc`) are a distinct plugin-scope namespace mirroring backend safety.ts. Do not conflate with panel RBAC renames; an `apikey.manage` split should avoid names that collide with plugin scopes.
- **Positive findings (contract-compliant):** `admin.read` correctly reaches the admin dashboard/users/roles/nodes/templates/alerts/audit/system-errors/api-keys/database/migration/plugins pages and the admin SSE stream; `admin.write`/`*` pass every hasAnyPermission gate; the hasGrant mirror is semantically exact; the API-key selector and subuser checklist primary paths are backend catalog-driven; server power/tab gating rides `effectivePermissions` (backend-computed) so targeted per-server grants render correctly.

## 4. CHANGE MAP — what must change per planned backend permission change

Universal pre-step for ANY new/renamed permission: update `pages/admin/RolesPage.tsx` PERMISSION_CATEGORIES + `formatPermission` switch + `i18n/locales/{en,fr,zh-CN}/admin-access.json` `roles.permissionLabels.*` (add en+fr+zh-CN in the same change; run `pnpm --filter catalyst-frontend run i18n:extract`, then `pnpm i18n:check` — extractor owns key order; 100% translation required).

| Backend change | Frontend files to touch | i18n keys (en/fr/zh-CN) |
|---|---|---|
| **`server.kill` (new)** | components/servers/ServerControls.tsx:52 (`canKill = hasWildcard \|\| p.has('server.kill') \|\| p.has('server.stop')` during compat); lib/serverPermissions.ts:25-51 FALLBACK + :58-113 label switch (if subuser-grantable); RolesPage.tsx:64-75 + 215-272; ServerDetailsPage.tsx:902-905 (settings-tab visibility if desired); __tests__/rbac-permissions.test.tsx:228 stays valid only if server.kill stays OUT of ADMIN_PERMISSIONS (it should — operator perm) | `serverPermissions.kill` in common.json ×3; `roles.permissionLabels.serverKill` in admin-access.json ×3 |
| **`server.archive` (new)** | No existing UI calls archive/restore (services/api/servers.ts:401,406 are uncalled) — greenfield buttons wherever they land (likely AdminServersPage / ServerAdminTab); RolesPage categories + labels; serverPermissions fallback/labels if subuser-grantable | `roles.permissionLabels.serverArchive` ×3 (+ `serverPermissions.archive` ×3 if subuser-grantable); audit action label already exists (utils/logLabels.ts:114) |
| **`server.migrate` / `server.transfer` split** | RolesPage.tsx:73-74 + label (:223 `serverTransfer` — relabel "Transfer ownership" wording per new semantics); lib/serverPermissions.ts:32,72-73; components/servers/TransferServerModal.tsx (node transfer UI — no client perm check today, backend-gated); ServerAdminTab.tsx:523 (node transfer); ServerControls none | `serverPermissions.transfer` (common.json ×3) text update; `roles.permissionLabels.serverTransfer`/`serverMigrate` ×3 |
| **`apikey.manage` split (e.g. apikey.read / apikey.write / apikey.create)** | App.tsx:611 route gate; AdminRedirect.tsx:14; navSections.ts:71; SearchPalette.tsx:331; Sidebar.tsx:54 (ADMIN_PRIMARY apiKeys); ApiKeysPage.tsx:305-308 (canManage — also fix D5 by adding admin.write); components/auth/ProtectedRoute.tsx:50 (ADMIN_PERMISSIONS); CreateApiKeyDialog auto-adapts (backend catalog) ✓; __tests__/rbac-permissions.test.tsx:158 | `roles.permissionLabels.apikeyManage` update + new `apikeyRead`/`apikeyWrite` keys in admin-access.json ×3 |
| **`file.sftp` (new, if subuser-scoped)** | ServerDetailsPage.tsx:894 (sftp tab gate — currently `file.read`); components/servers/tabs/ServerSftpTab.tsx (no internal gate today); lib/serverPermissions fallback + labels; RolesPage | `serverPermissions.sftp` in common.json ×3 + `roles.permissionLabels.fileSftp` ×3 |
| **`server.eula` (new, optional)** | None required — the EULA prompt is backend-driven (useEulaPrompt → POST /api/servers/eula, services/api/servers.ts:364); no frontend perm gate exists | (labels only if surfaced in checklist) |
| **Generic renames** | All 5 route→perm maps (D8) + RolesPage + serverPermissions + every raw-literal site in §2.7-2.8; check `permissionMatches` scoped-prefix behavior — a rename silently invalidates existing scoped `perm:resource` grants | all label keys above |
| **Backend catalog additions (any)** | API-key selector: automatic (usePermissionsCatalog). Subuser checklist: automatic via /api/permissions/server EXCEPT the stale fallback (serverPermissions.ts:25-51) and the label switch; note `staleTime: Infinity` means a panel upgrade + page refresh is needed | see per-perm rows |

Data sources (verified): API-key selector → `GET /api/admin/api-keys/permissions-catalog` (services/apiKeys.ts:121-124); my-permissions → `GET /api/admin/api-keys/my-permissions` (:127-129); subuser checklist + role wizard scoped step → `GET /api/permissions/server` (serverPermissions.ts:119-137) with the stale 25-perm hardcoded fallback; role editor global perms → **hardcoded** (RolesPage.tsx:64-179 — the one true D-CATALOG); server detail buttons/tabs → `server.effectivePermissions` from `GET /api/servers/:id`.

## 5. RISKS of renaming/splitting without frontend updates

1. **Silent grant invalidation:** `permissionMatches` (ProtectedRoute.tsx:61-70) matches exact strings or `perm:resource` prefixes; a renamed permission makes existing role/subuser grants fall through everywhere at once — users lose access with no error, only 403s.
2. **Ungrantable permissions (D1/D2):** backend perms missing from the role editor can't be delegated — routes then "need" admin.write/admin.read grants, recreating the over-broad fallback pattern the contract eliminates. The stale FALLBACK hides new perms offline and after upgrades until refresh (staleTime Infinity).
3. **i18n CI failure + raw keys:** `pnpm i18n:check` requires en+fr+zh-CN at 100% in the same change; missing keys render as literal identifiers (or the `Server › Update` fallback at RolesPage.tsx:270) and fail the pipeline.
4. **Nav/search drift (D8):** five parallel route→perm maps — forgetting one shows nav entries that 403 on click, or hides pages users can access (AdminRedirect even uses raw `includes`, so scoped grants already mismatch).
5. **Kill semantics stuck:** if `server.kill` ships without ServerControls.tsx:52, every `server.stop` holder keeps seeing (and getting) the force-kill button — the frontend would keep advertising the old conflated capability.
6. **Test pinning:** `__tests__/rbac-permissions.test.tsx:156-239` pins ADMIN_PERMISSIONS membership; moving perms into/out of the admin list breaks the suite (and the deliberate operator-vs-admin split it documents).
7. **Demo drift:** demo/fixtures.ts:11-20 (27 perms) and mockHandler presets drift from the real catalog — demo mode would show perms the backend no longer accepts.
8. **Vocabulary collision:** plugin-scope labels (permissionMeta.ts) share names like `server.write`/`user.write` with nothing in panel RBAC today — keep the two namespaces disjoint when naming split perms (esp. apikey.*).
