# Coverage Completeness Sweep — OpenAPI × Findings Files

Auditor: `audit-admin-people` (assignment 3). Audit only — no source files modified.
Method: every operation in `api/openapi.json` (296 ops, 243 paths) was matched structurally (method + normalized path segments; `:param` ≡ `{param}` ≡ `{otherName}`) against the endpoint tables of all findings files under `audit/permission-audit/`. Files that landed mid-sweep were re-checked at completion (per assignment): endpoint-verdict sources incorporated = `key-scope-matrix.md` (per-endpoint key-scope classification, 309 endpoints) and **`alerts.md` (landed during this sweep — full 11-row verdict table for routes/alerts.ts, by audit-infra)**; non-endpoint-table docs excluded from coverage credit = `core-model.md`, `frontend.md`, `test-plan.md`, `agent-side.md`, `FIX-CHECKLIST.md`, `TARGET-VOCABULARY-PROPOSAL.md`/`TARGET-VOCABULARY.md`, `key-scope-impl-plan.md`, `frontend-impl-plan.md`, `sftp-fix-design.md`, `verification.md`, `compat-inventory.md`.

**Mid-sweep update:** when the gap analysis ran, the 11 alerts ops had no verdict rows anywhere; §2.2 below closed them. `alerts.md` then landed with the same 11 rows plus deeper findings (B-WRITE-LEAK key-scope ×5, D-CATALOG ×2 for the dead `alert.read` capability). Both coverages stand: §2.2 is the contract-level view (all 11 OK at session level), `alerts.md` adds the API-key-amplification and `alert.read`-semantics verdicts — where they differ, `alerts.md`'s deeper verdicts win for the final report.

## 1. Reconciliation summary

| Findings file | OpenAPI ops credited (structural match) |
|---|---|
| admin-people.md | 44 (users/roles/audit-logs/api-keys/auth + combined rows counted manually below) |
| admin-system.md | 53 (settings/system-errors/smtp/migration/update/env/dashboard/db-status/health/lockouts/oidc/theme/mod-manager/diagnostics/setup/providers) |
| infra.md | 37 (nodes/locations/nests/templates) |
| plugins.md | 12 (plugins/marketplace) |
| realtime.md | 1 (GET /api/admin/events) + SSE/WS surfaces in §3-EXTRA |
| server-core.md | 18 (servers core/clone/variables/bulk + transfer-ownership) |
| server-extras.md | 41 (mod-manager/plugin-manager/cs2/invites/tasks/metrics§2.5) |
| server-files.md | 22 (files/backups/databases/logs/sftp-referenced/file-tunnel) |
| server-power.md | 21 (power/admin-ops/network/allocations) |
| **Subtotal structural** | **267** |
| Manual verifications (rows written in combined/abbreviated form) | 6: `GET /api/admin/api-keys/my-permissions` + `GET /api/admin/api-keys/permissions-catalog` (admin-people.md §2.4, rows written as `GET …/my-permissions` / `GET …/permissions-catalog`); `POST /api/auth/profile/avatar` (admin-people.md §2.5 combined avatar POST/DELETE row); `POST /api/auth/reset-password/validate` (admin-people.md §2.5 combined forgot-password/validate row); `GET /api/servers/{serverId}/metrics` + `GET /api/servers/{serverId}/stats` (server-extras.md §2.5, metrics.ts:83-90 and 349-356 rows — both **A-READ-GAP** verdicts, exclude `admin.read` via exact-match `rolePerms.includes("server.read")`) |
| **Covered before this sweep** | **273 / 296** |
| Gaps closed in §2 below | **23** |
| **Total covered** | **296 / 296 — 0 unjustified-uncovered** |

### Full operation → coverage mapping (296 ops)

