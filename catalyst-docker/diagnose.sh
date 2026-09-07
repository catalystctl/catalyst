#!/usr/bin/env bash
# ============================================================
# Catalyst — One-click diagnostics bundle (redacted)
# For installs created with install.sh (catalyst-docker).
#
# Collects everything support / AI agents usually need:
#   host info, runtime versions, compose status, service health,
#   compose logs, redacted .env, compose files, agent status/logs,
#   install log tail — with secrets stripped.
#
# Usage:
#   cd catalyst-docker && bash diagnose.sh [--lines N] [--out DIR]
#                                        [--mask-hosts] [--full]
# Old installs without this file:
#   curl -fsSL https://raw.githubusercontent.com/catalystctl/catalyst/main/catalyst-docker/diagnose.sh -o /tmp/diagnose.sh \
#     && bash /tmp/diagnose.sh --compose-dir ~/catalyst-docker
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_DIR="$SCRIPT_DIR"
LINES=500
OUT_PARENT=""
MASK_HOSTS=false
FULL=false
SKIP_AGENT=false

for arg in "$@"; do
    case "$arg" in
        --lines=*) LINES="${arg#--lines=}"; shift || true ;;
        --out=*) OUT_PARENT="${arg#--out=}"; shift || true ;;
        --compose-dir=*) COMPOSE_DIR="${arg#--compose-dir=}"; shift || true ;;
        --mask-hosts) MASK_HOSTS=true; shift || true ;;
        --full) FULL=true; LINES=2000; shift || true ;;
        --skip-agent) SKIP_AGENT=true; shift || true ;;
        -h|--help)
            cat <<'HELP'
Catalyst — one-click diagnostics bundle (redacted).
Collects host info, runtime versions, compose status, service health,
compose logs, redacted .env, compose files, agent status/logs, and the
install log tail. Secrets are replaced with [REDACTED]; hostnames and
ports are kept unless --mask-hosts is passed.
HELP
            echo ""
            echo "Usage: bash diagnose.sh [--lines N] [--out DIR] [--compose-dir DIR] [--mask-hosts] [--full] [--skip-agent]"
            echo "  --lines=N         Log lines per service (default: 500, --full: 2000)"
            echo "  --out=DIR         Parent dir for the bundle (default: COMPOSE_DIR)"
            echo "  --compose-dir=DIR Path to catalyst-docker (default: script dir)"
            echo "  --mask-hosts      Also mask IPs/domains (default keeps hosts, strips secrets)"
            echo "  --full            More lines + container inspect (larger bundle)"
            echo "  --skip-agent      Skip node-agent checks (panel-only bundle)"
            echo "  -h, --help        Show this help"
            exit 0
            ;;
        --lines|--out|--compose-dir)
            echo "Option $arg needs a value: use $arg=VALUE" >&2; exit 1 ;;
        *)
            if [[ "$arg" =~ ^[0-9]+$ ]]; then LINES="$arg";
            else echo "Unknown argument: $arg (try --help)" >&2; exit 1; fi
            ;;
    esac
done

# When piped via `curl | bash`, BASH_SOURCE[0] is not a file — fall back to cwd.
if [[ ! -d "$COMPOSE_DIR" ]]; then COMPOSE_DIR="$PWD"; fi
if [[ -z "$OUT_PARENT" ]]; then OUT_PARENT="$COMPOSE_DIR"; fi

if [[ -t 1 ]]; then
    GRN='\033[0;32m'; YLW='\033[1;33m'; CYN='\033[0;36m'; BLD='\033[1m'; RST='\033[0m'
else
    GRN=''; YLW=''; CYN=''; BLD=''; RST=''
fi
ok()   { echo -e "  ${GRN}✓${RST} $*"; }
info() { echo -e "  ${CYN}ℹ${RST} $*"; }
warn() { echo -e "  ${YLW}⚠${RST} $*" >&2; }

