# TARGET PERMISSION VOCABULARY — FINAL DECISION (Lead)

Canonical decision document. Implementers follow THIS file, not the proposal.
Source inputs: TARGET-VOCABULARY-PROPOSAL.md (core-model auditor), domain audit findings
(server-power, server-core, infra, server-files, server-extras, admin-people, admin-system,
realtime, plugins, frontend, key-scope-matrix, compat-inventory, agent-side).

## 0. Contract (owner's words, normative)

1. `admin.read` — READ access over the ENTIRE panel and every server. Every read-only
   endpoint, listing, export, stream, and SSE/WS read channel must accept it.
2. `admin.write` — READ+WRITE over the ENTIRE panel and every server. Every endpoint must
   accept it. `admin.read` must NEVER authorize a write.
3. `*` — superadmin wildcard (unchanged).
4. Every other permission is narrowly scoped: one capability, one resource family.
5. Missing permissions get created (below).

## 1. Final vocabulary

### Unchanged core
| value | R/W | capability |
|---|---|---|
| `*` | all | Superadmin wildcard |
| `admin.read` | read | Read the entire panel + every server |
| `admin.write` | read+write | Write (and read) the entire panel + every server |

### Splits (old → new, all behavior-preserving via mapping + alias window)
| split | new values | rationale |
|---|---|---|
| `apikey.manage` | `apikey.read` (read: list/view own keys, catalog, own effective perms) + `apikey.write` (write: create/rename/enable/revoke own keys) | one value gated five verbs; cross-user key admin stays admin.write-tier |
| `server.update` | `server.update` (settings/variables/restart-policy/crash/subuser-grants) + `server.network` (allocations/primary port) + `server.storage` (disk resize) | mega-perm covered unrelated capabilities |
| `node.update` | `node.update` (edit node capacity/addresses/metadata) + `node.server_manage` (full server manage on ASSIGNED nodes — the node_manage path) + `node.agent_control` (restart/update agent, rewrite agent config + host network) | node.update tripled as node editor, server manager, and agent controller |
| `server.suspend` | `server.suspend` (suspend/unsuspend) + `server.archive` (archive/restore) | one perm silently meant four verbs |
| `server.transfer` | `server.transfer` (ownership transfer — finally actually enforced) + `server.migrate` (move server between nodes) | transfer was enforced on migration, ignored on ownership transfer |
| `server.create` | `server.create` + `server.clone` (clone, preflight, retry) | clone rode create |
| `server.stop` | `server.stop` + `server.kill` (SIGKILL) | data-loss-grade action rode graceful stop |

### Additions (new, no old value)
| value | R/W | capability | replaces today's gate |
|---|---|---|---|
| `mods.manage` | write | install/uninstall mod-manager content (mods/datapacks/modpacks) per server | was `file.write` (over-broad) |
| `plugins.manage` | write | install/uninstall server plugins (plugin manager, CS2) per server | was `file.write` (over-broad) |
| `migration.manage` | write | start/test/pause/resume/cancel/retry Pterodactyl migration jobs | was admin.write-only (reads move to admin.read) |
| `update.trigger` | write | trigger panel self-update + forced release checks | was admin.write-only |
| `diagnostics.download` | read | download the diagnostics/troubleshooting bundle | delegation persona without full read-admin |

### Deliberate non-additions (DECIDED)
- EULA accept/decline stays `server.start` (lifecycle reuse, documented).
- Metrics reads stay `server.read` / `node.view_stats` (engine bugs fixed, not vocabulary).
- Alert rules stay `alert.*` (server-scoped rules) — see alerts.md for route fixes.
- No `settings.read`/`settings.write`, no `dbhost.*`, no `plugin.read`/`plugin.manage` for
  panel plugins, no `template.import`: panel-infrastructure surfaces are what the admin bits
  MEAN (contract §0.1/§0.2). Targeted perms exist only where a delegation persona exists.
- No `server.subusers`: subuser/invite management stays ownership-level (canManageSubusers).
- Plugin-system scope names (plugins/safety.ts namespace) are SEPARATE from RBAC and keep
  their names; document the collision, do not unify.

