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
echo "--- Running install.sh ---"
cd /tmp
bash "${INSTALL_SH}" 2>&1
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

if [[ -z "${PG_PASS}" || "${PG_PASS}" == "your_secure_password_here" ]]; then
    echo "FAIL: POSTGRES_PASSWORD was not generated"
    exit 1
fi

if [[ -z "${AUTH_SECRET}" || "${AUTH_SECRET}" == "your_secret_here" ]]; then
    echo "FAIL: BETTER_AUTH_SECRET was not generated"
    exit 1
fi

echo ""
echo "========================================"
echo "PASS: install.sh works on ${DISTRO}"
echo "========================================"
