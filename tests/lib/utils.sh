#!/bin/bash

# Catalyst E2E Test Utilities Library
# Provides common functions for all test suites

# Colors for output
export RED='\033[0;31m'
export GREEN='\033[0;32m'
export YELLOW='\033[1;33m'
export BLUE='\033[0;34m'
export MAGENTA='\033[0;35m'
export CYAN='\033[0;36m'
export NC='\033[0m' # No Color
export BOLD='\033[1m'

# Color constants for scripts
export COLOR_RED=$RED
export COLOR_GREEN=$GREEN
export COLOR_YELLOW=$YELLOW
export COLOR_BLUE=$BLUE
export COLOR_CYAN=$CYAN
export COLOR_RESET=$NC

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Logging functions
log_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

log_success() {
    echo -e "${GREEN}✓${NC} $1"
}

log_error() {
    echo -e "${RED}✗${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}⚠${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

log_section() {
    echo ""
    echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BOLD}${CYAN}  $1${NC}"
    echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

print_header() {
    echo ""
    echo -e "${BOLD}${CYAN}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}${CYAN}║                                                            ║${NC}"
    echo -e "${BOLD}${CYAN}║  $(printf '%-54s' "$1")  ║${NC}"
    echo -e "${BOLD}${CYAN}║                                                            ║${NC}"
    echo -e "${BOLD}${CYAN}╚════════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

print_section() {
    echo ""
    echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BOLD}${CYAN}  $1${NC}"
    echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
}

# Test assertion helpers
assert_equals() {
    local actual="$1"
    local expected="$2"
    local message="${3:-Assertion failed}"
    
    ((TESTS_RUN++)) || true
    if [ "$actual" = "$expected" ]; then
        ((TESTS_PASSED++)) || true
        log_success "$message"
        return 0
    else
        ((TESTS_FAILED++)) || true
        log_error "$message"
        log_error "  Expected: $expected"
        log_error "  Actual:   $actual"
        return 0  # Don't exit script on assertion failure
    fi
}

assert_not_empty() {
    local value="$1"
    local message="${2:-Value should not be empty}"
    
    ((TESTS_RUN++)) || true
    if [ -n "$value" ] && [ "$value" != "null" ]; then
        ((TESTS_PASSED++)) || true
        log_success "$message"
        return 0
    else
        ((TESTS_FAILED++)) || true
        log_error "$message"
        log_error "  Got empty or null value"
        return 0  # Don't exit script
    fi
}

assert_http_code() {
    local actual="$1"
    local expected="$2"
    local endpoint="${3:-Unknown endpoint}"
    
    assert_equals "$actual" "$expected" "HTTP $expected for $endpoint"
}

assert_json_field() {
    local json="$1"
    local field="$2"
    local expected="$3"
    local message="${4:-JSON field assertion}"
    
    local actual=$(echo "$json" | jq -r ".$field")
    assert_equals "$actual" "$expected" "$message"
}

assert_json_field_exists() {
    local json="$1"
    local field="$2"
    local message="${3:-JSON field should exist: $field}"
    
    local value=$(echo "$json" | jq -r ".$field")
    assert_not_empty "$value" "$message"
}

assert_contains() {
    local haystack="$1"
    local needle="$2"
    local message="${3:-String should contain substring}"
    
    ((TESTS_RUN++)) || true
    if echo "$haystack" | grep -q "$needle"; then
        ((TESTS_PASSED++)) || true
        log_success "$message"
        return 0
    else
        ((TESTS_FAILED++)) || true
        log_error "$message"
        log_error "  Looking for: $needle"
        log_error "  In: $haystack"
        return 0  # Don't exit script
    fi
}

# HTTP request helpers
http_get() {
    local url="$1"
    local headers="${2:-}"
    
    if [ -n "$headers" ]; then
        curl -s -w "\n%{http_code}" -X GET "$url" \
            -H "Content-Type: application/json" \
            -H "$headers"
    else
        curl -s -w "\n%{http_code}" -X GET "$url"
    fi
}

http_post() {
    local url="$1"
    local data="$2"
    local headers="${3:-}"
    
    if [ -n "$headers" ]; then
        curl -s -w "\n%{http_code}" -X POST "$url" \
            -H "Content-Type: application/json" \
            -H "$headers" \
            -d "$data"
    else
        curl -s -w "\n%{http_code}" -X POST "$url" \
            -H "Content-Type: application/json" \
            -d "$data"
    fi
}

http_put() {
    local url="$1"
    local data="$2"
    local headers="${3:-}"
    
    if [ -n "$headers" ]; then
        curl -s -w "\n%{http_code}" -X PUT "$url" \
            -H "Content-Type: application/json" \
            -H "$headers" \
            -d "$data"
    else
        curl -s -w "\n%{http_code}" -X PUT "$url" \
            -H "Content-Type: application/json" \
            -d "$data"
    fi
}

http_patch() {
    local url="$1"
    local data="$2"
    local headers="${3:-}"
    
    if [ -n "$headers" ]; then
        curl -s -w "\n%{http_code}" -X PATCH "$url" \
            -H "Content-Type: application/json" \
            -H "$headers" \
            -d "$data"
    else
        curl -s -w "\n%{http_code}" -X PATCH "$url" \
            -H "Content-Type: application/json" \
            -d "$data"
    fi
}

http_delete() {
    local url="$1"
    local headers="${2:-}"
    
    if [ -n "$headers" ]; then
        curl -s -w "\n%{http_code}" -X DELETE "$url" \
            -H "$headers"
    else
        curl -s -w "\n%{http_code}" -X DELETE "$url"
    fi
}

parse_response() {
    local response="$1"
    echo "$response" | head -n-1
}

parse_http_code() {
    local response="$1"
    echo "$response" | tail -n1
}

# Auth helpers
get_auth_header() {
    local token="$1"
    echo "-H \"Authorization: Bearer $token\""
}

# Wait helpers
wait_for_service() {
    local url="$1"
    local timeout="${2:-30}"
    local elapsed=0
    
    log_info "Waiting for service at $url..."
    while [ $elapsed -lt $timeout ]; do
        if curl -s -f "$url" > /dev/null 2>&1; then
            log_success "Service is ready"
            return 0
        fi
        sleep 1
        ((elapsed++))
    done
    
    log_error "Service not ready after ${timeout}s"
    return 1
}

wait_for_condition() {
    local condition_cmd="$1"
    local timeout="${2:-30}"
    local message="${3:-Waiting for condition...}"
    local elapsed=0
    
    log_info "$message"
    while [ $elapsed -lt $timeout ]; do
        if eval "$condition_cmd" > /dev/null 2>&1; then
            log_success "Condition met"
            return 0
        fi
        sleep 1
        ((elapsed++))
    done
    
    log_error "Condition not met after ${timeout}s"
    return 1
}

# Cleanup helpers
cleanup_docker_containers() {
    local pattern="${1:-catalyst-test-}"
    log_info "Cleaning up Docker containers matching: $pattern"
    docker ps -a --filter "name=$pattern" -q | xargs -r docker rm -f 2>/dev/null || true
}

cleanup_nerdctl_containers() {
    local pattern="${1:-catalyst-test-}"
    log_info "Cleaning up nerdctl containers matching: $pattern"
    sudo nerdctl ps -a --filter "name=$pattern" -q | xargs -r sudo nerdctl rm -f 2>/dev/null || true
}

cleanup_processes() {
    local pattern="$1"
    log_info "Cleaning up processes matching: $pattern"
    local pids
    pids=$(pgrep -f "$pattern" 2>/dev/null || true)
    if [ -n "$pids" ]; then
        for pid in $pids; do
            kill "$pid" 2>/dev/null || true
        done
    fi
}

# Random data generators
random_string() {
    local length="${1:-8}"
    cat /dev/urandom | tr -dc 'a-z0-9' | fold -w "$length" | head -n 1
}

random_email() {
    echo "test-$(random_string)@example.com"
}

random_port() {
    shuf -i 20000-30000 -n 1
}

timestamp() {
    date +%s
}

unique_id() {
    echo "test-$(timestamp)-$(random_string 4)"
}

# JSON generation helper
json_object() {
    # Takes key=value pairs and creates JSON
    local output="{"
    local first=true
    for arg in "$@"; do
        if [ "$first" = true ]; then
            first=false
        else
            output="$output,"
        fi
        local key="${arg%%=*}"
        local value="${arg#*=}"
        output="$output\"$key\":\"$value\""
    done
    output="$output}"
    echo "$output"
}

# Test report
print_test_summary() {
    echo ""
    echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BOLD}  Test Summary${NC}"
    echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "  Total:  ${BOLD}$TESTS_RUN${NC}"
    echo -e "  ${GREEN}Passed: $TESTS_PASSED${NC}"
    echo -e "  ${RED}Failed: $TESTS_FAILED${NC}"
    
    if [ $TESTS_FAILED -eq 0 ]; then
        echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo -e "${BOLD}${GREEN}  ✓ ALL TESTS PASSED${NC}"
        echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        return 0
    else
        echo -e "${BOLD}${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo -e "${BOLD}${RED}  ✗ SOME TESTS FAILED${NC}"
        echo -e "${BOLD}${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        return 1
    fi
}