### Canonical read set (replaces suffix sniffing in isReadPermission)
```
READ_PERMISSIONS = {
  admin.read, apikey.read,
  server.read, backup.read, file.read, console.read,
  database.read, alert.read, node.read, location.read,
  template.read, user.read, role.read,
  node.view_stats, backup.download, diagnostics.download,
}
```
Every future read perm ends in `.read` (or is explicitly added to this set). Everything
else is write/capability. Single source in lib/permissions-catalog.ts; permissions.ts
delegates to it; the duplicate subset logic in _helpers.ts is deleted.

## 2. Route-gate policy decisions (DECIDED — binding for implementers)

1. **Admin-panel infra reads** (SMTP, security/theme/OIDC/MCP/localization settings, env,
   db-status, health, update status/settings/state, migration reads, audit-logs/export,
   system-errors + export, mod-manager settings read, auth-lockouts, ip-pools read,
   database-hosts read/ping, diagnostics, admin stats, dashboard global counts,
   plugin inventory reads GET /api/plugins + /:name + manifest + assets): `admin.read`
   via hasGrant. Plugin inventory reads: `admin.read` (no plugin.read — no persona).
2. **GET /api/update/check** (currently auth-only): `admin.read`.
3. **GET /api/servers/database-hosts** (currently any server owner): `admin.read`.
4. **Server creation**: requires `server.create` OR the node_manage path (node assignment
   + `node.server_manage`). Bare node assignment alone authorizes NOTHING.
5. **SFTP mint/rotate** (DECIDED — supersedes the earlier file.sftp idea, per
   sftp-fix-design.md): gate on the caller's EFFECTIVE server permissions containing
   `file.read` OR `file.write` (getEffectiveServerPermissions; read-capable callers mint
   read-only sessions, write-capable mint sessions the agent bounds per-op). No new
   permission: SFTP read ≡ file read — same capability, different transport, so the
   targeted perm is the existing file.* family. validate-token derives session perms from
   the caller's effective server permissions (never raw user roles — fixes the ['*']
   derivation bug and the owner/admin.read [] bug). Key-scope enforced on mint/rotate
   (enforceKeyScope). The phantom `file.sftp` comment at validation.ts:227 is removed.
   Live-session revocation: interim panel-side honesty (revoke blocks NEW connections;
   TTL bounds replay/reconnect, not live sessions — documented), agent-side heartbeat
   revalidation deferred as a follow-up Rust change.
6. **Agent config read** (GET /:nodeId/agent/config): `node.read` + hasNodeAccess, or
   `admin.read`; agent control ops: `node.agent_control` + hasNodeAccess.
7. **assign-wildcard / assignment deletes**: `node.assign` + hasNodeAccess scoping +
   self-target guard + hierarchy guard (cannot affect assignments of `*`/`admin.write`
   holders unless actor is `*`).
