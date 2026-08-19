# Benchmarks — Catalyst vs Pterodactyl

> **TL;DR:** `bash scripts/lxc-lab/lab.sh benchmark` runs the full automated comparison on the LXC lab and writes `benchmarks/results/<ts>/report.md` + raw JSON. CI does the same on a self-hosted runner via `workflow_dispatch` or weekly schedule, with a pure-syntax `validate` job that always runs.

## What we bench

Everything worth benching between the two panels — HTTP API, operational flows, realtime, and scale. Suites are defined in `scripts/benchmark/scenarios.json` and orchestrated by `scripts/benchmark/run.sh`:

### HTTP suites (`bench.mjs` — concurrent fetch loops, histogram)

| Suite | Catalyst | Pterodactyl | Why it matters |
|---|---|---|---|
| `api-list-servers` | `GET /api/servers` | `GET /api/application/servers` | Primary pagination path |
| `api-get-server` | `GET /api/servers/:id` | `GET /api/application/servers/:id` | Single-entity read |
| `api-list-nodes` | `GET /api/nodes` | `GET /api/application/nodes` | Node inventory |
| `api-list-users` | `GET /api/admin/users` | `GET /api/application/users` | Admin user list |
| `api-dashboard` | `GET /api/dashboard/stats` | — (Catalyst-only) | Aggregated counts |
| `api-auth-me` | `GET /api/auth/session` | — | Token/session cost |
| `api-server-activity` | `GET /api/servers/:id/activity` | `GET /api/application/servers/:id/activity` | Audit log read |
| `api-stats-history` | `GET /api/servers/:id/stats/history?range=1h` | — | Time-series metrics |
| `api-permissions` | `GET /api/servers/:id/permissions` | — | Effective permissions |
| `api-file-list` | `GET /api/servers/:id/files?path=/` | `GET /api/client/servers/:uuid/files/list` | File explorer (tunnels via agent / Wings proxy) |
| `api-allocations` | `GET /api/servers/:id/allocations` | `GET /api/application/servers/:id` | Network allocations |
| `api-templates` | `GET /api/templates` | `GET /api/application/nests/:id/eggs` | Template/egg catalog |

Each suite runs with `connections` parallel workers for `duration` seconds (defaults `20c / 15s / 2s warmup` in `scenarios.json`), collecting rps, p50/p75/p90/p95/p99/p999, stddev, status-code histogram, and error rate.

### Operational ops (`ops.mjs` — timed iterations)

| Op | What it measures | Iterations | Notes |
|---|---|---|---|
| `op-file-write-readback` | `POST /files/write` (1KB) + `GET /files?path=/` + `GET /files/download` + cleanup | 12 | Agent file-tunnel round-trip |
| `op-file-upload-256k` | `POST /files/upload` multipart 256KB | 6 | Fastify multipart + agent streaming |
| `op-scale-list` | `GET /api/servers?limit=500` | 8 | Large-list DB + auth cost |
| `op-sse-ttfb` | TTFB to first byte on `GET /api/servers/:id/events` (SSE) | 12 parallel | Realtime connect latency |
| `op-server-create-burst-10` | Create 10 servers sequentially | 10 creates | API + DB + allocation; auto-cleanup |
| `op-backup-create` | `POST /api/servers/:id/backups` (tiny server) | 3 | Snapshot/create path |
| `op-migration-50` | Full 50-server Pterodactyl import via `/api/admin/migration` | 1 | **Opt-in** (`BENCH_INCLUDE_MIGRATION=1` or `--only op-migration-50`); destructive |

> `op-migration-50` is destructive (creates servers) and only runs when explicitly requested. All other ops clean up after themselves.

## How to run

### Prerequisites

- **Catalyst fixture:** `bash scripts/lxc-lab/lab.sh bootstrap` (creates backend/panel, location, node, templates, admin) + `bash scripts/lxc-lab/lab.sh servers` (Paper + SotF).
- **Pterodactyl fixture:** `bash scripts/lxc-lab/lab.sh ptero` + `bash scripts/lxc-lab/lab.sh ptero-bulk` (50 stopped servers across 3 Wings nodes). Optional for Catalyst-only results.
- `node >= 20`, `jq`, `curl` on the host. State lives in `~/.local/share/catalyst-lxc-lab/state.env` (sourced for URLs and tokens).

### One command — LXC lab

```bash
# Full suite (HTTP + ops, both panels when fixtures exist)
bash scripts/lxc-lab/lab.sh benchmark

# Smoke (5s per suite, 10c) — fast CI sanity
bash scripts/lxc-lab/lab.sh benchmark-quick

# Custom tuning
bash scripts/lxc-lab/lab.sh benchmark -- --duration 10 --connections 20
bash scripts/lxc-lab/lab.sh benchmark -- --only catalyst          # Catalyst only
bash scripts/lxc-lab/lab.sh benchmark -- --only pterodactyl       # Ptero HTTP only (needs PTERO_APP_KEY)
BENCH_INCLUDE_MIGRATION=1 bash scripts/lxc-lab/lab.sh benchmark   # include 50-server migration

# Direct orchestrator (without lab.sh)
bash scripts/benchmark/run.sh --duration 15 --connections 20
BENCH_ONLY=catalyst bash scripts/benchmark/run.sh
OUT_DIR=/tmp/bench bash scripts/benchmark/run.sh
```

