# Self-hosted CI runners

CI runs on two ephemeral rootless Podman runners on our own hardware
(labels `[self-hosted, Linux, X64, catalyst-ci]`). Each job gets a fresh
container that is destroyed afterwards. No Blacksmith runners remain.

## What runs where

| Job | Runner |
|-----|--------|
| Lint, test, build, Docker publish (`ci.yml`) | Self-hosted, except fork and Dependabot PRs |
| Agent release, version image publish (`auto-version.yml`) | Self-hosted (push to `main` only) |
| Fork and Dependabot pull requests (lint, test) | GitHub-hosted `ubuntu-latest` |
| Discord notifications, benchmark harness check | GitHub-hosted `ubuntu-latest` |
| Live benchmark (LXC lab) | None — needs a dedicated host runner, stays skipped |

Fork and Dependabot PRs never touch our hardware: `ci.yml` routes `pull_request` jobs from
forks and `dependabot/*` branches to `ubuntu-latest`. Same-repo pushes and internal PRs use the
self-hosted pool. As a second layer, keep **Require approval for fork pull
request workflows** enabled in Settings → Actions.

## Security properties

- One job per container (`--ephemeral` + `--rm`); fresh registration token per
  spawn, and the host credential never enters a job container.
- Rootless user namespace, dropped capabilities, `no-new-privileges`, no
  `--privileged`, no host network, no `docker.sock` mount.
- Per-job resource caps (memory, CPUs, PIDs) and `timeout-minutes` on every job.
- The test job starts its own throwaway Postgres cluster
  (`scripts/ci/ci-postgres.sh`) — no shared database.
- Container images build via buildah chroot isolation, never a shared daemon.

## Operations

```bash
systemctl --user status gh-catalyst-runner
journalctl --user -u gh-catalyst-runner -f
gh api repos/catalystctl/catalyst/actions/runners --jq '.runners[]|{name,status,busy}'
```

Runner sources live in `infra/self-hosted-runners/` (see its README for image
rebuilds and cache resets).