```
DELETE /api/admin/auth-lockouts/{lockoutId} | admin-system.md
DELETE /api/admin/database-hosts/{hostId} | GAP→coverage.md §2
DELETE /api/admin/ip-pools/{poolId} | GAP→coverage.md §2
DELETE /api/admin/users/{userId}/accounts/{accountId} | admin-people.md
DELETE /api/admin/users/{userId}/passkeys | admin-people.md
DELETE /api/admin/users/{userId}/two-factor | admin-people.md
DELETE /api/alert-rules/{ruleId} | GAP→coverage.md §2
DELETE /api/auth/profile/avatar | admin-people.md
DELETE /api/locations/{locationId} | infra.md
DELETE /api/nests/{nestId} | infra.md
DELETE /api/nodes/assign-wildcard/{targetType}/{targetId} | infra.md
DELETE /api/nodes/{nodeId} | infra.md
DELETE /api/nodes/{nodeId}/allocations/{allocationId} | infra.md
DELETE /api/nodes/{nodeId}/assignments/{assignmentId} | infra.md
DELETE /api/plugins/marketplace/sources/{id} | plugins.md
DELETE /api/roles/{roleId} | admin-people.md
DELETE /api/roles/{roleId}/permissions/* | admin-people.md
DELETE /api/roles/{roleId}/users/{userId} | admin-people.md
DELETE /api/servers/bulk | server-core.md
DELETE /api/servers/{serverId} | server-core.md
DELETE /api/servers/{serverId}/access/{targetUserId} | server-extras.md
DELETE /api/servers/{serverId}/allocations/{containerPort} | server-power.md
DELETE /api/servers/{serverId}/backups/{backupId} | server-files.md
DELETE /api/servers/{serverId}/databases/{databaseId} | server-files.md
DELETE /api/servers/{serverId}/files/delete | server-files.md
DELETE /api/servers/{serverId}/invites/{inviteId} | server-extras.md
DELETE /api/servers/{serverId}/tasks/{taskId} | server-extras.md
DELETE /api/templates/{templateId} | infra.md
GET /api/admin/api-keys | admin-people.md
GET /api/admin/api-keys/my-permissions | admin-people §2.4 (row "GET …/my-permissions")
GET /api/admin/api-keys/permissions-catalog | admin-people §2.4 (row "GET …/permissions-catalog")
GET /api/admin/audit-logs | admin-people.md,admin-system.md
GET /api/admin/audit-logs/export | admin-people.md,admin-system.md
GET /api/admin/auth-lockouts | admin-system.md
GET /api/admin/database-hosts | GAP→coverage.md §2
GET /api/admin/database-hosts/{hostId}/ping | GAP→coverage.md §2
GET /api/admin/db-status | admin-system.md
GET /api/admin/diagnostics/export | admin-system.md
GET /api/admin/events | realtime.md
GET /api/admin/health | admin-system.md
GET /api/admin/ip-pools | GAP→coverage.md §2
GET /api/admin/localization-settings | admin-system.md
GET /api/admin/mcp-settings | admin-system.md
GET /api/admin/migration | admin-system.md
GET /api/admin/migration/catalyst-nodes | admin-system.md
GET /api/admin/migration/{jobId} | admin-system.md
GET /api/admin/migration/{jobId}/steps | admin-system.md
GET /api/admin/mod-manager | admin-system.md
GET /api/admin/nodes | GAP→coverage.md §2
GET /api/admin/oidc-config | admin-system.md
GET /api/admin/roles | admin-people.md,admin-system.md
GET /api/admin/security-settings | admin-system.md
GET /api/admin/servers | GAP→coverage.md §2
GET /api/admin/settings/file-tunnel-upload-limit | admin-system.md
GET /api/admin/smtp | admin-system.md
GET /api/admin/stats | admin-system.md
GET /api/admin/system-errors | admin-system.md
GET /api/admin/system-errors/export | admin-system.md
GET /api/admin/theme-settings | admin-system.md
GET /api/admin/update/settings | admin-system.md
GET /api/admin/update/state | admin-system.md
GET /api/admin/update/status | admin-system.md
GET /api/admin/users | admin-people.md
GET /api/admin/users/{userId}/servers | admin-people.md
GET /api/alert-rules | GAP→coverage.md §2
GET /api/alert-rules/{ruleId} | GAP→coverage.md §2
GET /api/alerts | GAP→coverage.md §2
GET /api/alerts/stats | GAP→coverage.md §2
GET /api/alerts/{alertId} | GAP→coverage.md §2
GET /api/alerts/{alertId}/deliveries | GAP→coverage.md §2
GET /api/auth/me | admin-people.md
GET /api/auth/profile | admin-people.md
GET /api/auth/profile/api-keys | admin-people.md
GET /api/auth/profile/audit-log | admin-people.md
GET /api/auth/profile/export | admin-people.md
GET /api/dashboard/activity | admin-system.md
GET /api/dashboard/resources | admin-system.md
GET /api/dashboard/stats | admin-system.md
GET /api/internal/file-tunnel/poll | server-files.md
GET /api/internal/file-tunnel/upload/{requestId} | server-files.md
GET /api/locations | infra.md
GET /api/locations/{locationId} | infra.md
GET /api/nests | infra.md
GET /api/nests/{nestId} | infra.md
GET /api/nodes | infra.md
GET /api/nodes/accessible | infra.md
GET /api/nodes/{nodeId} | infra.md
GET /api/nodes/{nodeId}/agent/config | infra.md
GET /api/nodes/{nodeId}/agent/logs | infra.md
GET /api/nodes/{nodeId}/agent/logs/stream | infra.md
GET /api/nodes/{nodeId}/agent/status | infra.md
GET /api/nodes/{nodeId}/agent/update-status | infra.md
GET /api/nodes/{nodeId}/allocations | infra.md
GET /api/nodes/{nodeId}/api-key | infra.md
GET /api/nodes/{nodeId}/assignments | infra.md
GET /api/nodes/{nodeId}/ip-availability | infra.md
GET /api/nodes/{nodeId}/ip-pools | infra.md
GET /api/nodes/{nodeId}/metrics | infra.md,server-extras.md
GET /api/nodes/{nodeId}/stats | infra.md
GET /api/nodes/{nodeId}/unregistered-containers | infra.md
GET /api/nodes/{nodeId}/unregistered-containers/{containerId}/suggest-template | infra.md
GET /api/plugins | plugins.md
GET /api/plugins/marketplace | plugins.md
GET /api/plugins/marketplace/sources | plugins.md
GET /api/plugins/{name} | plugins.md
GET /api/plugins/{name}/frontend-manifest | plugins.md
GET /api/providers/status | admin-system.md,server-extras.md
GET /api/roles | admin-people.md
GET /api/roles/presets | admin-people.md
GET /api/roles/users/{userId}/nodes | admin-people.md
GET /api/roles/users/{userId}/roles | admin-people.md
GET /api/roles/{roleId} | admin-people.md
GET /api/roles/{roleId}/nodes | admin-people.md
GET /api/servers | server-core.md
GET /api/servers/database-hosts | server-files.md
GET /api/servers/invites/{token} | server-extras.md
GET /api/servers/{serverId} | server-core.md
GET /api/servers/{serverId}/activity | server-core.md
GET /api/servers/{serverId}/allocations | server-power.md
GET /api/servers/{serverId}/backups | server-files.md
GET /api/servers/{serverId}/backups/{backupId} | server-files.md
GET /api/servers/{serverId}/backups/{backupId}/download | server-files.md
GET /api/servers/{serverId}/cs2/frameworks | server-extras.md
GET /api/servers/{serverId}/cs2/frameworks/{frameworkId}/releases | server-extras.md
GET /api/servers/{serverId}/cs2/plugins | server-extras.md
GET /api/servers/{serverId}/databases | server-files.md
GET /api/servers/{serverId}/files | server-files.md
GET /api/servers/{serverId}/files/download | server-files.md
GET /api/servers/{serverId}/invites | server-extras.md
GET /api/servers/{serverId}/logs | server-files.md
GET /api/servers/{serverId}/metrics | server-extras §2.5 (metrics.ts:83-90 row)
GET /api/servers/{serverId}/mod-manager/game-versions | server-extras.md
GET /api/servers/{serverId}/mod-manager/installed | server-extras.md
GET /api/servers/{serverId}/mod-manager/search | server-extras.md
GET /api/servers/{serverId}/mod-manager/versions | server-extras.md
GET /api/servers/{serverId}/permissions | server-extras.md
GET /api/servers/{serverId}/plugin-manager/game-versions | server-extras.md
GET /api/servers/{serverId}/plugin-manager/installed | server-extras.md
GET /api/servers/{serverId}/plugin-manager/search | server-extras.md
GET /api/servers/{serverId}/plugin-manager/versions | server-extras.md
GET /api/servers/{serverId}/stats | server-extras §2.5 (metrics.ts:349-356 row)
GET /api/servers/{serverId}/stats/history | server-core.md
GET /api/servers/{serverId}/tasks | server-extras.md
GET /api/servers/{serverId}/tasks/{taskId} | server-extras.md
GET /api/servers/{serverId}/transfer-candidates | server-power.md
GET /api/servers/{serverId}/variables | server-core.md
GET /api/settings/locale | admin-system.md
GET /api/setup/environment | admin-system.md
GET /api/setup/status | admin-system.md
GET /api/templates | infra.md
GET /api/templates/{templateId} | infra.md
PATCH /api/admin/oidc-config | admin-system.md
PATCH /api/admin/theme-settings | admin-system.md
PATCH /api/auth/profile | admin-people.md
PATCH /api/auth/profile/preferences | admin-people.md
PATCH /api/nodes/auto-update | infra.md
PATCH /api/nodes/{nodeId}/allocations/{allocationId} | infra.md
PATCH /api/plugins/marketplace/sources/{id} | plugins.md
PATCH /api/servers/{id}/backup-settings | server-power.md
PATCH /api/servers/{id}/restart-policy | server-power.md
PATCH /api/servers/{serverId}/variables | server-core.md
POST /api/admin/api-keys | admin-people.md
POST /api/admin/database-hosts | GAP→coverage.md §2
POST /api/admin/ip-pools | GAP→coverage.md §2
POST /api/admin/migration/start | admin-system.md
POST /api/admin/migration/test | admin-system.md
POST /api/admin/migration/{jobId}/cancel | admin-system.md
POST /api/admin/migration/{jobId}/pause | admin-system.md
POST /api/admin/migration/{jobId}/resume | admin-system.md
POST /api/admin/migration/{jobId}/retry/{stepId} | admin-system.md
POST /api/admin/servers/actions | GAP→coverage.md §2
POST /api/admin/system-errors/resolve-all | admin-system.md
POST /api/admin/system-errors/{id}/resolve | admin-system.md
POST /api/admin/update/check | admin-system.md
POST /api/admin/update/trigger | admin-system.md
POST /api/admin/users | admin-people.md,admin-system.md
POST /api/admin/users/{userId}/ban | admin-people.md
POST /api/admin/users/{userId}/delete | admin-people.md
POST /api/admin/users/{userId}/unban | admin-people.md
POST /api/alert-rules | GAP→coverage.md §2
POST /api/alerts/bulk-resolve | GAP→coverage.md §2
POST /api/alerts/{alertId}/resolve | GAP→coverage.md §2
POST /api/auth/forgot-password | admin-people.md
POST /api/auth/login | admin-people.md
POST /api/auth/profile/avatar | admin-people §2.5 (combined avatar POST/DELETE row)
POST /api/auth/profile/delete | admin-people.md
POST /api/auth/profile/sso/unlink | admin-people.md
POST /api/auth/register | admin-people.md
POST /api/auth/reset-password/validate | admin-people §2.5 (combined forgot/validate row)
POST /api/internal/file-tunnel/response/{requestId} | server-files.md
POST /api/internal/file-tunnel/response/{requestId}/stream | server-files.md
POST /api/locations | infra.md
POST /api/nests | infra.md
POST /api/nodes | infra.md
POST /api/nodes/assign-wildcard | infra.md
POST /api/nodes/{nodeId}/agent/ping | infra.md
POST /api/nodes/{nodeId}/agent/restart | infra.md
POST /api/nodes/{nodeId}/agent/update | infra.md
POST /api/nodes/{nodeId}/allocations | infra.md
POST /api/nodes/{nodeId}/allocations/bulk-delete | infra.md
POST /api/nodes/{nodeId}/api-key | infra.md
POST /api/nodes/{nodeId}/assign | infra.md
POST /api/nodes/{nodeId}/deployment-token | infra.md
POST /api/nodes/{nodeId}/heartbeat | infra.md
POST /api/nodes/{nodeId}/host-network | infra.md
POST /api/nodes/{nodeId}/import-server | infra.md
POST /api/plugins/install | plugins.md
POST /api/plugins/marketplace/sources | plugins.md
POST /api/plugins/{name}/enable | plugins.md
POST /api/plugins/{name}/reload | plugins.md
POST /api/plugins/{name}/uninstall | plugins.md
POST /api/roles | admin-people.md
POST /api/roles/{roleId}/permissions | admin-people.md
POST /api/roles/{roleId}/users/{userId} | admin-people.md
POST /api/servers | server-core.md
POST /api/servers/bulk/status | server-core.md
POST /api/servers/bulk/suspend | server-core.md
POST /api/servers/bulk/unsuspend | server-core.md
POST /api/servers/eula | server-power.md
POST /api/servers/invites/accept | server-extras.md
POST /api/servers/invites/register | server-extras.md
POST /api/servers/{id}/reset-crash-count | server-power.md
POST /api/servers/{id}/transfer | server-power.md
POST /api/servers/{serverId}/access | server-extras.md
POST /api/servers/{serverId}/allocations | server-power.md
POST /api/servers/{serverId}/allocations/primary | server-power.md
POST /api/servers/{serverId}/archive | server-power.md
POST /api/servers/{serverId}/backups | server-files.md
POST /api/servers/{serverId}/backups/{backupId}/restore | server-files.md
POST /api/servers/{serverId}/cancel-install | server-power.md
POST /api/servers/{serverId}/clone | server-core.md
POST /api/servers/{serverId}/clone/preflight | server-core.md
POST /api/servers/{serverId}/clone/{cloneId}/retry | server-core.md
POST /api/servers/{serverId}/cs2/frameworks/{frameworkId}/install | server-extras.md
POST /api/servers/{serverId}/cs2/frameworks/{frameworkId}/uninstall | server-extras.md
POST /api/servers/{serverId}/cs2/plugins/uninstall | server-extras.md
POST /api/servers/{serverId}/databases | server-files.md
POST /api/servers/{serverId}/databases/{databaseId}/rotate | server-files.md
POST /api/servers/{serverId}/files/archive-contents | server-files.md
POST /api/servers/{serverId}/files/compress | server-files.md
POST /api/servers/{serverId}/files/create | server-files.md
POST /api/servers/{serverId}/files/decompress | server-files.md
POST /api/servers/{serverId}/files/permissions | server-files.md
POST /api/servers/{serverId}/files/rename | server-files.md
POST /api/servers/{serverId}/files/upload | server-files.md
POST /api/servers/{serverId}/files/write | server-files.md
POST /api/servers/{serverId}/install | server-power.md
POST /api/servers/{serverId}/invites | server-extras.md
POST /api/servers/{serverId}/invites/{inviteId}/regenerate | server-extras.md
POST /api/servers/{serverId}/kill | server-core.md,server-power.md
POST /api/servers/{serverId}/mod-manager/check-updates | server-extras.md
POST /api/servers/{serverId}/mod-manager/install | server-extras.md
POST /api/servers/{serverId}/mod-manager/uninstall | server-extras.md
POST /api/servers/{serverId}/mod-manager/update | server-extras.md
POST /api/servers/{serverId}/plugin-manager/check-updates | server-extras.md
POST /api/servers/{serverId}/plugin-manager/install | server-extras.md
POST /api/servers/{serverId}/plugin-manager/uninstall | server-extras.md
POST /api/servers/{serverId}/plugin-manager/update | server-extras.md
POST /api/servers/{serverId}/rebuild | server-power.md
POST /api/servers/{serverId}/reinstall | server-power.md
POST /api/servers/{serverId}/restart | server-power.md
POST /api/servers/{serverId}/restore | server-power.md
POST /api/servers/{serverId}/start | server-power.md
POST /api/servers/{serverId}/stop | server-power.md
POST /api/servers/{serverId}/storage/resize | server-core.md,server-power.md
POST /api/servers/{serverId}/suspend | server-power.md
POST /api/servers/{serverId}/tasks | server-extras.md
POST /api/servers/{serverId}/tasks/{taskId}/execute | server-extras.md
POST /api/servers/{serverId}/transfer-ownership | server-core.md,server-power.md
POST /api/servers/{serverId}/unsuspend | server-power.md
POST /api/setup/complete | admin-system.md
POST /api/templates | infra.md
POST /api/templates/import-pterodactyl | infra.md
POST /api/templates/import-pterodactyl-batch | infra.md
PUT /api/admin/database-hosts/{hostId} | GAP→coverage.md §2
PUT /api/admin/ip-pools/{poolId} | GAP→coverage.md §2
PUT /api/admin/localization-settings | admin-system.md
PUT /api/admin/mcp-settings | admin-system.md
PUT /api/admin/mod-manager | admin-system.md
PUT /api/admin/security-settings | admin-system.md
PUT /api/admin/smtp | admin-system.md
PUT /api/admin/update/settings | admin-system.md
PUT /api/admin/users/{userId} | admin-people.md
PUT /api/admin/users/{userId}/enforce-2fa | admin-people.md
PUT /api/admin/users/{userId}/verify-email | admin-people.md
PUT /api/alert-rules/{ruleId} | GAP→coverage.md §2
PUT /api/locations/{locationId} | infra.md
PUT /api/nests/{nestId} | infra.md
PUT /api/nodes/{nodeId} | infra.md
PUT /api/nodes/{nodeId}/agent/config | infra.md
PUT /api/plugins/{name}/config | plugins.md
PUT /api/plugins/{name}/permissions | plugins.md
PUT /api/roles/{roleId} | admin-people.md
PUT /api/servers/{serverId} | server-core.md
PUT /api/servers/{serverId}/tasks/{taskId} | server-extras.md
```

