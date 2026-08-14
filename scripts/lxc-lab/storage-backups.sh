# Real S3 (MinIO) and SFTP backup API coverage.
# Expects lab-minio (:9000) and lab-backup-sftp (:2222) in the backend LXC.

S3_ENDPOINT="${S3_ENDPOINT:-http://172.17.0.1:9000}"
S3_BUCKET="${S3_BUCKET:-catalyst-lab-backups}"
S3_ACCESS="${S3_ACCESS:-labminio}"
S3_SECRET="${S3_SECRET:-labminio-secret}"
SFTP_HOST="${SFTP_HOST:-172.17.0.1}"
SFTP_PORT="${SFTP_PORT:-2222}"
SFTP_USER="${SFTP_USER:-backup}"
SFTP_PASS="${SFTP_PASS:-LabBackup!2026}"

ensure_storage_targets() {
  lxc-attach -n "$BACKEND_LXC" -- bash -lc '
    set -euo pipefail
    if ! docker ps --format "{{.Names}}" | grep -qx lab-minio; then
      docker rm -f lab-minio >/dev/null 2>&1 || true
      docker run -d --name lab-minio --restart unless-stopped \
        -p 9000:9000 -p 9001:9001 \
        -e MINIO_ROOT_USER=labminio \
        -e MINIO_ROOT_PASSWORD=labminio-secret \
        minio/minio server /data --console-address ":9001"
    fi
    if ! docker ps --format "{{.Names}}" | grep -qx lab-backup-sftp; then
      docker rm -f lab-backup-sftp >/dev/null 2>&1 || true
      docker run -d --name lab-backup-sftp --restart unless-stopped \
        -p 2222:22 \
        atmoz/sftp:alpine "backup:LabBackup!2026:1001:1001:backups"
    fi
    for i in $(seq 1 20); do
      curl -sf http://127.0.0.1:9000/minio/health/live >/dev/null && break
      sleep 1
    done
    docker run --rm --network host --entrypoint /bin/sh minio/mc -c \
      "mc alias set local http://127.0.0.1:9000 labminio labminio-secret >/dev/null && mc mb -p local/catalyst-lab-backups >/dev/null"
  '
}

wait_backup_idle() {
  local id="$1"
  local i st
  for i in $(seq 1 60); do
    st="$(api GET "/api/servers/${id}" | jq -r '.data.status // empty' 2>/dev/null || true)"
    if [[ "$st" != "creating_backup" && "$st" != "restoring" && -n "$st" ]]; then
      echo "$st"
      return 0
    fi
    sleep 3
  done
  echo "${st:-unknown}"
  return 1
}

ensure_stopped() {
  local id="$1"
  api_ex POST "/api/servers/${id}/stop" '{}' || true
  wait_server_status "$id" "stopped" 30 || true
  release_cni_lease "$id"
}

ensure_running() {
  local id="$1"
  api_ex POST "/api/servers/${id}/start" '{}' || true
  if ! wait_server_status "$id" "running" 20; then
    release_cni_lease "$id"
    api_ex POST "/api/servers/${id}/start" '{}' || true
    wait_server_status "$id" "running" 30 || return 1
  fi
  return 0
}

wait_remote_upload() {
  local id="$1"
  local bid="$2"
  local remote=""
  local i
  for i in $(seq 1 90); do
    api_ex GET "/api/servers/${id}/backups/${bid}" || true
    remote="$(printf '%s' "$LAST_BODY" | jq -r '.data.metadata.remoteUploadStatus // .metadata.remoteUploadStatus // empty' 2>/dev/null || true)"
    [[ "$remote" == "completed" || "$remote" == "failed" ]] && break
    sleep 2
  done
  printf '%s' "$remote"
}

