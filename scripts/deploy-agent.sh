#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Catalyst Agent Deployment Script
# Installs and configures the Catalyst Agent on a fresh node.
# Baked into the backend image at /scripts/deploy-agent.sh (see Dockerfile).
#
# Supported distros / init systems:
#   apt    (Debian, Ubuntu)           — systemd
#   dnf    (Fedora 22+, RHEL 9+)      — systemd
#   yum    (RHEL / CentOS 7-8)        — systemd
#   pacman (Arch, Manjaro)            — systemd
#   zypper (openSUSE, SLES)           — systemd
#   apk    (Alpine Linux)             — OpenRC
#
# Usage (normally called by the bootstrap wrapper):
#   deploy-agent.sh <backend_url> <node_id> <node_api_key> [node_hostname]
# ---------------------------------------------------------------------------

set -euo pipefail

# --- Positional arguments -----------------------------------------------------
BACKEND_INPUT_URL="${1:-http://localhost:3000}"
NODE_ID="${2:-node-$(hostname -s 2>/dev/null || hostname)}"
NODE_API_KEY="${3:-}"
NODE_HOSTNAME="${4:-$(hostname -f 2>/dev/null || hostname)}"

NERDCTL_VERSION="2.2.1"
CNI_PLUGINS_VERSION="v1.4.1"
AGENT_RELEASE_REPO="${AGENT_RELEASE_REPO:-catalystctl/catalyst}"
# Optional pin from the panel one-liner (`AGENT_VERSION=1.18.8`). Empty means
# "ask the panel". Never default to GitHub /latest — that can install a newer
# agent than the running panel understands.
AGENT_VERSION="${AGENT_VERSION:-}"

# --- Helpers ------------------------------------------------------------------
log()  { printf '[deploy-agent] %s\n' "$*"; }
warn() { printf '[deploy-agent] WARNING: %s\n' "$*" >&2; }
fail() { printf '[deploy-agent] ERROR: %s\n' "$*" >&2; exit 1; }

# --- Auto-elevate to root if needed -------------------------------------------
if [ "$EUID" -ne 0 ]; then
    if command -v sudo >/dev/null 2>&1; then
        log "Not running as root — re-executing with sudo ..."
        exec sudo --preserve-env=AGENT_VERSION,AGENT_RELEASE_REPO,DATA_DIR,CONSOLE_LOG_DIR,CNI_DIR,CNI_BIN_DIR,CNI_DATA_DIR,CNI_RESULTS_DIR,CNI_BRIDGE_NAME,CNI_BRIDGE_SUBNET,SYSTEMD_OVERRIDE_DIR,CATALYST_CONFIG_PATH,SFTP_PORT,SFTP_HOST_KEY -- "$(command -v bash || command -v sh)" "$0" "$@"
    else
        fail "This script must be run as root and sudo is not available."
    fi
fi
# ------------------------------------------------------------------------------

if [ -z "$NODE_API_KEY" ]; then
    cat <<'USAGE' >&2
Usage: deploy-agent.sh <backend_url> <node_id> <node_api_key> [node_hostname]
USAGE
    exit 1
fi

# ---------------------------------------------------------------------------
# Detection helpers
# ---------------------------------------------------------------------------

detect_pkg_manager() {
    # Order matters: dnf before yum (on RHEL 8+ both exist; dnf is preferred).
    if command -v apt-get >/dev/null 2>&1; then echo "apt";    return; fi
    if command -v apk     >/dev/null 2>&1; then echo "apk";    return; fi
    if command -v dnf     >/dev/null 2>&1; then echo "dnf";    return; fi
    if command -v yum     >/dev/null 2>&1; then echo "yum";    return; fi
    if command -v pacman  >/dev/null 2>&1; then echo "pacman"; return; fi
    if command -v zypper  >/dev/null 2>&1; then echo "zypper"; return; fi
    echo ""
}

detect_init_system() {
    if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
        echo "systemd"
    elif command -v rc-update >/dev/null 2>&1; then
        echo "openrc"
    else
        echo "unknown"
    fi
}

os_arch() {
    case "$(uname -m)" in
        x86_64|amd64) echo "amd64" ;;
        aarch64|arm64) echo "arm64" ;;
        *) fail "Unsupported architecture: $(uname -m)" ;;
    esac
}

