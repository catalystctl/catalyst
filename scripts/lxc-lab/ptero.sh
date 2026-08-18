# Pterodactyl panel + Wings fixture for Catalyst migration e2e.
# Sourced from lab.sh. Isolated LXCs; does not reuse catalyst-panel/backend.
# shellcheck shell=bash

PTERO_PANEL_LXC="${PTERO_PANEL_LXC:-ptero-panel}"
PTERO_WINGS_LXC="${PTERO_WINGS_LXC:-ptero-wings}"
PTERO_PANEL_IP="${PTERO_PANEL_IP:-10.0.3.30}"
PTERO_WINGS_IP="${PTERO_WINGS_IP:-10.0.3.31}"
PTERO_BULK_WINGS_LXCS="${PTERO_BULK_WINGS_LXCS:-ptero-wings-02,ptero-wings-03}"
PTERO_BULK_WINGS_IPS="${PTERO_BULK_WINGS_IPS:-10.0.3.34,10.0.3.35}"
PTERO_PANEL_HOST_PORT="${PTERO_PANEL_HOST_PORT:-8090}"
PTERO_WINGS_HOST_PORT="${PTERO_WINGS_HOST_PORT:-8081}"
PTERO_SFTP_HOST_PORT="${PTERO_SFTP_HOST_PORT:-2023}"
PTERO_PANEL_MEMORY="${PTERO_PANEL_MEMORY:-2G}"
PTERO_WINGS_MEMORY="${PTERO_WINGS_MEMORY:-3G}"
PTERO_PANEL_CPU_QUOTA="${PTERO_PANEL_CPU_QUOTA:-200000 100000}"
PTERO_WINGS_CPU_QUOTA="${PTERO_WINGS_CPU_QUOTA:-200000 100000}"

PTERO_PANEL_IMAGE="${PTERO_PANEL_IMAGE:-ghcr.io/pterodactyl/panel:v1.11.11}"
PTERO_WINGS_IMAGE="${PTERO_WINGS_IMAGE:-ghcr.io/pterodactyl/wings:v1.11.13}"
PTERO_URL="${PTERO_URL:-http://${PTERO_PANEL_IP}}"
PTERO_PUBLIC_URL="${PTERO_PUBLIC_URL:-http://${HOST_LAN_IP}:${PTERO_PANEL_HOST_PORT}}"

PTERO_ADMIN_EMAIL="${PTERO_ADMIN_EMAIL:-admin@ptero.local}"
PTERO_ADMIN_USERNAME="${PTERO_ADMIN_USERNAME:-pteroadmin}"
PTERO_ADMIN_PASSWORD="${PTERO_ADMIN_PASSWORD:-PteroLab!2026}"
PTERO_SUBUSER_EMAIL="${PTERO_SUBUSER_EMAIL:-subuser@ptero.local}"
PTERO_SUBUSER_USERNAME="${PTERO_SUBUSER_USERNAME:-pterosub}"
PTERO_SUBUSER_PASSWORD="${PTERO_SUBUSER_PASSWORD:-PteroSub!2026}"

PTERO_LOCATION_SHORT="${PTERO_LOCATION_SHORT:-lab}"
PTERO_LOCATION_LONG="${PTERO_LOCATION_LONG:-Catalyst LXC lab}"
PTERO_NODE_NAME="${PTERO_NODE_NAME:-ptero-wings}"
PTERO_SERVER_NAME="${PTERO_SERVER_NAME:-Ptero Paper}"
PTERO_ALLOC_IP="${PTERO_ALLOC_IP:-${PTERO_WINGS_IP}}"
PTERO_ALLOC_PORT="${PTERO_ALLOC_PORT:-${MC_PORT:-25565}}"
PTERO_ALLOC_EXTRA_PORT="${PTERO_ALLOC_EXTRA_PORT:-25566}"
PTERO_MEMORY_MB="${PTERO_MEMORY_MB:-1024}"
PTERO_DISK_MB="${PTERO_DISK_MB:-2048}"
PTERO_CPU="${PTERO_CPU:-100}"
PTERO_BULK_SERVER_COUNT="${PTERO_BULK_SERVER_COUNT:-50}"
PTERO_BULK_NODE_COUNT="${PTERO_BULK_NODE_COUNT:-3}"
PTERO_BULK_PORT_START="${PTERO_BULK_PORT_START:-25565}"
PTERO_BULK_MEMORY_MB="${PTERO_BULK_MEMORY_MB:-128}"
PTERO_BULK_DISK_MB="${PTERO_BULK_DISK_MB:-256}"

PTERO_DB_PASSWORD="${PTERO_DB_PASSWORD:-ptero_lab_db}"
PTERO_DB_ROOT_PASSWORD="${PTERO_DB_ROOT_PASSWORD:-ptero_lab_root}"

PTERO_COMPOSE_DIR="/root/ptero"

ptero_api() {
  local method="$1"
  local path="$2"
  local data="${3:-}"
  local key="${4:-${PTERO_APP_KEY:-}}"
  local args=(-sS -X "$method" -H "Accept: application/vnd.pterodactyl.v1+json")
  if [[ -n "$key" ]]; then
    args+=(-H "Authorization: Bearer ${key}")
  fi
  if [[ -n "$data" ]]; then
    args+=(-H "Content-Type: application/json" -d "$data")
  fi
  curl "${args[@]}" "${PTERO_URL}${path}"
}

ptero_api_ex() {
  local method="$1"
  local path="$2"
  local data="${3:-}"
  local key="${4:-${PTERO_APP_KEY:-}}"
  local args=(-sS -X "$method" -H "Accept: application/vnd.pterodactyl.v1+json"
    -w $'\n%{http_code}')
  if [[ -n "$key" ]]; then
    args+=(-H "Authorization: Bearer ${key}")
  fi
  if [[ -n "$data" ]]; then
    args+=(-H "Content-Type: application/json" -d "$data")
  fi
  local out
  out="$(curl "${args[@]}" "${PTERO_URL}${path}")"
  LAST_STATUS="${out##*$'\n'}"
  LAST_BODY="${out%$'\n'*}"
}

ptero_client_api_ex() {
  ptero_api_ex "$1" "$2" "${3:-}" "${PTERO_CLIENT_KEY:-}"
}

require_ptero_keys() {
  load_state
  [[ -n "${PTERO_APP_KEY:-}" ]] || fail "PTERO_APP_KEY missing — run ptero-seed first"
  [[ -n "${PTERO_CLIENT_KEY:-}" ]] || fail "PTERO_CLIENT_KEY missing — run ptero-seed first"
}

write_ptero_panel_env() {
  local tmp
  tmp="$(mktemp)"
  cat > "$tmp" <<EOF
PTERO_PANEL_IMAGE=${PTERO_PANEL_IMAGE}
PTERO_URL=${PTERO_URL}
PTERO_ADMIN_EMAIL=${PTERO_ADMIN_EMAIL}
PTERO_DB_PASSWORD=${PTERO_DB_PASSWORD}
PTERO_DB_ROOT_PASSWORD=${PTERO_DB_ROOT_PASSWORD}
EOF
  push_file "$PTERO_PANEL_LXC" "$tmp" "${PTERO_COMPOSE_DIR}/.env"
  rm -f "$tmp"
}

write_ptero_wings_env() {
  local lxc="${1:-$PTERO_WINGS_LXC}"
  local tmp
  tmp="$(mktemp)"
  cat > "$tmp" <<EOF
PTERO_WINGS_IMAGE=${PTERO_WINGS_IMAGE}
EOF
  push_file "$lxc" "$tmp" "${PTERO_COMPOSE_DIR}/.env"
  rm -f "$tmp"
}

push_ptero_wings_compose() {
  local lxc="${1:-$PTERO_WINGS_LXC}"
  push_file "$lxc" "$LAB_DIR/compose/docker-compose.ptero-wings.yml" \
    "${PTERO_COMPOSE_DIR}/docker-compose.yml"
  write_ptero_wings_env "$lxc"
}

