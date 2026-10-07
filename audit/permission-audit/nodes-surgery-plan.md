# nodes.ts Surgery Plan — Wave 2 (plan only, no source changes)

File: `catalyst-backend/src/routes/nodes.ts` (3350 lines, 37 endpoints; 36 `ensurePermission`-gated + 1 agent-key heartbeat). Binding inputs: `TARGET-VOCABULARY.md` (§1 node.update split, §2.4/2.6/2.7/2.11/2.12/2.13, §3 alias window), `infra.md` (endpoint audit), `test-plan.md` (§3.2 matrix rows, §5a tests). Every edit below cites file:line.

Dependencies (other scopes, must land first or in the same wave-2 PR set):
- **Wave 1 catalog** (TARGET §5.1): `node.server_manage`, `node.agent_control` values + `LEGACY_ALIASES` (granted `node.update` satisfies both, TARGET §3) + `READ_PERMISSIONS` (node.read, node.view_stats are read-class) + `isReadPermission` delegation (permissions.ts:130-136 → TARGET §4.2).
- **lib read-mode** (TARGET §2.13): `hasNodeAccess`/`getUserAccessibleNodes` gain `opts?: { read?: boolean }` (permissions.ts:638-752 / :773-903) — admin fast path switches from `isAdminUser(prisma, userId, true)` (:648, :781) to `isAdminUser(prisma, userId, !opts?.read)`. Default stays write-tier so metrics.ts:80-82 and other files' node_manage pairings keep semantics.
- **Shared hierarchy helper** (TARGET §2.14): `assertCanAffectAdminRole` (admin-people scope) — reused by the §2.7 guards below.

---

## 1. The ensurePermission replacement

### 1.1 New helper (replaces nodes.ts:57-66 verbatim)

```ts
import { hasGrant } from "../lib/permissions";

const ensurePermission = (
	request: any,
	reply: FastifyReply,
	requiredPermission: string,
): boolean => {
	const perms: string[] = request.user?.permissions ?? [];
	if (hasGrant(perms, requiredPermission)) return true;
	apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "Insufficient permissions");
	return false;
};

// Read endpoints whose legacy gate was a write-class perm (§0.1 requires
// admin.read to reach every read): admit the read-class sibling too.
const ensureAnyPermission = (
	request: any,
	reply: FastifyReply,
	required: string[],
): boolean => {
	const perms: string[] = request.user?.permissions ?? [];
	if (required.some((p) => hasGrant(perms, p))) return true;
	apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "Insufficient permissions");
	return false;
};
```

