#!/bin/bash

# Test Suite 03: Node Management Tests
# Tests node CRUD operations and status tracking

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.env"
source "$SCRIPT_DIR/lib/utils.sh"

log_section "Node Management Tests"

# Setup: Create test user
log_info "Logging in as admin..."
EMAIL="admin@example.com"
PASSWORD="admin123"
response=$(http_post "${BACKEND_URL}/api/auth/login" "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
TOKEN=$(echo "$response" | head -n-1 | jq -r '.data.token')

# Create a location first (or use existing)
log_info "Getting existing location from database..."
# First try to get existing location
response=$(http_get "${BACKEND_URL}/api/nodes" "Authorization: Bearer $TOKEN")
body=$(parse_response "$response")
LOCATION_ID=$(echo "$body" | jq -r '.data[0].locationId // empty')

if [ -z "$LOCATION_ID" ] || [ "$LOCATION_ID" = "null" ]; then
    log_info "No existing location found, tests may fail if /api/locations endpoint doesn't exist"
    # Use a known location ID from seed data
    LOCATION_ID="cmkspe7nq0000sw3ctcc39e8z"
fi
log_info "Using location ID: $LOCATION_ID"

cleanup() {
    log_info "Cleaning up test data..."
}
setup_cleanup_trap cleanup

# Get existing location from seeded data
log_info "Getting existing location..."
response=$(http_get "${BACKEND_URL}/api/nodes" "Authorization: Bearer $TOKEN")
body=$(parse_response "$response")
LOCATION_ID=$(echo "$body" | jq -r '.data[0].locationId // empty')

if [ -z "$LOCATION_ID" ]; then
    log_error "No location found in database. Please run: bun run db:seed"
    exit 1
fi
log_success "Using location: $LOCATION_ID"

# Test 1: Create Node
log_info "Test 1: Create node"
NODE_NAME="test-node-$(random_string)"
NODE_HOSTNAME="test-host-$(random_string).example.com"
NODE_IP="192.168.1.$(shuf -i 1-254 -n 1)"
response=$(http_post "${BACKEND_URL}/api/nodes" "{\"name\":\"$NODE_NAME\",\"locationId\":\"$LOCATION_ID\",\"hostname\":\"$NODE_HOSTNAME\",\"publicAddress\":\"$NODE_IP\",\"maxMemoryMb\":16384,\"maxCpuCores\":8}" "Authorization: Bearer $TOKEN")

http_code=$(parse_http_code "$response")
body=$(parse_response "$response")

assert_http_code "$http_code" "200" "POST /api/nodes"
assert_json_field_exists "$body" "data.id" "Node should have ID"
assert_json_field_exists "$body" "data.secret" "Node should have secret"
assert_json_field "$body" "data.isOnline" "false" "Node should be offline initially"

NODE_ID=$(echo "$body" | jq -r '.data.id')
NODE_SECRET=$(echo "$body" | jq -r '.data.secret')

# Test 2: List Nodes
log_info "Test 2: List all nodes"
response=$(http_get "${BACKEND_URL}/api/nodes" "Authorization: Bearer $TOKEN")

http_code=$(parse_http_code "$response")
body=$(parse_response "$response")

assert_http_code "$http_code" "200" "GET /api/nodes"
assert_json_field_exists "$body" "data" "Should return nodes array"

# Test 3: Get Specific Node
log_info "Test 3: Get specific node by ID"
response=$(http_get "${BACKEND_URL}/api/nodes/${NODE_ID}" "Authorization: Bearer $TOKEN")

http_code=$(parse_http_code "$response")
body=$(parse_response "$response")

assert_http_code "$http_code" "200" "GET /api/nodes/{id}"
assert_json_field "$body" "data.name" "$NODE_NAME" "Node name should match"
assert_json_field "$body" "data.maxMemoryMb" "16384" "Memory should match"
assert_json_field "$body" "data.maxCpuCores" "8" "CPU cores should match"

# Test 4: Update Node
log_info "Test 4: Update node configuration"
response=$(http_put "${BACKEND_URL}/api/nodes/${NODE_ID}" "{\"maxMemoryMb\":32768,\"maxCpuCores\":16}" "Authorization: Bearer $TOKEN")

http_code=$(parse_http_code "$response")
body=$(parse_response "$response")

assert_http_code "$http_code" "200" "PUT /api/nodes/{id}"
assert_json_field "$body" "data.maxMemoryMb" "32768" "Memory should be updated"
assert_json_field "$body" "data.maxCpuCores" "16" "CPU cores should be updated"

# Test 5: Generate Deployment Token
log_info "Test 5: Generate deployment token for node"
response=$(http_post "${BACKEND_URL}/api/nodes/${NODE_ID}/deployment-token" "{}" "Authorization: Bearer $TOKEN")

http_code=$(parse_http_code "$response")
body=$(parse_response "$response")

assert_http_code "$http_code" "200" "POST /api/nodes/{id}/deployment-token"
assert_json_field_exists "$body" "data.deploymentToken" "Deployment token should be returned"
assert_json_field_exists "$body" "data.deployUrl" "Deployment URL should be returned"

# Test 6: Get Node Stats
log_info "Test 6: Get node statistics"
response=$(http_get "${BACKEND_URL}/api/nodes/${NODE_ID}/stats" "Authorization: Bearer $TOKEN")

http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "200" "GET /api/nodes/{id}/stats"

# Test 7: Create Node with Duplicate Name
log_info "Test 7: Create node with duplicate name"
response=$(http_post "${BACKEND_URL}/api/nodes" "{
    \"name\": \"$NODE_NAME\",
    \"locationId\": \"$LOCATION_ID\",
    \"hostname\": \"different-host.example.com\",
    \"publicAddress\": \"192.168.1.200\",
    \"maxMemoryMb\": 8192,
    \"maxCpuCores\": 4
}" "Authorization: Bearer $TOKEN")

http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "400" "POST /api/nodes (duplicate name)"

# Test 8: Create Node with Invalid Memory
log_info "Test 8: Create node with invalid memory value"
response=$(http_post "${BACKEND_URL}/api/nodes" "{
    \"name\": \"node-$(random_string)\",
    \"locationId\": \"$LOCATION_ID\",
    \"hostname\": \"host.example.com\",
    \"publicAddress\": \"192.168.1.201\",
    \"maxMemoryMb\": -1000,
    \"maxCpuCores\": 4
}" "Authorization: Bearer $TOKEN")

http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "400" "POST /api/nodes (invalid memory)"

# Test 9: Create Node with Missing Required Fields
log_info "Test 9: Create node with missing required fields"
response=$(http_post "${BACKEND_URL}/api/nodes" "{
    \"name\": \"incomplete-node\"
}" "Authorization: Bearer $TOKEN")

http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "400" "POST /api/nodes (missing fields)"

# Test 10: Get Non-existent Node
log_info "Test 10: Get non-existent node"
response=$(http_get "${BACKEND_URL}/api/nodes/nonexistent-id" "Authorization: Bearer $TOKEN")

http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "404" "GET /api/nodes/{id} (non-existent)"

# Test 11: Delete Node
log_info "Test 11: Delete node"
response=$(http_delete "${BACKEND_URL}/api/nodes/${NODE_ID}" "Authorization: Bearer $TOKEN")

http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "200" "DELETE /api/nodes/{id}"

# Test 12: Verify Node Deleted
log_info "Test 12: Verify node is deleted"
response=$(http_get "${BACKEND_URL}/api/nodes/${NODE_ID}" "Authorization: Bearer $TOKEN")

http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "404" "GET /api/nodes/{id} (after delete)"

# Print summary
print_test_summary
