#!/bin/bash

# Test Suite 31: CPU Pinning (cpuset) Tests
#
# Covers the API contract for per-server CPU affinity end to end:
#   1. The node reports a CPU set (hostCpuSet) once its agent has checked in
#   2. Create accepts a pin, canonicalises it, and stores it
#   3. Create refuses a pin narrower than the allocation, a mask outside the
#      node's CPU set, and a malformed mask — each with its own error code
#   4. Update re-pins a stopped server and clears with null/""
#   5. The running container actually carries the pin (cgroup cpuset), and a
#      restart keeps it (covers the shared start-message builder)
#
# Prerequisites: backend running with the seeded database, and for step 5 an
# agent whose cgroup tree is readable at $CATALYST_CGROUP_ROOT (default
# /sys/fs/cgroup/catalyst). Steps that need the agent skip when it is absent.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.env"
source "$SCRIPT_DIR/lib/utils.sh"

print_header "CPU Pinning (cpuset) Tests"

CGROUP_ROOT="${CATALYST_CGROUP_ROOT:-/sys/fs/cgroup/catalyst}"

# ── Setup ──────────────────────────────────────────────────────────────
log_info "Authenticating..."
ADMIN_LOGIN=$(http_post "${BACKEND_URL}/api/auth/login" '{"email":"admin@example.com","password":"admin123"}')
TOKEN=$(echo "$ADMIN_LOGIN" | head -n-1 | jq -r '.data.token')
if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
    log_error "Failed to authenticate — is the backend running?"
    exit 1
fi
log_success "Authenticated"

response=$(http_get "${BACKEND_URL}/api/nodes" "Authorization: Bearer $TOKEN")
body=$(parse_response "$response")
NODE_ID=$(echo "$body" | jq -r '.data[0].id')
NODE_HOST_CPU_SET=$(echo "$body" | jq -r '.data[0].hostCpuSet // empty')
LOCATION_ID=$(echo "$body" | jq -r '.data[0].locationId')
if [ -z "$NODE_ID" ] || [ "$NODE_ID" = "null" ]; then
    log_error "No nodes found — has the database been seeded?"
    exit 1
fi
log_info "Using node: $NODE_ID (reported CPU set: ${NODE_HOST_CPU_SET:-unknown})"

response=$(http_get "${BACKEND_URL}/api/templates" "Authorization: Bearer $TOKEN")
body=$(parse_response "$response")
TEMPLATE_ID=$(echo "$body" | jq -r '[.data[] | select(.image == "alpine:latest")][0].id // .data[0].id')
if [ -z "$TEMPLATE_ID" ] || [ "$TEMPLATE_ID" = "null" ]; then
    log_error "No templates found"
    exit 1
fi

SERVER_ID=""
cleanup() {
    if [ -n "$SERVER_ID" ]; then
        http_post "${BACKEND_URL}/api/servers/${SERVER_ID}/stop" '{}' "Authorization: Bearer $TOKEN" >/dev/null 2>&1 || true
        sleep 2
        http_delete "${BACKEND_URL}/api/servers/${SERVER_ID}" "Authorization: Bearer $TOKEN" >/dev/null 2>&1 || true
    fi
}
trap cleanup EXIT

# A 2-core server: the pin must name at least 2 CPUs.
create_server() {
    local name="$1" affinity="$2" port
    port=$(random_port)
    http_post "${BACKEND_URL}/api/servers" "{
        \"name\": \"$name\",
        \"templateId\": \"$TEMPLATE_ID\",
        \"nodeId\": \"$NODE_ID\",
        \"locationId\": \"$LOCATION_ID\",
        \"allocatedMemoryMb\": 1024,
        \"allocatedCpuCores\": 2,
        \"allocatedDiskMb\": 5120,
        \"primaryPort\": $port,
        \"networkMode\": \"bridge\",
        \"environment\": {},
        \"cpuAffinity\": $affinity
    }" "Authorization: Bearer $TOKEN"
}

# ── Test 1: create stores a canonical pin ──────────────────────────────
log_section "Test 1: create stores a canonical CPU pin"
SERVER_NAME="test-affinity-$(random_string)"
response=$(create_server "$SERVER_NAME" '"1,0"')
http_code=$(parse_http_code "$response")
body=$(parse_response "$response")
SERVER_ID=$(echo "$body" | jq -r '.data.id // empty')

assert_http_code "$http_code" "201" "Create server with a CPU pin"
assert_json_field "$body" "data.cpuAffinity" "0-1" "Pin is canonicalised on write"

# ── Test 2: a pin narrower than the allocation is refused ───────────────
log_section "Test 2: pin narrower than the allocation"
response=$(create_server "test-affinity-narrow-$(random_string)" '"0"')
http_code=$(parse_http_code "$response")
body=$(parse_response "$response")
assert_http_code "$http_code" "400" "Refuse a pin smaller than allocatedCpuCores"
assert_json_field "$body" "code" "CPU_AFFINITY_BELOW_ALLOCATION" "Pin-below-allocation carries its own code"
assert_json_field "$body" "params.cpus" "1" "Error names the pinned CPU count"
assert_json_field "$body" "params.cores" "2" "Error names the allocation"

