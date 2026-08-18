#!/bin/bash
#
# Docker Test Environment Generator
# Creates test-specific .env file with randomized ports and secrets
#

set -euo pipefail

# Source utility functions (colors, logging, etc.)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=utils.sh
source "$SCRIPT_DIR/utils.sh" 2>/dev/null || true

# ============================================================================
# Configuration
# ============================================================================

# Port ranges for randomization
PORT_MIN=20000
PORT_MAX=60000

# Default output file (relative to catalyst-docker directory)
DEFAULT_OUTPUT_FILE="../catalyst-docker/.env.test"

# ============================================================================
# Helper Functions
# ============================================================================

# Generate a random port number within range, checking for availability
_generate_random_port() {
    local port
    local attempts=0
    local max_attempts=50

    while [ $attempts -lt $max_attempts ]; do
        port=$(shuf -i "${PORT_MIN}-${PORT_MAX}" -n 1)
        # Check if port is available on both TCP and UDP
        if ! ss -tln | awk '{print $4}' | grep -qE "(:|${port}$)" 2>/dev/null; then
            echo "$port"
            return 0
        fi
        ((attempts++)) || true
    done

    # Fallback: just return a random port without checking
    shuf -i "${PORT_MIN}-${PORT_MAX}" -n 1
}

# Generate a secure random secret (base64)
_generate_secret() {
    local length="${1:-32}"
    openssl rand -base64 "$length" 2>/dev/null || cat /dev/urandom | tr -dc 'a-zA-Z0-9' | fold -w "$length" | head -n 1
}

# Generate an SFTP host key (ed25519)
_generate_sftp_host_key() {
    local tmp_dir
    tmp_dir=$(mktemp -d)
    ssh-keygen -t ed25519 -f "$tmp_dir/host_key" -N "" -C "catalyst-test" > /dev/null 2>&1
    cat "$tmp_dir/host_key"
    rm -rf "$tmp_dir"
}

# ============================================================================
# Main Functions
# ============================================================================

# Generate test environment file with randomized values
# Usage: generate_test_env [output_file]
generate_test_env() {
    local output_file="${1:-$DEFAULT_OUTPUT_FILE}"
    local output_dir
    output_dir=$(dirname "$output_file")

    # Ensure output directory exists
    mkdir -p "$output_dir"

    log_info "Generating test environment file: $output_file"

    # Generate random ports
    local postgres_port backend_port frontend_port redis_port sftp_port
    postgres_port=$(_generate_random_port)
    backend_port=$(_generate_random_port)
    frontend_port=$(_generate_random_port)
    redis_port=$(_generate_random_port)
    sftp_port=$(_generate_random_port)

    # Ensure all ports are unique
    while [ "$postgres_port" = "$backend_port" ] || [ "$postgres_port" = "$frontend_port" ] || \
          [ "$postgres_port" = "$redis_port" ] || [ "$postgres_port" = "$sftp_port" ]; do
        postgres_port=$(_generate_random_port)
    done
    while [ "$backend_port" = "$frontend_port" ] || [ "$backend_port" = "$redis_port" ] || \
          [ "$backend_port" = "$sftp_port" ]; do
        backend_port=$(_generate_random_port)
    done
    while [ "$frontend_port" = "$redis_port" ] || [ "$frontend_port" = "$sftp_port" ]; do
        frontend_port=$(_generate_random_port)
    done
    while [ "$redis_port" = "$sftp_port" ]; do
        redis_port=$(_generate_random_port)
    done

    # Generate secrets
    local better_auth_secret postgres_password redis_password sftp_host_key
    better_auth_secret=$(_generate_secret 32)
    postgres_password=$(_generate_secret 24)
    redis_password=$(_generate_secret 24)
    sftp_host_key=$(_generate_sftp_host_key)

    # Base64 encode the SFTP host key for env var
    local sftp_host_key_base64
    sftp_host_key_base64=$(echo "$sftp_host_key" | base64 -w 0)

    # Construct public URL (frontend port on localhost)
    local public_url
    public_url="http://127.0.0.1:${frontend_port}"

    # Write the environment file
    cat > "$output_file" <<EOF
# =============================================================================
# Catalyst — Test Environment (Auto-generated)
# Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")
# DO NOT EDIT MANUALLY — Regenerate with: ./run-docker-tests.sh
# =============================================================================

NODE_ENV=test
APP_NAME=Catalyst-Test
TZ=UTC
LOG_LEVEL=debug

# --- Ports (randomized to avoid conflicts) -----------------------------------
POSTGRES_PORT=127.0.0.1:${postgres_port}
REDIS_PORT=127.0.0.1:${redis_port}
BACKEND_PORT=127.0.0.1:${backend_port}
FRONTEND_PORT=127.0.0.1:${frontend_port}
SFTP_PORT=0.0.0.0:${sftp_port}

# --- PostgreSQL --------------------------------------------------------------
POSTGRES_USER=catalyst
POSTGRES_PASSWORD=${postgres_password}
POSTGRES_DB=catalyst_db

# --- Redis -------------------------------------------------------------------
REDIS_PASSWORD=${redis_password}

# --- Auth --------------------------------------------------------------------
BETTER_AUTH_SECRET=${better_auth_secret}
PASSKEY_RP_ID=localhost

# --- Public URL --------------------------------------------------------------
# This is the single source of truth for CORS, auth, and deploy URLs.
PUBLIC_URL=${public_url}

# --- SFTP --------------------------------------------------------------------
SFTP_ENABLED=true
# SFTP_HOST_KEY is left empty — backend auto-generates from SFTP_HOST_KEY_BASE64
SFTP_HOST_KEY=
SFTP_HOST_KEY_BASE64=${sftp_host_key_base64}


# --- Backups -----------------------------------------------------------------
BACKUP_STORAGE_MODE=local

# --- Performance tuning ------------------------------------------------------
CONSOLE_OUTPUT_BYTE_LIMIT_BYTES=524288
MAX_DISK_MB=1048576

# --- Webhooks (disabled in tests) --------------------------------------------
# WEBHOOK_URLS=
# WEBHOOK_SECRET=

# --- Suspension --------------------------------------------------------------
SUSPENSION_ENFORCED=true
SUSPENSION_DELETE_BLOCKED=false
SUSPENSION_DELETE_POLICY=keep

# --- OAuth (disabled in tests) -----------------------------------------------
# WHMCS_OIDC_CLIENT_ID=
# WHMCS_OIDC_CLIENT_SECRET=
# WHMCS_OIDC_DISCOVERY_URL=
# PAYMENTER_OIDC_CLIENT_ID=
# PAYMENTER_OIDC_CLIENT_SECRET=
# PAYMENTER_OIDC_DISCOVERY_URL=

# --- Auto Updater (disabled in tests) ----------------------------------------
AUTO_UPDATE_ENABLED=false
AUTO_UPDATE_INTERVAL_MS=3600000
AUTO_UPDATE_AUTO_TRIGGER=false
EOF

    log_success "Test environment file generated with ${public_url}"
    log_info "  Backend port: ${backend_port}"
    log_info "  Frontend port: ${frontend_port}"
    log_info "  Postgres port: ${postgres_port}"
    log_info "  Redis port: ${redis_port}"
    log_info "  SFTP port: ${sftp_port}"
}