# ── Redaction ─────────────────────────────────────────────────────────────
# Keeps hostnames/URLs (needed for PASSKEY_RP_ID / CORS / routing debugging)
# but strips secret VALUES, credentials inside URLs, and tokens.
# --mask-hosts additionally masks bare IPs and hostnames.
# NOTE: the generic key pattern requires an '=' or ':' separator and refuses
# values starting with '$', '?', or '{' so shell expansions like
# '${VAR:?message}' and prose like 'KEY set length 12' pass through intact.
redact() {
    sed -E \
        -e 's#(postgres(ql)?://[^/:[:space:]]+:)[^@[:space:]/]+@#\1[REDACTED]@#g' \
        -e 's#(redis://([^[:space:]]*:)?)[^@[:space:]/]+@#\1[REDACTED]@#g' \
        -e 's#((//)[^/:[:space:]]+:)[^@[:space:]/]+@#\1[REDACTED]@#g' \
        -e 's#([Bb]earer[[:space:]]+)[A-Za-z0-9._~+/_=-]+#\1[REDACTED]#g' \
        -e 's#((api[_-]?key|auth[_-]?token|access[_-]?token|refresh[_-]?token|secret|password|passwd|pwd)["'"'"']?[[:space:]]*[:=][[:space:]]*)["'"'"']?[^"'"'"'[:space:],;}?$][^"'"'"'[:space:],;}]*["'"'"']?#\1[REDACTED]#gi' \
        -e 's#AKIA[0-9A-Z]{16}#AKIA[REDACTED]#g' \
        -e 's#xox[bpas]-[A-Za-z0-9-]+#xox[REDACTED]#g' \
        -e 's#gh[pousr]_[A-Za-z0-9]+#gh[REDACTED]#g' \
        -e 's#sk-(live|test)-[A-Za-z0-9]+#sk-[REDACTED]#g' \
        -e 's#eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}#[REDACTED_JWT]#g' \
        -e 's#-----BEGIN [A-Z ]*PRIVATE KEY-----[^-]*-----END [A-Z ]*PRIVATE KEY-----#[REDACTED_PRIVATE_KEY]#g'
}

# Redact KEY=VALUE lines for known-secret keys, preserving the key name.
redact_env_file() {
    sed -E \
        -e 's/^([[:space:]]*(POSTGRES_PASSWORD|REDIS_PASSWORD|BETTER_AUTH_SECRET|API_KEY_SECRET|BACKUP_CREDENTIALS_ENCRYPTION_KEY|BACKUP_S3_SECRET_KEY|BACKUP_S3_ACCESS_KEY|WEBHOOK_SECRET|WHMCS_OIDC_CLIENT_SECRET|PAYMENTER_OIDC_CLIENT_SECRET|SENTRY_DSN)[[:space:]]*=[[:space:]]*).*/\1[REDACTED]/' \
        -e 's/^([[:space:]]*[A-Za-z0-9_]*(_PASSWORD|_SECRET|_TOKEN|_PRIVATE_KEY)([A-Za-z0-9_]*)[[:space:]]*=[[:space:]]*).*/\1[REDACTED]/' \
    | redact
}

mask_hosts() {
    if $MASK_HOSTS; then
        sed -E \
            -e 's#[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}#[IP_REDACTED]#g' \
            -e 's#([a-zA-Z0-9-]+\.)+(com|net|org|io|dev|app|local|lan|home|internal)(:[0-9]+)?#[HOST_REDACTED]#g'
    else
        cat
    fi
}

filter() { redact | mask_hosts; }

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="${OUT_PARENT}/catalyst-diagnostics-${TIMESTAMP}"
BUNDLE="${OUT_DIR}/catalyst-diagnostics-${TIMESTAMP}.txt"
mkdir -p "$OUT_DIR"

RUNTIME_CMD=""; COMPOSE_CMD=""
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    RUNTIME_CMD="docker"; COMPOSE_CMD="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_CMD="docker-compose"
    command -v docker >/dev/null 2>&1 && RUNTIME_CMD="docker"
