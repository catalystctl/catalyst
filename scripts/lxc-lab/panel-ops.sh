# SFTP, backups, alerts, and scheduled-task stages.
# Sourced from lab.sh after server-ops.sh (uses ops_ok / require_paper).

stage_sftp() {
  require_paper
  local id="$PAPER_SERVER_ID"
  OPS_PASS=0
  OPS_FAIL=0
  command -v sshpass >/dev/null && command -v sftp >/dev/null \
    || fail "sshpass and sftp required for SFTP lab"

  log "SFTP checks against Paper $id"

  api_ex GET "/api/sftp/connection-info?serverId=${id}"
  assert_http "sftp connection-info" 200 "$LAST_STATUS" "$LAST_BODY"
  local host port user pass
  host="$(printf '%s' "$LAST_BODY" | jq -r '.data.host')"
  port="$(printf '%s' "$LAST_BODY" | jq -r '.data.port')"
  user="$(printf '%s' "$LAST_BODY" | jq -r '.data.username')"
  pass="$(printf '%s' "$LAST_BODY" | jq -r '.data.sftpPassword')"
  [[ "$user" == "$id" ]] && ops_ok "sftp username is server id" || ops_fail "sftp username=$user"
  [[ -n "$pass" && "$pass" != "null" ]] && ops_ok "sftp password issued" || ops_fail "missing sftp password"

  api_ex GET "/api/sftp/tokens?serverId=${id}"
  assert_http "list sftp tokens" 200 "$LAST_STATUS" "$LAST_BODY"

  local tmp got
  tmp="$(mktemp -d)"
  printf 'sftp-lab-payload\n' > "${tmp}/hello.txt"
  got="${tmp}/got.txt"

  local sftp_opts=(-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null
    -o PreferredAuthentications=password -o PubkeyAuthentication=no
    -o NumberOfPasswordPrompts=1 -P "$port")

  if sshpass -p "$pass" sftp "${sftp_opts[@]}" "${user}@${host}" >/tmp/sftp-ls.out 2>/tmp/sftp-ls.err <<'EOF'
ls
bye
EOF
  then
    ops_ok "sftp ls"
  else
    ops_fail "sftp ls failed: $(head -c 200 /tmp/sftp-ls.err)"
  fi

  if sshpass -p "$pass" sftp "${sftp_opts[@]}" "${user}@${host}" >/tmp/sftp-put.out 2>/tmp/sftp-put.err <<EOF
mkdir sftp-lab
cd sftp-lab
put ${tmp}/hello.txt hello.txt
ls
bye
EOF
  then
    ops_ok "sftp mkdir/put"
  else
    ops_fail "sftp put failed: $(head -c 200 /tmp/sftp-put.err)"
  fi

  if sshpass -p "$pass" sftp "${sftp_opts[@]}" "${user}@${host}" >/tmp/sftp-get.out 2>/tmp/sftp-get.err <<EOF
cd sftp-lab
get hello.txt ${got}
bye
EOF
  then
    if grep -Fq "sftp-lab-payload" "$got"; then
      ops_ok "sftp get matches upload"
    else
      ops_fail "sftp get content mismatch"
    fi
  else
    ops_fail "sftp get failed: $(head -c 200 /tmp/sftp-get.err)"
  fi

  names="$(file_list_names "$id" "/sftp-lab")"
  assert_contains "file explorer sees sftp upload" "$names" "hello.txt"

  api_ex POST "/api/sftp/rotate-token" "$(jq -n --arg serverId "$id" '{serverId:$serverId}')"
  assert_http "rotate sftp token" 200 "$LAST_STATUS" "$LAST_BODY"
  local newpass
  newpass="$(printf '%s' "$LAST_BODY" | jq -r '.data.sftpPassword')"

  if sshpass -p "$pass" sftp "${sftp_opts[@]}" "${user}@${host}" >/dev/null 2>&1 <<'EOF'
ls
bye
EOF
  then
    ops_fail "old sftp token still works after rotate"
  else
    ops_ok "old sftp token rejected after rotate"
  fi

  if sshpass -p "$newpass" sftp "${sftp_opts[@]}" "${user}@${host}" >/dev/null 2>&1 <<'EOF'
ls
bye
EOF
  then
    ops_ok "new sftp token works"
  else
    ops_fail "new sftp token failed"
  fi

  sshpass -p "$newpass" sftp "${sftp_opts[@]}" "${user}@${host}" >/dev/null 2>&1 <<'EOF' || true
cd sftp-lab
rm hello.txt
bye
EOF

  rm -rf "$tmp"
  log "SFTP: ${OPS_PASS} passed, ${OPS_FAIL} failed"
  [[ "$OPS_FAIL" -eq 0 ]] || fail "sftp checks failed"
}