toml_escape() {
    printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

# Emit `key = "escaped"` when value is non-empty. Quotes must be built here
# (not via ${var:+key = "$var"} inside a heredoc) — bash quote-removal in
# ${var:+word} strips those quotes and produces invalid TOML.
toml_quoted_line() {
    local key="$1" val="${2:-}"
    [ -n "$val" ] || return 0
    printf '%s = "%s"\n' "$key" "$(toml_escape "$val")"
}

toml_raw_line() {
    local key="$1" val="${2:-}"
    [ -n "$val" ] || return 0
    printf '%s = %s\n' "$key" "$val"
}

normalize_backend_urls() {
    BACKEND_HTTP_URL="${BACKEND_INPUT_URL%/}"
    case "$BACKEND_HTTP_URL" in
        ws://*)  BACKEND_HTTP_URL="http://${BACKEND_HTTP_URL#ws://}" ;;
        wss://*) BACKEND_HTTP_URL="https://${BACKEND_HTTP_URL#wss://}" ;;
    esac
    # Strip trailing slashes and /ws suffix
    BACKEND_HTTP_URL="${BACKEND_HTTP_URL%/}"
    BACKEND_HTTP_URL="${BACKEND_HTTP_URL%/ws}"
    BACKEND_HTTP_URL="${BACKEND_HTTP_URL%/}"

    BACKEND_WS_URL="$BACKEND_HTTP_URL"
    case "$BACKEND_WS_URL" in
        https://*) BACKEND_WS_URL="wss://${BACKEND_WS_URL#https://}" ;;
        http://*)  BACKEND_WS_URL="ws://${BACKEND_WS_URL#http://}" ;;
    esac
    BACKEND_WS_URL="${BACKEND_WS_URL%/}"
    if [[ "$BACKEND_WS_URL" != */ws ]]; then
        BACKEND_WS_URL="${BACKEND_WS_URL}/ws"
    fi
}

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------

preflight() {
    log "Running pre-flight checks..."

    # Check connectivity — at least one binary source must be reachable
    local github_reachable=false
    local backend_reachable=false

    if curl -fsSL --max-time 10 "https://github.com/${AGENT_RELEASE_REPO}/releases/latest" -o /dev/null 2>&1; then
        github_reachable=true
    fi
    if curl -fsSL --max-time 10 "${BACKEND_HTTP_URL}/api/agent/version" -o /dev/null 2>&1; then
        backend_reachable=true
    elif curl -fsSL --max-time 10 "${BACKEND_HTTP_URL}/api/agent/download?arch=x86_64" -o /dev/null 2>&1; then
        backend_reachable=true
    fi

    if [ "$github_reachable" = false ] && [ "$backend_reachable" = false ]; then
        warn "Cannot reach GitHub Releases or ${BACKEND_HTTP_URL}."
        warn "Ensure this node has internet access or network access to the Catalyst backend."
    elif [ "$github_reachable" = true ]; then
        log "GitHub Releases reachable — pre-built binary available."
    else
        warn "GitHub Releases unreachable. Will try backend fallback for binary download."
    fi

    # Check minimum kernel version (containerd needs >= 4.x roughly)
    local kernel_major
    kernel_major="$(uname -r | cut -d. -f1)"
    if [ "${kernel_major:-0}" -lt 4 ]; then
        fail "Kernel too old ($(uname -r)). containerd requires Linux 4.x or later."
    fi

    # Check available disk space (need ~500MB for agent + deps)
    local available_mb
    available_mb="$(df -BM --output=avail / | tail -1 | tr -d ' M')"
    if [ "${available_mb:-0}" -lt 500 ]; then
        warn "Low disk space (${available_mb}MB free). Installation may fail."
    fi

    # Check if already installed
    if [ -x /opt/catalyst-agent/catalyst-agent ] && [ -s /opt/catalyst-agent/config.toml ]; then
        local existing_node_id
        existing_node_id="$(grep -oP 'node_id\s*=\s*"\K[^"]+' /opt/catalyst-agent/config.toml 2>/dev/null || true)"
        if [ "$existing_node_id" = "$NODE_ID" ]; then
            warn "Catalyst Agent is already installed for this node (node_id=${NODE_ID})."
            warn "The agent binary and config will be updated in-place."
        else
            warn "Catalyst Agent is already installed with a DIFFERENT node_id."
            warn "  Existing: ${existing_node_id}"
            warn "  New:      ${NODE_ID}"
            warn "Proceeding — config will be overwritten."
        fi
    fi

    log "Pre-flight checks passed."
}

# ---------------------------------------------------------------------------
# Package installation
# ---------------------------------------------------------------------------

install_base_packages() {
    local pm="$1"
    log "Installing system dependencies via $pm..."

    # Prefer containerd from official Docker CE repo on Debian/Ubuntu for
    # the latest stable version.  On other distros the default repo is fine.
    case "$pm" in
        apt)
            # Ensure HTTPS transport and key management are available.
            apt-get update -y
            # Do NOT install runc here — Docker CE's containerd.io bundles its own
            # runc and conflicts with the distro package.
            apt-get install -y ca-certificates curl wget jq tar gzip unzip \
                iproute2 iptables rsync util-linux e2fsprogs gnupg lsb-release

            # Add Docker GPG key and repo if not already present.
            if [ ! -f /etc/apt/sources.list.d/docker.list ] && \
               ! grep -rq 'download.docker.com' /etc/apt/sources.list /etc/apt/sources.list.d/ 2>/dev/null; then
                log "Adding Docker CE repository for containerd..."
                local arch dpkg_arch
                dpkg_arch="$(dpkg --print-architecture)"
                mkdir -p /etc/apt/keyrings
                curl -fsSL "https://download.docker.com/linux/$(lsb_release -si | tr '[:upper:]' '[:lower:]')/gpg" \
                    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg 2>/dev/null || true
                echo "deb [arch=${dpkg_arch} signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/$(lsb_release -si | tr '[:upper:]' '[:lower:]') \
$(lsb_release -sc) stable" > /etc/apt/sources.list.d/docker.list
                apt-get update -y
            fi

            apt-get install -y containerd.io
            ;;
        apk)
            # Ensure the community repo is enabled (containerd lives there).
            if ! grep -rq '\[community\]' /etc/apk/repositories 2>/dev/null; then
                log "Enabling Alpine community repository..."
                sed -i 's|^#\?\(.*community\)$|\1|' /etc/apk/repositories 2>/dev/null || true
                apk update
            fi
            apk add --no-cache ca-certificates curl wget jq tar gzip unzip \
                iproute2 iptables rsync util-linux e2fsprogs \
                containerd runc
            ;;
        yum)
            yum install -y ca-certificates curl wget jq tar gzip unzip \
                iproute iptables rsync util-linux e2fsprogs runc || true
            if ! rpm -q containerd >/dev/null 2>&1; then
                log "containerd not found in default repos — attempting containerd.io (Docker CE)..."
                yum install -y containerd.io 2>/dev/null || \
                    yum install -y containerd 2>/dev/null || \
                    fail "Could not install containerd. Enable the Docker CE repo or install containerd manually."
            fi
            ;;
        dnf)
            dnf install -y ca-certificates curl wget jq tar gzip unzip \
                iproute iptables rsync util-linux e2fsprogs runc || true
            if ! rpm -q containerd >/dev/null 2>&1; then
                log "containerd not found in default repos — attempting containerd.io (Docker CE)..."
                dnf install -y containerd.io 2>/dev/null || \
                    dnf install -y containerd 2>/dev/null || \
                    fail "Could not install containerd. Enable the Docker CE repo or install containerd manually."
            fi
            ;;
        pacman)
            pacman -Sy --noconfirm ca-certificates curl wget jq tar gzip unzip \
                iproute2 iptables rsync util-linux e2fsprogs \
                containerd runc
            ;;
        zypper)
            zypper --non-interactive install ca-certificates curl wget jq tar gzip unzip \
                iproute2 iptables rsync util-linux e2fsprogs \
                containerd runc
            ;;
        *)
            fail "Unsupported package manager. Install dependencies manually."
            ;;
    esac
}