ptero_parse_csv() {
  local -n _ptero_csv_dest="$1"
  local raw="${2:-}"
  _ptero_csv_dest=()
  [[ -n "$raw" ]] || return 0
  IFS=',' read -r -a _ptero_csv_dest <<< "$raw"
}

ptero_bulk_wings_topology() {
  ptero_parse_csv PTERO_EXTRA_WINGS_LXCS "${PTERO_BULK_WINGS_LXCS:-}"
  ptero_parse_csv PTERO_EXTRA_WINGS_IPS "${PTERO_BULK_WINGS_IPS:-}"
  local expected=$((PTERO_BULK_NODE_COUNT - 1))
  [[ "$expected" -ge 0 ]] || fail "PTERO_BULK_NODE_COUNT must be >= 1"
  [[ "${#PTERO_EXTRA_WINGS_LXCS[@]}" -eq "$expected" ]] \
    || fail "PTERO_BULK_WINGS_LXCS needs exactly ${expected} names"
  [[ "${#PTERO_EXTRA_WINGS_IPS[@]}" -eq "$expected" ]] \
    || fail "PTERO_BULK_WINGS_IPS needs exactly ${expected} addresses"
}

ptero_all_wings_lxcs() {
  local -n _ptero_wings_dest="$1"
  ptero_parse_csv PTERO_EXTRA_WINGS_LXCS "${PTERO_BULK_WINGS_LXCS:-}"
  _ptero_wings_dest=("$PTERO_WINGS_LXC" "${PTERO_EXTRA_WINGS_LXCS[@]}")
}

push_ptero_compose() {
  push_file "$PTERO_PANEL_LXC" "$LAB_DIR/compose/docker-compose.ptero-panel.yml" \
    "${PTERO_COMPOSE_DIR}/docker-compose.yml"
  write_ptero_panel_env
  push_ptero_wings_compose "$PTERO_WINGS_LXC"
}

stage_ptero_create() {
  ensure_host_tools
  create_one_lxc "$PTERO_PANEL_LXC" "$PTERO_PANEL_IP" "$PTERO_PANEL_MEMORY" "$PTERO_PANEL_CPU_QUOTA"
  create_one_lxc "$PTERO_WINGS_LXC" "$PTERO_WINGS_IP" "$PTERO_WINGS_MEMORY" "$PTERO_WINGS_CPU_QUOTA"
  write_netplan "$PTERO_PANEL_LXC" "$PTERO_PANEL_IP"
  write_netplan "$PTERO_WINGS_LXC" "$PTERO_WINGS_IP"
}

stage_ptero_docker() {
  have_lxc "$PTERO_PANEL_LXC" || fail "Ptero panel LXC missing — run ptero-create first"
  have_lxc "$PTERO_WINGS_LXC" || fail "Ptero Wings LXC missing — run ptero-create first"
  install_docker_in "$PTERO_PANEL_LXC"
  install_docker_in "$PTERO_WINGS_LXC"
}

start_ptero_forwards() {
  mkdir -p "$STATE_DIR/run"
  local map spec host_port dest_ip dest_port pidfile
  map="${PTERO_PANEL_HOST_PORT}:${PTERO_PANEL_IP}:80 ${PTERO_WINGS_HOST_PORT}:${PTERO_WINGS_IP}:8080 ${PTERO_SFTP_HOST_PORT}:${PTERO_WINGS_IP}:2022"
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

wait_ptero_panel() {
  wait_http "${PTERO_URL}/" 80 || fail "Pterodactyl panel never became ready at ${PTERO_URL}/"
}

ptero_panel_exec() {
  lxc_exec "$PTERO_PANEL_LXC" bash -lc "cd ${PTERO_COMPOSE_DIR} && docker compose exec -T panel $*"
}

ptero_panel_php() {
  local tmp dest
  tmp="$(mktemp)"
  dest="/tmp/ptero-lab-$(date +%s)-$RANDOM.php"
  cat > "$tmp"
  push_file "$PTERO_PANEL_LXC" "$tmp" "$dest"
  rm -f "$tmp"
  lxc_exec "$PTERO_PANEL_LXC" bash -lc "
    set -euo pipefail
    docker compose -f ${PTERO_COMPOSE_DIR}/docker-compose.yml cp '${dest}' panel:${dest}
    docker compose -f ${PTERO_COMPOSE_DIR}/docker-compose.yml exec -T panel php '${dest}'
    rm -f '${dest}'
  "
}

ptero_ensure_admin() {
  local existing
  existing="$(ptero_panel_php <<PHP | tr -d '\r'
<?php
require '/app/vendor/autoload.php';
\$app = require '/app/bootstrap/app.php';
\$app->make(Illuminate\\Contracts\\Console\\Kernel::class)->bootstrap();
echo Pterodactyl\\Models\\User::where('email', '${PTERO_ADMIN_EMAIL}')->exists() ? '1' : '0';
PHP
)"
  if [[ "$existing" == *"1"* ]]; then
    log "Ptero admin ${PTERO_ADMIN_EMAIL} already exists"
    return 0
  fi
  log "Creating Ptero root admin ${PTERO_ADMIN_EMAIL}"
  ptero_panel_exec php artisan p:user:make \
    --email="${PTERO_ADMIN_EMAIL}" \
    --username="${PTERO_ADMIN_USERNAME}" \
    --name-first=Ptero \
    --name-last=Admin \
    --password="${PTERO_ADMIN_PASSWORD}" \
    --admin=1
}

ptero_ensure_subuser() {
  local existing
  existing="$(ptero_panel_php <<PHP | tr -d '\r'
<?php
require '/app/vendor/autoload.php';
\$app = require '/app/bootstrap/app.php';
\$app->make(Illuminate\\Contracts\\Console\\Kernel::class)->bootstrap();
echo Pterodactyl\\Models\\User::where('email', '${PTERO_SUBUSER_EMAIL}')->exists() ? '1' : '0';
PHP
)"
  if [[ "$existing" == *"1"* ]]; then
    log "Ptero subuser ${PTERO_SUBUSER_EMAIL} already exists"
    return 0
  fi
  log "Creating Ptero subuser ${PTERO_SUBUSER_EMAIL}"
  ptero_panel_exec php artisan p:user:make \
    --email="${PTERO_SUBUSER_EMAIL}" \
    --username="${PTERO_SUBUSER_USERNAME}" \
    --name-first=Ptero \
    --name-last=Sub \
    --password="${PTERO_SUBUSER_PASSWORD}" \
    --admin=0
}

ptero_mint_app_key() {
  if [[ -n "${PTERO_APP_KEY:-}" ]]; then
    ptero_api_ex GET /api/application/locations
    if [[ "$LAST_STATUS" == "200" ]]; then
      log "Reusing stored Application API key"
      return 0
    fi
  fi
  log "Minting Application API key via panel PHP"
  local out token
  out="$(ptero_panel_php <<PHP
<?php
require '/app/vendor/autoload.php';
\$app = require '/app/bootstrap/app.php';
\$app->make(Illuminate\\Contracts\\Console\\Kernel::class)->bootstrap();
\$user = Pterodactyl\\Models\\User::where('email', '${PTERO_ADMIN_EMAIL}')->firstOrFail();
\$secret = Illuminate\\Support\\Str::random(Pterodactyl\\Models\\ApiKey::KEY_LENGTH);
\$ident = Pterodactyl\\Models\\ApiKey::generateTokenIdentifier(Pterodactyl\\Models\\ApiKey::TYPE_APPLICATION);
\$key = new Pterodactyl\\Models\\ApiKey();
\$key->forceFill([
  'user_id' => \$user->id,
  'key_type' => Pterodactyl\\Models\\ApiKey::TYPE_APPLICATION,
  'identifier' => \$ident,
  'token' => encrypt(\$secret),
  'memo' => 'catalyst-lxc-lab',
  'r_servers' => 3,
  'r_nodes' => 3,
  'r_allocations' => 3,
  'r_users' => 3,
  'r_locations' => 3,
  'r_nests' => 3,
  'r_eggs' => 3,
  'r_database_hosts' => 3,
  'r_server_databases' => 3,
]);
\$key->save();
echo 'PTERO_TOKEN='.\$ident.\$secret;
PHP
)"
  token="$(printf '%s' "$out" | tr -d '\r' | grep -Eo 'PTERO_TOKEN=ptla_[A-Za-z0-9]+' | tail -1 | cut -d= -f2)"
  [[ -n "$token" ]] || fail "failed to mint Application API key: $out"
  PTERO_APP_KEY="$token"
  save_state PTERO_APP_KEY "$PTERO_APP_KEY"
}

