# Catalyst Full API Permission Audit — Final Report

Date: 2026-10-06 · Lead: session Lead · Audit team: 8 domain auditors + cross-cutting
sweeps (15 findings documents, ~4,600 lines, every claim cited file:line).
Scope: the ENTIRE panel API — 296 OpenAPI operations + 13 non-OpenAPI routes (SSE/WS/env/
MCP/console/SFTP/plugin-assets) + the auth engine, the Rust agent-side trust model, and the
frontend permission surface. Coverage reconciliation: **296/296 operations, 0 uncovered**
(coverage.md). Findings were adversarially re-verified: **12/15 top claims confirmed, 3
nuanced, 0 refuted** (verification.md).

## 1. The contract (owner's requirement, normative)

1. `admin.read` → READ over the entire panel and every server.
2. `admin.write` → READ+WRITE over the entire panel and every server.
3. `*` → superadmin.
4. Every other permission narrowly scoped and targeted.
5. Missing permissions get created.

**Verdict: the contract was NOT met before this audit.** The enforcement core
(`hasGrant`, lib/permissions.ts:143-149) implements it correctly, but 4 systemic defect
classes broke it at the edges, across 100+ endpoints.

## 2. Systemic findings (P0/P1, cross-domain)

### S1. API-key scope bypass — 75 endpoints (B-WRITE-LEAK class)
API keys carry a scoped permission set and the auth middleware attaches it to
`request.user.permissions` (server.ts:473-517), but 75 routes decide authorization from the
OWNER's live DB roles instead. A key scoped to `server.read` belonging to an admin/console
user can: execute arbitrary console commands, reinstall (data-wipe) or SIGKILL servers,
rewrite backup S3/SFTP credentials, delete servers, transfer ownership, create+execute
console-command scheduled tasks, mint invites, download cross-tenant backups, and mint
full-R/W SFTP tokens. Root cause: `enforceKeyScope` (an optional conjunction at the tail of
`ensureServerAccess`, _helpers.ts:487-493) is skipped whenever the `actor` argument is
omitted; DB-resolved gates never consult `request.user` at all.
Fix: canonical choke point — a global `preHandler` hook enforcing
`hasGrant(key perms, route.config.requiredPermission)` for apiKeyId requests + mandatory
actor on the DB-resolving helpers + request-based gates for the 41 admin-amplified routes
+ CI source-pattern guard (key-scope-impl-plan.md; key-scope-matrix.md has all 309 rows).

### S2. Raw `perms.includes` instead of `hasGrant` — 4 independent outbreaks (contract violations)
Local helpers bypassed the engine: `canManageUsers` (admin.ts:84-88 — admin.read cannot
read users, admin.write cannot manage them, 12 endpoints), `ensurePermission`
(nodes.ts:57-66 — admin.read 403'd on all node reads, admin.write on 11 writes, 27
endpoints), metrics exact-match (metrics.ts:83-90/349-356 — BOTH admin.read AND bare
admin.write denied), dashboard `isGlobalAdmin` (dashboard.ts:50 — admin.read gets scoped
counts only), update.ts:32-35, plus the plugin SDK context checks
(context.ts:1161-1189 — admins fail plugin-route gates).
Fix: one mechanical sweep — every local gate delegates to hasGrant.

### S3. Role-system privilege escalation chains (B-WRITE-LEAK)
- `node.assign` + `node.update` self-assigns wildcard node access → full server permission
  set fleet-wide (nodes.ts:2508-2512; no self-target/hierarchy guard) — verified escalation.
- roles.ts role-member removal (917) and role-permission editing (440/718) can demote every
  administrator with only `user.set_roles`/`role.update`, bypassing admin.ts's demotion +
  last-admin guards; a `role.update` holder can strip `*` from the Administrator role.
- PUT /api/admin/users body-shape bypass: `roleIds: []` truthy → `user.set_roles` alone
  unlocks password reset (via email-change → forgot-password), ServerAccess rewrites; PUT
  lacks POST's scoped-grant escalation guard (admin.ts:639-654 vs 369-389).
- Legacy parallel admin channel: better-auth `/api/auth/admin/*` gated by the unsynced
  `User.role='administrator'` column (src/auth.ts:282-299) — seeded admins keep
  impersonation/ban/set-password after panel demotion.
Fix: shared `assertCanAffectAdminRole` + last-admin guards across all four routes; the
better-auth HTTP surface gated on hasGrant(admin.write); `User.role` becomes derived state.

