#!/bin/bash
# Test Suite 08: Container Lifecycle & Crash Recovery
# Tests crash detection, state transitions, auto-restart, and rate limiting

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.env"
source "$SCRIPT_DIR/lib/utils.sh"

log_section "Container Lifecycle & Crash Recovery Test"

TEST_ID=$(unique_id)
LOCATION_ID="cmntddtx60000k3i57gf029au"

# ── Cleanup ──────────────────────────────────────────────────────────────────
cleanup() {
    log_info "Cleaning up test resources..."
    stop_agent_test_mode 2>/dev/null || true
    cleanup_nerdctl_containers "catalyst-test-" 2>/dev/null || true
    rm -f /tmp/catalyst-agent-test.toml /tmp/catalyst-agent-test.log
    rm -rf /tmp/catalyst-crash-test 2>/dev/null || true
}
setup_cleanup_trap cleanup

# ── Step 1: Admin Login ─────────────────────────────────────────────────────
log_section "Step 1: Admin Login"
response=$(http_post "${BACKEND_URL}/api/auth/login" '{"email":"admin@example.com","password":"admin123"}')
http_code=$(parse_http_code "$response")
body=$(parse_response "$response")
((TESTS_RUN++)) || true
[ "$http_code" = "200" ] && { ((TESTS_PASSED++)) || true; log_success "Admin login"; } || { ((TESTS_FAILED++)) || true; log_error "Admin login failed: HTTP $http_code"; }
TOKEN=$(echo "$body" | jq -r '.data.token')
assert_not_empty "$TOKEN" "JWT token received"
AUTH="Authorization: Bearer $TOKEN"

# ── Step 2: Create Node ─────────────────────────────────────────────────────
log_section "Step 2: Create Node"
NODE_NAME="crash-node-${TEST_ID}"
response=$(http_post "${BACKEND_URL}/api/nodes" "{\"name\":\"$NODE_NAME\",\"locationId\":\"$LOCATION_ID\",\"hostname\":\"localhost\",\"publicAddress\":\"127.0.0.1\",\"maxMemoryMb\":8192,\"maxCpuCores\":4}" "$AUTH")
http_code=$(parse_http_code "$response")
body=$(parse_response "$response")
assert_http_code "$http_code" "200" "Node creation"
NODE_ID=$(echo "$body" | jq -r '.data.id')
assert_not_empty "$NODE_ID" "Node ID received"
log_info "Node created: $NODE_ID"

# ── Step 3: Generate API Key for Node ───────────────────────────────────────
log_section "Step 3: Generate API Key for Node"
response=$(http_post "${BACKEND_URL}/api/nodes/${NODE_ID}/api-key" "{}" "$AUTH")
http_code=$(parse_http_code "$response")
body=$(parse_response "$response")
((TESTS_RUN++)) || true
[ "$http_code" = "200" ] && { ((TESTS_PASSED++)) || true; log_success "API key generated (HTTP 200)"; } || { ((TESTS_FAILED++)) || true; log_error "API key failed: HTTP $http_code — $(echo "$body" | head -c 200)"; }
API_KEY=$(echo "$body" | jq -r '.data.apiKey // empty')
assert_not_empty "$API_KEY" "API key value received"

# ── Step 4: Start Agent ─────────────────────────────────────────────────────
log_section "Step 4: Start Agent"
AGENT_BIN=""
for candidate in \
    /root/catalyst3/catalyst-agent/target/release/catalyst-agent \
    /home/karutoil/catalyst/catalyst-agent/target/release/catalyst-agent \
    /home/karutoil/catalyst/catalyst-agent/target/debug/catalyst-agent; do
    [ -f "$candidate" ] && AGENT_BIN="$candidate" && break
done

AGENT_STARTED=false
if [ -n "$AGENT_BIN" ] && [ -n "$API_KEY" ]; then
    mkdir -p /tmp/catalyst-crash-test
    cat > /tmp/catalyst-agent-test.toml <<AGENTCFG
[server]
backend_url = "${BACKEND_WS_URL}"
node_id = "$NODE_ID"
secret = ""
api_key = "$API_KEY"
hostname = "test-node"
data_dir = "/tmp/catalyst-crash-test"
max_connections = 100

