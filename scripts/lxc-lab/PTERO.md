# Pterodactyl migration LXC fixture

Repeatable source panel for Catalyst's Pterodactyl importer. It is **isolated**
from the Catalyst panel/backend LXCs: one panel and three Wings Ubuntu guests,
official Pterodactyl images, deterministic IPs/ports, seeded keys, and a Catalyst
`/api/admin/migration` verification stage.

Invoke with `bash scripts/lxc-lab/lab.sh <stage>` (`lab.sh` can lose `+x`).

## Topology

```
host ${HOST_LAN_IP}
  tcp-proxy 8080  → 10.0.3.21:8080   catalyst-panel
  tcp-proxy 3000  → 10.0.3.20:3000   catalyst-backend
  tcp-proxy 8090  → 10.0.3.30:80     ptero-panel   (official ghcr.io/pterodactyl/panel)
  tcp-proxy 8081  → 10.0.3.31:8080   ptero-wings   (official ghcr.io/pterodactyl/wings)
  tcp-proxy 2023  → 10.0.3.31:2022   Wings SFTP
  direct            10.0.3.34:8080   ptero-wings-02
  direct            10.0.3.35:8080   ptero-wings-03
```

| Guest | Default IP | Role |
| --- | --- | --- |
| `ptero-panel` | `10.0.3.30` | Panel + MariaDB + Redis (HTTP, no TLS) |
| `ptero-wings` | `10.0.3.31` | Wings daemon for source node 1 |
| `ptero-wings-02` | `10.0.3.34` | Wings daemon for source node 2 |
| `ptero-wings-03` | `10.0.3.35` | Wings daemon for source node 3 |

Wings `fqdn` is the Wings IP so the Catalyst backend LXC (`10.0.3.20`) can
reach signed backup downloads without extra `/etc/hosts` entries.
`scheme=http`, `daemon_listen=8080`, `daemon_sftp=2022`, `behind_proxy=false`.

Images default to pinned official tags (`panel:v1.11.11`, `wings:v1.11.13`)
and can be overridden with `PTERO_PANEL_IMAGE` / `PTERO_WINGS_IMAGE`.

## Stages

| Command | What it does |
| --- | --- |
| `ptero-create` | Create/start the two LXCs and write static netplan |
| `ptero-docker` | Install Docker Engine + Compose plugin in both guests |
| `ptero-deploy` | Push compose from the **host** via `push_file`, start the panel stack |
| `ptero-seed` | Admin + subuser, `ptla_*`/`ptlc_*` keys, location/node/allocs/Paper server, Wings `config.yml`, tiny volume files, one schedule |
| `ptero-bulk` | Provision/configure nodes 2/3 as real Wings LXCs, then idempotently seed exactly 50 stopped servers across the 3 nodes |
| `ptero-status` | Probe panel/Wings and print stored IDs/keys |
| `ptero` | create → docker → deploy → seed → status |
| `ptero-migrate` | Catalyst `migration/test` + `migration/start` (full scope) + poll to `completed` |
| `ptero-destroy` | Stop/destroy only the Ptero LXCs and their host forwards |
| `destroy` | Catalyst LXCs **and** Ptero LXCs + all `fwd-*.pid` |

`ptero-bulk` is safe to rerun and verifies the exact server/node/template distribution. On its first run it creates `ptero-wings-02` and `ptero-wings-03`, installs Docker, writes each node's API configuration, and starts Wings; this provisioning can take several minutes. It does not start a migration. Run `ptero-migrate` only after reviewing the 50-server preview.

`ptero` is **not** part of `lab.sh all`. Bring the Catalyst lab up first
(`create` … `agent` at minimum) so `ptero-migrate` has an online target node.

## Seed contract

Written to `$STATE_DIR/state.env` (`~/.local/share/catalyst-lxc-lab` by default):

- `PTERO_URL` — `http://10.0.3.30`
- `PTERO_APP_KEY` — Application key (`ptla_*`, all resources read+write)
- `PTERO_CLIENT_KEY` — Client key (`ptlc_*`) for the root admin
- `PTERO_NODE_ID`, `PTERO_SERVER_ID`, `PTERO_SERVER_UUID`
- `PTERO_ALLOC_IP` / `PTERO_ALLOC_PORT` (primary `10.0.3.31:25565`) plus extra `25566`

The Paper-like server is **tiny on purpose**: `skip_scripts=true` and a few
bytes under `/var/lib/pterodactyl/volumes/<uuid>` so the importer's in-memory
backup download stays small. `feature_limits.backups=2` so the files phase can
create a backup.

Default Ptero login: `admin@ptero.local` / `PteroLab!2026` (not the Catalyst
lab admin).

## Verify a migration

```bash
bash scripts/lxc-lab/lab.sh create docker deploy bootstrap agent
bash scripts/lxc-lab/lab.sh ptero
bash scripts/lxc-lab/lab.sh ptero-migrate
```

`ptero-migrate` asserts:

1. `POST /api/admin/migration/test` succeeds with `stats.nodes/servers/locations >= 1`.
2. The review payload contains the Wings FQDN, HTTP scheme, daemon/SFTP ports,
   and both source allocations (`25565`, `25566`), with `25565` marked primary.
3. `POST /api/admin/migration/start` uses `scope=full` and maps the source node
   to `$NODE_ID`; the job reaches `completed` with no failed steps.
4. Catalyst creates `Ptero Paper` with primary port `25565`, both port bindings,
   and two `NodeAllocation` rows linked to the migrated server.
5. The migrated file explorer contains `eula.txt`, `server.properties`, and
   `server.jar` from the Wings volume.

`lab.sh admin` also uses `{url,key}` for the negative migration test. If
`PTERO_APP_KEY` is already in `state.env`, it additionally hits the live fixture.

## Cleanup

```bash
bash scripts/lxc-lab/lab.sh ptero-destroy   # Ptero guests only
bash scripts/lxc-lab/lab.sh destroy         # everything, including Catalyst
```

Stages are idempotent: existing LXCs, compose stacks, users, keys, nodes,
allocations, and servers are reused or reconciled instead of recreated. Override
extra Wings names/IPs with `PTERO_BULK_WINGS_LXCS` and
`PTERO_BULK_WINGS_IPS`; defaults are `.34` and `.35` because `.32` is occupied.
