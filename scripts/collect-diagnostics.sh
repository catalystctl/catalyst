#!/usr/bin/env bash
# ============================================================
# Catalyst — download a troubleshooting bundle from a running panel.
#
# Works without the frontend: it talks straight to the backend API, so it
# still works when the panel UI is broken. Requires an admin API key (or an
# admin session cookie).
#
# What you get (.zip):
#   panel/logs.txt            panel container output for the window
#   panel/environment.txt     effective panel config (secrets redacted)
#   panel/system-errors.json  persisted system errors for the window
#   nodes/<nodeId>.log        node agent logs for the window
#   servers/<id>/console.log  server console output for the window
#   servers/<id>/.env         server env file, when present (secrets redacted)
#   manifest.json             machine-readable index + warnings
#
# Usage:
#   bash collect-diagnostics.sh --url https://panel.example.com --api-key catalyst_xxx
#   CATALYST_URL=https://panel.example.com CATALYST_API_KEY=catalyst_xxx \
#     bash collect-diagnostics.sh --hours 6 --servers a,b --redaction strict
#
# One-liner (no checkout needed):
#   curl -fsSL https://raw.githubusercontent.com/catalystctl/catalyst/main/scripts/collect-diagnostics.sh \
#     | bash -s -- --url https://panel.example.com --api-key catalyst_xxx
# ============================================================
set -euo pipefail

CATALYST_URL="${CATALYST_URL:-}"
API_KEY="${CATALYST_API_KEY:-}"
COOKIE="${CATALYST_COOKIE:-}"
HOURS=24
NODES="all"
SERVERS="all"
SECTIONS=""
REDACTION="standard"
OUT=""
INSECURE=false
TIMEOUT=900

usage() {
    cat <<'HELP'
Catalyst — download a troubleshooting bundle from a running panel.

Works without the frontend: it talks straight to the backend API, so it still
works when the panel UI is broken. Requires an admin API key (or an admin
session cookie).

The .zip contains: panel/logs.txt, panel/environment.txt,
panel/system-errors.json, nodes/<nodeId>.log, servers/<id>/console.log,
servers/<id>/.env and a machine-readable manifest.json.

Options:
  --url URL          Panel base URL (or the backend directly, e.g. http://localhost:3000)
  --api-key KEY      Admin API key (starts with "catalyst"). Or set CATALYST_API_KEY.
  --cookie VALUE     Raw Cookie header for a browser session (alternative to --api-key)
  --hours N          Window size in hours (default 24, max 720)
  --nodes LIST       Comma-separated node ids, or "all" / "none" (default all)
  --servers LIST     Comma-separated server ids, or "all" / "none" (default all)
  --sections LIST    Comma-separated: panel,errors,nodes,servers,env (default all)
  --redaction MODE   "standard" (default) or "strict" (also masks IPs/hostnames)
  --out FILE         Output path (default catalyst-diagnostics-<timestamp>.zip)
  --timeout SECONDS  Request timeout (default 900)
  -k, --insecure     Skip TLS certificate verification
  -h, --help         Show this help
HELP
}

while [ $# -gt 0 ]; do
    case "$1" in
        --url) CATALYST_URL="${2:-}"; shift 2 ;;
        --api-key) API_KEY="${2:-}"; shift 2 ;;
        --cookie) COOKIE="${2:-}"; shift 2 ;;
        --hours) HOURS="${2:-}"; shift 2 ;;
        --nodes) NODES="${2:-}"; shift 2 ;;
        --servers) SERVERS="${2:-}"; shift 2 ;;
        --sections) SECTIONS="${2:-}"; shift 2 ;;
        --redaction) REDACTION="${2:-}"; shift 2 ;;
        --out) OUT="${2:-}"; shift 2 ;;
        --timeout) TIMEOUT="${2:-}"; shift 2 ;;
        -k|--insecure) INSECURE=true; shift ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Unknown argument: $1 (try --help)" >&2; exit 2 ;;
    esac
done

die() { echo "error: $*" >&2; exit 1; }

[ -n "$CATALYST_URL" ] || die "missing --url (or CATALYST_URL)"
[ -n "$API_KEY" ] || [ -n "$COOKIE" ] || die "missing --api-key (or CATALYST_API_KEY / --cookie)"
command -v curl >/dev/null 2>&1 || die "curl is required but not installed"

case "$HOURS" in
    ''|*[!0-9]*) die "--hours must be a whole number" ;;
esac
if [ "$HOURS" -lt 1 ] || [ "$HOURS" -gt 720 ]; then
    die "--hours must be between 1 and 720"
fi

case "$REDACTION" in
    standard|strict) ;;
    *) die "--redaction must be 'standard' or 'strict'" ;;
esac

BASE="${CATALYST_URL%/}"
URL="${BASE}/api/admin/diagnostics/export?hours=${HOURS}&redaction=${REDACTION}"
if [ "$NODES" != "all" ]; then URL="${URL}&nodes=${NODES}"; fi
if [ "$SERVERS" != "all" ]; then URL="${URL}&servers=${SERVERS}"; fi
if [ -n "$SECTIONS" ]; then URL="${URL}&sections=${SECTIONS}"; fi

if [ -z "$OUT" ]; then
    OUT="catalyst-diagnostics-$(date -u +%Y%m%d-%H%M%S).zip"
fi

CURL_ARGS=(-sS --max-time "$TIMEOUT" -o "$OUT.part" -w '%{http_code}')
if [ -n "$API_KEY" ]; then CURL_ARGS+=(-H "Authorization: Bearer ${API_KEY}"); fi
if [ -n "$COOKIE" ]; then CURL_ARGS+=(-H "Cookie: ${COOKIE}"); fi
if $INSECURE; then CURL_ARGS+=(-k); fi

echo "→ Requesting ${URL}"
HTTP_CODE="$(curl "${CURL_ARGS[@]}" "$URL" || echo "000")"

if [ "$HTTP_CODE" != "200" ]; then
    echo "error: panel returned HTTP ${HTTP_CODE}" >&2
    if [ -s "$OUT.part" ]; then
        echo "--- response body ---" >&2
        head -c 2000 "$OUT.part" >&2
        echo "" >&2
    fi
    rm -f "$OUT.part"
    case "$HTTP_CODE" in
        000) echo "hint: the URL is unreachable. If the frontend container is down, target the" >&2
             echo "      backend directly, e.g. --url http://localhost:3000" >&2 ;;
        401) echo "hint: missing or invalid API key." >&2 ;;
        403) echo "hint: the key needs the admin.read permission (an admin API key has it)." >&2 ;;
        404) echo "hint: this panel version may not have the diagnostics endpoint yet." >&2 ;;
    esac
    exit 1
fi

# Guard against a proxy/login page being saved as a "bundle" with HTTP 200.
if [ "$(head -c 2 "$OUT.part")" != "PK" ]; then
    echo "error: response was not a ZIP archive (proxy or login page?)" >&2
    head -c 500 "$OUT.part" >&2 || true
    rm -f "$OUT.part"
    exit 1
fi

mv "$OUT.part" "$OUT"
SIZE="$(du -h "$OUT" | cut -f1)"
echo "✓ Bundle: $OUT  (${SIZE})"
echo ""
echo "  Inspect the manifest before sharing:"
echo "    unzip -p \"$OUT\" manifest.json"
echo ""
echo "  Strict mode (--redaction strict) additionally masks IPs and hostnames."
