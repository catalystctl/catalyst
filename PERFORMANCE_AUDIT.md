# Catalyst Runtime Performance Audit — 2026-09-03

Full-stack performance and latency audit: Catalyst → containerd → runc → cgroups → Linux kernel.
Method: 12 parallel specialist investigations (CPU/cgroups, memory, disk/I-O, containerd/OCI, Tokio concurrency, console/WebSocket, networking, metrics, systemd/host, background ops, live host recon, adversarial review of fixes), external upstream research (runc conversion formulas, containerd stdio semantics, kernel cgroup v2 docs), and **empirical runc 1.4.3 spec-matrix tests** on a live host (kernel 6.12.101, cgroup v2, containerd 2.3.4, 16 cores).

Assumed already fixed (verified intact): CFS burst credit (`3e020fa63`).

---

## 1. Critical Findings

### C-1. Per-server CPU weight never applied — runc 1.4.3 on cgroup v2 ignores `resources.cpu.weight`
- **Where:** `catalyst-agent/src/runtime_manager/image_and_spec.rs` — `linux_cpu_resources()`; installer spec in `container_ops.rs`.
- **Mechanism:** runc 1.4.x writes cgroup v2 `cpu.weight` **only** from the `unified` map / shares conversion; the OCI `cpu.weight` field is silently dropped. Verified empirically: a spec with `"weight": 200` produced `cpu.weight 100` (default) in the cgroup; `"shares": 2048` produced `174` (lossy); `"unified": {"cpu.weight": "200"}` produced exactly `200`. Consequence: **every server on every host ran at equal default CPU weight** — a 1-core and an 8-core server had identical priority under host contention, so noisy-neighbor fairness was fictional.
- **Reproduction:** runc spec matrix (see §5). Live Catalyst container cgroup also showed `cpu.weight: 100`.
- **Impact:** Under host CPU contention, allocation size had no effect on scheduling priority; TPS degradation for large servers during neighbor load.
- **Fix (applied):** emit `shares = cores*1024` (cgroup v1 + lossy v2 fallback) **and** `unified: {"cpu.weight": cores*100}` (exact v2). Verified end-to-end: final spec → `cpu.weight 200` for a 2-core server. Regression tests: `cpu_resources_banks_one_full_period_as_burst`, `cpu_resources_weight_scales_with_cores`.

### C-2. `memory.high` = 90 % of `memory.max` → synchronous reclaim stalls below the advertised limit
- **Where:** `image_and_spec.rs` — `linux_memory_resources()`.
- **Mechanism:** cgroup v2 `memory.high` makes the kernel throttle allocating tasks in synchronous reclaim once `memory.current` passes it. Java sizing (`shell_utils.rs::java_cgroup_overhead_mb`, clamp 640–1024 MB) inflates a 2048 MB heap to a 2688 MB cgroup; 90 % → 2419 MB watermark, while Catalyst's own component plan sums to ~2389 MB before thread stacks, code cache, malloc arenas, and page cache. Breach is the expected steady state. With swap disabled (default), reclaim cannot swap → page-cache thrash through the loop image and multi-hundred-ms to second-scale main-thread freezes, invisible on working-set graphs.
- **Impact:** exactly the "average graphs normal, server freezes" class; JVM GC pauses amplified.
- **Fix (applied):** `memory.high == memory.max`. Working sets that fit run untouched; oversized ones hit a clean, restartable OOM at the limit instead of recurring freezes. Test updated (`memory_resources_disables_swap_when_zero`).

### C-3. Console log rotation renamed the file out from under the containerd shim's `O_APPEND` fd — console death and unbounded hidden file growth
- **Where:** `runtime_manager/helpers.rs` — `rotate_logs()` (old rename-chain), called from `console.rs` and the 5-min sweep.
- **Mechanism:** verified live: the shim holds the stdout file open `O_APPEND` for the task lifetime. `rename` does not change inodes → the shim kept appending to the renamed `stdout.1` (unbounded growth), the fresh `stdout` stayed empty, and the tail (path-based) read an empty file forever → console silently dead; eventual disk fill; when the shim can't write, the game server blocks on stdout → game freeze.
- **Fix (applied):** copy-then-truncate (`stdout` → `stdout.1`, truncate in place). Verified live with a real containerd task: after `truncate -s 0`, the shim's next write lands at offset 0 and streaming continues. Removed dead `LOG_BACKUP_COUNT`.

