# Catalyst

![Production Ready](https://img.shields.io/badge/status-production%20ready-brightgreen) ![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue) ![React 18](https://img.shields.io/badge/React-18-cyan) ![Rust](https://img.shields.io/badge/Rust-1.70-orange) ![License](https://img.shields.io/badge/license-MIT-green)

**The modern, production-grade game server management platform.** Deploy and manage 1000s of game servers with real-time control, enterprise security, and seamless automation.

---

## What is Catalyst?

Catalyst is a complete platform built for enterprise game server hosts, game communities, and billing panel integrations. Manage servers across multiple nodes with container isolation, live console access, automated backups, and fine-grained permissions.

🎯 **Perfect for:** Enterprise hosts, game communities, Minecraft/Rust/ARK/Hytale servers, billing panel automation

---

## Quick Start

### 🚀 Try It Locally (Development)

```bash
# Start database services
docker-compose up -d

# Backend (port 3000)
cd catalyst-backend && npm install && npm run db:push && npm run dev

# Frontend (port 5173)
cd catalyst-frontend && npm install && npm run dev
```

👉 [Full local setup guide](docs/GETTING_STARTED.md)

### 🌐 Deploy to Production

1. Deploy backend with PostgreSQL
2. Install agent on nodes (auto-configures containerd/CNI)
3. Create node in admin panel with deployment token
4. Start managing servers!

👉 [Production deployment guide](docs/ADMIN_GUIDE.md)

### 🔌 Integrate via API

```bash
# Create API key in admin panel, then:
curl -H "x-api-key: YOUR_KEY" http://localhost:3000/api/servers
```

👉 [API integration guide](docs/automation-api-guide.md)

---

## Key Features

### 🎮 Complete Server Lifecycle

Create, start, stop, restart, and transfer servers with automatic crash detection and recovery. State machine ensures safe transitions.

### 📊 Real-Time Monitoring

Live console streaming via WebSockets (<10ms latency), resource metrics (CPU/RAM/disk), and customizable alerts with threshold monitoring.

### 🔐 Enterprise Security

RBAC with 20+ granular permissions, API key authentication with rate limiting, audit logging, TLS support, and encrypted backups.

### 🔌 Powerful Plugin System

Extend functionality with custom backend plugins, API routes, WebSocket handlers, and scheduled tasks. Hot-reload enabled.

### 📁 File Management

Web-based file editor, SFTP access (port 2022), upload/download with path validation, and automated backup/restore.

### 🤖 API-First Design

60+ REST endpoints with billing panel integration examples (WHMCS, Python, Node.js) for complete automation.

---

## Architecture

```
┌──────────────┐     WebSocket      ┌──────────────┐
│   React 18   │◄──────────────────►│  Fastify     │
│  Frontend    │                    │  Backend     │
│  (Vite)      │                    │  (TypeScript)│
└──────────────┘                    └──────────────┘
                                           │
                          REST/WebSocket   │
                                           ▼
┌──────────────┐                    ┌──────────────┐
│   Rust 1.70  │◄──────────────────►│  PostgreSQL  │
│   Agent      │                    │  Database    │
│  (Tokio)     │                    │              │
└──────────────┘                    └──────────────┘
       │
       │ containerd/nerdctl
       ▼
┌──────────────┐
│   Game       │
│  Servers     │
└──────────────┘
```

**Tech Stack:**

- **Backend:** TypeScript 5.9, Fastify, PostgreSQL, WebSocket Gateway
- **Frontend:** React 18, Vite, TanStack Query, Radix UI
- **Agent:** Rust 1.70, Tokio, containerd/nerdctl
- **Features:** RBAC, SFTP, Plugin System, Task Scheduling, Alerts

👉 [Full architecture details](docs/ARCHITECTURE.md)

---

## What Makes Catalyst Different?

### 🎯 Production-Ready from Day One

- Tested with 100+ servers per node
- 60+ API endpoints, comprehensive E2E testing
- Enterprise security built-in (RBAC, audit logs, TLS)

### 🔧 Modern Architecture

- **containerd** for superior performance (not Docker)
- **WebSocket gateway** for real-time communication (<10ms latency)
- **Plugin system** for infinite extensibility
- **Rust agent** for memory safety and performance

### 🤝 Developer-Friendly

- TypeScript everywhere with shared types
- API-first design with billing panel examples
- Comprehensive documentation and E2E test suite

---

## Documentation

| Guide | For You If... | Description |
|-------|---------------|-------------|
| **[Getting Started](docs/GETTING_STARTED.md)** | New to Catalyst | Complete setup guide for local & production |
| **[User Guide](docs/USER_GUIDE.md)** | Server Owner | Manage your servers, files, backups, console |
| **[Admin Guide](docs/ADMIN_GUIDE.md)** | System Operator | Deploy nodes, configure networking, monitor health |
| **[Customer Guide](docs/CUSTOMER_GUIDE.md)** | Tenant | Access and use your hosted services |
| **[API Reference](docs/README.md)** | Developer | Complete REST API with integration examples |
| **[Plugin System](docs/PLUGIN_SYSTEM.md)** | Plugin Dev | Extend Catalyst with custom functionality |
| **[Features List](docs/FEATURES.md)** | All | Complete feature catalog and status |

---

## Example Use Cases

**🏢 Enterprise Game Server Host**

- Manage 1,000+ servers across 50+ nodes
- Automated backups, real-time alerts, and billing integration
- Scale horizontally with ease
- Fine-grained access control for teams

**🎮 Game Community**

- Self-host your game servers with full control
- Invite collaborators with limited permissions
- Schedule automated restarts and backups

**💻 Billing Panel Provider**

- Provision servers automatically via API
- Suspend/unsuspend based on payment status
- Full WHMCS integration with examples

---

## Project Status

| Category | Status |
|----------|--------|
| Core Features | ✅ Complete |
| Security (RBAC, Audit, TLS) | ✅ Production |
| Plugin System | ✅ Ready |
| REST API | ✅ 60+ endpoints |
| Testing | ✅ E2E + Unit tests |
| Frontend UI | 🚧 In active development |
| v2 (Scaling, CLI, Mobile) | 🔮 Planned |

---

## Configuration

Backend `.env` (see `catalyst-backend/.env.example`):

- `DATABASE_URL`, `PORT`, `CORS_ORIGIN`, `JWT_SECRET`, `BETTER_AUTH_*`
- `BACKEND_EXTERNAL_ADDRESS`, `FRONTEND_URL`
- Backup and suspension controls (see Admin Guide)

Frontend `.env` (see `catalyst-frontend/.env.example`):

- `VITE_API_URL`, `VITE_WS_URL`, `VITE_ENV`

---

## Networking Modes

- `bridge`: Node public IP with port mappings
- `host`: Host network (no port mappings); host IP selected from node public IP
- `mc-lan-static` / custom: macvlan with static IPAM pools

---

## Security Notes

- Enforce strong `JWT_SECRET` and `BETTER_AUTH_SECRET` in production
- Use TLS for HTTP/WebSocket in production
- Limit admin permissions via RBAC

---

## Known Limitations

- Transfers assume shared storage; no cross-node copy
- Backups lack retention rules by default
- Scheduler does not catch up missed runs
- Secondary allocations are not implemented

---

## Community & Support

- 📖 **[Documentation](docs/)** - Complete guides and references
- 🐛 **[Issues](https://github.com/your-repo/issues)** - Bug reports & features
- 💬 **[Discord](https://discord.gg/your-server)** - Community chat
- 📧 **[Email](mailto:support@catalyst.dev)** - Enterprise support

---

## Contributing

We welcome contributions! Please see [AGENTS.md](AGENTS.md) for repository guidelines, code conventions, and commit standards.

---

## License

MIT © 2025 Catalyst Contributors

---

**Built for scale. Ready for production.**
