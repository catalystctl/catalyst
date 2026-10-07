# Contract Test Plan — Permission-Model Implementation Lock-In

Companion to `audit/permission-audit/infra.md` (endpoint audit). Scope: lock the post-consolidation permission contract — `admin.read` reads everything, `admin.write` reads+writes everything, `*` superadmin, all other permissions narrowly scoped, API-key scope ceilings enforced — so ANY future drift fails CI. Source of truth for the route inventory: `api/openapi.json` (296 ops, extracted to `METHOD PATH` lines, see §3).

---

## 1. Existing permission-gate test inventory

Harness flavors used today (all verified in code):

- **P-A "inject-perms"** — `Fastify()` + `app.decorate('authenticate', …)` that sets `request.user = { userId, permissions }` directly; register one route module; `app.inject()`. Exercises the *real route handler gate code*, bypassing the real middleware. Examples: `diagnostics-export.test.ts:284-291`, `system-errors-export.test.ts:11-18`, `localization-settings.test.ts:22-29`, `dashboard-stats.test.ts:17-23`.
- **P-B "DB-roles"** — real `User`+`Role` rows in the dev DB (permissions resolved from DB); harness injects only `userId` (and often `permissions: []`). Examples: `power-access-rbac.test.ts:29-60` + fixtures `:75-151`, `rbac-api.test.ts:33-113`.
- **P-C "userOverrides"** — P-A variant with a default `'*'` user overridden per test (`{ userId, permissions }` merge). Examples: `node-allocations-bulk-delete.test.ts:20-33`, `secondary-allocations.test.ts:46-60`, `node-overallocation.test.ts:37-45`, `ipv6-support.test.ts:46-64`, `agent-config-update.test.ts:30-47`.
- **P-D pure-unit** — no HTTP: `server-access.test.ts`, `scoped-permissions.test.ts`, `rbac.test.ts`, `authz-fixes.test.ts:83-100`.
- **P-E gateway-stub** — `new WebSocketGateway(prismaStub, loggerStub)` + fake sockets: `authz-fixes.test.ts:29-80`, `gateway-ws-authz.test.ts:35-58`.

| File | Lines | Route / behavior pinned | Harness |
|---|---|---|---|
| `rbac-api.test.ts` | :127-164 | nodes routes ×7 — **resolution-level only** (`hasPermission(prisma, userId, perm)`, no HTTP) | P-B |
| | :166-204 | admin routes ×4 — resolution-level | P-B |
| | :206-232 | roles routes ×9 — resolution-level | P-B |
| | :234-272 | servers routes ×7 — resolution-level | P-B |
| | :274-306 | user-mgmt routes ×7 — resolution-level | P-B |
| | :308-355 | templates ×5, locations ×4 — resolution-level | P-B |
| | :357-371 | backups ×4 — **stale paths** (`/api/backups/:id` does not exist) | P-B |
| | :416-451 | `PUT /api/admin/smtp` — **real handler invoked**; admin.read→403, admin.write→400 (empty host) proves gate passed | capture-Routes stub :395-410 |
| | :454-500 | permission aggregation across two roles | P-B |
| `rbac.test.ts` | :24-49 | `parseScopedPermission` incl. multi-colon ids | P-D |
| | :51-171 | `hasPermission` scoped/wildcard matching (incl. `node.delete:test-node-123` :108) | P-D/P-B |
| | :197-475 | role CRUD → permission resolution (node.read+server.read, node.read+node.update, duplicate roles) | P-B |
| | :645-680 | role permission mutation re-resolution | P-B |
| | :493-525 | `PERMISSION_CATEGORIES` shape — **asserts the stale duplicate** in `lib/permissions.ts:432` | P-D |
| `server-access.test.ts` | :9-130 | `decideServerAccess`: owner/server_access/admin/node-bypass-denied/node_manage | P-D |
| | :132-147 | `isFullAdminRole`, `canManageViaNode` | P-D |
| | :149-239 | `requiredPermission` branch (role_permission precedence :207-227) | P-D |
| | :241-295 | admin.read = read-everything (read list ✓ / write list ✗) | P-D |
| | :297-331 | `hasGrant` exactness, admin.write≠`*`, admin.read read-only | P-D |
| `power-access-rbac.test.ts` | :170-176 | `POST /api/servers/:id/start` — node manager (assignment+node.update) non-403 | P-B + wsGateway/webhookService/fileTunnel stubs :41-57 |
| | :178-186 | start/stop for role holding `server.start`/`server.stop` | P-B |
| | :188-194 | no-perms user → 403 | P-B |
| `alerts-access-rbac.test.ts` | :148-155 | alerts query by non-owner with `alert.read` | P-B |
| | :156-163 | bare node assignment (no node.update) denied | P-B |
| | :164-171 | per-permission (alert.read ⊄ alert.create) | P-B |
| `authz-fixes.test.ts` | :83-87 | `checkAnyPerm`: admin.read ≠ server.suspend; admin.write ✓ | P-D |
| | :89-95 | `enforceKeyScope` matrix (5 cases incl. `*` key) | P-D |
| | :97-100 | `ALL_SERVER_PERMISSIONS` contains backup.download/server.update | P-D |
| | :102-158 | WS restart needs start+stop; stop-only ok; console_input needs console.write | P-E |
| `gateway-ws-authz.test.ts` | :61-81 | WS server_control denies no-grants (role-lookup failure safe) | P-E |
| | :83-107 | WS power denied for admin.read-only | P-E |
| | :109-140 | WS power allowed for owner | P-E |
| `security-wave2-regression.test.ts` | :60-124 | WS server_control payload whitelist | P-E |
| | :165-188 | WS subscribe denied for bare node assignment / allowed with node.update | P-E |
| | :219-235 | plugin detail/frontend-manifest redaction (static) | static |
| | :236-248 | role scoped-grant validation (static) | static |
| | :249-260 | deployment-token/api-key node-manage path (static — **not a route test**) | static |
| `localization-settings.test.ts` | :137-157 | `GET/PUT /api/admin/localization-settings` — admin.read reads ✓ / writes 403; `[]` 403 | P-A |
| | :159-190 | invalid locale 400; persistence + audit row | P-A |
| `system-errors-export.test.ts` | :49-73 | `GET /api/admin/system-errors/export` admin.read ✓ | P-A |
| | :79-107 | 403 for `[]`; `POST resolve-all` admin.write ✓ / admin.read 403 | P-A |
| `diagnostics-export.test.ts` | :320-326 | `GET /api/admin/diagnostics/export` 403 for `[]` | P-A |
| | :328-389 | redaction/validation 400s; ZIP 200 | P-A + DB fixtures |
| `dashboard-stats.test.ts` | :62-85 | `/api/dashboard/stats` numeric counts for `*` and scoped `server.read` | P-A |
| | :85-90 | cached-body identity | P-A |
| `node-allocations-bulk-delete.test.ts` | :200-220 | `POST /api/nodes/:id/allocations/bulk-delete` requires `node.manage_allocation` (403 for `[]`) | P-C |
| `secondary-allocations.test.ts` | :649-676 | server allocations add/remove by node manager (`node.read,node.update`) — regression for removed rbac middleware | P-C |
| | :678-688 | unprivileged user 403 | P-C |
| `backup-settings-mask.test.ts` | :181-209 | `PATCH /api/servers/:id/backup-settings` secret mask round-trip | P-C/real app |
| | :210-227 | real-secret change requires admin path (403 otherwise) | P-C |
| `servers-list-pagination.test.ts` | :165-236 | `GET /api/servers` scoping: server.read user vs `*` admin | P-C |
| `startup-command-override.test.ts` | :152-178 | startup propagation via start/restart/install (perms not the target; `'*'` harness) | P-C |
| `agent-config-update.test.ts` | :96-146 | `PUT /api/nodes/:id/agent/config` allowUnsafe forward + agent rejection codes | P-C + wsGateway stub |
| `node-overallocation.test.ts` / `ipv6-support.test.ts` | :140-394 / :361-507 | node CRUD/IPAM flows (default `'*'` harness — **no negative-perm coverage**) | P-C |
| `scoped-permissions.test.ts` | :5-39 | `mergeServerPermissions` union/dedupe | P-D |
| | :41-52 | `ALL_SERVER_PERMISSIONS` uniqueness | P-D |
| `security-fixes-regression.test.ts` | :11-75 | alert-webhook SSRF + IPAM release (adjacent, not perm gates) | unit |