# ---------------------------------------------------------------------------
# nerdctl (optional helper CLI for containerd)
# ---------------------------------------------------------------------------

install_nerdctl() {
    if command -v nerdctl >/dev/null 2>&1; then
        log "nerdctl already installed: $(nerdctl --version 2>/dev/null | head -1 || true)"
        return 0
    fi

    local arch url archive extract_dir
    arch="$(os_arch)"
    url="https://github.com/containerd/nerdctl/releases/download/v${NERDCTL_VERSION}/nerdctl-${NERDCTL_VERSION}-linux-${arch}.tar.gz"
    archive="/tmp/nerdctl-${NERDCTL_VERSION}-${arch}.tar.gz"
    extract_dir="/tmp/nerdctl-${NERDCTL_VERSION}-${arch}"

    log "Installing nerdctl ${NERDCTL_VERSION} (${arch})..."
    curl -fsSL "$url" -o "$archive"
    rm -rf "$extract_dir"
    mkdir -p "$extract_dir"
    tar -xzf "$archive" -C "$extract_dir"
    install -m 0755 "$extract_dir/nerdctl" /usr/local/bin/nerdctl
    if [ -f "$extract_dir/nerdctl-ctr" ]; then
        install -m 0755 "$extract_dir/nerdctl-ctr" /usr/local/bin/nerdctl-ctr
    fi
    rm -rf "$extract_dir" "$archive"
    log "nerdctl installed."
}

# ---------------------------------------------------------------------------
# CNI plugins
# ---------------------------------------------------------------------------

