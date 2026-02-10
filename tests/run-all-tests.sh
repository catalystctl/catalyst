#!/bin/bash

# Catalyst E2E Test Suite - Master Test Runner
# Runs all test suites in order and generates report

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Load configuration
source config.env
source lib/utils.sh

# Test suites in execution order
TEST_SUITES=(
    "01-auth.test.sh"
    "02-templates.test.sh"
    "03-nodes.test.sh"
    "04-servers.test.sh"
    "05-permissions.test.sh"
    "06-websocket.test.sh"
    "07-agent-connectivity.test.sh"
    "08-container-lifecycle.test.sh"
    "09-file-operations.test.sh"
    "10-full-workflow.test.sh"
    "11-multi-server.test.sh"
    "12-failure-scenarios.test.sh"
    "13-load-test.sh"
    "14-security.test.sh"
)

# Results tracking
TOTAL_SUITES=${#TEST_SUITES[@]}
PASSED_SUITES=0
FAILED_SUITES=0
SKIPPED_SUITES=0
declare -a FAILED_SUITE_NAMES

# Parse arguments
RUN_SPECIFIC=""
STOP_ON_FAILURE=false
VERBOSE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --suite)
            RUN_SPECIFIC="$2"
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
        --help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --suite <name>        Run specific test suite"
            echo "  --stop-on-failure     Stop on first failure"
            echo "  --verbose             Show detailed output"
            echo "  --help                Show this help"
            echo ""
            echo "Available test suites:"
            for suite in "${TEST_SUITES[@]}"; do
                echo "  - $suite"
            done
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Print header
echo ""
echo -e "${BOLD}${CYAN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${CYAN}║                                                            ║${NC}"
echo -e "${BOLD}${CYAN}║          CATALYST E2E TEST SUITE - COMPREHENSIVE               ║${NC}"
echo -e "${BOLD}${CYAN}║                                                            ║${NC}"
echo -e "${BOLD}${CYAN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""
log_info "Test execution started at $(date)"
log_info "Backend URL: $BACKEND_URL"
log_info "Log directory: $TEST_LOG_DIR"
echo ""

# Pre-flight checks
log_section "Pre-flight Checks"

log_info "Checking dependencies..."
command -v curl >/dev/null 2>&1 || { log_error "curl not found"; exit 1; }
command -v jq >/dev/null 2>&1 || { log_error "jq not found"; exit 1; }
command -v docker >/dev/null 2>&1 || { log_error "docker not found"; exit 1; }
log_success "Dependencies OK"

log_info "Checking backend service..."
if ! wait_for_service "${BACKEND_URL}/health" 10; then
    log_warn "Backend not running, attempting to start..."
    start_backend_test_mode
fi
log_success "Backend is ready"

log_info "Checking database..."
cd /root/catalyst3/catalyst-backend
if ! bun run db:push > /dev/null 2>&1; then
    log_error "Database connection failed"
    exit 1
fi
log_success "Database is ready"

# Prepare test environment
log_info "Preparing test environment..."
reset_test_database
log_success "Test environment ready"

# Run test suites
log_section "Running Test Suites"

for suite in "${TEST_SUITES[@]}"; do
    # Skip if running specific suite
    if [ -n "$RUN_SPECIFIC" ] && [ "$suite" != "$RUN_SPECIFIC" ]; then
        continue
    fi
    
    # Check if test file exists
    if [ ! -f "$suite" ]; then
        log_warn "Test suite not found: $suite (skipping)"
        ((SKIPPED_SUITES++))
        continue
    fi
    
    echo ""
    echo -e "${BOLD}${MAGENTA}┌────────────────────────────────────────────────────────┐${NC}"
    echo -e "${BOLD}${MAGENTA}│  Running: $suite${NC}"
    echo -e "${BOLD}${MAGENTA}└────────────────────────────────────────────────────────┘${NC}"
    echo ""
    
    # Run the test suite
    start_time=$(date +%s)
    
    if $VERBOSE; then
        bash "$suite"
        result=$?
    else
        bash "$suite" > "${TEST_LOG_DIR}/${suite}.log" 2>&1
        result=$?
    fi
    
    end_time=$(date +%s)
    duration=$((end_time - start_time))
    
    # Track results
    if [ $result -eq 0 ]; then
        ((PASSED_SUITES++))
        echo -e "${GREEN}✓ PASSED${NC} ${suite} (${duration}s)"
    else
        ((FAILED_SUITES++))
        FAILED_SUITE_NAMES+=("$suite")
        echo -e "${RED}✗ FAILED${NC} ${suite} (${duration}s)"
        
        if ! $VERBOSE; then
            echo -e "${YELLOW}  Log: ${TEST_LOG_DIR}/${suite}.log${NC}"
        fi
        
        if $STOP_ON_FAILURE; then
            log_error "Stopping due to failure (--stop-on-failure)"
            break
        fi
    fi
done

# Print final report
echo ""
log_section "Test Execution Complete"

echo ""
echo -e "${BOLD}${CYAN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${CYAN}║                    FINAL REPORT                            ║${NC}"
echo -e "${BOLD}${CYAN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Total Suites:   ${BOLD}$TOTAL_SUITES${NC}"
echo -e "  ${GREEN}Passed:         $PASSED_SUITES${NC}"
echo -e "  ${RED}Failed:         $FAILED_SUITES${NC}"
echo -e "  ${YELLOW}Skipped:        $SKIPPED_SUITES${NC}"
echo ""

if [ $FAILED_SUITES -gt 0 ]; then
    echo -e "${RED}Failed Test Suites:${NC}"
    for failed_suite in "${FAILED_SUITE_NAMES[@]}"; do
        echo -e "  ${RED}✗${NC} $failed_suite"
        echo -e "    Log: ${TEST_LOG_DIR}/${failed_suite}.log"
    done
    echo ""
fi

echo -e "Test logs saved to: ${TEST_LOG_DIR}"
echo -e "Execution time: $(date)"
echo ""

# Exit with appropriate code
if [ $FAILED_SUITES -eq 0 ]; then
    echo -e "${BOLD}${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}${GREEN}║               ✓ ALL TESTS PASSED                           ║${NC}"
    echo -e "${BOLD}${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
    exit 0
else
    echo -e "${BOLD}${RED}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}${RED}║               ✗ SOME TESTS FAILED                          ║${NC}"
    echo -e "${BOLD}${RED}╚════════════════════════════════════════════════════════════╝${NC}"
    exit 1
fi