## 2. Mini-audit rows — 23 gaps closed by this sweep

These OpenAPI ops had **no contract-verdict row in any findings file** (admin-system.md Appendix B explicitly deferred the admin.ts server/ipam/db-host areas "for the Lead to route"; alerts.ts was only key-scope-classified by key-scope-matrix.md §3.25). I read the handlers and verdict them here. Verdict codes per team convention; target contract: `admin.read` = read-everything, `admin.write` = everything, `*` = superadmin, others narrowly targeted.

### 2.1 admin.ts — server listing / bulk actions / IPAM / database hosts

| METHOD+PATH | Check (file:line) | R/W | Current check logic | VERDICT | Fix |
|---|---|---|---|---|---|
| GET /api/admin/nodes | admin.ts:1403 (`checkPerm 'node.read'`) | R | `hasGrant` → `node.read` (targeted) / `admin.read` / `admin.write` / `*` all honored; node `secret` omitted (admin.ts:1423) | **OK** | — |
| GET /api/admin/servers | admin.ts:1452 (`checkPerm 'server.read'`) | R | `hasGrant('server.read')` — targeted read perm + admin bits all work; owner emails included in list rows (1530-1537) | **OK** | — |
| POST /api/admin/servers/actions | admin.ts:1574-1582 (action→perm map), 1585 (`checkPerm requiredPerm`), 1593-1598 (API-key scope), 1622-1645 (per-server `decideServerAccess`) | W | per-action map: start/restart→`server.start`, stop/kill→`server.stop`, suspend/unsuspend→`server.suspend`, delete→`server.delete` (hasGrant ✓); API keys re-checked on the key's own scope (1593-1598); per-server `decideServerAccess` for non-admins (owner / row-with-perm / scoped grants / node+`node.update`). **Note (restriction, not leak): the global `checkPerm` gate at 1585 runs first** — an owner or subuser without a *global* role perm is rejected before the per-server owner/row logic can allow them (single-server power routes do allow owner-only); `admin.read` correctly excluded from every write action | **OK** | Optional UX/policy: let owners pass the global gate for their own servers (evaluate `decideServerAccess` before 1585), or document that bulk actions require a global permission |
| GET /api/admin/ip-pools | admin.ts:3215 (`checkPerm 'admin.read'`) | R | `hasGrant('admin.read')`; pools + allocations + server names exposed | **OK** | Note: falls back to admin-level only — no targeted IPAM perm exists (mission flag: "routes that fall back to admin-level grants"). Candidate `ipam.read` if non-admin node managers ever need it |
| POST /api/admin/ip-pools | admin.ts:3287 (`checkPerm 'admin.write'`) | W | `hasGrant('admin.write')`; pool validated via `summarizePool` (3318-3328); agent CNI `create_network` notified (3344-3373) | **OK** | Same admin-level-only note (`ipam.write` candidate) |
| PUT /api/admin/ip-pools/{poolId} | admin.ts:3398 (`checkPerm 'admin.write'`) | W | `hasGrant('admin.write')`; re-validates pool; agent `update_network` (3450-3481) | **OK** | Same |
| DELETE /api/admin/ip-pools/{poolId} | admin.ts:3505 (`checkPerm 'admin.write'`) + in-use guard 3511-3517 | W | `hasGrant('admin.write')`; blocks pools with active allocations; agent `delete_network` (3527-3554) | **OK** | Same |
| GET /api/admin/database-hosts | admin.ts:3578 (`checkPerm 'admin.read'`) | R | `hasGrant('admin.read')`; host `password` omitted (3584) | **OK** | admin-level-only note (`databasehost.read` candidate) |
| POST /api/admin/database-hosts | admin.ts:3599 (`checkPerm 'admin.write'`) | W | `hasGrant('admin.write')` | **OK** | Same |
| PUT /api/admin/database-hosts/{hostId} | admin.ts:3690 (`checkPerm 'admin.write'`) | W | `hasGrant('admin.write')` | **OK** | Same |
| DELETE /api/admin/database-hosts/{hostId} | admin.ts:3794 (`checkPerm 'admin.write'`) + live-databases guard 3799+ | W | `hasGrant('admin.write')`; blocks hosts with live databases | **OK** | Same |
| GET /api/admin/database-hosts/{hostId}/ping | admin.ts:3840 (`checkPerm 'admin.read'`) | R | `hasGrant('admin.read')` — read-only connectivity probe (comment at 3837-3839 documents the choice) | **OK** | — |