### C-4. Node-wide `sync` before every backup — synchronized writeback storm across all servers
- **Where:** `websocket_handler/backup.rs` — `handle_create_backup()` (old: `Command::new("sync")`).
- **Mechanism:** `sync(1)` flushed dirty pages of **every filesystem on the node** — converting all tenants' accumulated dirty pages (up to `vm.dirty_ratio=40` % of RAM per the old tuning) into one writeback storm plus ext4 journal commit bursts on every loop image, every time any user or the scheduler created a backup.
- **Fix (applied):** `sync_dir_tree()` fsyncs only the target server's files, then dir `sync_all`. Paired with `vm.dirty_background_bytes=256MB / vm.dirty_bytes=1GB` replacing RAM-ratio limits in `scripts/node-tuning.sh`.

### C-5. `burst` on unsupported kernels could fail every container start (latent from the previous fix)
- **Where:** `image_and_spec.rs` / `container_ops.rs` — unconditional `"burst"` in both specs.
- **Mechanism:** `cpu.max.burst` requires kernel ≥ 5.14; modern runc writes it literally — old kernel + new runc = task-creation failure (worse than the stall it fixed). Debian 11 (5.10, cgroup v2 by default) is the exact hazard combo.
- **Fix (applied):** one-time `kernel_supports_cpu_burst()` probe (scratch cgroup under `/sys/fs/cgroup/catalyst/`; falls back to a root-file existence check) omits the field when unsupported — on a read-only cgroupfs runc couldn't write it either, so omit-on-failure is the safe default. Test: `cpu_resources_omit_burst_when_kernel_lacks_it`.

### C-6. Throttling/reclaim/OOM structurally invisible to monitoring
- **Where:** `runtime_manager/helpers.rs` (cpu.stat parsed for `usage_usec` only), backend `ServerMetrics` — no `nr_throttled`/`throttled_usec`/PSI/`memory.events` anywhere.
- **Mechanism:** a fully throttled cgroup accrues `usage_usec` at exactly quota rate → the CPU graph shows a tidy flat line at the quota while every period freezes. Live proof: host's real container showed `nr_throttled 150 / nr_periods 166, throttled_usec 21.7 s > 15.8 s actual CPU` (pre-burst-fix container; counters static because the task was stopped).
- **Fix (applied):** `read_cgroup_cpu_throttling()` + cumulative `cpuThrottledUsec` / `cpuThrottledRatio` (0–1) added to `resource_stats` and batch payloads as additive optional JSON fields (older panels ignore unknown keys; None on v1). Panel/alerting surfacing is now possible and is listed under remaining work.

