# SFTP Fix Design — Panel-Side Authorization Repair

Design doc only (no source changes). Synthesizes `server-files.md` (SF), `agent-side.md` (AS) findings with the agent-side contract. Target contract: `admin.read` = READ over the entire panel (incl. SFTP file reads); `admin.write` = READ+WRITE; `*` = superadmin; every other permission narrowly targeted. The agent (sftp_server.rs) is kept as-is — it is already the correct granular enforcer.

## 0. The core insight that orders this design

The agent enforces **exactly** `file.read` / `file.write` / `*` per SFTP operation (sftp_server.rs:399-400, applied at every op site: 486-491, 578-580, 640-642, 730, 759, 788, 811, 831, 877, 955, 976, 996, 1017, 1060, 1091) and performs **zero permission inference** (AS A2). Therefore the single highest-leverage fix is the panel's **validate-token derivation**: whatever list the panel returns at auth time is frozen into the session (sftp_server.rs:1220-1232, 1303) and enforced verbatim. Fix the derivation first; the mint gate and key-scope enforcement then close who can *obtain* tokens (SF F2 before F4 — per AS constraint #2/#3).

**Confirmed mapping source:** `getEffectiveServerPermissions(userId, server)` (routes/servers/_helpers.ts:1374-1435) already produces exactly the right per-caller sets, in the agent's vocabulary:

| Caller | `getEffectiveServerPermissions` returns | Code | Agent-visible SFTP capability |
|---|---|---|---|
| Owner | full `ALL_SERVER_PERMISSIONS` (contains `file.read` + `file.write`) | _helpers.ts:1382-1384 | read + write |
| `*` / `admin.write` role | full set | _helpers.ts:1403-1410 | read + write |
| node-assignment + `node.update` | full set | _helpers.ts:1407-1409 | read + write |
| `admin.read` role (non-owner, no row) | read subset = `p.endsWith(".read") || p === "backup.download"` (contains `file.read`, **not** `file.write`) | _helpers.ts:1419-1425 | **read-only** |
| Subuser with ServerAccess row | roleGranted ∪ adminReadSubset ∪ row permissions | _helpers.ts:1427-1432 | exactly the granted subset (e.g. row `[file.write]` → write-only session: agent denies reads per-op) |
| Role-granted server perms, no row | roleGranted ∪ adminReadSubset | _helpers.ts:1434 | the role-granted subset |

This is self-consistent with the target contract: `admin.read` gets SFTP **read** (every read stream), not write; `admin.write`/owner get R+W; subusers get exactly their grants — the agent filters per op, so passing the full effective set is safe and needs no new vocabulary.

## 1. Panel-side changes, in dependency order

### C1 — validate-token derivation (FIRST — closes SF F2 / AS A2; un-breaks owner SFTP, gives admin.read SFTP read)

**File:line → change:**
- `server.ts:1450-1453` — extend the `sftpvServer` select with `ownerId: true` (currently `uuid, suspendedAt, nodeId`); everything downstream needs it.
- `server.ts:1475-1488` — delete the `isAdmin ? ["*"] : serverAccess?.permissions ?? []` derivation (and the `user`/`rolePerms` role query at 1475-1482 feeding it). Replace with:
  ```ts
  const { getEffectiveServerPermissions } = await import("./routes/servers/_helpers.js");
  const permissions = await getEffectiveServerPermissions(
    result.userId,
    { id: result.serverId, ownerId: sftpvServer.ownerId, nodeId: sftpvServer.nodeId },
    serverAccess ? [{ userId: result.userId, permissions: serverAccess.permissions }] : [],
  );
  ```
  The already-fetched `serverAccess` row (server.ts:1441-1444) is passed as the optional `serverAccess` argument so the helper does not re-query it (_helpers.ts:1395-1397 accepts it).
- **Keep unchanged (non-goals):** node binding (server.ts:1457-1463 — statically pinned by sec-m-hardening.test.ts:179-183), suspension check (1464-1469), token/entry validation (1431-1434), response shape `data.permissions` (agent parses it, sftp_server.rs:307-315).

**Closes:** SF F2 (owner → `[]`, owner SFTP functionally broken; `admin.read` → `[]`, SFTP read path dead for read-admins). The stale "up to 1 year" comment at server.ts:1449 can be corrected to "24 h" (sftp-token-manager.ts:68) while in the block.

