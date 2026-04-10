# Contributing to Prisma Streams

Welcome. This repository is being prepared for public production use, and contributions that improve correctness, operator experience, and protocol clarity are useful.

This file follows the same general baseline Prisma uses in [`prisma/prisma`](https://github.com/prisma/prisma), but is scoped to this repository and its Bun + TypeScript workflow.

Please read the [Code of Conduct](./code-of-conduct.md) before participating.

## Contributing Via Comments

To help maintainers triage efficiently:

- Use GitHub reactions on the main issue or comment to signal support.
- Add a comment only when you have new, actionable information: a reproduction, impact details, logs, or a concrete proposal.
- Avoid `+1`, `same here`, or `any update?` comments. They add notification noise without improving triage.

## Prerequisites

- Bun `>=1.3.6`
- Node.js `>=22`
- Git

For Windows development, use WSL or another Unix-like environment. The scripts and examples in this repository assume a POSIX shell.

## Setup

```bash
git clone <your-fork-or-repo-url>
cd prisma-streams
bun install
```

## Common Commands

```bash
bun run typecheck
bun run check:result-policy
bun test
bun run test:conformance:local
bun run test:conformance
```

Notes:

- `bun test` is the current fast repository baseline.
- `test:conformance:local` and `test:conformance` run the upstream black-box suite against local and full server modes.
- The current upstream conformance status is tracked in [conformance.md](./conformance.md).

## Development Expectations

- Keep changes focused. Avoid mixing refactors with unrelated cleanup.
- Add or update tests for behavior changes.
- Update documentation when public behavior, deployment guidance, or package surfaces change.
- Do not commit generated archives, local databases, `.DS_Store`, or other workstation artifacts.
- Follow the repository `better-result` policy. The current automated policy check covers `src/`; see [better-result-adoption.md](./better-result-adoption.md).

## Pull Requests

Before opening a pull request:

- Run `bun run verify`.
- If you touched protocol behavior, run the relevant conformance suite and note the result.
- Explain the motivation, scope, and any behavior changes clearly.
- Call out follow-up work instead of silently leaving partial migrations behind.

## Security Reports

Do not open public issues for suspected vulnerabilities. Follow [security.md](./security.md).
