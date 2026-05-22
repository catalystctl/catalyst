#!/usr/bin/env bash
# ============================================================
# fix-containerd-events.sh
# Diagnose and fix containerd events service when it's deadlocked.
# Run as root on the Catalyst node.
# Usage:  sudo bash fix-containerd-events.sh
# ============================================================
set -uo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC} $*"; }
err()  { echo -e "${RED}✗${NC} $*"; }
info() { echo -e "${CYAN}→${NC} $*"; }

# ------------------------------------------------------------------
# Phase 1 — Reproduce the bug
# ------------------------------------------------------------------
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Phase 1: Test containerd events service"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

info "Running 'ctr events' with 3-second timeout..."

if timeout 3 ctr events >/dev/null 2>&1; then
    ok "Events service is responsive — no fix needed."
    exit 0
fi

RC=$?
if [ "$RC" -eq 124 ]; then
    warn "ctr events timed out after 3s → events service is DEADLOCKED."
elif [ "$RC" -ne 0 ]; then
    warn "ctr events failed with exit code $RC."
fi

# ------------------------------------------------------------------
# Phase 2 — Diagnose
# ------------------------------------------------------------------
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Phase 2: Diagnose"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 2a — Which package provides containerd?
info "Checking containerd packaging..."

if dpkg -l containerd.io 2>/dev/null | grep -q '^ii'; then
    VER=$(dpkg -l containerd.io | grep '^ii' | awk '{print $3}')
    ok "containerd.io (upstream Docker package) — version $VER"
    PACKAGE_OK=true
elif dpkg -l containerd 2>/dev/null | grep -q '^ii'; then
    VER=$(dpkg -l containerd | grep '^ii' | awk '{print $3}')
    warn "containerd (Debian system package) — version $VER"
    warn "Debian's containerd build is known to ship a broken events service."
    PACKAGE_OK=false
else
    warn "Could not determine containerd package source."
    PACKAGE_OK=false
fi

# 2b — Is the events plugin loaded?
info "Checking containerd plugins for events..."

if ctr plugins ls 2>/dev/null | grep -qi 'events'; then
    ok "Events plugin is present in containerd plugin list."
else
    err "Events plugin NOT found in containerd plugin list!"
fi

# 2c — Check recent containerd logs
info "Last 15 lines of containerd journal:"
journalctl -u containerd --no-pager -n 15 2>/dev/null || warn "(journalctl not available or containerd not running via systemd)"

# 2d — Check systemd status
if systemctl is-active --quiet containerd 2>/dev/null; then
    ok "containerd.service is active."
elif systemctl is-active --quiet containerd.io 2>/dev/null; then
    ok "containerd.io.service is active."
else
    err "No containerd systemd unit found active."
fi

# ------------------------------------------------------------------
# Phase 3 — Decide action
# ------------------------------------------------------------------
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Phase 3: Determine fix"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# If we're on the upstream containerd.io package, a restart might fix it.
if [ "${PACKAGE_OK:-false}" = "true" ]; then
    info "Running upstream containerd.io — trying restart first."
    systemctl restart containerd || systemctl restart containerd.io || true
    sleep 2

    info "Retesting ctr events..."
    if timeout 3 ctr events >/dev/null 2>&1; then
        ok "Restart fixed the events service!"
        exit 0
    fi
    warn "Restart did not fix it. The events service is persistently broken."
    warn "Try: apt-get install --reinstall containerd.io"
    echo "   Or: check /etc/containerd/config.toml for misconfiguration."
    exit 1
fi

# We're on the Debian system package → reinstall with the upstream one.
echo ""
warn "Debian-packaged containerd has a known-broken events service."
info "Replacing with the upstream containerd.io package from Docker..."

# Ask for confirmation (can skip with --yes)
if [ "${1:-}" != "--yes" ]; then
    echo ""
    echo -n "Proceed with reinstall? This will NOT affect running containers. [y/N] "
    read -r CONFIRM
    if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
        echo "Aborted."
        exit 0
    fi
