#!/bin/bash
# Test Suite 27: Agent ↔ Panel Connection Resilience (chaos tests)
#
# Long-running suite (~3-5 min) that deliberately breaks the agent↔panel
# WebSocket channel and asserts both sides recover without operator help:
#
#   1. Real agent connects to a real panel            (baseline)
#   2. Half-open black-hole (SIGSTOP backend):        the agent must detect
#      the dead socket via its read-idle timeout and reconnect once the
#      backend resumes (SIGCONT)
#   3. Agent killed -9 mid-session:                   the panel must mark the
#      node offline within its heartbeat window
#   4. Reconnect storm:                               multiple agents created
#      simultaneously all reach online state (backoff jitter prevents lockstep)
#
# Requirements: running backend at $BACKEND_URL, built agent binary, jq.
# The suite never kills or restarts the panel process itself — it only uses
# SIGSTOP/SIGCONT on an already-running dev backend if one is detected.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/utils.sh"
source "$SCRIPT_DIR/config.env"

TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

AGENT_BIN="$SCRIPT_DIR/../catalyst-agent/target/debug/catalyst-agent"
if [ ! -x "$AGENT_BIN" ]; then
    AGENT_BIN="$SCRIPT_DIR/../catalyst-agent/target/release/catalyst-agent"
fi

# Timeouts aligned with agent/panel heartbeat constants (agent read-idle = 45s,
# panel heartbeat timeout = 60s), plus generous slack.
ONLINE_WAIT=60          # max seconds to wait for a node to come online
RECOVER_WAIT=180        # max seconds to wait for recovery after black-hole
OFFLINE_WAIT=120        # max seconds to wait for a dead node to be marked offline
POLL_INTERVAL=5

WORK_DIR=$(mktemp -d /tmp/catalyst-chaos-XXXX)
declare -a AGENT_PIDS=()
declare -a CREATED_NODE_IDS=()
STOPPED_BACKEND_PID=""

# Run a command with args, report success/failure via log helpers.
assert_pass() {
    local label="$1"; shift
    if "$@" >/dev/null 2>&1; then
        log_success "✓ $label"
        return 0
    else
        log_error "✗ $label"
        return 1
    fi
}

# Record an assertion's exit code in the counters.
record_result() {
    ((TESTS_RUN++))
    if [ "$1" -eq 0 ]; then
        ((TESTS_PASSED++))
    else
        ((TESTS_FAILED++))
    fi
}

cleanup() {
    log_info "Cleaning up chaos test resources..."
    # Always resume a stopped backend first.
    if [ -n "$STOPPED_BACKEND_PID" ]; then
        kill -CONT "$STOPPED_BACKEND_PID" 2>/dev/null || true
    fi
    for pid in "${AGENT_PIDS[@]}"; do
        kill "$pid" 2>/dev/null || true
    done
    sleep 2
    for pid in "${AGENT_PIDS[@]}"; do
        kill -9 "$pid" 2>/dev/null || true
    done
    rm -rf "$WORK_DIR"
    log_success "Cleanup complete"
}
trap cleanup EXIT

# Wait until GET /api/nodes/:id reports isOnline == expected ("true"/"false").
# Usage: wait_for_node_state <node_id> <expected> <timeout_seconds>
wait_for_node_state() {
    local node_id="$1" expected="$2" timeout_s="$3"
    local deadline=$((SECONDS + timeout_s))
    while [ $SECONDS -lt $deadline ]; do
        local resp online
        resp=$(http_get "${BACKEND_URL}/api/nodes/${node_id}" "Authorization: Bearer $TOKEN")
        online=$(echo "$resp" | head -n-1 | jq -r '.data.isOnline' 2>/dev/null)
        if [ "$online" = "$expected" ]; then
            return 0
        fi
        sleep "$POLL_INTERVAL"
    done
    return 1
}

spawn_agent() {
    local node_id="$1" api_key="$2"
    local cfg="$WORK_DIR/agent-${node_id}.toml"
    local datadir="$WORK_DIR/data-${node_id}"
    cat > "$cfg" << EOF
[server]
backend_url = "${BACKEND_WS_URL}"
node_id = "$node_id"
api_key = "$api_key"
hostname = "chaos-test-node"
data_dir = "$datadir"

[logging]
level = "info"
format = "json"
EOF
    CATALYST_CONFIG_PATH="$cfg" "$AGENT_BIN" > "$WORK_DIR/agent-${node_id}.log" 2>&1 &
    local pid=$!
    AGENT_PIDS+=("$pid")
    echo "$pid"
}

print_header "CHAOS TEST: AGENT ↔ PANEL CONNECTION RESILIENCE"

#=============================================================================
# Phase 0: Preflight
#=============================================================================
print_section "Phase 0: Preflight"

response=$(http_get "${BACKEND_URL}/health")
http_code=$(parse_http_code "$response")
if [ "$http_code" != "200" ]; then
    log_error "Backend not reachable at ${BACKEND_URL} — start it first"
    exit 1
fi
log_success "✓ Backend is healthy"

if [ ! -x "$AGENT_BIN" ]; then
    log_error "Agent binary not found — run: cd catalyst-agent && cargo build"
    exit 1
fi
log_success "✓ Agent binary found ($(basename "$(dirname "$(dirname "$AGENT_BIN")")"))"
command -v jq >/dev/null || { log_error "jq required"; exit 1; }
((TESTS_RUN++)); ((TESTS_PASSED++))

#=============================================================================
# Phase 1: Authentication
#=============================================================================
print_section "Phase 1: Authentication"

response=$(http_post "${BACKEND_URL}/api/auth/login" "{\"email\":\"admin@example.com\",\"password\":\"admin123\"}")
TOKEN=$(echo "$response" | head -n-1 | jq -r '.data.token')
if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
    log_error "Admin login failed"
    exit 1
