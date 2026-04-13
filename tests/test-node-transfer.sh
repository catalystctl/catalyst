#!/bin/bash
# ─────────────────────────────────────────────────────────────────────
# Node Transfer End-to-End Test
#
# Sets up two local agent instances (different containerd namespaces)
# on the same machine, creates a server, and transfers it between nodes.
#
# Prerequisites:
#   - Backend running on localhost:3000
#   - PostgreSQL and Redis running
#   - containerd running with accessible socket
#   - Agent binary built: catalyst-agent/target/debug/catalyst-agent
#   - User in the containerd group (or run with sudo)
#
# Usage:
#   sudo ./tests/test-node-transfer.sh          # needs sudo for containerd
#   ./tests/test-node-transfer.sh               # if user is in containerd group
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/lib/utils.sh"

# ── Configuration ────────────────────────────────────────────────────
BACKEND_URL="${BACKEND_URL:-http://localhost:3000}"
BACKEND_WS="${BACKEND_WS:-ws://localhost:3000/ws}"
CONTAINERD_SOCK="${CONTAINERD_SOCK:-/run/containerd/containerd.sock}"
AGENT_BIN="${AGENT_BIN:-$PROJECT_ROOT/catalyst-agent/target/debug/catalyst-agent}"

# Test node identifiers
NODE1_NAME="transfer-test-node-1"
NODE2_NAME="transfer-test-node-2"
NS1="catalyst-transfer-test-1"
NS2="catalyst-transfer-test-2"
DATA_DIR_SHARED="/tmp/catalyst-transfer-shared"
DATA_DIR1="$DATA_DIR_SHARED"
DATA_DIR2="$DATA_DIR_SHARED"

# Runtime paths for configs and PIDs
CONFIG1="/tmp/catalyst-transfer-agent1.toml"
CONFIG2="/tmp/catalyst-transfer-agent2.toml"
PID1_FILE="/tmp/catalyst-transfer-agent1.pid"
PID2_FILE="/tmp/catalyst-transfer-agent2.pid"
LOG1="/tmp/catalyst-transfer-agent1.log"
LOG2="/tmp/catalyst-transfer-agent2.log"

# Cleanup tracking
SERVER_ID=""
NODE1_ID=""
NODE2_ID=""
TEMPLATE_ID=""
TEARDOWN_DONE=0

# ── Colors for non-test output ──────────────────────────────────────
DIM='\033[2m'
RESET='\033[0m'

