#!/usr/bin/env bash
# Reusable Catalyst LXC E2E pipeline: install.sh → panel → node → Minecraft Paper.
#
# One panel LXC runs the official install.sh stack (what users run).
# One node LXC runs the panel-issued deploy-agent.sh (isolated from any
# host agent). Then a Paper server is created, installed, started and verified.
#
# Usage:
#   ./tests/e2e-lxc/e2e-minecraft.sh all        # full pipeline (default)
#   ./tests/e2e-lxc/e2e-minecraft.sh create     # create both LXCs
#   ./tests/e2e-lxc/e2e-minecraft.sh install    # install.sh + compose up in panel
#   ./tests/e2e-lxc/e2e-minecraft.sh bootstrap  # setup, location, node, paper egg
#   ./tests/e2e-lxc/e2e-minecraft.sh agent      # deploy agent into node LXC
#   ./tests/e2e-lxc/e2e-minecraft.sh minecraft  # create/install/start Paper + verify
#   ./tests/e2e-lxc/e2e-minecraft.sh verify     # re-verify a finished run
#   ./tests/e2e-lxc/e2e-minecraft.sh status     # human-readable state
#   ./tests/e2e-lxc/e2e-minecraft.sh destroy    # delete both LXCs + state
#
# Configuration: environment variables or CONFIG=/path/to.env (see config.env).
# State, per-stage logs and junit.xml land in $E2E_STATE_DIR.
#
# Node modes (E2E_NODE_MODE):
#   host (default) — isolated second agent on this host (own config, data
#     dir, containerd namespace, CNI set, SFTP port). The host's own agent
#     is never touched. Required because unprivileged LXCs cannot loop-mount
#     the agent's ext4 disk images.
#   lxc — agent deploys into E2E_NODE_LXC; only works with a PRIVILEGED
#     container for the same loop-mount reason.
set -euo pipefail

E2E_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$E2E_DIR/lib.sh"

