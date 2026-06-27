# Catalyst E2E Test Suite

Comprehensive end-to-end testing for the Catalyst game server management system.

## Overview

This test suite provides **real** E2E testing that validates the entire Catalyst stack:
- Backend REST API (TypeScript/Fastify)
- WebSocket communication
- Agent-Backend integration (Rust)
- Container lifecycle with **real containerd** (no mocks)
- Security & permissions
- Error handling & edge cases

## Quick Start

### Prerequisites

```bash
# Required
sudo apt-get install -y curl jq docker.io

# Optional (for advanced tests)
cargo install websocat  # WebSocket client
```

### Run All Tests

```bash
cd /root/catalyst3/tests
./run-all-tests.sh
```

### Run Specific Test Suite

```bash
cd /root/catalyst3/tests
./01-auth.test.sh           # Authentication tests
./02-templates.test.sh      # Template CRUD tests
./04-servers.test.sh        # Server management tests
./10-full-workflow.test.sh  # Complete E2E workflow
```

### Run With Options

```bash
# Run specific suite
./run-all-tests.sh --suite 01-auth.test.sh

# Stop on first failure
./run-all-tests.sh --stop-on-failure

# Verbose output
./run-all-tests.sh --verbose

# Help
./run-all-tests.sh --help
```

## Test Suites

### Phase 1: Backend API Tests

| Suite | File | Tests | Description |
|-------|------|-------|-------------|
| **01** | `01-auth.test.sh` | 14 | User registration, login, JWT validation, security |
| **02** | `02-templates.test.sh` | 11 | Template CRUD, variable substitution |
| **03** | `03-nodes.test.sh` | 12 | Node management, deployment tokens |
| **04** | `04-servers.test.sh` | 13 | Server CRUD, resource allocation |
| **05** | `05-permissions.test.sh` | 6 | RBAC, ownership, access control |

### Phase 2: Integration Tests

| Suite | File | Tests | Description |
|-------|------|-------|-------------|
| **06** | `06-websocket.test.sh` | TBD | WebSocket connectivity, real-time messaging |
| **08** | `08-container-lifecycle.test.sh` | TBD | Container create, start, stop, delete |

### Phase 3: End-to-End Workflows

| Suite | File | Tests | Description |
|-------|------|-------|-------------|
| **10** | `10-full-workflow.test.sh` | 18 | Complete user journey with real containers |

## Test Coverage

### ✅ Implemented (5 suites, ~60 tests)
- ✅ Authentication & JWT
- ✅ Templates CRUD
- ✅ Node Management
- ✅ Server Management
- ✅ RBAC & Permissions
- ✅ Full E2E Workflow (with real containers)

### 🚧 Planned (9 suites)
- 🚧 WebSocket real-time communication
- 🚧 Agent connectivity & lifecycle
- 🚧 Container operations (detailed)
- 🚧 File operations
- 🚧 Multi-server scenarios
- 🚧 Failure & recovery
- 🚧 Load & performance
- 🚧 Security penetration

## Test Infrastructure

### Configuration

Edit `config.env` to customize:
```bash
export BACKEND_URL="http://localhost:3000"
export BACKEND_WS_URL="ws://localhost:3000/ws"
export DATABASE_URL="postgresql://aero:aero@localhost:5432/aero_test"
export SERVICE_TIMEOUT=30
```

### Utilities Library

`lib/utils.sh` provides:
- **Assertions**: `assert_equals`, `assert_http_code`, `assert_json_field`
- **HTTP Helpers**: `http_get`, `http_post`, `http_put`, `http_delete`
- **Wait Functions**: `wait_for_service`, `wait_for_condition`
- **Cleanup**: `cleanup_docker_containers`, `cleanup_nerdctl_containers`
- **Logging**: `log_info`, `log_success`, `log_error`, `log_section`
- **Data Generators**: `random_string`, `random_email`, `unique_id`

### Example Test

```bash
#!/bin/bash
set -e
source "$(dirname "$0")/config.env"
source "$(dirname "$0")/lib/utils.sh"

log_section "My Test Suite"

# Make HTTP request
response=$(http_post "$BACKEND_URL/api/endpoint" '{"key": "value"}')
http_code=$(parse_http_code "$response")
body=$(parse_response "$response")

# Assert results
assert_http_code "$http_code" "200" "Endpoint should return 200"
assert_json_field "$body" "data.id" "expected-id" "ID should match"

# Print summary
print_test_summary
```

## Running Tests in CI/CD

### GitHub Actions

```yaml
name: E2E Tests
on: [push, pull_request]
jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Start services
        run: docker-compose up -d
      - name: Run tests
        run: cd tests && ./run-all-tests.sh
      - name: Upload logs
        if: failure()
        uses: actions/upload-artifact@v3
        with:
          name: test-logs
          path: /tmp/catalyst-tests/
```

### Docker-based Testing