Why this shape: `hasGrant` (permissions.ts:143-149) already implements the whole contract — `*` everything, `admin.write` any concrete, `admin.read` any read-class (via `isReadPermission` → READ_PERMISSIONS after wave 1), plus LEGACY_ALIASES (`node.update` satisfies `node.server_manage`/`node.agent_control` during the alias window). Because it consumes `request.user.permissions` (set by the middleware to the **key's** set for scoped API keys, server.ts:494-517), the helper is inherently key-scoped — the ceiling TARGET §2.11 demands for static-perm routes; the global preHandler from key-scope-impl-plan double-enforces it.

### 1.2 Full call-site inventory (all 36 `ensurePermission` sites; "new" = required permission after this plan)

| @ line | Route | Current perm | New perm | Change |
|---|---|---|---|---|
| nodes.ts:276 | PATCH /auto-update | `node.update` | `node.update` | unchanged (autoUpdateEnabled is node metadata/config = the §1 node.update capability); P3: add WRITE-mode hasNodeAccess for non-admins (infra.md fix #10) |
| nodes.ts:357 | POST /api/nodes | `node.create` | `node.create` | unchanged |
| nodes.ts:569 | GET /api/nodes | `node.read` | `node.read` | unchanged — helper swap admits admin.read/admin.write (A/F sweep) |
| nodes.ts:634 | GET /:nodeId | `node.read` | `node.read` | unchanged + hasNodeAccess READ (:639) |
| nodes.ts:672 | POST /:nodeId/deployment-token | `node.create` | **`node.server_manage`** | CHANGED — §2.12: the node-manage path this route authorizes is the server_manage pairing; `node.create` was the wrong verb for an existing-node credential op (infra.md fix #8) |
| nodes.ts:778 | GET /:nodeId/api-key | `node.read` | `node.read` | unchanged |
| nodes.ts:844 | POST /:nodeId/api-key | `node.create` | **`node.server_manage`** | CHANGED — same rationale as :672 |
| nodes.ts:995 | PUT /:nodeId | `node.update` | `node.update` | unchanged — the §1 split keeps node.update = capacity/addresses/metadata, exactly this route's body (:1002-1046) |
| nodes.ts:1140 | GET /:nodeId/stats | `node.view_stats` | `node.view_stats` | unchanged (read-class; admin.read admitted by helper) |
| nodes.ts:1411 | DELETE /:nodeId | `node.delete` | `node.delete` | unchanged |
| nodes.ts:1497 | GET /:nodeId/ip-pools | `node.read` | `node.read` | unchanged |
| nodes.ts:1543 | GET /:nodeId/ip-availability | `node.read` | `node.read` | unchanged |
| nodes.ts:1587 | GET /:nodeId/allocations | `node.manage_allocation` | **any-of [`node.read`, `node.manage_allocation`]** | EXPANDED — §0.1: a read must admit admin.read; `node.manage_allocation` is write-class, so `ensureAnyPermission` admits the read sibling. (No allocation split — TARGET §1 has none; creation/patch/delete keep `node.manage_allocation`.) |
| nodes.ts:1663 | POST /:nodeId/allocations | `node.manage_allocation` | `node.manage_allocation` | unchanged |
| nodes.ts:1731 | PATCH /:nodeId/allocations/:allocationId | `node.manage_allocation` | `node.manage_allocation` | unchanged |
| nodes.ts:1775 | DELETE /:nodeId/allocations/:allocationId | `node.manage_allocation` | `node.manage_allocation` | unchanged |
| nodes.ts:1809 | POST /:nodeId/allocations/bulk-delete | `node.manage_allocation` | `node.manage_allocation` | unchanged |
| nodes.ts:1870 | GET /:nodeId/assignments | `node.assign` | **any-of [`node.read`, `node.assign`]** | EXPANDED — §0.1 read admission, same pattern as :1587 |
| nodes.ts:1904 | POST /:nodeId/assign | `node.assign` | `node.assign` | unchanged — assigner hasNodeAccess (:1924-1931) already correct; ADD self-target + hierarchy guards (§3 below) |
| nodes.ts:2037 | DELETE /:nodeId/assignments/:assignmentId | `node.assign` | `node.assign` | unchanged value — ADD hasNodeAccess WRITE + self-target + hierarchy guards (currently none — infra.md row #21 B-WRITE-LEAK) |
| nodes.ts:2102 | GET /accessible | `node.read` | `node.read` | unchanged (getUserAccessibleNodes → READ mode, :2105) |
| nodes.ts:2146 | GET /:nodeId/unregistered-containers | literal `admin.write` | **`node.read`** | CHANGED — §0.1 (read must admit admin.read; today it's the only thing admin.write-literal admits) + hasNodeAccess READ. TARGET is silent on this route; node.read is the family read perm (infra.md fix #5, §2.6 analogy). |
| nodes.ts:2193 | GET …/:containerId/suggest-template | literal `admin.write` | **`node.read`** | CHANGED — pure computation read, same rationale as :2146 |
| nodes.ts:2324 | POST /:nodeId/import-server | literal `admin.write` | **`server.create` OR node_manage pairing** | CHANGED — §2.4 applied to server creation: `hasGrant(perms,'server.create')` OR (hasNodeAccess && node.server_manage) — sketch in §4 |
| nodes.ts:2512 | POST /assign-wildcard | `node.assign` | `node.assign` | unchanged value — ADD wildcard-scope + self-target + hierarchy guards (§3) |
| nodes.ts:2623 | DELETE /assign-wildcard/:targetType/:targetId | `node.assign` | `node.assign` | unchanged value — ADD same guards |
| nodes.ts:2690 | GET /:nodeId/agent/status | `node.read` | `node.read` | unchanged — ADD hasNodeAccess READ (infra.md row #28: today bare node.read crosses nodes) |
| nodes.ts:2781 | GET /:nodeId/agent/logs | `node.read` | `node.read` | unchanged — ADD hasNodeAccess READ |
| nodes.ts:2824 | GET /:nodeId/agent/logs/stream | `node.read` | `node.read` | unchanged — ADD hasNodeAccess READ |
| nodes.ts:2948 | POST /:nodeId/agent/restart | `node.update` | **`node.agent_control`** | CHANGED (§2.6) + ADD hasNodeAccess WRITE |
| nodes.ts:2995 | POST /:nodeId/agent/update | `node.update` | **`node.agent_control`** | CHANGED (§2.6) + ADD hasNodeAccess WRITE |
| nodes.ts:3075 | GET /:nodeId/agent/update-status | `node.read` | `node.read` | unchanged — ADD hasNodeAccess READ |
| nodes.ts:3129 | POST /:nodeId/agent/ping | `node.read` | `node.read` | unchanged (read-effect POST) — ADD hasNodeAccess READ |
| nodes.ts:3169 | GET /:nodeId/agent/config | `node.read` | `node.read` | unchanged — §2.6 binds "node.read + hasNodeAccess, or admin.read"; ADD hasNodeAccess READ. (Supersedes infra.md fix #7's suggestion to raise the perm — TARGET §2.6 wins.) |
| nodes.ts:3207 | PUT /:nodeId/agent/config | `node.update` | **`node.agent_control`** | CHANGED (§2.6: "rewrite agent config") + ADD hasNodeAccess WRITE |
| nodes.ts:3286 | POST /:nodeId/host-network | `node.update` | **`node.agent_control`** | CHANGED (§2.6: "+ host network") + ADD hasNodeAccess WRITE |

**Totals: 36 call sites keep the new helper; 9 required-permission values change (:672, :844, :2146, :2193, :2324, :2948, :2995, :3207, :3286); 2 gates become any-of read expansions (:1587, :1870); 2 inner node_manage pairing values change (`node.update` → `node.server_manage` at :689 and :863).** 25 sites are pure helper-swap (same required permission, new semantics).

---

## 2. Read-mode admin visibility (permissions.ts:648 / :781 gain read mode — §2.13)

Rule: a node-scoped **read** endpoint passes `{ read: true }` (admin.read admitted via the admin fast path); a **manage/write** endpoint passes nothing (default write-tier: only `*`/admin.write shortcut). Assignment-based access is mode-independent; the mode only decides which admins bypass.

READ-mode call sites (existing): nodes.ts:639 (GET node detail), :785 (GET api-key — replace the isApiKeyAdmin branch, see §5), :1145 (GET stats), :1502 (ip-pools), :1548 (ip-availability), :1592 (GET allocations), :1876 (GET assignments); `getUserAccessibleNodes`: :606 (GET / list, non-admin branch), :2105 (GET /accessible).
READ-mode call sites (new, agent cluster — infra.md rows #28-35): :2690, :2781, :2824, :3075, :3129, :3169 (each gains a `hasNodeAccess(prisma, userId, nodeId, { read: true })` check after the helper).
WRITE-mode call sites (existing): :688 (deployment-token pairing), :862 (api-key pairing), :999 (PUT node), :1415 (DELETE node), :1668/:1739/:1783/:1813 (allocation writes), :1924 (POST assign assigner-scope).
WRITE-mode call sites (new): :2037 (DELETE assignment), :2948/:2995/:3207/:3286 (agent-control), import-server pairing (§4).
`GET /` (:575-578) needs no hasNodeAccess — the `isAdmin` branch becomes `hasGrant(perms, "admin.read")` (hasGrant admits admin.read/admin.write/`*` for a read-class perm), non-admins keep :606.

---

## 3. assign-wildcard + assignment-delete guards (§2.7)

### 3.1 POST /assign-wildcard (nodes.ts:2508-2516, after `ensurePermission` at :2512)

```ts
const actorPerms: string[] = request.user?.permissions ?? [];
const isAdmin = hasGrant(actorPerms, "admin.write");
if (!isAdmin) {
	// A wildcard grant spans every node: "hasNodeAccess scoping" (§2.7)
	// generalizes to wildcard reach — the actor must already see all nodes.
	const reach = await getUserAccessibleNodes(prisma, request.user.userId);
	if (!reach.hasWildcard) {
		return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "Wildcard node reach required");
	}
}
// Self-target guard: granting yourself all-node access is the escalation.
if (targetType === "user" && targetId === request.user.userId) {
	return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "Cannot assign to yourself");
}
// Hierarchy guard (§2.7): cannot affect */admin.write holders unless actor is *.
if (!(await assertCanAffectAssignmentTarget(request, targetType, targetId, reply))) return;
```

`DELETE /assign-wildcard/:targetType/:targetId` (:2619-2627) gets the identical three guards (self-target applies when the removed wildcard's target is the actor).

### 3.2 DELETE /:nodeId/assignments/:assignmentId (nodes.ts:2033-2055)

```ts
if (!ensurePermission(request, reply, "node.assign")) return;
// Scope: mirror POST /assign's assigner check (:1924-1931) — currently missing (infra.md row #21).
if (!(await hasNodeAccess(prisma, request.user.userId, nodeId))) {
	return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "You don't have access to this node");
}
// Self-target: stripping your own access via the admin path is the same escalation.
if (assignment.userId && assignment.userId === request.user.userId) {
	return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "Cannot remove your own assignment");
}
if (!(await assertCanAffectAssignmentTarget(request, assignment.userId ? "user" : "role",
        assignment.userId ?? assignment.roleId ?? "", reply))) return;
```

### 3.3 Shared guard (reuses §2.14's helper; local wrapper if the shared one lands later)

```ts
async function assertCanAffectAssignmentTarget(
	request: any, targetType: "user" | "role", targetId: string, reply: FastifyReply,
): Promise<boolean> {
	const actorPerms: string[] = request.user?.permissions ?? [];
	if (actorPerms.includes("*")) return true;
	const targetPerms = targetType === "user"
		? await resolveUserPermissionsLive(targetId)          // live, not the 30s cache
		: (await prisma.role.findUnique({ where: { id: targetId }, select: { permissions: true } }))?.permissions ?? [];
	if (targetPerms.includes("*") || targetPerms.includes("admin.write")) {
		apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "Cannot modify admin-tier assignments");
		return false;
	}
	return true;
}
```

(POST /assign :1900 already has the assigner-scope guard; add the same self-target + hierarchy guards there for symmetry — target-role-membership check: also block when the actor is a member of a targeted role.)

---

## 4. Agent-control cluster (nodes.ts:2944-3348) and import-server

Per §2.6/§2.12, every agent-control op becomes `node.agent_control` + hasNodeAccess (WRITE tier):

| Route | Gate @ | New code (identical shape ×4) |
|---|---|---|
| POST /:nodeId/agent/restart | :2948 | `if (!ensurePermission(request, reply, "node.agent_control")) return;` then `if (!(await hasNodeAccess(prisma, userId, nodeId))) return 403;` |
| POST /:nodeId/agent/update | :2995 | same |
| PUT /:nodeId/agent/config | :3207 | same |
| POST /:nodeId/host-network | :3286 | same |

Alias window: roles still holding plain `node.update` keep passing via `LEGACY_ALIASES` (hasGrant consults them, TARGET §3) — no dual-check at route level.

`GET /:nodeId/agent/config` (:3169) stays `node.read` per §2.6 and gains `hasNodeAccess(..., { read: true })`. The payload contains security-sensitive keys (comment :3236-3239); TARGET does not mandate redaction — flag for wave-2 review, out of scope here.

The five agent reads (:2690, :2781, :2824, :3075, :3129) and agent/config GET get `hasNodeAccess(..., { read: true })` added (order: helper → access check → node lookup 404).

**deployment-token / api-key inner pairings** (:687-694, :861-868) — rewrite to:

```ts
const rolePerms = await resolveServerPermissions(request.user.userId, "", nodeId); // keeps RoleNodeGrant scoping
const nodeManageAllowed =
	(await hasNodeAccess(prisma, request.user.userId, nodeId)) &&
	(rolePerms.includes("node.server_manage") || rolePerms.includes("*"));
if (!nodeManageAllowed) { …403… }
// Key-scope ceiling for the dynamic decision (§2.11 pattern: decide, then ceiling):
if (!enforceKeyScope(request.user, "node.server_manage")) { …403… }
```

`admin.write` needs no special case (passes the :672/:844 outer gate via hasGrant); the two "admin.write is the documented admin path" comment blocks (:691-694, :865-868) are deleted.

**POST /:nodeId/import-server** (:2324) per §2.4 (server creation = server.create OR node_manage):

```ts
const actorPerms: string[] = request.user?.permissions ?? [];
const viaCreate = hasGrant(actorPerms, "server.create");
let viaNodeManage = false;
if (!viaCreate) {
	const rolePerms = await resolveServerPermissions(request.user.userId, "", nodeId);
	viaNodeManage = (await hasNodeAccess(prisma, request.user.userId, nodeId)) &&
		(rolePerms.includes("node.server_manage") || rolePerms.includes("*"));
}
if (!viaCreate && !viaNodeManage) { …403… }
if (!enforceKeyScope(request.user, viaCreate ? "server.create" : "node.server_manage")) { …403… }
```

---

## 5. A-READ-GAP / F-ADMIN-GAP sweep + dead-code deletion

- **16 reads admit admin.read** (infra.md A-READ-GAP rows): 12 pass purely via the helper (`node.read` ×11: :569, :634, :778, :1497, :1543, :2102, :2690, :2781, :2824, :3075, :3129, :3169 — wait, that is 12 incl. :3169; plus `node.view_stats` :1140); 4 need gate changes (:1587, :1870 any-of; :2146, :2193 → node.read). All 16 then also pass read-mode hasNodeAccess (admin.read admitted by §2.13 read mode).
- **11 writes admit admin.write** (infra.md F-ADMIN-GAP rows: :276, :357, :672, :844, :995, :1411, :1663, :1731, :1775, :1809, :1904) — all via the hasGrant helper regardless of the required value (`admin.write` satisfies any concrete perm).
- **Dead inner special cases deleted** once the outer gate is hasGrant-based:
  - nodes.ts:691-694 and :865-868 — the `rolePerms.includes("admin.write")` special cases + their comments (replaced by the §4 pairing rewrite; admin.write passes :672/:844 directly).
  - nodes.ts:781-784 — `isApiKeyAdmin` raw includes → `hasGrant(perms, "admin.read") || await hasNodeAccess(prisma, userId, nodeId, { read: true })`.
  - nodes.ts:997-1000 and :1413-1416 — `isNodeAdmin` raw includes → `hasGrant(perms, "admin.write") || await hasNodeAccess(prisma, userId, nodeId)`.
  - nodes.ts:574-578 — `isAdmin` raw includes → `hasGrant(perms, "admin.read")`.

## 6. Key-scope classification (request-based vs DB-resolved)

**Inherently key-scoped (request.user.permissions → no extra work beyond the helper):** all 36 `ensurePermission` sites; the converted `isAdmin`/`isNodeAdmin`/`isApiKeyAdmin` branches (:575-578, :781-784, :998, :1414). The middleware guarantees scoped-key perms ⊆ user role perms (server.ts:494-508), so `hasGrant(request perms, X)` is exactly the key ceiling; the global preHandler (key-scope-impl-plan) re-enforces it for static-perm routes.

**DB-resolved — kept but ceiling'd (decide-then-enforce pattern, §2.11 for dynamic routes):**
- `hasNodeAccess` (permissions.ts:638-752; admin fast path via DB `isAdminUser`): safe as a *decision* input because every call site sits behind a request-based outer gate; where the decision authorizes (deployment-token, api-key, import-server), add `enforceKeyScope(request.user, <required>)` after it (§4 sketches). A narrow key of an admin.write user then 403s at the ceiling even though `hasNodeAccess`'s DB path said yes.
- `resolveServerPermissions` (:682-686, :856-860, import-server): must stay DB-resolved — it is the only source of RoleNodeGrant node-scoped `node.server_manage` grants, which the middleware does NOT put into request.user.permissions. Always followed by `enforceKeyScope`.
- `getUserAccessibleNodes` (:606, :2105, :2512 wildcard-scope): DB admin path is fine because the outer `node.read` gate already ceiling'd the key.
- nodes.ts:783-784 (`apiKeyPerms` raw includes — actually request-based already, just raw): converted to hasGrant per §5, gaining alias + admin-bit correctness.

## 7. Ordering + test updates

**Edit order inside nodes.ts (each step compiles and keeps the `*`-harness tests green):**
1. Helper swap only (36 sites keep current perms) + raw-includes→hasGrant (:575-578, :781-784, :998, :1414). Fixes the entire A/F sweep with zero vocabulary change — safe before wave-1 aliases even land.
2. Read-mode flags at the §2 call sites (needs the lib read-mode prerequisite).
3. Vocabulary swaps: 9 required-perm changes + the 2 inner pairings → `node.server_manage`/`node.agent_control` (needs wave-1 LEGACY_ALIASES so existing `node.update` roles keep passing).
4. §3 guards (assign-wildcard, assignment-delete, self-target, hierarchy) — needs `assertCanAffectAssignmentTarget`.
5. Agent-cluster access checks + any-of read gates (:1587, :1870) + unregistered-containers/import-server gates.
6. Dead-code deletion (:691-694, :865-868 special cases and stale comments).
7. P3 (optional, separate PR): auto-update WRITE-mode scoping (:276).

**Test updates:**
- `src/__tests__/nodes-permission-gates.test.ts` (new, from test-plan.md §5a) — persona sweep AR/AW/PU/STAR over all 37 routes; vocab rows updated: agent-control ops keyed on `node.agent_control` (plus an alias-window case: a role holding only `node.update` still passes during the window); deployment-token/api-key keyed on `node.server_manage`; `GET /allocations` + `GET /assignments` admit admin.read; bare `node.read` without assignment denied on the agent cluster; `GET /agent/config` readable by node.read+assignment (§2.6).
- `src/__tests__/security-wave2-regression.test.ts:249-260` (lead cited :261) — the static pin "deployment-token and api-key routes check hasNodeAccess + node.update" must become `node.server_manage`.
- `src/__tests__/node-allocations-bulk-delete.test.ts:208-220` — `[]`→403 still passes; add an admin.write-admitted case (helper now lets it through to the 400 validation).
- `src/__tests__/agent-config-update.test.ts:47` — `'*'` harness unaffected; add a `node.agent_control`-holder positive case and a `node.update`-only alias case.
- `src/__tests__/node-overallocation.test.ts`, `ipv6-support.test.ts`, `startup-command-override.test.ts` — `'*'` harness, unaffected (regression smoke only).
- `audit/permission-audit/test-plan.md` §3.2 matrix rows get expected values updated where this plan changes gates (deployment-token/api-key/agent cluster/unregistered/import-server) — one-line sync, no new rows.
- Cross-file callouts (NOT this file's scope, for the wave-2 board): metrics.ts:405-411 node metrics history gate (test-plan §5a), metrics.ts:80-82 node_manage pairing → `node.server_manage`, and the servers-power routes' node_manage pairings (lib/server-access.ts is the single source after TARGET §4.6).

**Conflicts / supersessions vs TARGET-VOCABULARY (none hard; four judgment calls to confirm):**
1. Superseded by TARGET: infra.md fix #7 wanted `node.update` (or a new read perm) for GET agent/config — §2.6 binds `node.read` + hasNodeAccess → plan follows §2.6.
2. Judgment: deployment-token/api-key outer gate = `node.server_manage` (infra.md said `node.update`; §2.12 moves the *pairing* to server_manage, and the outer gate should match the capability it grants — key minting is the node-manage path).
3. Judgment: unregistered-containers + suggest-template reads → `node.read` (TARGET silent; §0.1 forces admin.read admission and node.read is the family read).
4. Judgment: §2.7 "hasNodeAccess scoping" for the wildcard route interpreted as wildcard-reach (hasWildcard or write-admin) — there is no single node to scope.
5. Required by §0.1 (not a conflict, but a gate-set change): allocations/assignments list reads become any-of with `node.read` because their current write-class perms can never admit admin.read under hasGrant.