elif command -v podman >/dev/null 2>&1 && podman compose version >/dev/null 2>&1; then
    RUNTIME_CMD="podman"; COMPOSE_CMD="podman compose"
elif command -v podman-compose >/dev/null 2>&1; then
    RUNTIME_CMD="podman"; COMPOSE_CMD="podman-compose"
elif command -v podman >/dev/null 2>&1; then
    RUNTIME_CMD="podman"
elif command -v docker >/dev/null 2>&1; then
    RUNTIME_CMD="docker"
fi
# Fallback for `docker ps`-style probes when only one runtime exists.
if [[ -z "$RUNTIME_CMD" ]]; then RUNTIME_CMD="docker"; fi

# Split COMPOSE_CMD ("docker compose" vs "docker-compose") for direct use.
# shellcheck disable=SC2206
COMPOSE_ARR=($COMPOSE_CMD)

compose() { (cd "$COMPOSE_DIR" && "${COMPOSE_ARR[@]}" "$@"); }

sec()  { { echo ""; echo "===== $* ====="; } >> "$BUNDLE"; }
note() { echo "# $*" >> "$BUNDLE"; }

# Run a command, append redacted output (never fails the bundle).
collect() {
    local title="$1"; shift
    sec "$title"
    note "\$ $*"
    if "$@" >> "$OUT_DIR/.raw.tmp" 2>&1; then
        filter < "$OUT_DIR/.raw.tmp" >> "$BUNDLE"
    else
        echo "(exit $?) — output below (if any):" >> "$BUNDLE"
        filter < "$OUT_DIR/.raw.tmp" >> "$BUNDLE"
    fi
    : > "$OUT_DIR/.raw.tmp"
}

collect_file() {
    local title="$1" file="$2" is_env="${3:-false}"
    sec "$title"
    if [[ -f "$file" ]]; then
        note "file: $file"
        if [[ "$is_env" == "env" ]]; then
            redact_env_file < "$file" >> "$BUNDLE"
        else
            filter < "$file" >> "$BUNDLE"
        fi
    else
        echo "(not found: $file)" >> "$BUNDLE"
    fi
}

collect_compose_logs() {
    local svc="$1"
    sec "logs: $svc (last $LINES lines)"
    if [[ -z "$COMPOSE_CMD" ]]; then echo "(no compose command found)" >> "$BUNDLE"; return; fi
    if compose logs --no-color --tail="$LINES" "$svc" >> "$OUT_DIR/.raw.tmp" 2>&1; then
        filter < "$OUT_DIR/.raw.tmp" >> "$BUNDLE"
    else
        echo "(service '$svc' has no logs or is not running)" >> "$BUNDLE"
        filter < "$OUT_DIR/.raw.tmp" >> "$BUNDLE"
    fi
    : > "$OUT_DIR/.raw.tmp"
}

echo -e "\n${BLD}${CYN}  ── Catalyst diagnostics ──${RST}"
info "Compose dir: $COMPOSE_DIR"
info "Log lines per service: $LINES"
: > "$BUNDLE"; : > "$OUT_DIR/.raw.tmp"

{
    echo "Catalyst diagnostics bundle (REDACTED — safe to share)"
    echo "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ) (UTC) on $(hostname 2>/dev/null || echo unknown-host)"
    echo "Script: catalyst-docker/diagnose.sh | lines=$LINES mask_hosts=$MASK_HOSTS full=$FULL"
    echo ""
    echo "REDACTION: secret values, URL credentials, Bearer tokens, AWS keys,"
    echo "  JWTs, and private keys are replaced with [REDACTED]. Hostnames and"
    echo "  ports are KEPT (needed for routing/CORS/passkey debugging) unless"
    echo "  you passed --mask-hosts. Review the file before sharing anyway."
} >> "$BUNDLE"

# ── Host ──────────────────────────────────────────────────────────────────
collect "host: uname" uname -a
collect "host: os-release" cat /etc/os-release
collect "host: uptime + load" uptime
collect "host: memory" free -h
collect "host: disk (human)" df -h
collect "host: disk inodes" df -i
collect "host: cpu count" nproc
collect "host: listening ports (80/443/8080/3000/2022/5432/6379)" bash -c 'ss -tlnp 2>/dev/null | grep -E ":(80|443|8080|3000|2022|5432|6379)\b" || ss -tlnp 2>/dev/null | head -30'

