# Catalyst — Standalone Docker/Podman Deployment

Uses pre-built images from [GitHub Container Registry](https://github.com/catalystctl/catalyst/pkgs/container/catalyst-backend).

> **Note:** This compose file is tuned for **podman-compose**. If using Docker Compose v2, the `$$` variable escapes in the upstream template work natively and some of the workarounds below can be reverted.

## Prerequisites

- **Podman** (rootless) or Docker
- Ports **8080**, **3000**, **2022**, **5432**, **6379** available

### Rootless Podman — Privileged Ports

Podman rootless cannot bind ports below 1024 by default. Two options:

1. **Use a high port (default in this setup)** — Frontend binds to `8080` instead of `80`.
2. **Allow privileged ports** — Add `net.ipv4.ip_unprivileged_port_start=80` to `/etc/sysctl.conf` and run `sudo sysctl -p`.

## Quick Start

### 1. Copy and configure `.env`

```bash
cp .env.example .env
```

Edit `.env`. The three **required** values:

| Variable | Description | Example |
|---|---|---|
| `PUBLIC_URL` | Full URL to access the panel | `http://192.168.1.78:8080` |
| `POSTGRES_PASSWORD` | Strong password for PostgreSQL | `my-db-password` |
| `BETTER_AUTH_SECRET` | Generate with `openssl rand -base64 32` | `a1b2c3...` |

### 2. Configure for your network

If exposing on your LAN (not just localhost), update these in `.env`:

```bash
PUBLIC_URL=http://<YOUR_LAN_IP>:8080
PASSKEY_RP_ID=<YOUR_LAN_IP>
FRONTEND_PORT=0.0.0.0:8080
BACKEND_PORT=0.0.0.0:3000
SFTP_PORT=0.0.0.0:2022
```

Find your LAN IP with `hostname -I | awk '{print $1}'`.

### 3. Start the stack

```bash
podman compose up -d
```

Wait for all four containers to become healthy. `podman-compose` may appear to hang — it waits for healthchecks. Verify in another terminal:

```bash
podman ps
```

Expected output — all four containers `Up` with postgres/redis/backend showing `(healthy)`:

| Container | Status | Port |
|---|---|---|
| catalyst-postgres | healthy | 127.0.0.1:5432 |
| catalyst-redis | healthy | 127.0.0.1:6379 |
| catalyst-backend | healthy | 127.0.0.1:3000, 127.0.0.1:2022 |
| catalyst-frontend | running | 0.0.0.0:8080 |

### 4. Seed the database (optional)

Creates a default admin user and example data:

```bash
podman exec -e NODE_ENV=development catalyst-backend bun run db:seed
```

Default credentials: **admin@example.com** / **admin123** — change immediately after login.

> The `config.toml` write error during seeding is expected in Docker (no sibling `catalyst-agent/` directory). Ignore it.

### 5. Access the panel

Open `PUBLIC_URL` in your browser (e.g. `http://192.168.1.78:8080`).

If you didn't seed, the **first user to register becomes the administrator**.

## Ports

| Port | Service | Default Bind | Description |
|---|---|---|---|
| 8080 | Frontend (nginx) | `0.0.0.0:8080` | Web panel |
| 3000 | Backend API | `0.0.0.0:3000` | REST API / WebSocket |
| 2022 | SFTP | `0.0.0.0:2022` | File upload/download |
| 5432 | PostgreSQL | `127.0.0.1:5432` | Database (local only) |
| 6379 | Redis | `127.0.0.1:6379` | Cache/sessions (local only) |

## Volumes

All data is persisted in named volumes:

| Volume | Purpose |
|---|---|
| `catalyst-postgres-data` | PostgreSQL database |
| `catalyst-server-data` | Server files |
| `catalyst-backup-data` | Backup archives |
| `catalyst-plugin-data` | Installed plugins |

### HTTPS / HSTS

The backend sets aggressive security headers in `NODE_ENV=production`:

- `Strict-Transport-Security` (HSTS) — forces browser to use HTTPS
- `upgrade-insecure-requests` in CSP — auto-upgrades http to https

If you're running over **plain HTTP** (no TLS/reverse proxy), you **must** set `NODE_ENV=development` in `.env`. Otherwise browsers will cache HSTS and refuse to load `http://` resources, breaking deploy scripts and the panel.

For production with HTTPS, set `NODE_ENV=production` and place a reverse proxy (Caddy, nginx, Traefik) in front to terminate TLS.

## Updating

```bash
podman compose pull
podman compose up -d
```

## Troubleshooting

### `podman compose up -d` hangs

This is normal — `podman-compose` waits for all healthchecks to pass before returning. Check progress in another terminal with `podman ps`. If it stays stuck for more than 2-3 minutes, check individual container logs:

```bash
podman logs catalyst-backend
podman logs catalyst-redis
podman logs catalyst-postgres
```

### Redis healthcheck failing

The healthcheck must use `CMD-SHELL` string form (not JSON array) for podman compatibility. The compose file is already patched for this.

### Backend crash loop on SFTP key

If `SFTP_HOST_KEY` or `SFTP_HOST_KEY_BASE64` aren't set in `.env`, the backend auto-generates a key. If podman-compose passes literal `${VAR:-}` strings instead of empty values, set them explicitly in `.env`:

```bash
SFTP_HOST_KEY=
SFTP_HOST_KEY_BASE64=
```

### `rootlessport cannot expose privileged port 80`

Use port 8080 (default), or allow privileged ports:
```bash
echo 'net.ipv4.ip_unprivileged_port_start=80' | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
```

## Adding Nodes

Nodes connect to the backend via WebSocket. Generate a deploy token from the panel's node management page, then run the deploy command on the target node.

## S3 Backups (optional)

Set in `.env`:

```bash
BACKUP_STORAGE_MODE=s3
BACKUP_S3_BUCKET=my-catalyst-backups
BACKUP_S3_REGION=us-east-1
BACKUP_S3_ACCESS_KEY=AKIA...
BACKUP_S3_SECRET_KEY=...
```
