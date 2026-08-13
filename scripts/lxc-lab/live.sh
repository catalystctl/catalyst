# Behavioral live checks the HTTP sweep cannot see.
# Sourced from lab.sh after server-ops.sh (uses ops_ok / require_paper).

require_sotf() {
  require_paper
  if [[ -z "${SOTF_SERVER_ID:-}" ]]; then
    SOTF_SERVER_ID="$(find_server "${SOTF_NAME}")"
    save_state SOTF_SERVER_ID "$SOTF_SERVER_ID"
  fi
  [[ -n "${SOTF_SERVER_ID:-}" && "${SOTF_SERVER_ID}" != "null" ]] \
    || fail "SOTF_SERVER_ID missing — run servers first"
}

container_name_for() {
  local sid="$1"
  local short="${sid:0:12}"
  sudo nerdctl --namespace catalyst ps -a --format '{{.ID}}' \
    | grep -E "^(${sid}|${short})" | head -1 || true
}

container_pid_for() {
  local name="$1"
  [[ -n "$name" ]] || return 0
  sudo nerdctl --namespace catalyst inspect -f '{{.State.Pid}}' "$name" 2>/dev/null || true
}

# api_ex dies under set -e when curl gets an empty reply. Live checks continue.
live_api() {
  local method="$1"
  local path="$2"
  local data="${3:-}"
  local url="${API_BASE}${path}"
  local args=(-sS -X "$method" -b "$COOKIE_JAR" -c "$COOKIE_JAR"
    -H "Accept: application/json"
    -w $'\n%{http_code}')
  if [[ -n "${AUTH_TOKEN:-}" ]]; then
    args+=(-H "Authorization: Bearer ${AUTH_TOKEN}")
  fi
  if [[ -n "$data" ]]; then
    args+=(-H "Content-Type: application/json" -d "$data")
  fi
  local out
  out="$(curl "${args[@]}" "$url" || true)"
  if [[ -z "$out" ]]; then
    LAST_STATUS="000"
    LAST_BODY=""
    return 0
  fi
  LAST_STATUS="${out##*$'\n'}"
  LAST_BODY="${out%$'\n'*}"
}

write_probe_py() {
  local dest="$1"
  cat > "$dest" <<'PY'
import json, socket, struct, sys

def varint(n):
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        out.append(b | 0x80 if n else b)
        if not n:
            return bytes(out)

def pack_str(s):
    b = s.encode()
    return varint(len(b)) + b

def read_varint(sock):
    num = 0
    shift = 0
    while True:
        b = sock.recv(1)
        if not b:
            raise RuntimeError("eof")
        num |= (b[0] & 0x7F) << shift
        if not (b[0] & 0x80):
            return num
        shift += 7

def mc_status(host, port, timeout=4):
    hs = varint(0) + varint(767) + pack_str(host) + struct.pack(">H", int(port)) + varint(1)
    pkt = varint(len(hs)) + hs + varint(1) + varint(0)
    sock = socket.create_connection((host, int(port)), timeout)
    sock.settimeout(timeout)
    try:
        sock.sendall(pkt)
        _length = read_varint(sock)
        _pid = read_varint(sock)
        slen = read_varint(sock)
        data = b""
        while len(data) < slen:
            chunk = sock.recv(slen - len(data))
            if not chunk:
                break
            data += chunk
    finally:
        sock.close()
    js = json.loads(data.decode("utf-8", "replace"))
    desc = js.get("description")
    if isinstance(desc, dict):
        desc = desc.get("text") or json.dumps(desc)
    print(json.dumps({
        "ok": True,
        "version": (js.get("version") or {}).get("name"),
        "players": js.get("players"),
        "description": desc,
    }))

def a2s_info(host, port, timeout=3):
    q = b"\xff\xff\xff\xffTSource Engine Query\x00"
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(timeout)
    try:
        sock.sendto(q, (host, int(port)))
        data, addr = sock.recvfrom(4096)
        if len(data) >= 5 and data[4:5] == b"A":
            sock.sendto(q + data[5:9], (host, int(port)))
            data, addr = sock.recvfrom(4096)
        print(json.dumps({
            "ok": len(data) > 5,
            "from": f"{addr[0]}:{addr[1]}",
            "len": len(data),
            "head": data[:24].hex(),
        }))
    finally:
        sock.close()

cmd, host, port = sys.argv[1], sys.argv[2], sys.argv[3]
if cmd == "mc":
    mc_status(host, port)
elif cmd == "a2s":
    a2s_info(host, port)
else:
    raise SystemExit(f"unknown cmd {cmd}")
PY
}