### C2 — mint/rotate gate + API-key scope (closes SF F4: E-BROAD `server.read` mint + B-WRITE-LEAK key-scope bypass → `["*"]` sessions)

**Mint-gate decision (recommended): gate on effective `file.read`, NOT a new `file.sftp` permission, NOT `file.write`.**

Justification:
- *Self-consistency:* the session's capability is the effective permission set (after C1), so the gate should match the minimum capability a useful session has — read. Callers with only `file.write` (write-only subusers) are rare but legitimate: keep `file.write` in the row filter so they can mint write-only sessions (the agent denies their reads per-op — correct granular behavior).
- *Contract alignment:* `admin.read` must reach every read stream → mint gate `file.read` is read-classified, so `decideServerAccess`'s `admin_read` branch admits read-admins (server-access.ts:53-59 with `isReadPermission("file.read")` = true, permissions.ts:130-136), and C1 gives them read-only sessions. `admin.write`/owner pass everywhere.
- *No churn:* a new `file.sftp` permission would need PERMISSION_CATEGORIES + ALL_SERVER_PERMISSIONS registration, frontend checklist, i18n labels, and would break every existing subuser's SFTP until re-granted — a migration for a gate that effective-perms already express. `file.sftp` remains an optional follow-up only if operators want SFTP to be *separately* consent-grantable from HTTP file access (see §5).
- *What the gate change actually fixes:* today `requiredPermission: "server.read"` (server.ts:1564, 1672) lets any global `server.read` role mint tokens for every server (E-BROAD) — the mint response also leaks node SFTP host/port (server.ts:1570-1594). Tightening to `file.read` means the role_permission branch (server-access.ts:60-62) requires an actual `file.read` grant.

**File:line → change:**
- `server.ts:1543-1547` (connection-info `sftpHasFileAccess`) — drop `'server.read'` from the row filter: keep `file.read` / `file.write` only.
- `server.ts:1559-1565` — change `requiredPermission: "server.read"` → `"file.read"` in the `sftpDecision`.
- `server.ts:1566-1568` — after the decision, add the key-scope check: `if (!enforceKeyScope(request.user, "file.read")) return reply.status(403)...` (reuse `_helpers.ts:487-493`; `request.user` carries `apiKeyId` + key-scoped `permissions` for API-key requests, server.ts:494-516). This closes the K1-style bypass where a narrow-scoped key of an `admin.write` user minted a token that validated to `["*"]` (the derivation came from USER roles; with C1 + this check, a key without `file.read`-satisfying scope cannot mint at all — and `generateSftpToken` is reachable only via mint/rotate, server.ts:1598/1678, so there is no other token source).
- `server.ts:1651-1655, 1667-1673` (rotate-token) — identical three changes (row filter, `requiredPermission`, `enforceKeyScope`).
- `lib/validation.ts:227` — the `file.sftp` mention is a phantom-permission comment example (D-CATALOG per plugins.md V1/V2); since Option A needs no new permission, delete the misleading example or replace it with a real one.

### C3 — token listing gate (closes SF F5 / A-READ-GAP: admin.read cannot list SFTP tokens)

- `server.ts:1744-1749` — pass `requiredPermission: "file.read"` to `decideSftpTokenAccess` so the `admin_read` branch is reachable (today the call omits `requiredPermission`, making the branch dead — server-access.ts:53-59 requires it).
- Adjacent (recommended while touching this block, closes SF F8): `services/sftp-token-manager.ts:332-368` — `listSftpTokensForServer`'s third parameter (`isOwner`, unused in the body) causes the route's `canManageTokens` (server.ts:1753-1757) to be dead: any caller passing the decision sees all users' token metadata. Either filter non-manager callers to their own entries or delete the parameter and correct the route comment (server.ts:1706).

### C4 — documentation of residual semantics (ships with C1-C3; no code)

