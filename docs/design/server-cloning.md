# Server Cloning — Design & Implementation Plan

Status: **implemented** (Phases 1–5 shipped; see §16 implementation notes) · Owner: TBD · Target: next minor (`feat:`)

Related: `docs/design/deck-identity.md`, node transfer (`admin-ops.ts` `/:id/transfer`), install flow (`power.ts` `/:serverId/install`).

---

## 1. Summary

A user must be able to duplicate one of their game servers, either onto the **same node** or onto **another node**. Two cloning modes are required:

| Mode | What it copies | Files | Install |
|------|----------------|-------|---------|
| **Full clone** | Panel configuration **+ the entire server data directory** | copied | not run (files already present) |
| **Configuration clone** | Panel configuration **only** | not copied | fresh install runs from the template |

When the target is a **different node**, the user must explicitly review and confirm every **node-specific** value that will be re-resolved (allocation, IP, port, location, data dir, connection endpoint, resource headroom) *before* anything is created. That confirmation is a first-class API contract, not a UI-only checkbox.

The panel already ships a partial clone endpoint (`POST /api/servers/:serverId/clone`) and a `CloneServerDialog`. This plan formalises it into the two modes above, fixes the correctness holes in the existing implementation, and adds the cross-node confirmation contract.

### Goals

1. One clone entry point, two explicit modes (`full`, `configuration`), no ambiguous booleans.
2. A preflight/plan endpoint that returns exactly what will change, focused on node-specific values, with hard blockers and warnings.
3. Cross-node clones require an explicit, server-verified confirmation of that change set.
4. Full clone is filesystem-consistent (source stopped) and works same-node and cross-node through one code path.
5. Configuration clone produces a working server: it creates the row **and runs the template install**.
6. Clone operations are durable enough to survive a backend restart (no server stuck in `cloning` forever).
7. Panel list/config view of the clone is complete and consistent (mods, sub-users, scheduled tasks, databases — each explicitly opt-in or opt-out, never silently half-copied).

### Non-goals (explicitly out of scope for v1)

- Copying **backup archives** or the backup catalog. Backups are storage- and node-specific; a full clone copies live server data, not historical backups.
- Copying **database contents**. A configuration clone provisions a *new, empty* database when database cloning is enabled; it never points the clone at the source database. Full clone does not snapshot MySQL/PostgreSQL data (documented limitation).
- Snapshotting a **running** source without stopping it. v1 requires the source to be stopped for a full clone. Incremental/CoW snapshots are a future item.
- Cloning across **panels** (export/import). That is the migration story, not this feature.
- Copying **logs, metrics, crash history, alerts** — always fresh.
- Copying server-level **plugin storage / plugin-created side tables** — plugins own their data and must opt in via the plugin SDK (future item).

---

## 2. Current-state audit

The feature is ~60 % built. This is what exists and what is wrong with it.

### What exists

| Area | Location | Notes |
|------|----------|-------|
| Clone endpoint | `catalyst-backend/src/routes/servers/core.ts:670-1327` | `POST /:serverId/clone`, `serverCloneSchema` validated |
| Validation schema | `catalyst-backend/src/lib/validation.ts:88-105` | `copyFiles` boolean, no `mode` |
| Config copy | same route, `prisma.server.create` at `:986-1009` | copies a subset of columns |
| Same-node file copy | agent `handle_clone_server_files`, `catalyst-agent/src/websocket_handler/mod.rs:3469` | `cp -a`, symlink scan, chown |
| Cross-node file copy | route `:1185-1233` | ad-hoc `prepare_restore_stream` → `relayBackupStream` → `finish_restore_stream` |
| Dialog | `catalyst-frontend/src/components/servers/CloneServerDialog.tsx` | name, node, network mode, allocation, owner, resources, "Copy Files" toggle |
| Types / API | `types/server.ts:192`, `services/api/servers.ts:42` | `CloneServerPayload` with `copyFiles` |
| Status | `ServerState.CLONING` (`shared-types.ts:23`), state machine allows `CLONING → STOPPED/ERROR/INSTALLING` | |
| Progress | `emitServerOperationProgress` (`lib/server-operation-progress.ts`) + SSE `server_operation_progress` | |
| Audit/events | `server.clone` audit, `server_created` broadcast, `webhookService.serverCreated` | |
| MCP tool | `catalyst-backend/src/mcp/tools.ts:241` | `clone_server` |

### Defects and gaps (must fix as part of this work)

1. **Configuration clone never installs.** Route `:1099-1133`: when `copyFiles` is false, the server is created `stopped` and the install command is never sent. The dialog promises "A fresh install will run on the new server" (`cloneServer.warningFreshInstall`). Result: an empty, unusable server. **Highest-severity bug.**
2. **No source-stopped guard for full clone.** `cp -a` runs against a live directory if the source is running, producing an inconsistent copy. Cross-node tar streaming has the same problem.
3. **`locationId` is copied from the source, not derived from the target node.** `:717` uses `body.locationId ?? sourceServer.locationId`. Cross-node clone to a node in another location creates a server whose `locationId` does not match its `node.locationId`. Panel location filters and any location-scoped logic break.
4. **No node-specific confirmation.** The user picks a node in a dropdown; allocations are only fetched when `networkMode === 'host'`; switching node silently clears the allocation with no summary and no acknowledgement. Nothing tells the user that IP, port, data dir, SFTP endpoint and location will change.
5. **Ad-hoc cross-node copy duplicates transfer logic** and skips pieces of it (no `Backup` row, no progress stages between 40 % and 100 %, different error handling). Divergent code paths rot.
6. **Incomplete config copy.** Not copied: `description`, `startupCommand`, `allocatedSwapMb`, `ioWeight`, `restartPolicy`, `maxCrashCount`, `backupStorageMode`, `backupRetentionCount`, `backupRetentionDays`. A clone of a server with a custom startup command silently reverts to the template default.
7. **No disk-space preflight.** `Node` has no disk capacity column; only `MAX_DISK_MB` env is checked on resize (`core.ts:1871`) and it is *not* checked at all on clone. A full clone can fill the target node's disk and take down every server on it.
8. **No idempotency.** `lib/idempotency.ts` documents clone as an intended caller but the route has no idempotency middleware. A double-submit creates two servers and two copies.
9. **No pre-creation blocker detection.** Target node offline, network mode unsupported on the target, no free allocations, template deleted, required template variables missing — all discovered *after* the row is created (and in the offline case, after the row exists and the async copy fails).
10. **No restart durability.** The file copy is a detached async IIFE (`:1167`). If the backend restarts mid-copy, the server stays in `cloning` forever — `gateway.ts:2683` explicitly excludes transitional states from the 30 s sync reconciliation.
11. **No cleanup/cancel.** A failed full clone leaves a half-populated server and a partial directory on the node with no way to retry or remove it from the dialog.
12. **Suspended source not handled.** A suspended server can be cloned into an unsuspended duplicate.
13. **No tests.** No backend test references clone; no agent test for `handle_clone_server_files`.
14. **No docs page.**

---

## 3. Taxonomy — the three buckets

Everything the panel knows about a server falls into exactly one bucket. This taxonomy drives both modes and the confirmation screen.

### Bucket A — Portable panel configuration

Copied by **both** modes. Safe to move between nodes because nothing here is bound to a host.

