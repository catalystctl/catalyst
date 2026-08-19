#!/usr/bin/env bash
# scripts/benchmark/run.sh — one-command Catalyst vs Pterodactyl benchmark orchestrator
# Runs bench.mjs HTTP suites + ops.mjs operational benches, then renders comparison.
# Usage:
#   bash scripts/benchmark/run.sh
#   bash scripts/benchmark/run.sh --only catalyst
#   bash scripts/benchmark/run.sh --duration 10 --connections 20
#   BENCH_INCLUDE_MIGRATION=1 bash scripts/benchmark/run.sh  # opt-in destructive migration bench
# Outputs:
#   benchmarks/results/<ts>/catalyst.json
#   benchmarks/results/<ts>/pterodactyl.json
#   benchmarks/results/<ts>/ops-catalyst.json
#   benchmarks/results/<ts>/report.md
#   benchmarks/results/<ts>/comparison.json
set -euo pipefail

BENCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$BENCH_DIR/../.." && pwd)"
STATE_FILE="${STATE_FILE:-${HOME}/.local/share/catalyst-lxc-lab/state.env}"
OUT_ROOT="${OUT_ROOT:-${REPO_ROOT}/benchmarks/results}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="${OUT_DIR:-${OUT_ROOT}/${TIMESTAMP}}"

DURATION="${BENCH_DURATION:-15}"
CONNECTIONS="${BENCH_CONNECTIONS:-20}"
WARMUP="${BENCH_WARMUP:-2}"
ONLY="${BENCH_ONLY:-}" # catalyst|pterodactyl|ops
SKIP="${BENCH_SKIP:-}"
INCLUDE_MIGRATION="${BENCH_INCLUDE_MIGRATION:-0}"

# Parse CLI
while [[ $# -gt 0 ]]; do
  case "$1" in
    --only) ONLY="$2"; shift 2;;
    --duration) DURATION="$2"; shift 2;;
    --connections) CONNECTIONS="$2"; shift 2;;
    --warmup) WARMUP="$2"; shift 2;;
    --out-dir) OUT_DIR="$2"; shift 2;;
    --state-file) STATE_FILE="$2"; shift 2;;
    --help|-h) sed -n '1,80p' "$0"; exit 0;;
    *) echo "Unknown arg $1" >&2; exit 2;;
  esac
done

mkdir -p "$OUT_DIR"
echo "[bench] out: $OUT_DIR"

# Load state via bash source (handles %q quoting)
load_state_var() {
  local key="$1"
  if [[ -f "$STATE_FILE" ]]; then
    bash -c "source \"$STATE_FILE\" 2>/dev/null; printf '%s' \"\${${key}:-}\"" 2>/dev/null || true
  fi
}

if [[ -z "${CATALYST_URL:-}" ]]; then
  CATALYST_URL="$(load_state_var BACKEND_PUBLIC)"
fi
if [[ -z "$CATALYST_URL" ]]; then
  CATALYST_URL="$(load_state_var BACKEND_IP)"
  if [[ -n "$CATALYST_URL" ]]; then CATALYST_URL="http://${CATALYST_URL}:3000"; fi
fi
if [[ -z "$CATALYST_URL" ]] || [[ "$CATALYST_URL" == "http://:3000" ]]; then
  CATALYST_URL="http://127.0.0.1:3000"
fi
# Fallback: API_BASE or PUBLIC_URL
if [[ -f "$STATE_FILE" ]]; then
  maybe="$(bash -c "source \"$STATE_FILE\" 2>/dev/null; printf '%s' \"\${API_BASE:-}\${PUBLIC_URL:-}\"" 2>/dev/null || true)"
  if [[ -n "$maybe" && "$CATALYST_URL" == "http://127.0.0.1:3000" ]]; then CATALYST_URL="$maybe"; fi
fi
# Final fallback: lab defaults (state.env doesn't store BACKEND_IP by default)
if [[ "$CATALYST_URL" == "http://127.0.0.1:3000" ]]; then
  if [[ -f "$REPO_ROOT/scripts/lxc-lab/config.env" ]]; then
    _lab_backend_ip="$(bash -c "source \"$REPO_ROOT/scripts/lxc-lab/config.env\" 2>/dev/null; printf '%s' \"\${BACKEND_IP:-}\"" 2>/dev/null || true)"
    if [[ -n "$_lab_backend_ip" ]]; then CATALYST_URL="http://${_lab_backend_ip}:3000"; fi
  fi