Document in the SFTP docs: token revocation blocks **new** connections immediately (revoked tokens are deleted from the cache, so `validateSftpToken` fails — sftp-token-manager.ts:249-294; revocation is already wired at every demotion/removal/ban site: auth.ts:857, admin.ts:793, 1029, invites.ts:739, brute-force.ts:427-428); **live sessions persist until the client disconnects** (AS A1: snapshot at sftp_server.rs:1220-1232; no agent revalidation). TTL bounds *stolen-token replay and new connections* (default 15 min, max 24 h — sftp-token-manager.ts:62-68, 71-78), not live-session lifetime. Operational guidance: prefer short TTL options (5–30 min) for shared/less-trusted contexts.

**Change count: 3 code changes (C1, C2, C3) + 1 doc/cleanup item (C4). Zero Rust changes required to close the audited findings.**

## 2. Session revocation design

**Constraint (AS A1):** permissions are frozen at session open; `revalidateSftpSession` (sftp-token-manager.ts:186-214) is documented ("Agents call this on session heartbeat; a false return must kill the session", 184-185) but called only from a test (sec-m-hardening.test.ts:136). No agent heartbeat exists.

### 2a. Now (panel-only interim — acceptable per assignment)

- Ship C1-C3. Revocation semantics after the fix: **new connections blocked immediately** at every lifecycle trigger (the panel already calls `revokeSftpTokensForUser`/`ForServer` on user removal from a server, role demotion, ban, brute-force lock — cites above); **existing sessions keep their snapshot until disconnect**. Residual risk window = session lifetime; mitigations: short-TTL guidance (C4) and the panel-side SFTP session listing (GET /api/sftp/tokens) so operators can *see* live tokens (metadata incl. expiry) — detection, not enforcement.
- Be precise in docs: lowering `MAX_TTL_MS` does **not** bound live sessions (the agent never re-checks); it bounds stolen-token usability and reconnection. Do not claim "revoke takes effect immediately" for live sessions.

### 2b. Follow-up (needs Rust — one addition, no new panel endpoints)

**Recommended mechanism: agent-side session heartbeat that re-POSTs the existing validate-token endpoint.**

- The panel endpoint already re-runs every check the heartbeat needs: token validity/expiry/ban/lock (sftp-token-manager.ts:249-294), suspension (server.ts:1464-1469), node binding (1457-1463), and — after C1 — the fresh effective-permission derivation. A `valid: false` response is a complete kill signal.
- Rust change sketch (catalyst-agent/src/sftp_server.rs): in `subsystem_request` (1258-1316), after starting `russh_sftp::server::run`, spawn a per-session task that every 60 s (`SFTP_HEARTBEAT_REVALIDATE_MS` already defined, backend sftp-token-manager.ts:154) calls `validate_sftp_token(&self.config, password, server_id)` (259-318) with the retained raw token, and on `Ok(None)`/`Err` closes the channel/session. `SshSession` must retain the raw `password` for revalidation (currently dropped after auth, 1209-1231). This also naturally enforces mid-session TTL expiry and mid-session suspension.
- Alternative considered and rejected as primary: a panel→agent push (`gateway.sendToAgent(nodeId, { type: "sftp_revoke", serverId, userId })`, new dispatch arm in mod.rs:1969-3271 + a session registry in the SFTP server). More new surface on both sides; the heartbeat reuses an existing, already-authenticated endpoint (agent → panel with `X-Node-Id`/`X-Node-Api-Key`, sftp_server.rs:269-270) and matches the documented contract. The push remains an option if immediate (sub-second) revocation is ever required.
- `revalidateSftpSession` stays the pure panel-side helper powering any future HTTP heartbeat variant; the existing unit test (sec-m-hardening.test.ts:127-139, fails-closed on ban) already pins its contract.

## 3. Test plan

**Existing tests that pin SFTP behavior (must stay green):**
- `sec-m-hardening.test.ts:115-125` — TTL defaults/clamps (`resolveSftpTtl` 15 min default, 24 h max, options ≤ 24 h). Unaffected by C1-C3.
- `sec-m-hardening.test.ts:127-139` — `revalidateSftpSession` fails closed on ban + `sftp_` prefix. Unaffected; becomes the C4-follow-up contract.
- `sec-m-hardening.test.ts:179-183` (SEC-M-01, static) — asserts `server.ts` contains `"sftpvServer.nodeId !== headerNodeId"` and `"SFTP validate-token node mismatch"`. **C1 must not alter those lines** (they are non-goals; the edit is confined to the select at 1450-1453 and the derivation at 1475-1488).
- `gateway-sftp-files-changed.test.ts:76+` — SFTP mutation → `server_files_changed` routing. Panel-permission changes don't touch the event path.