# Get the backend URL from the generated .env.test file
# Usage: get_test_backend_url [env_file]
get_test_backend_url() {
    local env_file="${1:-../catalyst-docker/.env.test}"

    if [ ! -f "$env_file" ]; then
        echo ""
        return 1
    fi

    local backend_port
    backend_port=$(grep "^BACKEND_PORT=" "$env_file" | cut -d'=' -f2 | sed 's/127.0.0.1://')
    echo "http://127.0.0.1:${backend_port}"
}

# Get the frontend URL from the generated .env.test file
# Usage: get_test_frontend_url [env_file]
get_test_frontend_url() {
    local env_file="${1:-../catalyst-docker/.env.test}"

    if [ ! -f "$env_file" ]; then
        echo ""
        return 1
    fi

    local frontend_port
    frontend_port=$(grep "^FRONTEND_PORT=" "$env_file" | cut -d'=' -f2 | sed 's/127.0.0.1://')
    echo "http://127.0.0.1:${frontend_port}"
}

# Get the WebSocket URL from the generated .env.test file
# Usage: get_test_ws_url [env_file]
get_test_ws_url() {
    local env_file="${1:-../catalyst-docker/.env.test}"

    if [ ! -f "$env_file" ]; then
        echo ""
        return 1
    fi

    local backend_port
    backend_port=$(grep "^BACKEND_PORT=" "$env_file" | cut -d'=' -f2 | sed 's/127.0.0.1://')
    echo "ws://127.0.0.1:${backend_port}/ws"
}

# Load environment variables from .env.test file
# Usage: load_test_env [env_file]
load_test_env() {
    local env_file="${1:-../catalyst-docker/.env.test}"

    if [ ! -f "$env_file" ]; then
        log_error "Test environment file not found: $env_file"
        return 1
    fi

    # Export all variables from the file
    set -a
    # shellcheck source=/dev/null
    source "$env_file"
    set +a

    log_info "Loaded test environment from $env_file"
}

# Check if all required tools are available for Docker testing
# Usage: check_docker_prerequisites
check_docker_prerequisites() {
    local missing=()

    command -v docker >/dev/null 2>&1 || missing+=("docker")
    command -v docker compose >/dev/null 2>&1 || missing+=("docker compose")
    command -v curl >/dev/null 2>&1 || missing+=("curl")
    command -v jq >/dev/null 2>&1 || missing+=("jq")
    command -v openssl >/dev/null 2>&1 || missing+=("openssl")
    command -v ssh-keygen >/dev/null 2>&1 || missing+=("ssh-keygen")

    if [ ${#missing[@]} -gt 0 ]; then
        log_error "Missing prerequisites for Docker testing:"
        for tool in "${missing[@]}"; do
            log_error "  - $tool"
        done
        return 1
    fi

    # Check Docker daemon is running
    if ! docker info >/dev/null 2>&1; then
        log_error "Docker daemon is not running or not accessible"
        return 1
    fi

    log_success "All Docker test prerequisites satisfied"
    return 0
}