fi
if [[ "$CATALYST_URL" == "http://127.0.0.1:3000" ]]; then
  CATALYST_URL="http://10.0.3.20:3000"
fi

PTERO_URL="$(load_state_var PTERO_URL)"
if [[ -z "$PTERO_URL" ]]; then PTERO_URL="http://10.0.3.30"; fi

AUTH_TOKEN="$(load_state_var AUTH_TOKEN)"
PTERO_APP_KEY="$(load_state_var PTERO_APP_KEY)"
PTERO_CLIENT_KEY="$(load_state_var PTERO_CLIENT_KEY)"
PAPER_ID="$(load_state_var PAPER_SERVER_ID)"
PTERO_SERVER_ID="$(load_state_var PTERO_SERVER_ID)"
PTERO_SERVER_UUID="$(load_state_var PTERO_SERVER_UUID)"
PTERO_NEST_ID="$(load_state_var PTERO_NEST_ID)"

# Try to obtain AUTH_TOKEN via API login if missing and we have admin creds
if [[ -z "$AUTH_TOKEN" ]]; then
  echo "[bench] AUTH_TOKEN missing, trying login at $CATALYST_URL"
  # source lab config for admin email/pass
  if [[ -f "$REPO_ROOT/scripts/lxc-lab/config.env" ]]; then
    # shellcheck disable=SC1091
    source "$REPO_ROOT/scripts/lxc-lab/config.env" 2>/dev/null || true
  fi
  if [[ -n "${ADMIN_EMAIL:-}" && -n "${ADMIN_PASSWORD:-}" ]]; then
    login_resp="$(curl -sS -X POST -H "Content-Type: application/json" \
      -d "$(jq -n --arg email "$ADMIN_EMAIL" --arg password "$ADMIN_PASSWORD" '{email:$email,password:$password,rememberMe:true}')" \
      "$CATALYST_URL/api/auth/login" 2>&1 || true)"
    AUTH_TOKEN="$(printf '%s' "$login_resp" | jq -r '.data.token // .token // empty' 2>/dev/null || true)"
    if [[ -n "$AUTH_TOKEN" && "$AUTH_TOKEN" != "null" ]]; then
      echo "[bench] obtained AUTH_TOKEN via login"
    else
      echo "[bench] WARN: login failed: ${login_resp:0:300}"
    fi
  fi
fi

echo "[bench] catalyst: $CATALYST_URL"
echo "[bench] pterodactyl: $PTERO_URL"
echo "[bench] connections=$CONNECTIONS duration=${DURATION}s warmup=${WARMUP}s"

# Ensure node
if ! command -v node >/dev/null; then
  echo "[bench] node missing" >&2
  exit 1
fi

# Run Catalyst HTTP suites
if [[ "$ONLY" != "pterodactyl" && "$ONLY" != "ptero" ]]; then
  if [[ -z "$AUTH_TOKEN" || "$AUTH_TOKEN" == "null" ]]; then
    echo "[bench] SKIP catalyst HTTP (no AUTH_TOKEN; run lab.sh bootstrap or pass AUTH_TOKEN env)"
  else
    echo "[bench] → catalyst HTTP suites"
    node "$BENCH_DIR/bench.mjs" \
      --url "$CATALYST_URL" \
      --token "$AUTH_TOKEN" \
      --connections "$CONNECTIONS" \
      --duration "$DURATION" \
      --warmup "$WARMUP" \
      --paper-id "$PAPER_ID" \
      --ptero-id "$PTERO_SERVER_ID" \
      --ptero-uuid "$PTERO_SERVER_UUID" \
      --nest-id "$PTERO_NEST_ID" \
      --config "$BENCH_DIR/scenarios.json" \
      --out "$OUT_DIR/catalyst.json" || echo "[bench] catalyst HTTP had errors (see above)"
  fi
else
  echo "[bench] SKIP catalyst (ONLY=$ONLY)"
fi

