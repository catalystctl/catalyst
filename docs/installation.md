# Installation Guide

Complete instructions for deploying Catalyst, a production-grade game server management panel.

## Table of Contents

- [Prerequisites](#prerequisites)
- [One-Line Install (Recommended)](#one-line-install-recommended)
- [Quick Start (Docker Compose)](#quick-start-docker-compose)
- [Standalone Docker (catalyst-docker)](#standalone-docker-catalyst-docker)
- [Environment Variables](#environment-variables)
  - [Required Variables](#required-variables)
  - [General Settings](#general-settings)
  - [Database Configuration](#database-configuration)
  - [Redis Configuration](#redis-configuration)
  - [Port Bindings](#port-bindings)
  - [SFTP Configuration](#sftp-configuration)
  - [Backup Configuration](#backup-configuration)
  - [Server Limits](#server-limits)
  - [Suspension Settings](#suspension-settings)
  - [OAuth Providers](#oauth-providers)
  - [S3 Backups](#s3-backups)
- [Service Architecture](#service-architecture)
- [Development Setup](#development-setup)
- [Reverse Proxy Configuration](#reverse-proxy-configuration)
  - [Nginx (Standalone)](#nginx-standalone)
  - [Caddy](#caddy)
- [SSL/TLS](#ssltls)
- [Upgrading](#upgrading)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

| Requirement | Minimum | Recommended |
|---|---|---|
| **OS** | Any Linux with Docker | Ubuntu 22.04+ / Debian 12+ |
| **Docker** | 20.10+ | Latest stable |
| **Docker Compose** | v2.0+ | Latest stable |
| **CPU** | 2 cores | 4+ cores |
| **RAM** | 2 GB | 4+ GB |
| **Disk** | 10 GB (panel only) | SSD with 50+ GB |

> **Note:** Docker Compose (with Docker or Podman) is the **only supported deployment method**. Direct installation, containerd (`ctr`/`nerdctl`), and other container runtimes are not supported.

## One-Line Install (Recommended)

The fastest way to get Catalyst running — no need to clone the full repo:

```bash
curl -fsSL https://raw.githubusercontent.com/catalystctl/catalyst/main/install.sh | bash
```

This script:
- Checks for Docker and Docker Compose
- Downloads the standalone `catalyst-docker/` folder from GitHub
- Generates secure `POSTGRES_PASSWORD` and `BETTER_AUTH_SECRET`
- Creates `.env` from `.env.example`

Then start the stack:

```bash
cd catalyst-docker
# Edit .env — set PUBLIC_URL at minimum
nano .env
docker compose up -d
```

👉 See [`catalyst-docker/README.md`](../catalyst-docker/README.md) for full details including TLS setup with Caddy or Traefik.

---

## Quick Start (Docker Compose)

If you prefer to build from source:

### 1. Clone the Repository

```bash
git clone https://github.com/catalystctl/catalyst.git
cd catalyst
```

### 2. Run the Setup Script

```bash
chmod +x dev.sh
./dev.sh
```

This script will:
- Detect Docker or Podman
- Copy `.env.example` to `.env`
- Prompt you to set required values
- Validate configuration
- Build and start all services

### 3. Manual Quick Start

If you prefer to configure manually:

```bash
# Copy environment template
cp .env.example .env

# Edit required values
nano .env  # Set BETTER_AUTH_SECRET and POSTGRES_PASSWORD
```

Generate a secure auth secret:

```bash
openssl rand -base64 32
```

Then start the stack:

```bash
docker compose up -d --build
```

### 4. Seed the Database

For first-time installations, seed the database with default data (admin user, roles, templates):

```bash
docker compose exec backend bun run db:seed
```

> **⚠️ Warning:** The seed script creates a default admin account (`admin@example.com` / `admin123`). Change this password immediately after first login. The seed script refuses to run in production (`NODE_ENV=production`) unless `SEED_ALLOW_DEFAULT_ADMIN=true` is set.

### 5. Access the Panel

| Service | URL |
|---|---|
| **Panel** | `http://localhost` (port 80) |
| **API** | `http://localhost:3000/api` |
| **API Docs** | `http://localhost:3000/docs` |
| **SFTP** | `localhost:2022` |

---

## Standalone Docker (catalyst-docker)

The `catalyst-docker/` folder is a self-contained deployment using **pre-built images** from GitHub Container Registry — no build step required. This is what the [one-line install](#one-line-install-recommended) downloads.

```bash
# Clone and enter the standalone folder
git clone https://github.com/catalystctl/catalyst.git
cd catalyst/catalyst-docker

cp .env.example .env
# Edit .env — set PUBLIC_URL at minimum
nano .env

docker compose up -d
```

For Podman, use `podman compose up -d` instead.

👉 See [`catalyst-docker/README.md`](../catalyst-docker/README.md) for the complete guide including TLS setup, port configuration, and troubleshooting.

## Environment Variables

All configuration is done through the `.env` file. Copy `.env.example` as a starting point.

### Required Variables

| Variable | Description | Example |
|---|---|---|
| `BETTER_AUTH_SECRET` | Secret key for session encryption. Generate with `openssl rand -base64 32` | `a3f8b...` |
| `BETTER_AUTH_URL` | Public URL of the panel (used for OAuth callbacks) | `https://panel.example.com` |
| `POSTGRES_PASSWORD` | Password for PostgreSQL (also used internally by the backend) | `your-secure-password` |

### General Settings

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `production` | Environment: `production` or `development` |
| `TZ` | `UTC` | Timezone in IANA format (e.g., `America/New_York`) |
| `LOG_LEVEL` | `info` | Log verbosity: `trace`, `debug`, `info`, `warn`, `error` |
| `APP_NAME` | `Catalyst` | Panel branding name (TOTP issuer, OAuth display, email subjects) |
| `BACKEND_EXTERNAL_ADDRESS` | `http://localhost` | Public-facing backend URL |
| `FRONTEND_URL` | `http://localhost` | Public-facing frontend URL |
| `CORS_ORIGIN` | `http://localhost` | Allowed CORS origin |
| `PASSKEY_RP_ID` | `localhost` | WebAuthn/Passkey relying party ID (must match your domain) |

### Database Configuration

| Variable | Default | Description |
|---|---|---|
| `POSTGRES_USER` | `catalyst` | PostgreSQL username |
| `POSTGRES_DB` | `catalyst_db` | Database name |
| `POSTGRES_PORT` | `127.0.0.1:5432` | Host port binding (bind address:port) |

### Redis Configuration

| Variable | Default | Description |
|---|---|---|
| `REDIS_PASSWORD` | *(empty)* | Redis password (leave empty for no auth) |
| `REDIS_URL` | `redis://:REDIS_PASSWORD_PLACEHOLDER@redis:6379` | Redis connection URL |
| `REDIS_PORT` | `127.0.0.1:6379` | Host port binding |

> **Note:** If `REDIS_URL` is empty or Redis is unreachable, Redis-dependent features (rate limiting, caching, session store) will be skipped. Redis is recommended for production.

### Port Bindings

| Variable | Default | Description |
|---|---|---|
| `BACKEND_PORT` | `127.0.0.1:3000` | Backend HTTP API port |
| `FRONTEND_PORT` | `80` | Frontend (nginx) port |
| `SFTP_PORT` | `127.0.0.1:2022` | SFTP server port |

> **Security:** By default, the backend and SFTP ports are bound to `127.0.0.1` only. They are accessed through the nginx frontend proxy. Change this only if you have a specific need.

### SFTP Configuration

| Variable | Default | Description |
|---|---|---|
| `SFTP_ENABLED` | `true` | Enable or disable the built-in SFTP server |

### Backup Configuration

| Variable | Default | Description |
|---|---|---|
| `BACKUP_STORAGE_MODE` | `local` | Storage backend: `local` or `s3` |
| `BACKUP_CREDENTIALS_ENCRYPTION_KEY` | *(empty)* | Encryption key for backup credentials. Generate with `openssl rand -hex 32`. **If lost, all encrypted backup credentials become unrecoverable.** |

### Server Limits

| Variable | Default | Description |
|---|---|---|
| `MAX_DISK_MB` | `10240` | Maximum disk allocation per server in MB |
| `CONSOLE_OUTPUT_BYTE_LIMIT_BYTES` | `262144` | Maximum console output buffer size per server |

### Suspension Settings

| Variable | Default | Description |
|---|---|---|
| `SUSPENSION_ENFORCED` | `true` | Whether suspension stops servers |
| `SUSPENSION_DELETE_POLICY` | `block` | Delete policy for suspended servers: `block` or `allow` |
| `SUSPENSION_DELETE_BLOCKED` | `true` | Whether delete operations are blocked for suspended servers |

### OAuth Providers

Catalyst supports WHMCS and Paymenter OIDC authentication. Leave these empty to disable.

| Variable | Description |
|---|---|
| `WHMCS_OIDC_CLIENT_ID` | WHMCS OAuth client ID |
| `WHMCS_OIDC_CLIENT_SECRET` | WHMCS OAuth client secret |
| `WHMCS_OIDC_DISCOVERY_URL` | WHMCS OIDC discovery endpoint URL |
| `PAYMENTER_OIDC_CLIENT_ID` | Paymenter OAuth client ID |
| `PAYMENTER_OIDC_CLIENT_SECRET` | Paymenter OAuth client secret |
| `PAYMENTER_OIDC_DISCOVERY_URL` | Paymenter OIDC discovery endpoint URL |

### S3 Backups

For remote backup storage via S3-compatible services (AWS, MinIO, etc.):

| Variable | Default | Description |
|---|---|---|
| `BACKUP_S3_ENDPOINT` | *(empty)* | S3 endpoint URL |
| `BACKUP_S3_REGION` | `us-east-1` | S3 region |
| `BACKUP_S3_BUCKET` | *(empty)* | S3 bucket name |
| `BACKUP_S3_ACCESS_KEY` | *(empty)* | S3 access key |
| `BACKUP_S3_SECRET_KEY` | *(empty)* | S3 secret key |
| `BACKUP_S3_PATH_STYLE` | `false` | Use path-style S3 URLs (needed for MinIO) |

## Service Architecture

Catalyst uses four Docker services:

```
┌──────────────┐     ┌──────────────┐
│   Frontend   │────▶│   Backend    │
│   (Nginx)    │     │   (Fastify)  │
│   Port 80    │     │   Port 3000  │
└──────────────┘     └──────┬───────┘
                            │
                     ┌──────┴───────┐
                     │              │
              ┌──────▼──────┐ ┌────▼──────┐
              │  PostgreSQL │ │   Redis   │
              │  Port 5432  │ │  Port 6379│
              └─────────────┘ └───────────┘
```

### Volumes

| Volume | Purpose |
|---|---|
| `catalyst-postgres-data` | PostgreSQL data persistence |
| `catalyst-server-data` | Server container files at `/var/lib/catalyst/servers` |
| `catalyst-backup-data` | Backup files at `/var/lib/catalyst/backups` |

### Health Checks

All services include health checks:

- **PostgreSQL:** `pg_isready` every 10s
- **Redis:** `redis-cli ping` every 10s
- **Backend:** HTTP GET `/health` every 30s (with 30s start period)

The frontend waits for the backend to be healthy before starting.

> **Note:** Docker Compose (with Docker or Podman) is the **only supported deployment method**. Manual installation of individual services is not supported.

## Development Setup

Catalyst uses a Bun workspace monorepo. Development requires:

- [Bun](https://bun.sh/) >= 1.0.0
- Podman or Docker (for PostgreSQL and Redis)
- Rust toolchain (for the agent, if needed)

```bash
# Install all dependencies
bun install

# Start infrastructure (PostgreSQL + Redis)
bun run dev:infra

# Run backend and frontend in parallel (hot reload)
bun run dev

# Run the agent locally (requires root for containerd access)
bun run dev:agent

# Seed the database
bun run db:seed

# Database GUI (Prisma Studio)
bun run db:studio
```

### Useful Development Scripts

| Command | Description |
|---|---|
| `bun run dev` | Start backend + frontend with hot reload |
| `bun run dev:agent` | Run the Rust agent locally |
| `bun run build` | Build all packages |
| `bun run build:agent` | Build the Rust agent (release) |
| `bun run db:generate` | Regenerate Prisma client |
| `bun run db:push` | Push schema changes to database |
| `bun run db:migrate` | Create and apply migrations |
| `bun run db:seed` | Seed database with sample data |
| `bun run db:studio` | Open Prisma Studio GUI |
| `bun run lint` | Lint all packages |
| `bun run test` | Run tests |



## Reverse Proxy Configuration

In production, place a reverse proxy (nginx, Caddy) in front of the frontend service to handle TLS termination.

### Nginx (Standalone)

```nginx
server {
    listen 443 ssl http2;
    server_name panel.example.com;

    ssl_certificate     /etc/letsencrypt/live/panel.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/panel.example.com/privkey.pem;

    client_max_body_size 100m;

    location / {
        proxy_pass http://127.0.0.1:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket support
    location /ws {
        proxy_pass http://127.0.0.1:80;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}

# Redirect HTTP to HTTPS
server {
    listen 80;
    server_name panel.example.com;
    return 301 https://$host$request_uri;
}
```

### Caddy

Caddy handles TLS automatically with Let's Encrypt:

```
panel.example.com {
    reverse_proxy localhost:80
}
```

## SSL/TLS

When using SSL, update these environment variables accordingly:

```env
BETTER_AUTH_URL=https://panel.example.com
BACKEND_EXTERNAL_ADDRESS=https://panel.example.com
FRONTEND_URL=https://panel.example.com
CORS_ORIGIN=https://panel.example.com
PASSKEY_RP_ID=panel.example.com
```

> **Important:** `PASSKEY_RP_ID` must exactly match your domain (no protocol, no port). WebAuthn/Passkey authentication will fail if this doesn't match.

## Upgrading

### Docker Compose

```bash
# Pull latest code
git pull origin main

# Rebuild and restart
docker compose up -d --build

# Run any pending database migrations
docker compose exec backend bunx prisma migrate deploy --config prisma/prisma.config.ts
```

> **Note:** The backend entrypoint automatically runs database migrations on every startup, so explicit migration commands are usually not needed.

### Standalone Docker (catalyst-docker)

```bash
cd catalyst-docker
docker compose pull
docker compose up -d
```

## Troubleshooting

### Database Connection Errors

```
Error: P1001 Can't reach database server
```

- Verify PostgreSQL is running: `docker compose ps postgres`
- Check `DATABASE_URL` in the backend environment
- Ensure the database container is healthy: `docker compose logs postgres`

### Migration Failures

```
Warning: Could not run migrations
```

- For a fresh database, run the seed manually: `docker compose exec backend bun run db:seed`
- For existing databases, check migration status: `docker compose exec backend bunx prisma migrate status --config prisma/prisma.config.ts`

### Redis Connection Warnings

```
Warning: Could not connect to Redis
```

Redis is optional. If you see this warning but don't need Redis features, it can be safely ignored. To fix it:

- Verify Redis is running: `docker compose ps redis`
- Check `REDIS_URL` matches your Redis configuration

### SFTP Connection Refused

- Verify `SFTP_ENABLED=true` in `.env`
- Check the SFTP port binding: `docker compose port backend 2022`
- Ensure port 2022 is not blocked by a firewall

### Port Already in Use

```bash
# Check what's using a port
ss -tlnp | grep :3000

# Change the port in .env
BACKEND_PORT=127.0.0.1:3001
```

### View Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f backend
docker compose logs -f postgres
```

### Reset Everything

> **⚠️ This deletes all data including databases, server files, and backups.**

```bash
docker compose down -v
```