**Section verdicts: OK 12 / A-READ-GAP 0 / B-WRITE-LEAK 0 / C-NO-CHECK 0 / D-CATALOG 0 / E-BROAD 0.** All twelve use `checkPerm` (hasGrant) — contract-clean; the only systemic note is the admin-level-only fallback (no targeted perms for IPAM/database-host CRUD).

### 2.2 routes/alerts.ts (prefix /api — alerts + alert-rules)

Context: local `isAdminUser(userId, required)` (alerts.ts:12-23) resolves **DB** permissions via `getUserPermissions` (lib/permissions.ts:307-319) with correct contract semantics (`*`/`admin.write` always; `admin.read` only when `required === 'admin.read'`); `ensureServerAccess` helper (alerts.ts:24-76) grants non-admins via owner / ServerAccess row containing the required perm (48-57) / role holding the exact perm incl. scoped grants (61-65) / node-assignment+`node.update` (68-73). Sessions are contract-correct on all eleven endpoints; the **API-key amplification** (gate resolves the owner's DB perms, never the key's scope) is already tracked as ADMIN-KEY-AMPLIFIED in key-scope-matrix.md §3.25 — cross-referenced per row, not re-verdicted here.

| METHOD+PATH | Check (file:line) | R/W | Current check logic | VERDICT | Fix |
|---|---|---|---|---|---|
| POST /api/alert-rules | alerts.ts:84 (`isAdminUser 'admin.write'`), server-target guard 148-158, global/node guard 168-170 | W | global/node-target rules need `admin.write`; server-target rules need `alert.create` via owner/row/role (148-158); `admin.read` cannot create (comment 13-15) ✓ | **OK** (+ key-scope A, §3.25) | key-scope fix per key-scope-matrix §5 (request-based check) |
| GET /api/alert-rules | alerts.ts:209 (`isAdminUser 'admin.read'`), scope filter 216-218 | R | `admin.read` sees all rules with `?scope=all`; everyone else own-only | **OK** (+ key-scope A) | same |
| GET /api/alert-rules/{ruleId} | alerts.ts:235, 245-247 | R | own rule or `admin.read` | **OK** (+ key-scope A) | same |
| PUT /api/alert-rules/{ruleId} | alerts.ts:259 (`isAdminUser 'admin.write'`), 273-290 | W | own rules or `admin.write`; server-target rules re-check `alert.update` (279-290); global/node rules need admin (276-278) | **OK** (+ key-scope A) | same |
| DELETE /api/alert-rules/{ruleId} | alerts.ts:324 (`isAdminUser 'admin.write'`), 331-348 | W | own rules or `admin.write`; server-target re-check `alert.delete` (337-348) | **OK** (+ key-scope A) | same |
| GET /api/alerts/{alertId}/deliveries | alerts.ts:366, 372-374, 375-386 | R | own alert or `admin.read`; non-admin server alerts need `alert.read` (375-386) | **OK** (+ key-scope A) | same |
| GET /api/alerts | alerts.ts:420, 421-432, 446-448 | R | own alerts or `admin.read` + `?scope=all`; serverId filter needs `alert.read` for non-admins (421-432) | **OK** (+ key-scope A) | same |
| GET /api/alerts/{alertId} | alerts.ts:493, 515-517, 518-529 | R | own alert or `admin.read`; non-admin server alert needs `alert.read` (518-529) | **OK** (+ key-scope A) | same |
| POST /api/alerts/{alertId}/resolve | alerts.ts:541 (`isAdminUser 'admin.write'`), 550-564 | W | own alert or `admin.write`; non-admin server alert needs `alert.update` (553-564) | **OK** (+ key-scope A) | same |
| POST /api/alerts/bulk-resolve | alerts.ts:602 (`isAdminUser 'admin.write'`), 609-633 | W | non-admins restricted to own alerts + per-server `alert.update` (609-633); admins resolve any | **OK** (+ key-scope A) | same |
| GET /api/alerts/stats | alerts.ts:675-676 | R | own stats or `admin.read` + `?scope=all` | **OK** (+ key-scope A) | same |

