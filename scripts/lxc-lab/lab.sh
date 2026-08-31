#!/usr/bin/env bash
# Repeatable Catalyst split-LXC lab:
#   two Ubuntu LXCs (panel + backend, no TLS) → panel first-run →
#   agent via the panel deploy URL on this host → Paper + Sons of the Forest
#   → file explorer + server control checks.
#
# Usage:
#   ./scripts/lxc-lab/lab.sh              # all stages
#   ./scripts/lxc-lab/lab.sh create
#   ./scripts/lxc-lab/lab.sh docker
#   ./scripts/lxc-lab/lab.sh deploy
#   ./scripts/lxc-lab/lab.sh bootstrap
#   ./scripts/lxc-lab/lab.sh agent
#   ./scripts/lxc-lab/lab.sh servers
#   ./scripts/lxc-lab/lab.sh files
#   ./scripts/lxc-lab/lab.sh ops
#   ./scripts/lxc-lab/lab.sh live
#   ./scripts/lxc-lab/lab.sh storage-backups
#   ./scripts/lxc-lab/lab.sh refresh
#   ./scripts/lxc-lab/lab.sh status
#   ./scripts/lxc-lab/lab.sh destroy
#   ./scripts/lxc-lab/lab.sh ptero            # panel+Wings LXCs + seed
#   ./scripts/lxc-lab/lab.sh ptero-migrate    # Catalyst import against the fixture
#   ./scripts/lxc-lab/lab.sh ptero-destroy
set -euo pipefail

LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$LAB_DIR/lib.sh"

PUBLIC_URL="${PUBLIC_URL:-http://${HOST_LAN_IP}:${PANEL_HOST_PORT}}"
BACKEND_PUBLIC="${BACKEND_PUBLIC:-http://${BACKEND_IP}:3000}"
API_BASE="${API_BASE:-$PUBLIC_URL}"
CORS_ORIGIN="${CORS_ORIGIN:-${PUBLIC_URL},http://${PANEL_IP}:8080,http://127.0.0.1:${PANEL_HOST_PORT}}"

append_lxc_tuning() {
  local name="$1"
  local ip="$2"
  local memory="$3"
  local cpu_quota="$4"
  local cfg="$HOME/.local/share/lxc/${name}/config"
  [[ -f "$cfg" ]] || fail "missing LXC config $cfg"

  if ! grep -q "lxc.apparmor.profile = unconfined" "$cfg"; then
    printf '\nlxc.apparmor.profile = unconfined\n' >> "$cfg"
  fi
  if ! grep -q "lxc.cgroup2.memory.max" "$cfg"; then
    cat >> "$cfg" <<EOF
lxc.cgroup2.memory.max = ${memory}
lxc.cgroup.memory.limit_in_bytes = ${memory}
lxc.cgroup2.cpu.max = ${cpu_quota}
lxc.cgroup.cpu.shares = 2048
EOF
  fi
  if ! grep -q "lxc.net.0.ipv4.address" "$cfg"; then
    cat >> "$cfg" <<EOF
lxc.net.0.ipv4.address = ${ip}/${LXC_NETMASK}
lxc.net.0.ipv4.gateway = ${LXC_GATEWAY}
EOF
  fi
}

create_one_lxc() {
  local name="$1"
  local ip="$2"
  local memory="$3"
  local cpu_quota="$4"

  if have_lxc "$name"; then
    log "LXC $name already exists"
  else
    log "Creating Ubuntu ${LXC_RELEASE} LXC $name"
    lxc-create -n "$name" -t download -- \
      -d "$LXC_DISTRO" -r "$LXC_RELEASE" -a "$LXC_ARCH" --force-cache
  fi

  append_lxc_tuning "$name" "$ip" "$memory" "$cpu_quota"

  if ! lxc_running "$name"; then
    log "Starting $name"
    lxc-start -n "$name" -d
  fi

  local got
  got="$(wait_for_ip "$name" "$ip" || true)"
  [[ -n "$got" ]] || fail "$name did not get IP $ip"
  log "$name is up at $got"
}

write_netplan() {
  local name="$1"
  local ip="$2"
  local tmp
  tmp="$(mktemp)"
  cat > "$tmp" <<EOF
network:
  version: 2
  ethernets:
    eth0:
      dhcp4: false
      addresses: [${ip}/${LXC_NETMASK}]
      routes:
        - to: default
          via: ${LXC_GATEWAY}
      nameservers:
        addresses: [1.1.1.1, 8.8.8.8]
EOF
  push_file "$name" "$tmp" /etc/netplan/10-lxc.yaml
  rm -f "$tmp"
  lxc_exec "$name" bash -lc 'chmod 600 /etc/netplan/10-lxc.yaml; netplan apply 2>/dev/null || true' || true
}

stage_create() {
  ensure_host_tools
  create_one_lxc "$BACKEND_LXC" "$BACKEND_IP" "$BACKEND_MEMORY" "$BACKEND_CPU_QUOTA"
  create_one_lxc "$PANEL_LXC" "$PANEL_IP" "$PANEL_MEMORY" "$PANEL_CPU_QUOTA"
  write_netplan "$BACKEND_LXC" "$BACKEND_IP"
  write_netplan "$PANEL_LXC" "$PANEL_IP"
}

