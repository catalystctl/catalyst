# Key-Scope Implementation Plan — canonical fix

Turns `key-scope-matrix.md` (70 BYPASSED + 41 AMPLIFIED endpoints) into a phased implementation plan. **Plan only — no source edits yet.** Matrix addendum surfaced while planning (from test-plan.md §5i analysis): 5 inline SFTP routes in server.ts are also KEY-SCOPE-BYPASSED (`/api/sftp/connection-info` :1511, `/api/sftp/rotate-token` :1621, `GET /api/sftp/tokens` :1707, `DELETE /api/sftp/tokens/:targetUserId` :1785, `DELETE /api/sftp/tokens` :1833) → **75 BYPASSED of 318 endpoints** (also inline, not key-relevant: `GET /api/permissions/server` :1695 auth-only, `GET /api/agent/version` :1121 auth-only, `GET /api/update/check` :1883 auth-only, `GET /api/theme-settings/public` :1901 and `GET /api/agent/download` :1140 unauth).

## 1. The global key-scope hook

### 1.1 Placement

Immediately after the authenticate decoration at **server.ts:595** (`(app as any).authenticate = authenticate;`), and strictly **before the first route registration at server.ts:952** (`await app.register(authRoutes, …)` through :1118). Fastify application-level hooks only apply to routes registered *after* `addHook` — placing it at :595 covers every route plugin (952-1118) and the inline routes (1121-1901).

Ordering caveat (must address): Fastify runs **app-level preHandler hooks before route-level preHandler hooks**. Routes that authenticate via route-level `preHandler` — tasks.ts:117/218/243/274/394/448, env.ts:49/55/64/103/137, migration.ts `withAuth` (:45), dashboard.ts:32/145/196, and the SFTP block (server.ts:1513/1623/1697/1709/1787/1836), agent/version (server.ts:1124), update/check (server.ts:1883) — would see `request.user === undefined` at hook time and silently skip. Mitigation (recommended, belt-and-suspenders):

- **(a) The shared check is invoked twice**: once from the global preHandler hook (covers the majority `onRequest: [app.authenticate]` style), and once **at the tail of `authenticate` itself** (server.ts:518, right after `request.user` is populated on the key path — covers every preHandler-auth route regardless of hook phase). Since Phase 0 extracts authenticate into `src/middleware/authenticate.ts` (§3), both call sites share one function; the in-authenticate invocation makes the hook ordering issue moot.
- (b) Optional hygiene follow-up: normalize the preHandler-auth files above to `onRequest: [app.authenticate]` (safe — authenticate reads only headers; body parsing happens later anyway).

### 1.2 TypeScript sketch

New module `src/middleware/key-scope.ts` (sibling of the extracted `authenticate.ts`):

```ts
import type { FastifyReply, FastifyRequest } from "fastify";
import { hasGrant } from "../lib/permissions.js";
import { apiError } from "../lib/http-error";
import { ErrorCodes } from "../shared-types";

/**
 * Route-level key-scope declaration. Declared on the route's `config` object
 * (same mechanism as config.rateLimit, e.g. mod-plugins.ts:115/1269).
 *  - requiredPermission: single value, or array = ANY-of semantics.
 *  - requiredAllPermissions: array = ALL-of semantics (power restart).
 *  - requiredPermission: null + keyScopeExemptReason = explicit exemption
 *    for dynamic-permission routes (owner/subuser OR-logic) — see §1.4.
 */
export interface KeyScopeRouteConfig {
  requiredPermission?: string | string[] | null;
  requiredAllPermissions?: string[];
  keyScopeExemptReason?: string;
}

export function enforceRouteKeyScope(request: FastifyRequest, reply: FastifyReply): boolean {
  const user = (request as any).user;
  // Inert for unauthenticated routes (their own auth will 401) and sessions:
  if (!user?.apiKeyId) return true;                       // server.ts:515 sets apiKeyId only for keys
  const config = (request.routeOptions?.config ?? {}) as KeyScopeRouteConfig;
  const perms: string[] = Array.isArray(user.permissions) ? user.permissions : [];
  const required = config.requiredPermission;
  if (required === null) return true;                     // explicit exemption, reason recorded in config
  if (typeof required === "string" && !hasGrant(perms, required)) {
    apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "Forbidden");
    return false;
  }
  if (Array.isArray(required) && !required.some((p) => hasGrant(perms, p))) {
    apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "Forbidden");
    return false;
  }
  if (config.requiredAllPermissions && !config.requiredAllPermissions.every((p) => hasGrant(perms, p))) {
    apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "Forbidden");
    return false;
  }
  return true;
}
```

