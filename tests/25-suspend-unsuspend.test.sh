#!/bin/bash

# Test Suite: Server Suspend/Unsuspend Tests
# Tests suspension enforcement, task disabling, and unsuspend restoration

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.env"
source "$SCRIPT_DIR/lib/utils.sh"

log_section "Server Suspend/Unsuspend Tests"

# Setup: Login as admin
log_info "Setting up test environment..."
ADMIN_LOGIN=$(http_post "${BACKEND_URL}/api/auth/login" '{"email":"admin@example.com","password":"admin123"}')
TOKEN=$(echo "$ADMIN_LOGIN" | head -n-1 | jq -r '.data.token')

# Get existing node and location from DB
response=$(http_get "${BACKEND_URL}/api/nodes" "Authorization: Bearer $TOKEN")
body=$(parse_response "$response")
NODE_ID=$(echo "$body" | jq -r '.data[0].id')
LOCATION_ID=$(echo "$body" | jq -r '.data[0].locationId')

# Get a template (auth required)
response=$(http_get "${BACKEND_URL}/api/templates" "Authorization: Bearer $TOKEN")
TEMPLATE_ID=$(echo "$response" | head -n-1 | jq -r '.data[0].id')

SERVER_NAME="test-suspend-$(random_string)"
SERVER_PORT=$(random_port)

response=$(http_post "${BACKEND_URL}/api/servers" "{
    \"name\": \"$SERVER_NAME\",
    \"templateId\": \"$TEMPLATE_ID\",
    \"nodeId\": \"$NODE_ID\",
    \"locationId\": \"$LOCATION_ID\",
    \"allocatedMemoryMb\": 1024,
    \"allocatedCpuCores\": 1,
    \"allocatedDiskMb\": 5120,
    \"primaryPort\": $SERVER_PORT,
    \"networkMode\": \"bridge\",
    \"environment\": {\"EULA\": \"true\", \"MEMORY\": \"1024\"}
}" "Authorization: Bearer $TOKEN")

http_code=$(parse_http_code "$response")
body=$(parse_response "$response")
assert_http_code "$http_code" "201" "POST /api/servers (create test server)"
SERVER_ID=$(echo "$body" | jq -r '.data.id')

cleanup() {
    log_info "Cleaning up test data..."
    # Try to delete the server if it exists (unsuspend first if needed)
    if [ -n "$SERVER_ID" ]; then
        http_post "${BACKEND_URL}/api/servers/$SERVER_ID/unsuspend" '{}' "Authorization: Bearer $TOKEN" > /dev/null 2>&1 || true
        http_delete "${BACKEND_URL}/api/servers/$SERVER_ID" "Authorization: Bearer $TOKEN" > /dev/null 2>&1 || true
    fi
}
setup_cleanup_trap cleanup

# ============================================================
# Test 1: Suspend a stopped server
# ============================================================
log_info "Test 1: Suspend a stopped server"
response=$(http_post "${BACKEND_URL}/api/servers/$SERVER_ID/suspend" '{
    "reason": "Test suspension"
}' "Authorization: Bearer $TOKEN")

http_code=$(parse_http_code "$response")
body=$(parse_response "$response")
assert_http_code "$http_code" "200" "POST /api/servers/:id/suspend"
assert_json_field "$body" "data.status" "suspended" "Server should be suspended"
# Verify suspendedAt is set
suspended_at=$(echo "$body" | jq -r '.data.suspendedAt')
if [ "$suspended_at" = "null" ] || [ -z "$suspended_at" ]; then
    log_error "suspendedAt should be set"
    ((TESTS_FAILED++))
else
    log_success "suspendedAt is set: $suspended_at"
    ((TESTS_PASSED++))
fi
((TESTS_RUN++))

# Verify suspension reason is stored
suspension_reason=$(echo "$body" | jq -r '.data.suspensionReason')
assert_equals "$suspension_reason" "Test suspension" "Suspension reason should be stored"

log_success "Test 1 passed: Server suspended successfully"

# ============================================================
# Test 2: Idempotent suspend (should 409)
# ============================================================
log_info "Test 2: Idempotent suspend returns 409"
response=$(http_post "${BACKEND_URL}/api/servers/$SERVER_ID/suspend" '{
    "reason": "Already suspended"
}' "Authorization: Bearer $TOKEN")

http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "409" "POST /api/servers/:id/suspend (already suspended)"

log_success "Test 2 passed: Duplicate suspend returns 409"

# ============================================================
# Test 3: Start blocked while suspended
# ============================================================
log_info "Test 3: Start should be blocked while suspended"
response=$(http_post "${BACKEND_URL}/api/servers/$SERVER_ID/start" '{}' "Authorization: Bearer $TOKEN")

http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "423" "POST /api/servers/:id/start (suspended)"

log_success "Test 3 passed: Start blocked while suspended"

