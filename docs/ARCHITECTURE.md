# Catalyst Architecture

High-level system architecture, design decisions, and data flow patterns.

## Table of Contents

- [System Overview](#system-overview)
- [Architecture Diagram](#architecture-diagram)
- [Component Breakdown](#component-breakdown)
- [Data Flow](#data-flow)
- [Key Design Decisions](#key-design-decisions)
- [Technology Choices](#technology-choices)
- [Scalability Considerations](#scalability-considerations)
- [Security Architecture](#security-architecture)

---

## System Overview

Catalyst is a three-tier monorepo application designed for managing containerized game servers at scale. The architecture emphasizes **real-time communication**, **stateless services**, and **clear separation of concerns**.

### Core Principles

1. **Backend owns all state** - Database is the source of truth
2. **Validate first, execute second** - Backend validates before sending to agents
3. **WebSocket as primary communication** - Real-time messaging for all events
4. **Container isolation via containerd** - Superior performance over Docker
5. **API-first design** - Complete automation via REST API

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Catalyst Platform                          │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────┐          WebSocket          ┌─────────────────┐
│   React 18     │ ◄──────────────────────►  │   Fastify       │
│   Frontend      │                            │   Backend       │
│   (Vite)       │                            │   (TypeScript)  │
│                 │   REST API / Websockets     │                 │
│  - Dashboard   │ ─────────────────────────► │  - API Routes  │
│  - Server Mgmt  │                            │  - WebSocket GW │
│  - File Mgmt   │                            │  - Auth/RBAC   │
│  - Console     │                            │  - Scheduler   │
└─────────────────┘                            └─────────────────┘
       │                                              │
       │ JWT Token                                    │ Database (PostgreSQL)
       │                                              │  - Users
       │                                              │  - Servers
       │                                              │  - Nodes
       │                                              │  - Metrics
       │                                              │  - Logs
       │                                              ▼
       │                                      ┌─────────────────┐
       │                                      │   PostgreSQL   │
       │                                      │   (Prisma ORM) │
       │                                      └─────────────────┘
       │
       ▼
┌─────────────────┐          WebSocket          ┌─────────────────┐
│   Rust 1.70    │ ◄──────────────────────►  │   Containerd   │
│   Agent        │                            │   (Nerdctl)    │
│   (Tokio)       │   Container Operations     │                 │
│                │ ─────────────────────────► │  - Containers  │
│  - WebSocket   │                            │  - Networks   │
│  - File Mgmt   │                            │  - Storage    │
│  - Metrics     │                            │                 │
│  - Runtime     │                            ▼                 │
└─────────────────┘                    ┌─────────────────┐
                                       │   Game         │
                                       │   Servers      │
                                       │   (Containers) │
                                       └─────────────────┘

External Integrations:
┌─────────────────┐  REST API  ┌─────────────────┐  SFTP Port 2022
│ Billing Panel   │ ──────────► │   Fastify       │ ◄─────────────┤
│ (WHMCS/Custom) │            │   Backend       │               │
└─────────────────┘            │                 │               │
┌─────────────────┐  Webhooks  │                 │               │
│ Discord/Slack   │ ◄─────────┤                 │               │
└─────────────────┘            └─────────────────┘               │
                                                                  │
                        Backup Storage (Optional)                   │
┌─────────────────┐                                              │
│   S3 / SFTP    │ ◄───────────────────────────────────────────────┤
│   Backup Store  │                                              │
└─────────────────┘                                              │
```

---

## Component Breakdown

### Frontend (React 18 + Vite)

**Purpose:** User interface and client-side logic

**Key Responsibilities:**
- Dashboard with real-time server status
- Server management (CRUD operations)
- File manager with SFTP integration
- Console terminal emulator
- Admin panel for system configuration
- WebSocket client for real-time updates

**Key Libraries:**
- **Vite** - Fast build tool and dev server
- **React Router v7** - Client-side routing
- **TanStack Query** - Server state management and caching
- **Zustand** - Global state (auth, WebSocket, UI)
- **Radix UI** - Accessible component primitives
- **Tailwind CSS** - Utility-first styling
- **Recharts** - Data visualization
- **Monaco Editor** - Code editor for files

**Architecture Pattern:**
- Component-based UI with hooks
- TanStack Query for API data (auto-caching, revalidation)
- Zustand for client state (auth, WebSocket connection)
- WebSocket subscription per server for real-time updates

---

### Backend (TypeScript + Fastify)

**Purpose:** API server, WebSocket gateway, business logic

**Key Responsibilities:**
- REST API with JWT authentication
- WebSocket gateway for real-time communication
- RBAC (Role-Based Access Control)
- Task scheduler (cron-based)
- SFTP server (port 2022)
- Plugin system for extensibility
- Audit logging
- Alert system with threshold monitoring

**Key Libraries:**
- **Fastify 5.7** - Fast, low-overhead web framework
- **Prisma ORM** - Type-safe database access
- **@fastify/websocket** - WebSocket support
- **better-auth** - Authentication with JWT
- **@fastify/helmet** - Security headers
- **@fastify/rate-limit** - Rate limiting
- **node-cron** - Task scheduling
- **ssh2** - SFTP server

**Architecture Pattern:**
- Route handlers → Middleware → Business Logic → Database
- WebSocket gateway manages agent and client connections
- State machine validates server transitions
- All state changes persist to DB before agent execution

**Directory Structure:**
```
src/
├── routes/          # API route handlers
├── middleware/      # Auth, RBAC, rate limiting
├── services/        # Business logic (state machine, scheduler)
├── websocket/       # WebSocket gateway
├── lib/            # Utilities (prisma, logging)
├── plugins/        # Plugin system
└── mod-manager/    # Mod management
```

---

### Agent (Rust + Tokio)

**Purpose:** Container lifecycle management and node operations

**Key Responsibilities:**
- Connect to backend via WebSocket
- Manage container lifecycle (create, start, stop, delete)
- File operations (read, write, upload, download)
- Resource monitoring (CPU, memory, disk)
- Health reporting (every 30 seconds)
- Auto-configure containerd/CNI on first run

**Key Libraries:**
- **Tokio** - Async runtime
- **tokio-tungstenite** - WebSocket client
- **containerd-client** - Container runtime
- **sysinfo** - System metrics
- **regex** - Path validation
- **serde** - Serialization

**Architecture Pattern:**
- Event-driven WebSocket message handler
- Tokio async runtime for concurrent operations
- Container operations via containerd API
- Path validation for security (defense in depth)

**Directory Structure:**
```
src/
├── main.rs          # Entry point
├── websocket_handler.rs  # WebSocket communication
├── runtime_manager.rs     # Container operations
├── file_manager.rs       # File operations
├── metrics.rs            # Resource monitoring
└── system_setup.rs      # Auto-configuration
```

---

### Database (PostgreSQL + Prisma)

**Purpose:** Persistent data storage and relationships

**Key Models:**
- **User** - Accounts with roles and permissions
- **Role** - RBAC roles with permission arrays
- **Node** - Physical/virtual machines
- **Server** - Individual game servers
- **ServerAccess** - Per-server user permissions
- **ServerLog** - Console and system logs
- **ServerMetrics** - Time-series resource data
- **Backup** - Server backups
- **ScheduledTask** - Cron-based tasks
- **Alert** - System alerts
- **AlertRule** - Alert conditions
- **AuditLog** - System audit trail
- **APIKey** - API keys for automation

**Design Patterns:**
- Indexes on foreign keys for fast joins
- Time-series data with timestamp indices
- Soft deletes for audit trail
- Unique constraints for data integrity

---

## Data Flow

### Server Start Flow

```
1. User clicks "Start" in frontend
   ↓
2. Frontend sends POST /api/servers/:id/start
   ↓
3. Backend validates:
   - JWT token authentication
   - server.start permission
   - Current state allows start (state machine)
   ↓
4. Backend persists state change to DB:
   server.status = 'starting'
   ↓
5. Backend sends WebSocket message to agent:
   { type: 'start_server', serverId, serverUuid, ... }
   ↓
6. Agent receives message
   ↓
7. Agent creates container via containerd
   ↓
8. Agent sends state update:
   { type: 'server_state_update', serverId, status: 'running' }
   ↓
9. Backend updates DB: server.status = 'running'
   ↓
10. Backend broadcasts to all subscribed clients
   ↓
11. Frontend receives update, updates UI
```

### Console Output Flow

```
1. Container generates console output
   ↓
2. Agent streams logs via containerd API
   ↓
3. Agent sends to backend WebSocket:
   { type: 'server_log', serverId, line: '...' }
   ↓
4. Backend:
   - Persists to ServerLog table (async)
   - Broadcasts to subscribed clients
   - Rate limits (max 200 lines/sec)
   ↓
5. Frontend receives WebSocket message
   ↓
6. Frontend appends to console terminal
   (Monaco editor or terminal emulator)
```

### File Upload Flow

```
1. User selects file in frontend
   ↓
2. Frontend sends POST /api/servers/:id/files/upload
   (multipart/form-data)
   ↓
3. Backend validates:
   - JWT token authentication
   - file.write permission
   - Path validation (no directory traversal)
   - File size limits
   ↓
4. Backend sends WebSocket message to agent:
   { type: 'write_file', serverId, path, content }
   ↓
5. Agent receives message
   ↓
6. Agent writes file to server directory
   ↓
7. Agent confirms success
   ↓
8. Backend responds to frontend
```

### Alert Trigger Flow

```
1. Backend scheduler runs (every 30 seconds)
   ↓
2. Agent sends health report:
   { type: 'health_report', cpu: 85%, memory: 90% }
   ↓
3. Backend stores metrics in ServerMetrics
   ↓
4. Backend evaluates alert rules:
   - Compare metrics to thresholds
   - Check alert duplication window
   ↓
5. If threshold exceeded:
   - Create Alert record
   - Send webhook notifications
   - Broadcast to subscribed admins
   ↓
6. Frontend shows alert notification
```

---

## Key Design Decisions

### 1. Backend Owns All State

**Decision:** Database is the source of truth for all state. Agent reports are informative but not authoritative.

**Rationale:**
- Prevents inconsistent state between backend and agents
- Enables audit trail for all changes
- Simplifies error recovery (backend can resync agents)
- Supports multiple agents per node (future)

**Implementation:**
- All state changes persist to DB first
- Backend validates transitions before agent execution
- Agent reports are checked against known state

### 2. WebSocket as Primary Communication

**Decision:** Use WebSocket for all real-time communication instead of gRPC.

**Rationale:**
- Simpler protocol (easier debugging)
- Native browser support (no gRPC-Web)
- Full-duplex (agents can push updates)
- Sufficient for current scale (100s of servers)
- Lower latency than HTTP polling

**Trade-offs:**
- No built-in protocol buffers (manual serialization)
- No built-in load balancing (future: Redis pub/sub)
- Requires custom message routing

### 3. Containerd Instead of Docker

**Decision:** Use containerd directly (via nerdctl) instead of Docker Engine.

**Rationale:**
- Better performance (lower overhead)
- More control over container lifecycle
- No Docker daemon dependency
- Smaller attack surface
- Better resource isolation

**Implementation:**
- Agent connects to containerd socket
- Uses containerd API for operations
- Nerdctl for compatibility layer

### 4. State Machine for Server Lifecycle

**Decision:** Explicit state machine validates all server state transitions.

**Rationale:**
- Prevents invalid operations (e.g., start already-running server)
- Clear documentation of allowed states
- Easier debugging of state issues
- Prevents race conditions

**States:**
- `stopped` → `installing` → `starting` → `running`
- `running` → `stopping` → `stopped`
- `crashed` (auto-restart logic)
- `suspended` (admin-enforced)
- `transferring` (node migration)
- `error` (unrecoverable)

### 5. RBAC with Granular Permissions

**Decision:** Role-based access control with 20+ granular permissions.

**Rationale:**
- Fine-grained access control for enterprise use
- Supports multi-tenant scenarios
- Audit trail for permission changes
- Future-proof for new features

**Permissions:**
- `server.create`, `server.read`, `server.start`, `server.stop`, etc.
- `file.read`, `file.write`, `file.delete`
- `console.read`, `console.write`
- `backup.create`, `backup.restore`
- `admin.read`, `admin.users`

### 6. API-First Design

**Decision:** Complete automation via REST API, UI is optional.

**Rationale:**
- Enables billing panel integrations (WHMCS, etc.)
- Supports custom automations and scripts
- Facilitates multi-tenant deployments
- Separates concerns (API vs UI)

**Implementation:**
- 60+ REST endpoints
- API key authentication
- Rate limiting per key
- Consistent error responses

---

## Technology Choices

### Why Fastify?

**Chosen for:**
- **Performance:** Faster than Express (~20-30%)
- **TypeScript:** Native TypeScript support
- **Plugins:** Extensible plugin system
- **Validation:** Built-in JSON schema validation
- **WebSocket:** Official WebSocket plugin

**Alternatives Considered:**
- Express (slower)
- NestJS (more opinionated)
- Koa (less mature WebSocket support)

### Why React?

**Chosen for:**
- **Ecosystem:** Largest component ecosystem
- **Performance:** Virtual DOM + React 18 optimizations
- **TypeScript:** Excellent TS support
- **Community:** Huge community and resources
- **State Management:** TanStack Query is excellent

**Alternatives Considered:**
- Vue.js (smaller ecosystem)
- Svelte (less mature)
- Angular (more opinionated)

### Why Rust for Agent?

**Chosen for:**
- **Performance:** Zero-cost abstractions, no GC
- **Memory Safety:** No memory leaks, buffer overflows
- **Concurrency:** Tokio async runtime is excellent
- **Binary Size:** Small, single binary distribution
- **System Integration:** Great for system-level operations

**Alternatives Considered:**
- Go (GC pauses, larger binaries)
- Node.js (single-threaded, memory hungry)
- Python (slow, GIL)

### Why PostgreSQL?

**Chosen for:**
- **Reliability:** ACID compliance, mature
- **Features:** JSON support, full-text search
- **Performance:** Excellent for complex queries
- **Type Safety:** Prisma ORM provides type safety
- **Scalability:** Proven at scale

**Alternatives Considered:**
- MySQL (less feature-rich)
- MongoDB (no ACID transactions)
- SQLite (not scalable)

### Why containerd?

**Chosen for:**
- **Performance:** Lower overhead than Docker
- **Control:** More control over container lifecycle
- **OCI Compliant:** Standard container format
- **No Daemon:** No Docker daemon dependency
- **Kubernetes:** Kubernetes uses containerd internally

**Alternatives Considered:**
- Docker (more overhead, daemon dependency)
- Podman (less mature)
- LXC (less standard)

---

## Scalability Considerations

### Current Limitations

- **Single Backend Instance:** No horizontal scaling yet
- **Single WebSocket Gateway:** No Redis pub/sub
- **Database:** Single PostgreSQL instance (no sharding)
- **File Storage:** Local on nodes (no shared storage)
- **Metrics:** No automatic cleanup

### Scaling Strategy (v2 Roadmap)

#### Horizontal Scaling

**Backend:**
- Add Redis for WebSocket pub/sub
- Add Redis for session storage
- Load balance API endpoints
- Sticky sessions for WebSocket

**Database:**
- Read replicas for queries
- Connection pooling (PgBouncer)
- Database sharding (future)

**File Storage:**
- S3-compatible storage for backups
- CDN for static assets
- Distributed file system for server data

#### Performance Optimization

**Caching:**
- Redis for frequently accessed data
- CDN for static assets
- Browser caching for API responses

**Database:**
- Query optimization
- Index tuning
- Partitioning for time-series data
- Connection pooling

**WebSocket:**
- Message batching
- Rate limiting per server
- Compression for large payloads

#### Metrics & Monitoring

**Observability:**
- Prometheus metrics export
- Grafana dashboards
- Distributed tracing (Jaeger/Zipkin)
- Log aggregation (ELK/Loki)

---

## Security Architecture

### Authentication

**JWT-Based Authentication:**
- Tokens issued after login
- Tokens signed with HS256 secret
- Token expiration: 24 hours
- Refresh tokens: Future enhancement

**API Keys:**
- Alternative to JWT for automation
- Rate limiting per key
- Optional expiration
- Instant revocation

### Authorization

**RBAC:**
- Users assigned to roles
- Roles have permission arrays
- Permissions: `resource.action` format
- Admin role: wildcard permissions (*)

**Server-Level Access:**
- `ServerAccess` table for per-server permissions
- Owner has full access
- Subusers have limited access

### Security Layers

**Network:**
- TLS for all HTTP/WebSocket in production
- CORS configuration
- Rate limiting per IP/user

**Application:**
- Helmet.js security headers
- Input validation (Zod schemas)
- Path validation (prevent directory traversal)
- SQL injection prevention (Prisma ORM)

**Data:**
- Password hashing (bcrypt)
- JWT signing secrets
- Encrypted backups (optional)
- Audit logging

**Container:**
- Namespaced containers (containerd)
- Resource limits (CPU, memory)
- Network isolation (macvlan)
- No privileged containers

### Audit Trail

**Logged Events:**
- Authentication (success, failure)
- Server actions (start, stop, delete)
- File operations (upload, download, delete)
- Admin actions (user management, config changes)
- API key usage

---

## Deployment Patterns

### Single-Instance (Development)

```
Frontend (localhost:5173)
   ↓ REST/WebSocket
Backend (localhost:3000)
   ↓
Database (localhost:5432)
   ↓
Agent (localhost)
   ↓
Containerd
```

### Production (Multiple Nodes)

```
┌─────────────┐
│  Frontend   │
│  (CDN)      │
└─────────────┘
       ↓
┌─────────────┐
│  Backend    │ (Load Balanced)
│  Cluster    │
└─────────────┘
       ↓
┌─────────────┐
│  PostgreSQL │ (Primary + Replicas)
└─────────────┘
       ↓
┌─────────────────────────────────────┐
│  Nodes (each running agent)       │
│  ┌─────────┐  ┌─────────┐      │
│  │ Agent 1 │  │ Agent 2 │ ... │
│  └─────────┘  └─────────┘      │
└─────────────────────────────────────┘
```

### Multi-Region (Future)

```
Region US-East          Region US-West
┌─────────────┐      ┌─────────────┐
│  Backend    │      │  Backend    │
│  Cluster    │ ◄──► │  Cluster    │
└─────────────┘      └─────────────┘
       ↓                    ↓
┌─────────────┐      ┌─────────────┐
│  PostgreSQL │      │  PostgreSQL │
│  Primary    │ ◄──► │  Replica    │
└─────────────┘      └─────────────┘
```

---

## Monitoring & Observability

### Metrics

**Server Metrics:**
- CPU usage percentage
- Memory usage (MB and %)
- Network I/O (bytes sent/received)
- Disk usage (server directory)
- Uptime

**Node Metrics:**
- Total CPU usage
- Total memory usage
- Disk usage
- Container count
- Network status

**Backend Metrics:**
- API request rate
- WebSocket connections
- Response times
- Error rates
- Database query times

### Logs

**Application Logs:**
- Structured logging (Pino)
- Log levels: debug, info, warn, error
- JSON format for parsing
- Log aggregation (future)

**Audit Logs:**
- Stored in AuditLog table
- Queryable by user, action, date
- Never deleted (compliance)

**Console Logs:**
- Stored in ServerLog table
- Ring buffer (last 1000 lines)
- Indexed by server and timestamp

---

## Conclusion

Catalyst's architecture is designed for **production-ready game server management** with emphasis on:

- **Reliability:** State machine validation, audit logging
- **Performance:** containerd, Rust agent, WebSocket
- **Scalability:** Modular design, API-first
- **Security:** RBAC, JWT, TLS, audit trail
- **Extensibility:** Plugin system, 60+ API endpoints

The platform is ready for **enterprise deployment** with **100+ servers per node** and plans for **horizontal scaling** in v2.

---

**Last Updated:** February 9, 2026
**Version:** 1.0.0