Registration in server.ts (after :595) and tail-call in the extracted authenticate (after the key branch sets `request.user`, server.ts:511-517):

```ts
app.addHook("preHandler", async (request, reply) => {
  if (!enforceRouteKeyScope(request, reply)) return reply; // 403 already sent
});
// inside authenticate.ts, after request.user is set on the key path:
if (!enforceRouteKeyScope(request, reply)) return;
```

`hasGrant` (permissions.ts:143-149) gives the right semantics for free: `*` passes, `admin.write` passes any concrete requirement, `admin.read` passes read-type requirements — so a full-admin key is never blocked, a `server.read` key passes `requiredPermission: "server.read"` and nothing write-level.

### 1.3 Route declaration idiom (mirrors config.rateLimit)

```ts
// mod-plugins.ts:319 today:
app.post("/:serverId/mod-manager/install", {
  onRequest: [app.authenticate],
  config: { rateLimit: { max: fileRateLimitMax, timeWindow: fileRateLimitWindowMs },
            requiredPermission: "file.write" },        // ← new line, same config object
}, handler);
```

Inertness for sessions/unauth: the hook exits on `!user?.apiKeyId` — session requests and routes without authenticate are untouched. Exempted dynamic routes carry `config: { requiredPermission: null, keyScopeExemptReason: "…" }` so the CI guard (§4) can distinguish "not yet wired" from "deliberately dynamic".

### 1.4 Static vs dynamic split of the 70 BYPASSED (matrix §3; +5 SFTP = 75)

**STATIC — single/any-of/all-of canonical permission, hook-declarable: 65 of 70** (plus all 5 SFTP routes):

| Route group (count) | Interim config value (pre-vocabulary) | Post-vocabulary (TARGET-VOCABULARY-PROPOSAL) |
|---|---|---|
| mod-plugins reads ×8 + check-updates ×2 | `server.read` | `mods.manage` family per vocabulary §4 |
| mod-plugins writes ×6 (install/uninstall/update) | `file.write` | `mods.manage` / `plugins.manage` |
| cs2 reads ×3 / writes ×3 | `server.read` / `file.write` | `mods.manage` |
| console stream / command | `console.read` / `console.write` | unchanged |
| backups create/list/get/restore/delete/download | `backup.create`/`backup.read`/`backup.restore`/`backup.delete`/`backup.download` | unchanged |
| power install/reinstall/rebuild/start/stop/kill | `server.install`/`server.reinstall`/`server.rebuild`/`server.start`/`server.stop`/`server.stop` | `server.kill` splits out |
| power cancel-install | any-of `[server.install, server.reinstall]` | same |
| power restart | all-of `[server.start, server.stop]` (`requiredAllPermissions`; mirrors power.ts:1180 `requireAll=true`) | same |
| admin-ops backup-settings | `backup.create` | unchanged |
| admin-ops transfer / transfer-candidates / transfer-ownership | `server.transfer` | unchanged |
| core GET list / GET one | `server.read` | unchanged |
| core DELETE / storage-resize | `server.delete` / `server.update` | `server.storage` splits out |
| network GET / writes ×3 | `server.read` / `server.update` | `server.network` splits out |
| variables GET / PATCH | `server.read` / `server.update` | unchanged |
| stats ×2, metrics ×2, invites GET permissions + GET invites | `server.read` | unchanged |
| databases /database-hosts | `database.read` | unchanged |
| SFTP connection-info / rotate-token / tokens GET | `file.read` (route itself accepts server.read/file.read/file.write rows, server.ts:1543-1547) | `file.sftp` |
| SFTP tokens DELETE ×2 | `server.update` (matches canManageTokens, server.ts:1857-1861) | `file.sftp` |

