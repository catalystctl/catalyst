# Installation Guide

Complete instructions for deploying **Catalyst**, a production-grade game server management panel built with Fastify, React, and PostgreSQL.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Option 1: One-Line Install (Recommended)](#option-1-one-line-install-recommended)
- [Option 2: Standalone Docker / Podman](#option-2-standalone-docker--podman)
- [Option 3: Build from Source](#option-3-build-from-source)
- [Post-Install Steps](#post-install-steps)
  - [First-Run Setup Wizard](#first-run-setup-wizard)
  - [Verify the Stack](#verify-the-stack)
  - [Access the Panel](#access-the-panel)
- [Environment Configuration](#environment-configuration)
  - [Required Variables](#required-variables)
  - [General Settings](#general-settings)
  - [Database](#database)
  - [Redis](#redis)
  - [Ports](#ports)
  - [SFTP](#sftp)
  - [Backups](#backups)
  - [Optional Features](#optional-features)
- [TLS / HTTPS](#tls--https)
  - [Caddy (Zero-Config)](#caddy-zero-config)
  - [Traefik (Docker-Native)](#traefik-docker-native)
  - [Manual Reverse Proxy](#manual-reverse-proxy)
- [Development Setup](#development-setup)
- [Upgrading](#upgrading)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

| Requirement | Minimum | Recommended |
|---|---|---|
| **OS** | Any Linux with Docker/Podman | Ubuntu 22.04+ / Debian 12+ |
| **Container Runtime** | Docker 20.10+ or Podman 4.0+ | Docker 26+ (rootless) |
| **Docker Compose** | V2 plugin (`docker compose`) or `podman-compose` | Latest stable |
| **CPU** | 2 cores | 4+ cores |
| **RAM** | 2 GB | 4+ GB |
| **Disk** | 10 GB (panel only) | SSD with 50+ GB |
| **Open Ports** | 80 (or 8080), 3000, 2022 | 80, 443, 2022 |

> **Note:** Docker Compose (Docker or Podman) is the **only supported deployment method**. Direct installation on bare metal is not supported.

---

## Option 1: One-Line Install (Recommended)

The fastest way to get Catalyst running — no need to clone the full repository:

```bash
curl -fsSL https://raw.githubusercontent.com/catalystctl/catalyst/main/install.sh | bash
```text

**What the script does:**

1. Checks that Docker and Docker Compose are installed and the daemon is running
2. Verifies `curl`, `tar`, and `openssl` are available
3. Downloads the `catalyst-docker/` folder from the latest `main` branch
4. Copies `.env.example` to `.env`
5. Generates strong `POSTGRES_PASSWORD` (32 chars) and `BETTER_AUTH_SECRET`
6. Preserves existing `.env` if it already exists (backs up to `.env.backup.PID`)

**After the script completes:**

```bash
cd catalyst-docker
# 1. Edit your configuration
nano .env

# 2. Start the stack
docker compose up -d

# 3. Verify containers are healthy
docker ps

# 4. (Optional) Seed the database with a default admin user
docker exec -e NODE_ENV=development catalyst-backend bun run db:seed
```

> **Tip:** If this is your first time, the **first user to register** automatically becomes the panel administrator. No seeding is required.
>
> After installation, follow the post-install walkthrough in [Getting Started](./getting-started.md) for your first admin setup.

---

## Option 2: Standalone Docker / Podman

The `catalyst-docker/` directory is a self-contained deployment using **pre-built images** from [GitHub Container Registry](https://github.com/catalystctl/catalyst/pkgs/container/catalyst-backend) — no build step needed.

### Docker

```bash
# Clone the repo (or download catalyst-docker/ separately)
git clone https://github.com/catalystctl/catalyst.git
cd catalyst/catalyst-docker

# Configure
cp .env.example .env
nano .env

# Start
docker compose up -d
```text

### Podman (Rootless)

```bash
# Clone the repo
git clone https://github.com/catalystctl/catalyst.git
cd catalyst/catalyst-docker

# Configure
cp .env.example .env
nano .env

# Start with podman-compose
podman compose up -d
```

> **Podman note:** `podman-compose` may appear to hang — it waits for healthchecks to pass. Check progress in another terminal with `podman ps`. All four containers should show `Up` with postgres/redis/backend marked `(healthy)`.

### Podman — Privileged Ports

Rootless Podman cannot bind ports below 1024 by default. Two options:

1. **Use high ports (default)** — Frontend binds to `8080` instead of `80`. No extra setup needed.
2. **Allow privileged ports** — Add `net.ipv4.ip_unprivileged_port_start=80` to `/etc/sysctl.conf`:

```bash
echo 'net.ipv4.ip_unprivileged_port_start=80' | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
```text

### LAN Exposure

If exposing the panel on your local network (not just localhost):

```env
# In .env
PUBLIC_URL=http://<YOUR_LAN_IP>:8080
PASSKEY_RP_ID=<YOUR_LAN_IP>
FRONTEND_PORT=0.0.0.0:8080
BACKEND_PORT=0.0.0.0:3000
SFTP_PORT=0.0.0.0:2022
```

Find your LAN IP with `hostname -I | awk '{print $1}'`.

---

## Option 3: Build from Source

For development or when pre-built images are not suitable:

### 1. Clone the Repository

```bash
git clone https://github.com/catalystctl/catalyst.git
cd catalyst
```text

### 2. Backend Dev Setup

```bash
cd catalyst-backend

# Create and configure .env
cp .env.example .env
nano .env  # Set DATABASE_URL and BETTER_AUTH_SECRET

# Install dependencies and generate Prisma client
bun install
bun run db:generate
bun run db:push

# Seed development data (dev only!)
bun run db:seed
```

### 3. Frontend Setup

```bash
cd ../catalyst-frontend
bun install
```text

### 4. Start Everything

```bash
# From the repository root
bun run dev
```

This starts the backend and frontend in parallel with hot reload.

> **Development scripts:** See the [Development Setup](#development-setup) section for the full list of commands.

---

## Post-Install Steps

### First-Run Setup Wizard

When you first visit your Catalyst URL, you'll see the setup wizard:

1. The wizard detects that no users exist
2. Register your first account — it becomes the **admin** automatically
3. Optionally configure SMTP, panel branding, and OAuth providers from the admin panel

> **Seed alternative:** If you prefer seeded data, run `docker exec -e NODE_ENV=development catalyst-backend bun run db:seed` to create a default admin (`admin@example.com` / `admin123`). **Change this password immediately** after first login.

### Verify the Stack

```bash
# Check all containers
docker compose ps
# or
podman ps

# Expected output — four containers running:
# catalyst-postgres   healthy   postgres:16-alpine
# catalyst-redis      healthy   redis:7-alpine
# catalyst-backend    healthy   ghcr.io/catalystctl/catalyst-backend:latest
# catalyst-frontend   running   ghcr.io/catalystctl/catalyst-frontend:latest
```text

### Access the Panel

| Service | URL |
|---|---|
| **Web Panel** | Your `PUBLIC_URL` (e.g., `http://localhost:8080`) |
| **REST API** | `http://localhost:3000/api` |
| **API Docs** | `http://localhost:3000/docs` |
| **SFTP** | `localhost:2022` |

The backend's `/health` endpoint returns `200 OK` when the service is ready.

---

## Environment Configuration

All configuration is done through the `.env` file in the `catalyst-docker/` directory. Copy `.env.example` as a starting point.

For the full variable reference, see [Environment Variables](./environment-variables.md).

For detailed Docker service architecture, volume management, and hardening, see [Docker Setup](./docker-setup.md).

### Required Variables

| Variable | Description | How to Generate |
|---|---|---|
| `PUBLIC_URL` | The exact URL users type into their browser (no trailing slash) | `http://your-domain.com` or `http://192.168.1.100:8080` |
| `POSTGRES_PASSWORD` | PostgreSQL database password | `openssl rand -base64 32 \| tr -d '/+=' \| head -c 32` |
| `BETTER_AUTH_SECRET` | Secret key for session encryption | `openssl rand -base64 32` |

> **`PUBLIC_URL` is the single source of truth.** It automatically drives `BETTER_AUTH_URL`, `CORS_ORIGIN`, `FRONTEND_URL`, `BACKEND_EXTERNAL_ADDRESS`, and `BACKEND_URL`. Only override those individually if you have a split DNS setup.

### General Settings

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | `production` enables HSTS and aggressive security headers. **Must be `production` when behind TLS.** |
| `TZ` | `UTC` | Timezone in IANA format (`America/New_York`, `Europe/London`) |
| `LOG_LEVEL` | `info` | Log verbosity: `trace` → `debug` → `info` → `warn` → `error` |
| `APP_NAME` | `Catalyst` | Panel name shown in emails, TOTP issuer, and OAuth display |

### Database

| Variable | Default | Description |
|---|---|---|
| `POSTGRES_USER` | `catalyst` | PostgreSQL username |
| `POSTGRES_DB` | `catalyst_db` | Database name |
| `POSTGRES_PORT` | `127.0.0.1:5432` | Host port binding (bind address + port) |

The PostgreSQL service (`catalyst-postgres`) binds to `127.0.0.1:5432` by default — it is not exposed to the network. If you need external access (e.g., pgAdmin, backup tools), change the bind address:

```env
POSTGRES_PORT=0.0.0.0:5432
```

> **Note:** The backend entrypoint automatically runs database migrations on every startup via `prisma migrate deploy`. For a fresh database, run `db:seed` to initialize the schema with sample data.

### Redis

| Variable | Default | Description |
|---|---|---|
| `REDIS_PASSWORD` | *(empty)* | Redis authentication password |
| `REDIS_PORT` | `127.0.0.1:6379` | Host port binding |

Redis is optional. If `REDIS_URL` is empty or Redis is unreachable, Redis-dependent features (rate limiting, caching, session store) are gracefully skipped.

```env
REDIS_PASSWORD=your-redis-password
# REDIS_URL is constructed automatically inside the backend container
```text

### Ports

| Variable | Default | Description |
|---|---|---|
| `FRONTEND_PORT` | `0.0.0.0:8080` | Web panel (nginx) port |
| `BACKEND_PORT` | `127.0.0.1:3000` | Backend API port |
| `SFTP_PORT` | `0.0.0.0:2022` | SFTP server port |

> **Security:** Backend and SFTP ports are exposed on `0.0.0.0` by default. Change to `127.0.0.1:<port>` to restrict access to localhost only.

### SFTP

| Variable | Default | Description |
|---|---|---|
| `SFTP_ENABLED` | `true` | Enable or disable the built-in SFTP server |
| `SFTP_MAX_FILE_SIZE` | `104857600` | Max upload size in bytes (default: 100 MB) |
| `SFTP_HOST_KEY` | *(auto-generate)* | SFTP host key file path. Set empty to auto-generate. |
| `SFTP_HOST_KEY_BASE64` | *(empty)* | Base64-encoded SFTP host key (alternative to `SFTP_HOST_KEY`) |

> **Podman note:** `podman-compose` may pass literal `${VAR:-}` strings instead of empty values. Set `SFTP_HOST_KEY=` and `SFTP_HOST_KEY_BASE64=` explicitly in `.env` to avoid SFTP host key errors.

### Backups

| Variable | Default | Description |
|---|---|---|
| `BACKUP_STORAGE_MODE` | `local` | Storage backend: `local` (disk) or `s3` (S3-compatible) |
| `BACKUP_CREDENTIALS_ENCRYPTION_KEY` | *(empty)* | Encryption key for stored backup credentials. Generate with `openssl rand -hex 32`. **If lost, all encrypted credentials become unrecoverable.** |

#### S3 Backups

When `BACKUP_STORAGE_MODE=s3`:

| Variable | Default | Description |
|---|---|---|
| `BACKUP_S3_ENDPOINT` | *(empty)* | S3-compatible endpoint (e.g., `https://s3.amazonaws.com`) |
| `BACKUP_S3_REGION` | `us-east-1` | S3 region |
| `BACKUP_S3_BUCKET` | *(empty)* | Target bucket name |
| `BACKUP_S3_ACCESS_KEY` | *(empty)* | S3 access key ID |
| `BACKUP_S3_SECRET_KEY` | *(empty)* | S3 secret access key |
| `BACKUP_S3_PATH_STYLE` | `false` | Use path-style URLs (required for MinIO) |

### Optional Features

#### Webhooks

```env
WEBHOOK_URLS=https://your-webhook.example.com/notify
WEBHOOK_SECRET=your-webhook-signing-secret
```

#### Auto-Updater

```env
AUTO_UPDATE_ENABLED=false
AUTO_UPDATE_INTERVAL_MS=3600000        # 1 hour
AUTO_UPDATE_AUTO_TRIGGER=false         # false = notify only; true = auto-update
AUTO_UPDATE_DOCKER_COMPOSE_PATH=/app/docker-compose.yml
```text

#### Suspension Policies

```env
SUSPENSION_ENFORCED=true
SUSPENSION_DELETE_BLOCKED=false
SUSPENSION_DELETE_POLICY=keep          # block, allow, or keep
```

---

## TLS / HTTPS

### Caddy (Zero-Config)

Caddy is the recommended option — automatic Let's Encrypt with minimal configuration:

**1. Configure `.env`:**

```env
DOMAIN=panel.example.com
ACME_EMAIL=admin@example.com              # optional but recommended for cert alerts
PUBLIC_URL=https://panel.example.com
NODE_ENV=production                       # enables HSTS in the backend
```text

**2. Start with the Caddy overlay:**

```bash
docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d
```

That's it. Visit `https://panel.example.com` — Caddy handles certificate issuance, renewal, and HTTP→HTTPS redirects.

### Traefik (Docker-Native)

For advanced users who want Docker-native service discovery and a web dashboard:

**1. Configure `.env`:**

```env
DOMAIN=panel.example.com
ACME_EMAIL=admin@example.com
PUBLIC_URL=https://panel.example.com
NODE_ENV=production
```text

**2. Start with the Traefik overlay:**

```bash
docker compose -f docker-compose.yml -f docker-compose.traefik.yml up -d
```

**3. (Optional) Access the Traefik dashboard:**

Open `http://127.0.0.1:8080` on the server (localhost only by default).

> **Security:** Never expose the Traefik dashboard on `0.0.0.0` without authentication. Set `TRAEFIK_DASHBOARD_PORT=` to disable it entirely.

### Manual Reverse Proxy

If you prefer to manage TLS yourself (e.g., with Certbot + nginx):

**1. Update `.env` for public-facing deployment:**

```env
PUBLIC_URL=https://panel.example.com
NODE_ENV=production
BACKEND_EXTERNAL_ADDRESS=https://panel.example.com
```text

**2. Configure your reverse proxy.** Example for nginx:

```nginx
server {
    listen 443 ssl http2;
    server_name panel.example.com;

    ssl_certificate     /etc/letsencrypt/live/panel.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/panel.example.com/privkey.pem;

    client_max_body_size 100m;

    # WebSocket support
    location /ws {
        proxy_pass http://127.0.0.1:80;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    # All other requests
    location / {
        proxy_pass http://127.0.0.1:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# Redirect HTTP → HTTPS
server {
    listen 80;
    server_name panel.example.com;
    return 301 https://$host$request_uri;
}
```

### Important: HSTS and NODE_ENV

When `NODE_ENV=production`, the backend sets:
- `Strict-Transport-Security` (HSTS) — forces browsers to use HTTPS
- `upgrade-insecure-requests` in CSP — auto-upgrades HTTP to HTTPS

**Never set `NODE_ENV=production` with plain HTTP.** Browsers will cache HSTS and refuse to load `http://` resources, breaking deploy scripts and the panel. Keep `NODE_ENV=development` when running behind no TLS, or use one of the TLS overlay options above.

### PASSKEY_RP_ID Must Match Your Domain

WebAuthn/Passkey authentication will fail if `PASSKEY_RP_ID` doesn't exactly match your domain:

```env
# For http://localhost:8080 → PASSKEY_RP_ID=localhost
# For https://panel.example.com → PASSKEY_RP_ID=panel.example.com
# For LAN → PASSKEY_RP_ID=192.168.1.100
```text

No protocol, no port — the bare hostname or IP only.

---

## Development Setup

Catalyst uses a Bun workspace monorepo. Full development requires:

- [Bun](https://bun.sh/) >= 1.0.0
- Docker or Podman (for PostgreSQL, Redis)
- Rust toolchain (for the agent, if needed)

### Quick Start

```bash
# Install all workspace dependencies
bun install

# Start infrastructure containers (PostgreSQL + Redis)
bun run dev:infra

# Run backend and frontend in parallel (hot reload)
bun run dev

# Run the Rust agent locally (requires root for containerd access)
bun run dev:agent
```

### Useful Commands

| Command | Context | Description |
|---|---|---|
| `bun run dev` | Root | Start backend + frontend with hot reload |
| `bun run dev:agent` | Root | Run the Rust agent locally |
| `bun run build` | Root | Build all packages |
| `bun run build:agent` | Root | Build the Rust agent (release) |
| `bun run db:generate` | `catalyst-backend/` | Regenerate Prisma client |
| `bun run db:push` | `catalyst-backend/` | Push schema to database |
| `bun run db:migrate` | `catalyst-backend/` | Create and apply migrations |
| `bun run db:seed` | `catalyst-backend/` | Seed database with sample data |
| `bun run db:seed:admin` | `catalyst-backend/` | Seed only the admin user |
| `bun run db:studio` | `catalyst-backend/` | Open Prisma Studio GUI |
| `bun run test` | Root | Run Vitest test suite |
| `bun run lint` | Root | Run ESLint on all packages |

### Backend Dev Environment

```bash
cd catalyst-backend
cp .env.example .env
nano .env  # Set DATABASE_URL

bun install
bun run db:generate
bun run db:push
bun run db:seed
bun run dev
```text

### Frontend Dev Environment

```bash
cd catalyst-frontend
bun install
# Frontend dev server starts via `bun run dev` (root) or `bun run dev` here
```

> **See also:** [Development Guide](./development.md) for the complete developer guide including testing, plugin development, and PR process.

---

## Upgrading

### Docker Compose (Recommended)

```bash
# Pull latest images
docker compose pull

# Apply any database migrations and restart
docker compose up -d
```text

The backend entrypoint automatically runs `prisma migrate deploy` on every startup, so migrations are applied before the API starts accepting connections.

> **Post-upgrade:** After upgrading, verify node agents are connected by checking the admin panel. For node deployment procedures, see [Agent Guide](./agent.md).

### With Git (Source Builds)

```bash
git pull origin main
docker compose up -d --build
```

### One-Line Install

The one-line installer includes an update routine:

```bash
# Run the installer again — it updates catalyst-docker/ in place
curl -fsSL https://raw.githubusercontent.com/catalystctl/catalyst/main/install.sh | bash
```text

It preserves your existing `.env` and only replaces the config files.

---

## Troubleshooting

### Docker Compose Hangs on Start

The compose command waits for healthchecks. This can take 1–3 minutes on first run:

```bash
# Check progress in another terminal
docker compose ps
```

### PostgreSQL Connection Errors

```text
Error: P1001 Can't reach database server
```

- Verify the container is running: `docker compose ps postgres`
- Check logs: `docker compose logs postgres`
- Ensure `POSTGRES_PASSWORD` is set in `.env` (required)
- For a fresh database, run: `docker exec -e NODE_ENV=development catalyst-backend bun run db:seed`

### Migration Failures

```text
Warning: Could not run migrations
```

The entrypoint falls back to `db push` (which may lose data). For a fresh database, the seed script handles initialization. For existing databases, check migration status:

```bash
docker compose exec backend bunx prisma migrate status --config prisma/prisma.config.ts
```text

### Redis Connection Warnings

```
Warning: Could not connect to Redis
```text

Redis is optional. If you don't use Redis-dependent features (rate limiting, caching), this can be safely ignored. To fix:

```bash
docker compose ps redis
docker compose logs redis
```

### SFTP Connection Refused

- Verify `SFTP_ENABLED=true` in `.env`
- Check the port binding: `docker compose port backend 2022`
- Podman users: ensure `SFTP_HOST_KEY=` and `SFTP_HOST_KEY_BASE64=` are set explicitly

### Podman `rootlessport` Error

```text
rootlessport cannot expose privileged port 80
```

Use the default high port (8080) or allow privileged ports:

```bash
echo 'net.ipv4.ip_unprivileged_port_start=80' | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
```text

### Port Already in Use

```bash
# Check what's using a port
ss -tlnp | grep :3000

# Change in .env
BACKEND_PORT=127.0.0.1:3001
```

### Backend Crash Loop

Check logs for the error:

```bash
docker compose logs -f backend
```text

Common causes:
- Missing `BETTER_AUTH_SECRET` or `DATABASE_URL`
- Invalid `SFTP_HOST_KEY` (set empty for auto-generate)
- Database unreachable (verify PostgreSQL container health)

### Reset Everything

> **⚠️ This deletes all data including databases, server files, and backups.**

```bash
docker compose down -v
```

### View Logs

```bash
# All services (follow mode)
docker compose logs -f

# Specific service
docker compose logs -f backend
docker compose logs -f postgres

# Last 100 lines
docker compose logs --tail=100 backend
```text