ptero_mint_client_key() {
  if [[ -n "${PTERO_CLIENT_KEY:-}" ]]; then
    ptero_client_api_ex GET /api/client
    if [[ "$LAST_STATUS" == "200" ]]; then
      log "Reusing stored Client API key"
      return 0
    fi
  fi
  log "Minting Client API key via panel PHP"
  local out token
  out="$(ptero_panel_php <<PHP
<?php
require '/app/vendor/autoload.php';
\$app = require '/app/bootstrap/app.php';
\$app->make(Illuminate\\Contracts\\Console\\Kernel::class)->bootstrap();
\$user = Pterodactyl\\Models\\User::where('email', '${PTERO_ADMIN_EMAIL}')->firstOrFail();
\$secret = Illuminate\\Support\\Str::random(Pterodactyl\\Models\\ApiKey::KEY_LENGTH);
\$ident = Pterodactyl\\Models\\ApiKey::generateTokenIdentifier(Pterodactyl\\Models\\ApiKey::TYPE_ACCOUNT);
\$key = new Pterodactyl\\Models\\ApiKey();
\$key->forceFill([
  'user_id' => \$user->id,
  'key_type' => Pterodactyl\\Models\\ApiKey::TYPE_ACCOUNT,
  'identifier' => \$ident,
  'token' => encrypt(\$secret),
  'memo' => 'catalyst-lxc-lab-client',
]);
\$key->save();
echo 'PTERO_TOKEN='.\$ident.\$secret;
PHP
)"
  token="$(printf '%s' "$out" | tr -d '\r' | grep -Eo 'PTERO_TOKEN=ptlc_[A-Za-z0-9]+' | tail -1 | cut -d= -f2)"
  [[ -n "$token" ]] || fail "failed to mint Client API key: $out"
  PTERO_CLIENT_KEY="$token"
  save_state PTERO_CLIENT_KEY "$PTERO_CLIENT_KEY"
}

ptero_json_id() {
  printf '%s' "$1" | jq -er '.attributes.id // .data.attributes.id // empty'
}

ptero_ensure_location() {
  local list id
  list="$(ptero_api GET /api/application/locations)"
  id="$(printf '%s' "$list" | jq -r --arg s "$PTERO_LOCATION_SHORT" '.data[]? | select(.attributes.short==$s) | .attributes.id' | head -1)"
  if [[ -z "$id" || "$id" == "null" ]]; then
    list="$(ptero_api POST /api/application/locations "$(jq -n --arg short "$PTERO_LOCATION_SHORT" --arg long "$PTERO_LOCATION_LONG" '{short:$short,long:$long}')")"
    id="$(ptero_json_id "$list")"
  fi
  [[ -n "$id" && "$id" != "null" ]] || fail "could not create Ptero location: $list"
  PTERO_LOCATION_ID="$id"
  save_state PTERO_LOCATION_ID "$PTERO_LOCATION_ID"
}

ptero_ensure_node() {
  local list id
  list="$(ptero_api GET /api/application/nodes)"
  id="$(printf '%s' "$list" | jq -r --arg n "$PTERO_NODE_NAME" '.data[]? | select(.attributes.name==$n) | .attributes.id' | head -1)"
  if [[ -z "$id" || "$id" == "null" ]]; then
    local body
    body="$(jq -n \
      --arg name "$PTERO_NODE_NAME" \
      --argjson location_id "$PTERO_LOCATION_ID" \
      --arg fqdn "$PTERO_WINGS_IP" \
      '{
        name:$name,
        location_id:$location_id,
        fqdn:$fqdn,
        scheme:"http",
        behind_proxy:false,
        memory:8192,
        memory_overallocate:0,
        disk:20480,
        disk_overallocate:0,
        upload_size:100,
        daemon_listen:8080,
        daemon_sftp:2022,
        daemon_base:"/var/lib/pterodactyl/volumes"
      }')"
    list="$(ptero_api POST /api/application/nodes "$body")"
    id="$(ptero_json_id "$list")"
  fi
  [[ -n "$id" && "$id" != "null" ]] || fail "could not create Ptero node: $list"
  PTERO_NODE_ID="$id"
  save_state PTERO_NODE_ID "$PTERO_NODE_ID"
}

ptero_ensure_allocations() {
  local list
  list="$(ptero_api GET "/api/application/nodes/${PTERO_NODE_ID}/allocations")"
  local have_primary have_extra
  have_primary="$(printf '%s' "$list" | jq -r --arg ip "$PTERO_ALLOC_IP" --argjson port "$PTERO_ALLOC_PORT" \
    '.data[]? | select(.attributes.ip==$ip and .attributes.port==$port) | .attributes.id' | head -1)"
  have_extra="$(printf '%s' "$list" | jq -r --arg ip "$PTERO_ALLOC_IP" --argjson port "$PTERO_ALLOC_EXTRA_PORT" \
    '.data[]? | select(.attributes.ip==$ip and .attributes.port==$port) | .attributes.id' | head -1)"
  if [[ -z "$have_primary" || "$have_primary" == "null" || -z "$have_extra" || "$have_extra" == "null" ]]; then
    ptero_api POST "/api/application/nodes/${PTERO_NODE_ID}/allocations" "$(jq -n \
      --arg ip "$PTERO_ALLOC_IP" \
      --argjson p1 "$PTERO_ALLOC_PORT" \
      --argjson p2 "$PTERO_ALLOC_EXTRA_PORT" \
      '{ip:$ip,ports:[$p1|tostring,$p2|tostring]}')" >/dev/null
    list="$(ptero_api GET "/api/application/nodes/${PTERO_NODE_ID}/allocations")"
    have_primary="$(printf '%s' "$list" | jq -r --arg ip "$PTERO_ALLOC_IP" --argjson port "$PTERO_ALLOC_PORT" \
      '.data[]? | select(.attributes.ip==$ip and .attributes.port==$port) | .attributes.id' | head -1)"
    have_extra="$(printf '%s' "$list" | jq -r --arg ip "$PTERO_ALLOC_IP" --argjson port "$PTERO_ALLOC_EXTRA_PORT" \
      '.data[]? | select(.attributes.ip==$ip and .attributes.port==$port) | .attributes.id' | head -1)"
  fi
  [[ -n "$have_primary" && "$have_primary" != "null" ]] || fail "primary allocation ${PTERO_ALLOC_IP}:${PTERO_ALLOC_PORT} missing"
  [[ -n "$have_extra" && "$have_extra" != "null" ]] || fail "extra allocation ${PTERO_ALLOC_IP}:${PTERO_ALLOC_EXTRA_PORT} missing"
  PTERO_ALLOC_ID="$have_primary"
  PTERO_ALLOC_EXTRA_ID="$have_extra"
  save_state PTERO_ALLOC_ID "$PTERO_ALLOC_ID"
  save_state PTERO_ALLOC_EXTRA_ID "$PTERO_ALLOC_EXTRA_ID"
  save_state PTERO_ALLOC_IP "$PTERO_ALLOC_IP"
  save_state PTERO_ALLOC_PORT "$PTERO_ALLOC_PORT"
}