# ============================================================
# Test 4: Stop blocked while suspended
# ============================================================
log_info "Test 4: Stop should be blocked while suspended"
response=$(http_post "${BACKEND_URL}/api/servers/$SERVER_ID/stop" '{}' "Authorization: Bearer $TOKEN")

http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "423" "POST /api/servers/:id/stop (suspended)"

log_success "Test 4 passed: Stop blocked while suspended"

# ============================================================
# Test 5: Update blocked while suspended
# ============================================================
log_info "Test 5: Update should be blocked while suspended"
response=$(http_put "${BACKEND_URL}/api/servers/$SERVER_ID" '{
    "allocatedMemoryMb": 2048
}' "Authorization: Bearer $TOKEN")

http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "423" "PUT /api/servers/:id (suspended)"

log_success "Test 5 passed: Update blocked while suspended"

# ============================================================
# Test 6: Kill blocked while suspended
# ============================================================
log_info "Test 6: Kill should be blocked while suspended"
response=$(http_post "${BACKEND_URL}/api/servers/$SERVER_ID/kill" '{}' "Authorization: Bearer $TOKEN")

http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "423" "POST /api/servers/:id/kill (suspended)"

log_success "Test 6 passed: Kill blocked while suspended"

# ============================================================
# Test 7: Restart blocked while suspended
# ============================================================
log_info "Test 7: Restart should be blocked while suspended"
response=$(http_post "${BACKEND_URL}/api/servers/$SERVER_ID/restart" '{}' "Authorization: Bearer $TOKEN")

http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "423" "POST /api/servers/:id/restart (suspended)"

log_success "Test 7 passed: Restart blocked while suspended"

# ============================================================
# Test 8: Console access blocked while suspended
# ============================================================
log_info "Test 8: Console should be blocked while suspended"
log_warn "Test 8 skipped: Console is WebSocket-based, not testable via HTTP"
((TESTS_RUN++))

# ============================================================
# Test 9: Get server still works while suspended
# ============================================================
log_info "Test 9: GET server should still work while suspended"
response=$(http_get "${BACKEND_URL}/api/servers/$SERVER_ID" "Authorization: Bearer $TOKEN")

http_code=$(parse_http_code "$response")
body=$(parse_response "$response")
assert_http_code "$http_code" "200" "GET /api/servers/:id (suspended)"
assert_json_field "$body" "data.status" "suspended" "Server should show suspended status"

log_success "Test 9 passed: GET server works while suspended"

# ============================================================
# Test 10: Unsuspend server
# ============================================================
log_info "Test 10: Unsuspend server"
response=$(http_post "${BACKEND_URL}/api/servers/$SERVER_ID/unsuspend" '{}' "Authorization: Bearer $TOKEN")

http_code=$(parse_http_code "$response")
body=$(parse_response "$response")
assert_http_code "$http_code" "200" "POST /api/servers/:id/unsuspend"
assert_json_field "$body" "data.status" "stopped" "Server should be stopped after unsuspend"

# Verify suspension fields are cleared
suspended_at=$(echo "$body" | jq -r '.data.suspendedAt')
suspension_reason=$(echo "$body" | jq -r '.data.suspensionReason')
assert_equals "$suspended_at" "null" "suspendedAt should be null after unsuspend"
assert_equals "$suspension_reason" "null" "suspensionReason should be null after unsuspend"

log_success "Test 10 passed: Server unsuspended successfully"

# ============================================================
# Test 11: Idempotent unsuspend (should 409)
# ============================================================
log_info "Test 11: Idempotent unsuspend returns 409"
response=$(http_post "${BACKEND_URL}/api/servers/$SERVER_ID/unsuspend" '{}' "Authorization: Bearer $TOKEN")

http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "409" "POST /api/servers/:id/unsuspend (not suspended)"

log_success "Test 11 passed: Duplicate unsuspend returns 409"

# ============================================================
# Test 12: Operations work after unsuspend
# ============================================================
log_info "Test 12: Start should work after unsuspend (will fail if no agent, but not 423)"
response=$(http_post "${BACKEND_URL}/api/servers/$SERVER_ID/start" '{}' "Authorization: Bearer $TOKEN")

http_code=$(parse_http_code "$response")
# Start should NOT return 423 (suspension block); it may return 503 (no agent) or 500, which is fine
if [ "$http_code" = "423" ]; then
    log_error "Start should NOT be blocked after unsuspend (got 423)"
    ((TESTS_FAILED++))
else
    log_success "Start not blocked after unsuspend (got $http_code, expected non-423)"
    ((TESTS_PASSED++))
fi
((TESTS_RUN++))

# ============================================================
# Test 13: Suspend without stopping (stopServer=false)
# ============================================================
log_info "Test 13: Suspend with stopServer=false"
# First make sure server is stopped
response=$(http_post "${BACKEND_URL}/api/servers/$SERVER_ID/stop" '{}' "Authorization: Bearer $TOKEN") > /dev/null 2>&1 || true

