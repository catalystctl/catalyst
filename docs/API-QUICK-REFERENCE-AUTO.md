# Catalyst API Quick Reference

> Auto-generated on 2026-04-17

## Authentication

```bash
export API_KEY="your_catalyst_api_key_here"

# All requests
curl -H "x-api-key: $API_KEY" http://localhost:3000/api/endpoint
```

---

## Server Management

### List Servers
```bash
curl -H "x-api-key: $API_KEY" http://localhost:3000/api/servers
```

### Create Server
```bash
curl -X POST http://localhost:3000/api/servers \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{
    "name": "My Server",
    "templateId": "template-id",
    "nodeId": "node-id",
    "locationId": "location-id",
    "allocatedMemoryMb": 4096,
    "allocatedCpuCores": 2,
    "allocatedDiskMb": 10240,
    "primaryPort": 25565
  }'
```

### Server Power Actions
```bash
# Start
curl -X POST http://localhost:3000/api/servers/:serverId/start \
  -H "x-api-key: $API_KEY"

# Stop
curl -X POST http://localhost:3000/api/servers/:serverId/stop \
  -H "x-api-key: $API_KEY"

# Restart
curl -X POST http://localhost:3000/api/servers/:serverId/restart \
  -H "x-api-key: $API_KEY"
```

### Suspend/Unsuspend
```bash
# Suspend (for non-payment)
curl -X POST http://localhost:3000/api/servers/:serverId/suspend \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"reason": "Payment overdue", "stopServer": true}'

# Unsuspend
curl -X POST http://localhost:3000/api/servers/:serverId/unsuspend \
  -H "x-api-key: $API_KEY"
```

---

## Node Management

### List Nodes
```bash
curl -H "x-api-key: $API_KEY" http://localhost:3000/api/nodes
```

### Create Node
```bash
curl -X POST http://localhost:3000/api/nodes \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{
    "name": "Node 1",
    "fqdn": "node1.example.com",
    "publicAddress": "1.2.3.4",
    "memoryMb": 32768,
    "cpuCores": 8,
    "diskMb": 512000
  }'
```

---

## Templates

### List Templates
```bash
curl -H "x-api-key: $API_KEY" http://localhost:3000/api/templates
```

### Create Template
```bash
curl -X POST http://localhost:3000/api/templates \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{
    "name": "Minecraft",
    "nestId": "nest-id",
    "description": "Minecraft Java server"
  }'
```

---

## User Management

### List Users
```bash
curl -H "x-api-key: $API_KEY" http://localhost:3000/api/admin/users
```

### Create User
```bash
curl -X POST http://localhost:3000/api/admin/users \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{
    "email": "user@example.com",
    "username": "username",
    "password": "SecureP@ss123!"
  }'
```

---

## Backups

### Create Backup
```bash
curl -X POST http://localhost:3000/api/servers/:serverId/backups \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"name": "My Backup"}'
```

### List Backups
```bash
curl -H "x-api-key: $API_KEY" \
  http://localhost:3000/api/servers/:serverId/backups
```

### Restore Backup
```bash
curl -X POST \
  http://localhost:3000/api/servers/:serverId/backups/:backupId/restore \
  -H "x-api-key: $API_KEY"
```

---

## Error Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Not Found |
| 409 | Conflict |
| 429 | Rate Limited |
| 500 | Server Error |

---

## All Endpoints


### Admin events

`GET    /api/admin/events/`


### Admin

`GET    /api/admin/stats`
`GET    /api/admin/users`
`POST   /api/admin/users`
`PUT    /api/admin/users/:userId`
`GET    /api/admin/users/:userId/servers`
`GET    /api/admin/roles`
`POST   /api/admin/users/:userId/delete`
`GET    /api/admin/nodes`
`GET    /api/admin/servers`
`POST   /api/admin/servers/actions`
`GET    /api/admin/audit-logs`
`GET    /api/admin/audit-logs/export`
`GET    /api/admin/security-settings`
`PUT    /api/admin/security-settings`
`GET    /api/admin/health`
`GET    /api/admin/ip-pools`
`POST   /api/admin/ip-pools`
`PUT    /api/admin/ip-pools/:poolId`
`DELETE /api/admin/ip-pools/:poolId`
`GET    /api/admin/database-hosts`
`POST   /api/admin/database-hosts`
`PUT    /api/admin/database-hosts/:hostId`
`DELETE /api/admin/database-hosts/:hostId`
`GET    /api/admin/smtp`
`PUT    /api/admin/smtp`
`GET    /api/admin/mod-manager`
`PUT    /api/admin/mod-manager`
`GET    /api/admin/theme-settings`
`PATCH  /api/admin/theme-settings`
`GET    /api/admin/auth-lockouts`
`DELETE /api/admin/auth-lockouts/:lockoutId`


### Alerts

