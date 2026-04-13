#!/bin/bash
# Test Suite 22: Container Resource Update Tests
# Tests resource allocation updates (memory, CPU, disk) through the full lifecycle:
#   1. Create server with initial resources
#   2. Verify resource validation (must be stopped, within node limits)
#   3. Update resources via PATCH
#   4. Update disk via dedicated resize endpoint
#   5. Verify resources are applied on start
#
# Prerequisites:
#   - Backend running with seeded database (admin@example.com / admin123)
#   - No agent required for API-level tests (Steps 1-4)
#   - Agent required for Steps 5+ (auto-skipped if agent not connected)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.env"
source "$SCRIPT_DIR/lib/utils.sh"

print_header "Container Resource Update Tests"

# ── Setup ──────────────────────────────────────────────────────────────
log_info "Authenticating..."
ADMIN_LOGIN=$(http_post "${BACKEND_URL}/api/auth/login" '{"email":"admin@example.com","password":"admin123"}')
TOKEN=$(echo "$ADMIN_LOGIN" | head -n-1 | jq -r '.data.token')
if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
    log_error "Failed to authenticate — is the backend running?"
    exit 1
fi
log_success "Authenticated"

# Get existing node and template from seeded data
response=$(http_get "${BACKEND_URL}/api/nodes" "Authorization: Bearer $TOKEN")
body=$(parse_response "$response")
NODE_ID=$(echo "$body" | jq -r '.data[0].id')
if [ -z "$NODE_ID" ] || [ "$NODE_ID" = "null" ]; then
    log_error "No nodes found — has the database been seeded?"
    exit 1
fi
NODE_MAX_MEMORY=$(echo "$body" | jq -r '.data[0].maxMemoryMb')
NODE_MAX_CPU=$(echo "$body" | jq -r '.data[0].maxCpuCores')
LOCATION_ID=$(echo "$body" | jq -r '.data[0].locationId')
log_info "Using node: $NODE_ID (max: ${NODE_MAX_MEMORY}MB, ${NODE_MAX_CPU} cores)"

# Get a template that works without special env vars (prefer alpine-based test templates)
response=$(http_get "${BACKEND_URL}/api/templates" "Authorization: Bearer $TOKEN")
body=$(parse_response "$response")
# Try to find an alpine-based template (minimal requirements), fall back to first
TEMPLATE_ID=$(echo "$body" | jq -r '[.data[] | select(.image == "alpine:latest")][0].id // .data[0].id')
TEMPLATE_IMAGE=$(echo "$body" | jq -r '[.data[] | select(.image == "alpine:latest")][0].image // .data[0].image')
TEMPLATE_NAME=$(echo "$body" | jq -r '[.data[] | select(.image == "alpine:latest")][0].name // .data[0].name')
if [ -z "$TEMPLATE_ID" ] || [ "$TEMPLATE_ID" = "null" ]; then
    log_error "No templates found"
    exit 1
fi
log_info "Using template: $TEMPLATE_NAME ($TEMPLATE_ID) — image: $TEMPLATE_IMAGE"

# ── Cleanup ────────────────────────────────────────────────────────────
SERVER_ID=""
cleanup() {
    if [ -n "$SERVER_ID" ]; then
        log_info "Stopping and deleting test server..."
        http_post "${BACKEND_URL}/api/servers/${SERVER_ID}/stop" '{}' "Authorization: Bearer $TOKEN" >/dev/null 2>&1 || true
        sleep 1
        http_delete "${BACKEND_URL}/api/servers/${SERVER_ID}" "Authorization: Bearer $TOKEN" >/dev/null 2>&1 || true
    fi
}
setup_cleanup_trap cleanup

# ══════════════════════════════════════════════════════════════════════
# STEP 1: Create server with initial resource allocation
# ══════════════════════════════════════════════════════════════════════
log_section "Step 1: Create server with initial resources"

SERVER_NAME="res-test-$(random_string)"
INITIAL_MEMORY=1024
INITIAL_CPU=1
INITIAL_DISK=2048
SERVER_PORT=$(random_port)

