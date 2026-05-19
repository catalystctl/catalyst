# Docker Setup Guide

> Complete reference for deploying Catalyst with Docker Compose — services, volumes, networking, TLS, health checks, updating, and production hardening.
>
> **New to Catalyst?** Start with the [Quick Start](QUICKSTART.md) for a 5-minute setup, then come back here for the full reference.

---

## Security Checklist (Before You Start)

Use this checklist before going to production. Details for each item are in the sections below.

| # | Check | Section |
|---|-------|---------|
| 1 | `PUBLIC_URL` is set to your real domain | [Environment](#environment-injection) |
| 2 | `POSTGRES_PASSWORD` is a strong, unique password | [Environment](#environment-injection) |
| 3 | `BETTER_AUTH_SECRET` was generated with `openssl rand -base64 32` | [Environment](#environment-injection) |
| 4 | `NODE_ENV=production` when using HTTPS | [TLS / HTTPS](#tls--https-setup) |
| 5 | Ports below 1024 are only used if you understand the implications | [Networking](#networking) |
| 6 | `BACKEND_PORT` and `POSTGRES_PORT` bound to `127.0.0.1` | [Networking](#networking) |
| 7 | Backup encryption key is set if using S3 backups | [Environment](#environment-injection) |
| 8 | Auto-updater is enabled with `AUTO_UPDATE_AUTO_TRIGGER=false` | [Updating](#updating) |

---

## Quick Start (I Want to Run This Now)

If you already have Docker Compose installed and just want Catalyst running:

```bash
# 1. Get the files
curl -fsSL https://raw.githubusercontent.com/catalystctl/catalyst/main/install.sh | bash
cd catalyst-docker

# 2. Configure
cp .env.example .env
# Edit .env — set PUBLIC_URL and generate secrets
nano .env

# 3. Start
docker compose up -d

# 4. Verify
docker compose ps
curl http://localhost:3000/health
```

That's it. Open your `PUBLIC_URL` in a browser. The first user to register becomes admin.

> **Want more detail?** Read the full [Installation Guide](installation.md) or continue below for the complete Docker reference.

---

## Prerequisites

| Requirement | Minimum | Recommended |
|---|---|---|
| **Container runtime** | Docker 20.10+ or Podman 4.0+ | Docker 26+ (rootless) |
| **Compose** | Docker Compose V2 or `podman-compose` | Latest stable |
| **RAM** | 2 GB | 4+ GB |
| **Disk** | 20 GB | 50+ GB SSD |
| **Ports** | 80, 3000, 2022 (or custom via `.env`) | 80, 443, 2022 |

> **Note:** Docker Compose is the **only supported deployment method**. Direct bare-metal installation is not supported.

---

## Services Overview

The Docker Compose stack (`catalyst-docker/docker-compose.yml`) defines four core services:

| Service | Image | Purpose | Default Exposed Port |
|---------|-------|---------|---------------------|
| `postgres` | `postgres:16-alpine` | Primary database | `127.0.0.1:5432` |
| `redis` | `redis:7-alpine` | Cache / session store | `127.0.0.1:6379` |
| `backend` | `ghcr.io/catalystctl/catalyst-backend:latest` | Fastify API + SFTP server | `127.0.0.1:3000`, `0.0.0.0:2022` |
| `frontend` | `ghcr.io/catalystctl/catalyst-frontend:latest` | Nginx static SPA | `0.0.0.0:80` |

### What Each Service Does

**PostgreSQL** stores all persistent data: users, servers, nodes, templates, roles, audit logs, and settings. It is the single source of truth for the entire panel.

**Redis** provides optional caching, rate limiting, and session storage. If Redis is unavailable, Catalyst falls back to in-memory caching gracefully.

**Backend** is the heart of Catalyst: Fastify API server, WebSocket gateway for agent communication, SFTP file server, plugin loader, task scheduler, alert service, and webhook dispatcher. It auto-runs database migrations on startup.

**Frontend** is a static React SPA served by Nginx. It proxies `/api/*` and `/ws` requests to the backend. All frontend assets are built at image build time — no runtime compilation needed.

### Service Dependencies

```
frontend → backend → postgres
                ↘ redis
```

The frontend waits for the backend health check to pass before starting. The backend waits for both PostgreSQL and Redis health checks. On first startup, this cascade can take 1–3 minutes.

---

## Volume Management

Catalyst uses five named Docker volumes that persist data across container restarts:

| Volume | Mount Point | Purpose |
|--------|-------------|---------|
| `catalyst-postgres-data` | `/var/lib/postgresql/data` | Database files |
| `catalyst-server-data` | `/var/lib/catalyst/servers` | Game server files |
| `catalyst-backup-data` | `/var/lib/catalyst/backups` | Backup archives |
| `catalyst-plugin-data` | `/var/lib/catalyst/plugins` | Plugin files |
| `caddy-data` / `traefik-certs` | — | TLS certificates (when using Caddy/Traefik overlays) |

### Where Volumes Live

Docker stores volumes in `/var/lib/docker/volumes/` (Docker) or `~/.local/share/containers/storage/volumes/` (rootless Podman).

```bash
# List Catalyst volumes
docker volume ls | grep catalyst

# Inspect a volume
docker volume inspect catalyst-postgres-data
```

### Backup Volumes

**Full backup script:**

```bash
#!/bin/bash
BACKUP_DIR="./catalyst-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

# Stop the stack first for a consistent snapshot
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

**Restore from backup:**

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

**Database-only backup (while running):**

```bash
docker compose exec postgres pg_dump -U catalyst catalyst_db > catalyst-db-$(date +%Y%m%d).sql
```

**Database-only restore:**

```bash
docker compose down
docker compose up -d postgres
sleep 5
docker compose exec -T postgres psql -U catalyst -d catalyst_db < catalyst-db-20260101.sql
docker compose up -d
```

### Reset Everything

::: danger Destructive
This deletes **all** data including databases, server files, backups, and plugins. This cannot be undone.
:::

```bash
docker compose down -v
```

To also remove images:

```bash
docker compose down -v --rmi all
```

---

## Networking

### Default Network

All services communicate on an internal Docker bridge network (`catalyst_default`). No external access is required for `postgres` and `redis` — they are only reachable from other containers within the Compose network.

### Custom Networks

To isolate Catalyst from other containers or use a specific IP range:

```yaml
# docker-compose.override.yml
networks:
  catalyst:
    driver: bridge
    ipam:
      config:
        - subnet: 172.28.0.0/16
```

Then start with: `docker compose -f docker-compose.yml -f docker-compose.override.yml up -d`

### Port Binding Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `FRONTEND_PORT` | `0.0.0.0:80` | Panel access. Use `127.0.0.1:8080` to restrict to localhost. |
| `BACKEND_PORT` | `127.0.0.1:3000` | API access. Usually localhost-only (proxied by nginx). |
| `SFTP_PORT` | `0.0.0.0:2022` | SFTP file access. Must be externally reachable. |
| `POSTGRES_PORT` | `127.0.0.1:5432` | Database. Disable by commenting out if not needed externally. |
| `REDIS_PORT` | `127.0.0.1:6379` | Redis. Optional — comment out to disable external access. |

::: tip Rootless Podman
Rootless Podman cannot bind ports below 1024. Use `FRONTEND_PORT=0.0.0.0:8080` instead of `:80`.
:::

---

## TLS / HTTPS Setup

Catalyst supports three TLS options. Choose **one**.

### Option A: Caddy (Recommended — Zero Config)

Caddy is the simplest option. One command, automatic Let's Encrypt certificates, HTTP→HTTPS redirect.

**Prerequisites:**
- DNS A record pointing your domain to your server's public IP
- Ports 80 and 443 reachable from the internet (required for ACME challenge)

**Steps:**

1. **Set your domain in `.env`:**

   ```env
   DOMAIN=panel.example.com
   ACME_EMAIL=admin@example.com
   PUBLIC_URL=https://panel.example.com
   NODE_ENV=production
   FRONTEND_PORT=127.0.0.1:8080
   ```

2. **Start with the Caddy overlay:**

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d
   ```

3. **Verify:**

   ```bash
   docker compose ps
   curl -I https://panel.example.com
   ```

That's it. Caddy handles certificate issuance, renewal, and redirects automatically. Certificates persist in the `caddy-data` volume.

### Option B: Traefik (Advanced — Docker Native)

Traefik offers Docker-native service discovery, a web dashboard, and more routing flexibility.

**Prerequisites:** Same as Caddy (DNS + ports 80/443).

**Steps:**

1. **Set your domain in `.env`:**

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

3. **(Optional) Access the Traefik dashboard:**

   ```bash
   ssh -L 8080:localhost:8080 your-server
   # Then open http://localhost:8080 in your browser
   ```

   > **Security:** Never expose the Traefik dashboard on `0.0.0.0` without authentication. Set `TRAEFIK_DASHBOARD_PORT=` to disable it entirely.

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

2. **Proxy traffic to `http://localhost:8080`:**

   **Nginx example:**

   ```nginx
   server {
       listen 443 ssl http2;
       server_name panel.example.com;

       ssl_certificate     /etc/letsencrypt/live/panel.example.com/fullchain.pem;
       ssl_certificate_key /etc/letsencrypt/live/panel.example.com/privkey.pem;

       client_max_body_size 100m;

       location / {
           proxy_pass http://127.0.0.1:8080;
           proxy_http_version 1.1;
           proxy_set_header Connection "";
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }

       # WebSocket support (agent connections, admin event stream)
       location /ws {
           proxy_pass http://127.0.0.1:8080;
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

   **Caddy example:**

   ```caddy
   panel.example.com {
       reverse_proxy localhost:8080
   }
   ```

::: warning CORS and Cookies
When using a reverse proxy, ensure `PUBLIC_URL` exactly matches the URL users access. Mismatches cause CORS errors and cookie rejection. If your proxy adds or removes `www.`, set `PUBLIC_URL` accordingly.
:::

::: warning HSTS and NODE_ENV
When `NODE_ENV=production`, the backend sets `Strict-Transport-Security` (HSTS). Never set `NODE_ENV=production` with plain HTTP — browsers will cache HSTS and refuse to load `http://` resources. Keep `NODE_ENV=development` when running behind no TLS.
:::

---

## Environment Injection

The `docker-compose.yml` passes environment variables directly to containers. All configuration is driven by the `.env` file.

### `PUBLIC_URL` Is the Single Source of Truth

When you set `PUBLIC_URL`, these are automatically derived:

| Derived Variable | Source |
|-----------------|--------|
| `BETTER_AUTH_URL` | `PUBLIC_URL` |
| `CORS_ORIGIN` | `PUBLIC_URL` |
| `FRONTEND_URL` | `PUBLIC_URL` |
| `BACKEND_EXTERNAL_ADDRESS` | `PUBLIC_URL` |
| `BACKEND_URL` | `PUBLIC_URL` |

You only need to override these individually for split internal/external setups (e.g., internal Docker network addresses differ from public URLs).

### Critical Variables

| Variable | How to Set | Notes |
|----------|-----------|-------|
| `PUBLIC_URL` | `.env` file | **Required.** The exact URL users type into their browser. No trailing slash. |
| `POSTGRES_PASSWORD` | `.env` file | **Required.** Strong password. No default. |
| `BETTER_AUTH_SECRET` | `.env` file | **Required.** Generate with `openssl rand -base64 32`. |
| `BACKUP_CREDENTIALS_ENCRYPTION_KEY` | `.env` file | Required for S3 backups. Generate with `openssl rand -hex 32`. |
| `SFTP_HOST_KEY` | `.env` or auto-generated | Path to SSH host key. Leave empty to auto-generate on first start. |

### Generating Secrets

```bash
# Better Auth secret (session encryption)
openssl rand -base64 32

# Backup encryption key
openssl rand -hex 32

# Webhook signing secret
openssl rand -hex 32

# API key signing secret
openssl rand -base64 32
```

---

## Health Checks

Each service includes a health check:

| Service | Check | Interval | Failure Action |
|---------|-------|----------|---------------|
| `postgres` | `pg_isready -U catalyst` | 10s | Backend returns 503, frontend won't start |
| `redis` | `redis-cli ping` | 10s | Graceful fallback to in-memory cache |
| `backend` | `curl -sf http://localhost:3000/health` | 15s | Frontend won't start |

The backend health check also verifies database connectivity. If PostgreSQL is unreachable, the backend returns HTTP 503 and the frontend container will not start.

```bash
# Check all services
docker compose ps

# Check backend health
curl http://localhost:3000/health

# Check individual service health
docker compose exec postgres pg_isready -U catalyst
docker compose exec redis redis-cli ping
```

---

## Image Version Pinning

By default, Catalyst uses `latest` tags for pre-built images. For production, pin to specific versions for reproducible deployments.

### How to Pin Versions

1. **Check available versions:**

   ```bash
   # List available image tags
   curl -s https://ghcr.io/token?scope=repository:catalystctl/catalyst-backend:pull | jq -r '.token'
   # Or check the GitHub releases page: https://github.com/catalystctl/catalyst/releases
   ```

2. **Pin in `.env`:**

   ```env
   BACKEND_IMAGE=ghcr.io/catalystctl/catalyst-backend:v1.2.3
   FRONTEND_IMAGE=ghcr.io/catalystctl/catalyst-frontend:v1.2.3
   ```

3. **Update `docker-compose.yml` to use the variables:**

   ```yaml
   services:
     backend:
       image: ${BACKEND_IMAGE:-ghcr.io/catalystctl/catalyst-backend:latest}
     frontend:
       image: ${FRONTEND_IMAGE:-ghcr.io/catalystctl/catalyst-frontend:latest}
   ```

### Version Update Workflow

```bash
# 1. Check current version
docker compose exec backend cat /app/package.json | grep version

# 2. Update .env with new version
sed -i 's/v1.2.3/v1.2.4/' .env

# 3. Pull and restart
docker compose pull
docker compose up -d

# 4. Verify
docker compose ps
curl http://localhost:3000/health
```

---

## Updating

### Automatic Updates (Built-in)

Enable in `.env`:

```env
AUTO_UPDATE_ENABLED=true
AUTO_UPDATE_INTERVAL_MS=3600000
AUTO_UPDATE_AUTO_TRIGGER=false
```

- `AUTO_UPDATE_AUTO_TRIGGER=false`: Backend notifies admins when an update is available. Admin approves via the panel.
- `AUTO_UPDATE_AUTO_TRIGGER=true`: Backend automatically pulls new images and restarts the stack. **Use with caution.**

### Manual Update

```bash
cd catalyst-docker

# Pull latest images
docker compose pull

# Restart with new images
docker compose up -d

# Verify all services are healthy
docker compose ps
```

The backend entrypoint automatically runs `prisma migrate deploy` on every startup, so database migrations are applied before the API starts accepting connections.

### Rollback

If an update breaks something, roll back to the previous image version:

```bash
# 1. Identify the previous image tag
docker images | grep catalyst-backend

# 2. Update .env to pin the previous version
#    BACKEND_IMAGE=ghcr.io/catalystctl/catalyst-backend:v1.2.3
#    FRONTEND_IMAGE=ghcr.io/catalystctl/catalyst-frontend:v1.2.3

# 3. Restart with the pinned version
docker compose up -d

# 4. If the database migration failed, you may need to restore from backup
#    See the Volume Management section above.
```

### Database Migrations After Update

Migrations run automatically, but you can verify:

```bash
docker compose exec backend bunx prisma migrate status --schema prisma/schema.prisma
```

If migrations are pending but the backend is running, they were likely applied on startup. If you see failures:

```bash
# View migration logs
docker compose logs backend | grep -i "migrat"

# Run manually (only if auto-migration failed)
docker compose exec backend bun run db:migrate
```

---

## Common Pitfalls

### 1. Port Conflicts

**Symptom:** `docker compose up` fails with "address already in use" or containers won't start.

**Check:**

```bash
ss -tlnp | grep -E ':(80|8080|3000|2022|5432|6379)'
```

**Fix:** Change the conflicting port in `.env`:

```env
FRONTEND_PORT=0.0.0.0:8081
BACKEND_PORT=127.0.0.1:3001
```

### 2. Permission Issues with Volumes

**Symptom:** PostgreSQL fails to start with "Permission denied" on data directory.

**Cause:** Docker volumes created with one user ID and accessed by another, or SELinux/AppArmor blocking access.

**Fix:**

```bash
# Recreate the volume with correct permissions
docker compose down
docker volume rm catalyst-postgres-data
docker compose up -d postgres

# For SELinux, add :Z or :z to volume mounts in docker-compose.yml
# volumes:
#   - catalyst-postgres-data:/var/lib/postgresql/data:Z
```

### 3. Podman Rootless Gotchas

**Symptom:** Various failures when running rootless Podman.

**Common fixes:**

| Issue | Fix |
|-------|-----|
| Can't bind port 80 | Use `FRONTEND_PORT=0.0.0.0:8080` |
| `podman compose up` hangs | Normal — it waits for healthchecks. Check `podman ps` in another terminal. |
| Permission denied on volumes | Rootless Podman maps your UID. Ensure files are owned by your user. |
| Can't access containerd socket | The agent needs root or the `containerd` group. See the [Agent Guide](agent.md). |

### 4. SFTP Host Key Issues

**Symptom:** SFTP connection fails or backend crashes on startup.

**Cause:** `podman-compose` may pass literal `${VAR:-}` strings instead of empty values for `SFTP_HOST_KEY`.

**Fix:** Explicitly set these in `.env`:

```env
SFTP_HOST_KEY=
SFTP_HOST_KEY_BASE64=
```

The backend will auto-generate a host key on first start.

### 5. First-Time Startup Takes 2–3 Minutes

**Symptom:** `docker compose up -d` seems to hang. `docker compose ps` shows containers as `starting` or `unhealthy`.

**This is normal.** On first run:
1. PostgreSQL initializes its data directory (~30s)
2. Redis starts (~5s)
3. Backend waits for PostgreSQL health check (~20s)
4. Backend runs Prisma migrations (~30s–2min depending on database size)
5. Frontend waits for backend health check (~15s)

**Check progress:**

```bash
docker compose ps
docker compose logs -f backend
```

### 6. `DATABASE_URL` vs `POSTGRES_PASSWORD` Confusion

**The Docker Compose setup uses `POSTGRES_PASSWORD`, not `DATABASE_URL`.**

| Variable | Used By | You Set It? |
|----------|---------|-------------|
| `POSTGRES_PASSWORD` | Docker Compose → PostgreSQL container | **Yes** (in `.env`) |
| `DATABASE_URL` | Backend code → connect to PostgreSQL | **No** (auto-built from `POSTGRES_PASSWORD` inside the container) |

The backend container's entrypoint constructs `DATABASE_URL` from `POSTGRES_PASSWORD`. You do **not** need to set `DATABASE_URL` in the Docker Compose `.env`.

If you're running the backend outside Docker (development), then you **do** need `DATABASE_URL` in `catalyst-backend/.env`.

### 7. `PUBLIC_URL` Mismatch

**Symptom:** Login works but you get CORS errors, or cookies are rejected, or OAuth callbacks fail.

**Cause:** `PUBLIC_URL` doesn't match the URL in your browser's address bar.

**Examples:**

| Browser URL | Correct `PUBLIC_URL` |
|-------------|---------------------|
| `http://localhost:8080` | `http://localhost:8080` |
| `http://192.168.1.100:8080` | `http://192.168.1.100:8080` |
| `https://panel.example.com` | `https://panel.example.com` |
| `https://www.example.com` | `https://www.example.com` |

**Fix:** Update `.env`, restart the backend:

```bash
# Edit .env
nano .env

# Restart
docker compose restart backend
```

### 8. `NODE_ENV=production` Without TLS

**Symptom:** Browser refuses to load the panel, or assets fail to load with "mixed content" errors.

**Cause:** `NODE_ENV=production` enables HSTS and `upgrade-insecure-requests` CSP. Browsers cache these and refuse HTTP.

**Fix:** Set `NODE_ENV=development` until you have HTTPS configured.

---

## Podman Compose

Podman Compose is a drop-in replacement. Key differences from Docker:

1. **Port binding:** Use ports above 1024 for rootless mode:
   ```env
   FRONTEND_PORT=0.0.0.0:8080
   ```

2. **Socket path:** If running the agent on the same host, adjust the Docker socket path:
   ```yaml
   volumes:
     - /run/user/1000/podman/podman.sock:/var/run/docker.sock
   ```

3. **SFTP host key:** Explicitly set `SFTP_HOST_KEY=` and `SFTP_HOST_KEY_BASE64=` in `.env` due to Podman variable interpolation quirks.

All other commands are identical — just replace `docker` with `podman`.

---

## Production Hardening Checklist

- [ ] Set `NODE_ENV=production` in `.env` (only with HTTPS)
- [ ] Change all default passwords and generate strong secrets
- [ ] Use TLS (Caddy, Traefik, or external reverse proxy)
- [ ] Restrict `BACKEND_PORT` and `POSTGRES_PORT` to `127.0.0.1`
- [ ] Disable external Redis access (comment out `REDIS_PORT`)
- [ ] Pin image versions instead of using `latest`
- [ ] Set up automated database backups (see Volume Management)
- [ ] Configure backup encryption key (`BACKUP_CREDENTIALS_ENCRYPTION_KEY`)
- [ ] Set `COOKIE_SECURE=true` when behind HTTPS
- [ ] Configure OAuth providers if using SSO
- [ ] Set up monitoring and alerting
- [ ] Enable audit log retention (Admin → Security)
- [ ] Review and adjust rate limits (Admin → Security)
- [ ] Set `PASSKEY_RP_ID` to match your domain

---

## Useful Commands Reference

| Command | Description |
|---------|-------------|
| `docker compose up -d` | Start all services |
| `docker compose up -d --build` | Build and start |
| `docker compose logs -f` | Tail all logs |
| `docker compose logs -f backend` | Tail backend logs |
| `docker compose logs -f --tail=100 backend` | Last 100 lines of backend logs |
| `docker compose exec backend bun run db:seed` | Seed database with sample data |
| `docker compose exec backend bun run db:studio` | Open Prisma Studio |
| `docker compose exec backend sh` | Shell into backend container |
| `docker compose exec postgres psql -U catalyst -d catalyst_db` | PostgreSQL CLI |
| `docker compose down` | Stop services |
| `docker compose down -v` | Stop and delete volumes |
| `docker compose ps` | List service status |
| `docker compose pull` | Update images |
| `docker system prune -a` | Clean up unused images and volumes |
| `docker stats` | Live container resource usage |

---

## Image Building from Source

To build images locally instead of using pre-built ones:

### Backend Image

```dockerfile
# catalyst-backend/Dockerfile
FROM oven/bun:latest
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install
COPY . .
RUN bun run build
EXPOSE 3000 2022
CMD ["bun", "dist/index.js"]
```

```bash
cd catalyst-backend
docker build -t catalyst-backend:local .
# Update docker-compose.yml to use catalyst-backend:local
```

### Frontend Image

```dockerfile
# catalyst-frontend/Dockerfile
FROM oven/bun:latest AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install
COPY . .
RUN bun run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

---

*Last updated: 2026-05-11*
