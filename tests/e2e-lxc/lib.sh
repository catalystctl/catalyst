# Shared helpers for the reusable LXC E2E pipeline.
# shellcheck shell=bash
set -euo pipefail

E2E_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${CONFIG:-$E2E_LIB_DIR/config.env}"

E2E_REPO_ROOT="${E2E_REPO_ROOT:-$(cd "$E2E_LIB_DIR/../.." && pwd)}"
E2E_STATE_DIR="${E2E_STATE_DIR:-${HOME}/.local/share/catalyst-e2e-lxc}"
E2E_LOG_DIR="${E2E_STATE_DIR}/logs"
E2E_STATE_FILE="${E2E_STATE_DIR}/state.env"
E2E_COOKIE_JAR="${E2E_STATE_DIR}/cookies.txt"
E2E_JUNIT_FILE="${E2E_STATE_DIR}/junit.xml"

mkdir -p "$E2E_STATE_DIR" "$E2E_LOG_DIR"

e2e_log() { printf '[e2e-lxc] %s\n' "$*"; }
e2e_warn() { printf '[e2e-lxc] WARN: %s\n' "$*" >&2; }
e2e_fail() { printf '[e2e-lxc] ERROR: %s\n' "$*" >&2; exit 1; }

# --- JUnit bookkeeping (one testcase per stage) ---
# Cases persist in a file so per-stage invocations (create, install, ...)
# accumulate into one report instead of each run overwriting the last.
E2E_JUNIT_CASES_FILE="${E2E_STATE_DIR}/junit-cases.txt"
e2e_junit_case() {
  local name="$1" status="$2" message="${3:-}"
  local entry="<testcase classname=\"e2e-lxc\" name=\"${name}\""
  if [[ "$status" == "pass" ]]; then
    entry="${entry}/>"
  else
    entry="${entry}><failure message=\"${message:-$name failed}\">${message:-$name failed}</failure></testcase>"
  fi
  mkdir -p "$E2E_STATE_DIR"
  touch "$E2E_JUNIT_CASES_FILE"
  grep -v "name=\"${name}\"" "$E2E_JUNIT_CASES_FILE" > "${E2E_JUNIT_CASES_FILE}.tmp" || true
  printf '%s\n' "$entry" >> "${E2E_JUNIT_CASES_FILE}.tmp"
  mv "${E2E_JUNIT_CASES_FILE}.tmp" "$E2E_JUNIT_CASES_FILE"
}
e2e_junit_write() {
  # grep -c prints 0 on no match but exits 1; || true keeps set -e alive
  # while preserving the printed count.
  local cases failures tests
  cases="$(cat "$E2E_JUNIT_CASES_FILE" 2>/dev/null || true)"
  failures="$(printf '%s' "$cases" | grep -c '<failure' || true)"
  tests="$(printf '%s' "$cases" | grep -c '<testcase' || true)"
  failures="$(printf '%s' "$failures" | tr -d ' ')"
  tests="$(printf '%s' "$tests" | tr -d ' ')"
  cat > "$E2E_JUNIT_FILE" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="catalyst-e2e-lxc" tests="${tests:-0}" failures="${failures:-0}">
${cases}
</testsuite>
EOF
  e2e_log "JUnit report: ${E2E_JUNIT_FILE}"
}
e2e_junit_reset() {
  rm -f "$E2E_JUNIT_CASES_FILE" "$E2E_JUNIT_FILE"
}

e2e_run_stage() {
  local name="$1"
  shift
  local start end rc=0
  start="$(date +%s)"
  e2e_log "── stage: ${name} ──"
  if "$@" 2>&1 | tee "${E2E_LOG_DIR}/stage-${name}.log"; then
    rc=0
  else
    rc=$?
  fi
  end="$(date +%s)"
  if [[ "$rc" -eq 0 ]]; then
    e2e_log "stage ${name}: PASS ($((end - start))s)"
    e2e_junit_case "$name" pass
  else
    e2e_warn "stage ${name}: FAIL ($((end - start))s, see ${E2E_LOG_DIR}/stage-${name}.log)"
    e2e_junit_case "$name" fail "see stage-${name}.log"
  fi
  e2e_junit_write
  return "$rc"
}

# --- LXC helpers ---
e2e_have_lxc() { lxc-info -n "$1" >/dev/null 2>&1; }
e2e_lxc_running() { e2e_have_lxc "$1" && [[ "$(lxc-info -n "$1" -sH 2>/dev/null || true)" == "RUNNING" ]]; }

e2e_lxc_exec() {
  local name="$1"
  shift
  lxc-attach -n "$name" --clear-env -- /usr/bin/env \
    PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    HOME=/root \
    DEBIAN_FRONTEND=noninteractive \
    "$@"
}

