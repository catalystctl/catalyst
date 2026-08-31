# Catalyst — Standalone Docker/Podman Deployment

The fastest way to run Catalyst. Uses pre-built images from [GitHub Container Registry](https://github.com/catalystctl/catalyst/pkgs/container/catalyst-backend) — no building required.

> 🏠 **New here?** See [`docs/QUICKSTART.md`](../docs/QUICKSTART.md) for the absolute fastest path, or [`docs/INSTALLATION_DETAILED.md`](../docs/INSTALLATION_DETAILED.md) for a deep-dive covering every option.

---

## ⚡ Super Quick Start (30 seconds)

```bash
cd catalyst-docker
cp .env.example .env
# Edit .env — set PUBLIC_URL, POSTGRES_PASSWORD, BETTER_AUTH_SECRET
nano .env
docker compose up -d
# Open PUBLIC_URL → complete Setup wizard → you are the admin
```

That's it. The first-run **Setup** wizard creates the administrator. No database seeding required.

---

## ⚠️ Agent WebSocket Routing (multi-worker / multi-instance setups)

Each agent holds one long-lived WebSocket to the panel. If you run **multiple
backend instances** behind a load balancer, or set `WORKERS > 1` inside a single
backend, commands to agents (`start`, `stop`, console, backups) will fail
intermittently unless the same agent always reaches the same backend process.

Rules of thumb:

- **Single instance, `WORKERS` unset/0/1** (the default): nothing to do — this is the supported setup.
- **Multiple backend instances**: your LB/reverse proxy must pin an agent's WebSocket session to the instance it connected to, and route the panel→agent command path through that same instance. Session affinity by cookie alone is not enough for machines — key on `nodeId` query parameter or source IP.
- **`WORKERS > 1` in one container**: agent sockets are process-local per Node worker; the panel logs a warning at boot. Prefer `WORKERS=0`.

---

## Table of Contents

- [What You Need](#what-you-need)
- [Quick Start (Step-by-Step)](#quick-start-step-by-step)
- [Configuration Reference](#configuration-reference)
- [Docker vs Podman](#docker-vs-podman)
- [TLS / HTTPS (Automatic)](#tls--https-automatic)
- [Updating](#updating)
- [Troubleshooting](#troubleshooting)
- [Security & Production Checklist](#security--production-checklist)
- [Next Steps](#next-steps)

---

## What You Need

| Requirement | Minimum | Notes |
|---|---|---|
| **Docker** 20.10+ **or** **Podman** 4.0+ | Required | Docker Compose v2 plugin or `podman-compose` |
| **Ports** | 8080, 3000, 2022, 5432, 6379 | Adjust in `.env` if conflicts |
| **RAM** | 2 GB | 4+ GB recommended |
| **Disk** | 10 GB | SSD recommended |

### Rootless Podman — Privileged Ports

Rootless Podman cannot bind ports below 1024 by default. This setup uses **8080** by default to avoid the issue. If you need 80/443 (for TLS overlays), either:

```bash
# Option 1: Allow privileged ports system-wide
echo 'net.ipv4.ip_unprivileged_port_start=80' | sudo tee -a /etc/sysctl.conf
sudo sysctl -p

# Option 2: Use high ports only (this is the default)
# FRONTEND_PORT=0.0.0.0:8080  ← already set in .env.example
```

---

## Quick Start (Step-by-Step)

### 1. Configure `.env`

Copy the example file and edit:

```bash
cp .env.example .env
nano .env
```

#### Required Variables

| Variable | Required | How to Set | Description |
|---|---|---|---|
| `PUBLIC_URL` | ✅ Yes | Your browser URL | `http://localhost:8080` or `http://192.168.1.78:8080` |
| `POSTGRES_PASSWORD` | ✅ Yes | Strong password | Database password (≥16 chars recommended) |
| `BETTER_AUTH_SECRET` | ✅ Yes | `openssl rand -base64 32` | Session encryption key |

#### Recommended Variables

| Variable | Default | When to Change |
|---|---|---|
| `PASSKEY_RP_ID` | `localhost` | Set to hostname from `PUBLIC_URL` for passkeys |
| `FRONTEND_PORT` | `0.0.0.0:8080` | Change to `127.0.0.1:8080` to block external access |
| `BACKEND_PORT` | `127.0.0.1:3000` | Change to `127.0.0.1:3000` for localhost-only API |

> SFTP is served by the node agent (default port `2022`), not by this compose stack.

> **`PUBLIC_URL` is the single source of truth.** It automatically drives `BETTER_AUTH_URL`, `CORS_ORIGIN`, `FRONTEND_URL`, `BACKEND_EXTERNAL_ADDRESS`, and `BACKEND_URL`. You only need to override those individually for split DNS setups.

#### LAN / Remote Access

If accessing from another machine on your network (not just `localhost`):

```bash
# Find your LAN IP
hostname -I | awk '{print $1}'

# Then in .env:
PUBLIC_URL=http://<YOUR_LAN_IP>:8080
PASSKEY_RP_ID=<YOUR_LAN_IP>
FRONTEND_PORT=0.0.0.0:8080
BACKEND_PORT=0.0.0.0:3000
```

### 2. Start the stack

```bash
# Docker
docker compose up -d

# Podman
podman compose up -d
```

> **Note:** `podman-compose` may appear to hang — it waits for healthchecks. This is normal. Verify in another terminal: `docker ps` or `podman ps`.

### 3. Verify everything is running

```bash
docker compose ps
# or
podman compose ps
```

Expected output — all containers `Up` with postgres/redis/backend showing `(healthy)`:

| Container | Status | Exposed Port |
|---|---|---|
| `catalyst-postgres` | `healthy` | `127.0.0.1:5432` |
| `catalyst-redis` | `healthy` | `127.0.0.1:6379` |
| `catalyst-backend` | `healthy` | `127.0.0.1:3000` |
| `catalyst-frontend` | `running` | `0.0.0.0:8080` |

If any container shows `(unhealthy)` or `Restarting`, see [Troubleshooting](#troubleshooting).

### 4. Access the panel

Open `PUBLIC_URL` in your browser (e.g. `http://192.168.1.78:8080`).

Complete the **Setup** wizard on first visit; that account becomes the administrator and open registration is disabled.

> **Optional:** If you want pre-seeded demo data, run:
> ```bash
> docker compose exec backend pnpm run db:seed
> ```
> Default credentials: `admin@example.com` / `admin123` — **change immediately**.

---

## Configuration Reference

### Services

The Docker Compose stack defines four services:

| Service | Image | Purpose | Exposed Port |
|---|---|---|---|
| `postgres` | `postgres:16-alpine` | Primary database | `127.0.0.1:5432` |
| `redis` | `redis:7-alpine` | Present in compose; **not** the Better Auth session store in current backend | `127.0.0.1:6379` |
| `backend` | `ghcr.io/catalystctl/catalyst-backend:latest` | Fastify API (SFTP runs on the node agent, not here) | `127.0.0.1:3000` |
| `frontend` | `ghcr.io/catalystctl/catalyst-frontend:latest` | Nginx static SPA | `0.0.0.0:8080` |

### Service Dependencies

```
frontend → backend → postgres
                ↘ redis
```

The frontend waits for the backend health check before starting. The backend waits for both PostgreSQL and Redis.

### Volumes

All data persists in named volumes:

| Volume | Purpose |
|---|---|
| `catalyst-postgres-data` | PostgreSQL database files |
| `catalyst-server-data` | Game server files |
| `catalyst-backup-data` | Backup archives |
| `catalyst-plugin-data` | Installed plugins |
| `caddy-data` | Caddy TLS certificates (Caddy overlay) |
| `traefik-certs` | Traefik ACME certificates (Traefik overlay) |

### Environment Injection

Setting `PUBLIC_URL` automatically configures:
- `BETTER_AUTH_URL`
- `CORS_ORIGIN`
- `FRONTEND_URL`
- `BACKEND_EXTERNAL_ADDRESS`
- `BACKEND_URL`

You only need to override these individually for split internal/external setups.

---

## Docker vs Podman

Both Docker and Podman are fully supported. The workflow is identical — just replace `docker` with `podman`:

| Task | Docker | Podman |
|---|---|---|
| Start stack | `docker compose up -d` | `podman compose up -d` |
| View logs | `docker compose logs -f` | `podman compose logs -f` |
| Pull updates | `docker compose pull` | `podman compose pull` |
| View containers | `docker ps` | `podman ps` |
| Stop stack | `docker compose down` | `podman compose down` |

### Podman-Specific Notes

1. **Privileged ports:** Rootless Podman cannot bind below 1024. Use port 8080 (default) or allow privileged ports (see [What You Need](#what-you-need)).

2. **Port merging:** `podman-compose` merges port lists instead of replacing them. When using a TLS overlay, set `FRONTEND_PORT=127.0.0.1:8080` in `.env` to prevent double exposure.

3. **Docker socket path:** If running the agent on the same host, adjust the socket path:
   ```yaml
   volumes:
     - /run/user/1000/podman/podman.sock:/var/run/docker.sock
   ```

---

## TLS / HTTPS (Automatic)

Two compose overlay files provide automatic HTTPS with Let's Encrypt. Choose one:

| Option | Best For | Compose File |
|---|---|---|
| **Caddy** | Simplicity — zero-config, 2-line Caddyfile | `docker-compose.caddy.yml` |
| **Traefik** | Advanced — Docker-native discovery, dashboard | `docker-compose.traefik.yml` |

Both overlays:
- Remove direct frontend host exposure
- Auto-obtain and renew Let's Encrypt certificates (ACME HTTP-01)
- Redirect HTTP → HTTPS automatically
- Persist certificates across restarts

### Prerequisites for TLS

1. DNS **A record** pointing your domain to this host's public IP
2. Ports **80** and **443** reachable from the internet (required for ACME challenge)
3. For rootless Podman: allow privileged ports (see [What You Need](#what-you-need))

### Option A: Caddy (Recommended)

**1. Configure `.env`:**

```bash
DOMAIN=panel.example.com
ACME_EMAIL=admin@example.com        # optional but recommended
PUBLIC_URL=https://panel.example.com  # must be https://
NODE_ENV=production                   # enables HSTS in the backend
```

**2. Start with the Caddy overlay:**

```bash
docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d
```

That's it. Visit `https://panel.example.com` — Caddy handles everything.

### Option B: Traefik

**1. Configure `.env` (same as Caddy):**

```bash
DOMAIN=panel.example.com
ACME_EMAIL=admin@example.com
PUBLIC_URL=https://panel.example.com
NODE_ENV=production
```

**2. Start with the Traefik overlay:**

```bash
docker compose -f docker-compose.yml -f docker-compose.traefik.yml up -d
```

**3. (Optional) Access the Traefik dashboard:**

Open `http://127.0.0.1:8080` on the server (localhost only by default).

> **Security:** Never expose the Traefik dashboard on `0.0.0.0` without authentication. Set `TRAEFIK_DASHBOARD_PORT=` to disable it entirely.

### Switching from Plain HTTP to HTTPS

If you already have a running stack without TLS:

1. Update `.env` — set `DOMAIN`, `PUBLIC_URL=https://...`, and `NODE_ENV=production`
2. Pull updated images: `docker compose pull`
3. Start with overlay: `docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d`

### How TLS Works

```
Internet → Caddy/Traefik (443/80) → frontend nginx (:80) → backend (:3000)
```

- The **reverse proxy** terminates TLS and forwards plain HTTP to nginx
- **nginx** preserves the `X-Forwarded-Proto: https` header
- The **backend** sees the correct protocol and applies security headers
- **SFTP** is unaffected — it's served by the node agent (default port 2022), a separate protocol

### ⚠️ HSTS Warning

When `NODE_ENV=production`, the backend sets:
- `Strict-Transport-Security` (HSTS) — forces browsers to use HTTPS
- `upgrade-insecure-requests` in CSP — auto-upgrades HTTP to HTTPS

**Never set `NODE_ENV=production` with plain HTTP.** Browsers will cache HSTS and refuse to load `http://` resources, breaking the panel. Keep `NODE_ENV=development` when running without TLS.

### PASSKEY_RP_ID Must Match Your Domain

WebAuthn/Passkey authentication will fail if `PASSKEY_RP_ID` doesn't match your domain:

```bash
# For https://panel.example.com → PASSKEY_RP_ID=panel.example.com
# For http://localhost:8080 → PASSKEY_RP_ID=localhost
# For LAN → PASSKEY_RP_ID=192.168.1.100
```

No protocol, no port — the bare hostname or IP only.

---

## Updating

Pull the latest pre-built images and restart:

```bash
docker compose pull
docker compose up -d
```

The backend entrypoint automatically runs database migrations on startup. No manual migration step needed.

> **Post-upgrade:** Verify node agents are connected in the admin panel. For node deployment procedures, see [`docs/agent.md`](../docs/agent.md).

---

## Troubleshooting

### Containers won't start or keep restarting

```bash
# Check all container statuses
docker compose ps

# Check logs for the failing container
docker compose logs --tail=50 backend
docker compose logs --tail=50 postgres
docker compose logs --tail=50 redis
```

**Common causes:**

| Symptom | Cause | Fix |
|---|---|---|
| Backend crashes on start | Missing `BETTER_AUTH_SECRET` or `POSTGRES_PASSWORD` | Verify both are set in `.env` |
| Backend keeps restarting | Database not ready yet | Wait 30s for postgres healthcheck; check `docker compose logs postgres` |
| Frontend never starts | Backend unhealthy | Fix backend first; frontend depends on backend |
| Port already in use | Another service uses 8080, 3000, or 2022 | Change ports in `.env` |

### Health check failures

```bash
# Check individual health
docker compose exec backend curl -sf http://localhost:3000/health || echo "UNHEALTHY"
docker compose exec postgres pg_isready -U catalyst || echo "UNHEALTHY"
docker compose exec redis redis-cli ping || echo "UNHEALTHY"
```

**PostgreSQL failing health check:**
- Ensure `POSTGRES_PASSWORD` is set and non-empty
- Check if the database volume is corrupted: `docker compose logs postgres`

**Backend failing health check:**
- Usually means it can't connect to PostgreSQL
- Verify `DATABASE_URL` is constructed correctly (derived from `POSTGRES_PASSWORD`)
- Check `docker compose logs backend` for connection errors

### Port conflicts

```bash
# Check what's using a port
ss -tlnp | grep :8080
ss -tlnp | grep :3000

# Change in .env, e.g.:
FRONTEND_PORT=0.0.0.0:8081
BACKEND_PORT=127.0.0.1:3001
```

### Database connection issues

**Symptom:** `Error: P1001 Can't reach database server`

```bash
# Verify PostgreSQL is running
docker compose ps postgres
docker compose logs postgres

# Ensure POSTGRES_PASSWORD is set in .env
grep POSTGRES_PASSWORD .env

# Test connection manually
docker compose exec postgres psql -U catalyst -d catalyst_db -c "SELECT 1;"

# For a fresh database, seed it:
docker compose exec backend pnpm run db:seed
```

**Symptom:** `Error: P1000 Authentication failed` / postgres log
`password authentication failed for user "catalyst"`

**Cause:** `POSTGRES_PASSWORD` in `.env` no longer matches the password stored
inside the existing `catalyst-postgres-data` volume. The official Postgres image
only reads `POSTGRES_PASSWORD` the **first** time the data directory is created.
This commonly happens after:
- re-running `install.sh --reconfigure` / a second install that regenerated secrets
- editing `POSTGRES_PASSWORD` in `.env` and restarting without wiping volumes
- uninstalling (which keeps volumes) then installing again with a new password

**Fix (fresh install / wipe data):**

```bash
docker compose down
# Project-prefixed name is typically catalyst-docker_catalyst-postgres-data
docker volume ls | grep catalyst-postgres
docker volume rm <the-postgres-volume-name>
docker compose up -d
```

**Fix (keep data, restore the old password):** put the original password back in
`.env` as `POSTGRES_PASSWORD=...`, then `docker compose up -d --force-recreate backend`.

**Fix (keep data, set a new password inside Postgres):**

```bash
# From the host, using the CURRENT (old) password via the postgres container
# which authenticates locally as the superuser without the app password:
docker compose exec postgres psql -U catalyst -d catalyst_db \
  -c "ALTER USER catalyst WITH PASSWORD 'your-new-password';"
# Then set POSTGRES_PASSWORD=your-new-password in .env and recreate backend.
```

### `podman compose up -d` hangs

This is normal — `podman-compose` waits for all healthchecks before returning. Check progress:

```bash
podman ps
```

If stuck for more than 3 minutes, check individual container logs:

```bash
podman logs catalyst-backend
podman logs catalyst-postgres
podman logs catalyst-redis
```

### Redis healthcheck failing

The healthcheck must use `CMD-SHELL` string form (not JSON array) for podman compatibility. The compose file is already patched for this.

### `rootlessport cannot expose privileged port 80`

Rootless Podman cannot bind ports below 1024. Two options:

1. **Use high port (default):** `FRONTEND_PORT=0.0.0.0:8080`
2. **Allow privileged ports:**
   ```bash
   echo 'net.ipv4.ip_unprivileged_port_start=80' | sudo tee -a /etc/sysctl.conf
   sudo sysctl -p
   ```

### Reset everything (⚠️ destroys all data)

```bash
docker compose down -v
# This deletes all volumes including databases, server files, and backups
```

---

## Security & Production Checklist

Before exposing Catalyst to the internet, complete this checklist:

- [ ] Set `NODE_ENV=production` in `.env`
- [ ] Change `POSTGRES_PASSWORD` from the example value (≥16 characters)
- [ ] Generate a strong `BETTER_AUTH_SECRET` (`openssl rand -base64 32`)
- [ ] Set up TLS (Caddy, Traefik, or external reverse proxy)
- [ ] Set `PUBLIC_URL` to your real domain (`https://panel.example.com`)
- [ ] Set `PASSKEY_RP_ID` to match your domain
- [ ] Restrict `BACKEND_PORT` to `127.0.0.1:3000` (localhost only)
- [ ] Disable external PostgreSQL access (keep `POSTGRES_PORT=127.0.0.1:5432`)
- [ ] Disable external Redis access (comment out `REDIS_PORT`)
- [ ] Generate a backup encryption key: `openssl rand -hex 32`
- [ ] Configure SMTP for password resets and notifications
- [ ] Set up automated database backups
- [ ] Review and adjust rate limits in Admin → Security
- [ ] Enable audit log retention (default: 90 days)
- [ ] Set `COOKIE_SECURE=true` when behind HTTPS
- [ ] Configure OAuth providers if using SSO
- [ ] Set up monitoring and alerting

### View Logs

```bash
# All services (follow mode)
docker compose logs -f

# Specific service
docker compose logs -f backend
docker compose logs -f postgres

# Last 100 lines
docker compose logs --tail=100 backend
```

### Useful Commands

| Command | Description |
|---|---|
| `docker compose up -d` | Start all services |
| `docker compose up -d --build` | Build and start (if building from source) |
| `docker compose logs -f` | Tail all logs |
| `docker compose logs -f backend` | Tail backend logs |
| `docker compose exec backend pnpm run db:seed` | Seed database with sample data |
| `docker compose exec backend pnpm run db:studio` | Open Prisma Studio GUI |
| `docker compose exec backend sh` | Shell into backend container |
| `docker compose down` | Stop services (keep volumes) |
| `docker compose down -v` | Stop and delete all data volumes |
| `docker compose ps` | List service status |
| `docker compose pull` | Update images to latest |

---

## Next Steps

- **New user?** Read [`docs/getting-started.md`](../docs/getting-started.md) for a walkthrough: create your first server, install the agent, manage templates.
- **Admin?** Read [`docs/admin-guide.md`](../docs/admin-guide.md) for node deployment, user management, RBAC, and system configuration.
- **Developer?** Read [`docs/development.md`](../docs/development.md) for local dev setup, testing, and plugin development.
- **API integration?** Read [`docs/api-reference.md`](../docs/api-reference.md) for the complete REST API reference.
- **Full details?** Read [`docs/INSTALLATION_DETAILED.md`](../docs/INSTALLATION_DETAILED.md) for every option, edge case, and advanced configuration.

---

*Last updated: 2026-05-11*
