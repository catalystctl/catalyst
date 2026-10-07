# Permission Audit — Admin / System endpoints (audit-admin-system)

Scope owner: teammate `audit-admin-system`. Files audited: `catalyst-backend/src/routes/admin.ts` (assigned sections), `settings.ts`, `env.ts`, `update.ts`, `migration.ts`, `provider-keys.ts`, `setup.ts`, `dashboard.ts`, plus two update-related endpoints found in `server.ts`. Users/roles/apikeys/audit-logs sections of `admin.ts` are covered by `audit-admin-people` (appendix A).

## 1. Executive summary

- The `admin.read`/`admin.write` core is sound: `hasGrant()` (`lib/permissions.ts:143-149`) makes `*` grant everything, `admin.write` satisfy any concrete permission, and `admin.read` satisfy any read permission (`isReadPermission`, `lib/permissions.ts:130-136`); `request.user.permissions` is populated for both session and API-key auth (`server.ts:473-517`, `572-585`).
- **8 A-READ-GAP**: all reads in `update.ts` (3) and `migration.ts` (4) are gated on raw `admin.write`, and `dashboard.ts /stats` gates global server counts on `admin.write` — `admin.read` (the owner's "read everything" grant) cannot reach them.
- **2 C-NO-CHECK**: `GET /api/update/check` and `GET /api/agent/version` (server.ts) are auth-only with no permission check at all.
- **0 B-WRITE-LEAK**: every write in scope requires `admin.write` or `*`; no route lets `admin.read` or a narrower grant perform a write.
- Secret masking is correct everywhere `admin.read` can read (SMTP password, mod-manager keys, OIDC client secrets, env secrets), so widening those reads to `admin.read` is safe — the gaps are pure gating bugs, not leak risks.
- `setup.ts`'s re-run guard is robust: one-way `SystemSetting "setup"` flag, fail-closed on DB error, proof-of-control password check for recovery, advisory-lock race guard.
- Update/migration files use **raw `perms.includes(...)`** instead of `hasGrant`, so a naive one-word fix (write→read) would lock out `admin.write`-only users; fixes must swap in `hasGrant` at the same time.

Verdict counts (56 endpoints): **OK 45** (incl. 4 OK-UNAUTH) · **A-READ-GAP 8** · **C-NO-CHECK 2** · **E-BROAD 1** · **B-WRITE-LEAK 0** · **D-CATALOG 0**.

## 2. Endpoint table

Legend: check column cites file:line of the actual permission decision (handler code read in full; comments ignored). "hasGrant(x)" means `hasGrant(perms, x)` semantics: `*`→yes, exact→yes, `admin.write`→any concrete x, `admin.read`→x is a read permission.

### 2.1 `routes/admin.ts` (mounted at `/api/admin`, `server.ts:1091`) — system sections

| METHOD+PATH | Check location | R/W | Current check logic | VERDICT | Proposed fix |
|---|---|---|---|---|---|
| GET /api/admin/stats | admin.ts:153-156 | read | `checkAnyPerm([admin.read, user.read, role.read, node.read, location.read, template.read, server.read, apikey.manage])` (hasGrant-based, admin.ts:78-81) | **E-BROAD (low)** | `admin.read` reaches it ✓, but 7 narrow read perms + `apikey.manage` (a non-read perm, admin.ts:155) also reach panel-wide counts (users/servers/nodes, admin.ts:162-174). Trim to admin-tier (`admin.read`-satisfying) grants, or accept as documented design. |
| GET /api/admin/system-errors | admin.ts:2405 | read | `checkPerm('admin.read')` (hasGrant, admin.ts:73-76) | OK | admin.read/admin.write/`*` all pass. |
| GET /api/admin/system-errors/export | admin.ts:2480 | read | `checkPerm('admin.read')` | OK | Same; JSON/MD export capped at 5000 rows (admin.ts:2529). |
| GET /api/admin/diagnostics/export | admin.ts:2593 | read (download) | `checkPerm('admin.read')` | OK | Cross-tenant by design (admin.ts:2584-2588); redaction modes standard/strict (2621-2624). Server `.env` files included for every server (includeEnv, 2693). Fine under admin.read; see `diagnostics.download` proposal in §3. |
| POST /api/admin/system-errors/:id/resolve | admin.ts:2752 | write | `checkPerm('admin.write')` | OK | admin.read cannot reach a write ✓. |
| POST /api/admin/system-errors/resolve-all | admin.ts:2786 | write | `checkPerm('admin.write')` | OK | Bulk `updateMany` (2824-2827). |
| GET /api/admin/security-settings | admin.ts:2849 | read | `checkPerm('admin.read')` | OK | — |
| PUT /api/admin/security-settings | admin.ts:2864 | write | `checkPerm('admin.write')` | OK | — |
| GET /api/admin/mcp-settings | admin.ts:3001 | read | `checkPerm('admin.read')` | OK | — |
| PUT /api/admin/mcp-settings | admin.ts:3015 | write | `checkPerm('admin.write')` | OK | — |
| GET /api/admin/localization-settings | admin.ts:3056 | read | `checkPerm('admin.read')` | OK | — |
| PUT /api/admin/localization-settings | admin.ts:3070 | write | `checkPerm('admin.write')` | OK | — |
| GET /api/admin/health | admin.ts:3114 | read | `checkAnyPerm(['*','admin.read'])` | OK | admin.read ✓ (exact); admin.write ✓ (satisfies 'admin.read' as concrete via hasGrant). Node online/offline/stale + Redis/cache stats (3118-3204). |
| GET /api/admin/db-status | admin.ts:3947 | read | `checkPerm('admin.read')` | OK | DB size/connections/row counts — aggregate, non-secret. |
| GET /api/admin/smtp | admin.ts:4007 | read | `checkPerm('admin.read')` | OK | Password masked `'********'` (4011-4017). |
| PUT /api/admin/smtp | admin.ts:4027 | write | `checkPerm('admin.write')` | OK | Password-preservation logic prevents masked overwrite (4068-4072). |
| GET /api/admin/mod-manager | admin.ts:4119 | read | `checkPerm('admin.read')` | OK | Keys masked to `{configured,last4,length}` (4123-4125). |
| PUT /api/admin/mod-manager | admin.ts:4134 | write | `checkPerm('admin.write')` | OK | — |
| GET /api/admin/theme-settings | admin.ts:4177 | read | `checkPerm('admin.read')`; OIDC secrets additionally masked unless `admin.write` (4192-4208) | OK | Model implementation of the read/write mask split (clientSecret first-4+bullets, 4199-4204). |
| PATCH /api/admin/theme-settings | admin.ts:4220 | write | `checkPerm('admin.write')` | OK | — |
| GET /api/admin/auth-lockouts | admin.ts:4327 | read | `checkPerm('admin.read')` | OK | Emails/IPs of lockouts — admin-only read, correctly gated. |
| DELETE /api/admin/auth-lockouts/:lockoutId | admin.ts:4379 | write | `checkPerm('admin.write')` | OK | — |
| GET /api/admin/oidc-config | admin.ts:4419 | read | `checkPerm('admin.read')` | OK | Secrets masked first-4+bullets (4440-4442). |
| PATCH /api/admin/oidc-config | admin.ts:4456 | write | `checkPerm('admin.write')` | OK | Masked secret round-trip handled (4486-4490). |
| GET /api/admin/settings/file-tunnel-upload-limit | admin.ts:4543-4553 | read | auth-only (no perm check) | OK (by design) | Single non-sensitive scalar (`maxUploadMb`, 4547-4551) needed by every uploading user; comment documents intent (4542). |

### 2.2 `routes/settings.ts` (mounted at `/api/settings`, `server.ts:954`)

| METHOD+PATH | Check location | R/W | Current check logic | VERDICT | Proposed fix |
|---|---|---|---|---|---|
| GET /api/settings/locale | settings.ts:30-42 | read | none (unauthenticated, rate-limited 60/min) | OK-UNAUTH | Returns `defaultLocale` only (localization.ts:25-33) — display-only, needed pre-login by design (settings.ts:5-17). |

### 2.3 `routes/env.ts` (mounted at `/api/admin/environment`, `server.ts:1092`)

| METHOD+PATH | Check location | R/W | Current check logic | VERDICT | Proposed fix |
|---|---|---|---|---|---|
| GET /api/admin/environment | env.ts:49-50 (requireRead env.ts:33-39, checkPerm 28-31 uses hasGrant) | read | hasGrant('admin.read') | OK | Config read for read-admins ✓. Secrets masked (env-settings.ts:294 maskSecret 261-265); non-secret effective values exposed to admin.read — consistent with "read the entire panel". |
| GET /api/admin/environment/restart-status | env.ts:55-56 | read | hasGrant('admin.read') | OK | — |
| PUT /api/admin/environment | env.ts:64-65 (requireWrite 41-47, RESTART_PERMISSION='admin.write' env.ts:23) | write | hasGrant('admin.write') | OK | — |
| DELETE /api/admin/environment/:key | env.ts:103-104 | write | hasGrant('admin.write') | OK | — |
| POST /api/admin/environment/restart | env.ts:137-138 | write (disruptive) | hasGrant('admin.write') | OK | Panel process restart; stays admin.write. Optional `panel.restart` targeted perm if delegation ever needed (§3). |

### 2.4 `routes/update.ts` (mounted at `/api/admin/update`, `server.ts:1093`)

Local `checkPerm` (update.ts:32-35) is **raw** `perms.includes('*') || perms.includes(permission)` — NOT hasGrant.

| METHOD+PATH | Check location | R/W | Current check logic | VERDICT | Proposed fix |
|---|---|---|---|---|---|
| GET /api/admin/update/status | update.ts:42 | read | raw checkPerm('admin.write') | **A-READ-GAP** | Change gate to `admin.read` AND replace local checkPerm with `hasGrant` (import from lib/permissions) — otherwise admin.write-only users get locked out by the raw includes. |
| GET /api/admin/update/settings | update.ts:73 | read | raw checkPerm('admin.write') | **A-READ-GAP** | Same fix. |
| PUT /api/admin/update/settings | update.ts:99 | write | raw checkPerm('admin.write') | OK | Correct write gate. |
| POST /api/admin/update/check | update.ts:167 | action (read-effect: refreshes cached release status) | raw checkPerm('admin.write') | OK | Side effect is an outbound release check + cache refresh only; admin.write gate acceptable. If treated as a pure read: drop to admin.read (with hasGrant). |
| POST /api/admin/update/trigger | update.ts:187 | write (disruptive/destructive) | raw checkPerm('admin.write') | OK | Contract-compliant. Optional targeted `update.trigger` (§3). |
| GET /api/admin/update/state | update.ts:212 | read | raw checkPerm('admin.write') | **A-READ-GAP** | Same fix as /status. |

### 2.5 Extra update/version endpoints in `server.ts`

| METHOD+PATH | Check location | R/W | Current check logic | VERDICT | Proposed fix |
|---|---|---|---|---|---|
| GET /api/update/check | server.ts:1875 (auth preHandler 1875) | read | **auth-only, no permission check** | **C-NO-CHECK** | Any authenticated user (subuser, low-priv API key) reads panel version + latest version + update availability (1886-1891). Same data as /api/admin/update/status which needs admin.write — inconsistent pair. Add `admin.read` check (hasGrant). |
| GET /api/agent/version | server.ts:1121-1135 (auth 1124) | read | auth-only, no permission check | C-NO-CHECK (low) | Version numbers + release repo (1128-1133); plausibly by design for node-bootstrap UI. Either add admin.read or document as intentional. |

### 2.6 `routes/migration.ts` (registered unprefixed, absolute paths, `server.ts:1114`)

`requireAdmin` (migration.ts:36-43) is **raw** `perms.includes('*') || perms.includes('admin.write')` — NOT hasGrant.

| METHOD+PATH | Check location | R/W | Current check logic | VERDICT | Proposed fix |
|---|---|---|---|---|---|
| GET /api/admin/migration/catalyst-nodes | migration.ts:53 | read | raw requireAdmin (admin.write/`*`) | **A-READ-GAP** | Read-only node listing (hostnames/usage, 56-89). Switch reads to hasGrant('admin.read'). |
| POST /api/admin/migration/test | migration.ts:102 | action (outbound conn test w/ caller-supplied creds) | raw requireAdmin | OK | Write-tier action; fine at admin.write. |
| POST /api/admin/migration/start | migration.ts:143 | write | raw requireAdmin | OK | Creates job, encrypted keys, race guards (204-283). |
| GET /api/admin/migration | migration.ts:357 | read | raw requireAdmin | **A-READ-GAP** | Job list (redacted by service). → admin.read. |
| GET /api/admin/migration/:jobId | migration.ts:373 | read | raw requireAdmin | **A-READ-GAP** | Job status. → admin.read. |
| POST /api/admin/migration/:jobId/pause | migration.ts:394 | write | raw requireAdmin | OK | — |
| POST /api/admin/migration/:jobId/resume | migration.ts:411 | write | raw requireAdmin | OK | — |
| POST /api/admin/migration/:jobId/cancel | migration.ts:428 | write | raw requireAdmin | OK | — |
| GET /api/admin/migration/:jobId/steps | migration.ts:446 | read | raw requireAdmin | **A-READ-GAP** | Step listing. → admin.read. |
| POST /api/admin/migration/:jobId/retry/:stepId | migration.ts:485 | write | raw requireAdmin | OK | — |

### 2.7 `routes/provider-keys.ts` (mounted at `/api/providers`, `server.ts:1102`)

| METHOD+PATH | Check location | R/W | Current check logic | VERDICT | Proposed fix |
|---|---|---|---|---|---|
| GET /api/providers/status | provider-keys.ts:16 (onRequest auth) | read | auth-only (any authenticated user) | OK (by design) | Booleans only (23-24); documented rationale — subusers see mod tabs without admin.read (provider-keys.ts:5-12). Mild fingerprinting (key configured y/n) acceptable. |

### 2.8 `routes/setup.ts` (mounted at `/api/setup`, `server.ts:953`)

| METHOD+PATH | Check location | R/W | Current check logic | VERDICT | Proposed fix |
|---|---|---|---|---|---|
| GET /api/setup/status | setup.ts:161-208 | read | none (unauth) | OK-UNAUTH | Boolean only + `no-store` (168); backfills completion flag when install evidence exists (179-205). |
| GET /api/setup/environment | setup.ts:213-219 | read | none (unauth) | OK-UNAUTH | Returns specs only, no values (env-settings.ts:342-362; `setup`-flagged keys only per schema comment setup.ts:38-41). |
| POST /api/setup/complete | setup.ts:383-698 | write (bootstrap) | unauth by design + multi-guard | OK-UNAUTH | Guards: persistent `SystemSetting "setup"` one-way flag, fail-closed on DB error (126-137, 397-399); secondary admin-count gate with backfill (404-414); proof-of-control password verification before promoting an existing account in recovery (450-472, 502-525, enumeration-safe 403s); `pg_advisory_lock` + re-check (492-525); rate limit 5/min (386-389). Solid. |

### 2.9 `routes/dashboard.ts` (mounted at `/api/dashboard`, `server.ts:1101`)

| METHOD+PATH | Check location | R/W | Current check logic | VERDICT | Proposed fix |
|---|---|---|---|---|---|
| GET /api/dashboard/stats | dashboard.ts:50 (`isGlobalAdmin`), 51, 55-78, 83-84, 120-123 | read | auth-only + in-handler: `isGlobalAdmin = perms.includes('*') \|\| perms.includes('admin.write')` (line 50); `isAdmin = isGlobalAdmin \|\| perms.includes('admin.read')` (line 51); global server counts only when isGlobalAdmin, else owner/access/node-assignment-scoped `serverWhere` (55-78) | **A-READ-GAP (confirmed — the known suspect)** | admin.read users get node/alert counts globally (wantNodes/wantAlerts via isAdmin, 83-84,120-123) but **scoped server counts** — a read-everything admin sees only their own servers. Fix: add `'admin.read'` to `isGlobalAdmin` (line 50). The `server.read`-not-global rule (comment 49, 53-54) stays intact for non-admins. Cache keys include perms (21-24) so no cross-user cache poisoning. |
| GET /api/dashboard/activity | dashboard.ts:150 | read | auth-only; `isAdmin = '*' \|\| admin.read \|\| admin.write` (150); global audit-log feed when admin, else own-userId rows (160-169) | OK | admin.read reaches the global feed ✓ (correct contrast to /stats). |
| GET /api/dashboard/resources | dashboard.ts:203-206 | read | auth-only; `canReadNodes = '*' \|\| node.read`; `isAdmin = '*' \|\| admin.read \|\| admin.write`; non-privileged get zeros (206-214) | OK | admin.read ✓ full aggregate. Minor: `node.view_stats` (a read perm, permissions.ts:133) does NOT satisfy — node-stats-only viewers get zeros; consider adding it to canReadNodes. |

## 3. Vocabulary findings

1. **`admin.read` / `admin.write` semantics are implemented correctly** (permissions.ts:143-149 + isReadPermission 130-136). All gaps above are routes bypassing this contract with raw `includes('admin.write')` (update.ts:32-35, migration.ts:36-43, dashboard.ts:50) or no check (server.ts:1875). No route in scope enforces a permission string missing from `PERMISSION_CATEGORIES` (permissions-catalog.ts:18-169) → **D-CATALOG: none**.
2. **`settings.read`/`settings.write`: NOT recommended.** SMTP/security/mcp/localization/theme/oidc settings are panel-administration functions; a parallel `settings.read` would duplicate `admin.read`'s exact meaning and create a second panel-wide grant, violating "every other permission narrowly scoped". Keep bare admin.read/admin.write here.
3. **`migration.manage` (recommended, write-tier):** for start/test/pause/resume/cancel/retry, so migrations can be delegated without full admin.write. Reads (list/get/steps/catalyst-nodes) must move to `admin.read` regardless (contract #1). Add to catalog 'admin' or new 'migration' category.
4. **`update.trigger` (recommended, write-tier):** the self-update trigger is disruptive/destructive; a targeted grant enables an "updater" role. Reads (status/settings/state, and arguably POST /check) belong on `admin.read`.
5. **`diagnostics.download` (optional):** the bundle crosses tenants and includes server `.env` content (admin.ts:2688-2695); admin.read is contract-compliant, but a targeted grant would let support staff fetch bundles without full read-admin. Low priority.
6. **`node.view_stats` should satisfy GET /api/dashboard/resources** (dashboard.ts:203) — it exists precisely for viewing node statistics (permissions.ts:133) yet the aggregate view ignores it.
7. **Dead duplicate catalog (cleanup):** lib/permissions.ts:432-546 exports a second `PERMISSION_CATEGORIES` (object form) missing `server.update`, `server.install`, `server.reinstall`, `server.rebuild`, `server.suspend`, `backup.download`; only its own test consumes it (rbac.test.ts:494,512) while production uses permissions-catalog.ts (api-keys.ts:5, roles.ts:1048). Delete it or re-export the canonical array to prevent future drift.
8. **`apikey.manage` in the /stats OR-gate** (admin.ts:153-156): a manage/write-tier permission grants a stats read alongside 7 read perms — trim or document.

## 4. Fix list (priority order)

1. **dashboard.ts:50** — `const isGlobalAdmin = perms.includes('*') || perms.includes('admin.read') || perms.includes('admin.write');` (A-READ-GAP; the owner's named suspect). Verify with a test: admin.read-only role sees global server counts.
2. **update.ts** — import `hasGrant` from `../lib/permissions` and rewrite local `checkPerm` (32-35) to use it; then change GET /status (42), GET /settings (73), GET /state (212) to `admin.read`. Keep PUT /settings, POST /trigger on `admin.write` (POST /check → `admin.read` or keep, see table note). Using hasGrant matters: raw includes would lock out admin.write-only users once the gate becomes 'admin.read'.
3. **server.ts:1875** — `GET /api/update/check`: add `hasPermission(request, 'admin.read')`-style gate so any-authenticated can no longer read version/update state.
4. **migration.ts** — replace `requireAdmin` (36-43) with a hasGrant-based helper; reads (53, 357, 373, 446) → `admin.read`; writes keep `admin.write` (or `migration.manage` once cataloged).
5. **server.ts:1121** — `/api/agent/version`: add `admin.read` or record as intentional in code comment.
6. Optional targeted perms per §3: add `migration.manage` and `update.trigger` to `PERMISSION_CATEGORIES` (permissions-catalog.ts) + route gates + role-wizard surfacing; add `node.view_stats` to dashboard.ts:203.
7. Cleanup: remove the stale duplicate `PERMISSION_CATEGORIES`/`PERMISSION_PRESETS` object in lib/permissions.ts:432-602 (migrate its test to the canonical catalog).
8. Low: trim `apikey.manage` from the /stats OR-list (admin.ts:153-156).

## Appendix A — sections of admin.ts covered by `audit-admin-people` (not deep-audited here)

- GET/POST /api/admin/users (admin.ts:179, 303), PUT /users/:userId (546), GET /users/:userId/servers (878), POST /users/:userId/delete (927), ban (1090), unban (1167), passkeys (1217), two-factor (1246), enforce-2fa (1276), accounts/:accountId (1312), verify-email (1351)
- GET /api/admin/roles (904)
- GET /api/admin/audit-logs (2218), GET /api/admin/audit-logs/export (2310)
- API-key routes (routes/api-keys.ts, mounted server.ts:1103)

Hand-off note for that teammate: `canManageUsers` (admin.ts:84-88) accepts only `*` or exact `user.${action}` — unlike `checkPerm` it does NOT treat `admin.write`/`admin.read` as satisfying, so an admin.write-only role is locked out of user routes. Verify against the owner's contract item 2 on their side.

## Appendix B — endpoints in/near scope not assigned to me (for the Lead to route)

- admin.ts: GET /nodes (1399), GET /servers (1447), POST /servers/actions (1557), ip-pools (3211/3282/3393/3500), database-hosts (3574-3835) — server/node/db-host areas (likely another teammate).
- routes/admin-events.ts (SSE admin event stream, server.ts:1094): spot-check shows admin.read required (admin-events.ts:124) — looks healthy, not deep-audited.
- routes/mcp.ts (mounted /api, server.ts:1118) — MCP layer exposing admin tools; separate auth model, not audited here.