stage_backups() {
  require_paper
  local id="$PAPER_SERVER_ID"
  OPS_PASS=0
  OPS_FAIL=0
  log "Backup checks against Paper $id"

  api_ex PUT "/api/servers/${id}" '{"backupAllocationMb":4096}'
  assert_http "enable backup allocation" 200 "$LAST_STATUS" "$LAST_BODY"

  api_ex POST "/api/servers/${id}/stop" '{}'
  wait_server_status "$id" "stopped" 30 && ops_ok "stopped for backup" || ops_fail "could not stop for backup"
  release_cni_lease "$id"

  api_ex POST "/api/servers/${id}/backups" '{"name":"lab-full"}'
  if [[ "$LAST_STATUS" == "200" || "$LAST_STATUS" == "201" || "$LAST_STATUS" == "202" ]]; then
    ops_ok "create backup accepted ($LAST_STATUS)"
  else
    ops_fail "create backup $LAST_STATUS ${LAST_BODY:0:200}"
  fi

  local i st
  for i in $(seq 1 40); do
    st="$(api GET "/api/servers/${id}" | jq -r '.data.status // empty')"
    if [[ "$st" != "creating_backup" ]]; then
      break
    fi
    sleep 3
  done
  [[ "$st" != "creating_backup" ]] && ops_ok "backup finished (server=$st)" || ops_fail "backup still creating"

  api_ex GET "/api/servers/${id}/backups"
  assert_http "list backups" 200 "$LAST_STATUS" "$LAST_BODY"
  local count
  count="$(printf '%s' "$LAST_BODY" | jq -r '(.data // .backups // []) | length')"
  if [[ "${count:-0}" -gt 0 ]]; then
    ops_ok "backup list nonempty ($count)"
  else
    # Some responses wrap as {success,data:[...]} or {backups:[...]}
    count="$(printf '%s' "$LAST_BODY" | jq -r '[.data,.backups,.data.backups] | map(select(.!=null)) | .[0] | if type=="array" then length else 0 end')"
    if [[ "${count:-0}" -gt 0 ]]; then
      ops_ok "backup list nonempty ($count)"
    else
      ops_fail "backup list empty: ${LAST_BODY:0:240}"
    fi
  fi

  api_ex POST "/api/servers/${id}/start" '{}'
  if ! wait_server_status "$id" "running" 20; then
    release_cni_lease "$id"
    api_ex POST "/api/servers/${id}/start" '{}'
  fi
  wait_server_status "$id" "running" 30 && ops_ok "running after backup" || ops_fail "did not restart after backup"

  log "Backups: ${OPS_PASS} passed, ${OPS_FAIL} failed"
  [[ "$OPS_FAIL" -eq 0 ]] || fail "backup checks failed"
}

