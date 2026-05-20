#!/bin/bash
#
# Catalyst Docker E2E Test Orchestrator
# Builds local Docker images and runs the full E2E test suite in containers.
#
# Usage:
#   ./run-docker-tests.sh [OPTIONS]
#
# Options:
#   --skip-build          Skip image building (use existing)
#   --skip-cleanup        Don't cleanup containers after tests
#   --suite <name>        Run specific test suite only
#   --stop-on-failure     Stop on first test failure
#   --verbose             Show all test output
#   --logs-dir <path>     Custom logs directory (default: /tmp/catalyst-docker-tests)
#   --help                Show help message
#

set -euo pipefail

# ============================================================================
# Configuration
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CATALYST_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DOCKER_DIR="$CATALYST_ROOT/catalyst-docker"
TEST_ENV_FILE="$DOCKER_DIR/.env.test"
COMPOSE_FILES="-f $DOCKER_DIR/docker-compose.yml -f $DOCKER_DIR/docker-compose.test.yml"

# Save our script dir before sourcing libraries that may overwrite SCRIPT_DIR
ORCHESTRATOR_DIR="$SCRIPT_DIR"

# Default settings
SKIP_BUILD=false
SKIP_CLEANUP=false
SUITE=""
STOP_ON_FAILURE=false
VERBOSE=false
LOGS_DIR="/tmp/catalyst-docker-tests"

# Tracking
TEST_EXIT_CODE=0
BUILD_START_TIME=0
BUILD_END_TIME=0
ENV_START_TIME=0
ENV_END_TIME=0
TEST_START_TIME=0
TEST_END_TIME=0

# ============================================================================
# Load Libraries
# ============================================================================

source "$SCRIPT_DIR/lib/utils.sh"
source "$SCRIPT_DIR/lib/docker-env.sh"

# ============================================================================
# CLI Argument Parsing
# ============================================================================

parse_arguments() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --skip-build)
                SKIP_BUILD=true
                shift
                ;;
            --skip-cleanup)
                SKIP_CLEANUP=true
                shift
                ;;
            --suite)
                if [[ -z "${2:-}" ]]; then
                    log_error "--suite requires a test file name"
                    exit 1
                fi
                SUITE="$2"
                shift 2
                ;;
            --stop-on-failure)
                STOP_ON_FAILURE=true
                shift
                ;;
            --verbose)
                VERBOSE=true
                shift
                ;;
            --logs-dir)
                LOGS_DIR="$2"
                shift 2
                ;;
            --help|-h)
                show_help
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                show_help
                exit 1
                ;;
        esac
    done
}

show_help() {
    cat <<EOF
Catalyst Docker E2E Test Orchestrator

Usage: $(basename "$0") [OPTIONS]

Builds local Docker images and runs the E2E test suite against containerized
Catalyst services (auth, templates, settings, nodes, etc.).

Options:
  --skip-build          Skip image building (use existing images)
  --skip-cleanup        Don't cleanup containers after tests
  --suite <name>        Run specific test suite only (e.g., 01-auth.test.sh)
  --stop-on-failure     Stop on first test failure
  --verbose             Show all test output (not just failures)
  --logs-dir <path>     Custom logs directory (default: /tmp/catalyst-docker-tests)
  --help, -h            Show this help message

Examples:
  # Run full test suite
  ./run-docker-tests.sh

  # Run with verbose output
  ./run-docker-tests.sh --verbose

  # Run single suite, skip build
  ./run-docker-tests.sh --suite 01-auth.test.sh --skip-build

  # Run and keep containers for debugging
  ./run-docker-tests.sh --skip-cleanup

Environment Variables:
  TEST_LOG_DIR          Where logs are saved (overrides --logs-dir)
  BACKEND_URL           Auto-set by the orchestrator
  BACKEND_WS_URL        Auto-set by the orchestrator

Notes:
  - Agent image build is optional; some test suites will be skipped if unavailable
EOF
}

# ============================================================================
# Logging Setup
# ============================================================================

