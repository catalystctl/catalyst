# Prisma Streams Security Policy

## Supported Versions

Security fixes are currently provided on the active main branch only. There are no long-lived release branches yet.

## Reporting A Vulnerability

Please do not open a public GitHub issue for security vulnerabilities.

Use GitHub's private vulnerability reporting flow for this repository if it is enabled. If that is not available, contact the maintainers privately before disclosing the issue publicly.

When reporting a vulnerability, include:

- The affected commit, branch, or version
- Your deployment mode: full server or local development server
- Reproduction steps or a minimal proof of concept
- Any relevant logs, traces, or configuration details

## Current Security Posture

Prisma Streams does **not** currently implement built-in authentication or authorization.

That has concrete deployment consequences:

- Do not expose the server directly to the public internet.
- Run the full server behind a trusted reverse proxy, API gateway, VPN boundary, or other authenticated network perimeter.
- Terminate TLS outside the server.
- Treat the local development server as a loopback-only tool for trusted local workflows such as `npx prisma dev`.

The local development server is intentionally optimized for local integration, not hostile-network deployment.

More detail is documented in [auth.md](./auth.md).
