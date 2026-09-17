#!/usr/bin/env bash
# ============================================================
# Catalyst — Docker Install Script
# Platform: Linux (Ubuntu/Debian, RHEL/CentOS, Fedora, Arch, Alpine, openSUSE)
# Usage:    bash install.sh [-y] [--dry-run] [--uninstall] [--help]
# ============================================================
set -euo pipefail
umask 077

# Pinned release metadata for verified installs (see "Versioned install" note
# in the Installation guide on docs.catalystctl.com). Release artifacts
# publish install.sh + .sha256; always verify before executing.
#   INSTALL_VERSION — git ref the catalyst-docker tree is downloaded from
#                     ("main" tracks the branch; a release tag like v1.60.1
#                     pins the stack files to that release).
#   INSTALL_SHA256  — expected SHA-256 of install.sh itself. When set, the
#                     script verifies its own checksum at startup and aborts
#                     on mismatch (accepts the raw hex or the content of the
#                     published install.sh.sha256 file).
INSTALL_VERSION="${INSTALL_VERSION:-main}"
INSTALL_SHA256="${INSTALL_SHA256:-}"

# Full fingerprint of Docker's official release key (Docker Release CE deb).
# Verified 2026-09-10 via `gpg --show-keys download.docker.com/linux/*/gpg`.
# Install snippets below compare this BEFORE dearmoring; a mismatch aborts.
# Used inside the heredoc install snippets below (shellcheck SC2034 N/A).
# shellcheck disable=SC2034
DOCKER_GPG_FINGERPRINT="9DC858229FC7DD38854AE2D88D81803C0EBFCD88"

REPO="catalystctl/catalyst"
BRANCH="main"
TARGET_DIR="catalyst-docker"
NON_INTERACTIVE=false
DRY_RUN=false
FORCE_RECONFIGURE=false
MODE="${MODE:-install}"
# Ordered "KEY=VALUE" .env overrides from --env-file / --set (later wins).
USER_SETS=()
ENV_FILE=""

# ── Parse arguments ──────────────────────────────────────────────────────────
usage() {
    echo "Usage: bash install.sh [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -y, --yes, --non-interactive   Accept all defaults / use env var overrides"
    echo "  --dry-run                      Show what would be done without making changes"
    echo "  --uninstall                    Remove the Catalyst Docker stack"
    echo "  --update                       Update stack files in ./catalyst-docker (keeps .env)"
    echo "  --reconfigure                  Re-run the .env configuration prompts"
    echo "  --set KEY=VALUE                Set a .env variable (repeatable; applied on"
    echo "                                 top of prompts/defaults, wins over the environment)"
    echo "  --env-file FILE                Read KEY=VALUE overrides from FILE (applied"
    echo "                                 before --set, so --set wins)"
    echo "  -h, --help                     Show this help"
    echo ""
    echo "Environment overrides (used with -y, or as prompt defaults):"
    echo "  PUBLIC_URL=       Panel URL (e.g. http://192.168.1.100:8080)"
    echo "  APP_NAME=         Panel name (default: Catalyst)"
    echo "  REMOVE_VOLUMES=1  With --uninstall -y, also delete compose volumes"
    echo "  INSTALL_VERSION=  Git ref for the stack files (default: main; a release"
    echo "                    tag like v1.60.1 pins catalyst-docker to that release)"
    echo "  INSTALL_SHA256=   Expected SHA-256 of install.sh itself — the script"
    echo "                    verifies its own checksum and aborts on mismatch"
}

# True for a KEY we allow writing into .env (UPPER_SNAKE_CASE, no metacharacters).
is_valid_env_key() {
    [[ "$1" =~ ^[A-Z_][A-Z0-9_]*$ ]]
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        -y|--yes|--non-interactive)
            NON_INTERACTIVE=true
            shift
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --uninstall)
            MODE=uninstall
            shift
            ;;
        --update)
            MODE=update
            shift
            ;;
        --reconfigure)
            FORCE_RECONFIGURE=true
            shift
            ;;
        --set)
            if [[ "${2:-}" != *=* || -z "${2%%=*}" ]]; then
                echo "--set expects KEY=VALUE (got '${2:-}')" >&2
                exit 1
            fi
            USER_SETS+=("$2")
            shift 2
            ;;
        --set=*)
            SET_ARG="${1#--set=}"
            if [[ "$SET_ARG" != *=* || -z "${SET_ARG%%=*}" ]]; then
                echo "--set expects KEY=VALUE (got '$SET_ARG')" >&2
                exit 1
            fi
            USER_SETS+=("$SET_ARG")
            shift
            ;;
        --env-file)
            ENV_FILE="${2:?--env-file needs a path}"
            shift 2
            ;;
        --env-file=*)
            ENV_FILE="${1#--env-file=}"
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown argument: $1" >&2
            exit 1
            ;;
    esac
done