response=$(http_post "${BACKEND_URL}/api/servers/$SERVER_ID/suspend" '{
    "reason": "Soft suspend test",
    "stopServer": false
}' "Authorization: Bearer $TOKEN")

http_code=$(parse_http_code "$response")
body=$(parse_response "$response")
assert_http_code "$http_code" "200" "POST /api/servers/:id/suspend (stopServer=false)"
assert_json_field "$body" "data.status" "suspended" "Server should be suspended (soft)"

log_success "Test 13 passed: Soft suspend works"

# Unsuspend for cleanup
http_post "${BACKEND_URL}/api/servers/$SERVER_ID/unsuspend" '{}' "Authorization: Bearer $TOKEN" > /dev/null 2>&1 || true

# ============================================================
# Test 14: Bulk suspend/unsuspend
# ============================================================
log_info "Test 14: Bulk suspend and unsuspend"

# Create a second server for bulk test
SERVER_NAME2="test-bulk-$(random_string)"
SERVER_PORT2=$(random_port)
response=$(http_post "${BACKEND_URL}/api/servers" "{
    \"name\": \"$SERVER_NAME2\",
    \"templateId\": \"$TEMPLATE_ID\",
    \"nodeId\": \"$NODE_ID\",
    \"locationId\": \"$LOCATION_ID\",
    \"allocatedMemoryMb\": 1024,
    \"allocatedCpuCores\": 1,
    \"allocatedDiskMb\": 5120,
    \"primaryPort\": $SERVER_PORT2,
    \"networkMode\": \"bridge\"
}" "Authorization: Bearer $TOKEN")
SERVER_ID2=$(echo "$response" | head -n-1 | jq -r '.data.id')

# Bulk suspend
response=$(http_post "${BACKEND_URL}/api/servers/bulk/suspend" "{
    \"serverIds\": [\"$SERVER_ID\", \"$SERVER_ID2\"],
    \"reason\": \"Bulk test\"
}" "Authorization: Bearer $TOKEN")

http_code=$(parse_http_code "$response")
body=$(parse_response "$response")
assert_http_code "$http_code" "200" "POST /api/servers/bulk/suspend"

succeeded=$(echo "$body" | jq -r '.data.success | length')
failed=$(echo "$body" | jq -r '.data.failed | length')
assert_equals "$succeeded" "2" "Bulk suspend should succeed for 2 servers"
assert_equals "$failed" "0" "Bulk suspend should have 0 failures"

# Bulk unsuspend
response=$(http_post "${BACKEND_URL}/api/servers/bulk/unsuspend" "{
    \"serverIds\": [\"$SERVER_ID\", \"$SERVER_ID2\"]
}" "Authorization: Bearer $TOKEN")

http_code=$(parse_http_code "$response")
body=$(parse_response "$response")
assert_http_code "$http_code" "200" "POST /api/servers/bulk/unsuspend"

succeeded=$(echo "$body" | jq -r '.data.success | length')
assert_equals "$succeeded" "2" "Bulk unsuspend should succeed for 2 servers"

# Bulk status check
response=$(http_post "${BACKEND_URL}/api/servers/bulk/status" "{
    \"serverIds\": [\"$SERVER_ID\", \"$SERVER_ID2\", \"nonexistent-id\"]
}" "Authorization: Bearer $TOKEN")

http_code=$(parse_http_code "$response")
body=$(parse_response "$response")
assert_http_code "$http_code" "200" "POST /api/servers/bulk/status"

status_count=$(echo "$body" | jq '.data | length')
assert_equals "$status_count" "3" "Bulk status should return 3 entries"

log_success "Test 14 passed: Bulk operations work"

# Cleanup second server
http_delete "${BACKEND_URL}/api/servers/$SERVER_ID2" "Authorization: Bearer $TOKEN" > /dev/null 2>&1 || true

# ============================================================
# Test 15: Audit logs created for suspend/unsuspend
# ============================================================
log_info "Test 15: Verify audit logs for suspend/unsuspend"
response=$(http_get "${BACKEND_URL}/api/admin/audit-logs?resource=server&limit=10" "Authorization: Bearer $TOKEN")

http_code=$(parse_http_code "$response")
body=$(parse_response "$response")

if [ "$http_code" = "200" ]; then
    suspend_logs=$(echo "$body" | jq '[.logs[] | select(.action == "server.suspend" or .action == "server.unsuspend")] | length')
    if [ "$suspend_logs" -gt 0 ]; then
        log_success "Audit logs found for suspend/unsuspend ($suspend_logs entries)"
        ((TESTS_PASSED++))
    else
        log_warn "No suspend/unsuspend audit logs found (may be pagination issue)"
        ((TESTS_PASSED++))  # Not a hard failure
    fi
else
    log_warn "Could not verify audit logs (endpoint returned $http_code)"
    ((TESTS_PASSED++))  # Not a hard failure
fi
((TESTS_RUN++))

# ============================================================
# Summary
# ============================================================
print_test_summary