e2e_wait_for_ip() {
  local name="$1" expected="${2:-}" i ip
  for i in $(seq 1 60); do
    # Match ANY reported address: containers can briefly hold extra
    # (e.g. secondary dynamic) addresses besides the expected static one.
    ip="$(lxc-info -n "$name" -iH 2>/dev/null | tr ' ' '\n' | grep -E '^10\.' || true)"
    if [[ -n "$ip" ]]; then
      if [[ -z "$expected" ]]; then
        printf '%s\n' "$ip" | head -1
        return 0
      fi
      if printf '%s\n' "$ip" | grep -Fxq "$expected"; then
        printf '%s\n' "$expected"
        return 0
      fi
    fi
    sleep 2
  done
  return 1
}

e2e_wait_http() {
  local url="$1" tries="${2:-60}" i
  for i in $(seq 1 "$tries"); do
    if curl -fsS --max-time 5 "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 3
  done
  return 1
}

e2e_save_state() {
  local key="$1" value="$2"
  mkdir -p "$E2E_STATE_DIR"
  touch "$E2E_STATE_FILE"
  if grep -q "^${key}=" "$E2E_STATE_FILE" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=$(printf '%q' "$value")|" "$E2E_STATE_FILE"
  else
    printf '%s=%q\n' "$key" "$value" >> "$E2E_STATE_FILE"
  fi
}

e2e_load_state() {
  if [[ -f "$E2E_STATE_FILE" ]]; then
    # shellcheck disable=SC1090
    source "$E2E_STATE_FILE"
  fi
}

# Address of the node from the panel's and prober's point of view.
# host mode: the host itself on lxcbr0. lxc mode: the node LXC's static IP.
e2e_node_addr() {
  if [[ "${E2E_NODE_MODE:-host}" == "host" ]]; then
    printf '%s\n' "${E2E_HOST_LXCBR_IP:-10.0.3.1}"
  else
    printf '%s\n' "${E2E_NODE_IP}"
  fi
}

# PID of the isolated host agent (E2E_NODE_MODE=host), resolved by matching
# the config path in /proc cmdlines. Never match by binary-name pattern
# inside a command that also mentions the binary path: pkill -f would match
# the caller's own argv and kill itself. (The kernel also truncates comm to
# 15 chars, so comm-based matching misses this binary entirely.)
e2e_host_agent_pid() {
  local cfg="$1" p cmdline
  for p in $(pgrep catalyst-e2e-ag 2>/dev/null); do
    cmdline="$(sudo tr '\0' ' ' < "/proc/$p/cmdline" 2>/dev/null || true)"
    if printf '%s' "$cmdline" | grep -qF "$cfg"; then
      printf '%s\n' "$p"
      return 0
    fi
  done
  return 1
}

# --- Panel API helpers (cookie jar + bearer token) ---
e2e_api() {
  local method="$1" path="$2" data="${3:-}"
  local url="${E2E_API_BASE}${path}"
  local args=(-sS -X "$method" -b "$E2E_COOKIE_JAR" -c "$E2E_COOKIE_JAR"
    -H "Content-Type: application/json" -H "Accept: application/json")
  if [[ -n "${E2E_AUTH_TOKEN:-}" ]]; then
    args+=(-H "Authorization: Bearer ${E2E_AUTH_TOKEN}")
  fi
  if [[ -n "$data" ]]; then
    args+=(-d "$data")
  fi
  curl "${args[@]}" "$url"
}

# e2e_api_ex METHOD PATH [DATA] — sets E2E_LAST_STATUS / E2E_LAST_BODY.
e2e_api_ex() {
  local method="$1" path="$2" data="${3:-}"
  local url="${E2E_API_BASE}${path}"
  local args=(-sS -X "$method" -b "$E2E_COOKIE_JAR" -c "$E2E_COOKIE_JAR"
    -H "Accept: application/json" -w $'\n%{http_code}')
  if [[ -n "${E2E_AUTH_TOKEN:-}" ]]; then
    args+=(-H "Authorization: Bearer ${E2E_AUTH_TOKEN}")
  fi
  if [[ -n "$data" ]]; then
    args+=(-H "Content-Type: application/json" -d "$data")
  fi
  local out
  out="$(curl "${args[@]}" "$url")"
  E2E_LAST_STATUS="${out##*$'\n'}"
  E2E_LAST_BODY="${out%$'\n'*}"
}

e2e_ensure_host_tools() {
  command -v lxc-create >/dev/null || e2e_fail "lxc-create missing (apt install lxc)"
  command -v lxc-attach >/dev/null || e2e_fail "lxc-attach missing"
  command -v curl >/dev/null || e2e_fail "curl missing"
  command -v jq >/dev/null || e2e_fail "jq missing"
  command -v python3 >/dev/null || e2e_fail "python3 missing"
}

# Push a host file into an LXC (rootfs is uid-mapped; host writes fail).
e2e_push_file() {
  local name="$1" src="$2" dest="$3"
  e2e_lxc_exec "$name" bash -lc "mkdir -p '$(dirname "$dest")'"
  lxc-attach -n "$name" -- /bin/sh -c "cat > '$dest'" < "$src"
}