install_cni_plugins() {
    local required=(bridge host-local portmap macvlan)
    local cni_dirs=("/opt/cni/bin" "/usr/libexec/cni" "/usr/lib/cni")
    local found_dir=""

    for cni_dir in "${cni_dirs[@]}"; do
        local all_present=true
        for plugin in "${required[@]}"; do
            if [ ! -x "${cni_dir}/${plugin}" ]; then
                all_present=false
                break
            fi
        done
        if [ "$all_present" = true ]; then
            found_dir="$cni_dir"
            break
        fi
    done

    if [ -n "$found_dir" ]; then
        log "CNI plugins already present in ${found_dir}"
        return 0
    fi

    # Try distro package first, fall back to upstream tarball.
    local pkg_manager="${1:-}"
    local pkg_installed=false

    case "$pkg_manager" in
        apt)
            apt-get install -y -qq containernetworking-plugins 2>/dev/null && pkg_installed=true
            ;;
        apk)
            apk add --no-cache cni-plugins 2>/dev/null && pkg_installed=true
            ;;
        yum|dnf)
            "$pkg_manager" install -y containernetworking-plugins 2>/dev/null && pkg_installed=true
            ;;
        pacman)
            pacman -S --noconfirm cni-plugins 2>/dev/null && pkg_installed=true
            ;;
        zypper)
            zypper --non-interactive install cni-plugins 2>/dev/null && pkg_installed=true
            ;;
    esac

    # Re-check after package install
    if [ "$pkg_installed" = true ]; then
        for cni_dir in "${cni_dirs[@]}"; do
            local all_present=true
            for plugin in "${required[@]}"; do
                if [ ! -x "${cni_dir}/${plugin}" ]; then
                    all_present=false
                    break
                fi
            done
            if [ "$all_present" = true ]; then
                log "CNI plugins installed via package manager in ${cni_dir}"
                return 0
            fi
        done
    fi

    # Fallback: download upstream tarball
    mkdir -p /opt/cni/bin
    local arch url archive
    arch="$(os_arch)"
    url="https://github.com/containernetworking/plugins/releases/download/${CNI_PLUGINS_VERSION}/cni-plugins-linux-${arch}-${CNI_PLUGINS_VERSION}.tgz"
    archive="/tmp/cni-plugins-${CNI_PLUGINS_VERSION}-${arch}.tgz"

    log "Installing CNI plugins ${CNI_PLUGINS_VERSION} (${arch}) from upstream..."
    curl -fsSL "$url" -o "$archive"
    tar -xzf "$archive" -C /opt/cni/bin
    rm -f "$archive"

    for plugin in "${required[@]}"; do
        [ -x "/opt/cni/bin/${plugin}" ] || fail "Missing required CNI plugin: ${plugin}"
    done
    log "CNI plugins installed from upstream tarball."
}

# ---------------------------------------------------------------------------
# containerd configuration
# ---------------------------------------------------------------------------

ensure_containerd_config() {
    local init="${1:-systemd}"
    mkdir -p /etc/containerd

    if [ ! -s /etc/containerd/config.toml ]; then
        if command -v containerd >/dev/null 2>&1; then
            log "Generating /etc/containerd/config.toml"
            containerd config default > /etc/containerd/config.toml
        else
            log "containerd binary not found — writing minimal config"
            cat > /etc/containerd/config.toml <<'TOML'
version = 2
[plugins]
  [plugins."io.containerd.grpc.v1.cri"]
    sandboxer = "podsandbox"
    [plugins."io.containerd.grpc.v1.cri".containerd]
      default_runtime_name = "runc"
      [plugins."io.containerd.grpc.v1.cri".containerd.runtimes]
        [plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runc]
          runtime_type = "io.containerd.runc.v2"
          [plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runc.options]
            BinaryName = "/usr/bin/runc"
TOML
        fi
    fi

    # Only set SystemdCgroup = true when the host actually uses systemd.
    # Alpine (OpenRC) and other non-systemd init systems use cgroupfs.
    if [ "$init" = "systemd" ]; then
        if grep -q 'SystemdCgroup = false' /etc/containerd/config.toml; then
            sed -i 's/SystemdCgroup = false/SystemdCgroup = true/g' /etc/containerd/config.toml
        elif ! grep -q 'SystemdCgroup = true' /etc/containerd/config.toml; then
            cat >> /etc/containerd/config.toml <<'EOF'

[plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runc.options]
  SystemdCgroup = true
EOF
        fi
    fi
}

# ---------------------------------------------------------------------------
# Filesystem layout
# ---------------------------------------------------------------------------

prepare_directories() {
    log "Preparing filesystem layout..."
    local data_dir="${DATA_DIR:-/var/lib/catalyst}"
    # Console FIFOs + stdout/stderr live under console_log_dir (default: $data_dir/console).
    # Never use /tmp for this: PrivateTmp=true + ReadWritePaths on a missing /tmp path
    # causes systemd exit status 226/NAMESPACE (see docs/troubleshooting.md).
    local console_dir="${CONSOLE_LOG_DIR:-${data_dir}/console}"
    mkdir -p /opt/catalyst-agent
    mkdir -p "${data_dir}"/{backups,images,migrate,console}
    mkdir -p "${console_dir}"
    mkdir -p /etc/cni/net.d
    mkdir -p /var/lib/cni/networks
    chmod 0755 "${console_dir}"
}

# ---------------------------------------------------------------------------
# Agent binary — download the static musl release matching the panel version
# ---------------------------------------------------------------------------

is_elf_binary() {
    # Do not depend on `file(1)` — it is not in the base package set.
    # ELF magic is 0x7f 'E' 'L' 'F'.
    [ -s "$1" ] || return 1
    [ "$(od -An -N4 -tx1 "$1" 2>/dev/null | tr -d ' \n')" = "7f454c46" ]
}