install_docker_in() {
  local name="$1"
  if lxc_exec "$name" bash -lc 'command -v docker >/dev/null && docker compose version >/dev/null'; then
    log "Docker already present in $name"
    return 0
  fi
  log "Installing Docker in $name"
  lxc_exec "$name" bash -lc '
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

stage_docker() {
  install_docker_in "$BACKEND_LXC"
  install_docker_in "$PANEL_LXC"
}

push_file() {
  local name="$1"
  local src="$2"
  local dest="$3"
  lxc_exec "$name" bash -lc "mkdir -p '$(dirname "$dest")'"
  # Stream through attach stdin — rootfs is uid-mapped so host writes fail.
  lxc-attach -n "$name" -- /bin/sh -c "cat > '$dest'" < "$src"
}

run_official_install_sh() {
  local name="$1"
  log "Running official install.sh -y in $name (no domain, no TLS)"
  lxc_exec "$name" bash -lc 'export DEBIAN_FRONTEND=noninteractive; apt-get update -y >/dev/null; apt-get install -y --no-install-recommends openssl tar ca-certificates curl >/dev/null'
  push_file "$name" "$REPO_ROOT/install.sh" /root/install.sh
  lxc_exec "$name" bash -lc "
    set -euo pipefail
    cd /root
    chmod +x /root/install.sh
    export PUBLIC_URL='${PUBLIC_URL}'
    export APP_NAME='${PANEL_NAME}'
    bash /root/install.sh -y
  "
}

patch_official_env() {
  local name="$1"
  local backend_bind="$2"
  lxc_exec "$name" bash -lc "
    set -euo pipefail
    ENV=/root/catalyst-docker/.env
    test -f \"\$ENV\"
    sed -i 's~^NODE_ENV=.*~NODE_ENV=development~' \"\$ENV\"
    sed -i 's~^PUBLIC_URL=.*~PUBLIC_URL=${PUBLIC_URL}~' \"\$ENV\"
    sed -i 's~^PASSKEY_RP_ID=.*~PASSKEY_RP_ID=${HOST_LAN_IP}~' \"\$ENV\"
    sed -i 's~^APP_NAME=.*~APP_NAME=${PANEL_NAME}~' \"\$ENV\"
    sed -i 's~^FRONTEND_PORT=.*~FRONTEND_PORT=0.0.0.0:8080~' \"\$ENV\"
    sed -i 's~^BACKEND_PORT=.*~BACKEND_PORT=${backend_bind}~' \"\$ENV\"
    if grep -q '^CORS_ORIGIN=' \"\$ENV\"; then
      sed -i 's~^CORS_ORIGIN=.*~CORS_ORIGIN=${LAB_CORS_ORIGINS}~' \"\$ENV\"
    else
      printf '\\nCORS_ORIGIN=%s\\n' '${LAB_CORS_ORIGINS}' >> \"\$ENV\"
    fi
    if grep -q '^CATALYST_COMPOSE_DIR=' \"\$ENV\"; then
      sed -i 's~^CATALYST_COMPOSE_DIR=.*~CATALYST_COMPOSE_DIR=/root/catalyst-docker~' \"\$ENV\"
    else
      printf '\\nCATALYST_COMPOSE_DIR=/root/catalyst-docker\\n' >> \"\$ENV\"
    fi
    if grep -q '^AUTO_UPDATE_DOCKER_COMPOSE_PATH=' \"\$ENV\"; then
      sed -i 's~^AUTO_UPDATE_DOCKER_COMPOSE_PATH=.*~AUTO_UPDATE_DOCKER_COMPOSE_PATH=/root/catalyst-docker/docker-compose.yml~' \"\$ENV\"
    else
      printf 'AUTO_UPDATE_DOCKER_COMPOSE_PATH=/root/catalyst-docker/docker-compose.yml\\n' >> \"\$ENV\"
    fi
    if ! grep -q '^BACKUP_CREDENTIALS_ENCRYPTION_KEY=' \"\$ENV\"; then
      printf 'BACKUP_CREDENTIALS_ENCRYPTION_KEY=%s\\n' \"\$(openssl rand -base64 32)\" >> \"\$ENV\"
    fi
    if grep -q '^WS_MAX_PAYLOAD_BYTES=' \"\$ENV\"; then
      sed -i 's~^WS_MAX_PAYLOAD_BYTES=.*~WS_MAX_PAYLOAD_BYTES=8388608~' \"\$ENV\"
    else
      printf 'WS_MAX_PAYLOAD_BYTES=8388608\\n' >> \"\$ENV\"
    fi
  "
}

stage_deploy_backend() {
  run_official_install_sh "$BACKEND_LXC"
  patch_official_env "$BACKEND_LXC" "0.0.0.0:3000"
  write_backend_overlay
  pull_backend_images
  patch_published_cron_parser
}

sync_official_compose() {
  local name="$1"
  push_file "$name" "$REPO_ROOT/catalyst-docker/docker-compose.yml" /root/catalyst-docker/docker-compose.yml
}

write_backend_overlay() {
  # Official compose binds BACKEND_* to PUBLIC_URL. Agents on the LAN should
  # talk to this LXC directly instead of hairpinning through the panel proxy.
  local tmp
  tmp="$(mktemp)"
  cat > "$tmp" <<EOF
services:
  backend:
    environment:
      BACKEND_EXTERNAL_ADDRESS: ${BACKEND_PUBLIC}
      BACKEND_URL: ${BACKEND_PUBLIC}
      CORS_ORIGIN: ${LAB_CORS_ORIGINS}
      AUTO_UPDATE_DOCKER_COMPOSE_PATH: /root/catalyst-docker/docker-compose.yml
      BACKUP_CREDENTIALS_ENCRYPTION_KEY: \${BACKUP_CREDENTIALS_ENCRYPTION_KEY}
      WS_MAX_PAYLOAD_BYTES: "8388608"
    volumes:
      - /root/catalyst-docker:/root/catalyst-docker:ro
EOF
  push_file "$BACKEND_LXC" "$tmp" /root/catalyst-docker/docker-compose.backend-lxc.yml
  rm -f "$tmp"
}

pull_backend_images() {
  log "Pulling latest postgres/redis/backend in $BACKEND_LXC"
  lxc_exec "$BACKEND_LXC" bash -lc "
    set -euo pipefail
    cd /root/catalyst-docker
    docker compose -f docker-compose.yml -f docker-compose.backend-lxc.yml pull postgres redis backend
    docker compose -f docker-compose.yml -f docker-compose.backend-lxc.yml up -d postgres redis backend
  "
}

pull_panel_images() {
  push_file "$PANEL_LXC" "$LAB_DIR/compose/docker-compose.panel-lxc.yml" /root/catalyst-docker/docker-compose.panel-lxc.yml
  lxc_exec "$PANEL_LXC" bash -lc "
    set -euo pipefail
    cd /root/catalyst-docker
    if grep -q '^BACKEND_IP=' .env; then
      sed -i 's~^BACKEND_IP=.*~BACKEND_IP=${BACKEND_IP}~' .env
    else
      printf '\nBACKEND_IP=%s\n' '${BACKEND_IP}' >> .env
    fi
    docker compose -f docker-compose.yml -f docker-compose.panel-lxc.yml pull frontend
    docker compose -f docker-compose.yml -f docker-compose.panel-lxc.yml up -d --no-deps frontend
  "
}

patch_published_cron_parser() {
  # Published image still calls cron-parser v4 parseExpression; v5 only has
  # CronExpressionParser.parse. Without this, POST /tasks always 400s.
  log "Patching published backend cron-parser usage if needed"
  lxc_exec "$BACKEND_LXC" bash -lc '
    set -euo pipefail
    docker exec -u root catalyst-backend node -e "
      const fs = require(\"fs\");
      const p = \"/app/dist/routes/tasks.js\";
      let s = fs.readFileSync(p, \"utf8\");
      const old = \"cronParser.parseExpression(schedule,\";
      const neu = \"cronParser.CronExpressionParser.parse(schedule,\";
      const c = s.split(old).length - 1;
      if (!c) { console.log(\"cron-parser already current\"); process.exit(0); }
      fs.writeFileSync(p, s.split(old).join(neu));
      console.log(\"patched cron-parser calls:\", c);
    "
    docker restart catalyst-backend
  '
  wait_http "http://${BACKEND_IP}:3000/health" 40 || true
  patch_published_ws_payload
}

patch_published_ws_payload() {
  # Published image still uses 64 KiB WS frames; agent backup chunks are 256 KiB.
  log "Raising published backend WebSocket maxPayload if needed"
  lxc_exec "$BACKEND_LXC" bash -lc '
    set -euo pipefail
    docker exec -u root catalyst-backend node -e "
      const fs = require(\"fs\");
      const p = \"/app/dist/index.js\";
      let s = fs.readFileSync(p, \"utf8\");
      const old = \"maxPayload: 64 * 1024\";
      const neu = \"maxPayload: 8 * 1024 * 1024\";
      const old2 = \"maxPayload: 65536\";
      let c = 0;
      if (s.includes(old)) { s = s.split(old).join(neu); c += 1; }
      if (s.includes(old2)) { s = s.split(old2).join(\"maxPayload: 8388608\"); c += 1; }
      if (!c) { console.log(\"ws maxPayload already raised\"); process.exit(0); }
      fs.writeFileSync(p, s);
      console.log(\"patched ws maxPayload replacements:\", c);
    "
    docker restart catalyst-backend
  '
  patch_published_s3_upload
}

patch_published_s3_upload() {
  # Published image PutObject's a PassThrough with no ContentLength; AWS SDK
  # then crashes on x-amz-decoded-content-length=undefined against MinIO.
  log "Patching published S3 backup upload to use a sized temp file"
  lxc_exec "$BACKEND_LXC" bash -lc '
    set -euo pipefail
    docker exec -u root catalyst-backend node -e "
      const fs = require(\"fs\");
      const p = \"/app/dist/services/backup-storage.js\";
      let s = fs.readFileSync(p, \"utf8\");
      if (s.includes(\"ContentLength: stats.size\")) { console.log(\"s3 upload already patched\"); process.exit(0); }
      const start = s.indexOf(\"streamAgentBackupToS3 = async\");
      const end = s.indexOf(\"export const streamAgentBackupToSftp\");
      if (start < 0 || end < 0) { console.log(\"s3 upload markers missing\"); process.exit(0); }
      const neu = \"streamAgentBackupToS3 = async (gateway, nodeId, serverId, serverUuid, agentPath, storageKey, server) => {\\n    const { client, bucket } = resolveS3Config(server);\\n    const tmpPath = path.join(TRANSFER_DIR, serverUuid, path.basename(storageKey));\\n    await streamAgentBackupToLocal(gateway, nodeId, serverId, serverUuid, agentPath, tmpPath);\\n    try {\\n        const stats = await fs.stat(tmpPath);\\n        await client.send(new PutObjectCommand({\\n            Bucket: bucket,\\n            Key: storageKey,\\n            Body: createReadStream(tmpPath),\\n            ContentLength: stats.size,\\n            ContentType: \\\"application/gzip\\\",\\n        }));\\n    } finally {\\n        await fs.unlink(tmpPath).catch(() => {});\\n    }\\n};\\nexport const \";
      s = s.slice(0, start) + neu + s.slice(end + \"export const \".length);
      fs.writeFileSync(p, s);
      console.log(\"patched streamAgentBackupToS3\");
    "
    docker restart catalyst-backend
  '
  wait_http "http://${BACKEND_IP}:3000/health" 40 || true
}


stage_deploy_panel() {
  run_official_install_sh "$PANEL_LXC"
  patch_official_env "$PANEL_LXC" "127.0.0.1:3000"
  pull_panel_images
  log "Waiting for panel nginx at http://${PANEL_IP}:8080/"
  wait_http "http://${PANEL_IP}:8080/" 40 || fail "panel nginx never became ready"
  start_host_forwards
  log "Waiting for published panel ${PUBLIC_URL}"
  wait_http "${PUBLIC_URL}/" 20 || warn "host publish ${PUBLIC_URL} not reachable yet (panel still at http://${PANEL_IP}:8080/)"
}

start_host_forwards() {
  mkdir -p "$STATE_DIR/run"
  local map spec host_port dest_ip dest_port pidfile
  map="${PANEL_HOST_PORT}:${PANEL_IP}:8080 ${BACKEND_HOST_PORT}:${BACKEND_IP}:3000"
  for spec in $map; do
    host_port="${spec%%:*}"
    dest_ip="${spec#*:}"; dest_ip="${dest_ip%%:*}"
    dest_port="${spec##*:}"
    pidfile="$STATE_DIR/run/fwd-${host_port}.pid"
    if [[ -f "$pidfile" ]] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
      continue
    fi
    log "Publishing host :${host_port} -> ${dest_ip}:${dest_port}"
    nohup python3 "$LAB_DIR/tcp-proxy.py" "$host_port" "$dest_ip" "$dest_port" \
      >>"$LOG_DIR/fwd-${host_port}.log" 2>&1 &
    echo $! > "$pidfile"
  done
}

stage_deploy() {
  stage_deploy_backend
  stage_deploy_panel
}

stage_refresh() {
  have_lxc "$BACKEND_LXC" || fail "backend LXC missing — run create/deploy first"
  have_lxc "$PANEL_LXC" || fail "panel LXC missing — run create/deploy first"
  lxc_running "$BACKEND_LXC" || fail "backend LXC not running"
  lxc_running "$PANEL_LXC" || fail "panel LXC not running"

  log "Refreshing lab compose files and GHCR :latest images"
  sync_official_compose "$BACKEND_LXC"
  sync_official_compose "$PANEL_LXC"
  patch_official_env "$BACKEND_LXC" "0.0.0.0:3000"
  patch_official_env "$PANEL_LXC" "127.0.0.1:3000"
  write_backend_overlay
  pull_backend_images
  pull_panel_images
  patch_published_cron_parser
  start_host_forwards
  wait_http "http://${BACKEND_IP}:3000/health" 40 || fail "backend /health never came up after refresh"
  wait_http "http://${PANEL_IP}:8080/" 40 || fail "panel nginx never came up after refresh"
  wait_http "${PUBLIC_URL}/" 20 || warn "host publish ${PUBLIC_URL} not reachable yet (panel still at http://${PANEL_IP}:8080/)"
  log "Lab images refreshed"
}

login_or_setup() {
  load_state
  API_BASE="$PUBLIC_URL"
  rm -f "$COOKIE_JAR"
  local status
  status="$(curl -fsS "${PUBLIC_URL}/api/setup/status" || curl -fsS "http://${PANEL_IP}:8080/api/setup/status")"
  local needed
  needed="$(printf '%s' "$status" | jq -r '.setupRequired')"
  if [[ "$needed" == "true" ]]; then
    log "Running first-run setup"
    local body
    body="$(jq -n \
      --arg email "$ADMIN_EMAIL" \
      --arg username "$ADMIN_USERNAME" \
      --arg password "$ADMIN_PASSWORD" \
      --arg panelName "$PANEL_NAME" \
      '{email:$email,username:$username,password:$password,panelName:$panelName,defaultTheme:"dark"}')"
    api POST /api/setup/complete "$body" | tee "$LOG_DIR/setup.json" >/dev/null
  fi

  log "Logging in as $ADMIN_EMAIL"
  local login
  login="$(api POST /api/auth/login "$(jq -n --arg email "$ADMIN_EMAIL" --arg password "$ADMIN_PASSWORD" '{email:$email,password:$password,rememberMe:true}')")"
  printf '%s\n' "$login" > "$LOG_DIR/login.json"
  AUTH_TOKEN="$(printf '%s' "$login" | jq -r '.data.token // empty')"
  [[ -n "$AUTH_TOKEN" && "$AUTH_TOKEN" != "null" ]] || fail "login failed: $login"
  save_state AUTH_TOKEN "$AUTH_TOKEN"
  export AUTH_TOKEN
}

ensure_location() {
  local list id
  list="$(api GET /api/locations)"
  id="$(printf '%s' "$list" | jq -r --arg n "$LOCATION_NAME" '.data[]? | select(.name==$n) | .id' | head -1)"
  if [[ -z "$id" || "$id" == "null" ]]; then
    id="$(api POST /api/locations "$(jq -n --arg name "$LOCATION_NAME" --arg description "LXC lab" '{name:$name,description:$description}')" | jq -r '.data.id')"
  fi
  [[ -n "$id" && "$id" != "null" ]] || fail "could not create location"
  save_state LOCATION_ID "$id"
  LOCATION_ID="$id"
}

ensure_nests() {
  local list
  list="$(api GET /api/nests)"
  ensure_one_nest() {
    local name="$1"
    local id
    id="$(printf '%s' "$list" | jq -r --arg n "$name" '.data[]? | select(.name==$n) | .id' | head -1)"
    if [[ -z "$id" || "$id" == "null" ]]; then
      id="$(api POST /api/nests "$(jq -n --arg name "$name" '{name:$name}')" | jq -r '.data.id')"
      list="$(api GET /api/nests)"
    fi
    printf '%s\n' "$id"
  }
  MINECRAFT_NEST_ID="$(ensure_one_nest Minecraft)"
  STEAM_NEST_ID="$(ensure_one_nest Steam)"
  save_state MINECRAFT_NEST_ID "$MINECRAFT_NEST_ID"
  save_state STEAM_NEST_ID "$STEAM_NEST_ID"
}

ensure_node() {
  local list id
  list="$(api GET /api/nodes)"
  id="$(printf '%s' "$list" | jq -r --arg n "$NODE_NAME" '.data[]? | select(.name==$n) | .id' | head -1)"
  if [[ -z "$id" || "$id" == "null" ]]; then
    local body
    body="$(jq -n \
      --arg name "$NODE_NAME" \
      --arg locationId "$LOCATION_ID" \
      --arg hostname "$NODE_HOSTNAME" \
      --arg publicAddress "$NODE_PUBLIC_ADDRESS" \
      --argjson maxMemoryMb "$NODE_MAX_MEMORY_MB" \
      --argjson maxCpuCores "$NODE_MAX_CPU" \
      '{name:$name,locationId:$locationId,hostname:$hostname,publicAddress:$publicAddress,maxMemoryMb:$maxMemoryMb,maxCpuCores:$maxCpuCores,sftpPort:2022,sftpEnabled:true}')"
    id="$(api POST /api/nodes "$body" | tee "$LOG_DIR/node.json" | jq -r '.data.id')"
  fi
  [[ -n "$id" && "$id" != "null" ]] || fail "could not create node"
  NODE_ID="$id"
  save_state NODE_ID "$NODE_ID"

  # Allocations for the two game servers + extras.
  api POST "/api/nodes/${NODE_ID}/allocations" "$(jq -n \
    --arg ip "$NODE_PUBLIC_ADDRESS" \
    --arg ports "${MC_PORT},${SOTF_PORT},${SOTF_QUERY_PORT},${SOTF_BLOB_PORT},25566-25570,8767-8770" \
    '{ip:$ip,ports:$ports}')" >/dev/null || true
}

import_egg() {
  local file="$1"
  local nest="$2"
  local name
  name="$(jq -r '.name' "$file")"
  local existing
  existing="$(api GET /api/templates | jq -r --arg n "$name" '.data[]? | select(.name==$n) | .id' | head -1)"
  if [[ -n "$existing" && "$existing" != "null" ]]; then
    printf '%s\n' "$existing"
    return 0
  fi
  local payload
  payload="$(jq --arg nestId "$nest" '. + {_category:null, nestId:$nestId}' "$file")"
  local resp
  resp="$(api POST /api/templates/import-pterodactyl "$payload")"
  printf '%s\n' "$resp" > "$LOG_DIR/import-$(echo "$name" | tr ' /' '__').json"
  local id
  id="$(printf '%s' "$resp" | jq -r '.data.id // empty')"
  [[ -n "$id" ]] || fail "egg import failed for $name: $resp"
  printf '%s\n' "$id"
}

patch_sotf_startup() {
  local id="$1"
  api PUT "/api/templates/${id}" '{"startup":"./start.sh"}' >/dev/null
}

stage_bootstrap() {
  start_host_forwards
  login_or_setup
  ensure_location
  ensure_nests
  ensure_node
  PAPER_TEMPLATE_ID="$(import_egg "$REPO_ROOT/eggs/minecraft/java/paper/egg-paper.json" "$MINECRAFT_NEST_ID")"
  SOTF_TEMPLATE_ID="$(import_egg "$REPO_ROOT/eggs/sonsoftheforest/egg-sons-of-the-forest.json" "$STEAM_NEST_ID")"
  patch_sotf_startup "$SOTF_TEMPLATE_ID"
  save_state PAPER_TEMPLATE_ID "$PAPER_TEMPLATE_ID"
  save_state SOTF_TEMPLATE_ID "$SOTF_TEMPLATE_ID"
  log "Bootstrap complete. location=$LOCATION_ID node=$NODE_ID paper=$PAPER_TEMPLATE_ID sotf=$SOTF_TEMPLATE_ID"
}

stage_agent() {
  load_state
  [[ -n "${AUTH_TOKEN:-}" ]] || login_or_setup
  [[ -n "${NODE_ID:-}" ]] || fail "NODE_ID missing — run bootstrap first"

  log "Requesting panel deploy token for node $NODE_ID"
  local tok
  tok="$(api POST "/api/nodes/${NODE_ID}/deployment-token" '{}')"
  printf '%s\n' "$tok" > "$LOG_DIR/deploy-token.json"
  local deploy_url api_key
  deploy_url="$(printf '%s' "$tok" | jq -r '.data.deployUrl')"
  api_key="$(printf '%s' "$tok" | jq -r '.data.apiKey')"
  [[ -n "$deploy_url" && "$deploy_url" != "null" ]] || fail "no deployUrl: $tok"
  [[ -n "$api_key" && "$api_key" != "null" ]] || fail "no apiKey: $tok"
  deploy_url="${deploy_url}?apiKey=$(jq -nr --arg k "$api_key" '$k|@uri')"
  save_state DEPLOY_URL "$deploy_url"
  log "Deploy URL: ${deploy_url%%\?*}?apiKey=***"

  # The token is single-use. Fetch and run it on this host (containerd node).
  local script
  script="$(mktemp /tmp/catalyst-panel-deploy.XXXXXX.sh)"
  curl -fsSL "$deploy_url" -o "$script"
  chmod +x "$script"
  log "Running panel deploy script on host"
  sudo bash "$script" | tee "$LOG_DIR/agent-deploy.log"
  rm -f "$script"

  systemctl is-active --quiet catalyst-agent || fail "catalyst-agent did not start"
  # Official install.sh sets BACKEND_URL from PUBLIC_URL (the panel). Point the
  # agent at the backend LXC so WebSockets do not traverse the host TCP proxy.
  if [[ -f /opt/catalyst-agent/config.toml ]]; then
    sudo sed -i "s#http://192.168.1.78:8080#${BACKEND_PUBLIC}#g; s#ws://192.168.1.78:8080#${BACKEND_PUBLIC/http/ws}#g" /opt/catalyst-agent/config.toml
    sudo systemctl restart catalyst-agent
    sleep 2
  fi
  log "Agent service is active — waiting for node to come online"
  for i in $(seq 1 40); do
    status="$(api GET "/api/nodes/${NODE_ID}" | jq -r '.data.status // .data.online // .data.connected // empty')"
    log "node status probe: ${status:-unknown}"
    if api GET /api/nodes | jq -e --arg id "$NODE_ID" '.data[] | select(.id==$id) | (.isOnline==true or .status=="online" or .lastSeenAt != null)' >/dev/null 2>&1; then
      log "Node is reporting in"
      return 0
    fi
    sleep 3
  done
  warn "Agent is running but node status was not clearly online; continuing"
}

find_server() {
  local name="$1"
  api GET /api/servers | jq -r --arg n "$name" '.data[]? | select(.name==$n) | .id' | head -1
}

create_server() {
  local payload="$1"
  local name
  name="$(printf '%s' "$payload" | jq -r '.name')"
  local existing
  existing="$(find_server "$name")"
  if [[ -n "$existing" && "$existing" != "null" ]]; then
    printf '%s\n' "$existing"
    return 0
  fi
  local resp
  resp="$(api POST /api/servers "$payload")"
  printf '%s\n' "$resp" > "$LOG_DIR/create-$(echo "$name" | tr ' /' '__').json"
  local id
  id="$(printf '%s' "$resp" | jq -r '.data.id // empty')"
  [[ -n "$id" ]] || fail "server create failed for $name: $resp"
  printf '%s\n' "$id"
}

install_server() {
  local id="$1"
  api POST "/api/servers/${id}/install" '{}' | tee "$LOG_DIR/install-${id}.json" >/dev/null || true
}

start_server() {
  local id="$1"
  api POST "/api/servers/${id}/start" '{}' | tee "$LOG_DIR/start-${id}.json" >/dev/null || true
}

accept_eula() {
  local id="$1"
  api POST /api/servers/eula "$(jq -n --arg serverId "$id" '{serverId:$serverId,accepted:true}')" >/dev/null || true
}

stage_servers() {
  load_state
  [[ -n "${AUTH_TOKEN:-}" ]] || login_or_setup
  [[ -n "${NODE_ID:-}" && -n "${LOCATION_ID:-}" ]] || fail "bootstrap first"
  [[ -n "${PAPER_TEMPLATE_ID:-}" && -n "${SOTF_TEMPLATE_ID:-}" ]] || fail "templates missing — bootstrap first"

  local paper_body sotf_body
  paper_body="$(jq -n \
    --arg name "$MC_NAME" \
    --arg templateId "$PAPER_TEMPLATE_ID" \
    --arg nodeId "$NODE_ID" \
    --arg locationId "$LOCATION_ID" \
    --argjson allocatedMemoryMb "$MC_MEMORY_MB" \
    --argjson allocatedCpuCores "$MC_CPU" \
    --argjson allocatedDiskMb "$MC_DISK_MB" \
    --argjson primaryPort "$MC_PORT" \
    '{
      name:$name,
      description:"Lab Minecraft Paper",
      templateId:$templateId,
      nodeId:$nodeId,
      locationId:$locationId,
      allocatedMemoryMb:$allocatedMemoryMb,
      allocatedCpuCores:$allocatedCpuCores,
      allocatedDiskMb:$allocatedDiskMb,
      primaryPort:$primaryPort,
      networkMode:"bridge",
      environment:{
        MINECRAFT_VERSION:"latest",
        SERVER_JARFILE:"server.jar",
        BUILD_NUMBER:"latest",
        IMAGE_VARIANT:"Java 25",
        EULA:"true"
      }
    }')"

  sotf_body="$(jq -n \
    --arg name "$SOTF_NAME" \
    --arg templateId "$SOTF_TEMPLATE_ID" \
    --arg nodeId "$NODE_ID" \
    --arg locationId "$LOCATION_ID" \
    --argjson allocatedMemoryMb "$SOTF_MEMORY_MB" \
    --argjson allocatedCpuCores "$SOTF_CPU" \
    --argjson allocatedDiskMb "$SOTF_DISK_MB" \
    --argjson primaryPort "$SOTF_PORT" \
    --arg query "$SOTF_QUERY_PORT" \
    --arg blob "$SOTF_BLOB_PORT" \
    --arg pw "$SOTF_PASSWORD" \
    '{
      name:$name,
      description:"Lab Sons of the Forest dedicated server",
      templateId:$templateId,
      nodeId:$nodeId,
      locationId:$locationId,
      allocatedMemoryMb:$allocatedMemoryMb,
      allocatedCpuCores:$allocatedCpuCores,
      allocatedDiskMb:$allocatedDiskMb,
      primaryPort:$primaryPort,
      networkMode:"bridge",
      portBindings:{
        ($query): ($query|tonumber),
        ($blob): ($blob|tonumber)
      },
      environment:{
        QUERY_PORT:$query,
        BLOBSYNC_PORT:$blob,
        SRV_NAME:"Catalyst SotF",
        MAX_PLAYERS:"4",
        SRV_PW:$pw,
        GAME_MODE:"normal",
        AUTO_UPDATE:"1",
        SRCDS_APPID:"2465200",
        WINEDEBUG:"-all",
        WINEARCH:"win64",
        WINEPATH:"/home/container",
        WINETRICKS_RUN:"mono vcrun2019",
        WINDOWS_INSTALL:"1",
        SKIP_TESTS:"true",
        SAVE_SLOT:"0000000001",
        SERVER_PORT:"8766"
      }
    }')"

  PAPER_SERVER_ID="$(create_server "$paper_body")"
  SOTF_SERVER_ID="$(create_server "$sotf_body")"
  save_state PAPER_SERVER_ID "$PAPER_SERVER_ID"
  save_state SOTF_SERVER_ID "$SOTF_SERVER_ID"
  log "Installing + starting Minecraft Paper $PAPER_SERVER_ID"
  install_server "$PAPER_SERVER_ID"
  sleep 3
  start_server "$PAPER_SERVER_ID"
  sleep 8
  accept_eula "$PAPER_SERVER_ID"

  log "Installing + starting Sons of the Forest $SOTF_SERVER_ID"
  install_server "$SOTF_SERVER_ID"
  local sotf_uuid
  sotf_uuid="$(api GET "/api/servers/${SOTF_SERVER_ID}" | jq -r '.data.uuid')"
  if [[ -n "$sotf_uuid" && "$sotf_uuid" != "null" && -d "/var/lib/catalyst/servers/${sotf_uuid}" ]]; then
    install -m 0755 "$LAB_DIR/sotf-start.sh" "/var/lib/catalyst/servers/${sotf_uuid}/start.sh"
  fi
  sleep 3
  start_server "$SOTF_SERVER_ID"

  log "Servers created. Paper=$PAPER_SERVER_ID SotF=$SOTF_SERVER_ID"
}

stage_status() {
  load_state
  echo "=== LXCs ==="
  lxc-ls -f || true
  echo
  echo "=== Panel ==="
  curl -fsS -o /dev/null -w "panel_lxc %{http_code}\n" "http://${PANEL_IP}:8080/" || echo "panel_lxc down"
  curl -fsS -o /dev/null -w "panel_pub %{http_code}\n" "${PUBLIC_URL}/" || echo "panel_pub down"
  echo "=== Backend ==="
  curl -fsS -o /dev/null -w "backend %{http_code}\n" "${BACKEND_PUBLIC}/health" || echo "backend down"
  echo "=== Agent ==="
  systemctl is-active catalyst-agent 2>/dev/null || echo "catalyst-agent inactive"
  if [[ -n "${AUTH_TOKEN:-}" ]]; then
    echo "=== API nodes/servers ==="
    api GET /api/nodes | jq '{nodes:(.data|map({id,name,status,hostname,publicAddress,lastHeartbeat}))}' || true
    api GET /api/servers | jq '{servers:(.data|map({id,name,status,primaryPort,nodeId}))}' || true
  fi
  echo "=== URLs ==="
  echo "Panel:   ${PUBLIC_URL}  (also http://${PANEL_IP}:8080/)"
  echo "Backend: ${BACKEND_PUBLIC}"
  echo "Login:   ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}"
  if have_lxc "${PTERO_PANEL_LXC:-ptero-panel}" || have_lxc "${PTERO_WINGS_LXC:-ptero-wings}" || have_lxc "${PTERO_BULK_WINGS_LXCS%%,*}"; then
    echo
    stage_ptero_status
  fi
}

stage_destroy() {
  local -a extra_wings=()
  ptero_parse_csv extra_wings "${PTERO_BULK_WINGS_LXCS:-}"
  warn "Destroying lab LXCs $BACKEND_LXC $PANEL_LXC ${PTERO_PANEL_LXC:-ptero-panel} ${PTERO_WINGS_LXC:-ptero-wings} ${extra_wings[*]} and host forwards"
  for pidfile in "$STATE_DIR"/run/fwd-*.pid; do
    [[ -f "$pidfile" ]] || continue
    kill "$(cat "$pidfile")" 2>/dev/null || true
    rm -f "$pidfile"
  done
  for name in "$BACKEND_LXC" "$PANEL_LXC" "${PTERO_PANEL_LXC:-ptero-panel}" "${PTERO_WINGS_LXC:-ptero-wings}" "${extra_wings[@]}"; do
    if have_lxc "$name"; then
      lxc-stop -n "$name" -k || true
      lxc-destroy -n "$name" -f || true
    fi
  done
}

stage_all() {
  stage_create
  stage_docker
  stage_deploy
  stage_bootstrap
  stage_agent
  stage_servers
  stage_files
  stage_ops
  stage_sftp
  stage_backups
  stage_storage_backups
  stage_alerts
  stage_automations
  stage_apis
  stage_admin
  stage_everything
  stage_updates
  stage_status
}
# shellcheck disable=SC1091
source "$LAB_DIR/server-ops.sh"
# shellcheck disable=SC1091
source "$LAB_DIR/panel-ops.sh"
source "$LAB_DIR/server-apis.sh"
# shellcheck disable=SC1091
source "$LAB_DIR/admin-ops.sh"
# shellcheck disable=SC1091
source "$LAB_DIR/storage-backups.sh"
source "$LAB_DIR/everything.sh"
# shellcheck disable=SC1091
source "$LAB_DIR/updates.sh"
# shellcheck disable=SC1091
source "$LAB_DIR/live.sh"
# shellcheck disable=SC1091
source "$LAB_DIR/ptero.sh"

cmd="${1:-all}"
case "$cmd" in
  create) stage_create ;;
  docker) stage_docker ;;
  deploy) stage_deploy ;;
  deploy-backend) stage_deploy_backend ;;
  deploy-panel) stage_deploy_panel ;;
  bootstrap) stage_bootstrap ;;
  agent) stage_agent ;;
  servers) stage_servers ;;
  files) stage_files ;;
  ops) stage_ops ;;
  sftp) stage_sftp ;;
  storage-backups) stage_storage_backups ;;
  backups) stage_backups ;;
  alerts) stage_alerts ;;
  automations) stage_automations ;;
  apis) stage_apis ;;
  admin) stage_admin ;;
  everything) stage_everything ;;
  refresh) stage_refresh ;;
  updates) stage_updates ;;
  live) stage_live ;;
  eggs) python3 "$LAB_DIR/egg-inventory.py" ;;
  full) stage_full ;;
  status) stage_status ;;
  destroy) stage_destroy ;;
  ptero) stage_ptero ;;
  ptero-create) stage_ptero_create ;;
  ptero-docker) stage_ptero_docker ;;
  ptero-deploy) stage_ptero_deploy ;;
  ptero-seed) stage_ptero_seed ;;
  ptero-status) stage_ptero_status ;;
  ptero-bulk) ptero_bulk_seed ;;
  ptero-migrate) stage_ptero_migrate ;;
  ptero-destroy) stage_ptero_destroy ;;
  all) stage_all ;;
  --tcp-proxy) ;;
  *)
    echo "Usage: $0 {all|create|docker|deploy|bootstrap|agent|servers|files|ops|sftp|backups|storage-backups|alerts|automations|apis|admin|everything|updates|refresh|live|eggs|full|status|destroy|ptero|ptero-create|ptero-docker|ptero-deploy|ptero-seed|ptero-status|ptero-bulk|ptero-migrate|ptero-destroy}"
    exit 2
    ;;
esac