**Section verdicts: OK 11 / A-READ-GAP 0 / B-WRITE-LEAK 0 / C-NO-CHECK 0 / D-CATALOG 0 / E-BROAD 0** (session-level contract; the API-key amplification is the pre-existing §3.25 finding, not a new leak).

## 3. EXTRA — audited endpoints that do NOT exist in openapi.json

Real, registered, audited routes absent from the spec. Group A is **spec drift** (plain REST that should be exported); Group B is streaming (not expected in a REST spec); Group C is non-HTTP. All are covered by findings files — nothing here is unaudited.

**A. Plain REST routes missing from openapi.json (23):**
| Route (registration cite) | Covered by |
|---|---|
| GET /api/admin/api-keys/{id} (api-keys.ts:210) | admin-people.md §2.4 |
| PATCH /api/admin/api-keys/{id} (api-keys.ts:250) | admin-people.md §2.4 |
| DELETE /api/admin/api-keys/{id} (api-keys.ts:317) | admin-people.md §2.4 |
| GET /api/admin/api-keys/{id}/usage (api-keys.ts:381) | admin-people.md §2.4 (A-READ-GAP verdict) |
| POST /api/servers/{serverId}/console/command (console-stream.ts:151) | realtime.md row 11 (B-WRITE-LEAK) + server-power.md |
| GET /api/permissions/server (server.ts:1696) | admin-people.md §2.5 (OK, auth-only vocabulary) |
| GET/PUT /api/admin/environment, DELETE /api/admin/environment/{key}, POST /api/admin/environment/restart, GET /api/admin/environment/restart-status (envRoutes, server.ts:1092) ×5 | admin-system.md + key-scope-matrix §3.7 |
| GET/POST/DELETE /api/mcp ×3 | plugins.md + key-scope-matrix §3.8 |
| GET /api/sftp/connection-info (server.ts:1512), POST /api/sftp/rotate-token (server.ts:1622), GET /api/sftp/tokens (server.ts:1708), DELETE /api/sftp/tokens (server.ts:1835), DELETE /api/sftp/tokens/{targetUserId} (server.ts:1786), POST /api/agent/sftp/validate-token (server.ts:1387) ×6 | server-files.md |
| GET /api/agent/version (server.ts:1122) | admin-system.md |
| GET /api/update/check (server.ts:1875) | admin-system.md |
| Plugin assets route (1) | plugins.md / key-scope-matrix §3.30 |

