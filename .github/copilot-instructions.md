# Catalyst - AI Coding Agent Instructions

**Project:** Catalyst - Production-Grade Game Server Management System  
**Last Updated:** January 28, 2026  
**Monorepo Structure:** Backend (TypeScript), Frontend (React), Agent (Rust), Shared Types

---

## Using AI Tools in This Repository

**Code Search Skill:** This repository is indexed with semantic search. When you need to find code by natural language queries (e.g., "where is authentication implemented?", "find WebSocket message handlers"), use the `code-search` skill for fast, accurate results.

Examples:
- "How does RBAC middleware work?"
- "Find all WebSocket message type definitions"
- "Where are server state transitions validated?"

Always prefer the code-search skill over grep/find when exploring unfamiliar parts of the codebase.

---

## Architecture Overview

Catalyst is a full-stack game server management system built as a three-tier monorepo. The architecture emphasizes **real-time communication**, **stateless services**, and **clear separation of concerns**.

### Core Components

1. **Backend** (`catalyst-backend/`) - Fastify + PostgreSQL + WebSocket Gateway
   - REST API with JWT auth and RBAC
   - WebSocket gateway for real-time client/agent communication
   - Task scheduler for cron-based actions (restart, backups)
   - SFTP server for direct file access
   - Alert service for threshold monitoring

2. **Frontend** (`catalyst-frontend/`) - React 18 + Vite + TypeScript
   - TanStack Query for API state management
   - WebSocket connection for live console/metrics
   - Terminal emulator (ghostty-web) for console access
   - Radix UI for accessible components

3. **Agent** (`catalyst-agent/`) - Rust + Tokio + Containerd
   - Daemon connecting to backend via WebSocket
   - Container lifecycle management (via containerd gRPC, not Docker)
   - Health reporting, metrics collection, file operations
   - System metrics collection every 30 seconds

4. **Shared Types** (`catalyst-shared/`) - Type definitions synced across services

---

## Critical Architecture Decisions & Why

### Backend State Management
- **Backend owns all state**, never trust agent-reported data
- Database is source of truth for server status, even during async operations
- Agent sends updates via WebSocket, backend validates and persists
- Pattern: `Backend -> WebSocket -> Agent`, `Agent -> WebSocket -> Backend (validation)`

### WebSocket as Primary Communication
- Used over gRPC for simplicity; covers current needs (100s of servers, not 1000s)
- Full-duplex allows agent health reports + backend commands concurrently
- Message types: `node_handshake`, `server_state_update`, `console_output`, `resource_stats`, `health_report`
- No reconnection logic yet; agents should implement with exponential backoff

### Containerd Instead of Docker
- Superior resource isolation and performance for containerized game servers
- Configured in agent as `socket_path: /run/containerd/containerd.sock`
- Agent uses Tokio for async I/O to containerd socket
- No image pull built-in; expects pre-cached images or manual pull

### Role-Based Access Control (RBAC)
- Fine-grained permissions: `server.create`, `server.start`, `file.write`, `backup.restore`, etc.
- Backend middleware validates permissions on every request
- User roles determine available permissions; combine roles for matrix structure
- **Important:** Audit logging required for all privileged operations

---

## Development Workflows

### Backend Setup
```bash
cd catalyst-backend
npm install
npm run db:push          # Sync Prisma schema to PostgreSQL
npm run db:seed          # Populate with test data
npm run dev              # Start Fastify with tsx watch (port 3000)
```

**Key commands:**
- `npm run build` - Compile TypeScript to dist/
- `npm run lint` - Run ESLint on src/
- `npm run lint -- --fix` - Auto-fix linting issues
- `npm run db:studio` - Graphical Prisma data viewer
- `npm run db:migrate` - Create versioned migrations
- `npm run db:generate` - Regenerate Prisma client

### Frontend Setup
```bash
cd catalyst-frontend
npm install
npm run dev              # Vite dev server (port 5173)
npm run test             # Vitest unit tests
npm run test:e2e         # Playwright integration tests
```