# ── Runtime ───────────────────────────────────────────────────────────────
collect "runtime: version" bash -c '"$0" --version 2>&1 || echo "no container runtime found"' "$RUNTIME_CMD"
collect "runtime: compose version" bash -c 'docker compose version 2>&1 || docker-compose --version 2>&1 || podman compose version 2>&1 || podman-compose --version 2>&1 || echo "no compose found"'
collect "runtime: info (plugins, storage)" bash -c '"$0" info 2>&1 || echo "runtime info unavailable"' "$RUNTIME_CMD"
collect "runtime: containers (all, catalyst first)" bash -c '"$0" ps -a --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null | (grep -i -E "NAMES|catalyst|postgres|redis" || head -20)' "$RUNTIME_CMD"
collect "runtime: images (catalyst/postgres/redis)" bash -c '"$0" images --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.CreatedAt}}" 2>/dev/null | (grep -i -E "REPOSITORY|catalyst|postgres|redis|caddy|traefik" || head -20)' "$RUNTIME_CMD"
collect "runtime: volumes" bash -c '"$0" volume ls 2>/dev/null | grep -i catalyst || "$0" volume ls 2>/dev/null | head -20' "$RUNTIME_CMD"
collect "runtime: disk usage" bash -c '"$0" system df 2>&1 || echo "system df unavailable"' "$RUNTIME_CMD"

# ── Compose project ───────────────────────────────────────────────────────
collect "compose: directory listing" ls -la "$COMPOSE_DIR"
if [[ -z "$COMPOSE_CMD" ]]; then
    sec "compose: ps"
    echo "(no compose command found — install docker compose or podman-compose)" >> "$BUNDLE"
else
    collect "compose: ps" compose ps
    collect "compose: images" compose images
    collect "compose: config (redacted — variables expanded)" compose config
fi
# Fix up: the generic collect() already redacted; config output went through filter. Good.
collect_file "config: .env (REDACTED — secret values stripped)" "$COMPOSE_DIR/.env" env
collect "config: required vars present? (names only, no values)" bash -c 'for k in PUBLIC_URL APP_NAME NODE_ENV POSTGRES_PASSWORD BETTER_AUTH_SECRET REDIS_PASSWORD API_KEY_SECRET BACKUP_CREDENTIALS_ENCRYPTION_KEY PASSKEY_RP_ID FRONTEND_PORT BACKEND_PORT; do if grep -q "^$k=" "'"$COMPOSE_DIR"'/.env" 2>/dev/null; then v=$(grep "^$k=" "'"$COMPOSE_DIR"'/.env" | head -1 | cut -d= -f2-); if [[ -z "$v" || "$v" == CHANGE_ME* ]]; then echo "$k MISSING_OR_PLACEHOLDER"; else echo "$k set length ${#v}"; fi; else echo "$k absent"; fi; done'
collect_file "config: docker-compose.yml" "$COMPOSE_DIR/docker-compose.yml"
collect_file "config: docker-compose.caddy.yml" "$COMPOSE_DIR/docker-compose.caddy.yml"
collect_file "config: docker-compose.traefik.yml" "$COMPOSE_DIR/docker-compose.traefik.yml"
collect_file "config: nginx/default.conf" "$COMPOSE_DIR/nginx/default.conf"
collect_file "config: caddy/Caddyfile" "$COMPOSE_DIR/caddy/Caddyfile"
collect_file "config: traefik/traefik.yml" "$COMPOSE_DIR/traefik/traefik.yml"

