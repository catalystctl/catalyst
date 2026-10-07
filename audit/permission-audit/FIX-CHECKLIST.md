# FIX-CHECKLIST — consolidated from all permission-audit findings

Built by `audit-server-core` from the 14 completed findings audits: **server-core, server-power, server-files, server-extras, admin-system, admin-people, infra, realtime, plugins, compat-inventory, frontend, core-model, key-scope-matrix, agent-side** (in `audit/permission-audit/`). Companion docs (not findings, cross-referenced): TARGET-VOCABULARY-PROPOSAL.md, sftp-fix-design.md, frontend-impl-plan.md. Pending: test-plan.md (test changes are excluded from this checklist by rule — the test-plan auditor owns those).

**Line verification**: ~45 spot-reads of cited lines across all source files during consolidation — **zero drift found**; every citation below matches current source. No source files were modified.

**Priority scheme** (per Lead): P0 = security holes (key-scope bypasses, privilege escalations, credential leaks, permission-less mutations) · P1 = admin.read/admin.write reachability violations (A-READ-GAP / F-ADMIN-GAP / C-NO-CHECK read gates) · P2 = consistency cleanups and non-catalog fixes. Anything requiring a NEW catalog permission is deferred to the REQUIRES-NEW-VOCABULARY section at the end.

**The API-key scope bypass (17 files, deduplicated to one row each)**: for API-key requests `request.user.permissions` = the key's scope (server.ts:442-511, key perms at :494, `apiKeyId` at :515); for sessions it = global role perms. Per key-scope-matrix's census of all 309 endpoints: **70 KEY-SCOPE-BYPASSED** routes (14 files) authorize via the *user's* DB grants (owner / ServerAccess / roles) and never consult the key's declared scope, and **41 ADMIN-KEY-AMPLIFIED** routes (5 files: roles, alerts, templates, locations, nests) resolve the gate permission from the owner's live DB roles (`hasPermission(prisma, userId, …)`), so *any* valid key — however narrow — from a user who holds the gate permission passes. A narrow key of an owner can kill/reinstall (data-wipe) servers, rewrite backup S3/SFTP credentials, mint full-R/W SFTP tokens, transfer ownership or delete servers. The existing guard is `enforceKeyScope(actor, permission)` (_helpers.ts:487-493), applied inside `ensureServerAccess` when callers pass `actor` (_helpers.ts:553-556). Every P0 row of this class = "consult the key's own permissions".

**Canonical implementation strategy** (key-scope-matrix §6, endorsed here — "systemic, not 100 patches"): (1) one global `preHandler` hook at server.ts:595 that, when `request.user.apiKeyId` is set and the route declares `config.requiredPermission(s)`, enforces `hasGrant(request.user.permissions, required)` — routes then carry a one-line `config` declaration (same style as the existing `rateLimit` config); (2) make `ensureServerAccess`'s `actor` parameter **required** (TS non-optional + runtime throw) so future omissions fail loudly. Both are P0 rows below (server.ts + _helpers.ts); the per-file rows are then mostly config declarations.

**File index** (56 distinct source files · 123 items · P0 36 · P1 28 · P2 59 — some index rows cover several files):

| File | P0 | P1 | P2 |
|---|---|---|---|
| src/lib/permissions.ts | 0 | 1 | 2 |
| src/routes/nodes.ts | 3 | 3 | 6 |
| src/routes/admin.ts | 5 | 2 | 3 |
| src/routes/roles.ts | 3 | 0 | 1 |
| src/auth.ts | 1 | 0 | 0 |
| src/routes/auth.ts | 0 | 0 | 1 |
| src/routes/servers/power.ts | 1 | 0 | 1 |
| src/routes/servers/admin-ops.ts | 3 | 1 | 1 |
| src/routes/servers/network.ts | 1 | 0 | 2 |
| src/routes/servers/core.ts | 2 | 1 | 4 |
| src/routes/servers/variables.ts | 1 | 0 | 0 |
| src/routes/servers/stats.ts | 0 | 0 | 1 |
| src/routes/bulk-servers.ts | 0 | 1 | 1 |
| src/routes/backups.ts | 1 | 0 | 0 |
| src/routes/servers/databases.ts | 0 | 2 | 0 |
| src/routes/servers/_helpers.ts | 1 | 0 | 2 |
| src/server.ts | 3 | 3 | 2 |
| src/services/sftp-token-manager.ts | 0 | 0 | 2 |
| src/routes/servers/mod-plugins.ts | 1 | 0 | 3 |
| src/routes/servers/cs2.ts | 1 | 0 | 1 |
| src/routes/servers/invites.ts | 2 | 0 | 2 |
| src/routes/tasks.ts | 1 | 1 | 1 |
| src/routes/metrics.ts | 0 | 2 | 0 |
| src/routes/console-stream.ts | 2 | 0 | 0 |
| src/routes/sse-events.ts | 0 | 1 | 1 |
| src/websocket/gateway.ts | 0 | 2 | 3 |
| src/routes/admin-events.ts | 0 | 0 | 1 |
| src/plugins/context.ts | 0 | 1 | 2 |
| src/routes/plugins.ts | 0 | 1 | 1 |
| src/routes/update.ts | 0 | 1 | 0 |
| src/routes/migration.ts | 0 | 1 | 0 |
| src/routes/dashboard.ts | 0 | 1 | 1 |
| src/routes/api-keys.ts | 0 | 1 | 1 |
| src/lib/validation.ts | 0 | 0 | 2 |
| src/routes/alerts.ts | 1 | 0 | 0 |
| src/routes/templates.ts | 1 | 0 | 0 |
| src/routes/locations.ts | 1 | 0 | 0 |
| src/routes/nests.ts | 1 | 0 | 0 |
| src/shared-types.ts | 0 | 0 | 1 |
| src/services/api-key-service.ts | 0 | 0 | 1 |
| prisma/seed.ts + src/routes/setup.ts + scripts/bootstrap-production.ts | 0 | 0 | 1 |
| catalyst-frontend/src/pages/admin/RolesPage.tsx | 0 | 1 | 0 |
| catalyst-frontend/src/lib/serverPermissions.ts | 0 | 0 | 1 |
| catalyst-frontend/src/components/layout/FleetHeartbeat.tsx | 0 | 1 | 0 |
| catalyst-frontend/src/pages/ApiKeysPage.tsx | 0 | 0 | 1 |
| catalyst-frontend/src/pages/nodes/NodesPage.tsx | 0 | 0 | 1 |
| catalyst-frontend/src/components/servers/CreateApiKeyDialog.tsx | 0 | 0 | 1 |
| catalyst-frontend/src/pages/servers/ServerDetailsPage.tsx | 0 | 0 | 2 |
| catalyst-frontend/src/components/backups/BackupSection.tsx | 0 | 0 | 1 |
| catalyst-frontend/src/components/auth/AdminRedirect.tsx | 0 | 0 | 1 |
| catalyst-frontend/src/App.tsx + UpdateNotification.tsx + SystemPage | 0 | 0 | 1 |

---

## src/lib/permissions.ts