**Key commands:**
- `npm run build` - Build production bundle
- `npm run preview` - Preview production build locally
- `npm run lint` - Run ESLint on all .ts/.tsx files
- `npm run lint -- --fix` - Auto-fix linting issues
- `npm run format` - Format with Prettier
- `npm run test:screenshots` - Run Playwright screenshot tests

### Agent Setup
```bash
cd catalyst-agent
cargo build --release   # ~2-3 minutes; produces `target/release/catalyst-agent`
cargo build             # Debug build for development (slower runtime)
cargo test              # Run Rust unit tests
cargo clippy            # Run Rust linter
cargo fmt               # Format Rust code

# Configuration
cp config.toml /opt/catalyst-agent/
# Edit /opt/catalyst-agent/config.toml with backend_url, node_id, secret
```

### Full Stack Locally
```bash
docker-compose up -d    # Starts PostgreSQL on :5432
cd catalyst-backend && npm run dev &
cd catalyst-frontend && npm run dev &
# Backend @ http://localhost:3000
# Frontend @ http://localhost:5173
```

---

## Critical Code Patterns

### Server State Machine  
File: [catalyst-backend/src/services/state-machine.ts](../catalyst-backend/src/services/state-machine.ts)

Server lifecycle: `stopped` → `installing/starting/running/stopping/crashed/error/suspended`

**Pattern:** All state transitions validated in backend BEFORE sending commands to agent. Database persists state immediately.
- `ServerStateMachine.canTransition(from, to)` validates all state changes
- `ServerStateMachine.canStart()` / `canStop()` guard operations
- Implementation uses static transition maps for explicit validation

**When adding server operations:**
1. Check state validity via `ServerStateMachine.validateTransition()`
2. Persist state change to DB immediately  
3. Then send WebSocket message to agent
4. Never rely on agent to validate state

### File Operations
Backend validates all file paths before agent execution:
- Path traversal blocked: reject `..` and paths outside server directory
- Implement whitelist pattern with server-scoped root directory
- Validation happens in backend BEFORE WebSocket message sent to agent
- Agent file_manager.rs enforces the same checks (defense in depth)

**When adding file operations:** Always validate on backend first, never trust file paths from frontend directly.

### WebSocket Message Routing  
File: [catalyst-backend/src/websocket/gateway.ts](../catalyst-backend/src/websocket/gateway.ts)

The gateway manages two connection types:
- **Agent connections** (nodeId + secret): receive commands, send state/metrics updates  
- **Client connections** (JWT token): send user commands, receive real-time updates via subscriptions

Message flow pattern:
```typescript
// Backend → Agent: commands with full context
wsGateway.sendToAgent(nodeId, { type: 'start_server', serverId, serverUuid, environment, ... })

// Agent → Backend: state updates with validation
{ type: 'server_state_update', serverId, status: 'running' } → persists to DB → broadcasts to subscribed clients

// Client → Agent: routed through backend
console_input → validates permission → routes to agent → executes
```

Key implementation details:
- Agent reconnection: exponential backoff (every 5 seconds) if disconnected
- Heartbeats: backend tracks agent.lastHeartbeat; disconnects after ~5 minutes inactivity
- Console output rate-limiting: max 200 lines/second per server to prevent spam
- Request-response pairs: agent requests include sequence IDs for matching responses

### Metrics & Health Reporting
Agents send health updates every 30 seconds to backend:
- `resource_stats`: CPU, memory, disk usage collected via sysinfo crate
- `health_report`: container status, uptime, error logs
- Backend persists to `ServerMetrics` and `NodeMetrics` tables (with TTL indices)
- Frontend uses WebSocket subscriptions for real-time metric streams
- **Immediate metrics**: When a client subscribes to a server, backend sends `request_immediate_stats` to agent to provide instant data (avoids 30-second wait)

**Important:** Metrics gaps > 2 minutes indicate agent disconnect; alert user.

### Frontend Architecture - Zustand Stores & Hooks
File: [catalyst-frontend/src/stores/](../catalyst-frontend/src/stores/)

