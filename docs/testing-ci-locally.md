# Testing CI/CD Locally

Two options for testing CI/CD locally before committing:

## Option 1: Quick Local Testing (Recommended)

**Fastest option** - runs CI steps directly on your machine without Docker overhead.

```bash
# Test everything
./test-ci-quick.sh

# Test specific components
./test-ci-quick.sh backend
./test-ci-quick.sh agent
./test-ci-quick.sh security
```

**Pros:**
- Very fast (seconds instead of minutes)
- Uses your local environment (same as development)
- Simple and easy to debug

**Cons:**
- Doesn't test in containerized environment
- Requires local dependencies installed

---

## Option 2: act (Full GitHub Actions Simulation)

Use `act` to test GitHub Actions workflows in Docker containers (exact CI environment).

### Quick Start

```bash
# List all workflows
./test-ci-locally.sh list

# Test backend CI
./test-ci-locally.sh backend

# Test agent CI
./test-ci-locally.sh agent

# Test specific job
./test-ci-locally.sh job backend-ci.yml test

# Dry run (see what would execute)
act --list
act -n  # dry-run mode
```

### Direct act Commands

```bash
# Test all workflows
act

# Test only push events
act push

# Test specific workflow
act -W .github/workflows/backend-ci.yml

# Test specific job
act -W .github/workflows/backend-ci.yml -j test

# Use specific platform image (override self-hosted)
act -P self-hosted=node:20-bullseye

# Run with secrets (if needed)
act --secret-file .env.secrets

# Verbose output
act -v

# List what would run
act --list
```

### Common Use Cases

#### Test backend changes before commit
```bash
cd /root/catalyst3
./test-ci-locally.sh backend
```

#### Test only the build job
```bash
act -W .github/workflows/backend-ci.yml -j test
```

#### Test with custom container
```bash
act -P self-hosted=rust:1.75-bullseye -W .github/workflows/agent-ci.yml
```

### Limitations

- Some GitHub-specific features may not work (e.g., GitHub token, artifacts)
- Service containers may need additional setup
- Self-hosted runner labels are mapped to Docker images
- GITHUB_TOKEN is simulated (not real)
- **Much slower than quick local testing** (Docker-in-Docker overhead)

### Troubleshooting

**Problem:** Permission denied on Docker socket
```bash
sudo usermod -aG docker $USER
# Then log out and back in
```

**Problem:** Container architecture mismatch
```bash
act --container-architecture linux/amd64
```

**Problem:** Out of disk space
```bash
docker system prune -a
```

---

## Recommendation

**Use `test-ci-quick.sh` for fast iteration** - it runs the exact same checks as CI without Docker overhead.

**Use `act` only when you need to:**
- Test the exact containerized CI environment
- Debug CI-specific issues
- Test service containers (PostgreSQL, etc.)

## More Info

- act documentation: https://github.com/nektos/act
- Installed version: `act --version`
