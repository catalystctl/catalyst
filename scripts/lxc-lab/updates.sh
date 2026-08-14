# Pull latest GHCR images, then exercise panel auto-update + agent self-update.

stage_updates() {
  stage_refresh
  load_state
  [[ -n "${AUTH_TOKEN:-}" ]] || login_or_setup
  [[ -n "${NODE_ID:-}" ]] || fail "NODE_ID missing"
  OPS_PASS=0
  OPS_FAIL=0
  log "Update checks (panel + agent)"

  api_ex GET "/api/update/check"
  accept_http "public update check" "$LAST_STATUS" 200
  api_ex GET "/api/admin/update/status"
  accept_http "admin update status" "$LAST_STATUS" 200
  local current latest docker auto
  current="$(printf '%s' "$LAST_BODY" | jq -r '.currentVersion // empty')"
  latest="$(printf '%s' "$LAST_BODY" | jq -r '.latestVersion // empty')"
  docker="$(printf '%s' "$LAST_BODY" | jq -r '.isDocker')"
  auto="$(printf '%s' "$LAST_BODY" | jq -r '.autoUpdateEnabled')"
  log "panel current=$current latest=$latest docker=$docker auto=$auto"

  api_ex POST "/api/admin/update/trigger" '{}'
  if [[ "$LAST_STATUS" == "200" ]]; then
    ops_ok "panel update trigger accepted"
  elif [[ "$LAST_STATUS" == "400" ]]; then
    ops_ok "panel update trigger reported expected failure (${LAST_BODY:0:160})"
  else
    ops_fail "panel update trigger HTTP $LAST_STATUS ${LAST_BODY:0:200}"
  fi

  api_ex GET "/api/nodes/${NODE_ID}/agent/update-status"
  accept_http "agent update status" "$LAST_STATUS" 200

  log "Triggering panel agent update to $current"
  api_ex POST "/api/nodes/${NODE_ID}/agent/update" \
    "$(jq -n --arg targetVersion "${current#v}" '{targetVersion:$targetVersion}')"
  accept_http "panel agent update command" "$LAST_STATUS" 200

  local i st ver finished=0
  for i in $(seq 1 40); do
    api_ex GET "/api/nodes/${NODE_ID}/agent/update-status"
    st="$(printf '%s' "$LAST_BODY" | jq -r '.data.status // empty')"
    ver="$(printf '%s' "$LAST_BODY" | jq -r '.data.currentVersion // empty')"
    log "agent update status=$st version=$ver"
    if [[ "$st" == "failed" ]]; then
      ops_fail "agent update failed: ${LAST_BODY:0:240}"
      finished=1
      break
    fi
    if [[ "$st" == "completed" || "$st" == "idle" ]]; then
      ops_ok "agent update finished ($st version=$ver)"
      finished=1
      break
    fi
    if [[ "$st" == "applying" && "$ver" == "${current#v}" && "$i" -ge 4 ]]; then
      ops_ok "agent already at $ver (same-version skip)"
      finished=1
      break
    fi
    sleep 3
  done
  [[ "$finished" -eq 1 ]] || ops_fail "agent update timed out status=$st version=$ver"

  local online=""
  for i in $(seq 1 20); do
    online="$(api GET "/api/nodes/${NODE_ID}" | jq -r '.data.isOnline')"
    [[ "$online" == "true" ]] && break
    sleep 2
  done
  [[ "$online" == "true" ]] && ops_ok "node online after agent update" \
    || ops_fail "node not online after agent update"

  api_ex GET "/api/servers"
  accept_http "servers list after update" "$LAST_STATUS" 200
  if [[ -n "${PAPER_SERVER_ID:-}" ]]; then
    assert_contains "Paper still listed" "$LAST_BODY" "$PAPER_SERVER_ID"
  fi
  if [[ -n "${SOTF_SERVER_ID:-}" ]]; then
    assert_contains "SotF still listed" "$LAST_BODY" "$SOTF_SERVER_ID"
  fi

  log "Updates: ${OPS_PASS} passed, ${OPS_FAIL} failed"
  [[ "$OPS_FAIL" -eq 0 ]] || fail "update checks failed"
}