ptero_ensure_egg() {
  local nests nest_id eggs egg_id
  nests="$(ptero_api GET /api/application/nests)"
  nest_id="$(printf '%s' "$nests" | jq -r '.data[]? | select(.attributes.name=="Minecraft") | .attributes.id' | head -1)"
  [[ -n "$nest_id" && "$nest_id" != "null" ]] || fail "Minecraft nest missing after panel seed"
  eggs="$(ptero_api GET "/api/application/nests/${nest_id}/eggs")"
  egg_id="$(printf '%s' "$eggs" | jq -r '.data[]? | select(.attributes.name=="Paper") | .attributes.id' | head -1)"
  if [[ -z "$egg_id" || "$egg_id" == "null" ]]; then
    egg_id="$(printf '%s' "$eggs" | jq -r '.data[]? | select(.attributes.name|test("Paper|Vanilla";"i")) | .attributes.id' | head -1)"
  fi
  [[ -n "$egg_id" && "$egg_id" != "null" ]] || fail "Paper/Vanilla egg missing after panel seed"
  PTERO_NEST_ID="$nest_id"
  PTERO_EGG_ID="$egg_id"
  save_state PTERO_NEST_ID "$PTERO_NEST_ID"
  save_state PTERO_EGG_ID "$PTERO_EGG_ID"
}

ptero_ensure_users() {
  local users admin_id sub_id
  users="$(ptero_api GET /api/application/users)"
  admin_id="$(printf '%s' "$users" | jq -r --arg e "$PTERO_ADMIN_EMAIL" '.data[]? | select(.attributes.email==$e) | .attributes.id' | head -1)"
  sub_id="$(printf '%s' "$users" | jq -r --arg e "$PTERO_SUBUSER_EMAIL" '.data[]? | select(.attributes.email==$e) | .attributes.id' | head -1)"
  [[ -n "$admin_id" && "$admin_id" != "null" ]] || fail "Ptero admin user not visible via Application API"
  [[ -n "$sub_id" && "$sub_id" != "null" ]] || fail "Ptero subuser not visible via Application API"
  PTERO_ADMIN_ID="$admin_id"
  PTERO_SUBUSER_ID="$sub_id"
  save_state PTERO_ADMIN_ID "$PTERO_ADMIN_ID"
  save_state PTERO_SUBUSER_ID "$PTERO_SUBUSER_ID"
}

ptero_ensure_server() {
  local servers id uuid
  servers="$(ptero_api GET /api/application/servers)"
  id="$(printf '%s' "$servers" | jq -r --arg n "$PTERO_SERVER_NAME" '.data[]? | select(.attributes.name==$n) | .attributes.id' | head -1)"
  if [[ -z "$id" || "$id" == "null" ]]; then
    local egg docker startup env body
    egg="$(ptero_api GET "/api/application/nests/${PTERO_NEST_ID}/eggs/${PTERO_EGG_ID}?include=variables")"
    docker="$(printf '%s' "$egg" | jq -r '.attributes.docker_image // (.attributes.docker_images|to_entries[0].value)')"
    startup="$(printf '%s' "$egg" | jq -r '.attributes.startup')"
    env="$(printf '%s' "$egg" | jq '
      reduce (.attributes.relationships.variables.data // [])[] as $v
        ({}; .[$v.attributes.env_variable] = $v.attributes.default_value)
      + {SERVER_JARFILE:"server.jar", MINECRAFT_VERSION:"1.21.1", BUILD_NUMBER:"latest"}
    ')"
    body="$(jq -n \
      --arg name "$PTERO_SERVER_NAME" \
      --argjson user "$PTERO_ADMIN_ID" \
      --argjson egg "$PTERO_EGG_ID" \
      --arg docker_image "$docker" \
      --arg startup "$startup" \
      --argjson environment "$env" \
      --argjson memory "$PTERO_MEMORY_MB" \
      --argjson disk "$PTERO_DISK_MB" \
      --argjson cpu "$PTERO_CPU" \
      --argjson allocation "$PTERO_ALLOC_ID" \
      --argjson extra "$PTERO_ALLOC_EXTRA_ID" \
      '{
        name:$name,
        user:$user,
        egg:$egg,
        docker_image:$docker_image,
        startup:$startup,
        environment:$environment,
        skip_scripts:true,
        start_on_completion:false,
        limits:{memory:$memory,swap:0,disk:$disk,io:500,cpu:$cpu},
        feature_limits:{databases:1,allocations:2,backups:2},
        allocation:{default:$allocation,additional:[$extra]}
      }')"
    servers="$(ptero_api POST /api/application/servers "$body")"
    printf '%s\n' "$servers" > "$LOG_DIR/ptero-create-server.json"
    id="$(ptero_json_id "$servers")"
  fi
  [[ -n "$id" && "$id" != "null" ]] || fail "could not create Ptero server: ${servers:-}"
  servers="$(ptero_api GET "/api/application/servers/${id}")"
  uuid="$(printf '%s' "$servers" | jq -r '.attributes.uuid')"
  PTERO_SERVER_ID="$id"
  PTERO_SERVER_UUID="$uuid"
  save_state PTERO_SERVER_ID "$PTERO_SERVER_ID"
  save_state PTERO_SERVER_UUID "$PTERO_SERVER_UUID"
}

ptero_seed_tiny_files() {
  local uuid="${PTERO_SERVER_UUID}"
  local vol="/var/lib/pterodactyl/volumes/${uuid}"
  lxc_exec "$PTERO_WINGS_LXC" bash -lc "
    set -euo pipefail
    mkdir -p '${vol}'
    if [[ ! -f '${vol}/eula.txt' ]]; then
      printf 'eula=true\n' > '${vol}/eula.txt'
    fi
    if [[ ! -f '${vol}/server.properties' ]]; then
      printf 'server-port=${PTERO_ALLOC_PORT}\nmotd=Ptero Lab Paper\n' > '${vol}/server.properties'
    fi
    if [[ ! -f '${vol}/server.jar' ]]; then
      printf 'tiny-fixture-jar\n' > '${vol}/server.jar'
    fi
    chown -R 988:988 '${vol}' || true
  "
}

ptero_mark_server_installed() {
  ptero_panel_php <<PHP >/dev/null
<?php
require '/app/vendor/autoload.php';
\$app = require '/app/bootstrap/app.php';
\$app->make(Illuminate\\Contracts\\Console\\Kernel::class)->bootstrap();
\$server = Pterodactyl\\Models\\Server::query()->findOrFail(${PTERO_SERVER_ID});
if (\$server->installed_at === null) {
    \$server->forceFill(['installed_at' => Illuminate\\Support\\Carbon::now()])->save();
}
PHP
}

ptero_ensure_schedule() {
  ptero_client_api_ex GET "/api/client/servers/${PTERO_SERVER_UUID}/schedules"
  [[ "$LAST_STATUS" == "200" ]] || fail "client schedules list HTTP $LAST_STATUS ${LAST_BODY:0:200}"
  local existing
  existing="$(printf '%s' "$LAST_BODY" | jq -r '.data[]? | select(.attributes.name=="lab-restart") | .attributes.id' | head -1)"
  if [[ -n "$existing" && "$existing" != "null" ]]; then
    PTERO_SCHEDULE_ID="$existing"
    save_state PTERO_SCHEDULE_ID "$PTERO_SCHEDULE_ID"
    return 0
  fi
  ptero_client_api_ex POST "/api/client/servers/${PTERO_SERVER_UUID}/schedules" \
    '{"name":"lab-restart","is_active":false,"minute":"0","hour":"4","day_of_month":"*","month":"*","day_of_week":"*"}'
  [[ "$LAST_STATUS" == "200" || "$LAST_STATUS" == "201" ]] || fail "create schedule HTTP $LAST_STATUS ${LAST_BODY:0:200}"
  PTERO_SCHEDULE_ID="$(printf '%s' "$LAST_BODY" | jq -r '.attributes.id')"
  save_state PTERO_SCHEDULE_ID "$PTERO_SCHEDULE_ID"
}

ptero_ensure_subuser_access() {
  ptero_client_api_ex GET "/api/client/servers/${PTERO_SERVER_UUID}/users"
  [[ "$LAST_STATUS" == "200" ]] || fail "client users list HTTP $LAST_STATUS ${LAST_BODY:0:200}"
  local existing
  existing="$(printf '%s' "$LAST_BODY" | jq -r --arg e "$PTERO_SUBUSER_EMAIL" '.data[]? | select(.attributes.email==$e) | .attributes.uuid' | head -1)"
  if [[ -n "$existing" && "$existing" != "null" ]]; then
    return 0
  fi
  ptero_client_api_ex POST "/api/client/servers/${PTERO_SERVER_UUID}/users" \
    "$(jq -n --arg email "$PTERO_SUBUSER_EMAIL" '{email:$email,permissions:["control.console","file.read"]}')"
  [[ "$LAST_STATUS" == "200" || "$LAST_STATUS" == "201" ]] \
    || fail "create subuser HTTP $LAST_STATUS ${LAST_BODY:0:200}"
}