**New tests (backend, `src/__tests__/`):**
1. `validate-token derivation matrix` — for each caller class, assert the `data.permissions` array: owner → contains `file.read` AND `file.write` (closes SF F2 owner bug); `admin.read` role → contains `file.read`, NOT `file.write`; `admin.write` role / `*` → both; subuser ServerAccess row `[file.read]` → `file.read` present, `file.write` absent; row `[file.write]` → write-only. (Hits the dev DB per repo test conventions; agent-auth headers as in existing integration style.)
2. `mint gate` — role holding only `server.read` (no `file.read`) → 403 on GET /api/sftp/connection-info (pins the E-BROAD fix; currently 200); `admin.read` → 200 with token; owner → 200.
3. `mint key-scope` — API key scoped to `[server.read]` belonging to an `admin.write` user → 403 on connection-info and rotate-token (pins the K1/B-WRITE-LEAK fix; currently mints a `["*"]`-validating token).
4. `rotate gate` — same matrix as (2)/(3) for POST /api/sftp/rotate-token.
5. `token listing` — `admin.read` user (non-owner, no ServerAccess row) → 200 on GET /api/sftp/tokens (pins C3; currently 403 — SF A-READ-GAP).
6. `SEC-M-style static contract` (optional, mirrors sec-m-hardening.test.ts:168-183): `server.ts` no longer contains `requiredPermission: "server.read"` within the SFTP blocks and the validate handler references `getEffectiveServerPermissions`.
7. *If/when the Rust follow-up lands:* agent-side test that a session is closed when `validate_sftp_token` returns `Ok(None)` (factor the kill logic so it is callable with a stubbed validator), plus a panel test that a revoked token yields `valid: false` from `/api/agent/sftp/validate-token` (covers revoke → heartbeat kill end-to-end at the contract level).

## 4. Explicit non-goals

- **Agent path scoping — do not touch.** The jail is solid and permission-independent: canonical-base resolution (file_manager.rs:564-668), traversal-style server-id rejection (64-80, test at 2065), ancestor-symlink revalidation (82-128), `O_NOFOLLOW` read/write/probe (49-62; sftp_server.rs:504-510, 588-594, 664-691), chmod clamping (file_manager.rs:1135-1157).
- **Token prefix and format contract stays:** `sftp_<64 hex>` (sftp-token-manager.ts:119); the agent rejects non-`sftp_` passwords outright (sftp_server.rs:1212-1218).
- **`serverUuid` return contract stays:** the agent keys the file jail on the panel-attested UUID, not the client username (sftp_server.rs:1229-1231, 1297-1303).
- **Cross-node binding stays:** server.ts:1457-1463 (statically pinned by sec-m-hardening.test.ts:179-183) — a node-B agent cannot validate a node-A token.
- **Agent per-op vocabulary and enforcement stays:** sftp_server.rs:399-400 and its 14 call sites are the correct granular enforcer; no agent change is part of closing the audited findings.
- **WS transport / handshake security** (mod.rs:143-187, 1899-1947) — out of scope; unchanged.
- **Mint of toothless tokens is not "fixed" by the agent:** after C1, a token minted by a caller without `file.read` yields a deny-all session by construction — that is safe; C2 additionally stops the mint and the node host/port disclosure.

## 5. Deferred / optional follow-ups (out of this fix)

- `file.sftp` as an explicit, separately-grantable panel permission (mint-gate-only consent surface for SFTP distinct from HTTP file access). Only if operators ask; requires PERMISSION_CATEGORIES + ALL_SERVER_PERMISSIONS registration, i18n, and a grant-migration story. Until then, remove the phantom reference at lib/validation.ts:227 (in C2).
- Rust session heartbeat (§2b) — the only change that makes revocation kill live sessions and enforces mid-session TTL/suspension.
- Honoring `canManageTokens` in `listSftpTokensForServer` (C3-adjacent, included) and the node-manage inconsistency on DELETE /api/sftp/tokens (SF notes) — cosmetic alignment, not security.