**DYNAMIC — stay on actor threading (must NOT fake a static requiredPermission): 5 of 70** — the invites manage-path routes (`POST /invites` invites.ts:133, regenerate :257, DELETE invite :340, `POST /access` :646, `DELETE /access/:targetUserId` :726). Their gate is `canManageSubusers` (_helpers.ts:469-485: owner | `*`/admin.write | node+node.update) — an OR over principal types with no catalog permission. Interim enforcement: add an `actor` param to `canManageSubusers` and run `enforceKeyScope(actor, "admin.write")` — deny-by-default for the pure-owner path via key (an unrepresentable capability; `allPermissions` keys and admin keys still work). Post-vocabulary (FIX-CHECKLIST REQUIRES-NEW-VOCABULARY: `server.subusers`): switch to `config.requiredPermission: "server.subusers"`.

Two static-with-dynamic-element routes (base static + in-handler conditional): tasks create/update/execute take `config.requiredPermission: "server.schedule"` **and keep** the in-handler `ensureCommandPermission` (tasks.ts:152-158/294-300/472-478) for `action === "command"`, which itself gains the key check (Phase 4). admin.ts `POST /servers/actions` (admin.ts:1585 per-action map) is already ENFORCED and request-based — **no hook config there** (risk §5).

## 2. Phased backfill (severity first)

### Phase 0 — prerequisites (behavior-preserving; see §3 + §6)
1. Extract `authenticate` → `src/middleware/authenticate.ts`; extract SFTP routes → `src/routes/sftp.ts` (test-plan.md §5i, :534).
2. Land the vocabulary **additive step** (TARGET-VOCABULARY-PROPOSAL §7.1: new values + `READ_PERMISSIONS` + `LEGACY_ALIASES`, no route changes) so backfill configs can use post-vocab names immediately.
3. Land the hook itself (§1) — inert until routes declare config.

### Phase 1 — the 5 worst bypasses (19 endpoints)
| Route | Edit (file:line) | Interim config value |
|---|---|---|
| POST /:sid/console/command | console-stream.ts:151 route, gate :175-205 | `console.write` |
| GET /:sid/console/stream | console-stream.ts:33 route, gate :48-79 | `console.read` |
| backups ×6 | backups.ts:99/165/254/297/456/528 (helper :43-95) | `backup.create`/`backup.read`/`backup.read`/`backup.restore`/`backup.delete`/`backup.download` |
| PATCH /:id/backup-settings | admin-ops.ts:139 route, gate :218 (ensureServerAccess **without** actor) | `backup.create` (plus thread `request.user` at :218 like :66-72 does) |
| power ×8 | power.ts:193/290/387/555/712/913/1048/1180 (helper :56-95) | per §1.4 table |
| DELETE /:sid (core) | core.ts:2396 route, gate :2424-2435 | `server.delete` |
| POST /:sid/transfer-ownership | admin-ops.ts:734 route, gate :756 | `server.transfer` |

Note: console-stream/power/backups routes also *keep* their user-level DB gates unchanged — the hook only adds the key ceiling.