```bash
# Run tests in isolated container
docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v $(pwd):/workspace \
  -w /workspace/tests \
  ubuntu:22.04 \
  bash -c "apt-get update && apt-get install -y curl jq && ./run-all-tests.sh"
```

## Test Environment Setup

### 1. Start Backend Services

```bash
cd /root/catalyst3
docker-compose up -d  # PostgreSQL + Redis
cd catalyst-backend
npm install
npm run db:push
npm run db:seed
npm run dev  # Or: npm start for production build
```

### 2. Build Agent (for E2E tests)

```bash
cd /root/catalyst3/catalyst-agent
cargo build --release
# Binary: ./target/release/catalyst-agent
```

### 3. Verify Setup

```bash
curl http://localhost:3000/health
# Should return: {"status":"ok"}
```

### 4. Run Tests

```bash
cd /root/catalyst3/tests
./run-all-tests.sh
```

## Debugging Failed Tests

### View Test Logs

```bash
# All logs are saved to /tmp/catalyst-tests/
ls -la /tmp/catalyst-tests/

# View specific test log
cat /tmp/catalyst-tests/01-auth.test.sh.log

# View backend logs
cat /tmp/catalyst-backend-test.log

# View agent logs
cat /tmp/catalyst-agent-test.log
```

### Run Single Test With Verbose Output

```bash
cd /root/catalyst3/tests
bash -x ./01-auth.test.sh  # Shell debug mode
```

### Manual Test Execution

```bash
# Source utilities
source config.env
source lib/utils.sh

# Make test requests
response=$(http_get "$BACKEND_URL/health")
echo "$response"

# Check backend
curl -v http://localhost:3000/health
```

## Common Issues

### Backend Not Running

```bash
# Check if backend is running
curl http://localhost:3000/health

# Start backend
cd /root/catalyst3/catalyst-backend
npm run dev
```

### Database Connection Failed

```bash
# Check PostgreSQL
docker ps | grep postgres

# Restart database
docker-compose restart postgres

# Reset database
cd catalyst-backend
npm run db:push
npm run db:seed
```

### Agent Tests Failing

```bash
# Check if agent binary exists
ls -la /root/catalyst3/catalyst-agent/target/release/catalyst-agent

# Rebuild agent
cd /root/catalyst3/catalyst-agent
cargo build --release

# Check containerd
sudo systemctl status containerd
```

### Permission Errors

```bash
# Make scripts executable
chmod +x /root/catalyst3/tests/*.sh
chmod +x /root/catalyst3/tests/lib/*.sh

# Containerd requires sudo
sudo nerdctl ps  # Should work
```

## Adding New Tests

### 1. Create Test File

```bash
cat > tests/99-my-test.test.sh << 'EOF'
#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.env"
source "$SCRIPT_DIR/lib/utils.sh"

log_section "My New Test Suite"

# Your tests here
log_info "Test 1: Description"
response=$(http_get "$BACKEND_URL/api/endpoint")
http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "200" "Endpoint test"

print_test_summary
EOF

chmod +x tests/99-my-test.test.sh
```

### 2. Add to Test Runner

Edit `run-all-tests.sh` and add to `TEST_SUITES` array:
```bash
TEST_SUITES=(
    ...
    "99-my-test.test.sh"
)
```

### 3. Run Your Test

```bash
./tests/99-my-test.test.sh
```

## Best Practices

### ✅ Do's
- Use `unique_id()` for test resource names
- Always set up cleanup traps: `setup_cleanup_trap cleanup`
- Assert both success and failure cases
- Use meaningful assertion messages
- Log important steps with `log_info`
- Reset test data between suites

### ❌ Don'ts
- Don't hardcode IDs or names
- Don't leave test containers running
- Don't depend on other test suites
- Don't skip cleanup on failure
- Don't use `sleep` without comments explaining why

## Performance

### Test Execution Times

| Suite | Approximate Time |
|-------|------------------|
| Authentication | ~5 seconds |
| Templates | ~8 seconds |
| Nodes | ~8 seconds |
| Servers | ~10 seconds |
| Permissions | ~12 seconds |
| Full Workflow | ~60 seconds (with containers) |
| **Full Suite** | **~10-15 minutes** |

### Optimization Tips

- Run independent tests in parallel (future enhancement)
- Use smaller container images (Alpine)
- Reduce sleep delays where safe
- Skip heavy tests in quick CI runs

## Contributing

When adding tests:
1. Follow existing naming conventions (`NN-name.test.sh`)
2. Use the utilities library
3. Document what you're testing
4. Include both positive and negative cases
5. Clean up all resources
6. Update this README

## License

MIT - Same as Catalyst project

## Support

For issues or questions:
- Check test logs in `/tmp/catalyst-tests/`
- Review backend/agent logs
- Verify services are running
- Consult main Catalyst documentation in `/root/catalyst3/`

---

**Test Coverage**: 5/14 suites implemented (~60 tests)  
**Status**: ✅ Core functionality tested, 🚧 Advanced tests in progress  
**Last Updated**: 2026-01-24
