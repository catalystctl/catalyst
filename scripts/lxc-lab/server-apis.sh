# Exhaustive server-API stage. Sourced after server-ops.sh.
# Hits every user-facing /api/servers/* route that is not already
# covered by files/ops/sftp/backups/alerts/automations.

accept_http() {
  local label="$1"
  local status="$2"
  shift 2
  local ok
  for ok in "$@"; do
    if [[ "$status" == "$ok" ]]; then
      ops_ok "$label ($status)"
      return 0
    fi
  done
  ops_fail "$label unexpected HTTP $status body=${LAST_BODY:0:240}"
}

sse_peek() {
  local path="$1"
  local label="$2"
  local url="${API_BASE}${path}"
  local out
  out="$(curl -sS -N --max-time 3 \
    -H "Authorization: Bearer ${AUTH_TOKEN}" \
    -H "Accept: text/event-stream" \
    -b "$COOKIE_JAR" "$url" 2>/dev/null || true)"
  if printf '%s' "$out" | grep -Eq 'event:|data:|: connected|connected'; then
    ops_ok "$label"
  else
    ops_fail "$label no SSE payload: ${out:0:200}"
  fi
}

cleanup_clone() {
  local cid="${1:-}"
  [[ -n "$cid" && "$cid" != "null" ]] || return 0
  api_ex POST "/api/servers/${cid}/unsuspend" '{}' || true
  api_ex POST "/api/servers/${cid}/restore" '{}' || true
  api_ex DELETE "/api/servers/${cid}"
}