# curl wrapper: follow redirects, retry, never treat a progress meter as failure.
# Prints HTTP status to stdout on success via the caller checking the dest file.
download_file() {
    local url="$1" dest="$2" timeout="${3:-180}"
    local http_code curl_rc=0
    local extra=()
    # curl 7.71+; ignore on older distros (Ubuntu 20.04 ships 7.68).
    if curl --help all 2>/dev/null | grep -q -- '--retry-all-errors'; then
        extra+=(--retry-all-errors)
    fi
    # Do not swallow curl's exit status: a truncated HTTP 200 (curl 18) must fail.
    http_code="$(curl -fL --retry 3 --retry-delay 2 \
        --connect-timeout 15 --max-time "$timeout" \
        -A "catalyst-deploy-agent" "${extra[@]}" \
        -o "$dest" -w '%{http_code}' "$url" 2>/dev/null)" || curl_rc=$?
    [ "$curl_rc" = 0 ] && [ "$http_code" = "200" ] && [ -s "$dest" ]
}

fetch_github_release_digest() {
    local repo="$1" version="$2" asset_name="$3" dest="$4"
    local api_url digest
    command -v jq >/dev/null 2>&1 || return 1
    api_url="https://api.github.com/repos/${repo}/releases/tags/v${version}"
    if ! download_file "$api_url" "${dest}.api.json" 30; then
        rm -f "${dest}.api.json"
        return 1
    fi
    digest="$(jq -r --arg n "$asset_name" '.assets[]? | select(.name==$n) | .digest // empty' "${dest}.api.json" \
        | sed 's/^sha256://' | head -1)"
    rm -f "${dest}.api.json"
    [ "${#digest}" = 64 ] || return 1
    printf '%s\n' "$digest" > "$dest"
}

normalize_semver() {
    local raw="${1:-}" dots
    raw="${raw#v}"
    raw="${raw#V}"
    case "$raw" in
        ''|*[!0-9.]*|.*|*.) return 1 ;;
    esac
    dots="$(printf '%s' "$raw" | tr -cd '.' | wc -c)"
    [ "$dots" = 1 ] || [ "$dots" = 2 ] || return 1
    case "$raw" in
        [0-9]*.[0-9]*)
            printf '%s' "$raw"
            return 0
            ;;
    esac
    return 1
}

resolve_agent_version() {
    local pinned body extracted
    if pinned="$(normalize_semver "${AGENT_VERSION:-}")"; then
        AGENT_VERSION="$pinned"
        log "Using AGENT_VERSION=${AGENT_VERSION} (from environment / deploy token)."
        return 0
    fi

    log "Querying panel version from ${BACKEND_HTTP_URL}/api/agent/version ..."
    body="$(curl -fsSL --max-time 15 "${BACKEND_HTTP_URL}/api/agent/version" 2>/dev/null || true)"
    extracted="$(printf '%s' "$body" | sed -n 's/.*"agentVersion"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
    if [ -z "$extracted" ]; then
        extracted="$(printf '%s' "$body" | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
    fi
    if pinned="$(normalize_semver "$extracted")"; then
        AGENT_VERSION="$pinned"
        log "Panel reports version ${AGENT_VERSION} — installing matching agent."
        return 0
    fi

    warn "Could not determine panel version from ${BACKEND_HTTP_URL}/api/agent/version."
    AGENT_VERSION=""
    return 1
}

verify_and_install_binary() {
    local tmp_binary="$1"
    local source_label="$2"
    local asset_name="$3"
    shift 3

    if ! is_elf_binary "$tmp_binary"; then
        local err_body
        err_body="$(head -c 200 "$tmp_binary" 2>/dev/null || true)"
        rm -f "$tmp_binary"
        warn "${source_label} returned a non-ELF payload: ${err_body}"
        return 1
    fi

    local expected="" src
    for src in "$@"; do
        [ -n "$src" ] || continue
        rm -f "${tmp_binary}.sha256"
        if download_file "$src" "${tmp_binary}.sha256" 60; then
            expected="$(awk '{print $1}' "${tmp_binary}.sha256" | tr -d '\r')"
            expected="${expected#sha256:}"
            if [ "${#expected}" = 64 ]; then
                break
            fi
            expected=""
        fi
    done
    rm -f "${tmp_binary}.sha256"

    if [ "${#expected}" != 64 ] && [ -n "${AGENT_RELEASE_REPO:-}" ] && [ -n "${AGENT_VERSION:-}" ]; then
        if fetch_github_release_digest "$AGENT_RELEASE_REPO" "$AGENT_VERSION" "$asset_name" "${tmp_binary}.sha256"; then
            expected="$(awk '{print $1}' "${tmp_binary}.sha256" | tr -d '\r')"
            expected="${expected#sha256:}"
        fi
        rm -f "${tmp_binary}.sha256"
    fi

    if [ "${#expected}" != 64 ]; then
        warn "Could not obtain checksum for ${source_label} — refusing unverified binary."
        rm -f "$tmp_binary"
        return 1
    fi

    local actual
    actual="$(sha256sum "$tmp_binary" | awk '{print $1}')"
    if [ "$expected" != "$actual" ]; then
        rm -f "$tmp_binary"
        fail "Binary checksum mismatch from ${source_label}! Expected ${expected}, got ${actual}."
    fi
    log "Binary checksum verified (${source_label})."

    mv -f "$tmp_binary" /opt/catalyst-agent/catalyst-agent
    chmod 0755 /opt/catalyst-agent/catalyst-agent
    log "Agent binary installed from ${source_label}."
    return 0
}

