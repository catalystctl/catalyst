# Catalyst Documentation

Welcome to the Catalyst documentation. This is the central index for all guides, references, and technical documentation.

---

## ⚡ Get Running Now

**New to Catalyst?** Pick your path:

| Path | If you... | Start here |
|------|-----------|------------|
| **🚀 Simple** | Want to get running in 5 minutes with Docker | **[QUICKSTART.md](QUICKSTART.md)** |
| **📖 Detailed** | Want to understand every option and edge case | **[installation.md](installation.md)** |

> **Docker is the only supported deployment method.** You need Docker (or Podman) with Compose support. Nothing else required — no Node.js, no Rust, no database setup.

### Simple Path

For most users who just want Catalyst running:

```bash
# One-line install
curl -fsSL https://raw.githubusercontent.com/catalystctl/catalyst/main/install.sh | bash
cd catalyst-docker && nano .env && docker compose up -d
```

Then follow **[QUICKSTART.md](QUICKSTART.md)** → **[Getting Started](getting-started.md)** for your first server.

### Detailed Path

For production deployments, custom setups, or when things go wrong:

1. **[installation.md](installation.md)** — Complete install guide with every option
2. **[Docker Setup](docker-setup.md)** — Deep dive into Docker Compose, volumes, TLS, networking
3. **[Environment Variables](environment-variables.md)** — Every config variable explained

---

## 📚 All Guides

### Quick Start

| Guide | Audience | Detail Level |
|-------|----------|-------------|
| **[QUICKSTART](QUICKSTART.md)** | New users — 5-minute Docker setup | Simple |
| **[Getting Started](getting-started.md)** | First-time users — walkthrough after install | Simple |
| **[Installation](installation.md)** | Devs & ops — full install instructions | Medium |
| **[Installation (Detailed)](installation.md)** | Production deployments — every option covered | Detailed |
| **[Usage Examples](usage-examples.md)** | Everyone — copy-paste API, CLI, and automation snippets | Reference |

### End User Guides

| Document | Description |
|----------|-------------|
| [User Guide](user-guide.md) | Game server management: console, files, backups, databases, tasks, SFTP |
| [Troubleshooting](troubleshooting.md) | Common errors, solutions, and debugging workflows |

### Administration

| Document | Description |
|----------|-------------|
| [Admin Guide](admin-guide.md) | Node deployment, user/role management, templates, monitoring, health checks |
| [Agent Guide](agent.md) | Deploy and configure the Rust agent on game server nodes (containerd, CNI) |
| [Environment Variables](environment-variables.md) | Complete reference of all 60+ configuration variables with defaults |

### Infrastructure & Deployment

| Document | Description |
|----------|-------------|
| [Docker Setup](docker-setup.md) | Docker Compose reference: services, volumes, networking, TLS, health checks |
| [Architecture Overview](architecture.md) | System design, component diagrams, data flow, security model, scaling |

### Developer Resources

| Document | Description |
|----------|-------------|
| [API Reference](api-reference.md) | Complete REST API endpoints with request/response schemas |
| [Automation & Plugin Guide](automation.md) | Scheduled tasks, webhooks, API automation, bulk operations, plugins |
| [Development Guide](development.md) | Dev environment setup, testing, code style, build process |
| [Plugin System Guide](plugins.md) | Complete plugin development guide: architecture, SDK, examples, security |
| [Plugin System Analysis](plugin-system-analysis.md) | Deep dive into the plugin architecture and internals |
| [Plugin System Gap Analysis](plugin-system-gaps.md) | Identified gaps and recommended improvements for the plugin system |

### Security

| Document | Description |
|----------|-------------|
| [Security Policy](SECURITY.md) | Security policy, vulnerability reporting, threat model |
| [Security Quick Reference](SECURITY_QUICK_REFERENCE.md) | Quick security checklist and best practices |
| [Security Review Prompt](SECURITY_REVIEW_PROMPT.md) | Formal security review checklist and audit template |

---

## 🏗️ Architecture at a Glance

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Browser   │────▶│   Nginx     │────▶│  Fastify    │
│  (React)    │◀────│  (Frontend) │◀────│  (Backend)  │
└─────────────┘     └─────────────┘     └──────┬──────┘
                                               │
                    ┌─────────────┐     ┌──────┴──────┐
                    │  Game Node  │◀────│  WebSocket  │
                    │Rust Agent   │     │   Gateway   │
                    │(containerd)│     └─────────────┘
                    └─────────────┘            │
                                        ┌──────┴──────┐
                                        │ PostgreSQL  │
                                        │   + Redis   │
                                        └─────────────┘
```

---

## 📖 Documentation Conventions

- Code blocks include language tags for syntax highlighting
- `::: tip`, `::: warning`, and `::: danger` admonitions highlight important notes
- All paths are relative to the repository root unless stated otherwise
- Environment variable examples use `bash` syntax

---

## 🛠️ Missing Something?

If you find gaps in the documentation or encounter unclear sections:

1. Check the [Troubleshooting](troubleshooting.md) guide
2. Review the [API Reference](api-reference.md) for technical details
3. Open an issue on GitHub with the `documentation` label

---

*Last updated: 2026-05-11*
