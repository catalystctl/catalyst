# Catalyst

![Early Testing](https://img.shields.io/badge/status-early%20testing-orange) ![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue) ![React 18](https://img.shields.io/badge/React-18-cyan) ![Rust](https://img.shields.io/badge/Rust-1.70-orange) ![License](https://img.shields.io/badge/license-GPLv3-green)

**An experimental game server management platform in early testing.** Expect breaking changes and instability while core workflows are being validated.

---

## What is Catalyst?

Catalyst is a complete platform built for enterprise game server hosts, game communities, and billing panel integrations. Manage servers across multiple nodes with container isolation, live console access, automated backups, and fine-grained permissions.

🎯 **Perfect for:** Enterprise hosts, game communities, Minecraft/Rust/ARK/Hytale servers, billing panel automation

---

## Quick Start

### 📦 Prerequisites

- **Docker** with Compose support, **Podman** with Compose support, or **containerd** (with `nerdctl` or `ctr`)

That's it. Everything runs in containers — no Node.js, Bun, or Rust install needed on the host.

### 🚀 Deploy with Docker Compose

```bash
git clone https://github.com/catalystctl/catalyst.git
cd catalyst

# Create environment file
cp .env.example .env

# Edit .env — set at minimum:
#   BETTER_AUTH_SECRET  (generate: openssl rand -base64 32)
#   POSTGRES_PASSWORD

# Build and start everything
docker compose up -d --build
```

Or use the helper script:

```bash
./dev.sh
```

**That's it.** The panel is available at `http://localhost` (port 80 by default).

#### First-time setup

After the containers are running, seed the database with initial data:

```bash
docker compose exec backend bun run db:seed
```

#### Useful commands

| Command | Description |
|---|---|
| `docker compose up -d --build` | Build and start all services |
| `docker compose logs -f` | Tail logs from all services |
| `docker compose logs -f backend` | Tail backend logs only |
| `docker compose exec backend bun run db:seed` | Seed the database |
| `docker compose exec backend bun run db:studio` | Open Prisma Studio |
| `docker compose down` | Stop all services |
| `docker compose down -v` | Stop and delete all data volumes |

---

### 🟢 Deploy with Podman Compose

Podman Compose is a drop-in replacement — the workflow is identical:

```bash
git clone https://github.com/catalystctl/catalyst.git
cd catalyst

cp .env.example .env
# Edit .env (see Docker Compose section above)

podman compose up -d --build
```

All commands are the same, just replace `docker` with `podman`. The helper script
`./dev.sh` will auto-detect Podman if Docker is not installed.

---

### 🟦 Deploy with containerd

For environments using containerd directly (no Docker/Podman), Catalyst includes
helpers to run PostgreSQL and Redis under containerd. The backend and frontend
images can then be managed with `nerdctl` or `ctr`.

#### Using nerdctl (compose-like)

```bash
git clone https://github.com/catalystctl/catalyst.git
cd catalyst

cp .env.example .env
# Edit .env — set BETTER_AUTH_SECRET and POSTGRES_PASSWORD

# Start dependencies (PostgreSQL + Redis)
export POSTGRES_PASSWORD=<your-password>
./containerd/compose-to-nerdctl.sh

# Build and start backend + frontend
nerdctl compose -f docker-compose.yml up -d --build
```

#### Using ctr (no compose)

```bash
git clone https://github.com/catalystctl/catalyst.git
cd catalyst

cp .env.example .env
# Edit .env — set BETTER_AUTH_SECRET and POSTGRES_PASSWORD

# Start dependencies directly via containerd
./containerd/compose-to-containerd.sh

# Build and run backend/frontend containers manually with ctr
# (see containerd/compose-to-containerd.sh for image and runtime details)
```

For systemd integration and automatic restart on boot, see the service files in
`containerd/`.

👉 See [`containerd/`](containerd/) for the full helper scripts and configuration.

### 🔧 Configuration

All configuration lives in `.env` at the project root. See [`.env.example`](.env.example) for the full list.

Key variables:

| Variable | Required | Default | Description |
|---|---|---|---|
| `BETTER_AUTH_SECRET` | ✅ | — | Session encryption key (`openssl rand -base64 32`) |
| `POSTGRES_PASSWORD` | ✅ | — | PostgreSQL password |
| `CORS_ORIGIN` | | `http://localhost` | Allowed CORS origins |
| `BACKEND_EXTERNAL_ADDRESS` | | `http://localhost` | Public backend URL |
| `FRONTEND_PORT` | | `80` | Port to expose the panel on |
| `BACKEND_PORT` | | `127.0.0.1:3000` | Port to expose the API on (localhost only) |
| `SFTP_PORT` | | `127.0.0.1:2022` | Port for SFTP file access |

### 🌐 Exposing to the Internet

For production, put a reverse proxy (Caddy, Nginx, Cloudflare Tunnel) in front of port 80:

```bash
# Example: Caddy (automatic HTTPS)
caddy reverse-proxy --from panel.example.com --to localhost:80
```

Set `CORS_ORIGIN=https://panel.example.com` and `BACKEND_EXTERNAL_ADDRESS=https://panel.example.com` in `.env`.

### 🤖 Install Agent on Nodes

The agent runs on game server nodes (separate from the panel). See the [Admin Guide](docs/ADMIN_GUIDE.md) for node deployment.

### 🔌 Integrate via API

```bash
# Create API key in admin panel, then:
curl -H "x-api-key: YOUR_KEY" http://localhost:3000/api/servers
```

👉 [API integration guide](docs/automation-api-guide.md)

---

## Architecture

```
                     ┌─────────────────────┐
                     │   Docker Compose     │
                     │                      │
  :80 (panel)  ───► │  Nginx (Frontend)   │
                     │    │  /api  /ws      │
                     │    ▼                 │
                     │  Fastify (Backend)   │──► :3000 (API)
                     │    │                 │──► :2022 (SFTP)
                     │    ▼                 │
  :5432 (internal) ◄─│  PostgreSQL          │
  :6379 (internal) ◄─│  Redis               │
                     └─────────────────────┘

  Game Nodes (separate machines):
  ┌──────────────┐                    ┌──────────────┐
  │  Rust Agent  │◄── WebSocket ─────►│  Backend API │
  │  (containerd)│                    └──────────────┘
  └──────────────┘
       │
       ▼
  ┌──────────────┐
  │  Game        │
  │  Servers     │
  └──────────────┘
```

**Tech Stack:**

- **Backend:** TypeScript 5.9, Fastify, PostgreSQL, WebSocket Gateway
- **Frontend:** React 18, Vite, TanStack Query, Radix UI
- **Agent:** Rust 1.70, Tokio, containerd gRPC
- **Features:** RBAC, SFTP, Plugin System, Task Scheduling, Alerts

👉 [Full architecture details](docs/ARCHITECTURE.md)

---

## Key Features

### 🎮 Complete Server Lifecycle

Create, start, stop, restart, and transfer servers with automatic crash detection and recovery.

### 📊 Real-Time Monitoring

Live console streaming via WebSockets (<10ms latency), resource metrics, and customizable alerts.

### 🔐 Enterprise Security

RBAC with 20+ granular permissions, API key authentication with rate limiting, audit logging, TLS support.

### 🔌 Powerful Plugin System

Extend functionality with custom backend plugins, API routes, WebSocket handlers, and scheduled tasks.

### 📁 File Management

Web-based file editor, SFTP access, upload/download with path validation, and automated backup/restore.

### 🤖 API-First Design

60+ REST endpoints with billing panel integration examples (WHMCS, Python, Node.js).

---

## What Makes Catalyst Different?

- **containerd** for superior performance (not Docker)
- **WebSocket gateway** for real-time communication (<10ms latency)
- **Plugin system** for infinite extensibility
- **Rust agent** for memory safety and performance
- **Docker Compose** for one-command deployment

---

## Documentation

| Guide | For You If... | Description |
|-------|---------------|-------------|
| **[Getting Started](docs/GETTING_STARTED.md)** | New to Catalyst | Setup guide for Docker Compose and beyond |
| **[User Guide](docs/USER_GUIDE.md)** | Server Owner | Manage your servers, files, backups, console |
| **[Admin Guide](docs/ADMIN_GUIDE.md)** | System Operator | Deploy nodes, configure networking, monitor health |
| **[API Reference](docs/README.md)** | Developer | Complete REST API with integration examples |
| **[Plugin System](docs/PLUGIN_SYSTEM.md)** | Plugin Dev | Extend Catalyst with custom functionality |
| **[Features List](docs/FEATURES.md)** | All | Complete feature catalog and status |

---

## Project Status

| Category | Status |
|----------|--------|
| Core Features (Servers, Nodes, Backups, SFTP) | ✅ Stable |
| Security (RBAC, Audit, TLS, API Keys) | ✅ Stable |
| REST API | ✅ 60+ endpoints |
| Real-Time (WebSocket Console, Metrics) | ✅ Stable |
| Frontend UI | ✅ 25+ pages, full admin panel |
| Plugin System | ✅ Stable (2 bundled plugins) |
| Task Scheduling | ✅ Stable |
| Alerting | ✅ Stable |
| Agent (Rust, containerd) | ✅ Stable |
| Testing | ✅ 23 E2E test suites |
| Container Deployment | ✅ Docker Compose, Podman Compose, containerd |
| v2 (Scaling, CLI, Mobile) | 🔮 Planned |

---

## Contributing

We welcome contributions! Please see [AGENTS.md](AGENTS.md) for repository guidelines, code conventions, and commit standards.

---

## License

GPLv3 © 2025 Catalyst Contributors
