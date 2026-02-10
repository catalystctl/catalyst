# Catalyst Admin Guide

**For:** Platform operators and administrators running Catalyst in production

## Table of Contents

- [System Requirements](#system-requirements)
- [Backend Setup (Production)](#backend-setup-production)
- [Frontend Setup](#frontend-setup)
- [Node & Agent Deployment](#node--agent-deployment)
- [Networking & IPAM](#networking--ipam)
- [Templates](#templates)
- [RBAC & Permissions](#rbac--permissions)
- [Backups](#backups)
- [Observability](#observability)
- [Operations Runbook](#operations-runbook)
- [Security Checklist](#security-checklist)
- [Upgrade Notes](#upgrade-notes)

---

## System Requirements

## System Requirements

- Linux (Ubuntu 22.04+ or Debian 12+ recommended)
- PostgreSQL 14+
- Node.js 20+ (backend)
- Rust 1.70+ (agent)
- containerd + nerdctl on nodes

## Backend Setup (Production)

1. Configure `catalyst-backend/.env` from `.env.example`.
2. Run database migrations:
   ```bash
   cd catalyst-backend
   bun install
   bun run db:push
   bun run db:seed
   ```
3. Build and run:
   ```bash
   bun run build
   npm start
   ```

## Frontend Setup

```bash
cd catalyst-frontend
bun install
bun run build
bun run preview
```

## Node & Agent Deployment

1. Create a node in the admin UI (hostname, publicAddress, resource caps).
2. Generate a deployment token.
3. Run the deploy script and configure `/opt/catalyst-agent/config.toml`.
4. Start the agent service:
   ```bash
   sudo systemctl start catalyst-agent
   sudo systemctl status catalyst-agent
   ```

## Networking & IPAM

- `mc-lan-static` is the default macvlan network with static IPAM.
- Configure IP pools per node in **Admin → Network**.
- Host networking uses the node public IP when no explicit IP is set.

## Templates

- Store templates under `templates/`.
- Keep `TEMPLATE_IMAGE`, `startup`, and required variables in sync.

## RBAC & Permissions

- Permissions are enforced per route (e.g., `server.start`).
- Use roles to grant least-privilege access.
- Audit logging is enabled for privileged operations.

## Backups

- Configure storage via `.env`:
  - `BACKUP_DIR`, `BACKUP_STORAGE_MODE`, `BACKUP_S3_*`, `BACKUP_SFTP_*`
- Ensure `BACKUP_CREDENTIALS_ENCRYPTION_KEY` is set in production.

## Observability

- Backend logs: stdout (pino).
- Agent logs: `journalctl -u catalyst-agent`.
- Health: node metrics are stored in `NodeMetrics`.

## Operations Runbook

- **Node offline**: check agent service, WebSocket connectivity, firewall.
- **Server stuck starting**: inspect console logs, check containerd status.
- **IP conflicts**: review IP pools and port bindings.
- **Suspensions**: `SUSPENSION_ENFORCED` controls blocking.

## Security Checklist

- Rotate secrets: `JWT_SECRET`, `BETTER_AUTH_SECRET`.
- Enforce TLS for HTTP/WebSocket endpoints.
- Restrict admin access by role.
- Use separate DB credentials per environment.

## Upgrade Notes

- Backend: `bun run build` then restart service.
- Agent: rebuild with `cargo build --release`, then restart service.
- Apply DB migrations before backend restart.