stage_alerts() {
  require_paper
  local id="$PAPER_SERVER_ID"
  OPS_PASS=0
  OPS_FAIL=0
  log "Alert checks against Paper $id"

  api_ex POST "/api/alert-rules" "$(jq -n --arg targetId "$id" '{
    name:"Lab High CPU",
    description:"Lab threshold",
    type:"resource_threshold",
    target:"server",
    targetId:$targetId,
    conditions:{cpuThreshold:1},
    actions:{webhooks:["https://example.invalid/hook"],cooldownMinutes:5}
  }')"
  if [[ "$LAST_STATUS" != "200" && "$LAST_STATUS" != "201" ]]; then
    ops_fail "create alert rule $LAST_STATUS ${LAST_BODY:0:240}"
    log "Alerts: ${OPS_PASS} passed, ${OPS_FAIL} failed"
    fail "alert checks failed"
  fi
  ops_ok "create alert rule ($LAST_STATUS)"
  local rule
  rule="$(printf '%s' "$LAST_BODY" | jq -r '.rule.id // .data.id // empty')"
  [[ -n "$rule" ]] && ops_ok "alert rule id $rule" || ops_fail "no rule id"

  api_ex GET "/api/alert-rules?scope=all"
  assert_http "list alert rules" 200 "$LAST_STATUS" "$LAST_BODY"
  assert_contains "rule in list" "$LAST_BODY" "$rule"

  api_ex PUT "/api/alert-rules/${rule}" '{"enabled":false}'
  assert_http "disable alert rule" 200 "$LAST_STATUS" "$LAST_BODY"

  api_ex GET "/api/alerts?scope=all"
  assert_http "list alerts" 200 "$LAST_STATUS" "$LAST_BODY"

  api_ex GET "/api/alerts/stats?scope=all"
  assert_http "alert stats" 200 "$LAST_STATUS" "$LAST_BODY"

  api_ex DELETE "/api/alert-rules/${rule}"
  assert_http "delete alert rule" 200 "$LAST_STATUS" "$LAST_BODY"

  log "Alerts: ${OPS_PASS} passed, ${OPS_FAIL} failed"
  [[ "$OPS_FAIL" -eq 0 ]] || fail "alert checks failed"
}

stage_automations() {
  require_paper
  local id="$PAPER_SERVER_ID"
  OPS_PASS=0
  OPS_FAIL=0
  log "Automation checks against Paper $id"

  api_ex POST "/api/servers/${id}/tasks" "$(jq -n '{
    name:"Lab list players",
    description:"Lab cron",
    action:"command",
    schedule:"0 3 * * *",
    payload:{command:"list"}
  }')"
  if [[ "$LAST_STATUS" != "200" && "$LAST_STATUS" != "201" ]]; then
    ops_fail "create task $LAST_STATUS ${LAST_BODY:0:240}"
    fail "automation checks failed"
  fi
  ops_ok "create scheduled task ($LAST_STATUS)"
  local task
  task="$(printf '%s' "$LAST_BODY" | jq -r '.task.id // .data.id // empty')"
  [[ -n "$task" ]] && ops_ok "task id $task" || ops_fail "no task id"

  api_ex GET "/api/servers/${id}/tasks"
  assert_http "list tasks" 200 "$LAST_STATUS" "$LAST_BODY"
  assert_contains "task in list" "$LAST_BODY" "$task"

  api_ex GET "/api/servers/${id}/tasks/${task}"
  assert_http "get task" 200 "$LAST_STATUS" "$LAST_BODY"

  api_ex PUT "/api/servers/${id}/tasks/${task}" '{"enabled":false}'
  assert_http "disable task" 200 "$LAST_STATUS" "$LAST_BODY"

  api_ex POST "/api/servers/${id}/tasks/${task}/execute" '{}'
  if [[ "$LAST_STATUS" == "200" ]]; then
    ops_ok "execute task"
  else
    ops_fail "execute task $LAST_STATUS ${LAST_BODY:0:200}"
  fi

  api_ex DELETE "/api/servers/${id}/tasks/${task}"
  assert_http "delete task" 200 "$LAST_STATUS" "$LAST_BODY"

  log "Automations: ${OPS_PASS} passed, ${OPS_FAIL} failed"
  [[ "$OPS_FAIL" -eq 0 ]] || fail "automation checks failed"
}