`POST   /api/alert-rules`
`GET    /api/alert-rules`
`GET    /api/alert-rules/:ruleId`
`PUT    /api/alert-rules/:ruleId`
`DELETE /api/alert-rules/:ruleId`
`GET    /api/alerts/:alertId/deliveries`
`GET    /api/alerts`
`GET    /api/alerts/:alertId`
`POST   /api/alerts/:alertId/resolve`
`POST   /api/alerts/bulk-resolve`
`GET    /api/alerts/stats`


### Api keys

`POST   /api/api/admin/api-keys`
`GET    /api/api/admin/api-keys`


### Auth

`POST   /api/auth/register`
`POST   /api/auth/login`
`GET    /api/auth/me`
`GET    /api/auth/profile`
`POST   /api/auth/profile/change-password`
`POST   /api/auth/profile/set-password`
`GET    /api/auth/profile/two-factor`
`POST   /api/auth/profile/two-factor/enable`
`POST   /api/auth/profile/two-factor/disable`
`POST   /api/auth/profile/two-factor/generate-backup-codes`
`GET    /api/auth/profile/passkeys`
`POST   /api/auth/profile/passkeys`
`POST   /api/auth/profile/passkeys/verify`
`DELETE /api/auth/profile/passkeys/:id`
`PATCH  /api/auth/profile/passkeys/:id`
`GET    /api/auth/profile/sso/accounts`
`POST   /api/auth/profile/sso/link`
`POST   /api/auth/profile/sso/unlink`
`POST   /api/auth/forgot-password`
`GET    /api/auth/reset-password/validate`
`POST   /api/auth/profile/delete`
`POST   /api/auth/reset-password`


### Backups

`POST   /api/servers/:serverId/backups`
`GET    /api/servers/:serverId/backups`
`GET    /api/servers/:serverId/backups/:backupId`
`POST   /api/servers/:serverId/backups/:backupId/restore`
`DELETE /api/servers/:serverId/backups/:backupId`
`GET    /api/servers/:serverId/backups/:backupId/download`


### Bulk servers

`POST   /api/servers/bulk/suspend`
`POST   /api/servers/bulk/unsuspend`
`DELETE /api/servers/bulk`
`POST   /api/servers/bulk/status`


### Dashboard

`GET    /api/dashboard/stats`
`GET    /api/dashboard/activity`
`GET    /api/dashboard/resources`


### File tunnel

`GET    /api/servers/api/internal/file-tunnel/poll`
`POST   /api/servers/api/internal/file-tunnel/response/:requestId`
`POST   /api/servers/api/internal/file-tunnel/response/:requestId/stream`
`GET    /api/servers/api/internal/file-tunnel/upload/:requestId`


### Metrics

`GET    /api/servers/:serverId/metrics`
`GET    /api/servers/:serverId/stats`
`GET    /api/nodes/:nodeId/metrics`


### Migration

`GET    /api/admin/migration/api/admin/migration/catalyst-nodes`
`POST   /api/admin/migration/api/admin/migration/test`
`POST   /api/admin/migration/api/admin/migration/start`
`GET    /api/admin/migration/api/admin/migration`
`GET    /api/admin/migration/api/admin/migration/:jobId`
`POST   /api/admin/migration/api/admin/migration/:jobId/pause`
`POST   /api/admin/migration/api/admin/migration/:jobId/resume`
`POST   /api/admin/migration/api/admin/migration/:jobId/cancel`
`GET    /api/admin/migration/api/admin/migration/:jobId/steps`
`POST   /api/admin/migration/api/admin/migration/:jobId/retry/:stepId`


### Nests

`GET    /api/nests/`
`GET    /api/nests/:nestId`
`POST   /api/nests/`
`PUT    /api/nests/:nestId`
`DELETE /api/nests/:nestId`


### Nodes

`POST   /api/nodes/`
`GET    /api/nodes/`
`GET    /api/nodes/:nodeId`
`POST   /api/nodes/:nodeId/deployment-token`
`GET    /api/nodes/:nodeId/api-key`
`POST   /api/nodes/:nodeId/api-key`
`PUT    /api/nodes/:nodeId`
`GET    /api/nodes/:nodeId/stats`
`POST   /api/nodes/:nodeId/heartbeat`
`DELETE /api/nodes/:nodeId`
`GET    /api/nodes/:nodeId/ip-pools`
`GET    /api/nodes/:nodeId/ip-availability`
`GET    /api/nodes/:nodeId/allocations`
`POST   /api/nodes/:nodeId/allocations`
`PATCH  /api/nodes/:nodeId/allocations/:allocationId`
`DELETE /api/nodes/:nodeId/allocations/:allocationId`
`GET    /api/nodes/:nodeId/assignments`
`POST   /api/nodes/:nodeId/assign`
`DELETE /api/nodes/:nodeId/assignments/:assignmentId`
`GET    /api/nodes/accessible`
`POST   /api/nodes/assign-wildcard`
`DELETE /api/nodes/assign-wildcard/:targetType/:targetId`


### Plugins

`GET    /api/plugins/api/plugins`
`GET    /api/plugins/api/plugins/:name`
`POST   /api/plugins/api/plugins/:name/enable`
`POST   /api/plugins/api/plugins/:name/reload`
`PUT    /api/plugins/api/plugins/:name/config`
`GET    /api/plugins/api/plugins/:name/frontend-manifest`