| Pri | file:line | Exact change | Sources | Conflict notes |
|---|---|---|---|---|
| P1 | permissions.ts:638-652, 773-790 | Add a read mode to `hasNodeAccess`/`getUserAccessibleNodes` (optional param, e.g. `{ read: true }` → `isAdminUser(prisma, userId, false)` so `admin.read` counts); keep the default write-mode — metrics.ts:80-82 and the node_manage pairing intentionally require write-admin | infra + core-model | none |
| P2 | permissions.ts:130-136 + _helpers.ts:1421-1424 | Convert `isReadPermission` from suffix-sniffing (`endsWith('.read')` + two exceptions) to a declarative READ-permission set defined in the catalog, and deduplicate the local copy at _helpers.ts:1421-1424 (`p.endsWith('.read') || p === 'backup.download'` — agrees only by luck); otherwise every future read perm not named `*.read` (e.g. `file.sftp`) silently becomes a write for `admin.read` | core-model + TARGET-VOCABULARY-PROPOSAL | none |
| P2 | permissions.ts:432-546 | Delete the stale duplicate `PERMISSION_CATEGORIES`/`PERMISSION_PRESETS` (missing `server.update/install/reinstall/rebuild`, `backup.download`, `apikey.manage`, `server.suspend` vs the canonical permissions-catalog.ts) or re-export the canonical array; re-point the `PERMISSION_PRESETS` import at roles.ts:14/1048 to a canonical preset list; its only other consumer is `src/__tests__/rbac.test.ts:494,512` (test migration belongs to the test-plan auditor) | server-core + server-extras + admin-system + admin-people + infra + realtime + core-model | none — seven audits independently flagged it |

## src/routes/nodes.ts

| Pri | file:line | Exact change | Sources | Conflict notes |
|---|---|---|---|---|
| P0 | nodes.ts:2508-2516 | POST /assign-wildcard: require write-admin (`hasGrant(perms, "admin.write")`, i.e. `*`/admin.write) instead of bare `node.assign`; reject `targetId === request.user.userId` and roles the caller belongs to — today `node.assign` alone grants self wildcard access to every node (privilege escalation) | infra | none |
| P0 | nodes.ts:2033-2037, 2619-2623 | DELETE /:nodeId/assignments/:assignmentId and DELETE /assign-wildcard/:targetType/:targetId: add the assigner `hasNodeAccess` guard used by POST /assign (nodes.ts:1924-1931) — today `node.assign` with zero node access can revoke ANY assignment on ANY node | infra | none |
| P0 | nodes.ts:3165-3169 | GET /:nodeId/agent/config: raise the gate from `node.read` to `node.update` (interim) AND scope with hasNodeAccess — the payload is security-sensitive agent config (nodes.ts:3236-3239) readable today by bare `node.read` (shipped support/moderator presets) | infra | DECISION-NEEDED: interim `node.update` vs new `node.agent_config` (latter → REQUIRES-NEW-VOCABULARY) |
| P1 | nodes.ts:57-66 | `ensurePermission`: replace raw `perms.includes("*") || perms.includes(requiredPermission)` with `hasGrant(perms, requiredPermission)` (import from ../lib/permissions) — one change admits `admin.read` to 16 read endpoints, `admin.write` to 11 write endpoints (F-ADMIN-GAP), and revives scoped perms (`node.read:<id>`) | infra | none |
| P1 | nodes.ts:639, 785, 1145, 1502, 1548, 1592, 1876, 2105 | Switch the node-access leg of these read routes to hasNodeAccess read-mode (after the lib change) so `admin.read` passes | infra | none |
| P1 | nodes.ts:2146, 2193 | GET unregistered-containers + suggest-template: replace the literal `admin.write` gate with `node.read` (hasGrant-fixed) + hasNodeAccess read-mode | infra | none |
| P2 | nodes.ts:2948, 2995, 3207, 3286 | Agent restart / agent update / PUT agent-config / host-network: add hasNodeAccess guard for non-write-admins (mirror the PUT /:nodeId pattern at nodes.ts:995-1000) — `node.update` currently acts globally without node assignment | infra | none |
| P2 | nodes.ts:2690, 2781, 2824, 3075, 3129 | agent/status, agent/logs, agent/logs/stream, agent/update-status, agent/ping: add hasNodeAccess read-mode — bare `node.read` currently queries ANY node | infra | none |
| P2 | nodes.ts:672, 844 | deployment-token + agent API-key minting: change the required permission from `node.create` to `node.update` (existing-node operations; the inner nodeManage check at 687-694/861-868 already demands node.update) | infra | none |
| P2 | nodes.ts:1587, 1870 | GET /allocations + GET /assignments: admit `node.read` (+ hasNodeAccess read-mode) alongside `node.manage_allocation`/`node.assign` (write perms currently gate list reads) | infra | none |
| P2 | nodes.ts:276 | PATCH /auto-update: filter submitted nodeIds through `getUserAccessibleNodes` for non-write-admins, matching PUT /:nodeId scoping | infra | none |
| P2 | nodes.ts:2324 | POST /import-server: keep admin.write but via hasGrant, or introduce `node.import_server` | infra | DECISION-NEEDED (admin-level fallback vs new perm → REQUIRES-NEW-VOCABULARY) |

## src/routes/admin.ts