State management split across Zustand stores (not Redux):
- `authStore` - JWT token, user profile, login/logout actions
- `websocketStore` - WebSocket connection, message subscriptions
- `uiStore` - theme, modal open/close states
- `serverStore` (if exists) - cached server data

Hook pattern for data fetching:
```typescript
// catalysts-frontend/src/hooks/useServers.ts
export function useServers() {
  return useQuery({
    queryKey: ['servers'],
    queryFn: async () => { /* API call */ },
    // Auto-refetch in 1sec if status is transitional
    refetchInterval: server.status ∈ transitionalStatuses ? 1000 : false,
  });
}
```

**When adding UI features:**
1. Create Zustand store in `src/stores/` if state is global
2. Use TanStack Query hooks for API caching
3. Components in `src/pages/` structure mirrors route structure
4. Radix UI + Tailwind for accessible, styled components
5. Toast notifications via sonner library (not custom impl)

### RBAC Middleware Pattern
File: [catalyst-backend/src/middleware/rbac.ts](../catalyst-backend/src/middleware/rbac.ts)

Applied to all protected routes:
```typescript
app.post('/api/servers/:id/start', 
  { onRequest: rbac.checkPermission('server.start') },  // Middleware guard
  async (request, reply) => { ... }
);
```

Permissions enum in [catalyst-backend/src/shared-types.ts](../catalyst-backend/src/shared-types.ts):
- `server.start`, `server.stop`, `server.create`, `server.delete`, `server.suspend`
- `file.read`, `file.write`
- `console.read`, `console.write`
- `database.create`, `database.read`, `database.delete`, `database.rotate`

**When adding new endpoints:** Add permission check middleware, update `Permission` enum in shared-types.

---

## Integration Points & External Dependencies

### PostgreSQL + Prisma
- Connection string: `.env` `DATABASE_URL`
- Schema: [catalyst-backend/prisma/schema.prisma](../catalyst-backend/prisma/schema.prisma)
- **On schema changes:** Run `npm run db:migrate` (creates versioned migrations)
- Prisma client auto-generated; use `prisma.modelName.method()` in routes

### Containerd API
- Agent connects to `/run/containerd/containerd.sock` (configurable in `config.toml`)
- Uses protocol buffers; pre-compiled in Cargo.lock dependencies
- Requires `runc` or `crun` runtime available on node machine
- **Important:** Namespace isolation in config (`namespaces: ["catalyst"]`); all containers run in isolated namespace