| Server column | Notes |
|---------------|-------|
| `templateId` | template must still exist and resolve an image |
| `description` | currently dropped |
| `environment` | template defaults ⊕ source env ⊕ request overrides; strip runtime-injected keys |
| `startupCommand` | currently dropped |
| `allocatedMemoryMb`, `allocatedCpuCores`, `allocatedDiskMb` | overridable per clone |
| `allocatedSwapMb`, `ioWeight` | currently dropped |
| `backupAllocationMb`, `databaseAllocation` | quotas |
| `backupStorageMode`, `backupRetentionCount`, `backupRetentionDays` | policy, **not** credentials |
| `restartPolicy`, `maxCrashCount` | currently dropped |
| `networkMode` | portable *value*, but must be supported by the target node → confirmed |
| container-side ports | the keys of `portBindings` (host side is Bucket B) |
| `ownerId` | overridable; requires `user.create` to set another user |

**Deliberately excluded secrets:** `backupS3Config` and `backupSftpConfig` contain third-party credentials. Do **not** copy them by default. Offer an explicit admin-only `copyBackupCredentials: true` that deep-redacts and requires `admin.write`; absent that flag the clone falls back to `backupStorageMode: 'local'`. (Decision D6.)

### Bucket B — Node-specific (re-resolved on every clone, confirmed cross-node)

Never copied verbatim. Re-derived or user-chosen, and surfaced in the preflight change list.

| Item | Source value | Clone value |
|------|--------------|-------------|
| `nodeId` | node A | chosen node (A or B) |
| `locationId` | `node A.locationId` | **derived from chosen node** |
| `primaryIp` | A's IP | new IPAM allocation, or allocation IP, or target node `publicAddress` (host) |
| `primaryPort` | A's port | allocation port; container port preserved otherwise |
| `portBindings` host side | A's host ports | freshly auto-assigned free host ports on target |
| `IpAllocation` row | A's | new row via IPAM or allocation claim |
| `NodeAllocation` row | A's | claimed on target (bridge/host) |
| `containerId`, `containerName` | A's | null (agent assigns on install/start) |
| server data dir | `A.serverDataDir/<uuid>` | `B.serverDataDir/<newUuid>` |
| SFTP endpoint | A hostname + `A.sftpPort` | B hostname + `B.sftpPort` |
| `status` | any | always `stopped` (or `installing` for config clone) |
| `uuid` | A's | new |
| resource headroom | — | target node memory/CPU free capacity |
| agent presence | — | `isOnline`, `agentVersion` |

### Bucket C — Data / runtime (full clone only, or never)

| Item | Full clone | Configuration clone |
|------|-----------|---------------------|
| Server data directory (worlds, plugins, configs, saves) | **copied** | not copied; fresh install |
| `InstalledMod` rows | copied (files come with the directory) | copied **only if** `includeInstalledMods` — files are re-installed by the installer if the template does it, otherwise the rows would lie → default `false` for config, forced `true` for full |
| `ServerAccess` rows (sub-users) | opt-in `includeAccess` (default `true`) | opt-in (default `true`) |
| `ServerRole` / `RoleServerGrant` | opt-in `includeRoleGrants` (default `true`) | same |
| `ScheduledTask` rows | opt-in `includeScheduledTasks` (**default `false`**) | same — two copies of a cron `restart`/`backup` is a foot-gun |
| `ServerDatabase` rows | opt-in `includeDatabases` (**default `false`**); provisions a **new** database | same |
| `ServerAccessInvite` | never (pending invites are not transferable) | never |
| `Backup` rows + archives | never | never |
| `ServerLog`, `ServerMetrics`, `ServerStat`, `Alert` | never | never |
| crash counters, `lastExitCode`, `lastCrashAt`, `suspendedAt/By/Reason` | never — clone starts clean and unsuspended | same |

---

## 4. Mode semantics

### 4.1 Full clone

1. Source must be **stopped** (`stopped` or `crashed`). Any other status is a blocker. The dialog offers "Stop source and continue" when the user holds `server.stop`.
2. Create the server row (Bucket A + resolved Bucket B), `status = cloning`.
3. Copy the data directory through a single unified service (same-node or cross-node), emitting staged progress.
4. On success: `status = stopped`, log "File copy complete", emit completion.
5. On failure: keep the row (so the user can inspect/retry/delete), set `status = stopped`, write an error log, capture a system error, and return a `cloneError` in the server's operation state. Do **not** auto-delete — the user must see it. Add `POST /:serverId/clone/:cloneId/retry` and a delete affordance.
6. Verify: agent reports bytes copied; compare against the source size measured in preflight. A >2 % shortfall is a warning in the log (not a hard failure, since `cp -a` of a live-adjacent tree can legitimately differ if the source changed).

### 4.2 Configuration clone

1. Source may be in any non-transitional status (running is fine — nothing is read from disk).
2. Create the server row with Bucket A config, `status = installing`.
3. Immediately send `install_server` to the target agent using the **same payload builder as `POST /:serverId/install`** (extract `buildInstallPayload(server, node, template)` into `catalyst-backend/src/services/server-install.ts`).
4. Template install runs normally; install script creates files, downloads jars, etc.
5. On install failure, existing install semantics apply (`status = error`, log).

Configuration clone is the "create from a template, but pre-filled with an existing server's config" path — it exists so users don't have to re-enter variables, ports, resources, and startup flags on a fresh deployment.

### 4.3 Mode selection matrix

| Source status | Full clone | Configuration clone |
|---------------|-----------|---------------------|
| `stopped` | allowed | allowed |
| `crashed` | allowed | allowed |
| `running`/`starting`/`stopping` | **blocked** (offer stop) | allowed |
| `installing`/`cloning`/`transferring`/`restoring`/`creating_backup` | **blocked** | **blocked** |
| `suspended` | blocked for non-admin; allowed for `admin.write` with a warning | same |
| `error` | allowed (source files are still valid) | allowed |

---

## 5. Cross-node confirmation contract

This is the core of the request: *"if it is being transferred to another node, we need to have the user confirm everything that is node specific."*

### 5.1 Two-phase API

```
POST /api/servers/:serverId/clone/preflight   → 200 { preflightId, plan }
POST /api/servers/:serverId/clone             → 201 { server }   (requires preflightId when cross-node)
```

The submit call **must not** be reachable without a fresh preflight when `targetNodeId !== sourceServer.nodeId`. A confirmation checkbox in the UI alone would be bypassed by the MCP tool or a raw API call.

### 5.2 Preflight request

```ts
// catalyst-backend/src/lib/validation.ts
export const serverClonePreflightSchema = z.object({
  mode: z.enum(['full', 'configuration']),
  targetNodeId: z.string().min(1),
  networkMode: z.enum(['bridge', 'macvlan', 'host', 'mc-lan-static', 'mc-lan-dynamic']).optional(),
  allocationId: z.string().min(1).optional(),
  ownerId: z.string().min(1).optional(),
  allocatedMemoryMb: z.number().int().min(512).max(131072).optional(),
  allocatedCpuCores: z.number().int().min(1).max(128).optional(),
  allocatedDiskMb: z.number().int().min(1024).max(1048576).optional(),
  includeAccess: z.boolean().default(true),
  includeRoleGrants: z.boolean().default(true),
  includeScheduledTasks: z.boolean().default(false),
  includeDatabases: z.boolean().default(false),
  includeInstalledMods: z.boolean().optional(), // forced true for full, default false for configuration
});
```

### 5.3 Preflight response

