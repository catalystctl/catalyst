# Remaining public/admin/auth/node routes not covered by other stages.

stage_everything() {
  require_paper
  local id="$PAPER_SERVER_ID"
  local node="${NODE_ID:-}"
  local admin_id="" host_id="" pool_id="" assign_id="" extra_user=""
  OPS_PASS=0
  OPS_FAIL=0
  log "Catch-all remaining API sweep"

  api_ex GET "/health"
  accept_http "backend /health" "$LAST_STATUS" 200
  api_ex GET "/api/health"
  accept_http "backend /api/health" "$LAST_STATUS" 200 404
  api_ex GET "/api/setup/status"
  accept_http "setup status" "$LAST_STATUS" 200
  api_ex GET "/api/agent/version"
  accept_http "agent version" "$LAST_STATUS" 200
  api_ex GET "/api/agent/deploy-script"
  accept_http "agent deploy-script" "$LAST_STATUS" 200
  api_ex GET "/api/agent/download-checksum"
  accept_http "agent checksum" "$LAST_STATUS" 200 404
  api_ex GET "/api/update/check"
  accept_http "public update check" "$LAST_STATUS" 200
  api_ex GET "/api/theme-settings/public"
  accept_http "public theme settings" "$LAST_STATUS" 200
  api_ex POST "/api/system-errors/report" '{"message":"lab report","component":"lxc-lab"}'
  accept_http "report system error" "$LAST_STATUS" 200 201 400

  api_ex GET "/api/auth/me"
  accept_http "auth me" "$LAST_STATUS" 200
  admin_id="$(printf '%s' "$LAST_BODY" | jq -r '.data.id // .user.id // .id // empty')"
  api_ex GET "/api/auth/profile/export"
  accept_http "gdpr export" "$LAST_STATUS" 200
  api_ex PATCH "/api/auth/profile" '{"firstName":"Lab"}'
  accept_http "patch profile" "$LAST_STATUS" 200
  api_ex PATCH "/api/auth/profile/preferences" '{"labSweep":true}'
  accept_http "patch preferences" "$LAST_STATUS" 200
  api_ex DELETE "/api/auth/profile/avatar"
  accept_http "delete avatar" "$LAST_STATUS" 200 404
  api_ex POST "/api/auth/profile/sso/unlink" '{"provider":"missing"}'
  accept_http "sso unlink missing" "$LAST_STATUS" 400 404
  api_ex POST "/api/auth/forgot-password" "$(jq -n --arg email "${ADMIN_EMAIL}" '{email:$email}')"
  accept_http "forgot password" "$LAST_STATUS" 200 202
  api_ex POST "/api/auth/reset-password/validate" '{"token":"not-a-real-token"}'
  accept_http "reset token invalid" "$LAST_STATUS" 200 400 404
  api_ex POST "/api/auth/register" '{"email":"x","username":"x","password":"short"}'
  accept_http "register invalid" "$LAST_STATUS" 400 403 409 422
  api_ex POST "/api/auth/profile/delete" '{}'
  accept_http "admin cannot self-delete" "$LAST_STATUS" 400 403 409

  api_ex GET "/api/sftp/connection-info?serverId=${id}"
  accept_http "sftp info" "$LAST_STATUS" 200
  if [[ -n "$admin_id" && "$admin_id" != "null" ]]; then
    api_ex DELETE "/api/sftp/tokens/${admin_id}?serverId=${id}"
    accept_http "revoke own sftp token" "$LAST_STATUS" 200 404
  fi
  api_ex DELETE "/api/sftp/tokens?serverId=${id}"
  accept_http "revoke all sftp tokens" "$LAST_STATUS" 200

  api_ex POST "/api/servers/invites/accept" '{"token":"missing"}'
  accept_http "accept missing invite" "$LAST_STATUS" 400 404
  api_ex GET "/api/servers/invites/missing-token"
  accept_http "preview missing invite" "$LAST_STATUS" 400 404
  api_ex POST "/api/servers/invites/register" '{"token":"missing","email":"a@b.c","username":"x","password":"LabUser!2026"}'
  accept_http "register via missing invite" "$LAST_STATUS" 400 404

  api_ex GET "/api/alert-rules/missing"
  accept_http "get missing alert rule" "$LAST_STATUS" 404
  api_ex GET "/api/alerts/missing"
  accept_http "get missing alert" "$LAST_STATUS" 404
  api_ex GET "/api/alerts/missing/deliveries"
  accept_http "alert deliveries missing" "$LAST_STATUS" 404
  api_ex POST "/api/alerts/missing/resolve" '{}'
  accept_http "resolve missing alert" "$LAST_STATUS" 404
  api_ex POST "/api/alerts/bulk-resolve" '{"alertIds":[]}'
  accept_http "bulk-resolve empty" "$LAST_STATUS" 200 400

  api_ex GET "/api/plugins"
  accept_http "list plugins" "$LAST_STATUS" 200
  local pname
  pname="$(printf '%s' "$LAST_BODY" | jq -r '.data[0].name // .plugins[0].name // empty')"
  if [[ -n "$pname" && "$pname" != "null" ]]; then
    api_ex GET "/api/plugins/${pname}"
    accept_http "get plugin" "$LAST_STATUS" 200
    api_ex GET "/api/plugins/${pname}/frontend-manifest"
    accept_http "plugin manifest" "$LAST_STATUS" 200 404
  fi
  api_ex GET "/api/plugins/does-not-exist"
  accept_http "missing plugin" "$LAST_STATUS" 404
  api_ex POST "/api/plugins/does-not-exist/enable" '{"enabled":false}'
  accept_http "enable missing plugin" "$LAST_STATUS" 400 404
  api_ex POST "/api/plugins/does-not-exist/reload" '{}'
  accept_http "reload missing plugin" "$LAST_STATUS" 400 404
  api_ex PUT "/api/plugins/does-not-exist/config" '{}'
  accept_http "config missing plugin" "$LAST_STATUS" 400 404 500

  api_ex GET "/api/admin/security-settings"
  accept_http "get security settings" "$LAST_STATUS" 200
  if [[ "$LAST_STATUS" == "200" ]]; then
    api_ex PUT "/api/admin/security-settings" "$LAST_BODY"
    accept_http "put security settings echo" "$LAST_STATUS" 200 400
  fi
  api_ex GET "/api/admin/theme-settings"
  accept_http "get theme settings" "$LAST_STATUS" 200
  if [[ "$LAST_STATUS" == "200" ]]; then
    local theme
    theme="$(printf '%s' "$LAST_BODY" | jq -c '.data // .settings // {}')"
    api_ex PATCH "/api/admin/theme-settings" "$theme"
    accept_http "patch theme echo" "$LAST_STATUS" 200 400
  fi
  api_ex GET "/api/admin/mod-manager"
  accept_http "get mod-manager" "$LAST_STATUS" 200
  if [[ "$LAST_STATUS" == "200" ]]; then
    api_ex PUT "/api/admin/mod-manager" "$(printf '%s' "$LAST_BODY" | jq -c '.data // .')"
    accept_http "put mod-manager echo" "$LAST_STATUS" 200 400
  fi
  api_ex GET "/api/admin/dns-settings"
  accept_http "get dns settings" "$LAST_STATUS" 200
  api_ex GET "/api/admin/oidc-config"
  accept_http "get oidc" "$LAST_STATUS" 200
  api_ex GET "/api/admin/smtp"
  accept_http "get smtp" "$LAST_STATUS" 200

  api_ex GET "/api/admin/system-errors"
  accept_http "list system errors" "$LAST_STATUS" 200
  local err_id
  err_id="$(printf '%s' "$LAST_BODY" | jq -r '[.data[]?,.errors[]?] | map(select(.resolvedAt==null or .resolved==false or .resolved==null)) | .[0].id // empty')"
  if [[ -n "$err_id" && "$err_id" != "null" ]]; then
    api_ex POST "/api/admin/system-errors/${err_id}/resolve" '{}'
    accept_http "resolve system error" "$LAST_STATUS" 200
  else
    api_ex POST "/api/admin/system-errors/missing/resolve" '{}'
    accept_http "resolve missing system error" "$LAST_STATUS" 404
  fi
  api_ex DELETE "/api/admin/auth-lockouts/missing"
  accept_http "delete missing lockout" "$LAST_STATUS" 404
  api_ex DELETE "/api/admin/users/${admin_id:-x}/accounts/missing"
  accept_http "unlink missing sso account" "$LAST_STATUS" 400 404

  api_ex POST "/api/admin/database-hosts" '{"name":"x"}'
  accept_http "db host missing fields" "$LAST_STATUS" 400
  api_ex POST "/api/admin/database-hosts" "$(jq -n '{
    name:"Lab PG",
    host:"127.0.0.1",
    port:5432,
    username:"lab",
    password:"lab",
    engine:"postgresql",
    database:"postgres"
  }')"
  accept_http "create db host" "$LAST_STATUS" 200 201
  host_id="$(printf '%s' "$LAST_BODY" | jq -r '.data.id // .id // empty')"
  if [[ -n "$host_id" && "$host_id" != "null" ]]; then
    api_ex PUT "/api/admin/database-hosts/${host_id}" '{"name":"Lab PG2"}'
    accept_http "update db host" "$LAST_STATUS" 200
    api_ex GET "/api/admin/database-hosts/${host_id}/ping"
    accept_http "ping db host" "$LAST_STATUS" 200 400 502 503
    api_ex DELETE "/api/admin/database-hosts/${host_id}"
    accept_http "delete db host" "$LAST_STATUS" 200
  fi

  if [[ -n "$node" ]]; then
    api_ex POST "/api/admin/ip-pools" '{"nodeId":"missing","networkName":"lab","cidr":"10.99.0.0/24"}'
    accept_http "ip pool missing node" "$LAST_STATUS" 404
    api_ex POST "/api/admin/ip-pools" "$(jq -n --arg nodeId "$node" '{
      nodeId:$nodeId,networkName:"lab-sweep",cidr:"10.99.50.0/24",gateway:"10.99.50.1"
    }')"
    accept_http "create ip pool" "$LAST_STATUS" 200 201 409
    pool_id="$(printf '%s' "$LAST_BODY" | jq -r '.data.id // .id // empty')"
    if [[ -n "$pool_id" && "$pool_id" != "null" ]]; then
      api_ex PUT "/api/admin/ip-pools/${pool_id}" '{"gateway":"10.99.50.1"}'
      accept_http "update ip pool" "$LAST_STATUS" 200
      api_ex DELETE "/api/admin/ip-pools/${pool_id}"
      accept_http "delete ip pool" "$LAST_STATUS" 200
    fi
  fi

  if [[ -n "$node" ]]; then
    api_ex GET "/api/nodes/${node}"
    accept_http "get node" "$LAST_STATUS" 200
    local nname
    nname="$(printf '%s' "$LAST_BODY" | jq -r '.data.name // empty')"
    if [[ -n "$nname" && "$nname" != "null" ]]; then
      api_ex PUT "/api/nodes/${node}" "$(jq -n --arg name "$nname" '{name:$name}')"
      accept_http "put node name echo" "$LAST_STATUS" 200
    fi
    api_ex POST "/api/nodes/${node}/heartbeat" '{}'
    accept_http "node heartbeat unauth" "$LAST_STATUS" 400 401 403
    api_ex DELETE "/api/nodes/missing-node"
    accept_http "delete missing node" "$LAST_STATUS" 404

    local stamp
    stamp="$(date +%s)"
    api_ex POST "/api/admin/users" "$(jq -n --arg email "sweep-${stamp}@catalyst.local" --arg username "sweep${stamp}" '{email:$email,username:$username,password:"LabUser!2026"}')"
    accept_http "create sweep user" "$LAST_STATUS" 200 201
    extra_user="$(printf '%s' "$LAST_BODY" | jq -r '.data.id // .user.id // .id // empty')"
    if [[ -n "$extra_user" && "$extra_user" != "null" ]]; then
      api_ex POST "/api/nodes/${node}/assign" "$(jq -n --arg targetId "$extra_user" '{targetType:"user",targetId:$targetId}')"
      accept_http "assign node to user" "$LAST_STATUS" 200 201
      api_ex GET "/api/nodes/${node}/assignments"
      accept_http "list assignments" "$LAST_STATUS" 200
      assign_id="$(printf '%s' "$LAST_BODY" | jq -r --arg uid "$extra_user" '[.. | objects | select(.userId==$uid or .user.id==$uid)] | .[0].id // empty' 2>/dev/null || true)"
      if [[ -n "$assign_id" && "$assign_id" != "null" ]]; then
        api_ex DELETE "/api/nodes/${node}/assignments/${assign_id}"
        accept_http "unassign node" "$LAST_STATUS" 200
      fi
      api_ex POST "/api/admin/users/${extra_user}/delete" '{}'
      accept_http "delete sweep user" "$LAST_STATUS" 200
    fi
  fi

  api_ex POST "/api/templates/import-pterodactyl" '{}'
  accept_http "import egg missing" "$LAST_STATUS" 400 422
  api_ex GET "/api/admin/migration/missing-job"
  accept_http "migration missing job" "$LAST_STATUS" 404
  api_ex GET "/api/admin/migration/missing-job/steps"
  accept_http "migration missing steps" "$LAST_STATUS" 200 404
  api_ex POST "/api/admin/migration/missing-job/pause" '{}'
  accept_http "migration pause missing" "$LAST_STATUS" 400 404 500
  api_ex POST "/api/admin/migration/missing-job/resume" '{}'
  accept_http "migration resume missing" "$LAST_STATUS" 400 404 500
  api_ex POST "/api/admin/migration/missing-job/cancel" '{}'
  accept_http "migration cancel missing" "$LAST_STATUS" 400 404 500
  api_ex POST "/api/admin/migration/missing-job/retry/missing-step" '{}'
  accept_http "migration retry missing" "$LAST_STATUS" 404
  api_ex POST "/api/admin/migration/start" '{}'
  accept_http "migration start missing fields" "$LAST_STATUS" 400 422

  api_ex DELETE "/api/servers/bulk" '{"serverIds":[]}'
  accept_http "bulk delete empty" "$LAST_STATUS" 400
  api_ex GET "/docs"
  accept_http "swagger ui" "$LAST_STATUS" 200 301 302
  api_ex GET "/docs/json"
  accept_http "openapi json" "$LAST_STATUS" 200 404

  api_ex GET "/api/servers/${id}"
  assert_http "paper still present after everything" 200 "$LAST_STATUS" "$LAST_BODY"

  log "Everything leftover: ${OPS_PASS} passed, ${OPS_FAIL} failed"
  [[ "$OPS_FAIL" -eq 0 ]] || fail "everything leftover checks failed"
}

stage_full() {
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
  stage_live
  stage_status
}