### S4. SFTP token system (B-WRITE-LEAK + broken-by-design)
Minting gated on bare `server.read` (any viewer); validate-token derives `['*']` from the
user's DB roles (server.ts:1483-1488) so narrow-scoped admin keys get full R/W sessions;
owners (auto-imported servers) and admin.read users get `[]` (broken). Agent side is solid
(literal per-op file.read/file.write matching, path jail, challenge-response handshake —
agent-side.md) but never revalidates live sessions.
Fix (sftp-fix-design.md): validate-token → `getEffectiveServerPermissions`; mint/rotate →
effective file.read/file.write + key-scope; honest revocation docs + deferred Rust
heartbeat.

### S5. Read-capability gaps for `admin.read` (A-READ-GAP, ~30 endpoints)
Global server list (core.ts:1443), dashboard global counts, all migration reads, all
update reads, task listings (gated on write-level server.schedule), database listings
(ensureDatabasePermission lacks the admin_read branch), transfer-candidates, the global
lifecycle SSE stream (sse-events.ts:202 — comments codified the anti-contract), node
metrics, api-key usage, audit-logs export, user list, plus 4 plugin-inventory reads with NO
permission at all (auth-only, amplified through MCP).

### S6. Vocabulary defects
`apikey.manage` (five verbs), `server.update` (settings+network+storage mega-perm),
`node.update` (node editing + full server manage + agent control), `server.suspend`
(suspend+archive+restore), `server.transfer` (enforced on node migration, ignored on
ownership transfer), `server.stop`≡kill, `server.create`≡clone, mods/plugins riding
`file.write`, SFTP riding `server.read`, dead `alert.read` cross-visibility, phantom
`file.sftp` comment, dual drifted PERMISSION_CATEGORIES copies (permissions.ts:432-546
stale, production-served PERMISSION_PRESETS stale), stale frontend catalogs (RolesPage
hardcoded, missing 5 real permissions), seeds diverging (setup 8-perm User role vs seed's 1).

## 3. The fix (LANDED)

**Target vocabulary** — TARGET-VOCABULARY.md (binding): keeps admin.read/admin.write/*;
splits apikey.manage→read+write, server.update→update+network+storage, node.update→
update+server_manage+agent_control, suspend→suspend+archive, transfer→transfer+migrate,
create→create+clone, stop→stop+kill; adds mods.manage, plugins.manage, migration.manage,
update.trigger, diagnostics.download; canonical READ_PERMISSIONS set replaces suffix
sniffing; LEGACY_ALIASES + idempotent data migration (no schema change — all stores are
String[]); 30 binding route-gate policy decisions (§2). SFTP gates on effective
file.read/file.write (no file.sftp — see §2.5).

**Implementation waves (all landed):** wave 1 core-additive (catalog/engine —
lib/permission-vocabulary.ts + permissions-catalog/permissions/server-access/shared-types/
validation + _helpers presets); wave 2 route fixes across 8 disjoint domain scopes (nodes
ensurePermission→hasGrant sweep, canManageUsers hasGrant, role hierarchy guards +
last-admin, better-auth channel gated + User.role derived, PUT body-shape fix,
apikey split, mod/plugins/tasks/metrics/invites gates, SFTP derivation+mint fixes,
console route gate, SSE admin_read + revocation sweepers, dashboard global counts,
update/migration reads, plugin reads gated, database-hosts gated, key-scope
enforcement: global preHandler hook + mandatory actor + 15 compiler-surfaced bypasses
fixed); wave 3 data migration (prisma/migrate-permissions.ts, executed idempotently
against dev DB; diagnose-admin-rbac.mjs alias-window tracker); wave 4 frontend (20 files
+ 12 locale catalogs: alias-aware ProtectedRoute, regenerated catalogs, backend-driven
role editor + GET /api/roles/permissions-catalog, 5 blind-spot fixes, kill/archive UI,
plugin bootstrap gating, 41 i18n keys ×3 locales); wave 5 gates below. Full item list:
FIX-CHECKLIST.md (123 items: P0 36 · P1 28 · P2 59 across 56 files). Durable enforcement:
route-contract suite (route-contract.matrix.ts, 311 rows / 291 assertions + openapi
drift guard), key-scope-regression.test.ts source-pattern CI guard (295 routes scanned),
plus 40+ new targeted tests across the systemic cases.

## 3b. Final gate results (verified by the Lead)

- Backend lint: 0 errors. Backend typecheck: 0 errors.
- Backend full suite: 10,993 passed / 1 skipped / **1 pre-existing failure**
  (generic-oauth-oidc: this dev .env configures 2 OIDC providers, the test expects 1 —
  proven unrelated to this change).
- Frontend: tsc clean; lint 0 errors (16 pre-existing warnings); 447/447 tests.
- i18n: check 100% (3 locales, 4675 keys); no new hardcoded strings; verify no drift.
- Builds: backend and frontend both succeed.
- Browser verification (admin session): dashboard global counts render; users list 200;
  GET /api/roles/permissions-catalog serves 15 categories / 74 permissions incl. every
  new value; role-editor wizard offers all 12 new permissions with proper labels;
  servers page renders; no console errors. Dev-DB test-fixture rows cleaned.

## 4. Domain verdict totals (endpoint rows across findings files)

| domain | file | endpoints | headline |
|---|---|---|---|
| servers core/bulk | server-core.md | 18 | 7 key-scope bypasses; admin.read locked out of global list; creation via bare node assignment |
| servers power/admin-ops/network | server-power.md | 23 | 12 key-scope bypasses (reinstall/kill/credentials); kill≡stop; archive≡suspend; transfer mis-gated |
| servers files/backups/db/SFTP | server-files.md | 33 | backups+SFTP key-scope bypass; SFTP ['*'] derivation; database-host info leak; files.ts clean |
| servers mods/plugins/invites/tasks/metrics/cs2 | server-extras.md | 41 | 18 key-scope bypasses; metrics locks out both admin archetypes; task listings write-gated; invite tokens leaked; mod family untargeted |
| admin users/roles/api-keys/auth | admin-people.md | 53 | canManageUsers contract break; role-system escalation chains; better-auth legacy channel; apikey mega-perm |
| admin system/settings/migration/update/dashboard | admin-system.md | 56 | 8 read-gaps (dashboard/migration/update); /api/update/check no-check; secret masking otherwise solid |
| nodes/locations/nests/templates | infra.md | 55 | ensurePermission raw-includes (27 endpoints); assign-wildcard escalation; agent-control cluster over-broad |
| realtime (WS/SSE) | realtime.md | 19 channels | console route accepts admin.read (latent); global stream excludes admin.read; revocation gaps |
| plugins + MCP | plugins.md | 32 | 4 auth-only reads; context checks deny admins; phantom admin bits; MCP amplifies all upstream gaps |
| alerts | alerts.md | 11 | all 11 key-scope bypassed; dead alert.read visibility; webhook secrets unredacted |
| engine + vocabulary | core-model.md | — | hasNodeAccess write-only admin; 8 decideServerAccess reimplementations with drift; dual catalogs; no membership validation |
| frontend | frontend.md | 435 literals | semantics healthy; data sources stale (role editor missing 5 perms); raw-includes blind spots; 5 parallel route→perm maps |
| agent (Rust) | agent-side.md | 4 surfaces | trust model sound; SFTP session-snapshot revocation gap; panel = sole policy point |
| key-scope (cross-cutting) | key-scope-matrix.md | 309 | 167 enforced / 75 bypassed / 41 amplified / 21 N/A |
| verification | verification.md | 15 claims | 12 confirmed, 3 nuanced, 0 refuted |

## 5. Artifacts index

Findings: server-core.md, server-power.md, server-files.md, server-extras.md,
admin-people.md, admin-system.md, infra.md, realtime.md, plugins.md, alerts.md,
core-model.md, frontend.md, agent-side.md, key-scope-matrix.md, coverage.md,
verification.md, compat-inventory.md.
Decisions: TARGET-VOCABULARY.md (binding), TARGET-VOCABULARY-PROPOSAL.md (input).
Plans: FIX-CHECKLIST.md, test-plan.md, key-scope-impl-plan.md, nodes-surgery-plan.md,
sftp-fix-design.md, frontend-impl-plan.md, wave1-patch-plan.md.
Endpoint inventory: api/openapi.json (generated, 296 ops).

## 6. What "done" means for this change (STATUS: MET)

- Every read endpoint accepts admin.read; every endpoint accepts admin.write; no write
  accepts admin.read — **proven per-endpoint by the route-contract suite (291/291)**.
- API keys act strictly within their declared scope — global preHandler hook +
  mandatory actor on every DB-resolving helper + 295-route CI source guard.
- No raw permission checks outside the engine (hasGrant everywhere; the four local
  raw-includes outbreaks removed); no escalation path via role edits (hierarchy +
  last-admin guards on every route that can demote) or better-auth (gated + derived
  column); SFTP sessions bounded by effective file perms.
- New targeted vocabulary live with aliases; data migration shipped and executed;
  frontend catalogs backend-driven; i18n 100% (en/fr/zh-CN); all CI gates green.
- Known follow-ups (deliberately deferred, tracked): alias-window removal + legacy-value
  cleanup migration (one release after diagnose reports zero legacy values — 15 remain);
  SFTP live-session revocation needs one agent-side Rust heartbeat (panel-side honesty
  documented); KEY_SCOPE_ENFORCE rollout flag can be removed once trusted in prod.
