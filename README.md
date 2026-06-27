# Catalyst

![Early Testing](https://img.shields.io/badge/status-early%20testing-orange) ![TypeScript](https://img.shields.io/badge/TypeScript-6.0-blue) ![React](https://img.shields.io/badge/React-19-cyan) ![Rust](https://img.shields.io/badge/Rust-1.95-orange) ![License](https://img.shields.io/badge/license-GPLv3-green)

**An experimental game server management platform in early testing.** Expect breaking changes and instability while core workflows are being validated.

---

## What is Catalyst?

Catalyst is a complete platform built for enterprise game server hosts, game communities, and billing panel integrations. Manage servers across multiple nodes with container isolation, live console access, automated backups, and fine-grained permissions.

🎯 **Perfect for:** Enterprise hosts, game communities, Minecraft/Rust/ARK/Hytale servers, billing panel automation

---

## ⚡ 5-Minute Quick Start

> **Docker Compose** (Docker or Podman) is the **only supported deployment method**. Everything runs in containers — no Node.js, Bun, or Rust install needed on the host.

### 1. Download & configure

```bash
curl -fsSL https://raw.githubusercontent.com/catalystctl/catalyst/main/install.sh | bash
cd catalyst-docker
nano .env          # Set PUBLIC_URL at minimum
docker compose up -d
```

### 2. Access the panel

Open your `PUBLIC_URL` in a browser. The **first user to register becomes the administrator** automatically.

That's it. No build steps, no dependency installation, no manual secret generation (the install script does that for you).

👉 Want more detail? See the [Quick Start Guide](docs/QUICKSTART.md) for the full walkthrough with screenshots, or the [Detailed Installation Guide](docs/INSTALLATION_DETAILED.md) for every option, every edge case, and production hardening.

---

## Installation Options

Catalyst deploys in three ways. Pick the one that fits you:

| Method | Time | Best For |
|--------|------|----------|
| **[One-Line Install](docs/QUICKSTART.md)** | 5 minutes | First-time users, production |
| **[Docker/Podman Compose](docs/docker-setup.md)** | 10 minutes | Users who want full control over TLS, ports, volumes |
| **[Build from Source](docs/development.md)** | 30+ minutes | Developers contributing to Catalyst |

### 🐳 Docker & Podman

Both Docker Compose and Podman Compose are fully supported. The workflow is identical — just replace `docker` with `podman` in every command.

```bash
# Docker
docker compose up -d

# Podman (drop-in replacement)
podman compose up -d
```

### 🔧 Configuration

All configuration lives in `.env`. The install script generates it automatically, but you can edit it anytime:

| Variable | Required | Default | Description |
|---|---|---|---|
| `PUBLIC_URL` | ✅ | — | The URL users access the panel from |
| `POSTGRES_PASSWORD` | ✅ | auto-generated | PostgreSQL password |
| `BETTER_AUTH_SECRET` | ✅ | auto-generated | Session encryption key |
| `FRONTEND_PORT` | | `0.0.0.0:8080` | Panel port |
| `BACKEND_PORT` | | `127.0.0.1:3000` | API port (localhost-only by default) |
| `SFTP_PORT` | | `0.0.0.0:2022` | SFTP file access port |

For the complete variable reference, see [Environment Variables](docs/environment-variables.md).

### 🌐 Production & TLS

For production with automatic HTTPS:

```bash
# Caddy — automatic Let's Encrypt
docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d

# Or Traefik — Docker-native routing
docker compose -f docker-compose.yml -f docker-compose.traefik.yml up -d
```

See [Docker Setup](docs/docker-setup.md) for full TLS, reverse proxy, and hardening details.

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

- **Backend:** TypeScript 6.0, Fastify, PostgreSQL, WebSocket Gateway
- **Frontend:** React 19, Vite, TanStack Query, Radix UI
- **Agent:** Rust 1.95, Tokio, containerd gRPC
- **Features:** RBAC, SFTP, Plugin System, Task Scheduling, Alerts

👉 [Full architecture details](docs/architecture.md)

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

## Screenshots

All screenshots are captured automatically at 1080p via Playwright. [See how to regenerate them](catalyst-frontend/e2e/README.md).

### Authentication

| |
|---|
| ![Login](docs/screenshots/auth/login.png) |
| ![Register](docs/screenshots/auth/register.png) |
| ![Forgot Password](docs/screenshots/auth/forgot-password.png) |

### User Panel

| |
|---|
| ![Dashboard](docs/screenshots/user/dashboard.png) |
| ![Servers](docs/screenshots/user/servers.png) |
| ![Server Console](docs/screenshots/user/server-console.png) |
| ![Server Files](docs/screenshots/user/server-files.png) |
| ![Server Metrics](docs/screenshots/user/server-metrics.png) |
| ![Server Backups](docs/screenshots/user/server-backups.png) |
| ![Server Databases](docs/screenshots/user/server-databases.png) |
| ![Profile](docs/screenshots/user/profile.png) |

### Admin Panel

| |
|---|
| ![Admin Dashboard](docs/screenshots/admin/admin-dashboard.png) |
| ![Admin Users](docs/screenshots/admin/admin-users.png) |
| ![Admin Roles](docs/screenshots/admin/admin-roles.png) |
| ![Admin Nodes](docs/screenshots/admin/admin-nodes.png) |
| ![Admin Templates](docs/screenshots/admin/admin-templates.png) |
| ![Admin System](docs/screenshots/admin/admin-system.png) |
| ![Admin Security](docs/screenshots/admin/admin-security.png) |
| ![Admin Alerts](docs/screenshots/admin/admin-alerts.png) |
| ![Admin Audit Logs](docs/screenshots/admin/admin-audit-logs.png) |
| ![Admin API Keys](docs/screenshots/admin/admin-api-keys.png) |
| ![Admin Plugins](docs/screenshots/admin/admin-plugins.png) |

<details>
<summary>📁 View all screenshots (41 files)</summary>

#### Auth (3)
- [Login](docs/screenshots/auth/login.png) · [Register](docs/screenshots/auth/register.png) · [Forgot Password](docs/screenshots/auth/forgot-password.png)

#### User (18)
- [Dashboard](docs/screenshots/user/dashboard.png) · [Profile](docs/screenshots/user/profile.png) · [Servers](docs/screenshots/user/servers.png)
- [Server Console](docs/screenshots/user/server-console.png) · [Files](docs/screenshots/user/server-files.png) · [SFTP](docs/screenshots/user/server-sftp.png)
- [Backups](docs/screenshots/user/server-backups.png) · [Tasks](docs/screenshots/user/server-tasks.png) · [Databases](docs/screenshots/user/server-databases.png)
- [Metrics](docs/screenshots/user/server-metrics.png) · [Alerts](docs/screenshots/user/server-alerts.png) · [Mod Manager](docs/screenshots/user/server-modmanager.png)
- [Plugin Manager](docs/screenshots/user/server-pluginmanager.png) · [Configuration](docs/screenshots/user/server-configuration.png) · [Users](docs/screenshots/user/server-users.png)
- [Settings](docs/screenshots/user/server-settings.png) · [Admin Tab](docs/screenshots/user/server-admin.png)

#### Admin (20)
- [Dashboard](docs/screenshots/admin/admin-dashboard.png) · [Users](docs/screenshots/admin/admin-users.png) · [Roles](docs/screenshots/admin/admin-roles.png)
- [Servers](docs/screenshots/admin/admin-servers.png) · [Nodes](docs/screenshots/admin/admin-nodes.png) · [Templates](docs/screenshots/admin/admin-templates.png)
- [Database](docs/screenshots/admin/admin-database.png) · [Network](docs/screenshots/admin/admin-network.png) · [System](docs/screenshots/admin/admin-system.png)
- [Security](docs/screenshots/admin/admin-security.png) · [Theme Settings](docs/screenshots/admin/admin-theme-settings.png) · [Alerts](docs/screenshots/admin/admin-alerts.png)
- [Audit Logs](docs/screenshots/admin/admin-audit-logs.png) · [API Keys](docs/screenshots/admin/admin-api-keys.png) · [Plugins](docs/screenshots/admin/admin-plugins.png)
- [Node Details](docs/screenshots/admin/node-details.png) · [Node Allocations](docs/screenshots/admin/node-allocations.png)
- [Template 1](docs/screenshots/admin/template-1-details.png) · [Template 2](docs/screenshots/admin/template-2-details.png) · [Template 3](docs/screenshots/admin/template-3-details.png) · [Template 4](docs/screenshots/admin/template-4-details.png)

</details>

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
| **[⚡ Quick Start](docs/QUICKSTART.md)** | New to Catalyst | 5-minute setup with Docker Compose |
| **[📖 Detailed Installation](docs/INSTALLATION_DETAILED.md)** | Devs & ops | Full install: every option, every edge case |
| **[Getting Started](docs/getting-started.md)** | First-time admin | Walkthrough: nodes, templates, first server |
| **[Docker Setup](docs/docker-setup.md)** | System operator | TLS, volumes, networking, production hardening |
| **[User Guide](docs/user-guide.md)** | Server owner | Manage your servers, files, backups, console |
| **[Admin Guide](docs/admin-guide.md)** | System operator | Deploy nodes, configure networking, monitor health |
| **[Agent Guide](docs/agent.md)** | Node operator | Deploy the Rust agent on game server nodes |
| **[API Reference](docs/api-reference.md)** | Developer | Complete REST API with integration examples |
| **[Automation & Plugins](docs/automation.md)** | Power user | Scheduled tasks, webhooks, API automation, plugins |
| **[Development Guide](docs/development.md)** | Contributor | Dev environment, testing, code style, PR process |
| **[Plugin System](docs/plugins.md)** | Plugin dev | Extend Catalyst with custom functionality |
| **[Environment Variables](docs/environment-variables.md)** | All | Complete reference of all 60+ config variables |
| **[Troubleshooting](docs/troubleshooting.md)** | All | Common errors, solutions, debugging workflows |
| **[Architecture](docs/architecture.md)** | Technical | System design, data flow, security model |

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
| Container Deployment | ✅ Docker Compose, Podman Compose |
| v2 (Scaling, CLI, Mobile) | 🔮 Planned |

---

## 📚 Quick Documentation Links

New here? Pick your path:

- 🚀 **[Quick Start](docs/QUICKSTART.md)** — Running in 5 minutes with Docker
- 📖 **[Detailed Installation](docs/INSTALLATION_DETAILED.md)** — Every option, every edge case, production hardening
- 🐳 **[Docker Reference](docs/docker-setup.md)** — Complete Docker/Podman guide: TLS, volumes, networking

The full documentation catalog is in the table above.

---

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for repository guidelines, code conventions, and commit standards.

---

## License

GPLv3 © 2026 Catalyst Contributors