# ── --env-file: load KEY=VALUE lines before --set entries so --set wins ──────
if [[ -n "$ENV_FILE" ]]; then
    if [[ ! -f "$ENV_FILE" ]]; then
        echo "env-file not found: $ENV_FILE" >&2
        exit 1
    fi
    FILE_SETS=()
    while IFS= read -r env_line || [[ -n "$env_line" ]]; do
        env_line="${env_line%$'\r'}"
        [[ -z "${env_line//[[:space:]]/}" ]] && continue
        [[ "$env_line" == \#* ]] && continue
        # ltrim + optional "export " prefix
        env_line="${env_line#"${env_line%%[![:space:]]*}"}"
        env_line="${env_line#export }"
        if [[ "$env_line" != *=* ]]; then
            echo "${ENV_FILE}: not a KEY=VALUE line: ${env_line}" >&2
            exit 1
        fi
        env_key="${env_line%%=*}"
        env_val="${env_line#*=}"
        # Strip one pair of matching surrounding quotes, if present
        if [[ ${#env_val} -ge 2 ]]; then
            env_q="${env_val:0:1}"
            if [[ "$env_q" == '"' && "${env_val: -1}" == '"' ]] || \
               [[ "$env_q" == "'" && "${env_val: -1}" == "'" ]]; then
                env_val="${env_val:1:${#env_val}-2}"
            fi
        fi
        if ! is_valid_env_key "$env_key"; then
            echo "${ENV_FILE}: invalid key (must be UPPER_SNAKE_CASE): ${env_key}" >&2
            exit 1
        fi
        FILE_SETS+=("${env_key}=${env_val}")
    done < "$ENV_FILE"
    if [[ ${#FILE_SETS[@]} -gt 0 ]]; then
        USER_SETS=("${FILE_SETS[@]}" "${USER_SETS[@]}")
    fi
fi

for set_entry in "${USER_SETS[@]}"; do
    if ! is_valid_env_key "${set_entry%%=*}"; then
        echo "Invalid --set key: ${set_entry%%=*} (must be UPPER_SNAKE_CASE)" >&2
        exit 1
    fi
done

# ── Colors (graceful fallback when piped / no terminal) ─────────────────────
if [ -t 1 ]; then
    RED='\033[0;31m'; GRN='\033[0;32m'; YLW='\033[1;33m'
    CYN='\033[0;36m'; BLD='\033[1m';    DIM='\033[2m'; RST='\033[0m'
else
    RED=''; GRN=''; YLW=''; CYN=''; BLD=''; DIM=''; RST=''
fi

ok()   { echo -e "  ${GRN}✓${RST} $*"; }
err()  { echo -e "  ${RED}✗${RST} $*" >&2; }
info() { echo -e "  ${CYN}ℹ${RST} $*"; }
warn() { echo -e "  ${YLW}⚠${RST} $*"; }
step() { echo -e "\n${BLD}${CYN}  ── $1 ──${RST}"; }

# ── Logging ───────────────────────────────────────────────────────────────────
LOGFILE="/tmp/catalyst-install-$(date +%Y%m%d-%H%M%S).log"
log()  { echo "[$(date +%H:%M:%S)] $*" >> "$LOGFILE"; }

run() {
    log "Running: $*"
    if $DRY_RUN; then
        info "[dry-run] $*"; return 0
    fi
    "$@" >> "$LOGFILE" 2>&1
}

# ── Verified install: self-check install.sh against INSTALL_SHA256 ───────────
# Optional, but closes the loop on the documented release flow: the user
# downloads install.sh + install.sh.sha256, and can export INSTALL_SHA256 to
# make the script verify itself (instead of trusting a manual sha256sum -c).
# Accepts raw hex or the full "<hex>  install.sh" line from the .sha256 file.
if [[ -n "$INSTALL_SHA256" ]]; then
    EXPECTED_SUM="$(awk '{print $1}' <<<"$INSTALL_SHA256" | tr -d '[:space:]' | tr 'A-F' 'a-f')"
    ACTUAL_SUM=""
    if command -v sha256sum &>/dev/null; then
        ACTUAL_SUM="$(sha256sum -- "$0" 2>/dev/null | awk '{print $1}' || true)"
    elif command -v openssl &>/dev/null; then
        ACTUAL_SUM="$(openssl dgst -r -sha256 -- "$0" 2>/dev/null | awk '{print $1}' || true)"
    fi
    if [[ -z "$ACTUAL_SUM" || "$ACTUAL_SUM" != "$EXPECTED_SUM" ]]; then
        echo "install.sh checksum mismatch (INSTALL_SHA256)" >&2
        echo "  expected: ${EXPECTED_SUM}" >&2
        echo "  actual:   ${ACTUAL_SUM:-<unavailable>}" >&2
        echo "  Re-download install.sh + install.sh.sha256 from the release assets" >&2
        echo "  and verify with: sha256sum -c install.sh.sha256" >&2
        exit 1
    fi
    echo "  ✓ install.sh checksum verified (INSTALL_SHA256)"
fi

# ── Cleanup ───────────────────────────────────────────────────────────────────
WORK_DIR=""
STAGING_ENV=""   # set during phase_configure — staging file for atomic .env write

cleanup() {
    rm -rf "${WORK_DIR:-/tmp/catalyst-noop}"
    # If a staging .env was left behind (interrupted before commit),
    # remove it so the next run doesn't see a half-written .env
    if [[ -n "${STAGING_ENV:-}" && -f "$STAGING_ENV" ]]; then
        rm -f "$STAGING_ENV"
    fi
}
trap cleanup EXIT

# ── SIGINT trap (Ctrl+C) ─────────────────────────────────────────────────────
on_interrupt() {
    echo ""
    warn "Interrupted — cleaning up partial state..."
    # Remove any staging file (cleanup trap handles this too)
    if [[ -n "${STAGING_ENV:-}" && -f "$STAGING_ENV" ]]; then
        rm -f "$STAGING_ENV"
    fi
    # If the real .env was already committed but looks incomplete,
    # mark it so the next run offers to reconfigure
    if [[ -n "${DEST:-}" && -f "${DEST}/.env" ]] && is_env_incomplete "${DEST}/.env"; then
        echo "# CATALYST_SETUP_INCOMPLETE=1" >> "${DEST}/.env"
        warn "Configuration was not completed. Re-run to continue."
    fi
    exit 130
}
trap on_interrupt INT

# ── Error trap ────────────────────────────────────────────────────────────────
on_error() {
    echo ""
    err "Installation failed at line $1"
    warn "Log: ${LOGFILE}"
    echo ""
    exit 1
}
trap 'on_error $LINENO' ERR

# ── Prompt helpers ────────────────────────────────────────────────────────────
# ask VAR_NAME "prompt text" "default value"
# Reads from env var first, then interactive prompt, then default.
# In non-interactive mode, uses env var or default (no prompt).
ask() {
    local var_name="$1"
    local prompt_text="$2"
    local default_val="$3"

    # If the variable is already set in the environment, use it
    if [[ -n "${!var_name:-}" ]]; then
        local env_val="${!var_name}"
        printf -v "$var_name" '%s' "$env_val"
        ok "${var_name}=${env_val}  (from environment)"
        return
    fi

    if [[ "$NON_INTERACTIVE" == "true" ]]; then
        printf -v "$var_name" '%s' "$default_val"
        info "${var_name}=${default_val}  (default, non-interactive)"
        return
    fi

    # Interactive prompt
    local answer
    if [[ -n "$default_val" ]]; then
        echo -en "\n  ${BLD}?${RST} ${prompt_text} ${DIM}[${default_val}]${RST}: "
    else
        echo -en "\n  ${BLD}?${RST} ${prompt_text}: "
    fi
    read -r answer </dev/tty
    # Use default if empty
    if [[ -z "$answer" ]]; then
        answer="$default_val"
    fi
    printf -v "$var_name" '%s' "$answer"
}

confirm() {
    # confirm "Question" → returns 0 (yes) or 1 (no)
    echo -en "\n  ${BLD}?${RST} $1 ${DIM}[y/N]${RST}: "
    read -r ans </dev/tty
    [[ "${ans,,}" == "y" || "${ans,,}" == "yes" ]]
}

# ── --set / --env-file helpers ────────────────────────────────────────────────
# Value of KEY from USER_SETS (later entries win; empty string when absent).
user_set_value() {
    local key="$1" entry v=""
    for entry in "${USER_SETS[@]}"; do
        [[ "${entry%%=*}" == "$key" ]] && v="${entry#*=}"
    done
    printf '%s' "$v"
}

user_set_has() {
    [[ -n "$(user_set_value "$1")" ]]
}

# Print "***" for values that look like secrets, so dry-run output and logs
# never echo a credential that was passed via --set / --env-file.
mask_secret_value() {
    case "$1" in
        *PASSWORD|*SECRET|*KEY|*TOKEN) echo "***" ;;
        *) printf '%s' "$2" ;;
    esac
}

# Effective value for a host-port setting: --set/--env-file > environment >
# compose default. Used by the port pre-flight so it checks the port the user
# actually asked for, not just the default.
preflight_port() {
    local key="$1" default="$2" v
    v="$(user_set_value "$key")"
    [[ -z "$v" ]] && v="${!key:-}"
    [[ -z "$v" ]] && v="$default"
    printf '%s' "$v"
}

# ── Extract hostname from URL (for PASSKEY_RP_ID) ────────────────────────────
# Strips scheme and port: "https://panel.example.com:8080" → "panel.example.com"
extract_hostname() {
    local url="$1"
    url="${url#http://}"; url="${url#https://}"
    url="${url%%/*}"; url="${url%%:*}"
    echo "$url"
}

# ── Distro detection ─────────────────────────────────────────────────────────

detect_distro() {
    if [[ -f /etc/os-release ]]; then
        # shellcheck disable=SC1091
        . /etc/os-release
        echo "${ID:-unknown}"
        return
    fi
    if [[ -f /etc/debian_version ]]; then echo "debian"; return; fi
    if [[ -f /etc/ubuntu-release ]] || [[ -f /etc/lsb-release ]]; then echo "ubuntu"; return; fi
    if [[ -f /etc/redhat-release ]]; then
        if grep -qi "centos" /etc/redhat-release 2>/dev/null; then echo "centos"; return; fi
        if grep -qi "fedora" /etc/redhat-release 2>/dev/null; then echo "fedora"; return; fi
        echo "rhel"; return
    fi
    if [[ -f /etc/alpine-release ]]; then echo "alpine"; return; fi
    if [[ -f /etc/arch-release ]]; then echo "arch"; return; fi
    if [[ -f /etc/SuSE-release ]] || [[ -f /etc/openSUSE-release ]]; then echo "opensuse"; return; fi
    echo "unknown"
}

detect_distro_pretty() {
    if [[ -f /etc/os-release ]]; then
        # shellcheck disable=SC1091
        . /etc/os-release
        echo "${PRETTY_NAME:-${NAME:-Linux}}"
        return
    fi
    echo "Linux"
}

get_docker_install_commands() {
    local distro="$1"
    case "$distro" in
        ubuntu|pop|linuxmint|elementary|neon|zorin)
            cat <<'INSTALL'
# Remove conflicting packages
for pkg in docker.io docker-doc docker-compose docker-compose-v2 podman-docker containerd runc; do
    sudo apt-get remove -y $pkg 2>/dev/null || true
done

# Add Docker's official GPG key (fingerprint-checked before dearmor)
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /tmp/docker.gpg
gpg --show-keys /tmp/docker.gpg | grep -q "9DC858229FC7DD38854AE2D88D81803C0EBFCD88" || { echo "Docker GPG fingerprint mismatch — aborting" >&2; exit 1; }
sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg /tmp/docker.gpg
rm -f /tmp/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# Add the Docker repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker Engine + Compose plugin
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Add current user to the docker group
sudo usermod -aG docker $USER
INSTALL
            ;;
        debian|kali|parrot|devuan)
            cat <<'INSTALL'
# Remove conflicting packages
for pkg in docker.io docker-doc docker-compose docker-compose-v2 podman-docker containerd runc; do
    sudo apt-get remove -y $pkg 2>/dev/null || true
done

# Add Docker's official GPG key (fingerprint-checked before dearmor)
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /tmp/docker.gpg
gpg --show-keys /tmp/docker.gpg | grep -q "9DC858229FC7DD38854AE2D88D81803C0EBFCD88" || { echo "Docker GPG fingerprint mismatch — aborting" >&2; exit 1; }
sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg /tmp/docker.gpg
rm -f /tmp/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# Add the Docker repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker Engine + Compose plugin
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Add current user to the docker group
sudo usermod -aG docker $USER
INSTALL
            ;;
        centos|rhel|rocky|almalinux|ol)
            cat <<'INSTALL'
# Remove conflicting packages
sudo dnf remove -y docker docker-client docker-client-latest docker-common \
    docker-latest docker-latest-logrotate docker-logrotate docker-engine \
    podman-docker runc 2>/dev/null || true

# Add Docker repository
sudo dnf install -y dnf-plugins-core
sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo

# Install Docker Engine + Compose plugin
sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Start and enable Docker
sudo systemctl start docker
sudo systemctl enable docker

# Add current user to the docker group
sudo usermod -aG docker $USER
INSTALL
            ;;
        fedora)
            cat <<'INSTALL'
# Remove conflicting packages
sudo dnf remove -y docker docker-client docker-client-latest docker-common \
    docker-latest docker-latest-logrotate docker-logrotate docker-engine \
    podman-docker runc 2>/dev/null || true

# Add Docker repository
sudo dnf install -y dnf-plugins-core
sudo dnf config-manager --add-repo https://download.docker.com/linux/fedora/docker-ce.repo

# Install Docker Engine + Compose plugin
sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Start and enable Docker
sudo systemctl start docker
sudo systemctl enable docker

# Add current user to the docker group
sudo usermod -aG docker $USER
INSTALL
            ;;
        opensuse-tumbleweed|opensuse-leap|opensuse|sles)
            cat <<'INSTALL'
# Install Docker from openSUSE repositories
sudo zypper install -y docker docker-compose zypper-plugins-docker

# Start and enable Docker
sudo systemctl start docker
sudo systemctl enable docker

# Add current user to the docker group
sudo usermod -aG docker $USER
INSTALL
            ;;
        alpine)
            cat <<'INSTALL'
# Install Docker
sudo apk add docker docker-cli-compose

# Start and enable Docker
sudo rc-update add docker boot
sudo service docker start

# Add current user to the docker group
sudo addgroup $USER docker
INSTALL
            ;;
        arch|manjaro|endeavouros|garuda)
            cat <<'INSTALL'