ptero_write_wings_config() {
  local node_id="${1:-$PTERO_NODE_ID}"
  local lxc="${2:-$PTERO_WINGS_LXC}"
  local cfg tmp
  cfg="$(ptero_api GET "/api/application/nodes/${node_id}/configuration")"
  printf '%s\n' "$cfg" | jq -e '.uuid and .token' >/dev/null \
    || fail "node configuration missing uuid/token: $cfg"
  tmp="$(mktemp)"
  printf '%s\n' "$cfg" | python3 -c '
import json, sys
cfg = json.load(sys.stdin)
api = cfg.get("api") or {}
api["host"] = "0.0.0.0"
api["port"] = 8080
api["ssl"] = {"enabled": False, "cert": "/etc/letsencrypt/live/example/fullchain.pem", "key": "/etc/letsencrypt/live/example/privkey.pem"}
cfg["api"] = api
cfg["remote"] = "'"${PTERO_URL}"'"
cfg["allowed_origins"] = ["'"${PTERO_URL}"'", "'"${PTERO_PUBLIC_URL}"'"]
cfg["allow_cors_private_network"] = True
print(json.dumps(cfg))
' > "${tmp}.json"
  # Wings reads YAML; convert JSON configuration to YAML without extra deps.
  python3 - "$tmp.json" "$tmp" <<'PY'
import json, sys
src, dest = sys.argv[1], sys.argv[2]

def dump(value, indent=0):
    pad = "  " * indent
    if isinstance(value, dict):
        if not value:
            return "{}\n"
        out = ""
        for k, v in value.items():
            if isinstance(v, (dict, list)):
                out += f"{pad}{k}:\n{dump(v, indent + 1)}"
            else:
                out += f"{pad}{k}: {dump(v, 0)}"
        return out
    if isinstance(value, list):
        if not value:
            return f"{pad}[]\n" if indent else "[]\n"
        out = ""
        for item in value:
            if isinstance(item, (dict, list)):
                nested = dump(item, indent + 1)
                first, rest = nested.split("\n", 1)
                out += f"{pad}- {first.lstrip()}"
                if rest:
                    out += rest if rest.endswith("\n") else rest + "\n"
            else:
                out += f"{pad}- {dump(item, 0)}"
        return out
    if value is True:
        return "true\n"
    if value is False:
        return "false\n"
    if value is None:
        return "null\n"
    if isinstance(value, (int, float)):
        return f"{value}\n"
    text = str(value).replace("\\", "\\\\").replace('"', '\\"')
    return f"\"{text}\"\n"

data = json.load(open(src))
open(dest, "w").write(dump(data))
PY
  push_file "$lxc" "$tmp" /etc/pterodactyl/config.yml
  rm -f "$tmp" "${tmp}.json"
}

ptero_update_node_allocation_ip() {
  local node_id="$1"
  local ip="$2"
  [[ "$node_id" =~ ^[0-9]+$ ]] || fail "invalid Ptero node id: ${node_id}"
  [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "invalid Wings IP: ${ip}"
  ptero_panel_php <<PHP >/dev/null
<?php
require '/app/vendor/autoload.php';
\$app = require '/app/bootstrap/app.php';
\$app->make(Illuminate\\Contracts\\Console\\Kernel::class)->bootstrap();
Pterodactyl\\Models\\Allocation::query()
    ->where('node_id', ${node_id})
    ->where('ip', '!=', '${ip}')
    ->update(['ip' => '${ip}', 'ip_alias' => null]);
PHP
}

ptero_start_wings() {
  local lxc="${1:-$PTERO_WINGS_LXC}"
  local ip="${2:-$PTERO_WINGS_IP}"
  log "Starting official Wings stack in ${lxc}"
  lxc_exec "$lxc" bash -lc "
    set -euo pipefail
    mkdir -p /etc/pterodactyl /var/lib/pterodactyl /var/log/pterodactyl /tmp/pterodactyl
    cd ${PTERO_COMPOSE_DIR}
    docker compose pull
    docker compose up -d
  "
  wait_http "http://${ip}:8080/api/system" 40 \
    || warn "Wings /api/system not answering at ${ip} yet (config may still be loading)"
}

ptero_prepare_extra_wings() {
  ensure_host_tools
  ptero_bulk_wings_topology
  local i lxc ip
  for i in "${!PTERO_EXTRA_WINGS_LXCS[@]}"; do
    lxc="${PTERO_EXTRA_WINGS_LXCS[$i]}"
    ip="${PTERO_EXTRA_WINGS_IPS[$i]}"
    create_one_lxc "$lxc" "$ip" "$PTERO_WINGS_MEMORY" "$PTERO_WINGS_CPU_QUOTA"
    write_netplan "$lxc" "$ip"
    install_docker_in "$lxc"
    push_ptero_wings_compose "$lxc"
  done
}

stage_ptero_deploy() {
  have_lxc "$PTERO_PANEL_LXC" || fail "Ptero panel LXC missing — run ptero-create first"
  have_lxc "$PTERO_WINGS_LXC" || fail "Ptero Wings LXC missing — run ptero-create first"
  lxc_running "$PTERO_PANEL_LXC" || fail "Ptero panel LXC not running"
  lxc_running "$PTERO_WINGS_LXC" || fail "Ptero Wings LXC not running"
  push_ptero_compose
  log "Starting official Pterodactyl panel stack"
  lxc_exec "$PTERO_PANEL_LXC" bash -lc "
    set -euo pipefail
    mkdir -p /srv/pterodactyl/var /srv/pterodactyl/nginx /srv/pterodactyl/logs /srv/pterodactyl/database
    cd ${PTERO_COMPOSE_DIR}
    docker compose pull
    docker compose up -d
  "
  wait_ptero_panel
  start_ptero_forwards
  wait_http "${PTERO_PUBLIC_URL}/" 20 || warn "host publish ${PTERO_PUBLIC_URL} not reachable yet"
  save_state PTERO_URL "$PTERO_URL"
  save_state PTERO_PUBLIC_URL "$PTERO_PUBLIC_URL"
}

stage_ptero_seed() {
  have_lxc "$PTERO_PANEL_LXC" || fail "Ptero panel LXC missing — run ptero-create first"
  have_lxc "$PTERO_WINGS_LXC" || fail "Ptero Wings LXC missing — run ptero-create first"
  wait_ptero_panel
  load_state
  ptero_ensure_admin
  ptero_ensure_subuser
  ptero_mint_app_key
  ptero_mint_client_key
  ptero_ensure_location
  ptero_ensure_node
  ptero_ensure_allocations
  ptero_ensure_egg
  ptero_ensure_users
  ptero_write_wings_config
  ptero_start_wings
  ptero_ensure_server
  ptero_seed_tiny_files
  ptero_mark_server_installed
  ptero_ensure_schedule
  ptero_ensure_subuser_access
  start_ptero_forwards
  log "Ptero seed complete. url=${PTERO_URL} node=${PTERO_NODE_ID} server=${PTERO_SERVER_ID} alloc=${PTERO_ALLOC_IP}:${PTERO_ALLOC_PORT}"
}

ptero_seed_bulk_files_backups() {
  load_state
  require_ptero_keys
  local -a wings_lxcs wings_ips
  ptero_all_wings_lxcs wings_lxcs
  ptero_parse_csv PTERO_EXTRA_WINGS_IPS "${PTERO_BULK_WINGS_IPS:-}"
  wings_ips=("$PTERO_WINGS_IP" "${PTERO_EXTRA_WINGS_IPS[@]}")

  # Bulk servers are tiny fixtures. Use the supported build endpoint to give
  # each server a backup slot before using the Client API.
  local servers id uuid node_index lxc ip volume backups backup_uuid status attempt tmp server_json build_body
  servers="$(ptero_api GET '/api/application/servers?per_page=100')"
  while IFS=$'\t' read -r id uuid node_index; do
    [[ -n "$id" ]] || continue
    server_json="$(ptero_api GET "/api/application/servers/${id}")"
    build_body="$(printf '%s' "$server_json" | jq '.attributes | {allocation:(.allocation|if type=="number" then . else .id end),memory:.limits.memory,swap:.limits.swap,disk:.limits.disk,io:.limits.io,cpu:.limits.cpu,feature_limits:(.feature_limits+{backups:1})}')"
    ptero_api_ex PATCH "/api/application/servers/${id}/build" "$build_body"
    [[ "$LAST_STATUS" == "200" ]] || fail "could not set backup slot for server ${id}: HTTP ${LAST_STATUS} ${LAST_BODY:0:200}"
  done < <(printf '%s' "$servers" | jq -r '.data[] | [.attributes.id,.attributes.uuid,.attributes.node] | @tsv')
  while IFS=$'\t' read -r id uuid node_index; do
    [[ -n "$id" ]] || continue
    lxc="${wings_lxcs[$((node_index-1))]}"
    ip="${wings_ips[$((node_index-1))]}"
    volume="/var/lib/pterodactyl/volumes/${uuid}"
    lxc_exec "$lxc" bash -lc "
      set -euo pipefail
      mkdir -p '${volume}'
      printf 'fixture-server=%s\\nnode=%s\\n' '${id}' '${ip}' > '${volume}/catalyst-migration-fixture.txt'
      printf 'eula=true\\nserver-port=%s\\n' '$((25565 + id))' > '${volume}/eula.txt'
      printf 'motd=Catalyst migration fixture %s\\nserver-port=%s\\n' '${id}' '$((25565 + id))' > '${volume}/server.properties'
      printf 'fixture-%s\\n' '${uuid}' > '${volume}/server.jar'
      chown -R 988:988 '${volume}' || true
    "

    ptero_client_api_ex GET "/api/client/servers/${uuid}/backups"
    backups="$LAST_BODY"
    backup_uuid="$(printf '%s' "$backups" | jq -r '.data[]? | select(.attributes.is_successful==true or .attributes.completed_at!=null) | .attributes.uuid' | head -1)"
    if [[ -n "$backup_uuid" && "$backup_uuid" != "null" ]]; then
      continue
    fi

    ptero_client_api_ex POST "/api/client/servers/${uuid}/backups" '{"name":"catalyst-bulk-fixture","ignored_files":""}'
    [[ "$LAST_STATUS" == "200" || "$LAST_STATUS" == "201" || "$LAST_STATUS" == "202" ]] || fail "backup create failed for server ${id}: HTTP ${LAST_STATUS} ${LAST_BODY:0:200}"
    backup_uuid="$(printf '%s' "$LAST_BODY" | jq -r '.attributes.uuid // .data.attributes.uuid // empty')"
    [[ -n "$backup_uuid" && "$backup_uuid" != "null" ]] || fail "backup create returned no UUID for server ${id}: ${LAST_BODY:0:200}"

    for attempt in $(seq 1 60); do
      ptero_client_api_ex GET "/api/client/servers/${uuid}/backups"
      status="$(printf '%s' "$LAST_BODY" | jq -r --arg uuid "$backup_uuid" '.data[]? | select(.attributes.uuid==$uuid) | if .attributes.is_successful==true or .attributes.completed_at!=null then "completed" elif .attributes.failed==true then "failed" else "pending" end' | head -1)"
      case "$status" in
        completed) break ;;
        failed) fail "backup failed for server ${id} (${uuid})" ;;
      esac
      sleep 2
    done
    [[ "$status" == "completed" ]] || fail "backup timed out for server ${id} (${uuid})"
  done < <(printf '%s' "$servers" | jq -r '.data[] | [.attributes.id,.attributes.uuid,.attributes.node] | @tsv')
}