### Phase 2 — remaining 51 + 5 SFTP (56 endpoints)
mod-plugins 16 (:64/:134/:276/:341/:495/:558/:680/:744/:933/:982/:1036/:1101/:1158/:1275/:1387/:1528), cs2 6 (cs2.ts:198/:232/:269/:375/:455/:486), tasks 6 (tasks.ts:115/:216/:241/:272/:392/:446 — static base + keep command gate), invites 7 (reads :38/:77 → `server.read`; the 5 manage-path routes → **interim `canManageSubusers` actor param + `enforceKeyScope(actor,"admin.write")`**, NOT config), metrics 2 (metrics.ts:22/:278 → `server.read`; also fixes the admin.read/admin.write A-READ-GAP as a side effect of route gate changes per infra.md), admin-ops transfer :361 + transfer-candidates :683 (→ `server.transfer`), core GET list :1428 + GET one :1706 (`server.read`) + resize :2248 (`server.update`), network 4 (:33/:106/:348/:474), variables 2 (:9/:63), stats 2 (stats.ts:9/:109), databases 1 (:10, `database.read`), SFTP 5 (server.ts:1511/:1621/:1707/:1785/:1833 — after extraction, routes/sftp.ts).

### Phase 3 — the 41 ADMIN-KEY-AMPLIFIED (gate swap + coordination)
Swap the DB-resolved gate `hasPermission(prisma, userId, …)` / local `isAdminUser(userId)` for the request-based `hasPermission(request, …)` (permissions-catalog.ts:200-211) or hook config (preferred, uniform: `config.requiredPermission`). Per-file combined change sets (coordinate with FIX-CHECKLIST pending items — land together where the same lines are touched):

- **roles.ts (13 routes, gate :206-211)** — key-scope: config `role.read`/`role.create`/`role.update`/`role.delete` (routes :217/:338/:440/:566/:632/:718/:793/:917/:988/:1038/:1057/:1164). Land WITH pending FIX-CHECKLIST items: P0 admin-demotion guard on DELETE /:roleId/users/:userId (roles.ts:917-985), P0 hierarchy guard on role edit/permission-remove (roles.ts:440-528, 718-758), P2 catalog validation on role create/update (roles.ts:356-373/489-507/649-655). Keep `freshEditorPermissions` live-DB escalation guards (roles.ts:65-71) — anti-escalation, not route gates.
- **templates.ts (7 routes, gate :64-76)** — config `template.read`/`template.create`/`template.update`/`template.delete` (:83/:157/:188/:308/:442/:481/:598); optionally `template.import` for the two import routes per FIX-CHECKLIST :378.
- **locations.ts (5, gate :11-22)** — config `location.*` (:25/:55/:90/:143/:204).
- **nests.ts (5, gate :13-25)** — config `template.*` (nest rides template perms by design, nests.ts:8-11) (:26/:52/:79/:130/:188).
- **alerts.ts (11, gate :12-27)** — replace local `isAdminUser(userId)` (DB) with `checkIsAdmin(request, …)`; alert-rule CRUD config `alert.read`/`alert.create`/`alert.update`/`alert.delete` (routes :79/:197/:230/:254/:319/:361/:396/:488/:536/:597/:669); per-server paths already use the alert.* ServerAccess perms (alerts.ts:29-75) — keep, plus Phase 4 actor threading.

### Phase 4 — signature hardening (compiler-driven, 0 route edits)
Make `actor` mandatory (non-optional TS param; runtime throw) on:
- `ensureServerAccess` (_helpers.ts:495) — call sites that then break (all already actor-threaded by Phases 1-2, expected zero errors): mod-plugins 16, cs2.ts:179, files.ts:82 wrapper + 12 calls, admin-ops.ts:66/:114/:218, core.ts:1827, power.ts:483, metrics-stream.ts:55.
- `ensureBackupAccess` (backups.ts:43) — 6 call sites (:99/:165/:254/:297/:456/:528 routes).
- `ensureSchedulePermission` + `ensureCommandPermission` (tasks.ts:20/:86) — call sites :144/:152/:223/:248/:287/:294/:399/:453/:472.
- `ensurePowerAccess` (power.ts:56) — 8 call sites (:193/:290/:387/:555/:712/:913/:1048/:1180).
- `canAccessServer` (_helpers.ts:1305) — 10 call sites: invites.ts:54/:93, core.ts:908/:1014/:1322, network.ts:57, stats.ts:29/:129.
- `canManageSubusers` (_helpers.ts:469) — 5 call sites: invites.ts:133/:257/:340/:646/:726.