### Roles

`GET    /api/roles/`
`GET    /api/roles/:roleId`
`POST   /api/roles/`
`PUT    /api/roles/:roleId`
`DELETE /api/roles/:roleId`
`POST   /api/roles/:roleId/permissions`
`DELETE /api/roles/:roleId/permissions/*`
`POST   /api/roles/:roleId/users/:userId`
`DELETE /api/roles/:roleId/users/:userId`
`GET    /api/roles/users/:userId/roles`
`GET    /api/roles/presets`
`GET    /api/roles/:roleId/nodes`
`GET    /api/roles/users/:userId/nodes`


### Servers

`POST   /api/servers/`
`GET    /api/servers/`
`GET    /api/servers/:serverId`
`GET    /api/servers/:serverId/stats/history`
`PUT    /api/servers/:serverId`
`POST   /api/servers/:serverId/storage/resize`
`GET    /api/servers/:serverId/files`
`GET    /api/servers/:serverId/mod-manager/search`
`GET    /api/servers/:serverId/mod-manager/versions`
`POST   /api/servers/:serverId/mod-manager/install`
`GET    /api/servers/:serverId/plugin-manager/search`
`GET    /api/servers/:serverId/plugin-manager/versions`
`POST   /api/servers/:serverId/plugin-manager/install`
`GET    /api/servers/:serverId/mod-manager/installed`
`GET    /api/servers/:serverId/plugin-manager/installed`
`POST   /api/servers/:serverId/mod-manager/uninstall`
`POST   /api/servers/:serverId/plugin-manager/uninstall`
`POST   /api/servers/:serverId/mod-manager/check-updates`
`POST   /api/servers/:serverId/plugin-manager/check-updates`
`POST   /api/servers/:serverId/mod-manager/update`
`POST   /api/servers/:serverId/plugin-manager/update`
`GET    /api/servers/:serverId/files/download`
`POST   /api/servers/:serverId/files/upload`
`POST   /api/servers/:serverId/files/create`
`POST   /api/servers/:serverId/files/compress`
`POST   /api/servers/:serverId/files/decompress`
`POST   /api/servers/:serverId/files/archive-contents`
`GET    /api/servers/:serverId/logs`
`POST   /api/servers/:serverId/files/write`
`POST   /api/servers/:serverId/files/permissions`
`DELETE /api/servers/:serverId/files/delete`
`POST   /api/servers/:serverId/files/rename`
`DELETE /api/servers/:serverId`
`GET    /api/servers/:serverId/permissions`
`GET    /api/servers/:serverId/invites`
`POST   /api/servers/:serverId/invites`
`DELETE /api/servers/:serverId/invites/:inviteId`
`POST   /api/servers/invites/accept`
`POST   /api/servers/invites/register`
`GET    /api/servers/invites/:token`
`POST   /api/servers/:serverId/access`
`DELETE /api/servers/:serverId/access/:targetUserId`
`GET    /api/servers/:serverId/databases`
`POST   /api/servers/:serverId/databases`
`POST   /api/servers/:serverId/databases/:databaseId/rotate`
`DELETE /api/servers/:serverId/databases/:databaseId`
`POST   /api/servers/:serverId/install`
`POST   /api/servers/:serverId/reinstall`
`POST   /api/servers/eula`
`POST   /api/servers/:serverId/rebuild`
`POST   /api/servers/:serverId/start`
`POST   /api/servers/:serverId/stop`
`POST   /api/servers/:serverId/kill`
`POST   /api/servers/:serverId/restart`
`GET    /api/servers/:serverId/allocations`
`POST   /api/servers/:serverId/allocations`
`DELETE /api/servers/:serverId/allocations/:containerPort`
`POST   /api/servers/:serverId/allocations/primary`
`PATCH  /api/servers/:id/restart-policy`
`POST   /api/servers/:id/reset-crash-count`
`PATCH  /api/servers/:id/backup-settings`
`POST   /api/servers/:id/transfer`
`POST   /api/servers/:serverId/suspend`
`POST   /api/servers/:serverId/unsuspend`
`POST   /api/servers/:serverId/transfer-ownership`
`POST   /api/servers/:serverId/archive`
`POST   /api/servers/:serverId/restore`


### Tasks

`POST   /api/servers/:serverId/tasks`
`GET    /api/servers/:serverId/tasks`
`GET    /api/servers/:serverId/tasks/:taskId`
`PUT    /api/servers/:serverId/tasks/:taskId`
`DELETE /api/servers/:serverId/tasks/:taskId`
`POST   /api/servers/:serverId/tasks/:taskId/execute`


### Templates

`GET    /api/templates/`
`GET    /api/templates/:templateId`
`POST   /api/templates/`
`PUT    /api/templates/:templateId`
`DELETE /api/templates/:templateId`
`POST   /api/templates/import-pterodactyl`


---

*Generated from 222 API routes*
