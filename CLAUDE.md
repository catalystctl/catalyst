# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Catalyst is a production-grade game server management platform built as a three-tier monorepo:

- **Backend** (`catalyst-backend/`) - TypeScript 5.9, Fastify, PostgreSQL, WebSocket gateway
- **Frontend** (`catalyst-frontend/`) - React 18, Vite, TanStack Query, Radix UI
- **Agent** (`catalyst-agent/`) - Rust 1.70, Tokio, containerd/nerdctl for container management
- **Shared** (`catalyst-shared/`) - TypeScript type definitions synced across services

## Development Commands

### Backend (catalyst-backend/)
```bash
bun install              # Install dependencies
bun run dev              # Start in watch mode (port 3000)
bun run build            # Compile TypeScript to dist/
bun run start            # Run production build
bun run lint             # Run ESLint on src/
bun run test             # Run Vitest unit tests
```

### Database (PostgreSQL + Prisma)
```bash
bun run db:push          # Sync Prisma schema to PostgreSQL
bun run db:migrate       # Create versioned migrations
bun run db:seed          # Populate with test data
bun run db:studio        # Open Prisma Studio GUI
bun run db:generate      # Regenerate Prisma client
```

### Frontend (catalyst-frontend/)
```bash
bun install              # Install dependencies
bun run dev              # Start Vite dev server (port 5173)
bun run build            # Build production bundle
bun run preview          # Preview production build
bun run lint             # Run ESLint
bun run format           # Format with Prettier
bun run test             # Run Vitest unit tests
bun run test:e2e         # Run Playwright E2E tests
```

### Agent (catalyst-agent/)
```bash
cargo build              # Debug build
cargo build --release    # Optimized build (~2-3 minutes)
cargo test               # Run unit tests
cargo clippy             # Run linter
cargo fmt                # Format code
```

### Full Stack & Testing
```bash
docker-compose up -d     # Start PostgreSQL & Redis
./test-ci-quick.sh       # Quick CI checks
./test-ci-locally.sh     # Full local CI simulation
cd tests && ./run-all-tests.sh  # Full E2E test suite
```

## Architecture Principles

1. **Backend owns all state** - Database is source of truth; never trust agent-reported data without validation
2. **Validate first, execute second** - Backend validates all state transitions before sending commands to agents
3. **WebSocket as primary communication** - Used for real-time communication between backend, agents, and clients
4. **containerd over Docker** - Agent uses containerd/nerdctl for container management (not Docker daemon)
5. **State machine for server lifecycle** - All server state transitions validated via `ServerStateMachine`

## Key Data Flow Patterns

- **Server Operations**: Frontend → Backend API → WebSocket → Agent → containerd
- **Real-time Updates**: Agent → WebSocket → Backend → Database → WebSocket → Frontend
- **State Changes**: Persist to DB first, then send WebSocket message to agent

## Critical Code Locations

- **Server State Machine**: `catalyst-backend/src/services/state-machine.ts`
- **WebSocket Gateway**: `catalyst-backend/src/websocket/gateway.ts`
- **RBAC Middleware**: `catalyst-backend/src/middleware/rbac.ts`
- **Agent WebSocket Handler**: `catalyst-agent/src/websocket_handler.rs`
- **Agent Runtime Manager**: `catalyst-agent/src/runtime_manager.rs`
- **Database Schema**: `catalyst-backend/prisma/schema.prisma`
- **Shared Types**: `catalyst-shared/types.ts`

## Server State Transitions

Valid states: `stopped` → `installing` → `starting` → `running` → `stopping` → `stopped`
Error states: `crashed`, `error`, `suspended`, `transferring`

**Important**: Always validate transitions via `ServerStateMachine.validateTransition()` before persisting to DB or sending commands to agent.

## WebSocket Message Types

Agent messages: `node_handshake`, `server_state_update`, `console_output`, `resource_stats`, `health_report`
Backend→Agent: `start_server`, `stop_server`, `create_backup`, `console_input`, `file_operations`

## RBAC Permissions

Permissions use `resource.action` format: `server.create`, `server.start`, `file.write`, `backup.restore`, etc.
Apply middleware: `{ onRequest: rbac.checkPermission('server.start') }`

## File Operations Security

**Path validation is critical**: Backend validates all file paths before agent execution. Reject `..` and paths outside server directory. Defense in depth - agent validates again in `file_manager.rs`.

## Testing

Integration tests are bash suites in `tests/` directory (`NN-name.test.sh` format):
- `01-auth.test.sh` - Authentication flow
- `04-servers.test.sh` - Server state transitions
- `06-websocket.test.sh` - WebSocket communication
- `10-full-workflow.test.sh` - End-to-end scenarios

Run tests: `cd tests && ./run-all-tests.sh`

## Configuration

- Backend: `catalyst-backend/.env` (see `.env.example`)
- Frontend: `catalyst-frontend/.env` (see `.env.example`)
- Agent: `catalyst-agent/config.toml` (or `config-e2e.toml` for tests)

Never commit secrets or credentials.

## Common Gotchas

- **DO NOT trust agent state reports** - Always validate in backend before persisting
- **DO NOT skip path validation** - Validate on backend AND agent (defense in depth)
- **DO NOT assume WebSocket is connected** - Check connection state before sending
- **DO NOT modify server state without database update** - Persist first, then send WebSocket message
- Console output is rate-limited (max 200 lines/second per server)
- Agent reconnection uses exponential backoff (every 5 seconds)

## Code Search

This repository is indexed with semantic search. Use the `code-search` skill for natural language queries:
- "How does RBAC middleware work?"
- "Find WebSocket message handlers"
- "Where are server state transitions validated?"
