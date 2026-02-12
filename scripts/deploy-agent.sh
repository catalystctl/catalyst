#!/usr/bin/env bash

# Catalyst Agent Deployment Script
# Installs and configures the Catalyst Agent on a fresh node

set -euo pipefail

BACKEND_INPUT_URL="${1:-http://localhost:3000}"
NODE_ID="${2:-node-$(hostname -s 2>/dev/null || hostname)}"
NODE_API_KEY="${3:-}"
NODE_HOSTNAME="${4:-$(hostname -f 2>/dev/null || hostname)}"

NERDCTL_VERSION="2.2.1"
CNI_PLUGINS_VERSION="v1.4.1"

log() { echo "[deploy-agent] $*"; }
fail() { echo "[deploy-agent] ERROR: $*" >&2; exit 1; }

if [ "$EUID" -ne 0 ]; then
    fail "This script must be run as root."
fi

if [ -z "$NODE_API_KEY" ]; then
    cat <<'USAGE' >&2
Usage: deploy-agent.sh <backend_url> <node_id> <node_api_key> [node_hostname]
USAGE
    exit 1
fi

detect_pkg_manager() {
    if command -v apt-get >/dev/null 2>&1; then echo "apt"; return; fi
    if command -v apk >/dev/null 2>&1; then echo "apk"; return; fi
    if command -v dnf >/dev/null 2>&1; then echo "dnf"; return; fi
    if command -v yum >/dev/null 2>&1; then echo "yum"; return; fi
    if command -v pacman >/dev/null 2>&1; then echo "pacman"; return; fi
    if command -v zypper >/dev/null 2>&1; then echo "zypper"; return; fi
    echo ""
}

os_arch() {
    case "$(uname -m)" in
        x86_64|amd64) echo "amd64" ;;
        aarch64|arm64) echo "arm64" ;;
        *)
            fail "Unsupported architecture: $(uname -m)"
            ;;
    esac
}

toml_escape() {
    printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

normalize_backend_urls() {
    BACKEND_HTTP_URL="${BACKEND_INPUT_URL%/}"
    case "$BACKEND_HTTP_URL" in
        ws://*) BACKEND_HTTP_URL="http://${BACKEND_HTTP_URL#ws://}" ;;
        wss://*) BACKEND_HTTP_URL="https://${BACKEND_HTTP_URL#wss://}" ;;
    esac
    BACKEND_HTTP_URL="${BACKEND_HTTP_URL%/}"
    BACKEND_HTTP_URL="${BACKEND_HTTP_URL%/ws}"
    BACKEND_HTTP_URL="${BACKEND_HTTP_URL%/}"

    BACKEND_WS_URL="$BACKEND_HTTP_URL"
    case "$BACKEND_WS_URL" in
        https://*) BACKEND_WS_URL="wss://${BACKEND_WS_URL#https://}" ;;
        http://*) BACKEND_WS_URL="ws://${BACKEND_WS_URL#http://}" ;;
    esac
    BACKEND_WS_URL="${BACKEND_WS_URL%/}"
    if [[ "$BACKEND_WS_URL" != */ws ]]; then
        BACKEND_WS_URL="${BACKEND_WS_URL}/ws"
    fi
}

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
            apk add --no-cache \
                ca-certificates curl wget jq tar gzip unzip \
                iproute2 iptables rsync util-linux e2fsprogs \
                containerd runc
            ;;
        yum)
            yum install -y \
                ca-certificates curl wget jq tar gzip unzip \
                iproute iptables rsync util-linux e2fsprogs \
                containerd runc
            ;;
        dnf)
            dnf install -y \
                ca-certificates curl wget jq tar gzip unzip \
                iproute iptables rsync util-linux e2fsprogs \
                containerd runc
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

