# Shared helpers for the Catalyst split-LXC lab.
# shellcheck shell=bash

set -euo pipefail

LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${CONFIG:-$LAB_DIR/config.env}"

REPO_ROOT="${REPO_ROOT:-$(cd "$LAB_DIR/../.." && pwd)}"
STATE_DIR="${STATE_DIR:-$HOME/.local/share/catalyst-lxc-lab}"
COOKIE_JAR="${STATE_DIR}/cookies.txt"
STATE_FILE="${STATE_DIR}/state.env"
LOG_DIR="${STATE_DIR}/logs"

mkdir -p "$STATE_DIR" "$LOG_DIR"

log()  { printf '[lab] %s\n' "$*"; }
warn() { printf '[lab] WARN: %s\n' "$*" >&2; }
fail() { printf '[lab] ERROR: %s\n' "$*" >&2; exit 1; }

have_lxc() {
  lxc-info -n "$1" >/dev/null 2>&1
}

lxc_running() {
  have_lxc "$1" && [[ "$(lxc-info -n "$1" -sH 2>/dev/null || true)" == "RUNNING" ]]
}

lxc_exec() {
  local name="$1"
  shift
  lxc-attach -n "$name" --clear-env -- /usr/bin/env \
    PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    DEBIAN_FRONTEND=noninteractive \
    "$@"
}

wait_for_ip() {
  local name="$1"
  local expected="${2:-}"
  local i
  for i in $(seq 1 60); do
    local ip
    ip="$(lxc-info -n "$name" -iH 2>/dev/null | awk '/^10\./ {print $1; exit}')"
    if [[ -n "$ip" ]]; then
      if [[ -z "$expected" || "$ip" == "$expected" ]]; then
        printf '%s\n' "$ip"
        return 0
      fi
    fi
    sleep 2
  done
  return 1
}

wait_http() {
  local url="$1"
  local tries="${2:-60}"
  local i
  for i in $(seq 1 "$tries"); do
    if curl -fsS --max-time 5 "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 3
  done
  return 1
}

save_state() {
  local key="$1"
  local value="$2"
  mkdir -p "$STATE_DIR"
  touch "$STATE_FILE"
  if grep -q "^${key}=" "$STATE_FILE" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=$(printf '%q' "$value")|" "$STATE_FILE"
  else
    printf '%s=%q\n' "$key" "$value" >> "$STATE_FILE"
  fi
}

load_state() {
  # shellcheck disable=SC1090
  [[ -f "$STATE_FILE" ]] && source "$STATE_FILE" || true
}

api() {
  local method="$1"
  local path="$2"
  local data="${3:-}"
  local url="${API_BASE}${path}"
  local args=(-sS -X "$method" -b "$COOKIE_JAR" -c "$COOKIE_JAR"
    -H "Content-Type: application/json" -H "Accept: application/json")
  if [[ -n "${AUTH_TOKEN:-}" ]]; then
    args+=(-H "Authorization: Bearer ${AUTH_TOKEN}")
  fi
  if [[ -n "$data" ]]; then
    args+=(-d "$data")
  fi
  curl "${args[@]}" "$url"
}

# Sets LAST_STATUS and LAST_BODY.
api_ex() {
  local method="$1"
  local path="$2"
  local data="${3:-}"
  local url="${API_BASE}${path}"
  local args=(-sS -X "$method" -b "$COOKIE_JAR" -c "$COOKIE_JAR"
    -H "Accept: application/json"
    -w $'\n%{http_code}')
  if [[ -n "${AUTH_TOKEN:-}" ]]; then
    args+=(-H "Authorization: Bearer ${AUTH_TOKEN}")
  fi
  if [[ -n "$data" ]]; then
    args+=(-H "Content-Type: application/json" -d "$data")
  fi
  local out
  out="$(curl "${args[@]}" "$url")"
  LAST_STATUS="${out##*$'\n'}"
  LAST_BODY="${out%$'\n'*}"
}
api_upload() {
  local path="$1"
  local dest_dir="$2"
  local file="$3"
  local url="${API_BASE}${path}"
  local args=(-sS -X POST -b "$COOKIE_JAR" -c "$COOKIE_JAR"
    -w $'\n%{http_code}'
    -F "path=${dest_dir}" -F "file=@${file}")
  if [[ -n "${AUTH_TOKEN:-}" ]]; then
    args+=(-H "Authorization: Bearer ${AUTH_TOKEN}")
  fi
  local out
  out="$(curl "${args[@]}" "$url")"
  LAST_STATUS="${out##*$'\n'}"
  LAST_BODY="${out%$'\n'*}"
}

api_download() {
  local path="$1"
  local dest="$2"
  local url="${API_BASE}${path}"
  local args=(-sS -X GET -b "$COOKIE_JAR" -c "$COOKIE_JAR"
    -w '%{http_code}' -o "$dest")
  if [[ -n "${AUTH_TOKEN:-}" ]]; then
    args+=(-H "Authorization: Bearer ${AUTH_TOKEN}")
  fi
  curl "${args[@]}" "$url"
}

json_get() {
  jq -er "$1"
}

ensure_host_tools() {
  command -v lxc-create >/dev/null || fail "lxc-create missing"
  command -v curl >/dev/null || fail "curl missing"
  command -v jq >/dev/null || fail "jq missing"
  command -v python3 >/dev/null || fail "python3 missing"
}
