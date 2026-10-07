# Frontend Implementation Plan — permission vocabulary rollout (prep, plan only)

Input: `audit/permission-audit/frontend.md` (CHANGE MAP §4, DIVERGENCES §3). Target vocabulary on the table: `server.kill`, `server.archive`, `server.migrate` + `server.transfer` fix, apikey split (`apikey.read/create/update/delete`, `apikey.manage` alias), `file.sftp`, mod family, `server.eula`.
Nothing here modifies source; every reference cites file:line from the audit. Steps are ordered by dependency, not priority — see §3 for constraints.

## 0. Endpoint decision for step (a) — role-editor catalog source

**Decision: new backend route `GET /api/roles/permissions-catalog`, gated on the role family (`role.read` OR `role.create` OR `role.update`, via hasGrant semantics), returning `PERMISSION_CATEGORIES`.**

Justification (facts):
- The existing catalog endpoint `GET /api/admin/api-keys/permissions-catalog` (backend routes/api-keys.ts:55-59) is gated `requireApiKeyRead` = `apikey.manage` OR `isAdmin` (`*`/admin.write/admin.read, api-keys.ts:46-50 + lib/permissions-catalog.ts:208-211). A plain role manager — the RolesPage audience, page gate `['role.read','role.create','role.update','role.delete','admin.read','admin.write']` (App.tsx:425-433) — holds no admin bit and no apikey.manage → **403**. Making the role editor depend on it would break non-admin role managers.
- `GET /api/roles/presets` (backend routes/roles.ts:1037-1053) is already `role.read`-gated and serves only PERMISSION_PRESETS (lib/permissions.ts:551-602) — wrong shape, right privilege level, right home for a sibling route.
- `GET /api/permissions/server` (server.ts:1695-1704, auth-only) serves only the 27 server-scoped perms — wrong shape for the panel-wide role editor.
- Frontend service layer already talks to this API family: `services/api/roles.ts:17-91` (add `getPermissionsCatalog()` next to `getPresets()` at :89-91); DTO type `PermissionCategory` already exists (types/admin.ts:370-372).

Rejected alternative: widening `requireApiKeyRead` (api-keys.ts:46) to also accept `role.*` — couples role editing to the apikey area and broadens an admin endpoint, contrary to contract #4 (narrow, targeted).

**Cross-layer prerequisite the Lead must decide (blocks steps 2 and 3 fully working):** the backend's grantable-permission validators use raw `includes` — `freshEditorPermissions` (roles.ts:360-373: an admin.write-only editor without `*` cannot grant ANY concrete perm), API-key create validation (api-keys.ts:82-96), the stale-key check at auth (server.ts:495-508), and `GET /api/admin/api-keys/my-permissions` (api-keys.ts:64-69, returns raw `request.user.permissions`). If `admin.write` = write-everything per contract, these need `hasGrant` semantics (or an expanded effective-permission list returned by my-permissions); otherwise the frontend fixes below surface checkboxes that 403 on save. This is a backend change — flag to the backend owner.

## 1. Ordered step list

### Step 0 — Backend dependencies (not frontend work; blocks/limits steps 1-5)
- 0.1 Catalog additions land in backend `PERMISSION_CATEGORIES` / `ALL_SERVER_PERMISSIONS` (lib/permissions-catalog.ts:18-169, 238-247) + presets (`DEFAULT_PERMISSION_PRESETS`, routes/servers/_helpers.ts:22-82) — exact names frozen before any frontend step 6 i18n work.
- 0.2 New `GET /api/roles/permissions-catalog` (decision §0) in routes/roles.ts next to `/presets` (:1037).
- 0.3 Grant-validator semantics fix (§0 cross-layer note) — Lead decision.
- 0.4 Route behavior changes the frontend mirrors: kill accepts `server.kill` (+ compat window for `server.stop`, power.ts:1048); archive/restore accept `server.archive` (+ optional `server.suspend` legacy fallback, admin-ops.ts:837,907); `server.migrate` split from `server.transfer` (admin-ops.ts:406); apikey family enforcement in routes/api-keys.ts (requireApiKeyManage :36-40, requireApiKeyRead :46-50).
- Blast radius: backend; frontend steps below assume 0.1-0.2 minimum.

