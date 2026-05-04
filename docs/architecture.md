# Architecture Overview

> A deep dive into Catalyst's system design, component responsibilities, data flows, security model, and technology stack rationale.

**Audience:** Technical stakeholders, new team members, auditors, and anyone evaluating the system's design decisions.

---

## Table of Contents

- [System Topology](#system-topology)
  - [Deployment Architecture](#deployment-architecture)
  - [Service Dependencies](#service-dependencies)
- [Component Responsibilities](#component-responsibilities)
  - [Frontend (React SPA)](#frontend-react-spa)
  - [Backend API Server](#backend-api-server)
  - [Agent (Rust)](#agent-rust)
  - [Shared Layer](#shared-layer)
- [Data Flows](#data-flows)
  - [User Request Flow](#user-request-flow)
  - [WebSocket Message Routing](#websocket-message-routing)
  - [Server Lifecycle Flow](#server-lifecycle-flow)
  - [Plugin Runtime Flow](#plugin-runtime-flow)
  - [Backup Flow](#backup-flow)
- [Authentication & Authorization](#authentication--authorization)
  - [Authentication Flow](#authentication-flow)
  - [Authorization Model](#authorization-model)
  - [API Key System](#api-key-system)
  - [Agent Authentication](#agent-authentication)
- [Database Schema](#database-schema)
  - [Entity Relationship Diagram](#entity-relationship-diagram)
  - [Key Relationships](#key-relationships)
- [Plugin Architecture](#plugin-architecture)
  - [Plugin System Components](#plugin-system-components)
  - [Backend Extension Points](#backend-extension-points)
  - [Frontend Extension Points](#frontend-extension-points)
  - [Worker Thread Isolation](#worker-thread-isolation)
- [Security Model](#security-model)
  - [Network Isolation](#network-isolation)
  - [SFTP Security](#sftp-security)
  - [Container Security](#container-security)
  - [Data Protection](#data-protection)
- [Scaling Considerations](#scaling-considerations)
  - [Horizontal Scaling](#horizontal-scaling)
  - [Vertical Scaling](#vertical-scaling)
  - [State Management](#state-management)
- [Technology Stack Rationale](#technology-stack-rationale)
  - [Backend — Fastify + TypeScript](#backend--fastify--typescript)
  - [Frontend — React 18 + Vite](#frontend--react-18--vite)
  - [Agent — Rust + Tokio](#agent--rust--tokio)
  - [Database — PostgreSQL + Prisma](#database--postgresql--prisma)
- [Observability](#observability)
  - [Logging](#logging)
  - [Error Reporting](#error-reporting)
  - [Retention Jobs](#retention-jobs)
- [Cross-References](#cross-references)
- [Identified Gaps](#identified-gaps)

---

## System Topology


Catalyst is a **three-tier architecture** consisting of a React frontend SPA, a TypeScript/Node.js backend API server, and a Rust agent deployed on each game server node.

### Deployment Architecture

```text
┌───────────────────────────────────────────────────────────────┐
│                       Client Browser                          │
│              (React SPA served by reverse proxy)               │
└───────────────────────────┬───────────────────────────────────┘
                            │ HTTPS (TLS terminated at proxy)
                            ▼
┌───────────────────────────────────────────────────────────────┐
│                   Reverse Proxy Layer                         │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐                   │
│   │   Nginx  │  │   Caddy  │  │ Traefik  │  (user-selected)  │
│   └──────────┘  └──────────┘  └──────────┘                   │
│         │             │              │                        │
│         └─────────────┴──────────────┘                        │
│                      │                                        │
│              ┌───────┴────────┐                               │
│              │  Catalyst API   │  :3000                       │
│              │  (Fastify)      │                               │
│              └───────┬────────┘                               │
│                      │                                         │
│   ┌──────────────────┴──────────────────┐                      │
│   │       WebSocket Gateway (/ws)       │                      │
│   └──────────────────┬──────────────────┘                      │
│                      │ wss://                                  │
│   ┌──────────────────┴──────────────────┐                      │
│   │         HTTP Tunnel (:2022)         │                      │
│   └─────────────────────────────────────┘                      │
└───────────────────────────────────────────────────────────────┘
                            │
┌───────────────────────────┼───────────────────────────────────────┐
│                 Node Agent (per node)                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐      │
│  │ container │  │   CNI    │  │ Firewall │  │ File System  │      │
│  │  d runtime│  │  Network │  │ Manager  │  │ (served by   │      │
│  │ (runc)    │  │  Driver  │  │          │  │ HTTP tunnel) │      │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────┘      │
└───────────────────────────────────────────────────────────────────┘
                            │
┌───────────────────────────┼───────────────────────────────────────┐
│                     Data Layer                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐        │
│  │  PostgreSQL  │    │    Redis     │    │    S3/MinIO  │        │
│  │  (primary DB)│    │  (optional)  │    │ (backups)    │        │
│  └──────────────┘    └──────────────┘    └──────────────┘        │
└───────────────────────────────────────────────────────────────────┘
```

### Service Dependencies

| Service | Dependency | Purpose |
|---------|------------|---------|
| Backend | PostgreSQL | Primary data store (users, servers, nodes, templates, etc.) |
| Backend | Redis (optional) | Cache and session store |
| Backend | Better Auth | Authentication (session management, OAuth) |
| Backend | Plugin SDK | Plugin runtime and extension system |
| Agent | containerd | Container orchestration on nodes |
| Agent | CNI | Network plugin interface for container networking |
| Agent | Node Agent API | Communication with backend (WebSocket + HTTP) |
| Frontend | Backend API | All server state and user data |

---

## Component Responsibilities

### Frontend (React SPA)

**Location:** `catalyst-frontend/`

**Key files:**

| File | Purpose |
|------|---------|
| `src/main.tsx` | React DOM entry point |
| `src/App.tsx` | Router, lazy-loaded pages, plugin provider, theme system |
| `src/components/` | Shared UI components (Radix UI primitives) |
| `src/pages/` | Route-based page components |
| `src/stores/` | Zustand client-state stores |
| `src/hooks/` | Custom React hooks (auth, setup status, theme) |
| `src/services/` | API client layer (TanStack Query integration) |
| `src/plugins/` | Plugin provider and slot system |

**Responsibilities:**

1. **User Interface Rendering**: Serves as the single-page application, handling all client-side routing via React Router DOM v7.
2. **State Management**: Uses TanStack Query for server state (automated caching, background refetching, optimistic updates) and Zustand for transient client state.
3. **Authentication UI**: Handles login, registration, 2FA, passkey setup, and profile management.
4. **Plugin Slot System**: Dynamically injects plugin-provided React components into designated slots (admin dashboard tabs, server detail tabs, user navigation).
5. **Theme System**: Applies panel branding (custom CSS, logo, color scheme) fetched from the backend's public theme settings endpoint.
6. **Error Reporting**: Captures frontend errors via the `reportSystemError` service and POSTs them to `/api/system-errors/report`.

**Notable patterns:**

- **Lazy-loaded code splitting**: All pages except auth-related ones are lazy-loaded via `React.lazy()` to minimize the initial bundle.
- **Protected routes**: The `ProtectedRoute` component wraps all app-level routes, enforcing authentication and permission checks.
- **Plugin routing**: Dynamic routes (`/:pluginRouteName`) are registered after all static routes to prevent conflicts.

### Backend API Server

**Location:** `catalyst-backend/`

**Key files:**

| File | Purpose |
|------|---------|
| `src/index.ts` | Fastify bootstrap, middleware, route registration, service initialization |
| `src/auth.ts` | Better Auth configuration (Prisma adapter, plugins) |
| `src/routes/*.ts` | 20+ route modules for all API endpoints |
| `src/services/` | Business logic services (tasks, webhooks, alerts, backup, SFTP, etc.) |
| `src/lib/` | Core libraries (permissions, validation, IPAM, caching, agent auth) |
| `src/middleware/` | RBAC middleware, custom serializers |
| `src/websocket/` | WebSocket gateway for agent communication |
| `src/sftp-server.ts` | SSH2-based SFTP server implementation |
| `src/plugins/` | Plugin loader, worker thread management, extension resolution |

**Responsibilities:**

1. **REST API Gateway**: Serves all `/api/*` endpoints for frontend and third-party integrations.
2. **WebSocket Gateway**: Manages bidirectional real-time communication with agents on game server nodes.
3. **SFTP Server**: Provides JWT-authenticated SFTP access for server file management.
4. **Authentication Hub**: Integrates Better Auth for session-based auth, API keys, and OAuth/OIDC providers.
5. **Plugin Host**: Loads, isolates, and communicates with plugin Worker Threads.
6. **Task Scheduler**: Cron-based scheduled task execution (backups, restarts, commands).
7. **Alert Service**: Monitors server health and triggers notifications.
8. **Webhook Dispatcher**: Sends outbound HTTP notifications for events.

**Boot sequence (from `index.ts`):**

```text
1. Create Fastify instance with security plugins (helmet, cors, rate-limit, compress)
2. Register Swagger/Swagger UI for API docs at /docs
3. Register WebSocket gateway at /ws
4. Register health check at /health
5. Register auth routes at /api/auth
6. Register 20+ route modules
7. Initialize plugin loader and auto-enable enabled plugins
8. Bootstrap OIDC config from database (falls back to env vars)
9. Initialize Better Auth
10. Start server on configured port
11. Start SFTP server (if enabled)
12. Start task scheduler
13. Start alert service
14. Start auto-updater (if enabled)
15. Schedule retention jobs (audit, stat, backup, log, metrics, auth)
```

### Agent (Rust)

**Location:** `catalyst-agent/`

**Key files:**

| File | Purpose |
|------|---------|
| `src/main.rs` | Application state, lifecycle management, signal handling |
| `src/config.rs` | Configuration loading (TOML file → env vars) |
| `src/runtime_manager.rs` | containerd gRPC client for container lifecycle |
| `src/websocket_handler.rs` | WebSocket connection to backend, message routing |
| `src/file_manager.rs` | Server filesystem operations (read, write, list, delete) |
| `src/file_tunnel.rs` | HTTP-based file transfer client to backend |
| `src/network_manager.rs` | CNI IPAM, container networking |
| `src/firewall_manager.rs` | iptables/nftables rule management |
| `src/storage_manager.rs` | Disk space tracking and quota enforcement |
| `src/system_setup.rs` | System-level dependency checks and initialization |
| `src/updater.rs` | Self-update mechanism |

**Responsibilities:**

1. **Container Orchestration**: Uses containerd's gRPC API to manage game server containers (create, start, stop, delete, exec).
2. **WebSocket Listener**: Maintains a persistent WebSocket connection to the backend for receiving commands (console input, power operations, backup requests, file operations).
3. **Health Monitoring**: Sends periodic health reports and per-server resource stats (CPU, memory, disk, network) to the backend every 5 seconds.
4. **Network Management**: Configures CNI networks, manages IPAM allocations, and ensures proper network isolation for containers.
5. **Firewall Management**: Manages iptables rules for per-server network isolation and port forwarding.
6. **File Operations**: Provides filesystem access for server files, served via the backend's file tunnel.
7. **Storage Management**: Monitors disk usage and enforces per-server disk quotas.
8. **Self-Updates**: Can fetch and apply new agent binary versions from the backend.

**Internal architecture:**

```text
CatalystAgent
├── config: AgentConfig (from TOML or env)
├── runtime: ContainerdRuntime (gRPC client)
├── ws_handler: WebSocketHandler (→ backend WS)
├── file_manager: FileManager (→ disk)
├── file_tunnel: FileTunnelClient (→ backend HTTP)
├── storage_manager: StorageManager (→ disk quotas)
└── backend_connected: RwLock<bool> (connection state)
```

**Concurrent tasks (each `run()` spawns):**

1. **WebSocket connection** — reconnects on disconnect, handles command routing
2. **Health monitoring** — 5-second interval heartbeat to backend
3. **File tunnel server** — HTTP endpoint for backend to fetch server files

### Shared Layer

**Location:** `catalyst-shared/`

**Responsibilities:**

- Exports TypeScript interfaces used by both frontend and backend.
- No runtime code — types-only package shared via Bun workspaces.

---

## Data Flows

### User Request Flow

```text
Browser                    Frontend                      Backend
  │                            │                               │
  │  GET /api/servers          │                               │
  │ ──────────────────────────>│                               │
  │                            │  TanStack Query cache hit?    │
  │                            │  ── No ──> GET /api/servers  │
  │                            │  ── Yes ──> Return cached    │
  │                            │                               │
  │                            │                       ┌───────┴───────┐
  │                            │                       │  Authenticate  │
  │                            │                       │  (session/api) │
  │                            │                       └───────┬───────┘
  │                            │                               │
  │                            │                       ┌───────┴───────┐
  │                            │                       │     Prisma    │
  │                            │                       │   PostgreSQL  │
  │                            │                       └───────┬───────┘
  │                            │                               │
  │  JSON response             │                               │
  │ <──────────────────────────│                               │
  │                            │                               │
  │  Update Zustand store      │                               │
  │  Re-render server list     │                               │
  ```

### WebSocket Message Routing

The WebSocket gateway (`/ws`) is the central nervous system connecting the backend to all agents.

```text
Agent Node A          WebSocket Gateway          Backend Services
     │                       │                         │
     │  connect + auth       │                         │
     │ ─────────────────────>│                         │
     │                       │  Store session map      │
     │  <ack>                │                         │
     │                       │                         │
     │  send_console(cmd)    │                         │
     │ ─────────────────────>│                         │
     │                       │  Route to server 123    │
     │                       │  → TaskScheduler        │
     │                       │                         │
     │  server_started       │                         │
     │ <─────────────────────│                         │
     │                       │  Broadcast SSE event    │
     │                       │  → sse-events.ts        │
     │                       │  → admin-events.ts      │
```

**Message types sent to agents:**

| Type | Payload | Purpose |
|------|---------|---------|
| `start_server` | Template, environment, resources | Start a game server container |
| `stop_server` | Server ID | Graceful stop |
| `restart_server` | Template, environment, resources | Restart with potentially new config |
| `console_input` | Server ID, command string | Send command to container console |
| `create_backup` | Server ID, environment, storage config | Create a backup snapshot |
| `delete_backup` | Server ID, backup ID | Remove a backup |
| `file_op` | Server ID, operation, path | Read/write/rename/delete files |

**Messages received from agents:**

| Type | Payload | Purpose |
|------|---------|---------|
| `health_report` | CPU, memory, disk, uptime | Node health check |
| `resource_stats` | Per-server CPU, memory, network, disk | Per-server resource usage |
| `console_output` | Server ID, text | Forward container stdout to clients |
| `server_status` | Server ID, status string | State change notification |

### Server Lifecycle Flow

```text
┌─────────────┐
│  Admin/DB   │  CREATE server record
│  (Prisma)   │  ── INSERT → servers table ─────────────────┐
└─────────────┘                                            │
                                                          │
┌─────────────┐    Start Server    ┌──────────────┐       │
│   Frontend  │ ──────────────────>│  Backend API  │       │
│             │                    │  /api/servers  │       │
└─────────────┘                    │                │       │
                                   │ 1. Validate    │       │
                                   │ 2. Check perms │       │
                                   │ 3. Create req  │       │
                                   │    task record │       │
                                   │                │       │
                                   │ 4. WS → Agent  │       │
                                   │    { type: "start_server", ... } │
                                   └───────┬────────┘       │
                                           │                │
                                   ┌───────┴────────┐       │
                                   │    Agent Node    │       │
                                   │                  │       │
                                   │  1. Receive WS   │       │
                                   │  2. containerd   │       │
                                   │     create       │       │
                                   │  3. containerd   │       │
                                   │     start        │       │
                                   │  4. Monitor      │       │
                                   │     console      │       │
                                   │  5. WS → Backend │       │
                                   │     "running"    │       │
                                   └────────┬─────────┘       │
                                            │                 │
                                   ┌────────┴─────────┐       │
                                   │  SSE Stream to    │       │
                                   │  Frontend clients │◄──────┘
                                   └──────────────────┘
```

### Plugin Runtime Flow

```text
┌─────────────────────────────────────────────────────┐
│                   Backend Process                     │
│                                                     │
│  ┌─────────────────────────────────────┐            │
│  │         Main Thread                  │            │
│  │  (Fastify + all services)            │            │
│  └──────────┬──────────────────────────┘            │
│             │                                       │
│             │  Load plugin via                      │
│             │  worker_threads                       │
│             ▼                                       │
│  ┌─────────────────────┐  ┌──────────────────────┐  │
│  │  Plugin Worker 1    │  │  Plugin Worker 2     │  │
│  │  (egg-explorer)     │  │  (ticketing)         │  │
│  │                     │  │                      │  │
│  │  ├─ Backend routes  │  │  ├─ Backend routes   │  │
│  │  ├─ WebSocket msg   │  │  ├─ WebSocket msg    │  │
│  │  └─ Prisma client   │  │  └─ Prisma client    │  │
│  └─────────────────────┘  └──────────────────────┘  │
│                                                     │
│  Frontend receives plugin metadata via              │
│  API and injects React components via               │
│  PluginProvider slot system                         │
└─────────────────────────────────────────────────────┘
```

**Extension points:**

| Type | Backend | Frontend |
|------|---------|----------|
| Routes | `app.register(pluginRoutes)` | N/A |
| WebSocket | Custom message handlers | N/A |
| UI Slots | N/A | Admin dashboard, server details, nav bar |
| Data | Prisma queries | TanStack Query hooks |

### Backup Flow

```text
┌──────────┐     ┌──────────────┐     ┌──────────┐     ┌──────────┐
│ Frontend │     │  Backend     │     │  Agent   │     │  Storage │
│          │     │              │     │          │     │          │
│ Click    │────>│ Create backup│     │          │     │          │
│ "Backup" │     │ endpoint     │     │          │     │          │
│          │     │              │     │          │     │          │
│          │     │ 1. Validate  │     │          │     │          │
│          │     │    request   │     │          │     │          │
│          │     │ 2. Store     │     │          │     │          │
│          │     │    backup    │     │          │     │          │
│          │     │    record    │     │          │     │          │
│          │     │              │     │          │     │          │
│          │     │ 3. WS→Agent  │     │          │     │          │
│          │     │    { type:   │     │          │     │          │
│          │     │      "create│     │          │     │          │
│          │     │       backup│     │          │     │          │
│          │     │       }     │     │          │     │          │
│          │     │              │     │          │     │          │
│          │     │              │────>│ Create    │     │          │
│          │     │              │     │ container  │     │          │
│          │     │              │     │ snapshot   │     │          │
│          │     │              │     │            │     │          │
│          │     │              │<────│ Return     │     │          │
│          │     │              │     │ status     │     │          │
│          │     │              │     │            │     │          │
│          │     │ 4. Upload to │     │          │     │          │
│          │     │    S3/local  │     │          │     │          │
│          │     │              │     │          │     │          │
│          │     │ 5. SSE emit  │     │          │     │          │
│          │     │    complete  │     │          │     │          │
│          │     │              │     │          │     │          │
│          │<────│ Backup       │     │          │     │          │
│          │     │    complete  │     │          │     │          │
│          │     └──────────────┘     │          │     │          │
└──────────┘                          └──────────┘     └──────────┘
```

---

## Authentication & Authorization

### Authentication Flow

Catalyst uses **Better Auth v1.6.9** with the Prisma adapter as its primary authentication system.

**Supported methods:**

| Method | Description | Configuration |
|--------|-------------|---------------|
| Email/Password | Standard username + password login | Built-in |
| Email Verification | Required on registration | Built-in |
| Password Reset | Email-based reset flow via SMTP | Built-in |
| Two-Factor Auth (TOTP) | Time-based one-time passwords | Better Auth TOTP plugin |
| Passkeys (WebAuthn) | Passwordless authentication | Better Auth passkey plugin |
| OAuth/OIDC | External identity providers | Configurable via admin UI |
| API Keys | Machine-to-machine auth | Custom implementation |

**Session flow:**

```text
Client                          Backend                          Database
  │                                │                               │
  │ POST /api/auth/login           │                               │
  │ { email, password }            │                               │
  │ ──────────────────────────────>│                               │
  │                                │  Verify credentials           │
  │                                │  ──> Prisma adapter          │
  │                                │  ──> Check bcrypt hash       │
  │                                │                               │
  │  Set-Cookie: best-auth.session │                               │
  │  (httpOnly, secure, sameSite)  │                               │
  │ <──────────────────────────────│                               │
  │                                │                               │
  │ Subsequent requests:           │                               │
  │ Cookie header ────────────────>│                               │
  │                                │  Parse cookie                  │
  │                                │  ──> Better Auth               │
  │                                │  ──> Resolve user + roles    │
  │                                │  ──> resolveUserPermissions() │
  │                                │                               │
  │  Session object                │                               │
  │  <─────────────────────────────│                               │
  │                                │                               │
  │  Attach to request.user        │                               │
  │  (userId, email, username,     │                               │
  │   permissions: string[])       │                               │
```

### Authorization Model

Catalyst uses a **Role-Based Access Control (RBAC)** system with **20+ granular permissions**.

**Permission categories:**

| Category | Permissions | Scope |
|----------|-------------|-------|
| User Management | `user.read`, `user.create`, `user.update`, `user.delete`, `user.set_roles` | Admin |
| Server Management | `server.read`, `server.create`, `server.update`, `server.delete`, `server.power.*`, `server.console.*`, `server.files.*`, `server.databases.*`, `server.backups.*`, `server.tasks.*`, `server.invites.*`, `server.sftp.*`, `server.plugins.*` | Server + Admin |
| Node Management | `node.read`, `node.create`, `node.update`, `node.delete`, `node.allocations.*` | Admin |
| Template Management | `template.read`, `template.create`, `template.update`, `template.delete` | Admin |
| Role Management | `role.read`, `role.create`, `role.update`, `role.delete` | Admin |
| System | `admin.read`, `admin.write`, `system.read`, `system.update` | Admin |
| Monitoring | `metrics.read` | User + Admin |
| Alerts | `alert.read`, `alert.create`, `alert.update`, `alert.delete` | Admin |
| API Keys | `apikey.manage` | Admin |
| Wildcard | `*` | Super-admin |

**Permission resolution flow:**

```text
Request arrives with userId
         │
         ▼
  Load user → Role → Permissions chain
         │              │
         │              ▼
         │       Lookup role permissions
         │
         ▼
  resolveUserPermissions(userId):
    1. Fetch user roles from DB
    2. For each role, fetch permission set
    3. Union all permissions into a flat string[]
    4. Cache result (optional, via Redis)
    5. Attach to request.user.permissions
```

The `RbacMiddleware` (applied per-route) checks the `permissions` array against the route's `config.permissions` array.

### API Key System

API keys provide machine-to-machine authentication. They are **not** part of Better Auth.

**Structure:**

```text
catalyst_<random-prefix>_<hashed-key>
│        │                  │
│        │                  └─ SHA-256 hash of the actual key (stored in DB)
│        └─ Prefix (optional, configurable)
└─ "catalyst" prefix (hardcoded)
```

**Lifecycle:**

```text
Admin creates key (POST /api/api-keys)
         │
         ▼
  Generate random prefix + secret
         │
         ▼
  Hash secret with SHA-256
         │
         ▼
  Store in DB: {
    key: "catalyst_xyz...<hash>",
    permissions: [...],  // specific scope or ["*"]
    allPermissions: boolean,
    userId: "...",
    createdAt: "...",
    expiresAt: "..."  // optional
  }
         │
         ▼
  Return the **raw** key to admin (never stored in plaintext)
```

**Verification flow:**

```text
Request: Authorization: Bearer catalyst_xyz...
         │
         ▼
  Verify prefix === "catalyst"
         │
         ▼
  Query DB for key (partial match on prefix)
         │
         ▼
  Compare stored hash vs request key
         │
         ▼
  Load user + resolve permissions
         │
         ▼
  Attach to request.user
```

**Security notes:**

- Keys are never logged or stored in plaintext.
- Scopes are enforced at route level (same as session-based permissions).
- Keys can be revoked independently of user deletion.
- Rate-limit bypass is granted to agent-api-key endpoints to prevent rate-limit abuse if a key is compromised.

### Agent Authentication

Agent nodes authenticate to the backend using **node-specific credentials** stored in the `nodes` table.

**Authentication methods (in order of preference):**

| Method | Header / Param | Notes |
|--------|----------------|-------|
| Node ID + Token | `X-Catalyst-Node-Id` + `X-Catalyst-Node-Token` | Primary method |
| Node ID + API Key | `X-Catalyst-Node-Id` + `X-Node-Api-Key` | Alternative |
| Query params | `?nodeId=...&token=...` | For deployment scripts |

**Verification flow:**

```text
Request with X-Catalyst-Node-Id + X-Catalyst-Node-Token
         │
         ▼
  verifyAgentApiKey(prisma, nodeId, token):
    1. Query nodes table for nodeId
    2. Compare stored API key hash with request token
    3. Return { valid: true, node: Node }
```

**Deployment token flow (one-time use):**

```text
Admin creates DeploymentToken (POST /api/admin/nodes)
         │
         ▼
  Generate random token string, set expiration
         │
         ▼
  Generate deploy script via generateDeploymentScript():
    #!/usr/bin/env bash
    BACKEND_HTTP_URL=https://panel.example.com
    NODE_ID=abc123
    NODE_API_KEY=secret456
    NODE_HOSTNAME=node1.example.com
    curl -fsSL "$BACKEND_HTTP_URL/api/agent/deploy-script" | bash
```

---

## Database Schema

### Entity Relationship Diagram

```text
┌──────────┐       1:N       ┌─────────┐       N:1       ┌──────────┐
│   User   │◄────────────────│  Server │────────────────►│   Node   │
│──────────│                 │─────────│                 │──────────│
│ id       │                 │ id      │                 │ id       │
│ email    │                 │ ownerId │◄────────────────│ ownerId  │
│ username │                 │ nodeId  │                 │ hostname │
│ roles [] │                 │ state   │                 │ publicAddress │
└──────────┘                 │ templateId│                └──────────┘
                             │ resource limits│
                             └──────┬─────────┘
                                    │ 1:N
                          ┌─────────┴─────────┐
                          │                   │
                     ┌────▼────┐        ┌────▼────┐
                     │ Backup  │        │  Task   │
                     │─────────│        │─────────│
                     │ id      │        │ id      │
                     │ serverId│        │ serverId│
                     │ status  │        │ action  │
                     └─────────┘        └─────────┘

┌──────────┐       1:N       ┌──────────┐       N:1       ┌──────────┐
│  Nest    │◄────────────────│ Template │────────────────►│ Location │
│──────────│                 │─────────│                 │──────────│
│ id       │                 │ nestId  │                 │ id       │
│ name     │                 │ name    │                 │ name     │
└──────────┘                 └─────────┘                 └──────────┘

┌──────────┐       1:N       ┌─────────┐       N:1       ┌──────────┐
│   Role   │◄────────────────│  Server │                 │ Template │
│──────────│                 │─────────│                 │──────────│
│ id       │                 │ id      │                 │ nestId   │
│ name     │                 │ templateId│                │ name     │
│ perms [] │                 │ server  │                 │ config   │
└──────────┘                 └─────────┘                 └──────────┘

┌──────────┐       1:1       ┌─────────┐       1:N       ┌──────────┐
│ ThemeSet │               │  Server │◄────────────────│  File    │
│ ttings   │                 │─────────│                 │──────────│
│ id       │                 │ server  │                 │ id       │
│ name     │                 │ disk    │                 │ serverId │
│ colors   │                 │ memory  │                 │ path     │
└──────────┘                 └─────────┘                 └──────────┘

┌──────────┐       1:N       ┌──────────┐       N:1       ┌──────────┐
│  Alert   │◄────────────────│ AlertRule │                 │  Server  │
│ Rule     │                 │─────────│                 │──────────│
│ id       │                 │ serverId│                 │ server   │
│ name     │                 │ type    │                 │ id       │
│ condition│                 │ enabled │                 │ alert    │
└──────────┘                 └──────────┘                 └──────────┘

┌──────────┐       N:1       ┌──────────┐
│ ApiKey   │────────────────►│   User   │
│──────────│                 │──────────│
│ id       │                 │ id       │
│ key      │                 │ email    │
│ hashed   │                 │ username │
│ perms [] │                 └──────────┘
│ userId   │
└──────────┘
```

### Key Relationships

| Relationship | Cardinality | Notes |
|--------------|-------------|-------|
| User → Server | 1:N | A user can own multiple servers |
| Server → Node | N:1 | A server runs on exactly one node |
| Server → Template | N:1 | A server uses exactly one template |
| Template → Nest | N:1 | Templates are grouped into nests |
| Server → Backup | 1:N | Multiple backups per server |
| Server → Task | 1:N | Scheduled tasks per server |
| Role → Server | 1:N | Roles can be assigned to servers |
| User → ApiKey | 1:N | Multiple API keys per user |
| Server → AlertRule | 1:N | Alert rules per server |
| DatabaseHost → ServerDatabase | 1:N | MySQL provisioning |
| Server → ServerDatabase | 1:N | Per-server MySQL databases |

---

## Plugin Architecture

### Plugin System Components

```text
┌─────────────────────────────────────────────────────────────┐
│                  Plugin System Components                    │
│                                                             │
│  ┌─────────────┐     ┌─────────────┐     ┌──────────────┐  │
│  │  Plugin SDK  │     │ Plugin CLI  │     │ Plugin Loader│  │
│  │ (types-only) │     │ (scaffold)  │     │ (runtime)    │  │
│  └─────────────┘     └─────────────┘     └──────────────┘  │
│         │                                          │         │
│         │  Install via NPM                         │         │
│         │                                          │         │
│  ┌──────▼────────────────────────────────────────┐  │
│  │          Plugin Worker Threads                │  │
│  │  ┌─────────────┐    ┌──────────────────────┐  │  │
│  │  │ Plugin 1:   │    │ Plugin 2:            │  │  │
│  │  │ egg-explorer│    │ ticketing-plugin     │  │  │
│  │  │             │    │                      │  │  │
│  │  │ - Routes    │    │ - Routes             │  │  │
│  │  │ - WebSocket │    │ - WebSocket          │  │  │
│  │  │ - Prisma    │    │ - Prisma             │  │  │
│  │  └─────────────┘    └──────────────────────┘  │  │
│  └───────────────────────────────────────────────┘  │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         Frontend Plugin Provider                     │  │
│  │  ┌────────────────────────────────────────────────┐  │  │
│  │  │ PluginRoutePage (dynamic routes)               │  │  │
│  │  │ Admin plugin tabs                              │  │  │
│  │  │ Server detail plugin tabs                      │  │  │
│  │  └────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Backend Extension Points

Plugins can extend the backend via the Plugin SDK:

| Extension Point | Description |
|-----------------|-------------|
| `routes` | Register additional Fastify routes |
| `websocket` | Handle custom WebSocket message types |
| `prisma` | Use the shared Prisma client |
| `hooks` | Register lifecycle hooks (before/after route handlers) |

### Frontend Extension Points

Plugins can register React components into predefined slots:

| Slot | Location | Example |
|------|----------|---------|
| `admin-dashboard` | Admin dashboard sidebar | Plugin list widget |
| `server-details` | Server details page | Console tab, monitoring tab |
| `user-navigation` | User navigation bar | Plugin menu item |
| `admin-navigation` | Admin navigation bar | Plugin admin section |
| `custom-routes` | Dynamic route registration | `/ticketing-plugin`, `/egg-explorer` |

### Worker Thread Isolation

Plugins run in **isolated Node.js Worker Threads**, which provide:

- **Memory isolation**: Each plugin has its own heap; no shared memory.
- **Exception isolation**: A plugin crash does not affect the main thread.
- **Independent lifecycle**: Each plugin can be started, stopped, and restarted independently.
- **Hot reload**: Plugins can be reloaded without restarting the main server (controlled by `PLUGIN_HOT_RELOAD` env var).

**Thread communication:**

```text
Main Thread (Fastify)          Worker Thread (Plugin)
         │                              │
         │  require(pluginModule)       │
         │ ──────────────────────────>  │
         │                              │  Plugin exports:
         │                              │  - routes: Fastify plugin
         │                              │  - wsHandlers: message handlers
         │                              │  - frontendComponents: React components
         │                              │
         │  app.register(plugin.routes) │
         │ <──────────────────────────  │
         │                              │
         │  ws.send({type, payload})    │
         │ ──────────────────────────>  │  plugin.wsHandlers
         │                              │
         │  <ws.receive({type, data})   │
         │ <──────────────────────────  │
```

---

## Security Model

### Network Isolation

Catalyst enforces **per-server network isolation** using CNI (Container Network Interface) plugins and iptables rules:

**Isolation strategy:**

```text
Node Network
    │
    ├── Node Agent (trusted, internal)
    │
    ├── Game Server Container A
    │    ├── Isolated CNI network
    │    ├── Only exposed ports: primaryPort + portBindings
    │    └── iptables: DROP all other inbound traffic
    │
    └── Game Server Container B
         ├── Isolated CNI network
         ├── Only exposed ports: primaryPort + portBindings
         └── iptables: DROP all other inbound traffic
```

**Network modes:**

| Mode | Configuration | Use Case |
|------|---------------|----------|
| `bridge` (default) | CNI-managed bridge network | Standard container networking |
| `host` | Host network namespace | Maximum performance, no isolation |
| `none` | No network | Isolated server (no inbound/outbound) |

**IPAM (IP Address Management):**

- Each server gets a dedicated IP from an IP pool defined in the location.
- The `ipam.ts` module manages allocation/deallocation and prevents IP conflicts.
- The `network-isolation.ts` module generates iptables rules per-server.

### SFTP Security

SFTP access is **JWT-authenticated** and **session-scoped**:

```text
User requests SFTP connection
         │
         ▼
  Backend generates JWT token (user + server + TTL)
         │
         ▼
  Token stored in-memory (SFTP_TTL_OPTIONS: 5min, 15min, 1hr, 24hr)
         │
         ▼
  SFTP server validates JWT on connection
         │
         ▼
  User connects with:
    host: panel.example.com
    port: 2022
    user: {userId}
    password: {jwtToken}
```

**Security features:**

- Tokens expire automatically based on TTL.
- Tokens can be individually revoked or all revoked at once by the server owner.
- Token rotation is supported (generate new token without closing existing session).
- The SSH2 SFTP server runs on a dedicated port (`SFTP_PORT`, default `2022`).

### Container Security

**Principles:**

1. **No root in containers**: Game servers run as non-root users defined in the template.
2. **Resource limits**: CPU and memory limits enforced by containerd and/or cgroups.
3. **Disk quotas**: Per-server disk limits tracked by `StorageManager`.
4. **File path validation**: The `path-validation.ts` module prevents path traversal attacks (e.g., `../../etc/passwd`).
5. **Host-key for SFTP**: The SFTP server uses a dedicated host key (`SFTP_HOST_KEY`), not the host's SSH keys.

**Firewall rules:**

The agent's `FirewallManager` maintains persistent iptables rules:

```bash
# Per-server isolation (example for server A, IP 172.18.0.2)
iptables -I FORWARD -s 172.18.0.2 -d 172.18.0.3 -j DROP  # No inter-server communication
iptables -A FORWARD -s 172.18.0.2 -p tcp --dport 25565 -j ACCEPT  # Game port
iptables -A FORWARD -s 172.18.0.2 -p udp --dport 25565 -j ACCEPT
```text

### Data Protection

| Category | Mechanism |
|----------|-----------|
| Database | PostgreSQL with SSL/TLS (via `DATABASE_URL`) |
| Auth secrets | `BETTER_AUTH_SECRET` (environment variable, never stored in DB) |
| S3 backup credentials | Encrypted at rest using `BACKUP_CREDENTIALS_ENCRYPTION_KEY` |
| Passwords | bcrypt hashing (via Better Auth) |
| Session cookies | `httpOnly`, `secure`, `sameSite=strict` |
| SFTP tokens | JWT signed with `BETTER_AUTH_SECRET` |
| API keys | SHA-256 hashed (never stored in plaintext) |
| Audit logs | Captured for all admin actions |
| System errors | Captured with stack traces, user context, and metadata |

---

## Scaling Considerations

### Horizontal Scaling

**Backend scalability:**

| Approach | Supported? | Notes |
|----------|------------|-------|
| Multiple backend instances | ⚠️ Partial | Shared secrets and in-memory state (SFTP tokens, session cache) limit multi-instance deployments. Redis is optional and not fully utilized for session storage yet. |
| Worker threads | ✅ Yes | The backend supports `WORKERS` env var for Cluster API multi-process mode. |
| Reverse proxy | ✅ Yes | Nginx, Caddy, Traefik all supported as load balancers. |

**Node scalability:**

| Approach | Supported? | Notes |
|----------|------------|-------|
| Multiple nodes | ✅ Yes | Each node is independent; the backend manages multiple agents. |
| Geographic distribution | ✅ Yes | Nodes are assigned to Locations; the agent connects via WebSocket. |
| Server density per node | ✅ Yes | Resource limits per server prevent resource contention. |

### Vertical Scaling

| Component | Scaling Strategy |
|-----------|-----------------|
| Backend | Increase RAM/CPU, optimize Prisma connection pool (`DB_POOL_MAX`), add Redis |
| Database | PostgreSQL read replicas (not yet implemented) |
| Agent | Increase CPU for more concurrent container operations |
| Frontend | Static assets served via CDN; SPA is stateless |

### State Management

| State Type | Storage | Persistence |
|------------|---------|-------------|
| User sessions | Better Auth (browser cookies) | Database (Prisma) |
| WebSocket connections | In-memory session map | Ephemeral (reconnect on disconnect) |
| SFTP tokens | In-memory Map | Ephemeral (expire/rotate) |
| Server state | PostgreSQL | Persistent |
| Plugin state | In-memory (Worker Threads) | Ephemeral (reloaded on restart) |
| Audit logs | PostgreSQL | Persistent (retention configurable) |
| Metrics/statistics | PostgreSQL | Persistent (retention configurable) |

---

## Technology Stack Rationale

### Backend — Fastify + TypeScript

**Why Fastify:**

- **Performance**: One of the fastest Node.js frameworks (high request throughput, low overhead).
- **Schema-based validation**: Native Zod integration for request/response validation.
- **Plugin ecosystem**: Modular route registration, easy to extend.
- **WebSocket support**: `@fastify/websocket` provides clean WebSocket handling.
- **Type safety**: First-class TypeScript support with strict types.

**Alternatives considered:**

| Alternative | Reason not chosen |
|-------------|-------------------|
| Express | Simpler but less performant; no built-in Zod integration |
| NestJS | Heavier, more opinionated; overkill for a REST API with WebSocket |
| Hapi | Stale ecosystem; smaller community |

### Frontend — React 18 + Vite

**Why React 18 + Vite:**

- **Component model**: Declarative UI with composable components.
- **Code splitting**: Vite's native ESM support + lazy loading reduces bundle size.
- **TanStack Query**: Excellent server state management with automatic caching and invalidation.
- **Radix UI**: Headless UI primitives for accessibility and customization.
- **Tailwind CSS v4**: Utility-first styling with fast compilation.

**Alternatives considered:**

| Alternative | Reason not chosen |
|-------------|-------------------|
| Angular | Heavier, more opinionated; larger bundle |
| Vue | Smaller ecosystem for admin dashboards; fewer UI component libraries |
| SolidJS | Smaller ecosystem; fewer third-party integrations |

### Agent — Rust + Tokio

**Why Rust:**

- **Safety**: Memory safety without GC pauses; no heap corruption from plugins or containers.
- **Performance**: Near-C speeds for container orchestration and file I/O.
- **Async runtime**: Tokio provides high-performance async/await for WebSocket handling.
- **Compilation**: Static binary (`musl`) for maximum portability across Linux distributions.
- **Process isolation**: A Rust agent crash cannot corrupt the host system.

**Why not Node.js for the agent:**

| Concern | Rust | Node.js |
|---------|------|---------|
| Memory safety | ✅ Compile-time | ❌ Runtime (GC pauses, heap corruption) |
| Performance | ✅ Native speed | ⚠️ GC overhead under load |
| Binary distribution | ✅ Static musl binary | ❌ Requires Node.js runtime |
| Crash isolation | ✅ OS-level isolation | ⚠️ Can bring down host process |
| Containerd gRPC | ✅ Excellent (generated code) | ⚠️ Works but slower |

### Database — PostgreSQL + Prisma

**Why PostgreSQL:**

- **Relational integrity**: ACID compliance, foreign keys, constraints.
- **JSON support**: Flexible for storing template configurations and server variables.
- **Scalability**: Read replicas, partitioning, and connection pooling support growth.
- **Prisma ORM**: Type-safe queries, automatic migrations, excellent TypeScript integration.

**Alternatives considered:**

| Alternative | Reason not chosen |
|-------------|-------------------|
| MySQL | Less JSON support; weaker typing |
| SQLite | No concurrency; not suitable for multi-user panel |
| MongoDB | Schema-less (but we need schema); weaker relational queries |

---

## Observability

### Logging

**Backend logging (Pino):**

| Environment | Format | Level |
|-------------|--------|-------|
| Development | Pretty-printed, colorized | `debug` |
| Production | Structured JSON | `info` (configurable via `LOG_LEVEL`) |

**Agent logging (tracing + tracing-subscriber):**

| Format | Configuration |
|--------|---------------|
| Human-readable | `tracing_subscriber::fmt()` |
| JSON | `tracing_subscriber::fmt().json()` (set `logging.format: "json"` in config.toml) |

### Error Reporting

**Frontend error capture:**

```typescript
// In any component:
import { reportSystemError } from './services/api/systemErrors';

reportSystemError({
  level: 'error' | 'warn' | 'critical',
  component: 'ComponentName',
  message: 'Error description',
  stack: error.stack,
  metadata: { context: 'error_context' }
});
```

Errors are POSTed to `/api/system-errors/report` and stored in the `SystemError` table for admin review.

### Retention Jobs

Catalyst runs **six independent retention jobs** to manage data lifecycle:

| Job | Table | Configurable? |
|-----|-------|---------------|
| Audit retention | `AuditLog` | Yes (via admin settings) |
| Stat retention | `Stat` | Yes |
| Backup retention | `Backup` | Yes (via backup policy) |
| Log retention | `Log` | Yes |
| Metrics retention | `Metric` | Yes |
| Auth retention | `Session` (Better Auth) | Yes |

All retention jobs use randomized jitter (`0–60s`) to prevent synchronized database spikes.

---

## Cross-References

| Doc | Relevance |
|-----|-----------|
| [API Reference](./api-reference.md) | Complete endpoint documentation with request/response schemas |
| [Docker Setup](./docker-setup.md) | Deployment topology, service configurations, and health checks |
| [Agent](./agent.md) | Agent internals, containerd integration, and CNI networking |
| [Admin Guide](./admin-guide.md) | Operational management, alert configuration, and RBAC setup |
| [Environment Variables](./environment-variables.md) | Complete configuration reference for all 60+ variables |
| [Security](./SECURITY.md) | Security policy, vulnerability reporting, and threat model |
| [Troubleshooting](./troubleshooting.md) | Common errors and resolution steps |
| [Development](./development.md) | Build system, testing, and contribution guidelines |
| [Plugin System Analysis](./plugin-system-analysis.md) | Internal plugin system deep-dive (archival) |

---

## Identified Gaps

The following architecture aspects are **partially documented** or **under-specified**:

| Gap | Status | Notes |
|-----|--------|-------|
| WebSocket message flow diagram | 📝 Planned | Sequence diagram for all WS message types |
| Plugin runtime sequence diagram | 📝 Planned | Full lifecycle from load to unload |
| Database ER diagram (textual) | ✅ Included | See Section 5.1 |
| Performance benchmarks | 📋 Gap | No published baseline numbers |
| Multi-region / federation | ⚠️ Low priority | Not yet implemented |
| Redis session storage | ⚠️ Partial | Redis available but not used for sessions |
| Read replica support | ⚠️ Low priority | PostgreSQL supports it; Prisma supports it; not yet configured |

---

> **Last updated:** Auto-generated by documentation automation chain.
> **Maintainers:** Development team. Update this document when significant architectural changes are made.
> **Related:** [Development Guide](./development.md) · [Docker Setup](./docker-setup.md) · [Security Policy](./SECURITY.md)