## 3. Extraction prerequisites (test-plan.md §5i, :534)

**(i) `server.ts:442-595 authenticate` → `src/middleware/authenticate.ts`.** Move the whole function (key path :446-531, session path :534-592) plus the new `enforceRouteKeyScope` tail call (§1.2). Import rewiring for the new module: `prisma` from `../db.js`; `verifyApiKey as verifyApiKeyService` (imported at server.ts:61 from services/api-key-service); `cacheSessionUser`/`extractSessionToken`/`getCachedSessionUser` (server.ts:29-32, lib/auth-session-cache); `resolveUserPermissions` (server.ts:34, lib/permissions-catalog); `auth` (server.ts:88, ../auth); `fromNodeHeaders` (server.ts:89, better-auth/node); `captureSystemError` (server.ts:24, services/error-logger); `logger` — created at server.ts:119 (`const logger = pino(...)`) → hoist to a shared `src/lib/logger.ts` and import in both server.ts and the new module. server.ts keeps only `(app as any).authenticate = authenticate;` at :595 (plus the addHook from §1.1). Behavior-preserving; the session-cache branch (server.ts:541-545, 586-588) moves verbatim.

**(ii) Inline SFTP routes → `src/routes/sftp.ts`.** Move server.ts:1511-1870: `GET /api/sftp/connection-info` (:1511-1618), `POST /api/agent/… /api/sftp/rotate-token` (:1621-1689), `GET /api/sftp/tokens` (:1707-…), `DELETE /api/sftp/tokens/:targetUserId` (:1785-1831), `DELETE /api/sftp/tokens` (:1833-1869). New module `export async function sftpRoutes(app: FastifyInstance)`; registered in server.ts at the same spot: `await app.register(sftpRoutes);` (no prefix — paths are absolute). Import rewiring: `generateSftpToken`/`rotateSftpToken`/`revokeAllSftpTokensForServer`/`SFTP_TTL_OPTIONS` (server.ts:74-80, services/sftp-token-manager), `prisma` (../db.js), authenticate via `(app as any).authenticate`; convert the in-handler dynamic imports (`./lib/permissions-catalog.js` :1528-1530, `./lib/server-access.js` :1531, `./routes/servers/_helpers.js` :1553-1557, and mirrors at :1636-1666) to static imports. Optional third move (also flagged by test-plan :443): `GET /api/agent/version` (server.ts:1121-1135, uses getCurrentVersion/normalizePanelVersion :101, agentReleaseRepo :105) + `GET /api/permissions/server` (:1695-1704) → a small `src/routes/panel-info.ts`. Verification per test-plan §5h: new `sftp-token-access.test.ts` (deny + allow sides) and the full existing suite.

## 4. CI source-pattern guard

Model: `security-wave2-regression.test.ts` reads source text and asserts patterns (e.g. :252-262 reads nodes.ts and asserts markers). New `src/__tests__/key-scope-regression.test.ts`:

- **Guard A (no actor-less call)**: for each of mod-plugins.ts, cs2.ts, tasks.ts, backups.ts, power.ts, invites.ts, metrics.ts, console-stream.ts, servers/{core,admin-ops,network,stats,variables,databases}.ts, routes/sftp.ts: read source; assert `ensureServerAccess(` never appears with only 4 args (regex `ensureServerAccess\([^)]*,[^)]*,[^)]*,[^)]*\)` counting top-level commas is brittle — instead assert the *signature* is mandatory (`actor:` non-optional in _helpers.ts:495/backups.ts:43/tasks.ts:20/power.ts:56/_helpers.ts:1305/469) and that `enforceKeyScope` is imported/called in each file, mirroring :261's `expect(src).toContain(...)` style).
- **Guard B (route inventory + declaration)**: the openapi-diff drift guard from test-plan.md §4 (last bullet) — read `api/openapi.json` (296 ops) and the matrix data file `src/__tests__/route-contract.matrix.ts` (test-plan §4 design, :451-453); fail when (a) an op exists in openapi.json without a matrix row (drift), or (b) a matrix row for an authenticated op lacks a `keyScope` field that is either a `requiredPermission` value (validated against `PERMISSION_CATEGORIES`, permissions-catalog.ts:18-169), `{ any: [...] }`/`{ all: [...] }`, `"dynamic-actor"`, or `{ exempt: "reason" }`.
- **Guard C (A-class regression)**: after Phase 3, assert roles.ts/templates.ts/locations.ts/nests.ts/alerts.ts no longer call `hasPermission(prisma,` / `hasAnyPermission(prisma,` / `getUserPermissions(prisma` in route-gate helpers (source grep, :231-232 style).

## 5. Risk analysis

| Risk | Trigger | Mitigation |
|---|---|---|
| Static value misrepresents a dynamic gate | admin.ts `POST /servers/actions` maps action→perm at :1585; tasks `command` actions add `console.write`; SFTP accepts server.read\|file.read\|file.write rows (server.ts:1543-1547) | No config on admin.ts actions route (already request-based); tasks keep the in-handler command gate; SFTP uses conservative interim `file.read` (narrow keys lose a convenience, never gain power); the 5 invites manage routes are exempted (`requiredPermission: null` + reason) until `server.subusers` |
| Hook ordering (preHandler-auth routes run app-level hook first) | tasks/env/migration/dashboard/SFTP block | In-authenticate invocation (§1.1a) makes phase irrelevant; optional onRequest normalization |
| Over-denial breaking legitimate flows | keys whose scope was broader than intended by their creator | Intended tightening; rollout behind a config flag (`KEY_SCOPE_ENFORCE=off` short-circuit in `enforceRouteKeyScope`) for one release; audit log line on each 403 to spot false positives |
| WS routes (console-stream GET upgrade) | preHandler semantics under @fastify/websocket | Hook runs before the handler/upgrade (console-stream.ts:36 authenticates at onRequest); verify with a manual WS test in Phase 1 |
| Test harness breakage | P-A inject tests decorate their own authenticate and set `request.user` without `apiKeyId` (diagnostics-export.test.ts:284-291, dashboard-stats.test.ts:17-23) | Hook inert without `apiKeyId` — no existing test sets it; new tests cover the key path per test-plan §5b/§5h |
| MCP surface | mcp.ts:128-137 proxies with the caller's raw key | Upstream re-enters authenticate → hook applies automatically; no MCP-specific work |
| Typo'd config values | any backfill route | Guard B validates every `requiredPermission` against the catalog |

## 6. Interaction with the vocabulary change

TARGET-VOCABULARY-PROPOSAL §7 already sequences the vocabulary as: (1) additive new values + `READ_PERMISSIONS` + `LEGACY_ALIASES` (no behavior change), (2) switch route gates, (3) data migration, (4) remove aliases. Its §6.4 assumes the unified helper with a required actor — same direction as Phase 4.

**Recommended ordering: vocabulary step 1 (additive) FIRST, then the key-scope backfill with post-vocabulary config values** (§1.4 table's right column: `mods.manage`, `plugins.manage`, `file.sftp`, `server.network`, `server.storage`, `server.kill`, `server.clone`, `apikey.read/write`, `node.server_manage`). Rationale: `LEGACY_ALIASES` keep existing grants/keys satisfying the new names during the window, so **no rename pass is ever needed** — the backfill writes final names once; the vocabulary's later data migration (§6.3/§7.3) cleans stored arrays, and alias removal (§7.4) lands last. Fallback if the vocabulary change slips: ship Phases 1-2 with the interim names in §1.4's left column and do ONE mechanical rename pass afterward (config values are greppable strings; Guard B fails on unknown values, making the rename pass self-verifying). Either way, `server.subusers` (invites) and `file.sftp` (SFTP) must exist before their routes can drop the interim `admin.write`/`file.read` values.