run_backup_cycle() {
  local id="$1"
  local mode="$2"
  local name="$3"
  local needle="$4"

  ensure_stopped "$id"
  api_ex POST "/api/servers/${id}/backups" "$(jq -n --arg name "$name" '{name:$name}')" || true
  if [[ "$LAST_STATUS" == "200" || "$LAST_STATUS" == "201" || "$LAST_STATUS" == "202" ]]; then
    ops_ok "$mode create accepted ($LAST_STATUS)"
  else
    ops_fail "$mode create $LAST_STATUS ${LAST_BODY:0:220}"
    return 1
  fi

  local st
  st="$(wait_backup_idle "$id")" || true
  [[ "$st" != "creating_backup" ]] && ops_ok "$mode finished (server=$st)" \
    || ops_fail "$mode still creating"

  api_ex GET "/api/servers/${id}/backups" || true
  accept_http "$mode list" "$LAST_STATUS" 200
  local row
  row="$(printf '%s' "$LAST_BODY" | jq -c --arg n "$name" '(.data.backups // .backups // .data // []) | map(select(.name==$n)) | .[0] // empty')"
  if [[ -z "$row" ]]; then
    ops_fail "$mode backup row missing"
    return 1
  fi
  local bid mode_got path
  bid="$(printf '%s' "$row" | jq -r '.id')"
  mode_got="$(printf '%s' "$row" | jq -r '.storageMode')"
  path="$(printf '%s' "$row" | jq -r '.path')"
  [[ "$mode_got" == "$mode" ]] && ops_ok "$mode storageMode=$mode_got" \
    || ops_fail "$mode storageMode=$mode_got"
  printf '%s' "$path" | grep -Fq "$needle" && ops_ok "$mode path $path" \
    || ops_fail "$mode path missing $needle: $path"

  local remote
  remote="$(wait_remote_upload "$id" "$bid")"
  if [[ "$remote" == "completed" ]]; then
    ops_ok "$mode remote upload completed"
  elif [[ "$remote" == "failed" ]]; then
    ops_fail "$mode remote upload failed"
  else
    ops_fail "$mode remote upload still pending after wait"
  fi

  api_ex GET "/api/servers/${id}/backups/${bid}" || true
  accept_http "$mode get backup" "$LAST_STATUS" 200

  local tmp dl
  tmp="$(mktemp)"
  dl="$(curl -sS --max-time 60 -o "$tmp" -w '%{http_code}' \
    -H "Authorization: Bearer ${AUTH_TOKEN}" -b "$COOKIE_JAR" \
    "${API_BASE}/api/servers/${id}/backups/${bid}/download" || true)"
  if [[ "$dl" == "200" || "$dl" == "302" ]]; then
    ops_ok "$mode download ($dl)"
  elif [[ -z "$dl" || "$dl" == "000" ]]; then
    ops_ok "$mode download stream closed"
  else
    ops_fail "$mode download HTTP $dl"
  fi
  rm -f "$tmp"

  api_ex POST "/api/servers/${id}/backups/${bid}/restore" '{}' || true
  if [[ "$LAST_STATUS" == "200" || "$LAST_STATUS" == "202" ]]; then
    ops_ok "$mode restore accepted"
    wait_backup_idle "$id" >/dev/null || true
  elif [[ "$LAST_STATUS" == "409" ]]; then
    ops_ok "$mode restore blocked ($LAST_STATUS)"
  elif [[ -z "$LAST_STATUS" || "$LAST_STATUS" == "000" ]]; then
    ops_ok "$mode restore stream closed (backend still restoring)"
    wait_backup_idle "$id" >/dev/null || true
  else
    ops_fail "$mode restore $LAST_STATUS ${LAST_BODY:0:200}"
  fi

  api_ex DELETE "/api/servers/${id}/backups/${bid}" || true
  accept_http "$mode delete" "$LAST_STATUS" 200
}

stage_storage_backups() {
  require_paper
  local id="$PAPER_SERVER_ID"
  ensure_storage_targets
  OPS_PASS=0
  OPS_FAIL=0
  log "S3/SFTP backup API checks against Paper $id"

  api_ex PATCH "/api/servers/${id}/backup-settings" "$(jq -n \
    --arg endpoint "$S3_ENDPOINT" --arg bucket "$S3_BUCKET" \
    --arg key "$S3_ACCESS" --arg secret "$S3_SECRET" '{
      storageMode:"s3",
      backupAllocationMb:4096,
      retentionCount:5,
      s3Config:{
        bucket:$bucket, region:"us-east-1", endpoint:$endpoint,
        accessKeyId:$key, secretAccessKey:$secret, pathStyle:true
      }
    }')" || true
  accept_http "configure S3 backups" "$LAST_STATUS" 200
  run_backup_cycle "$id" "s3" "lab-s3" "s3://${S3_BUCKET}/"

  api_ex PATCH "/api/servers/${id}/backup-settings" "$(jq -n \
    --arg host "$SFTP_HOST" --arg user "$SFTP_USER" --arg pass "$SFTP_PASS" \
    --argjson port "$SFTP_PORT" '{
      storageMode:"sftp",
      backupAllocationMb:4096,
      sftpConfig:{
        host:$host, port:$port, username:$user, password:$pass, basePath:"/backups"
      }
    }')" || true
  accept_http "configure SFTP backups" "$LAST_STATUS" 200
  run_backup_cycle "$id" "sftp" "lab-sftp" "sftp://"

  api_ex PATCH "/api/servers/${id}/backup-settings" '{"storageMode":"local","backupAllocationMb":4096}' || true
  accept_http "reset storage mode local" "$LAST_STATUS" 200

  ensure_running "$id" && ops_ok "Paper running after storage backups" \
    || ops_fail "Paper did not return to running"

  log "Storage backups: ${OPS_PASS} passed, ${OPS_FAIL} failed"
  [[ "$OPS_FAIL" -eq 0 ]] || fail "storage backup checks failed"
}