# Install Docker
sudo pacman -Sy --noconfirm docker docker-compose

# Start and enable Docker
sudo systemctl start docker
sudo systemctl enable docker

# Add current user to the docker group
sudo usermod -aG docker $USER
INSTALL
            ;;
        *)
            # Unsupported distro — return empty
            ;;
    esac
}

# ── Check if .env looks incomplete ───────────────────────────────────────────
# Returns 0 (true) if the .env appears to be from an interrupted setup.
#
# IMPORTANT: A completed install that keeps the default PUBLIC_URL
# (http://localhost:8080) is NOT incomplete. Treating it as incomplete caused
# re-runs (especially with -y) to regenerate POSTGRES_PASSWORD while the
# existing Postgres volume still held the old password → Prisma P1000
# "password authentication failed for user catalyst".
is_env_incomplete() {
    local env_file="$1"

    # Explicit marker left by SIGINT trap or a previous interrupted run
    if grep -q "^# CATALYST_SETUP_INCOMPLETE=" "$env_file" 2>/dev/null; then
        return 0
    fi

    # Mixed secret state: one required secret written, the other still a
    # placeholder — only happens with a half-written .env (pre-staging or crash).
    local pg_pass auth_secret
    pg_pass=$(grep "^POSTGRES_PASSWORD=" "$env_file" 2>/dev/null | cut -d= -f2- || echo "")
    auth_secret=$(grep "^BETTER_AUTH_SECRET=" "$env_file" 2>/dev/null | cut -d= -f2- || echo "")

    local pg_placeholder=false auth_placeholder=false
    if [[ -z "$pg_pass" || "$pg_pass" == CHANGE_ME* ]]; then
        pg_placeholder=true
    fi
    if [[ -z "$auth_secret" || "$auth_secret" == CHANGE_ME* ]]; then
        auth_placeholder=true
    fi

    if $pg_placeholder && ! $auth_placeholder; then
        return 0
    fi
    if ! $pg_placeholder && $auth_placeholder; then
        return 0
    fi

    return 1
}

# Read a KEY=value from an env file (value may contain '=').
env_get() {
    local env_file="$1" key="$2"
    grep "^${key}=" "$env_file" 2>/dev/null | head -n1 | cut -d= -f2- || true
}

# True when value is empty or still a CHANGE_ME* placeholder.
is_placeholder_secret() {
    local val="${1:-}"
    [[ -z "$val" || "$val" == CHANGE_ME* ]]
}

# Set KEY=value in an env file without sed replacement pitfalls (values may
# contain &, ~, |, backslashes). Rewrites via awk with the value passed in
# the environment, so no metacharacter in the value is ever interpreted.
# Uncommented matching lines are replaced; commented "# KEY=" lines are
# replaced only when no active KEY= line exists; otherwise KEY is appended.
env_set() {
    local env_file="$1" key="$2" value="${3:-}"
    ENV_SET_KEY="$key" ENV_SET_VAL="$value" awk '
        BEGIN { active_done = 0 }
        {
            line = $0
            stripped = line
            sub(/^[ \t]+/, "", stripped)
            if (stripped ~ "^"ENVIRON["ENV_SET_KEY"]"=") {
                if (active_done == 0) {
                    print ENVIRON["ENV_SET_KEY"]"="ENVIRON["ENV_SET_VAL"]
                    active_done = 1
                }
                next
            }
            if (stripped ~ "^#[ \t]*"ENVIRON["ENV_SET_KEY"]"=") {
                if (pending_comment == "") { pending_comment = line }
                next
            }
            print line
        }
        END {
            # Re-check: awk cannot easily look ahead, so handle the
            # commented-only case with a second pass marker via exit code.
            if (active_done == 0) { exit 3 }
        }
    ' "$env_file" > "${env_file}.new" || {
        local rc=$?
        if [[ $rc -eq 3 ]]; then
            # No active KEY= line: uncomment the first "# KEY=" match if any,
            # else append.
            if grep -q "^#[ \t]*${key}=" "$env_file"; then
                ENV_SET_KEY="$key" ENV_SET_VAL="$value" awk '
                    BEGIN { done = 0 }
                    {
                        tmp = $0
                        sub(/^[ \t]+/, "", tmp)
                        if (done == 0 && tmp ~ "^#[ \t]*"ENVIRON["ENV_SET_KEY"]"=") {
                            print ENVIRON["ENV_SET_KEY"]"="ENVIRON["ENV_SET_VAL"]
                            done = 1
                        } else { print $0 }
                    }
                ' "$env_file" > "${env_file}.new"
            else
                cat "$env_file" > "${env_file}.new"
                printf '%s=%s\n' "$key" "$value" >> "${env_file}.new"
            fi
        else
            rm -f "${env_file}.new"
            return $rc
        fi
    }
    # Drop any leftover commented "# KEY=" duplicates after an active set.
    if grep -q "^${key}=" "${env_file}.new" 2>/dev/null; then
        grep -v "^#[ \t]*${key}=" "${env_file}.new" > "${env_file}.new2" && mv "${env_file}.new2" "${env_file}.new"
    fi
    cat "${env_file}.new" > "$env_file"
    rm -f "${env_file}.new"
    chmod 600 "$env_file" 2>/dev/null || true
}

# ── State ─────────────────────────────────────────────────────────────────────
RUNTIME_CMD=""
COMPOSE_CMD=""
DETECTED_DISTRO=$(detect_distro)
DETECTED_DISTRO_PRETTY=$(detect_distro_pretty)
DEST=""   # set later after download

# ══════════════════════════════════════════════════════════════════════════════
# PHASES
# ══════════════════════════════════════════════════════════════════════════════

