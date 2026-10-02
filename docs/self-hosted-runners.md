# Self-hosted CI runners

**PR gates** run on four ephemeral rootless Podman runners on our own hardware
(labels `[self-hosted, Linux, X64, catalyst-ci]`). Each job gets a fresh
container that is destroyed afterwards. No Blacksmith runners remain.

Release builds do not use this pool — see
[Why release builds are not on the self-hosted pool](#why-release-builds-are-not-on-the-self-hosted-pool).

## What runs where

| Job | Runner |
|-----|--------|
| PR gates: lint, test, build verification (`ci.yml`) | Self-hosted, except fork and Dependabot PRs |
| Musl agent release (`auto-version.yml`) | GitHub-hosted, native per arch (`ubuntu-latest` x86_64, `ubuntu-24.04-arm` aarch64) |
| Release notes / draft release (`auto-version.yml`) | GitHub-hosted `ubuntu-latest` |
| Version image publish (`auto-version.yml`) | GitHub-hosted `ubuntu-latest` / `ubuntu-24.04-arm` with Buildx GHA cache |
| Fork and Dependabot pull requests (lint, test, build) | GitHub-hosted `ubuntu-latest` |
| Pushes to `main` | No CI gates — straight to `auto-version.yml` release |
| Discord notifications, benchmark harness check | GitHub-hosted `ubuntu-latest` |
| Live benchmark (LXC lab) | None — needs a dedicated host runner, stays skipped |

Fork and Dependabot PRs never touch our hardware: `ci.yml` runs on pull requests
only, routing jobs from forks and `dependabot/*` branches to `ubuntu-latest`
while internal PR jobs use the self-hosted pool. Pushes to `main` skip CI and
go straight to the `auto-version.yml` release, so keep PRs green before pushing
— direct pushes are ungated. As a second layer, keep **Require approval for fork pull
request workflows** enabled in Settings → Actions.

## Why release builds are not on the self-hosted pool

`auto-version.yml` runs entirely on GitHub-hosted runners, so a release never
competes with the production panel or the second pool on the runner host:

- **Agent binaries** build natively per architecture — x86_64 on
  `ubuntu-latest`, aarch64 on `ubuntu-24.04-arm` — instead of cross-compiling
  ARM from an x86 runner with `/opt/aarch64-linux-musl-cross`. Each leg gets
  4 vCPU / 16 GB rather than sharing 3 vCPU / 4 GB slots, and both legs start
  immediately instead of queueing behind whatever else holds the pool.
- **Container images** already built this way (`publish-images`).
- **PR CI** therefore cannot occupy the slots a release needs, and vice versa.

The tradeoff is cache locality: hosted runners are ephemeral and start empty.
`agent-release` installs its toolchain per job and keeps `sccache` in front of
the compile with the **GHA cache backend**, so repeat releases still reuse
compiled objects instead of recompiling every crate. `/cache/sccache` remains
in use only by the self-hosted PR jobs in `ci.yml`.

Only `ci.yml` (PR gates), `e2e-lxc.yml` and the benchmark `live` job still use
the self-hosted pool.

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