setup_logging() {
    # Use environment variable if set, otherwise CLI argument
    LOGS_DIR="${TEST_LOG_DIR:-$LOGS_DIR}"

    mkdir -p "$LOGS_DIR"

    # Create a main orchestrator log
    ORCHESTRATOR_LOG="$LOGS_DIR/orchestrator.log"

    log_info "Logs directory: $LOGS_DIR"
    log_info "Orchestrator log: $ORCHESTRATOR_LOG"

    # Redirect all output to both console and log file
    exec > >(tee -a "$ORCHESTRATOR_LOG")
    exec 2> >(tee -a "$ORCHESTRATOR_LOG" >&2)
}

# ============================================================================
# Phase 1: Build Images
# ============================================================================

build_images() {
    if $SKIP_BUILD; then
        log_section "Phase 1: Building Docker Images (SKIPPED)"
        log_info "Using existing images"
        return 0
    fi

    log_section "Phase 1: Building Docker Images"
    BUILD_START_TIME=$(date +%s)

    cd "$DOCKER_DIR"

    # Ensure .env.test exists for build context — docker compose build
    # interpolates ALL service variables even for services not being built,
    # so POSTGRES_PASSWORD (with :? in docker-compose.yml) must resolve.
    if [ ! -f "$TEST_ENV_FILE" ]; then
        log_info "No .env.test found, generating before build..."
        generate_test_env "$TEST_ENV_FILE"
    fi

    # Build backend image
    log_info "Building backend image..."
    docker compose $COMPOSE_FILES --env-file "$TEST_ENV_FILE" build backend \
        --build-arg BUILDKIT_INLINE_CACHE=1 \
        2>&1 | tee "$LOGS_DIR/build-backend.log"
    log_success "Backend image built: catalyst-backend:test"

    # Build frontend image
    log_info "Building frontend image..."
    docker compose $COMPOSE_FILES --env-file "$TEST_ENV_FILE" build frontend \
        --build-arg BUILDKIT_INLINE_CACHE=1 \
        2>&1 | tee "$LOGS_DIR/build-frontend.log"
    log_success "Frontend image built: catalyst-frontend:test"

    # Optionally build agent image
    log_info "Building agent image..."
    docker compose $COMPOSE_FILES --env-file "$TEST_ENV_FILE" build agent \
        --build-arg BUILDKIT_INLINE_CACHE=1 \
        2>&1 | tee "$LOGS_DIR/build-agent.log" || {
        log_warn "Agent image build failed (optional, some tests may be skipped)"
    }

    BUILD_END_TIME=$(date +%s)
    local duration=$((BUILD_END_TIME - BUILD_START_TIME))
    log_success "Image builds completed in ${duration}s"
}

# ============================================================================
# Phase 2: Setup Environment
# ============================================================================

setup_environment() {
    log_section "Phase 2: Setting Up Test Environment"
    ENV_START_TIME=$(date +%s)

    cd "$DOCKER_DIR"

    # Generate test environment (only if not already created during build phase)
    if [ ! -f "$TEST_ENV_FILE" ]; then
        log_info "Generating test environment..."
        generate_test_env "$TEST_ENV_FILE"
    else
        log_info "Using existing test environment from build phase"
    fi

    # Load the environment variables
    load_test_env "$TEST_ENV_FILE"

    # Export URLs for test scripts
    export BACKEND_URL
    BACKEND_URL=$(get_test_backend_url "$TEST_ENV_FILE")
    export BACKEND_URL

    export BACKEND_WS_URL
    BACKEND_WS_URL=$(get_test_ws_url "$TEST_ENV_FILE")
    export BACKEND_WS_URL

    export FRONTEND_URL
    FRONTEND_URL=$(get_test_frontend_url "$TEST_ENV_FILE")
    export FRONTEND_URL

    log_info "Backend URL: $BACKEND_URL"
    log_info "Frontend URL: $FRONTEND_URL"
    log_info "WebSocket URL: $BACKEND_WS_URL"

    # Stop any existing test containers
    log_info "Stopping any existing test containers..."
    docker compose $COMPOSE_FILES --env-file "$TEST_ENV_FILE" down -v 2>/dev/null || true

    # Start services (exclude agent — it's optional and its image may not build)
    log_info "Starting Docker Compose services..."
    docker compose $COMPOSE_FILES --env-file "$TEST_ENV_FILE" up -d backend frontend postgres redis

    # Wait for services to be healthy
    log_info "Waiting for services to be healthy..."
    if ! wait_for_compose_services "$DOCKER_DIR" 120; then
        log_error "Services failed to become healthy"
        capture_container_logs
        return 1
    fi

    # Wait for backend /health endpoint
    log_info "Waiting for backend /health endpoint..."
    if ! wait_for_service "${BACKEND_URL}/health" 60; then
        log_error "Backend health endpoint not responding"
        capture_container_logs
        return 1
    fi

    # Run database migrations
    log_info "Running database migrations..."
    if ! run_db_migrations; then
        log_error "Database migrations failed"
        capture_container_logs
        return 1
    fi

    ENV_END_TIME=$(date +%s)
    local duration=$((ENV_END_TIME - ENV_START_TIME))
    log_success "Test environment ready in ${duration}s"
}