```ts
type ClonePlan = {
  preflightId: string;          // opaque, single-use, 10 min TTL
  fingerprint: string;          // sha256 of the resolved node-specific set
  mode: 'full' | 'configuration';
  crossNode: boolean;
  source: {
    id: string; name: string; status: string;
    nodeId: string; nodeName: string; locationId: string; locationName: string;
    templateId: string; templateName: string;
    networkMode: string; primaryIp: string | null; primaryPort: number;
    dataDir: string;                    // node.serverDataDir + '/' + uuid
    dataSizeBytes: number | null;       // agent du -sb, null if unknown/offline
    installedMods: number;
    scheduledTasks: number;
    subUsers: number;
    databases: number;
  };
  target: {
    nodeId: string; nodeName: string; locationId: string; locationName: string;
    isOnline: boolean; agentVersion: string | null;
    serverDataDir: string; sftpPort: number; publicAddress: string;
    supportedNetworkModes: string[];    // modes the target can host
    capacity: {
      memoryFreeMb: number | 'unlimited'; cpuFreeCores: number | 'unlimited';
      diskFreeBytes: number | null;     // agent statvfs, null if offline
    };
  };
  resolved: {                            // exactly what the clone will get
    name: string; nodeId: string; locationId: string;
    networkMode: string; primaryIp: string | null; primaryPort: number;
    portBindings: Record<number, number>;
    allocatedMemoryMb: number; allocatedCpuCores: number; allocatedDiskMb: number;
    ownerId: string;
  };
  changes: Array<{                       // node-specific diff, drives the review step
    field: string; label: string;
    from: string | number | null; to: string | number | null;
    nodeSpecific: boolean;
  }>;
  allocations: {
    required: boolean;                   // true for host + bridge without IPAM pool
    mode: 'ipam' | 'allocation' | 'host-public' | 'none';
    available: Array<{ id: string; ip: string; port: number; alias: string | null }>;
    selected: { id: string; ip: string; port: number } | null;
  };
  requirements: {
    sourceStopped: boolean;              // full clone only
    installWillRun: boolean;             // configuration clone only
    estimatedDurationSec: number | null; // from dataSizeBytes and a throughput constant
  };
  blockers: Array<{ code: string; message: string; field?: string }>;
  warnings: Array<{ code: string; message: string; field?: string }>;
};
```

`changes` is the contract the UI renders. For a same-node clone it still lists port/IP changes (host ports are always fresh) but `nodeSpecific` is `true` only for the genuinely node-bound rows. For a cross-node clone the node, location, data dir, SFTP endpoint and connection address rows are added.

### 5.4 Blockers vs warnings

**Blockers** (submit disabled; each maps to a stable error code):

| Code | Condition |
|------|-----------|
| `CLONE_SOURCE_NOT_STOPPED` | full clone, source not `stopped`/`crashed` |
| `CLONE_SOURCE_TRANSITIONAL` | source in `installing`/`cloning`/`transferring`/`restoring`/`creating_backup` |
| `CLONE_TARGET_NODE_OFFLINE` | full clone to an offline node (config clone also blocked — install needs the agent) |
| `CLONE_NETWORK_MODE_UNSUPPORTED` | requested mode not available on target (e.g. IPAM mode with no `IpPool`) |
| `CLONE_NO_ALLOCATION_AVAILABLE` | host/bridge selected, node has an allocation pool but none free |
| `CLONE_ALLOCATION_NOT_ON_NODE` / `_ALREADY_ASSIGNED` | stale or taken allocation |
| `CLONE_INSUFFICIENT_MEMORY` / `_CPU` | target node lacks capacity (same math as create/transfer) |
| `CLONE_INSUFFICIENT_DISK` | `diskFreeBytes` < `dataSizeBytes * 1.1` (full clone only) |
| `CLONE_TEMPLATE_MISSING` | source template deleted |
| `CLONE_TEMPLATE_IMAGE_UNRESOLVED` | `resolveTemplateImage` returns empty |
| `CLONE_MISSING_TEMPLATE_VARIABLES` | required template var absent from merged environment |
| `CLONE_TARGET_NODE_INACCESSIBLE` | caller lacks node access |
| `CLONE_OWNER_NOT_FOUND` / `CLONE_OWNER_PERMISSION` | `ownerId` invalid or caller lacks `user.create` |
| `CLONE_SOURCE_SUSPENDED` | source suspended and caller is not `admin.write` |

**Warnings** (require `acknowledgedWarnings` to include the code before submit):

