# Repository Guidelines

This repository hosts the Catalyst platform: a TypeScript backend, a Rust agent, and a
React frontend, plus shared types and end-to-end tests. It is a **Bun monorepo** and
the primary deployment method is **Docker Compose** (or Podman Compose).

## Project Structure & Module Organization
- `catalyst-backend/`: TypeScript backend (`src/`, `prisma/`, Prisma schema in
  `prisma/schema.prisma`, `Dockerfile`).
- `catalyst-frontend/`: React app (`src/components`, `src/pages`, `src/hooks`,
  `src/services`, `src/styles`, `Dockerfile`, `nginx.conf`).
- `catalyst-agent/`: Rust daemon (`src/`, `config.toml`, `config-e2e.toml`).
- `catalyst-shared/`: Shared TypeScript types (workspace package).
- `catalyst-plugins/`: Plugin packages (`example-plugin/`).
- `tests/`: Bash E2E suites (`NN-name.test.sh`) with helpers in `tests/lib/`.
- `templates/`: Server template JSON files.
- Root: `package.json` (Bun workspaces), `docker-compose.yml`, `.env.example`.

## Deployment
- **Primary:** `docker compose up -d --build` — builds and runs panel, backend,
  PostgreSQL, and Redis. Configuration is in the root `.env` file.
- **Helper script:** `./dev.sh` — validates config, builds, and starts everything.
- See [docs/GETTING_STARTED.md](docs/GETTING_STARTED.md) for the full guide.

## Build, Test, and Development Commands
- `docker compose up -d --build`: build and start all services.
- `docker compose exec backend bun run db:seed`: seed the database.
- `docker compose exec backend bun run db:studio`: open Prisma Studio.
- `bun run build`: build backend + frontend from source (no Docker).
- `bun run dev`: start backend + frontend in watch mode (requires `bun install`).
- `bun run lint`: lint all packages. `bun run test`: test all packages.
- Agent: `cd catalyst-agent && cargo build --release`.
- Quick API/E2E checks: `./test-backend.sh`, `./test-api-integration.sh`,
  `./test-e2e-simple.sh`, `./test-e2e.sh`, `./test-e2e-complete.sh`.
- Full E2E suite: `cd tests && ./run-all-tests.sh`.

## Coding Style & Naming Conventions
- TypeScript/TSX linting via `bun run lint` in backend and frontend.
- Frontend formatting via Prettier (`catalyst-frontend/.prettierrc`: single quotes,
  trailing commas, 100-column print width).
- Naming: React components/pages use `PascalCase` and `*Page.tsx`; hooks use `useX`
  in `src/hooks`; shell tests use `NN-name.test.sh`.

## Testing Guidelines
- Primary integration coverage is in `tests/` Bash suites; configure targets in
  `tests/config.env`.
- Frontend unit tests: `bun run test` (Vitest). Frontend E2E: `bun run test:e2e`
  (Playwright).
- Backend smoke tests: `./test-backend.sh` and `./test-api-integration.sh`.

## Commit & Pull Request Guidelines
- Git history mixes conventional commits (e.g., `feat: ...`) and imperative
  summaries (e.g., `Add ...`); prefer a short, imperative subject, and use
  `feat:`/`fix:` when possible.
- PRs should include: a clear summary, tests run, linked issues, and screenshots
  for UI changes.
- Keep changes scoped to the relevant module (`catalyst-backend`, `catalyst-frontend`,
  `catalyst-agent`).

## Configuration & Security Tips
- All runtime config is in the root `.env` (see `.env.example`).
- Agent configuration lives in `catalyst-agent/config.toml` (and `config-e2e.toml`
  for tests); avoid committing secrets.
- PostgreSQL and Redis ports are bound to `127.0.0.1` by default — only expose
  them externally if you know what you're doing.

---

## Documentation

Comprehensive documentation is available in the `docs/` directory:

- **[Getting Started](docs/GETTING_STARTED.md)** - Docker Compose setup guide
- **[Architecture](docs/ARCHITECTURE.md)** - System design and data flow
- **[Features](docs/FEATURES.md)** - Complete feature catalog
- **[API Reference](docs/README.md)** - REST API documentation
- **[User Guide](docs/USER_GUIDE.md)** - Server owner guide
- **[Admin Guide](docs/ADMIN_GUIDE.md)** - System operator guide
- **[Plugin System](docs/PLUGIN_SYSTEM.md)** - Plugin development guide
- **[CONTRIBUTING.md](CONTRIBUTING.md)** - Contribution guidelines
