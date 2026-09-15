# Catalyst Documentation

Public product documentation lives on the docs site:

**[docs.catalystctl.com](https://docs.catalystctl.com)**
([source](https://github.com/catalystctl/catalyst-doc), also vendored here as
the `catalyst-doc/` submodule — clone with `git clone --recurse-submodules`
or run `git submodule update --init --recursive`).

- Game-server owners → *Game Server Guide* (console, files, SFTP, backups,
  databases, tasks, networking, subusers).
- Operators → *Administrator Guide* (install, nodes, networking, storage,
  roles, templates, updates, migration, disaster recovery).
- Integrators → *API & Developers* (auth, errors, pagination, WebSockets,
  guides, generated API reference).
- Everyone stuck → *Troubleshooting*.

## Internal docs (stay in this repo)

These are contributor/engineering references, not published on the docs site:

| Document | Description |
|----------|-------------|
| [Agent Guide](agent.md) | Rust agent internals and node deployment detail |
| [Architecture Overview](architecture.md) | System design, data flow, security model |
| [Development Guide](development.md) | Dev environment, testing, code style |
| [i18n Guide](i18n.md) | Translation workflow and conventions |
| [Environment Variables](environment-variables.md) | Canonical variable reference (summarized on the docs site) |
| [Redis](redis.md) | Redis setup and operations reference |
| [Plugin System Guide](plugins.md) | Full plugin engineering reference (overview on the docs site) |
| [Security Policy](SECURITY.md) | Vulnerability reporting and threat model |
| [Egg Migration Audit](egg-migration-audit.md) | Point-in-time Pterodactyl egg audit |
| [Self-Hosted Runners](self-hosted-runners.md) | CI runner operations |
| [Benchmarks](benchmarks.md) | Benchmark methodology and results |

`screenshots/` holds product screenshots used by the root README.
