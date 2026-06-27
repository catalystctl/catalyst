# 📖 Complete Installation Guide

> **The comprehensive reference for deploying Catalyst.**
>
> This document explains every option, every configuration variable, and every edge case. If you want to understand *everything* before deploying, start here.
>
> **Short on time?** → [Quick Start](QUICKSTART.md) (5-minute setup)

---

## Table of Contents

- [Overview](#overview)
- [System Requirements](#system-requirements)
- [Method 1: One-Line Install](#method-1-one-line-install)
- [Method 2: Pre-Built Docker Images](#method-2-pre-built-docker-images)
- [Method 3: Build from Source](#method-3-build-from-source)
- [Post-Installation](#post-installation)
- [Production Hardening](#production-hardening)
- [TLS / HTTPS Configuration](#tls--https-configuration)
- [Podman Considerations](#podman-considerations)
- [Network Configuration](#network-configuration)
- [Updating & Upgrading](#updating--upgrading)
- [Backup & Recovery](#backup--recovery)
- [Troubleshooting](#troubleshooting)
- [Reference: Complete .env Walkthrough](#reference-complete-env-walkthrough)

---

## Overview

Catalyst is deployed as a set of Docker containers managed by Docker Compose. There are three ways to get it running:

| Method | Best For | Time | Complexity |
|--------|----------|------|------------|
| **One-Line Install** | First-time users, quick demos | 2 min | ⭐ |
| **Pre-Built Docker Images** | Production, customization | 5 min | ⭐⭐ |
| **Build from Source** | Developers, custom builds | 15 min | ⭐⭐⭐ |

**All methods produce the same running system.** The difference is only in how you obtain the files.

### Architecture at a Glance

```
Internet ──► [Reverse Proxy] ──► Nginx (frontend) ──► Fastify (backend)
                                                           │
                                                           ├──► PostgreSQL
                                                           ├──► Redis
                                                           └──► WebSocket ──► Agent nodes
```

The stack consists of four services:

| Service | Image | Purpose | Default Port |
|---------|-------|---------|-------------|
| `postgres` | `postgres:16-alpine` | Primary database | `127.0.0.1:5432` |
| `redis` | `redis:7-alpine` | Cache / sessions | `127.0.0.1:6379` |
| `backend` | `ghcr.io/catalystctl/catalyst-backend:latest` | API + SFTP | `127.0.0.1:3000`, `0.0.0.0:2022` |
| `frontend` | `ghcr.io/catalystctl/catalyst-frontend:latest` | Web panel | `0.0.0.0:80` |

> **Important:** Docker Compose (with Docker or Podman) is the **only supported deployment method**. Direct bare-metal installation is not supported.

---

## System Requirements

### Hardware

| Requirement | Minimum | Recommended | Notes |
|---|---|---|---|
| **CPU** | 2 cores | 4+ cores | Game servers run on separate nodes; the panel itself is lightweight |
| **RAM** | 2 GB | 4+ GB | PostgreSQL benefits from more RAM for query caching |
| **Disk** | 20 GB | 50+ GB SSD | SSD strongly recommended for database I/O |
| **Network** | 10 Mbps | 100+ Mbps | Panel-to-agent bandwidth depends on console traffic |

### Software

| Requirement | Minimum | Recommended | Notes |
|---|---|---|---|
| **OS** | Any Linux with Docker/Podman | Ubuntu 22.04+ / Debian 12+ | macOS and Windows are not supported for production |
| **Docker** | 20.10+ | 26+ (rootless) | Rootless Docker is the most secure option |
| **Podman** | 4.0+ | 5+ | Rootless Podman is fully supported |
| **Compose** | V2 plugin or `podman-compose` | Latest stable | `docker compose` (space) not `docker-compose` (hyphen) |
| **curl** | Any | Latest | Required for the one-line installer |
| **openssl** | Any | Latest | Required for generating secrets |

### Ports

| Port | Protocol | Service | Required? |
|------|----------|---------|-----------|
| 80 | TCP | Web panel (HTTP) | Yes, or custom via `FRONTEND_PORT` |
| 443 | TCP | Web panel (HTTPS) | Only with TLS overlay |
| 3000 | TCP | Backend API | Only if accessing API directly |
| 2022 | TCP | SFTP file access | Only if using SFTP |
| 5432 | TCP | PostgreSQL | No (internal only by default) |
| 6379 | TCP | Redis | No (internal only by default) |

### DNS Requirements for TLS

If using automatic HTTPS (Caddy or Traefik overlays):

- A **public DNS A record** pointing your domain to your server's public IP
- Ports **80 and 443** must be reachable from the internet (for ACME HTTP-01 challenge)
- The server must have a **public IP** or be behind a NAT with port forwarding

### Storage Considerations

**SSD vs HDD:**
- PostgreSQL performs significantly better on SSDs. HDDs are acceptable for small deployments (<10 nodes, <100 users) but will cause noticeable latency in the admin panel.
- Game server files (in `catalyst-server-data`) can live on HDDs since the agent reads them sequentially.

**Disk Space Planning:**

| Component | Initial Size | Growth Rate |
|-----------|-------------|-------------|
| PostgreSQL | ~50 MB | ~10 MB per 1000 audit log entries |
| Game server files | Varies by game | 1–10 GB per Minecraft server |
| Backups | 0 (until created) | 1× server size per backup |
| Logs | ~10 MB/day | Depends on console verbosity |

---

## Method 1: One-Line Install

The fastest way to get Catalyst running. No repository clone, no build step.

```bash
curl -fsSL https://raw.githubusercontent.com/catalystctl/catalyst/main/install.sh | bash
```

### What the Script Does (Step by Step)

The `install.sh` script performs these operations in order:

**Step 1 — Detect Container Runtime**
- Checks for Docker first (`docker` command + daemon running)
- Falls back to Podman if Docker is not found
- Verifies the daemon is reachable (not just installed)

**Step 2 — Detect Compose**
- Tries `docker compose` (V2 plugin) first
- Falls back to `docker-compose` (standalone) with a warning
- Falls back to `podman compose` if Podman is the runtime

**Step 3 — Validate Prerequisites**
- Verifies `curl`, `tar`, and `openssl` are installed
- Exits with a helpful error message if any are missing

**Step 4 — Download `catalyst-docker/` Folder**
- Downloads `https://github.com/catalystctl/catalyst/archive/refs/heads/main.tar.gz`
- Extracts only the `catalyst-docker/` directory using `--strip-components`
- Creates a temporary working directory (auto-cleaned on exit via `trap`)

**Step 5 — Install Files**
- If `catalyst-docker/` already exists and has a `.env`, preserves it (backs up to `.env.backup.<PID>`)
- Otherwise, copies all files fresh

**Step 6 — Generate Secrets**
- Generates a 32-character PostgreSQL password: `openssl rand -base64 48 | tr -d '/+=' | head -c 32`
- Generates a 32-byte base64 Better Auth secret: `openssl rand -base64 32`
- Patches these into `.env` using `sed`

**Step 7 — Print Next Steps**
- Displays the three required variables to set
- Shows optional LAN exposure settings
- Prints the exact commands to start the stack

### After the Script Runs

```bash
cd catalyst-docker
nano .env          # Set PUBLIC_URL at minimum
docker compose up -d
```

### Podman Users

Replace `docker` with `podman` everywhere:

```bash
curl -fsSL https://raw.githubusercontent.com/catalystctl/catalyst/main/install.sh | bash
cd catalyst-docker
nano .env
podman compose up -d
```

### Troubleshooting the Installer

| Symptom | Cause | Fix |
|---------|-------|-----|
| "Docker daemon is not running" | Docker installed but not started | `sudo systemctl start docker` |
| "Podman is not running" | Podman socket not active | `systemctl --user start podman` |
| "No container runtime found" | Neither Docker nor Podman installed | Install Docker: `sudo apt install docker.io docker-compose-v2` |
| "No compose command found" | Compose plugin not installed | `sudo apt install docker-compose-v2` |
| "Failed to download from GitHub" | Network issue or rate limited | Check internet connection; wait a minute and retry |
| "Extraction failed" | GitHub archive structure changed | Open an issue on GitHub |

---

## Method 2: Pre-Built Docker Images

This method clones the full repository but only uses the pre-built images from GitHub Container Registry. No compilation needed.

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

### What's in `catalyst-docker/`

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Core service definitions (postgres, redis, backend, frontend) |
| `docker-compose.caddy.yml` | Caddy TLS reverse proxy overlay |
| `docker-compose.traefik.yml` | Traefik TLS reverse proxy overlay |
| `.env.example` | Template with all variables documented |
| `nginx/default.conf` | Nginx configuration for the frontend |
| `caddy/Caddyfile` | Caddy configuration (used by Caddy overlay) |
| `traefik/traefik.yml` | Traefik static configuration |

### Understanding `docker-compose.yml`

The compose file defines four services with these relationships:

```
frontend → backend → postgres
                  ↘ redis
```

**Dependencies:**
- `frontend` waits for `backend` to be healthy
- `backend` waits for `postgres` AND `redis` to be healthy
- This means first startup can take 1–3 minutes as the cascade resolves

**Health checks:**
- PostgreSQL: `pg_isready -U catalyst` every 10s
- Redis: `redis-cli ping | grep PONG` every 10s
- Backend: `curl -sf http://localhost:3000/health` every 15s, with a 60s startup grace period

**Volumes:**
- All data lives in named volumes that persist across container restarts
- See [Backup & Recovery](#backup--recovery) for how to back these up

### Verifying Each Service Individually

After `docker compose up -d`, verify each service:

```bash
# 1. Check all containers are running
docker compose ps

# 2. Verify PostgreSQL is healthy
docker compose exec postgres pg_isready -U catalyst
# Expected: /var/run/postgresql:5432 - accepting connections

# 3. Verify Redis is responding
docker compose exec redis redis-cli ping
# Expected: PONG

# 4. Check backend health
curl http://localhost:3000/health
# Expected: {"status":"ok"}

# 5. Check frontend is serving
curl -I http://localhost:80
# Expected: HTTP/1.1 200 OK

# 6. Check the full panel
curl -s http://localhost:80 | head -5
# Expected: HTML containing "Catalyst"
```

---

## Method 3: Build from Source

For development or when you need to modify the code before deploying.

### Prerequisites

- [Node.js](https://nodejs.org/) >= 22
- [pnpm](https://pnpm.io/) >= 8
- Docker or Podman (for PostgreSQL + Redis infrastructure)
- Rust toolchain (for the agent, if needed)

### 1. Clone the Repository

```bash
git clone https://github.com/catalystctl/catalyst.git
cd catalyst
```

### 2. Install Workspace Dependencies

```bash
pnpm install
```

This installs dependencies for all packages in the pnpm workspace.

### 3. Start Infrastructure

```bash
pnpm run dev:infra
```

This starts PostgreSQL and Redis containers. They run in the background.

### 4. Configure the Backend

```bash
cd catalyst-backend
cp .env.example .env
nano .env
```

Set at minimum:

```env
DATABASE_URL=postgresql://catalyst:your-password@localhost:5432/catalyst_db
BETTER_AUTH_SECRET=$(openssl rand -base64 32)
```

### 5. Set Up the Database

```bash
pnpm run db:generate    # Generate Prisma client
pnpm run db:push        # Push schema to database
pnpm run db:seed        # Seed with sample data (dev only)
```

### 6. Start the Backend

```bash
pnpm run dev
```

The backend starts on `http://localhost:3000` with hot reload.

### 7. Start the Frontend

In a new terminal:

```bash
cd catalyst-frontend
pnpm install            # Already installed at workspace root, but safe to run
pnpm run dev
```

The frontend dev server starts (usually on `http://localhost:5173`).

### 8. Start the Agent (Optional)

In a new terminal:

```bash
pnpm run dev:agent
```

This builds and runs the Rust agent locally. Requires root for containerd access.

### Development Commands Reference

| Command | Context | Description |
|---------|---------|-------------|
| `pnpm run dev` | Root | Backend + frontend with hot reload |
| `pnpm run dev:infra` | Root | PostgreSQL + Redis containers |
| `pnpm run dev:agent` | Root | Rust agent (local build) |
| `pnpm run build` | Root | Build all packages |
| `pnpm run build:agent` | Root | Build Rust agent (release) |
| `pnpm run db:generate` | `catalyst-backend/` | Regenerate Prisma client |
| `pnpm run db:push` | `catalyst-backend/` | Push schema to database |
| `pnpm run db:migrate` | `catalyst-backend/` | Create and apply migrations |
| `pnpm run db:seed` | `catalyst-backend/` | Seed database with sample data |
| `pnpm run db:seed:admin` | `catalyst-backend/` | Seed only admin user |
| `pnpm run db:studio` | `catalyst-backend/` | Open Prisma Studio GUI |
| `pnpm run test` | Root | Run Vitest test suite |
| `pnpm run lint` | Root | Run ESLint on all packages |

---

## Post-Installation

### First-Run Setup

When you first visit your Catalyst URL, the setup wizard detects that no users exist:

1. Register your first account — it becomes the **administrator** automatically
2. The admin has full access to all features
3. From the admin panel, configure SMTP, branding, and OAuth providers

> **Alternative:** Run the seed script to create a default admin:
> ```bash
> docker compose exec -e NODE_ENV=development catalyst-backend pnpm run db:seed
> ```
> Default credentials: `admin@example.com` / `admin123` — **change this password immediately**.

### Verify the Stack

```bash
# Check all containers
docker compose ps

# Expected output:
# NAME                STATUS    IMAGE
# catalyst-postgres   healthy   postgres:16-alpine
# catalyst-redis      healthy   redis:7-alpine
# catalyst-backend    healthy   ghcr.io/catalystctl/catalyst-backend:latest
# catalyst-frontend   running   ghcr.io/catalystctl/catalyst-frontend:latest
```

### Access Points

| Service | URL | Notes |
|---------|-----|-------|
| Web Panel | Your `PUBLIC_URL` | e.g. `http://localhost:8080` |
| REST API | `http://localhost:3000/api` | Backend API |
| API Docs | `http://localhost:3000/docs` | Swagger/OpenAPI UI |
| Health | `http://localhost:3000/health` | Returns `{"status":"ok"}` |
| SFTP | `localhost:2022` | File transfer protocol |

---

## Production Hardening

Use this checklist before deploying to production. Each item is explained below.

| # | Check | Why It Matters |
|---|-------|--------------|
| 1 | `PUBLIC_URL` is set to your real domain | Drives CORS, auth, and all generated links |
| 2 | `POSTGRES_PASSWORD` is strong and unique | Protects your entire database |
| 3 | `BETTER_AUTH_SECRET` was generated with `openssl` | Session encryption — compromise = total breach |
| 4 | `NODE_ENV=production` (only with HTTPS) | Enables HSTS and security headers |
| 5 | `BACKEND_PORT` bound to `127.0.0.1` | Prevents direct API access from the internet |
| 6 | `POSTGRES_PORT` bound to `127.0.0.1` | Prevents direct database access |
| 7 | `REDIS_PORT` commented out | Redis should not be externally accessible |
| 8 | TLS is configured (Caddy, Traefik, or proxy) | Encrypts all traffic |
| 9 | `BACKUP_CREDENTIALS_ENCRYPTION_KEY` is set | Protects S3 backup credentials |
| 10 | `AUTO_UPDATE_AUTO_TRIGGER=false` | Review updates before applying |
| 11 | Image versions are pinned | Reproducible deployments |
| 12 | `PASSKEY_RP_ID` matches your domain | WebAuthn won't work otherwise |
| 13 | `COOKIE_SECURE=true` (behind HTTPS) | Prevents cookie theft |
| 14 | Audit log retention is configured | Compliance and forensics |
| 15 | Rate limits are reviewed | Prevent abuse |
| 16 | Monitoring and alerting are set up | Know when things break |

### Detailed Explanations

**1. `PUBLIC_URL` Must Match the Browser URL**

This is the single most important setting. `PUBLIC_URL` drives:
- CORS origin validation
- Better Auth trusted origins
- Password reset email links
- OAuth callback URLs
- Agent deployment scripts
- WebSocket connection URLs

If there's a mismatch (e.g., `PUBLIC_URL=http://localhost:8080` but users access via `https://panel.example.com`), you'll get CORS errors, cookie rejection, and failed OAuth flows.

**2. Strong `POSTGRES_PASSWORD`**

Generate with:
```bash
openssl rand -base64 48 | tr -d '/+=' | head -c 32
```

This password protects your entire database. If compromised, an attacker has full access to all user accounts, server data, and audit logs.

**3. `BETTER_AUTH_SECRET` Generation**

```bash
openssl rand -base64 32
```

This secret is used for:
- Session JWT signing
- CSRF token generation
- Password reset token encryption

**If this secret is leaked or rotated, all existing user sessions are invalidated.** Rotate only during a maintenance window.

**4. `NODE_ENV=production`**

When set to `production`, the backend enables:
- `Strict-Transport-Security` (HSTS) — 1 year max-age
- `upgrade-insecure-requests` in Content-Security-Policy
- Secure cookie flags (`Secure`, `SameSite=Lax`)

> **CRITICAL:** Never set `NODE_ENV=production` with plain HTTP. Browsers cache HSTS and will refuse to load `http://` resources.

**5–7. Port Binding Restrictions**

By default:
- `BACKEND_PORT=127.0.0.1:3000` — only localhost can reach the API
- `POSTGRES_PORT=127.0.0.1:5432` — only localhost can reach the database
- `REDIS_PORT` is commented out — no external access

These restrictions prevent direct access to internal services. All legitimate traffic goes through the frontend nginx proxy.

**8. TLS Configuration**

See [TLS / HTTPS Configuration](#tls--https-configuration) for the three supported methods.

**9. Backup Encryption Key**

```bash
openssl rand -hex 32
```

If using S3 backups, this key encrypts the S3 credentials stored in the database. **If lost, you cannot recover the credentials and backups will fail.** Back up this key separately.

**10. Auto-Updater Caution**

```env
AUTO_UPDATE_ENABLED=true
AUTO_UPDATE_AUTO_TRIGGER=false
```

With `AUTO_UPDATE_AUTO_TRIGGER=false`, the backend notifies you of updates but does not apply them automatically. This prevents surprise downtime from breaking changes.

**11. Pin Image Versions**

Instead of `latest`, use:
```env
BACKEND_IMAGE=ghcr.io/catalystctl/catalyst-backend:v1.2.3
FRONTEND_IMAGE=ghcr.io/catalystctl/catalyst-frontend:v1.2.3
```

This makes deployments reproducible and rollbacks possible.

**12. `PASSKEY_RP_ID` Must Match Domain**

```env
# For https://panel.example.com
PASSKEY_RP_ID=panel.example.com

# For http://192.168.1.100:8080
PASSKEY_RP_ID=192.168.1.100
```

No protocol, no port, no path — just the bare hostname or IP.

---

## TLS / HTTPS Configuration

Catalyst supports three methods for TLS. Choose **one**.

### Option A: Caddy (Recommended — Zero Config)

Caddy automatically obtains and renews Let's Encrypt certificates with zero configuration.

**Prerequisites:**
- DNS A record pointing your domain to your server's public IP
- Ports 80 and 443 reachable from the internet

**Steps:**

1. **Configure `.env`:**

   ```env
   DOMAIN=panel.example.com
   ACME_EMAIL=admin@example.com        # Optional — for cert expiry notifications
   PUBLIC_URL=https://panel.example.com
   NODE_ENV=production
   FRONTEND_PORT=127.0.0.1:8080        # Restrict direct access
   ```

2. **Start with the Caddy overlay:**

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d
   ```

3. **Verify:**

   ```bash
   curl -I https://panel.example.com
   # Expected: HTTP/2 200
   ```

**How it works:**
- The Caddy overlay removes the frontend's direct port binding (`ports: []`)
- Caddy binds to ports 80 and 443 on the host
- Caddy proxies all traffic to the frontend nginx container
- Certificates are stored in the `caddy-data` volume and persist across restarts

**The Caddyfile (2 lines):**

```caddy
{$DOMAIN}
reverse_proxy frontend:80
```

That's the entire configuration. Caddy handles:
- Certificate issuance (ACME HTTP-01)
- Certificate renewal (automatic, before expiry)
- OCSP stapling
- HTTP→HTTPS redirect

### Option B: Traefik (Advanced — Docker Native)

Traefik offers Docker-native service discovery and a web dashboard.

**Prerequisites:** Same as Caddy.

**Steps:**

1. **Configure `.env`:**

   ```env
   DOMAIN=panel.example.com
   ACME_EMAIL=admin@example.com
   PUBLIC_URL=https://panel.example.com
   NODE_ENV=production
   FRONTEND_PORT=127.0.0.1:8080
   ```

2. **Start with the Traefik overlay:**

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.traefik.yml up -d
   ```

3. **(Optional) Access the dashboard:**

   ```bash
   ssh -L 8080:localhost:8080 your-server
   # Open http://localhost:8080 in your browser
   ```

**How it works:**
- Traefik discovers the frontend service via Docker labels
- The `traefik.http.routers.frontend` label defines the HTTPS router
- The `traefik.http.routers.frontend-http` label handles HTTP→HTTPS redirect
- Certificates are stored in the `traefik-certs` volume

**Security note:** The Traefik dashboard defaults to `127.0.0.1:8080` (localhost only). Never expose it on `0.0.0.0`. Set `TRAEFIK_DASHBOARD_PORT=` to disable entirely.

### Option C: Existing Reverse Proxy

If you already run Nginx, Apache, HAProxy, or another proxy, the recommended
approach is to **proxy everything to the bundled frontend nginx container**
and let its internal routing handle `/ws`, `/api/`, `/auth/`, `/docs`, and
static assets.

> **Do NOT add a separate `/ws` block in your external proxy.** The bundled
> nginx (`frontend` container) already has optimized `/ws`, `/api/`, `/auth/`,
> `/docs`, and static asset routing with correct buffering, timeouts, and
> WebSocket upgrade headers. Adding a separate `/ws` location in your external
> proxy bypasses these settings and can cause console streaming failures,
> truncated responses, and agent disconnections.

If you already run Nginx, Apache, HAProxy, or another proxy:

1. **Bind Catalyst to localhost only:**

   ```env
   FRONTEND_PORT=127.0.0.1:8080
   PUBLIC_URL=https://panel.example.com
   NODE_ENV=production
   BACKEND_EXTERNAL_ADDRESS=https://panel.example.com
   ```

2. **Configure your reverse proxy.**

   **Full Nginx example:**

   ```nginx
   upstream catalyst {
       server 127.0.0.1:8080;
       keepalive 32;
   }

   server {
       listen 443 ssl http2;
       server_name panel.example.com;

       ssl_certificate     /etc/letsencrypt/live/panel.example.com/fullchain.pem;
       ssl_certificate_key /etc/letsencrypt/live/panel.example.com/privkey.pem;

       # Security headers
       add_header X-Frame-Options "SAMEORIGIN" always;
       add_header X-Content-Type-Options "nosniff" always;
       add_header Referrer-Policy "strict-origin-when-cross-origin" always;

       client_max_body_size 100m;

       location / {
           proxy_pass http://catalyst;
           proxy_http_version 1.1;
           proxy_set_header Connection "";
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }

       # WebSocket support (agent connections, admin event stream)
       location /ws {
           proxy_pass http://catalyst;
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

   # Redirect HTTP → HTTPS
   server {
       listen 80;
       server_name panel.example.com;
       return 301 https://$host$request_uri;
   }
   ```

   **Caddy standalone example:**

   ```caddy
   panel.example.com {
       reverse_proxy localhost:8080
   }
   ```

   **Apache example:**

   ```apache
   <VirtualHost *:443>
       ServerName panel.example.com

       SSLEngine on
       SSLCertificateFile /etc/letsencrypt/live/panel.example.com/fullchain.pem
       SSLCertificateKeyFile /etc/letsencrypt/live/panel.example.com/privkey.pem

       ProxyPass / http://localhost:8080/
       ProxyPassReverse / http://localhost:8080/
       ProxyPreserveHost On

       RewriteEngine on
       RewriteCond %{HTTP:Upgrade} websocket [NC]
       RewriteCond %{HTTP:Connection} upgrade [NC]
       RewriteRule ^/?(.*) "ws://localhost:8080/$1" [P,L]
   </VirtualHost>
   ```

### Switching from HTTP to HTTPS

If you already have a running stack without TLS:

1. Update `.env` with `DOMAIN`, `PUBLIC_URL=https://...`, and `NODE_ENV=production`
2. Pull updated images: `docker compose pull`
3. Start with the overlay: `docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d`
4. Clear browser cache — HSTS may have been cached from a previous `NODE_ENV=production` test

### HSTS and `NODE_ENV`

When `NODE_ENV=production`, the backend sets:
- `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
- `Content-Security-Policy: ... upgrade-insecure-requests`

These tell browsers to **always** use HTTPS for this domain. Once a browser sees these headers, it will refuse to load `http://` resources for 1 year.

> **Never set `NODE_ENV=production` with plain HTTP.** If you do, browsers will cache HSTS and you'll be locked out until you clear the browser's HSTS cache or wait a year.

---

## Podman Considerations

Podman is a drop-in replacement for Docker with important differences.

### Rootless vs Rootful

| Mode | Command | Port Restrictions | Security |
|------|---------|-------------------|----------|
| **Rootless** (default) | `podman` as your user | Cannot bind ports <1024 | Most secure |
| **Rootful** | `sudo podman` | No restrictions | Same as Docker |

### Port Restrictions

Rootless Podman cannot bind ports below 1024. Two options:

**Option 1: Use high ports (recommended)**

```env
FRONTEND_PORT=0.0.0.0:8080
BACKEND_PORT=0.0.0.0:3000
SFTP_PORT=0.0.0.0:2022
```

This is the default in `.env.example`.

**Option 2: Allow privileged ports**

```bash
echo 'net.ipv4.ip_unprivileged_port_start=80' | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
```

Then you can use `FRONTEND_PORT=0.0.0.0:80`.

### podman-compose Hangs

`podman compose up -d` may appear to hang — it waits for all healthchecks to pass. This is normal.

Check progress in another terminal:

```bash
podman ps
```

All four containers should show `Up` with postgres/redis/backend marked `(healthy)`.

### Socket Path Differences

If running the agent on the same host as the panel:

```yaml
# In docker-compose.yml or docker-compose.override.yml
volumes:
  - /run/user/1000/podman/podman.sock:/var/run/docker.sock
```

The exact path depends on your UID:

```bash
# Find your Podman socket
podman info --format '{{.Host.RemoteSocket.Path}}'
```

### SFTP Host Key Quirk

`podman-compose` may pass literal `${VAR:-}` strings instead of empty values. Explicitly set:

```env
SFTP_HOST_KEY=
SFTP_HOST_KEY_BASE64=
```

The backend will auto-generate a host key on first start.

### Volume Ownership

Rootless Podman maps your UID to root inside containers. Ensure the data directories are owned by your user:

```bash
# If you see permission errors
sudo chown -R $(id -u):$(id -g) /path/to/volume
```

### Podman-specific Compose Differences

| Feature | Docker Compose | Podman Compose |
|---------|---------------|----------------|
| Port replacement | Replaces base ports list | Merges port lists |
| Health check syntax | JSON array: `["CMD-SHELL", "..."]` | String form: `"CMD-SHELL"` |
| Volume driver | `local` | `local` (same) |
| Network isolation | Bridge network | Bridge network |

**Port merge workaround:** When using a TLS overlay, set `FRONTEND_PORT=127.0.0.1:8080` to restrict direct access.

---

## Network Configuration

### LAN Deployment

For home networks or private LANs:

```env
PUBLIC_URL=http://<YOUR_LAN_IP>:8080
PASSKEY_RP_ID=<YOUR_LAN_IP>
FRONTEND_PORT=0.0.0.0:8080
BACKEND_PORT=0.0.0.0:3000
SFTP_PORT=0.0.0.0:2022
```

Find your LAN IP:

```bash
hostname -I | awk '{print $1}'
```

**Caveats:**
- Passkeys (WebAuthn) may not work over HTTP on some browsers
- OAuth callbacks must use the LAN IP (not localhost)
- No TLS means passwords are sent in plaintext

### Public Deployment

For internet-facing servers:

```env
PUBLIC_URL=https://panel.example.com
PASSKEY_RP_ID=panel.example.com
NODE_ENV=production
FRONTEND_PORT=127.0.0.1:8080
BACKEND_PORT=127.0.0.1:3000
```

Use a TLS overlay (Caddy or Traefik) or an external reverse proxy.

### Split DNS (Internal vs External)

If your internal network resolves `panel.example.com` to a private IP but external users resolve it to a public IP:

```env
# External URL (what users type)
PUBLIC_URL=https://panel.example.com

# Internal URL (what the backend uses for agent deployment scripts)
BACKEND_URL=http://192.168.1.10:3000

# External URL (what the backend uses for generated links)
BACKEND_EXTERNAL_ADDRESS=https://panel.example.com
```

This is rare — most deployments only need `PUBLIC_URL`.

### Custom Networks

To isolate Catalyst from other containers:

Create `docker-compose.override.yml`:

```yaml
networks:
  catalyst:
    driver: bridge
    ipam:
      config:
        - subnet: 172.28.0.0/16
```

Start with:

```bash
docker compose -f docker-compose.yml -f docker-compose.override.yml up -d
```

---

## Updating & Upgrading

### Docker Compose (Pre-Built Images)

```bash
cd catalyst-docker

# Pull latest images
docker compose pull

# Restart with new images
docker compose up -d

# Verify all services are healthy
docker compose ps
```

The backend entrypoint automatically runs `prisma migrate deploy` on every startup, so database migrations are applied before the API starts.

### One-Line Install

Re-run the installer — it updates `catalyst-docker/` in place, preserving `.env`:

```bash
curl -fsSL https://raw.githubusercontent.com/catalystctl/catalyst/main/install.sh | bash
cd catalyst-docker
docker compose up -d
```

### With Git (Source Builds)

```bash
git pull origin main
docker compose up -d --build
```

### Version Pinning and Rollback

**Pin to a specific version:**

```env
BACKEND_IMAGE=ghcr.io/catalystctl/catalyst-backend:v1.2.3
FRONTEND_IMAGE=ghcr.io/catalystctl/catalyst-frontend:v1.2.3
```

Update `docker-compose.yml`:

```yaml
services:
  backend:
    image: ${BACKEND_IMAGE:-ghcr.io/catalystctl/catalyst-backend:latest}
  frontend:
    image: ${FRONTEND_IMAGE:-ghcr.io/catalystctl/catalyst-frontend:latest}
```

**Rollback procedure:**

```bash
# 1. Identify the previous image tag
docker images | grep catalyst-backend

# 2. Pin to the previous version in .env
# BACKEND_IMAGE=ghcr.io/catalystctl/catalyst-backend:v1.2.2

# 3. Restart with the pinned version
docker compose up -d

# 4. If the database migration failed, restore from backup
# See Backup & Recovery section below
```

### Database Migration Verification

Migrations run automatically, but you can verify:

```bash
# Check migration status
docker compose exec backend npx prisma migrate status --schema prisma/schema.prisma

# View migration logs
docker compose logs backend | grep -i "migrat"

# Run manually (only if auto-migration failed)
docker compose exec backend pnpm run db:migrate
```

### Post-Update Verification

After any update:

```bash
# 1. Check all containers are healthy
docker compose ps

# 2. Verify backend health
curl http://localhost:3000/health

# 3. Check the panel loads
curl -s http://localhost:80 | grep -i catalyst

# 4. Verify agents are connected (in the admin panel)
# Admin → Nodes → check status indicators

# 5. Check for errors in logs
docker compose logs --tail=50 backend
```

---

## Backup & Recovery

### Full Stack Backup

This backs up all volumes and the database:

```bash
#!/bin/bash
BACKUP_DIR="./catalyst-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

# Stop the stack for a consistent snapshot
docker compose down

# Backup each volume
for vol in catalyst-postgres-data catalyst-server-data catalyst-backup-data catalyst-plugin-data; do
  docker run --rm \
    -v "${vol}:/source:ro" \
    -v "$(pwd)/${BACKUP_DIR}:/backup" \
    alpine tar czf "/backup/${vol}.tar.gz" -C /source .
  echo "Backed up: ${vol}"
done

echo "Backups saved to: ${BACKUP_DIR}"
```

### Full Stack Restore

```bash
# WARNING: This overwrites current data. Stop the stack first.
docker compose down

# Restore each volume
BACKUP_DIR="./catalyst-backup-20260101-120000"
for vol in catalyst-postgres-data catalyst-server-data catalyst-backup-data catalyst-plugin-data; do
  docker run --rm \
    -v "${vol}:/target" \
    -v "$(pwd)/${BACKUP_DIR}:/backup:ro" \
    alpine sh -c "rm -rf /target/* && tar xzf /backup/${vol}.tar.gz -C /target"
  echo "Restored: ${vol}"
done

# Restart
docker compose up -d
```

### Database-Only Backup (While Running)

```bash
# Backup
docker compose exec postgres pg_dump -U catalyst catalyst_db > catalyst-db-$(date +%Y%m%d).sql

# Restore (stop stack first)
docker compose down
docker compose up -d postgres
sleep 5
docker compose exec -T postgres psql -U catalyst -d catalyst_db < catalyst-db-20260101.sql
docker compose up -d
```

### Configuration Backup

Always back up your `.env` file separately:

```bash
cp .env .env.backup.$(date +%Y%m%d)
```

### Disaster Recovery Checklist

1. ✅ Reinstall Docker/Podman on a new server
2. ✅ Restore the `catalyst-docker/` directory (or re-run `install.sh`)
3. ✅ Restore `.env` from backup
4. ✅ Restore volumes from backup
5. ✅ Restart the stack: `docker compose up -d`
6. ✅ Verify health: `curl http://localhost:3000/health`
7. ✅ Check agents reconnect (Admin → Nodes)

---

## Troubleshooting

### Installation Issues

| Problem | Likely Cause | Fix |
|---------|-------------|-----|
| One-line install fails | Missing Docker/Podman | Install per script output |
| "Docker daemon is not running" | Docker installed but stopped | `sudo systemctl start docker` |
| "Podman is not running" | Podman socket not active | `systemctl --user start podman` |
| Download fails | Network issue | Check connection; retry |
| Extraction fails | Archive structure changed | Open GitHub issue |

### Startup Issues

| Problem | Likely Cause | Fix |
|---------|-------------|-----|
| Compose hangs on start | Waiting for healthchecks (normal) | Check `docker compose ps` |
| PostgreSQL won't start | Permission denied on volume | Recreate volume; check SELinux |
| Backend crash loop | Missing `BETTER_AUTH_SECRET` | Set in `.env`; restart backend |
| Backend crash loop | Missing `POSTGRES_PASSWORD` | Set in `.env`; restart stack |
| Frontend won't start | Backend not healthy | Check `docker compose logs backend` |
| Port already in use | Another service using port | `ss -tlnp \| grep :3000`; change in `.env` |

### Runtime Issues

| Problem | Likely Cause | Fix |
|---------|-------------|-----|
| Can't log in | `PUBLIC_URL` mismatch | Set to exact browser URL |
| CORS errors | `CORS_ORIGIN` doesn't match | Set `PUBLIC_URL` correctly |
| Cookies rejected | `PUBLIC_URL` uses HTTP but `NODE_ENV=production` | Set `NODE_ENV=development` or use HTTPS |
| SFTP refused | Port not mapped | Check `SFTP_ENABLED=true` in `.env` |
| SFTP refused (Podman) | Variable interpolation quirk | Set `SFTP_HOST_KEY=` explicitly |
| Passkeys don't work | `PASSKEY_RP_ID` mismatch | Set to bare hostname |
| 2FA codes rejected | Clock drift | Sync server time with NTP |
| Panel blank page | Stale JS bundle | Clear browser cache |

### Podman-Specific Issues

| Problem | Likely Cause | Fix |
|---------|-------------|-----|
| `rootlessport cannot expose privileged port 80` | Rootless can't bind <1024 | Use port 8080 |
| `podman compose up` hangs | Waiting for healthchecks | Normal — check `podman ps` |
| Permission denied on volumes | UID mapping | `chown -R $(id -u):$(id -g)` |

### Agent Connection Issues

| Problem | Likely Cause | Fix |
|---------|-------------|-----|
| Agent shows offline | Wrong `backend_url` in agent config | Update `config.toml` |
| Agent shows offline | Firewall blocking WebSocket | Open outbound port 443 |
| Agent shows offline | TLS certificate issue | Check CA certs; verify `wss://` |
| WebSocket drops | Proxy timeout too short | Set `proxy_read_timeout 86400s` |

---

## Reference: Complete .env Walkthrough

This section explains every variable in `.env.example` in detail.

### General Settings

| Variable | Default | Required? | Description |
|----------|---------|-----------|-------------|
| `NODE_ENV` | `development` | Recommended | `development` for plain HTTP; `production` for HTTPS. Controls HSTS, CSP, and cookie security. |
| `PUBLIC_URL` | `http://localhost:8080` | **Yes** | The exact URL users type into their browser. Drives CORS, auth, and all generated links. No trailing slash. |
| `APP_NAME` | `Catalyst` | No | Panel name shown in emails and UI. |
| `ENABLE_COMPRESSION` | *(commented out)* | No | Must be `false` when behind nginx (Docker). nginx handles compression. |
| `TZ` | `UTC` | No | Timezone for log timestamps and scheduled tasks. Use IANA format: `America/New_York`, `Europe/London`. |
| `LOG_LEVEL` | `info` | No | Pino log level: `fatal`, `error`, `warn`, `info`, `debug`, `trace`. |

### PostgreSQL

| Variable | Default | Required? | Description |
|----------|---------|-----------|-------------|
| `POSTGRES_USER` | `catalyst` | No | PostgreSQL username. |
| `POSTGRES_PASSWORD` | *(placeholder)* | **Yes** | Strong password. Generate: `openssl rand -base64 48 \| tr -d '/+=' \| head -c 32`. |
| `POSTGRES_DB` | `catalyst_db` | No | Database name. |
| `POSTGRES_PORT` | `127.0.0.1:5432` | No | Host port binding. `127.0.0.1` restricts to localhost. Comment out to disable external access entirely. |

### Redis

| Variable | Default | Required? | Description |
|----------|---------|-----------|-------------|
| `REDIS_PASSWORD` | *(empty)* | No | Redis auth password. Leave empty for no password (acceptable when not exposed). |
| `REDIS_PORT` | *(commented out)* | No | Host port binding. Commented out by default — Redis is internal-only. |

> Redis is optional. If unavailable, Catalyst falls back to in-memory caching gracefully.

### Authentication

| Variable | Default | Required? | Description |
|----------|---------|-----------|-------------|
| `BETTER_AUTH_SECRET` | *(placeholder)* | **Yes** | Session encryption key. Generate: `openssl rand -base64 32`. **Rotate carefully — invalidates all sessions.** |
| `PASSKEY_RP_ID` | `localhost` | No | Passkey relying party ID. Must match the hostname portion of `PUBLIC_URL`. No protocol, no port. |

### Ports

| Variable | Default | Required? | Description |
|----------|---------|-----------|-------------|
| `FRONTEND_PORT` | `0.0.0.0:8080` | No | Web panel port. `0.0.0.0` = all interfaces; `127.0.0.1` = localhost only. |
| `BACKEND_PORT` | `0.0.0.0:3000` | No | Backend API port. Should be `127.0.0.1` in production. |
| `SFTP_PORT` | `0.0.0.0:2022` | No | SFTP server port. Must be externally reachable for SFTP access. |

### SFTP

| Variable | Default | Required? | Description |
|----------|---------|-----------|-------------|
| `SFTP_ENABLED` | `true` | No | Enable/disable the built-in SFTP server. |
| `SFTP_HOST_KEY` | *(empty)* | No | Path to SSH host private key. Leave empty to auto-generate. |
| `SFTP_HOST_KEY_BASE64` | *(empty)* | No | Base64-encoded host key. Alternative to `SFTP_HOST_KEY`. |
| `SFTP_MAX_FILE_SIZE` | `104857600` | No | Max upload size in bytes (100 MB). |

### Backups

| Variable | Default | Required? | Description |
|----------|---------|-----------|-------------|
| `BACKUP_STORAGE_MODE` | `local` | No | `local`, `s3`, or `stream`. |
| `BACKUP_S3_BUCKET` | *(commented out)* | For S3 | S3 bucket name. |
| `BACKUP_S3_REGION` | `us-east-1` | For S3 | S3 region. |
| `BACKUP_S3_ACCESS_KEY` | *(commented out)* | For S3 | S3 access key ID. |
| `BACKUP_S3_SECRET_KEY` | *(commented out)* | For S3 | S3 secret access key. |
| `BACKUP_S3_ENDPOINT` | *(commented out)* | For S3 | Custom endpoint (e.g., MinIO). |
| `BACKUP_S3_PATH_STYLE` | `true` | For S3 | `true` for MinIO; `false` for AWS S3. |
| `BACKUP_CREDENTIALS_ENCRYPTION_KEY` | *(empty)* | For S3 | Encrypts S3 credentials in DB. Generate: `openssl rand -hex 32`. |

### Webhooks

| Variable | Default | Required? | Description |
|----------|---------|-----------|-------------|
| `WEBHOOK_URLS` | *(commented out)* | No | Comma-separated webhook URLs. |
| `WEBHOOK_SECRET` | *(commented out)* | No | HMAC signing secret. Generate: `openssl rand -hex 32`. |

### Suspension

| Variable | Default | Required? | Description |
|----------|---------|-----------|-------------|
| `SUSPENSION_ENFORCED` | `true` | No | Enforce suspension across all operations. |
| `SUSPENSION_DELETE_BLOCKED` | `false` | No | Block file deletion on suspended servers. |
| `SUSPENSION_DELETE_POLICY` | `keep` | No | `keep`, `block`, or `allow` deletion. |

### OAuth Providers

| Variable | Default | Required? | Description |
|----------|---------|-----------|-------------|
| `WHMCS_OIDC_CLIENT_ID` | *(commented out)* | No | WHMCS OAuth client ID. |
| `WHMCS_OIDC_CLIENT_SECRET` | *(commented out)* | No | WHMCS OAuth client secret. |
| `WHMCS_OIDC_DISCOVERY_URL` | *(commented out)* | No | WHMCS OIDC discovery endpoint. |
| `PAYMENTER_OIDC_CLIENT_ID` | *(commented out)* | No | Paymenter OAuth client ID. |
| `PAYMENTER_OIDC_CLIENT_SECRET` | *(commented out)* | No | Paymenter OAuth client secret. |
| `PAYMENTER_OIDC_DISCOVERY_URL` | *(commented out)* | No | Paymenter OIDC discovery endpoint. |

### TLS / Reverse Proxy

| Variable | Default | Required? | Description |
|----------|---------|-----------|-------------|
| `DOMAIN` | *(commented out)* | For TLS | Domain for automatic HTTPS. Requires DNS A record. |
| `ACME_EMAIL` | *(commented out)* | For TLS | Email for Let's Encrypt notifications. |
| `HTTP_PORT` | `0.0.0.0:80` | For TLS | HTTP port binding for reverse proxy. |
| `HTTPS_PORT` | `0.0.0.0:443` | For TLS | HTTPS port binding for reverse proxy. |
| `TRAEFIK_DASHBOARD_PORT` | `127.0.0.1:8080` | For Traefik | Traefik dashboard port. `127.0.0.1` = localhost only. Set empty to disable. |

### Auto Updater

| Variable | Default | Required? | Description |
|----------|---------|-----------|-------------|
| `AUTO_UPDATE_ENABLED` | `false` | No | Enable update checking. |
| `AUTO_UPDATE_INTERVAL_MS` | `3600000` | No | Check interval in milliseconds (1 hour). |
| `AUTO_UPDATE_AUTO_TRIGGER` | `false` | No | Auto-apply updates. `false` = notify only. |
| `AUTO_UPDATE_DOCKER_COMPOSE_PATH` | *(commented out)* | No | Path to `docker-compose.yml`. |

---

*Last updated: 2026-05-11*