# ── Banner ────────────────────────────────────────────────────────────────────
print_banner() {
    echo ""
    echo -e "${CYN}"
    cat << 'BANNER'
  ╔══════════════════════════════════════════╗
  ║          Catalyst Panel Setup           ║
  ║        Game Server Management           ║
  ╚══════════════════════════════════════════╝
BANNER
    echo -e "${RST}"
    echo -e "  ${BLD}Docker Install Script${RST}  ${DIM}(${DETECTED_DISTRO_PRETTY})${RST}"
    echo -e "  $(printf '─%.0s' {1..44})"
    $DRY_RUN && warn "DRY-RUN MODE — no changes will be made"
    $NON_INTERACTIVE && info "Non-interactive mode (using defaults / env vars)"
    echo ""
    log "Install started — distro=${DETECTED_DISTRO}, pretty=${DETECTED_DISTRO_PRETTY}"
}

# ── Phase 1: Check container runtime & Compose ───────────────────────────────
phase_check_runtime() {
    step "Checking container runtime & Compose"

    if command -v docker &>/dev/null; then
        DOCKER_VERSION=$(docker version --format '{{.Server.Version}}' 2>/dev/null || docker -v | sed -n 's/.*version \([^,]*\).*/\1/p')
        RUNTIME_CMD="docker"
        ok "Docker ${DOCKER_VERSION}"

        if ! docker info &>/dev/null; then
            err "Docker daemon is not running"
            echo -e "  ${DIM}Start with: sudo systemctl start docker${RST}"
            exit 1
        fi

        if docker compose version &>/dev/null; then
            COMPOSE_VERSION=$(docker compose version | sed -n 's/.*version \([^,]*\).*/\1/p')
            COMPOSE_CMD="docker compose"
            ok "Docker Compose ${COMPOSE_VERSION}"
        elif command -v docker-compose &>/dev/null; then
            COMPOSE_VERSION=$(docker-compose --version | sed -n 's/.*version \([^,]*\).*/\1/p')
            COMPOSE_CMD="docker-compose"
            warn "Standalone docker-compose (v${COMPOSE_VERSION}) — V2 plugin recommended"
        fi
    fi

    # Try Podman if no Compose found via Docker
    if [[ -z "$COMPOSE_CMD" ]] && command -v podman &>/dev/null; then
        PODMAN_VERSION=$(podman version --format '{{.Version}}' 2>/dev/null || podman -v | sed -n 's/.*version \([^,]*\).*/\1/p')
        if [[ -z "$RUNTIME_CMD" ]]; then
            RUNTIME_CMD="podman"
            ok "Podman ${PODMAN_VERSION}"

            if ! podman info &>/dev/null; then
                err "Podman is not running"
                echo -e "  ${DIM}systemctl --user start podman  (rootless)${RST}"
                echo -e "  ${DIM}sudo systemctl start podman   (rootful)${RST}"
                exit 1
            fi
        fi

        if podman compose version &>/dev/null; then
            COMPOSE_VERSION=$(podman compose version | sed -n 's/.*version \([^,]*\).*/\1/p')
            COMPOSE_CMD="podman compose"
            ok "Podman Compose ${COMPOSE_VERSION}"
        fi
    fi

    # Podman caveats: the compose file bind-mounts /var/run/docker.sock (used
    # by the panel's server management + Update button), which only exists
    # under Podman when podman-docker's compatibility socket is enabled.
    # Rootless Podman also cannot bind host ports below 1024 (the default
    # FRONTEND_PORT=8080 and loopback-bound service ports are fine).
    if [[ "$RUNTIME_CMD" == "podman" ]]; then
        warn "Podman detected — the backend expects a Docker-compatible socket at /var/run/docker.sock"
        echo -e "  ${DIM}Enable the podman-docker compatibility socket (or run rootful Podman).${RST}"
        echo -e "  ${DIM}Rootless Podman cannot bind ports below 1024 — defaults (8080) are safe.${RST}"
    fi
}

# ── Phase 2: Install Docker if missing ───────────────────────────────────────
phase_install_docker() {
    if [[ -n "$RUNTIME_CMD" ]]; then
        return 0  # Already have a runtime
    fi

    err "No container runtime found (tried docker, podman)"
    echo ""

    DOCKER_INSTALL_CMDS=$(get_docker_install_commands "$DETECTED_DISTRO")

    if [[ -n "$DOCKER_INSTALL_CMDS" && "$NON_INTERACTIVE" != "true" ]]; then
        echo -e "  ${BLD}Detected:${RST} ${DETECTED_DISTRO_PRETTY}"
        echo ""
        echo -e "  ${BLD}This script can install Docker Engine (including Compose) for you.${RST}"
        echo -e "  The following commands will be run with ${YLW}sudo${RST}:"
        echo ""
        echo "$DOCKER_INSTALL_CMDS" | sed 's/^/    /'
        echo ""
        warn "This installs packages from Docker's official repository."
        warn "After install, you may need to log out/in for the 'docker' group to take effect."

        if confirm "Install Docker now?"; then
            echo ""
            if $DRY_RUN; then
                info "[dry-run] Would install Docker"
                return 0
            fi
            # The snippets above call sudo unconditionally. Running as root
            # without sudo installed (minimal VPS images) would spray
            # "sudo: command not found" through the whole snippet; a non-root
            # user without sudo cannot proceed at all.
            if [[ ${EUID} -ne 0 ]] && ! command -v sudo &>/dev/null; then
                err "sudo is not installed and you are not root — cannot install Docker automatically"
                echo -e "  ${DIM}Install sudo (or re-run as root), or install Docker manually:${RST}"
                echo -e "  ${CYN}https://docs.docker.com/engine/install/${RST}"
                exit 1
            fi
            if [[ ${EUID} -eq 0 ]] && ! command -v sudo &>/dev/null; then
                DOCKER_INSTALL_CMDS="$(sed -e 's/^sudo //' -e 's/^\([[:space:]]*\)sudo /\1/' <<<"$DOCKER_INSTALL_CMDS")"
            fi
            info "Installing Docker..."
            log "Installing Docker for ${DETECTED_DISTRO}"
            echo "$DOCKER_INSTALL_CMDS" | bash

            if command -v docker &>/dev/null; then
                DOCKER_VERSION=$(docker version --format '{{.Server.Version}}' 2>/dev/null || docker -v | sed -n 's/.*version \([^,]*\).*/\1/p')
                RUNTIME_CMD="docker"
                ok "Docker ${DOCKER_VERSION} installed"

                if docker compose version &>/dev/null; then
                    COMPOSE_VERSION=$(docker compose version | sed -n 's/.*version \([^,]*\).*/\1/p')
                    COMPOSE_CMD="docker compose"
                    ok "Docker Compose ${COMPOSE_VERSION}"
                fi

                # Try to start the daemon if not running
                if ! docker info &>/dev/null; then
                    info "Starting Docker daemon..."
                    if [[ ${EUID} -eq 0 ]] && ! command -v sudo &>/dev/null; then
                        systemctl start docker 2>/dev/null || service docker start 2>/dev/null || true
                    else
                        sudo systemctl start docker 2>/dev/null || sudo service docker start 2>/dev/null || true
                    fi
                    sleep 2
                    if ! docker info &>/dev/null; then
                        err "Docker daemon still not reachable"
                        echo -e "  ${DIM}Start manually: sudo systemctl start docker${RST}"
                        echo -e "  ${DIM}Then re-run this script.${RST}"
                        exit 1
                    fi
                fi

                ok "Docker is ready"
            else
                err "Docker installed but 'docker' command not found"
                echo -e "  ${DIM}You may need to log out and back in for the docker group.${RST}"
                echo -e "  ${DIM}Then re-run this script.${RST}"
                exit 1
            fi
        else
            echo ""
            echo -e "  ${BLD}To install Docker manually:${RST}"
            echo -e "  Copy and paste the commands shown above, or follow:"
            echo -e "  ${CYN}https://docs.docker.com/engine/install/${RST}"
            echo ""
            echo "  After installing, re-run this script."
            exit 1
        fi
    else
        # Non-interactive or unsupported distro
        if [[ -n "$DOCKER_INSTALL_CMDS" ]]; then
            echo -e "  ${BLD}Detected:${RST} ${DETECTED_DISTRO_PRETTY}"
        fi
        echo ""
        echo -e "  ${BLD}Install Docker or Podman before continuing:${RST}"
        echo -e "  ${CYN}https://docs.docker.com/engine/install/${RST}"
        echo -e "  ${CYN}https://podman.io/getting-started/installation${RST}"
        if [[ "$NON_INTERACTIVE" == "true" ]]; then
            echo ""
            warn "Run interactively (without -y) to get an automatic Docker install option."
        fi
        echo ""
        echo "  After installing, re-run this script."
        exit 1
    fi
}

