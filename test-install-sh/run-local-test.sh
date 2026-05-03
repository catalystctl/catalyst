#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TESTROOT=$(mktemp -d)
mkdir -p "$TESTROOT/bin"
mkdir -p /tmp/test-catalyst-archive

# Create local archive mimicking GitHub structure
ARCHIVE_DIR=$(mktemp -d)
mkdir -p "$ARCHIVE_DIR/catalyst-main/catalyst-docker"
cp -r "$PROJECT_DIR/catalyst-docker/." "$ARCHIVE_DIR/catalyst-main/catalyst-docker/"
cd "$ARCHIVE_DIR"
tar -czf catalyst.tar.gz catalyst-main/catalyst-docker/
cp catalyst.tar.gz /tmp/test-catalyst-archive/catalyst.tar.gz

# Install mocks
cp "$SCRIPT_DIR/mock-docker" "$TESTROOT/bin/docker"
cp "$SCRIPT_DIR/mock-docker-compose" "$TESTROOT/bin/docker-compose"
cp "$SCRIPT_DIR/mock-curl" "$TESTROOT/bin/curl"

# Run install.sh with mocked PATH
cd "$TESTROOT"
PATH="$TESTROOT/bin:$PATH" bash "$PROJECT_DIR/install.sh"

# Verify outputs
ls -la "$TESTROOT/catalyst-docker/"
grep -E "^(POSTGRES_PASSWORD|BETTER_AUTH_SECRET)=" "$TESTROOT/catalyst-docker/.env"

# Cleanup
rm -rf "$TESTROOT" /tmp/test-catalyst-archive