### Step 1 — Fix the shared server-permission list (audit item b)
Files: `lib/serverPermissions.ts` (138 lines), `i18n/locales/{en,fr,zh-CN}/common.json`.
- 1.1 Regenerate `FALLBACK_SERVER_PERMISSIONS` (serverPermissions.ts:25-51) from backend `ALL_SERVER_PERMISSIONS` — adds `server.update`, `backup.download` today, plus `server.kill/archive/migrate/sftp/eula` (+ mod family) when they land. Keep it a deploy-time mirror of the backend constant (comment at :4-7 already documents this contract).
- 1.2 Extend the label switch (serverPermissions.ts:58-113): add the missing cases (`server.update`, `backup.download`) and one case per new perm. Keep the switch pattern — the comment at :53-57 explains why (i18n extractor needs literal keys in source; do NOT switch to dynamic key building).
- 1.3 Change `staleTime: Infinity` (serverPermissions.ts:134) → `staleTime: 10 * 60_000` (match usePermissionsCatalog, hooks/useApiKeys.ts:59) so a panel upgrade flows new perms after ≤10 min; keep `gcTime: Infinity`, `retry: 1`.
- Backend dependency: none (endpoint `/api/permissions/server` is auth-only, server.ts:1695-1704).
- Blast radius: **S** — consumers are ServerDetailsPage subuser checklist (:413-425) and RolesPage scoped-access step (:992); both already render whatever the list contains; label switch is display-only. Tests: none pin the fallback list today.

### Step 2 — Make the role editor catalog-driven (audit item a)
Files: `pages/admin/RolesPage.tsx` (1649 lines), `services/api/roles.ts`, `hooks/useRoles.ts` (if presets hook exists) or a new small hook, `types/admin.ts`.
- 2.1 Add `rolesApi.getPermissionsCatalog()` (services/api/roles.ts:89-91 area) → `GET /api/roles/permissions-catalog` (step 0.2).
- 2.2 New `useRolePermissionsCatalog()` query (10-min staleTime) and replace the hardcoded `PERMISSION_CATEGORIES` at RolesPage.tsx:64-179 with its data. **Keep the current hardcoded array only as the offline fallback** (mirror the serverPermissions.ts pattern), regenerated in the same PR — the categories carry icons/colors per group (RolesPage.tsx:65-75) so map them by category id, defaulting to the generic style for unknown ids.
- 2.3 Replace hardcoded `PERMISSION_PRESETS` (RolesPage.tsx:182-212) with `rolesApi.getPresets()` (roles.ts:89-91 → backend GET /api/roles/presets, roles.ts:1037-1053) — backend presets are the single source; the frontend copy diverges today (adds `node.assign` to moderator).
- 2.4 Extend `formatPermission` (RolesPage.tsx:215-272) with the 5 missing cases + one case per new perm (labels land in step 6). Unknown perms already fall back safely (:270).
- 2.5 `getPermissionCategories` (:314-330) and the scope wizard (:964-1177, uses `useServerPermissionOptions` at :992) need no structural change — the wizard is already backend-driven.
- Backend dependency: **step 0.2 required**; 0.3 required for admin.write-only editors to actually save grants.
- Blast radius: **M** — one page (role create/edit UI), no other component imports its constants (verified: only RolesPage itself). i18n keys consumed, not defined, here.