**Coverage gap confirmed:** rbac-api.test.ts touches ~34 route *names* at the `hasPermission()` resolution level only (plus 1 real handler at :416-451); no test suite asserts the wiring between a route and its gate for more than ~25 endpoints. Nothing tests `request.user.permissions` injection *and* DB-role resolution together; nothing tests the middleware's API-key scope logic.

## 2. Auth middleware — how permissions actually reach the route

Real middleware `authenticate` (server.ts:442, attached `app.authenticate` at server.ts:595):

1. `Authorization: Bearer catalyst…` → `verifyApiKeyService` (server.ts:452) → banned/locked checks (server.ts:459-471) → `resolveUserPermissions(key.userId)` (server.ts:474) → **key-scope ceiling** (server.ts:482-509): `allPermissions` keys inherit live user perms only; scoped keys 403 (`"API key permissions revoked"`) the moment any key perm is no longer held by the user (unless user holds `*`). Then `request.user = { userId, email, username, apiKeyId, permissions }` (server.ts:511-517).
2. Session fallback: better-auth `getSession` (server.ts:548) → same banned/locked checks → `resolveUserPermissions` (server.ts:575) → `request.user` (server.ts:580-585).

**How tests inject today: neither session mock nor API-key stub.** Every `buildTestApp` variant *replaces* `app.authenticate` with a decorator that writes `request.user` directly (e.g. diagnostics-export.test.ts:286-288). Consequences:

- ✅ The route-level gate code under test is the real production code (`ensurePermission`, `checkPerm`, `ensureServerAccess`, `decideServerAccess` with real DB rows).
- ❌ The real middleware (key verification, key-scope inheritance/revocation, banned/locked, session resolution) is never executed by any existing test.
- ⚠️ **Two permission data sources must both be satisfied by the harness.** Gates read either `request.user.permissions` (nodes.ts:57-66, admin.ts:73-81, dashboard.ts:41-46, metrics.ts:405-411, plugins `ensureAdmin` plugins.ts:249) or re-resolve from DB roles (templates.ts:63-75 → lib `hasPermission`, locations.ts:10-21 / nests.ts:11-22 → lib `hasAnyPermission`, roles.ts `checkPermission`, `resolveServerPermissions`, `hasNodeAccess` permissions.ts:638). A generated suite that only injects perms will false-fail DB-driven routes; one that only creates roles will false-fail request-driven routes. **Contract harness must do both: create the persona's Role rows in the dev DB AND inject the identical perms array.**

Middleware-level testing requires extracting `authenticate` from server.ts:442-595 into `src/middleware/authenticate.ts` (implementation task, flagged as a dependency) so the key-scope block can be exercised with real `createApiKey` fixtures. Until extracted, the key-scope matrix covers `enforceKeyScope` (servers/_helpers.ts:487-493) and the admin inline ceiling (admin.ts:1591-1598) at route level.

## 3. The 296-op contract matrix

Personas (each a real DB user + role, plus identical injected perms):

- **AR** — `['admin.read']` only. Read ops → non-403; write ops → 403.
- **AW** — `['admin.write']` only. Everything → non-403.
- **PU** — no roles, `[]`. Permission-gated ops → 403; self-scoped → non-403.
- **STAR** — `['*']`. Sanity: non-403 everywhere gated.
- **KEY** — `apiKeyId` set + narrow key perms (see §5b).

Cells: ✓ expect non-403 · ✗ expect 403 · S non-403 but scoped to own resources (empty for PU) · — no permission gate applies (self / public / unauth / agent / token). **K**: Y = `enforceKeyScope` wired today (power/files/databases routes pass `request.user` actor: power.ts:483, files.ts:82/115, databases via `ensureDatabasePermission` _helpers.ts:1449+; admin bulk actions admin.ts:1591-1598); W = key-scope to be wired during implementation (backups/variables per audit); — = not applicable. R/W column: R = read-class (GET + read-effect POSTs), W = write-class. Tier (last column): T0 403-fast/personas-only · T1 personas+shared fixtures · T2 +gateway/loader stubs · T3 special (see §4).

### 3.1 /api/admin — 73 ops (gate source: `checkPerm`/`checkAnyPerm`/`canManageUsers` on `request.user.permissions`, admin.ts:73-88; migration routes inline)

