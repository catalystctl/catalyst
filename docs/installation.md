# Installation Guide

> **🐳 Docker is the only supported way to run Catalyst.** All production deployments use Docker Compose or Podman Compose.

> **📚 Looking for the 5-minute version?** → [Quick Start](QUICKSTART.md)  
> **📖 Want every option explained in depth?** → [Detailed Installation](INSTALLATION_DETAILED.md)

Complete instructions for deploying **Catalyst** with Docker Compose. This guide covers everything you need to get the panel running, configured, and secured.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Option 1: One-Line Install (Recommended)](#option-1-one-line-install-recommended)
- [Option 2: Standalone Docker / Podman](#option-2-standalone-docker--podman)
- [Option 3: Build from Source](#option-3-build-from-source)
- [Post-Install Steps](#post-install-steps)
  - [First-Run Setup](#first-run-setup)
  - [Verify the Stack](#verify-the-stack)
  - [Access the Panel](#access-the-panel)
- [Environment Configuration](#environment-configuration)
  - [Required Variables](#required-variables)
  - [General, Database, Redis, Ports](#general-database-redis-ports)
  - [SFTP](#sftp)
  - [Backups](#backups)
  - [Optional Features](#optional-features)
- [TLS / HTTPS](#tls--https)
- [Development Setup](#development-setup)
- [Upgrading](#upgrading)
- [Quick Troubleshooting](#quick-troubleshooting)

---

## Prerequisites

| Requirement | Minimum | Recommended |
|---|---|---|
| **OS** | Any Linux with Docker/Podman | Ubuntu 22.04+ / Debian 12+ |
| **Container Runtime** | Docker 20.10+ or Podman 4.0+ | Docker 26+ (rootless) |
| **Docker Compose** | V2 plugin or `podman-compose` | Latest stable |
| **CPU** | 2 cores | 4+ cores |
| **RAM** | 2 GB | 4+ GB |
| **Disk** | 10 GB (panel only) | SSD with 50+ GB |
| **Open Ports** | 80 (or 8080), 3000, 2022 | 80, 443, 2022 |

> **Note:** Docker Compose (Docker or Podman) is the **only supported deployment method**. Direct bare-metal installation is not supported.

---

## Option 1: One-Line Install (Recommended)

The fastest way to get Catalyst running — no repo clone needed:

```bash
curl -fsSL https://raw.githubusercontent.com/catalystctl/catalyst/main/install.sh | bash
```

**What it does:** checks Docker/Compose, downloads the `catalyst-docker/` folder, generates secure secrets, and creates `.env`.

**Then:**

```bash
cd catalyst-docker
nano .env          # Set PUBLIC_URL at minimum
docker compose up -d
```

> **Tip:** Complete the **Setup** wizard on first visit to create the administrator. No seeding required. Open registration is disabled after setup.
>
> After installation, follow [Getting Started](./getting-started.md) for your first admin setup.

For Podman, use `podman compose up -d` instead of `docker compose up -d`.

📖 See [Detailed Installation](INSTALLATION_DETAILED.md) for a breakdown of everything the install script does, Podman quirks, and LAN exposure settings.

---

## Option 2: Standalone Docker / Podman

The `catalyst-docker/` directory is self-contained with **pre-built images** from GitHub Container Registry — no build step.

### Docker

```bash
git clone https://github.com/catalystctl/catalyst.git
cd catalyst/catalyst-docker
cp .env.example .env
nano .env
docker compose up -d
```

### Podman (Rootless)

```bash
git clone https://github.com/catalystctl/catalyst.git
cd catalyst/catalyst-docker
cp .env.example .env
nano .env
podman compose up -d
```

> `podman-compose` may appear to hang while waiting for healthchecks. Check `podman ps` in another terminal. All four containers should show `Up` with postgres/redis/backend marked `(healthy)`.

### Podman — Privileged Ports

Rootless Podman cannot bind ports below 1024. Either use port 8080 (default), or allow privileged ports:

```bash
echo 'net.ipv4.ip_unprivileged_port_start=80' | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
```

### LAN Exposure

If exposing on your local network:

```env
PUBLIC_URL=http://<YOUR_LAN_IP>:8080
PASSKEY_RP_ID=<YOUR_LAN_IP>
FRONTEND_PORT=0.0.0.0:8080
BACKEND_PORT=0.0.0.0:3000
SFTP_PORT=0.0.0.0:2022
```

Find your LAN IP with `hostname -I | awk '{print $1}'`.

📖 Full Docker service reference, volume management, and production hardening: [Docker Setup](./docker-setup.md).

---

## Option 3: Build from Source

For development or when pre-built images aren't suitable:

```bash
git clone https://github.com/catalystctl/catalyst.git
cd catalyst
```

**Backend:**

```bash
cd catalyst-backend
cp .env.example .env
nano .env  # Set DATABASE_URL and BETTER_AUTH_SECRET
pnpm install
pnpm run db:generate
pnpm run db:push
pnpm run db:seed   # dev only
```

**Frontend:**

```bash
cd ../catalyst-frontend
pnpm install
```

**Start everything:**

```bash
cd ..         # back to repo root
pnpm run dev   # backend + frontend with hot reload
```

> **See also:** [Development Guide](./development.md) for the complete developer guide including testing, plugin development, and PR process.

---

## Post-Install Steps

### First-Run Setup

When you first visit your Catalyst URL:

1. The wizard detects no users exist
2. Complete the **Setup** wizard — the admin account you create becomes the administrator
3. Optionally configure SMTP, panel branding, and OAuth from the admin panel

> **Seed alternative:** Run `docker exec -e NODE_ENV=development catalyst-backend pnpm run db:seed` to create a default admin (`admin@example.com` / `admin123`). **Change this password immediately.**

### Verify the Stack

```bash
docker compose ps
# or
podman ps
```

Expected — four containers running:

| Container | Status | Image |
|---|---|---|
| catalyst-postgres | healthy | postgres:16-alpine |
| catalyst-redis | healthy | redis:7-alpine |
| catalyst-backend | healthy | ghcr.io/catalystctl/catalyst-backend:latest |
| catalyst-frontend | running | ghcr.io/catalystctl/catalyst-frontend:latest |

### Access the Panel

| Service | URL |
|---|---|
| **Web Panel** | Your `PUBLIC_URL` (e.g. `http://localhost:8080`) |
| **REST API** | `http://localhost:3000/api` |
| **API Docs** | `http://localhost:3000/docs` |
| **SFTP** | `localhost:2022` |

The backend's `/health` endpoint returns `200 OK` when ready.

---

## Environment Configuration

All config lives in `.env` inside `catalyst-docker/`. Copy `.env.example` as a starting point.

📖 For the full 60+ variable reference with defaults and security recommendations, see [Environment Variables](./environment-variables.md).  
📖 For Docker service architecture, volume management, and production hardening, see [Docker Setup](./docker-setup.md).

### Required Variables

| Variable | Description | Example |
|---|---|---|
| `PUBLIC_URL` | Exact URL users type into their browser (no trailing slash) | `http://your-domain.com` or `http://192.168.1.100:8080` |
| `POSTGRES_PASSWORD` | PostgreSQL database password | Generate: `openssl rand -base64 32 \| tr -d '/+=' \| head -c 32` |
| `BETTER_AUTH_SECRET` | Session encryption key | Generate: `openssl rand -base64 32` |

> **`PUBLIC_URL` is the single source of truth.** It automatically drives `BETTER_AUTH_URL`, `CORS_ORIGIN`, `FRONTEND_URL`, `BACKEND_EXTERNAL_ADDRESS`, and `BACKEND_URL`.

### General, Database, Redis, Ports

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | Set to `production` when behind TLS. Enables HSTS and aggressive security headers. |
| `TZ` | `UTC` | Timezone in IANA format |
| `LOG_LEVEL` | `info` | Pino log level: trace → debug → info → warn → error |
| `APP_NAME` | `Catalyst` | Panel name shown in emails and UI |
| `POSTGRES_USER` | `catalyst` | PostgreSQL username |
| `POSTGRES_DB` | `catalyst_db` | Database name |
| `POSTGRES_PORT` | `127.0.0.1:5432` | Host port binding. Not exposed to the network by default. |
| `REDIS_PASSWORD` | *(empty)* | Redis auth password |
| `REDIS_PORT` | `127.0.0.1:6379` | Host port binding |
| `FRONTEND_PORT` | `0.0.0.0:8080` | Web panel port |
| `BACKEND_PORT` | `127.0.0.1:3000` | Backend API port |
| `SFTP_PORT` | `0.0.0.0:2022` | SFTP server port |

> The backend entrypoint automatically runs `prisma migrate deploy` on every startup. For a fresh database, run `db:seed` to initialize sample data.

### SFTP

| Variable | Default | Description |
|---|---|---|
| `SFTP_ENABLED` | `true` | Enable/disable built-in SFTP server |
| `SFTP_MAX_FILE_SIZE` | `104857600` | Max upload size in bytes (100 MB) |
| `SFTP_HOST_KEY` | *(auto-generate)* | SSH host key path. Leave empty to auto-generate. |
| `SFTP_HOST_KEY_BASE64` | *(empty)* | Base64-encoded host key (alternative) |

> **Podman:** set `SFTP_HOST_KEY=` and `SFTP_HOST_KEY_BASE64=` explicitly in `.env` to avoid interpolation issues.

### Backups

| Variable | Default | Description |
|---|---|---|
| `BACKUP_STORAGE_MODE` | `local` | `local`, `s3`, or `stream` |
| `BACKUP_CREDENTIALS_ENCRYPTION_KEY` | *(empty)* | Required for S3. Generate: `openssl rand -hex 32`. **If lost, credentials are unrecoverable.** |

When `BACKUP_STORAGE_MODE=s3`, also set `BACKUP_S3_BUCKET`, `BACKUP_S3_REGION`, `BACKUP_S3_ACCESS_KEY`, `BACKUP_S3_SECRET_KEY`, and optionally `BACKUP_S3_ENDPOINT` and `BACKUP_S3_PATH_STYLE` (set `true` for MinIO).

### Optional Features

```env
# Webhooks
WEBHOOK_URLS=https://your-webhook.example.com/notify
WEBHOOK_SECRET=your-webhook-signing-secret

# Auto-Updater
AUTO_UPDATE_ENABLED=false
AUTO_UPDATE_INTERVAL_MS=3600000
AUTO_UPDATE_AUTO_TRIGGER=false

# Suspension Policies
SUSPENSION_ENFORCED=true
SUSPENSION_DELETE_BLOCKED=false
SUSPENSION_DELETE_POLICY=keep
```

---

## TLS / HTTPS

### Caddy (Zero-Config)

```env
DOMAIN=panel.example.com
ACME_EMAIL=admin@example.com
PUBLIC_URL=https://panel.example.com
NODE_ENV=production
```

```bash
docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d
```

Caddy handles certificate issuance, renewal, and HTTP→HTTPS redirects automatically.

### Traefik (Docker-Native)

Same `.env` as Caddy, then:

```bash
docker compose -f docker-compose.yml -f docker-compose.traefik.yml up -d
```

Traefik dashboard: `http://127.0.0.1:8080` (localhost only).  
> **Security:** Never expose the Traefik dashboard on `0.0.0.0` without authentication. Set `TRAEFIK_DASHBOARD_PORT=` to disable.

### Manual Reverse Proxy

The recommended approach is to **proxy everything to the bundled frontend
nginx container** and let its internal routing handle `/ws`, `/api/`,
`/auth/`, `/docs`, and static assets.

> **Do NOT add a separate `/ws` block in your external proxy.** The bundled
> nginx (`frontend` container) already has optimized `/ws`, `/api/`, `/auth/`,
> `/docs`, and static asset routing with correct buffering, timeouts, and
> WebSocket upgrade headers. Adding a separate `/ws` location in your external
> proxy bypasses these settings and can cause console streaming failures,
> truncated responses, and agent disconnections.

Use your own reverse proxy (nginx, Caddy standalone, etc.).

```env
PUBLIC_URL=https://panel.example.com
NODE_ENV=production
BACKEND_EXTERNAL_ADDRESS=https://panel.example.com
```

Example nginx config:

```nginx
server {
    listen 443 ssl http2;
    server_name panel.example.com;

    ssl_certificate     /etc/letsencrypt/live/panel.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/panel.example.com/privkey.pem;

    client_max_body_size 100m;

    location / {
        proxy_pass http://127.0.0.1:80;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket support (agent connections, admin event stream)
    location /ws {
        proxy_pass http://127.0.0.1:80;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```

### HSTS and NODE_ENV

When `NODE_ENV=production`, the backend sets:
- `Strict-Transport-Security` (HSTS) — forces HTTPS for 1 year
- `upgrade-insecure-requests` in CSP

**Never set `NODE_ENV=production` with plain HTTP.** Browsers will cache HSTS and refuse to load `http://` resources.

### PASSKEY_RP_ID

WebAuthn/Passkey requires `PASSKEY_RP_ID` to exactly match your domain:

```env
# For http://localhost:8080       → PASSKEY_RP_ID=localhost
# For https://panel.example.com   → PASSKEY_RP_ID=panel.example.com
# For LAN                         → PASSKEY_RP_ID=192.168.1.100
```

No protocol, no port — bare hostname or IP only.

📖 For full TLS configuration details, certificate automation, and reverse-proxy examples: [Detailed Installation](INSTALLATION_DETAILED.md).

---

## Development Setup

Catalyst uses a **pnpm** workspace monorepo. Requirements:

- [Node.js](https://nodejs.org/) >= 22 + [pnpm](https://pnpm.io/) >= 8
- Docker or Podman (for PostgreSQL, Redis)
- Rust toolchain (for the agent)

**Quick start:**

```bash
pnpm install              # install all workspace deps
pnpm run dev:infra        # start PostgreSQL + Redis
pnpm run dev              # backend + frontend with hot reload
pnpm run dev:agent        # Rust agent locally (needs root)
```

| Command | Description |
|---|---|
| `pnpm run dev` | Start backend + frontend (hot reload) |
| `pnpm run dev:agent` | Run Rust agent locally |
| `pnpm run build` | Build all packages |
| `pnpm run db:seed` | Seed database with sample data |
| `pnpm run db:studio` | Open Prisma Studio GUI |
| `pnpm run test` | Run Vitest test suite |
| `pnpm run lint` | Run ESLint on all packages |

> **See also:** [Development Guide](./development.md) for the complete developer guide.

---

## Upgrading

### Docker Compose (Recommended)

```bash
docker compose pull
docker compose up -d
```

The backend automatically runs `prisma migrate deploy` on startup. After upgrading, verify agents are connected in the admin panel.

### With Git (Source Builds)

```bash
git pull origin main
docker compose up -d --build
```

### One-Line Install

Re-run the installer — it updates `catalyst-docker/` in place, preserving `.env`:

```bash
curl -fsSL https://raw.githubusercontent.com/catalystctl/catalyst/main/install.sh | bash
```

---

## Quick Troubleshooting

| Problem | Quick Fix |
|---|---|
| Docker Compose hangs on start | It waits for healthchecks (1–3 min). Check `docker compose ps`. |
| PostgreSQL connection error | Verify container: `docker compose ps postgres`. Check `POSTGRES_PASSWORD` in `.env`. |
| Redis warning | Redis is optional. Safe to ignore unless using rate limiting or caching. |
| SFTP refused | Check `SFTP_ENABLED=true` and port mapping. Podman: set `SFTP_HOST_KEY=` explicitly. |
| Podman port 80 error | Use port 8080, or run: `echo 'net.ipv4.ip_unprivileged_port_start=80' \| sudo tee -a /etc/sysctl.conf && sudo sysctl -p` |
| Port already in use | `ss -tlnp \| grep :3000` then change in `.env` |
| Backend crash loop | Check `BETTER_AUTH_SECRET` and `DATABASE_URL` are set. Check `docker compose logs -f backend`. |

📖 For comprehensive troubleshooting — debug logging, agent issues, CORS errors, plugin failures, and performance tuning: [Troubleshooting](./troubleshooting.md).  
📖 For deep-dive environment variable explanations and config issue matrix: [Detailed Installation](INSTALLATION_DETAILED.md).