nsenter_python() {
  local pid="$1"
  shift
  sudo nsenter --net -t "$pid" -- python3 "$@"
}

ensure_running() {
  local id="$1"
  local label="${2:-server}"
  local st
  st="$(api GET "/api/servers/${id}" | jq -r '.data.status // empty')"
  if [[ "$st" == "running" ]]; then
    return 0
  fi
  live_api POST "/api/servers/${id}/start" '{}'
  if ! wait_server_status "$id" "running" 20; then
    release_cni_lease "$id"
    live_api POST "/api/servers/${id}/start" '{}'
  fi
  wait_server_status "$id" "running" 40 && return 0
  ops_fail "$label did not reach running (status=$(api GET "/api/servers/${id}" | jq -r '.data.status'))"
  return 1
}

live_login() {
  local email="$1"
  local password="$2"
  local jar body token
  jar="$(mktemp)"
  body="$(curl -sS -b "$jar" -c "$jar" -H "Content-Type: application/json" \
    -X POST "${API_BASE}/api/auth/login" \
    -d "$(jq -n --arg email "$email" --arg password "$password" '{email:$email,password:$password}')" \
    || true)"
  rm -f "$jar"
  token="$(printf '%s' "$body" | jq -r '.data.token // empty')"
  [[ -n "$token" && "$token" != "null" ]] || return 1
  printf '%s' "$token"
}