# Database helpers
reset_test_database() {
    log_info "Resetting test database..."
    cd /root/catalyst3/catalyst-backend
    bun run db:push --force-reset > /dev/null 2>&1
    bun run db:seed > /dev/null 2>&1
    log_success "Database reset complete"
}

# Service management
start_backend_test_mode() {
    log_info "Starting backend in test mode..."
    cd /root/catalyst3/catalyst-backend
    NODE_ENV=test bun run dev > /tmp/catalyst-backend-test.log 2>&1 &
    local pid=$!
    echo $pid > /tmp/catalyst-backend-test.pid
    
    wait_for_service "${BACKEND_URL}/health" 30
    return $?
}

stop_backend_test_mode() {
    if [ -f /tmp/catalyst-backend-test.pid ]; then
        local pid=$(cat /tmp/catalyst-backend-test.pid)
        log_info "Stopping backend (PID: $pid)..."
        kill $pid 2>/dev/null || true
        rm -f /tmp/catalyst-backend-test.pid
    fi
}

start_agent_test_mode() {
    local node_id="$1"
    local node_secret="$2"
    local node_api_key="${3:-}"
    
    log_info "Starting agent in test mode..."
    cd /root/catalyst3/catalyst-agent
    
    # Create test config
    cat > /tmp/catalyst-agent-test.toml <<EOF
[server]
backend_url = "${BACKEND_WS_URL}"
node_id = "$node_id"
secret = "$node_secret"
api_key = "$node_api_key"
hostname = "test-node"
data_dir = "/var/lib/catalyst"
max_connections = 100

[containerd]
socket_path = "/run/containerd/containerd.sock"
namespace = "catalyst"

[logging]
level = "info"
format = "json"
EOF
    
    sudo RUST_LOG=info ./target/release/catalyst-agent --config /tmp/catalyst-agent-test.toml > /tmp/catalyst-agent-test.log 2>&1 &
    local pid=$!
    echo $pid > /tmp/catalyst-agent-test.pid
    
    sleep 3
    log_success "Agent started (PID: $pid)"
}

stop_agent_test_mode() {
    if [ -f /tmp/catalyst-agent-test.pid ]; then
        local pid=$(cat /tmp/catalyst-agent-test.pid)
        log_info "Stopping agent (PID: $pid)..."
        sudo kill $pid 2>/dev/null || true
        rm -f /tmp/catalyst-agent-test.pid
    fi
}

# Trap helper for cleanup
setup_cleanup_trap() {
    local cleanup_function="$1"
    trap "$cleanup_function" EXIT INT TERM
}