install_nerdctl() {
    if command -v nerdctl >/dev/null 2>&1; then
        log "nerdctl already installed: $(nerdctl --version 2>/dev/null || true)"
        return 0
    fi

    local arch
    arch="$(os_arch)"
    local url="https://github.com/containerd/nerdctl/releases/download/v${NERDCTL_VERSION}/nerdctl-${NERDCTL_VERSION}-linux-${arch}.tar.gz"
    local archive="/tmp/nerdctl-${NERDCTL_VERSION}-${arch}.tar.gz"
    local extract_dir="/tmp/nerdctl-${NERDCTL_VERSION}-${arch}"

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

install_cni_plugins() {
    local required=(bridge host-local portmap macvlan)
    local cni_dirs=("/opt/cni/bin" "/usr/libexec/cni")
    local found_dir=""

    # Check if plugins exist in any known directory
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

    mkdir -p /opt/cni/bin
    local arch
    arch="$(os_arch)"
    local url="https://github.com/containernetworking/plugins/releases/download/${CNI_PLUGINS_VERSION}/cni-plugins-linux-${arch}-${CNI_PLUGINS_VERSION}.tgz"
    local archive="/tmp/cni-plugins-${CNI_PLUGINS_VERSION}-${arch}.tgz"

    log "Installing CNI plugins ${CNI_PLUGINS_VERSION} (${arch})..."
    curl -fsSL "$url" -o "$archive"
    tar -xzf "$archive" -C /opt/cni/bin
    rm -f "$archive"

    for plugin in "${required[@]}"; do
        [ -x "/opt/cni/bin/${plugin}" ] || fail "Missing required CNI plugin: ${plugin}"
    done
}

ensure_containerd_config() {
    mkdir -p /etc/containerd
    if [ ! -s /etc/containerd/config.toml ]; then
        log "Generating /etc/containerd/config.toml"
        containerd config default > /etc/containerd/config.toml
    fi

    if grep -q 'SystemdCgroup = false' /etc/containerd/config.toml; then
        sed -i 's/SystemdCgroup = false/SystemdCgroup = true/g' /etc/containerd/config.toml
    elif ! grep -q 'SystemdCgroup = true' /etc/containerd/config.toml; then
        cat >> /etc/containerd/config.toml <<'EOF'

[plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runc.options]
  SystemdCgroup = true
EOF
    fi
}

prepare_directories() {
    log "Preparing filesystem layout..."
    mkdir -p /opt/catalyst-agent
    mkdir -p /var/lib/catalyst/{backups,images,migrate}
    mkdir -p /etc/cni/net.d
    mkdir -p /var/lib/cni/networks
    mkdir -p /tmp/catalyst-console
    chmod 0755 /tmp/catalyst-console
}

install_agent_binary() {
    log "Downloading Catalyst Agent binary from ${BACKEND_HTTP_URL}/api/agent/download"
    if curl -fsSL "${BACKEND_HTTP_URL}/api/agent/download" -o /opt/catalyst-agent/catalyst-agent; then
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

require_systemd() {
    command -v systemctl >/dev/null 2>&1 || fail "systemctl is required for deployment."
}

ensure_containerd_service() {
    systemctl unmask containerd >/dev/null 2>&1 || true
    systemctl reset-failed containerd >/dev/null 2>&1 || true
}

wait_for_containerd() {
    local attempts=30
    local i
    for i in $(seq 1 "$attempts"); do
        if systemctl is-active --quiet containerd; then
            return 0
        fi
        if [ -S /run/containerd/containerd.sock ]; then
            log "containerd socket is present; proceeding despite inactive systemd state"
            return 0
        fi
        sleep 1
    done

    systemctl status containerd --no-pager >&2 || true
    journalctl -u containerd -n 80 --no-pager >&2 || true
    fail "containerd failed to start. Review the logs above and /etc/containerd/config.toml."
}

start_services() {
    systemctl daemon-reload
    ensure_containerd_service
    log "Enabling and starting containerd..."
    systemctl enable --now containerd
    wait_for_containerd
    systemctl enable --now catalyst-agent
}

verify_install() {
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

main() {
    log "=== Catalyst Agent Installation ==="
    log "Node ID: ${NODE_ID}"

    normalize_backend_urls
    log "Backend HTTP URL: ${BACKEND_HTTP_URL}"
    log "Backend WS URL: ${BACKEND_WS_URL}"

    local pkg_manager
    pkg_manager="$(detect_pkg_manager)"
    [ -n "$pkg_manager" ] || fail "No supported package manager found."

    install_base_packages "$pkg_manager"
    install_nerdctl
    install_cni_plugins
    ensure_containerd_config
    prepare_directories
    install_agent_binary
    write_config
    write_systemd_unit
    require_systemd
    start_services
    verify_install

    log "View logs with: journalctl -u catalyst-agent -f"
}

main "$@"
