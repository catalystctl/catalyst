# Docker Automated Testing

This document describes the Docker-based E2E testing system for Catalyst. It builds local Docker images and runs the full test suite against containerized services.

## Quick Start

```bash
# Run the full Docker E2E test suite
cd tests
./run-docker-tests.sh
```

## Prerequisites

- **Docker** 20.10+ (with BuildKit support)
- **Docker Compose** 2.0+
- **bash** 4.0+
- **jq** — JSON processing
- **curl** — HTTP requests
- **openssl** — Secret generation
- **ssh-keygen** — SFTP host key generation

Install prerequisites on Ubuntu/Debian:

```bash
sudo apt-get update
sudo apt-get install -y jq curl openssl openssh-client
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    run-docker-tests.sh                       │
│  (Orchestrator — CLI, logging, three-phase execution)       │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        ┌─────────┐    ┌──────────┐    ┌──────────┐
        │ Phase 1 │    │ Phase 2  │    │ Phase 3  │
        │ Build   │ →  │ Setup    │ →  │ Run      │
        │ Images  │    │ Environment│   │ Tests    │
        └─────────┘    └──────────┘    └──────────┘
              │               │               │
              ▼               ▼               ▼
        docker compose    docker-env.sh   run-all-tests.sh
        build             .env.test       (14 test suites)
```

## Running Tests Locally

### Full Suite

```bash
cd tests
./run-docker-tests.sh
```

This will:
1. Build `catalyst-backend:test` and `catalyst-frontend:test` images from local source
2. Generate a test `.env` file with randomized ports and secrets
3. Start all services with Docker Compose
4. Wait for healthchecks to pass
5. Run database migrations and seed data
6. Execute all 14 core E2E test suites
7. Clean up containers and volumes

### Single Test Suite

```bash
./run-docker-tests.sh --suite 01-auth.test.sh
```

### Skip Image Build (Use Existing)

```bash
./run-docker-tests.sh --skip-build
```

Useful when you've already built the images and want to re-run tests quickly.

### Verbose Output

```bash
./run-docker-tests.sh --verbose
```

Shows all test output in real-time instead of saving to log files.

### Keep Containers for Debugging

```bash
./run-docker-tests.sh --skip-cleanup
```

Leaves containers running after tests so you can inspect them:

```bash
cd catalyst-docker
docker compose -f docker-compose.yml -f docker-compose.test.yml --env-file .env.test ps
docker compose -f docker-compose.yml -f docker-compose.test.yml --env-file .env.test logs backend
```

### Stop on First Failure

```bash
./run-docker-tests.sh --stop-on-failure
```

## Environment Variables

The orchestrator automatically generates a test environment file (`catalyst-docker/.env.test`) with:

| Variable | Description |
|----------|-------------|
| `BACKEND_PORT` | Randomized backend port (20000–60000) |
| `FRONTEND_PORT` | Randomized frontend port |
| `POSTGRES_PORT` | Randomized PostgreSQL port |
| `REDIS_PORT` | Randomized Redis port |
| `SFTP_PORT` | Randomized SFTP port |
| `BETTER_AUTH_SECRET` | Secure random secret (base64, 32 bytes) |
| `POSTGRES_PASSWORD` | Secure random password |
| `REDIS_PASSWORD` | Secure random password |
| `PUBLIC_URL` | Points to `http://127.0.0.1:<frontend_port>` |
| `SFTP_HOST_KEY` | Auto-generated ED25519 host key |

You can also set these environment variables before running:

| Variable | Description |
|----------|-------------|
| `TEST_LOG_DIR` | Where logs are saved (default: `/tmp/catalyst-docker-tests`) |
| `BACKEND_URL` | Auto-set by the orchestrator — do not override manually |

## Test Logs

All logs are saved to `TEST_LOG_DIR` (default: `/tmp/catalyst-docker-tests`):

```
/tmp/catalyst-docker-tests/
├── orchestrator.log       # Main orchestrator output
├── build-backend.log      # Backend image build output
├── build-frontend.log     # Frontend image build output
├── build-agent.log        # Agent image build output
├── db-migration.log       # Database migration output
├── db-seed.log            # Database seed output
├── cleanup.log            # Cleanup output
├── 01-auth.test.sh.log    # Individual test suite logs
├── 02-templates.test.sh.log
└── ...
```

