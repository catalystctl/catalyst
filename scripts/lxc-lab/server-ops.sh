# File explorer + server-control stages for the LXC lab.
# Sourced from lab.sh after login_or_setup exists.

OPS_PASS=0
OPS_FAIL=0

ops_ok() {
  OPS_PASS=$((OPS_PASS + 1))
  log "PASS  $*"
}

ops_fail() {
  OPS_FAIL=$((OPS_FAIL + 1))
  warn "FAIL  $*"
}

require_paper() {
  load_state
  [[ -n "${AUTH_TOKEN:-}" ]] || login_or_setup
  if [[ -z "${PAPER_SERVER_ID:-}" ]]; then
    PAPER_SERVER_ID="$(find_server "${MC_NAME}")"
    save_state PAPER_SERVER_ID "$PAPER_SERVER_ID"
  fi
  [[ -n "${PAPER_SERVER_ID:-}" && "${PAPER_SERVER_ID}" != "null" ]] \
    || fail "PAPER_SERVER_ID missing — run servers first"
}

release_cni_lease() {
  local container_id="$1"
  [[ -n "$container_id" ]] || return 0
  local f
  for f in /var/lib/cni/networks/catalyst/*; do
    [[ -f "$f" ]] || continue
    if sudo grep -q "$container_id" "$f" 2>/dev/null; then
      sudo rm -f "$f"
    fi
  done
  sudo rm -f "/var/lib/cni/results/catalyst-${container_id}" \
    "/var/lib/cni/results/catalyst-${container_id}-config"
}

wait_server_status() {
  local id="$1"
  local want="$2"
  local tries="${3:-40}"
  local i got
  for i in $(seq 1 "$tries"); do
    got="$(api GET "/api/servers/${id}" | jq -r '.data.status // empty')"
    if [[ "$got" == "$want" ]]; then
      return 0
    fi
    sleep 2
  done
  warn "server $id status=$got wanted=$want"
  return 1
}
file_list_names() {
  local id="$1"
  local dir="$2"
  api GET "/api/servers/${id}/files?path=$(printf '%s' "$dir" | jq -sRr @uri)" \
    | jq -r '.data.files[]?.name // .data.files[]?.path // empty'
}

assert_http() {
  local label="$1"
  local expect="$2"
  local status="$3"
  local body="$4"
  if [[ "$status" == "$expect" ]]; then
    ops_ok "$label ($status)"
  else
    ops_fail "$label expected HTTP $expect got $status body=${body:0:240}"
  fi
}

assert_contains() {
  local label="$1"
  local hay="$2"
  local needle="$3"
  if printf '%s' "$hay" | grep -Fq "$needle"; then
    ops_ok "$label"
  else
    ops_fail "$label missing '$needle' in: ${hay:0:240}"
  fi
}

stage_files() {
  require_paper
  local id="$PAPER_SERVER_ID"
  local root="/lab-explorer"
  local names tmp up
  OPS_PASS=0
  OPS_FAIL=0
  tmp="$(mktemp -d)"
  up="${tmp}/upload-src.txt"
  printf 'uploaded-via-multipart\n' > "$up"

  log "File explorer checks against Paper $id"

  api_ex GET "/api/servers/${id}/files?path=%2F"
  assert_http "list /" 200 "$LAST_STATUS" "$LAST_BODY"
  names="$(printf '%s' "$LAST_BODY" | jq -r '.data.files[]?.name // empty')"
  assert_contains "root has server.jar" "$names" "server.jar"

  api_ex GET "/api/servers/${id}/files?path=..%2F..%2Fetc"
  if [[ "$LAST_STATUS" == "400" || "$LAST_STATUS" == "403" ]]; then
    ops_ok "list rejects path traversal ($LAST_STATUS)"
  else
    ops_fail "list traversal expected 400/403 got $LAST_STATUS ${LAST_BODY:0:160}"
  fi

  api_ex POST "/api/servers/${id}/files/create" \
    "$(jq -n --arg path "$root" '{path:$path,isDirectory:true}')"
  if [[ "$LAST_STATUS" == "200" ]]; then
    ops_ok "create dir $root (200)"
  elif [[ "$LAST_STATUS" == "400" ]]; then
    ops_ok "create dir $root already exists"
  else
    ops_fail "create dir $root expected 200/400 got $LAST_STATUS ${LAST_BODY:0:160}"
  fi

  api_ex POST "/api/servers/${id}/files/create" \
    "$(jq -n --arg path "${root}/note.txt" --arg content "hello-lab" '{path:$path,isDirectory:false,content:$content}')"
  assert_http "create file note.txt" 200 "$LAST_STATUS" "$LAST_BODY"

  api_ex POST "/api/servers/${id}/files/write" \
    "$(jq -n --arg path "${root}/note.txt" --arg content "hello-lab-rewritten" '{path:$path,content:$content}')"
  assert_http "write note.txt" 200 "$LAST_STATUS" "$LAST_BODY"

  local dl
  dl="$(api_download "/api/servers/${id}/files/download?path=$(printf '%s' "${root}/note.txt" | jq -sRr @uri)" "${tmp}/note.txt")"
  if [[ "$dl" == "200" ]] && grep -Fq "hello-lab-rewritten" "${tmp}/note.txt"; then
    ops_ok "download note.txt contents"
  else
    ops_fail "download note.txt status=$dl body=$(head -c 120 "${tmp}/note.txt" 2>/dev/null || true)"
  fi

  api_ex POST "/api/servers/${id}/files/permissions" \
    "$(jq -n --arg path "${root}/note.txt" '{path:$path,mode:"644"}')"
  assert_http "chmod 644 note.txt" 200 "$LAST_STATUS" "$LAST_BODY"

  api_ex POST "/api/servers/${id}/files/rename" \
    "$(jq -n --arg from "${root}/note.txt" --arg to "${root}/note-renamed.txt" '{from:$from,to:$to}')"
  assert_http "rename note.txt" 200 "$LAST_STATUS" "$LAST_BODY"

  names="$(file_list_names "$id" "$root")"
  assert_contains "list shows renamed file" "$names" "note-renamed.txt"

  api_upload "/api/servers/${id}/files/upload" "$root" "$up"
  assert_http "upload upload-src.txt" 200 "$LAST_STATUS" "$LAST_BODY"
  names="$(file_list_names "$id" "$root")"
  assert_contains "list shows upload-src.txt" "$names" "upload-src.txt"

  api_ex POST "/api/servers/${id}/files/compress" \
    "$(jq -n --arg a "${root}/lab-bundle.tar.gz" \
      --arg p1 "${root}/note-renamed.txt" --arg p2 "${root}/upload-src.txt" \
      '{paths:[$p1,$p2],archiveName:$a}')"
  assert_http "compress lab-bundle.tar.gz" 200 "$LAST_STATUS" "$LAST_BODY"

  api_ex POST "/api/servers/${id}/files/archive-contents" \
    "$(jq -n --arg archivePath "${root}/lab-bundle.tar.gz" '{archivePath:$archivePath}')"
  assert_http "archive-contents" 200 "$LAST_STATUS" "$LAST_BODY"
  if printf '%s' "$LAST_BODY" | grep -Fq "note-renamed"; then
    ops_ok "archive lists note-renamed.txt"
  else
    warn "archive-contents empty (agent tar parser); verifying via extract instead"
  fi

  api_ex POST "/api/servers/${id}/files/create" \
    "$(jq -n --arg path "${root}/extracted" '{path:$path,isDirectory:true}')"
  if [[ "$LAST_STATUS" == "200" || "$LAST_STATUS" == "400" ]]; then
    ops_ok "create extract dir"
  else
    ops_fail "create extract dir $LAST_STATUS ${LAST_BODY:0:160}"
  fi
  api_ex POST "/api/servers/${id}/files/decompress" \
    "$(jq -n --arg archivePath "${root}/lab-bundle.tar.gz" --arg targetPath "${root}/extracted" \
      '{archivePath:$archivePath,targetPath:$targetPath}')"
  assert_http "decompress lab-bundle.tar.gz" 200 "$LAST_STATUS" "$LAST_BODY"
  names="$(file_list_names "$id" "${root}/extracted/lab-explorer")"
  assert_contains "extracted note-renamed.txt" "$names" "note-renamed"

  api_ex DELETE "/api/servers/${id}/files/delete?path=$(printf '%s' "${root}/upload-src.txt" | jq -sRr @uri)"
  assert_http "delete uploaded file" 200 "$LAST_STATUS" "$LAST_BODY"

  for p in "${root}/note-renamed.txt" "${root}/lab-bundle.tar.gz"; do
    api_ex DELETE "/api/servers/${id}/files/delete?path=$(printf '%s' "$p" | jq -sRr @uri)" || true
  done

  names="$(file_list_names "$id" "/")"
  assert_contains "root still has server.jar after explorer ops" "$names" "server.jar"

  rm -rf "$tmp"
  log "File explorer: ${OPS_PASS} passed, ${OPS_FAIL} failed"
  [[ "$OPS_FAIL" -eq 0 ]] || fail "file explorer checks failed"
}

stage_ops() {
  require_paper
  local id="$PAPER_SERVER_ID"
  OPS_PASS=0
  OPS_FAIL=0

  log "Server control checks against Paper $id"

  api_ex GET "/api/servers/${id}"
  assert_http "get server" 200 "$LAST_STATUS" "$LAST_BODY"
  assert_contains "server name" "$LAST_BODY" "Minecraft Paper"

  api_ex GET "/api/servers/${id}/logs?lines=20"
  assert_http "get logs" 200 "$LAST_STATUS" "$LAST_BODY"

  if api GET "/api/servers/${id}" | jq -e '.data.status=="running"' >/dev/null; then
    api_ex POST "/api/servers/${id}/console/command" '{"command":"list"}'
    if [[ "$LAST_STATUS" == "200" || "$LAST_STATUS" == "202" ]]; then
      ops_ok "console command list ($LAST_STATUS)"
    else
      ops_fail "console command expected 200/202 got $LAST_STATUS ${LAST_BODY:0:160}"
    fi
  else
    warn "Paper not running — skipping console command"
  fi

  api_ex POST "/api/servers/${id}/stop" '{}'
  if [[ "$LAST_STATUS" == "200" || "$LAST_STATUS" == "202" ]]; then
    ops_ok "stop accepted"
    wait_server_status "$id" "stopped" 30 && ops_ok "stopped" || ops_fail "did not reach stopped"
    release_cni_lease "$id"
  else
    ops_fail "stop expected 200 got $LAST_STATUS ${LAST_BODY:0:160}"
  fi

  api_ex POST "/api/servers/${id}/start" '{}'
  if [[ "$LAST_STATUS" == "200" || "$LAST_STATUS" == "202" ]]; then
    ops_ok "start accepted"
    if ! wait_server_status "$id" "running" 20; then
      release_cni_lease "$id"
      api_ex POST "/api/servers/${id}/start" '{}'
    fi
    wait_server_status "$id" "running" 30 && ops_ok "running after start" || ops_fail "did not reach running"
  else
    ops_fail "start expected 200 got $LAST_STATUS ${LAST_BODY:0:160}"
  fi

  api_ex POST "/api/servers/${id}/restart" '{}'
  if [[ "$LAST_STATUS" == "200" || "$LAST_STATUS" == "202" ]]; then
    ops_ok "restart accepted"
    sleep 3
    if ! wait_server_status "$id" "running" 20; then
      release_cni_lease "$id"
      api_ex POST "/api/servers/${id}/start" '{}'
    fi
    wait_server_status "$id" "running" 30 && ops_ok "running after restart" || ops_fail "did not return to running"
  else
    ops_fail "restart expected 200 got $LAST_STATUS ${LAST_BODY:0:160}"
  fi

  api_ex POST "/api/servers/${id}/backups" '{"name":"lab-smoke"}'
  if [[ "$LAST_STATUS" == "200" || "$LAST_STATUS" == "201" || "$LAST_STATUS" == "202" ]]; then
    ops_ok "create backup accepted ($LAST_STATUS)"
  elif [[ "$LAST_STATUS" == "403" ]] && printf '%s' "$LAST_BODY" | grep -Fq "Backup allocation disabled"; then
    ops_ok "create backup skipped (allocation disabled)"
  elif [[ "$LAST_STATUS" == "409" ]] && printf '%s' "$LAST_BODY" | grep -Fq "must be stopped"; then
    ops_ok "create backup requires stopped server (expected while running)"
  else
    ops_fail "create backup unexpected $LAST_STATUS ${LAST_BODY:0:200}"
  fi
  api_ex GET "/api/servers/${id}/backups"
  assert_http "list backups" 200 "$LAST_STATUS" "$LAST_BODY"

  api_ex GET "/api/servers/${id}/metrics"
  if [[ "$LAST_STATUS" == "200" ]]; then
    ops_ok "get metrics"
  else
    log "metrics endpoint HTTP $LAST_STATUS (optional)"
  fi

  log "Server ops: ${OPS_PASS} passed, ${OPS_FAIL} failed"
  [[ "$OPS_FAIL" -eq 0 ]] || fail "server control checks failed"
}
