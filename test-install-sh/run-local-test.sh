#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Helper: set up the local archive once ─────────────────────────────────────
setup_archive() {
    mkdir -p /tmp/test-catalyst-archive
    ARCHIVE_DIR=$(mktemp -d)
    mkdir -p "$ARCHIVE_DIR/catalyst-main/catalyst-docker"
    # Copy everything except .env (which may exist from a previous local run)
    cd "$PROJECT_DIR/catalyst-docker"
    tar -cf - --exclude='.env' . | (cd "$ARCHIVE_DIR/catalyst-main/catalyst-docker" && tar -xf -)
    cd "$ARCHIVE_DIR"
    tar -czf catalyst.tar.gz catalyst-main/catalyst-docker/
    cp catalyst.tar.gz /tmp/test-catalyst-archive/catalyst.tar.gz
    rm -rf "$ARCHIVE_DIR"
}

# ── Test 1: Normal install (with Docker mock) ────────────────────────────────
echo "╔══════════════════════════════════════════════════════╗"
echo "║  Test 1: Normal install (Docker found)              ║"
echo "╚══════════════════════════════════════════════════════╝"

setup_archive

TESTROOT=$(mktemp -d)
mkdir -p "$TESTROOT/bin"

cp "$SCRIPT_DIR/mock-docker" "$TESTROOT/bin/docker"
cp "$SCRIPT_DIR/mock-docker-compose" "$TESTROOT/bin/docker-compose"
cp "$SCRIPT_DIR/mock-curl" "$TESTROOT/bin/curl"

cd "$TESTROOT"
PATH="$TESTROOT/bin:$PATH" PUBLIC_URL=http://localhost:8080 bash "$PROJECT_DIR/install.sh" -y

# Verify outputs
echo ""
echo "--- Verification ---"
ls -la "$TESTROOT/catalyst-docker/"

# Check required variables were set
echo ""
echo "Checking required .env variables:"
for var in POSTGRES_PASSWORD BETTER_AUTH_SECRET REDIS_PASSWORD PUBLIC_URL PASSKEY_RP_ID APP_NAME; do
    val=$(grep "^${var}=" "$TESTROOT/catalyst-docker/.env" | cut -d= -f2-)
    if [[ -z "$val" ]]; then
        echo "  FAIL: ${var} is not set"
        exit 1
    else
        echo "  OK: ${var} is set (${#val} chars)"
    fi
done

# Check that secrets are not placeholder values
PG_PASS=$(grep "^POSTGRES_PASSWORD=" "$TESTROOT/catalyst-docker/.env" | cut -d= -f2-)
if [[ "$PG_PASS" == *"CHANGE_ME"* ]]; then
    echo "  FAIL: POSTGRES_PASSWORD is still a placeholder"
    exit 1
fi

AUTH_SECRET=$(grep "^BETTER_AUTH_SECRET=" "$TESTROOT/catalyst-docker/.env" | cut -d= -f2-)
if [[ "$AUTH_SECRET" == *"CHANGE_ME"* ]]; then
    echo "  FAIL: BETTER_AUTH_SECRET is still a placeholder"
    exit 1
fi

# Check PASSKEY_RP_ID derivation
PASSKEY_VAL=$(grep "^PASSKEY_RP_ID=" "$TESTROOT/catalyst-docker/.env" | cut -d= -f2-)
if [[ "$PASSKEY_VAL" != "localhost" ]]; then
    echo "  FAIL: PASSKEY_RP_ID='${PASSKEY_VAL}' should be 'localhost' for http://localhost:8080"
    exit 1
fi

# Check the panel stack does not claim the agent's SFTP port
if grep -q "^SFTP_PORT=" "$TESTROOT/catalyst-docker/.env"; then
    echo "  FAIL: SFTP_PORT is set — SFTP belongs to the node agent, not the compose stack"
    exit 1
fi

echo ""
echo "Test 1: PASSED ✓"

rm -rf "$TESTROOT"

# ── Test 2: No container runtime found (non-interactive) ─────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  Test 2: No container runtime (non-interactive)     ║"
echo "╚══════════════════════════════════════════════════════╝"

TESTROOT2=$(mktemp -d)
mkdir -p "$TESTROOT2/bin"