install_agent_binary() {
    local agent_arch
    case "$(uname -m)" in
        x86_64|amd64) agent_arch="x86_64" ;;
        aarch64|arm64) agent_arch="aarch64" ;;
        *) fail "Unsupported architecture for agent binary: $(uname -m)" ;;
    esac

    local tmp_binary="/tmp/catalyst-agent.${agent_arch}"
    local asset_name="catalyst-agent-${agent_arch}-linux-musl"
    rm -f "$tmp_binary" "${tmp_binary}.sha256"

    resolve_agent_version || true
    if [ -z "${AGENT_VERSION:-}" ]; then
        fail "Cannot install agent: panel version is unknown. Re-run from the panel one-liner, or set AGENT_VERSION=x.y.z."
    fi

    local release_url backend_url backend_checksum
    release_url="https://github.com/${AGENT_RELEASE_REPO}/releases/download/v${AGENT_VERSION}/${asset_name}"
    backend_url="${BACKEND_HTTP_URL}/api/agent/download?arch=${agent_arch}&version=${AGENT_VERSION}"
    backend_checksum="${BACKEND_HTTP_URL}/api/agent/download-checksum?arch=${agent_arch}&version=${AGENT_VERSION}"

    # ── Priority 1: GitHub Releases, pinned to the panel version ──
    log "Downloading ${asset_name} v${AGENT_VERSION} from GitHub Releases..."
    if download_file "$release_url" "$tmp_binary" 180; then
        if verify_and_install_binary "$tmp_binary" "GitHub Releases v${AGENT_VERSION}" "$asset_name" \
            "${release_url}.sha256"; then
            return 0
        fi
    else
        rm -f "$tmp_binary"
        warn "GitHub Releases download failed for v${AGENT_VERSION}. Falling back to panel proxy..."
    fi

    # ── Priority 2: Panel proxy (same version; works when GitHub is blocked) ──
    log "Downloading ${asset_name} v${AGENT_VERSION} from panel..."
    if download_file "$backend_url" "$tmp_binary" 180; then
        if verify_and_install_binary "$tmp_binary" "panel v${AGENT_VERSION}" "$asset_name" \
            "$backend_checksum" "${release_url}.sha256"; then
            return 0
        fi
    else
        rm -f "$tmp_binary"
        warn "Panel download failed for v${AGENT_VERSION}."
    fi

    # ── Priority 3: local cargo build (dev machines only) ──
    if [ -f "$(pwd)/target/release/catalyst-agent" ]; then
        log "Using local build from $(pwd)/target/release/catalyst-agent"
        cp "$(pwd)/target/release/catalyst-agent" /opt/catalyst-agent/catalyst-agent
        chmod 0755 /opt/catalyst-agent/catalyst-agent
        return 0
    fi

    fail "Could not download catalyst-agent v${AGENT_VERSION} (${asset_name}) from GitHub or ${BACKEND_HTTP_URL}. Place a pre-built binary at /opt/catalyst-agent/catalyst-agent or retry with network access."
}

# ---------------------------------------------------------------------------
# Agent configuration
# ---------------------------------------------------------------------------