### Direct runners (without orchestrator)

```bash
# Single HTTP suite
node scripts/benchmark/bench.mjs \
  --url http://10.0.3.20:3000 \
  --token "$AUTH_TOKEN" \
  --scenario api-list-servers \
  --connections 20 --duration 15 --warmup 2 \
  --paper-id "$PAPER_SERVER_ID" --ptero-id "$PTERO_SERVER_ID" \
  --out /tmp/catalyst.json

# Pterodactyl Application API
node scripts/benchmark/bench.mjs \
  --url http://10.0.3.30 \
  --token "$PTERO_APP_KEY" \
  --accept "application/vnd.pterodactyl.v1+json" \
  --path /api/application/servers

# Ops only
node scripts/benchmark/ops.mjs --target catalyst --out /tmp/ops.json
node scripts/benchmark/ops.mjs --target catalyst --only op-file-write-readback,op-sse-ttfb --out /tmp/ops-subset.json
BENCH_INCLUDE_MIGRATION=1 node scripts/benchmark/ops.mjs --only op-migration-50 --out /tmp/migration.json
```

### Outputs

Each run writes to `benchmarks/results/<YYYYMMDD-HHMMSS>/`:

- `catalyst.json` — Catalyst HTTP suite results
- `pterodactyl.json` — Pterodactyl HTTP suite results (if fixture present)
- `ops-catalyst.json` — operational results
- `report.md` — human-readable comparison (rps, p95, winner per suite)
- `comparison.json` — machine-readable comparison
- `ops-report.md` — ops summary

Example preview (`report.md`):

```markdown
| Suite | Catalyst rps | Pterodactyl rps | Δ rps | Catalyst p95 | Pterodactyl p95 | Δ p95 | Winner (p95) |
|---|---|---|---|---|---|---|---|
| api-list-servers | 850.0 | 620.0 | +37.1% | 18.0ms | 27.0ms | -33.3% | Catalyst |
```

Render a comparison from any two result files:

```bash
node scripts/benchmark/compare.mjs \
  --catalyst benchmarks/results/20250101-120000/catalyst.json \
  --pterodactyl benchmarks/results/20250101-120000/pterodactyl.json \
  --out /tmp/compare.md --json /tmp/compare.json
```

## Automation

### Lab

`scripts/lxc-lab/benchmark.sh` exposes `stage_benchmark` / `stage_benchmark_quick` and is sourced by `lab.sh`. `lab.sh benchmark` delegates to `scripts/benchmark/run.sh` and tolerates missing fixtures (skips ptero suites when `PTERO_APP_KEY` is absent).

### CI (`.github/workflows/benchmark.yml`)

| Trigger | What runs | Where |
|---|---|---|
| `push` to `main` touching `scripts/benchmark/**` or `lab.sh` | `validate` only: syntax check, `scenarios.json` validation, `--help` smoke, mock comparison + artifact `benchmark-mock-report` | `blacksmith-2vcpu-ubuntu-2404` (always) |
| `workflow_dispatch` (manual) | `validate` + `live` (full `run.sh` on the LXC host) | `live` needs self-hosted runner `[self-hosted, benchmark]` with `state.env` present; skipped otherwise |
| `schedule` Mondays 03:00 UTC | `validate` + `live` (smoke) | same as dispatch |

The `live` job reads `~/.local/share/catalyst-lxc-lab/state.env` for URLs/tokens, runs `bash scripts/benchmark/run.sh`, and uploads `benchmark-results` (all `*.json` + `*.md`). If no self-hosted runner is available, the workflow still succeeds via `validate`.

Inputs for manual runs: `duration`, `connections`, `include_migration` (destructive).

### Keeping runs fair

- Pin LXC memory/CPU (`BACKEND_MEMORY`, `PTERO_PANEL_MEMORY`, etc. in `config.env`) when doing head-to-head comparisons.
- Warmup (`--warmup 2`) is included; each suite reports 3+ runs median if you repeat with `OUT_DIR` variations.
- Collect `NodeMetrics` / `ServerMetrics` and `docker stats` alongside if diagnosing overhead differences.

## Interpreting results

- **rps** — throughput under fixed concurrency; higher is better (but bounded by your host).
- **p50 / p95 / p99** — tail latency matters more than mean for UI-perceived snappiness.
- **errorRate / statusCodes** — should stay 0% / all `200` for healthy suites; file/SSE suites may show `503` if the node is offline.
- **Catalyst-only suites** (`api-dashboard`, `api-stats-history`, etc.) naturally show `—` for Pterodactyl.

See also: `docs/architecture.md` — Identified Gaps (Performance benchmarks) now points here.

## Troubleshooting

- `AUTH_TOKEN missing` — run `bash scripts/lxc-lab/lab.sh bootstrap` or export `AUTH_TOKEN` from a login response.
- `PTERO_APP_KEY missing` — run `bash scripts/lxc-lab/lab.sh ptero-seed` or export it from `state.env`.
- `unresolved template :paperId` — pass `--paper-id` or ensure `PAPER_SERVER_ID` is in `state.env`.
- File/SSE ops return `503`/`504` — node offline or agent not connected; check `systemctl status catalyst-agent` and `curl http://10.0.3.20:3000/health`.
- Large `p99` spikes on first run — cold JIT/DB; re-run with longer warmup or discard the first run.