# ── Health ────────────────────────────────────────────────────────────────
PUBLIC_URL="$(grep '^PUBLIC_URL=' "$COMPOSE_DIR/.env" 2>/dev/null | head -1 | cut -d= -f2- || true)"
collect "health: backend /health (localhost:3000)" bash -c 'curl -fsS -m 10 http://localhost:3000/health 2>&1 || echo "backend :3000/health unreachable from this host"'
collect "health: backend via PUBLIC_URL" bash -c 'if [ -n "'"$PUBLIC_URL"'" ]; then curl -fsS -m 10 "'"${PUBLIC_URL}"'/health" 2>&1 || curl -fsS -m 10 "'"${PUBLIC_URL}"'/api/health" 2>&1 || echo "PUBLIC_URL health check failed"; else echo "(no PUBLIC_URL in .env)" ; fi'
collect "health: frontend (localhost:8080 + :80)" bash -c 'curl -sS -o /dev/null -m 10 -w "8080 -> %{http_code}\n" http://localhost:8080/ 2>&1; curl -sS -o /dev/null -m 10 -w "80 -> %{http_code}\n" http://localhost:80/ 2>&1 || true'
if [[ -z "$COMPOSE_CMD" ]]; then
    sec "health: postgres pg_isready"
    echo "(no compose command found)" >> "$BUNDLE"
    sec "health: redis ping"
    echo "(no compose command found)" >> "$BUNDLE"
else
    collect "health: postgres pg_isready" compose exec -T postgres pg_isready -U catalyst -d catalyst_db
    collect "health: redis ping" compose exec -T redis redis-cli --no-auth-warning ping
fi

# ── Logs ──────────────────────────────────────────────────────────────────
for svc in backend frontend postgres redis; do
    collect_compose_logs "$svc"
done
for svc in caddy traefik; do
    if [[ -n "$COMPOSE_CMD" ]] && compose ps "$svc" 2>/dev/null | grep -q "$svc"; then
        collect_compose_logs "$svc"
    fi
done
sec "logs: backend error summary (ERROR/FATAL/P1000/P1001 grep, last $LINES)"
if [[ -n "$COMPOSE_CMD" ]] && compose logs --no-color --tail="$LINES" backend > "$OUT_DIR/.raw.tmp" 2>&1; then
    grep -a -i -E "error|fatal|exception|p1000|p1001|ECONNREFUSED|auth failed|migration" "$OUT_DIR/.raw.tmp" | tail -50 | filter >> "$BUNDLE" || echo "(no error lines in tail)" >> "$BUNDLE"
else
    echo "(backend logs unavailable)" >> "$BUNDLE"
fi
: > "$OUT_DIR/.raw.tmp"

LATEST_INSTALL_LOG="$(ls -t /tmp/catalyst-install-*.log 2>/dev/null | head -1 || true)"
sec "install log tail ($LATEST_INSTALL_LOG, last 100 lines)"
if [[ -n "$LATEST_INSTALL_LOG" && -f "$LATEST_INSTALL_LOG" ]]; then
    note "file: $LATEST_INSTALL_LOG"
    tail -100 "$LATEST_INSTALL_LOG" | filter >> "$BUNDLE"
else
    echo "(no /tmp/catalyst-install-*.log found — install ran elsewhere or /tmp was cleared)" >> "$BUNDLE"
fi