# ── Phase 3: Validate Compose ────────────────────────────────────────────────
phase_validate_compose() {
    if [[ -z "$COMPOSE_CMD" ]]; then
        err "Docker is installed but no Compose command was found"
        echo ""
        echo -e "  ${BLD}Install Docker Compose V2 plugin:${RST}"
        echo -e "    ${CYN}Ubuntu/Debian${RST}   sudo apt-get install docker-compose-plugin"
        echo -e "    ${CYN}CentOS/RHEL${RST}    sudo dnf install docker-compose-plugin"
        echo -e "    ${CYN}Fedora${RST}         sudo dnf install docker-compose-plugin"
        echo -e "    ${CYN}Arch${RST}           sudo pacman -S docker-compose"
        echo -e "    ${CYN}Alpine${RST}         sudo apk add docker-cli-compose"
        echo -e "    ${CYN}openSUSE${RST}       sudo zypper install docker-compose"
        echo ""
        echo -e "  ${CYN}Official guide:${RST} https://docs.docker.com/compose/install/"
        echo ""
        echo "  After installing, re-run this script."
        exit 1
    fi
}

# ── Phase 4: Check dependencies ──────────────────────────────────────────────
phase_check_deps() {
    step "Checking dependencies"
    local missing=()
    for cmd in curl tar openssl; do
        command -v "$cmd" &>/dev/null && ok "$cmd" || { err "$cmd not found"; missing+=("$cmd"); }
    done
    if [[ ${#missing[@]} -gt 0 ]]; then
        err "Missing: ${missing[*]}"
        info "Install them and re-run this script."
        exit 1
    fi
}

# ── Phase 4b: Pre-flight (warn-only; nothing here is fatal) ──────────────────
# Catches the failures that otherwise only surface later at `docker compose up`:
# a port already bound by another service, or a disk too small for the images.
phase_preflight() {
    step "Pre-flight checks"

    # Disk space — images + postgres data live on the target filesystem
    local avail_mb
    avail_mb=$(df -Pk "$PWD" 2>/dev/null | awk 'NR==2 {printf "%d", $4/1024}')
    if [[ -n "${avail_mb:-}" ]]; then
        if [[ "$avail_mb" -lt 5120 ]]; then
            warn "Only ${avail_mb} MB free under ${PWD} — images + database need several GB"
        else
            ok "Disk space OK (${avail_mb} MB free)"
        fi
    fi

    # Host-side ports: warn when something is already listening. A running
    # Catalyst stack on a re-install is legitimate, so this is advisory.
    local listeners=""
    if command -v ss &>/dev/null; then
        listeners=$(ss -ltn 2>/dev/null || true)
    elif command -v netstat &>/dev/null; then
        listeners=$(netstat -ltn 2>/dev/null || true)
    fi
    if [[ -n "$listeners" ]]; then
        local pair key raw port
        for pair in "FRONTEND_PORT:0.0.0.0:8080" "BACKEND_PORT:127.0.0.1:3000" "POSTGRES_PORT:127.0.0.1:5432" "REDIS_PORT:127.0.0.1:6379"; do
            key="${pair%%:*}"
            raw="$(preflight_port "$key" "${pair#*:}")"
            port="${raw##*:}"
            [[ "$port" =~ ^[0-9]+$ ]] || continue
            # Trailing non-digit guard so :8080 does not also match :80800
            if grep -qE "[:.]${port}([^0-9]|$)" <<<"$listeners"; then
                warn "Port ${port} (${key}) is already in use — stop that service or change ${key}"
            else
                ok "Port ${port} free (${key})"
            fi
        done
    else
        info "ss/netstat not available — skipping port checks"
    fi
}

# ── Phase 5: Download catalyst-docker ────────────────────────────────────────
phase_download() {
    step "Downloading ${TARGET_DIR}"

    # INSTALL_VERSION picks the git ref: "main" tracks the branch, anything
    # else (a release tag like v1.60.1) pins the stack files to that release
    # so a verified installer from release X installs stack X, not main HEAD.
    local ref_spec="refs/heads/${BRANCH}"
    local ref_name="${BRANCH}"
    if [[ "$INSTALL_VERSION" != "$BRANCH" ]]; then
        ref_spec="refs/tags/${INSTALL_VERSION}"
        ref_name="${INSTALL_VERSION}"
        info "Pinned install: using release ${INSTALL_VERSION} for stack files"
    fi

    local archive_url="https://github.com/${REPO}/archive/${ref_spec}.tar.gz"
    WORK_DIR=$(mktemp -d /tmp/catalyst-install.XXXXXX)

    if $DRY_RUN; then
        info "[dry-run] Would download from ${archive_url}"
        DEST="${PWD}/${TARGET_DIR}"
        return 0
    fi

    info "Fetching from ${REPO} (${ref_name})..."
    if ! curl -fsSL "$archive_url" -o "${WORK_DIR}/catalyst.tar.gz"; then
        err "Failed to download from GitHub"
        info "Check your internet connection and try again."
        exit 1
    fi
    ok "Download complete"

    info "Extracting..."
    tar -xzf "${WORK_DIR}/catalyst.tar.gz" -C "$WORK_DIR" --strip-components=1 "${REPO#*/}-${ref_name}/${TARGET_DIR}/"

    if [[ ! -d "${WORK_DIR}/${TARGET_DIR}" ]]; then
        err "Extraction failed — '${TARGET_DIR}' not found in archive"
        exit 1
    fi
    ok "Extraction complete"

    # Move into place — avoid overwriting an existing .env
    DEST="${PWD}/${TARGET_DIR}"
    if [[ -d "$DEST" ]]; then
        warn "'${TARGET_DIR}' already exists in ${PWD}"
        if [[ -f "${DEST}/.env" ]]; then
            # Preserve existing .env
            mv "${DEST}/.env" "${DEST}/.env.backup.$$"
            cp -r "${WORK_DIR}/${TARGET_DIR}/." "$DEST/" 2>/dev/null || true
            mv "${DEST}/.env.backup.$$" "${DEST}/.env"
            ok "Updated files (kept your existing .env)"
        else
            cp -r "${WORK_DIR}/${TARGET_DIR}/." "$DEST/"
            ok "Updated '${TARGET_DIR}' in ${PWD}"
        fi
    else
        mv "${WORK_DIR}/${TARGET_DIR}" "$DEST"
        ok "Created '${TARGET_DIR}' in ${PWD}"
    fi
}

# ── Phase 6: Configure .env ──────────────────────────────────────────────────
phase_configure() {
    step "Configuring environment"

    local env_exists=false
    local env_incomplete=false

    if [[ -f "${DEST}/.env" ]]; then
        env_exists=true
        if is_env_incomplete "${DEST}/.env"; then
            env_incomplete=true
        fi
    fi

    # When reconfiguring, keep a pointer to the previous .env so we can reuse
    # non-placeholder secrets. Postgres only applies POSTGRES_PASSWORD on the
    # FIRST init of the data volume — regenerating it against an existing
    # volume causes P1000 password authentication failures.
    local previous_env=""

    # ── Decide what to do with an existing .env ──────────────────────────
    if $env_exists && ! $env_incomplete && ! $FORCE_RECONFIGURE; then
        # Fully configured .env — just show a reminder
        warn ".env already exists and looks configured — skipping"
        echo ""
        echo -e "  ${DIM}To reconfigure: bash install.sh --reconfigure${RST}"
        echo -e "  ${DIM}To edit manually: nano ${DEST}/.env${RST}"
        return 0
    elif $env_exists && $env_incomplete; then
        # Interrupted previous run — offer to reconfigure
        warn "Previous setup was interrupted — .env is incomplete"
        if [[ "$NON_INTERACTIVE" == "true" ]] || confirm "Reconfigure .env now?"; then
            previous_env="${DEST}/.env.incomplete.$$"
            mv "${DEST}/.env" "$previous_env"
            info "Backed up incomplete .env to $(basename "$previous_env")"
        else
            info "Aborted. Edit manually: nano ${DEST}/.env"
            return 0
        fi
    elif $env_exists && $FORCE_RECONFIGURE; then
        # --reconfigure flag — back up and start fresh
        warn "Reconfigure requested — backing up existing .env"
        previous_env="${DEST}/.env.backup.$$"
        mv "${DEST}/.env" "$previous_env"
        info "Backed up to $(basename "$previous_env")"
    fi

    if $DRY_RUN; then
        info "[dry-run] Would create .env with generated secrets and prompted values"
        local dry_entry dry_key
        for dry_entry in "${USER_SETS[@]}"; do
            dry_key="${dry_entry%%=*}"
            info "[dry-run] Would set ${dry_key}=$(mask_secret_value "$dry_key" "${dry_entry#*=}")  (from --set/--env-file)"
        done
        return 0
    fi

    # ── Write to a STAGING file first, commit atomically at the end ─────
    # This way, if the user hits Ctrl+C during the interactive prompts,
    # the real .env is not left in a half-configured state.
    STAGING_ENV="${DEST}/.env.staging.$$"
    cp "${DEST}/.env.example" "$STAGING_ENV"
    # SECURITY: this file will hold every generated secret (auth secret,
    # API key secret, DB/redis passwords). Restrict from creation onward
    # instead of relying on umask.
    chmod 600 "$STAGING_ENV" 2>/dev/null || true
    ok "Preparing .env configuration..."

    # ── Secrets: reuse existing non-placeholder values when present ───────
    # Fresh install → generate everything.
    # --reconfigure / resume → keep POSTGRES_PASSWORD (and other real secrets)
    # so they stay in sync with any already-initialized Docker volumes.
    local prev_pg="" prev_auth="" prev_redis="" prev_api=""
    if [[ -n "$previous_env" && -f "$previous_env" ]]; then
        prev_pg=$(env_get "$previous_env" POSTGRES_PASSWORD)
        prev_auth=$(env_get "$previous_env" BETTER_AUTH_SECRET)
        prev_redis=$(env_get "$previous_env" REDIS_PASSWORD)
        prev_api=$(env_get "$previous_env" API_KEY_SECRET)
    fi

    local NEW_PG_PASS NEW_AUTH_SECRET NEW_REDIS_PASS NEW_API_KEY_SECRET NEW_BACKUP_CRED_KEY
    local prev_backup_cred=""
    if [[ -n "$previous_env" && -f "$previous_env" ]]; then
        prev_backup_cred=$(env_get "$previous_env" BACKUP_CREDENTIALS_ENCRYPTION_KEY)
    fi
    local reused_pg=false reused_auth=false reused_redis=false reused_api=false

    if ! is_placeholder_secret "$prev_pg"; then
        NEW_PG_PASS="$prev_pg"
        reused_pg=true
    else
        NEW_PG_PASS=$(openssl rand -base64 48 | tr -d '/+=' | head -c 32)
    fi

    if ! is_placeholder_secret "$prev_auth"; then
        NEW_AUTH_SECRET="$prev_auth"
        reused_auth=true
    else
        NEW_AUTH_SECRET=$(openssl rand -base64 32)
    fi

    # Redis auth is required by the bundled compose file (${REDIS_PASSWORD:?}).
    # Older .env files could leave this empty for a no-auth Redis; empty is no
    # longer valid, so only a real value is reused.
    if [[ -n "$previous_env" && -f "$previous_env" ]] && ! is_placeholder_secret "$prev_redis"; then
        NEW_REDIS_PASS="$prev_redis"
        reused_redis=true
    else
        NEW_REDIS_PASS=$(openssl rand -base64 48 | tr -d '/+=' | head -c 24)
    fi

    if ! is_placeholder_secret "$prev_api"; then
        NEW_API_KEY_SECRET="$prev_api"
        reused_api=true
    else
        NEW_API_KEY_SECRET=$(openssl rand -base64 32)
    fi

    env_set "$STAGING_ENV" POSTGRES_PASSWORD "$NEW_PG_PASS"
    env_set "$STAGING_ENV" BETTER_AUTH_SECRET "$NEW_AUTH_SECRET"
    env_set "$STAGING_ENV" REDIS_PASSWORD "$NEW_REDIS_PASS"
    # API_KEY_SECRET may be commented or absent in older .env.example copies.
    if grep -q '^API_KEY_SECRET=\|^# *API_KEY_SECRET=' "$STAGING_ENV"; then
        env_set "$STAGING_ENV" API_KEY_SECRET "$NEW_API_KEY_SECRET"
    else
        printf '\n# HMAC secret for panel/agent API keys\n' >> "$STAGING_ENV"
        printf '%s=%s\n' "API_KEY_SECRET" "$NEW_API_KEY_SECRET" >> "$STAGING_ENV"
        chmod 600 "$STAGING_ENV" 2>/dev/null || true
    fi

    # SECURITY: backup S3/SFTP credentials are encrypted at rest with this key;
    # without it the backend now refuses to store them in production rather
    # than writing plaintext secrets into Postgres. It must remain STABLE —
    # rotating it makes previously stored credentials undecryptable — so an
    # existing non-placeholder value is preserved like the other secrets.
    if ! is_placeholder_secret "$prev_backup_cred" && [[ -n "$prev_backup_cred" ]]; then
        NEW_BACKUP_CRED_KEY="$prev_backup_cred"
    else
        NEW_BACKUP_CRED_KEY=$(openssl rand -base64 32)
    fi
    if grep -q '^BACKUP_CREDENTIALS_ENCRYPTION_KEY=\|^# *BACKUP_CREDENTIALS_ENCRYPTION_KEY=' "$STAGING_ENV"; then
        env_set "$STAGING_ENV" BACKUP_CREDENTIALS_ENCRYPTION_KEY "$NEW_BACKUP_CRED_KEY"
    else
        printf '\n# AES key for encrypting backup S3/SFTP credentials at rest\n' >> "$STAGING_ENV"
        printf '%s=%s\n' "BACKUP_CREDENTIALS_ENCRYPTION_KEY" "$NEW_BACKUP_CRED_KEY" >> "$STAGING_ENV"
        chmod 600 "$STAGING_ENV" 2>/dev/null || true
    fi

    if $reused_pg || $reused_auth || $reused_redis || $reused_api; then
        ok "Preserved existing secrets (Postgres password is only applied on first volume init)"
        $reused_pg    && info "Reused POSTGRES_PASSWORD from previous .env"
        $reused_auth  && info "Reused BETTER_AUTH_SECRET from previous .env"
        $reused_redis && info "Reused REDIS_PASSWORD from previous .env"
        $reused_api   && info "Reused API_KEY_SECRET from previous .env"
        ! $reused_pg    && info "Generated new POSTGRES_PASSWORD"
        ! $reused_auth  && info "Generated new BETTER_AUTH_SECRET"
        ! $reused_redis && info "Generated new REDIS_PASSWORD"
        ! $reused_api   && info "Generated new API_KEY_SECRET"
    else
        ok "Generated POSTGRES_PASSWORD, BETTER_AUTH_SECRET, REDIS_PASSWORD, API_KEY_SECRET, BACKUP_CREDENTIALS_ENCRYPTION_KEY"
    fi
    # A fresh API_KEY_SECRET over an existing stack changes the HMAC secret
    # that panel/agent API keys were hashed under. The backend keeps those
    # keys working via a one-time fallback — re-issue them from the panel
    # when convenient so they hash under the dedicated secret.
    if [[ -n "$previous_env" && -f "$previous_env" ]] && ! $reused_api; then
        warn "New API_KEY_SECRET generated for an existing stack: pre-existing panel/agent API keys keep working, but re-issue them from the panel."
    fi

    # ── Detect default PUBLIC_URL ─────────────────────────────────────────
    DETECTED_IP=""
    if command -v hostname &>/dev/null; then
        DETECTED_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || \
                      ip route get 1 2>/dev/null | awk '{print $7; exit}' || \
                      echo "")
    fi

    DEFAULT_PUBLIC_URL="http://localhost:8080"
    if [[ -n "$DETECTED_IP" ]]; then
        DEFAULT_PUBLIC_URL="http://${DETECTED_IP}:8080"
    fi

    # ── Seed prompted values from --set/--env-file ────────────────────────
    # Behaves like the environment-variable overrides: a --set PUBLIC_URL is
    # picked up by ask() as a preset instead of prompting. Only the prompted
    # keys are assigned as shell variables here — everything else goes through
    # apply_user_sets() on the staging file, so --set can never clobber the
    # script's own internals.
    local seed_key seed_val
    for seed_key in PUBLIC_URL APP_NAME DOMAIN ACME_EMAIL; do
        if [[ -z "${!seed_key:-}" ]]; then
            seed_val="$(user_set_value "$seed_key")"
            if [[ -n "$seed_val" ]]; then
                printf -v "$seed_key" '%s' "$seed_val"
            fi
        fi
    done

    # ── Prompt for configuration ─────────────────────────────────────────
    echo ""
    echo -e "  ${BLD}Configuration${RST}"
    echo -e "  $(printf '─%.0s' {1..40})"
    echo -e "  ${DIM}Press Enter to accept [defaults] in brackets.${RST}"

    ask PUBLIC_URL "Public URL users will access the panel from" "$DEFAULT_PUBLIC_URL"

    # Validate PUBLIC_URL
    if [[ "$PUBLIC_URL" != http://* && "$PUBLIC_URL" != https://* ]]; then
        warn "Prepending http:// — PUBLIC_URL needs a scheme"
        PUBLIC_URL="http://${PUBLIC_URL}"
    fi
    if [[ "$PUBLIC_URL" == */ ]]; then
        PUBLIC_URL="${PUBLIC_URL%/}"
    fi

    # Derive PASSKEY_RP_ID (an explicit --set PASSKEY_RP_ID wins)
    if user_set_has PASSKEY_RP_ID; then
        PASSKEY_RP_ID="$(user_set_value PASSKEY_RP_ID)"
    else
        PASSKEY_RP_ID=$(extract_hostname "$PUBLIC_URL")
    fi

    ask APP_NAME "Panel name (shown in UI and emails)" "Catalyst"

    # ── Apply to staging .env ────────────────────────────────────────────
    env_set "$STAGING_ENV" PUBLIC_URL "$PUBLIC_URL"
    env_set "$STAGING_ENV" PASSKEY_RP_ID "$PASSKEY_RP_ID"
    env_set "$STAGING_ENV" APP_NAME "$APP_NAME"

    ok "PUBLIC_URL=${PUBLIC_URL}"
    ok "PASSKEY_RP_ID=${PASSKEY_RP_ID}  (auto-derived from PUBLIC_URL)"
    ok "APP_NAME=${APP_NAME}"

    # ── NODE_ENV ─────────────────────────────────────────────────────────
    if [[ "$PUBLIC_URL" == https://* ]]; then
        env_set "$STAGING_ENV" NODE_ENV "production"
        ok "NODE_ENV=production  (auto-set: PUBLIC_URL uses HTTPS)"

        warn "HTTPS detected — make sure TLS is configured."
        echo -e "  ${DIM}Use Caddy/Traefik overlay (see README.md).${RST}"
        echo -e "  ${DIM}Required: DOMAIN + ACME_EMAIL in .env, ports 80/443 open.${RST}"
    fi

    # ── TLS offer (interactive only) ─────────────────────────────────────
    if [[ "$PUBLIC_URL" != https://* && "$NON_INTERACTIVE" != "true" ]]; then
        echo ""
        if confirm "Set up automatic HTTPS with Let's Encrypt? (requires a real domain + ports 80/443)"; then
            ask DOMAIN "Domain name (e.g. panel.example.com)" ""
            if [[ -n "$DOMAIN" ]]; then
                ask ACME_EMAIL "Email for Let's Encrypt notifications" ""

                PUBLIC_URL="https://${DOMAIN}"
                env_set "$STAGING_ENV" PUBLIC_URL "$PUBLIC_URL"
                env_set "$STAGING_ENV" PASSKEY_RP_ID "$DOMAIN"
                env_set "$STAGING_ENV" DOMAIN "$DOMAIN"
                if [[ -n "$ACME_EMAIL" ]]; then
                    env_set "$STAGING_ENV" ACME_EMAIL "$ACME_EMAIL"
                fi
                env_set "$STAGING_ENV" NODE_ENV "production"

                ok "PUBLIC_URL updated to ${PUBLIC_URL}"
                ok "PASSKEY_RP_ID=${DOMAIN}"
                ok "DOMAIN=${DOMAIN}"
                ok "NODE_ENV=production"
                info "Start with TLS overlay:"
                echo -e "  ${CYN}cd ${DEST} && ${COMPOSE_CMD} -f docker-compose.yml -f docker-compose.caddy.yml up -d${RST}"
            fi
        fi
    fi

    # ── Panel Update button: same-path compose bind-mount ───────────────
    COMPOSE_DIR="$(cd "$DEST" && pwd)"
    if grep -q "^CATALYST_COMPOSE_DIR=\|^# *CATALYST_COMPOSE_DIR=" "$STAGING_ENV"; then
        env_set "$STAGING_ENV" CATALYST_COMPOSE_DIR "$COMPOSE_DIR"
    else
        printf '\n# Absolute host path of this compose project (panel Update button)\n' >> "$STAGING_ENV"
        printf '%s=%s\n' "CATALYST_COMPOSE_DIR" "$COMPOSE_DIR" >> "$STAGING_ENV"
        chmod 600 "$STAGING_ENV" 2>/dev/null || true
    fi
    if grep -q "^AUTO_UPDATE_DOCKER_COMPOSE_PATH=\|^# *AUTO_UPDATE_DOCKER_COMPOSE_PATH=" "$STAGING_ENV"; then
        env_set "$STAGING_ENV" AUTO_UPDATE_DOCKER_COMPOSE_PATH "${COMPOSE_DIR}/docker-compose.yml"
    else
        printf '%s=%s\n' "AUTO_UPDATE_DOCKER_COMPOSE_PATH" "${COMPOSE_DIR}/docker-compose.yml" >> "$STAGING_ENV"
        chmod 600 "$STAGING_ENV" 2>/dev/null || true
    fi
    ok "CATALYST_COMPOSE_DIR=${COMPOSE_DIR}"
    # Container user catalyst must traverse parents of the bind mount.
    chmod o+x "$(dirname "$COMPOSE_DIR")" 2>/dev/null || true
    # Least privilege: only the compose YAML/configs need container-user reads.
    # Never chmod the .env (secrets) or apply recursive a+rX.
    if [[ -f "${COMPOSE_DIR}/docker-compose.yml" ]]; then
        chmod 644 "${COMPOSE_DIR}/docker-compose.yml" 2>/dev/null || true
    fi
    for cfg in docker-compose.caddy.yml docker-compose.traefik.yml docker-compose.test.yml; do
        if [[ -f "${COMPOSE_DIR}/${cfg}" ]]; then
            chmod 644 "${COMPOSE_DIR}/${cfg}" 2>/dev/null || true
        fi
    done
    chmod 600 "$STAGING_ENV" 2>/dev/null || true
    find "$COMPOSE_DIR" -maxdepth 1 -name ".env*" -exec chmod 600 {} \; 2>/dev/null || true

    # ── Apply --set / --env-file overrides ────────────────────────────────
    # Last stop before the atomic commit: user overrides land on top of the
    # generated secrets and prompted values, with warnings where an override
    # replaces something dangerous to hand-set.
    if [[ ${#USER_SETS[@]} -gt 0 ]]; then
        local set_entry set_key set_val
        local example_env="${DEST}/.env.example"
        for set_entry in "${USER_SETS[@]}"; do
            set_key="${set_entry%%=*}"
            set_val="${set_entry#*=}"
            if [[ -f "$example_env" ]] && ! grep -qE "^#?[[:space:]]*${set_key}=" "$example_env"; then
                warn "${set_key} is not in .env.example — appending anyway (check for typos)"
            fi
            case "$set_key" in
                POSTGRES_PASSWORD)
                    warn "--set POSTGRES_PASSWORD overrides the generated/reused value — it must match the password the postgres volume was FIRST initialized with, or the backend fails with Prisma P1000"
                    ;;
                BETTER_AUTH_SECRET|REDIS_PASSWORD|API_KEY_SECRET|BACKUP_CREDENTIALS_ENCRYPTION_KEY)
                    warn "--set ${set_key} overrides the generated/reused secret"
                    ;;
            esac
            env_set "$STAGING_ENV" "$set_key" "$set_val"
            ok "Set ${set_key}=$(mask_secret_value "$set_key" "$set_val")  (from --set/--env-file)"
        done
        chmod 600 "$STAGING_ENV" 2>/dev/null || true
    fi

    # ── Commit: atomically move staging → .env ────────────────────────────
    # All prompts answered, all values written.  Now it's safe to commit.
    mv "$STAGING_ENV" "${DEST}/.env"
    chmod 600 "${DEST}/.env" 2>/dev/null || true
    STAGING_ENV=""   # clear so cleanup trap doesn't remove it
    ok "Configuration complete!"

    # Remove any leftover incomplete marker from a previous interrupted run
    sed -i '/^# CATALYST_SETUP_INCOMPLETE=/d' "${DEST}/.env" 2>/dev/null || true
}

# ── Phase 7: Uninstall ────────────────────────────────────────────────────────
phase_uninstall() {
    step "Uninstalling Catalyst"

    DEST="${PWD}/${TARGET_DIR}"

    if [[ ! -d "$DEST" ]]; then
        err "'${TARGET_DIR}' not found in ${PWD}"
        exit 1
    fi

    echo -e "  ${BLD}This will remove:${RST}"
    echo -e "    ${RED}${DEST}/${RST}"
    echo ""
    echo -e "  ${DIM}Named Docker volumes (postgres DB, server files, backups) are kept by default.${RST}"
    echo -e "  ${DIM}If you reinstall later with a new POSTGRES_PASSWORD while keeping the old${RST}"
    echo -e "  ${DIM}postgres volume, the backend will fail with Prisma P1000 auth errors.${RST}"
    echo ""

    if [[ "$NON_INTERACTIVE" != "true" ]] && ! confirm "Remove the Catalyst Docker stack?"; then
        info "Aborted."
        exit 0
    fi

    local remove_volumes=false
    if [[ "$NON_INTERACTIVE" == "true" ]]; then
        # -y uninstall keeps data unless the operator opts in explicitly.
        if [[ "${REMOVE_VOLUMES:-}" == "1" || "${REMOVE_VOLUMES:-}" == "true" ]]; then
            remove_volumes=true
        fi
    else
        if confirm "Also delete data volumes (database, servers, backups)? This cannot be undone."; then
            remove_volumes=true
        fi
    fi

    if $DRY_RUN; then
        if $remove_volumes; then
            info "[dry-run] Would remove ${DEST} and compose volumes"
        else
            info "[dry-run] Would remove ${DEST} (volumes kept)"
        fi
        return 0
    fi

    # Stop containers first
    if [[ -f "${DEST}/docker-compose.yml" ]]; then
        info "Stopping containers..."
        if $remove_volumes; then
            # -v removes named volumes declared in the compose file
            (cd "$DEST" && $COMPOSE_CMD down -v 2>/dev/null) || true
        else
            (cd "$DEST" && $COMPOSE_CMD down 2>/dev/null) || true
        fi
    fi

    rm -rf "$DEST"
    ok "Removed ${DEST}"

    echo ""
    echo -e "  ${GRN}${BLD}Catalyst has been uninstalled.${RST}"
    if $remove_volumes; then
        ok "Compose volumes removed (database + server data wiped)"
    else
        echo -e "  ${DIM}Note: Docker volumes (database, server data) were kept.${RST}"
        echo -e "  ${DIM}To wipe them later:${RST}"
        echo -e "  ${CYN}  docker volume ls | grep catalyst${RST}"
        echo -e "  ${CYN}  docker volume rm <name>${RST}"
        echo -e "  ${DIM}Or re-run: REMOVE_VOLUMES=1 bash install.sh --uninstall -y${RST}"
    fi
    echo ""
}

# ── Summary ───────────────────────────────────────────────────────────────────
print_summary() {
    # Read current values. env_get tolerates a missing file (dry-run never
    # writes .env) and missing keys, unlike a bare grep|cut pipeline which
    # pipefail+errexit would abort on.
    local public_url passkey_rp_id app_name node_env
    public_url=$(env_get "${DEST}/.env" PUBLIC_URL)
    passkey_rp_id=$(env_get "${DEST}/.env" PASSKEY_RP_ID)
    app_name=$(env_get "${DEST}/.env" APP_NAME)
    node_env=$(env_get "${DEST}/.env" NODE_ENV)

    echo ""
    echo -e "  ${GRN}${BLD}╔══════════════════════════════════════════╗${RST}"
    echo -e "  ${GRN}${BLD}║      Catalyst setup is ready!    ✓      ║${RST}"
    echo -e "  ${GRN}${BLD}╚══════════════════════════════════════════╝${RST}"
    echo ""
    echo -e "  ${BLD}Configuration:${RST}"
    echo -e "    APP_NAME            ${CYN}${app_name:-Catalyst}${RST}"
    echo -e "    PUBLIC_URL          ${CYN}${public_url:-http://localhost:8080}${RST}"
    echo -e "    PASSKEY_RP_ID       ${CYN}${passkey_rp_id:-localhost}${RST}"
    echo -e "    NODE_ENV            ${CYN}${node_env:-development}${RST}"
    echo -e "    POSTGRES_PASSWORD   ${GRN}✓ generated${RST}"
    echo -e "    BETTER_AUTH_SECRET  ${GRN}✓ generated${RST}"
    echo -e "    REDIS_PASSWORD      ${GRN}✓ generated${RST}"
    echo -e "    API_KEY_SECRET      ${GRN}✓ generated${RST}"
    echo ""
    echo -e "  ${BLD}Next steps:${RST}"
    echo ""
    echo -e "    1. Review configuration:"
    echo -e "       ${CYN}nano ${DEST}/.env${RST}"
    echo ""
    echo -e "    2. Start the stack:"
    echo -e "       ${CYN}cd ${DEST} && ${COMPOSE_CMD} up -d${RST}"

    if [[ "${node_env:-}" == "production" ]]; then
        echo ""
        echo -e "       ${YLW}TLS:${RST} Use HTTPS overlay instead:"
        echo -e "       ${CYN}cd ${DEST} && ${COMPOSE_CMD} -f docker-compose.yml -f docker-compose.caddy.yml up -d${RST}"
    fi

    echo ""
    echo -e "    3. Check status:"
    echo -e "       ${CYN}${RUNTIME_CMD} ps${RST}"
    echo ""
    echo -e "    4. Open in browser:"
    echo -e "       ${CYN}${public_url:-http://localhost:8080}${RST}"
    echo ""
    echo -e "  ${YLW}Tip:${RST} First registered user becomes admin."
    echo -e "  ${YLW}Tip:${RST} Edit config anytime: ${CYN}nano ${DEST}/.env${RST}"
    echo -e "  ${YLW}Tip:${RST} Keep stack files current after future releases:"
    echo -e "       ${CYN}bash ${DEST}/update.sh${RST}  (then docker compose pull && docker compose up -d)"
    echo -e "  ${YLW}Tip:${RST} Something wrong? Collect a redacted support bundle:"
    echo -e "       ${CYN}bash ${DEST}/diagnose.sh${RST}  (share the .txt with support / your AI agent)"
    echo -e "  ${YLW}Tip:${RST} Do not change POSTGRES_PASSWORD after first start without wiping the postgres volume,"
    echo -e "       ${DIM}or you will get Prisma P1000 password authentication failures.${RST}"
    echo -e "  ${DIM}Log: ${LOGFILE}${RST}"
    echo ""
}

# ══════════════════════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════════════════════

# ── Update mode: refresh stack files via the shipped updater ─────────────────
# Works for old installs too: if ./catalyst-docker/update.sh doesn't exist yet
# (deployed before the updater shipped), fetch just that script from upstream.
phase_update() {
    local dest="${PWD}/${TARGET_DIR}"
    if [[ ! -f "${dest}/docker-compose.yml" ]]; then
        err "'${TARGET_DIR}' not found in ${PWD} — nothing to update"
        info "Run this installer without --update first."
        exit 1
    fi

    if [[ ! -f "${dest}/update.sh" ]]; then
        warn "update.sh not present (older install) — fetching it from upstream"
        local url="https://raw.githubusercontent.com/${REPO}/${INSTALL_VERSION}/${TARGET_DIR}/update.sh"
        curl -fsSL "$url" -o "${dest}/update.sh" || {
            err "Could not download update.sh — check your internet connection"
            exit 1
        }
        chmod +x "${dest}/update.sh"
        ok "Fetched ${url}"
    fi

    info "Updating stack files in ${dest} (.env is preserved)"
    # --dry-run passes through to update.sh (which supports its own dry-run);
    # without this, `install.sh --update --dry-run` would update for real.
    if $DRY_RUN; then
        bash "${dest}/update.sh" --dry-run
    else
        bash "${dest}/update.sh"
    fi
    local rc=$?
    if [[ $rc -ne 0 ]]; then
        exit $rc
    fi
}

main() {
    print_banner

    if [[ "$MODE" == "uninstall" ]]; then
        # Need runtime for compose down
        phase_check_runtime
        phase_uninstall
        exit 0
    fi

    if [[ "$MODE" == "update" ]]; then
        phase_update
        exit 0
    fi

    phase_check_runtime
    phase_install_docker
    phase_validate_compose
    phase_check_deps
    phase_preflight
    phase_download
    phase_configure
    print_summary

    log "Install completed successfully"
}

main "$@"