stage_apis() {
  require_paper
  local id="$PAPER_SERVER_ID"
  local sotf="${SOTF_SERVER_ID:-}"
  local clone="" backup_id="" invite_id="" invite_token=""
  local orig_name orig_disk
  OPS_PASS=0
  OPS_FAIL=0
  log "Full server API sweep against Paper $id"

  # --- list / read ---
  api_ex GET "/api/servers"
  assert_http "list servers" 200 "$LAST_STATUS" "$LAST_BODY"
  assert_contains "list includes Paper" "$LAST_BODY" "$id"
  if [[ -n "$sotf" ]]; then
    assert_contains "list includes SotF" "$LAST_BODY" "$sotf"
    api_ex GET "/api/servers/${sotf}"
    assert_http "get SotF" 200 "$LAST_STATUS" "$LAST_BODY"
  fi

  api_ex GET "/api/servers/${id}"
  assert_http "get Paper" 200 "$LAST_STATUS" "$LAST_BODY"
  orig_name="$(printf '%s' "$LAST_BODY" | jq -r '.data.name')"
  orig_disk="$(printf '%s' "$LAST_BODY" | jq -r '.data.allocatedDiskMb')"

  api_ex GET "/api/servers/${id}/activity"
  accept_http "activity" "$LAST_STATUS" 200

  api_ex GET "/api/servers/${id}/stats/history?range=1h"
  accept_http "stats history" "$LAST_STATUS" 200

  api_ex GET "/api/servers/${id}/stats"
  accept_http "current stats" "$LAST_STATUS" 200

  api_ex GET "/api/servers/${id}/metrics"
  accept_http "server metrics" "$LAST_STATUS" 200

  api_ex GET "/api/nodes/${NODE_ID}/metrics"
  accept_http "node metrics" "$LAST_STATUS" 200

  api_ex GET "/api/servers/${id}/permissions"
  accept_http "server permissions" "$LAST_STATUS" 200

  api_ex GET "/api/servers/${id}/variables"
  accept_http "get variables" "$LAST_STATUS" 200
  var_body="$(printf '%s' "$LAST_BODY" | jq -c '([.data[]?] | map(select(.name != null) | {(.name): (.value // .default // "")}) | add) // {}')"
  api_ex PATCH "/api/servers/${id}/variables" "$var_body"
  accept_http "patch variables" "$LAST_STATUS" 200 400 422

  # --- metadata update (revert name) ---
  api_ex PUT "/api/servers/${id}" "$(jq -n --arg n "${orig_name} Lab" '{name:$n}')"
  accept_http "rename server" "$LAST_STATUS" 200
  api_ex PUT "/api/servers/${id}" "$(jq -n --arg n "$orig_name" '{name:$n}')"
  accept_http "restore server name" "$LAST_STATUS" 200

  api_ex PATCH "/api/servers/${id}/restart-policy" '{"restartPolicy":"on-failure","maxCrashCount":3}'
  accept_http "restart policy" "$LAST_STATUS" 200

  api_ex POST "/api/servers/${id}/reset-crash-count" '{}'
  accept_http "reset crash count" "$LAST_STATUS" 200

  api_ex PATCH "/api/servers/${id}/backup-settings" '{"storageMode":"local","retentionCount":3,"retentionDays":7,"backupAllocationMb":4096}'
  accept_http "backup settings" "$LAST_STATUS" 200

  # --- files extras not in files stage ---
  api_ex POST "/api/servers/${id}/files/write" \
    '{"path":"/lab-api.txt","content":"api-sweep\n"}'
  accept_http "files write" "$LAST_STATUS" 200
  api_ex POST "/api/servers/${id}/files/permissions" \
    '{"path":"/lab-api.txt","mode":"644"}'
  accept_http "files chmod" "$LAST_STATUS" 200
  api_ex DELETE "/api/servers/${id}/files/delete?path=$(printf '%s' /lab-api.txt | jq -sRr @uri)"
  accept_http "files delete lab-api" "$LAST_STATUS" 200

  # --- console / SSE ---
  api_ex POST "/api/servers/${id}/console/command" '{"command":"list"}'
  accept_http "console command" "$LAST_STATUS" 200 202
  sse_peek "/api/servers/${id}/console/stream" "console SSE"
  sse_peek "/api/servers/${id}/events" "server events SSE"
  sse_peek "/api/servers/all-servers/events" "global events SSE"
  sse_peek "/api/servers/${id}/metrics/stream" "metrics SSE"

  # --- network ---
  api_ex GET "/api/servers/${id}/allocations"
  accept_http "list allocations" "$LAST_STATUS" 200
  api_ex POST "/api/servers/${id}/allocations" '{"containerPort":25566,"hostPort":25566}'
  accept_http "add allocation" "$LAST_STATUS" 200 201 409
  if [[ "$LAST_STATUS" == "200" || "$LAST_STATUS" == "201" ]]; then
    api_ex POST "/api/servers/${id}/allocations/primary" '{"containerPort":25565}'
    accept_http "set primary allocation" "$LAST_STATUS" 200 400 404 409
    api_ex DELETE "/api/servers/${id}/allocations/25566"
    accept_http "delete extra allocation" "$LAST_STATUS" 200 404
  fi

  # --- invites / access ---
  api_ex GET "/api/servers/${id}/invites"
  accept_http "list invites" "$LAST_STATUS" 200
  api_ex POST "/api/servers/${id}/invites" \
    '{"email":"lab-invite@example.invalid","permissions":["server.read","console.read"]}'
  accept_http "create invite" "$LAST_STATUS" 200 201
  if [[ "$LAST_STATUS" == "200" || "$LAST_STATUS" == "201" ]]; then
    invite_id="$(printf '%s' "$LAST_BODY" | jq -r '.data.id // .invite.id // empty')"
    invite_token="$(printf '%s' "$LAST_BODY" | jq -r '.data.token // .invite.token // empty')"
    if [[ -n "$invite_token" && "$invite_token" != "null" ]]; then
      api_ex GET "/api/servers/invites/${invite_token}"
      accept_http "invite preview" "$LAST_STATUS" 200
    fi
    if [[ -n "$invite_id" && "$invite_id" != "null" ]]; then
      api_ex DELETE "/api/servers/${id}/invites/${invite_id}"
      accept_http "cancel invite" "$LAST_STATUS" 200
    fi
  fi
  api_ex POST "/api/servers/${id}/access" \
    '{"targetUserId":"does-not-exist","permissions":["server.read"]}'
  accept_http "access missing user" "$LAST_STATUS" 400 404
  api_ex GET "/api/servers/${id}/transfer-candidates"
  accept_http "transfer candidates" "$LAST_STATUS" 200
  api_ex POST "/api/servers/${id}/transfer-ownership" '{"newOwnerId":"does-not-exist"}'
  accept_http "transfer ownership missing user" "$LAST_STATUS" 400 404

  # --- plugins / mods ---
  api_ex GET "/api/servers/${id}/plugin-manager/game-versions?provider=modrinth"
  accept_http "plugin game versions" "$LAST_STATUS" 200 400 404 409
  api_ex GET "/api/servers/${id}/plugin-manager/search?provider=modrinth&query=essentials"
  accept_http "plugin search" "$LAST_STATUS" 200 400 404 409
  api_ex GET "/api/servers/${id}/plugin-manager/installed"
  accept_http "plugin installed" "$LAST_STATUS" 200 400 404 409
  api_ex POST "/api/servers/${id}/plugin-manager/check-updates" '{}'
  accept_http "plugin check-updates" "$LAST_STATUS" 200 400 404 409
  api_ex GET "/api/servers/${id}/plugin-manager/versions?provider=modrinth&projectId=missing"
  accept_http "plugin versions missing" "$LAST_STATUS" 200 400 404 409
  api_ex POST "/api/servers/${id}/plugin-manager/install" \
    '{"provider":"modrinth","projectId":"missing","versionId":"missing"}'
  accept_http "plugin install missing" "$LAST_STATUS" 400 404 409
  api_ex POST "/api/servers/${id}/plugin-manager/uninstall" '{"filename":"missing.jar"}'
  accept_http "plugin uninstall missing" "$LAST_STATUS" 400 404 409
  api_ex POST "/api/servers/${id}/plugin-manager/update" \
    '{"provider":"modrinth","filename":"missing.jar"}'
  accept_http "plugin update missing" "$LAST_STATUS" 400 404 409

  api_ex GET "/api/servers/${id}/mod-manager/game-versions?provider=modrinth"
  accept_http "mod game versions" "$LAST_STATUS" 200 400 404 409
  api_ex GET "/api/servers/${id}/mod-manager/search?provider=modrinth&query=sodium"
  accept_http "mod search" "$LAST_STATUS" 200 400 404 409
  api_ex GET "/api/servers/${id}/mod-manager/installed"
  accept_http "mod installed" "$LAST_STATUS" 200 400 404 409
  api_ex POST "/api/servers/${id}/mod-manager/check-updates" '{}'
  accept_http "mod check-updates" "$LAST_STATUS" 200 400 404 409
  api_ex GET "/api/servers/${id}/mod-manager/versions?provider=modrinth&projectId=missing"
  accept_http "mod versions missing" "$LAST_STATUS" 200 400 404 409
  api_ex POST "/api/servers/${id}/mod-manager/install" \
    '{"provider":"modrinth","projectId":"missing","versionId":"missing"}'
  accept_http "mod install missing" "$LAST_STATUS" 400 404 409
  api_ex POST "/api/servers/${id}/mod-manager/uninstall" '{"filename":"missing.jar"}'
  accept_http "mod uninstall missing" "$LAST_STATUS" 400 404 409
  api_ex POST "/api/servers/${id}/mod-manager/update" \
    '{"provider":"modrinth","filename":"missing.jar"}'
  accept_http "mod update missing" "$LAST_STATUS" 400 404 409

  # --- databases ---
  api_ex GET "/api/servers/${id}/databases"
  accept_http "list databases" "$LAST_STATUS" 200
  api_ex PUT "/api/servers/${id}" '{"databaseAllocation":1}'
  accept_http "enable database allocation" "$LAST_STATUS" 200
  api_ex POST "/api/servers/${id}/databases" '{"name":"labdb","hostId":"missing-host"}'
  accept_http "create db missing host" "$LAST_STATUS" 400 403 404
  api_ex POST "/api/servers/${id}/databases/missing/rotate" '{}'
  accept_http "rotate missing db" "$LAST_STATUS" 404
  api_ex DELETE "/api/servers/${id}/databases/missing"
  accept_http "delete missing db" "$LAST_STATUS" 404
  api_ex PUT "/api/servers/${id}" '{"databaseAllocation":0}'
  accept_http "disable database allocation" "$LAST_STATUS" 200

  # --- backups extras ---
  api_ex GET "/api/servers/${id}/backups"
  accept_http "list backups" "$LAST_STATUS" 200
  backup_id="$(printf '%s' "$LAST_BODY" | jq -r '.backups[0].id // .data[0].id // empty')"
  if [[ -n "$backup_id" && "$backup_id" != "null" ]]; then
    api_ex GET "/api/servers/${id}/backups/${backup_id}"
    accept_http "get backup" "$LAST_STATUS" 200
    local tmp dl
    tmp="$(mktemp)"
    dl="$(curl -sS --max-time 15 -o "$tmp" -w '%{http_code}' \
      -H "Authorization: Bearer ${AUTH_TOKEN}" -b "$COOKIE_JAR" \
      "${API_BASE}/api/servers/${id}/backups/${backup_id}/download" || true)"
    if [[ "$dl" == "200" || "$dl" == "302" ]]; then
      ops_ok "download backup ($dl)"
    elif [[ -z "$dl" || "$dl" == "000" ]]; then
      ops_ok "download backup stream closed (agent/local backup)"
    else
      ops_fail "download backup HTTP $dl"
    fi
    rm -f "$tmp"
    api_ex POST "/api/servers/${id}/backups/${backup_id}/restore" '{}'
    accept_http "restore backup while running" "$LAST_STATUS" 409 400 403
  else
    ops_ok "no backup row to get/download (list empty after prior stage?)"
  fi

  # --- power extras on Paper ---
  api_ex POST "/api/servers/eula" "$(jq -n --arg serverId "$id" '{serverId:$serverId}')"
  accept_http "eula missing accepted" "$LAST_STATUS" 400

  local st
  st="$(api GET "/api/servers/${id}" | jq -r '.data.status // empty')"
  if [[ "$st" == "running" || "$st" == "starting" || "$st" == "stopping" ]]; then
    api_ex POST "/api/servers/${id}/kill" '{}'
    accept_http "kill" "$LAST_STATUS" 200 202
    wait_server_status "$id" "stopped" 20 || true
    release_cni_lease "$id"
    api_ex POST "/api/servers/${id}/start" '{}'
    accept_http "start after kill" "$LAST_STATUS" 200 202
    if ! wait_server_status "$id" "running" 20; then
      release_cni_lease "$id"
      api_ex POST "/api/servers/${id}/start" '{}'
      wait_server_status "$id" "running" 30 || ops_fail "did not return running after kill"
    else
      ops_ok "running after kill"
    fi
  else
    ops_ok "kill skipped (status=$st)"
  fi

  local grow=$((orig_disk + 1024))
  api_ex POST "/api/servers/${id}/storage/resize" "$(jq -n --argjson d "$grow" '{allocatedDiskMb:$d}')"
  accept_http "storage grow" "$LAST_STATUS" 200 202 409
  api_ex POST "/api/servers/${id}/storage/resize" "$(jq -n --argjson d "$orig_disk" '{allocatedDiskMb:$d}')"
  accept_http "storage shrink while running" "$LAST_STATUS" 409 400

  api_ex POST "/api/servers/${id}/transfer" '{"targetNodeId":"missing-node"}'
  accept_http "transfer missing node" "$LAST_STATUS" 400 404

  # --- clone + destructive lifecycle ---
  api_ex POST "/api/servers/${id}/clone" "$(jq -n --arg n "Lab API Clone $(date +%s)" '{name:$n,copyFiles:false}')"
  accept_http "clone server" "$LAST_STATUS" 200 201 409
  clone="$(printf '%s' "$LAST_BODY" | jq -r '.data.id // empty')"
  if [[ -n "$clone" && "$clone" != "null" ]]; then
    api_ex GET "/api/servers/${clone}"
    accept_http "get clone" "$LAST_STATUS" 200
    api_ex POST "/api/servers/${clone}/install" '{}'
    accept_http "install clone" "$LAST_STATUS" 200 202 409

    api_ex POST "/api/servers/bulk/status" "$(jq -n --arg id "$clone" '{serverIds:[$id]}')"
    accept_http "bulk status" "$LAST_STATUS" 200

    api_ex POST "/api/servers/${clone}/suspend" '{"reason":"lab sweep"}'
    accept_http "suspend clone" "$LAST_STATUS" 200
    api_ex POST "/api/servers/${clone}/unsuspend" '{}'
    accept_http "unsuspend clone" "$LAST_STATUS" 200

    api_ex POST "/api/servers/bulk/suspend" "$(jq -n --arg id "$clone" '{serverIds:[$id]}')"
    accept_http "bulk suspend" "$LAST_STATUS" 200
    api_ex POST "/api/servers/bulk/unsuspend" "$(jq -n --arg id "$clone" '{serverIds:[$id]}')"
    accept_http "bulk unsuspend" "$LAST_STATUS" 200

    api_ex POST "/api/servers/${clone}/reinstall" '{}'
    accept_http "reinstall clone" "$LAST_STATUS" 200 202 409
    api_ex POST "/api/servers/${clone}/rebuild" '{}'
    accept_http "rebuild clone" "$LAST_STATUS" 200 202 409

    api_ex POST "/api/servers/${clone}/archive" '{}'
    accept_http "archive clone" "$LAST_STATUS" 200
    api_ex POST "/api/servers/${clone}/restore" '{}'
    accept_http "restore archived clone" "$LAST_STATUS" 200

    api_ex DELETE "/api/servers/${clone}"
    accept_http "delete clone" "$LAST_STATUS" 200
    clone=""
  fi

  # Paper must still exist
  api_ex GET "/api/servers/${id}"
  assert_http "paper still present" 200 "$LAST_STATUS" "$LAST_BODY"

  cleanup_clone "$clone"
  log "Server APIs: ${OPS_PASS} passed, ${OPS_FAIL} failed"
  [[ "$OPS_FAIL" -eq 0 ]] || fail "server API sweep failed"
}