### JWT Authentication
- Secret: `.env` `JWT_SECRET` (25+ characters in production)
- Token payload includes `userId`, `email`, `permissions[]`
- Expiration: 24 hours (hardcoded in [index.ts](../catalyst-backend/src/index.ts#L1))
- **On changes:** Update `@fastify/jwt` config in `src/index.ts`

### SFTP Server (ssh2 library)
- Port: `.env` `SFTP_PORT` (default 2022)
- Auth: Username = serverId, Password = JWT token
- Chroot: Each user restricted to their server's file directory
- **Caveat:** Can timeout if backend API calls block; use async/await

### Redis (if configured)
- Used for caching, session storage (optional, not required for MVP)
- Connection: `.env` `REDIS_URL` if enabled
- Can be disabled with environment flags for single-instance deployments

---

## Testing Requirements & Patterns

### Backend API Testing
Scripts in `tests/` directory; use [test-backend.sh](../test-backend.sh) as reference for quick smoke tests.

Integration tests are bash suites in `tests/` directory (`NN-name.test.sh` format):
- [01-auth.test.sh](../tests/01-auth.test.sh) - auth flow patterns
- [02-templates.test.sh](../tests/02-templates.test.sh) - template management
- [03-nodes.test.sh](../tests/03-nodes.test.sh) - node registration & deployment
- [04-servers.test.sh](../tests/04-servers.test.sh) - server state transitions
- [05-permissions.test.sh](../tests/05-permissions.test.sh) - RBAC validation
- [06-websocket.test.sh](../tests/06-websocket.test.sh) - WebSocket communication
- [07-agent-connectivity.test.sh](../tests/07-agent-connectivity.test.sh) - agent health checks
- [08-container-lifecycle.test.sh](../tests/08-container-lifecycle.test.sh) - container operations
- [09-file-operations.test.sh](../tests/09-file-operations.test.sh) - path validation patterns
- [10-full-workflow.test.sh](../tests/10-full-workflow.test.sh) - end-to-end scenarios

**Test pattern:** Use `curl` with token extraction and variable setup from `tests/lib/` helpers.
```bash
# Login to get token
TOKEN=$(curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"password123"}' | jq -r '.data.token')

# Use token in authenticated calls
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/servers
```

**Running individual tests:**
```bash
cd tests
./01-auth.test.sh              # Run single test file
./run-all-tests.sh             # Run entire suite
```

**When adding endpoints:** Add corresponding test file to `tests/` with curl-based assertions.

### Frontend Component Testing
Use Vitest + React Testing Library (in `catalyst-frontend/`):
- `npm run test` - Run unit tests
- `npm run test:e2e` - Run Playwright integration tests
- State management via Zustand stores (auth, websocket, UI)
- TanStack Query for API caching; use `useServers()`, `useServer()` hooks

**Actual pattern in codebase:**
```typescript
// Frontend hooks use TanStack Query with hard-coded status set
const transitionalStatuses = new Set(['installing', 'starting', 'stopping', 'transferring']);
export function useServers() {
  return useQuery({
    queryKey: ['servers'],
    queryFn: async () => { /* API call */ },
    refetchInterval: server.status ∈ transitionalStatuses ? 1000 : false,
  });
}
```

### Integration Testing
End-to-end flows test complete backend + agent + frontend interactions:
- Run `./test-e2e-simple.sh` for basic flow (quick)
- Run `./test-e2e-complete.sh` for comprehensive coverage
- Run `cd tests && ./run-all-tests.sh` for full suite
- Configure agent connection targets in `tests/config.env`

---

## Common Tasks & Implementation Guide

### Adding a New API Endpoint
1. Define Zod schema for request body: `src/routes/example.ts`
2. Add route handler with RBAC middleware
3. Add tests in `tests/20-example.test.sh`
4. Update `backend-docs.md` with cURL examples
5. If database changes needed, run `npm run db:migrate`

### Adding a Database Model
1. Update `catalyst-backend/prisma/schema.prisma`
2. Run `npm run db:migrate` (enter a descriptive name)
3. Regenerate Prisma client: `npm run db:push` (automatic after migrate)
4. Use in backend routes via `prisma.example.findUnique()`

### Scheduled Tasks & Cron Scheduler
File: [catalyst-backend/src/services/task-scheduler.ts](../catalyst-backend/src/services/task-scheduler.ts)

Backend supports recurring tasks stored in `ScheduledTask` model:
```typescript
// Task payload structure
{
  id: string;          // UUID
  serverId: string;
  action: 'backup' | 'command' | 'restart';
  cronExpression: '*/15 * * * *';  // Cron syntax
  payload?: { command?: string };   // Optional data
}
```

**Task executor pattern:**
1. Task scheduler evaluates cron expressions every minute
2. Executor builds environment with `SERVER_DIR`, `CATALYST_NETWORK_IP`
3. Sends appropriate WebSocket message to agent (e.g., `create_backup`, `console_input`)
4. No persistence of task results; agent handles execution

**When adding new task types:**
1. Add action to `ScheduledTask.action` enum
2. Handle in index.ts `taskScheduler.setTaskExecutor()` callback
3. Send correct message type to agent via `wsGateway.sendToAgent()`

### Containerd & Container Lifecycle  
File: [catalyst-agent/src/runtime_manager.rs](../catalyst-agent/src/runtime_manager.rs)

Agent connects to Containerd via Unix socket (not Docker):
- Configuration: `socket_path: /run/containerd/containerd.sock` in `config.toml`
- Namespace isolation: defaults to `"catalyst"` namespace
<<<<<<< HEAD
- Container creation expects pre-cached images or pull via `ctr`
=======
- Container creation expects pre-cached images or manual pull via `nerdctl`
>>>>>>> origin/main
- No automatic image pulls; template specifies `image` + `installImage`

**When adding agent operations:**
1. Use Containerd API protocol buffers (pre-compiled in dependencies)
2. All container operations async via Tokio
3. Health checks via `container.Status()` API
4. Log streaming via `Tasks.GetEvents()` for console output

### Modifying WebSocket Protocol
1. Update [catalyst-backend/src/websocket/gateway.ts](../catalyst-backend/src/websocket/gateway.ts) for backend message handling
2. Update [catalyst-agent/src/websocket_handler.rs](../catalyst-agent/src/websocket_handler.rs) for agent response/parsing
3. Test message flow with `npm run dev` in backend & manual WebSocket client or curl
4. **Critical:** Maintain backward compatibility with deployed agents (version message types if needed)
5. Message types use snake_case throughout (`node_handshake`, `server_state_update`, `console_output`)

### Deploying Changes
Backend + Frontend:
```bash
npm run build          # Compile to dist/
npm start              # Runs node dist/index.js (port 3000)
# Or via Docker: docker build -t catalyst-backend .
```

Agent:
```bash
cargo build --release  # Produces catalyst-agent binary (~50MB)
systemctl restart catalyst-agent  # On node running service
```

---

## Project-Specific Conventions

### Naming
- **Database models:** PascalCase (Server, ServerLog, NodeMetrics)
- **API routes:** kebab-case URLs (`/api/servers/:id/file-operations`)
- **WebSocket message types:** snake_case (`server_state_update`, `console_output`)
- **Tasks:** Verb + noun (`restart_server`, `create_backup`)

### Error Handling
- Backend: Use custom `AgentError` enum in agent; propagate with context
- Frontend: TanStack Query handles HTTP errors; show toast notifications
- Never swallow errors; log with full context for debugging

### Logging
- Backend: Pino logger with `info`, `warn`, `error` levels
- Agent: Tracing crate with structured output
- Production: Set `LOG_LEVEL=info`; Development: `LOG_LEVEL=debug`

### Linting & Code Quality

**Backend (TypeScript):**
```bash
npm run lint                          # Run ESLint on src/
npm run lint -- --fix                # Auto-fix issues
```

Configuration: [catalyst-backend/.eslintrc.json](../catalyst-backend/.eslintrc.json)
- Enforces TypeScript best practices
- Warns on unused variables, missing return types
- Prevents common pitfalls (floating promises, non-null assertions)
- Type-checking enabled via tsconfig integration

**Frontend (TypeScript + React):**
```bash
npm run lint                          # Run ESLint on all .ts,.tsx files
npm run lint -- --fix                # Auto-fix issues
npm run format                        # Format with Prettier
```

Configuration: [catalyst-frontend/.eslintrc.cjs](../catalyst-frontend/.eslintrc.cjs)
- Enforces React 18 best practices (no need for React imports in JSX)
- TypeScript type safety rules
- React Hook exhaustive dependencies checking
- Integrates with Prettier for auto-formatting

**Key ESLint Rules Applied Across Codebase:**
- `eqeqeq: error` - Require strict equality (`===`)
- `no-debugger: error` - Prevent debugger statements in production
- `prefer-const` - Use `const` over `let` when possible
- `@typescript-eslint/no-explicit-any: warn` - Avoid `any` types
- `@typescript-eslint/consistent-type-imports` - Use `import type` for types
- `@typescript-eslint/no-floating-promises` - Handle promises properly
- `max-depth: warn (4)` - Warn on deeply nested code
- `complexity: warn (15)` - Warn on high cyclomatic complexity

**When adding new code:**
1. Run linter before committing: `npm run lint`
2. Fix auto-fixable issues: `npm run lint -- --fix`
3. Address warnings about types, promises, and complexity
4. For frontend, ensure React hooks deps are exhaustive
5. Frontend: Format with Prettier: `npm run format`

### Configuration
- Use `.env` files (never commit secrets)
- `.env.example` with all required variables documented
- `.env.development` for local overrides
- Agent config in `catalyst-agent/config.toml` or `config-e2e.toml`

---

## Performance Considerations

- **Metrics querying:** Index `ServerMetrics` on `(serverId, timestamp)` for time-range queries
- **WebSocket connections:** Backend designed for ~100s concurrent connections per instance
- **Database:** Recommended PostgreSQL 14+ for JSON operators
- **Agent:** Idle connections send heartbeats every 30s; server-side timout ~5min recommended
- **Backups:** Compression (gzip) saves 70-90% space; stored locally in `/var/lib/catalyst/backups/`

---

## Debugging Tips

1. **Agent disconnected?** Check backend WebSocket log: `ws_handler.connect_and_listen()`
2. **Server won't start?** Check agent has permission to access containerd socket: `ls -l /run/containerd/`
3. **File operations failing?** Verify path validation in `file_manager.rs` + backend permission checks
4. **WebSocket messages lost?** Add logging in `www.send()` calls; check network tab in devtools
5. **Slow API?** Run `npm run db:studio` to inspect query performance, check indexes

## Common Gotchas & Patterns to Avoid

- **DO NOT trust agent state reports** - Always validate in backend before persisting
- **DO NOT skip path validation** - Even if frontend validates, validate again on agent
- **DO NOT assume WebSocket is connected** - Always check connection state before sending
- **DO NOT modify server state without database update** - Persist first, then send WebSocket message
- **DO NOT reuse server UUIDs** - Use `nanoid()` for unique IDs across all servers
- **Frontend state refetch:** Servers in transitional states auto-refetch every 1s via TanStack Query
- **Agent reconnection:** Exponential backoff every 5 seconds; no max retry limit (runs forever)

---

## Quick Command Reference

**Start local dev environment:**
```bash
docker-compose up -d                    # PostgreSQL on :5432
cd catalyst-backend && npm run dev &    # Backend on :3000
cd catalyst-frontend && npm run dev &   # Frontend on :5173
# Login: admin@example.com / password123
```

**Database operations:**
```bash
npm run db:push      # Sync schema changes
npm run db:migrate   # Create migration with name prompt
npm run db:studio    # Prisma Studio GUI
npm run db:seed      # Populate with test data
```

**Testing:**
```bash
./test-backend.sh                       # Quick API smoke test
./test-api-integration.sh               # Extended API tests
cd catalyst-frontend && npm run test    # Unit tests
cd tests && ./run-all-tests.sh          # Full E2E suite
```

**Agent development:**
```bash
cd catalyst-agent && cargo build        # Debug build
cd catalyst-agent && cargo build --release  # Optimized
```

---

## Files to Reference

- **Architecture:** [README-old.md](../README-old.md), [plan.md](../plan.md)
- **API Reference:** [backend-docs.md](../backend-docs.md)
- **Backend Structure:** `catalyst-backend/src/` (routes, middleware, services, websocket)
- **Frontend Structure:** `catalyst-frontend/src/` (pages, components, hooks, services, stores)
- **Agent Structure:** `catalyst-agent/src/` (websocket_handler, runtime_manager, file_manager)
- **Database Schema:** `catalyst-backend/prisma/schema.prisma`
- **Test Examples:** `tests/` directory (bash) + `catalyst-frontend/` (vitest, playwright)

---

## Questions? Patterns Not Covered?

- Refer to `backend-docs.md` for complete API specification + WebSocket protocol
- Check existing tests in `tests/` for similar patterns
- Review `plan.md` for architecture rationale on major decisions
- See `AGENTS.md` for repository-level guidelines on structure, commits, and security

---

## Additional Documentation Files

This repository has multiple instruction files for different purposes:
- `.github/copilot-instructions.md` (this file) - Architecture, patterns, and workflows
- `AGENTS.md` - Repository structure, build/test commands, and conventions
- `README.md` - Quick start and configuration guide
- `docs/` - User guides, admin guides, and customer documentation
