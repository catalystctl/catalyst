# AGENTS.md

Agent instructions for the Catalyst monorepo (game-server control panel).

## Layout

- `catalyst-backend/` — Fastify 5 + Prisma 7 + PostgreSQL, TypeScript ESM. Vitest runs against the dev database.
- `catalyst-frontend/` — React 19 + Vite + Tailwind 4 + i18next, TypeScript.
- `catalyst-agent/` — the Rust node agent (`cargo`).
- `packages/plugin-sdk/`, `packages/plugin-sdk-cli/` — plugin SDKs.
- Plugin frontends live in the separate `catalystctl/catalyst-plugins` repo. CI checks it out to `catalyst-plugins/`; the panel build globs it in, so a local build needs that directory present.

## Verify before claiming something works

These are the gates CI runs. Run the ones your change touches — for anything
non-trivial, all of them:

| Area | Command |
|------|---------|
| Backend lint | `pnpm --filter catalyst-backend run lint` |
| Frontend lint | `pnpm --filter catalyst-frontend run lint` |
| Backend types | `pnpm --filter catalyst-backend run typecheck` |
| Frontend types | `cd catalyst-frontend && npx tsc --noEmit` (the Vite build does not type-check) |
| Tests | `pnpm --filter catalyst-backend run test`, `pnpm --filter catalyst-frontend run test` |
| Rust | `cargo fmt --manifest-path catalyst-agent/Cargo.toml -- --check`, `cargo clippy --manifest-path catalyst-agent/Cargo.toml -- -D warnings`, `cargo test --manifest-path catalyst-agent/Cargo.toml` |
| Builds | `pnpm run build:backend`, `pnpm run build:frontend` |
| Translations | `pnpm i18n:check`, `pnpm i18n:hardcoded`, `pnpm --filter catalyst-frontend run i18n:verify` |

`./run-workflow.sh` emulates the whole pipeline locally (`EVENT=push TARGET=all ./run-workflow.sh`); keep it in sync with `.github/workflows/ci.yml`.

## CI and releases

- Pull requests run `ci.yml` gates (lint → test → build verification). Pushing to `main` skips CI and runs `auto-version.yml` only: conventional commits decide the bump, and it tags, publishes the GHCR images, the agent release and the GitHub release. Keep PRs green before pushing — direct pushes to `main` are ungated.
- CI installs with `pnpm@latest` (12.x) and `--frozen-lockfile`. A dependency whose install script is not approved fails the install *and* the Docker image builds — approve it under `allowBuilds` in `pnpm-workspace.yaml`.
- pnpm settings that matter (overrides, `minimumReleaseAge`, hoisted linker, `allowBuilds`) live in `pnpm-workspace.yaml`; `.npmrc` only carries auth/registry settings on pnpm 11+.
- `cargo audit` and `cargo deny` are blocking; the zizmor workflow lint is advisory.
- Work in this repo is landed by pushing to `main`. Open a PR only when asked.

## i18n rules

- English (`en`) is the source language; every user-visible string goes through `t()`.
- Catalogs: `catalyst-frontend/src/i18n/locales/{en,fr,zh-CN}/<namespace>.json` and `catalyst-backend/src/i18n/locales/{en,fr,zh-CN}/email.json` (account emails and alerts).
- Add the string in code first, then run `pnpm --filter catalyst-frontend run i18n:extract`. The extractor owns key order — never hand-reorder or invent keys; `i18n:verify` fails when the catalogs drift from the code.
- Add every new key to `en`, `fr` and `zh-CN` in the same change: `pnpm i18n:check` requires every translated locale to stay 100% translated (`--strict` also fails on empty values).
- Backend errors carry stable codes from `catalyst-backend/src/lib/error-codes/*.ts`; the frontend translates them (`errors.json`, `src/i18n/api-errors.ts`). Emit with `apiError(reply, status, code, message, { params })` and pass `params` for every `{{placeholder}}` in the message.
- `pnpm i18n:hardcoded` enforces that: CI fails on any literal string the linter
  finds that is neither translated nor listed in `scripts/i18n-hardcoded-baseline.json`
  (each entry there carries a reason). Wrap new copy in `t()`; for text that must
  stay literal, record it with `node scripts/i18n-hardcoded-check.mjs --update`
  and explain why.
- `docs/i18n.md` lists what is deliberately left in English (stored data, console output, product names, third-party plugin UI). Chinese uses the formal 您 form, French the formal vous form.
- The zh-CN and fr catalogs were produced by machine translation; wording fixes from native speakers are wanted (issue #251).

## Conventions

- Conventional commits: the release workflow derives minor/patch bumps from them (`feat:` minor, `fix:` patch).
- Tests live next to the code (`src/__tests__/`, `src/**/__tests__/`). Backend tests hit the real dev database and must clean up the rows they create.
- When behaviour changes, update the matching doc (`docs/i18n.md`, `docs/admin-guide.md`, `docs/api-reference.md`).
- Comments stay short and factual; explain non-obvious constraints only.
- When a change alters anything a user sees in the panel, verify it in the browser (sign-in and admin flows) before reporting it as done.

## Database migrations

- Any change to `catalyst-backend/prisma/schema.prisma` (new column, table, index or enum) must ship with a committed migration under `catalyst-backend/prisma/migrations/` in the same change, generated with `pnpm --filter catalyst-backend run db:migrate`.
- Containers only run `prisma migrate deploy` at startup (`catalyst-backend/docker-entrypoint.sh`); it applies committed migration files and never diffs `schema.prisma`. A schema change without a migration is invisible to customers' databases, and their backend fails at runtime (a missing `SystemSetting.defaultLocale` column once broke login with HTTP 500).
- Never edit or delete an already-applied migration; add a new one instead.

## Local environment

- `pnpm install`, then `pnpm run dev` (backend :3000, frontend :5173). `pnpm run dev:infra` starts PostgreSQL and Redis through docker/podman compose (`catalyst-docker/`).
- Local admin account: `pnpm run db:seed:admin` (see `catalyst-backend/prisma/seed-admin.ts`).
- `prisma db push` against a long-lived dev database reports dropping legacy columns (for example `dnsEnabled`). Read what it wants to drop; for local work add new columns with plain SQL instead of accepting data loss.
- Never print `catalyst-backend/src/services/mailer.ts` wholesale — it embeds a ~2 MB base64 logo on a single line.
