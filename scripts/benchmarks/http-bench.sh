#!/usr/bin/env bash
set -euo pipefail

# Simple, rate-limit-safe HTTP benchmarks for Catalyst.
#
# Requirements:
# - backend running (default http://localhost:3000)
# - jq installed
# - network access to download autocannon via npx (or cached)
#
# Usage:
#   BASE_URL=http://localhost:3000 \
#   EMAIL=admin@example.com PASSWORD=admin123 \
#   ./scripts/benchmarks/http-bench.sh

BASE_URL="${BASE_URL:-http://localhost:3000}"
EMAIL="${EMAIL:-admin@example.com}"
PASSWORD="${PASSWORD:-admin123}"

AUTOCANNON="bunx -y autocannon@7.12.0"

require() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

require curl
require jq

bench() {
  local name="$1"; shift
  echo
  echo "=== ${name} ==="
  # shellcheck disable=SC2086
  ${AUTOCANNON} "$@"
}

echo "Catalyst HTTP Bench"
echo "BASE_URL=${BASE_URL}"
echo "Kernel: $(uname -srmo 2>/dev/null || uname -a)"

# Health is explicitly rate-limited (but much higher than most routes).
# Keep RPS <= ~16 to stay under 1000/min.
bench "/health (3 rps, 60s)" -c 1 -d 60 -R 100 "${BASE_URL}/health"

echo
echo "Sleeping 65s to reset rate-limit window..."
sleep 65

echo
echo "Fetching JWT (token not printed)"
TOKEN="$(
  curl -s -X POST "${BASE_URL}/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}" \
  | jq -r '.data.token'
)"

if [[ -z "${TOKEN}" || "${TOKEN}" == "null" ]]; then
  echo "Failed to login and obtain token. Check EMAIL/PASSWORD and backend logs." >&2
  exit 1
fi

AUTH_HEADER="Authorization: Bearer ${TOKEN}"

# Authenticated routes are globally rate-limited (default ~200/min per user).
# Keep RPS low unless you temporarily bump rate limits for a benchmark run.
bench "/api/auth/me (2 rps, 20s)" -c 1 -d 20 -R 2 -H "${AUTH_HEADER}" "${BASE_URL}/api/auth/me"
bench "/api/templates (2 rps, 20s)" -c 1 -d 20 -R 2 -H "${AUTH_HEADER}" "${BASE_URL}/api/templates"
bench "/api/servers (2 rps, 20s)" -c 1 -d 20 -R 2 -H "${AUTH_HEADER}" "${BASE_URL}/api/servers"

echo
echo "Done."