ptero_bulk_seed() {
  ptero_prepare_extra_wings
  wait_ptero_panel; load_state; require_ptero_keys
  ptero_ensure_location; ptero_ensure_egg; ptero_ensure_users
  local -a nodes eggs bulk_ips bulk_lxcs
  local n node port alloc egg name servers id docker startup env body bulk_ip lxc
  ptero_bulk_wings_topology
  bulk_ips=("$PTERO_WINGS_IP" "${PTERO_EXTRA_WINGS_IPS[@]}")
  bulk_lxcs=("$PTERO_WINGS_LXC" "${PTERO_EXTRA_WINGS_LXCS[@]}")
  for n in $(seq 1 "$PTERO_BULK_NODE_COUNT"); do
    name="$PTERO_NODE_NAME"; (( n > 1 )) && name="${PTERO_NODE_NAME}-$(printf '%02d' "$n")"
    bulk_ip="${bulk_ips[$((n-1))]}"
    lxc="${bulk_lxcs[$((n-1))]}"
    body="$(jq -n --arg name "$name" --argjson location_id "$PTERO_LOCATION_ID" --arg fqdn "$bulk_ip" '{name:$name,location_id:$location_id,fqdn:$fqdn,scheme:"http",behind_proxy:false,maintenance_mode:false,memory:8192,memory_overallocate:0,disk:20480,disk_overallocate:0,upload_size:100,daemon_listen:8080,daemon_sftp:2022,daemon_base:"/var/lib/pterodactyl/volumes"}')"
    servers="$(ptero_api GET '/api/application/nodes?per_page=100')"
    node="$(printf '%s' "$servers" | jq -r --arg name "$name" '.data[]?|select(.attributes.name==$name)|.attributes.id'|head -1)"
    if [[ -z "$node" || "$node" == null ]]; then
      node="$(ptero_json_id "$(ptero_api POST /api/application/nodes "$body")")"
    else
      ptero_api PATCH "/api/application/nodes/${node}" "$body" >/dev/null
    fi
    [[ -n "$node" && "$node" != null ]] || fail "could not create or update Ptero node ${name}"
    nodes[$n]="$node"
    ptero_update_node_allocation_ip "$node" "$bulk_ip"
    ptero_write_wings_config "$node" "$lxc"
    ptero_start_wings "$lxc" "$bulk_ip"
  done
  mapfile -t eggs < <(ptero_api GET "/api/application/nests/${PTERO_NEST_ID}/eggs?per_page=100" | jq -r '.data[]?|select(.attributes.name=="Paper" or .attributes.name=="Bungeecord" or .attributes.name=="Forge Minecraft" or .attributes.name=="Sponge (SpongeVanilla)" or .attributes.name=="Vanilla Minecraft")|.attributes.id')
  [[ "${#eggs[@]}" -eq 5 ]] || fail "bulk fixture requires all five Minecraft eggs"
  for n in $(seq 2 "$PTERO_BULK_SERVER_COUNT"); do
    local ni=$(( ((n-1)%PTERO_BULK_NODE_COUNT)+1 )); node="${nodes[$ni]}"; port=$((PTERO_BULK_PORT_START+n))
    bulk_ip="${bulk_ips[$((ni-1))]}"
    servers="$(ptero_api GET "/api/application/nodes/${node}/allocations?per_page=100")"
    alloc="$(printf '%s' "$servers" | jq -r --arg ip "$bulk_ip" --argjson p "$port" '.data[]?|select(.attributes.ip==$ip and .attributes.port==$p)|.attributes.id' | head -1)"
    if [[ -z "$alloc" || "$alloc" == null ]]; then
      ptero_api POST "/api/application/nodes/${node}/allocations" "$(jq -n --arg ip "$bulk_ip" --arg p "$port" '{ip:$ip,ports:[$p]}')" >/dev/null
      servers="$(ptero_api GET "/api/application/nodes/${node}/allocations?per_page=100")"
      alloc="$(printf '%s' "$servers" | jq -r --arg ip "$bulk_ip" --argjson p "$port" '.data[]?|select(.attributes.ip==$ip and .attributes.port==$p)|.attributes.id' | head -1)"
    fi
    [[ -n "$alloc" && "$alloc" != null ]] || fail "bulk allocation ${bulk_ip}:${port} missing after create"
    name="Ptero Minecraft $(printf '%03d' "$n")"; servers="$(ptero_api GET '/api/application/servers?per_page=100')"; id="$(printf '%s' "$servers"|jq -r --arg name "$name" '.data[]?|select(.attributes.name==$name)|.attributes.id'|head -1)"; [[ -n "$id" && "$id" != null ]] && continue
    egg="${eggs[$(( (n-1)%5 ))]}"; body="$(ptero_api GET "/api/application/nests/${PTERO_NEST_ID}/eggs/${egg}?include=variables")"; docker="$(printf '%s' "$body"|jq -r '.attributes.docker_image // (.attributes.docker_images|to_entries[0].value)')"; startup="$(printf '%s' "$body"|jq -r '.attributes.startup')"; env="$(printf '%s' "$body"|jq 'reduce (.attributes.relationships.variables.data // [])[] as $v ({};.[$v.attributes.env_variable]=$v.attributes.default_value)+{SERVER_JARFILE:"server.jar",MINECRAFT_VERSION:"1.21.1",BUILD_NUMBER:"latest"}')"
    body="$(jq -n --arg name "$name" --argjson user "$PTERO_ADMIN_ID" --argjson egg "$egg" --arg docker_image "$docker" --arg startup "$startup" --argjson environment "$env" --argjson allocation "$alloc" '{name:$name,user:$user,egg:$egg,docker_image:$docker_image,startup:$startup,environment:$environment,skip_scripts:true,start_on_completion:false,limits:{memory:128,swap:0,disk:256,io:500,cpu:0},feature_limits:{databases:0,allocations:0,backups:0},allocation:{default:$allocation}}')"
    servers="$(ptero_api POST /api/application/servers "$body")"
    id="$(printf '%s' "$servers" | jq -r '.attributes.id // .data.attributes.id // empty' 2>/dev/null || true)"
    if [[ -z "$id" || "$id" == null ]]; then
      body="$servers"
      servers="$(ptero_api GET '/api/application/servers?per_page=100')"
      id="$(printf '%s' "$servers" | jq -r --arg name "$name" '.data[]?|select(.attributes.name==$name)|.attributes.id' | head -1)"
      [[ -n "$id" && "$id" != null ]] || fail "could not create bulk server ${name}: ${body}"
    fi
  done
  ptero_seed_bulk_files_backups
  ptero_bulk_verify
}