8. **Invite tokens**: the raw `token` column is visible ONLY to manage-capable callers
   (owner, subuser-manage grant, admin.write/*). Non-manage listings get metadata only.
9. **Default ServerAccess grant set** (user create/update with serverIds, transfer):
   trim to `server.read, server.start, server.stop, alert.read`. No default
   server.delete/file.write/console.write.
10. **better-auth legacy admin channel** (`User.role='administrator'` column,
    src/auth.ts:282-299): (a) add a Fastify preHandler gating `/api/auth/admin/*` on
    hasGrant(admin.write) — the column stops being an authority for HTTP; (b) sync
    `User.role = 'administrator'` whenever a user's effective permissions gain/lose
    admin.write-tier (role mutations + user role edits), so auth.api internal calls work
    for panel-appointed admins. The column becomes derived state, never an authority.
11. **Key-scope enforcement** (P0): every server-scoped access helper takes a MANDATORY
    actor argument (compiler-enforced); DB-resolved gates swap to request-based
    hasPermission where the check is static; a global preHandler hook enforces
    hasGrant(key perms, route.config.requiredPermission) for apiKeyId requests on
    static-perm routes (see key-scope-impl-plan.md). Dynamic (owner|subuser|role) routes
    rely on the actor threading, NOT a fake static perm.
12. **node_manage pairings**: the ~14 inline `node.update + hasNodeAccess` checks move to
    `node.server_manage` (alias keeps old roles working).
13. **hasNodeAccess/getUserAccessibleNodes**: admin visibility path gains a READ mode
    (admin.read sees all nodes read-only); manage paths keep write-tier admin.
14. **Roles/users hierarchy guards**: shared helper `assertCanAffectAdminRole` +
    last-admin guard used by admin.ts PUT /users, roles.ts PUT/DELETE-permission,
    roles.ts role-member removal. Target guards (pw reset, 2FA wipe, passkey wipe,
    ban/unban, enforce-2fa, SSO unlink, delete) treat `*`, `admin.write` AND `admin.read`
    targets as admin-equivalent (actor must be `*`, or admin.write for read-tier targets
    where the action is a read-safe mutation — implementer judgment, fail-closed).
15. **PUT /api/admin/users body-shape**: `roleIds` presence must NOT downgrade the required
    permission when password/email/username/serverIds are present — check user.update for
    those fields AND user.set_roles for roleIds; port POST's scoped-grant escalation guard.
16. **Plugin route authorization** (context.requirePermission): swap raw includes for
    hasGrant so admin.read/admin.write callers pass concrete-perm gates correctly.
17. **Console-stream POST /console/command** route gate: `admin.write` (the gateway
    re-check already enforces it; the route must match).

## 3. Compat (binding)

- All stores are `String[]`; NO schema.prisma change, NO prisma migration file. Data
  migration is a committed script `prisma/migrate-permissions.ts` + package.json script
  `db:migrate-permissions` (seed-admin.ts pattern), idempotent, covering ALL six stores:
  Role.permissions, ApiKey.permissions, ServerAccess.permissions,
  ServerAccessInvite.permissions, RoleServerGrant.permissions, RoleNodeGrant.permissions.
- Mapping (append new values, keep old during the alias window, dedupe):
  `apikey.manage`→apikey.read+apikey.write; `server.update`→+server.network+server.storage;
  `node.update`→+node.server_manage+node.agent_control; `server.suspend`→+server.archive;
  `server.transfer`→+server.migrate; `server.create`→+server.clone; `server.stop`→+server.kill.
- `LEGACY_ALIASES` in permissions-catalog.ts consulted by hasGrant/permissionMatches so
  unmigrated rows keep working (e.g. granted 'server.update' satisfies 'server.network').
  Aliases are removed one release after the migration reports zero legacy values.
- Deliberate narrowing (NOT aliased): mods.manage/plugins.manage do not alias file.write.
- No `file.sftp` permission (DECIDED — see §2.5): SFTP access rides the effective
  file.read/file.write permissions; the phantom string is removed from validation.ts.
- Frontend/backend interface decisions (from frontend-impl-plan.md): NEW backend route
  GET /api/roles/permissions-catalog (role.read|role.create|role.update via hasGrant,
  sibling of GET /api/roles/presets) serves the catalog to the role editor — owned by the
  admin-people implementer. mods.manage/plugins.manage are SERVER-SCOPED permissions
  (ride the serverPermissions pipeline + common.json serverPermissions i18n namespace).
  server.transfer keeps ownership-transfer semantics (label updated); server.migrate takes
  node moves. Dual-check compat for stop/kill + suspend/archive is handled by
  LEGACY_ALIASES alone (hasGrant consults them) — no route-level dual checks.
- scripts/diagnose-admin-rbac.mjs extended to report legacy-value counts.

## 4. Update sites (every place the vocabulary lives — from compat-inventory + proposal)

1. lib/permissions-catalog.ts — PERMISSION_CATEGORIES, ALL_PERMISSIONS,
   ALL_SERVER_PERMISSIONS, + READ_PERMISSIONS, LEGACY_ALIASES, isValidPermission.
2. lib/permissions.ts — isReadPermission delegates to READ_PERMISSIONS; DELETE the stale
   PERMISSION_CATEGORIES (432-546) and re-point PERMISSION_PRESETS (551-602) to a
   canonical preset list in the catalog (roles.ts:11-18 + GET /api/roles/presets serve it);
   isAdminUser docstring fix; hasNodeAccess read-mode (§2.13).
3. shared-types.ts Permission enum (44-115) + permissions: Permission[] (347).
4. routes/setup.ts default User role (257-284, 543-570) — align with seed.ts.
5. routes/servers/_helpers.ts — OWNER_SERVER_PERMISSIONS (85),
   DEFAULT_PERMISSION_PRESETS (22-79), adminRead subset (1421-1424 → READ set ∩
   ALL_SERVER_PERMISSIONS), ensureSuspendPermission (1274) + archive split,
   ensureDatabasePermission (1446) gains admin_read + node_manage branches,
   ensureServerAccess mandatory actor.
6. lib/server-access.ts — node_manage branch → node.server_manage; canManageViaNode same.
7. The ~14 inline node_manage pairings (list in TARGET-VOCABULARY-PROPOSAL.md §3.3).
8. services/migration/types.ts PERMISSION_MAP (348-367) + subuser defaults (749, 1047-1067).
9. lib/validation.ts permissionSchema gains catalog membership (allow `*` + scoped forms);
   remove the stale file.sftp comment; give it consumers (role/apikey/ServerAccess writes).
10. Grant-creation guards become hasGrant-based + catalog-checked: roles.ts:365/499,
    api-keys.ts:85, roles.ts:110-118 (scoped grants — extend allowed set with the new
    server-scoped values: mods.manage, plugins.manage, file.sftp, server.clone,
    server.kill, server.network, server.storage, server.archive, server.migrate).
11. prisma/seed.ts, prisma/seed-admin.ts, routes/setup.ts bootstrap arrays — align.
12. Frontend: RolesPage.tsx:64-179 (hardcoded catalog → backend-driven or regenerated),
    lib/serverPermissions.ts:25-51 fallback + label switch, the five route→perm maps
    (App.tsx, AdminRedirect, navSections, SearchPalette, Sidebar), canKill split
    (ServerControls.tsx:52), canManageDatabases fix, i18n labels en/fr/zh-CN for every
    new value (extractor owns key order), rbac-permissions.test.tsx pinning,
    demo fixtures. (Details: frontend.md + frontend-impl-plan.md.)
13. Tests: rbac.test.ts:492-539 (stale-copy assertions), rbac-api.test.ts route table
    (stale rows), security-wave2-regression.test.ts:261 (node.update pairing pin — now
    node.server_manage), server-access.test.ts, scoped-permissions.test.ts.

## 5. Sequencing (binding)

1. **Wave 1 — core, additive only**: catalog values + READ_PERMISSIONS + LEGACY_ALIASES +
   isValidPermission + validation consumers + presets consolidation + enum + shared-types.
   Zero route behavior change. (Files: permissions-catalog.ts, permissions.ts,
   shared-types.ts, validation.ts, roles.ts presets re-point, _helpers.ts preset arrays.)
2. **Wave 2 — engine + route gates**: all §2 policy fixes, per-domain, disjoint file
   scopes. Land the route-contract test suite skeleton from test-plan.md in the same wave.
3. **Wave 3 — data migration**: prisma/migrate-permissions.ts + package.json script +
   diagnose-admin-rbac.mjs reporting. Run against dev DB; document for operators.
4. **Wave 4 — frontend** (parallel with 2/3 once catalog endpoints serve new values) and
   i18n (en/fr/zh-CN same change).
5. **Wave 5 — gates**: backend+frontend lint, typecheck, full tests, i18n:check +
   i18n:hardcoded, builds. Fix fallout. Browser verification of admin flows per
   frontend-impl-plan.md checklist.
6. Alias removal is a LATER release (not this change).