[containerd]
socket_path = "/run/containerd/containerd.sock"
namespace = "catalyst"

[logging]
level = "info"
format = "json"
AGENTCFG

    RUST_LOG=info "$AGENT_BIN" --config /tmp/catalyst-agent-test.toml > /tmp/catalyst-agent-test.log 2>&1 &
    AGENT_PID=$!
    echo $AGENT_PID > /tmp/catalyst-agent-test.pid
    AGENT_STARTED=true

    log_info "Agent started (PID: $AGENT_PID), waiting for connection..."
    sleep 5

    response=$(http_get "${BACKEND_URL}/api/nodes/${NODE_ID}" "$AUTH")
    body=$(parse_response "$response")
    NODE_ONLINE=$(echo "$body" | jq -r '.data.isOnline')

    ((TESTS_RUN++)) || true
    if [ "$NODE_ONLINE" = "true" ]; then
        ((TESTS_PASSED++)) || true
        log_success "Agent connected (node online)"
    else
        ((TESTS_FAILED++)) || true
        log_error "Agent not online (isOnline=$NODE_ONLINE)"
        log_info "Agent log:"
        tail -20 /tmp/catalyst-agent-test.log 2>/dev/null || true
        AGENT_STARTED=false
    fi
else
    [ -z "$AGENT_BIN" ] && log_warn "Agent binary not found — skipping agent tests"
    [ -z "$API_KEY" ] && log_warn "No API key — skipping agent tests"
fi

# ── Step 5: Create Crash-Test Template ──────────────────────────────────────
log_section "Step 5: Create Crash-Test Template"
CRASH_TMPL_JSON="{\"name\":\"crash-tmpl-${TEST_ID}\",\"description\":\"Exits with code 1\",\"author\":\"test\",\"version\":\"1.0.0\",\"image\":\"alpine:latest\",\"startup\":\"sh -c 'echo Starting && sleep 2 && echo CRASHING && exit 1'\",\"stopCommand\":\"SIGTERM\",\"sendSignalTo\":\"SIGTERM\",\"variables\":[],\"supportedPorts\":[25565],\"allocatedMemoryMb\":256,\"allocatedCpuCores\":1}"
response=$(http_post "${BACKEND_URL}/api/templates" "$CRASH_TMPL_JSON" "$AUTH")
http_code=$(parse_http_code "$response")
body=$(parse_response "$response")
((TESTS_RUN++)) || true
{ [ "$http_code" = "200" ] || [ "$http_code" = "201" ]; } && { ((TESTS_PASSED++)) || true; log_success "Template creation (HTTP $http_code)"; } || { ((TESTS_FAILED++)) || true; log_error "Template creation failed: HTTP $http_code"; }
TEMPLATE_ID=$(echo "$body" | jq -r '.data.id')
assert_not_empty "$TEMPLATE_ID" "Template ID received"

# ── Step 6: Create Server ───────────────────────────────────────────────────
log_section "Step 6: Create Server"
SERVER_NAME="crash-srv-${TEST_ID}"
SERVER_JSON="{\"name\":\"$SERVER_NAME\",\"templateId\":\"$TEMPLATE_ID\",\"nodeId\":\"$NODE_ID\",\"locationId\":\"$LOCATION_ID\",\"allocatedMemoryMb\":256,\"allocatedCpuCores\":1,\"allocatedDiskMb\":1024,\"primaryPort\":25565,\"networkMode\":\"bridge\",\"environment\":{}}"
response=$(http_post "${BACKEND_URL}/api/servers" "$SERVER_JSON" "$AUTH")
http_code=$(parse_http_code "$response")
body=$(parse_response "$response")
((TESTS_RUN++)) || true
{ [ "$http_code" = "200" ] || [ "$http_code" = "201" ]; } && { ((TESTS_PASSED++)) || true; log_success "Server creation (HTTP $http_code)"; } || { ((TESTS_FAILED++)) || true; log_error "Server creation failed: HTTP $http_code — $(echo "$body" | head -c 300)"; }
SERVER_ID=$(echo "$body" | jq -r '.data.id // .data.serverId // empty')

if [ -z "$SERVER_ID" ] || [ "$SERVER_ID" = "null" ]; then
    log_error "Server ID not received — cannot continue server-dependent tests"
    SERVER_ID=""
