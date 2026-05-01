#!/bin/bash
# Catalyst Node Tuning Script
# Applies sysctl, conntrack, loop device, and systemd overrides.
# Idempotent and safe to re-run.

set -euo pipefail

SYSCTL_CONF="/etc/sysctl.d/99-catalyst.conf"
MODPROBE_LOOP="/etc/modprobe.d/loop.conf"
MODPROBE_CONNTRACK="/etc/modprobe.d/catalyst.conf"
SERVICE_OVERRIDE_DIR="/etc/systemd/system/catalyst-agent.service.d"
SERVICE_OVERRIDE="${SERVICE_OVERRIDE_DIR}/limits.conf"

log() {
  echo "[catalyst-tune] $*"
}

# ---------------------------------------------------------------------------
# 1. Sysctl tuning
# ---------------------------------------------------------------------------
log "Writing ${SYSCTL_CONF} ..."

cat > "${SYSCTL_CONF}" <<'EOF'
# File descriptors
fs.file-max = 2097152
fs.nr_open = 2097152

# Inotify
fs.inotify.max_user_instances = 8192
fs.inotify.max_user_watches = 524288

# Process/thread limits
kernel.threads-max = 4194304
kernel.pid_max = 4194304

# Memory maps (critical for JVM-based game servers)
vm.max_map_count = 2621440

# Network ports
net.ipv4.ip_local_port_range = 1024 65535

# Connection tracking (NAT)
net.netfilter.nf_conntrack_max = 2000000
net.netfilter.nf_conntrack_tcp_timeout_established = 86400
net.netfilter.nf_conntrack_udp_timeout = 60
net.netfilter.nf_conntrack_udp_timeout_stream = 120

# TCP performance
net.core.rmem_max = 134217728
net.core.wmem_max = 134217728
net.ipv4.tcp_rmem = 4096 87380 134217728
net.ipv4.tcp_wmem = 4096 65536 134217728
net.core.netdev_max_backlog = 50000
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 65535
net.ipv4.tcp_congestion_control = bbr
net.ipv4.tcp_notsent_lowat = 16384

# Bridge / forwarding
net.bridge.bridge-nf-call-iptables = 1
net.ipv4.ip_forward = 1
net.ipv4.conf.all.forwarding = 1

# Virtual memory
vm.dirty_ratio = 40
vm.dirty_background_ratio = 10
vm.swappiness = 10
vm.vfs_cache_pressure = 50
EOF

log "Applying sysctl --system ..."
sysctl --system >/dev/null 2>&1 || sysctl -p "${SYSCTL_CONF}" >/dev/null 2>&1

# ---------------------------------------------------------------------------
# 2. Conntrack hashsize (must be >= max/8)
# ---------------------------------------------------------------------------
log "Setting conntrack hashsize ..."
if [[ -w /sys/module/nf_conntrack/parameters/hashsize ]]; then
  echo 524288 > /sys/module/nf_conntrack/parameters/hashsize || true
fi

# Ensure module option persists across reboots
mkdir -p "$(dirname "${MODPROBE_CONNTRACK}")"
if ! grep -q "options nf_conntrack hashsize=524288" "${MODPROBE_CONNTRACK}" 2>/dev/null; then
  echo 'options nf_conntrack hashsize=524288' >> "${MODPROBE_CONNTRACK}"
fi

# ---------------------------------------------------------------------------
# 3. Loop devices
# ---------------------------------------------------------------------------
log "Configuring loop devices ..."
mkdir -p "$(dirname "${MODPROBE_LOOP}")"
if ! grep -q "options loop max_loop=512" "${MODPROBE_LOOP}" 2>/dev/null; then
  echo 'options loop max_loop=512' > "${MODPROBE_LOOP}"
fi

# Reload loop module only if safe (no active loop devices)
if command -v losetup &>/dev/null; then
  ACTIVE_LOOPS=$(losetup -a 2>/dev/null | wc -l || echo 0)
  if [[ "${ACTIVE_LOOPS}" -eq 0 ]]; then
    modprobe -r loop 2>/dev/null || true
    modprobe loop 2>/dev/null || true
  else
    log "Skipping loop module reload (active loop devices detected)."
  fi
else
  modprobe -r loop 2>/dev/null || true
  modprobe loop 2>/dev/null || true
fi

# ---------------------------------------------------------------------------
# 4. Systemd override for catalyst-agent.service
# ---------------------------------------------------------------------------
log "Creating systemd override ${SERVICE_OVERRIDE} ..."
mkdir -p "${SERVICE_OVERRIDE_DIR}"

cat > "${SERVICE_OVERRIDE}" <<'EOF'
[Service]
LimitNOFILE=1048576
LimitNOFILESoft=1048576
TasksMax=infinity
MemoryMax=4G
MemorySwapMax=0
EOF

systemctl daemon-reload

if systemctl is-active --quiet catalyst-agent 2>/dev/null; then
  log "Restarting catalyst-agent.service ..."
  systemctl restart catalyst-agent || true
else
  log "catalyst-agent.service not active; override written but not restarted."
fi

log "Catalyst node tuning applied successfully."