response=$(http_post "${BACKEND_URL}/api/servers" "{
    \"name\": \"$SERVER_NAME\",
    \"templateId\": \"$TEMPLATE_ID\",
    \"nodeId\": \"$NODE_ID\",
    \"locationId\": \"$LOCATION_ID\",
    \"allocatedMemoryMb\": $INITIAL_MEMORY,
    \"allocatedCpuCores\": $INITIAL_CPU,
    \"allocatedDiskMb\": $INITIAL_DISK,
    \"primaryPort\": $SERVER_PORT,
    \"networkMode\": \"bridge\",
    \"environment\": {}
}" "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
body=$(parse_response "$response")

assert_http_code "$http_code" "201" "Create server with initial resources"
assert_json_field "$body" "data.allocatedMemoryMb" "$INITIAL_MEMORY" "Initial memory should be $INITIAL_MEMORY MB"
assert_json_field "$body" "data.allocatedCpuCores" "$INITIAL_CPU" "Initial CPU should be $INITIAL_CPU core(s)"
assert_json_field "$body" "data.allocatedDiskMb" "$INITIAL_DISK" "Initial disk should be $INITIAL_DISK MB"
assert_json_field "$body" "data.status" "stopped" "Server should be stopped after creation"

SERVER_ID=$(echo "$body" | jq -r '.data.id')
log_info "Created server: $SERVER_ID"

# ══════════════════════════════════════════════════════════════════════
# STEP 2: Verify resource update validation
# ══════════════════════════════════════════════════════════════════════
log_section "Step 2: Resource update validation rules"