| op | R/W | AR | AW | PU | K | tier |
|---|---|---|---|---|---|---|
| GET /api/admin/api-keys | R | ✓ | ✓ | ✗ | — | T0 |
| GET /api/admin/api-keys/my-permissions | R | ✓ | ✓ | ✗ | — | T0 |
| GET /api/admin/api-keys/permissions-catalog | R | ✓ | ✓ | ✗ | — | T0 |
| GET /api/admin/audit-logs | R | ✓ | ✓ | ✗ | — | T0 |
| GET /api/admin/audit-logs/export | R | ✓ | ✓ | ✗ | — | T0 |
| GET /api/admin/auth-lockouts | R | ✓ | ✓ | ✗ | — | T0 |
| GET /api/admin/database-hosts | R | ✓ | ✓ | ✗ | — | T0 |
| GET /api/admin/database-hosts/{hostId}/ping | R | ✓ | ✓ | ✗ | — | T0 |
| GET /api/admin/db-status | R | ✓ | ✓ | ✗ | — | T0 |
| GET /api/admin/diagnostics/export | R | ✓ | ✓ | ✗ | — | T0 |
| GET /api/admin/events | R | ✓ | ✓ | ✗ | — | T0 |
| GET /api/admin/health | R | ✓ | ✓ | ✗ | — | T0 |
| GET /api/admin/ip-pools | R | ✓ | ✓ | ✗ | — | T0 |
| GET /api/admin/localization-settings | R | ✓ | ✓ | ✗ | — | T0 |
| GET /api/admin/mcp-settings | R | ✓ | ✓ | ✗ | — | T0 |
| GET /api/admin/migration | R | ✓ | ✓ | ✗ | — | T0 |
| GET /api/admin/migration/catalyst-nodes | R | ✓ | ✓ | ✗ | — | T0 |
| GET /api/admin/migration/{jobId} | R | ✓ | ✓ | ✗ | — | T0 |
| GET /api/admin/migration/{jobId}/steps | R | ✓ | ✓ | ✗ | — | T0 |
| GET /api/admin/mod-manager | R | ✓ | ✓ | ✗ | — | T0 |
| GET /api/admin/nodes | R | ✓ | ✓ | ✗ | — | T0 |
| GET /api/admin/oidc-config | R | ✓ | ✓ | ✗ | — | T0 |
| GET /api/admin/roles | R | ✓ | ✓ | ✗ | — | T0 |
| GET /api/admin/security-settings | R | ✓ | ✓ | ✗ | — | T0 |
| GET /api/admin/servers | R | ✓ | ✓ | ✗ | — | T0 |
| GET /api/admin/settings/file-tunnel-upload-limit | R | ✓ | ✓ | ✗ | — | T0 |
| GET /api/admin/smtp | R | ✓ | ✓ | ✗ | — | T0 |
| GET /api/admin/stats | R | ✓ | ✓ | ✗ | — | T0 |
| GET /api/admin/system-errors | R | ✓ | ✓ | ✗ | — | T0 |
| GET /api/admin/system-errors/export | R | ✓ | ✓ | ✗ | — | T0 |
| GET /api/admin/theme-settings | R | ✓ | ✓ | ✗ | — | T0 |
| GET /api/admin/update/settings | R | ✓ | ✓ | ✗ | — | T0 |
| GET /api/admin/update/state | R | ✓ | ✓ | ✗ | — | T0 |
| GET /api/admin/update/status | R | ✓ | ✓ | ✗ | — | T0 |
| GET /api/admin/users | R | ✓ | ✓ | ✗ | — | T0 |
| GET /api/admin/users/{userId}/servers | R | ✓ | ✓ | ✗ | — | T0 |
| POST /api/admin/api-keys | W | ✗ | ✓ | ✗ | — | T0 |
| POST /api/admin/database-hosts | W | ✗ | ✓ | ✗ | — | T0 |
| POST /api/admin/ip-pools | W | ✗ | ✓ | ✗ | — | T0 |
| POST /api/admin/migration/{jobId}/cancel | W | ✗ | ✓ | ✗ | — | T3 (validation-blocked) |
| POST /api/admin/migration/{jobId}/pause | W | ✗ | ✓ | ✗ | — | T3 |
| POST /api/admin/migration/{jobId}/resume | W | ✗ | ✓ | ✗ | — | T3 |
| POST /api/admin/migration/{jobId}/retry/{stepId} | W | ✗ | ✓ | ✗ | — | T3 |
| POST /api/admin/migration/start | W | ✗ | ✓ | ✗ | — | T3 |
| POST /api/admin/migration/test | W | ✗ | ✓ | ✗ | — | T3 |
| POST /api/admin/servers/actions | W | ✗ | ✓ | ✗ | Y | T0 (invalid action → 400) |
| POST /api/admin/system-errors/{id}/resolve | W | ✗ | ✓ | ✗ | — | T0 |
| POST /api/admin/system-errors/resolve-all | W | ✗ | ✓ | ✗ | — | T0 |
| POST /api/admin/update/check | R | ✓ | ✓ | ✗ | — | T0 |
| POST /api/admin/update/trigger | W | ✗ | ✓ | ✗ | — | T3 (destructive — validation-blocked only) |
| POST /api/admin/users | W | ✗ | ✓ | ✗ | — | T0 |
| POST /api/admin/users/{userId}/ban | W | ✗ | ✓ | ✗ | — | T0 |
| POST /api/admin/users/{userId}/delete | W | ✗ | ✓ | ✗ | — | T0 |
| POST /api/admin/users/{userId}/unban | W | ✗ | ✓ | ✗ | — | T0 |
| PUT /api/admin/database-hosts/{hostId} | W | ✗ | ✓ | ✗ | — | T0 |
| PUT /api/admin/ip-pools/{poolId} | W | ✗ | ✓ | ✗ | — | T0 |
| PUT /api/admin/localization-settings | W | ✗ | ✓ | ✗ | — | T0 |
| PUT /api/admin/mcp-settings | W | ✗ | ✓ | ✗ | — | T0 |
| PUT /api/admin/mod-manager | W | ✗ | ✓ | ✗ | — | T0 |
| PUT /api/admin/security-settings | W | ✗ | ✓ | ✗ | — | T0 |
| PUT /api/admin/smtp | W | ✗ | ✓ | ✗ | — | T0 |
| PUT /api/admin/update/settings | W | ✗ | ✓ | ✗ | — | T0 |
| PUT /api/admin/users/{userId} | W | ✗ | ✓ | ✗ | — | T0 |
| PUT /api/admin/users/{userId}/enforce-2fa | W | ✗ | ✓ | ✗ | — | T0 |
| PUT /api/admin/users/{userId}/verify-email | W | ✗ | ✓ | ✗ | — | T0 |
| PATCH /api/admin/oidc-config | W | ✗ | ✓ | ✗ | — | T0 |
| PATCH /api/admin/theme-settings | W | ✗ | ✓ | ✗ | — | T0 |
| DELETE /api/admin/auth-lockouts/{lockoutId} | W | ✗ | ✓ | ✗ | — | T0 |
| DELETE /api/admin/database-hosts/{hostId} | W | ✗ | ✓ | ✗ | — | T0 |
| DELETE /api/admin/ip-pools/{poolId} | W | ✗ | ✓ | ✗ | — | T0 |
| DELETE /api/admin/users/{userId}/accounts/{accountId} | W | ✗ | ✓ | ✗ | — | T0 |
| DELETE /api/admin/users/{userId}/passkeys | W | ✗ | ✓ | ✗ | — | T0 |
| DELETE /api/admin/users/{userId}/two-factor | W | ✗ | ✓ | ✗ | — | T0 |

Note: `canManageUsers` (admin.ts:84-88) is raw `includes('user.${action}')` — AW must pass via `hasGrant`; targeted regression test in §5f.

### 3.2 /api/nodes — 38 ops (gate source: `ensurePermission` raw includes nodes.ts:57-66 + `hasNodeAccess`/`resolveServerPermissions`; target contract from infra.md §4)

| op | R/W | AR | AW | PU | K | tier |
|---|---|---|---|---|---|---|
| GET /api/nodes | R | ✓ | ✓ | ✗ | — | T0 |
| GET /api/nodes/accessible | R | ✓ | ✓ | ✗ | — | T0 |
| GET /api/nodes/{nodeId} | R | ✓ | ✓ | ✗ | — | T1 |
| GET /api/nodes/{nodeId}/agent/config | R | ✓ | ✓ | ✗ | — | T1 (sensitive — see §5d) |
| GET /api/nodes/{nodeId}/agent/logs | R | ✓ | ✓ | ✗ | — | T1 |
| GET /api/nodes/{nodeId}/agent/logs/stream | R | ✓ | ✓ | ✗ | — | T3 (SSE hijack — 403-side only in runner) |
| GET /api/nodes/{nodeId}/agent/status | R | ✓ | ✓ | ✗ | — | T1 |
| GET /api/nodes/{nodeId}/agent/update-status | R | ✓ | ✓ | ✗ | — | T1 |
| GET /api/nodes/{nodeId}/allocations | R | ✓ | ✓ | ✗ | — | T1 |
| GET /api/nodes/{nodeId}/api-key | R | ✓ | ✓ | ✗ | — | T1 |
| GET /api/nodes/{nodeId}/assignments | R | ✓ | ✓ | ✗ | — | T1 |
| GET /api/nodes/{nodeId}/ip-availability | R | ✓ | ✓ | ✗ | — | T1 |
| GET /api/nodes/{nodeId}/ip-pools | R | ✓ | ✓ | ✗ | — | T1 |
| GET /api/nodes/{nodeId}/metrics | R | ✓ | ✓ | ✗ | — | T0 (gate metrics.ts:405-411 precedes node lookup) |
| GET /api/nodes/{nodeId}/stats | R | ✓ | ✓ | ✗ | — | T1 |
| GET /api/nodes/{nodeId}/unregistered-containers | R | ✓ | ✓ | ✗ | — | T0 |
| GET /api/nodes/{nodeId}/unregistered-containers/{containerId}/suggest-template | R | ✓ | ✓ | ✗ | — | T0 |
| POST /api/nodes | W | ✗ | ✓ | ✗ | — | T0 (dup-name body → 409/400 after gate) |
| POST /api/nodes/assign-wildcard | W | ✗ | ✓ | ✗ | — | T0 (node.assign-only must 403 — §5e) |
| POST /api/nodes/{nodeId}/agent/ping | R | ✓ | ✓ | ✗ | — | T1 |
| POST /api/nodes/{nodeId}/agent/restart | W | ✗ | ✓ | ✗ | — | T1 |
| POST /api/nodes/{nodeId}/agent/update | W | ✗ | ✓ | ✗ | — | T1 |
| POST /api/nodes/{nodeId}/allocations | W | ✗ | ✓ | ✗ | — | T1 |
| POST /api/nodes/{nodeId}/allocations/bulk-delete | W | ✗ | ✓ | ✗ | — | T1 |
| POST /api/nodes/{nodeId}/api-key | W | ✗ | ✓ | ✗ | — | T1 |
| POST /api/nodes/{nodeId}/assign | W | ✗ | ✓ | ✗ | — | T1 |
| POST /api/nodes/{nodeId}/deployment-token | W | ✗ | ✓ | ✗ | — | T1 |
| POST /api/nodes/{nodeId}/heartbeat | — | — | — | — | — | AGENT (agent-key auth, by design) |
| POST /api/nodes/{nodeId}/host-network | W | ✗ | ✓ | ✗ | — | T1 |
| POST /api/nodes/{nodeId}/import-server | W | ✗ | ✓ | ✗ | — | T0 (missing fields → 400 after gate) |
| PUT /api/nodes/{nodeId} | W | ✗ | ✓ | ✗ | — | T1 |
| PUT /api/nodes/{nodeId}/agent/config | W | ✗ | ✓ | ✗ | — | T1 |
| PATCH /api/nodes/auto-update | W | ✗ | ✓ | ✗ | — | T0 (invalid nodeIds → 400) |
| PATCH /api/nodes/{nodeId}/allocations/{allocationId} | W | ✗ | ✓ | ✗ | — | T1 |
| DELETE /api/nodes/assign-wildcard/{targetType}/{targetId} | W | ✗ | ✓ | ✗ | — | T0 |
| DELETE /api/nodes/{nodeId} | W | ✗ | ✓ | ✗ | — | T1 |
| DELETE /api/nodes/{nodeId}/allocations/{allocationId} | W | ✗ | ✓ | ✗ | — | T1 |
| DELETE /api/nodes/{nodeId}/assignments/{assignmentId} | W | ✗ | ✓ | ✗ | — | T1 |