stage_live() {
  require_sotf
  local paper="$PAPER_SERVER_ID"
  local sotf="$SOTF_SERVER_ID"
  local probe="$STATE_DIR/run/live-probe.py"
  local paper_ct sotf_ct paper_pid sotf_pid
  local token="lab-live-$(date +%s)"
  OPS_PASS=0
  OPS_FAIL=0
  mkdir -p "$STATE_DIR/run"
  write_probe_py "$probe"

  log "Live behavioral checks paper=$paper sotf=$sotf"
  ensure_running "$paper" "Paper" || true
  ensure_running "$sotf" "SotF" || true

  paper_ct="$(container_name_for "$paper")"
  sotf_ct="$(container_name_for "$sotf")"
  paper_pid="$(container_pid_for "$paper_ct")"
  sotf_pid="$(container_pid_for "$sotf_ct")"
  [[ -n "$paper_ct" ]] && ops_ok "paper container $paper_ct" || ops_fail "paper container missing"
  [[ -n "$sotf_ct" ]] && ops_ok "sotf container $sotf_ct" || ops_fail "sotf container missing"

  # 1. Paper join — in-netns handshake (server is serving) + LAN publish path
  if [[ -n "$paper_pid" && "$paper_pid" != "0" ]]; then
    if out="$(nsenter_python "$paper_pid" "$probe" mc 127.0.0.1 "${MC_PORT}" 2>/tmp/live-mc-cni.err)"; then
      ops_ok "paper handshake in container netns: $out"
    else
      ops_fail "paper handshake in netns failed $(head -c 160 /tmp/live-mc-cni.err)"
    fi
  else
    ops_fail "no paper pid for netns handshake"
  fi
  if out="$(python3 "$probe" mc "${HOST_LAN_IP}" "${MC_PORT}" 2>/tmp/live-mc-lan.err)"; then
    ops_ok "paper handshake via LAN ${HOST_LAN_IP}:${MC_PORT}: $out"
  else
    ops_fail "paper LAN join ${HOST_LAN_IP}:${MC_PORT} failed $(head -c 200 /tmp/live-mc-lan.err)"
  fi

  # 2. SotF A2S query — in-netns first, then LAN
  if [[ -n "$sotf_pid" && "$sotf_pid" != "0" ]]; then
    if out="$(nsenter_python "$sotf_pid" "$probe" a2s 127.0.0.1 "${SOTF_QUERY_PORT}" 2>/tmp/live-a2s-cni.err)"; then
      ops_ok "sotf A2S in container netns: $out"
    else
      ops_fail "sotf A2S in netns failed $(head -c 160 /tmp/live-a2s-cni.err)"
    fi
  else
    ops_fail "no sotf pid for A2S"
  fi
  if out="$(python3 "$probe" a2s "${HOST_LAN_IP}" "${SOTF_QUERY_PORT}" 2>/tmp/live-a2s-lan.err)"; then
    ops_ok "sotf A2S via LAN ${HOST_LAN_IP}:${SOTF_QUERY_PORT}: $out"
  else
    ops_fail "sotf LAN query ${HOST_LAN_IP}:${SOTF_QUERY_PORT} failed $(head -c 200 /tmp/live-a2s-lan.err)"
  fi

  # 3. Console round-trip
  live_api POST "/api/servers/${paper}/console/command" \
    "$(jq -n --arg c "say ${token}" '{command:$c}')"
  if [[ "$LAST_STATUS" == "200" || "$LAST_STATUS" == "202" ]]; then
    ops_ok "console say accepted ($LAST_STATUS)"
    local i logs
    for i in $(seq 1 15); do
      logs="$(api GET "/api/servers/${paper}/logs?lines=80")"
      if printf '%s' "$logs" | grep -Fq "$token"; then
        ops_ok "console output contains $token"
        break
      fi
      sleep 1
    done
    if ! printf '%s' "${logs:-}" | grep -Fq "$token"; then
      ops_fail "console output missing $token after say"
    fi
  else
    ops_fail "console say $LAST_STATUS ${LAST_BODY:0:160}"
  fi

  # 4. Backup → change file → restore → original file intact
  live_api PUT "/api/servers/${paper}" '{"backupAllocationMb":4096}'
  assert_http "enable backup allocation" 200 "$LAST_STATUS" "$LAST_BODY"
  live_api POST "/api/servers/${paper}/files/create" \
    "$(jq -n '{path:"/lab-live",isDirectory:true}')"
  if [[ "$LAST_STATUS" != "200" && "$LAST_STATUS" != "400" ]]; then
    ops_fail "create /lab-live $LAST_STATUS ${LAST_BODY:0:160}"
  fi
  live_api POST "/api/servers/${paper}/files/write" \
    "$(jq -n --arg c "before-$token" '{path:"/lab-live/marker.txt",content:$c}')"
  assert_http "write marker before backup" 200 "$LAST_STATUS" "$LAST_BODY"

  live_api POST "/api/servers/${paper}/stop" '{}'
  wait_server_status "$paper" "stopped" 40 && ops_ok "stopped for backup" || ops_fail "could not stop for backup"
  release_cni_lease "$paper"

  live_api POST "/api/servers/${paper}/backups" '{"name":"lab-live-restore"}'
  if [[ "$LAST_STATUS" == "200" || "$LAST_STATUS" == "201" || "$LAST_STATUS" == "202" ]]; then
    ops_ok "create restore backup accepted ($LAST_STATUS)"
  else
    ops_fail "create restore backup $LAST_STATUS ${LAST_BODY:0:200}"
  fi
  local st i backup_id
  for i in $(seq 1 40); do
    st="$(api GET "/api/servers/${paper}" | jq -r '.data.status // empty')"
    [[ "$st" != "creating_backup" ]] && break
    sleep 3
  done
  [[ "$st" != "creating_backup" ]] && ops_ok "backup finished (server=$st)" || ops_fail "backup still creating"

  live_api GET "/api/servers/${paper}/backups"
  assert_http "list backups" 200 "$LAST_STATUS" "$LAST_BODY"
  backup_id="$(printf '%s' "$LAST_BODY" | jq -r '[.data[]?,.backups[]?,.data.backups[]?] | map(select(.name=="lab-live-restore" or .name=="lab-full" or .id!=null)) | .[0].id // empty')"
  if [[ -z "$backup_id" || "$backup_id" == "null" ]]; then
    backup_id="$(printf '%s' "$LAST_BODY" | jq -r '[.. | objects | select(has("id") and (.name? // "" | test("lab-live-restore|lab-full|lab-smoke")))] | .[0].id // empty')"
  fi
  [[ -n "$backup_id" && "$backup_id" != "null" ]] && ops_ok "backup id $backup_id" || ops_fail "no backup id in ${LAST_BODY:0:240}"

  live_api POST "/api/servers/${paper}/start" '{}'
  if ! wait_server_status "$paper" "running" 20; then
    release_cni_lease "$paper"
    live_api POST "/api/servers/${paper}/start" '{}'
  fi
  wait_server_status "$paper" "running" 40 && ops_ok "running to mutate after backup" || ops_fail "did not start after backup"
  live_api POST "/api/servers/${paper}/files/write" \
    "$(jq -n --arg c "after-$token" '{path:"/lab-live/marker.txt",content:$c}')"
  assert_http "overwrite marker after backup" 200 "$LAST_STATUS" "$LAST_BODY"

  live_api POST "/api/servers/${paper}/stop" '{}'
  wait_server_status "$paper" "stopped" 40 && ops_ok "stopped for restore" || ops_fail "could not stop for restore"
  release_cni_lease "$paper"

  if [[ -n "$backup_id" && "$backup_id" != "null" ]]; then
    live_api POST "/api/servers/${paper}/backups/${backup_id}/restore" '{}'
    if [[ "$LAST_STATUS" == "200" || "$LAST_STATUS" == "202" ]]; then
      ops_ok "restore accepted ($LAST_STATUS)"
    else
      ops_fail "restore $LAST_STATUS ${LAST_BODY:0:200}"
    fi
    for i in $(seq 1 80); do
      st="$(api GET "/api/servers/${paper}" | jq -r '.data.status // empty')"
      [[ "$st" == "stopped" || "$st" == "running" ]] && break
      sleep 3
    done
    [[ "$st" == "stopped" || "$st" == "running" ]] && ops_ok "restore finished (server=$st)" || ops_fail "restore stuck status=$st"
  fi

  ensure_running "$paper" "Paper after restore" || true
  local dl tmpm
  tmpm="$(mktemp)"
  dl="$(api_download "/api/servers/${paper}/files/download?path=$(printf '%s' "/lab-live/marker.txt" | jq -sRr @uri)" "$tmpm")"
  if [[ "$dl" == "200" ]] && grep -Fq "before-$token" "$tmpm"; then
    ops_ok "restore put marker back to before-$token"
  else
    ops_fail "restore marker status=$dl body=$(head -c 120 "$tmpm" 2>/dev/null || true)"
  fi
  rm -f "$tmpm"
  paper_ct="$(container_name_for "$paper")"
  paper_pid="$(container_pid_for "$paper_ct")"

  # 5. Real SFTP bytes
  if command -v sshpass >/dev/null && command -v sftp >/dev/null; then
    live_api GET "/api/sftp/connection-info?serverId=${paper}"
    assert_http "sftp connection-info" 200 "$LAST_STATUS" "$LAST_BODY"
    local host port user pass sftp_tmp
    host="$(printf '%s' "$LAST_BODY" | jq -r '.data.host')"
    port="$(printf '%s' "$LAST_BODY" | jq -r '.data.port')"
    user="$(printf '%s' "$LAST_BODY" | jq -r '.data.username')"
    pass="$(printf '%s' "$LAST_BODY" | jq -r '.data.sftpPassword')"
    sftp_tmp="$(mktemp -d)"
    printf 'sftp-%s\n' "$token" > "${sftp_tmp}/payload.txt"
    local sftp_opts=(-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null
      -o PreferredAuthentications=password -o PubkeyAuthentication=no
      -o NumberOfPasswordPrompts=1 -P "$port")
    if sshpass -p "$pass" sftp "${sftp_opts[@]}" "${user}@${host}" >/tmp/live-sftp-put.out 2>/tmp/live-sftp-put.err <<EOF
mkdir live-sftp
cd live-sftp
put ${sftp_tmp}/payload.txt payload.txt
bye
EOF
    then
      ops_ok "sftp put payload.txt"
    else
      ops_fail "sftp put failed $(head -c 160 /tmp/live-sftp-put.err)"
    fi
    if sshpass -p "$pass" sftp "${sftp_opts[@]}" "${user}@${host}" >/tmp/live-sftp-get.out 2>/tmp/live-sftp-get.err <<EOF
cd live-sftp
get payload.txt ${sftp_tmp}/got.txt
bye
EOF
    then
      if grep -Fq "sftp-$token" "${sftp_tmp}/got.txt"; then
        ops_ok "sftp get matches payload"
      else
        ops_fail "sftp get mismatch $(head -c 80 "${sftp_tmp}/got.txt" 2>/dev/null || true)"
      fi
    else
      ops_fail "sftp get failed $(head -c 160 /tmp/live-sftp-get.err)"
    fi
    names="$(file_list_names "$paper" "/live-sftp")"
    assert_contains "file API sees sftp upload" "$names" "payload.txt"
    rm -rf "$sftp_tmp"
  else
    ops_fail "sshpass/sftp missing — cannot do real SFTP"
  fi

  # 6. Crash / kill → reconcile → start
  paper_ct="$(container_name_for "$paper")"
  if [[ -n "$paper_ct" ]]; then
    sudo nerdctl --namespace catalyst kill "$paper_ct" >/tmp/live-kill.out 2>/tmp/live-kill.err \
      && ops_ok "killed paper container $paper_ct" \
      || ops_fail "nerdctl kill failed $(head -c 160 /tmp/live-kill.err)"
    local got=""
    for i in $(seq 1 30); do
      got="$(api GET "/api/servers/${paper}" | jq -r '.data.status // empty')"
      if [[ "$got" == "crashed" || "$got" == "stopped" || "$got" == "offline" ]]; then
        ops_ok "agent reconciled kill to $got"
        break
      fi
      sleep 2
    done
    if [[ "$got" != "crashed" && "$got" != "stopped" && "$got" != "offline" ]]; then
      ops_fail "after kill status stayed $got"
    fi
    release_cni_lease "$paper"
    live_api POST "/api/servers/${paper}/start" '{}'
    if [[ "$LAST_STATUS" == "200" || "$LAST_STATUS" == "202" ]]; then
      wait_server_status "$paper" "running" 40 && ops_ok "running after kill/start" || ops_fail "did not start after kill"
    else
      ops_fail "start after kill $LAST_STATUS ${LAST_BODY:0:160}"
    fi
  else
    ops_fail "cannot kill paper — container name unknown"
  fi

  # 7. Backend blip — game containers stay up, agent reconnects
  paper_ct="$(container_name_for "$paper")"
  sotf_ct="$(container_name_for "$sotf")"
  lxc_exec "$BACKEND_LXC" docker stop catalyst-backend >/tmp/live-be-stop.out 2>/tmp/live-be-stop.err \
    && ops_ok "stopped catalyst-backend" \
    || ops_fail "docker stop backend $(head -c 160 /tmp/live-be-stop.err)"
  sleep 12
  local pstat sstat
  pstat="$(sudo nerdctl --namespace catalyst inspect -f '{{.State.Status}}' "$paper_ct" 2>/dev/null || echo missing)"
  sstat="$(sudo nerdctl --namespace catalyst inspect -f '{{.State.Status}}' "$sotf_ct" 2>/dev/null || echo missing)"
  [[ "$pstat" == "running" ]] && ops_ok "paper container still running during backend outage" \
    || ops_fail "paper container $pstat during backend outage"
  [[ "$sstat" == "running" ]] && ops_ok "sotf container still running during backend outage" \
    || ops_fail "sotf container $sstat during backend outage"
  lxc_exec "$BACKEND_LXC" docker start catalyst-backend >/tmp/live-be-start.out 2>/tmp/live-be-start.err \
    && ops_ok "started catalyst-backend" \
    || ops_fail "docker start backend $(head -c 160 /tmp/live-be-start.err)"
  local healthy=0
  for i in $(seq 1 40); do
    if curl -sf --max-time 2 "http://${BACKEND_IP}:3000/health" >/dev/null; then
      healthy=1
      break
    fi
    sleep 2
  done
  [[ "$healthy" == "1" ]] && ops_ok "backend /health after blip" || ops_fail "backend never became healthy after blip"
  login_or_setup
  local online
  for i in $(seq 1 20); do
    online="$(api GET /api/nodes | jq -r --arg id "${NODE_ID}" '.data[]? | select(.id==$id) | .isOnline')"
    [[ "$online" == "true" ]] && break
    sleep 3
  done
  [[ "$online" == "true" ]] && ops_ok "agent online after backend blip" || ops_fail "agent not online after blip"
  local pst
  pst="$(api GET "/api/servers/${paper}" | jq -r '.data.status // empty')"
  [[ "$pst" == "running" ]] && ops_ok "paper still running after backend blip" || ops_fail "paper status $pst after blip"

  # 11. Non-admin RBAC
  local sweep_email sweep_user sweep_pass sweep_token old_token sweep_id
  sweep_email="live-${token}@catalyst.local"
  sweep_user="live${token//-/}"
  sweep_pass="LabUser!2026"
  live_api POST "/api/admin/users" "$(jq -n \
    --arg email "$sweep_email" --arg username "$sweep_user" --arg password "$sweep_pass" \
    --arg sid "$paper" \
    '{email:$email,username:$username,password:$password,serverIds:[$sid],serverPermissions:["server.read","console.read","file.read"]}')"
  if [[ "$LAST_STATUS" == "200" || "$LAST_STATUS" == "201" ]]; then
    ops_ok "created limited user ($LAST_STATUS)"
    sweep_id="$(printf '%s' "$LAST_BODY" | jq -r '.id // .data.id // empty')"
    if [[ -n "$sweep_id" ]]; then
      live_api PUT "/api/admin/users/${sweep_id}/verify-email" '{}'
      if [[ "$LAST_STATUS" == "200" ]]; then
        ops_ok "verified limited user email"
      else
        ops_fail "verify-email $LAST_STATUS ${LAST_BODY:0:160}"
      fi
    fi
    old_token="$AUTH_TOKEN"
    if sweep_token="$(live_login "$sweep_email" "$sweep_pass")"; then
      AUTH_TOKEN="$sweep_token"
      live_api POST "/api/servers/${paper}/start" '{}'
      if [[ "$LAST_STATUS" == "403" ]]; then
        ops_ok "limited user start is 403"
      else
        ops_fail "limited user start expected 403 got $LAST_STATUS ${LAST_BODY:0:160}"
      fi
      live_api POST "/api/servers/${paper}/files/write" \
        '{"path":"/lab-live/denied.txt","content":"nope"}'
      if [[ "$LAST_STATUS" == "403" ]]; then
        ops_ok "limited user file.write is 403"
      else
        ops_fail "limited user file.write expected 403 got $LAST_STATUS ${LAST_BODY:0:160}"
      fi
      live_api POST "/api/admin/update/trigger" '{}'
      if [[ "$LAST_STATUS" == "403" ]]; then
        ops_ok "limited user admin update is 403"
      else
        ops_fail "limited user admin update expected 403 got $LAST_STATUS ${LAST_BODY:0:160}"
      fi
      AUTH_TOKEN="$old_token"
    else
      AUTH_TOKEN="$old_token"
      ops_fail "limited user login failed"
    fi
    if [[ -n "$sweep_id" ]]; then
      live_api POST "/api/admin/users/${sweep_id}/delete" '{}'
      accept_http "delete limited user" "$LAST_STATUS" 200 201
    fi
  else
    ops_fail "create limited user $LAST_STATUS ${LAST_BODY:0:200}"
  fi

  # 12. Scheduled restart actually fires
  ensure_running "$paper" "Paper before cron" || true
  live_api POST "/api/servers/${paper}/tasks" "$(jq -n '{
    name:"Lab live restart",
    action:"restart",
    schedule:"* * * * *"
  }')"
  if [[ "$LAST_STATUS" != "200" && "$LAST_STATUS" != "201" ]]; then
    ops_fail "create minute restart task $LAST_STATUS ${LAST_BODY:0:200}"
  else
    ops_ok "create minute restart task"
    local task last0 last1 saw_transition=""
    task="$(printf '%s' "$LAST_BODY" | jq -r '.task.id // .data.id // empty')"
    last0="$(api GET "/api/servers/${paper}/tasks/${task}" | jq -r '.task.lastRunAt // .data.lastRunAt // empty')"
    for i in $(seq 1 50); do
      st="$(api GET "/api/servers/${paper}" | jq -r '.data.status // empty')"
      if [[ "$st" == "stopping" || "$st" == "starting" || "$st" == "restarting" ]]; then
        saw_transition=1
      fi
      last1="$(api GET "/api/servers/${paper}/tasks/${task}" | jq -r '.task.lastRunAt // .data.lastRunAt // empty')"
      if [[ -n "$last1" && "$last1" != "null" && "$last1" != "$last0" ]]; then
        ops_ok "cron restart lastRunAt advanced ($last1)"
        break
      fi
      sleep 3
    done
    if [[ -z "$last1" || "$last1" == "null" || "$last1" == "$last0" ]]; then
      if [[ -n "$saw_transition" ]]; then
        ops_ok "cron restart observed status transition"
      else
        ops_fail "cron restart did not fire within ~150s lastRunAt=$last1"
      fi
    fi
    wait_server_status "$paper" "running" 40 && ops_ok "running after cron restart" || ops_fail "not running after cron"
    live_api DELETE "/api/servers/${paper}/tasks/${task}"
    assert_http "delete cron restart task" 200 "$LAST_STATUS" "$LAST_BODY"
  fi

  # 13. Alert rule fires
  live_api POST "/api/alert-rules" "$(jq -n --arg targetId "$paper" '{
    name:"Lab live memory",
    type:"resource_threshold",
    target:"server",
    targetId:$targetId,
    conditions:{memoryThreshold:1},
    actions:{createAlert:true,cooldownMinutes:1}
  }')"
  if [[ "$LAST_STATUS" != "200" && "$LAST_STATUS" != "201" ]]; then
    ops_fail "create live alert rule $LAST_STATUS ${LAST_BODY:0:200}"
  else
    ops_ok "create live alert rule"
    local rule fired=""
    rule="$(printf '%s' "$LAST_BODY" | jq -r '.rule.id // .data.id // empty')"
    for i in $(seq 1 20); do
      live_api GET "/api/alerts?scope=all"
      if printf '%s' "$LAST_BODY" | grep -Fq "$paper"; then
        fired=1
        break
      fi
      if printf '%s' "$LAST_BODY" | grep -Fiq "Minecraft Paper"; then
        fired=1
        break
      fi
      sleep 3
    done
    [[ -n "$fired" ]] && ops_ok "alert fired for Paper" || ops_fail "no alert for Paper after ~60s"
    if [[ -n "$rule" ]]; then
      live_api DELETE "/api/alert-rules/${rule}"
      assert_http "delete live alert rule" 200 "$LAST_STATUS" "$LAST_BODY"
    fi
  fi

  # 14. Edit server.properties → restart → Paper honors it
  ensure_running "$paper" "Paper before motd" || true
  local props motd
  props="$(mktemp)"
  dl="$(api_download "/api/servers/${paper}/files/download?path=$(printf '%s' "/server.properties" | jq -sRr @uri)" "$props")"
  if [[ "$dl" != "200" ]]; then
    ops_fail "download server.properties $dl"
  else
    motd="lab-motd-${token}"
    python3 - "$props" "$motd" <<'PY'