## CI Integration

The GitHub Actions workflow (`.github/workflows/docker-e2e.yml`) runs automatically on:

- **Pull requests** to `main` or `develop` (when relevant files change)
- **Pushes** to `main` (when relevant files change)

The workflow:
1. Checks out the repository
2. Sets up Docker Buildx with layer caching
3. Installs dependencies (`jq`, `curl`, `openssl`)
4. Runs the full Docker E2E test suite with `--verbose`
5. Uploads test logs as artifacts (always)
6. Captures container logs on failure
7. Cleans up containers on failure

### Workflow Triggers

The workflow triggers when any of these paths change:

```yaml
paths:
  - 'catalyst-backend/**'
  - 'catalyst-frontend/**'
  - 'catalyst-agent/**'
  - 'catalyst-docker/**'
  - 'tests/**'
  - '.github/workflows/docker-e2e.yml'
```

## Files Reference

| File | Purpose |
|------|---------|
| `tests/run-docker-tests.sh` | Main orchestrator script |
| `tests/lib/docker-env.sh` | Environment generation library |
| `tests/lib/utils.sh` | Docker helper functions (wait, logs, cleanup) |
| `catalyst-docker/docker-compose.test.yml` | Test-specific Compose override |
| `catalyst-docker/.env.test` | Auto-generated test environment (temporary) |
| `.github/workflows/docker-e2e.yml` | GitHub Actions CI workflow |
| `tests/DOCKER_TESTING.md` | This documentation |

## Troubleshooting

### Port Conflicts

If you see "port already allocated" errors, the orchestrator will try up to 50 random ports per service. If conflicts persist:

```bash
# Check what's using the ports
sudo ss -tlnp | grep -E '20000|30000|40000|50000|60000'

# Or manually specify ports in catalyst-docker/.env.test
```

### Build Failures

If image builds fail, check the build logs:

```bash
cat /tmp/catalyst-docker-tests/build-backend.log
cat /tmp/catalyst-docker-tests/build-frontend.log
```

Common issues:
- Missing `bun.lock` or `package.json` changes not committed
- Docker daemon not running
- Insufficient disk space (`docker system df`)

### Services Not Healthy

If services fail healthchecks:

```bash
# Run with --skip-cleanup and inspect
cd catalyst-docker
docker compose -f docker-compose.yml -f docker-compose.test.yml --env-file .env.test ps
docker compose -f docker-compose.yml -f docker-compose.test.yml --env-file .env.test logs backend
```

### Database Migration Failures

If migrations fail, the backend container may not have connectivity to postgres:

```bash
# Test connectivity from backend container
docker exec catalyst-backend-test pg_isready -h postgres -U catalyst
```

## Development Tips

### Iterating Quickly

For rapid iteration during development:

```bash
# Build once, test many times
cd tests
./run-docker-tests.sh --skip-build --skip-cleanup

# Then run individual suites against running containers
BACKEND_URL=$(./lib/docker-env.sh get_test_backend_url 2>/dev/null || echo "http://127.0.0.1:3000")
export BACKEND_URL
bash 01-auth.test.sh
```

### Testing Agent-Related Suites

Some test suites (07, 21, 24) require the agent container. The orchestrator builds the agent image but starts it in a paused state (`sleep infinity`). Tests that need the agent will configure and start it dynamically.

### Adding New Test Suites

To add a new test suite:

1. Create `tests/XX-your-suite.test.sh`
2. Source `lib/utils.sh` and `config.env`
3. Use the assertion helpers (`assert_equals`, `assert_http_code`, etc.)
4. Call `print_test_summary` at the end
5. Add the suite to `TEST_SUITES` in `run-all-tests.sh`

## Security Considerations

- Test secrets are auto-generated per-run and never committed
- SFTP host keys are generated fresh for each test run
- Containers are isolated with randomized ports
- All test data is destroyed on cleanup (`docker compose down -v`)
- The `.env.test` file is created in `.gitignore` territory (it is explicitly removed on cleanup)

## Future Enhancements

- [ ] Parallel test suite execution
- [ ] Agent container automatic startup for agent-dependent tests
- [ ] Multi-arch image builds (ARM64 + AMD64)
- [ ] Test result reporting to GitHub PR comments
- [ ] Snapshot testing for container image sizes
