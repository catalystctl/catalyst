# Catalyst E2E test suites

Bash end-to-end tests that drive a running Catalyst stack through its REST API,
WebSocket gateway and node agent. They are separate from the Vitest suites that
live next to the code (`catalyst-backend/src/__tests__/`,
`catalyst-frontend/src/**/__tests__/`).

## Prerequisites

```bash
sudo apt-get install -y curl jq        # required by every suite
sudo apt-get install -y docker.io      # suites that start containers
```

Suites that deploy real containers (`08`, `10`, `15`–`19`, `21`, `24`) also
need `containerd`/`nerdctl` and a built agent binary (`cargo build --release` in
`catalyst-agent/`).

## Run

```bash
cd tests

./run-all-tests.sh                     # the 8 core suites, in order
./run-all-tests.sh --suite 04-servers.test.sh
./run-all-tests.sh --stop-on-failure
./run-all-tests.sh --verbose
./run-all-tests.sh --help

./04-servers.test.sh                   # any single suite, directly
```

`run-all-tests.sh` runs only the core suites listed in its `TEST_SUITES` array
(`01`–`10`). The newer suites (`15`–`30`) are run individually — most need a
deployed node, a real agent, or root, so they are not part of the default pass.

Logs land in `$TEST_LOG_DIR` (default `/tmp/catalyst-tests`), one
`<suite>.test.sh.log` per suite.

### Docker orchestrator

`run-docker-tests.sh` builds the images, generates `catalyst-docker/.env.test`
with random ports and secrets, and runs `run-all-tests.sh` against the compose
stack. See [DOCKER_TESTING.md](DOCKER_TESTING.md).

## Suites

| Suite | File | Covers | Core runner |
|---|---|---|---|
| 01 | `01-auth.test.sh` | Registration, login, token validation, auth security | ✅ |
| 02 | `02-templates.test.sh` | Template CRUD, variable substitution | ✅ |
| 03 | `03-nodes.test.sh` | Node CRUD, status tracking, deployment tokens | ✅ |
| 04 | `04-servers.test.sh` | Server CRUD, resource allocation | ✅ |
| 05 | `05-permissions.test.sh` | RBAC, ownership, access control | ✅ |
| 06 | `06-websocket.test.sh` | WebSocket connectivity, real-time messaging | ✅ |
| 08 | `08-container-lifecycle.test.sh` | Crash detection, state transitions, auto-restart, rate limiting | ✅ |
| 10 | `10-full-workflow.test.sh` | Complete user journey with real containers | ✅ |
| 15 | `15-full-deployment.test.sh` | User → node → server → container deployment | — |
| 16 | `16-real-container-deploy.test.sh` | Real container deployment end to end | — |
| 17 | `17-complete-deployment-flow.test.sh` | Auth → template → server → deploy → validation | — |
| 18 | `18-deployment-persistent.test.sh` | Deployment that leaves the container running for inspection | — |
| 19 | `19-system-setup.test.sh` | Automatic first-boot system initialisation | — |
| 20 | `20-alerts.test.sh` | Alert-rule CRUD and alert listing | — |
| 21 | `21-agent-containerd-deploy.test.sh` | Agent deployed inside containerd (nerdctl), node shows online | — |
| 22 | `22-resource-updates.test.sh` | Memory/CPU/disk updates through a server's lifecycle | — |
| 23 | `23-security-hardening.test.sh` | Security-hardening regressions | — |
| 24 | `24-real-agent-e2e.test.sh` | API → WebSocket → agent → container | — |
| 25 | `25-suspend-unsuspend.test.sh` | Suspension enforcement, task disabling, unsuspend restore | — |
| 26 | `26-subuser-lifecycle.test.sh` | Invites, access, SFTP cleanup, ownership transfer, user deletion | — |
| 27 | `27-agent-resilience.test.sh` | Agent↔panel chaos tests (~3–5 min) | — |
| 28 | `28-supply-chain.test.sh` | `install.sh` / `deploy-agent.sh` checksum and fingerprint helpers (offline) | — |
| 29 | `29-docker-port-wiring.test.sh` | Container-internal port consistency across compose, nginx and healthchecks | — |
| 30 | `30-fedora44-openat2.test.sh` | Fedora 44 `RestrictSUIDSGID` vs `openat2(2)` | — |

The LXC pipeline (`tests/e2e-lxc/`) is documented separately in
[e2e-lxc/README.md](e2e-lxc/README.md); it is the only suite wired into CI
(`.github/workflows/e2e-lxc.yml`).

## Configuration

The API-driving suites source `config.env` (`19`, `23`, `28`–`30` don't):

```bash
BACKEND_URL="http://localhost:3000"
BACKEND_WS_URL="ws://localhost:3000/ws"
DATABASE_URL="postgresql://catalyst:catalyst_dev@localhost:5432/catalyst_db"
SERVICE_TIMEOUT=30
CONTAINER_TIMEOUT=60
TEST_LOG_DIR="/tmp/catalyst-tests"
```

Export `BACKEND_URL`/`BACKEND_WS_URL` before running to point at a different
instance; `run-all-tests.sh` preserves values set in the environment.

## Helpers

`lib/utils.sh` provides assertions (`assert_equals`, `assert_http_code`,
`assert_json_field`, `assert_contains`), HTTP wrappers (`http_get`,
`http_post`, `http_put`, `http_patch`, `http_delete`, `parse_http_code`,
`parse_response`), waits (`wait_for_service`, `wait_for_condition`), cleanup
(`cleanup_docker_containers`, `cleanup_nerdctl_containers`,
`cleanup_docker_compose`, `setup_cleanup_trap`), logging (`log_info`,
`log_success`, `log_error`, `log_section`, `print_test_summary`) and data
generators (`random_string`, `random_email`, `random_port`, `unique_id`).

`lib/docker-env.sh` generates and reads the `.env.test` used by
`run-docker-tests.sh` (`generate_test_env`, `get_test_backend_url`,
`get_test_frontend_url`, `get_test_ws_url`, `check_docker_prerequisites`).

## Writing a suite

```bash
#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.env"
source "$SCRIPT_DIR/lib/utils.sh"

log_section "My suite"
setup_cleanup_trap cleanup

response=$(http_post "$BACKEND_URL/api/example" '{"key":"value"}')
assert_http_code "$(parse_http_code "$response")" "200" "endpoint returns 200"
assert_json_field "$(parse_response "$response")" "data.id" "expected-id" "id matches"

print_test_summary
```

Name the file `NN-name.test.sh`, make it executable, and add it to
`TEST_SUITES` in `run-all-tests.sh` only if it can run unattended against a
fresh local stack. Use `unique_id()` for resource names, always install a
cleanup trap, and assert both success and failure paths.

## Troubleshooting

| Symptom | Check |
|---|---|
| Everything 401/403 | `curl -s $BACKEND_URL/health`; the stack must be seeded (`pnpm run db:seed` at the repo root) |
| Connection refused | Backend not running — `pnpm run dev` from the repo root |
| Database errors | `pnpm run dev:infra` (Postgres + Redis), then `pnpm --filter catalyst-backend run db:push` |
| Container suites skip/fail | `sudo systemctl status containerd`; agent binary at `catalyst-agent/target/release/catalyst-agent` |

Debug a single suite with `bash -x ./01-auth.test.sh`.