# Run database migrations inside the backend container
run_db_migrations() {
    local backend_container
    backend_container=$(docker compose $COMPOSE_FILES --env-file "$TEST_ENV_FILE" ps -q backend)

    if [ -z "$backend_container" ]; then
        log_error "Backend container not found"
        return 1
    fi

    # Wait a moment for postgres to be fully ready
    sleep 2

    # Run db:push with force-reset for clean test state
    docker exec "$backend_container" sh -c \
        "cd /app && pnpm run db:push --force-reset" 2>&1 | tee "$LOGS_DIR/db-migration.log"

    local exit_code=${PIPESTATUS[0]}
    if [ $exit_code -ne 0 ]; then
        log_error "Database push failed with exit code $exit_code"
        return 1
    fi

    # Seed the database
    log_info "Seeding database..."
    docker exec "$backend_container" sh -c \
        "cd /app && pnpm run db:seed" 2>&1 | tee "$LOGS_DIR/db-seed.log"

    exit_code=${PIPESTATUS[0]}
    if [ $exit_code -ne 0 ]; then
        log_warn "Database seed failed with exit code $exit_code (continuing)"
        # Don't fail on seed — tests may create their own data
    fi

    log_success "Database migrations complete"
    return 0
}

# Capture container logs for debugging
capture_container_logs() {
    log_info "Capturing container logs..."
    local services=("backend" "frontend" "postgres" "redis")
    for service in "${services[@]}"; do
        get_container_logs "catalyst-${service}-test" 500 > "$LOGS_DIR/${service}-logs.txt" 2>&1 || true
    done
}

# ============================================================================
# Phase 3: Run Tests
# ============================================================================

run_tests() {
    log_section "Phase 3: Running E2E Tests"
    TEST_START_TIME=$(date +%s)

    cd "$ORCHESTRATOR_DIR"

    # Build arguments for run-all-tests.sh
    local test_args=()

    if [ -n "$SUITE" ]; then
        test_args+=("--suite" "$SUITE")
    fi

    if $STOP_ON_FAILURE; then
        test_args+=("--stop-on-failure")
    fi

    if $VERBOSE; then
        test_args+=("--verbose")
    fi

    # Set TEST_LOG_DIR for test suites
    export TEST_LOG_DIR="$LOGS_DIR"
    mkdir -p "$TEST_LOG_DIR"

    # Signal Docker E2E mode so test suites skip local-only steps
    export DOCKER_E2E_MODE=true

    log_info "Running test suites with BACKEND_URL=$BACKEND_URL"
    log_info "Test arguments: ${test_args[*]:-<none>}"

    # Run the test suite
    set +e
    bash "$ORCHESTRATOR_DIR/run-all-tests.sh" "${test_args[@]}"
    TEST_EXIT_CODE=$?
    set -e

    TEST_END_TIME=$(date +%s)
    local duration=$((TEST_END_TIME - TEST_START_TIME))

    if [ $TEST_EXIT_CODE -eq 0 ]; then
        log_success "All tests passed in ${duration}s"
    else
        log_error "Tests failed with exit code $TEST_EXIT_CODE (duration: ${duration}s)"
    fi
}