E2E_API_BASE="${E2E_PUBLIC_URL}"
E2E_AUTH_TOKEN="${E2E_AUTH_TOKEN:-}"
E2E_LOCATION_ID="${E2E_LOCATION_ID:-}"
E2E_NODE_ID="${E2E_NODE_ID:-}"
E2E_PAPER_TEMPLATE_ID="${E2E_PAPER_TEMPLATE_ID:-}"
E2E_MC_SERVER_ID="${E2E_MC_SERVER_ID:-}"
e2e_load_state
# State file wins over the environment for resume; explicit env overrides win
# over stale state only when the caller exports them before invoking.
if [[ -f "$E2E_STATE_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$E2E_STATE_FILE"
fi
E2E_API_BASE="${E2E_PUBLIC_URL}"

# ---------------------------------------------------------------------------
# LXC helpers
# ---------------------------------------------------------------------------

e2e_append_tuning() {
  local name="$1" ip="$2" memory="$3"
  local cfg="$HOME/.local/share/lxc/${name}/config"
  [[ -f "$cfg" ]] || e2e_fail "missing LXC config $cfg"
  if ! grep -q "^lxc.include = /usr/share/lxc/config/nesting.conf" "$cfg"; then
    printf 'lxc.include = /usr/share/lxc/config/nesting.conf\n' >> "$cfg"
  fi
  # nesting.conf sets lxc.apparmor.profile=lxc-container-default-with-nesting
  # and LXC is last-wins: the include above would override the template's
  # "unconfined" line. The confined nesting profile denies recursive bind
  # mounts, which breaks containerd layer extraction (docker pull fails with
  # "permission denied" on tmpmounts). Force unconfined AFTER the include.
  sed -i '/^lxc\.apparmor\.profile[[:space:]]*=/d' "$cfg"
  printf 'lxc.apparmor.profile = unconfined\n' >> "$cfg"
  # Loop devices for the agent's per-server ext4 disk images (loop mounts).
  # The host provides /dev/loop*; bind them in and allow the block/char
  # major pairs, otherwise server start fails with
  # "mount ... failed: Operation not permitted" inside the node LXC.
  if ! grep -q "loop-control" "$cfg"; then
    cat >> "$cfg" <<EOF
lxc.cgroup2.devices.allow = b 7:* rwm
lxc.cgroup2.devices.allow = c 10:237 rwm
lxc.mount.entry = /dev/loop-control dev/loop-control none bind,create=file,optional 0 0
lxc.mount.entry = /dev/loop0 dev/loop0 none bind,create=file,optional 0 0
lxc.mount.entry = /dev/loop1 dev/loop1 none bind,create=file,optional 0 0
lxc.mount.entry = /dev/loop2 dev/loop2 none bind,create=file,optional 0 0
lxc.mount.entry = /dev/loop3 dev/loop3 none bind,create=file,optional 0 0
lxc.mount.entry = /dev/loop4 dev/loop4 none bind,create=file,optional 0 0
lxc.mount.entry = /dev/loop5 dev/loop5 none bind,create=file,optional 0 0
lxc.mount.entry = /dev/loop6 dev/loop6 none bind,create=file,optional 0 0
lxc.mount.entry = /dev/loop7 dev/loop7 none bind,create=file,optional 0 0
EOF
  fi
  if ! grep -q "lxc.cgroup2.memory.max" "$cfg"; then
    cat >> "$cfg" <<EOF
lxc.cgroup2.memory.max = ${memory}
lxc.cgroup.memory.limit_in_bytes = ${memory}
EOF
  fi
  if ! grep -q "lxc.net.0.ipv4.address" "$cfg"; then
    cat >> "$cfg" <<EOF
lxc.net.0.ipv4.address = ${ip}/${E2E_NETMASK}
lxc.net.0.ipv4.gateway = ${E2E_GATEWAY}
EOF
  fi
}

e2e_create_one() {
  local name="$1" ip="$2" memory="$3"
  if e2e_have_lxc "$name"; then
    e2e_log "LXC $name already exists"
  else
    e2e_log "Creating ${E2E_LXC_DISTRO} ${E2E_LXC_RELEASE} LXC $name"
    lxc-create -n "$name" -t download -- \
      -d "$E2E_LXC_DISTRO" -r "$E2E_LXC_RELEASE" -a "$E2E_LXC_ARCH" --force-cache
  fi
  local cfg="$HOME/.local/share/lxc/${name}/config"
  local before=""
  [[ -f "$cfg" ]] && before="$(md5sum "$cfg" | awk '{print $1}')"
  e2e_append_tuning "$name" "$ip" "$memory"
  local after=""
  [[ -f "$cfg" ]] && after="$(md5sum "$cfg" | awk '{print $1}')"
  if [[ "$before" != "$after" ]] && e2e_lxc_running "$name"; then
    e2e_log "Config changed for running $name — restarting to pick it up"
    lxc-stop -n "$name" -k || true
  fi
  if ! e2e_lxc_running "$name"; then
    e2e_log "Starting $name"
    lxc-start -n "$name" -d
  fi
  local got
  got="$(e2e_wait_for_ip "$name" "$ip" || true)"
  [[ -n "$got" ]] || e2e_fail "$name did not get IP $ip"
  e2e_log "$name is up at $got"
}

e2e_write_netplan() {
  local name="$1" ip="$2" tmp
  tmp="$(mktemp)"
  cat > "$tmp" <<EOF
network:
  version: 2
  ethernets:
    eth0:
      dhcp4: false
      addresses: [${ip}/${E2E_NETMASK}]
      routes:
        - to: default
          via: ${E2E_GATEWAY}
      nameservers:
        addresses: [1.1.1.1, 8.8.8.8]
EOF
  # Overwrite the image's 10-lxc.yaml (dhcp4:true): a second file merely
  # merges, leaving a secondary dynamic address that breaks IP expectations.
  e2e_push_file "$name" "$tmp" /etc/netplan/10-lxc.yaml
  rm -f "$tmp"
  e2e_lxc_exec "$name" bash -lc 'rm -f /etc/netplan/10-e2e.yaml; chmod 600 /etc/netplan/10-lxc.yaml; netplan apply 2>/dev/null || true' || true
}

stage_create() {
  e2e_ensure_host_tools
  e2e_create_one "$E2E_PANEL_LXC" "$E2E_PANEL_IP" "$E2E_PANEL_MEMORY"
  if [[ "${E2E_NODE_MODE:-host}" == "host" ]]; then
    e2e_log "E2E_NODE_MODE=host — no node LXC (isolated agent runs on this host)"
  else
    e2e_create_one "$E2E_NODE_LXC" "$E2E_NODE_IP" "$E2E_NODE_MEMORY"
    e2e_write_netplan "$E2E_NODE_LXC" "$E2E_NODE_IP"
  fi
  e2e_write_netplan "$E2E_PANEL_LXC" "$E2E_PANEL_IP"
}

# ---------------------------------------------------------------------------
# Panel install (official install.sh path)
# ---------------------------------------------------------------------------

e2e_install_docker_in_panel() {
  if e2e_lxc_exec "$E2E_PANEL_LXC" bash -lc 'command -v docker >/dev/null && docker compose version >/dev/null'; then
    e2e_log "Docker already present in $E2E_PANEL_LXC"
    return 0
  fi
  e2e_log "Installing Docker in $E2E_PANEL_LXC"
  e2e_lxc_exec "$E2E_PANEL_LXC" bash -lc '
    set -euo pipefail
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y
    apt-get install -y --no-install-recommends ca-certificates curl gnupg iptables
    install -m 0755 -d /etc/apt/keyrings
    if [[ ! -f /etc/apt/keyrings/docker.gpg ]]; then
      curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
      chmod a+r /etc/apt/keyrings/docker.gpg
    fi
    . /etc/os-release
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
      > /etc/apt/sources.list.d/docker.list
    apt-get update -y
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    systemctl enable --now docker
    docker compose version
  '
}

# install.sh downloads catalyst-docker from GitHub. With E2E_USE_LOCAL=1 the
# working tree's compose files are overlaid afterwards so uncommitted changes
# to catalyst-docker/ are what actually boots (images stay GHCR :latest —
# full local image builds are covered by catalyst-docker/docker-compose.test.yml).
e2e_overlay_local_compose() {
  [[ "${E2E_USE_LOCAL}" == "1" ]] || return 0
  e2e_log "Overlaying working-tree catalyst-docker/ into panel LXC"
  local tmp
  tmp="$(mktemp -d)"
  (cd "$E2E_REPO_ROOT/catalyst-docker" && tar -cf - --exclude='.env' .) | (cd "$tmp" && tar -xf -)
  for f in docker-compose.yml nginx/default.conf.template update.sh diagnose.sh; do
    [[ -f "$tmp/$f" ]] || continue
    e2e_push_file "$E2E_PANEL_LXC" "$tmp/$f" "/root/catalyst-docker/$f"
  done
  rm -rf "$tmp"
}

stage_install() {
  e2e_install_docker_in_panel
  e2e_log "Running install.sh -y in $E2E_PANEL_LXC (PUBLIC_URL=${E2E_PUBLIC_URL})"
  e2e_lxc_exec "$E2E_PANEL_LXC" bash -lc 'export DEBIAN_FRONTEND=noninteractive; apt-get update -y >/dev/null; apt-get install -y --no-install-recommends openssl tar ca-certificates curl jq >/dev/null'
  if [[ "${E2E_USE_LOCAL}" == "1" ]]; then
    e2e_push_file "$E2E_PANEL_LXC" "$E2E_REPO_ROOT/install.sh" /root/install.sh
    e2e_lxc_exec "$E2E_PANEL_LXC" bash -lc "
      set -euo pipefail
      cd /root
      chmod +x /root/install.sh
      export PUBLIC_URL='${E2E_PUBLIC_URL}'
      export APP_NAME='${E2E_APP_NAME}'
      bash /root/install.sh -y
    "
  else
    e2e_lxc_exec "$E2E_PANEL_LXC" bash -lc "
      set -euo pipefail
      cd /root
      curl -fsSL 'https://raw.githubusercontent.com/${E2E_REPO}/${E2E_BRANCH}/install.sh' -o install.sh
      chmod +x install.sh
      export PUBLIC_URL='${E2E_PUBLIC_URL}'
      export APP_NAME='${E2E_APP_NAME}'
      bash install.sh -y
    "
  fi
  e2e_overlay_local_compose
  e2e_log "Starting panel stack"
  e2e_lxc_exec "$E2E_PANEL_LXC" bash -lc 'set -euo pipefail; cd /root/catalyst-docker; docker compose up -d; docker compose ps'
  # BACKEND_PORT stays loopback-bound (install.sh default): probe the backend
  # from inside the LXC, exactly as the compose healthcheck does.
  e2e_log "Waiting for backend health (inside panel LXC)"
  e2e_lxc_exec "$E2E_PANEL_LXC" bash -lc '
    for i in $(seq 1 40); do
      curl -fsS --max-time 5 http://localhost:3000/health >/dev/null 2>&1 && exit 0
      sleep 3
    done
    exit 1
  ' || e2e_fail "backend /health never came up"
  e2e_log "Waiting for panel nginx"
  e2e_wait_http "${E2E_PUBLIC_URL}/" 40 || e2e_fail "panel nginx never came up at ${E2E_PUBLIC_URL}"
}

# ---------------------------------------------------------------------------
# Bootstrap: setup → login → location → node → allocations → Paper egg
# ---------------------------------------------------------------------------

stage_bootstrap() {
  rm -f "$E2E_COOKIE_JAR"
  E2E_API_BASE="${E2E_PUBLIC_URL}"
  local status needed
  status="$(curl -fsS "${E2E_PUBLIC_URL}/api/setup/status")"
  needed="$(printf '%s' "$status" | jq -r '.setupRequired')"
  if [[ "$needed" == "true" ]]; then
    e2e_log "Running first-run setup"
    e2e_api POST /api/setup/complete "$(jq -n \
      --arg email "$E2E_ADMIN_EMAIL" \
      --arg username "$E2E_ADMIN_USERNAME" \
      --arg password "$E2E_ADMIN_PASSWORD" \
      --arg panelName "$E2E_APP_NAME" \
      '{email:$email,username:$username,password:$password,panelName:$panelName,defaultTheme:"dark"}')" \
      | tee "${E2E_LOG_DIR}/setup.json" >/dev/null
  else
    e2e_log "Setup already complete"
  fi
  e2e_log "Logging in as $E2E_ADMIN_EMAIL"
  local login
  login="$(e2e_api POST /api/auth/login "$(jq -n --arg email "$E2E_ADMIN_EMAIL" --arg password "$E2E_ADMIN_PASSWORD" '{email:$email,password:$password,rememberMe:true}')")"
  printf '%s\n' "$login" > "${E2E_LOG_DIR}/login.json"
  E2E_AUTH_TOKEN="$(printf '%s' "$login" | jq -r '.data.token // empty')"
  [[ -n "$E2E_AUTH_TOKEN" && "$E2E_AUTH_TOKEN" != "null" ]] || e2e_fail "login failed: $login"
  e2e_save_state E2E_AUTH_TOKEN "$E2E_AUTH_TOKEN"

  # Location
  local list id
  list="$(e2e_api GET /api/locations)"
  id="$(printf '%s' "$list" | jq -r --arg n "$E2E_LOCATION_NAME" '.data[]? | select(.name==$n) | .id' | head -1)"
  if [[ -z "$id" || "$id" == "null" ]]; then
    id="$(e2e_api POST /api/locations "$(jq -n --arg name "$E2E_LOCATION_NAME" --arg description "E2E pipeline" '{name:$name,description:$description}')" | jq -r '.data.id')"
  fi
  [[ -n "$id" && "$id" != "null" ]] || e2e_fail "could not create location"
  E2E_LOCATION_ID="$id"
  e2e_save_state E2E_LOCATION_ID "$id"

  # Minecraft nest
  local nests nest_id
  nests="$(e2e_api GET /api/nests)"
  nest_id="$(printf '%s' "$nests" | jq -r '.data[]? | select(.name=="Minecraft") | .id' | head -1)"
  if [[ -z "$nest_id" || "$nest_id" == "null" ]]; then
    nest_id="$(e2e_api POST /api/nests "$(jq -n '{name:"Minecraft"}')" | jq -r '.data.id')"
  fi
  [[ -n "$nest_id" && "$nest_id" != "null" ]] || e2e_fail "could not create Minecraft nest"
  e2e_save_state E2E_MINECRAFT_NEST_ID "$nest_id"

  # Node (publicAddress = where the agent is reachable; node LXC IP in lxc
  # mode, the host's lxcbr0 address in host mode).
  local nodes node_id node_addr
  node_addr="$(e2e_node_addr)"
  nodes="$(e2e_api GET /api/nodes)"
  node_id="$(printf '%s' "$nodes" | jq -r --arg n "$E2E_NODE_NAME" '.data[]? | select(.name==$n) | .id' | head -1)"
  if [[ -z "$node_id" || "$node_id" == "null" ]]; then
    node_id="$(e2e_api POST /api/nodes "$(jq -n \
      --arg name "$E2E_NODE_NAME" \
      --arg locationId "$E2E_LOCATION_ID" \
      --arg hostname "$E2E_NODE_LXC" \
      --arg publicAddress "$node_addr" \
      --argjson maxMemoryMb "$E2E_NODE_MAX_MEMORY_MB" \
      --argjson maxCpuCores "$E2E_NODE_MAX_CPU" \
      '{name:$name,locationId:$locationId,hostname:$hostname,publicAddress:$publicAddress,maxMemoryMb:$maxMemoryMb,maxCpuCores:$maxCpuCores,sftpPort:2022,sftpEnabled:true}')" \
      | tee "${E2E_LOG_DIR}/node.json" | jq -r '.data.id')"
  fi
  [[ -n "$node_id" && "$node_id" != "null" ]] || e2e_fail "could not create node"
  E2E_NODE_ID="$node_id"
  e2e_save_state E2E_NODE_ID "$node_id"

  # Allocation for the Minecraft port (bridge servers claim host ports;
  # creating the allocation first exercises the path users trip over).
  e2e_api POST "/api/nodes/${E2E_NODE_ID}/allocations" "$(jq -n \
    --arg ip "$node_addr" \
    --arg ports "${E2E_MC_PORT}" \
    '{ip:$ip,ports:$ports}')" >/dev/null || true

  # Paper egg import (idempotent by template name; hard fail — everything
  # downstream needs it)
  local egg="$E2E_REPO_ROOT/eggs/minecraft/java/paper/egg-paper.json"
  [[ -f "$egg" ]] || e2e_fail "missing egg $egg"
  local egg_name existing payload resp tid
  egg_name="$(jq -r '.name' "$egg")"
  existing="$(e2e_api GET /api/templates | jq -r --arg n "$egg_name" '.data[]? | select(.name==$n) | .id' | head -1)"
  if [[ -n "$existing" && "$existing" != "null" ]]; then
    E2E_PAPER_TEMPLATE_ID="$existing"
  else
    payload="$(jq --arg nestId "$nest_id" '. + {_category:null, nestId:$nestId}' "$egg")"
    resp="$(e2e_api POST /api/templates/import-pterodactyl "$payload")"
    printf '%s\n' "$resp" > "${E2E_LOG_DIR}/import-paper.json"
    tid="$(printf '%s' "$resp" | jq -r '.data.id // empty')"
    [[ -n "$tid" ]] || e2e_fail "egg import failed: $resp"
    E2E_PAPER_TEMPLATE_ID="$tid"
  fi
  e2e_save_state E2E_PAPER_TEMPLATE_ID "$E2E_PAPER_TEMPLATE_ID"

  if [[ "${E2E_TEMPLATES:-paper}" == "all" ]]; then
    e2e_import_all_eggs "$egg"
  fi
  e2e_log "Bootstrap complete: location=$E2E_LOCATION_ID node=$E2E_NODE_ID paper=$E2E_PAPER_TEMPLATE_ID"
}

# Import every egg under eggs/ (E2E_TEMPLATES=all). Nests are derived from
# the top-level egg directory ("minecraft" → "Minecraft"). Idempotent by
# template name; failures are collected and reported, never fatal (only the
# Paper import above is).
# $1 = paper egg path to skip (already imported).
e2e_import_all_eggs() {
  local skip="$1" f top nest_name nest_id egg_name payload resp tid
  local total=0 imported=0 skipped=0 failed=0
  declare -A seen_names=()
  : > "${E2E_LOG_DIR}/import-all-failures.txt"
  while IFS= read -r f; do
    [[ "$f" == "$skip" ]] && continue
    total=$((total + 1))
    egg_name="$(jq -r '.name // empty' "$f")"
    if [[ -z "$egg_name" ]]; then
      echo "$f: missing .name" >> "${E2E_LOG_DIR}/import-all-failures.txt"
      failed=$((failed + 1))
      continue
    fi
    if [[ -n "${seen_names[$egg_name]:-}" ]]; then
      skipped=$((skipped + 1))
      continue
    fi
    if e2e_api GET /api/templates 2>/dev/null | jq -e --arg n "$egg_name" '.data[]? | select(.name==$n)' >/dev/null; then
      seen_names["$egg_name"]=1
      skipped=$((skipped + 1))
      continue
    fi
    top="${f#$E2E_REPO_ROOT/eggs/}"
    top="${top%%/*}"
    [[ -n "$top" && "$top" != "$f" ]] || top="Misc"
    nest_name="$(tr '[:lower:]' '[:upper:]' <<< "${top:0:1}")${top:1}"
    nest_name="${nest_name//_/ }"
    nest_id="$(e2e_ensure_nest "$nest_name")"
    if [[ -z "$nest_id" || "$nest_id" == "null" ]]; then
      echo "$f: nest failed" >> "${E2E_LOG_DIR}/import-all-failures.txt"
      failed=$((failed + 1))
      continue
    fi
    payload="$(jq --arg nestId "$nest_id" '. + {_category:null, nestId:$nestId}' "$f")"
    resp="$(e2e_api POST /api/templates/import-pterodactyl "$payload")"
    tid="$(printf '%s' "$resp" | jq -r '.data.id // empty')"
    if [[ -n "$tid" ]]; then
      seen_names["$egg_name"]=1
      imported=$((imported + 1))
    else
      echo "$f: $(printf '%s' "$resp" | head -c 200)" >> "${E2E_LOG_DIR}/import-all-failures.txt"
      failed=$((failed + 1))
    fi
  done < <(find "$E2E_REPO_ROOT/eggs" -name 'egg-*.json' | sort)
  e2e_log "import-all: total=$total imported=$imported skipped=$skipped failed=$failed (see import-all-failures.txt)"
  [[ "$failed" -eq 0 ]] || e2e_warn "import-all had $failed failures (non-fatal)"
}

# Ensure a nest exists by name; prints its id.
e2e_ensure_nest() {
  local nests id
  nests="$(e2e_api GET /api/nests)"
  id="$(printf '%s' "$nests" | jq -r --arg n "$1" '.data[]? | select(.name==$n) | .id' | head -1)"
  if [[ -z "$id" || "$id" == "null" ]]; then
    id="$(e2e_api POST /api/nests "$(jq -n --arg name "$1" '{name:$name}')" | jq -r '.data.id')"
  fi
  printf '%s\n' "$id"
}

# ---------------------------------------------------------------------------
# Agent: deployment token → run deploy script inside the node LXC
# ---------------------------------------------------------------------------

stage_agent() {
  if [[ "${E2E_NODE_MODE:-host}" == "host" ]]; then
    stage_agent_host
  else
    stage_agent_lxc
  fi
}

# Isolated second agent on this host: own binary/config/data dir/containerd
# namespace/CNI plugins/bridge/SFTP port. The host's own agent is untouched.
stage_agent_host() {
  e2e_load_state
  [[ -n "${E2E_AUTH_TOKEN:-}" ]] || e2e_fail "missing auth token — run bootstrap first"
  [[ -n "${E2E_NODE_ID:-}" ]] || e2e_fail "missing node id — run bootstrap first"
  E2E_API_BASE="${E2E_PUBLIC_URL}"
  command -v nerdctl >/dev/null 2>&1 || e2e_fail "nerdctl missing on host"
  sudo -n true 2>/dev/null || e2e_fail "passwordless sudo required for host agent"

  local panel_ver
  panel_ver="$(e2e_api GET /api/agent/version | jq -r '.data.agentVersion // .agentVersion // empty')"
  [[ -n "$panel_ver" ]] || e2e_fail "could not read panel agent version"
  e2e_log "Panel agent version: $panel_ver"

  if [[ ! -x "$E2E_HOST_AGENT_BIN" ]] || ! "$E2E_HOST_AGENT_BIN" --version 2>/dev/null | grep -q "$panel_ver"; then
    e2e_log "Fetching agent $panel_ver from panel proxy"
    sudo mkdir -p "$(dirname "$E2E_HOST_AGENT_BIN")"
    curl -fsSL -H "Authorization: Bearer ${E2E_AUTH_TOKEN}" \
      "${E2E_PUBLIC_URL}/api/agent/download?arch=x86_64&version=${panel_ver}" \
      -o "${E2E_HOST_AGENT_BIN}.tmp"
    local expect actual
    expect="$(curl -fsSL -H "Authorization: Bearer ${E2E_AUTH_TOKEN}" \
      "${E2E_PUBLIC_URL}/api/agent/download-checksum?arch=x86_64&version=${panel_ver}" | awk '{print $1}')"
    actual="$(sha256sum "${E2E_HOST_AGENT_BIN}.tmp" | awk '{print $1}')"
    [[ "$expect" == "$actual" ]] || e2e_fail "agent checksum mismatch (expected $expect got $actual)"
    mv "${E2E_HOST_AGENT_BIN}.tmp" "$E2E_HOST_AGENT_BIN"
    chmod +x "$E2E_HOST_AGENT_BIN"
  fi

  # CNI plugins pinned like deploy-agent.sh (distro sets can predate the
  # 1.0.0 spec and break container DNS); isolated dir, host's own set untouched.
  if [[ ! -x "${E2E_HOST_CNI_DIR}/bridge" ]] || ! "${E2E_HOST_CNI_DIR}/bridge" 2>&1 | grep -q "1\.0\.0"; then
    e2e_log "Installing CNI plugins v1.9.0 to ${E2E_HOST_CNI_DIR}"
    mkdir -p "$E2E_HOST_CNI_DIR"
    curl -fsSL "https://github.com/containernetworking/plugins/releases/download/v1.9.0/cni-plugins-linux-amd64-v1.9.0.tgz" -o /tmp/e2e-cni.tgz
    echo "58c03705426e929658f45a851df15a86d06ef680cacbf3f2dc127731ca265c28  /tmp/e2e-cni.tgz" | sha256sum -c -
    tar -xzf /tmp/e2e-cni.tgz -C "$E2E_HOST_CNI_DIR"
    rm -f /tmp/e2e-cni.tgz
  fi

  e2e_log "Requesting deployment token for node $E2E_NODE_ID"
  local tok api_key
  tok="$(e2e_api POST "/api/nodes/${E2E_NODE_ID}/deployment-token" '{}')"
  printf '%s\n' "$tok" > "${E2E_LOG_DIR}/deploy-token.json"
  api_key="$(printf '%s' "$tok" | jq -r '.data.apiKey // .data.api_key // empty')"
  [[ -n "$api_key" && "$api_key" != "null" ]] || e2e_fail "no apiKey in: $tok"

  sudo mkdir -p "$E2E_HOST_AGENT_DATADIR"
  # NOTE: backend_url is always the PANEL (agents dial in); e2e_node_addr is
  # where game ports bind (probes/allocations), a different address in host mode.
  # CNI state dirs live under the e2e data dir so leases/results never
  # intermingle with the host's own agent.
  sudo mkdir -p "${E2E_HOST_AGENT_DATADIR}/cni-networks" "${E2E_HOST_AGENT_DATADIR}/cni-results"
  sudo tee "$E2E_HOST_AGENT_CONFIG" > /dev/null <<EOF
[server]
backend_url = "ws://${E2E_PANEL_IP}:${E2E_PANEL_PORT}/ws"
node_id = "${E2E_NODE_ID}"
api_key = "${api_key}"
hostname = "e2e-host-node"
data_dir = "${E2E_HOST_AGENT_DATADIR}"
max_connections = 100

[sftp]
port = ${E2E_HOST_AGENT_SFTP_PORT}

[containerd]
socket_path = "/run/containerd/containerd.sock"
namespace = "${E2E_HOST_AGENT_NAMESPACE}"
cni_bin_dir = "${E2E_HOST_CNI_DIR}"
cni_data_dir = "${E2E_HOST_AGENT_DATADIR}/cni-networks"
cni_results_dir = "${E2E_HOST_AGENT_DATADIR}/cni-results"
cni_bridge_name = "${E2E_HOST_BRIDGE}"
cni_bridge_subnet = "${E2E_HOST_SUBNET}"

[logging]
level = "info"
format = "json"

[agent]
release_repo = "catalystctl/catalyst"
EOF
  sudo chmod 600 "$E2E_HOST_AGENT_CONFIG"

  if p=$(e2e_host_agent_pid "$E2E_HOST_AGENT_CONFIG"); then
    e2e_log "Stopping previous host agent (pid $p)"
    sudo kill "$p" 2>/dev/null || true
    sleep 2
  fi
  e2e_log "Starting isolated host agent"
  sudo nohup "$E2E_HOST_AGENT_BIN" --config "$E2E_HOST_AGENT_CONFIG" > "$E2E_HOST_AGENT_LOG" 2>&1 &
  sleep 3
  if p=$(e2e_host_agent_pid "$E2E_HOST_AGENT_CONFIG"); then
    echo "$p" | sudo tee "$E2E_HOST_AGENT_PIDFILE" > /dev/null
    e2e_log "Host agent running (pid $p)"
  else
    e2e_fail "host agent did not start (see ${E2E_HOST_AGENT_LOG})"
  fi

  e2e_log "Waiting for node to report online"
  local i status
  for i in $(seq 1 40); do
    status="$(e2e_api GET "/api/nodes/${E2E_NODE_ID}" | jq -r '.data.isOnline // .data.status // empty')"
    if e2e_api GET /api/nodes | jq -e --arg id "$E2E_NODE_ID" '.data[] | select(.id==$id) | (.isOnline==true or .status=="online")' >/dev/null 2>&1; then
      e2e_log "Node is online via host agent"
      return 0
    fi
    sleep 3
  done
  e2e_fail "node never came online (see ${E2E_HOST_AGENT_LOG})"
}

stage_agent_lxc() {
  e2e_load_state
  [[ -n "${E2E_AUTH_TOKEN:-}" ]] || e2e_fail "missing auth token — run bootstrap first"
  [[ -n "${E2E_NODE_ID:-}" ]] || e2e_fail "missing node id — run bootstrap first"
  E2E_API_BASE="${E2E_PUBLIC_URL}"

  e2e_log "Requesting deployment token for node $E2E_NODE_ID"
  local tok deploy_url api_key
  tok="$(e2e_api POST "/api/nodes/${E2E_NODE_ID}/deployment-token" '{}')"
  printf '%s\n' "$tok" > "${E2E_LOG_DIR}/deploy-token.json"
  deploy_url="$(printf '%s' "$tok" | jq -r '.data.deployUrl // .data.deploy_url // empty')"
  api_key="$(printf '%s' "$tok" | jq -r '.data.apiKey // .data.api_key // empty')"
  [[ -n "$deploy_url" && "$deploy_url" != "null" ]] || e2e_fail "no deployUrl in: $tok"
  [[ -n "$api_key" && "$api_key" != "null" ]] || e2e_fail "no apiKey in: $tok"

  # The deploy URL embeds the panel's BACKEND_URL view of itself; inside the
  # node LXC the panel is reachable at the LXC IP, so rewrite the host part
  # when it points at localhost or a different interface.
  local panel_base="http://${E2E_PANEL_IP}:3000"
  if [[ "$deploy_url" == *"localhost"* || "$deploy_url" == *"127.0.0.1"* ]]; then
    deploy_url="${deploy_url//localhost/${E2E_PANEL_IP}}"
    deploy_url="${deploy_url//127.0.0.1/${E2E_PANEL_IP}}"
  fi
  e2e_log "Deploy URL: $deploy_url (panel base for agent: $panel_base)"

  local script
  script="$(mktemp /tmp/catalyst-e2e-deploy.XXXXXX.sh)"
  curl -fsSL -H "Authorization: Bearer ${api_key}" "$deploy_url" -o "$script"
  chmod +x "$script"
  e2e_push_file "$E2E_NODE_LXC" "$script" /root/panel-deploy.sh
  rm -f "$script"

  e2e_log "Running panel deploy script inside $E2E_NODE_LXC"
  e2e_lxc_exec "$E2E_NODE_LXC" bash -lc 'set -euo pipefail; bash /root/panel-deploy.sh' 2>&1 | tee "${E2E_LOG_DIR}/agent-deploy.log"
  e2e_lxc_exec "$E2E_NODE_LXC" bash -lc 'systemctl is-active --quiet catalyst-agent' \
    || e2e_fail "catalyst-agent did not start in $E2E_NODE_LXC"

  e2e_log "Waiting for node to report online"
  local i status
  for i in $(seq 1 40); do
    status="$(e2e_api GET "/api/nodes/${E2E_NODE_ID}" | jq -r '.data.isOnline // .data.status // empty')"
    e2e_log "node probe $i: ${status:-unknown}"
    if e2e_api GET /api/nodes | jq -e --arg id "$E2E_NODE_ID" '.data[] | select(.id==$id) | (.isOnline==true or .status=="online")' >/dev/null 2>&1; then
      e2e_log "Node is online"
      return 0
    fi
    sleep 3
  done
  e2e_fail "node never came online (agent runs but panel shows offline — check ${E2E_LOG_DIR}/agent-deploy.log)"
}

# ---------------------------------------------------------------------------
# Minecraft: create → install → EULA → start → verify running + queryable
# ---------------------------------------------------------------------------

e2e_find_server() {
  e2e_api GET /api/servers | jq -r --arg n "$1" '.data[]? | select(.name==$n) | .id' | head -1
}

e2e_wait_server_status() {
  local id="$1" want="$2" tries="${3:-60}" i got
  for i in $(seq 1 "$tries"); do
    got="$(e2e_api GET "/api/servers/${id}" | jq -r '.data.status // empty')"
    if [[ "$got" == "$want" ]]; then
      return 0
    fi
    sleep 5
  done
  e2e_warn "server $id status=${got:-unknown} wanted=$want"
  return 1
}

stage_minecraft() {
  e2e_load_state
  [[ -n "${E2E_AUTH_TOKEN:-}" ]] || e2e_fail "missing auth token — run bootstrap first"
  [[ -n "${E2E_NODE_ID:-}" && -n "${E2E_LOCATION_ID:-}" ]] || e2e_fail "bootstrap first"
  [[ -n "${E2E_PAPER_TEMPLATE_ID:-}" ]] || e2e_fail "paper template missing — bootstrap first"
  E2E_API_BASE="${E2E_PUBLIC_URL}"

  local existing payload resp sid
  existing="$(e2e_find_server "$E2E_MC_NAME")"
  if [[ -z "$existing" || "$existing" == "null" ]]; then
    # Fail fast on a squatted game port (a host squatter otherwise surfaces
    # much later as a cryptic container start failure).
    if [[ "${E2E_NODE_MODE:-host}" == "host" ]]; then
      if ss -tln 2>/dev/null | grep -q ":${E2E_MC_PORT} "; then
        e2e_fail "port ${E2E_MC_PORT} already in use on this host — set E2E_MC_PORT to a free port (e.g. 25566)"
      fi
    fi
  fi
  if [[ -n "$existing" && "$existing" != "null" ]]; then
    E2E_MC_SERVER_ID="$existing"
    e2e_log "Reusing existing server $E2E_MC_NAME ($existing)"
  else
    payload="$(jq -n \
      --arg name "$E2E_MC_NAME" \
      --arg templateId "$E2E_PAPER_TEMPLATE_ID" \
      --arg nodeId "$E2E_NODE_ID" \
      --arg locationId "$E2E_LOCATION_ID" \
      --argjson allocatedMemoryMb "$E2E_MC_MEMORY_MB" \
      --argjson allocatedCpuCores "$E2E_MC_CPU" \
      --argjson allocatedDiskMb "$E2E_MC_DISK_MB" \
      --argjson primaryPort "$E2E_MC_PORT" \
      --arg mcVersion "$E2E_MC_VERSION" \
      --arg build "$E2E_MC_BUILD" \
      --arg variant "$E2E_MC_IMAGE_VARIANT" \
      '{
        name:$name, description:"E2E Minecraft Paper (reusable pipeline)",
        templateId:$templateId, nodeId:$nodeId, locationId:$locationId,
        allocatedMemoryMb:$allocatedMemoryMb, allocatedCpuCores:$allocatedCpuCores,
        allocatedDiskMb:$allocatedDiskMb, primaryPort:$primaryPort,
        networkMode:"bridge",
        environment:{MINECRAFT_VERSION:$mcVersion,SERVER_JARFILE:"server.jar",BUILD_NUMBER:$build,IMAGE_VARIANT:$variant,EULA:"true"}
      }')"
    resp="$(e2e_api POST /api/servers "$payload")"
    printf '%s\n' "$resp" > "${E2E_LOG_DIR}/create-minecraft.json"
    sid="$(printf '%s' "$resp" | jq -r '.data.id // empty')"
    [[ -n "$sid" ]] || e2e_fail "server create failed: $resp"
    E2E_MC_SERVER_ID="$sid"
  fi
  e2e_save_state E2E_MC_SERVER_ID "$E2E_MC_SERVER_ID"

  e2e_log "Installing Paper $E2E_MC_SERVER_ID (timeout ${E2E_INSTALL_TIMEOUT_S}s)"
  # Stop first when reusing a running server: POST /install against a live
  # server leaves status=running, which the wait loop below would mistake
  # for a finished install (and the files check would race the wipe).
  local pre_status
  pre_status="$(e2e_api GET "/api/servers/${E2E_MC_SERVER_ID}" | jq -r '.data.status // empty')"
  if [[ "$pre_status" == "running" ]]; then
    e2e_log "Stopping running server before reinstall"
    e2e_api POST "/api/servers/${E2E_MC_SERVER_ID}/stop" '{}' >/dev/null || true
    e2e_wait_server_status "$E2E_MC_SERVER_ID" "stopped" 30 || true
  fi
  local attempt st deadline
  for attempt in 1 2; do
    e2e_api POST "/api/servers/${E2E_MC_SERVER_ID}/install" '{}' | tee "${E2E_LOG_DIR}/install-${E2E_MC_SERVER_ID}.json" >/dev/null || true
    deadline=$(( $(date +%s) + E2E_INSTALL_TIMEOUT_S ))
    st=""
    while true; do
      st="$(e2e_api GET "/api/servers/${E2E_MC_SERVER_ID}" | jq -r '.data.status // empty')"
      if [[ "$st" == "stopped" || "$st" == "running" ]]; then
        e2e_log "install finished with status=$st (attempt $attempt)"
        break
      fi
      if [[ "$st" == "error" || "$st" == "crashed" ]]; then
        break
      fi
      [[ "$(date +%s)" -lt "$deadline" ]] || e2e_fail "install timed out waiting for stopped/running (last=$st)"
      sleep 5
    done
    if [[ "$st" != "error" && "$st" != "crashed" ]]; then
      break
    fi
    if [[ "$attempt" == "1" ]]; then
      e2e_warn "install attempt 1 failed (status=$st) — retrying once (transient network blips fail this way)"
      sleep 5
    fi
  done
  if [[ "$st" == "error" || "$st" == "crashed" ]]; then
    e2e_fail "install failed (status=$st). Logs: $(e2e_api GET "/api/servers/${E2E_MC_SERVER_ID}/logs?lines=30")"
  fi

  # server.jar must exist via the file explorer (catches mount-namespace splits).
  local names
  names="$(e2e_api GET "/api/servers/${E2E_MC_SERVER_ID}/files?path=%2F" | jq -r '.data.files[]?.name // empty')"
  printf '%s\n' "$names" > "${E2E_LOG_DIR}/files-root.txt"
  grep -Fq "server.jar" "${E2E_LOG_DIR}/files-root.txt" \
    || e2e_fail "server.jar missing after install (files: $(tr '\n' ' ' < "${E2E_LOG_DIR}/files-root.txt"))"

  e2e_log "Starting Paper $E2E_MC_SERVER_ID"
  e2e_api POST "/api/servers/${E2E_MC_SERVER_ID}/start" '{}' | tee "${E2E_LOG_DIR}/start-${E2E_MC_SERVER_ID}.json" >/dev/null || true

  # EULA: Paper stops on first boot until eula.txt is accepted. Accept via
  # API, then explicitly (re)start: some agent versions boot automatically
  # after accept, others wait for a start command.
  local eula_deadline=$(( $(date +%s) + 180 )) st eula_accepted=0
  while true; do
    st="$(e2e_api GET "/api/servers/${E2E_MC_SERVER_ID}" | jq -r '.data.status // empty')"
    if [[ "$st" == "running" ]]; then
      break
    fi
    if [[ "$st" == "stopped" && "$eula_accepted" == "1" ]]; then
      e2e_log "Starting after EULA accept"
      e2e_api POST "/api/servers/${E2E_MC_SERVER_ID}/start" '{}' >/dev/null || true
      sleep 10
      continue
    fi
    local logs
    logs="$(e2e_api GET "/api/servers/${E2E_MC_SERVER_ID}/logs?lines=40" || true)"
    if printf '%s' "$logs" | grep -qi "eula"; then
      e2e_log "Accepting EULA"
      e2e_api POST /api/servers/eula "$(jq -n --arg serverId "$E2E_MC_SERVER_ID" '{serverId:$serverId,accepted:true}')" >/dev/null || true
      eula_accepted=1
      sleep 5
    fi
    [[ "$(date +%s)" -lt "$eula_deadline" ]] || break
    sleep 5
  done

  e2e_wait_server_status "$E2E_MC_SERVER_ID" "running" 120 \
    || e2e_fail "Paper never reached running. Logs: $(e2e_api GET "/api/servers/${E2E_MC_SERVER_ID}/logs?lines=50")"

  # Queryable: MC handshake on the node address should get a response.
  # Retry: Paper opens the port seconds after status=running, and a fresh
  # bridge/NAT needs a moment for ARP. Stale duplicate DNAT rules (first
  # match wins) never heal — the failure message tells where to look.
  local node_addr
  node_addr="$(e2e_node_addr)"
  e2e_log "Probing Minecraft query port ${node_addr}:${E2E_MC_PORT}"
  local probe_i
  for probe_i in $(seq 1 6); do
    if e2e_lxc_exec "$E2E_PANEL_LXC" bash -lc "timeout 10 bash -c 'cat < /dev/null > /dev/tcp/${node_addr}/${E2E_MC_PORT}'"; then
      e2e_log "Minecraft Paper is running and reachable"
      return 0
    fi
    sleep 10
  done
  e2e_fail "TCP probe to ${node_addr}:${E2E_MC_PORT} failed — server running but unreachable. On the node, check for stale duplicate DNAT rules shadowing the live container IP (iptables -t nat -L PREROUTING -n --line-numbers | grep ${E2E_MC_PORT}; first match wins)"
}

stage_verify() {
  e2e_load_state
  E2E_API_BASE="${E2E_PUBLIC_URL}"
  [[ -n "${E2E_MC_SERVER_ID:-}" ]] || e2e_fail "no minecraft server in state — run minecraft first"
  e2e_lxc_exec "$E2E_PANEL_LXC" bash -lc 'curl -fsS --max-time 5 http://localhost:3000/health >/dev/null' \
    || e2e_fail "backend unhealthy"
  e2e_wait_http "${E2E_PUBLIC_URL}/" 10 || e2e_fail "panel unreachable"
  local st
  st="$(e2e_api GET "/api/servers/${E2E_MC_SERVER_ID}" | jq -r '.data.status // empty')"
  [[ "$st" == "running" ]] || e2e_fail "expected running, got ${st:-unknown}"
  local logs
  logs="$(e2e_api GET "/api/servers/${E2E_MC_SERVER_ID}/logs?lines=60")"
  printf '%s\n' "$logs" > "${E2E_LOG_DIR}/verify-logs.json"
  printf '%s' "$logs" | grep -qi "done" || e2e_warn "no 'Done' marker in last 60 log lines yet (server may still be starting)"
  local vprobe_i
  for vprobe_i in $(seq 1 6); do
    if e2e_lxc_exec "$E2E_PANEL_LXC" bash -lc "timeout 10 bash -c 'cat < /dev/null > /dev/tcp/$(e2e_node_addr)/${E2E_MC_PORT}'"; then
      e2e_log "Verify OK: panel healthy, Paper running, port reachable"
      return 0
    fi
    sleep 10
  done
  e2e_fail "TCP probe failed during verify"
}

stage_status() {
  e2e_load_state || true
  echo "=== LXCs ==="
  lxc-ls -f || true
  echo
  echo "=== Panel ==="
  curl -fsS -o /dev/null -w "panel %{http_code}\n" "${E2E_PUBLIC_URL}/" || echo "panel down"
  e2e_lxc_exec "$E2E_PANEL_LXC" bash -lc 'curl -fsS -o /dev/null -w "backend %{http_code}\n" http://localhost:3000/health || echo "backend down"'
  echo "=== Node ==="
  if [[ "${E2E_NODE_MODE:-host}" == "host" ]]; then
    if p=$(e2e_host_agent_pid "$E2E_HOST_AGENT_CONFIG"); then
      echo "host agent running (pid $p)"
    else
      echo "host agent not running"
    fi
  elif e2e_lxc_running "$E2E_NODE_LXC"; then
    e2e_lxc_exec "$E2E_NODE_LXC" bash -lc 'systemctl is-active catalyst-agent' || echo "agent inactive in $E2E_NODE_LXC"
  else
    echo "$E2E_NODE_LXC not running"
  fi
  if [[ -n "${E2E_AUTH_TOKEN:-}" && -n "${E2E_NODE_ID:-}" ]]; then
    E2E_API_BASE="${E2E_PUBLIC_URL}"
    echo "=== API ==="
    e2e_api GET /api/nodes | jq '{nodes:(.data|map({id,name,publicAddress,isOnline}))}' || true
    e2e_api GET /api/servers | jq '{servers:(.data|map({id,name,status,primaryPort}))}' || true
  fi
  echo "=== URLs ==="
  echo "Panel: ${E2E_PUBLIC_URL}"
  echo "Login: ${E2E_ADMIN_EMAIL}"
  echo "State: ${E2E_STATE_DIR}  JUnit: ${E2E_JUNIT_FILE}"
}

stage_destroy() {
  if [[ "${E2E_NODE_MODE:-host}" == "host" ]]; then
    if p=$(e2e_host_agent_pid "$E2E_HOST_AGENT_CONFIG"); then
      e2e_warn "Stopping isolated host agent (pid $p)"
      sudo kill "$p" 2>/dev/null || true
    fi
    rm -f "$E2E_HOST_AGENT_PIDFILE" 2>/dev/null || sudo rm -f "$E2E_HOST_AGENT_PIDFILE"
    if [[ -d "${E2E_HOST_AGENT_DATADIR:-}" ]]; then
      e2e_warn "Removing host agent data ${E2E_HOST_AGENT_DATADIR}"
      # Loop-mounted disk images survive agent death; unmount (lazy) before
      # removing, deepest mount first. Never aborts the destroy.
      while read -r mp _; do
        sudo umount -l "$mp" 2>/dev/null || true
      done < <(grep -F " ${E2E_HOST_AGENT_DATADIR}" /proc/mounts 2>/dev/null | awk '{print $2}' | sort -r || true)
      sudo rm -rf "${E2E_HOST_AGENT_DATADIR}" 2>/dev/null || e2e_warn "datadir not fully removed (a reboot clears stale mounts)"
    fi
    e2e_warn "Destroying $E2E_PANEL_LXC (state kept at $E2E_STATE_DIR)"
    if e2e_have_lxc "$E2E_PANEL_LXC"; then
      lxc-stop -n "$E2E_PANEL_LXC" -k || true
      lxc-destroy -n "$E2E_PANEL_LXC" -f || true
    fi
    if e2e_have_lxc "$E2E_NODE_LXC"; then
      lxc-stop -n "$E2E_NODE_LXC" -k || true
      lxc-destroy -n "$E2E_NODE_LXC" -f || true
    fi
    rm -f "$E2E_STATE_FILE" "$E2E_COOKIE_JAR"
    # Pidfile/config are root-owned (written via sudo); remove with sudo so
    # set -e never aborts the destroy halfway.
    sudo rm -f "$E2E_HOST_AGENT_PIDFILE" "$E2E_HOST_AGENT_CONFIG"
    return 0
  fi
  e2e_warn "Destroying $E2E_PANEL_LXC $E2E_NODE_LXC (state kept at $E2E_STATE_DIR)"
  for name in "$E2E_PANEL_LXC" "$E2E_NODE_LXC"; do
    if e2e_have_lxc "$name"; then
      lxc-stop -n "$name" -k || true
      lxc-destroy -n "$name" -f || true
    fi
  done
  rm -f "$E2E_STATE_FILE" "$E2E_COOKIE_JAR"
}

stage_all() {
  e2e_junit_reset
  e2e_run_stage create stage_create
  e2e_run_stage install stage_install
  e2e_run_stage bootstrap stage_bootstrap
  e2e_run_stage agent stage_agent
  e2e_run_stage minecraft stage_minecraft
  e2e_run_stage verify stage_verify
  stage_status
}

cmd="${1:-all}"
case "$cmd" in
  create) e2e_run_stage create stage_create ;;
  install) e2e_run_stage install stage_install ;;
  bootstrap) e2e_run_stage bootstrap stage_bootstrap ;;
  agent) e2e_run_stage agent stage_agent ;;
  minecraft) e2e_run_stage minecraft stage_minecraft ;;
  verify) e2e_run_stage verify stage_verify ;;
  status) stage_status ;;
  destroy) stage_destroy ;;
  all) stage_all ;;
  *)
    echo "Usage: $0 {all|create|install|bootstrap|agent|minecraft|verify|status|destroy}"
    exit 2
    ;;
esac