ptero_bulk_verify() {
  local s n egg_names
  s="$(ptero_api GET '/api/application/servers?per_page=100')"
  n="$(ptero_api GET '/api/application/nodes?per_page=100')"
  printf '%s\n' "$s" | jq '{servers:(.data|length),duplicates:(.data|group_by(.attributes.name)|map(select(length>1)|.[0].attributes.name)),eggs:(.data|group_by(.attributes.egg)|map({egg:.[0].attributes.egg,count:length}))}'
  printf '%s\n' "$n" | jq '{nodes:(.data|length),names:(.data|map(.attributes.name))}'
  printf '%s' "$s" | jq -e --argjson count "$PTERO_BULK_SERVER_COUNT" --argjson nodes "$PTERO_BULK_NODE_COUNT" '(.data|length)==$count and ([.data[].attributes.name]|unique|length)==$count and ([.data[].attributes.node]|unique|length)==$nodes' >/dev/null || fail "bulk fixture verification failed"
}

stage_ptero_status() {
  load_state
  local -a wings_lxcs wings_ips
  local i lxc ip wings_status
  ptero_all_wings_lxcs wings_lxcs
  ptero_parse_csv PTERO_EXTRA_WINGS_IPS "${PTERO_BULK_WINGS_IPS:-}"
  wings_ips=("$PTERO_WINGS_IP" "${PTERO_EXTRA_WINGS_IPS[@]}")
  echo "=== Ptero LXCs ==="
  lxc-ls -f | awk -v names="${PTERO_PANEL_LXC},$(IFS=,; echo "${wings_lxcs[*]}")" 'NR==1 {print; next} index("," names ",", "," $1 ",")' || true
  echo
  echo "=== Ptero panel ==="
  curl -fsS -o /dev/null -w "ptero_lxc %{http_code}\n" "${PTERO_URL}/" || echo "ptero_lxc down"
  curl -fsS -o /dev/null -w "ptero_pub %{http_code}\n" "${PTERO_PUBLIC_URL}/" || echo "ptero_pub down"
  echo "=== Wings ==="
  for i in "${!wings_lxcs[@]}"; do
    lxc="${wings_lxcs[$i]}"
    ip="${wings_ips[$i]:-unset}"
    wings_status="$(curl -sS -o /dev/null -w '%{http_code}' "http://${ip}:8080/api/system" || true)"
    if [[ "$wings_status" == "200" || "$wings_status" == "401" ]]; then
      echo "${lxc} ${ip} ${wings_status} (reachable)"
    else
      echo "${lxc} ${ip} ${wings_status:-000} (down)"
    fi
  done
  if [[ -n "${PTERO_APP_KEY:-}" ]]; then
    echo "=== Application API ==="
    ptero_api GET /api/application/nodes | jq '{nodes:(.data|map({id:.attributes.id,name:.attributes.name,fqdn:.attributes.fqdn}))}' || true
    ptero_api GET /api/application/servers | jq '{servers:(.data|map({id:.attributes.id,name:.attributes.name,node:.attributes.node,allocation:.attributes.allocation}))}' || true
  fi
  echo "=== URLs / keys ==="
  echo "Panel:   ${PTERO_URL}  (also ${PTERO_PUBLIC_URL})"
  echo "Wings:   $(IFS=' '; echo "${wings_ips[*]}") (port 8080)"
  echo "Login:   ${PTERO_ADMIN_EMAIL} / ${PTERO_ADMIN_PASSWORD}"
  echo "App key: $([[ -n "${PTERO_APP_KEY:-}" ]] && echo configured || echo unset)"
  echo "Client:  $([[ -n "${PTERO_CLIENT_KEY:-}" ]] && echo configured || echo unset)"
  echo "Node:    ${PTERO_NODE_ID:-unset}  Server: ${PTERO_SERVER_ID:-unset} (${PTERO_SERVER_UUID:-})"
  echo "Alloc:   ${PTERO_ALLOC_IP:-unset}:${PTERO_ALLOC_PORT:-unset} + ${PTERO_ALLOC_EXTRA_PORT}"
}

stage_ptero_destroy() {
  local -a wings_lxcs
  ptero_all_wings_lxcs wings_lxcs
  warn "Destroying Ptero LXCs $PTERO_PANEL_LXC ${wings_lxcs[*]} and their host forwards"
  for port in "$PTERO_PANEL_HOST_PORT" "$PTERO_WINGS_HOST_PORT" "$PTERO_SFTP_HOST_PORT"; do
    local pidfile="$STATE_DIR/run/fwd-${port}.pid"
    if [[ -f "$pidfile" ]]; then
      kill "$(cat "$pidfile")" 2>/dev/null || true
      rm -f "$pidfile"
    fi
  done
  for name in "$PTERO_PANEL_LXC" "${wings_lxcs[@]}"; do
    if have_lxc "$name"; then
      lxc-stop -n "$name" -k || true
      lxc-destroy -n "$name" -f || true
    fi
  done
}

ptero_assert_preview() {
  local body="$1"
  printf '%s' "$body" | jq -e '.success == true' >/dev/null \
    || fail "migration test did not succeed: $body"
  printf '%s' "$body" | jq -e '.stats.nodes >= 1 and .stats.servers >= 1 and .stats.locations >= 1' >/dev/null \
    || fail "preview stats missing entities: $body"
  printf '%s' "$body" | jq -e \
    --arg fqdn "$PTERO_WINGS_IP" \
    --argjson listen 8080 \
    --argjson sftp 2022 \
    --argjson primary "$PTERO_ALLOC_PORT" \
    --argjson extra "$PTERO_ALLOC_EXTRA_PORT" \
    '.nodesList[] | select(
      .fqdn == $fqdn and
      .scheme == "http" and
      .daemonListen == $listen and
      .daemonSftp == $sftp and
      ([.allocations[].port] | contains([$primary, $extra]))
    )' >/dev/null \
    || fail "preview node configuration or allocations are incomplete: $body"
  printf '%s' "$body" | jq -e \
    --arg name "$PTERO_SERVER_NAME" \
    --argjson primary "$PTERO_ALLOC_PORT" \
    --argjson extra "$PTERO_ALLOC_EXTRA_PORT" \
    '.serversList[] | select(
      .name == $name and
      .hasAllocation == true and
      ([.allocations[].port] | contains([$primary, $extra])) and
      ([.allocations[] | select(.primary == true) | .port] | contains([$primary]))
    )' >/dev/null \
    || fail "preview server is missing primary/additional allocations: $body"
}

