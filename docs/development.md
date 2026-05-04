# Development Guide

> How to set up a local development environment, write tests, follow code style, and submit pull requests.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Repository Structure](#repository-structure)
- [Quick Start](#quick-start)
- [Backend Development](#backend-development)
- [Frontend Development](#frontend-development)
- [Agent Development](#agent-development)
- [Plugin Development](#plugin-development)
- [Testing](#testing)
- [Code Style](#code-style)
- [Database & Migrations](#database--migrations)
- [Pull Request Process](#pull-request-process)
- [Debugging Tips](#debugging-tips)
- [Common Gotchas](#common-gotchas)

---

## Prerequisites

| Tool | Minimum Version | Purpose |
|------|----------------|---------|
| **Bun** | 1.0+ | JavaScript/TypeScript runtime (monorepo package manager) |
| **Node.js** | 20+ | Peer dependency resolution |
| **Rust** | 1.70+ | Catalyst agent (cross-compiled targets) |
| **cargo** | Latest stable | Rust package manager & build tool |
| **Docker** | 24+ or **Podman** | Development infra (PostgreSQL, Redis) |
| **PostgreSQL** | 14+ | Primary database (provided via Docker/Podman) |
| **protoc** | 25.1+ | Protocol buffer compilation for agent (gRPC) |

### Installing Prerequisites

**Bun:**
```bash
curl -fsSL https://bun.sh/install | bash
```text

**Rust:**
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup component add rustfmt clippy
```

**Protocol Buffers compiler (for agent):**
```bash
# Download and install protoc 25.1
curl -LO "https://github.com/protocolbuffers/protobuf/releases/download/v25.1/protoc-25.1-linux-x86_64.zip"
unzip protoc-25.1-linux-x86_64.zip -d $HOME/.local
export PATH="$HOME/.local/bin:$PATH"
```text

---

## Repository Structure

Catalyst is a multi-package monorepo managed via Bun workspaces:

```
catalyst/
├── catalyst-backend/          # Fastify + TypeScript API server
│   ├── src/                   # Source code (routes, services, middleware)
│   ├── prisma/                # Database schema & migrations
│   ├── tests/                 # Bash integration tests
│   └── package.json
├── catalyst-frontend/         # React 18 + Vite SPA
│   ├── src/                   # React components, pages, hooks
│   ├── e2e/                   # Playwright E2E tests
│   └── package.json
├── catalyst-shared/           # Shared TypeScript types (types-only package)
│   └── types.ts
├── catalyst-agent/            # Rust daemon (Tokio + containerd gRPC)
│   ├── src/                   # Rust source code
│   ├── Cargo.toml             # Rust dependencies
│   └── config.toml            # Agent runtime configuration
├── catalyst-plugins/          # Bundled plugins
│   ├── egg-explorer/          # Game egg metadata browser
│   ├── example-plugin/        # Plugin system demonstration
│   └── ticketing-plugin/      # WHMCS ticket integration
├── packages/plugin-sdk/       # Official Plugin SDK
│   ├── cli/                   # CLI scaffolding tool
│   ├── src/                   # SDK source types & helpers
│   └── templates/             # Plugin templates (backend-only, fullstack, minimal)
├── catalyst-docker/           # Docker Compose manifests
├── scripts/                   # Deployment & utility scripts
├── .github/workflows/         # CI/CD pipelines
├── package.json               # Root workspace config
└── docs/                      # User/admin documentation
```text

---

## Quick Start

Spin up the full stack locally in under a minute:

```bash
# 1. Clone the repository
git clone https://github.com/catalystctl/catalyst.git
cd catalyst

# 2. Start PostgreSQL and Redis
bun run dev:infra

# 3. Seed the database
bun run db:seed
bun run db:seed:admin   # Creates admin@example.com / password123

# 4. Start both dev servers in parallel
bun run dev

# Navigate to http://localhost:5173
# Login: admin@example.com / password123
```

### Alternative: Manual Start

```bash
# Start infrastructure
cd catalyst-docker && podman-compose up -d postgres redis

# Backend (port 3000)
cd catalyst-backend
bun run dev

# Frontend (port 5173)
cd catalyst-frontend
bun run dev
```text

---

## Backend Development

### Setup

```bash
cd catalyst-backend

# Install dependencies
bun install

# Generate Prisma client
bun run db:generate

# Push schema to database
bun run db:push

# Seed development data
bun run db:seed
```

### Development Commands

| Command | Description |
|---------|-------------|
| `bun run dev` | Start Fastify server with hot reload (`--watch`) |
| `bun run build` | Compile TypeScript to `dist/` |
| `bun run start` | Run compiled server from `dist/index.js` |
| `bun run lint` | Run ESLint on `src/` |
| `bun run lint -- --fix` | Auto-fix linting issues |
| `bun run test` | Run Vitest unit tests |
| `bun run test:ui` | Run Vitest with UI (interactive) |
| `bun run test:coverage` | Run tests with coverage report |
| `bun run db:generate` | Regenerate Prisma client |
| `bun run db:push` | Push schema changes to database |
| `bun run db:migrate` | Create versioned migration |
| `bun run db:studio` | Open Prisma Studio GUI |
| `bun run db:seed` | Populate with test data |
| `bun run db:seed:admin` | Create admin user only |

### Project Structure

```text
catalyst-backend/src/
├── index.ts                 # Fastify bootstrap, route registration, service startup
├── auth.ts                  # Better Auth initialization
├── routes/                  # HTTP endpoint handlers (20+ modules)
│   ├── auth.ts              # Login, register, profile, passkey, 2FA
│   ├── nodes.ts             # Node CRUD, health, deployment tokens
│   ├── servers.ts           # Server CRUD, power, files, databases
│   ├── admin.ts             # Admin operations
│   ├── roles.ts             # RBAC management
│   └── ...
├── services/                # Business logic layer
│   ├── state-machine.ts     # Server lifecycle state machine
│   ├── task-scheduler.ts    # Cron-based scheduled tasks
│   ├── webhook-service.ts   # Outbound webhook dispatch
│   ├── alert-service.ts     # Alert rule evaluation
│   └── ...
├── middleware/              # Fastify middleware
│   └── rbac.ts              # Permission checking
├── lib/                     # Shared utilities
│   ├── permissions.ts       # RBAC permission resolution
│   ├── validation.ts        # Zod validators
│   ├── rate-limits.ts       # Rate limit configuration
│   └── ...
└── websocket/               # WebSocket gateway
    └── gateway.ts           # Agent & client connection management
```

### Key Architecture Patterns

**Server State Machine** — All server state transitions are validated in the backend before sending commands to the agent. The database is the single source of truth.

```typescript
// ✅ Correct pattern
ServerStateMachine.canTransition(from, to);  // Validate
prisma.server.update(...);                    // Persist
wsGateway.sendToAgent(...);                   // Notify agent
```text

**RBAC Middleware** — Every protected route uses the permission middleware:

```typescript
app.post('/api/servers/:id/start',
  { onRequest: rbac.checkPermission('server.start') },
  async (request, reply) => { /* handler */ }
);
```

---

## Frontend Development

### Setup

```bash
cd catalyst-frontend

# Install dependencies
bun install

# Start development server (port 5173)
bun run dev

# Run unit tests
bun run test

# Run E2E tests (requires backend running)
bun run test:e2e
```text

### Development Commands

| Command | Description |
|---------|-------------|
| `bun run dev` | Start Vite dev server with hot module replacement |
| `bun run build` | Build production bundle |
| `bun run preview` | Preview production build locally |
| `bun run lint` | Run ESLint on `.ts`/`.tsx` files |
| `bun run lint -- --fix` | Auto-fix linting issues |
| `bun run format` | Format code with Prettier |
| `bun run test` | Run Vitest unit tests |
| `bun run test:e2e` | Run Playwright E2E tests |
| `bun run test:screenshots` | Run Playwright screenshot crawl tests |
| `bun run test:screenshots:headed` | Run screenshot crawl with visible browser |
| `bun run build:analyze` | Analyze bundle size with visualizer |

### Project Structure

```
catalyst-frontend/src/
├── main.tsx                 # React DOM entry point
├── App.tsx                  # Router, lazy-loaded routes, theming
├── components/              # Reusable UI components
│   ├── layout/              # Sidebar, header, navigation
│   └── ...
├── pages/                   # Page components (mirrors routes)
├── hooks/                   # React hooks (TanStack Query wrappers)
│   ├── useServers.ts
│   ├── useAuth.ts
│   └── ...
├── stores/                  # Zustand global state
│   ├── authStore.ts
│   ├── websocketStore.ts
│   └── uiStore.ts
├── services/                # API client, WebSocket service
├── lib/                     # Utilities (formatters, helpers)
└── test/setup.ts            # Vitest test setup
```text

### Key Architecture Patterns

**State Management** — Zustand for global UI state, TanStack Query for server state:

```typescript
// Fetch with automatic caching and refetch
// Transitional states (installing, starting, stopping, transferring) refetch every 2s
// Normal states refetch every 10s
const { data: servers } = useQuery({
  queryKey: ['servers'],
  queryFn: () => api.getServers(),
  refetchInterval: (query) =>
    query.state.data?.some((s: Server) => transitionalStatuses.has(s.status)) ? 2000 : 10000,
});
```

**Component Structure** — Pages mirror the route structure. Use Radix UI primitives with Tailwind CSS for styling.

**Plugin Frontend Slots** — Plugins can register React components that appear in admin tabs or server detail views. Plugin frontend code is bundled alongside the main app at build time.

### Frontend Stores (Zustand)

Zustand manages global UI state. All stores are in `catalyst-frontend/src/stores/`. See [Frontend Global State (Stores)](#frontend-global-state-stores) for detailed documentation of `authStore`, `themeStore`, `backupDownloadStore`, and deprecated `uiStore`.

#### `websocketStore` — WebSocket Connection State

Manages the WebSocket connection used for real-time console streaming and server events.

**Key state:**
- `connected` — Whether the WebSocket is connected
- `serverId` — Currently connected server (for console streaming)
- `consoleLines` — Buffered console output lines
- `listeners` — Registered event listeners for console events

**Key methods:**
- `connect(serverId)` — Open WebSocket to `/api/servers/:id/console/stream`
- `disconnect()` — Close WebSocket connection
- `sendCommand(command)` — Send console command via WebSocket
- `onConsoleData(callback)` — Subscribe to console output
- `addSseSubscriber(serverId, callback)` — Register SSE fallback subscriber
- `getSseSubscriberCount(serverId)` — Check subscriber count (cap: 50 per server)

**SSE Fallback:** When WebSocket is unavailable, the store falls back to Server-Sent Events via `GET /api/servers/:id/console/stream`.

#### `uiStore` — UI Layout State

Manages sidebar state, modals, and transient UI elements.

**Key state:**
- `sidebarCollapsed` — Whether the sidebar is collapsed
- `modals` — Currently open modal registry
- `notifications` — Toast notification queue

---

### Frontend Hooks (React + TanStack Query)

Hooks are in `catalyst-frontend/src/hooks/`. They wrap API calls with TanStack Query for caching, refetching, and transitional state handling.

#### `useAuth` — Authentication Operations

```typescript
const { data: user } = useQuery(['auth/me'], () => api.getMe());
const { mutate: login } = useMutation(() => api.login(email, password));
```

**Provides:**
- `useAuthUser()` — Current authenticated user with roles
- `useAuthInit()` — Auto-handles 401 errors, silently refreshes expired sessions
- `useAuthPermission(permission)` — Checks if current user has a specific permission

#### `useServers` — Server Lifecycle Operations

```typescript
const { data: servers } = useServers();
const { mutate: startServer } = useStartServer();
```

**Provides:**
- `useServers()` — Fetches all servers user has access to; refetches every 2s during transitional states (installing, starting, stopping, transferring), every 10s otherwise
- `useServer(serverId)` — Single server detail with owner/permissions info
- `useCreateServer()` — Create a new server from a template
- `useStartServer()` / `useStopServer()` / `useRestartServer()` — Power operations with status polling
- `useDeleteServer()` — Delete with ownership verification
- `useTransferOwnership()` — Transfer server to another user
- `useSuspendServer()` / `useResumeServer()` — Admin suspension operations

#### `useFileManager` — File Operations

```typescript
const { data: files } = useFiles(serverId, path);
const { mutate: uploadFile } = useUploadFile();
```

**Provides:**
- `useFiles(serverId, path)` — List files with pagination; uses `/api/servers/:id/files`
- `useReadFile(serverId, path)` — Read file content via file tunnel
- `useWriteFile(serverId, path)` — Write file via file tunnel
- `useUploadFile(serverId, path)` — Upload file via file tunnel
- `useDeleteFile(serverId, path)` — Delete file/directory
- `useRenameFile(serverId, oldPath, newPath)` — Rename or move file
- `useCreateDirectory(serverId, path)` — Create directory
- `useCompressArchive(serverId, path)` — Create tar.gz archive
- `useExtractArchive(serverId, archivePath, destPath)` — Extract archive

**File Tunnel:** All file operations flow through the file tunnel (`/api/servers/:id/file-tunnel/*`) which has its own rate limits (see Security Settings defaults table above).

#### `useSseConsole` — Console Streaming

```typescript
const lines = useSseConsole(serverId);
const { mutate: sendCommand } = useSendConsoleCommand(serverId);
```

**Provides:**
- `useSseConsole(serverId)` — Real-time console via SSE or WebSocket
- `useSendConsoleCommand(serverId)` — Send commands to the server console
- `useConsoleStream(serverId)` — Direct WebSocket console (alternative to SSE)

#### `useFileManager` — System & Admin Hooks

- `useSetupStatus()` — Checks if first-time panel setup is required; redirects if so
- `useSystemErrors()` — Fetches client-side error reports from `reportSystemError()`
- `useAuditLogs()` — Fetches system audit logs with filtering
- `useNodeHealth(nodeId)` — Fetches node resource metrics (CPU, memory, disk)

---

### Frontend API Services

API services are in `catalyst-frontend/src/services/`. They wrap `fetch()` calls with proper headers, auth tokens, and error handling.

#### Core Services

| Service | File | Purpose |
|---------|------|--------|
| `api.ts` | `services/api/` | Core API client with auth headers, error handling, abort controllers |
| `websocket.ts` | `services/websocket/` | WebSocket connection manager for console streaming |
| `sse.ts` | `services/sse/` | SSE EventSource wrapper for console streaming fallback |

#### Feature Services

| Service | File | Purpose |
|---------|------|--------|
| `servers.ts` | `services/api/servers.ts` | All server CRUD, power operations, transfer, suspend |
| `nodes.ts` | `services/api/nodes.ts` | Node management, allocation, health checks |
| `auth.ts` | `services/api/auth.ts` | Login, register, 2FA, passkeys, sessions, profile |
| `files.ts` | `services/api/files.ts` | File tunnel operations, upload, download, archive |
| `backups.ts` | `services/api/backups.ts` | Backup creation, listing, restoration, deletion |
| `sftp.ts` | `services/api/sftp.ts` | SFTP token generation, listing, revocation |
| `templates.ts` | `services/api/templates.ts` | Server template CRUD, variables, images |
| `users.ts` | `services/api/users.ts` | User management, invites, roles |
| `roles.ts` | `services/api/roles.ts` | Role CRUD, permissions |
| `admin.ts` | `services/api/admin.ts` | Admin endpoints: settings, security, system errors |
| `systemErrors.ts` | `services/api/systemErrors.ts` | `reportSystemError()` client for frontend error tracking |
| `plugins.ts` | `services/api/plugins.ts` | Plugin installation, management, config |

#### Auth Token Flow

```typescript
// api.ts automatically attaches the auth token from authStore
class ApiClient {
  async request(url, options) {
    const token = authStore.getState().token;
    if (token) options.headers.Authorization = `Bearer ${token}`;
    
    const response = await fetch(url, options);
    if (response.status === 401) {
      // useAuthInit handles 401s silently
      // Does NOT destroy new sessions (prevents login loops)
    }
    return response;
  }
}
```

#### Error Reporting

Frontend services call `reportSystemError()` for client-side error tracking. This function is used by 60+ modules including `AuthStore`, `useFileManager`, `useSetupStatus`, `useSseConsole`, and all page components. Errors are collected and visible on the Admin System Errors page (`/admin/system-errors`).

---

## Frontend Global State (Stores)

Catalyst uses [Zustand](https://zustand.docs.pmnd.rs/) for global state management. Stores are located in `catalyst-frontend/src/stores/`.

### `authStore`

**File:** `stores/authStore.ts`

Manages authentication state, login/logout flows, 2FA verification, and cross-tab session synchronization.

| Field | Type | Description |
|-------|------|-------------|
| `user` | `User \| null` | Current authenticated user object |
| `isAuthenticated` | `boolean` | Whether the user is logged in |
| `isLoading` | `boolean` | Whether a login/register operation is in progress |
| `isReady` | `boolean` | Whether auth initialization is complete |
| `isRefreshing` | `boolean` | Whether a session refresh is in progress |
| `error` | `string \| null` | Error message from the last failed operation |
| `rememberMe` | `boolean` | Whether "remember me" was checked (persisted to localStorage) |
| `_broadcast` | `BroadcastChannel` | BroadcastChannel for cross-tab logout sync (internal) |

**Methods:**

| Method | Parameters | Description |
|--------|-----------|-------------|
| `login()` | `(values: LoginSchema, options?)` | Log in with email/password. Handles 2FA redirect. Sets cookies via HttpOnly. Uses `loginGuard` to prevent stale 401s from wiping state. |
| `register()` | `(values: RegisterSchema)` | Register a new account. Same cookie-based auth pattern. |
| `refresh()` | `()` | Refresh session by calling the auth API. Silently handles 401 during login. Clears old token-based localStorage items. |
| `init()` | `()` | Initialize auth on app mount. Skips refresh if login is in-flight. Only sets `isReady` when refresh completes. |
| `logout()` | `()` | Clear local state, fire-and-forget server sign-out, broadcast `logout` message to other tabs. |
| `setUser()` | `(user: User \| null)` | Manually set the user object. |
| `setSession()` | `({ user })` | Set session from a payload (e.g., after OAuth redirect). |
| `verifyTwoFactor()` | `({ code, trustDevice? })` | Verify 2FA code. `trustDevice` stores a 30-day trust token. |

**Cross-Tab Sync:**

The store uses a `BroadcastChannel('catalyst-auth')` to synchronize logout across tabs. When one tab logs out, all other tabs are immediately logged out and redirected to `/login`.

```typescript
// authStore.ts (simplified)
if (typeof window !== 'undefined') {
  const channel = new BroadcastChannel('catalyst-auth');
  channel.onmessage = (event) => {
    if (event.data?.type === 'logout') {
      useAuthStore.setState({ user: null, isAuthenticated: false });
      window.location.href = '/login';
    }
  };
}
```

**Persistence:**

Only `rememberMe` is persisted to localStorage (via Zustand `persist` middleware). All other state is runtime-only.

---

### `themeStore`

**File:** `stores/themeStore.ts`

Manages theme state, sidebar state, server view mode, custom CSS, and dynamic color preview.

| Field | Type | Description |
|-------|------|-------------|
| `theme` | `'light' \| 'dark'` | Current theme mode |
| `sidebarCollapsed` | `boolean` | Whether the sidebar is collapsed |
| `serverViewMode` | `'card' \| 'list'` | How servers are displayed in the list |
| `themeSettings` | `PublicThemeSettings \| null` | Server-fetched theme settings (panel name, logo, colors) |
| `customCssElement` | `HTMLStyleElement \| null` | Reference to the injected `<style>` element (internal) |

**Methods:**

| Method | Parameters | Description |
|--------|-----------|-------------|
| `setTheme()` | `(theme)` | Switch between light/dark. Applies CSS variables to `<html>`. |
| `setServerViewMode()` | `(mode)` | Toggle between card and list views |
| `toggleSidebar()` | `()` | Toggle sidebar collapsed state |
| `setThemeSettings()` | `(settings, customCss?)` | Set theme settings from server. Applies colors as CSS variables. Injects custom CSS if provided. |
| `applyTheme()` | `()` | Apply the current theme settings to the DOM. Sets all CSS custom properties. |
| `previewColors()` | `({ primaryColor?, secondaryColor?, accentColor?, themeColors? })` | Schedule a live-preview DOM update. **Batched via `requestAnimationFrame`** to eliminate jank during rapid color changes (e.g., dragging a color picker at ~60fps). |
| `cancelPreview()` | `()` | Cancel any pending preview frame update |
| `injectCustomCss()` | `(css)` | Inject a `<style id="catalyst-custom-css">` element into `<head>`. Removes old element first. |

**Color System:**

The store converts hex colors to HSL and generates a full 90-shade scale (50–900) for primary, secondary, and accent colors. It applies over 40 CSS custom properties including `--primary`, `--secondary`, `--accent`, `--success`, `--warning`, `--danger`, `--info`, and all surface/shade tokens for both light and dark modes.

**Persistence:**

`theme`, `sidebarCollapsed`, and `serverViewMode` are persisted to localStorage via Zustand `persist` middleware.

---

### `backupDownloadStore`

**File:** `stores/backupDownloadStore.ts`

Tracks backup download progress per backup ID. Used for large backup file downloads.

---

### `uiStore` (DEPRECATED)

**File:** `stores/uiStore.ts`

Deprecated alias to `themeStore`. Use `themeStore` directly.

---

## Frontend Hooks Reference

Hooks live in `catalyst-frontend/src/hooks/`. All hooks are TanStack Query wrappers over the API services.

### Admin Hooks (`hooks/useAdmin.ts`)

| Hook | Purpose | API Endpoint | Details |
|------|---------|-------------|---------|
| `useAdminStats()` | Platform stats | `GET /api/admin/stats` | Users, servers, nodes, active servers. Refreshes every 30s. |
| `useAdminHealth()` | Platform health | `GET /api/admin/health` | Database status, node online/offline/stale counts. Refreshes every 15s. |
| `useAdminServers()` | Admin server listing | `GET /api/admin/servers` | Paginated, searchable. Filters by status and owner. |
| `useAuditLogs()` | System-wide audit log | `GET /api/admin/audit-logs` | Filters by action, resource, user, date range. |
| `useDatabaseHosts()` | Database host config | `GET /api/admin/database-hosts` | List all database host configurations. |
| `useSmtpSettings()` | SMTP configuration | `GET /api/admin/smtp` | Get SMTP settings for invites/notifications. |
| `useSecuritySettings()` | Security config | `GET /api/admin/security-settings` | 18 security settings: rate limits, lockout policy, file tunnel, agent limits. |
| `useModManagerSettings()` | Mod manager config | `GET /api/admin/mod-manager` | CurseForge + Modrinth API key settings. |
| `useAuthLockouts()` | Lockout tracking | `GET /api/admin/auth-lockouts` | Failed login tracking with search/pagination. |
| `useThemeSettings()` | Theme configuration | `GET /api/admin/theme-settings` | Full admin theme settings. |
| `useOidcConfig()` | OIDC configuration | `GET /api/admin/oidc` | OpenID Connect / SSO settings. |
| `useSystemErrors()` | System errors | `GET /api/admin/system-errors` | Client-side error reporting dashboard. |
| `useResolveSystemError()` | Resolve error | `POST /api/admin/system-errors/:id/resolve` | Mark a system error as resolved. |

### Auth Hooks

| Hook | Purpose | API Endpoint | Details |
|------|---------|-------------|---------|
| `useAuthInit()` | Auth initialization | `POST /api/auth/refresh` | Silently handles 401s. Used by `App.tsx` on mount. |
| `useProfile()` | Profile CRUD | `GET/PUT /api/profile` | Personal info, avatar, password, sessions, 2FA, passkeys, API keys. |
| `useProfileApiKeys()` | API key management | `GET/POST/PUT/DELETE /api/profile/api-keys` | Create, list, enable/disable, delete, rename API keys. |
| `useProfileSsoAccounts()` | SSO account linking | `GET /api/profile/sso-accounts` | Link/unlink WHMCS/Paymenter accounts. |
| `useProfileSync()` | Profile sync | `GET/PUT /api/profile` | Avatar upload and profile synchronization. |
| `useEulaPrompt()` | EULA acceptance | `POST /api/servers/:id/eula` | Shows EULA prompts for Minecraft and similar games. |

### Server Hooks

| Hook | Purpose | API Endpoint | Details |
|------|---------|-------------|---------|
| `useServers()` | Server listing | `GET /api/servers` | Paginated server list with metrics. Transitional states refetch every 2s. |
| `useServerStateUpdates()` | State changes | `GET /api/servers/:id/events` | Real-time server state changes via SSE. |
| `useServerMetrics()` | Server metrics | `GET /api/servers/:id/metrics` | Per-server CPU/memory/disk metrics. |
| `useServerMetricsHistory()` | Historical metrics | `GET /api/servers/:id/metrics/history` | Historical metrics with time range selection. |
| `useClusterMetrics()` | Cluster metrics | `GET /api/admin/metrics` | Cluster-wide metrics aggregation. |
| `useTasks()` | Scheduled tasks | `GET/POST/PUT/DELETE /api/tasks/:id/tasks` | Server task CRUD with schedule management. |
| `useNodes()` | Node listing | `GET /api/nodes` | Node listing with search. |
| `useTemplates()` | Template management | `GET/POST/PUT/DELETE /api/templates` | Template CRUD and detail retrieval. |
| `useUpdateCheck()` | Update checking | `GET /api/admin/update-check` | Auto-update version checking. |

### File & Console Hooks

| Hook | Purpose | API Endpoint | Details |
|------|---------|-------------|---------|
| `useFileManager()` | File operations | `GET/PUT/POST /api/servers/:id/files` | Path navigation, file open/edit/save with dirty tracking. Shows file path, name, line count. |
| `useSseConsole()` | SSE console | `GET /api/servers/:id/console/stream` | Batched 32ms flush intervals, pre-allocated IDs, streaming, polling fallback on disconnect. |
| `useConsole()` | Console commands | `POST /api/servers/:id/console/command` | Thin wrapper around `useSseConsole`. Sends commands (max 4096 chars, auto-appends `\n`). |

### SSE Event Hooks

| Hook | Purpose | API Endpoint | Details |
|------|---------|-------------|---------|
| `useSseAdminEvents()` | Admin events | `GET /api/events` | Admin-level real-time notifications (notification bell). |
| `useSseResizeComplete()` | Resize complete | `GET /api/servers/:id/events` | Server resize completion events. |

### Utility Hooks

| Hook | Purpose | Details |
|------|---------|---------|
| `useKeyboardShortcut()` | Keyboard shortcuts | Global shortcuts (e.g., Ctrl+K for command palette). |
| `useDebounce()` | Debounce utility | Generic debounce for search inputs across pages. |
| `useResourceBalancer()` | Resource balancing | Suggests optimal nodes for server distribution (transfer suggestions). |

---

## Agent Development

The Catalyst Agent is a Rust daemon that runs on game server nodes. It manages container lifecycles via containerd gRPC.

### Setup

```bash
cd catalyst-agent

# Install dependencies (via cargo)
cargo fetch

# Build debug binary (for development, slower runtime)
cargo build

# Build release binary (optimized, for production)
cargo build --release

# Run on a node with containerd
sudo cargo run -- ./config.toml
```text

### Development Commands

| Command | Description |
|---------|-------------|
| `cargo build` | Debug build (faster compile, slower runtime) |
| `cargo build --release` | Optimized release build (~50MB binary) |
| `cargo test` | Run Rust unit tests |
| `cargo clippy` | Run Rust linter (fails on warnings in CI) |
| `cargo fmt` | Format code |
| `cargo fmt -- --check` | Check formatting (used in CI) |

### Project Structure

```
catalyst-agent/src/
├── main.rs                  # Entry point, Tokio runtime, signal handling
├── websocket_handler.rs     # WebSocket connection to backend
├── runtime_manager.rs       # Containerd lifecycle management
├── file_manager.rs          # File operations on node filesystem
└── config.rs                # TOML configuration parsing
```text

### Key Architecture Patterns

**Containerd Communication** — The agent connects to `/run/containerd/containerd.sock` (configurable in `config.toml`). All operations are async via Tokio:

```rust
// Container creation
containerd_client.create_container(&namespace, &config).await?;
// Health checks
containerd_client.get_container_status(container_id).await?;
```

**WebSocket Protocol** — Messages use `snake_case` types:

```rust
// Agent → Backend
{ "type": "server_state_update", "serverId": "...", "status": "running" }

// Backend → Agent
{ "type": "start_server", "serverId": "...", "serverUuid": "..." }
```text

---

## Plugin Development

Catalyst supports extensible plugins with backend API routes, WebSocket handlers, scheduled tasks, and frontend React components.

### Quick Start

```bash
# Scaffold a new plugin (from the monorepo root)
cd packages/plugin-sdk
npx @catalyst/plugin-sdk create my-plugin --template fullstack
```

### Plugin Templates

| Template | Description | Use Case |
|----------|-------------|----------|
| `backend-only` | API routes + WebSocket handlers only | Backend integrations |
| `fullstack` | Backend + frontend tabs | Interactive plugins |
| `minimal` | Single manifest + entry point | Simple functionality |

### Plugin Lifecycle

```typescript
// plugin.json — manifest
{
  "name": "my-plugin",
  "version": "1.0.0",
  "displayName": "My Plugin",
  "config": { /* plugin config fields */ }
}

// backend/index.js — lifecycle hooks
export default {
  async onLoad(context) {
    // Register routes (before server starts)
    const routes = defineRoutes((router) => {
      router.get('/hello', async (req, reply) => { ... });
    });
    for (const route of routes) {
      context.registerRoute(route);
    }
  },
  async onEnable(context) {
    // Register WebSocket handlers, cron jobs
  },
  async onDisable(context) {
    // Cleanup, stop tasks
  },
  async onUnload(context) {
    // Final cleanup
  }
};
```text

### Context API

| Method | Purpose |
|--------|---------|
| `context.registerRoute(route)` | Register an API route |
| `context.onWebSocketMessage(type, handler)` | Listen for WebSocket messages |
| `context.scheduleTask(cron, handler)` | Register a cron task |
| `context.on(event, handler)` / `context.emit(event, data)` | Event system |
| `context.getConfig(key)` / `context.setConfig(key, value)` | Plugin config |
| `context.getStorage(key)` / `context.setStorage(key, value)` | Persistent key-value storage |
| `context.collection(name)` | Typed MongoDB-like collection API |

### Testing Plugins

The SDK provides test utilities:

```typescript
import { createTestPlugin } from '@catalyst/plugin-sdk/testing';

const harness = createTestPlugin(myPlugin, manifest, config);
const context = await harness.load();

// Assert routes were registered
assert(context.registerRoute.calls.length > 0);
```

### Hot Reload

Set `PLUGIN_HOT_RELOAD=true` in `.env` to auto-reload plugins on file changes (development only).

### Example Plugin

See `catalyst-plugins/example-plugin/` for a full demonstration including:
- Custom API routes (`/api/plugins/example-plugin/hello`)
- WebSocket message handling
- Scheduled cron tasks
- Frontend admin + server tabs
- Persistent storage
- Configuration via admin UI

---

## Testing

Catalyst uses a multi-layer testing strategy.

### Backend Unit Tests (Vitest)

```bash
# Run all backend tests
bun run test                  # or: cd catalyst-backend && bun run test

# Run with UI (interactive watch mode)
bun run test:ui

# Generate coverage report
bun run test:coverage
```text

Test files live alongside source in `src/**/__tests__/**/*.test.ts`.

### Frontend Unit Tests (Vitest + React Testing Library)

```bash
# Run unit tests
bun run test                  # or: cd catalyst-frontend && bun run test
```

Test files follow the pattern `src/**/__tests__/**/*.{test,spec}.{ts,tsx}`.

### Frontend E2E Tests (Playwright)

```bash
# Run all E2E tests (headless)
bun run test:e2e

# Screenshot crawl — captures every page, tab, and modal
bun run test:screenshots

# Watch the browser live
bun run test:screenshots:headed

# Against an already-running dev server
SKIP_WEB_SERVER=1 bun run test:screenshots
```text

The screenshot crawl dynamically discovers routes from `src/App.tsx`, navigation links from the sidebar, and modals from DOM triggers — requiring zero test maintenance when adding pages.

### Integration Tests (Bash + curl)

Bash test suites in `tests/` verify API workflows end-to-end:

```bash
# Run all integration tests
cd tests && ./run-all-tests.sh

# Run a single test
cd tests && ./01-auth.test.sh

# Quick smoke test
cd tests && ./test-backend.sh
```

Tests include auth flow, template management, node registration, server state transitions, RBAC validation, WebSocket communication, file operations, and full workflows.

**Key integration test flows:**

| Test File | Covers |
|-----------|--------|
| `01-auth.test.sh` | Registration, login, 2FA, passkey, session management |
| `02-templates.test.sh` | Template CRUD, variable validation, egg import |
| `03-nodes.test.sh` | Node registration, allocation, health checks |
| `04-servers.test.sh` | Server lifecycle: create → start → stop → transfer → delete |
| `05-rbac.test.sh` | Role-based access control, permission enforcement |
| `06-websocket.test.sh` | WebSocket connection, console streaming, SSE fallback |
| `07-files.test.sh` | File tunnel operations, upload/download, archive/extract |
| `smoke-test.sh` | Quick health check — starts all services and verifies `/health` endpoint |

**Testing patterns for auth/security features:**

```bash
# Test rate limiting — send multiple requests and verify 429 responses
curl -s -w '%{http_code}' http://localhost:3000/api/auth/login -d '{"email":"test@test.com","password":"test"}'

# Test password complexity — registration should reject weak passwords
curl -s http://localhost:3000/api/auth/register -d '{"email":"test@test.com","password":"weak","username":"test"}'

# Test passkey registration flow — requires HTTPS and WebAuthn-capable browser
```

**Backend unit test patterns:**

```typescript
// Prisma test client isolates tests from the real database
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

beforeEach(async () => {
  await prisma.$transaction([
    prisma.user.deleteMany(),
    prisma.server.deleteMany(),
    prisma.node.deleteMany(),
  ]);
});

afterEach(async () => {
  await prisma.$disconnect();
});
```

**Frontend test patterns:**

```typescript
// Render with auth context
import { render, screen } from '@testing-library/react';
import { authStore } from '@/stores/authStore';

render(<Route path="/servers" element={<ServerList />} />, {
  wrapper: ({ children }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  ),
});

// Mock API services
vi.mock('@/services/api/servers', () => ({
  getServers: () => Promise.resolve(mockServers),
}));
```

### Running All Tests

```bash
# From monorepo root — runs tests in all packages
bun run test
```text

---

## Code Style

### TypeScript / JavaScript (Backend & Frontend)

**ESLint Configuration**

Backend and frontend share similar TypeScript ESLint rules but with different targets:

| Rule | Severity | Notes |
|------|----------|-------|
| `eqeqeq` | error | Require `===` over `==` |
| `no-debugger` | error | Prevent `debugger` statements |
| `@typescript-eslint/no-explicit-any` | off | `any` is acceptable |
| `@typescript-eslint/no-unused-vars` | off | Unused vars allowed |
| `@typescript-eslint/no-non-null-assertion` | warn | Prefer optional chaining |
| `no-console` | warn | Only `warn`/`error` allowed |

**Prettier Configuration** (Frontend)

```json
{
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100
}
```

**Auto-fix all linting:**
```bash
bun run lint -- --fix
bun run format    # Frontend only
```text

### Rust (Agent)

| Command | Description |
|---------|-------------|
| `cargo fmt` | Format code (2-space indent, standard style) |
| `cargo clippy -- -D warnings` | Fail on all clippy warnings |

---

## Database & Migrations

Catalyst uses **PostgreSQL** with **Prisma ORM** for the database layer.

### Schema

The Prisma schema lives in `catalyst-backend/prisma/schema.prisma`. Key entities include `User`, `Server`, `Node`, `Template`, `Role`, `Permission`, `Backup`, `Task`, `Alert`, and `Plugin`.

### Migration Workflow

```bash
# 1. Edit the schema
# catalyst-backend/prisma/schema.prisma

# 2. Generate migration
bun run db:migrate

# 3. Apply schema changes to database
bun run db:push

# 4. Regenerate Prisma client (usually automatic)
bun run db:generate

# 5. Inspect database visually
bun run db:studio
```

### Seeding

```bash
# Full seed (admin user + sample servers, nodes, templates)
bun run db:seed

# Admin user only
bun run db:seed:admin
```text

Default seeded credentials: `admin@example.com` / `password123`

---

## Pull Request Process

### Branch Strategy

- **`main`** — Stable release branch
- **`develop`** — Integration branch for features

PRs targeting either branch trigger CI checks.

### CI Pipeline

Each PR runs automated checks:

| Job | Scope | Checks |
|-----|-------|--------|
| **Backend CI** | `catalyst-backend/**`, `catalyst-shared/**` | Lint, build, Prisma generate, security audit (bun pm scan) |
| **Agent CI** | `catalyst-agent/**` | `cargo fmt --check`, `cargo check`, `cargo clippy -- -D warnings`, unit tests |
| **Docker Publish** | Changes in backend or frontend | Conditional Docker image build & push to GHCR |

### PR Checklist

Before submitting a PR:

1. **Run local tests** — `bun run test` (all packages)
2. **Run linters** — `bun run lint -- --fix` (backend + frontend)
3. **Format agent code** — `cargo fmt` (if touching the agent)
4. **Run E2E tests** — `bun run test:e2e` (if touching UI or API)
5. **Self-review** — Check your diff for lint warnings, dead code, TODOs
6. **Link related issues** — Reference issue numbers in the PR description
7. **Update tests** — Add or update tests for new functionality

### PR Title Convention

Use conventional commit style:

```
feat: add server export functionality
fix: resolve WebSocket reconnection race condition
docs: update API reference for new endpoints
refactor: simplify state machine transitions
test: add E2E test for plugin management
chore: update dependencies
```text

---

---

## Cross-References

- [Architecture Overview](./architecture.md) — System design, data flow, and component responsibilities
- [API Reference](./api-reference.md) — Complete REST API endpoint reference for integration
- [Plugin System Analysis](./plugin-system-analysis.md) — Internal plugin system internals (deep dive)
- [Automation Guide](./automation.md) — API integration examples (WHMCS, Python, Node.js)

---

## Debugging Tips

### Backend

```bash
# See runtime logs (console output from Fastify)
bun run dev

# Inspect database state
bun run db:studio

# Check for SQL query issues
# Set LOG_LEVEL=debug in .env for verbose Pino logs
```

### Frontend

```bash
# Check network requests in browser DevTools
# WebSocket connection shown in Network → WS tab
# React DevTools for component tree inspection
```text

### Agent

```bash
# Agent uses structured logging via tracing crate
# Set RUST_LOG=debug for verbose output
sudo cargo run -- ./config.toml 2>&1 | grep -i error
```

### Full Stack Debugging

```bash
# Run everything with debug logging
cd catalyst-docker
docker compose up -d              # Start infra
docker compose logs -f            # Tail all logs
docker compose logs -f backend    # Tail backend only
docker compose logs -f frontend   # Tail frontend only
```text

---

## Common Gotchas

### Backend

- **Never trust agent state** — Always validate server state in the backend before persisting or sending commands.
- **Path validation is critical** — File paths must be validated on the backend before being sent to the agent. Even if the frontend validates, re-validate on the server.
- **WebSocket messages use `snake_case`** — All message types are lowercase with underscores (e.g., `server_state_update`, not `serverStateUpdate`).

### Frontend

- **Transitional states auto-refetch** — Servers in `installing`, `starting`, `stopping`, or `transferring` states are polled every 1 second via TanStack Query. Don't override this behavior.
- **Plugin frontend components share the bundle** — Plugin frontend code is compiled with the main app. Ensure plugin components don't leak state.
- **Modals must be dismissed properly** — Use Escape key or explicit close buttons. Don't rely on route changes to close dialogs.

### Agent

- **Always check containerd socket permissions** — If the agent can't connect, check: `ls -l /run/containerd/`
- **HTTP/HTTPS URLs in URLs in URLS are HTTPS** — Ensure `BACKEND_URL` uses `https://` in production, or WebSocket connections will fail.
- **Agent heartbeats are critical** — If an agent doesn't send heartbeats for ~5 minutes, it's considered disconnected.

### General

- **Don't commit `.env` files** — Use `.env.example` for documenting required variables.
- **Never trust data from the agent** — Validate everything in the backend.
- **Database is the source of truth** — Persist state changes to the database immediately before sending any async commands.