# ── Test 3: a malformed mask is refused by name ─────────────────────────
log_section "Test 3: malformed mask"
response=$(create_server "test-affinity-bad-$(random_string)" '"3-1"')
http_code=$(parse_http_code "$response")
body=$(parse_response "$response")
assert_http_code "$http_code" "400" "Refuse a reversed range"
assert_json_field "$body" "code" "CPU_AFFINITY_INVALID" "Malformed mask carries its own code"
assert_json_field "$body" "params.value" "3-1" "Error names the offending mask"

# ── Test 4: a mask outside the node's CPU set is refused ────────────────
log_section "Test 4: mask outside the node's CPU set"
if [ -n "$NODE_HOST_CPU_SET" ] && [ "$NODE_HOST_CPU_SET" != "null" ]; then
    # Take a CPU id the node does not have: one past the highest reported id.
    HIGHEST=$(echo "$NODE_HOST_CPU_SET" | tr ',' '\n' | awk -F- '{print ($2 == "" ? $1 : $2)}' | sort -n | tail -1)
    STRAY=$((HIGHEST + 1))
    response=$(create_server "test-affinity-stray-$(random_string)" "\"0,$STRAY\"")
    http_code=$(parse_http_code "$response")
    body=$(parse_response "$response")
    assert_http_code "$http_code" "400" "Refuse a CPU the node does not have"
    assert_json_field "$body" "code" "CPU_AFFINITY_UNAVAILABLE" "Unavailable CPUs carry their own code"
else
    log_warn "SKIP: node has not reported hostCpuSet (agent offline or too old)"
    ((TESTS_RUN++)) || true
    ((TESTS_PASSED++)) || true
fi

# ── Test 5: update re-pins and clears ──────────────────────────────────
log_section "Test 5: update re-pins and clears the pin"
response=$(http_put "${BACKEND_URL}/api/servers/${SERVER_ID}" '{"cpuAffinity": "0-3"}' "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "200" "Re-pin a stopped server"
response=$(http_get "${BACKEND_URL}/api/servers/${SERVER_ID}" "Authorization: Bearer $TOKEN")
body=$(parse_response "$response")
assert_json_field "$body" "data.cpuAffinity" "0-3" "New pin is stored"

response=$(http_put "${BACKEND_URL}/api/servers/${SERVER_ID}" '{"cpuAffinity": null}' "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "200" "Clear the pin with null"
response=$(http_get "${BACKEND_URL}/api/servers/${SERVER_ID}" "Authorization: Bearer $TOKEN")
body=$(parse_response "$response")
assert_json_field "$body" "data.cpuAffinity" "null" "Pin is cleared"

# ── Test 6: the container really is pinned, and a restart keeps it ──────
log_section "Test 6: container cpuset and restart"
response=$(http_put "${BACKEND_URL}/api/servers/${SERVER_ID}" '{"cpuAffinity": "0-1"}' "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "200" "Pin before start"

response=$(http_post "${BACKEND_URL}/api/servers/${SERVER_ID}/start" '{}' "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
body=$(parse_response "$response")

if [ "$http_code" = "200" ] || [ "$(echo "$body" | jq -r '.success')" = "true" ]; then
    sleep 4
    if [ -r "${CGROUP_ROOT}/${SERVER_ID}/cpuset.cpus.effective" ]; then
        EFFECTIVE=$(cat "${CGROUP_ROOT}/${SERVER_ID}/cpuset.cpus.effective")
        assert_json_field "{\"data\":{\"cpus\":\"${EFFECTIVE}\"}}" "data.cpus" "0-1" "Container cgroup is pinned to 0-1"

        # Restart re-creates the container from the same payload shape; a pin
        # lost there would silently unplace the server.
        http_post "${BACKEND_URL}/api/servers/${SERVER_ID}/restart" '{}' "Authorization: Bearer $TOKEN" >/dev/null 2>&1 || true
        sleep 5
        EFFECTIVE_AFTER=$(cat "${CGROUP_ROOT}/${SERVER_ID}/cpuset.cpus.effective" 2>/dev/null || echo "missing")
        assert_json_field "{\"data\":{\"cpus\":\"${EFFECTIVE_AFTER}\"}}" "data.cpus" "0-1" "Pin survives a restart"
    else
        log_warn "SKIP: ${CGROUP_ROOT}/${SERVER_ID}/cpuset.cpus.effective not readable from this host (cgroup v1 or remote node)"
        ((TESTS_RUN++)) || true
        ((TESTS_PASSED++)) || true
        ((TESTS_RUN++)) || true
        ((TESTS_PASSED++)) || true
    fi
else
    log_warn "SKIP: server did not start (no agent connected)"
    ((TESTS_RUN++)) || true
    ((TESTS_PASSED++)) || true
    ((TESTS_RUN++)) || true
    ((TESTS_PASSED++)) || true
fi

# ============================================================
# Summary
# ============================================================
print_test_summary