fi

# ------------------------------------------------------------------
# Phase 4 — Reinstall containerd from upstream
# ------------------------------------------------------------------
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Phase 4: Reinstall containerd (upstream)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Detect distro
if [ -f /etc/os-release ]; then
    . /etc/os-release
    DISTRO_ID="${ID:-unknown}"
    VERSION_CODENAME="${VERSION_CODENAME:-}"
else
    DISTRO_ID="unknown"
fi

info "Detected distro: $DISTRO_ID ($VERSION_CODENAME)"

case "$DISTRO_ID" in
    debian)
        CODENAME="${VERSION_CODENAME:-bookworm}"
        REPO_URL="https://download.docker.com/linux/debian"
        ;;
    ubuntu)
        CODENAME="${VERSION_CODENAME:-noble}"
        REPO_URL="https://download.docker.com/linux/ubuntu"
        ;;
    *)
        err "Unsupported distro: $DISTRO_ID"
        echo "  Manual fix: follow https://github.com/containerd/containerd/blob/main/docs/getting-started.md"
        exit 1
        ;;
esac

info "Adding Docker APT repository for $DISTRO_ID $CODENAME..."

# Install prerequisites
apt-get update -qq
apt-get install -y -qq ca-certificates curl gpg 2>/dev/null

# Add Docker GPG key
install -m 0755 -d /etc/apt/keyrings
curl -fsSL "${REPO_URL}/gpg" | gpg --dearmor -o /etc/apt/keyrings/docker.gpg 2>/dev/null
chmod a+r /etc/apt/keyrings/docker.gpg

# Add repo
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] ${REPO_URL} ${CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list

apt-get update -qq

info "Removing Debian containerd package (containers keep running)..."
systemctl stop containerd 2>/dev/null || true
apt-get remove -y containerd 2>/dev/null || true

info "Installing containerd.io from Docker repo..."
apt-get install -y containerd.io 2>/dev/null || {
    err "Failed to install containerd.io."
    exit 1
}

# Ensure the default config exists
if [ ! -f /etc/containerd/config.toml ]; then
    info "Generating default containerd config..."
    mkdir -p /etc/containerd
    containerd config default > /etc/containerd/config.toml
fi

# Re-apply the socket group override if the catalyst user needs it
if [ -d /etc/systemd/system/containerd.service.d ] && [ -f /etc/systemd/system/containerd.service.d/override.conf ]; then
    ok "Socket permissions override already present."
else
    GROUP_EXISTS=false
    if getent group containerd >/dev/null 2>&1; then
        GROUP_EXISTS=true
    fi
    AGENT_USER="${SUDO_USER:-root}"
    if [ "$AGENT_USER" != "root" ] && [ "$GROUP_EXISTS" = "true" ]; then
        info "Re-creating containerd socket group override for user '$AGENT_USER'..."
        usermod -aG containerd "$AGENT_USER" 2>/dev/null || true
        mkdir -p /etc/systemd/system/containerd.service.d
        cat > /etc/systemd/system/containerd.service.d/override.conf <<'EOF'
[Service]
ExecStartPre=-/bin/chown root:containerd /run/containerd
ExecStartPost=-/bin/chmod 660 /run/containerd/containerd.sock
EOF
        systemctl daemon-reload
    fi
fi

info "Starting containerd..."
systemctl start containerd
sleep 2

# ------------------------------------------------------------------
# Phase 5 — Verify
# ------------------------------------------------------------------
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Phase 5: Verify fix"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

containerd --version 2>/dev/null || true

info "Testing ctr events..."
if timeout 3 ctr events >/dev/null 2>&1; then
    ok "Events service is working!"
    echo ""
    ok "Fix complete. Restart the Catalyst agent to enable event monitoring."
    exit 0
else
    err "Events service STILL unresponsive after reinstall."
    err "This may be a kernel or cgroup issue. Check: dmesg | tail -30"
    exit 1
fi
