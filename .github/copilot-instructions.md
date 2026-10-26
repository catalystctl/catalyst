# Copilot instructions — catalystctl/catalyst

**Read [AGENTS.md](../AGENTS.md) first. It is the contract for this repository**
and covers the layout, the verification gates CI runs, commit conventions, i18n
rules and the database-migration rule. This file only adds what Copilot needs on
top of it: a file map, the architecture invariants, and the skills available
here.

Do not restate AGENTS.md in this file — if a rule changes, change it there.

## File map

| Area | Where |
|---|---|
| API routes | `catalyst-backend/src/routes/*.ts` + `routes/servers/*.ts` |
| Auth / RBAC | `src/auth.ts` (better-auth), `src/middleware/authenticate.ts`, `src/middleware/rbac.ts`, `src/lib/server-access.ts` |
| Server state | `src/services/state-machine.ts` (`ServerStateMachine.canTransition`) |
| WebSocket gateway | `src/websocket/gateway.ts` |
| Task scheduler | `src/services/task-scheduler.ts` |
| Agent | `catalyst-agent/src/main.rs`, `websocket_handler/`, `runtime_manager/`, `file_manager.rs`, `sftp_server.rs` |
| Panel data layer | `catalyst-frontend/src/csync/` (imported as `@/csync`) |
| Panel UI | `catalyst-frontend/src/pages/`, `components/`, `stores/` (Zustand), `i18n/` |
| Plugin SDK | `packages/plugin-sdk/src/` (+ CLI in `cli/`), `packages/mcp-server/src/` |
| Deployment | `catalyst-docker/`, `install.sh` |

## Invariants

- **The backend owns state.** Persist a state change to the database *before*
  sending the command to the agent, and validate it with
  `ServerStateMachine.canTransition` first. Never trust an agent-reported state
  without checking it.
- **Paths are validated in the backend before any agent call**, and the agent
  re-checks (`catalyst-agent/src/file_manager.rs`). Keep both.
- **The panel's data layer is `@/csync`, not TanStack Query.** `csync` exposes a
  compatible `useQuery`/`useMutation`/`QueryClient` API; import from `@/csync`.
- **Auth is better-auth, not JWT.** Sessions live in PostgreSQL; the cookie
  secret is `BETTER_AUTH_SECRET`. `request.user.userId` is the identity —
  `request.user.apiKeyId` marks an API-key call, which is capped by the key's own
  permission scope.
- **Agent WebSocket messages** use snake_case types: `node_handshake`,
  `server_state_update`, `console_output`, `resource_stats`, `health_report`.
  Deployed agents must stay compatible; version new message shapes.
- **SFTP runs on the node agent** (default port 2022). `catalyst-backend/src/sftp-server.ts`
  is a deprecated no-op stub; the panel only issues and validates tokens
  (`src/services/sftp-token-manager.ts`). Never publish 2022 from the panel stack.

## Skills

Skills are pinned in `skills-lock.json` at the repo root:

`better-auth-best-practices`, `email-and-password-best-practices`,
`fastify-best-practices`, `impeccable`, `tanstack-query-best-practices`,
`two-factor-authentication-best-practices`, `vite`.

Note `tanstack-query-best-practices` applies to `csync`, which mirrors that API
surface — do not add the real `@tanstack/react-query` package.

## Docs

- User/admin docs: https://docs.catalystctl.com (source:
  `catalystctl/catalyst-doc`, a separate repo — never add product code there).
- Contributor/operator docs in this repo: `AGENTS.md`, `CONTRIBUTING.md`,
  `DESIGN.md`, `catalyst-docker/README.md`, `tests/README.md`.
- API reference: `pnpm --filter catalyst-backend run openapi:export` →
  `api/openapi.json` (generated — do not hand-edit).
