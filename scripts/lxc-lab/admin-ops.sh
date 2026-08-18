# Admin + panel management APIs. Sourced after server-apis.sh.

stage_admin() {
  require_paper
  local id="$PAPER_SERVER_ID"
  local node="${NODE_ID:-}"
  local loc="${LOCATION_ID:-}"
  local nest="${MINECRAFT_NEST_ID:-}"
  local tmpl="${PAPER_TEMPLATE_ID:-}"
  local admin_id="" lab_user="" lab_role="" lab_loc="" lab_nest="" key_id="" clone="" alloc_id=""
  OPS_PASS=0
  OPS_FAIL=0
  log "Admin management sweep"

  # --- identity ---
  api_ex GET "/api/auth/me"
  accept_http "auth me" "$LAST_STATUS" 200
  admin_id="$(printf '%s' "$LAST_BODY" | jq -r '.data.id // .user.id // .id // empty')"
  api_ex GET "/api/auth/profile"
  accept_http "auth profile" "$LAST_STATUS" 200
  api_ex GET "/api/auth/profile/audit-log"
  accept_http "profile audit log" "$LAST_STATUS" 200
  api_ex GET "/api/auth/profile/api-keys"
  accept_http "profile api keys" "$LAST_STATUS" 200

  # --- dashboard ---
  api_ex GET "/api/dashboard/stats"
  accept_http "dashboard stats" "$LAST_STATUS" 200
  api_ex GET "/api/dashboard/activity?limit=10"
  accept_http "dashboard activity" "$LAST_STATUS" 200
  api_ex GET "/api/dashboard/resources"
  accept_http "dashboard resources" "$LAST_STATUS" 200

  # --- admin overview ---
  api_ex GET "/api/admin/stats"
  accept_http "admin stats" "$LAST_STATUS" 200
  api_ex GET "/api/admin/health"
  accept_http "admin health" "$LAST_STATUS" 200
  api_ex GET "/api/admin/db-status"
  accept_http "admin db-status" "$LAST_STATUS" 200
  api_ex GET "/api/admin/servers"
  accept_http "admin list servers" "$LAST_STATUS" 200
  assert_contains "admin servers include Paper" "$LAST_BODY" "$id"
  api_ex GET "/api/admin/servers?search=Paper&limit=5"
  accept_http "admin search servers" "$LAST_STATUS" 200
  api_ex GET "/api/admin/nodes"
  accept_http "admin list nodes" "$LAST_STATUS" 200
  api_ex GET "/api/admin/audit-logs?limit=20"
  accept_http "admin audit logs" "$LAST_STATUS" 200
  api_ex GET "/api/admin/audit-logs/export"
  accept_http "admin audit export" "$LAST_STATUS" 200
  api_ex GET "/api/admin/system-errors"
  accept_http "admin system errors" "$LAST_STATUS" 200
  api_ex GET "/api/admin/security-settings"
  accept_http "admin security settings" "$LAST_STATUS" 200
  api_ex GET "/api/admin/ip-pools"
  accept_http "admin ip pools" "$LAST_STATUS" 200
  api_ex GET "/api/admin/database-hosts"
  accept_http "admin database hosts" "$LAST_STATUS" 200
  api_ex GET "/api/admin/smtp"
  accept_http "admin smtp" "$LAST_STATUS" 200
  api_ex GET "/api/admin/mod-manager"
  accept_http "admin mod-manager" "$LAST_STATUS" 200
  api_ex GET "/api/admin/dns-settings"
  accept_http "admin dns settings" "$LAST_STATUS" 200
  api_ex GET "/api/admin/theme-settings"
  accept_http "admin theme settings" "$LAST_STATUS" 200
  api_ex GET "/api/admin/auth-lockouts"
  accept_http "admin auth lockouts" "$LAST_STATUS" 200
  api_ex GET "/api/admin/oidc-config"
  accept_http "admin oidc config" "$LAST_STATUS" 200
  api_ex GET "/api/admin/settings/file-tunnel-upload-limit"
  accept_http "file-tunnel upload limit" "$LAST_STATUS" 200
  sse_peek "/api/admin/events" "admin events SSE"

  api_ex GET "/api/admin/migration"
  accept_http "admin migration list" "$LAST_STATUS" 200
  api_ex GET "/api/admin/migration/catalyst-nodes"
  accept_http "admin migration nodes" "$LAST_STATUS" 200
  api_ex POST "/api/admin/migration/test" '{"url":"http://127.0.0.1:1","key":"x"}'
  accept_http "admin migration test bad" "$LAST_STATUS" 400 401 422 500 502 503
  if [[ -n "${PTERO_APP_KEY:-}" && -n "${PTERO_URL:-}" ]]; then
    api_ex POST "/api/admin/migration/test" "$(jq -n --arg url "$PTERO_URL" --arg key "$PTERO_APP_KEY" --arg clientApiKey "${PTERO_CLIENT_KEY:-}" '{url:$url,key:$key,clientApiKey:$clientApiKey}')"
    accept_http "admin migration test live fixture" "$LAST_STATUS" 200
    if [[ "$LAST_STATUS" == "200" ]]; then
      if printf '%s' "$LAST_BODY" | jq -e '.success == true and .stats.nodes >= 1' >/dev/null; then
        ops_ok "live fixture preview has nodes"
      else
        ops_fail "live fixture preview missing nodes: ${LAST_BODY:0:240}"
      fi
      if printf '%s' "$LAST_BODY" | jq -e '.serversList[0].hasAllocation == true' >/dev/null; then
        ops_ok "live fixture server hasAllocation"
      else
        ops_fail "live fixture server missing allocation: ${LAST_BODY:0:240}"
      fi
    fi
  fi
  api_ex GET "/api/admin/update/status"
  accept_http "admin update status" "$LAST_STATUS" 200

  # --- users / roles ---
  api_ex GET "/api/admin/users"
  accept_http "admin list users" "$LAST_STATUS" 200
  api_ex GET "/api/admin/roles"
  accept_http "admin list roles" "$LAST_STATUS" 200
  api_ex GET "/api/roles"
  accept_http "roles list" "$LAST_STATUS" 200
  api_ex GET "/api/roles/presets"
  accept_http "role presets" "$LAST_STATUS" 200

  local stamp
  stamp="$(date +%s)"
  api_ex POST "/api/roles" "$(jq -n --arg n "lab-role-$stamp" '{name:$n,description:"lab",permissions:["server.read"]}')"
  accept_http "create role" "$LAST_STATUS" 200 201
  lab_role="$(printf '%s' "$LAST_BODY" | jq -r '.data.id // .role.id // .id // empty')"
  if [[ -n "$lab_role" && "$lab_role" != "null" ]]; then
    api_ex GET "/api/roles/${lab_role}"
    accept_http "get role" "$LAST_STATUS" 200
    api_ex PUT "/api/roles/${lab_role}" '{"description":"lab updated"}'
    accept_http "update role" "$LAST_STATUS" 200
    api_ex POST "/api/roles/${lab_role}/permissions" '{"permission":"console.read"}'
    accept_http "add role permission" "$LAST_STATUS" 200 201
    api_ex DELETE "/api/roles/${lab_role}/permissions/console.read"
    accept_http "delete role permission" "$LAST_STATUS" 200
    api_ex GET "/api/roles/${lab_role}/nodes"
    accept_http "role nodes" "$LAST_STATUS" 200
  fi

  api_ex POST "/api/admin/users" "$(jq -n \
    --arg email "lab-user-${stamp}@catalyst.local" \
    --arg username "labuser${stamp}" \
    --arg password "LabUser!2026" \
    --arg id "$id" \
    '{email:$email,username:$username,password:$password,serverIds:[$id],serverPermissions:["server.read","console.read"]}')"
  accept_http "create admin user" "$LAST_STATUS" 200 201
  lab_user="$(printf '%s' "$LAST_BODY" | jq -r '.data.id // .user.id // .id // empty')"
  if [[ -n "$lab_user" && "$lab_user" != "null" ]]; then
    api_ex GET "/api/admin/users/${lab_user}/servers"
    accept_http "user servers" "$LAST_STATUS" 200
    api_ex GET "/api/roles/users/${lab_user}/roles"
    accept_http "user roles" "$LAST_STATUS" 200
    api_ex GET "/api/roles/users/${lab_user}/nodes"
    accept_http "user nodes" "$LAST_STATUS" 200
    api_ex PUT "/api/admin/users/${lab_user}" '{"username":"labuser'"${stamp}"'x"}'
    accept_http "update user" "$LAST_STATUS" 200
    api_ex PUT "/api/admin/users/${lab_user}/verify-email" '{}'
    accept_http "verify user email" "$LAST_STATUS" 200
    api_ex PUT "/api/admin/users/${lab_user}/enforce-2fa" '{"enforced":false}'
    accept_http "enforce 2fa false" "$LAST_STATUS" 200
    api_ex DELETE "/api/admin/users/${lab_user}/passkeys"
    accept_http "wipe passkeys" "$LAST_STATUS" 200
    api_ex DELETE "/api/admin/users/${lab_user}/two-factor"
    accept_http "wipe 2fa" "$LAST_STATUS" 200
    api_ex POST "/api/admin/users/${lab_user}/ban" '{"reason":"lab"}'
    accept_http "ban user" "$LAST_STATUS" 200
    api_ex POST "/api/admin/users/${lab_user}/unban" '{}'
    accept_http "unban user" "$LAST_STATUS" 200
    if [[ -n "$lab_role" && "$lab_role" != "null" ]]; then
      api_ex POST "/api/roles/${lab_role}/users/${lab_user}" '{}'
      accept_http "assign role" "$LAST_STATUS" 200
      api_ex DELETE "/api/roles/${lab_role}/users/${lab_user}"
      accept_http "unassign role" "$LAST_STATUS" 200
    fi
    api_ex POST "/api/servers/${id}/access" \
      "$(jq -n --arg uid "$lab_user" '{targetUserId:$uid,permissions:["server.read"]}')"
    accept_http "grant server access" "$LAST_STATUS" 200 201 409
    api_ex DELETE "/api/servers/${id}/access/${lab_user}"
    accept_http "revoke server access" "$LAST_STATUS" 200 404
  fi

  # --- api keys ---
  api_ex GET "/api/admin/api-keys/permissions-catalog"
  accept_http "api key catalog" "$LAST_STATUS" 200
  api_ex GET "/api/admin/api-keys/my-permissions"
  accept_http "api key my-permissions" "$LAST_STATUS" 200
  api_ex GET "/api/admin/api-keys"
  accept_http "list api keys" "$LAST_STATUS" 200
  api_ex POST "/api/admin/api-keys" '{"name":"lab-key","permissions":["server.read"],"expiresIn":3600}'
  accept_http "create api key" "$LAST_STATUS" 200 201
  key_id="$(printf '%s' "$LAST_BODY" | jq -r '.data.id // .id // empty')"
  if [[ -n "$key_id" && "$key_id" != "null" ]]; then
    api_ex GET "/api/admin/api-keys/${key_id}"
    accept_http "get api key" "$LAST_STATUS" 200
    api_ex GET "/api/admin/api-keys/${key_id}/usage"
    accept_http "api key usage" "$LAST_STATUS" 200
    api_ex PATCH "/api/admin/api-keys/${key_id}" '{"enabled":false}'
    accept_http "disable api key" "$LAST_STATUS" 200
    api_ex DELETE "/api/admin/api-keys/${key_id}"
    accept_http "delete api key" "$LAST_STATUS" 200
  fi

  # --- locations / nests / templates ---
  api_ex GET "/api/locations"
  accept_http "list locations" "$LAST_STATUS" 200
  if [[ -n "$loc" ]]; then
    api_ex GET "/api/locations/${loc}"
    accept_http "get location" "$LAST_STATUS" 200
  fi
  api_ex POST "/api/locations" "$(jq -n --arg n "Lab Loc $stamp" '{name:$n,description:"lab"}')"
  accept_http "create location" "$LAST_STATUS" 200 201
  lab_loc="$(printf '%s' "$LAST_BODY" | jq -r '.data.id // .id // empty')"
  if [[ -n "$lab_loc" && "$lab_loc" != "null" ]]; then
    api_ex PUT "/api/locations/${lab_loc}" '{"description":"lab loc updated"}'
    accept_http "update location" "$LAST_STATUS" 200
    api_ex DELETE "/api/locations/${lab_loc}"
    accept_http "delete location" "$LAST_STATUS" 200
  fi

  api_ex GET "/api/nests"
  accept_http "list nests" "$LAST_STATUS" 200
  if [[ -n "$nest" ]]; then
    api_ex GET "/api/nests/${nest}"
    accept_http "get nest" "$LAST_STATUS" 200
  fi
  api_ex POST "/api/nests" "$(jq -n --arg n "Lab Nest $stamp" '{name:$n,description:"lab"}')"
  accept_http "create nest" "$LAST_STATUS" 200 201
  lab_nest="$(printf '%s' "$LAST_BODY" | jq -r '.data.id // .id // empty')"
  if [[ -n "$lab_nest" && "$lab_nest" != "null" ]]; then
    api_ex PUT "/api/nests/${lab_nest}" '{"description":"lab nest updated"}'
    accept_http "update nest" "$LAST_STATUS" 200
    api_ex DELETE "/api/nests/${lab_nest}"
    accept_http "delete nest" "$LAST_STATUS" 200
  fi

  api_ex GET "/api/templates"
  accept_http "list templates" "$LAST_STATUS" 200
  if [[ -n "$tmpl" ]]; then
    api_ex GET "/api/templates/${tmpl}"
    accept_http "get paper template" "$LAST_STATUS" 200
  fi
  api_ex POST "/api/templates" '{"name":""}'
  accept_http "create template missing fields" "$LAST_STATUS" 400 422 500

  # --- nodes ---
  api_ex GET "/api/nodes"
  accept_http "list nodes" "$LAST_STATUS" 200
  api_ex GET "/api/nodes/accessible"
  accept_http "accessible nodes" "$LAST_STATUS" 200
  if [[ -n "$node" ]]; then
    api_ex GET "/api/nodes/${node}"
    accept_http "get node" "$LAST_STATUS" 200
    api_ex GET "/api/nodes/${node}/stats"
    accept_http "node stats" "$LAST_STATUS" 200
    api_ex GET "/api/nodes/${node}/api-key"
    accept_http "node api-key exists" "$LAST_STATUS" 200
    api_ex GET "/api/nodes/${node}/allocations"
    accept_http "node allocations" "$LAST_STATUS" 200
    api_ex GET "/api/nodes/${node}/assignments"
    accept_http "node assignments" "$LAST_STATUS" 200
    api_ex GET "/api/nodes/${node}/ip-pools"
    accept_http "node ip-pools" "$LAST_STATUS" 200
    api_ex GET "/api/nodes/${node}/ip-availability"
    accept_http "node ip-availability" "$LAST_STATUS" 200 400
    api_ex POST "/api/nodes/${node}/allocations" '{"ip":"0.0.0.0","ports":"39999"}'
    accept_http "add node allocation" "$LAST_STATUS" 200 201 400 403 409
    if [[ "$LAST_STATUS" == "200" || "$LAST_STATUS" == "201" ]]; then
      alloc_id="$(printf '%s' "$LAST_BODY" | jq -r '[.. | objects | select(has("id") and ((.port==39999) or (.hostPort==39999)))] | .[0].id // empty' 2>/dev/null || true)"
      if [[ -z "$alloc_id" || "$alloc_id" == "null" ]]; then
        api_ex GET "/api/nodes/${node}/allocations"
        alloc_id="$(printf '%s' "$LAST_BODY" | jq -r '[.. | objects | select(has("id") and ((.port==39999) or (.hostPort==39999)))] | .[0].id // empty' 2>/dev/null || true)"
      fi
      if [[ -n "$alloc_id" && "$alloc_id" != "null" ]]; then
        api_ex PATCH "/api/nodes/${node}/allocations/${alloc_id}" '{"notes":"lab"}'
        accept_http "patch node allocation" "$LAST_STATUS" 200
        api_ex DELETE "/api/nodes/${node}/allocations/${alloc_id}"
        accept_http "delete node allocation" "$LAST_STATUS" 200
      fi
    fi
    api_ex POST "/api/nodes/${node}/deployment-token" '{}'
    accept_http "node deploy token" "$LAST_STATUS" 200 201
  fi

  # --- plugins ---
  api_ex GET "/api/plugins"
  accept_http "list plugins" "$LAST_STATUS" 200

  # --- admin bulk server actions on a clone ---
  api_ex POST "/api/servers/${id}/clone" "$(jq -n --arg n "Lab Admin Clone $stamp" '{name:$n,copyFiles:false}')"
  accept_http "clone for admin actions" "$LAST_STATUS" 200 201 409
  clone="$(printf '%s' "$LAST_BODY" | jq -r '.data.id // empty')"
  if [[ -n "$clone" && "$clone" != "null" ]]; then
    api_ex POST "/api/admin/servers/actions" \
      "$(jq -n --arg id "$clone" '{serverIds:[$id],action:"suspend",reason:"lab admin"}')"
    accept_http "admin suspend action" "$LAST_STATUS" 200
    api_ex POST "/api/admin/servers/actions" \
      "$(jq -n --arg id "$clone" '{serverIds:[$id],action:"unsuspend"}')"
    accept_http "admin unsuspend action" "$LAST_STATUS" 200
    api_ex POST "/api/admin/servers/actions" \
      "$(jq -n --arg id "$clone" '{serverIds:[$id],action:"delete"}')"
    accept_http "admin delete action" "$LAST_STATUS" 200
    if [[ "$LAST_STATUS" != "200" ]]; then
      cleanup_clone "$clone"
    fi
    clone=""
  fi
  api_ex POST "/api/admin/servers/actions" '{"serverIds":[],"action":"start"}'
  accept_http "admin action empty ids" "$LAST_STATUS" 400

  # --- leftover backup delete ---
  api_ex GET "/api/servers/${id}/backups"
  local backup_id
  backup_id="$(printf '%s' "$LAST_BODY" | jq -r '.backups[0].id // .data[0].id // empty')"
  if [[ -n "$backup_id" && "$backup_id" != "null" ]]; then
    api_ex DELETE "/api/servers/${id}/backups/${backup_id}"
    accept_http "delete backup" "$LAST_STATUS" 200
  fi

  # cleanup disposable user/role
  if [[ -n "$lab_user" && "$lab_user" != "null" ]]; then
    api_ex POST "/api/admin/users/${lab_user}/delete" '{}'
    accept_http "delete lab user" "$LAST_STATUS" 200
  fi
  if [[ -n "$lab_role" && "$lab_role" != "null" ]]; then
    api_ex DELETE "/api/roles/${lab_role}"
    accept_http "delete lab role" "$LAST_STATUS" 200
  fi

  api_ex GET "/api/servers/${id}"
  assert_http "paper still present after admin sweep" 200 "$LAST_STATUS" "$LAST_BODY"

  log "Admin APIs: ${OPS_PASS} passed, ${OPS_FAIL} failed"
  [[ "$OPS_FAIL" -eq 0 ]] || fail "admin API sweep failed"
}