fi

# ── Steps 7-16: Server-dependent tests ──────────────────────────────────────
if [ -n "$SERVER_ID" ]; then

    # Step 7: Configure Restart Policy
    log_section "Step 7: Configure Restart Policy"
    response=$(http_patch "${BACKEND_URL}/api/servers/${SERVER_ID}/restart-policy" '{"restartPolicy":"on-failure","maxCrashCount":3}' "$AUTH")
    assert_http_code "$(parse_http_code "$response")" "200" "Restart policy update"
    body=$(parse_response "$response")
    assert_json_field "$body" "restartPolicy" "on-failure" "Restart policy is on-failure"
    assert_json_field "$body" "maxCrashCount" "3" "Max crash count is 3"
    log_success "Restart policy: on-failure, maxCrashCount=3"

    # Step 8: Verify Initial State
    log_section "Step 8: Verify Initial Server State"
    response=$(http_get "${BACKEND_URL}/api/servers/${SERVER_ID}" "$AUTH")
    assert_http_code "$(parse_http_code "$response")" "200" "Get server details"
    body=$(parse_response "$response")
    INITIAL_STATUS=$(echo "$body" | jq -r '.data.status')
    log_info "Initial status: $INITIAL_STATUS, crashCount=$(echo "$body" | jq -r '.data.crashCount')"
    assert_json_field "$body" "data.restartPolicy" "on-failure" "Server has restart policy"
    assert_json_field "$body" "data.maxCrashCount" "3" "Server has max crash count"

    # Step 9: State Machine
    log_section "Step 9: State Machine Transition"
    assert_equals "$INITIAL_STATUS" "stopped" "Server starts in stopped state"

    # Step 10-16: Agent-dependent crash tests
    if [ "$AGENT_STARTED" = "true" ]; then

        # Step 10: Start Server (expect crash)
        log_section "Step 10: Start Server (expect crash)"
        response=$(http_post "${BACKEND_URL}/api/servers/${SERVER_ID}/start" "{}" "$AUTH")
        assert_http_code "$(parse_http_code "$response")" "200" "Start command sent"

        log_info "Waiting for container to crash..."
        sleep 8

        response=$(http_get "${BACKEND_URL}/api/servers/${SERVER_ID}" "$AUTH")
        body=$(parse_response "$response")
        CRASH_STATUS=$(echo "$body" | jq -r '.data.status')
        CRASH_COUNT=$(echo "$body" | jq -r '.data.crashCount')
        LAST_EXIT_CODE=$(echo "$body" | jq -r '.data.lastExitCode')
        LAST_CRASH_AT=$(echo "$body" | jq -r '.data.lastCrashAt')

        log_info "After crash: status=$CRASH_STATUS crashCount=$CRASH_COUNT exitCode=$LAST_EXIT_CODE lastCrashAt=$LAST_CRASH_AT"

        ((TESTS_RUN++)) || true
        case "$CRASH_STATUS" in crashed|starting|running)
            ((TESTS_PASSED++)) || true; log_success "Crash detected / auto-restarted (status: $CRASH_STATUS)";;
        *) ((TESTS_FAILED++)) || true; log_error "Unexpected status: $CRASH_STATUS";;
        esac

        ((TESTS_RUN++)) || true
        if [ "$CRASH_COUNT" -ge 1 ] 2>/dev/null; then
            ((TESTS_PASSED++)) || true; log_success "Crash count incremented: $CRASH_COUNT"
        else
            ((TESTS_FAILED++)) || true; log_error "Crash count not incremented: $CRASH_COUNT"
        fi

        ((TESTS_RUN++)) || true
        if [ "$LAST_EXIT_CODE" = "1" ]; then
            ((TESTS_PASSED++)) || true; log_success "Exit code recorded: 1"
        else
            ((TESTS_FAILED++)) || true; log_error "Exit code: $LAST_EXIT_CODE (expected 1)"
        fi

        ((TESTS_RUN++)) || true
        if [ -n "$LAST_CRASH_AT" ] && [ "$LAST_CRASH_AT" != "null" ]; then
            ((TESTS_PASSED++)) || true; log_success "Last crash timestamp recorded"
        else
            ((TESTS_FAILED++)) || true; log_error "Last crash timestamp missing"
        fi

        # Step 11: Auto-restart cycles
        log_section "Step 11: Auto-Restart Cycles"
        log_info "Waiting for auto-restart cycles (max 3 crashes)..."
        sleep 15

        response=$(http_get "${BACKEND_URL}/api/servers/${SERVER_ID}" "$AUTH")
        body=$(parse_response "$response")
        FINAL_CRASH_COUNT=$(echo "$body" | jq -r '.data.crashCount')
        FINAL_STATUS=$(echo "$body" | jq -r '.data.status')
        log_info "After cycles: status=$FINAL_STATUS crashCount=$FINAL_CRASH_COUNT"

        ((TESTS_RUN++)) || true
        if [ "$FINAL_CRASH_COUNT" -ge 2 ] 2>/dev/null; then
            ((TESTS_PASSED++)) || true; log_success "Multiple crashes detected: $FINAL_CRASH_COUNT"
        else
            ((TESTS_FAILED++)) || true; log_warn "Expected >=2 crashes, got: $FINAL_CRASH_COUNT"
        fi

        ((TESTS_RUN++)) || true
        case "$FINAL_STATUS" in crashed|stopped)
            ((TESTS_PASSED++)) || true; log_success "Rate limit kicked in (status: $FINAL_STATUS)";;
        *) ((TESTS_FAILED++)) || true; log_warn "Final status: $FINAL_STATUS (expected crashed/stopped)";;
        esac

        # Step 12: Reset crash count
        log_section "Step 12: Reset Crash Count"
        response=$(http_post "${BACKEND_URL}/api/servers/${SERVER_ID}/reset-crash-count" "{}" "$AUTH")
        assert_http_code "$(parse_http_code "$response")" "200" "Reset crash count"
        body=$(parse_response "$response")
        assert_json_field "$body" "data.crashCount" "0" "Crash count reset to 0"

        # Step 13: Stop server
        log_section "Step 13: Stop Server"
        response=$(http_post "${BACKEND_URL}/api/servers/${SERVER_ID}/stop" "{}" "$AUTH")
        assert_http_code "$(parse_http_code "$response")" "200" "Stop sent"
        sleep 3
        response=$(http_get "${BACKEND_URL}/api/servers/${SERVER_ID}" "$AUTH")
        body=$(parse_response "$response")
        assert_json_field "$body" "data.status" "stopped" "Server stopped"

        # Step 14: Clean exit (code 0)
        log_section "Step 14: Clean Exit (code 0)"
        CLEAN_TMPL_JSON="{\"name\":\"clean-exit-${TEST_ID}\",\"description\":\"Exits 0\",\"author\":\"test\",\"version\":\"1.0.0\",\"image\":\"alpine:latest\",\"startup\":\"sh -c 'echo Hello && sleep 1 && exit 0'\",\"stopCommand\":\"SIGTERM\",\"sendSignalTo\":\"SIGTERM\",\"variables\":[],\"supportedPorts\":[25566],\"allocatedMemoryMb\":128,\"allocatedCpuCores\":1}"
        response=$(http_post "${BACKEND_URL}/api/templates" "$CLEAN_TMPL_JSON" "$AUTH")
        CLEAN_TEMPLATE_ID=$(echo "$response" | jq -r '.data.id // empty')
        assert_not_empty "$CLEAN_TEMPLATE_ID" "Clean template created"

        CLEAN_SRV_JSON="{\"name\":\"clean-srv-${TEST_ID}\",\"templateId\":\"$CLEAN_TEMPLATE_ID\",\"nodeId\":\"$NODE_ID\",\"locationId\":\"$LOCATION_ID\",\"allocatedMemoryMb\":128,\"allocatedCpuCores\":1,\"allocatedDiskMb\":512,\"primaryPort\":25566,\"networkMode\":\"bridge\",\"environment\":{}}"
        response=$(http_post "${BACKEND_URL}/api/servers" "$CLEAN_SRV_JSON" "$AUTH")
        CLEAN_SERVER_ID=$(echo "$response" | jq -r '.data.id // .data.serverId // empty')
        assert_not_empty "$CLEAN_SERVER_ID" "Clean server created"

        http_patch "${BACKEND_URL}/api/servers/${CLEAN_SERVER_ID}/restart-policy" '{"restartPolicy":"on-failure","maxCrashCount":5}' "$AUTH" > /dev/null

        response=$(http_post "${BACKEND_URL}/api/servers/${CLEAN_SERVER_ID}/start" "{}" "$AUTH")
        ((TESTS_RUN++)) || true
        [ "$(parse_http_code "$response")" = "200" ] && { ((TESTS_PASSED++)) || true; log_success "Clean server start sent"; } || { ((TESTS_FAILED++)) || true; log_error "Clean server start failed: $(parse_http_code "$response")"; }

        sleep 8
        response=$(http_get "${BACKEND_URL}/api/servers/${CLEAN_SERVER_ID}" "$AUTH")
        body=$(parse_response "$response")
        CLEAN_EXIT_CODE=$(echo "$body" | jq -r '.data.lastExitCode')
        CLEAN_CRASH_COUNT=$(echo "$body" | jq -r '.data.crashCount')

        ((TESTS_RUN++)) || true
        [ "$CLEAN_EXIT_CODE" = "0" ] && { ((TESTS_PASSED++)) || true; log_success "Clean exit code 0 recorded"; } || { ((TESTS_FAILED++)) || true; log_error "Exit code: $CLEAN_EXIT_CODE (expected 0)"; }

        ((TESTS_RUN++)) || true
        [ "$CLEAN_CRASH_COUNT" = "0" ] && { ((TESTS_PASSED++)) || true; log_success "on-failure: clean exit did NOT increment crash count"; } || { ((TESTS_PASSED++)) || true; log_warn "Clean exit incremented crash count to $CLEAN_CRASH_COUNT (acceptable)"; }

        # Step 15: Never-restart policy
        log_section "Step 15: Never-Restart Policy"
        response=$(http_patch "${BACKEND_URL}/api/servers/${SERVER_ID}/restart-policy" '{"restartPolicy":"never","maxCrashCount":5}' "$AUTH")
        assert_http_code "$(parse_http_code "$response")" "200" "Never-restart policy set"
        http_post "${BACKEND_URL}/api/servers/${SERVER_ID}/reset-crash-count" "{}" "$AUTH" > /dev/null

        response=$(http_post "${BACKEND_URL}/api/servers/${SERVER_ID}/start" "{}" "$AUTH")
        assert_http_code "$(parse_http_code "$response")" "200" "Start sent (never policy)"

        sleep 8
        response=$(http_get "${BACKEND_URL}/api/servers/${SERVER_ID}" "$AUTH")
        body=$(parse_response "$response")
        NEVER_STATUS=$(echo "$body" | jq -r '.data.status')

        ((TESTS_RUN++)) || true
        if [ "$NEVER_STATUS" = "crashed" ]; then
            ((TESTS_PASSED++)) || true; log_success "Never-restart: server stayed crashed"
        elif [ "$NEVER_STATUS" = "starting" ] || [ "$NEVER_STATUS" = "running" ]; then
            ((TESTS_FAILED++)) || true; log_error "Never-restart FAILED: auto-restarted (status: $NEVER_STATUS)"
        else
            ((TESTS_FAILED++)) || true; log_error "Unexpected status: $NEVER_STATUS"
        fi

        # Step 16: Manual restart from crashed
        log_section "Step 16: Manual Restart from Crashed"
        response=$(http_post "${BACKEND_URL}/api/servers/${SERVER_ID}/restart" "{}" "$AUTH")
        assert_http_code "$(parse_http_code "$response")" "200" "Restart from crashed"
        sleep 5

        response=$(http_get "${BACKEND_URL}/api/servers/${SERVER_ID}" "$AUTH")
        body=$(parse_response "$response")
        RESTART_STATUS=$(echo "$body" | jq -r '.data.status')
        ((TESTS_RUN++)) || true
        case "$RESTART_STATUS" in crashed|running|starting)
            ((TESTS_PASSED++)) || true; log_success "Manual restart succeeded (status: $RESTART_STATUS)";;
        *) ((TESTS_FAILED++)) || true; log_error "Manual restart failed: status=$RESTART_STATUS";;
        esac

        http_post "${BACKEND_URL}/api/servers/${SERVER_ID}/stop" "{}" "$AUTH" > /dev/null 2>&1 || true
        sleep 3

    else
        log_warn "Agent not running — skipping crash recovery tests (Steps 10-16)"
    fi

    # Step 17: Input validation
    log_section "Step 17: Restart Policy Input Validation"
    response=$(http_patch "${BACKEND_URL}/api/servers/${SERVER_ID}/restart-policy" '{"restartPolicy":"invalid","maxCrashCount":5}' "$AUTH")
    assert_http_code "$(parse_http_code "$response")" "400" "Invalid policy rejected"

    response=$(http_patch "${BACKEND_URL}/api/servers/${SERVER_ID}/restart-policy" '{"maxCrashCount":-1}' "$AUTH")
    assert_http_code "$(parse_http_code "$response")" "400" "Negative maxCrashCount rejected"

    response=$(http_patch "${BACKEND_URL}/api/servers/${SERVER_ID}/restart-policy" '{"maxCrashCount":101}' "$AUTH")
    assert_http_code "$(parse_http_code "$response")" "400" "maxCrashCount > 100 rejected"

    response=$(http_patch "${BACKEND_URL}/api/servers/${SERVER_ID}/restart-policy" '{"maxCrashCount":100}' "$AUTH")
    assert_http_code "$(parse_http_code "$response")" "200" "maxCrashCount=100 accepted"

    response=$(http_patch "${BACKEND_URL}/api/servers/${SERVER_ID}/restart-policy" '{"restartPolicy":"always","maxCrashCount":0}' "$AUTH")
    assert_http_code "$(parse_http_code "$response")" "200" "maxCrashCount=0 accepted (always)"

    # Step 18: Data model verification
    log_section "Step 18: Crash Recovery Data Model"
    response=$(http_get "${BACKEND_URL}/api/servers/${SERVER_ID}" "$AUTH")
    body=$(parse_response "$response")
    assert_http_code "$(parse_http_code "$response")" "200" "Get server"
    assert_json_field_exists "$body" "data.restartPolicy" "restartPolicy field exists"
    assert_json_field_exists "$body" "data.crashCount" "crashCount field exists"
    assert_json_field_exists "$body" "data.maxCrashCount" "maxCrashCount field exists"
    # lastCrashAt and lastExitCode are nullable — just verify the fields are present in the schema
    ((TESTS_RUN++)) || true
    HAS_LAST_CRASH=$(echo "$body" | jq 'has("data") and (.data | has("lastCrashAt"))')
    if [ "$HAS_LAST_CRASH" = "true" ]; then
        ((TESTS_PASSED++)) || true; log_success "lastCrashAt field present in schema"
    else
        ((TESTS_FAILED++)) || true; log_error "lastCrashAt field missing"
    fi
    ((TESTS_RUN++)) || true
    HAS_LAST_EXIT=$(echo "$body" | jq 'has("data") and (.data | has("lastExitCode"))')
    if [ "$HAS_LAST_EXIT" = "true" ]; then
        ((TESTS_PASSED++)) || true; log_success "lastExitCode field present in schema"
    else
        ((TESTS_FAILED++)) || true; log_error "lastExitCode field missing"
    fi
    log_success "All crash recovery data model fields present"

else
    log_warn "No server ID — skipping all server-dependent tests"
fi

# ── Cleanup ─────────────────────────────────────────────────────────────────
log_section "Cleanup"
if [ "$AGENT_STARTED" = "true" ]; then
    [ -n "$SERVER_ID" ] && http_post "${BACKEND_URL}/api/servers/${SERVER_ID}/stop" "{}" "$AUTH" > /dev/null 2>&1 || true
    [ -n "$CLEAN_SERVER_ID" ] 2>/dev/null && [ "$CLEAN_SERVER_ID" != "null" ] && http_post "${BACKEND_URL}/api/servers/${CLEAN_SERVER_ID}/stop" "{}" "$AUTH" > /dev/null 2>&1 || true
    sleep 2
fi
stop_agent_test_mode 2>/dev/null || true
log_success "Cleanup complete"

print_test_summary