T1 nodes rows use a shared node fixture; AR's non-403 depends on the `hasNodeAccess` read-mode fix (infra.md fix #4).

### 3.3 /api/servers — 103 ops (gate source: `ensureServerAccess`/`canAccessServer` → `decideServerAccess`, server lookup FIRST (404-before-gate) → fixtures mandatory)

| op | R/W | AR | AW | PU | K | tier |
|---|---|---|---|---|---|---|
| GET /api/servers | R | ✓ | ✓ | S | — | T1 |
| GET /api/servers/database-hosts | R | ✓ | ✓ | ✗ | — | T1 (privileged list databases.ts:14-25) |
| GET /api/servers/invites/{token} | — | — | — | — | — | TOKEN (invite-token auth, by design) |
| GET /api/servers/{serverId} | R | ✓ | ✓ | ✗ | — | T1 |
| GET /api/servers/{serverId}/activity | R | ✓ | ✓ | ✗ | — | T1 |
| GET /api/servers/{serverId}/allocations | R | ✓ | ✓ | ✗ | — | T1 |
| GET /api/servers/{serverId}/backups | R | ✓ | ✓ | ✗ | W | T1 |
| GET /api/servers/{serverId}/backups/{backupId} | R | ✓ | ✓ | ✗ | W | T1 |
| GET /api/servers/{serverId}/backups/{backupId}/download | R | ✓ | ✓ | ✗ | W | T1 (backup.download is read-class) |
| GET /api/servers/{serverId}/cs2/frameworks | R | ✓ | ✓ | ✗ | — | T1 |
| GET /api/servers/{serverId}/cs2/frameworks/{frameworkId}/releases | R | ✓ | ✓ | ✗ | — | T1 |
| GET /api/servers/{serverId}/cs2/plugins | R | ✓ | ✓ | ✗ | — | T1 |
| GET /api/servers/{serverId}/databases | R | ✓ | ✓ | ✗ | W | T1 |
| GET /api/servers/{serverId}/files | R | ✓ | ✓ | ✗ | Y | T1 |
| GET /api/servers/{serverId}/files/download | R | ✓ | ✓ | ✗ | Y | T1 |
| GET /api/servers/{serverId}/invites | R | ✓ | ✓ | ✗ | — | T1 |
| GET /api/servers/{serverId}/logs | R | ✓ | ✓ | ✗ | — | T1 |
| GET /api/servers/{serverId}/metrics | R | ✓ | ✓ | ✗ | — | T1 (see §5g exact-match bug) |
| GET /api/servers/{serverId}/mod-manager/game-versions | R | ✓ | ✓ | ✗ | — | T1 |
| GET /api/servers/{serverId}/mod-manager/installed | R | ✓ | ✓ | ✗ | — | T1 |
| GET /api/servers/{serverId}/mod-manager/search | R | ✓ | ✓ | ✗ | — | T1 |
| GET /api/servers/{serverId}/mod-manager/versions | R | ✓ | ✓ | ✗ | — | T1 |
| GET /api/servers/{serverId}/permissions | R | ✓ | ✓ | S | — | T1 (subuser UI effective perms) |
| GET /api/servers/{serverId}/plugin-manager/game-versions | R | ✓ | ✓ | ✗ | — | T1 |
| GET /api/servers/{serverId}/plugin-manager/installed | R | ✓ | ✓ | ✗ | — | T1 |
| GET /api/servers/{serverId}/plugin-manager/search | R | ✓ | ✓ | ✗ | — | T1 |
| GET /api/servers/{serverId}/plugin-manager/versions | R | ✓ | ✓ | ✗ | — | T1 |
| GET /api/servers/{serverId}/stats | R | ✓ | ✓ | ✗ | — | T1 |
| GET /api/servers/{serverId}/stats/history | R | ✓ | ✓ | ✗ | — | T1 |
| GET /api/servers/{serverId}/tasks | R | ✓ | ✓ | ✗ | — | T1 (see §5h task-listing perms) |
| GET /api/servers/{serverId}/tasks/{taskId} | R | ✓ | ✓ | ✗ | — | T1 |
| GET /api/servers/{serverId}/transfer-candidates | R | ✓ | ✓ | ✗ | — | T1 |
| GET /api/servers/{serverId}/variables | R | ✓ | ✓ | ✗ | W | T1 |
| POST /api/servers | W | ✗ | ✓ | ✗ | — | T1 (invalid body → 400 proves gate) |
| POST /api/servers/bulk/status | W | ✗ | ✓ | ✗ | — | T1 |
| POST /api/servers/bulk/suspend | W | ✗ | ✓ | ✗ | — | T1 |
| POST /api/servers/bulk/unsuspend | W | ✗ | ✓ | ✗ | — | T1 |
| POST /api/servers/eula | W | ✗ | ✓ | ✗ | — | T1 |
| POST /api/servers/{id}/reset-crash-count | W | ✗ | ✓ | ✗ | — | T1 |
| POST /api/servers/{id}/transfer | W | ✗ | ✓ | ✗ | — | T1 |
| POST /api/servers/invites/accept | — | — | — | — | — | TOKEN+auth (invite flow — §5b special) |
| POST /api/servers/invites/register | — | — | — | — | — | TOKEN (by design) |
| POST /api/servers/{serverId}/access | W | ✗ | ✓ | ✗ | — | T1 |
| POST /api/servers/{serverId}/allocations | W | ✗ | ✓ | ✗ | — | T1 |
| POST /api/servers/{serverId}/allocations/primary | W | ✗ | ✓ | ✗ | — | T1 |
| POST /api/servers/{serverId}/archive | W | ✗ | ✓ | ✗ | — | T1 |
| POST /api/servers/{serverId}/backups | W | ✗ | ✓ | ✗ | W | T1 |
| POST /api/servers/{serverId}/backups/{backupId}/restore | W | ✗ | ✓ | ✗ | W | T1 |
| POST /api/servers/{serverId}/cancel-install | W | ✗ | ✓ | ✗ | — | T1 |
| POST /api/servers/{serverId}/clone | W | ✗ | ✓ | ✗ | — | T1 (invalid body → 400) |
| POST /api/servers/{serverId}/clone/{cloneId}/retry | W | ✗ | ✓ | ✗ | — | T1 |
| POST /api/servers/{serverId}/clone/preflight | R | ✓ | ✓ | ✗ | — | T1 (computation-only) |
| POST /api/servers/{serverId}/cs2/frameworks/{frameworkId}/install | W | ✗ | ✓ | ✗ | — | T1 |
| POST /api/servers/{serverId}/cs2/frameworks/{frameworkId}/uninstall | W | ✗ | ✓ | ✗ | — | T1 |
| POST /api/servers/{serverId}/cs2/plugins/uninstall | W | ✗ | ✓ | ✗ | — | T1 |
| POST /api/servers/{serverId}/databases | W | ✗ | ✓ | ✗ | Y | T1 |
| POST /api/servers/{serverId}/databases/{databaseId}/rotate | W | ✗ | ✓ | ✗ | Y | T1 |
| POST /api/servers/{serverId}/files/archive-contents | R | ✓ | ✓ | ✗ | Y | T1 |
| POST /api/servers/{serverId}/files/compress | W | ✗ | ✓ | ✗ | Y | T1 |
| POST /api/servers/{serverId}/files/create | W | ✗ | ✓ | ✗ | Y | T1 |
| POST /api/servers/{serverId}/files/decompress | W | ✗ | ✓ | ✗ | Y | T1 |
| POST /api/servers/{serverId}/files/permissions | W | ✗ | ✓ | ✗ | Y | T1 |
| POST /api/servers/{serverId}/files/rename | W | ✗ | ✓ | ✗ | Y | T1 |
| POST /api/servers/{serverId}/files/upload | W | ✗ | ✓ | ✗ | Y | T3 (multipart — 403-side in runner) |
| POST /api/servers/{serverId}/files/write | W | ✗ | ✓ | ✗ | Y | T1 |
| POST /api/servers/{serverId}/install | W | ✗ | ✓ | ✗ | — | T1 |
| POST /api/servers/{serverId}/invites | W | ✗ | ✓ | ✗ | — | T1 |
| POST /api/servers/{serverId}/invites/{inviteId}/regenerate | W | ✗ | ✓ | ✗ | — | T1 |
| POST /api/servers/{serverId}/kill | W | ✗ | ✓ | ✗ | Y | T1 |
| POST /api/servers/{serverId}/mod-manager/check-updates | R | ✓ | ✓ | ✗ | — | T1 |
| POST /api/servers/{serverId}/mod-manager/install | W | ✗ | ✓ | ✗ | — | T1 |
| POST /api/servers/{serverId}/mod-manager/uninstall | W | ✗ | ✓ | ✗ | — | T1 |
| POST /api/servers/{serverId}/mod-manager/update | W | ✗ | ✓ | ✗ | — | T1 |
| POST /api/servers/{serverId}/plugin-manager/check-updates | R | ✓ | ✓ | ✗ | — | T1 |
| POST /api/servers/{serverId}/plugin-manager/install | W | ✗ | ✓ | ✗ | — | T1 |
| POST /api/servers/{serverId}/plugin-manager/uninstall | W | ✗ | ✓ | ✗ | — | T1 |
| POST /api/servers/{serverId}/plugin-manager/update | W | ✗ | ✓ | ✗ | — | T1 |
| POST /api/servers/{serverId}/rebuild | W | ✗ | ✓ | ✗ | — | T1 |
| POST /api/servers/{serverId}/reinstall | W | ✗ | ✓ | ✗ | — | T1 |
| POST /api/servers/{serverId}/restart | W | ✗ | ✓ | ✗ | Y | T1 |
| POST /api/servers/{serverId}/restore | W | ✗ | ✓ | ✗ | — | T1 |
| POST /api/servers/{serverId}/start | W | ✗ | ✓ | ✗ | Y | T1 |
| POST /api/servers/{serverId}/stop | W | ✗ | ✓ | ✗ | Y | T1 |
| POST /api/servers/{serverId}/storage/resize | W | ✗ | ✓ | ✗ | — | T1 |
| POST /api/servers/{serverId}/suspend | W | ✗ | ✓ | ✗ | — | T1 |
| POST /api/servers/{serverId}/tasks | W | ✗ | ✓ | ✗ | — | T1 |
| POST /api/servers/{serverId}/tasks/{taskId}/execute | W | ✗ | ✓ | ✗ | — | T1 |
| POST /api/servers/{serverId}/transfer-ownership | W | ✗ | ✓ | ✗ | — | T1 |
| POST /api/servers/{serverId}/unsuspend | W | ✗ | ✓ | ✗ | — | T1 |
| PUT /api/servers/{serverId} | W | ✗ | ✓ | ✗ | — | T1 |
| PUT /api/servers/{serverId}/tasks/{taskId} | W | ✗ | ✓ | ✗ | — | T1 |
| PATCH /api/servers/{id}/backup-settings | W | ✗ | ✓ | ✗ | W | T1 |
| PATCH /api/servers/{id}/restart-policy | W | ✗ | ✓ | ✗ | — | T1 |
| PATCH /api/servers/{serverId}/variables | W | ✗ | ✓ | ✗ | W | T1 |
| DELETE /api/servers/bulk | W | ✗ | ✓ | ✗ | — | T1 |
| DELETE /api/servers/{serverId} | W | ✗ | ✓ | ✗ | — | T1 |
| DELETE /api/servers/{serverId}/access/{targetUserId} | W | ✗ | ✓ | ✗ | — | T1 |
| DELETE /api/servers/{serverId}/allocations/{containerPort} | W | ✗ | ✓ | ✗ | — | T1 |
| DELETE /api/servers/{serverId}/backups/{backupId} | W | ✗ | ✓ | ✗ | W | T1 |
| DELETE /api/servers/{serverId}/databases/{databaseId} | W | ✗ | ✓ | ✗ | Y | T1 |
| DELETE /api/servers/{serverId}/files/delete | W | ✗ | ✓ | ✗ | Y | T1 |
| DELETE /api/servers/{serverId}/invites/{inviteId} | W | ✗ | ✓ | ✗ | — | T1 |
| DELETE /api/servers/{serverId}/tasks/{taskId} | W | ✗ | ✓ | ✗ | — | T1 |