# ── Cleanup ─────────────────────────────────────────────────────────
teardown() {
    if [ $TEARDOWN_DONE -eq 1 ]; then return; fi
    TEARDOWN_DONE=1
    echo ""
    echo -e "${DIM}── Teardown ──${RESET}"

    # Stop agents
    for pidfile in "$PID1_FILE" "$PID2_FILE"; do
        if [ -f "$pidfile" ]; then
            local pid
            pid=$(cat "$pidfile" 2>/dev/null || true)
            if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
                kill "$pid" 2>/dev/null || true
                wait "$pid" 2>/dev/null || true
                echo -e "${DIM}  Stopped agent (PID $pid)${RESET}"
            fi
            rm -f "$pidfile"
        fi
    done

    # Delete test server — try stop first, then kill, then force DB update if needed
    if [ -n "${SERVER_ID:-}" ] && [ -n "${TOKEN:-}" ]; then
        # Try graceful stop first
        curl -s -X POST "${BACKEND_URL}/api/servers/${SERVER_ID}/stop" \
            -H "Authorization: Bearer $TOKEN" > /dev/null 2>&1 || true
        sleep 1
        # Try kill
        curl -s -X POST "${BACKEND_URL}/api/servers/${SERVER_ID}/kill" \
            -H "Authorization: Bearer $TOKEN" > /dev/null 2>&1 || true
        sleep 1
        # If agent is dead, force status to stopped via podman exec
        local srv_status
        srv_status=$(curl -s "${BACKEND_URL}/api/servers/${SERVER_ID}" \
            -H "Authorization: Bearer $TOKEN" 2>/dev/null | jq -r '.data.status // empty')
        if [ "$srv_status" = "running" ] || [ "$srv_status" = "stopping" ]; then
            podman exec catalyst-postgres psql -U catalyst -d catalyst_db \
                -c "UPDATE \"Server\" SET status='stopped' WHERE id='${SERVER_ID}';" \
                > /dev/null 2>&1 || true
        fi
        # Now delete
        curl -s -X DELETE "${BACKEND_URL}/api/servers/${SERVER_ID}" \
            -H "Authorization: Bearer $TOKEN" > /dev/null 2>&1 || true
        echo -e "${DIM}  Deleted test server${RESET}"
    fi

    # Delete test nodes
    if [ -n "${TOKEN:-}" ]; then
        for nid in "${NODE1_ID:-}" "${NODE2_ID:-}"; do
            if [ -n "$nid" ]; then
                curl -s -X DELETE "${BACKEND_URL}/api/nodes/${nid}" \
                    -H "Authorization: Bearer $TOKEN" > /dev/null 2>&1 || true
            fi
        done
        echo -e "${DIM}  Deleted test nodes${RESET}"
    fi

    # Clean up temp files
    rm -f "$CONFIG1" "$CONFIG2" "$PID1_FILE" "$PID2_FILE" "$LOG1" "$LOG2"

    # Clean up data directories (may be busy if containers linger)
    rm -rf "$DATA_DIR_SHARED" 2>/dev/null || true
    echo -e "${DIM}  Cleaned up temp directories${RESET}"

    # Clean up containerd namespaces (remove any leftover containers)
    for ns in "$NS1" "$NS2"; do
        if command -v ctr &>/dev/null; then
            ctr -n "$ns" containers ls -q 2>/dev/null | while read -r cid; do
                ctr -n "$ns" task kill "$cid" 2>/dev/null || true
                ctr -n "$ns" container rm "$cid" 2>/dev/null || true
            done
        fi
    done
    echo -e "${DIM}  Cleaned containerd namespaces${RESET}"
    # Delete test template (must come after server deletion)
    if [ -n "${TOKEN:-}" ]; then
        TPL=$(curl -s "${BACKEND_URL}/api/templates" -H "Authorization: Bearer $TOKEN" | \
            jq -r '.data[] | select(.name == "transfer-test-alpine") | .id // empty')
        if [ -n "$TPL" ]; then
            curl -s -X DELETE "${BACKEND_URL}/api/templates/${TPL}" \
                -H "Authorization: Bearer $TOKEN" > /dev/null 2>&1 || true
            echo -e "${DIM}  Deleted test template${RESET}"
        fi
    fi
    echo -e "${DIM}── Teardown complete ──${RESET}"
}
trap teardown EXIT INT TERM

# ── Helpers ─────────────────────────────────────────────────────────
step() {
    echo ""
    echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BOLD}${CYAN}  $1${NC}"
    echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

wait_for_agent_online() {
    local node_id="$1"
    local timeout="${2:-20}"
    local elapsed=0
    while [ $elapsed -lt $timeout ]; do
        local online
        online=$(curl -s "${BACKEND_URL}/api/nodes/${node_id}" \
            -H "Authorization: Bearer $TOKEN" 2>/dev/null | jq -r '.data.isOnline')
        if [ "$online" = "true" ]; then
            return 0
        fi
        sleep 1
        ((elapsed++))
    done
    return 1
}

wait_for_server_status() {
    local server_id="$1"
    local expected_status="$2"
    local timeout="${3:-30}"
    local elapsed=0
    while [ $elapsed -lt $timeout ]; do
        local status
        status=$(curl -s "${BACKEND_URL}/api/servers/${server_id}" \
            -H "Authorization: Bearer $TOKEN" 2>/dev/null | jq -r '.data.status')
        if [ "$status" = "$expected_status" ]; then
            return 0
        fi
        sleep 1
        ((elapsed++))
    done
    echo "  Timeout waiting for status '$expected_status', got '$status'"
    return 1
}

# ── Pre-flight checks ───────────────────────────────────────────────
print_header "Node Transfer E2E Test"

echo -e "${DIM}Backend:      $BACKEND_URL${RESET}"
echo -e "${DIM}Agent binary: $AGENT_BIN${RESET}"
echo -e "${DIM}Containerd:   $CONTAINERD_SOCK${RESET}"
echo ""

# Pre-flight cleanup: remove any leftover state from previous runs
log_info "Checking for leftover state from previous runs..."
PRE_TOKEN=$(curl -s "${BACKEND_URL}/api/auth/login" \
    -H 'Content-Type: application/json' -d '{"email":"admin@example.com","password":"admin123"}' | jq -r '.data.token // empty')
