# Self-hosted runners for catalystctl/catalyst

Ephemeral, rootless Podman runner pool. Each CI job runs in a fresh container
that is destroyed afterwards. The host supervisor never exposes its GitHub
credential to jobs.

## Layout

| file | purpose |
|------|---------|
| `Containerfile` | runner image (Node 22, pnpm, Rust, protoc, postgres, buildah, cross linkers) |
| `entrypoint.sh` | register `--ephemeral`, run one job, exit |
| `supervisor.sh` | keep `CONCURRENCY` containers alive, fresh token per spawn |
| `gh-catalyst-runner.service` | systemd user unit |
| `../../scripts/ci/ci-postgres.sh` | per-job Postgres starter used by the test job |

## Security model (public repo)

`catalystctl/catalyst` is public, so any fork can open a pull request whose
workflow run executes attacker-controlled code (the checked-out PR). The pool
is hardened for that threat:

- **Ephemeral**: `--ephemeral` + `--rm`. One job per container, then the
  container and its GitHub registration are gone. No persistence for backdoors.
- **Rootless**: container root maps to the unprivileged host user. Jobs cannot
  read the host home directory, other services, or host secrets.
- **Fork and Dependabot routing**: pull-request jobs from forks and
  `dependabot/*` branches run on GitHub-hosted `ubuntu-latest`, never here.
  Only same-repo pushes and internal non-Dependabot PRs reach these runners
  (see `runs-on` expressions in `ci.yml`). `ci.yml` is PR gates only; pushes
  to `main` go straight to `auto-version.yml` release builds.
- **Token hygiene**: the supervisor mints a fresh 1-hour registration token per
  spawn. The `gh` credential lives only in the supervisor process on the host.
- **Least capability**: containers drop all capabilities except the file-ownership
  set needed to run, plus `no-new-privileges`. No `--privileged`, no host
  network, no `docker.sock` mount, no host path mounts except the `/cache` volume.
- **Resource caps**: `--memory`, `--cpus`, `--pids-limit` per container so a
  runaway job cannot starve the host or production services.
- **Per-job database**: the test job starts its own throwaway Postgres cluster
  in a temp dir. No shared database server, no cross-job rows.
- **Image builds without a daemon**: container images build via buildah chroot
  isolation. No Docker daemon socket is ever exposed to jobs.
- **Pinned supply chain**: third-party actions are pinned to SHAs, protoc and
  toolchain tarballs are sha256-checked at image build time.
- **Timeouts**: every self-hosted job sets `timeout-minutes`.

Residual risk: the per-slot `/cache` volume is shared across that slot's runs,
so a malicious job could poison cached modules for the next job on the same
slot. Acceptable because only trusted (same-repo, non-Dependabot) code reaches these runners;
to fully reset, drop the volumes and restart the pool.

## Manage (host)

```bash
systemctl --user status gh-catalyst-runner
journalctl --user -u gh-catalyst-runner -f
gh api repos/catalystctl/catalyst/actions/runners --jq '.runners[]|{name,status,busy}'
podman logs -f catalyst-ci-$(hostname -s)-0
systemctl --user restart gh-catalyst-runner
podman volume rm gh-catalyst-cache-0 gh-catalyst-cache-1  # full cache reset
```

## Rebuild the image

```bash
cd ~/catalyst/infra/self-hosted-runners
podman build -f Containerfile -t localhost/gh-runner-catalyst:latest .
systemctl --user restart gh-catalyst-runner
```