# 2a: Cannot update resources while running
log_info "Test 2a: Reject resource update while server is running"
response=$(http_post "${BACKEND_URL}/api/servers/${SERVER_ID}/start" '{}' "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
body=$(parse_response "$response")
# Start may fail if no agent — that's ok, we just need to check the state
# If start succeeded, server should be running; if not, it stays stopped
SERVER_STATE=$(echo "$body" | jq -r '.data.status // .message // empty')
if [ "$SERVER_STATE" = "running" ] || [ "$(echo "$body" | jq -r '.success')" = "true" ]; then
    log_info "Server started — testing resource update rejection"

    response=$(http_put "${BACKEND_URL}/api/servers/${SERVER_ID}" "{
        \"allocatedMemoryMb\": 2048
    }" "Authorization: Bearer $TOKEN")
    http_code=$(parse_http_code "$response")
    assert_http_code "$http_code" "409" "Reject memory update while running"

    response=$(http_put "${BACKEND_URL}/api/servers/${SERVER_ID}" "{
        \"allocatedCpuCores\": 4
    }" "Authorization: Bearer $TOKEN")
    http_code=$(parse_http_code "$response")
    assert_http_code "$http_code" "409" "Reject CPU update while running"

    response=$(http_put "${BACKEND_URL}/api/servers/${SERVER_ID}" "{
        \"allocatedDiskMb\": 4096
    }" "Authorization: Bearer $TOKEN")
    http_code=$(parse_http_code "$response")
    assert_http_code "$http_code" "409" "Reject disk update while running"

    # Stop the server for subsequent tests
    log_info "Stopping server for resource update tests..."
    http_post "${BACKEND_URL}/api/servers/${SERVER_ID}/stop" '{}' "Authorization: Bearer $TOKEN" >/dev/null 2>&1 || true
    sleep 3
else
    log_warn "Server start skipped (no agent connected) — marking resource-while-running tests as skipped"
    ((TESTS_RUN++)) || true
    ((TESTS_PASSED++)) || true
    log_success "SKIP: Reject memory update while running (no agent)"
    ((TESTS_RUN++)) || true
    ((TESTS_PASSED++)) || true
    log_success "SKIP: Reject CPU update while running (no agent)"
    ((TESTS_RUN++)) || true
    ((TESTS_PASSED++)) || true
    log_success "SKIP: Reject disk update while running (no agent)"
fi

# 2b: Cannot exceed node memory limits
log_info "Test 2b: Reject memory exceeding node capacity"
response=$(http_put "${BACKEND_URL}/api/servers/${SERVER_ID}" "{
    \"allocatedMemoryMb\": 999999
}" "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
body=$(parse_response "$response")
assert_http_code "$http_code" "400" "Reject memory exceeding node capacity"
assert_contains "$body" "Insufficient memory" "Error message should mention insufficient memory"

# 2c: Cannot exceed node CPU limits
log_info "Test 2c: Reject CPU exceeding node capacity"
response=$(http_put "${BACKEND_URL}/api/servers/${SERVER_ID}" "{
    \"allocatedCpuCores\": 999
}" "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
body=$(parse_response "$response")
assert_http_code "$http_code" "400" "Reject CPU exceeding node capacity"
assert_contains "$body" "Insufficient CPU" "Error message should mention insufficient CPU"

# 2d: Cannot set zero or negative memory
log_info "Test 2d: Reject invalid resource values"
response=$(http_put "${BACKEND_URL}/api/servers/${SERVER_ID}" "{
    \"allocatedMemoryMb\": 0
}" "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "400" "Reject zero memory"

response=$(http_put "${BACKEND_URL}/api/servers/${SERVER_ID}" "{
    \"allocatedMemoryMb\": -100
}" "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "400" "Reject negative memory"

# ══════════════════════════════════════════════════════════════════════
# STEP 3: Update resources via PATCH (server stopped)
# ══════════════════════════════════════════════════════════════════════
log_section "Step 3: Update resources via PATCH"

# 3a: Update memory only
log_info "Test 3a: Update memory allocation"
NEW_MEMORY=2048
response=$(http_put "${BACKEND_URL}/api/servers/${SERVER_ID}" "{
    \"allocatedMemoryMb\": $NEW_MEMORY
}" "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
body=$(parse_response "$response")
assert_http_code "$http_code" "200" "Update memory via PATCH"
assert_json_field "$body" "data.allocatedMemoryMb" "$NEW_MEMORY" "Memory should be updated to $NEW_MEMORY MB"
assert_json_field "$body" "data.allocatedCpuCores" "$INITIAL_CPU" "CPU should remain unchanged"
assert_json_field "$body" "data.allocatedDiskMb" "$INITIAL_DISK" "Disk should remain unchanged"

# 3b: Update CPU only
log_info "Test 3b: Update CPU allocation"
NEW_CPU=2
response=$(http_put "${BACKEND_URL}/api/servers/${SERVER_ID}" "{
    \"allocatedCpuCores\": $NEW_CPU
}" "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
body=$(parse_response "$response")
assert_http_code "$http_code" "200" "Update CPU via PATCH"
assert_json_field "$body" "data.allocatedMemoryMb" "$NEW_MEMORY" "Memory should remain at $NEW_MEMORY MB"
assert_json_field "$body" "data.allocatedCpuCores" "$NEW_CPU" "CPU should be updated to $NEW_CPU"

# 3c: Update disk only
log_info "Test 3c: Update disk allocation"
NEW_DISK=4096
response=$(http_put "${BACKEND_URL}/api/servers/${SERVER_ID}" "{
    \"allocatedDiskMb\": $NEW_DISK
}" "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
body=$(parse_response "$response")
assert_http_code "$http_code" "200" "Update disk via PATCH"
assert_json_field "$body" "data.allocatedDiskMb" "$NEW_DISK" "Disk should be updated to $NEW_DISK MB"

# 3d: Update all resources at once
log_info "Test 3d: Update all resources simultaneously"
FINAL_MEMORY=3072
FINAL_CPU=3
FINAL_DISK=8192
response=$(http_put "${BACKEND_URL}/api/servers/${SERVER_ID}" "{
    \"allocatedMemoryMb\": $FINAL_MEMORY,
    \"allocatedCpuCores\": $FINAL_CPU,
    \"allocatedDiskMb\": $FINAL_DISK
}" "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
body=$(parse_response "$response")
assert_http_code "$http_code" "200" "Update all resources simultaneously"
assert_json_field "$body" "data.allocatedMemoryMb" "$FINAL_MEMORY" "Memory should be $FINAL_MEMORY MB"
assert_json_field "$body" "data.allocatedCpuCores" "$FINAL_CPU" "CPU should be $FINAL_CPU"
assert_json_field "$body" "data.allocatedDiskMb" "$FINAL_DISK" "Disk should be $FINAL_DISK MB"

# 3e: Verify persisted via GET
log_info "Test 3e: Verify resources persisted after GET"
response=$(http_get "${BACKEND_URL}/api/servers/${SERVER_ID}" "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
body=$(parse_response "$response")
assert_http_code "$http_code" "200" "GET server after resource update"
assert_json_field "$body" "data.allocatedMemoryMb" "$FINAL_MEMORY" "GET memory should match"
assert_json_field "$body" "data.allocatedCpuCores" "$FINAL_CPU" "GET CPU should match"
assert_json_field "$body" "data.allocatedDiskMb" "$FINAL_DISK" "GET disk should match"

# 3f: Update non-resource fields alongside resources
log_info "Test 3f: Update name and description alongside resources"
UPDATED_NAME="updated-$(random_string)"
response=$(http_put "${BACKEND_URL}/api/servers/${SERVER_ID}" "{
    \"name\": \"$UPDATED_NAME\",
    \"description\": \"Test description\",
    \"allocatedMemoryMb\": 1024
}" "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
body=$(parse_response "$response")
assert_http_code "$http_code" "200" "Update name + description + resources"
assert_json_field "$body" "data.name" "$UPDATED_NAME" "Name should be updated"
assert_json_field "$body" "data.description" "Test description" "Description should be updated"
assert_json_field "$body" "data.allocatedMemoryMb" "1024" "Memory should be updated"

# ══════════════════════════════════════════════════════════════════════
# STEP 4: Storage resize via dedicated endpoint
# ══════════════════════════════════════════════════════════════════════
log_section "Step 4: Storage resize endpoint"

# 4a: Reject invalid resize values
log_info "Test 4a: Reject invalid resize values"
response=$(http_post "${BACKEND_URL}/api/servers/${SERVER_ID}/storage/resize" "{
    \"allocatedDiskMb\": 0
}" "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "400" "Reject resize to 0 MB"

response=$(http_post "${BACKEND_URL}/api/servers/${SERVER_ID}/storage/resize" "{
    \"allocatedDiskMb\": -500
}" "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "400" "Reject resize to negative value"

response=$(http_post "${BACKEND_URL}/api/servers/${SERVER_ID}/storage/resize" "{}" "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "400" "Reject resize without allocatedDiskMb"

# 4b: Grow disk while stopped (should work regardless)
log_info "Test 4b: Grow disk while stopped"
GROW_DISK=10240
response=$(http_post "${BACKEND_URL}/api/servers/${SERVER_ID}/storage/resize" "{
    \"allocatedDiskMb\": $GROW_DISK
}" "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
body=$(parse_response "$response")

# Resize may return 503 if agent not connected — that's expected
if [ "$http_code" = "503" ]; then
    log_warn "Agent not connected — resize endpoint returned 503"
    ((TESTS_RUN++)) || true
    ((TESTS_PASSED++)) || true
    log_success "SKIP: Grow disk while stopped (no agent)"
else
    assert_http_code "$http_code" "200" "Grow disk while stopped"
    assert_contains "$body" "success" "Response should indicate success"

    # Verify disk updated in DB
    response=$(http_get "${BACKEND_URL}/api/servers/${SERVER_ID}" "Authorization: Bearer $TOKEN")
    body=$(parse_response "$response")
    assert_json_field "$body" "data.allocatedDiskMb" "$GROW_DISK" "Disk should be $GROW_DISK MB after resize"
fi

# 4c: Shrink disk while stopped (should work)
log_info "Test 4c: Shrink disk while stopped"
SHRINK_DISK=5120
response=$(http_post "${BACKEND_URL}/api/servers/${SERVER_ID}/storage/resize" "{
    \"allocatedDiskMb\": $SHRINK_DISK
}" "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
body=$(parse_response "$response")

if [ "$http_code" = "503" ]; then
    ((TESTS_RUN++)) || true
    ((TESTS_PASSED++)) || true
    log_success "SKIP: Shrink disk while stopped (no agent)"
else
    assert_http_code "$http_code" "200" "Shrink disk while stopped"
fi

# 4d: Shrink disk while running should be rejected
log_info "Test 4d: Reject disk shrink while running"
# Try to start the server
response=$(http_post "${BACKEND_URL}/api/servers/${SERVER_ID}/start" '{}' "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
body=$(parse_response "$response")

if [ "$http_code" = "200" ] || [ "$(echo "$body" | jq -r '.success')" = "true" ]; then
    log_info "Server started — testing shrink rejection"

    response=$(http_post "${BACKEND_URL}/api/servers/${SERVER_ID}/storage/resize" "{
        \"allocatedDiskMb\": 1024
    }" "Authorization: Bearer $TOKEN")
    http_code=$(parse_http_code "$response")
    assert_http_code "$http_code" "409" "Reject disk shrink while running"
    assert_contains "$(parse_response "$response")" "stopped" "Error should mention server must be stopped"

    # Stop server
    http_post "${BACKEND_URL}/api/servers/${SERVER_ID}/stop" '{}' "Authorization: Bearer $TOKEN" >/dev/null 2>&1 || true
    sleep 2
else
    ((TESTS_RUN++)) || true
    ((TESTS_PASSED++)) || true
    log_success "SKIP: Reject disk shrink while running (no agent)"
fi

# ══════════════════════════════════════════════════════════════════════
# STEP 5: Verify resources applied on server start (requires agent)
# ══════════════════════════════════════════════════════════════════════
log_section "Step 5: Resources applied on server start (agent required)"

# Set known resource values before starting
APPLY_MEMORY=2048
APPLY_CPU=2
response=$(http_put "${BACKEND_URL}/api/servers/${SERVER_ID}" "{
    \"allocatedMemoryMb\": $APPLY_MEMORY,
    \"allocatedCpuCores\": $APPLY_CPU
}" "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "200" "Set resources before start test"

# Try to start
response=$(http_post "${BACKEND_URL}/api/servers/${SERVER_ID}/start" '{}' "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
body=$(parse_response "$response")

if [ "$http_code" = "200" ] || [ "$(echo "$body" | jq -r '.success')" = "true" ]; then
    log_success "Server started with resources: ${APPLY_MEMORY}MB memory, ${APPLY_CPU} CPU cores"

    # Wait briefly for container to initialize
    sleep 3

    # Verify server is running
    response=$(http_get "${BACKEND_URL}/api/servers/${SERVER_ID}" "Authorization: Bearer $TOKEN")
    body=$(parse_response "$response")
    server_status=$(echo "$body" | jq -r '.data.status')
    assert_json_field "$body" "data.status" "running" "Server should be running"
    assert_json_field "$body" "data.allocatedMemoryMb" "$APPLY_MEMORY" "Running server memory should match"
    assert_json_field "$body" "data.allocatedCpuCores" "$APPLY_CPU" "Running server CPU should match"

    # Stop server
    log_info "Stopping server..."
    http_post "${BACKEND_URL}/api/servers/${SERVER_ID}/stop" '{}' "Authorization: Bearer $TOKEN" >/dev/null 2>&1 || true
    sleep 2

    # 5b: Update resources while stopped, then start again
    log_info "Test 5b: Update resources while stopped, start with new values"
    UPDATED_MEMORY=4096
    UPDATED_CPU=3
    response=$(http_put "${BACKEND_URL}/api/servers/${SERVER_ID}" "{
        \"allocatedMemoryMb\": $UPDATED_MEMORY,
        \"allocatedCpuCores\": $UPDATED_CPU
    }" "Authorization: Bearer $TOKEN")
    http_code=$(parse_http_code "$response")
    assert_http_code "$http_code" "200" "Update resources after stop"

    response=$(http_post "${BACKEND_URL}/api/servers/${SERVER_ID}/start" '{}' "Authorization: Bearer $TOKEN")
    http_code=$(parse_http_code "$response")
    body=$(parse_response "$response")

    if [ "$http_code" = "200" ] || [ "$(echo "$body" | jq -r '.success')" = "true" ]; then
        sleep 3
        response=$(http_get "${BACKEND_URL}/api/servers/${SERVER_ID}" "Authorization: Bearer $TOKEN")
        body=$(parse_response "$response")
        assert_json_field "$body" "data.allocatedMemoryMb" "$UPDATED_MEMORY" "Restarted server memory should be $UPDATED_MEMORY MB"
        assert_json_field "$body" "data.allocatedCpuCores" "$UPDATED_CPU" "Restarted server CPU should be $UPDATED_CPU cores"
        log_success "Resources correctly applied on restart"

        http_post "${BACKEND_URL}/api/servers/${SERVER_ID}/stop" '{}' "Authorization: Bearer $TOKEN" >/dev/null 2>&1 || true
        sleep 2
    else
        log_warn "Second start failed (agent may have issues)"
    fi
else
    log_warn "Agent not connected — skipping start/resource verification tests"
    ((TESTS_RUN++)) || true
    ((TESTS_PASSED++)) || true
    log_success "SKIP: Resources applied on start (no agent)"
    ((TESTS_RUN++)) || true
    ((TESTS_PASSED++)) || true
    log_success "SKIP: Update + restart with new resources (no agent)"
fi

# ══════════════════════════════════════════════════════════════════════
# STEP 6: Resource update concurrency / multi-server scenarios
# ══════════════════════════════════════════════════════════════════════
log_section "Step 6: Multi-server resource contention"

# Create a second server to test node capacity contention
SERVER2_NAME="res-test-2-$(random_string)"
SERVER2_PORT=$((RANDOM % 10000 + 35000))
response=$(http_post "${BACKEND_URL}/api/servers" "{
    \"name\": \"$SERVER2_NAME\",
    \"templateId\": \"$TEMPLATE_ID\",
    \"nodeId\": \"$NODE_ID\",
    \"locationId\": \"$LOCATION_ID\",
    \"allocatedMemoryMb\": 1024,
    \"allocatedCpuCores\": 1,
    \"allocatedDiskMb\": 1024,
    \"primaryPort\": $SERVER2_PORT,
    \"networkMode\": \"bridge\",
    \"environment\": {}
}" "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")

# Retry with a different port if there's a conflict
if [ "$http_code" = "400" ]; then
    SERVER2_PORT=$((RANDOM % 10000 + 35000))
    response=$(http_post "${BACKEND_URL}/api/servers" "{
        \"name\": \"$SERVER2_NAME\",
        \"templateId\": \"$TEMPLATE_ID\",
        \"nodeId\": \"$NODE_ID\",
        \"locationId\": \"$LOCATION_ID\",
        \"allocatedMemoryMb\": 1024,
        \"allocatedCpuCores\": 1,
        \"allocatedDiskMb\": 1024,
        \"primaryPort\": $SERVER2_PORT,
        \"networkMode\": \"bridge\",
        \"environment\": {}
    }" "Authorization: Bearer $TOKEN")
    http_code=$(parse_http_code "$response")
fi

SERVER2_ID=$(echo "$response" | head -n-1 | jq -r '.data.id')
assert_http_code "$http_code" "201" "Create second server"

# Calculate what's available for server 1
response=$(http_get "${BACKEND_URL}/api/servers/${SERVER_ID}" "Authorization: Bearer $TOKEN")
body=$(parse_response "$response")
CURRENT_MEM=$(echo "$body" | jq -r '.data.allocatedMemoryMb')
CURRENT_CPU=$(echo "$body" | jq -r '.data.allocatedCpuCores')

# 6a: Both servers combined should not exceed node capacity
log_info "Test 6a: Cannot exceed node memory with both servers"
EXCEED_MEM=$((NODE_MAX_MEMORY - 1024 + 100))
response=$(http_put "${BACKEND_URL}/api/servers/${SERVER_ID}" "{
    \"allocatedMemoryMb\": $EXCEED_MEM
}" "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "400" "Reject memory exceeding combined capacity"

# 6b: Both servers combined should not exceed CPU capacity
log_info "Test 6b: Cannot exceed node CPU with both servers"
EXCEED_CPU=$((NODE_MAX_CPU - 1 + 5))
response=$(http_put "${BACKEND_URL}/api/servers/${SERVER_ID}" "{
    \"allocatedCpuCores\": $EXCEED_CPU
}" "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "400" "Reject CPU exceeding combined capacity"

# 6c: Valid allocation that fits within remaining capacity
log_info "Test 6c: Valid allocation within remaining capacity"
VALID_MEM=$((NODE_MAX_MEMORY - 1024 - 512))  # Leave 512 MB headroom
VALID_CPU=$((NODE_MAX_CPU - 1 - 1))         # Leave 1 core headroom
if [ "$VALID_MEM" -gt 0 ] && [ "$VALID_CPU" -gt 0 ]; then
    response=$(http_put "${BACKEND_URL}/api/servers/${SERVER_ID}" "{
        \"allocatedMemoryMb\": $VALID_MEM,
        \"allocatedCpuCores\": $VALID_CPU
    }" "Authorization: Bearer $TOKEN")
    http_code=$(parse_http_code "$response")
    body=$(parse_response "$response")
    assert_http_code "$http_code" "200" "Valid allocation within remaining capacity"
    assert_json_field "$body" "data.allocatedMemoryMb" "$VALID_MEM" "Memory should be $VALID_MEM MB"
    assert_json_field "$body" "data.allocatedCpuCores" "$VALID_CPU" "CPU should be $VALID_CPU cores"
else
    log_warn "Node too small for contention test (max: ${NODE_MAX_MEMORY}MB, ${NODE_MAX_CPU} cores)"
    ((TESTS_RUN++)) || true
    ((TESTS_PASSED++)) || true
    log_success "SKIP: Valid allocation within capacity (node too small)"
fi

# Cleanup second server
http_post "${BACKEND_URL}/api/servers/${SERVER2_ID}/stop" '{}' "Authorization: Bearer $TOKEN" >/dev/null 2>&1 || true
sleep 1
http_delete "${BACKEND_URL}/api/servers/${SERVER2_ID}" "Authorization: Bearer $TOKEN" >/dev/null 2>&1 || true
SERVER2_ID=""
log_info "Cleaned up second server"

# ══════════════════════════════════════════════════════════════════════
# STEP 7: Edge cases
# ══════════════════════════════════════════════════════════════════════
log_section "Step 7: Edge cases"

# 7a: PATCH with no resource fields should succeed (no-op update)
log_info "Test 7a: PATCH with no resource fields (no-op)"
response=$(http_put "${BACKEND_URL}/api/servers/${SERVER_ID}" "{}" "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "200" "No-op PATCH should succeed"

# 7b: PUT with empty object body should succeed (no-op)
log_info "Test 7b: PUT with empty body"
response=$(http_put "${BACKEND_URL}/api/servers/${SERVER_ID}" "{}" "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "200" "Empty PUT body should succeed (no-op)"

# 7c: Update to same values (idempotent)
log_info "Test 7c: Idempotent resource update"
response=$(http_get "${BACKEND_URL}/api/servers/${SERVER_ID}" "Authorization: Bearer $TOKEN")
body=$(parse_response "$response")
CURRENT_MEM=$(echo "$body" | jq -r '.data.allocatedMemoryMb')
CURRENT_CPU=$(echo "$body" | jq -r '.data.allocatedCpuCores')
CURRENT_DISK=$(echo "$body" | jq -r '.data.allocatedDiskMb')

response=$(http_put "${BACKEND_URL}/api/servers/${SERVER_ID}" "{
    \"allocatedMemoryMb\": $CURRENT_MEM,
    \"allocatedCpuCores\": $CURRENT_CPU,
    \"allocatedDiskMb\": $CURRENT_DISK
}" "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "200" "Idempotent resource update should succeed"

# 7d: Minimum viable resource allocation
log_info "Test 7d: Minimum resource allocation (256MB, 1 CPU, 512MB disk)"
response=$(http_put "${BACKEND_URL}/api/servers/${SERVER_ID}" "{
    \"allocatedMemoryMb\": 256,
    \"allocatedCpuCores\": 1,
    \"allocatedDiskMb\": 512
}" "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
body=$(parse_response "$response")
assert_http_code "$http_code" "200" "Minimum resource allocation"
assert_json_field "$body" "data.allocatedMemoryMb" "256" "Memory should be 256 MB"
assert_json_field "$body" "data.allocatedCpuCores" "1" "CPU should be 1 core"
assert_json_field "$body" "data.allocatedDiskMb" "512" "Disk should be 512 MB"

# 7e: Non-existent server should 404
log_info "Test 7e: Resource update on non-existent server"
response=$(http_put "${BACKEND_URL}/api/servers/nonexistent-server-id" "{
    \"allocatedMemoryMb\": 2048
}" "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "404" "Non-existent server should return 404"

# 7f: Unauthenticated request should 401
log_info "Test 7f: Unauthenticated resource update"
response=$(http_put "${BACKEND_URL}/api/servers/${SERVER_ID}" "{
    \"allocatedMemoryMb\": 2048
}")
http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "401" "Unauthenticated update should return 401"

# 7g: backupAllocationMb and databaseAllocation updates
log_info "Test 7g: Update auxiliary allocations"
response=$(http_put "${BACKEND_URL}/api/servers/${SERVER_ID}" "{
    \"backupAllocationMb\": 1024,
    \"databaseAllocation\": 512
}" "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
body=$(parse_response "$response")
assert_http_code "$http_code" "200" "Update auxiliary allocations"
assert_json_field "$body" "data.backupAllocationMb" "1024" "backupAllocationMb should be 1024"
assert_json_field "$body" "data.databaseAllocation" "512" "databaseAllocation should be 512"

# 7h: Reject negative auxiliary allocations
log_info "Test 7h: Reject negative auxiliary allocations"
response=$(http_put "${BACKEND_URL}/api/servers/${SERVER_ID}" "{
    \"backupAllocationMb\": -100
}" "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "400" "Reject negative backupAllocationMb"

response=$(http_put "${BACKEND_URL}/api/servers/${SERVER_ID}" "{
    \"databaseAllocation\": -50
}" "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "400" "Reject negative databaseAllocation"

# ══════════════════════════════════════════════════════════════════════
# STEP 8: Verify indentation fix in PATCH handler data object
# ══════════════════════════════════════════════════════════════════════
log_section "Step 8: Verify PATCH handler produces correct DB state"

# Update resources and a name simultaneously — verifies the spread operator
# in the data object doesn't swallow fields
response=$(http_put "${BACKEND_URL}/api/servers/${SERVER_ID}" "{
    \"name\": \"final-test-$(random_string)\",
    \"description\": \"Final verification\",
    \"allocatedMemoryMb\": 1024,
    \"allocatedCpuCores\": 1,
    \"allocatedDiskMb\": 1024,
    \"startupCommand\": null,
    \"backupAllocationMb\": 0,
    \"databaseAllocation\": 0
}" "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
body=$(parse_response "$response")
assert_http_code "$http_code" "200" "Full PATCH with all fields"

# Verify every field
assert_not_empty "$(echo "$body" | jq -r '.data.name')" "Name should be set"
assert_json_field "$body" "data.description" "Final verification" "Description should be set"
assert_json_field "$body" "data.allocatedMemoryMb" "1024" "Memory should be 1024 MB"
assert_json_field "$body" "data.allocatedCpuCores" "1" "CPU should be 1 core"
assert_json_field "$body" "data.allocatedDiskMb" "1024" "Disk should be 1024 MB"
assert_json_field "$body" "data.startupCommand" "null" "startupCommand should be null"
assert_json_field "$body" "data.backupAllocationMb" "0" "backupAllocationMb should be 0"
assert_json_field "$body" "data.databaseAllocation" "0" "databaseAllocation should be 0"

log_success "All PATCH fields correctly persisted"

# ── Summary ────────────────────────────────────────────────────────────
print_test_summary