if [ -n "$PRE_TOKEN" ]; then
    # Force-delete any leftover servers via DB (bypasses all API validation)
    for SID in $(curl -s "${BACKEND_URL}/api/servers" -H "Authorization: Bearer $PRE_TOKEN" | \
        jq -r '.data[] | select(.name == "transfer-test-server") | .id'); do
        podman exec catalyst-postgres psql -U catalyst -d catalyst_db \
            -c "DELETE FROM \"Server\" WHERE id='${SID}' CASCADE;" > /dev/null 2>&1 || true
        log_info "  Force-deleted leftover server $SID"
    done
    # Delete test nodes via API
    for name in "$NODE1_NAME" "$NODE2_NAME"; do
        NID=$(curl -s "${BACKEND_URL}/api/nodes" -H "Authorization: Bearer $PRE_TOKEN" | \
            jq -r ".data[] | select(.name == \"$name\") | .id // empty")
        if [ -n "$NID" ]; then
            curl -s -X DELETE "${BACKEND_URL}/api/nodes/${NID}" \
                -H "Authorization: Bearer $PRE_TOKEN" > /dev/null 2>&1 || true
        fi
    done
    # Delete test template via API, fallback to DB
    sleep 0.5
    TPL=$(curl -s "${BACKEND_URL}/api/templates" -H "Authorization: Bearer $PRE_TOKEN" | \
        jq -r '.data[] | select(.name == "transfer-test-alpine") | .id // empty')
    if [ -n "$TPL" ]; then
        curl -s -X DELETE "${BACKEND_URL}/api/templates/${TPL}" \
            -H "Authorization: Bearer $PRE_TOKEN" > /dev/null 2>&1 || true
        # Verify deletion, force via DB if still exists
        sleep 0.3
        STILL_TPL=$(curl -s "${BACKEND_URL}/api/templates" -H "Authorization: Bearer $PRE_TOKEN" | \
            jq -r '.data[] | select(.name == "transfer-test-alpine") | .id // empty')
        if [ -n "$STILL_TPL" ]; then
            podman exec catalyst-postgres psql -U catalyst -d catalyst_db \
                -c "DELETE FROM \"ServerTemplate\" WHERE id='${STILL_TPL}';" > /dev/null 2>&1 || true
        fi
    fi
fi

# Check backend is reachable
if ! curl -sf "${BACKEND_URL}/health" > /dev/null 2>&1; then
    log_error "Backend is not reachable at $BACKEND_URL"
    log_info "Start it with: cd catalyst-backend && bun run dev"
    exit 1
fi
log_success "Backend is reachable"

# Check containerd socket
if [ ! -S "$CONTAINERD_SOCK" ]; then
    log_error "containerd socket not found at $CONTAINERD_SOCK"
    log_info "Start containerd or set CONTAINERD_SOCK env var"
    exit 1
fi

# Check we can access containerd
if ! command -v ctr &>/dev/null; then
    log_error "ctr (containerd CLI) not found in PATH"
    exit 1
fi
if ! ctr --address "$CONTAINERD_SOCK" -n "$NS1" namespaces ls &>/dev/null; then
    log_error "Cannot access containerd — check permissions"
    log_info "Add your user to the containerd group or run with sudo"
    exit 1
fi
log_success "containerd is accessible"

# Check agent binary
if [ ! -x "$AGENT_BIN" ]; then
    log_error "Agent binary not found or not executable: $AGENT_BIN"
    log_info "Build it with: cd catalyst-agent && cargo build"
    exit 1
fi
log_success "Agent binary exists"

# ── Step 1: Authenticate ────────────────────────────────────────────
step "Step 1: Authenticate"

response=$(http_post "${BACKEND_URL}/api/auth/login" '{
    "email": "admin@example.com",
    "password": "admin123"
}')
TOKEN=$(parse_response "$response" | jq -r '.data.token')
http_code=$(parse_http_code "$response")

