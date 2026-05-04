# Docker Setup Guide

Complete reference for deploying Catalyst with Docker Compose, including TLS overlays, volume management, and production hardening.

---

## Prerequisites

- **Docker** with Compose support **or** **Podman** with Compose support
- At least **2GB RAM** and **20GB disk** available
- Ports **80**, **3000**, **2022** available (or custom ports via `.env`)

::: tip One-Line Install
The fastest way to deploy is the [one-line install](../README.md#-one-line-install-recommended) which downloads only the `catalyst-docker/` folder with pre-built images.
:::

---

## Services Overview

The Docker Compose stack (`catalyst-docker/docker-compose.yml`) defines four services:

| Service | Image | Purpose | Exposed Port |
|---------|-------|---------|-------------|
| `postgres` | `postgres:16-alpine` | Primary database | `127.0.0.1:5432` |
| `redis` | `redis:7-alpine` | Cache / session store | `127.0.0.1:6379` |
| `backend` | `ghcr.io/catalystctl/catalyst-backend:latest` | Fastify API + SFTP | `127.0.0.1:3000`, `0.0.0.0:2022` |
| `frontend` | `ghcr.io/catalystctl/catalyst-frontend:latest` | Nginx static SPA | `0.0.0.0:80` |

### Service Dependencies

```text
frontend → backend → postgres
                ↘ redis
```text

The frontend waits for the backend health check to pass before starting. The backend waits for both PostgreSQL and Redis health checks.

---

## Quick Start

### 1. Configure Environment

```bash
cd catalyst-docker
cp .env.example .env
nano .env
```

**Minimum required variables:**

```env
PUBLIC_URL=http://localhost:8080
POSTGRES_PASSWORD=CHANGE_ME_GENERATE_A_STRONG_PASSWORD
BETTER_AUTH_SECRET=$(openssl rand -base64 32)
```text

### 2. Start the Stack

```bash
docker compose up -d
```

### 3. Verify Health

```bash
# All services should show "healthy"
docker compose ps

# Backend health check
curl http://localhost:3000/health

# View logs
docker compose logs -f
```text

### 4. First-Time Setup

Visit `http://localhost` and register the first user — they automatically become the administrator.

Alternatively, seed the database:

```bash
docker compose exec backend bun run db:seed
```

---

## Volume Management

Four named volumes are created automatically:

| Volume | Mount Point | Purpose |
|--------|-------------|---------|
| `catalyst-postgres-data` | `/var/lib/postgresql/data` | Database files |
| `catalyst-server-data` | `/var/lib/catalyst/servers` | Game server files |
| `catalyst-backup-data` | `/var/lib/catalyst/backups` | Backup files |
| `catalyst-plugin-data` | `/var/lib/catalyst/plugins` | Plugin files |

### Backup Volumes

```bash
# Backup all volumes
docker run --rm -v catalyst-postgres-data:/source -v $(pwd)/backup:/backup alpine tar czf /backup/postgres.tar.gz -C /source .
docker run --rm -v catalyst-server-data:/source -v $(pwd)/backup:/backup alpine tar czf /backup/servers.tar.gz -C /source .
```text

### Reset Everything

::: danger Destructive
This deletes all data including servers, users, and backups.
:::

```bash
docker compose down -v
```

---

## Networking

### Default Network

All services communicate on an internal Docker bridge network. No external access is required for `postgres` and `redis`.

### Custom Networks

To isolate Catalyst from other containers:

```yaml
# docker-compose.yml override
networks:
  catalyst:
    driver: bridge
    ipam:
      config:
        - subnet: 172.28.0.0/16
```text

### Port Binding

| Variable | Default | Description |
|------|---------|-------------|
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

### Option A: Caddy (Automatic HTTPS)

```bash
# Set your domain in .env
DOMAIN=panel.example.com
ACME_EMAIL=admin@example.com

# Use the Caddy overlay
docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d
```

Caddy automatically obtains and renews Let's Encrypt certificates.

### Option B: Traefik (Reverse Proxy)

```bash
# Set your domain in .env
DOMAIN=panel.example.com
ACME_EMAIL=admin@example.com

# Use the Traefik overlay
docker compose -f docker-compose.yml -f docker-compose.traefik.yml up -d
```text

Traefik dashboard is available at `127.0.0.1:8080` by default.

### Option C: Existing Reverse Proxy

If you already run Nginx, Caddy, or another proxy:

1. Set `FRONTEND_PORT=127.0.0.1:8080` to bind Catalyst to localhost only
2. Proxy traffic from your reverse proxy to `http://localhost:8080`
3. Set `PUBLIC_URL=https://panel.example.com` in `.env`

Example Nginx upstream:

```nginx
server {
    listen 443 ssl http2;
    server_name panel.example.com;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

::: warning CORS and Cookies
When using a reverse proxy, ensure `PUBLIC_URL` matches the URL users access. Mismatches cause CORS errors and cookie rejection.
:::

---

## Environment Injection

The `docker-compose.yml` passes environment variables directly to containers. Key injection patterns:

### `PUBLIC_URL` Drives Everything

Setting `PUBLIC_URL` automatically configures:
- `BETTER_AUTH_URL`
- `CORS_ORIGIN`
- `FRONTEND_URL`
- `BACKEND_EXTERNAL_ADDRESS`
- `BACKEND_URL`

You only need to override these individually for split internal/external setups.

### Sensitive Variables

| Variable | How to Set | Notes |
|----------|-----------|-------|
| `POSTGRES_PASSWORD` | `.env` file | Required. No default. |
| `BETTER_AUTH_SECRET` | `.env` file | Required. Generate with `openssl rand -base64 32`. |
| `BACKUP_CREDENTIALS_ENCRYPTION_KEY` | `.env` file | Required for backup encryption. Generate with `openssl rand -hex 32`. |
| `SFTP_HOST_KEY` | `.env` file or auto-generated | Path to SSH host key. Leave empty to auto-generate. |

---

## Health Checks

Each service includes a health check:

| Service | Check | Interval |
|---------|-------|----------|
| `postgres` | `pg_isready -U catalyst` | 10s |
| `redis` | `redis-cli ping` | 10s |
| `backend` | `curl -sf http://localhost:3000/health` | 15s |

The backend health check also verifies database connectivity. If PostgreSQL is unreachable, the backend returns HTTP 503.

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
```text

Build and use:

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
```text

---

## Podman Compose

Podman Compose is a drop-in replacement. The only differences:

1. **Port binding**: Use ports above 1024 for rootless mode:
   ```env
   FRONTEND_PORT=0.0.0.0:8080
   ```

2. **Socket path**: If using the agent on the same host, adjust Docker socket path in `docker-compose.yml`:
   ```yaml
   volumes:
     - /run/user/1000/podman/podman.sock:/var/run/docker.sock
   ```text

3. **SFTP host key**: Explicitly set `SFTP_HOST_KEY=` (empty) in `.env` due to Podman variable interpolation quirks.

All other commands are identical — just replace `docker` with `podman`.

---

## Updating

### Automatic Updates

Enable in `.env`:

```env
AUTO_UPDATE_ENABLED=true
AUTO_UPDATE_INTERVAL_MS=3600000
AUTO_UPDATE_AUTO_TRIGGER=false
```

The backend checks for new releases and can notify or auto-trigger updates (if `AUTO_UPDATE_AUTO_TRIGGER=true`).

### Manual Update

```bash
cd catalyst-docker
docker compose pull
docker compose up -d
```text

### Database Migrations

After updating, run migrations:

```bash
docker compose exec backend bun run db:migrate
```

---

## Production Hardening Checklist

- [ ] Set `NODE_ENV=production` in `.env`
- [ ] Change all default passwords and generate strong secrets
- [ ] Use TLS (Caddy, Traefik, or external reverse proxy)
- [ ] Restrict `BACKEND_PORT` and `POSTGRES_PORT` to `127.0.0.1`
- [ ] Disable external Redis access (comment out `REDIS_PORT`)
- [ ] Set up automated database backups
- [ ] Configure backup encryption key
- [ ] Review and adjust rate limits
- [ ] Enable audit log retention
- [ ] Set `COOKIE_SECURE=true` when behind HTTPS
- [ ] Configure OAuth providers if using SSO
- [ ] Set up monitoring and alerting

---

## Useful Commands Reference

| Command | Description |
|---------|-------------|
| `docker compose up -d` | Start all services |
| `docker compose up -d --build` | Build and start |
| `docker compose logs -f` | Tail all logs |
| `docker compose logs -f backend` | Tail backend logs |
| `docker compose exec backend bun run db:seed` | Seed database |
| `docker compose exec backend bun run db:studio` | Open Prisma Studio |
| `docker compose exec backend sh` | Shell into backend container |
| `docker compose down` | Stop services |
| `docker compose down -v` | Stop and delete volumes |
| `docker compose ps` | List service status |
| `docker compose pull` | Update images |
