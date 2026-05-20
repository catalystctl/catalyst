#!/usr/bin/env bash
# Runs inside a Docker container to test install.sh
set -euo pipefail

DISTRO="${1:-unknown}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_SH="${SCRIPT_DIR}/install.sh"

echo "========================================"
echo "Testing install.sh on: ${DISTRO}"
echo "========================================"
echo ""

# Show environment info
echo "--- Shell ---"
bash --version | head -n1

echo "--- Core tools ---"
curl --version | head -n1
tar --version | head -n1
openssl version 2>/dev/null || echo "openssl: not found"
sed --version 2>/dev/null | head -n1 || echo "sed: BSD/GNU check"
mktemp --version 2>/dev/null | head -n1 || echo "mktemp: available"

echo ""
echo "--- Test 1: Full install (non-interactive with Docker) ---"
cd /tmp
rm -rf /tmp/catalyst-docker
PUBLIC_URL=http://localhost:8080 bash "${INSTALL_SH}" -y 2>&1
EXIT_CODE=$?

echo ""
echo "--- Verifying results ---"
if [[ $EXIT_CODE -ne 0 ]]; then
    echo "FAIL: install.sh exited with code ${EXIT_CODE}"
    exit 1
fi

if [[ ! -d "/tmp/catalyst-docker" ]]; then
    echo "FAIL: catalyst-docker directory was not created"
    exit 1
fi

if [[ ! -f "/tmp/catalyst-docker/.env" ]]; then
    echo "FAIL: .env file was not created"
    exit 1
fi

# Check that secrets were generated
PG_PASS=$(grep "^POSTGRES_PASSWORD=" /tmp/catalyst-docker/.env | cut -d= -f2-)
AUTH_SECRET=$(grep "^BETTER_AUTH_SECRET=" /tmp/catalyst-docker/.env | cut -d= -f2-)
REDIS_PASS=$(grep "^REDIS_PASSWORD=" /tmp/catalyst-docker/.env | cut -d= -f2-)

if [[ -z "${PG_PASS}" || "${PG_PASS}" == "CHANGE_ME_GENERATE_A_STRONG_PASSWORD" ]]; then
    echo "FAIL: POSTGRES_PASSWORD was not generated"
    exit 1
fi

if [[ -z "${AUTH_SECRET}" || "${AUTH_SECRET}" == "CHANGE_ME_GENERATE_WITH_OPENSSL_RAND_BASE64_32" ]]; then
    echo "FAIL: BETTER_AUTH_SECRET was not generated"
    exit 1
fi

if [[ -z "${REDIS_PASS}" ]]; then
    echo "FAIL: REDIS_PASSWORD was not generated"
    exit 1
fi

# Check PUBLIC_URL was set
PUBLIC_URL_VAL=$(grep "^PUBLIC_URL=" /tmp/catalyst-docker/.env | cut -d= -f2-)
if [[ -z "${PUBLIC_URL_VAL}" ]]; then
    echo "FAIL: PUBLIC_URL was not set"
    exit 1
fi

# Check PASSKEY_RP_ID was auto-derived
PASSKEY_RP_ID_VAL=$(grep "^PASSKEY_RP_ID=" /tmp/catalyst-docker/.env | cut -d= -f2-)
if [[ -z "${PASSKEY_RP_ID_VAL}" ]]; then
    echo "FAIL: PASSKEY_RP_ID was not auto-derived"
    exit 1
fi

# Check PASSKEY_RP_ID matches PUBLIC_URL hostname
# For http://localhost:8080, PASSKEY_RP_ID should be localhost
if [[ "${PASSKEY_RP_ID_VAL}" != "localhost" ]]; then
    echo "FAIL: PASSKEY_RP_ID='${PASSKEY_RP_ID_VAL}' doesn't match expected 'localhost' from PUBLIC_URL='${PUBLIC_URL_VAL}'"
    exit 1
fi

echo "  All .env checks passed ✓"

echo ""
echo "--- Test 2: Distro detection ---"
# Source the detection functions and test them
eval "$(sed -n '/^detect_distro()/,/^}/p' "${INSTALL_SH}")"
eval "$(sed -n '/^detect_distro_pretty()/,/^}/p' "${INSTALL_SH}")"

DETECTED_DISTRO=$(detect_distro)
DETECTED_PRETTY=$(detect_distro_pretty)

if [[ -z "$DETECTED_DISTRO" || "$DETECTED_DISTRO" == "unknown" ]]; then
    echo "  WARN: distro detection returned 'unknown' — may be minimal container image"
else
    echo "  Detected distro: ${DETECTED_DISTRO} (${DETECTED_PRETTY})"
fi

# Verify the detection matches the test distro parameter
if [[ "$DETECTED_DISTRO" != "$DISTRO" && "$DISTRO" != "unknown" ]]; then
    echo "  WARN: expected '${DISTRO}' but got '${DETECTED_DISTRO}'"
fi

echo ""
echo "========================================"
echo "PASS: install.sh works on ${DISTRO}"
echo "========================================"
