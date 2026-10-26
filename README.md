# Catalyst

![TypeScript](https://img.shields.io/badge/TypeScript-6.0-blue) ![React](https://img.shields.io/badge/React-19-cyan) ![Rust](https://img.shields.io/badge/Rust-1.95-orange) ![License](https://img.shields.io/badge/license-GPLv3-green)

**A game server control panel.** Create servers, manage files, backups, and
console output, and automate everything through the API. Per-subsystem status is
in [Project Status](#project-status).

> **Official support channels:** [GitHub Issues](https://github.com/catalystctl/catalyst/issues) and [Discord](https://discord.gg/mybxhmru3y). These are the only official lines of communication for support, bug reports, and project discussion.

---

## What is Catalyst?

Catalyst is a complete platform built for enterprise game server hosts, game communities, and billing panel integrations. Manage servers across multiple nodes with container isolation, live console access, automated backups, and fine-grained permissions.

🎯 **Perfect for:** Enterprise hosts, game communities, Minecraft/Rust/ARK/Hytale servers, billing panel automation

---

## ⚡ 5-Minute Quick Start

> **Docker Compose** (Docker or Podman) is the **only supported deployment method**. Everything runs in containers — no Node.js, Bun, or Rust install needed on the host.

### 1. Download & configure

```bash
VERSION=v1.85.0  # replace with the release you want
curl -fsSL -o install.sh "https://github.com/catalystctl/catalyst/releases/download/${VERSION}/install.sh"
curl -fsSL -o install.sh.sha256 "https://github.com/catalystctl/catalyst/releases/download/${VERSION}/install.sh.sha256"
sha256sum -c install.sh.sha256 && bash install.sh
cd catalyst-docker
nano .env          # Set PUBLIC_URL at minimum
docker compose up -d
```

### 2. Access the panel

Open your `PUBLIC_URL` in a browser. Complete the **Setup** wizard (admin account + appearance). That first setup user becomes the administrator and open registration is disabled afterward.

That's it. No build steps, no dependency installation, no manual secret generation (the install script does that for you).

👉 Want more detail? See the [Administrator Guide](https://docs.catalystctl.com/admin/overview/) for the full walkthrough, or [Installation](https://docs.catalystctl.com/admin/installation/) for every option and production hardening.

Stuck or have questions? Join the community on [Discord](https://discord.gg/mybxhmru3y) or open a [GitHub Issue](https://github.com/catalystctl/catalyst/issues).

---

## Installation Options

Catalyst deploys in three ways. Pick the one that fits you:

| Method | Time | Best For |
|--------|------|----------|
| **[One-Line Install](https://docs.catalystctl.com/admin/installation/)** | 5 minutes | First-time users, production |
| **[Docker/Podman Compose](https://docs.catalystctl.com/admin/installation/)** | 10 minutes | Users who want full control over TLS, ports, volumes |
| **[Build from Source](CONTRIBUTING.md)** | 30+ minutes | Developers contributing to Catalyst |

### 🐳 Docker & Podman

Both Docker Compose and Podman Compose are fully supported. The workflow is identical — just replace `docker` with `podman` in every command.

```bash
# Docker
docker compose up -d

# Podman (drop-in replacement)
podman compose up -d
```

### 🔧 Configuration

`install.sh` writes `.env` for you (secrets included); you can edit it anytime.
Every variable, its default and what it changes:
[`catalyst-docker/.env.example`](catalyst-docker/.env.example),
[catalyst-docker/README.md](catalyst-docker/README.md#configuration-reference) and
the [Configuration](https://docs.catalystctl.com/admin/configuration/) page.

### 🌐 Production & TLS

For production with automatic HTTPS:

```bash
# Caddy — automatic Let's Encrypt
docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d

# Or Traefik — Docker-native routing
docker compose -f docker-compose.yml -f docker-compose.traefik.yml up -d
```

See the [Administrator Guide](https://docs.catalystctl.com/admin/networking/) for full TLS, reverse proxy, and hardening details.

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
                     │    ▼                 │
  :5432 (internal) ◄─│  PostgreSQL          │
  :6379 (internal) ◄─│  Redis               │
                     └─────────────────────┘

  Game Nodes (separate machines):
  ┌──────────────┐                    ┌──────────────┐
  │  Rust Agent  │◄── WebSocket ─────►│  Backend API │
  │  (containerd)│                    └──────────────┘
  └──────┬───────┘
         │ :2022 (SFTP)
         ▼
  ┌──────────────┐
  │  Game        │
  │  Servers     │
  └──────────────┘
```

**Tech Stack:**

- **Backend:** TypeScript 6.0, Fastify, PostgreSQL, WebSocket Gateway
- **Frontend:** React 19, Vite, Catalyst Sync (csync), Radix UI
- **Agent:** Rust 1.95, Tokio, containerd gRPC
- **Features:** RBAC, SFTP, Plugin System, Task Scheduling, Alerts

### Agent performance and node tuning

The agent's control plane shares host CPU, memory and storage with game
containers. Defaults keep that overhead low: resource reports every five
seconds, bounded transfer queues, and installer logs read as appended bytes
rather than re-read whole. Backups do not force source-file fsyncs — tar reads
the page cache — so quiesce or stop the game for a consistent backup.

For dense nodes, set `[agent].stats_interval_secs = 10` or `30` in the agent
configuration when slower graphs are acceptable; `STATS_INTERVAL_SECS` overrides
the file setting (minimum: one second). Leave `[logging].level = "info"` in
normal operation — SSH/SFTP debug logging follows it rather than being forced
on. See [the configuration example](catalyst-agent/config.toml.example).

[The node tuning script](scripts/node-tuning.sh) configures host limits and
absolute dirty-page thresholds (256 MiB background, 1 GiB maximum). **It changes
global kernel settings and restarts the agent; review it before running on a live
node.** Generated systemd units use neutral CPU/IO weights of 100, which are
hierarchical rather than cross-hierarchy game reservations or disk bandwidth
caps.

Validate tuning under representative player load: compare game tick/frame
latency, cgroup `cpu.stat` throttling deltas, `memory.events`, and
`/proc/pressure/{cpu,memory,io}` while exercising saves, backups and transfers.
Do not read reclaimable file cache in `memory.current` as agent heap/RSS.
Remaining limits: live backups, copies and installs can still contend with game
I/O, and mount-restricted environments can fall back to plain directories
without enforcing the requested disk quota.


---

## Key Features

### 🎮 Complete Server Lifecycle

Create, start, stop, restart, and transfer servers with automatic crash detection and recovery.

### 📊 Real-Time Monitoring

Live console streaming over WebSockets, resource metrics, and customizable alerts.

### 🔐 Enterprise Security

RBAC with 74 granular permissions, API key authentication with rate limiting, audit logging, TLS support.

### 🔌 Powerful Plugin System

Extend functionality with custom backend plugins, API routes, WebSocket handlers, and scheduled tasks.

### 📁 File Management

Web-based file editor, SFTP access, upload/download with path validation, and automated backup/restore.

### 🤖 API-First Design

334 REST operations with billing-panel integrations (WHMCS, Paymenter) and an OpenAPI reference.

---

## What Makes Catalyst Different?

- **containerd** for superior performance (not Docker)
- **WebSocket gateway** for real-time console, metrics and agent traffic
- **Plugin system** for infinite extensibility
- **Rust agent** for memory safety and performance
- **Docker Compose** for one-command deployment

---

## Documentation

Full product documentation lives at **[docs.catalystctl.com](https://docs.catalystctl.com)**
([source](https://github.com/catalystctl/catalyst-doc)):

| Guide | For You If... | Start here |
|-------|---------------|------------|
| **[Getting Started](https://docs.catalystctl.com/getting-started/first-server/)** | New to Catalyst | First server in minutes |
| **[Game Server Guide](https://docs.catalystctl.com/users/overview/)** | Server owner | Console, files, backups, databases, tasks |
| **[Administrator Guide](https://docs.catalystctl.com/admin/overview/)** | System operator | Install, nodes, networking, updates |
| **[API & Developers](https://docs.catalystctl.com/api/overview/)** | Developer | Auth, WebSockets, generated API reference |
| **[Troubleshooting](https://docs.catalystctl.com/troubleshooting/overview/)** | All | Errors, fixes, debugging workflows |

Contributor and operator references stay in this repo:

- [CONTRIBUTING.md](CONTRIBUTING.md) — local setup, code style, tests, commit rules
- [AGENTS.md](AGENTS.md) — the contributor/agent contract: verification gates, i18n and migration rules
- [DESIGN.md](DESIGN.md) — design tokens and the panel's visual contract
- [catalyst-docker/README.md](catalyst-docker/README.md) — deployment, TLS, troubleshooting
- [tests/README.md](tests/README.md) — the bash E2E suites

---

## Project Status

| Category | Status |
|----------|--------|
| Core Features (Servers, Nodes, Backups, SFTP) | ✅ Stable |
| Security (RBAC, Audit, TLS, API Keys) | ✅ Stable |
| REST API | ✅ 334 operations across 42 route files |
| Real-Time (WebSocket Console, Metrics) | ✅ Stable |
| Frontend UI | ✅ 41 page components, full admin panel |
| Plugin System | ✅ Stable (10 official plugins in the marketplace) |
| Task Scheduling | ✅ Stable |
| Alerting | ✅ Stable |
| Agent (Rust, containerd) | ✅ Stable |
| Testing | ✅ 144 backend and 78 frontend Vitest files, 2 Playwright E2E specs, 24 bash E2E suites |
| Container Deployment | ✅ Docker Compose, Podman Compose |
| v2 (Scaling, CLI, Mobile) | 🔮 Planned |

---

## 📚 Quick Documentation Links

New here? Pick your path in the [documentation](https://docs.catalystctl.com):

- 🚀 **[First server](https://docs.catalystctl.com/getting-started/first-server/)** — Running in minutes
- 📖 **[Installation](https://docs.catalystctl.com/admin/installation/)** — Every option, every edge case, production hardening
- 🐳 **[Networking & TLS](https://docs.catalystctl.com/admin/networking/)** — Reverse proxy, TLS, ports

The full documentation catalog is in the table above.

---

## Support & Community

**Official support channels are GitHub Issues and Discord only.** Please use these for bug reports, feature requests, installation help, and project discussion — they are our official lines of communication.

| Channel | Use for |
|---------|---------|
| **[GitHub Issues](https://github.com/catalystctl/catalyst/issues)** | Bug reports, feature requests, tracked work |
| **[Discord](https://discord.gg/mybxhmru3y)** | Real-time help, community discussion, announcements |

Invite link: [https://discord.gg/mybxhmru3y](https://discord.gg/mybxhmru3y)

---

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for repository guidelines, code conventions, and commit standards.

Questions about contributing? Hop into [Discord](https://discord.gg/mybxhmru3y) or open a [GitHub Issue](https://github.com/catalystctl/catalyst/issues).

---

## License

GPLv3 © 2026 Catalyst Contributors