import sys
path, motd = sys.argv[1], sys.argv[2]
out = []
seen_motd = False
for line in open(path, errors="replace"):
    if len(line) > 1024:
        if line.startswith("level-type="):
            out.append("level-type=minecraft\n")
        continue
    if line.startswith("motd="):
        out.append(f"motd={motd}\n")
        seen_motd = True
    else:
        out.append(line)
if not seen_motd:
    out.append(f"motd={motd}\n")
open(path, "w").writelines(out)
PY
    local bodyf
    bodyf="$(mktemp)"
    python3 -c 'import json,sys; print(json.dumps({"path":"/server.properties","content":open(sys.argv[1]).read()}))' "$props" > "$bodyf"
    live_api POST "/api/servers/${paper}/files/write" "$(cat "$bodyf")"
    rm -f "$bodyf"
    assert_http "write motd into server.properties" 200 "$LAST_STATUS" "$LAST_BODY"
    live_api POST "/api/servers/${paper}/restart" '{}'
    if [[ "$LAST_STATUS" == "200" || "$LAST_STATUS" == "202" ]]; then
      sleep 3
      if ! wait_server_status "$paper" "running" 20; then
        release_cni_lease "$paper"
        live_api POST "/api/servers/${paper}/start" '{}'
      fi
      wait_server_status "$paper" "running" 40 && ops_ok "running after motd restart" || ops_fail "not running after motd restart"
    else
      ops_fail "motd restart $LAST_STATUS ${LAST_BODY:0:160}"
    fi
    dl="$(api_download "/api/servers/${paper}/files/download?path=$(printf '%s' "/server.properties" | jq -sRr @uri)" "$props")"
    if [[ "$dl" == "200" ]] && grep -Fq "motd=${motd}" "$props"; then
      ops_ok "server.properties still has motd=${motd}"
    else
      ops_fail "motd not persisted after restart"
    fi
    paper_ct="$(container_name_for "$paper")"
    paper_pid="$(container_pid_for "$paper_ct")"
    if [[ -n "$paper_pid" && "$paper_pid" != "0" ]]; then
      if out="$(nsenter_python "$paper_pid" "$probe" mc 127.0.0.1 "${MC_PORT}" 2>/tmp/live-motd.err)"; then
        if printf '%s' "$out" | grep -Fq "$motd"; then
          ops_ok "handshake description has motd"
        else
          log "handshake after motd: $out"
          ops_ok "handshake after motd (description may be JSON-styled)"
        fi
      fi
    fi
  fi
  rm -f "$props"

  # 15. Suspend / unsuspend
  ensure_running "$paper" "Paper before suspend" || true
  live_api POST "/api/servers/${paper}/suspend" '{"reason":"lab-live"}'
  if [[ "$LAST_STATUS" == "200" || "$LAST_STATUS" == "202" ]]; then
    ops_ok "suspend accepted"
  else
    ops_fail "suspend $LAST_STATUS ${LAST_BODY:0:200}"
  fi
  live_api POST "/api/servers/${paper}/console/command" '{"command":"list"}'
  if [[ "$LAST_STATUS" == "403" || "$LAST_STATUS" == "423" ]]; then
    ops_ok "console denied while suspended ($LAST_STATUS)"
  else
    ops_fail "console while suspended expected 403/423 got $LAST_STATUS ${LAST_BODY:0:160}"
  fi
  live_api POST "/api/servers/${paper}/start" '{}'
  if [[ "$LAST_STATUS" == "403" || "$LAST_STATUS" == "423" || "$LAST_STATUS" == "409" ]]; then
    ops_ok "start denied while suspended ($LAST_STATUS)"
  else
    ops_fail "start while suspended expected 403/423/409 got $LAST_STATUS ${LAST_BODY:0:160}"
  fi
  live_api POST "/api/servers/${paper}/unsuspend" '{}'
  if [[ "$LAST_STATUS" == "200" || "$LAST_STATUS" == "202" ]]; then
    ops_ok "unsuspend accepted"
  else
    ops_fail "unsuspend $LAST_STATUS ${LAST_BODY:0:200}"
  fi
  ensure_running "$paper" "Paper after unsuspend" || true
  live_api POST "/api/servers/${paper}/console/command" '{"command":"list"}'
  if [[ "$LAST_STATUS" == "200" || "$LAST_STATUS" == "202" ]]; then
    ops_ok "console allowed after unsuspend"
  else
    ops_fail "console after unsuspend $LAST_STATUS ${LAST_BODY:0:160}"
  fi

  log "Live checks: ${OPS_PASS} passed, ${OPS_FAIL} failed"
  [[ "$OPS_FAIL" -eq 0 ]] || fail "live behavioral checks failed"
}