# Run Pterodactyl HTTP suites (Application API)
if [[ "$ONLY" != "catalyst" && "$ONLY" != "ops" ]]; then
  if [[ -z "$PTERO_APP_KEY" || "$PTERO_APP_KEY" == "null" ]]; then
    echo "[bench] SKIP pterodactyl HTTP (no PTERO_APP_KEY in $STATE_FILE; run lab.sh ptero-seed)"
  else
    echo "[bench] → pterodactyl HTTP suites"
    # Map scenarios.json pterodactyl specs to bench.mjs via manual per-suite calls
    # Use bench.mjs with ptero base + app key, substituting ptero paths
    # We synthesize a ptero-specific scenarios file on the fly
    PTERO_SCENARIOS_TMP="$OUT_DIR/_ptero-scenarios.json"
    node -e "
import {readFileSync, writeFileSync} from 'fs';
const src = JSON.parse(readFileSync('$BENCH_DIR/scenarios.json','utf8'));
const out = { suites: [] };
for (const s of src.suites || []) {
  const p = s.pterodactyl;
  if (!p || !p.path) continue;
  // pterodactyl suites become catalyst-shaped for bench.mjs
  out.suites.push({ id: s.id, catalyst: { path: p.path, method: p.method || 'GET' } });
}
writeFileSync('$PTERO_SCENARIOS_TMP', JSON.stringify(out, null, 2));
"
    node "$BENCH_DIR/bench.mjs" \
      --url "$PTERO_URL" \
      --token "$PTERO_APP_KEY" \
      --accept "application/vnd.pterodactyl.v1+json" \
      --connections "$CONNECTIONS" \
      --duration "$DURATION" \
      --warmup "$WARMUP" \
      --paper-id "$PAPER_ID" \
      --ptero-id "$PTERO_SERVER_ID" \
      --ptero-uuid "$PTERO_SERVER_UUID" \
      --nest-id "$PTERO_NEST_ID" \
      --config "$PTERO_SCENARIOS_TMP" \
      --out "$OUT_DIR/pterodactyl.json" || echo "[bench] pterodactyl HTTP had errors"
  fi
else
  echo "[bench] SKIP pterodactyl (ONLY=$ONLY)"
fi

# Run ops (Catalyst)
if [[ "$ONLY" != "pterodactyl" && "$ONLY" != "ptero" ]]; then
  echo "[bench] → catalyst ops"
  OPS_ARGS=(--target catalyst --out "$OUT_DIR/ops-catalyst.json" --state-file "$STATE_FILE")
  if [[ -n "$SKIP" ]]; then OPS_ARGS+=(--skip "$SKIP"); fi
  # migration is opt-in
  if [[ "$INCLUDE_MIGRATION" == "1" ]]; then
    export BENCH_INCLUDE_MIGRATION=1
  fi
  node "$BENCH_DIR/ops.mjs" "${OPS_ARGS[@]}" || echo "[bench] ops had errors"
else
  echo "[bench] SKIP ops (ONLY=$ONLY)"
fi

# Render comparison if both HTTP results exist
if [[ -f "$OUT_DIR/catalyst.json" && -f "$OUT_DIR/pterodactyl.json" ]]; then
  echo "[bench] → comparison report"
  node "$BENCH_DIR/compare.mjs" \
    --catalyst "$OUT_DIR/catalyst.json" \
    --pterodactyl "$OUT_DIR/pterodactyl.json" \
    --out "$OUT_DIR/report.md" \
    --json "$OUT_DIR/comparison.json" || true
  # Also render ops into comparison if present
  if [[ -f "$OUT_DIR/ops-catalyst.json" ]]; then
    node "$BENCH_DIR/compare.mjs" \
      --catalyst "$OUT_DIR/ops-catalyst.json" \
      --pterodactyl "$OUT_DIR/ops-catalyst.json" \
      --out "$OUT_DIR/ops-report.md" || true
  fi
fi

# Summary
echo ""
echo "[bench] Results in $OUT_DIR"
ls -lh "$OUT_DIR" | sed 's/^/[bench] /'
if [[ -f "$OUT_DIR/report.md" ]]; then
  echo ""
  echo "[bench] report preview:"
  head -n 40 "$OUT_DIR/report.md" | sed 's/^/[bench] /'
fi
echo ""
echo "[bench] Done. Re-run: bash scripts/benchmark/run.sh"
echo "[bench] View: cat $OUT_DIR/report.md"
