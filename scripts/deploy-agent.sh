#!/usr/bin/env bash

# Catalyst Agent Deployment Script
# Installs and configures the Catalyst Agent on a fresh node
#
# Supported distros / init systems:
#   apt    (Debian, Ubuntu)           — systemd
#   dnf    (Fedora 22+, RHEL 9+)      — systemd
#   yum    (RHEL / CentOS 7-8)        — systemd
#   pacman (Arch, Manjaro)            — systemd
#   zypper (openSUSE, SLES)           — systemd
#   apk    (Alpine Linux)             — OpenRC

set -euo pipefail

BACKEND_INPUT_URL="${1:-http://localhost:3000}"
NODE_ID="${2:-node-$(hostname -s 2>/dev/null || hostname)}"
NODE_API_KEY="${3:-}"
NODE_HOSTNAME="${4:-$(hostname -f 2>/dev/null || hostname)}"

NERDCTL_VERSION="2.2.1"
CNI_PLUGINS_VERSION="v1.4.1"

log() { echo "[deploy-agent] $*"; }
fail() { echo "[deploy-agent] ERROR: $*" >&2; exit 1; }

# --- Auto-elevate to root if needed -----------------------------------------------
if [ "$EUID" -ne 0 ]; then
    if command -v sudo >/dev/null 2>&1; then
        log "Not running as root — re-executing with sudo ..."
        exec sudo -- "$(command -v bash || command -v sh)" "$0" "$@"
    else
        fail "This script must be run as root and sudo is not available."
    fi
fi
# ---------------------------------------------------------------------------

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

normalize_backend_urls() {
    BACKEND_HTTP_URL="${BACKEND_INPUT_URL%/}"
    case "$BACKEND_HTTP_URL" in
        ws://*)  BACKEND_HTTP_URL="http://${BACKEND_HTTP_URL#ws://}" ;;
        wss://*) BACKEND_HTTP_URL="https://${BACKEND_HTTP_URL#wss://}" ;;
    esac
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
# Package installation
# ---------------------------------------------------------------------------

install_base_packages() {
    local pm="$1"
    log "Installing system dependencies via $pm..."
    case "$pm" in
        apt)
            apt-get update -y
            apt-get install -y \
                ca-certificates curl wget jq tar gzip unzip \
                iproute2 iptables rsync util-linux e2fsprogs \
                containerd runc
            ;;
        apk)
            # Ensure the community repo is enabled (containerd lives there).
            if ! grep -rq '\[community\]' /etc/apk/repositories 2>/dev/null; then
                log "Enabling Alpine community repository..."
                sed -i 's|^#\\?\\(.*community\\)$|\\1|' /etc/apk/repositories 2>/dev/null || true
                apk update
            fi
            apk add --no-cache \
                ca-certificates curl wget jq tar gzip unzip \
                iproute2 iptables rsync util-linux e2fsprogs \
                containerd runc
            ;;
        yum)
            # On RHEL/CentOS 7 the containerd package may not be in the
            # default repos.  Try the package directly first, then fall back
            # to containerd.io (Docker CE repo).
            yum install -y \
                ca-certificates curl wget jq tar gzip unzip \
                iproute iptables rsync util-linux e2fsprogs \
                runc || true
            if ! rpm -q containerd >/dev/null 2>&1; then
                log "containerd not found in default repos — attempting containerd.io (Docker CE)..."
                yum install -y containerd.io 2>/dev/null || \
                    yum install -y containerd 2>/dev/null || \
                    fail "Could not install containerd.  Enable the Docker CE repo or install containerd manually."
            fi
            ;;
        dnf)
            # Fedora has containerd in the default repos.  RHEL 9 may need
            # the Docker CE repo — try containerd first, then containerd.io.
            dnf install -y \
                ca-certificates curl wget jq tar gzip unzip \
                iproute iptables rsync util-linux e2fsprogs \
                runc || true
            if ! rpm -q containerd >/dev/null 2>&1; then
                log "containerd not found in default repos — attempting containerd.io (Docker CE)..."
                dnf install -y containerd.io 2>/dev/null || \
                    dnf install -y containerd 2>/dev/null || \
                    fail "Could not install containerd.  Enable the Docker CE repo or install containerd manually."
            fi
            ;;
        pacman)
            pacman -Sy --noconfirm \
                ca-certificates curl wget jq tar gzip unzip \
                iproute2 iptables rsync util-linux e2fsprogs \
                containerd runc
            ;;
        zypper)
            zypper --non-interactive install \
                ca-certificates curl wget jq tar gzip unzip \
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
        log "nerdctl already installed: $(nerdctl --version 2>/dev/null || true)"
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
}

# ---------------------------------------------------------------------------
# CNI plugins
# ---------------------------------------------------------------------------

install_cni_plugins() {
    local required=(bridge host-local portmap macvlan)
    # Every known CNI plugin directory across distros:
    #   /opt/cni/bin       — upstream tarball / Debian packages
    #   /usr/libexec/cni   — Fedora / RHEL packages
    #   /usr/lib/cni       — Arch / Alpine / openSUSE packages
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
            # Arch official repo uses "cni-plugins", NOT "containernetworking-plugins".
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
    log "CNI plugins installed from upstream tarball"
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
    mkdir -p /opt/catalyst-agent
    mkdir -p /var/lib/catalyst/{backups,images,migrate}
    mkdir -p /etc/cni/net.d
    mkdir -p /var/lib/cni/networks
    mkdir -p /tmp/catalyst-console
    chmod 0755 /tmp/catalyst-console
}