stage_ptero_migrate() {
  require_ptero_keys
  [[ -n "${AUTH_TOKEN:-}" ]] || login_or_setup
  [[ -n "${NODE_ID:-}" ]] || fail "NODE_ID missing — run Catalyst bootstrap/agent first"

  # Target Catalyst node must already expose the same ports the importer will map.
  api POST "/api/nodes/${NODE_ID}/allocations" "$(jq -n \
    --arg ip "${NODE_PUBLIC_ADDRESS}" \
    --arg ports "${PTERO_ALLOC_PORT},${PTERO_ALLOC_EXTRA_PORT}" \
    '{ip:$ip,ports:$ports}')" >/dev/null || true

  local payload preview
  payload="$(jq -n \
    --arg url "$PTERO_URL" \
    --arg key "$PTERO_APP_KEY" \
    --arg clientApiKey "$PTERO_CLIENT_KEY" \
    '{url:$url,key:$key,clientApiKey:$clientApiKey}')"
  api_ex POST /api/admin/migration/test "$payload"
  accept_http "ptero migration test" "$LAST_STATUS" 200
  preview="$LAST_BODY"
  printf '%s\n' "$preview" > "$LOG_DIR/ptero-migration-test.json"
  ptero_assert_preview "$preview"

  local catalyst_node node_mappings
  catalyst_node="$NODE_ID"
  node_mappings="$(printf '%s' "$preview" | jq -c --arg catalystNode "$catalyst_node" '
    reduce .nodesList[] as $node ({}; .[($node.id|tostring)] = $catalystNode)
  ')"
  [[ "$(printf '%s' "$node_mappings" | jq 'length')" -ge 3 ]] || fail "preview did not include all Ptero node mappings: $node_mappings"

  payload="$(jq -n \
    --arg url "$PTERO_URL" \
    --arg key "$PTERO_APP_KEY" \
    --arg clientApiKey "$PTERO_CLIENT_KEY" \
    --argjson nodeMappings "$node_mappings" \
    '{
      url:$url,
      key:$key,
      clientApiKey:$clientApiKey,
      scope:"full",
      nodeMappings:$nodeMappings,
      serverMappings:{}
    }')"
  api_ex POST /api/admin/migration/start "$payload"
  if [[ "$LAST_STATUS" == "409" ]]; then
    local existing
    existing="$(api GET /api/admin/migration | jq -r '[.[]? | select(.status=="pending" or .status=="running" or .status=="validating")][0].id // empty')"
    [[ -n "$existing" ]] || fail "migration already running but no active job id found: $LAST_BODY"
    PTERO_MIGRATION_JOB_ID="$existing"
    warn "A migration is already in progress ($PTERO_MIGRATION_JOB_ID); polling it"
  else
    accept_http "ptero migration start" "$LAST_STATUS" 200
    PTERO_MIGRATION_JOB_ID="$(printf '%s' "$LAST_BODY" | jq -r '.jobId // .data.jobId // empty')"
  fi
  [[ -n "${PTERO_MIGRATION_JOB_ID:-}" && "$PTERO_MIGRATION_JOB_ID" != "null" ]] \
    || fail "no migration job id: $LAST_BODY"
  save_state PTERO_MIGRATION_JOB_ID "$PTERO_MIGRATION_JOB_ID"

  local i status phase error
  status=""
  for i in $(seq 1 90); do
    api_ex GET "/api/admin/migration/${PTERO_MIGRATION_JOB_ID}"
    status="$(printf '%s' "$LAST_BODY" | jq -r '.status // .data.status // empty')"
    phase="$(printf '%s' "$LAST_BODY" | jq -r '.currentPhase // .data.currentPhase // empty')"
    error="$(printf '%s' "$LAST_BODY" | jq -r '.error // .data.error // empty')"
    log "migration job=${PTERO_MIGRATION_JOB_ID} attempt=${i}/90 status=${status} phase=${phase}"
    case "$status" in
      completed) break ;;
      failed|cancelled)
        fail "migration ${status}: ${error:-$LAST_BODY}"
        ;;
    esac
    sleep 5
  done
  [[ "$status" == "completed" ]] || fail "migration did not complete (status=${status:-unknown})"

  api_ex GET "/api/admin/migration/${PTERO_MIGRATION_JOB_ID}/steps?limit=200"
  accept_http "migration steps" "$LAST_STATUS" 200
  printf '%s\n' "$LAST_BODY" > "$LOG_DIR/ptero-migration-steps.json"
  printf '%s' "$LAST_BODY" | jq -e '[.steps[]? | select(.status=="failed")] | length == 0' >/dev/null \
    || fail "migration completed with failed steps: $(printf '%s' "$LAST_BODY" | jq '[.steps[]? | select(.status=="failed")]')"

  local cat_id
  cat_id="$(api GET /api/servers | jq -r --arg n "$PTERO_SERVER_NAME" '.data[]? | select(.name==$n) | .id' | head -1)"
  [[ -n "$cat_id" && "$cat_id" != "null" ]] || fail "Catalyst servers list missing ${PTERO_SERVER_NAME}"
  api_ex GET "/api/servers/${cat_id}"
  accept_http "migrated server get" "$LAST_STATUS" 200
  printf '%s' "$LAST_BODY" | jq -e \
    --argjson primary "$PTERO_ALLOC_PORT" \
    --argjson extra "$PTERO_ALLOC_EXTRA_PORT" \
    '((.data.primaryPort // .primaryPort) == $primary) and
     (((.data.portBindings // .portBindings) | to_entries | map(.value | tonumber)) | contains([$primary, $extra]))' >/dev/null \
    || fail "migrated server port configuration is incomplete: $LAST_BODY"

  api_ex GET "/api/nodes/${NODE_ID}/allocations?serverId=${cat_id}"
  accept_http "migrated server allocations" "$LAST_STATUS" 200
  printf '%s' "$LAST_BODY" | jq -e \
    --arg serverId "$cat_id" \
    --argjson primary "$PTERO_ALLOC_PORT" \
    --argjson extra "$PTERO_ALLOC_EXTRA_PORT" \
    '([.data[].port] | contains([$primary, $extra])) and ([.data[].serverId] | all(. == $serverId))' >/dev/null \
    || fail "target allocations are not linked to migrated server ${cat_id}: $LAST_BODY"

  api_ex GET "/api/servers/${cat_id}/files?path=%2F"
  accept_http "migrated server files" "$LAST_STATUS" 200
  printf '%s' "$LAST_BODY" | jq -e '[.data.files[]?.name] | contains(["eula.txt", "server.properties", "server.jar"])' >/dev/null \
    || fail "migrated server files are incomplete: $LAST_BODY"

  log "Ptero migration verified. job=${PTERO_MIGRATION_JOB_ID} catalystServer=${cat_id} ports=${PTERO_ALLOC_PORT},${PTERO_ALLOC_EXTRA_PORT} files=ok"
}

stage_ptero() {
  stage_ptero_create
  stage_ptero_docker
  stage_ptero_deploy
  mapfile -t eggs < <(ptero_api GET "/api/application/nests/${PTERO_NEST_ID}/eggs?per_page=100" | jq -r '.data[]?|select(.attributes.name=="Paper" or .attributes.name=="Bungeecord" or .attributes.name=="Forge Minecraft" or .attributes.name=="Sponge (SpongeVanilla)" or .attributes.name=="Vanilla Minecraft")|.attributes.id')
  stage_ptero_status
}