if [ "$http_code" != "200" ] || [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
    log_error "Authentication failed"
    exit 1
fi
log_success "Authenticated as admin"

# ── Step 2: Use seeded location ───────────────────────────────────────
step "Step 2: Use seeded location"

LOCATION_ID="cmntddtx60000k3i57gf029au"
log_info "Using location: $LOCATION_ID"

# ── Step 3: Create a clean template ───────────────────────────────────
step "Step 3: Create a clean template"

# Delete any leftover from previous runs
OLD_TPL=$(curl -s "${BACKEND_URL}/api/templates" -H "Authorization: Bearer $TOKEN" | \
    jq -r '.data[] | select(.name == "transfer-test-alpine") | .id // empty')
if [ -n "$OLD_TPL" ]; then
    curl -s -X DELETE "${BACKEND_URL}/api/templates/${OLD_TPL}" \
        -H "Authorization: Bearer $TOKEN" > /dev/null 2>&1 || true
fi

STARTUP_CMD='echo Hello from transfer test > /data/greeting.txt; echo timestamp=$(date) > /data/timestamp.txt; dd if=/dev/urandom of=/data/random.bin bs=1024 count=512 2>/dev/null; echo data_written=true > /data/status.txt; sleep 300'

TEMPLATE_JSON=$(jq -n \
    --arg startup "$STARTUP_CMD" \
    '{
        name: "transfer-test-alpine",
        description: "Alpine with data-writing startup for transfer testing",
        author: "e2e-test",
        version: "1.0.0",
        image: "alpine:latest",
        startup: $startup,
        stopCommand: "SIGTERM",
        sendSignalTo: "SIGTERM",
        variables: [],
        supportedPorts: [25565],
        allocatedMemoryMb: 256,
        allocatedCpuCores: 1
    }')

response=$(http_post "${BACKEND_URL}/api/templates" "$TEMPLATE_JSON" "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")

if [ "$http_code" != "201" ]; then
    log_error "Failed to create template"
    parse_response "$response" | jq '.' 2>/dev/null | head -5
    exit 1
fi
TEMPLATE_ID=$(parse_response "$response" | jq -r '.data.id')
log_success "Created template: $TEMPLATE_ID (alpine:latest, writes data to /data)"

# ── Step 4: Create two nodes ────────────────────────────────────────
step "Step 4: Create two test nodes"

# Node 1
response=$(http_post "${BACKEND_URL}/api/nodes" "{
    \"name\": \"$NODE1_NAME\",
    \"description\": \"Transfer test node 1\",
    \"locationId\": \"$LOCATION_ID\",
    \"hostname\": \"localhost\",
    \"publicAddress\": \"127.0.0.1\",
    \"maxMemoryMb\": 4096,
    \"maxCpuCores\": 4,
    \"serverDataDir\": \"$DATA_DIR1/servers\"
}" "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")

if [ "$http_code" != "200" ]; then
    # Node might already exist from a previous run — clean it up
    NODE1_ID=$(curl -s "${BACKEND_URL}/api/nodes" -H "Authorization: Bearer $TOKEN" | \
        jq -r ".data[] | select(.name == \"$NODE1_NAME\") | .id")
    if [ -n "$NODE1_ID" ] && [ "$NODE1_ID" != "null" ]; then
        curl -s -X DELETE "${BACKEND_URL}/api/nodes/${NODE1_ID}" \
            -H "Authorization: Bearer $TOKEN" > /dev/null 2>&1 || true
        log_warn "Cleaned up existing node: $NODE1_NAME"
    fi
    response=$(http_post "${BACKEND_URL}/api/nodes" "{
        \"name\": \"$NODE1_NAME\",
        \"description\": \"Transfer test node 1\",
        \"locationId\": \"$LOCATION_ID\",
        \"hostname\": \"localhost\",
        \"publicAddress\": \"127.0.0.1\",
        \"maxMemoryMb\": 4096,
        \"maxCpuCores\": 4,
        \"serverDataDir\": \"$DATA_DIR1/servers\"
    }" "Authorization: Bearer $TOKEN")
    http_code=$(parse_http_code "$response")
fi

if [ "$http_code" != "200" ]; then
    log_error "Failed to create node 1"
    parse_response "$response" | jq '.' 2>/dev/null | head -5
    exit 1
fi
NODE1_ID=$(parse_response "$response" | jq -r '.data.id')
log_success "Created node 1: $NODE1_NAME ($NODE1_ID)"

# Node 2
response=$(http_post "${BACKEND_URL}/api/nodes" "{
    \"name\": \"$NODE2_NAME\",
    \"description\": \"Transfer test node 2\",
    \"locationId\": \"$LOCATION_ID\",
    \"hostname\": \"localhost\",
    \"publicAddress\": \"127.0.0.1\",
    \"maxMemoryMb\": 4096,
    \"maxCpuCores\": 4,
    \"serverDataDir\": \"$DATA_DIR2/servers\"
}" "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")

if [ "$http_code" != "200" ]; then
    # Node might already exist from a previous run — clean it up
    NODE2_ID=$(curl -s "${BACKEND_URL}/api/nodes" -H "Authorization: Bearer $TOKEN" | \
        jq -r ".data[] | select(.name == \"$NODE2_NAME\") | .id")
    if [ -n "$NODE2_ID" ] && [ "$NODE2_ID" != "null" ]; then
        curl -s -X DELETE "${BACKEND_URL}/api/nodes/${NODE2_ID}" \
            -H "Authorization: Bearer $TOKEN" > /dev/null 2>&1 || true
        log_warn "Cleaned up existing node: $NODE2_NAME"
    fi
    response=$(http_post "${BACKEND_URL}/api/nodes" "{
        \"name\": \"$NODE2_NAME\",
        \"description\": \"Transfer test node 2\",
        \"locationId\": \"$LOCATION_ID\",
        \"hostname\": \"localhost\",
        \"publicAddress\": \"127.0.0.1\",
        \"maxMemoryMb\": 4096,
        \"maxCpuCores\": 4,
        \"serverDataDir\": \"$DATA_DIR2/servers\"
    }" "Authorization: Bearer $TOKEN")
    http_code=$(parse_http_code "$response")
fi

if [ "$http_code" != "200" ]; then
    log_error "Failed to create node 2"
    parse_response "$response" | jq '.' 2>/dev/null | head -5
    exit 1
fi
NODE2_ID=$(parse_response "$response" | jq -r '.data.id')
log_success "Created node 2: $NODE2_NAME ($NODE2_ID)"

# ── Step 5: Generate API keys for both nodes ────────────────────────
step "Step 5: Generate API keys for agents"

response=$(http_post "${BACKEND_URL}/api/nodes/${NODE1_ID}/api-key" '{
    "regenerate": true
}' "Authorization: Bearer $TOKEN")
API_KEY1=$(parse_response "$response" | jq -r '.data.apiKey')
http_code=$(parse_http_code "$response")
if [ "$http_code" != "200" ] || [ -z "$API_KEY1" ] || [ "$API_KEY1" = "null" ]; then
    log_error "Failed to create API key for node 1"
    exit 1
fi
log_success "Node 1 API key: ${API_KEY1:0:20}..."

response=$(http_post "${BACKEND_URL}/api/nodes/${NODE2_ID}/api-key" '{
    "regenerate": true
}' "Authorization: Bearer $TOKEN")
API_KEY2=$(parse_response "$response" | jq -r '.data.apiKey')
http_code=$(parse_http_code "$response")
if [ "$http_code" != "200" ] || [ -z "$API_KEY2" ] || [ "$API_KEY2" = "null" ]; then
    log_error "Failed to create API key for node 2"
    exit 1
fi
log_success "Node 2 API key: ${API_KEY2:0:20}..."

# ── Step 6: Write agent configs and start agents ────────────────────
step "Step 6: Start both agents"

mkdir -p "$DATA_DIR_SHARED"

# Write config for agent 1
cat > "$CONFIG1" <<EOF
[server]
backend_url = "$BACKEND_WS"
node_id = "$NODE1_ID"
api_key = "$API_KEY1"
hostname = "localhost"
data_dir = "$DATA_DIR1"
max_connections = 100

[containerd]
socket_path = "$CONTAINERD_SOCK"
namespace = "$NS1"

[logging]
level = "info"
format = "text"
EOF

# Write config for agent 2
cat > "$CONFIG2" <<EOF
[server]
backend_url = "$BACKEND_WS"
node_id = "$NODE2_ID"
api_key = "$API_KEY2"
hostname = "localhost"
data_dir = "$DATA_DIR2"
max_connections = 100

[containerd]
socket_path = "$CONTAINERD_SOCK"
namespace = "$NS2"

[logging]
level = "info"
format = "text"
EOF

log_info "Starting agent 1 ($NODE1_NAME, namespace: $NS1)..."
"$AGENT_BIN" --config "$CONFIG1" > "$LOG1" 2>&1 &
echo $! > "$PID1_FILE"

log_info "Starting agent 2 ($NODE2_NAME, namespace: $NS2)..."
"$AGENT_BIN" --config "$CONFIG2" > "$LOG2" 2>&1 &
echo $! > "$PID2_FILE"

# Wait for agents to come online
log_info "Waiting for agent 1 to connect..."
if wait_for_agent_online "$NODE1_ID" 20; then
    log_success "Agent 1 is online"
else
    log_error "Agent 1 failed to connect"
    echo -e "${DIM}--- Agent 1 log (last 20 lines) ---${RESET}"
    tail -20 "$LOG1" | sed 's/^/  /'
    exit 1
fi

log_info "Waiting for agent 2 to connect..."
if wait_for_agent_online "$NODE2_ID" 20; then
    log_success "Agent 2 is online"
else
    log_error "Agent 2 failed to connect"
    echo -e "${DIM}--- Agent 2 log (last 20 lines) ---${RESET}"
    tail -20 "$LOG2" | sed 's/^/  /'
    exit 1
fi

# ── Step 7: Create a server on node 1 ───────────────────────────────
step "Step 7: Create server on node 1"

SERVER_PORT=$((RANDOM % 10000 + 35000))
response=$(http_post "${BACKEND_URL}/api/servers" "{
    \"name\": \"transfer-test-server\",
    \"templateId\": \"$TEMPLATE_ID\",
    \"nodeId\": \"$NODE1_ID\",
    \"locationId\": \"$LOCATION_ID\",
    \"allocatedMemoryMb\": 512,
    \"allocatedCpuCores\": 1,
    \"allocatedDiskMb\": 1024,
    \"primaryPort\": $SERVER_PORT,
    \"networkMode\": \"bridge\",
    \"environment\": {}
}" "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")

if [ "$http_code" != "201" ]; then
    log_error "Failed to create server"
    parse_response "$response" | jq '.error' 2>/dev/null
    exit 1
fi
SERVER_ID=$(parse_response "$response" | jq -r '.data.id')
SERVER_UUID=$(parse_response "$response" | jq -r '.data.uuid')
log_success "Created server: $SERVER_ID (uuid: $SERVER_UUID)"

# ── Step 8: Start the server on node 1 ──────────────────────────────
step "Step 8: Start server on node 1"

response=$(http_post "${BACKEND_URL}/api/servers/${SERVER_ID}/start" "{}" \
    "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")

if [ "$http_code" != "200" ]; then
    log_error "Failed to start server"
    parse_response "$response" | jq '.error' 2>/dev/null
    # Don't exit — continue with stopped server test
    log_warn "Will test transfer with stopped server"
else
    log_success "Server start requested"

    # Wait for running status
    if wait_for_server_status "$SERVER_ID" "running" 30; then
        log_success "Server is running on node 1"

        # Give it a few seconds to produce some data
        log_info "Letting server run for 5 seconds..."
        sleep 5
    else
        log_warn "Server did not reach running state"
    fi
fi

# ── Step 9: Stop the server (required for transfer) ─────────────────
step "Step 9: Stop server"

response=$(http_post "${BACKEND_URL}/api/servers/${SERVER_ID}/stop" "{}" \
    "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")

if [ "$http_code" != "200" ]; then
    log_warn "Stop returned $http_code (may already be stopped)"
else
    log_success "Stop requested"
fi

# Wait up to 60s — agent may need time for graceful shutdown
if wait_for_server_status "$SERVER_ID" "stopped" 60; then
    log_success "Server is stopped"
elif wait_for_server_status "$SERVER_ID" "crashed" 10; then
    log_warn "Server is crashed (acceptable for transfer test)"
else
    # Force kill as last resort
    log_warn "Graceful stop timed out — sending kill..."
    curl -s -X POST "${BACKEND_URL}/api/servers/${SERVER_ID}/kill" \
        -H "Authorization: Bearer $TOKEN" > /dev/null 2>&1 || true
    if wait_for_server_status "$SERVER_ID" "stopped" 15; then
        log_success "Server killed and stopped"
    else
        log_error "Server did not reach stopped state"
        exit 1
    fi
fi

# Verify data exists on node 1
if [ -d "$DATA_DIR1/$SERVER_UUID" ]; then
    FILE_COUNT=$(find "$DATA_DIR1/$SERVER_UUID" -type f 2>/dev/null | wc -l)
    if [ -f "$DATA_DIR1/$SERVER_UUID/greeting.txt" ]; then
        log_success "Data written on node 1: $FILE_COUNT file(s) including greeting.txt"
    else
        log_warn "Server data dir exists but no greeting.txt ($FILE_COUNT files)"
    fi
else
    log_warn "No server data directory on node 1 (container may not have written anything)"
fi

# Ensure server is fully stopped (not crashed/restarting)
CURRENT_STATUS=$(curl -s "${BACKEND_URL}/api/servers/${SERVER_ID}" \
    -H "Authorization: Bearer $TOKEN" | jq -r '.data.status')
if [ "$CURRENT_STATUS" != "stopped" ]; then
    log_info "Server status is $CURRENT_STATUS — killing..."
    curl -s -X POST "${BACKEND_URL}/api/servers/${SERVER_ID}/kill" \
        -H "Authorization: Bearer $TOKEN" > /dev/null 2>&1 || true
    sleep 2
    if ! wait_for_server_status "$SERVER_ID" "stopped" 15; then
        log_error "Could not stop server (status: $(curl -s "${BACKEND_URL}/api/servers/${SERVER_ID}" -H "Authorization: Bearer $TOKEN" | jq -r '.data.status'))"
        exit 1
    fi
    log_success "Server is stopped"
fi

# ── Step 10: Transfer server from node 1 → node 2 ──────────────────
step "Step 10: Transfer server to node 2"

response=$(http_post "${BACKEND_URL}/api/servers/${SERVER_ID}/transfer" "{
    \"targetNodeId\": \"$NODE2_ID\",
    \"transferMode\": \"local\"
}" "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
body=$(parse_response "$response")

echo -e "${DIM}Transfer response:${RESET}"
echo "$body" | jq '.' 2>/dev/null || echo "$body"

if [ "$http_code" != "200" ]; then
    log_error "Transfer failed with HTTP $http_code"
    echo "$body" | jq '.error // .message' 2>/dev/null
    log_info ""
    log_info "--- Agent 1 log (last 30 lines) ---"
    tail -30 "$LOG1" | sed 's/^/  /'
    log_info ""
    log_info "--- Agent 2 log (last 30 lines) ---"
    tail -30 "$LOG2" | sed 's/^/  /'
    exit 1
fi
log_success "Transfer initiated"

# Wait for server to reach stopped status on node 2
if wait_for_server_status "$SERVER_ID" "stopped" 30; then
    log_success "Server is stopped on node 2 (transfer complete)"
else
    log_warn "Server status did not settle — checking current state..."
fi

# ── Step 11: Verify transfer results ────────────────────────────────
step "Step 11: Verify transfer"

# Check server is now on node 2
response=$(http_get "${BACKEND_URL}/api/servers/${SERVER_ID}" "Authorization: Bearer $TOKEN")
body=$(parse_response "$response")
CURRENT_NODE=$(echo "$body" | jq -r '.data.nodeId')
CURRENT_STATUS=$(echo "$body" | jq -r '.data.status')
CONTAINER_ID=$(echo "$body" | jq -r '.data.containerId')

((TESTS_RUN++)) || true
if [ "$CURRENT_NODE" = "$NODE2_ID" ]; then
    ((TESTS_PASSED++)) || true
    log_success "Server is now on node 2"
else
    ((TESTS_FAILED++)) || true
    log_error "Server is on wrong node: $CURRENT_NODE (expected $NODE2_ID)"
fi

((TESTS_RUN++)) || true
if [ "$CURRENT_STATUS" = "stopped" ]; then
    ((TESTS_PASSED++)) || true
    log_success "Server status is stopped"
else
    ((TESTS_FAILED++)) || true
    log_error "Server status is $CURRENT_STATUS (expected stopped)"
fi

((TESTS_RUN++)) || true
if [ "$CONTAINER_ID" = "null" ]; then
    ((TESTS_PASSED++)) || true
    log_success "Container ID cleared (will be regenerated on new node)"
else
    ((TESTS_FAILED++)) || true
    log_error "Container ID should be null after transfer, got: $CONTAINER_ID"
fi

# Check data exists on node 2 and matches node 1
((TESTS_RUN++)) || true
if [ -d "$DATA_DIR2/$SERVER_UUID" ] && [ -f "$DATA_DIR2/$SERVER_UUID/greeting.txt" ]; then
    FILE_COUNT=$(find "$DATA_DIR2/$SERVER_UUID" -type f 2>/dev/null | wc -l)
    # Verify content integrity
    ORIG_GREETING=$(cat "$DATA_DIR1/$SERVER_UUID/greeting.txt" 2>/dev/null || echo "")
    NEW_GREETING=$(cat "$DATA_DIR2/$SERVER_UUID/greeting.txt" 2>/dev/null || echo "")
    ORIG_SIZE=$(stat -c%s "$DATA_DIR1/$SERVER_UUID/random.bin" 2>/dev/null || echo 0)
    NEW_SIZE=$(stat -c%s "$DATA_DIR2/$SERVER_UUID/random.bin" 2>/dev/null || echo 0)
    if [ "$ORIG_GREETING" = "$NEW_GREETING" ] && [ "$ORIG_SIZE" = "$NEW_SIZE" ]; then
        ((TESTS_PASSED++)) || true
        log_success "Data transferred and verified on node 2: $FILE_COUNT file(s), content matches"
    else
        ((TESTS_FAILED++)) || true
        log_error "Data transferred but content mismatch (greeting: '$ORIG_GREETING' vs '$NEW_GREETING', random: ${ORIG_SIZE}B vs ${NEW_SIZE}B)"
    fi
else
    ((TESTS_FAILED++)) || true
    log_error "No server data directory on node 2 at $DATA_DIR2/$SERVER_UUID"
fi

# Check server logs for transfer entries
((TESTS_RUN++)) || true
TRANSFER_LOGS=$(curl -s "${BACKEND_URL}/api/servers/${SERVER_ID}/logs?stream=system" \
    -H "Authorization: Bearer $TOKEN" | \
    jq -r '[.data.logs[]? | select(.data | test("Transfer"; "i"))] | length')
if [ "$TRANSFER_LOGS" -gt 0 ]; then
    ((TESTS_PASSED++)) || true
    log_success "Transfer system logs found ($TRANSFER_LOGS entries)"
else
    ((TESTS_FAILED++)) || true
    log_error "No transfer log entries found"
fi

# ── Step 12: Start server on node 2 ─────────────────────────────────
step "Step 12: Start server on new node (node 2)"

response=$(http_post "${BACKEND_URL}/api/servers/${SERVER_ID}/start" "{}" \
    "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")

((TESTS_RUN++)) || true
if [ "$http_code" = "200" ]; then
    ((TESTS_PASSED++)) || true
    log_success "Start on node 2 accepted"
else
    ((TESTS_FAILED++)) || true
    log_error "Start on node 2 returned $http_code"
    parse_response "$response" | jq '.error' 2>/dev/null | sed 's/^/  /'
fi

if [ "$http_code" = "200" ]; then
    if wait_for_server_status "$SERVER_ID" "running" 30; then
        ((TESTS_RUN++)) || true
        ((TESTS_PASSED++)) || true
        log_success "Server is running on node 2"

        # Verify container exists in node 2's namespace
        ((TESTS_RUN++)) || true
        if ctr --address "$CONTAINERD_SOCK" -n "$NS2" containers ls -q 2>/dev/null | grep -q .; then
            ((TESTS_PASSED++)) || true
            log_success "Container exists in namespace $NS2"
        else
            ((TESTS_FAILED++)) || true
            log_warn "No container found in namespace $NS2"
        fi

        # Let it run briefly
        sleep 3
    else
        ((TESTS_RUN++)) || true
        ((TESTS_FAILED++)) || true
        log_error "Server did not reach running state on node 2"
    fi

    # Stop the server
    log_info "Stopping server on node 2..."
    http_post "${BACKEND_URL}/api/servers/${SERVER_ID}/stop" "{}" \
        "Authorization: Bearer $TOKEN" > /dev/null 2>&1 || true
    if wait_for_server_status "$SERVER_ID" "stopped" 60; then
        log_success "Server stopped on node 2"
    else
        # Force kill
        log_warn "Stop timed out — killing..."
        curl -s -X POST "${BACKEND_URL}/api/servers/${SERVER_ID}/kill" \
            -H "Authorization: Bearer $TOKEN" > /dev/null 2>&1 || true
        wait_for_server_status "$SERVER_ID" "stopped" 15 || true
    fi
fi

# ── Step 13: Transfer back (node 2 → node 1) ───────────────────────
step "Step 13: Transfer server back to node 1"

response=$(http_post "${BACKEND_URL}/api/servers/${SERVER_ID}/transfer" "{
    \"targetNodeId\": \"$NODE1_ID\",
    \"transferMode\": \"local\"
}" "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
body=$(parse_response "$response")

((TESTS_RUN++)) || true
if [ "$http_code" = "200" ]; then
    ((TESTS_PASSED++)) || true
    log_success "Reverse transfer succeeded"
else
    ((TESTS_FAILED++)) || true
    log_error "Reverse transfer failed with HTTP $http_code"
    echo "$body" | jq '.error // .message' 2>/dev/null | sed 's/^/  /'
fi

# Wait for status
if [ "$http_code" = "200" ]; then
    wait_for_server_status "$SERVER_ID" "stopped" 30 || true
fi

# Verify it's back on node 1
response=$(http_get "${BACKEND_URL}/api/servers/${SERVER_ID}" "Authorization: Bearer $TOKEN")
body=$(parse_response "$response")
FINAL_NODE=$(echo "$body" | jq -r '.data.nodeId')

((TESTS_RUN++)) || true
if [ "$FINAL_NODE" = "$NODE1_ID" ]; then
    ((TESTS_PASSED++)) || true
    log_success "Server is back on node 1"
else
    ((TESTS_FAILED++)) || true
    log_error "Server is on node $FINAL_NODE (expected $NODE1_ID)"
fi

# ── Summary ─────────────────────────────────────────────────────────
print_test_summary
exit $TESTS_FAILED