# ---------------------------------------------------------------------------
# Agent binary
# ---------------------------------------------------------------------------

install_agent_binary() {
    local agent_arch
    case "$(uname -m)" in
        x86_64|amd64) agent_arch="x86_64" ;;
        aarch64|arm64) agent_arch="aarch64" ;;
        *) fail "Unsupported architecture for agent binary: $(uname -m)" ;;
    esac
    log "Downloading Catalyst Agent binary (${agent_arch}) from ${BACKEND_HTTP_URL}/api/agent/download"
    if curl -fsSL "${BACKEND_HTTP_URL}/api/agent/download?arch=${agent_arch}" -o /opt/catalyst-agent/catalyst-agent; then
        [ -s /opt/catalyst-agent/catalyst-agent ] || fail "Downloaded agent binary is empty."
        chmod 0755 /opt/catalyst-agent/catalyst-agent
        return 0
    fi

    if [ -f "$(pwd)/target/release/catalyst-agent" ]; then
        cp "$(pwd)/target/release/catalyst-agent" /opt/catalyst-agent/catalyst-agent
        chmod 0755 /opt/catalyst-agent/catalyst-agent
        return 0
    fi

    fail "Agent binary not found and download failed."
}

# ---------------------------------------------------------------------------
# Agent configuration
# ---------------------------------------------------------------------------

write_config() {
    local escaped_backend escaped_node escaped_api_key escaped_hostname
    escaped_backend="$(toml_escape "$BACKEND_WS_URL")"
    escaped_node="$(toml_escape "$NODE_ID")"
    escaped_api_key="$(toml_escape "$NODE_API_KEY")"
    escaped_hostname="$(toml_escape "$NODE_HOSTNAME")"

    cat > /opt/catalyst-agent/config.toml <<EOF
[server]
backend_url = "${escaped_backend}"
node_id = "${escaped_node}"
api_key = "${escaped_api_key}"
hostname = "${escaped_hostname}"
data_dir = "/var/lib/catalyst"
max_connections = 100

[containerd]
socket_path = "/run/containerd/containerd.sock"
namespace = "catalyst"

[logging]
level = "info"
format = "json"
EOF

    chmod 0600 /opt/catalyst-agent/config.toml
}

# ---------------------------------------------------------------------------
# Service management — systemd
# ---------------------------------------------------------------------------

write_systemd_unit() {
    cat > /etc/systemd/system/catalyst-agent.service <<'EOF'
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
# - /var/lib/catalyst (server data, backups)
# - /var/lib/cni and /etc/cni/net.d (container networking)
# - /tmp/catalyst-console (console I/O pipes)
NoNewPrivileges=false
ProtectSystem=false
ProtectHome=false
PrivateTmp=false

# Ensure access to required paths
ReadWritePaths=/var/lib/catalyst /tmp/catalyst-console /etc/cni/net.d /var/lib/cni /mnt /run/containerd

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
        systemctl status containerd --no-pager >&2 || true
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
        journalctl -u catalyst-agent -n 50 --no-pager >&2 || true
        fail "catalyst-agent failed to start."
    }
    [ -S /run/containerd/containerd.sock ] || fail "containerd socket is missing."
    log "Installation complete."
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
    # Ensure containerd is running
    if [ -e /etc/init.d/containerd ]; then
        if ! rc-service containerd status >/dev/null 2>&1; then
            log "Starting containerd via OpenRC..."
            rc-service containerd start || \
                rc-update add containerd default && rc-service containerd start
        fi
    else
        # No init script — try starting containerd directly
        if ! pgrep -x containerd >/dev/null 2>&1; then
            log "Starting containerd directly..."
            containerd &
            sleep 2
        fi
    fi

    # Wait for the socket
    local attempts=30 i
    for i in $(seq 1 "$attempts"); do
        [ -S /run/containerd/containerd.sock ] && break
        sleep 1
    done

    if [ ! -S /run/containerd/containerd.sock ]; then
        fail "containerd socket is not available.  Ensure containerd is running."
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
    log "Installation complete."
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
    log "=== Catalyst Agent Installation ==="
    log "Node ID: ${NODE_ID}"

    normalize_backend_urls
    log "Backend HTTP URL: ${BACKEND_HTTP_URL}"
    log "Backend WS URL: ${BACKEND_WS_URL}"

    local pkg_manager init_system
    pkg_manager="$(detect_pkg_manager)"
    [ -n "$pkg_manager" ] || fail "No supported package manager found."
    log "Package manager: ${pkg_manager}"

    init_system="$(detect_init_system)"
    log "Init system:     ${init_system}"

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

    log "View logs with: journalctl -u catalyst-agent -f  (systemd)"
    log "             or: cat /var/log/catalyst-agent.log   (OpenRC)"
}

main "$@"
