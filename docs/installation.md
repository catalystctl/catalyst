# Installation Guide

Complete instructions for deploying Catalyst, a production-grade game server management panel.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start (Docker Compose)](#quick-start-docker-compose)
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
- [Manual Deployment](#manual-deployment)
  - [Database Setup](#database-setup)
  - [Redis Setup](#redis-setup)
  - [Backend Setup](#backend-setup)
  - [Frontend Setup](#frontend-setup)
  - [Database Seeding](#database-seeding)
- [Development Setup](#development-setup)
- [Containerd / nerdctl Deployment](#containerd--nerdctl-deployment)
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

> **Note:** Docker or Podman is required. Catalyst also supports nerdctl/containerd for infrastructure without Docker.

## Quick Start (Docker Compose)

The fastest way to get Catalyst running is via Docker Compose.

### 1. Clone the Repository

```bash
git clone https://github.com/your-org/catalyst.git
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

## Manual Deployment

If you prefer to run services outside Docker, follow these steps.

### Database Setup

Install PostgreSQL 16+ and create the database:

```bash
# Create database and user
sudo -u postgres createuser catalyst
sudo -u postgres createdb catalyst_db -O catalyst
sudo -u postgres psql -c "ALTER USER catalyst PASSWORD 'your-secure-password';"
```

### Redis Setup

Install Redis 7+:

```bash
# Ubuntu/Debian
sudo apt install redis-server

# Enable and start
sudo systemctl enable redis-server
sudo systemctl start redis-server
```

### Backend Setup

The backend requires **Bun** (>= 1.0.0) or **Node.js** (>= 20.0.0).

```bash
cd catalyst/catalyst-backend

# Install dependencies
bun install

# Generate Prisma client
bunx prisma generate --config prisma/prisma.config.ts

# Run database migrations
bunx prisma migrate deploy --config prisma/prisma.config.ts

# Build for production
bun run build

# Start
DATABASE_URL="postgresql://catalyst:password@localhost:5432/catalyst_db" \
BETTER_AUTH_SECRET="$(openssl rand -base64 32)" \
BETTER_AUTH_URL="https://panel.example.com" \
bun run start
```

### Frontend Setup

```bash
cd catalyst/catalyst-frontend

# Install dependencies
bun install

# Build
bun run build

# Serve the dist/ directory with any static file server or nginx
```

### Database Seeding

For development/testing only:

```bash
cd catalyst/catalyst-backend
NODE_ENV=development bun run db:seed
```

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

## Containerd / nerdctl Deployment

For environments without Docker, Catalyst provides containerd and nerdctl support.

### Using nerdctl (Recommended for non-Docker setups)

```bash
export POSTGRES_PASSWORD="your-secure-password"

# Start PostgreSQL and Redis under containerd via nerdctl
./containerd/compose-to-nerdctl.sh
```

The script:
- Starts PostgreSQL 16 and Redis 7 containers via nerdctl
- Creates persistent data directories at `/var/lib/catalyst/`
- Performs health checks on both services
- Is idempotent (won't recreate existing containers)

### Using systemd Services

For production, install the provided systemd service files:

```bash
# Copy service files
sudo cp containerd/catalyst-postgres.service /etc/systemd/system/
sudo cp containerd/catalyst-redis.service /etc/systemd/system/

# Create environment files
sudo mkdir -p /etc/catalyst
sudo tee /etc/catalyst/postgres.env <<EOF
POSTGRES_PASSWORD=your-secure-password
EOF

# Enable and start
sudo systemctl daemon-reload
sudo systemctl enable --now catalyst-postgres catalyst-redis
```

Service files are provided for: PostgreSQL, Redis, MinIO, MySQL, and SeaweedFS.

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

### Manual

```bash
cd catalyst/catalyst-backend
bun install
bunx prisma generate --config prisma/prisma.config.ts
bun run build
# Restart your process manager (systemd, pm2, etc.)
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