# ── Agent (node) ──────────────────────────────────────────────────────────
if ! $SKIP_AGENT; then
    AGENT_CONFIG=""
    for c in /opt/catalyst-agent/config.toml /etc/catalyst-agent/config.toml; do
        [[ -s "$c" ]] && AGENT_CONFIG="$c" && break
    done
    sec "agent: detection"
    if [[ -n "$AGENT_CONFIG" ]]; then
        echo "config: $AGENT_CONFIG" >> "$BUNDLE"
    else
        echo "(no agent config.toml found — panel-only host, skipping agent detail)" >> "$BUNDLE"
    fi
    if [[ -n "$AGENT_CONFIG" ]]; then
        sec "agent: config.toml (REDACTED)"
        # NOTE: replacement has no quotes so the generic secret filter below
        # stays idempotent (it would otherwise eat the opening quote).
        if [[ -r "$AGENT_CONFIG" ]]; then
            sed -E -e 's/^([[:space:]]*(api_key|token|secret)[[:space:]]*=[[:space:]]*).*/\1[REDACTED]/i' "$AGENT_CONFIG" | filter >> "$BUNDLE" || echo "(could not read $AGENT_CONFIG)" >> "$BUNDLE"
        elif command -v sudo >/dev/null 2>&1 && sudo -n cat "$AGENT_CONFIG" 2>/dev/null | grep -q .; then
            sudo -n cat "$AGENT_CONFIG" | sed -E -e 's/^([[:space:]]*(api_key|token|secret)[[:space:]]*=[[:space:]]*).*/\1[REDACTED]/i' | filter >> "$BUNDLE"
        else
            echo "(cannot read $AGENT_CONFIG — re-run with sudo to include the agent section)" >> "$BUNDLE"
        fi
        collect "agent: binary version" catalyst-agent --version
        collect "agent: systemd status" systemctl status catalyst-agent --no-pager
        collect "agent: journal (last $LINES)" journalctl -u catalyst-agent -n "$LINES" --no-pager
        collect "agent: containerd status" systemctl status containerd --no-pager
        collect "agent: containerd socket" ls -la /run/containerd/containerd.sock
        collect "agent: CNI plugins" bash -c 'ls -la /opt/cni/bin/ 2>&1 | head -20; echo ---; ls /var/lib/cni/results/ 2>/dev/null | head -10'
        collect "agent: kernel bits (ip_forward, loop)" bash -c 'sysctl net.ipv4.ip_forward 2>&1; lsmod 2>/dev/null | grep -i loop || echo "(loop module: not listed)"'
        collect "agent: data dir" bash -c 'df -h /var/lib/catalyst 2>&1; ls /var/lib/catalyst 2>&1 | head -20'
        collect "agent: containers" bash -c 'ctr -n catalyst containers ls 2>&1 | head -20; echo ---; ctr -n catalyst tasks ls 2>&1 | head -20'
    fi
else
    sec "agent: skipped (--skip-agent)"
fi

if $FULL; then
    collect "full: backend inspect" bash -c '"$0" inspect catalyst-backend 2>&1 | head -100 || true' "$RUNTIME_CMD"
    collect "full: postgres inspect (env stripped)" bash -c '"$0" inspect catalyst-postgres 2>/dev/null | grep -v -i -E "password|secret|token" | head -80 || true' "$RUNTIME_CMD"
fi

rm -f "$OUT_DIR/.raw.tmp"

# ── Package ───────────────────────────────────────────────────────────────
TARBALL="${OUT_PARENT}/catalyst-diagnostics-${TIMESTAMP}.tar.gz"
tar -czf "$TARBALL" -C "$OUT_PARENT" "catalyst-diagnostics-${TIMESTAMP}/catalyst-diagnostics-${TIMESTAMP}.txt" 2>/dev/null || \
tar -czf "$TARBALL" -C "$OUT_DIR" "catalyst-diagnostics-${TIMESTAMP}.txt"

LINES_TOTAL="$(wc -l < "$BUNDLE")"
SIZE="$(du -h "$BUNDLE" | cut -f1)"

echo ""
ok "Bundle: $BUNDLE"
ok "Archive: $TARBALL  (${SIZE}, ${LINES_TOTAL} lines)"
echo ""
echo -e "  ${BLD}Before sharing:${RST} quickly scan for anything private:"
echo -e "    ${CYN}grep -i -E 'token|password|secret|BEGIN.*PRIVATE' \"$BUNDLE\" | head${RST}"
echo ""
echo -e "  ${BLD}Share with support / your AI agent:${RST}"
echo -e "    - Paste ${CYN}$(basename "$BUNDLE")${RST} (or attach ${CYN}$(basename "$TARBALL")${RST})"
echo -e "    - Describe: what you did, what you expected, what happened instead"
echo -e "    - Panel URL shape only if relevant (http/https + port, e.g. http://<host>:8080)"
echo ""