PU column for `GET /api/servers` and `GET …/permissions` is **S** (non-403, scoped to own rows — the plain user owns nothing, so 200-empty is correct, not a leak).

### 3.4 /api/auth — 15 ops (self-scoped; no permission gate)

| op | R/W | AR | AW | PU | K | tier |
|---|---|---|---|---|---|---|
| POST /api/auth/login | — | — | — | — | — | UNAUTH by design |
| POST /api/auth/register | — | — | — | — | — | UNAUTH by design |
| POST /api/auth/forgot-password | — | — | — | — | — | UNAUTH by design |
| POST /api/auth/reset-password/validate | — | — | — | — | — | UNAUTH by design |
| GET /api/auth/me | R-self | ✓ | ✓ | ✓ | — | T0 |
| GET /api/auth/profile | R-self | ✓ | ✓ | ✓ | — | T0 |
| GET /api/auth/profile/api-keys | R-self | ✓ | ✓ | ✓ | — | T0 |
| GET /api/auth/profile/audit-log | R-self | ✓ | ✓ | ✓ | — | T0 |
| GET /api/auth/profile/export | R-self | ✓ | ✓ | ✓ | — | T0 |
| PATCH /api/auth/profile | W-self | ✓ | ✓ | ✓ | — | T0 |
| PATCH /api/auth/profile/preferences | W-self | ✓ | ✓ | ✓ | — | T0 |
| POST /api/auth/profile/avatar | W-self | ✓ | ✓ | ✓ | — | T3 (multipart) |
| POST /api/auth/profile/delete | W-self | ✓ | ✓ | ✓ | — | T0 |
| POST /api/auth/profile/sso/unlink | W-self | ✓ | ✓ | ✓ | — | T0 |
| DELETE /api/auth/profile/avatar | W-self | ✓ | ✓ | ✓ | — | T0 |

