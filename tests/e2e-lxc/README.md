# Catalyst LXC E2E — Minecraft pipeline

Reusable end-to-end test for the exact path users run:

`install.sh` → panel → node → Minecraft Paper → reachable game server.

It exists alongside `scripts/lxc-lab/` (the full split-panel lab with SOTF,
Pterodactyl fixtures and every API sweep). Use this pipeline when you want a
fast, isolated answer to "does setup + node + Minecraft work right now".

## Topology

- `catalyst-e2e-panel` (default `10.0.3.50`): runs the official `install.sh -y`
  stack (postgres + redis + backend + frontend). This is what users install.
- Node (agent), two modes via `E2E_NODE_MODE`:
  - `host` (default): an isolated second agent on this host with its own
    config, data dir (`/var/lib/catalyst-e2e`), containerd namespace
    (`catalyst-e2e`), CNI plugin set, bridge (`catalyst-e2e0`/`10.44.0.0/16`)
    and SFTP port (2222). The host's own agent is never touched. Game ports
    bind on the host; probe them via `E2E_HOST_LXCBR_IP` (`10.0.3.1`).
  - `lxc`: the agent deploys into `catalyst-e2e-node` (default `10.0.3.51`).
    Only viable with a **privileged** container — unprivileged LXCs cannot
    loop-mount the agent's ext4 disk images (`mount failed: Operation not
    permitted`), so server start fails there.

No host TCP proxies: the host reaches `10.0.3.x` directly over `lxcbr0`.

## Prerequisites

```bash
sudo apt install -y lxc curl jq python3
```

The pipeline creates unprivileged Ubuntu `jammy` LXCs with nesting enabled
(containerd inside the node LXC needs it).

## Quick start

```bash
# Full run (create → install → bootstrap → agent → minecraft → verify)
./tests/e2e-lxc/e2e-minecraft.sh all

# Resume / iterate per stage
./tests/e2e-lxc/e2e-minecraft.sh create
./tests/e2e-lxc/e2e-minecraft.sh install
./tests/e2e-lxc/e2e-minecraft.sh bootstrap
./tests/e2e-lxc/e2e-minecraft.sh agent
./tests/e2e-lxc/e2e-minecraft.sh minecraft
./tests/e2e-lxc/e2e-minecraft.sh verify
./tests/e2e-lxc/e2e-minecraft.sh status
./tests/e2e-lxc/e2e-minecraft.sh destroy
```

Each stage writes `~/.local/share/catalyst-e2e-lxc/logs/stage-<name>.log` and
updates `junit.xml` there for CI.

## Configuration

Environment variables (or `CONFIG=/path/to.env ./...`); see `config.env`:

| Variable | Default | Meaning |
|---|---|---|
| `E2E_PANEL_LXC` / `E2E_NODE_LXC` | `catalyst-e2e-panel` / `catalyst-e2e-node` | LXC names |
| `E2E_PANEL_IP` / `E2E_NODE_IP` | `10.0.3.50` / `10.0.3.51` | Static LXC IPs |
| `E2E_USE_LOCAL` | `0` | `1` pushes the working tree `install.sh` + `catalyst-docker/`; `0` downloads `install.sh` from GitHub like a user (curl path) |
| `E2E_TEMPLATES` | `paper` | `paper` imports just Paper; `all` imports all ~250 eggs under `eggs/` too |
| `E2E_MC_VERSION` / `E2E_MC_BUILD` | `1.21.11` / `132` | Pinned PaperMC coordinates. `latest` tracks bleeding edge (26.x, Java 25+ only) and its metadata drifts, breaking the egg's URL building |
| `E2E_MC_VERSION` / `E2E_MC_BUILD` | `latest` / `latest` | PaperMC Fill API version selectors |
| `E2E_MC_IMAGE_VARIANT` | `Java 21` | Must match `egg-paper.json` `docker_images` |
| `E2E_KEEP_ON_SUCCESS` | `0` | `1` keeps LXCs after `all` for debugging |

## What it verifies (and why users hit these)

1. **install** — `install.sh -y` exits 0, `.env` has generated secrets,
   `docker compose up -d` reaches backend `/health` and panel `/`.
2. **bootstrap** — `/api/setup/complete` + login, location, node with
   `publicAddress=<node-ip>`, allocation for the MC port, Paper egg import.
3. **agent** — single-use `/api/nodes/:id/deployment-token` → Bearer fetch of
   `/api/deploy/:token` → `deploy-agent.sh` in the node LXC → node `isOnline`.
4. **minecraft** — server create (`bridge`, `primaryPort`), async install to
   `stopped`/`running`, `server.jar` visible via file explorer (catches
   mount-namespace splits), start, EULA accept when prompted, `running`,
   TCP probe to `<node-ip>:25565`.
5. **verify** — re-checks health + `running` + port on a finished run.

Unlike `scripts/lxc-lab`, this pipeline never live-patches running backend
containers (old `cron-parser` / WS payload / S3 shims). Those source fixes
already landed; E2E must test the image as shipped and fail if the published
image regresses.

## Outputs

- `~/.local/share/catalyst-e2e-lxc/state.env` — ids/tokens for resume.
- `logs/stage-*.log` — per-stage transcript.
- `junit.xml` — one `<testcase>` per stage for CI.
- `logs/{setup,login,node,import-paper,deploy-token,create-minecraft}.json`.

## Cleaning up

```bash
./tests/e2e-lxc/e2e-minecraft.sh destroy
```

This deletes both LXCs and the cookie jar; logs and `junit.xml` are kept.

## Findings from the first full run (kept here so they stay fixed)

- **LXC AppArmor ordering**: `nesting.conf` sets
  `lxc.apparmor.profile=lxc-container-default-with-nesting` and LXC is
  last-wins. Appending the include after the template's `unconfined` line
  silently confines the container; recursive bind mounts then fail and
  `docker pull` dies extracting layers (`permission denied` on
  `tmpmounts`). The pipeline re-affirms `unconfined` after the include.
- **Backend health probe**: `install.sh` leaves `BACKEND_PORT` loopback-bound
  by default, so the pipeline probes `/health` from inside the panel LXC and
  uses the frontend URL for all API traffic — exactly like real users.
- **CNI plugin age**: distro packages can predate the 1.0.0 CNI spec (Ubuntu
  jammy ships 0.9.1). Containers get IPs but DNS stays broken. Both
  `deploy-agent.sh` (new version gate → pinned v1.9.0 tarball) and this
  pipeline's host agent (isolated v1.9.0 set) require 1.0.0-spec plugins.
- **Java/images**: Fill `latest` currently resolves to Paper 26.x, which needs
  the `Java 25` egg image — `Java 21` boots to
  `Minecraft 26.1 and newer requires ... Java 25 or above` and crashes.
- **Stale NAT is now self-healing**: killing an agent mid-lifecycle used to
  orphan DNAT rules and IPAM leases, and duplicates accumulated until the
  first match blackholed the port (`No route to host` on a `running`
  server). The agent now sweeps dead-container NAT (DNAT/MASQUERADE/CNI
  chains, exact duplicates) at startup, releases orphaned IPAM leases, and
  skips `-A` for rules that already exist. Verified live: 7 orphaned rules
  removed on restart, zero references left, lab rules untouched.