# ============================================================================
# Cleanup
# ============================================================================

cleanup() {
    log_section "Cleanup"

    if $SKIP_CLEANUP; then
        log_info "Skipping cleanup (--skip-cleanup)"
        log_info "Containers are still running for inspection:"
        docker compose $COMPOSE_FILES --env-file "$TEST_ENV_FILE" ps 2>/dev/null || true
        log_info "To clean up manually:"
        log_info "  cd $DOCKER_DIR && docker compose -f docker-compose.yml -f docker-compose.test.yml --env-file .env.test down -v"
        return 0
    fi

    log_info "Stopping and removing test containers..."
    cd "$DOCKER_DIR"
    docker compose $COMPOSE_FILES --env-file "$TEST_ENV_FILE" down -v 2>&1 | tee "$LOGS_DIR/cleanup.log" || true

    log_info "Removing test images..."
    docker rmi catalyst-backend:test catalyst-frontend:test catalyst-agent:test 2>/dev/null || true

    log_info "Removing test environment file..."
    rm -f "$TEST_ENV_FILE"

    log_success "Cleanup complete"
}

# ============================================================================
# Main Execution
# ============================================================================

main() {
    parse_arguments "$@"

    print_header "CATALYST DOCKER E2E TEST ORCHESTRATOR"

    setup_logging

    log_info "Starting Docker E2E tests at $(date)"
    log_info "Skip build: $SKIP_BUILD"
    log_info "Skip cleanup: $SKIP_CLEANUP"
    log_info "Suite: ${SUITE:-<all>}"
    log_info "Stop on failure: $STOP_ON_FAILURE"
    log_info "Verbose: $VERBOSE"
    log_info "Logs directory: $LOGS_DIR"

    # Check prerequisites
    log_section "Prerequisite Checks"
    if ! check_docker_prerequisites; then
        log_error "Prerequisites not met. Exiting."
        exit 1
    fi

    # Run phases
    build_images
    setup_environment
    run_tests

    # Final cleanup (unless skipped)
    cleanup

    # Print summary
    log_section "Test Execution Summary"

    local total_duration=$((TEST_END_TIME - BUILD_START_TIME))
    local build_duration=$((BUILD_END_TIME - BUILD_START_TIME))
    local env_duration=$((ENV_END_TIME - ENV_START_TIME))
    local test_duration=$((TEST_END_TIME - TEST_START_TIME))

    echo ""
    echo -e "${BOLD}${CYAN}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}${CYAN}║                 DOCKER E2E TEST SUMMARY                    ║${NC}"
    echo -e "${BOLD}${CYAN}╚════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "  Build time:    ${build_duration}s"
    echo -e "  Env setup:     ${env_duration}s"
    echo -e "  Test time:     ${test_duration}s"
    echo -e "  Total:         ${total_duration}s"
    echo ""
    echo -e "  Logs:          $LOGS_DIR"
    echo ""

    if [ $TEST_EXIT_CODE -eq 0 ]; then
        echo -e "${BOLD}${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
        echo -e "${BOLD}${GREEN}║               ✓ ALL DOCKER E2E TESTS PASSED                ║${NC}"
        echo -e "${BOLD}${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
    else
        echo -e "${BOLD}${RED}╔════════════════════════════════════════════════════════════╗${NC}"
        echo -e "${BOLD}${RED}║               ✗ SOME DOCKER E2E TESTS FAILED               ║${NC}"
        echo -e "${BOLD}${RED}╚════════════════════════════════════════════════════════════╝${NC}"
        echo ""
        echo -e "  Check logs: $LOGS_DIR"
    fi
    echo ""

    exit $TEST_EXIT_CODE
}

# Run main with all arguments
main "$@"