### 3.5 /api/roles — 13 ops (DB-driven `checkPermission`)

| op | R/W | AR | AW | PU | K | tier |
|---|---|---|---|---|---|---|
| GET /api/roles | R | ✓ | ✓ | ✗ | — | T1 |
| GET /api/roles/presets | R | ✓ | ✓ | ✗ | — | T1 |
| GET /api/roles/{roleId} | R | ✓ | ✓ | ✗ | — | T1 |
| GET /api/roles/{roleId}/nodes | R | ✓ | ✓ | ✗ | — | T1 |
| GET /api/roles/users/{userId}/nodes | R | ✓ | ✓ | ✗ | — | T1 |
| GET /api/roles/users/{userId}/roles | R | ✓ | ✓ | ✗ | — | T1 |
| POST /api/roles | W | ✗ | ✓ | ✗ | — | T1 |
| POST /api/roles/{roleId}/permissions | W | ✗ | ✓ | ✗ | — | T1 |
| POST /api/roles/{roleId}/users/{userId} | W | ✗ | ✓ | ✗ | — | T1 |
| PUT /api/roles/{roleId} | W | ✗ | ✓ | ✗ | — | T1 |
| DELETE /api/roles/{roleId} | W | ✗ | ✓ | ✗ | — | T1 |
| DELETE /api/roles/{roleId}/permissions/* | W | ✗ | ✓ | ✗ | — | T1 |
| DELETE /api/roles/{roleId}/users/{userId} | W | ✗ | ✓ | ✗ | — | T1 |

### 3.6 /api/alerts (6) + /api/alert-rules (5) — 11 ops

| op | R/W | AR | AW | PU | K | tier |
|---|---|---|---|---|---|---|
| GET /api/alerts | R | ✓ | ✓ | ✗ | — | T1 (admin path or serverId scope) |
| GET /api/alerts/{alertId} | R | ✓ | ✓ | ✗ | — | T1 |
| GET /api/alerts/{alertId}/deliveries | R | ✓ | ✓ | ✗ | — | T1 |
| GET /api/alerts/stats | R | ✓ | ✓ | ✗ | — | T1 |
| POST /api/alerts/{alertId}/resolve | W | ✗ | ✓ | ✗ | — | T1 |
| POST /api/alerts/bulk-resolve | W | ✗ | ✓ | ✗ | — | T1 |
| GET /api/alert-rules | R | ✓ | ✓ | ✗ | — | T1 |
| GET /api/alert-rules/{ruleId} | R | ✓ | ✓ | ✗ | — | T1 |
| POST /api/alert-rules | W | ✗ | ✓ | ✗ | — | T1 |
| PUT /api/alert-rules/{ruleId} | W | ✗ | ✓ | ✗ | — | T1 |
| DELETE /api/alert-rules/{ruleId} | W | ✗ | ✓ | ✗ | — | T1 |

### 3.7 /api/dashboard (3), /api/locations (5), /api/nests (5), /api/templates (7), /api/plugins (14), /api/settings (1), /api/providers (1), /api/setup (3), /api/internal (4)

| op | R/W | AR | AW | PU | K | tier |
|---|---|---|---|---|---|---|
| GET /api/dashboard/stats | R | ✓ | ✓ | ✗ | — | T0 (see §5c global counts) |
| GET /api/dashboard/activity | R | ✓ | ✓ | ✗ | — | T0 |
| GET /api/dashboard/resources | R | ✓ | ✓ | ✗ | — | T0 |
| GET /api/locations | R | ✓ | ✓ | ✗ | — | T1 |
| GET /api/locations/{locationId} | R | ✓ | ✓ | ✗ | — | T1 |
| POST /api/locations | W | ✗ | ✓ | ✗ | — | T1 |
| PUT /api/locations/{locationId} | W | ✗ | ✓ | ✗ | — | T1 |
| DELETE /api/locations/{locationId} | W | ✗ | ✓ | ✗ | — | T1 |
| GET /api/nests | R | ✓ | ✓ | ✗ | — | T1 |
| GET /api/nests/{nestId} | R | ✓ | ✓ | ✗ | — | T1 |
| POST /api/nests | W | ✗ | ✓ | ✗ | — | T1 |
| PUT /api/nests/{nestId} | W | ✗ | ✓ | ✗ | — | T1 |
| DELETE /api/nests/{nestId} | W | ✗ | ✓ | ✗ | — | T1 |
| GET /api/templates | R | ✓ | ✓ | ✗ | — | T1 |
| GET /api/templates/{templateId} | R | ✓ | ✓ | ✗ | — | T1 |
| POST /api/templates | W | ✗ | ✓ | ✗ | — | T1 |
| POST /api/templates/import-pterodactyl | W | ✗ | ✓ | ✗ | — | T1 (invalid egg → 422) |
| POST /api/templates/import-pterodactyl-batch | W | ✗ | ✓ | ✗ | — | T3 (network — invalid repo → 400) |
| PUT /api/templates/{templateId} | W | ✗ | ✓ | ✗ | — | T1 |
| DELETE /api/templates/{templateId} | W | ✗ | ✓ | ✗ | — | T1 |
| GET /api/plugins | R | ✓ | ✓ | ✗ | — | T2 (pluginLoader stub) |
| GET /api/plugins/marketplace | R | ✓ | ✓ | ✗ | — | T2 |
| GET /api/plugins/marketplace/sources | R | ✓ | ✓ | ✗ | — | T2 |
| GET /api/plugins/{name} | R | ✓ | ✓ | ✗ | — | T2 |
| GET /api/plugins/{name}/frontend-manifest | R | ✓ | ✓ | ✓ | — | T2 (redacted for non-admins — wave2 contract) |
| POST /api/plugins/install | W | ✗ | ✓ | ✗ | — | T2 |
| POST /api/plugins/marketplace/sources | W | ✗ | ✓ | ✗ | — | T2 |
| POST /api/plugins/{name}/enable | W | ✗ | ✓ | ✗ | — | T2 |
| POST /api/plugins/{name}/reload | W | ✗ | ✓ | ✗ | — | T2 |
| POST /api/plugins/{name}/uninstall | W | ✗ | ✓ | ✗ | — | T2 |
| PUT /api/plugins/{name}/config | W | ✗ | ✓ | ✗ | — | T2 |
| PUT /api/plugins/{name}/permissions | W | ✗ | ✓ | ✗ | — | T2 |
| PATCH /api/plugins/marketplace/sources/{id} | W | ✗ | ✓ | ✗ | — | T2 |
| DELETE /api/plugins/marketplace/sources/{id} | W | ✗ | ✓ | ✗ | — | T2 |
| GET /api/settings/locale | — | — | — | — | — | PUBLIC (no auth, settings.ts:30-48) |
| GET /api/providers/status | R-any | ✓ | ✓ | ✓ | — | T0 (every authenticated user, provider-keys.ts:14-30) |
| GET /api/setup/environment | — | — | — | — | — | STATE-MACHINE (pre-init only) |
| GET /api/setup/status | — | — | — | — | — | STATE-MACHINE |
| POST /api/setup/complete | — | — | — | — | — | STATE-MACHINE |
| GET /api/internal/file-tunnel/poll | — | — | — | — | — | AGENT-INTERNAL by design |
| GET /api/internal/file-tunnel/upload/{requestId} | — | — | — | — | — | AGENT-INTERNAL |
| POST /api/internal/file-tunnel/response/{requestId} | — | — | — | — | — | AGENT-INTERNAL |
| POST /api/internal/file-tunnel/response/{requestId}/stream | — | — | — | — | — | AGENT-INTERNAL |

**Not in openapi.json but in scope of the targeted suite (§5):** the four SFTP routes defined inline in server.ts (`/api/sftp/connection-info` :1511, `/api/sftp/rotate-token` :1621, `/api/sftp/tokens` :1707, `/api/sftp/tokens/:targetUserId` :1785, `/api/sftp/tokens` DELETE :1833) and `GET /api/agent/version` (server.ts:1122-1136) — module-extraction prerequisite, see §5i.

**Matrix totals:** 296 ops = ~130 read-class + ~140 write-class + 15 by-design N/A + 11 self-scoped. ~46 rows carry K=Y (wired) and ~10 K=W (to wire).

## 4. (a) Generated table-driven route-contract test

**Feasibility: YES — ~266 of 296 ops (90%) can be matrix-executed on both deny and allow sides.** 15 ops are by-design N/A (unauth/agent/token/setup); ~10 more are 403-side-only in the generated runner (SSE stream, multipart uploads, destructive triggers) and get allow-side coverage from the targeted suite (§5). Route modules are importable for every openapi prefix except the SFTP/agent-version inline routes.

### Design

**File:** `src/__tests__/route-contract.matrix.ts` (data only, no `.test.ts` suffix) + `src/__tests__/route-contract.test.ts` (runner) + `src/__tests__/route-contract-harness.ts` (shared builder) + `src/__tests__/route-contract-fixtures.ts`.

**Harness (`buildContractApp(persona, tier)`):**

1. `Fastify({ logger: false })`; `app.decorate('authenticate', …)` injecting `request.user = { userId: persona.userId, email, username, permissions: persona.perms, apiKeyId: persona.apiKeyId }` — P-A/P-C pattern (diagnostics-export.test.ts:284-291).
2. **Persona provisioning (P-B):** `beforeAll` creates 4 users + roles in the dev DB — `contract-admin-read` (`['admin.read']`), `contract-admin-write` (`['admin.write']`), `contract-plain` (`[]`), `contract-star` (`['*']`) — so DB-resolution gates (templates/locations/nests/roles, `hasNodeAccess`, `resolveServerPermissions`) see the same truth as the injected perms. `afterAll` deletes them (AGENTS.md cleanup; nanoid names like power-access-rbac.test.ts:75-96).
3. **Tier-1 shared fixtures:** one location + node + template + server (owned by a 5th `contract-owner` user) + nodeAssignment none — created once, deleted in `afterAll` (pattern: power-access-rbac.test.ts:98-150, server rows last-first in reverse order :153-167).
4. **Decorations for `serverRoutes`:** `wsGateway` (no-op pushers, `sendToAgent → true`, `requestFromAgent → { success: true, logs: [] }`), `webhookService`, `fileTunnel` — exact set proven by power-access-rbac.test.ts:41-57. For plugins routes: `pluginLoader` stub with `getRegistry().getAll() → []` (plugins.ts:256).
5. **Registration map** (same prefixes as server.ts:952-1118): `authRoutes('/api/auth')`, `settingsRoutes('/api/settings')`, `nodeRoutes('/api/nodes')`, `serverRoutes('/api/servers')`, `templateRoutes('/api/templates')`, `nestRoutes('/api/nests')`, `locationRoutes('/api/locations')`, `metricsRoutes('/api')`, `backupRoutes('/api/servers')`, `adminRoutes('/api/admin')`, `updateRoutes('/api/admin/update')`, `roleRoutes('/api/roles')`, `taskRoutes('/api/servers')`, `bulkServerRoutes('/api/servers')`, `alertRoutes('/api')`, `dashboardRoutes('/api/dashboard')`, `providerKeyRoutes('/api/providers')`, `apiKeyRoutes()`, `pluginRoutes(app, loaderStub, prisma)`, `migrationRoutes(app)`.

**Runner assertion protocol (per matrix row × persona):**

- Route-param substitution: `{serverId}` → fixture server id; `{nodeId}` → fixture node id; other params → well-formed non-existent ids (`nonexistent0000` cuid-shaped).
- PU (deny side): expect **403**.
- AR: read-class → expect **≠ 403** (200/400/404 all prove the gate opened); write-class → expect **403**.
- AW / STAR: expect **≠ 403** — sends a **minimal invalid payload** (`{}` or missing required fields) for writes so the response is a 400/409 validation error *after* the gate, never executing the write (the rbac-api.test.ts:436-447 trick, generalized). Read routes with unknown ids may 404 — acceptable.
- 401 can never occur (decorator always authenticates); route-level `config.rateLimit` is inert without the rate-limit plugin (verify once in a smoke case).
- Rows tagged T3 run **only the PU 403 side** in the generated suite.

**Test names** (one `it` per row, generated from the matrix): `it('GET /api/nodes/:nodeId/allocations — admin.read ✓ / admin.write ✓ / plain ✗')` etc. A `describe` per prefix group; failing output names the exact route and persona — a drift report by construction.

**Drift guard beyond personas:** a final `it('matrix covers every openapi operation')` reads `api/openapi.json` at test time, diffs it against the matrix rows, and **fails when a new route ships without a matrix row** — this is the lock that makes the suite fail on future drift, not just today's bugs.

### Which routes need what (feasibility classes)

- **T0 — 403-fast, personas only (~85 ops):** all `/api/admin` gates run `checkPerm` before any DB work; nodes outer `ensurePermission`; dashboard raw includes; update routes. Deny side needs nothing; allow side is validation-blocked (400).
- **T1 — personas + one shared server/node fixture (~170 ops):** every `/api/servers/*` (server `findUnique` precedes the gate — 404 would mask 403 without the fixture), nodes detail/agent/allocation/assignment routes, templates/locations/nests/roles/alerts/tasks/backups/metrics.
- **T2 — + loader/gateway stubs (14 ops):** plugins family.
- **T3 — special (~25 ops):** by-design N/A (15), SSE stream + multipart + destructive triggers (403-side only), auth profile avatar (multipart).

**3 hardest routes** (called out for the implementation phase):

1. `POST /api/servers` (create) — allow-side proof for admin.write needs the full fixture chain and a body that fails validation *after* the gate (missing `templateId`/`nodeId` → 400); a valid body would create a server + allocation and trigger the install pipeline through the wsGateway stub.
2. `GET /api/nodes/:nodeId/agent/logs/stream` — the allow side hijacks the reply and starts a 2s polling interval (nodes.ts:2848-2939); `app.inject` can complete it only with `requestFromAgent` stubbed and careful socket teardown, else leaked timers hang Vitest. 403-side only in the generated runner; allow-side is a targeted test.
3. `POST /api/admin/update/trigger` + `POST /api/admin/migration/start` — destructive machinery behind the gate; the generated test must never let them execute (validation-blocked payload, e.g. missing `confirm`), and the targeted suite mocks the auto-updater/migration service for the allow-side.

(Honorable mention: the inline-in-server.ts SFTP routes are not importable as a module — extraction is a prerequisite, §5i.)

## 5. (b) Targeted behavior tests — the systemic cases

All paths under `catalyst-backend/src/__tests__/`, names in repo style. DB-hitting tests create + clean up their rows (AGENTS.md).

**a. `nodes-permission-gates.test.ts`** — the P0 systemic fix (infra.md fix #1/#4):
- `it('nodes.ts ensurePermission honors hasGrant: admin.read reaches every node read')` — parametrized over the 17 GET routes with the P-A harness; must fail against today's raw includes (nodes.ts:57-66).
- `it('admin.write reaches every node write endpoint')` — the 11 F-ADMIN-GAP rows (PUT/DELETE node, allocations CRUD, assign, deployment-token, api-key, auto-update).
- `it('hasNodeAccess read-mode admits admin.read on node detail/stats/ip-pools/allocations/assignments reads')` — needs the read-mode param (permissions.ts:638-652).
- `it('node.update holder without node assignment cannot restart/update/config-write an agent')` — agent cluster scoping (nodes.ts:2948, 2995, 3207, 3286).
- `it('bare node.read cannot read agent config of an unassigned node')` (nodes.ts:3169 — the support-preset leak).
- `it('node.view_stats + assignment reaches node metrics history; admin.read too')` (metrics.ts:405-411).

**b. `key-scope-matrix.test.ts`** — API-key ceilings:
- Unit: extend the authz-fixes.test.ts:89-95 matrix for every K=Y family — `{ apiKeyId, permissions }` × required perm × `*` key (servers/_helpers.ts:487-493).
- Route-level: P-C harness with `apiKeyId` injected — `POST /api/servers/:id/start` with key perms `['server.read']` → 403; `['server.start']` → non-403; same for a file write and a database rotate (power.ts:483, files.ts:115, databases `ensureDatabasePermission`).
- `POST /api/admin/servers/actions` inline ceiling (admin.ts:1591-1598): key with `['server.read']` + action `start` → 403 "API key does not include the required permission".
- Middleware-level (requires extraction of server.ts:442-595 → `src/middleware/authenticate.ts`): `allPermissions` key inherits live user perms; scoped key 403s when the user's role loses a perm (server.ts:495-508); banned/locked users rejected on the key path (server.ts:459-471).

**c. `dashboard-global-counts.test.ts`** — extends dashboard-stats.test.ts:
- `it('admin.read sees panel-wide server counts (hasGrant, not raw includes)')` — pins the fix for dashboard.ts:41-46 (`canReadServers`/`isGlobalAdmin` raw includes); today admin.read gets scoped counts, target = global.
- `/activity` and `/resources` parity for admin.read (dashboard.ts:143-152, 196-206).

**d. `metrics-access-contract.test.ts`**:
- `it('server metrics admit admin.read/admin.write roles (exact-match fix)')` — metrics.ts:83-87 and :349-353 use `rolePerms.includes('server.read')`; a role with only `admin.read`/`admin.write` must pass the read decision via hasGrant.
- `it('bare node assignment without node.update cannot read another tenant's metrics')` (metrics.ts:80-82 — already correct; pin it).

**e. `nodes-assignment-escalation.test.ts`** (P0):
- `it('node.assign alone cannot create a wildcard assignment (self-escalation)')` — POST /api/nodes/assign-wildcard with `['node.assign']`, target self → 403 (nodes.ts:2512 today allows).
- `it('node.assign alone cannot delete assignments on nodes it cannot access')` — DELETE /api/nodes/:id/assignments/:aid (nodes.ts:2037) and DELETE /api/nodes/assign-wildcard/... (nodes.ts:2623) → 403 without node access.

**f. `admin-user-perm-regression.test.ts`**:
- `it('canManageUsers admits admin.write via hasGrant')` (admin.ts:84-88 raw includes today).
- `it('admin.read is denied user-management writes')`.

**g. `tasks-access-contract.test.ts`**:
- `it('task listing admits admin.read (read) but not plain users; execute requires console.write/server.schedule')` — tasks.ts:87-108 (`ensureCommandPermission` exact-match + `permissions: { has: 'console.write' }` DB filter :98) and the GET task routes' `ensureSchedulePermission`.
- `it('node manager (assignment+node.update) can list and run tasks')` (node_manage parity).

**h. `sftp-token-access.test.ts`** (prerequisite: extract the five inline routes from server.ts:1511-1850 into `routes/sftp.ts`):
- `connection-info` decideServerAccess contract with `requiredPermission: 'server.read'` (server.ts:1559-1565) — owner ✓, subuser with any of server.read/file.read/file.write ✓ (server.ts:1543-1547 — pin the exact-match trio AND extend to hasGrant), plain 403.
- `rotate-token`, token list/revoke — owner/self/panel-manager scoping.
- Key-scope: SFTP token minting with a narrow API key must respect the key ceiling.

**i. Prerequisite extraction tasks for the implementation phase** (tracked so the tests can land): `server.ts:442-595 authenticate` → `src/middleware/authenticate.ts`; inline SFTP routes → `src/routes/sftp.ts`. Both are behavior-preserving moves that make the two untestable surfaces testable; the contract suite depends on them.

## 6. (c) Unit tests — vocabulary of hasGrant / isReadPermission / decideServerAccess

Extend the existing pure-unit files (no DB, no HTTP):

**`server-access.test.ts`** (append `describe('post-consolidation vocabulary')`):
- `hasGrant(['node.agent_control'], 'node.agent_control')` ✓ and ⊄ `node.update`-only roles; same for `node.agent_config`, `template.import` (if adopted from infra.md §3).
- `isReadPermission` covers every read-class string in the catalog: parametrize over `ALL_PERMISSIONS` — every `*.read` + `node.view_stats` + `backup.download` returns true; every write-class returns false. **Plus a completeness clause:** every permission in `PERMISSION_CATEGORIES` (permissions-catalog.ts:18-169) that is read-class by convention must appear in `isReadPermission` — catches new read perms added without updating the allow-list (permissions.ts:130-136).
- `decideServerAccess`: new-vocabulary rows — `requiredPermission: 'node.view_stats'` with `admin.read` → `admin_read`; node_manage unchanged; admin.read still denied without requiredPermission (:286-294).
- `decideServerAccess` read-mode note: reads on node-scoped resources via `hasNodeAccess` read-mode — unit-test the wrapper added in infra.md fix #4 (admits `admin.read` when `read: true`, rejects otherwise).

**`scoped-permissions.test.ts`** (append):
- `ALL_SERVER_PERMISSIONS` stays a subset of `ALL_PERMISSIONS` (catalog integrity for the server-scoped list, permissions-catalog.ts:238-247).
- **Single-source-of-truth guard:** `lib/permissions.ts:432-546 PERMISSION_CATEGORIES` is deleted or re-exported; if kept, assert it deep-equals the catalog (today it does NOT — missing `server.update/install/reinstall/rebuild`, `backup.download`) — this is the drift lock for infra.md vocabulary finding 9.

**`rbac.test.ts`** (append):
- `hasPermission` with preResolved sets (permissions.ts:217-237) for the new vocabulary.
- `permissionMatches` scoped-form parity: `node.agent_control:nodeX` matches only that node (permissions.ts:160-206).

**`authz-fixes.test.ts`** (append): `enforceKeyScope` rows for the new vocabulary (if key-scoped).

## 7. Conventions checklist (from AGENTS.md)

- Tests live in `src/__tests__/`; DB-hitting tests must clean up every row they create (reverse-deletion order, `.catch(() => {})` per power-access-rbac.test.ts:153-167).
- Run gates: `pnpm --filter catalyst-backend run test` + `run lint` + `run typecheck`.
- No user-visible strings in tests → no i18n obligations; keep error-code assertions symbolic (`ErrorCodes.PERMISSION_DENIED`).
- The matrix data file must stay lint-clean (typed row objects, no `any` leaks).
- The generated suite hits the real dev database (Postgres must be up — same prerequisite as the existing suite); total runtime target: the shared-fixture design keeps it to one fixture set per worker.

## 8. Execution order (implementation phase)

1. Land prerequisite extractions (§5i) — behavior-preserving.
2. Land §6 unit tests + matrix-data file with today's contract values (they should FAIL against current code exactly where infra.md found gaps — that failure list is the implementation backlog).
3. Implement the permission fixes (infra.md §4 fix list) until §6 + the generated runner go green.
4. Land the targeted behavior tests (§5a-h) as each systemic fix lands.
5. Add the openapi-diff drift guard (§4 last bullet) so the matrix can never silently go stale.
