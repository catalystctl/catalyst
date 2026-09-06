# Environment Variables Reference

> Complete reference for all Catalyst environment variables. Grouped by service and category for easy navigation.

::: tip Single Source of Truth
**`PUBLIC_URL`** is the single source of truth for the panel URL. When set, it automatically drives `BETTER_AUTH_URL`, `CORS_ORIGIN`, `FRONTEND_URL`, `BACKEND_EXTERNAL_ADDRESS`, and `BACKEND_URL`. You only need to override those individually for split internal/external setups.
:::

## Table of Contents

1. [Quick Reference](#quick-reference)
2. [Backend Environment Variables](#backend-environment-variables)
   - [General](#general)
   - [Public URL & Addresses](#public-url--addresses)
   - [Server & Networking](#server--networking)
   - [Database](#database)
   - [Authentication](#authentication)
   - [OAuth Providers](#oauth-providers)
   - [Console & Server Limits](#console--server-limits)
   - [Suspension Policies](#suspension-policies)
   - [Database Hosts (MySQL)](#database-hosts-mysql)
   - [SFTP Server](#sftp-server)
   - [Plugins](#plugins)
   - [Backups](#backups)
   - [Webhooks](#webhooks)
   - [Optional Services](#optional-services)
   - [Performance & Scaling](#performance--scaling)
   - [Auto Updater](#auto-updater)
   - [Bootstrap / Seeding (Dev Only)](#bootstrap--seeding-dev-only)
3. [Docker Compose Environment Variables](#docker-compose-environment-variables)
   - [Ports](#ports)
   - [PostgreSQL](#postgresql)
   - [Redis](#redis)
   - [TLS/Reverse Proxy](#tlsreverse-proxy)
4. [Frontend Build Variables](#frontend-build-variables)
5. [Agent Environment Variables](#agent-environment-variables)
6. [Agent TOML Configuration](#agent-toml-configuration)
7. [Variables Not Configurable via Environment](#variables-not-configurable-via-environment)
8. [Security Recommendations](#security-recommendations)
9. [Troubleshooting Common Config Issues](#troubleshooting-common-config-issues)

---

## Quick Reference

| Variable | Required | Default | Sensitive | Service |
|----------|----------|---------|-----------|---------|
| `DATABASE_URL` | ✅ Required | — | ✅ Yes | Backend |
| `BETTER_AUTH_SECRET` | ✅ Required | — | ✅ Yes | Backend |
| `PUBLIC_URL` | Recommended | — | — | All |
| `POSTGRES_PASSWORD` | ✅ Required | — | ✅ Yes | Docker |
| `BACKUP_CREDENTIALS_ENCRYPTION_KEY` | For S3 backups | — | ✅ Yes | Backend |
| `NODE_ID` | ✅ Required for nodes | — | ✅ Yes | Agent |
| `NODE_API_KEY` | ✅ Required for nodes | — | ✅ Yes | Agent |

::: warning Critical
`DATABASE_URL`, `BETTER_AUTH_SECRET`, and `POSTGRES_PASSWORD` **must** be set before starting the backend. The application will refuse to start without them.
:::

---

## Backend Environment Variables

All backend variables are defined in `catalyst-backend/.env.example`.

::: tip Copy to Start
```bash
cp catalyst-backend/.env.example catalyst-backend/.env
```
:::

### General

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `NODE_ENV` | `development` \| `production` | `development` | Affects HSTS headers, cookie security, logging format, and debug output. Always set to `production` in deployed environments. |
| `ENABLE_COMPRESSION` | `true` \| `false` | Enabled unless `false` | HTTP response compression (gzip/br/deflate). The backend registers compression unless `ENABLE_COMPRESSION=false`; the Docker stack sets `false` because nginx handles compression instead. |
| `TZ` | IANA timezone | `UTC` | Timezone for scheduled tasks and log timestamps. Use values like `America/New_York`, `Europe/London`, `Asia/Tokyo`. |
| `LOG_LEVEL` | `trace` \| `debug` \| `info` \| `warn` \| `error` | `info` | Pino log level. `trace` includes all HTTP request details; `error` only shows errors. Note: stock `catalyst-docker/docker-compose.yml` hardcodes `LOG_LEVEL: info`; editing `.env` alone does not change it without a Compose edit. |
| `TRUST_PROXY` | `true` \| `false` | `true` | Trust `X-Forwarded-*` headers from nginx/reverse proxy. Set to `false` only on direct exposure. |
| `DOCS_ENABLED` | `true` \| `false` | `404` in production unless `true` | Enables runtime Swagger UI at `GET /docs`. |
| `ALLOW_DATA_LOSS` | `0` \| `1` | `0` | Entrypoint only: `1` permits destructive `prisma db push`. Never set in normal operation. |
| `APP_NAME` | String | `Catalyst` | Panel name shown in emails, auth issuer claims, and UI. |

### Public URL & Addresses

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `PUBLIC_URL` | Full URL | — | **SINGLE SOURCE OF TRUTH.** Set this to the exact URL users access the panel from (e.g., `https://panel.example.com`). It drives CORS, Better Auth trusted origins, deploy scripts, agent config, and email links. No trailing slash. |
| `PORT` | Integer | `3000` | Backend HTTP listen port. Only relevant when running without Docker port mapping. |
| `CORS_ORIGIN` | Comma-separated URLs | Auto from `PUBLIC_URL` | Allowed CORS origins. Example: `CORS_ORIGIN=https://panel.example.com,https://admin.example.com`. Leave empty to default to `PUBLIC_URL`. |
| `BACKEND_EXTERNAL_ADDRESS` | Full URL | Auto from `PUBLIC_URL` | Public-facing backend URL used for generated links, webhooks, and auth redirects. Override only if internal/external URLs differ (e.g., internal Docker network address). |
| `FRONTEND_URL` | Full URL | Auto from `PUBLIC_URL` | Frontend base URL for password reset links, profile redirects, and invite URLs. Override only for split frontend/backend deployments. |
| `DEV_EXTRA_ORIGINS` | Comma-separated URLs | — | Additional CORS origins for local development (e.g., `http://localhost:5173,http://127.0.0.1:5173`). Only used when `NODE_ENV=development`. |
| `COOKIE_SECURE` | `true` \| `false` | Auto (depends on `NODE_ENV`) | Set to `false` to disable secure cookies. Not recommended outside development. |

::: tip URL Resolution Order
```
BETTER_AUTH_URL → PUBLIC_URL → BACKEND_EXTERNAL_ADDRESS → http://localhost:3000
FRONTEND_URL    → PUBLIC_URL → http://localhost:5173
```
The first available value is used. See source: `catalyst-backend/src/auth.ts`.
:::

#### CORS Mechanism (How Origins Are Checked)

CORS is enforced via `@fastify/cors` on every request. The allowed origins list is built dynamically from multiple sources:

| Source | Condition | Example |
|--------|-----------|--------|
| `CORS_ORIGIN` | Always checked; comma-separated | `https://panel.example.com,https://admin.example.com` |
| `PUBLIC_URL` | Always checked | `https://panel.example.com` |
| `FRONTEND_URL` | Always checked | `https://panel.example.com` |
| Dev origins | Only when `NODE_ENV=development` | `http://localhost:3000`, `http://localhost:5173`, `http://127.0.0.1:3000`, `http://127.0.0.1:5173` |
| `DEV_EXTRA_ORIGINS` | Only in development | Additional custom origins |

**Settings:**
- **Allowed methods:** `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`
- **Allowed headers:** `Content-Type`, `Authorization`, `X-Requested-With`, `X-Client-Info`
- **Credentials:** `true` (cookies supported)
- **Preflight cache (`maxAge`):** `86400` seconds (24 hours)

::: warning Agent Auth Headers Not in CORS
The headers `X-Catalyst-Node-Id`, `X-Catalyst-Node-Token`, and `X-Node-Api-Key` are **intentionally NOT** included in allowed CORS headers. These are server-to-server agent authentication headers and should never be exposed to browser JavaScript.
:::

::: tip Better Auth Trusted Origins
Better Auth uses the same origin list (via `buildTrustedOrigins()`) for its `trustedOrigins` setting. This ensures OAuth callbacks, JWT verification, and session cookies all respect the same origin policy.
:::

### Server & Networking

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `BACKEND_URL` | Full URL | `http://localhost:3000` | Base URL for generated deployment scripts. Used when internal Docker network addresses differ from public URLs. |
| `API_URL` | Full URL | — | **Not currently used.** Use `BACKEND_URL` or `BACKEND_EXTERNAL_ADDRESS` instead. Reserved for future API gateway routing. |

### Database

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `DATABASE_URL` | PostgreSQL connection string | **Required** | Full connection string: `postgresql://user:password@host:5432/dbname`. No default — must be set. The application **will not start** without this. |
| `DB_POOL_MAX` | Integer | `15` | PostgreSQL connection pool max size. Raise for production under load. |
| `DB_STATEMENT_TIMEOUT_MS` | Integer | `30000` | **Reserved for future use.** Statement timeout per query in milliseconds. Currently hardcoded in Prisma config. |

::: warning DATABASE_URL
The application crashes on startup if `DATABASE_URL` is not set. Use the Docker Compose variables below (or a managed PostgreSQL service) to provide this.
:::

### Authentication

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `BETTER_AUTH_SECRET` | 32-byte base64 | **Required** | Cryptographic secret for Better Auth sessions, JWT signing, and CSRF protection. Generate with: `openssl rand -base64 32`. **Rotate carefully** — rotating invalidates all existing sessions. |
| `API_KEY_SECRET` | Base64 string | Falls back to `BETTER_AUTH_SECRET` | HMAC secret for hashing panel/agent API keys. If unset, falls back to `BETTER_AUTH_SECRET` (same as Docker Compose). Set a dedicated value for key-rotation isolation: `openssl rand -base64 32`. |
| `BETTER_AUTH_URL` | Full URL | `http://localhost:3000` | Better Auth base URL. Defaults to `PUBLIC_URL` if set. Override only for split internal/external setups. |
| `PASSKEY_RP_ID` | Hostname | `localhost` | Passkey (WebAuthn) relying party ID. Must match the hostname portion of `PUBLIC_URL`. For `https://panel.example.com`, set `PASSKEY_RP_ID=panel.example.com`. |

### OAuth Providers

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `WHMCS_OIDC_CLIENT_ID` | String | — | WHMCS OpenID Connect client ID. Leave empty to disable. |
| `WHMCS_OIDC_CLIENT_SECRET` | String | — | WHMCS OIDC client secret. |
| `WHMCS_OIDC_DISCOVERY_URL` | Full URL | — | WHMCS OIDC discovery endpoint (e.g., `https://billing.example.com/.well-known/openid-configuration`). |
| `PAYMENTER_OIDC_CLIENT_ID` | String | — | Paymenter OpenID Connect client ID. Leave empty to disable. |
| `PAYMENTER_OIDC_CLIENT_SECRET` | String | — | Paymenter OIDC client secret. |
| `PAYMENTER_OIDC_DISCOVERY_URL` | Full URL | — | Paymenter OIDC discovery endpoint. |

::: tip Security
Do not commit OAuth secrets to version control. Use secret managers, Docker secrets, or CI/CD vault injection for production.
:::

### Console & Server Limits

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `CONSOLE_OUTPUT_BYTE_LIMIT_BYTES` | Integer | `262144` (256 KB) in code; Docker stack sets `524288` | Per-server console output cap in bytes. Clamped to range 65536–2097152. |
| `MAX_DISK_MB` | Integer | Unset (no cap) unless set | Maximum disk usage per server in megabytes, enforced only when set. The Docker stack sets a high default; the backend example uses `10240`. |

### Suspension Policies

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `SUSPENSION_ENFORCED` | `true` \| `false` | `true` | Enforce suspension across all server operations. Set to `false` to disable suspension checks (not recommended). |
| `SUSPENSION_DELETE_POLICY` | `block` \| `keep` \| `delete` | Code treats `block` as block | What to do when a suspended server needs disk cleanup. Only the exact value `block` blocks in code; compose ships `keep`. |
| `SUSPENSION_DELETE_BLOCKED` | `true` \| `false` | `true` in code (blocked unless `false`); compose ships `false` | Whether to block file deletion while a server is suspended. |

### Database Hosts (MySQL)

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `DATABASE_HOST_CONNECT_TIMEOUT_MS` | Integer | `5000` | Connection timeout when creating new MySQL database host connections, in milliseconds. |

> `DATABASE_HOST_PORT_DEFAULT` appears in some examples but is not read by the backend — only `DATABASE_HOST_CONNECT_TIMEOUT_MS` is.

### Server Data

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `SERVER_DATA_DIR` | Filesystem path | `/var/lib/catalyst/servers` | Root directory for server data. All server files live under this path. |

::: tip SFTP Runs on the Agent
SFTP is hosted by the **node agent** (default port `2022`), not the panel or backend. The per-node SFTP port is configured in the panel (Admin → Nodes) and written into the agent's `config.toml` by the deploy script. The panel only issues short-lived SFTP tokens (`/api/sftp/connection-info`).

SFTP file size is the panel Admin → Security **Max upload size**, not an environment variable.
:::

### Plugins

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `PLUGINS_DIR` | Filesystem path | `/var/lib/catalyst/plugins` in Docker (`./plugins` in the backend example) | Directory where installed plugins are loaded from. |
| `PLUGIN_HOT_RELOAD` | `true` \| `false` | `false` | Enable live reload of plugins on file changes. Disable in production. |
| `AGENT_TARGET_DIR` | Filesystem path | `/opt/catalyst-agent` | Target directory for agent deployment on game server nodes. |
| `DEPLOY_SCRIPT_PATH` | Filesystem path | — | Path to a custom agent deployment script. Uses the built-in script if not set. |

### Backups

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `BACKUP_DIR` | Filesystem path | `/var/lib/catalyst/backups` | Default directory for local backup storage. |
| `BACKUP_STORAGE_MODE` | `local` \| `s3` \| `stream` | `local` | Default backup storage backend. Change to `s3` for S3-compatible storage. |
| `BACKUP_STREAM_DIR` | Temp path | `/tmp/catalyst-backup-stream` | Temporary directory for streaming backup operations. |
| `BACKUP_TRANSFER_DIR` | Temp path | `/tmp/catalyst-backup-transfer` | Temporary directory for backup file transfers. |
| `BACKUP_CREDENTIALS_ENCRYPTION_KEY` | 32-byte key | **Required for S3** | Key used to encrypt backup credentials stored in the database. `install.sh` generates base64 (`openssl rand -base64 32`). Note: `routes/backups.ts` also reads a legacy `BACKUP_ENCRYPTION_KEY` — use `BACKUP_CREDENTIALS_ENCRYPTION_KEY`. |

#### S3 Backup Variables (when `BACKUP_STORAGE_MODE=s3`)

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `BACKUP_S3_BUCKET` | String | — | S3 bucket name. Required for S3 backups. |
| `BACKUP_S3_REGION` | AWS region | `us-east-1` | S3 region. |
| `BACKUP_S3_ACCESS_KEY` | String | — | S3 access key ID. |
| `BACKUP_S3_SECRET_KEY` | String | — | S3 secret access key. |
| `BACKUP_S3_ENDPOINT` | Full URL | — | Custom S3 endpoint (e.g., `https://minio.example.com`). Useful for MinIO or cloud providers with custom URLs. |
| `BACKUP_S3_PATH_STYLE` | `true` \| `false` | `false` | Use path-style URLs (`bucket.endpoint/key`) instead of virtual-hosted style (`bucket.endpoint/key`). Set to `true` for MinIO. |

#### SFTP Backup (Reserved)

These variables are **reserved for future implementation** and currently have no effect:

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `BACKUP_SFTP_HOST` | Host | — | SFTP server hostname (future). |
| `BACKUP_SFTP_PORT` | Integer | `22` | SFTP port (future). |
| `BACKUP_SFTP_USER` | String | — | SFTP username (future). |
| `BACKUP_SFTP_PASSWORD` | String | — | SFTP password (future). |
| `BACKUP_SFTP_PATH` | Path | `/backups` | Remote SFTP path (future). |

### Webhooks

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `WEBHOOK_URLS` | Comma-separated URLs | — | Comma-separated list of webhook endpoints for global notifications. Example: `WEBHOOK_URLS=https://discord.example.com/hook,https://slack.example.com/hook`. |
| `WEBHOOK_SECRET` | Hex string | Auto-generated | Secret for HMAC-signing all outbound webhook payloads. If not set, a random 32-byte hex key is generated at startup (changes on restart). For reliable signature verification, set this explicitly. Generate with: `openssl rand -hex 32`. |

::: tip Webhook Signing
Webhooks include an `X-Webhook-Signature` header with an HMAC-SHA256 hash of the payload, signed using `WEBHOOK_SECRET`. Recipients should verify this signature to ensure authenticity.
:::

### Optional Services

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `REDIS_URL` | Redis connection string | — | Reserved. There is currently no Redis client in the backend (`REDIS_URL` is never read); Redis runs in Compose but is inert. Leave as Compose sets it. Example: `redis://:password@localhost:6379/0`. |

### Performance & Scaling

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `MAX_AGENT_CONNECTIONS` | Integer | `1000` | Max concurrent WebSocket connections from agent nodes. |
| `MAX_CLIENT_CONNECTIONS` | Integer | `10000` | Max concurrent connections from dashboard/API clients. |
| `MAX_CONNECTIONS_PER_USER` | Integer | `10` | Max concurrent connections per authenticated user. |
| `WORKERS` | Integer | `0` | Number of **Node.js** cluster worker processes. `0` = single process (cluster mode off). Set to a positive number for multi-process cluster mode. |
| `WS_MAX_PAYLOAD_BYTES` | Integer | `8388608` (8 MB) | Maximum accepted WebSocket message size (`fastify-websocket` `maxPayload`, registered in `catalyst-backend/src/index.ts`). Messages larger than this are rejected at the protocol level. Raise only if agents legitimately send larger single frames. |
| `AGENT_BACKPRESSURE_BYTES` | Integer | `4194304` (4 MiB) | Outbound backpressure watermark per agent socket in `WebSocketGateway`. When an agent's unsent outbound buffer exceeds this, low-priority traffic to that agent is shed and bulk binary transfers abort instead of growing memory; control-plane power commands are always attempted. |
| `METRICS_RETENTION_DAYS` | Integer | `30` | How long to retain server metrics data, in days. |

### Auto Updater

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `AUTO_UPDATE_ENABLED` | `true` \| `false` | `false` | Enable automatic update checking. The backend checks for new releases at regular intervals. |
| `AUTO_UPDATE_INTERVAL_MS` | Integer | `3600000` (1 hour) | Interval between update checks, in milliseconds. |
| `AUTO_UPDATE_AUTO_TRIGGER` | `true` \| `false` | `false` | Auto-trigger the update when a new version is available. If `false`, only send a notification (admin must approve). |
| `AUTO_UPDATE_DOCKER_COMPOSE_PATH` | Filesystem path | `${CATALYST_COMPOSE_DIR:-/opt/catalyst-docker}/docker-compose.yml` in Docker | Path to `docker-compose.yml` for Docker-based auto-update. Used to restart the stack after updating. |

### Bootstrap / Seeding (Dev Only)

::: danger Development Only
These variables and the associated seed scripts are for **development and initial provisioning only**. Do not run seed scripts in production. For new production installs, use the `/setup` web UI or `bootstrap-production.ts`.
:::

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `CATALYST_ADMIN_EMAIL` | Email | — | Admin email for bootstrap script (dev only). |
| `CATALYST_ADMIN_USERNAME` | String | — | Admin username for bootstrap script (dev only). |
| `CATALYST_ADMIN_PASSWORD` | String | — | Admin password for bootstrap script (dev only). |
| `CATALYST_ADMIN_NAME` | String | — | Admin display name for bootstrap script (dev only). |
| `SEED_ALLOW_DEFAULT_ADMIN` | `true` \| `false` | `false` | Allow seed scripts to run in production. **Never set to `true` in production.** |
| `SEED_NODE_PUBLIC_ADDRESS` | IP/Hostname | — | Seed node public address (dev only). |
| `SEED_NODE_HOSTNAME` | String | — | Seed node hostname (dev only). |

---

## Docker Compose Environment Variables

Docker Compose adds several variables on top of the backend variables, defined in `catalyst-docker/.env.example`.

::: tip Copy to Start
```bash
cp catalyst-docker/.env.example catalyst-docker/.env
```
:::

### Ports

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `FRONTEND_PORT` | Host:Container binding | `0.0.0.0:8080` | Port binding for the frontend service. For podman (rootless), use a port ≥ 1024 (e.g., `0.0.0.0:8080`). |
| `BACKEND_PORT` | Host:Container binding | `127.0.0.1:3000` (compose default) | Host publish for the backend API. Compose defaults to **localhost-only**; the process still listens on `0.0.0.0` inside the container. |

::: tip Restricting Bind Addresses
Set the prefix to `127.0.0.1:` to restrict access to localhost only. Example: `FRONTEND_PORT=127.0.0.1:8080`.

### PostgreSQL

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `POSTGRES_USER` | String | `catalyst` | PostgreSQL superuser name. Hardcoded to `catalyst` in `catalyst-docker/docker-compose.yml`; `.env` values do not interpolate. |
| `POSTGRES_PASSWORD` | String | **Required** | PostgreSQL superuser password. **Must be changed from the default before production use.** |
| `POSTGRES_DB` | String | `catalyst_db` | PostgreSQL database name. Hardcoded to `catalyst_db` in Compose; `.env` values do not interpolate. |
| `POSTGRES_PORT` | Host:Container binding | `127.0.0.1:5432` | Port mapping for exposing PostgreSQL to the host (e.g., for pgAdmin or local tools). |

::: tip PostgreSQL Security
The PostgreSQL port is **not exposed by default**. To connect from the host, set `POSTGRES_PORT=127.0.0.1:5432`. Never expose it on `0.0.0.0`.

### Redis

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `REDIS_PASSWORD` | String | — | Redis authentication password. The Docker stack requires it (`redis-server --requirepass ${REDIS_PASSWORD:?...}` refuses to boot without it; `install.sh` auto-generates it). Leave empty only in non-Docker dev setups where Redis is not exposed externally. |
| `REDIS_PORT` | Host:Container binding | — | Port mapping for exposing Redis to the host. Leave commented to keep Redis internal to the Docker network. |

### TLS/Reverse Proxy

::: warning Production
The following variables are required when using the Caddy or Traefik TLS overlay Compose files (`docker-compose.caddy.yml` or `docker-compose.traefik.yml`).
:::

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `DOMAIN` | Hostname | — | Domain name for automatic HTTPS (e.g., `panel.example.com`). Requires a DNS A record pointing to your server and ports 80/443 accessible. |
| `ACME_EMAIL` | Email | — | Email for Let's Encrypt certificate notifications (renewal warnings, expiration). Optional but recommended. |
| `HTTP_PORT` | Host:Container binding | `0.0.0.0:80` | HTTP (port 80) binding for the reverse proxy. |
| `HTTPS_PORT` | Host:Container binding | `0.0.0.0:443` | HTTPS (port 443) binding for the reverse proxy. |
| `TRAEFIK_DASHBOARD_PORT` | Host:Container binding | `127.0.0.1:8080` | Traefik dashboard binding. **Defaults to localhost only.** Set to empty to disable. **Never expose on `0.0.0.0` without authentication.** |

::: danger Traefik Dashboard
Never set `TRAEFIK_DASHBOARD_PORT=0.0.0.0:8080`. The dashboard exposes configuration without authentication by default. If you need remote access, use SSH tunneling or restrict with Traefik middleware.
:::

---

## Frontend Build Variables

Frontend variables are defined in `catalyst-frontend/.env.example` and consumed by Vite at build time.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `VITE_API_URL` | Full URL | — | Base URL for API requests. Empty = use Vite dev proxy in development, relative paths in production. |
| `VITE_BETTER_AUTH_URL` | Full URL | Auto from `VITE_API_URL` | Base URL for Better Auth client. Defaults to `VITE_API_URL` if not set. |
| `VITE_PASSKEY_RP_ID` | Hostname | — | Only affects Vite dev-server `allowedHosts` in `vite.config.ts`; it is not read by frontend `src` code. Set the backend `PASSKEY_RP_ID` to match your domain. |
| `SKIP_WEB_SERVER` | `true` \| `false` | `false` | Playwright Node-side flag (read in `playwright.config.ts`), not a Vite browser variable. Set to `true` in CI to skip starting the frontend dev server during E2E tests. |

::: tip Vite Environment Variables
Frontend env vars are prefixed with `VITE_` because Vite only exposes variables with this prefix to the browser bundle. They are baked into the JavaScript at build time, not read at runtime.
:::

---

## Agent Environment Variables

The Catalyst Agent (`catalyst-agent`) reads configuration from environment variables **or** `config.toml`. Environment variables take precedence.

::: tip Agent Configuration
Agent variables are set on the node/server where the agent runs. They are NOT set in Docker Compose — they are injected into the agent process or passed as TOML config.
:::

### Required Variables

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `NODE_ID` | UUID | **Required** | Unique node identifier from the database. Set during node deployment. |
| `NODE_API_KEY` | String | **Required** | Agent API key for node authentication. Set during node deployment. |

### Optional Variables

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `BACKEND_URL` | WebSocket URL | `wss://localhost:3000/ws` in code (`ws://` in the TOML example header) | Backend gateway URL for the agent. Use `ws://` for loopback/RFC1918 development, `wss://` for production. |
| `DATA_DIR` | Filesystem path | `/var/lib/catalyst` | Root directory for container volumes and agent data. |
| `CONTAINERD_SOCKET` | Filesystem path | `/run/containerd/containerd.sock` | Path to the containerd Unix socket. |
| `CONTAINERD_NAMESPACE` | String | `catalyst` | containerd namespace for Catalyst containers. |
| `LOG_LEVEL` | `trace` \| `debug` \| `info` \| `warn` \| `error` | `info` | Rust tracing log level. |
| `HOSTNAME` | String | Auto-detected | Human-readable hostname for this node. Defaults to the OS hostname. |
| `MAX_CONNECTIONS` | Integer | `100` | Maximum servers managed by this agent instance (server-count enforcement, capped at 1000). |
| `SFTP_ENABLED` | `true` \| `false` | `true` | Set to `false`/`0` to disable the agent SFTP server. |
| `SFTP_PORT` | Integer | `2022` | Agent SFTP listen port. |
| `SFTP_HOST_KEY` | Filesystem path | `/opt/catalyst-agent/sftp_host_key` | Agent SFTP host key path. |
| `CATALYST_ALLOW_INSECURE_WS` | `1` or unset | Unset | Set to `1` to allow `ws://` to public hosts. Loopback and RFC1918 private LAN IPs (`10/8`, `172.16/12`, `192.168/16`) are already allowed without this. **Never set for public internet backends.** |

::: tip Node Deployment
When deploying a node, `NODE_ID` and `NODE_API_KEY` are generated by the Catalyst backend and injected via the deployment script. You rarely need to set these manually.
:::

---

## Agent TOML Configuration

The agent also supports a `config.toml` file. This is used when running the agent as a binary outside of Docker, or when environment variables are not convenient.

::: tip Env Vars vs TOML
Environment variables **always take precedence** over `config.toml` values. Use TOML for persistent configuration and env vars for overrides (e.g., secrets).
:::

### Structure

```toml
[server]
backend_url = "wss://panel.example.com:3000/ws"
node_id = "your-node-uuid-here"
api_key = "your-api-key-here"
hostname = "node1.example.com"
data_dir = "/var/lib/catalyst"
max_connections = 100

[containerd]
socket_path = "/run/containerd/containerd.sock"
namespace = "catalyst"

[networking]
# Optional: configure macvlan networks
# [[networking.networks]]
# name = "mc-lan-static"
# interface = "eth0"
# cidr = "10.5.5.0/24"
# gateway = "10.5.5.1"
# range_start = "10.5.5.50"
# range_end = "10.5.5.200"

[logging]
level = "info"
format = "json"  # "json" or "text"
```

### TOML Sections

#### `[server]` — Agent Server Settings

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `backend_url` | URL | `ws://localhost:3000/ws` | Backend WebSocket URL. |
| `node_id` | UUID | — | Unique node identifier. |
| `api_key` | String | — | Agent API key. |
| `hostname` | String | Auto-detected | Node hostname. |
| `data_dir` | Path | `/var/lib/catalyst` | Data directory for volumes. |
| `max_connections` | Integer | `100` | Max concurrent WebSocket connections. |

#### `[containerd]` — Container Runtime

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `socket_path` | Path | `/run/containerd/containerd.sock` | containerd Unix socket path. |
| `namespace` | String | `catalyst` | containerd namespace for Catalyst containers. |

#### `[networking]` — Container Networking

Configure one or more macvlan networks for game server IP allocation. If omitted, the agent provisions a default `mc-lan-static` network based on the primary interface.

| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `name` | String | ✅ Yes | Network name (e.g., `mc-lan-static`). |
| `interface` | String | ✅ Yes | Host network interface (e.g., `eth0`). |
| `cidr` | CIDR | ✅ Yes | Network CIDR (e.g., `10.5.5.0/24`). |
| `gateway` | IP | ✅ Yes | Network gateway (e.g., `10.5.5.1`). |
| `range_start` | IP | ✅ Yes | IP range start for allocation. |
| `range_end` | IP | ✅ Yes | IP range end for allocation. |

::: tip Macvlan Networks
macvlan networks give each container a unique IP on your LAN. This is ideal for game servers that need public IPs. The networking section supports multiple networks for different purposes (e.g., `mc-lan-static` for LAN games, `mc-public` for public servers).
:::

#### `[logging]` — Agent Logging

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `level` | `trace` \| `debug` \| `info` \| `warn` \| `error` | `info` | Log verbosity level. |
| `format` | `json` \| `text` | `json` | Log output format. `json` is recommended for log aggregation. |

---

## Security Headers (Helmet/CSP)

These security headers are enforced by `@fastify/helmet` and **cannot** be changed via environment variables. They are hardcoded in `catalyst-backend/src/index.ts`.

### Content Security Policy (CSP)

| Directive | Value | Purpose |
|-----------|-------|--------|
| `default-src` | `'self'` | Only allow resources from same origin |
| `script-src` | `'self'` | Only allow same-origin JavaScript |
| `style-src` | `'self'` | Only allow same-origin CSS |
| `img-src` | `'self'`, `data:`, `https:` | Allow same-origin, inline data URIs, and HTTPS remote images |

**Why this policy:** Prevents XSS by disallowing inline scripts and third-party resource loading. WebSocket connections are allowed via `crossOriginEmbedderPolicy: false`.

### HSTS (HTTP Strict Transport Security)

| Setting | Production | Development |
|---------|-----------|-------------|
| `maxAge` | `31536000` (1 year) | Disabled |
| `includeSubDomains` | `true` | N/A |
| `preload` | `true` | N/A |

::: tip Production Only
HSTS is **only enabled** when `NODE_ENV=production`. It tells browsers to always use HTTPS for 1 year, including subdomains, and to preload the domain into browsers for even faster HTTPS enforcement.
:::

### Other Security Headers

| Header | Value | Purpose |
|--------|-------|--------|
| `referrer-policy` | `no-referrer-when-downgrade` | Send full referrer for HTTPS→HTTPS, strip for HTTPS→HTTP |
| `crossOriginEmbedderPolicy` | `false` | Allows WebSocket connections (required for SSE/console streaming) |
| `x-powered-by` | Stripped | Prevents framework fingerprinting |

---

## Variables Not Configurable via Environment

These settings are **hardcoded** in the source code and **cannot** be changed via environment variables:

| Setting | Value | Location | Description |
|---------|-------|----------|-------------|
| `SERVER_METRICS_MAX_PER_SEC` | `1` | `catalyst-backend/src/services/` | Server metrics collection rate limit. |
| `AGENT_METRICS_MAX_PER_SEC` | `1000` | `catalyst-backend/src/services/` | Agent metrics collection rate limit. |
| `GLOBAL_CONSOLE_OUTPUT_MB_PER_SEC` | `100` | `catalyst-backend/src/` | Global console output rate cap. |
| `MAX_SSE_CONSOLE_PER_SERVER` | `50` | `catalyst-backend/src/` | Max SSE console streams per server. |
| `MAX_SSE_EVENTS_PER_SERVER` | `100` | `catalyst-backend/src/` | Max SSE events per server. |
| `SSE_CONSOLE_SWEEP_MS` | `300000` (5 min) | `catalyst-backend/src/` | SSE console stream cleanup interval. |
| `FILE_TUNNEL_MAX_QUEUE_PER_NODE` | `100` | `catalyst-backend/src/` | File tunnel queue limit per node. |
| `FILE_TUNNEL_MAX_POLLERS_PER_NODE` | `10` | `catalyst-backend/src/` | Max concurrent file tunnel pollers per node. |
| `DEFAULT_CONSOLE_OUTPUT_BYTE_LIMIT` | `262144` (256 KB) | `mailer.ts` | Default console output byte limit. |
| `MIN_CONSOLE_OUTPUT_BYTE_LIMIT` | `65536` (64 KB) | `mailer.ts` | Minimum allowed console output limit. |
| `MAX_CONSOLE_OUTPUT_BYTE_LIMIT` | `2097152` (2 MB) | `mailer.ts` | Maximum allowed console output limit. |
| **Security Settings Defaults** (via `DEFAULT_SECURITY_SETTINGS`): | | `mailer.ts` | | | |
| `authRateLimitMax` | `30` | Same | Auth endpoint rate limit per window |
| `fileRateLimitMax` | `120` | Same | File operation rate limit |
| `consoleRateLimitMax` | `60` | Same | Console input rate limit |
| `consoleOutputLinesMax` | `2000` | Same | Lines retained in console buffer |
| `consoleOutputByteLimitBytes` | `262144` (256 KB) | Same | Output byte throughput limit |
| `agentMessageMax` | `10000` | Same | Agent message rate limit |
| `agentMetricsMax` | `10000` | Same | Agent metrics rate limit |
| `serverMetricsMax` | `60` | Same | Server metrics rate limit |
| `lockoutMaxAttempts` | `5` | Same | Failed attempts before progressive lockout |
| `lockoutWindowMinutes` | `15` | Same | Time window for counting failed attempts |
| `lockoutDurationMinutes` | `15` | Same | Initial lockout duration |
| `auditRetentionDays` | `90` | Same | Audit log retention period |
| `maxBufferMb` | `50` | Same | Max buffer size per server |
| `fileTunnelRateLimitMax` | `100` | Same | File tunnel request rate limit |
| `fileTunnelMaxUploadMb` | `500` | Same | Max single-file size for the file browser and SFTP on every agent |
| `fileTunnelMaxPendingPerNode` | `50` | Same | Max pending tunnel requests per node |
| `fileTunnelConcurrentMax` | `10` | Same | Max concurrent tunnels per node |
| JWT expiration | `7 days` | `auth.ts` | Better Auth JWT token lifetime |
| Session cookie cache maxAge | `300` (5 min) | `auth.ts` | Session data cache in cookies |
| Global rate limit | `1200`/min | `index.ts` | Max requests per IP/user |
| Auth dynamic default | `60`/min | `mailer.ts` (`authRateLimitMax`) | Auth endpoint default before Admin → Security overrides |
| File operations default | `180`/min | `mailer.ts` (`fileRateLimitMax`) | File route default |
| Console input default | `120`/min | `mailer.ts` (`consoleRateLimitMax`) | Console input default |
| Better Auth internal rate limit | `30`/60s | `auth.ts` | Default better-auth rate limit |
| Better Auth `/sign-in/email` | `5`/60s | `auth.ts` | Login attempt limit |
| Better Auth `/sign-up/email` | `5`/60s | `auth.ts` | Registration attempt limit |
| Better Auth `/request-password-reset` | `3`/300s | `auth.ts` | Password reset attempt limit |
| Prisma statement timeout | `30000` ms | `prisma/prisma.config.ts` | Database query timeout. |

::: tip Hardcoded Values
To change any of these, you must modify the source code directly and rebuild. Open an issue if you need these as configurable environment variables.
:::

---

## Security Recommendations

::: danger Required Secret Generation
Before deploying to production, **generate secrets** for the following variables:
```bash
# Better Auth secret (required)
openssl rand -base64 32

# Backup credentials encryption key (required for S3 backups)
openssl rand -hex 32

# Webhook signing secret (recommended)
openssl rand -hex 32

# API key signing secret (recommended)
openssl rand -base64 32
```
:::

### Secrets That Must Be Rotated/Managed

| Variable | Risk if Compromised | Rotation Impact |
|----------|---------------------|-----------------|
| `BETTER_AUTH_SECRET` | Full session takeover, auth bypass | **Invalidates ALL user sessions.** Rotate during maintenance window. If `API_KEY_SECRET` is unset and was falling back to this value, also re-hash or re-issue API keys. |
| `API_KEY_SECRET` | Forgeable panel/agent API keys | **Invalidates all existing API keys** (hashes no longer match). Re-issue keys after rotation. |
| `DATABASE_URL` (contains password) | Full database access | Change password and update. |
| `POSTGRES_PASSWORD` | Full database access | Change in Docker Compose. |
| `BACKUP_CREDENTIALS_ENCRYPTION_KEY` | Unencrypted backup credential access | **Backup credentials become unreadable.** Must rotate with credential re-encryption. |
| `NODE_API_KEY` | Unauthorized node control | Regenerate on the node. |
| `WHMCS_OIDC_CLIENT_SECRET` | OAuth impersonation | Rotate in WHMCS admin panel. |

### Minimum Production Checklist

1. ✅ `NODE_ENV=production`
2. ✅ `PUBLIC_URL` set to the real domain
3. ✅ `BETTER_AUTH_SECRET` set (not the example value)
4. ✅ `API_KEY_SECRET` set (or intentionally relying on `BETTER_AUTH_SECRET` fallback)
5. ✅ `DATABASE_URL` pointing to a secured PostgreSQL instance
6. ✅ `POSTGRES_PASSWORD` changed from default
7. ✅ `BACKUP_CREDENTIALS_ENCRYPTION_KEY` generated (if using backups)
8. ✅ `WEBHOOK_SECRET` set explicitly (not auto-generated)
9. ✅ `PASSKEY_RP_ID` matching your domain
10. ✅ `SUSPENSION_ENFORCED=true`
11. ✅ `AUTO_UPDATE_ENABLED=true` with `AUTO_UPDATE_AUTO_TRIGGER=false` (review before updating)

---

## Troubleshooting Common Config Issues

### "Cannot connect to database"

| Symptom | Cause | Fix |
|---------|-------|-----|
| Backend refuses to start | `DATABASE_URL` not set | Check backend `.env` or Docker Compose env injection |
| Connection refused | Wrong host/port in `DATABASE_URL` | Verify PostgreSQL is running and accessible |
| Authentication failed | Wrong password in `DATABASE_URL` | Check `POSTGRES_PASSWORD` matches the connection string |

### "WebSocket connection failed" (agent)

| Symptom | Cause | Fix |
|---------|-------|-----|
| Agent can't connect | `BACKEND_URL` wrong or `ws://` in production | Set `BACKEND_URL=wss://panel.example.com:3000/ws` |
| Insecure connection blocked | `ws://` to a public host | Use a private LAN / loopback IP, switch to `wss://`, or set `CATALYST_ALLOW_INSECURE_WS=1` for public hosts only |

### "Passkey authentication fails"

| Symptom | Cause | Fix |
|---------|-------|-----|
| Passkeys don't register | `PASSKEY_RP_ID` doesn't match domain | Set `PASSKEY_RP_ID` to the hostname of `PUBLIC_URL` |
| CORS blocks auth callback | `CORS_ORIGIN` misconfigured | Ensure `CORS_ORIGIN` includes the frontend origin |

### "Backups fail to upload to S3"

| Symptom | Cause | Fix |
|---------|-------|-----|
| Bucket not found | `BACKUP_S3_BUCKET` missing | Set the variable to your bucket name |
| Access denied | Missing/incorrect S3 keys | Verify `BACKUP_S3_ACCESS_KEY` and `BACKUP_S3_SECRET_KEY` |
| MinIO incompatibility | Path-style URLs needed | Set `BACKUP_S3_PATH_STYLE=true` |
| Credentials can't be encrypted | `BACKUP_CREDENTIALS_ENCRYPTION_KEY` missing | Generate a 32-byte key and set the variable |

### "SFTP connection refused"

| Symptom | Cause | Fix |
|---------|-------|-----|
| Can't connect to SFTP | Agent down or SFTP disabled for the node | Check `systemctl status catalyst-agent` on the node; enable SFTP in Admin → Nodes |
| Port mismatch | Node SFTP port differs from client config | Use the host/port from the panel's SFTP Connection Info (default `2022`) |
| Node firewall blocks SFTP | SFTP port closed on the node | Open the node's SFTP port in its firewall |

> SFTP is hosted by the node agent — there is no `SFTP_PORT`/`SFTP_ENABLED` variable for the panel compose stack. (The agent itself honors `SFTP_ENABLED`, `SFTP_PORT`, and `SFTP_HOST_KEY`.)

### "Plugin hot-reload not working"

| Symptom | Cause | Fix |
|---------|-------|-----|
| Changes not reflected | `PLUGIN_HOT_RELOAD=false` | Set `PLUGIN_HOT_RELOAD=true` for development |
| Plugin not loading | `PLUGINS_DIR` doesn't contain plugin files | Verify the directory path and plugin structure |

### "Rate limited"

| Symptom | Cause | Fix |
|---------|-------|-----|
| API returns 429 | Rate limiting from `lib/rate-limits.ts` | Check rate limit configuration in admin settings; reduce request frequency |
| Auth rate limited | Too many login attempts | Account may be locked. Check `lockoutMaxAttempts` and `lockoutWindowMinutes` in admin settings |

### "Logs too verbose or not detailed enough"

| Symptom | Cause | Fix |
|---------|-------|-----|
| Too much noise | `LOG_LEVEL=trace` or `debug` | Set `LOG_LEVEL=info` for normal operation, `LOG_LEVEL=error` for minimal logging |
| Need more detail for debugging | `LOG_LEVEL=info` | Set `LOG_LEVEL=debug` temporarily for troubleshooting |

---

## Cross-References

- → [Installation](./installation.md) — Required variables during setup
- → [Docker Setup](./docker-setup.md) — Docker-specific environment injection
- → [Admin Guide](./admin-guide.md) — Settings that can be configured via the web UI instead
- → [Architecture](./architecture.md) — How these settings affect system design
- → [Troubleshooting](./troubleshooting.md) — Config-related error solutions
- → [API Reference](./api-reference.md) — Rate limit settings (`RATE_LIMIT_*`)

---

*Last updated: 2026-08-26*