| Code | Condition |
|------|-----------|
| `CLONE_SOURCE_ENV_STALE` | source `environment` has keys not declared by the current template — list them |
| `CLONE_SOURCE_ENV_DROPPED` | runtime-injected keys removed (`CATALYST_NETWORK_IP`, `TEMPLATE_IMAGE`) |
| `CLONE_SOURCE_SIZE_UNKNOWN` | agent offline / `du` timed out; disk check skipped |
| `CLONE_DISK_TIGHT` | free disk < 1.5× the source size |
| `CLONE_DATABASES_OMITTED` | source has databases, `includeDatabases` false |
| `CLONE_SCHEDULES_OMITTED` | source has scheduled tasks, `includeScheduledTasks` false |
| `CLONE_BACKUP_CREDENTIALS_DROPPED` | `backupS3Config`/`backupSftpConfig` non-empty and not copied |
| `CLONE_SOURCE_DESCRIPTION_OVERRIDDEN` | name conflicts with an existing server on the target owner (warn, don't block) |
| `CLONE_CROSS_LOCATION` | target node is in a different location than the source |
| `CLONE_MODS_NOT_REINSTALLED` | config clone, `includeInstalledMods` true but template install won't place the files |

### 5.5 Confirmation enforcement (submit)

Submit body:

```ts
export const serverCloneSchema = z.object({
  mode: z.enum(['full', 'configuration']),
  preflightId: z.string().min(1).optional(),   // required when crossNode
  fingerprint: z.string().min(8).optional(),   // echoed; lets us verify without Redis
  acknowledgedWarnings: z.array(z.string()).default([]),
  name: serverNameSchema.optional(),
  nodeId: z.string().min(1).optional(),
  // ... existing fields, copyFiles retained as deprecated
});
```

Verification sequence in the submit handler:

1. Load and re-run the same resolution + validation the preflight used (single shared function, §6.1). Never trust the client's numbers.
2. Recompute the fingerprint over `{ sourceId, sourceUpdatedAt, sourceStatus, targetNodeId, networkMode, allocationId, ownerId, mode, resource overrides, include* }`.
3. If `crossNode`:
   - `preflightId` must be present, single-use, unexpired → else `409 CLONE_PREFLIGHT_REQUIRED` / `CLONE_PREFLIGHT_EXPIRED`.
   - stored fingerprint must equal the recomputed one → else `409 CLONE_PREFLIGHT_STALE` (the UI re-runs preflight automatically on this code).
   - every warning code in the stored plan must appear in `acknowledgedWarnings` → else `400 CLONE_WARNINGS_UNACKNOWLEDGED`.
4. If same-node, preflight is optional (nothing node-specific beyond guaranteed-fresh host ports); we still recompute and hard-validate.
5. Redis holds `clone:preflight:<id>` → `{ userId, plan, fingerprint }`, TTL 600 s. Deleting the key on successful submit enforces single-use. If Redis is unavailable, the route falls back to fingerprint-only verification (client-echoed) and logs a warning — clone must not hard-fail because a cache is down.

**Why a preflightId and not just a boolean:** it makes "the user confirmed *this* change set" enforceable server-side, gives us a natural place to detect stale state (allocation claimed by someone else in the meantime), and reuses the same plan for the UI, the MCP tool and any future plugin.

### 5.6 MCP / plugin surface

`clone_server` in `mcp/tools.ts` gains `mode`, and for cross-node calls the tool description states that preflight must be run first. Add a `clone_preflight` MCP tool returning the plan so agents can inspect blockers before mutating. Both wrap the same service functions the HTTP routes call.

---

## 6. Backend architecture

### 6.1 Extract a clone service

`core.ts` is 2 440 lines; the clone handler is ~650 of them. Move the logic into `catalyst-backend/src/services/server-clone.ts`:

```ts
export type CloneMode = 'full' | 'configuration';

export interface ResolvedCloneInput {
  mode: CloneMode;
  source: ServerWithRelations;
  targetNode: Node;
  resolvedLocationId: string;
  networkMode: string;
  allocationId?: string;
  ownerId: string;
  overrides: ResourceOverrides;
  environment: Record<string, string>;
  include: CloneIncludes;
}

/** Pure-ish: resolves + validates everything without writing. Used by preflight AND submit. */
export async function buildClonePlan(input: RawCloneRequest, ctx: CloneContext): Promise<ClonePlan>;

/** Writes the server row + access/roles/tasks/mods/databases inside one transaction. */
export async function persistClone(plan: ClonePlan, ctx: CloneContext): Promise<Server>;

/** Full clone only: unified file copy (same-node cp -a or cross-node stream). */
export async function copyServerData(plan: ClonePlan, ctx: CloneContext): Promise<{ bytes: number }>;

/** Configuration clone only: shared install payload + send install_server. */
export async function startCloneInstall(serverId: string, ctx: CloneContext): Promise<void>;
```

`buildClonePlan` is the single source of truth. The preflight route returns it; the submit route calls it again and diffs the fingerprint. This removes all duplicated validation.

### 6.2 Fix `locationId`

`resolvedLocationId = targetNode.locationId`, always. Remove `locationId` from the accepted clone body (keep it accepted-and-ignored for one release for API compatibility, or reject with `VALIDATION_ERROR` — prefer **ignore + warn** so existing MCP/plugin callers don't break).

### 6.3 Unified file copy

Extract the transfer pipeline into `catalyst-backend/src/services/server-transfer.ts` (or a new `server-file-stream.ts`) and have **both** node transfer and cross-node full clone call it:

```ts
export async function streamServerData(opts: {
  sourceNodeId: string; targetNodeId: string;
  sourceUuid: string; targetUuid: string;
  serverIdForLogs: string;
  onProgress?: (stage: string, progress: number) => void;
}): Promise<{ bytes: number }>;
```

- Same node → `requestFromAgent(target, { type: 'clone_server_files', ... })` (no relay hop, fastest).
- Different node → `prepare_restore_stream` → `relayBackupStream` → `finish_restore_stream`, with progress callbacks at 25/55/85/100 %.
- The transfer route becomes a thin caller. This kills the divergent copy that exists today (`core.ts:1185-1233`).

### 6.4 Agent changes

Shipped (see §16 for what the live run added on top):

1. **`handle_clone_server_files`** (`websocket_handler/mod.rs`)
   - Clears the target directory before copying so a retry cannot merge into a
     partial copy, and rejects a source/target that resolve to the same path.
   - Returns bytes copied in `clone_files_complete`.
2. **New `clone_preflight` command** — measures the source data directory
   (`{ sourceBytes }`) and the target filesystem's free space
   (`{ targetFreeBytes }`) via `statvfs`; unreadable entries are skipped rather
   than failing the probe. Each node answers only the half it can measure, so
   the panel asks the source node for the size and the target node for free
   space.
3. **New `backup_stream_flow` command** — pauses/resumes an in-flight backup
   stream, gating the tar reader on a `watch` channel. While paused the tar pipe
   fills and tar blocks on write, so the backpressure stays on the source node
   instead of buffering in the panel.
4. **Replay guard keyed on `(requestId, type)`** — the restore protocol
   deliberately reuses one requestId across `prepare_restore_stream` and
   `finish_restore_stream`, so keying on the id alone dropped the finish message
   and every cross-node restore hung. This affected node transfer too.
5. **Storage fallback on mount-restricted nodes** (`storage_manager.rs`) — when
   a loop mount or the migration staging mount fails with a permission error
   (an unprivileged LXC, for example), the agent uses the plain data directory,
   skips migration, and logs that disk quota is not enforced.
6. **IO weight omitted when the cgroup v2 `io` controller is absent**
   (`runtime_manager/image_and_spec.rs`) — otherwise `runc` refuses to create the
   container with `io.weight: no such file or directory`.
7. Rust gates: `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`.

### 6.5 Durability & reconciliation

Phase 1 (required):

- On backend boot, run a reconciliation pass: any server in `cloning` (or `transferring`) whose operation has no live in-process handle and whose `updatedAt` is older than N minutes is moved to `stopped` with a system log "Clone interrupted by panel restart; files may be incomplete. Retry or delete this server." This closes gate #10 cheaply.
- Record `cloneStartedAt` in the operation payload so the reconciler can distinguish "just started on another instance" from "orphaned".

Phase 2 (optional, recommended): add a durable operation table.

```prisma
enum ServerOperationType { install clone transfer }
enum ServerOperationStatus { running succeeded failed cancelled }

model ServerOperation {
  id         String   @id @default(cuid())
  serverId   String
  server     Server   @relation(fields: [serverId], references: [id], onDelete: Cascade)
  type       ServerOperationType
  status     ServerOperationStatus @default(running)
  stage      String?
  progress   Int      @default(0)
  payload    Json     @default("{}")
  error      String?
  startedAt  DateTime @default(now())
  finishedAt DateTime?
  @@index([serverId, startedAt(sort: Desc)])
  @@index([status])
}
```

Migration required in the same change (per `AGENTS.md` → `pnpm --filter catalyst-backend run db:migrate`). This turns progress into a queryable resource, gives `GET /api/servers/:id/operations/latest`, and lets the reconciler be a simple `status = running AND startedAt < now() - interval`.

*Shipped instead:* boot reconciliation only (the table is not in the tree), plus
Redis-backed clone provenance so a failed full-clone copy can be retried without
recreating the server. The table remains a reasonable future improvement.

### 6.5b Relay flow control (cross-node copies)

Cross-node clones and node transfers share one panel-relayed tar stream. The
original relay aborted the transfer when the target's socket buffer exceeded a
fixed 4 MiB, which killed ordinary copies whenever the target lagged. This was
replaced with adaptive flow control (`src/websocket/relay-flow-control.ts`):

1. **Pause/resume around a watermark.** At the high watermark the panel sends
   the source agent `backup_stream_flow { paused: true }`; at the low watermark it
   resumes. The source stops reading tar output, so the backpressure lives on the
   source node instead of panel memory.
2. **The watermark adapts while the copy runs.** Each pause doubles the high
   watermark up to a ceiling, so a persistently slow-but-healthy target is not
   thrashed in a stop/start loop.
3. **A paused stream is re-checked on a timer.** No frames arrive while paused,
   so the drain can only be observed on a timer — without it the transfer wedged
   until the relay timeout (caught in the live validation run).
4. **Abort only on a genuine stall** — no drain at all for the stall window —
   rather than on transient lag.
5. **Graceful degradation.** An agent predating `backup_stream_flow` ignores the
   command; the adaptive ceiling plus stall detector still let the copy finish.

Defaults: low 8 MiB, high 32 MiB, ceiling 256 MiB, stall 90 s, all tunable via
`RELAY_BACKPRESSURE_LOW_BYTES`, `RELAY_BACKPRESSURE_HIGH_BYTES`,
`RELAY_BACKPRESSURE_CEILING_BYTES` and `RELAY_STALL_MS`.

### 6.6 Transaction scope

Keep the server row + access + role grants + installed mods + scheduled tasks + database rows in **one** `prisma.$transaction` (databases may require an external provisioning call — see §6.7). The file copy and the install are **outside** the transaction by definition; the row is the durable handle for them.

The allocation claim must stay a conditional `updateMany({ where: { id, nodeId, serverId: null } })` inside the transaction (already present at `core.ts:1027`) so two concurrent clones cannot claim the same allocation.

### 6.7 Database cloning

When `includeDatabases` is true, for each source `ServerDatabase`:

1. Provision a **new** database + user on the same `DatabaseHost` (reuse the provisioning helper used by `routes/servers/databases.ts`).
2. Insert the new `ServerDatabase` row pointing at it.
3. Never copy the password; generate a new one.
4. If provisioning fails, fail the whole clone transaction (no half-cloned DBs) and surface `CLONE_DATABASE_PROVISION_FAILED` with the offending host name.

Schema-only clone (tables/rows) is a non-goal — document it.

---

## 7. Frontend plan

### 7.1 Entry points

- Keep `CloneServerDialog` but rebuild it as a **two-step wizard** inside the existing `Dialog` shell.
- Add the same action to the server list row menu (admin + owner) so users don't have to open settings first.
- `ServerSettingsTab.tsx` currently renders the dialog — update props if needed.

### 7.2 Step 1 — Mode & target

```
[ Full clone ]  [ Configuration clone ]        ← segmented control, with a one-line explainer each

Full clone:        "Copies the server's files and configuration. The source must be
                    stopped. Best for duplicating a live world or a configured modpack."
Configuration:     "Copies the panel configuration only and runs a fresh install from
                    the template. Best for spinning up a second deployment of the same setup."
```

Then: name, node selector, network mode, allocation (when required), owner (admin), resources, and the include-* toggles (access, role grants, scheduled tasks, databases, installed mods) with default-off markers on the dangerous ones.

### 7.3 Step 2 — Review (the node-specific confirmation)

Triggered by "Review changes → ", which calls `POST .../clone/preflight`. The step renders:

1. **Blockers** (red panel) — submit disabled, each blocker shown with its message. If `CLONE_TARGET_NODE_OFFLINE`, show a "Retry" that re-runs preflight.
2. **Changes table** — field / from → to, node-specific rows visually flagged:

```
Node            Node A                    →  Node B            [node-specific]
Location        EU-West                   →  US-East           [node-specific]
Network mode    host                      →  mc-lan-static     [node-specific]
Public address  play.a.example:25565      →  play.b.example:25611  [node-specific]
Data directory  /var/lib/.../uuid-a       →  /var/lib/.../uuid-c    [node-specific]
SFTP            a.example:2022            →  b.example:2022     [node-specific]
Memory          4096 MB                   →  4096 MB           (unchanged)
```

3. **Warnings** — each needs a checkbox before submit unblocks. Rendered with their translated copy.
4. **Summary line** — mode, estimated size/duration, whether a fresh install will run, whether databases are omitted.
5. **Confirm** button label: "Create server on Node B" (cross-node) or "Clone server" (same node).

If the user goes back and changes anything on step 1, discard the preflight and re-run it on re-entry (fingerprint would change anyway).

### 7.4 Progress & result

- On submit, the dialog closes and navigates to the new server page (existing behaviour).
- The server page already subscribes to `server_operation_progress`; the clone stages (`creating → copying files (x %) → finalizing → complete`) render on the existing progress component. Confirm the component handles the `clone` operation key; add i18n for new stage strings.
- For a full clone, show a persistent banner while `status === 'cloning'`: "Copying files from <source>. This server cannot be started until the copy completes." with a Retry action on failure.

### 7.5 Components & files

| File | Change |
|------|--------|
| `components/servers/CloneServerDialog.tsx` | rebuild as wizard (mode → review) |
| `components/servers/clone/CloneModeStep.tsx` | new |
| `components/servers/clone/CloneReviewStep.tsx` | new — changes table, blockers, warnings |
| `components/servers/clone/CloneChangesTable.tsx` | new |
| `services/api/servers.ts` | `clonePreflight(id, payload)`, `clone(id, payload)` with `mode`/`preflightId` |
| `types/server.ts` | `CloneMode`, `ClonePlan`, `ClonePreflightPayload`, extend `CloneServerPayload` |
| `services/api/server-events.ts` | confirm clone stages handled; add stage label map |
| `utils/logLabels.ts` | clone stage labels |

### 7.6 i18n

All new copy goes through `t()` in the `servers` namespace. Required keys (en, then fr + zh-CN in the same change):

```
cloneServer.mode.full.title / .description
cloneServer.mode.configuration.title / .description
cloneServer.step.review / .back / .confirmSameNode / .confirmCrossNode
cloneServer.changes.title / .field / .from / .to / .nodeSpecific
cloneServer.blockers.title
cloneServer.warnings.title / .acknowledge
cloneServer.installWillRun / .estimatedSize / .estimatedDuration
cloneServer.omitDatabases / .omitSchedules / .includeAccess ...
cloneServer.stage.starting / .copying / .finalizing / .complete / .failed
cloneServer.retry / .cannotStartWhileCloning
cloneServer.errors.* (mapped from stable codes)
```

Add the codes to `catalyst-backend/src/lib/error-codes/servers.ts` and to `catalyst-frontend/src/i18n/api-errors.ts` + `errors.json`. Suggestion: a dedicated `cloneServer.blockers.<CODE>` / `cloneServer.warnings.<CODE>` mapping so every preflight code renders without a fallback to the raw English message.

Run `pnpm --filter catalyst-frontend run i18n:extract` after adding strings; never hand-order keys. `pnpm i18n:check`, `pnpm i18n:hardcoded`, `pnpm --filter catalyst-frontend run i18n:verify` must pass.

---

## 8. Permissions & security

| Action | Requirement |
|--------|-------------|
| See the clone action | access to the source server (`canAccessServer`) |
| Clone (both modes) | `server.create` |
| Clone to a different node | node access (`hasNodeAccess`) **and** `server.create`; recommend also requiring `server.transfer` when the target differs from the source node, mirroring the node-transfer gate (`admin-ops.ts:419-437`) — **decision D3** |
| Set a different owner | `user.create` (existing) |
| `includeDatabases` | `database.create` on the target node/host (or `admin.write`) |
| `copyBackupCredentials` | `admin.write` only |
| Clone a suspended source | `admin.write`; otherwise blocked |
| MCP `clone_server` | inherits API-key permissions; the API-key permission set must include `server.create` |

Additional hardening:

- Never accept client-supplied `templateId` — always the source's template (existing behaviour; keep it).
- Never accept client-supplied `uuid`, `containerId`, `status`.
- `environment` overrides pass through the existing variable-rule validation (range / enum / ReDoS-guarded regex) — already implemented at `core.ts:777-824`, keep it in the shared service.
- Clone payloads can contain secrets (`environment` often holds RCON passwords, API keys). Preflight responses must never echo full environment values; show key names only, and redact values (`secret-redaction.ts` exists — reuse it). Audit log stores key names, not values.
- The preflight plan is stored in Redis keyed by a random UUID and scoped to `userId`; a different user presenting the same `preflightId` gets `403`.
- Database passwords are generated fresh and never copied from the source.

---

## 9. Error codes to add

Add to `catalyst-backend/src/lib/error-codes/servers.ts` (stable codes; frontend translates them):

```
CLONE_SOURCE_NOT_STOPPED
CLONE_SOURCE_TRANSITIONAL
CLONE_SOURCE_SUSPENDED
CLONE_TARGET_NODE_OFFLINE
CLONE_TARGET_NODE_INACCESSIBLE
CLONE_NETWORK_MODE_UNSUPPORTED
CLONE_NO_ALLOCATION_AVAILABLE
CLONE_INSUFFICIENT_DISK
CLONE_TEMPLATE_MISSING            (alias/rename of existing SERVER_CLONE_FAILED path)
CLONE_TEMPLATE_IMAGE_UNRESOLVED
CLONE_MISSING_TEMPLATE_VARIABLES
CLONE_OWNER_NOT_FOUND
CLONE_OWNER_PERMISSION
CLONE_PREFLIGHT_REQUIRED
CLONE_PREFLIGHT_EXPIRED
CLONE_PREFLIGHT_STALE
CLONE_WARNINGS_UNACKNOWLEDGED
CLONE_DATABASE_PROVISION_FAILED
CLONE_FILE_COPY_FAILED
CLONE_INTERRUPTED
```

Reuse existing: `PERMISSION_DENIED`, `SERVER_NOT_FOUND`, `NODE_NOT_FOUND`, `NODE_OFFLINE`, `ALLOCATION_NOT_FOUND`, `ALLOCATION_ALREADY_ASSIGNED`, `INSUFFICIENT_RESOURCES`, `SERVER_VARIABLE_INVALID`, `SERVER_NETWORK_MODE_INVALID`, `SERVER_TEMPLATE_IMAGE_REQUIRED`.

Every `apiError(...)` call must pass `params` for each `{{placeholder}}` in the message (`AGENTS.md` rule).

---

## 10. Observability

- **Audit log** `server.clone` details: `{ mode, sourceServerId, sourceServerName, targetServerId, targetNodeId, sourceNodeId, crossNode, ownerId, allocationId, networkMode, include: {...}, bytesCopied, durationMs }`. No environment values.
- **System log** on the clone: staged lines ("Clone started (full, Node A → Node B)", "Copying files…", "File copy complete").
- **Webhook**: add `webhookService.serverCloned({ source, clone, mode, crossNode }, userId)`. Keep the existing `serverCreated` fire for both modes so current integrations keep working.
- **WS/SSE**: reuse `server_operation_progress` with `operation: 'clone'` and stages defined in `server-operation-progress.ts`. Add a `clone_failed` broadcast carrying the error code so the server page can show Retry without a refetch.
- **System errors**: `captureSystemError({ component: 'CloneFiles' | 'CloneInstall' })` on failure (exists for the copy path).
- **Metrics** (optional Phase 2): counter `catalyst_clone_total{mode,cross_node,outcome}` and histogram of duration/bytes.

---

## 11. Testing plan

Per `AGENTS.md`, backend tests hit the real dev database and clean up their rows.

### Backend (`catalyst-backend/src/__tests__/` or `routes/servers/__tests__/`)

`server-clone.test.ts`:
1. `buildClonePlan` — full clone same node: expects `crossNode: false`, fresh host ports, `locationId === node.locationId`.
2. `buildClonePlan` — cross-node into a different location: `locationId` follows the target node (regression test for defect #3).
3. Blocker: full clone of a `running` source → `CLONE_SOURCE_NOT_STOPPED`.
4. Blocker: configuration clone of a `running` source → allowed, `installWillRun: true`.
5. Blocker: target node offline → `CLONE_TARGET_NODE_OFFLINE`.
6. Blocker: memory/CPU over capacity → `INSUFFICIENT_RESOURCES`.
7. Blocker: IPAM mode with no `IpPool` on target → `CLONE_NETWORK_MODE_UNSUPPORTED`.
8. Warning: stale environment keys → `CLONE_SOURCE_ENV_STALE` with the key names.
9. Submit without `preflightId` cross-node → `409 CLONE_PREFLIGHT_REQUIRED`.
10. Submit with a fingerprint that changed (claim the allocation in between) → `409 CLONE_PREFLIGHT_STALE`.
11. Submit with an unacknowledged warning → `400 CLONE_WARNINGS_UNACKNOWLEDGED`.
12. Configuration clone creates the row, sets `installing`, and sends `install_server` with `SERVER_DIR` and synced port env (mock the gateway, assert the payload).
13. Full clone sets `cloning`, and a mocked agent failure leaves the row `stopped` with an error log and no auto-delete.
14. `includeScheduledTasks: false` → zero `ScheduledTask` rows on the clone; `true` → copied with `lastRunAt`/`runCount`/`lastStatus` reset.
15. `includeDatabases` → new DB provisioned, password differs, rollback on provisioning failure.
16. Permission matrix: no `server.create` → 403; target node not accessible → 403; another user's `ownerId` without `user.create` → 403.
17. Cross-user `preflightId` replay → 403.
18. Idempotency: two identical submits with the same `Idempotency-Key` → one server.
19. Reconciliation: a `cloning` row with an old operation is moved to `stopped` on boot.

### Agent (Rust, `catalyst-agent/src/websocket_handler/`)

- `clone_server_files` clears a pre-existing target dir before copying.
- Path-segment validation rejects `../` and absolute UUIDs.
- Symlink scan removes escaping symlinks (may exist already — extend if not).
- `clone_preflight` returns size + free bytes and times out gracefully.
- Byte count is reported.

### Frontend (Vitest + Testing Library)

- Wizard: mode toggle changes the explainer and the review summary.
- Review step renders blockers and disables submit.
- Warnings require acknowledgement before submit enables.
- Changing a step-1 field discards the preflight and re-runs it.
- Error mapping: `CLONE_PREFLIGHT_STALE` triggers an automatic re-preflight.
- i18n: no hardcoded strings (covered by `i18n:hardcoded`).

### Gates to run before claiming done

```
pnpm --filter catalyst-backend run lint && pnpm --filter catalyst-backend run typecheck && pnpm --filter catalyst-backend run test
pnpm --filter catalyst-frontend run lint && (cd catalyst-frontend && npx tsc --noEmit) && pnpm --filter catalyst-frontend run test
cargo fmt --manifest-path catalyst-agent/Cargo.toml -- --check && cargo clippy --manifest-path catalyst-agent/Cargo.toml -- -D warnings && cargo test --manifest-path catalyst-agent/Cargo.toml
pnpm run build:backend && pnpm run build:frontend
pnpm i18n:check && pnpm i18n:hardcoded && pnpm --filter catalyst-frontend run i18n:verify
```

And verify the flows **in the browser** (sign-in, owner clone, admin cross-node clone) before reporting done.

---

## 12. Phased delivery

> **Historical.** This is the delivery plan as proposed. It is kept for the
> rationale behind the ordering; **§16 is the authoritative record** of what
> shipped and what the live validation changed.

### Phase 0 — Decisions (blocking)

Close §14 decisions D1–D7 before writing code.

### Phase 1 — Correctness fixes (small, high value)

- Derive `locationId` from the target node.
- Trigger install after a configuration clone (shared `buildInstallPayload`).
- Block full clone when the source is not stopped.
- Add the node disk/memory/CPU preflight checks that are cheap (no agent probe yet).
- Fix the dialog copy that promises an install which never ran (with Phase 1 it becomes true).
- Wire idempotency onto the clone route.
- Boot-time reconciliation of orphaned `cloning` servers.
- Tests for each fix.

**Exit:** existing `copyFiles` boolean still works, but now behaves correctly and the panel is honest about it.

### Phase 2 — Modes, preflight and confirmation

- `mode` enum + `copyFiles` back-compat mapping.
- `buildClonePlan` service extraction from `core.ts`.
- `POST .../clone/preflight` + `preflightId`/fingerprint verification.
- New error codes + i18n (en/fr/zh-CN).
- Frontend wizard: mode step, review step, blockers/warnings, changes table.
- MCP `clone_preflight`; `clone_server` gains `mode`.
- Backend tests (plan, blockers, warnings, confirmation enforcement) + frontend tests.

**Exit:** a user can clone same-node in either mode, and a cross-node clone cannot be submitted without an acknowledged, fingerprinted review of the node-specific changes.

### Phase 3 — Full clone hardening

- Extract the shared `streamServerData` service; make node transfer use it too.
- Agent: clear-target-before-copy, byte reporting, `clone_preflight` (size + free space).
- Disk-space blocker + size-based duration estimate.
- Retry/cleanup endpoints and UI actions; `clone_failed` broadcast.
- Cross-node full-clone integration test (agent mock).

**Exit:** full clones are consistent, verified, retryable, and use one copy path shared with transfers.

### Phase 4 — Optional config surfaces

- `includeAccess`, `includeRoleGrants`, `includeScheduledTasks`, `includeDatabases`, `includeInstalledMods` behind feature flags, with the database provisioning path.
- Durable `ServerOperation` table + migration + `GET /operations/latest`.
- Backup-credential copy (admin-only, explicit).
- MCP/plugin SDK exposure of the preflight plan.

### Phase 5 — Docs

- New `catalyst-doc` page "Cloning a server": the two modes, when to use each, what is and isn't copied, the cross-node confirmation, and the stopped-source requirement.
- Update the generated API reference for the two endpoints and the new codes.
- Cross-link from the node-transfer doc.
- If `AGENTS.md` wording needs it, note the shared `streamServerData` service in `docs/architecture.md`.

---

## 13. File-by-file change map

What the implementation actually touched. §16 lists behaviour; this lists files.

**Backend**
- `catalyst-backend/src/services/server-clone.ts` — new: plan, persist, copy,
  install, preflight store, provenance.
- `catalyst-backend/src/services/server-file-stream.ts` — new: shared
  same-node/cross-node data mover; the transfer route delegates to it.
- `catalyst-backend/src/services/server-install.ts` — new: install command
  builder shared by `/install`, `/reinstall` and the configuration clone.
- `catalyst-backend/src/routes/servers/core.ts` — preflight, submit and retry
  routes; `runCloneFileCopy`; `buildCloneAuth`; `probeCloneSizes`.
- `catalyst-backend/src/routes/servers/_helpers.ts` — `findAvailableHostPort`
  moved here; `collectUsedHostPortsByIp` gains `includeHost`.
- `catalyst-backend/src/routes/servers/admin-ops.ts` — transfer uses the shared
  stream service.
- `catalyst-backend/src/routes/servers/power.ts` — install/reinstall use the
  shared payload builder.
- `catalyst-backend/src/lib/validation.ts` — `serverCloneSchema` (+`mode`,
  `preflightId`, `fingerprint`, `acknowledgedWarnings`, include flags),
  `serverClonePreflightSchema`.
- `catalyst-backend/src/lib/error-codes/servers.ts` — clone error codes.
- `catalyst-backend/src/lib/idempotency.ts` — `releaseIdempotency` for failed
  clone submits.
- `catalyst-backend/src/lib/reconcile-operations.ts` — new: boot reconciliation.
- `catalyst-backend/src/services/webhook-service.ts` — `serverCloned`.
- `catalyst-backend/src/websocket/relay-flow-control.ts` — new: adaptive
  watermark decisions.
- `catalyst-backend/src/websocket/gateway.ts` — relay flow control, pause/resume
  commands, drain watcher.
- `catalyst-backend/src/mcp/tools.ts` — `clone_server_preflight`,
  `clone_server` `mode`.
- `catalyst-backend/src/index.ts` — boot reconciliation call.
- `catalyst-backend/src/i18n/locales/{en,fr,zh-CN}/email.json` — not touched;
  clone emails are not planned.

**Agent**
- `catalyst-agent/src/websocket_handler/mod.rs` — `clone_server_files`
  hardening, `clone_preflight`, `backup_stream_flow` dispatch, replay-guard key.
- `catalyst-agent/src/websocket_handler/backup.rs` — flow gate on the backup
  stream producer, `handle_backup_stream_flow`, byte reporting.
- `catalyst-agent/src/storage_manager.rs` — plain-directory fallback for
  mount-restricted nodes.
- `catalyst-agent/src/runtime_manager/image_and_spec.rs` — omit `blockIO` when
  the cgroup `io` controller is absent.

**Frontend**
- `catalyst-frontend/src/components/servers/CloneServerDialog.tsx` — wizard shell.
- `catalyst-frontend/src/components/servers/clone/CloneReviewStep.tsx` — review
  step (changes table, blockers, warning acknowledgement).
- `catalyst-frontend/src/services/api/servers.ts` — `clonePreflight`, `clone`.
- `catalyst-frontend/src/types/server.ts` — `CloneMode`, `ClonePlan`, payloads.
- `catalyst-frontend/src/i18n/locales/{en,fr,zh-CN}/servers.json` — `cloneServer.*`.
- `catalyst-frontend/src/i18n/locales/{en,fr,zh-CN}/errors.json` — clone codes.
- `catalyst-frontend/i18next.config.ts` — preserve clone blocker/warning/change
  label subtrees (runtime lookups).

**Docs**
- `docs/design/server-cloning.md`, `docs/agent.md` (this repo).
- `catalyst-doc`: `users/cloning.mdx`, `admin/nodes/installing.mdx`,
  `admin/requirements.mdx`, `troubleshooting/node.mdx`, regenerated
  `api/openapi.json`.

---

## 14. Decisions & assumptions

> **Resolved.** Every decision below was taken as recommended; §16 records the
> actual choice, including the two that changed during implementation.

These are the gaps I filled. Each needs a yes/no before Phase 1; my recommended default is listed first.

- **D1 — "Full clone" requires the source to be stopped.** Recommended: yes, block otherwise, with a one-click "Stop source and continue" for users holding `server.stop`. Alternative: allow a running source with a loud warning (unsafe, crash-consistent at best). *Assumption: correctness beats convenience.*
- **D2 — Configuration clone runs a real install.** Recommended: yes. This is what makes it useful and what the current UI already claims. Alternative: create the server stopped and let the user press Install (less convenient, more honest than today's silent no-op).
- **D3 — Cross-node clone permission.** Recommended: require `server.create` + target-node access, and additionally `server.transfer` because it moves data to another node. Alternative: `server.create` + node access only.
- **D4 — Default include flags.** Recommended: `includeAccess: true`, `includeRoleGrants: true`, `includeInstalledMods: true (full) / false (config)`, `includeScheduledTasks: false`, `includeDatabases: false`. Rationale: sub-users are configuration; tasks and databases have side effects (double cron, duplicate DB provisioning).
- **D5 — Failed full clone leaves the server row.** Recommended: keep it, `stopped`, with an error and Retry/Delete actions. Alternative: auto-delete on failure. Keeping it preserves evidence and avoids destroying partial data the user may want.
- **D6 — Backup credentials (`backupS3Config`, `backupSftpConfig`).** Recommended: never copied by default; `backupStorageMode` falls back to `local`; a warning explains it. Admin-only opt-in later. Alternative: copy them (leaks third-party secrets to a new owner).
- **D7 — `locationId` in the clone body.** Recommended: ignore it and derive from the target node; drop it from the schema after a deprecation release.
- **D8 — Cross-node confirmation transport.** Recommended: `preflightId` in Redis + client-echoed fingerprint, single-use, 10 min TTL, with a Redis-less fallback. Alternative: stateless HMAC token (no Redis dependency, more secret plumbing).
- **D9 — Durability depth.** Recommended: Phase 1 boot reconciliation, Phase 4 `ServerOperation` table. Alternative: ship the table in Phase 1 (a migration and more surface, but a cleaner end state).
- **D10 — Database contents.** Recommended: never copied; configuration clone provisions an empty database when enabled. Alternative: dump/restore contents (large, engine-specific, needs a maintenance window).

---

## 15. Acceptance criteria (feature complete)

1. A user can clone a server in either mode onto the same node.
2. A user can clone a server in either mode onto another node, and cannot submit until they have seen and acknowledged a server-generated list of every node-specific change.
3. A configuration clone ends up with a running template install and a fully populated panel configuration.
4. A full clone ends up with the source's data and identical panel configuration, with fresh node-specific values.
5. Cross-node clones never reuse the source's IP, host ports, data directory, container identity or location.
6. Failures are visible, logged, and recoverable (retry or delete) — no server is stuck in `cloning`, including across a backend restart.
7. Every new string is translated in en/fr/zh-CN; every new error is a stable, translated code; all CI gates pass.
8. The DB and the node are never left with a half-created clone that the panel cannot explain.

---

## 16. Implementation notes

What shipped, and how it was validated. This section supersedes the phase plan
in §12 where the two disagree.

### Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/servers/:serverId/clone/preflight` | Resolve + validate without writing; returns the plan, node-specific change set, blockers and warnings, plus `preflightId`/`fingerprint` |
| `POST` | `/api/servers/:serverId/clone` | Create the clone. `mode` (`full`/`configuration`); cross-node requires `preflightId` + acknowledged warnings + `server.transfer` |
| `POST` | `/api/servers/:serverId/clone/:cloneId/retry` | Re-run the file copy for a full clone whose copy failed. Provenance (source id, mode, target node) is recorded in Redis when the clone is created |

`copyFiles: true|false` is still accepted on submit and maps to
`full|configuration`, so existing API and MCP callers keep working. MCP exposes
`clone_server_preflight` and `clone_server` (with `mode`).

### Decisions taken

- **D1 source must be stopped** — enforced; the review step offers "Stop source
  and continue".
- **D2 configuration clone installs** — the clone is created `installing` and the
  backend sends `install_server` directly, reusing the shared payload builder
  (`services/server-install.ts`, also used by `/install` and `/reinstall`).
- **D3 cross-node permission** — `server.create` + target-node access +
  `server.transfer`; the last is reported as a `PERMISSION_DENIED` blocker in
  preflight.
- **D4 include defaults** — access/role grants on; scheduled tasks, databases and
  (for configuration clones) installed-mod records off.
- **D5 failed full clone keeps its row** — `stopped`, with an error log, a
  `clone_failed` event, and the retry/delete paths.
- **D6 backup credentials** — never copied; the clone falls back to local backup
  storage and warns. `copyBackupCredentials` is accepted but gated to
  `admin.write`.
- **D7 `locationId`** — derived from the target node; the field is not part of
  the clone schema (unknown keys are stripped).
- **D8 confirmation transport** — `preflightId` stored in Redis (10 min,
  single-use, user-scoped) plus a client-echoed fingerprint, with a
  process-local fallback.
- **D9 durability** — boot reconciliation of servers stuck in
  `cloning`/`transferring` (older than 10 minutes) instead of a new operation
  table; Redis-backed clone provenance for retry.
- **D10 database contents** — never copied; configuration clones can provision
  new empty databases.

### Bugs found and fixed during implementation

Found by tests or by the live validation run, in the order they surfaced:

1. **Configuration clones never installed** (pre-existing) — the server was
   created empty and stopped. Now the install is queued.
2. **`locationId` copied from the source** (pre-existing) — a clone to another
   location ended up mismatched with its node.
3. **No source-stopped guard for full clones** (pre-existing) — `cp -a` could run
   against a live directory.
4. **Host-network port reuse** — `collectUsedHostPortsByIp` skips host-network
   servers, so the "shift the port block" logic never saw an existing server and
   two host-network clones both took 25565. Fixed with an opt-in `includeHost`.
5. **Disk probe asked the wrong node** — a cross-node full clone asked the
   *target* node for the *source* data size, which can never resolve. The panel
   now asks each node for the half it can measure.
6. **Relay aborted on a fixed 4 MiB watermark** — replaced by adaptive flow
   control (§6.5b).
7. **Agent replay guard dropped `finish_restore_stream`** — the guard keyed on
   `requestId` alone, but the restore protocol reuses one id across
   `prepare`/`finish`. Every cross-node restore hung; node transfer was affected
   too. Now keyed on `(requestId, type)`.
8. **Storage mount/migration had no fallback on mount-restricted nodes** — an
   unprivileged LXC could not start servers.
9. **`blockIO` always set** — `runc` failed with `io.weight: no such file or
   directory` where the cgroup v2 `io` controller is not delegated.
10. **Flow control deadlock** — the first version only re-evaluated flow when a
    binary frame arrived, so a paused stream never resumed and wedged until the
    relay timeout. Fixed with a drain watcher that runs while paused.

Items 1–3 are pre-existing clone defects; 4–5 are clone-code defects; 6–10 are
shared relay/agent defects that also affect node transfer.

### Deliberate deviations

- **No retry button in the panel UI.** `POST /:serverId/clone/:cloneId/retry`
  exists and is API/MCP-reachable, and the failure is visible in the console log;
  the UI paths are the cloning banner, server delete, and re-running the clone.
  A failed-clone banner would need clone outcome state on the server detail
  response.
- **Host-network ports are shifted, not remapped.** Host networking shares the
  host namespace, so the whole port block is shifted by a constant offset to the
  first free range, with a `CLONE_HOST_PORTS_SHIFTED` warning. This replaces the
  previous behaviour, which reused the source's host ports and could collide.
- **Disk preflight is agent-measured.** `Node` has no disk-capacity column, so
  the agent reports the sizes; a timeout downgrades the disk check to
  `CLONE_SOURCE_SIZE_UNKNOWN` rather than blocking. The probe runs only for full
  clones, and only after the source node is confirmed to have the measurement.
- **Boot reconciliation, not an operation table.** A migration on a checkout
  whose dev database has unapplied migrations could not be verified locally.

### What a node needs

The live validation ran a node inside an unprivileged LXC container and surfaced
two environment requirements that are now documented for operators
(`docs/agent.md`, `admin/requirements.mdx`, `troubleshooting/node.mdx`):

- **Loop-mount permission** for per-server disk quotas. Without it the agent
  falls back to a plain data directory and disk quota is **not enforced**.
- **The cgroup v2 `io` controller** delegated to the agent, otherwise `runc`
  cannot create the container. An up-to-date agent omits the IO weight when the
  controller is absent.

### Verification

- **Backend:** `src/__tests__/server-clone.test.ts` (22 tests) covers the modes,
  plan resolution, blockers, warnings, the confirmation contract, idempotency,
  retry, the disk probe and host-port conflicts. `src/websocket/__tests__/relay-flow-control.test.ts`
  (8) covers the watermark decisions and `src/__tests__/relay-flow-control.gateway.test.ts`
  (4) covers the orchestration, including the drain-timer deadlock regression.
- **Frontend:** `components/servers/clone/CloneReviewStep.test.tsx` (6 tests).
- **Agent:** `clone_server_files` hardening, `clone_preflight`, `backup_stream_flow`,
  the replay-guard key, the storage fallback and the IO-weight omission all ship
  with `cargo fmt`/`clippy -D warnings`/`test` green (215 tests).
- **i18n:** all new copy and error codes in en/fr/zh-CN; `i18n:check`,
  `i18n:hardcoded` and `i18n:verify` pass.
- **Browser:** sign-in and the owner clone flow were exercised against a running
  panel, which is what found the stale "allocation required" gate that kept the
  review button disabled and the preflight that blocked on the agent probe for
  every mode; both are fixed (allocation is optional, the probe runs only for
  full clones with a 12 s cap, and the dialog shows a checking state).
- **Live end-to-end:** a node was created inside an LXC container, registered and
  installed from the panel one-liner, and both clone modes were run against it —
  a configuration clone (fresh Paper install, EULA accepted, running) and a full
  clone of a running Paper server (238 MB, 194 files, running on its own port
  after the host-port shift). A later 238 MB cross-node copy completed with the
  code defaults and no environment overrides, and the relay's pause command was
  observed reaching and being honoured by the source agent. That run is what
  surfaced bugs 7–10 above.