write_config() {
    local escaped_backend escaped_node escaped_api_key escaped_hostname escaped_data_dir
    escaped_backend="$(toml_escape "$BACKEND_WS_URL")"
    escaped_node="$(toml_escape "$NODE_ID")"
    escaped_api_key="$(toml_escape "$NODE_API_KEY")"
    escaped_hostname="$(toml_escape "$NODE_HOSTNAME")"
    escaped_data_dir="$(toml_escape "${DATA_DIR:-/var/lib/catalyst}")"

    # Backup existing config if present
    if [ -s /opt/catalyst-agent/config.toml ]; then
        cp /opt/catalyst-agent/config.toml "/opt/catalyst-agent/config.toml.bak.$(date +%s)"
        log "Existing config backed up."
    fi

    {
        cat <<EOF
# Catalyst Agent Configuration
# Auto-generated by deploy-agent.sh — $(date -Iseconds 2>/dev/null || date)

[server]
backend_url = "${escaped_backend}"
node_id = "${escaped_node}"
api_key = "${escaped_api_key}"
hostname = "${escaped_hostname}"
data_dir = "${escaped_data_dir}"
EOF
        toml_quoted_line console_log_dir "${CONSOLE_LOG_DIR:-}"
        printf 'max_connections = 100\n\n'

        printf '[sftp]\n'
        toml_raw_line port "${SFTP_PORT:-}"
        toml_quoted_line host_key_path "${SFTP_HOST_KEY:-}"
        printf '\n'

        cat <<'EOF'
[containerd]
socket_path = "/run/containerd/containerd.sock"
namespace = "catalyst"
EOF
        toml_quoted_line cni_dir "${CNI_DIR:-}"
        toml_quoted_line cni_bin_dir "${CNI_BIN_DIR:-}"
        toml_quoted_line cni_data_dir "${CNI_DATA_DIR:-}"
        toml_quoted_line cni_results_dir "${CNI_RESULTS_DIR:-}"
        toml_quoted_line cni_bridge_name "${CNI_BRIDGE_NAME:-}"
        toml_quoted_line cni_bridge_subnet "${CNI_BRIDGE_SUBNET:-}"
        toml_quoted_line systemd_override_dir "${SYSTEMD_OVERRIDE_DIR:-}"
        printf '\n'

        cat <<'EOF'
[logging]
level = "info"
format = "json"

[agent]
EOF
        toml_quoted_line config_path "${CATALYST_CONFIG_PATH:-}"
        toml_quoted_line release_repo "${AGENT_RELEASE_REPO:-}"
    } > /opt/catalyst-agent/config.toml

    chmod 0600 /opt/catalyst-agent/config.toml
    log "Configuration written to /opt/catalyst-agent/config.toml"
}

# ---------------------------------------------------------------------------
# Service management — systemd
# ---------------------------------------------------------------------------

