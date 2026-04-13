# Getting Started with Catalyst

Complete guide to setting up Catalyst for different use cases.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Deploy with Docker Compose](#deploy-with-docker-compose)
- [Configuration](#configuration)
- [First-Time Setup](#first-time-setup)
- [Exposing to the Internet](#exposing-to-the-internet)
- [Deploying Node Agents](#deploying-node-agents)
- [API Integration](#api-integration)
- [Local Development (Contributors)](#local-development-contributors)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

- **Docker** (or **Podman**) with Compose support
- **Git**

That's it. The panel, backend, PostgreSQL, and Redis all run in containers.

> **Podman users:** replace every `docker compose` command with `podman compose`.

---

## Deploy with Docker Compose

### Step 1: Clone

```bash
git clone https://github.com/catalystctl/catalyst.git
cd catalyst
```

### Step 2: Configure

```bash
cp .env.example .env
```

Edit `.env` and set at minimum:

```env
# Generate with: openssl rand -base64 32
BETTER_AUTH_SECRET=<generated-secret>

# Any strong password for PostgreSQL
POSTGRES_PASSWORD=<strong-password>
```

### Step 3: Start

```bash
docker compose up -d --build
```

Or use the helper script:

```bash
./dev.sh
```

### Step 4: Access

- **Panel:** http://localhost (port 80 by default)
- **API:** http://localhost:3000/api
- **Swagger Docs:** http://localhost:3000/docs
- **SFTP:** localhost:2022

---

## Configuration

All configuration is in the root `.env` file. See [`.env.example`](../.env.example) for the complete list.

### Key Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `BETTER_AUTH_SECRET` | ✅ | — | Session encryption key |
| `POSTGRES_PASSWORD` | ✅ | — | PostgreSQL password |
| `CORS_ORIGIN` | | `http://localhost` | Allowed CORS origins (comma-separated) |
| `BACKEND_EXTERNAL_ADDRESS` | | `http://localhost` | Public backend URL |
| `FRONTEND_PORT` | | `80` | Port for the panel |
| `BACKEND_PORT` | | `127.0.0.1:3000` | Port for the API (localhost only) |
| `SFTP_PORT` | | `127.0.0.1:2022` | Port for SFTP file access |
| `REDIS_URL` | | `redis://redis:6379` | Redis connection URL |
| `SFTP_ENABLED` | | `true` | Enable/disable SFTP |
| `BACKUP_STORAGE_MODE` | | `local` | `local`, `s3`, or `sftp` |

### Port Mapping

| Service | Container Port | Default Host Binding | Description |
|---|---|---|---|
| Frontend (Nginx) | 80 | `0.0.0.0:80` | Panel UI |
| Backend API | 3000 | `127.0.0.1:3000` | REST API + WebSocket |
| SFTP | 2022 | `127.0.0.1:2022` | File access |
| PostgreSQL | 5432 | `127.0.0.1:5432` | Database (internal) |
| Redis | 6379 | `127.0.0.1:6379` | Cache (internal) |

> PostgreSQL and Redis are bound to localhost only for security. Only expose them externally if you know what you're doing.

---

## First-Time Setup

After containers are running, seed the database with initial data:

```bash
docker compose exec backend bun run db:seed
```

### Useful Commands

```bash
# View logs
docker compose logs -f
docker compose logs -f backend

# Open Prisma Studio (database GUI)
docker compose exec backend bun run db:studio

# Reset everything (deletes all data)
docker compose down -v
docker compose up -d --build
docker compose exec backend bun run db:seed

# Rebuild after code changes
docker compose up -d --build

# Run a one-off command in the backend
docker compose exec backend bun run db:push
```

---

## Exposing to the Internet

For production, place a reverse proxy in front of the frontend container:

### Caddy (automatic HTTPS)

```bash
caddy reverse-proxy --from panel.example.com --to localhost:80
```

### Nginx

```nginx
server {
    listen 80;
    server_name panel.example.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name panel.example.com;

    ssl_certificate /etc/letsencrypt/live/panel.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/panel.example.com/privkey.pem;

    client_max_body_size 100m;

    location / {
        proxy_pass http://127.0.0.1:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Cloudflare Tunnel (no open ports)

```bash
cloudflared tunnel --hostname panel.example.com --url http://localhost:80
```

### Update `.env` for your domain

```env
CORS_ORIGIN=https://panel.example.com
BACKEND_EXTERNAL_ADDRESS=https://panel.example.com
FRONTEND_URL=https://panel.example.com
BETTER_AUTH_URL=https://panel.example.com
PASSKEY_RP_ID=panel.example.com
```

Then restart: `docker compose up -d`

---

## Deploying Node Agents

The agent runs on game server nodes (separate machines from the panel). See the [Admin Guide](ADMIN_GUIDE.md) for full node deployment instructions.

Quick overview:

```bash
# Copy agent binary to node
scp catalyst-agent user@node:/usr/local/bin/

# Run agent (auto-configures containerd, CNI on first run)
sudo /usr/local/bin/catalyst-agent /opt/catalyst-agent/config.toml
```

---

## API Integration

### Step 1: Create API Key

Login to Catalyst → **Admin → API Keys → Create**

### Step 2: Use the API

```bash
export API_KEY="catalyst_xxx_yyy_zzz"

# List servers
curl -H "x-api-key: $API_KEY" http://localhost:3000/api/servers

# Create a server
curl -X POST http://localhost:3000/api/servers \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{
    "name": "My Server",
    "templateId": "template-id",
    "nodeId": "node-id",
    "ownerId": "user-id",
    "allocatedMemoryMb": 4096
  }'
```

👉 [Complete API guide](README.md)
👉 [Billing integration examples](automation-api-guide.md)

---

## Local Development (Contributors)

For contributing to Catalyst source code, you can run backend and frontend outside Docker:

```bash
# Start only the databases
docker compose up -d postgres redis

# Install workspace dependencies
bun install

# Backend (port 3000)
cd catalyst-backend
cp .env.example .env   # edit DATABASE_URL to use localhost:5432
bun run db:generate
bun run db:push
bun run dev

# Frontend (port 5173)
cd catalyst-frontend
bun run dev
```

---

## Troubleshooting

### Containers won't start

```bash
# Check logs
docker compose logs

# Check if ports are already in use
sudo lsof -i :80
sudo lsof -i :3000
```

### Database connection errors

```bash
# Verify PostgreSQL is healthy
docker compose ps
docker compose logs postgres

# Reset database
docker compose down -v
docker compose up -d
docker compose exec backend bun run db:push
docker compose exec backend bun run db:seed
```

### Frontend can't reach backend (CORS errors)

- Check `CORS_ORIGIN` in `.env` matches the URL you're accessing the panel from
- If accessing via IP, add `http://<your-ip>` to `CORS_ORIGIN`

### Agent can't connect to backend

```bash
# Test WebSocket from the node
curl -I http://your-backend:3000/ws

# Check firewall allows outbound to backend port
```

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `POSTGRES_PASSWORD is required` | Missing `.env` variable | Set in `.env` |
| `BETTER_AUTH_SECRET is required` | Missing `.env` variable | Set in `.env` |
| CORS errors | Mismatched origin | Update `CORS_ORIGIN` in `.env` |
| 502 from Nginx | Backend not ready | Wait for healthcheck, check `docker compose logs backend` |
| `ECONNREFUSED` | Service down | `docker compose restart <service>` |

---

## Next Steps

- **[Admin Guide](ADMIN_GUIDE.md)** — Deploy nodes, configure networking, backups
- **[User Guide](USER_GUIDE.md)** — Manage servers, files, console
- **[API Reference](README.md)** — Full REST API docs
- **[Plugin System](PLUGIN_SYSTEM.md)** — Extend Catalyst
- **[Architecture](ARCHITECTURE.md)** — System design deep dive