### Step 3 — Fix the raw-includes blind spots (audit item c)
Files: 5 components. All fixes import `hasAnyPermission` from `components/auth/ProtectedRoute` (exported at :143).
- 3.1 `pages/ApiKeysPage.tsx:305-308` — `canManage = hasAnyPermission(userPerms, ['apikey.manage'])` (hasGrant semantics: `*`/admin.write/apikey.manage). After the apikey split, widen to `['apikey.manage','apikey.create','apikey.update','apikey.delete']` per the split decision.
- 3.2 `pages/admin/NodesPage.tsx:289-297` — `canCreate = hasAnyPermission(perms, ['node.create'])`, `canDelete = hasAnyPermission(perms, ['node.delete'])` (admin.write-only users regain buttons; `canDeleteAnyNode` at :298 unchanged).
- 3.3 `pages/servers/ServerDetailsPage.tsx:280-287` — replace `canManageDatabases` with `hasAnyPermission(user?.permissions, ['database.create','database.rotate','database.delete']) || isOwner` — fixes BOTH bugs: admin.write now implied; `admin.read` no longer wrongly included (read perms don't satisfy write perms under hasGrant). Keep the owner check (server.ownerId === user.id).
- 3.4 `components/apikeys/CreateApiKeyDialog.tsx:54-64` — filter becomes `p.value === '*' ? false : (userHasWildcard || hasAnyPermission(myPermissions, [p.value]))`. NOTE: for admin.write-only users this still yields an empty list **unless step 0.3/0.4 lands** (my-permissions must return the grantable set). Interim mitigation: show the allPermissions toggle prominently with a hint; final fix is backend.
- 3.5 `components/layout/FleetHeartbeat.tsx:22-24` — `canSeeNodes = hasAnyPermission(user?.permissions, ['node.read'])` (admin.read satisfies node.read via hasGrant → read-admins see node counts; matches the comment at :15-17).
- Backend dependency: none for 3.1-3.3, 3.5; 3.4 needs 0.3 for full effect.
- Blast radius: **S each, M combined** — button/widget visibility only; behavior verified by existing tests? `pages/admin/__tests__/NodesPage.adminUx.test.tsx:59-94` pins canCreate/canDelete behavior with literal-perm users (still passes — literal holders keep passing) but needs new cases for admin.write-only; `UpdateNotification.test.tsx` unaffected.

### Step 4 — Kill split + archive/restore wiring (audit item d)
Files: `components/servers/ServerControls.tsx`, `components/servers/tabs/ServerAdminTab.tsx`, `pages/servers/ServerDetailsPage.tsx`.
- 4.1 `ServerControls.tsx:52` — `const canKill = hasWildcard || p.has('server.kill') || p.has('server.stop');` (compat window per step 0.4; remove the `server.stop` fallback when the migration window closes — flag the date in the Lead decision). `permissions` here is `server.effectivePermissions` (ServerDetailsPage.tsx:1122-1125), backend-computed, so backend compat makes this a no-op transition until cutover.
- 4.2 Archive/restore (greenfield — no UI caller exists today; API wrappers at services/api/servers.ts:401-407): add an "Archival" section to ServerAdminTab next to the suspension section (:1069-1105). Gate: `canArchive = hasAnyPermission(user?.permissions, ['server.archive', 'server.suspend', 'admin.write'])` (server.suspend only if kept as legacy fallback per 0.4; admin.read excluded by design — archive is a write). Show Restore when `server.status === 'archived'`, Archive otherwise; reuse the ConfirmDialog pattern from the kill confirm (:290-300). Audit-log wording already exists — `utils/logLabels.ts:114` (`server.archive`), `:138` (`server.kill`) — no i18n change needed for log display.
- 4.3 Optional: surface `server.eula` in the settings-tab visibility list (ServerDetailsPage.tsx:900-908) if the EULA perm becomes separately grantable; the EULA dialog itself is backend-driven (`useEulaPrompt` → POST /api/servers/eula, services/api/servers.ts:364) and needs no gate.
- Backend dependency: 0.1 (perms exist in effectivePermissions/ADMIN list), 0.4 (kill compat + archive enforcement).
- Blast radius: **M** — ServerControls renders on every server row/detail (compact + full); ServerAdminTab is the admin tab only. Tests: CreateServerModal.test/ServerControls tests (if any reference kill) — none found pinning canKill; add one for the split.

### Step 5 — Update the five route→permission maps (audit item e)
Only perms that change *page reach* touch these maps; server.kill/archive/migrate/eula are operator-level (effectivePermissions) and change nothing here.
- 5.1 **apikey split** — update all five: `App.tsx:611` (page gate → `['apikey.manage','apikey.read','apikey.create','apikey.update','apikey.delete','admin.read','admin.write']` or the alias decision), `components/auth/AdminRedirect.tsx:14`, `components/layout/navSections.ts:71`, `components/search/SearchPalette.tsx:331`, `components/layout/Sidebar.tsx:54` (ADMIN_PRIMARY apiKeys entry). Also `components/auth/ProtectedRoute.tsx:50` (ADMIN_PERMISSIONS — add the new apikey.* members; apikey perms ARE admin-panel perms, unlike server.kill) and `pages/ApiKeysPage.tsx:305-308` (already in step 3.1).
- 5.2 **D4 follow-up (optional, backend-first)** — if update-status reads open to `admin.read` on the backend (routes/update.ts:38-212 today admin.write), change `App.tsx:517` `/admin/system` from `requireAdminWrite` to `requirePermissions={['admin.read','admin.write']}` and split UpdateNotification.tsx:85 (banner visible to admin.read, trigger button stays admin.write).
- 5.3 Fix `AdminRedirect.tsx:36-38` raw `includes` → `hasAnyPermission` while touching it (scoped grants currently mismatch).
- Backend dependency: 0.4 for 5.1; backend update-status change for 5.2.
- Blast radius: **S per file, M combined** — pure gating lists; SearchPalette has ~40 entries but only :331 changes for the apikey split.

### Step 6 — i18n keys (audit item f)
Namespace files: `i18n/locales/{en,fr,zh-CN}/common.json` (`serverPermissions.*` — 25 keys today) and `i18n/locales/{en,fr,zh-CN}/admin-access.json` (`roles.permissionLabels.*` — 54 keys today, plus `roles.presets.*`, `roles.permissionCategories.*`).
- New `serverPermissions.*` keys (common.json ×3 locales): `update`, `backupDownload` (fill the D2 gap), `kill`, `archive`, `migrate`, `sftp`, `eula`, + mod-family keys (exact names pending vocabulary freeze).
- New `roles.permissionLabels.*` keys (admin-access.json ×3): `serverUpdate`, `serverInstall`, `serverReinstall`, `serverRebuild`, `backupDownload` (fill the D1 gap — install/reinstall/rebuild cases already exist? verify: RolesPage switch :219-224 has start/stop/create/delete/suspend/transfer/schedule but NOT install/reinstall/rebuild/update), `serverKill`, `serverArchive`, `serverMigrate`, `fileSftp`, `serverEula`, `apikeyRead`, `apikeyCreate`, `apikeyUpdate`, `apikeyDelete` (+ mod family).
- Text-only updates to existing keys (no key rename): `serverTransfer` (wording must match the migrate/ownership split decision), `apikeyManage` (mark as alias/legacy if the split deprecates it).
- **Process (AGENTS.md, mandatory order):** land the code that references the keys first (switch cases from steps 1/2/4) → run `pnpm --filter catalyst-frontend run i18n:extract` (the extractor owns key order — never hand-reorder) → add every new key to en, fr AND zh-CN in the same change → `pnpm i18n:check` (fails below 100%) → `pnpm i18n:hardcoded` for any literal that must stay.
- Backend dependency: vocabulary names frozen (0.1).
- Blast radius: **M** — 6 locale files; CI-blocking if incomplete.

### Step 7 — Demo catalog + test pinning (audit item g)
- 7.1 `demo/fixtures.ts:11-20` (27-perm list) and `demo/mockHandler.ts:129` (truncated presets) — regenerate to mirror the new catalog/presets; demo role fixtures at :495-507 unchanged unless presets change.
- 7.2 `__tests__/rbac-permissions.test.tsx` — update the ADMIN_PERMISSIONS assertions (:156-239) if apikey.* members are added to ADMIN_PERMISSIONS (step 5.1); **keep the operator-perm exclusions valid** (:224-229 asserts `server.kill` stays OUT of ADMIN_PERMISSIONS — it must). Add hasGrant-semantics cases for the step-3 fixes (admin.write-only user passes node.create etc.) and a canKill split case.
- Blast radius: **S** — test/demo files only, but 7.2 blocks CI if skipped after 5.1.

### Step 8 — Full gate run (per AGENTS.md)
`pnpm --filter catalyst-frontend run lint` → `cd catalyst-frontend && npx tsc --noEmit` → `pnpm --filter catalyst-frontend run test` → `pnpm i18n:check` + `pnpm i18n:hardcoded` → `pnpm run build:frontend`. Browser verification per §2.

## 2. Verification checklist (browser, per AGENTS.md "verify admin flows in the browser")

Sign in as distinct seeded roles (superadmin `*`, admin.read-only, admin.write-only, plain role-manager with only role.create+role.update, server owner, subuser with stop-only, subuser with full preset):
1. **Role editor grants `server.update`:** /admin/roles → create role → `server.update` checkbox exists (step 2), label renders (not the `Server › Update` fallback), save succeeds, role detail shows it. With a plain role-manager (no admin bit): the editor still loads the full catalog (step 0.2 works — no 403 in network tab).
2. **admin.read user:** /admin dashboard shows global counts (servers/nodes/users); /admin/users list renders; /admin/nodes/:id metrics render; admin SSE connects (no EventSource 403); FleetHeartbeat shows node counts (step 3.5); write buttons (settings link, node create, key create, kill) are absent.
3. **admin.write-only user (no `*`):** API-key create dialog shows a NON-EMPTY permission picker (step 3.4 + 0.3); node create/delete buttons visible (3.2); canManageDatabases path: databases tab shows manage UI (3.3); role editor can save a concrete perm (0.3).
4. **Subuser checklist:** /servers/:id → users tab → invite/edit dialog lists the new perms (server.update, backup.download, kill, archive, migrate, sftp, mod family) with localized labels in en → switch locale fr and zh-CN → labels localized, `pnpm i18n:check` green.
5. **Kill split:** subuser with only `server.stop` → kill button hidden after cutover (during compat: visible); subuser with `server.kill` → visible; owner → visible. ServerAdminTab force-kill still admin-gated.
6. **Archive/restore:** admin (admin.write or server.suspend/server.archive) sees the Archival section; archive a stopped server → status archived; restore → stopped; audit log shows the localized `server.archive` label (logLabels.ts:114).
7. **apikey split:** user with only `apikey.read` opens /admin/api-keys (page gate 5.1) but sees no create/revoke; user with `apikey.create` sees create only.
8. **Nav/search integrity:** sidebar, sections popover (NavSectionsMenu), and search palette (⌘K) show /admin/api-keys to exactly the users who can open it (five maps consistent — spot-check each surface).
9. **i18n plumbing:** `pnpm i18n:check` and `pnpm i18n:hardcoded` pass; no raw keys visible in any locale.

## 3. Risks + ordering constraints

1. **Hard ordering:** 0.1 (vocabulary frozen) → 6 (i18n keys can be authored) and 4 (perm checks reference real strings); 0.2 → 2 (role editor endpoint); 0.3 → 3.4 and the admin.write verification items in §2; 0.4 → 4.1/4.2 compat behavior and 5.1 page reach. Within frontend: 1 and 3.1-3.3/3.5 are independent, ship anytime; 2 before the i18n extractor run only insofar as new switch cases land in the same PR as their keys (AGENTS.md: code first, then extract, then fill en/fr/zh-CN — extractor owns key order, never hand-reorder).
2. **Rename invalidation:** `permissionMatches` (ProtectedRoute.tsx:61-70) matches exact strings and `perm:resource` prefixes — every rename (server.transfer→migrate, apikey.manage split) silently strands existing role/subuser grants. Ship renames with a backend data-migration for stored `role.permissions`, `ServerAccess.permissions`, RoleServerGrant/RoleNodeGrant rows, API-key scopes — coordinate with the backend owner; the frontend cannot repair this.
3. **Compat windows must be timed:** kill (server.stop fallback in ServerControls.tsx:52) and archive (server.suspend fallback in the 4.2 gate) need an agreed removal date or the frontend re-hardcodes the old conflation.
4. **Fallback hygiene:** steps 1.1/2.2 keep regenerated hardcoded fallbacks — every future catalog change must regenerate them or the offline/degraded UI silently reverts to the old set (today's D1/D2 is exactly this risk realized). Consider a unit test asserting FALLBACK ⊆ backend ALL_SERVER_PERMISSIONS shape (import from a generated fixture).
5. **i18n CI is the gate:** missing fr/zh-CN keys fail `pnpm i18n:check` (100% rule) — do not merge step 6 partially; the zh-CN/fr catalogs are machine-translated baseline, translations may be rough but must exist.
6. **Test pinning:** rbac-permissions.test.tsx:156-239 pins ADMIN_PERMISSIONS — update together with ProtectedRoute.tsx:50; the :224-229 exclusions (server.kill etc. stay operator perms) are contract documentation, keep them passing.
7. **Demo drift:** demo fixtures (7.1) rot silently because demo mode never hits the backend catalog — regenerate in the same PR as vocabulary changes.
8. **Do not conflate vocabularies:** plugin-scope labels (pages/admin/plugins/permissionMeta.ts:6-15 — `server.write`, `user.write`, `plugin.rpc`) mirror backend safety.ts, not RBAC; the apikey split naming must avoid plugin-scope collisions and this file must NOT be "fixed" in this rollout.

## Lead decisions needed
1. Approve endpoint decision §0 (new `GET /api/roles/permissions-catalog`, role-family-gated) and assign the backend owner.
2. Grant-validator semantics for admin.write-only users (§0 cross-layer note: freshEditorPermissions roles.ts:360-373, api-key create api-keys.ts:82-96, stale-check server.ts:495-508, my-permissions api-keys.ts:64-69) — without it, steps 2/3.4 are cosmetically fixed but functionally blocked for admin.write-only editors.
3. Kill/archive compat windows: accept `server.stop`/`server.suspend` during migration (frontend keeps dual checks) or hard cut (single checks, immediate behavior change for existing stop/suspend holders).
4. `server.transfer` semantics after the migrate split: keep the key for ownership transfer (label text change) or retire it — determines whether `serverTransfer` i18n text changes or the key retires.
5. Mod family: confirm server-scoped vs panel-level and final names — decides whether they ride the serverPermissions pipeline (steps 1/6 common.json) or the role catalog (admin-access.json only).
6. Whether D4 (update status → admin.read) happens backend-side this rollout; if yes, include optional step 5.2.