| Pri | file:line | Exact change | Sources | Conflict notes |
|---|---|---|---|---|
| P0 | admin.ts:570-583 + 639-654 | PUT /users: require `user.update` whenever `password`/`email`/`username`/`serverIds` are present (today `roleIds: []` is truthy so a set_roles-only holder unlocks password reset + email/username change + ServerAccess rewrites); port the scoped-grant escalation guard from POST /users (admin.ts:369-389) into the PUT role-assignment path (PUT checks global perms only) | admin-people | none (source audit rated P1; reclassified P0 = privilege escalation per Lead's scheme) |
| P0 | admin.ts:596, 1228, 1257 | Password-reset / passkeys-wipe / 2FA-wipe target guards: treat `admin.read` targets as admin-equivalent (currently only `*`/admin.write) — a user.update holder can currently reset a read-admin's password and wipe its passkeys = full read-panel takeover | admin-people | none |
| P0 | admin.ts:956-957 | Delete-user guard: add `targetEffectivePerms.includes('*')` to the admin-equivalent test (currently role-name "Administrator" + `admin.write` only — a superadmin whose `*` comes from an unnamed role is deletable by a mere user.delete holder) | admin-people | none |
| P0 | admin.ts:1167-1173 | POST unban: add the hierarchy guard mirroring ban (admin.ts:1110-1113) — a user.unban holder can currently unban an admin banned for cause by a `*` holder | admin-people | none |
| P0 | admin.ts:1276-1308, 1312-1347 | enforce-2fa + account-unlink: add hierarchy guards (block on `*`/admin.write/admin.read targets unless actor `*`) — a user.update holder can currently disable 2FA on a superadmin / unlink an admin's SSO | admin-people | none |
| P1 | admin.ts:84-88 | `canManageUsers`: replace raw `perms.includes('user.'+action)` with `hasGrant(perms, 'user.'+action)` — restores admin.read reads + admin.write writes on all 12 user-management endpoints (contract violation CG-1) | admin-people | none (source audit rated P0; per Lead's scheme this is P1 = contract violation) |
| P1 | admin.ts:2315 | GET /audit-logs/export: `checkPerm(request, 'admin.write')` → `'admin.read'` (align with system-errors export at admin.ts:2480; export writes nothing) | admin-people + admin-system | none |
| P2 | admin.ts:153-156 | GET /stats OR-list: trim `apikey.manage` (a write-tier perm) from the read gate, or document it | admin-system | none |
| P2 | admin.ts:440-453, 766-782, 1009-1014 | Default ServerAccess set granted on user create/update/transfer (when `serverIds` given without explicit perms): drop `server.delete`, `file.write`, `console.write` (trim to server.read/start/stop + alert.read; require explicit grants for the rest) | admin-people | none |
| P2 | admin.ts:908 | Remove the duplicate GET /api/admin/roles route (roles.ts GET / is the canonical implementation) or make it delegate | admin-people | none |

## src/routes/roles.ts

| Pri | file:line | Exact change | Sources | Conflict notes |
|---|---|---|---|---|
| P0 | roles.ts:917-985 | DELETE /:roleId/users/:userId: add the admin-demotion guard + last-admin guard mirroring admin.ts:603-618 — today `user.set_roles` alone can strip the Administrator role from every admin (bypasses the `*`-required guards on the admin.ts path) | admin-people | none |
| P0 | roles.ts:440-528, 718-758 | PUT /:roleId and DELETE /:roleId/permissions/:permission: hierarchy guard — editing permissions/scope of, or removing a permission from, an admin-equivalent role requires actor `*`; add a last-admin check before stripping `*`/admin.write from the Administrator role (a role.update holder can currently demote every admin at once) | admin-people | none |
| P2 | roles.ts:356-373, 489-507, 649-655 | Role create/update/permission-add: add catalog validation (reject strings not in PERMISSION_CATEGORIES / ALL_SERVER_PERMISSIONS as appropriate) — today a `*`-holding editor can store arbitrary/typo strings into `Role.permissions` (only the scoped-grant wizard at roles.ts:110-118 validates) | compat-inventory + core-model | none |
| P0 | roles.ts:203-213 | Key-scope (ADMIN-KEY-AMPLIFIED, 13 role routes): `checkPermission` resolves `hasPermission(prisma, userId, permission)` from the owner's live DB roles — replace with (or add) `hasGrant(request.user.permissions, permission)` so the API key's own scope is enforced (thread request into the helper) | key-scope-matrix + core-model | none |

## src/auth.ts

| Pri | file:line | Exact change | Sources | Conflict notes |
|---|---|---|---|---|
| P0 | auth.ts:282-299 | better-auth admin plugin is gated by the `User.role` column (written only by seeds/setup, never by panel role edits): sync `User.role` on every role connect/disconnect, or resolve the better-auth role from the RBAC relation at session time, or disable the `/api/auth/admin/*` HTTP surface (keep server-side `auth.api` calls) — today a demoted admin keeps impersonation/ban/set-password powers | admin-people | DECISION-NEEDED: three remediation strategies (sync column / resolve live / disable surface) |

## src/routes/auth.ts

| Pri | file:line | Exact change | Sources | Conflict notes |
|---|---|---|---|---|
| P2 | routes/auth.ts:802-901 | POST /profile/delete: add last-admin guard (refuse if actor is the last user holding `*`/admin.write) — today the seeded superadmin can self-delete and leave zero admins | admin-people | none |

## src/routes/servers/power.ts

| Pri | file:line | Exact change | Sources | Conflict notes |
|---|---|---|---|---|
| P0 | power.ts:56-95 | `ensurePowerAccess`: add an `actor` parameter and call `enforceKeyScope(actor, permission)` on every allow path (owner early-return at :64 included; per-permission loop at :74-88); update the 8 call sites — install :193, reinstall :290, cancel-install :387, rebuild :555, start :712, stop :913, kill :1048, restart :1180 — to pass `request.user`. Highest-impact endpoints: reinstall (data wipe) and kill | server-power | none |
| P2 | power.ts:1330, 1632 | Fix stale comments: "List port allocations" above the suspend route; dead "Transfer server ownership" comment with no route (real route is admin-ops.ts:734) | server-power | none |

## src/routes/servers/admin-ops.ts

| Pri | file:line | Exact change | Sources | Conflict notes |
|---|---|---|---|---|
| P0 | admin-ops.ts:218-223 | PATCH /:id/backup-settings: pass `request.user` as the 5th argument to `ensureServerAccess(...)` — the `actor` is currently omitted so `enforceKeyScope` never runs; a zero-scope owner key can rewrite backup S3/SFTP credentials (the exact exfiltration path the SECURITY comment guards subusers against) | server-power | none |
| P0 | admin-ops.ts:277-315 | backup-settings credential/storage-mode change gate: add `enforceKeyScope(request.user, 'backup.create')` — the decideServerAccess reason gate reads DB grants only, not the key scope | server-power | none |
| P0 | admin-ops.ts:391-410 (POST /:id/transfer) and 756-759 (POST /:serverId/transfer-ownership) | Add `enforceKeyScope(request.user, 'server.transfer')` on the owner/ServerAccess/role allow paths (the `checkIsAdmin` branch already honors key scope) | server-power + server-core | none |
| P1 | admin-ops.ts:699-702 | GET /:serverId/transfer-candidates: `checkIsAdmin(request, "admin.write")` → `"admin.read"` (read endpoint; admin.read currently 404s) | server-power | DECISION-NEEDED: whether read-admins see the `email` field (they already can via user.read-level endpoints) |
| P2 | admin-ops.ts:956-958 | Remove the dead "PER-SERVER ACTIVITY LOG" trailing section (comment hygiene) | server-power | none |

## src/routes/servers/network.ts

| Pri | file:line | Exact change | Sources | Conflict notes |
|---|---|---|---|---|
| P0 | network.ts:136-150, 371-385, 495-509 | POST /allocations, DELETE /allocations/:containerPort, POST /allocations/primary: wrap every allow path with `enforceKeyScope(request.user, "server.update")` — or convert the inline gates to `ensureServerAccess(serverId, userId, "server.update", reply, request.user)` (also picks up suspension + 404 handling) | server-power | none |
| P2 | network.ts:57-63 | GET /:serverId/allocations: extend `canAccessServer` with an optional actor (or post-check `enforceKeyScope(request.user, 'server.read')`) so key actors are bounded by key scope on reads (low severity) | server-power | none |
| P2 | network.ts:111-114, 134 | Delete the stale comment claiming `server.update` "is not a grantable catalog permission" (it is — permissions-catalog.ts:42) and the stale "update/delete" ServerAccess comment | server-power | none |

## src/routes/servers/core.ts

| Pri | file:line | Exact change | Sources | Conflict notes |
|---|---|---|---|---|
| P0 | core.ts:342 | POST / (create): remove `hasNodeAccessResult` as an alternative to `server.create` (or pair it with `node.update`) — today a bare node assignment (no permission at all) authorizes creating a server the caller then owns with full permissions, contradicting the "node assignment alone is NOT enough" contract enforced everywhere else | server-core | DECISION-NEEDED: the error message at core.ts:343 ("…or node assignment required") shows the path is deliberate — owner must decide product policy vs permission contract |
| P0 | core.ts:2273 (storage/resize) and 2423 (DELETE) | Owner bypass paths: add `enforceKeyScope(request.user, 'server.update' | 'server.delete')` — a zero-scope API key of the owner can currently resize disk / delete the server | server-core | none |
| P1 | core.ts:1443, 1491, 1640 | GET / (list): admit `admin.read` to the all-servers fast path (`checkIsAdmin(request, "admin.read")` instead of `"admin.write"`, with read-subset `effectivePermissions` mirroring _helpers.ts:1421-1425) and to the non-admin `isUserAdmin` merge at :1640 — admin.read currently sees only own/assigned servers | server-core | none |
| P2 | core.ts:2300 | storage/resize subuser branch: drop `file.write` from the accepted permissions — disk resize is a resource setting, require `server.update` only | server-core | none |
| P2 | core.ts:908, 1014, 1322 | Clone preflight/submit/retry: require a read-grade grant on the source (pass `requiredPermission: "server.read"` into the access decision instead of any-row `canAccessServer`) — a minimal-grant subuser + global `server.create` currently full-clones the source into a server they own with full permissions | server-core | none |
| P2 | core.ts:1336 | Clone retry: add an access check on the clone target server itself (owner or `server.update`-grade) — currently gated only by source access + provenance | server-core | none |
| P2 | core.ts:1867-1893 | Delete the unreachable sensitive-fields re-check (everyone who passes `ensureServerAccess` at :1827 passes it too) — or make it genuinely stricter once the `server.update` vocabulary split lands | server-core | none |

## src/routes/servers/variables.ts

| Pri | file:line | Exact change | Sources | Conflict notes |
|---|---|---|---|---|
| P0 | variables.ts:86 | PATCH /:serverId/variables owner path: add `enforceKeyScope(request.user, 'server.update')` — env vars flow into container startup; a narrow key of the owner can currently rewrite them | server-core | none |

## src/routes/servers/stats.ts

| Pri | file:line | Exact change | Sources | Conflict notes |
|---|---|---|---|---|
| P2 | stats.ts:108 | Fix the wrong "Update server" comment above GET /:serverId/activity (comment hygiene) | server-core | none |

## src/routes/bulk-servers.ts

| Pri | file:line | Exact change | Sources | Conflict notes |
|---|---|---|---|---|
| P1 | bulk-servers.ts:666-667 | POST /bulk/status: add `admin.read` to the `isAdmin` check (`perms.includes('*') || perms.includes('admin.write') || perms.includes('admin.read')`) — read-admins currently get `not_found` for every non-owned server | server-core | none |
| P2 | bulk-servers.ts:46-91, 84-85, 149-151 | Delete the provably-dead per-server `hasServerAccess` layer (any user passing the global gate at :118/:301/:457 passes it automatically) and fix the comments at :84-85/:149-151 that contradict the code; optionally honor RoleServerGrant/RoleNodeGrant rows in the /bulk/status filter for consistency with GET / | server-core | DECISION-NEEDED (adjacent): single DELETE /:serverId allows a plain owner (core.ts:2423) while bulk DELETE requires global `server.delete` (:457) — pick one contract |

## src/routes/backups.ts

| Pri | file:line | Exact change | Sources | Conflict notes |
|---|---|---|---|---|
| P0 | backups.ts:43-96 + call sites 106, 175, 263, 306, 465, 539 | `ensureBackupAccess`: add an `actor` parameter and call `enforceKeyScope(actor, permission)` on every allowed branch — or replace the helper with `ensureServerAccess` (identical contract incl. key scope) at all six call sites (create/read/read/restore/delete/download). Also closes the MCP backup tools (plugins.md E3) | server-files + plugins | none |

## src/routes/servers/databases.ts

| Pri | file:line | Exact change | Sources | Conflict notes |
|---|---|---|---|---|
| P1 | databases.ts:48-55 | GET /:serverId/databases: use `ensureServerAccess(serverId, userId, "database.read", reply, request.user)` instead of `ensureDatabasePermission` — admin.read and node managers are currently denied (the helper lacks the admin_read + node_manage branches) | server-files + plugins | none |
| P1 | databases.ts:17-32 | GET /api/servers/database-hosts: gate on a permission (`admin.read` via hasGrant) instead of the "owns ≥1 server OR any ServerAccess row" fallback that exposes panel-wide DB hostnames/ports to any single-server subuser; scope the host list to hosts referenced by the caller's accessible servers | server-files + plugins | DECISION-NEEDED: bare `admin.read` vs new `database.host.read` (latter → REQUIRES-NEW-VOCABULARY) |

## src/routes/servers/_helpers.ts

| Pri | file:line | Exact change | Sources | Conflict notes |
|---|---|---|---|---|
| P0 | _helpers.ts:495-558 (ensureServerAccess), 1446-1515 (ensureDatabasePermission) | Make the `actor` parameter REQUIRED (TypeScript non-optional + runtime throw on missing) so every omission fails loudly at compile time — the compiler then lights up every call site missed by the audits; add an optional `actor` to `canAccessServer` too | key-scope-matrix §6.2 + core-model | none — systemic backstop for the whole key-scope family |
| P2 | _helpers.ts:1446-1515 | `ensureDatabasePermission`: delegate to `decideServerAccess` (or retire in favor of `ensureServerAccess`) so the database routes get the admin_read + node_manage branches consistently | server-files + core-model | none |
| P2 | _helpers.ts:61 (DEFAULT_PERMISSION_PRESETS.full / OWNER_SERVER_PERMISSIONS) | `server.transfer` is shipped in the owner-full preset but never enforced by transfer-ownership — remove it from the preset, or make the route accept it (see the server.transfer DECISION-NEEDED in admin-ops.ts / REQUIRES-NEW-VOCABULARY) | server-core + server-power | DECISION-NEEDED (see transfer semantics conflict) |

## src/routes/alerts.ts

| Pri | file:line | Exact change | Sources | Conflict notes |
|---|---|---|---|---|
| P0 | alerts.ts:12-27 (isAdminUser via `getUserPermissions(prisma, userId)` DB lookup) + 24-76 (local ensureServerAccess) | Key-scope (ADMIN-KEY-AMPLIFIED, 11 alert routes): the gates resolve the owner's live DB roles — enforce the key's own scope: `hasGrant(request.user.permissions, …)` in isAdminUser, and port the local ensureServerAccess onto the shared `_helpers` version with `actor` (also fixes rule-mutation reachability of narrow keys) | key-scope-matrix + core-model | none |

## src/routes/templates.ts

| Pri | file:line | Exact change | Sources | Conflict notes |
|---|---|---|---|---|
| P0 | templates.ts:3 + all 7 route gates (`hasPermission(prisma, userId, …)`) | Key-scope (ADMIN-KEY-AMPLIFIED, 7 template routes): consult `request.user.permissions` via hasGrant in the gates (or adopt the server.ts global hook with `config.requiredPermission`) — today any valid key of a template-capable user passes regardless of its declared scope | key-scope-matrix + core-model | none |

## src/routes/locations.ts

| Pri | file:line | Exact change | Sources | Conflict notes |
|---|---|---|---|---|
| P0 | locations.ts:3 + all 5 route gates (`hasAnyPermission(prisma, userId, …)`) | Key-scope (ADMIN-KEY-AMPLIFIED, 5 location routes): same fix — enforce `request.user.permissions` (hasGrant) in the gates | key-scope-matrix + core-model | none |

## src/routes/nests.ts

| Pri | file:line | Exact change | Sources | Conflict notes |
|---|---|---|---|---|
| P0 | nests.ts:3 + all 5 route gates (`hasAnyPermission(prisma, userId, …)`) | Key-scope (ADMIN-KEY-AMPLIFIED, 5 nest routes): same fix — enforce `request.user.permissions` (hasGrant) in the gates | key-scope-matrix + core-model | none |

## src/shared-types.ts

| Pri | file:line | Exact change | Sources | Conflict notes |
|---|---|---|---|---|
| P2 | shared-types.ts:44-115 | The `Permission` enum is a third hand-maintained catalog copy (matches today, drifts silently): generate it from permissions-catalog.ts at build time, or add a sync check (the test that pins it belongs to the test-plan auditor) | core-model | none |

## src/services/api-key-service.ts

| Pri | file:line | Exact change | Sources | Conflict notes |
|---|---|---|---|---|
| P2 | api-key-service.ts:8-12 | Fix the docstring drift (describes stale semantics vs the live-inheritance behavior implemented at server.ts:483-511) | core-model | none |

## src/server.ts

| Pri | file:line | Exact change | Sources | Conflict notes |
|---|---|---|---|---|
| P0 | server.ts:595 (immediately after `(app as any).authenticate = authenticate;`) | Systemic layer 1 for the key-scope family: register a global `preHandler` hook — when `request.user.apiKeyId` is set and the route declares `config.requiredPermission` (or `requiredPermissions: string[]` with any-of semantics), enforce `hasGrant(request.user.permissions, required)` and 403 otherwise; then add the one-line `config` declaration to each key-scope-affected route (same style as the existing `config.rateLimit`) | key-scope-matrix §6.1 | none — recommended over ~110 individual call-site patches; combine with the _helpers.ts actor-required row |
| P0 | server.ts:1512-1568 (connection-info) and 1622-1676 (rotate-token) | SFTP token mint/rotate: change `requiredPermission: "server.read"` → `"file.read"` (or the new `file.sftp`) AND add `enforceKeyScope(request.user, perm)` — today a bare view-servers role / narrow key mints a token that validates to `["*"]` full SFTP R/W, and `server.read` leaks node SFTP host/port | server-files | DECISION-NEEDED: interim `file.read` vs new `file.sftp` (→ REQUIRES-NEW-VOCABULARY; also resolves the lib/validation.ts:227 phantom comment; see sftp-fix-design.md for the ordered panel-side repair) |
| P0 | server.ts:1708-1752 (GET /api/sftp/tokens), 1807-1821, 1858-1867 (DELETE tokens) | Add `enforceKeyScope` on the SFTP token list/revoke endpoints (currently user-DB grants only) | server-files | none |
| P1 | server.ts:1483-1488 | SFTP validate-token permission derivation: replace `isAdmin ? ["*"] : serverAccess?.permissions ?? []` with `getEffectiveServerPermissions(result.userId, server)` — owners currently derive `[]` (SFTP functionally broken), `admin.read` derives `[]` (SFTP read dead), node managers derive `[]` | server-files | none |
| P1 | server.ts:1744-1749 | GET /api/sftp/tokens decision: pass `requiredPermission` (e.g. `"file.read"`) so the `admin_read` branch of decideServerAccess is reachable — admin.read currently cannot list SFTP tokens | server-files | none |
| P1 | server.ts:1875 | GET /api/update/check: add a hasGrant-based `admin.read` gate — currently auth-only; any authenticated user reads panel version + update availability (same data as the admin-gated /api/admin/update/status) | admin-system | none |
| P2 | server.ts:1121-1135 | GET /api/agent/version: add an `admin.read` gate or record the auth-only stance as intentional in a code comment | admin-system | DECISION-NEEDED (mild): plausibly by design for node-bootstrap UI |
| P2 | server.ts:1449 | Fix the stale "up to 1 year" comment (actual max 24h, sftp-token-manager.ts:68) | server-files | none |

## src/services/sftp-token-manager.ts

| Pri | file:line | Exact change | Sources | Conflict notes |
|---|---|---|---|---|
| P2 | sftp-token-manager.ts:332-368 | `listSftpTokensForServer`: honor the `isOwner`/`requestUserId` parameters (currently unused) so non-managers see only their own token entries — today any subuser with any ServerAccess row sees all users' token metadata (emails/usernames/expiry) | server-files | none |
| P2 | sftp-token-manager.ts:184-214 | `revalidateSftpSession` is documented-but-dead code (only a test calls it): wire it into the token-validation path or delete it and document the session-open snapshot contract — the agent enforces the frozen permission list verbatim until disconnect (sftp_server.rs:1220-1232), so panel-side revocations never reach live SFTP sessions | agent-side | DECISION-NEEDED: wire revalidation vs accept-and-document the snapshot window |

## src/routes/servers/mod-plugins.ts

| Pri | file:line | Exact change | Sources | Conflict notes |
|---|---|---|---|---|
| P0 | mod-plugins.ts:64, 134, 276, 341, 495, 558, 680, 744, 933, 982, 1036, 1101, 1158, 1275, 1387, 1528 | Pass `request.user` as the actor (5th arg) at all 16 `ensureServerAccess` call sites — a key scoped to `server.read` (or ∅) currently performs file.write-class writes (mod/plugin install/uninstall/update) with the owner user's full DB-resolved access | server-extras | none |
| P2 | mod-plugins.ts:933, 982 | GET mod-manager/installed + plugin-manager/installed: gate the file-tunnel directory listing on `file.read` for consistency with files.ts:115 (server.read-only subusers currently enumerate mod/plugin filenames) | server-extras | none |
| P2 | mod-plugins.ts:1158, 1275 | POST check-updates ×2: decide — document as read-refresh (writes InstalledMod rows on a `server.read` gate, reachable by admin.read) or gate on `mod.read` once introduced | server-extras | DECISION-NEEDED (mild) |
| P2 | mod-plugins.ts:1644-1645 | Remove the dead trailing "Download server file" comment | server-extras | none |

## src/routes/servers/cs2.ts

| Pri | file:line | Exact change | Sources | Conflict notes |
|---|---|---|---|---|
| P0 | cs2.ts:177-180 | `ensureAccess` wrapper: pass `request.user` through to `ensureServerAccess` — same key-scope bypass class (framework install/uninstall writes + gameinfo.gi patches) | server-extras | none |
| P2 | cs2.ts:204, 461 | GET frameworks + GET plugins: gate the tunnel directory listings on `file.read` for consistency with files.ts:115 | server-extras | none |

## src/routes/servers/invites.ts

| Pri | file:line | Exact change | Sources | Conflict notes |
|---|---|---|---|---|
| P0 | invites.ts:93-102 | GET /:sid/invites: gate on `canManageSubusers` and/or strip the raw `token` column from the listing — tokens are bearer credentials currently returned to any subuser (gate is `canAccessServer`, not the manage path) | server-extras | none |
| P0 | invites.ts:133, 257, 340, 646, 726 | The five manage-path writes (create invite, regenerate, delete, POST /access, DELETE /access/:targetUserId): enforce API-key scope — interim `enforceKeyScope(request.user, 'admin.write')`; clean fix is the new `server.subusers` permission (→ REQUIRES-NEW-VOCABULARY) | server-extras | none |
| P2 | invites.ts:150-172, 659-685 | Validate permission payloads ⊆ ALL_SERVER_PERMISSIONS (reject `admin.*`, `*`, `node.*`) on invite create and access grant — arbitrary strings can currently be stuffed into ServerAccess rows and flow into consumers verbatim | server-extras | none |
| P2 | invites.ts:759-760 | Remove the dead trailing "List server databases" comment | server-extras | none |

## src/routes/tasks.ts

| Pri | file:line | Exact change | Sources | Conflict notes |
|---|---|---|---|---|
| P0 | tasks.ts:20-112 | Thread `request.user` into `ensureSchedulePermission`/`ensureCommandPermission` and run `enforceKeyScope(request.user, 'server.schedule' | 'console.write')` — task CRUD + execute currently acts with the owner user's full DB access regardless of key scope | server-extras | none |
| P1 | tasks.ts:223-229, 248-254 | GET /:sid/tasks + GET /:sid/tasks/:taskId: gate reads on `server.read` (read variant of the helper or `ensureServerAccess`) instead of the write-level `server.schedule` — admin.read and server.read subusers currently 403 on the only listing that behaves this way | server-extras | none |
| P2 | tasks.ts:144-158, 287-300, 453-478 | Task create/update/execute: require the action-matching permission (`server.start`/`server.stop`/`backup.create`) like the existing `console.write` gate for command tasks — a schedule-only subuser can currently create/execute stop tasks they could never trigger directly | server-extras | none |

## src/routes/metrics.ts

| Pri | file:line | Exact change | Sources | Conflict notes |
|---|---|---|---|---|
| P1 | metrics.ts:83-90 and 349-356 | GET /servers/:sid/metrics + /stats: replace `rolePerms.includes("server.read")` with `hasGrant(rolePerms, "server.read")` — restores admin.read AND bare admin.write (currently only `*` or roles also holding server.read/node.update pass) | server-extras | none |
| P1 | metrics.ts:405-412 | GET /nodes/:nodeId/metrics: accept the targeted `node.view_stats` (currently admin-bits only, blinding the shipped support/moderator presets that grant it) | server-extras + infra | DECISION-NEEDED: server-extras proposes `hasAnyPermission([node.view_stats, node.read]) || admin bits`; infra proposes `hasGrant(perms, "node.view_stats") + hasNodeAccess read-mode` (admits `*`/admin.write/admin.read via hasGrant + view_stats holders WITH node assignment). Difference: whether bare `node.read` (no assignment) qualifies and whether node-assignment scoping applies |

## src/routes/console-stream.ts

| Pri | file:line | Exact change | Sources | Conflict notes |
|---|---|---|---|---|
| P0 | console-stream.ts:184 | POST /:serverId/console/command: `checkIsAdmin(request, 'admin.read')` → `checkIsAdmin(request, 'admin.write')` — the console-command route is a write channel; today only the gateway re-check (gateway.ts:5435) stops an admin.read holder, so the route layer encodes the wrong contract | realtime | none |
| P0 | console-stream.ts:61-81 (GET stream) and 151-233 (POST command) | Add `enforceKeyScope(request.user, 'console.read' | 'console.write')` at the route — the gateway re-check only receives userId and cannot enforce the key scope (mirror metrics-stream.ts:54-56) | realtime | none |

## src/routes/sse-events.ts

| Pri | file:line | Exact change | Sources | Conflict notes |
|---|---|---|---|---|
| P1 | sse-events.ts:188-235 (gate at 202) | GET /api/servers/all-servers/events: admit `admin.read` to the unfiltered stream (`isFullAdminRole(rolePerms) || rolePerms.includes('admin.read')` → `allowedServerIds = undefined`); extend the scoped branch to honor decideServerAccess's role_permission branch (a global role holding `server.read` → all servers); rewrite the comments at :189-203 which codify the opposite contract | realtime | none |
| P2 | sse-events.ts:131-144 | Switch the session-only auth to the `authenticate` middleware (accepts API keys) for surface parity with console/metrics streams — pair with admin-events.ts:110-121 | realtime | none |

## src/websocket/gateway.ts

| Pri | file:line | Exact change | Sources | Conflict notes |
|---|---|---|---|---|
| P1 | gateway.ts:4276 | `getAllowedUsersForServer` console.read cache: seed the baseline with owner + only ServerAccess rows whose `permissions` include `console.read` (currently every row's userId) — removing console.read from a subuser's row currently never cuts their SSE console stream | realtime | none |
| P1 | gateway.ts:4559-4589 + 4152-4183 | Add a 60s re-auth sweeper for unfiltered `globalSseSubscribers` (mirror `reauthAdminSubscribers` at 4917-4952): re-check the qualifying grant (`*`/admin.write, plus admin.read once the sse-events fix lands) and close on loss; optionally apply the `allowedUsers` check to `'deliver'` decisions on serverId-carrying payloads in `pushToGlobalSubscribers` | realtime | none |
| P2 | gateway.ts:410-429 | `pruneServerSubscriptions`: include the `sseSubscribers` (console SSE) registry in the no-argument/global branch, matching the serverId branch at 397-409 — global invalidations currently miss console SSE | realtime | none |
| P2 | gateway.ts:3545-3563 + 5545-5552 | Plugin WS dispatch: extend `registerPluginWsHandler` with a required-permissions field enforced by the dispatcher before invoking the handler | realtime + plugins | none |
| P2 | gateway.ts:5570-5581 | `broadcastToAuthenticated`: scope broadcasts to per-server subscription sets or an explicit subscriber list, or document as a trusted-plugin-only API | realtime + plugins | none |

## src/routes/admin-events.ts

| Pri | file:line | Exact change | Sources | Conflict notes |
|---|---|---|---|---|
| P2 | admin-events.ts:110-121 | Switch the session-only auth to the `authenticate` middleware for API-key parity (pair with sse-events.ts) | realtime | none |

## src/plugins/context.ts

| Pri | file:line | Exact change | Sources | Conflict notes |
|---|---|---|---|---|
| P1 | context.ts:1161-1189 | `requirePermission` + `hasPermission`: replace raw `perms.includes('*') || required.some(p => perms.includes(p))` with `hasGrant` semantics (import from lib/permissions) — admin.write/admin.read callers currently fail concrete-permission checks on plugin routes (inverse of the panel contract) | plugins | none |
| P2 | context.ts:856-863 | `sendWebSocketMessage('*')`: gate the all-clients broadcast on a new `ws.broadcast` plugin capability or remove the `'*'` target — any enabled plugin can currently push arbitrary payloads to every authenticated client with no capability declaration | plugins | REQUIRES-NEW-VOCABULARY (plugin capability) |
| P2 | context.ts:591-592 + safety.ts:75-90 | Phantom plugin tokens: enforce or remove plugin-scope `admin.read`/`admin.write` (never checked anywhere) and the dead `user.write` (empty whitelist, always throws); fix the PERMISSION_INFO consent copy so dialogs never claim capabilities that don't exist | plugins | DECISION-NEEDED: enforce vs delete each token |

## src/routes/plugins.ts

| Pri | file:line | Exact change | Sources | Conflict notes |
|---|---|---|---|---|
| P1 | plugins.ts:616-648, 665-720, 1020-1062 | GET /api/plugins, GET /:name, GET /:name/frontend-manifest: gate the sensitive fields (declared/granted permissions, consent state, licensing destinations, capability inventories, configSchema) on `isAdminCaller(request, 'admin.read')` (already implemented at plugins.ts:66-76); keep a minimal public projection (name/displayName/status/entry) for non-admins — currently auth-only, also reachable by any API key via MCP `list_panel_plugins`/`get_panel_plugin` | plugins | DECISION-NEEDED: bare `admin.read` gate vs new `plugin.read` perm (→ REQUIRES-NEW-VOCABULARY) |
| P2 | plugins.ts:557-607 | /plugins-assets: restrict `.map` sourcemaps (can embed original source) to admin.read callers, or drop `.map` from ASSET_EXTENSIONS; document the auth-only stance for remaining asset types if intentional | plugins | none |

## src/routes/update.ts

| Pri | file:line | Exact change | Sources | Conflict notes |
|---|---|---|---|---|
| P1 | update.ts:32-35, 42, 73, 212 | Replace the raw local `checkPerm` (`perms.includes('*') || perms.includes(permission)`) with `hasGrant` from ../lib/permissions, then change GET /status (:42), GET /settings (:73), GET /state (:212) to `admin.read` (writes stay on `admin.write`) — using hasGrant matters: raw includes would lock out admin.write-only users once the gate becomes admin.read | admin-system | none |

## src/routes/migration.ts

| Pri | file:line | Exact change | Sources | Conflict notes |
|---|---|---|---|---|
| P1 | migration.ts:36-43, 53, 357, 373, 446 | Replace the raw `requireAdmin` with a hasGrant-based helper, then switch reads to `admin.read`: GET /catalyst-nodes (:53), GET / (:357), GET /:jobId (:373), GET /:jobId/steps (:446); writes keep `admin.write` | admin-system | none |

## src/routes/dashboard.ts

| Pri | file:line | Exact change | Sources | Conflict notes |
|---|---|---|---|---|
| P1 | dashboard.ts:50 | `isGlobalAdmin = perms.includes('*') || perms.includes('admin.read') || perms.includes('admin.write')` — admin.read currently gets scoped (own-servers-only) server counts on GET /stats despite being the read-everything grant | admin-system | none |
| P2 | dashboard.ts:203-206 | `canReadNodes`: also accept `node.view_stats` (exists precisely for this, is read-classified, yet is ignored — node-stats-only viewers get zeros on /resources) | admin-system | none |

## src/routes/api-keys.ts

| Pri | file:line | Exact change | Sources | Conflict notes |
|---|---|---|---|---|
| P1 | api-keys.ts:381-383 | GET /api/admin/api-keys/:id/usage: preHandler `requireApiKeyManage` → `requireApiKeyRead` (the in-handler check at :399-402 already allows admin.read; the preHandler rejects it first) | admin-people | none |
| P2 | api-keys.ts:85-87 (create) + update path | Catalog-validate the key's permission array on create/update (reject strings not in PERMISSION_CATEGORIES unless `*`) — today only the format is checked, so arbitrary/typo strings can be frozen into a key scope | core-model | none |

## src/lib/validation.ts

| Pri | file:line | Exact change | Sources | Conflict notes |
|---|---|---|---|---|
| P2 | validation.ts:227 | The `file.sftp` comment is a phantom (syntax example only, never cataloged/enforced): register the permission (per the SFTP mint-gate decision) or remove the comment | server-files | DECISION-NEEDED (tied to the SFTP gate decision in server.ts) |
| P2 | validation.ts:229-244 | `permissionSchema`/`roleCreateSchema` are dead code (zero consumers — roles.ts does its own inline checks): wire them into role create/update for shape validation (accepts `*`, `resource.action`, `resource.action:resourceId`, multi-segment resources), or delete them | compat-inventory | none |

## Seeds / bootstrap (default role arrays)

| Pri | file:line | Exact change | Sources | Conflict notes |
|---|---|---|---|---|
| P2 | prisma/seed.ts:330-347, 350-357; src/routes/setup.ts:528-538; scripts/bootstrap-production.ts:33-48, 51-62 | Align the divergent default permission arrays: three different "User"-role defaults (seed.ts `["server.read"]` vs setup.ts 8 perms) and two Administrator shapes (`["*"]` vs bootstrap's `*`+14 concrete) — pick one canonical shape per role so vocabulary changes don't orphan differently-seeded installs | compat-inventory | none |

---

## Frontend (catalyst-frontend/src)

The frontend `hasAnyPermission`/`permissionMatches` mirror (components/auth/ProtectedRoute.tsx:61-87) is semantically exact vs backend `hasGrant` — the gaps below are hardcoded data and raw `includes` sites that bypass it. Server-level UI is backend-driven via `effectivePermissions` and auto-adapts to backend splits.

| Pri | file:line | Exact change | Sources | Conflict notes |
|---|---|---|---|---|
| P1 | pages/admin/RolesPage.tsx:64-179 (and presets 182-212) | The hardcoded role-editor catalog is stale vs the backend PERMISSION_CATEGORIES: add `server.update`, `server.install`, `server.reinstall`, `server.rebuild`, `backup.download` (five backend perms are ungrantable via the role editor — the exact "missing permission forces fallback to admin-level grants" failure); align the preset chips with backend PERMISSION_PRESETS (frontend moderator wrongly includes `node.assign`) — longer-term, drive the grid from a backend catalog endpoint like the API-key selector does | frontend | none |
| P1 | components/layout/FleetHeartbeat.tsx:22-24 | `canSeeNodes = '*' || node.read` — add `admin.read` (read-admins currently see server counts instead of node counts in the shell heartbeat; the component's own comment at :15-17 expects admin.read holders to receive node events) | frontend | none |
| P2 | lib/serverPermissions.ts:25-51 + label switch 58-113 | Offline fallback `FALLBACK_SERVER_PERMISSIONS` is missing `server.update` + `backup.download` (25 of 27 perms) and the label switch has no cases for them — sync with ALL_SERVER_PERMISSIONS; add the matching `common.json` serverPermissions keys in en/fr/zh-CN in the same change | frontend + compat-inventory | none |
| P2 | pages/ApiKeysPage.tsx:305-308 | Mutation buttons check `apikey.manage`/`*` only — add `admin.write` (admin.write-only roles currently lose the create/revoke UI though the backend allows them) | frontend | none |
| P2 | pages/nodes/NodesPage.tsx:289-297 | Create/delete buttons use raw `includes('node.create'/'node.delete'/'*')` — route through `hasAnyPermission` so `admin.write` passes | frontend | none |
| P2 | components/servers/CreateApiKeyDialog.tsx:54-64 | Permission picker filters by raw `myPermissions.includes(p.value)` — an admin.write-only user gets an empty picker; apply hasGrant semantics (or have the backend my-permissions endpoint return the implied set) | frontend | none |
| P2 | pages/servers/ServerDetailsPage.tsx:280-287 (canManageDatabases) | Includes `admin.read` but NOT `admin.write` (doubly wrong: read-admins see manage UI they'll 403 on; write-admins don't see UI they can use) — gate on `admin.write`/`*` | frontend | none |
| P2 | components/auth/AdminRedirect.tsx:36-38 | Raw `includes` matching misses scoped grants (`node.read:x`) and admin.write implication — route through the shared `hasAnyPermission` helper | frontend | none |
| P2 | App.tsx:517, components/shared/UpdateNotification.tsx:85, SystemPage read sections | After the backend update.ts reads move to `admin.read` (P1 above): split the frontend gates — update-status/banner reads visible to admin.read, trigger/settings writes stay admin.write | frontend | sequencing: backend first |
| P2 | pages/servers/ServerDetailsPage.tsx:898-899 (users tab via `server.delete`), components/backups/BackupSection.tsx:552 (download button gated by canRead not `backup.download`), ServerDetailsPage.tsx:213-219 (isAdmin fallback renders write controls for admin.read while effectivePermissions loads) | Cosmetic UI/backend mismatches — align tab/button visibility with the backend contract (users tab → owner/admin/node-manage; download → `backup.download`) | frontend | none |

---

## REQUIRES-NEW-VOCABULARY

These need catalog entries (PERMISSION_CATEGORIES + ALL_SERVER_PERMISSIONS where server-scoped + preset updates) — the authoritative split/merge decisions now live in **TARGET-VOCABULARY-PROPOSAL.md** (landed); the rows below cross-reference it. Interim non-catalog fixes above are P2 rows in the main list.

**Universal pre-step for ANY new/renamed permission** (compat-inventory + frontend): backend catalog (permissions-catalog.ts:18-169, ALL_SERVER_PERMISSIONS :238-247 if server-scoped, `isReadPermission` lib/permissions.ts:130-136 if read-type) + frontend copies (pages/admin/RolesPage.tsx:64-208, components/auth/ProtectedRoute.tsx:7-50, lib/serverPermissions.ts:25-51 + label switch) + i18n keys in en/fr/zh-CN in the same change (`roles.permissionLabels.*` admin-access.json ×3, `serverPermissions.*` common.json ×3; `pnpm i18n:check` enforces 100%) + seeds/presets if defaulted (prisma/seed.ts, prisma/seed-admin.ts, src/routes/setup.ts, scripts/bootstrap-production.ts — four files with divergent default arrays). **Renames additionally need a data migration** (`UPDATE "Role" SET permissions = array_replace(...)` × Role/RoleServerGrant/RoleNodeGrant/ServerAccess/ServerAccessInvite/apikey — compat-inventory §6; a rename without it silently revokes access) and the five duplicated frontend route→perm maps updated (App.tsx, AdminRedirect.tsx, navSections.ts, SearchPalette.tsx, Sidebar.tsx). Existing stored arrays are NOT catalog-clean (only roles.ts:110-118 validates), so migrations must be idempotent. Test updates (rbac.test.ts, rbac-permissions.test.tsx — pins ADMIN_PERMISSIONS membership incl. `not.toContain('server.kill')`) belong to the test-plan auditor.

| New permission | Capability | Endpoints | Sources | Notes / conflicts |
|---|---|---|---|---|
| `server.kill` | Force-kill (SIGKILL) a running container | power.ts:1048; frontend ServerControls.tsx:52 (`canKill = canStop` must split — D7) | server-power (proposes split) vs server-core (defensible as one stop family) | DECISION-NEEDED; compat window accepting `server.stop` proposed by server-power |
| `server.archive` | Archive + restore-from-archive | admin-ops.ts:837, 907; no frontend caller exists (services/api/servers.ts:401,406 uncalled — greenfield UI) | server-power | currently rides `server.suspend` (4 capabilities on one bit) |
| `server.migrate` / relabel `server.transfer` | Node migration vs ownership transfer split | admin-ops.ts:396-406, :756; permissions-catalog.ts:40; preset _helpers.ts:61 | server-power + server-core | **Top conflict**: server-power proposes rename to `server.migrate` + reserve/relabel `server.transfer`; server-core proposes accepting `server.transfer` on transfer-ownership or removing it from the owner preset |
| `server.storage.resize`, `server.startup.update`, `server.resources.update` | Split of the `server.update` mega-perm (resize; env/startup/variables; resources/network) | core.ts PUT + storage/resize; variables.ts PATCH | server-core | interim P2: drop `file.write` from resize; delete dead sensitive-block |
| `mod.read` / `mod.write` | Browse vs install/update/uninstall mods, plugins, CS2 frameworks | mod-plugins.ts + cs2.ts (all reads / all writes) | server-extras | deprecation window accepting `file.write`; re-gate listings off `server.read` |
| `file.sftp` | Mint/rotate SFTP access tokens | server.ts:1512-1568, 1622-1676; frontend ServerDetailsPage.tsx:894 (sftp tab gate currently `file.read`) | server-files | DECISION-NEEDED vs interim `file.read` |
| `database.host.read` | List panel database hosts | databases.ts:17-32 | server-files | panel-level, not server-scoped |
| `server.subusers` | Subuser/invite management (create/regenerate/cancel invites, grant/edit/remove ServerAccess) | invites.ts five manage-path routes | server-extras | optional — `canManageSubusers` ownership-level design is deliberate; interim key-scope fix is P0 above |
| `node.agent_control` / `node.agent_config` | Agent restart/binary-update; agent config read/write + host-network | nodes.ts:2944-3348, :3165 | infra | interim: P0/P2 rows above (raise config read, scope writes) |
| `node.import_server` | Import a server from a node | nodes.ts:2324 | infra | DECISION-NEEDED (keep admin.write) |
| `template.import` | Pterodactyl egg import (single + batch) | templates.ts:485, :602 | infra | optional — current template.create gate is safe |
| `migration.manage` / `update.trigger` | Delegate migrations / panel self-update without full admin.write | migration.ts writes; update.ts:187 | admin-system | reads must move to admin.read regardless (P1 above) |
| `apikey.read/create/update/delete` split | Decompose the `apikey.manage` mega-perm | api-keys.ts; frontend: App.tsx:611, AdminRedirect.tsx:14, navSections.ts:71, SearchPalette.tsx:331, Sidebar.tsx:54, ApiKeysPage.tsx:305-308, ProtectedRoute.tsx:50 | admin-people + frontend | keep `apikey.manage` as deprecated alias one release (no data migration then; removal would need an array migration across Role + apikey tables — compat-inventory §6); avoid names colliding with plugin-scope tokens (frontend D9) |
| `plugin.read` | Read plugin inventory (permissions/consent/licensing) | plugins.ts:616-720, 1020-1062 | plugins | DECISION-NEEDED vs bare admin.read gate |
| `ws.broadcast` (plugin capability) | Push to all authenticated clients | context.ts:856-863 | plugins | plugin-consent vocabulary, not panel catalog |
| `server.restart` | Either catalog the synthetic string gateway.ts:3702-3742 materializes (currently ungrantable; behavior = start+stop composite) or stop materializing it | gateway.ts:3702-3742 + power.ts:1180 | realtime | phantom-perm cleanup |
| plugin-scope token fixes | Enforce-or-delete phantom `admin.read`/`admin.write`/`user.write` plugin tokens | safety.ts:75-90 + context.ts:591-592 | plugins | DECISION-NEEDED |