### C-7. In-container `df` exec per server per 5 s — O(N) fork storm through the shim
- **Where:** `websocket_handler/monitoring.rs` fast + slow paths (`runtime.exec(container, ["df","-m","/data"])`).
- **Mechanism:** each sample = 3 gRPC calls + shim fork + exec + FIFO file create/remove, ×N containers ×0.2 Hz (≈50 forks/s at 250 servers), landing on the same host as the games; timeouts degraded into garbage metrics (cumulative block-IO reported as "disk usage").
- **Fix (applied):** host-side `statvfs` on the resolved data dir (`data_dir/<uuid>`, resolved from the stored start message's `serverUuid` since containers are named by server.id — adversarial review caught this keying subtlety). Zero execs; failure reports (0,0) rather than counter garbage. NVMe-blind `io.stat` parser (`8:` major filter) also fixed to sum all devices.

---

## 2. High Findings

- **H-1. Control-plane freeze from inline WS handlers** (`websocket_handler/mod.rs`): `download_backup` (multi-GB chunk stream), `delete_server` (`remove_dir_all`), `resize_storage` (up to 3600 s `e2fsck`), `finish_restore_stream`, `delete_backup`, `file_operation` (500 MB read + base64) all executed inline on the single read loop — every other server's console/power/stats queued behind them. **Fixed:** these are now `tokio::spawn`ed (mirroring the existing create_backup pattern). `console_input` deliberately kept inline: commands are order-sensitive and the new 5 s-bounded stdin write caps worst-case delay.
- **H-2. Blocking stdin FIFO write could wedge the node** (`container_ops.rs::send_input`): blocking-fd `write_all` on a full 64 K pipe (container not reading stdin) hung a blocking-pool thread forever and, inline, the read loop. **Fixed:** 5 s `tokio::time::timeout`; timeout error is diagnosable ("container is not reading input").
- **H-3. Per-chunk backup-upload writes under the map write-lock** (`backup.rs`): one slow write serialized every upload session + GC. **Fixed:** size-check + `try_clone()` handle under a read lock, write outside the lock, state update under a short write lock. Verified race with the stale-upload GC is benign (unlinked-inode write).
- **H-4. Console tail re-read the whole ≤10 MB file every 50–200 ms per server** (`console.rs`): O(file) reads + UTF-8 validation per poll (~200 MB/s per busy server at 20 Hz). **Fixed:** seek-based `read_new_tail_bytes()` reads only appended bytes; also recovers from non-UTF-8 chunks (old code wedged forever). Adversarial review verified trailing-fragment/rotation semantics identical to the old logic.
- **H-5. Host kernel tuning dead code** — `scripts/node-tuning.sh` (conntrack sizing, JVM `vm.max_map_count=2621440`, inotify limits, socket buffers) was invoked by **no install path**, and `deploy-agent.sh` overwrote the same sysctl file with one line. **Fixed:** deploy invokes the tuning script (with curl-pipe fetch fallback via `CATALYST_TUNING_URL`); ip_forward now appended, not clobbered.
- **H-6. Agent systemd drop-in `MemoryMax=4G` + `MemorySwapMax=0`** around the agent **and all its children** (backup tar/gzip, restore, streaming crypto) — hard OOM of the management plane mid-operation; the two shipped copies also diverged (only one had CPU/IOWeight 1000). **Fixed:** consolidated drop-in (both copies) without the memory wall.
- **H-7. Backend PUT `/api/servers/:id` bypassed zod validation** (`routes/servers/core.ts`): `allocatedCpuCores` unbounded (floats → Prisma 500s; 129+ → container-creation failure at spec-parse). **Fixed:** `serverUpdateSchema` applied as `preHandler`, with the schema extended to cover all fields the handler and frontend actually send (`startupCommand` nullable, `primaryIp`, `allocationId`, `backupAllocationMb`, `databaseAllocation`, `primaryPort`) — the adversarial review verified zod's key-stripping against real frontend payloads so no silent no-ops were introduced.
- **H-8. Import path could create unlimited-CPU containers** (`routes/nodes.ts`): `resolvedCpuCores` of 0 → runc `quota 0` = **no CFS cap**. **Fixed:** `Math.max(1, Math.ceil(...))` with the template fallback chain preserved (adversarial review caught a dead-`??` regression in the first attempt — fixed).
- **H-9. Unbounded installer `/tmp` tmpfs** (`container_ops.rs`): large modpack extracts consumed the 2 GB cgroup and OOM-killed the installer (exit 137, undiagnosable) instead of failing with ENOSPC. **Fixed:** `size=1G`.

## 3. Medium Findings (fixed unless noted)

- **M-1.** `pids.max=512` below real game-server thread fan-out (JVM GC/Netty/mods) → EAGAIN mid-run "random lag". **Fixed: 2048** (runtime + installer).
- **M-2.** `/dev/shm` fixed 64 MiB — POSIX-SHM consumers (Source 2, multi-process engines) hit ENOSPC mid-match. **Fixed: 256 MiB.**
- **M-3.** Missing cgroup namespace — containers saw the host's real cgroup tree via the ro `/sys/fs/cgroup` bind (cross-tenant metadata leak; engines mis-size thread pools). **Fixed: `{"type":"cgroup"}` namespace added** (runc/Docker default).
- **M-4.** Missing per-netns socket sysctls — fresh netns clamped `setsockopt(SO_RCVBUF)` at ~208 KiB defaults. **Fixed:** `linux.sysctl` with `net.ipv4.tcp_rmem/wmem` max 16 MiB for netns-per-container mode only. Constrained by live testing: runc writes `net.core.*` requiring CAP_NET_ADMIN (which the spec deliberately lacks) → `net.core.*` in the spec would break container starts; tcp_* autotuning maxima are the safe subset. UDP buffer caps are raised by node-tuning instead.
- **M-5.** `cpu.weight` clamp: >100-core allocations (backend allows 128) produced weight >10000 → kernel EINVAL → container creation failed. **Fixed: saturate at 10000** (`cpu_resources_weight_clamps_at_kernel_max`).
- **M-6.** `quota: 0` defense-in-depth: malformed agent message → unlimited container. **Fixed: clamp to 1 core** (`cpu_resources_zero_cores_degrades_to_one`).
- **M-7.** `vm.dirty_ratio=40` / `dirty_background_ratio=10` in tuning — tens of GB of dirty pages before forced writeback on large hosts. **Fixed: byte-based 256 MB / 1 GB.**
- **M-8.** Installer burst applied unconditionally on old kernels — **fixed** (same kernel gate as runtime).
- **M-9 (reported, not fixed).** Backup tar+gzip runs in the agent's high-priority cgroup with no per-node concurrency limit; scheduled backups at the same cron minute stack. Recommend `ionice -c3` + a node-level semaphore (follow-up).
- **M-10 (reported, not fixed).** Whole-file backup encryption (AES-GCM over `tokio::fs::read` of the entire archive ≈ 2× size in RAM) can OOM on small nodes. Recommend streaming crypto (follow-up).
- **M-11 (reported, not fixed).** Backend persists every console line with an awaited per-message Prisma insert + uncached ownership query — DB-bound ceiling around thousands of msg/s per node with zero viewers. Recommend batching + `serverAccessCache` reuse (follow-up).
- **M-12 (reported, not fixed).** Per-client `request_immediate_stats` triggers a full agent sample (no coalescing) — O(clients) agent work on connect storms. Recommend gateway-side dedupe window (follow-up).
- **M-13 (reported, not fixed).** Bridge-mode DNAT rules match `--dport` only, no `-d <host-ip>` scoping, and macvlan servers get unused DNAT rules while being excluded from port-conflict checks — mixed-mode nodes with overlapping ports can cross-route inbound traffic. Recommend `-d` scoping + skipping port-forwards for macvlan (follow-up, security-adjacent).
- **M-14 (reported, not fixed).** Per-container exit monitors each subscribe to the **node-wide** unfiltered containerd event stream → O(N²) event decode under churn. Recommend one shared subscription demuxed by id (follow-up).
- **M-15 (reported, not fixed).** Stop path SIGTERM 30 s → SIGSTOP 5 s → SIGKILL: worst-case ~65 s stop with a SIGSTOP dwell that risks save corruption. Consider egg-configurable grace and dropping SIGSTOP (follow-up, needs product decision).

## 4. Low / Notes

- Loop-image architecture: double fsync (guest→host journal) is structural; mitigations applied (`noatime` on loop mounts in `storage_manager.rs`); recommend periodic `fstrim` for space reclaim (not implemented).
- `io.weight` from `blockIO.weight` is ineffective through loop devices (backing I/O attributed to the root cgroup) — documented; disk *latency* isolation would need per-server `io.max` on the backing device.
- Deployed agent drop-in / node-tuning: `LimitNOFILE` drift (65536 vs 1M) remains between unit and tuning script (both now consistent on weights).
- cgroups land at root `/catalyst/<id>` (cgroupfs driver) — sane for isolation; systemd-oomd blindness is a known trade-off (documented, unchanged).
- PSI and `pids.events` observability still not surfaced (throttling is; the rest is follow-up).
- Frontend/DB metric fan-out costs (redundant `findFirst` per batch, per-tick `node.update`, N+1 admin dashboards) — catalogued by the metrics specialist, not changed (no measured user impact at target scale).

## 5. Performance Tests Performed

**Empirical spec→cgroup matrix (runc 1.4.3, kernel 6.12, cgroup v2, 16-core host):**

| Spec variant | cgroup result |
|---|---|
| `cpu.weight: 200` (old Catalyst) | `cpu.weight 100` — **silently ignored** |
| `cpu.shares: 2048` | `cpu.weight 174` (lossy conversion) |
| `unified.cpu.weight: "200"` | `cpu.weight 200` ✓ |
| `shares+unified` (fix shape) | `cpu.weight 200`, `cpu.max 200000 100000`, `burst 200000` ✓ |
| `net.core.*` in spec without netns/caps | **runc run fails** ("not allowed in host network namespace" / "permission denied") — informed the sysctl fix |
| final Catalyst spec (2-core) | `cpu.max 200000 100000`, `cpu.max.burst 200000`, `cpu.weight 200`, `memory.max=memory.high=2 GiB`, `memory.swap.max 0`, `pids.max 2048` ✓ |

**Live runtime verification (real host, production agent):**
- Live Catalyst container cgroup (`/sys/fs/cgroup/catalyst/<id>`): `nr_periods 166, nr_throttled 150 (90.4 %), throttled_usec 21,712,877` vs 15.8 s actual CPU — the exact pre-burst-fix signature, caught in the wild (container stopped; counters static).
- Parent `catalyst` cgroup: no limits (no hidden parent throttling); `memory.events.max 4615` historical limit hits, 0 OOM kills.
- containerd shim fd check: log file held `O_APPEND=True`; truncate-in-place verified live (shim continued writing from offset 0 after truncate).
- Host PSI: `io` full ≈ 55.6 min over 13 d (loop-image/backup consistent); THP `always`, swap in use — host-tuning follow-ups noted.

**Bare-metal A/B/C benchmark:** not run at scale on this host — two podman CI runners (`--cpus=6 --memory=7g` each), jellyfin and litellm run concurrently, making latency comparisons unsound. The runc-matrix + live-cgroup evidence isolates Catalyst's *configuration* effect from noise; a dedicated-node A/B/C remains listed as future work.

**Automated gates after all fixes:** `cargo fmt --check`, `cargo check`, `cargo clippy -D warnings` clean; **136 agent tests pass** (incl. 5 new/updated CPU-semantics tests + throttling-field round-trip tests); backend `tsc` clean; **10,075 backend tests pass** (53 files).

## 6. Changes Made

17 files, +683/−163:

| File | Change |
|---|---|
| `runtime_manager/image_and_spec.rs` | CPU weight/shares/unified fix; weight clamp; quota-0 guard; burst kernel gate; `memory.high == limit`; `/dev/shm` 256 MiB; pids 2048; cgroup namespace; netns tcp sysctls |
| `runtime_manager/container_ops.rs` | Installer: unified weight, gated burst, bounded `/tmp`, pids 2048; bounded stdin write |
| `runtime_manager/helpers.rs` | Throttle-counter reader; kernel burst probe; copy-truncate rotation; io.stat all-device parsing |
| `runtime_manager/mod.rs` | ContainerStats throttling field; export updates |
| `websocket_handler/backup.rs` | `sync_dir_tree` replaces node-wide `sync`; lock-free upload writes |
| `websocket_handler/console.rs` | Seek-based incremental tail |
| `websocket_handler/monitoring.rs` | statvfs disk usage; throttle fields on both paths |
| `websocket_handler/mod.rs` | Spawn heavy handlers; additive throttle wire fields |
| `storage_manager.rs` | `noatime` on loop mounts |
| `lib/validation.ts` / `routes/servers/core.ts` / `_helpers.ts` | PUT validation with complete schema |
| `routes/nodes.ts` | Import CPU clamp with template fallback |
| `scripts/deploy-agent.sh` | Wire node tuning; append-only sysctl; curl-pipe fallback |
| `scripts/node-tuning.sh` | Byte-based dirty limits; safe agent drop-in (no memory wall) |
| `systemd/catalyst-agent.service.d/limits.conf` | Consolidated, no `MemoryMax` |

**Rollout note:** spec changes apply only on container recreation (restart / stop-start / rebuild), same as the burst fix; existing containers keep old cgroup values until restarted. After updating the agent, restart each server once.

## 7. Remaining Risks / Not Reproducible Here

- Burst-on-5.10-hard-failure (C-5) is defended by the probe, but the failure mode itself wasn't reproduced (no 5.10 host available) — the fix is fail-safe in the right direction.
- A/B/C benchmark on a quiet node (§5 caveat).
- Items marked *reported, not fixed* (M-9..M-15) — each has a concrete minimal fix sketched; none were applied without measurement or product decisions (e.g., stop-path timing, backup retention policy, DNAT scoping).
- Backend does not yet persist/display `cpuThrottledUsec/Ratio` (additive fields are ignored harmlessly by the current schema) — surfacing them in graphs/alerts is the natural next PR.
- The audit ran while a second, stale debug agent process existed on the host (noted by recon); unrelated to these changes but worth cleaning up on this machine.

## 8. Final Verdict

> **Does Catalyst introduce avoidable performance degradation compared with correctly configured plain containerd?**

**Yes — it did, on multiple independent paths, and the worst offenders are now fixed.** Beyond the already-fixed CFS burst issue, this audit proved with live runc tests that the per-server CPU weight silently never reached the kernel on cgroup v2 (equal-priority noisy neighbors), that `memory.high` at 90 % caused synchronous reclaim freezes below the advertised limit, that console rotation could permanently kill console streaming and grow hidden files until games blocked on stdout, that every backup flushed the whole node's dirty pages at once, and that a `df` fork storm plus whole-file console re-reads imposed a permanent per-server agent tax — all invisible to Catalyst's own average-based monitoring, which had no throttling, reclaim, or OOM signals at all. With the applied changes (verified against the real runc/cgroup stack and covered by tests), a freshly created Catalyst server now sits at **plain-containerd parity for CPU quota/burst/weight, memory bounds, and I/O mount options**, its console and metrics paths are bounded, and the newly exposed throttle counters make the residual stall class visible instead of hidden. The remaining items are catalogued follow-ups (streaming backup crypto, backup prioritization/concurrency, console-DB batching, DNAT scoping, event demux, stop-path tuning) rather than unresolved defects.