write_systemd_unit() {
    local data_dir="${DATA_DIR:-/var/lib/catalyst}"
    local console_dir="${CONSOLE_LOG_DIR:-${data_dir}/console}"
    # Build ReadWritePaths. A leading "-" makes systemd ignore the path when it
    # does not exist yet (avoids 226/NAMESPACE on fresh hosts without /mnt, etc.).
    # Do NOT list host /tmp paths here: PrivateTmp=true remounts a private tmpfs
    # on /tmp, and a missing ReadWritePaths target fails unit start before ExecStart.
    local rw_paths="${data_dir}"
    case "${console_dir}" in
        "${data_dir}"/*) ;; # already covered by data_dir
        *) rw_paths="${rw_paths} ${console_dir}" ;;
    esac
    rw_paths="${rw_paths} /etc/cni/net.d /var/lib/cni -/mnt /run/containerd"

    cat > /etc/systemd/system/catalyst-agent.service <<EOF
[Unit]
Description=Catalyst Agent - Game Server Management
After=network-online.target containerd.service
Wants=network-online.target
Requires=containerd.service

[Service]
Type=simple
User=root
Group=root
WorkingDirectory=/opt/catalyst-agent
ExecStart=/opt/catalyst-agent/catalyst-agent --config /opt/catalyst-agent/config.toml
Restart=always
RestartSec=5
LimitNOFILE=65536

# Security: Agent must run as root to manage containers via containerd socket
# The agent needs unrestricted access to:
# - /run/containerd/containerd.sock (container management)
# - ${data_dir} (server data, backups, console FIFOs under console/)
# - /var/lib/cni and /etc/cni/net.d (container networking)
#
# Sandbox directives that ARE safe to enable (tested compatible):
NoNewPrivileges=true
ProtectSystem=full
PrivateTmp=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
#
# ProtectSystem=full implies a private mount namespace. The agent MUST mount
# server disk images in the host NS (nsenter -t 1 -m) so containerd bind-mounts
# and the file explorer see the same files. Do not drop ProtectSystem without
# also revisiting storage_manager.rs.
# Sandbox directives that MUST remain disabled (agent requires them):
# PrivateDevices=false     (needs loop devices for disk images)
# PrivateNetwork=false     (needs network for WebSocket + CNI)
# RestrictNamespaces=false (agent may need nsenter for container namespace ops)
# CapabilityBoundingSet=... (needs CAP_NET_BIND_SERVICE, CAP_SYS_ADMIN for mount)

# Ensure access to required paths ("-" prefix = ignore if missing)
ReadWritePaths=${rw_paths}

[Install]
WantedBy=multi-user.target
EOF
}

start_services_systemd() {
    systemctl daemon-reload
    systemctl unmask containerd >/dev/null 2>&1 || true
    systemctl reset-failed containerd >/dev/null 2>&1 || true
    log "Enabling and starting containerd..."
    systemctl enable --now containerd

    # Wait for the socket
    local attempts=30 i
    for i in $(seq 1 "$attempts"); do
        if systemctl is-active --quiet containerd; then break; fi
        if [ -S /run/containerd/containerd.sock ]; then
            log "containerd socket is present; proceeding"
            break
        fi
        sleep 1
    done

    if [ ! -S /run/containerd/containerd.sock ]; then
        log "--- containerd status ---"
        systemctl status containerd --no-pager >&2 || true
        log "--- containerd logs (last 80 lines) ---"
        journalctl -u containerd -n 80 --no-pager >&2 || true
        fail "containerd failed to start. Review the logs above and /etc/containerd/config.toml."
    fi

    systemctl enable --now catalyst-agent
}

verify_install_systemd() {
    sleep 2
    if ! systemctl is-active --quiet containerd; then
        if [ -S /run/containerd/containerd.sock ]; then
            log "containerd socket is present; continuing despite inactive systemd state"
        else
            fail "containerd is not active."
        fi
    fi
    systemctl is-active --quiet catalyst-agent || {
        log "--- catalyst-agent logs (last 50 lines) ---"
        journalctl -u catalyst-agent -n 50 --no-pager >&2 || true
        fail "catalyst-agent failed to start."
    }
    [ -S /run/containerd/containerd.sock ] || fail "containerd socket is missing."

    log "=========================================="
    log " Installation complete!"
    log "=========================================="
    log "View logs:  journalctl -u catalyst-agent -f"
    log "Config:     /opt/catalyst-agent/config.toml"
    log "Node ID:    ${NODE_ID}"
    log "Hostname:   ${NODE_HOSTNAME}"
}

# ---------------------------------------------------------------------------
# Service management — OpenRC (Alpine)
# ---------------------------------------------------------------------------

write_openrc_init() {
    cat > /etc/init.d/catalyst-agent <<'INITEOF'
#!/sbin/openrc-run

name="catalyst-agent"
description="Catalyst Agent - Game Server Management"
command="/opt/catalyst-agent/catalyst-agent"
command_args="--config /opt/catalyst-agent/config.toml"
command_background="yes"
pidfile="/run/${RC_SVCNAME}.pid"
output_log="/var/log/${RC_SVCNAME}.log"
error_log="/var/log/${RC_SVCNAME}.log"

depend() {
    need net
    after firewall
    # containerd may be managed manually or via its own init script
    if [ -e /etc/init.d/containerd ]; then
        need containerd
    fi
}
INITEOF
    chmod 0755 /etc/init.d/catalyst-agent
}

start_services_openrc() {
    if [ -e /etc/init.d/containerd ]; then
        if ! rc-service containerd status >/dev/null 2>&1; then
            log "Starting containerd via OpenRC..."
            rc-service containerd start || \
                rc-update add containerd default && rc-service containerd start
        fi
    else
        if ! pgrep -x containerd >/dev/null 2>&1; then
            log "Starting containerd directly..."
            containerd &
            sleep 2
        fi
    fi

    local attempts=30 i
    for i in $(seq 1 "$attempts"); do
        [ -S /run/containerd/containerd.sock ] && break
        sleep 1
    done

    if [ ! -S /run/containerd/containerd.sock ]; then
        fail "containerd socket is not available. Ensure containerd is running."
    fi

    rc-update add catalyst-agent default 2>/dev/null || true
    rc-service catalyst-agent start
}

verify_install_openrc() {
    sleep 2
    if [ ! -S /run/containerd/containerd.sock ]; then
        fail "containerd socket is missing."
    fi
    if ! rc-service catalyst-agent status >/dev/null 2>&1; then
        cat /var/log/catalyst-agent.log >&2 2>/dev/null || true
        fail "catalyst-agent failed to start."
    fi

    log "=========================================="
    log " Installation complete!"
    log "=========================================="
    log "View logs:  cat /var/log/catalyst-agent.log"
    log "Config:     /opt/catalyst-agent/config.toml"
    log "Node ID:    ${NODE_ID}"
    log "Hostname:   ${NODE_HOSTNAME}"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
    log "=== Catalyst Agent Installation ==="
    log "Node ID: ${NODE_ID}"

    normalize_backend_urls
    log "Backend HTTP: ${BACKEND_HTTP_URL}"
    log "Backend WS:   ${BACKEND_WS_URL}"

    local pkg_manager init_system
    pkg_manager="$(detect_pkg_manager)"
    [ -n "$pkg_manager" ] || fail "No supported package manager found."
    log "Package manager: ${pkg_manager}"

    init_system="$(detect_init_system)"
    log "Init system:     ${init_system}"

    preflight
    install_base_packages "$pkg_manager"
    install_nerdctl
    install_cni_plugins "$pkg_manager"
    ensure_containerd_config "$init_system"
    prepare_directories
    install_agent_binary
    write_config

    case "$init_system" in
        systemd)
            write_systemd_unit
            start_services_systemd
            verify_install_systemd
            ;;
        openrc)
            write_openrc_init
            start_services_openrc
            verify_install_openrc
            ;;
        *)
            fail "Unsupported init system (${init_system}). Only systemd and OpenRC are supported."
            ;;
    esac
}

main "$@"