# Build a PATH that has all essential tools but NOT docker or podman
# We do this by symlinking everything from /usr/bin and /bin EXCEPT
# docker, podman, docker-compose
for dir in /usr/bin /bin /usr/sbin /sbin; do
    if [[ -d "$dir" ]]; then
        for bin in "$dir"/*; do
            name=$(basename "$bin")
            case "$name" in
                docker|dockerd|docker-compose|docker-containerd|docker-proxy|podman)
                    # Skip — don't make these available
                    ;;
                *)
                    ln -sf "$bin" "$TESTROOT2/bin/$name" 2>/dev/null || true
                    ;;
            esac
        done
    fi
done

# Override curl with our mock (which serves the local archive)
# Must remove the symlink first, then copy the mock
rm -f "$TESTROOT2/bin/curl"
cp "$SCRIPT_DIR/mock-curl" "$TESTROOT2/bin/curl"

cd "$TESTROOT2"
# Use ONLY our isolated PATH
OUTPUT=$(PATH="$TESTROOT2/bin" PUBLIC_URL=http://localhost:8080 bash "$PROJECT_DIR/install.sh" -y 2>&1) && EXIT_CODE=$? || EXIT_CODE=$?

if [[ "$EXIT_CODE" -ne 1 ]]; then
    echo "  FAIL: Expected exit code 1, got ${EXIT_CODE}"
    exit 1
fi

# Verify the output mentions Docker install options
if echo "$OUTPUT" | grep -qi "install docker or podman"; then
    echo "  OK: Manual install instructions shown"
else
    echo "  FAIL: Missing manual install instructions"
    echo "  Output was:"
    echo "$OUTPUT" | grep -i "install\|docker\|podman" | head -5 | sed 's/^/    /'
    exit 1
fi

if echo "$OUTPUT" | grep -qi "run interactively"; then
    echo "  OK: Tip about running interactively shown"
else
    echo "  FAIL: Missing tip about running interactively"
    echo "  Output was:"
    echo "$OUTPUT" | grep -i "tip\|interactive\|non-inter" | head -5 | sed 's/^/    /'
    exit 1
fi

# Verify distro was detected
if echo "$OUTPUT" | grep -qi "detected:"; then
    echo "  OK: Distro detection shown"
else
    echo "  FAIL: Distro detection not shown"
    exit 1
fi

echo ""
echo "Test 2: PASSED ✓"

rm -rf "$TESTROOT2"

# ── Test 3: Distro detection function ────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  Test 3: Distro detection & install commands         ║"
echo "╚══════════════════════════════════════════════════════╝"

# Extract functions from install.sh and test them
eval "$(sed -n '/^detect_distro()/,/^}/p' "$PROJECT_DIR/install.sh")"
eval "$(sed -n '/^detect_distro_pretty()/,/^}/p' "$PROJECT_DIR/install.sh")"
eval "$(sed -n '/^get_docker_install_commands()/,/^}/p' "$PROJECT_DIR/install.sh")"

DETECTED_DISTRO=$(detect_distro)
DETECTED_PRETTY=$(detect_distro_pretty)
INSTALL_CMDS=$(get_docker_install_commands "$DETECTED_DISTRO")

echo "  Detected: ${DETECTED_DISTRO} (${DETECTED_PRETTY})"

if [[ -z "$DETECTED_DISTRO" || "$DETECTED_DISTRO" == "unknown" ]]; then
    echo "  WARN: distro detection returned unknown (no /etc/os-release?)"
else
    echo "  OK: Distro detected"
fi

if [[ -n "$INSTALL_CMDS" ]]; then
    echo "  OK: Docker install commands available for ${DETECTED_DISTRO}"
else
    echo "  WARN: No Docker install commands for ${DETECTED_DISTRO}"
fi

# Test all known distro IDs
SUPPORTED=0
UNSUPPORTED=0
for distro_id in ubuntu pop linuxmint debian kali centos rhel rocky almalinux fedora opensuse-tumbleweed opensuse-leap alpine arch manjaro; do
    cmds=$(get_docker_install_commands "$distro_id")
    if [[ -n "$cmds" ]]; then
        SUPPORTED=$((SUPPORTED + 1))
    else
        UNSUPPORTED=$((UNSUPPORTED + 1))
        echo "  FAIL: No install commands for known distro '${distro_id}'"
    fi
done
echo "  Supported: ${SUPPORTED} distros, Unsupported: ${UNSUPPORTED}"

if [[ "$UNSUPPORTED" -gt 0 ]]; then
    exit 1
fi

echo ""
echo "Test 3: PASSED ✓"

# ── Test 4: is_env_incomplete must not false-positive on default PUBLIC_URL ──
echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  Test 4: incomplete-env heuristic + secret reuse     ║"
echo "╚══════════════════════════════════════════════════════╝"

eval "$(sed -n '/^is_env_incomplete()/,/^}/p' "$PROJECT_DIR/install.sh")"
eval "$(sed -n '/^is_placeholder_secret()/,/^}/p' "$PROJECT_DIR/install.sh")"
eval "$(sed -n '/^env_get()/,/^}/p' "$PROJECT_DIR/install.sh")"

# Completed install that kept the default PUBLIC_URL must NOT look incomplete
COMPLETE_ENV=$(mktemp)
cat > "$COMPLETE_ENV" <<'EOF'
PUBLIC_URL=http://localhost:8080
POSTGRES_PASSWORD=AlreadyGeneratedPassword123
BETTER_AUTH_SECRET=AlreadyGeneratedAuthSecret
REDIS_PASSWORD=AlreadyGeneratedRedis
API_KEY_SECRET=AlreadyGeneratedApiKey
EOF
if is_env_incomplete "$COMPLETE_ENV"; then
    echo "  FAIL: complete .env with default PUBLIC_URL treated as incomplete"
    rm -f "$COMPLETE_ENV"
    exit 1
fi
echo "  OK: complete default-PUBLIC_URL .env is not incomplete"

# Mixed secrets (half-written) should be incomplete
MIXED_ENV=$(mktemp)
cat > "$MIXED_ENV" <<'EOF'
PUBLIC_URL=http://localhost:8080
POSTGRES_PASSWORD=AlreadyGeneratedPassword123
BETTER_AUTH_SECRET=CHANGE_ME_GENERATE_WITH_OPENSSL_RAND_BASE64_32
EOF
if ! is_env_incomplete "$MIXED_ENV"; then
    echo "  FAIL: mixed secret state should be incomplete"
    rm -f "$COMPLETE_ENV" "$MIXED_ENV"
    exit 1
fi
echo "  OK: mixed secret state is incomplete"

# Explicit marker
MARKER_ENV=$(mktemp)
cat > "$MARKER_ENV" <<'EOF'
PUBLIC_URL=http://192.168.1.10:8080
POSTGRES_PASSWORD=AlreadyGeneratedPassword123
BETTER_AUTH_SECRET=AlreadyGeneratedAuthSecret
# CATALYST_SETUP_INCOMPLETE=1
EOF
if ! is_env_incomplete "$MARKER_ENV"; then
    echo "  FAIL: CATALYST_SETUP_INCOMPLETE marker ignored"
    rm -f "$COMPLETE_ENV" "$MIXED_ENV" "$MARKER_ENV"
    exit 1
fi
echo "  OK: explicit incomplete marker detected"

rm -f "$COMPLETE_ENV" "$MIXED_ENV" "$MARKER_ENV"

# Reconfigure must preserve POSTGRES_PASSWORD from the previous .env
setup_archive
TESTROOT4=$(mktemp -d)
mkdir -p "$TESTROOT4/bin"
cp "$SCRIPT_DIR/mock-docker" "$TESTROOT4/bin/docker"
cp "$SCRIPT_DIR/mock-docker-compose" "$TESTROOT4/bin/docker-compose"
cp "$SCRIPT_DIR/mock-curl" "$TESTROOT4/bin/curl"

cd "$TESTROOT4"
PATH="$TESTROOT4/bin:$PATH" PUBLIC_URL=http://localhost:8080 bash "$PROJECT_DIR/install.sh" -y
FIRST_PG=$(grep "^POSTGRES_PASSWORD=" "$TESTROOT4/catalyst-docker/.env" | cut -d= -f2-)
FIRST_AUTH=$(grep "^BETTER_AUTH_SECRET=" "$TESTROOT4/catalyst-docker/.env" | cut -d= -f2-)

PATH="$TESTROOT4/bin:$PATH" PUBLIC_URL=http://localhost:8080 bash "$PROJECT_DIR/install.sh" --reconfigure -y
SECOND_PG=$(grep "^POSTGRES_PASSWORD=" "$TESTROOT4/catalyst-docker/.env" | cut -d= -f2-)
SECOND_AUTH=$(grep "^BETTER_AUTH_SECRET=" "$TESTROOT4/catalyst-docker/.env" | cut -d= -f2-)

if [[ "$FIRST_PG" != "$SECOND_PG" ]]; then
    echo "  FAIL: --reconfigure regenerated POSTGRES_PASSWORD (was '$FIRST_PG', now '$SECOND_PG')"
    exit 1
fi
if [[ "$FIRST_AUTH" != "$SECOND_AUTH" ]]; then
    echo "  FAIL: --reconfigure regenerated BETTER_AUTH_SECRET"
    exit 1
fi
echo "  OK: --reconfigure reuses POSTGRES_PASSWORD and BETTER_AUTH_SECRET"

# A second plain install with existing complete .env must skip reconfiguration
PATH="$TESTROOT4/bin:$PATH" PUBLIC_URL=http://localhost:8080 bash "$PROJECT_DIR/install.sh" -y >/tmp/catalyst-install-reentry.out 2>&1
THIRD_PG=$(grep "^POSTGRES_PASSWORD=" "$TESTROOT4/catalyst-docker/.env" | cut -d= -f2-)
if [[ "$FIRST_PG" != "$THIRD_PG" ]]; then
    echo "  FAIL: re-entry install changed POSTGRES_PASSWORD"
    exit 1
fi
if ! grep -qi "already exists and looks configured" /tmp/catalyst-install-reentry.out; then
    echo "  FAIL: re-entry install did not skip configured .env"
    cat /tmp/catalyst-install-reentry.out | tail -20
    exit 1
fi
echo "  OK: re-entry install skips configured .env (default PUBLIC_URL)"

rm -rf "$TESTROOT4"

echo ""
echo "Test 4: PASSED ✓"

# ── Final cleanup ─────────────────────────────────────────────────────────────
rm -rf /tmp/test-catalyst-archive

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  All tests passed! ✓                                ║"
echo "╚══════════════════════════════════════════════════════╝"