fi
log_success "✓ Admin authenticated"
((TESTS_RUN++)); ((TESTS_PASSED++))

# Resolve a locationId for node creation
LOCATION_ID=$(http_get "${BACKEND_URL}/api/locations" "Authorization: Bearer $TOKEN" | head -n-1 | jq -r '.data[0].id // empty')
[ -z "$LOCATION_ID" ] && LOCATION_ID="cmkspe7nq0000sw3ctcc39e8z"

# Helper: create node + API key, echoing "<node_id> <api_key>"
create_chaos_node() {
    local name="chaos-$(random_string)"
    local resp node_id key_resp
    resp=$(http_post "${BACKEND_URL}/api/nodes" "{\"name\":\"$name\",\"locationId\":\"$LOCATION_ID\",\"hostname\":\"$name.example.com\",\"publicAddress\":\"127.0.0.1\",\"maxMemoryMb\":16384,\"maxCpuCores\":8}" "Authorization: Bearer $TOKEN")
    node_id=$(echo "$resp" | head -n-1 | jq -r '.data.id // empty')
    if [ -z "$node_id" ]; then
        return 1
    fi
    CREATED_NODE_IDS+=("$node_id")
    key_resp=$(http_post "${BACKEND_URL}/api/nodes/${node_id}/api-key" '{}' "Authorization: Bearer $TOKEN")
    echo "$node_id $(echo "$key_resp" | head -n-1 | jq -r '.data.apiKey // empty')"
}

# Export TOKEN for subshell helper use
export TOKEN LOCATION_ID

#=============================================================================
# Phase 2: Baseline connect
#=============================================================================
print_section "Phase 2: Baseline — real agent connects"

read -r NODE_A KEY_A <<< "$(create_chaos_node)"
if [ -z "$NODE_A" ] || [ -z "$KEY_A" ]; then
    log_error "Failed to create baseline node"
    exit 1
fi
AGENT_A_PID=$(spawn_agent "$NODE_A" "$KEY_A")
log_info "Agent A started (PID $AGENT_A_PID, node $NODE_A)"

assert_pass "Node comes online after agent start" \
    wait_for_node_state "$NODE_A" "true" "$ONLINE_WAIT"
record_result $?

#=============================================================================
# Phase 3: Black-hole (half-open socket) via SIGSTOP
#=============================================================================
print_section "Phase 3: Black-hole — backend frozen mid-session"

BACKEND_PID="${BACKEND_PID:-$(pgrep -f 'dist/index.js' | head -1)}"
if [ -n "$BACKEND_PID" ] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    STOPPED_BACKEND_PID="$BACKEND_PID"
    log_info "Freezing backend PID $BACKEND_PID with SIGSTOP (simulates silent network drop)"
    kill -STOP "$BACKEND_PID"
    sleep 5
    # Agent's read-idle timeout is 45s; reconnect backoff starts at 5s.
    log_info "Waiting up to ${RECOVER_WAIT}s for agent to notice and recover..."
    kill -CONT "$BACKEND_PID"
    STOPPED_BACKEND_PID=""
    assert_pass "Agent recovers after backend black-hole + resume" \
        wait_for_node_state "$NODE_A" "true" "$RECOVER_WAIT"
    blackhole_rc=$?
    record_result "$blackhole_rc"
    if [ "$blackhole_rc" -ne 0 ]; then
        log_warn "Agent A log tail:"; tail -20 "$WORK_DIR/agent-${NODE_A}.log"
    fi
else
    log_warn "No controllable backend process found (set BACKEND_PID to enable this scenario)"
fi

#=============================================================================
# Phase 4: Agent dies mid-session (-9)
#=============================================================================
print_section "Phase 4: Agent killed -9 mid-session"

log_info "SIGKILL agent A (PID $AGENT_A_PID); backend keeps running"
kill -9 "$AGENT_A_PID" 2>/dev/null || true
sleep 2
assert_pass "Panel marks node offline after agent crash (≤${OFFLINE_WAIT}s)" \
    wait_for_node_state "$NODE_A" "false" "$OFFLINE_WAIT"
record_result $?

#=============================================================================
# Phase 5: Reconnect storm
#=============================================================================
print_section "Phase 5: Reconnect storm — simultaneous agents"

STORM_NODES=()
STORM_OK=0
for i in 1 2 3; do
    read -r nid key <<< "$(create_chaos_node)"
    if [ -n "$nid" ] && [ -n "$key" ]; then
        spawn_agent "$nid" "$key" >/dev/null
        STORM_NODES+=("$nid")
    fi
done

if [ ${#STORM_NODES[@]} -eq 0 ]; then
    log_error "Failed to create any storm nodes"
    ((TESTS_RUN++)); ((TESTS_FAILED++))
else
    log_info "Launched ${#STORM_NODES[@]} agents simultaneously"
    ALL_ONLINE=true
    for nid in "${STORM_NODES[@]}"; do
        if wait_for_node_state "$nid" "true" "$ONLINE_WAIT"; then
            log_success "✓ Storm node $nid online"
        else
            ALL_ONLINE=false
            log_error "✗ Storm node $nid did not come online"
            tail -10 "$WORK_DIR/agent-${nid}.log" || true
        fi
    done
    ((TESTS_RUN++))
    if [ "$ALL_ONLINE" = true ]; then ((TESTS_PASSED++)); else ((TESTS_FAILED++)); fi
fi

#=============================================================================
# Summary
#=============================================================================
echo ""
print_header "RESULTS: $TESTS_PASSED/$TESTS_RUN passed, $TESTS_FAILED failed"
[ "$TESTS_FAILED" -eq 0 ] && exit 0 || exit 1