**B. SSE streams (4):** GET /api/servers/{serverId}/events + GET /api/servers/all-servers/events + GET /api/servers/{serverId}/console/stream + GET /api/servers/{serverId}/metrics/stream — realtime.md rows 8-12 (note: GET /api/admin/events **is** in the spec).

**C. Non-HTTP surfaces:** WS message types ×7 + fan-out paths ×6 (realtime.md rows 1-7, 14-19); agent control-plane WS 48 op types + SFTP surface (agent-side.md); better-auth auto-mounted endpoints under /api/auth/* beyond the 15 custom auth.ts routes — the `/api/auth/admin/*` channel is audited in admin-people.md §2.5 (B-WRITE-LEAK + D-CATALOG), the self-scoped/unauth remainder is classified N/A in key-scope-matrix §3.29-3.30.

Reconciliation note: key-scope-matrix.md's header counts "309 = 296 + 13 non-OpenAPI" — its 13 (env 5, MCP 3, console stream/command 2, metrics SSE 1, events SSE 1, plugin assets 1) undercounts the true non-spec surface: Group A alone adds 23, Group B 4 (one overlaps their count basis). The **audit union** across all findings files is nonetheless complete (every route above has a covering file); only the openapi.json spec itself and the 309 figure need updating.

## 4. Final counts

- **Total OpenAPI operations audited: 296 / 296** — 273 covered by the nine endpoint-verdict findings files as landed, **23 gaps closed by this sweep** (§2: 12 admin.ts + 11 alerts.ts), **0 still-uncovered**.
- All 23 gap closures verdict **OK** against the target contract (no new A/B/C/D/E findings); cross-cutting notes: IPAM/database-host CRUD has no targeted permission (admin-level fallback), bulk actions require a global permission even for owners, and alerts REST routes carry the pre-existing API-key amplification (key-scope-matrix §3.25).
- Extra audited surface beyond openapi.json: 23 plain REST routes (Group A — recommend re-exporting the spec), 4 SSE streams, WS/agent/better-auth surfaces (Group B/C).
- Grand total audited HTTP endpoints: 296 (spec) + 27 (non-spec) = **323**, plus WS/SSE/agent/better-auth surfaces — every one mapped to a findings file in §1-§3.
