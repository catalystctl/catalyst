# Admin Guide

This guide covers all administrative features in Catalyst, from user management and role-based access control to node provisioning, server templates, backups, security, and system customization.

---

## Table of Contents

1. [Admin Dashboard Overview](#admin-dashboard-overview)
2. [System Health](#system-health)
3. [User Management](#user-management)
4. [Role & Permission System](#role--permission-system)
5. [Node Management](#node-management)
6. [Server Templates](#server-templates)
7. [Server Administration](#server-administration)
8. [Backup Management](#backup-management)
9. [Alerts System](#alerts-system)
10. [Scheduled Tasks](#scheduled-tasks)
11. [API Key Management](#api-key-management)
12. [Webhooks](#webhooks)
13. [Plugin Management](#plugin-management)
14. [Security Settings](#security-settings)
15. [SMTP & Email Configuration](#smtp--email-configuration)
16. [Theme & Branding](#theme--branding)
17. [IPAM (IP Address Management)](#ipam-ip-address-management)
18. [Database Host Management](#database-host-management)
19. [Audit Logs](#audit-logs)
20. [Pterodactyl Migration](#pterodactyl-migration)
21. [Auth Lockouts](#auth-lockouts)
22. [OIDC / OAuth Provider Configuration](#oidc--oauth-provider-configuration)
23. [Mod Manager Settings](#mod-manager-settings)

---

## Admin Dashboard Overview

The admin dashboard provides a centralized view of your Catalyst installation. Access it from the **Admin** section in the navigation sidebar.

The dashboard displays key metrics including:

- **Total users** registered on the panel
- **Total servers** deployed across all nodes
- **Total nodes** configured in the system
- **Active servers** currently running

From the admin dashboard, you can navigate to all management sections:

| Page | Description |
|------|-------------|
| **Users** | Manage user accounts, roles, and server access |
| **Nodes** | Configure compute nodes and view resource usage |
| **Servers** | View and manage all servers across the panel |
| **Templates** | Create and manage game server templates |
| **Roles** | Define roles and permission sets |
| **Alerts** | Configure and monitor alert rules |
| **Audit Logs** | Review system-wide activity logs |
| **Security** | Configure rate limits, lockout policies, and brute-force protection |
| **Theme** | Customize panel branding, colors, and appearance |
| **Plugins** | Install and manage panel extensions |
| **Network (IPAM)** | Manage IP pools and address allocation |
| **Migration** | Import from Pterodactyl panels |
| **System** | SMTP, mod manager, database hosts, and general settings |

All admin operations require appropriate permissions. The `admin.read` permission grants read-only access to the admin panel, while `admin.write` grants full administrative control.

---

## System Health

The system health endpoint provides a real-time overview of Catalyst's infrastructure status.

**Access:** Admin panel → System Health

The health check reports:

- **Overall status** — `healthy` (all systems nominal) or `degraded` (issues detected)
- **Database** — PostgreSQL connectivity status (`connected` / `disconnected`)
- **Nodes** — Count of total, online, offline, and stale nodes (no heartbeat in 5+ minutes)

### Checking Health via API

```bash
curl -H "Authorization: Bearer <session_token>" \
  https://your-catalyst.example.com/api/admin/health
```text

Response example:

```json
{
  "status": "degraded",
  "database": "connected",
  "nodes": {
    "total": 3,
    "online": 2,
    "offline": 1,
    "stale": 0
  },
  "timestamp": "2026-04-18T21:00:00.000Z"
}
```

---

## User Management

### Viewing Users

Navigate to **Admin → Users** to see a paginated list of all registered users. You can search users by email or username.

Each user entry shows:

- Email address and username
- Assigned roles
- Creation and last update timestamps
- Number of assigned servers

### Creating a User

1. Click **Create User** on the Users page.
2. Fill in the required fields:
   - **Email** — must be unique
   - **Username** — must be unique
   - **Password** — minimum 8 characters
3. Optionally assign **Roles** (requires `user.set_roles` permission).
4. Optionally assign **Server Access** by specifying server IDs and permissions.
5. Click **Create**.

When assigning server access without specifying permissions, the following defaults are granted:

- `server.start`, `server.stop`, `server.read`, `server.delete`
- `alert.read`, `alert.create`, `alert.update`, `alert.delete`
- `file.read`, `file.write`
- `console.read`, `console.write`

### Updating a User

1. Click on a user to edit their profile.
2. Modify email, username, or password as needed.
3. Update role assignments (requires `user.set_roles` permission).
4. Update server access assignments.
5. Click **Save**.

**Note:** When server access is removed from a user, their SFTP tokens for those servers are automatically revoked.

### Deleting a User

1. Navigate to the user's profile.
2. Click **Delete User**.
3. If the user owns servers, you must either:
   - Transfer ownership to another user by providing `{ force: true, transferToUserId: "..." }`, or
   - Delete/transfer the servers first.

When a user is deleted, the following actions occur automatically:

- All SFTP tokens are revoked
- All WebSocket sessions are disconnected
- Session data, API keys, passkeys, and 2FA configurations are removed
- Server access records are cleaned up
- An audit log entry is created
- A webhook event (`user.deleted`) is dispatched

### Managing User Server Access

To view which servers a user has access to:

```bash
GET /api/admin/users/:userId/servers
```text

### Permissions Required

| Action | Permission |
|--------|-----------|
| View users | `user.read` |
| Create users | `user.create` |
| Update users | `user.update` |
| Delete users | `user.delete` |
| Assign roles | `user.set_roles` |
| Ban/unban users | `user.ban` / `user.unban` |

---

## Role & Permission System

Catalyst uses a granular role-based access control (RBAC) system. Permissions are organized into categories, and roles bundle permissions together for easy assignment.

### Permission Categories

| Category | Permissions |
|----------|------------|
| **Administration** | `*` (Super Admin), `admin.read`, `admin.write` |
| **Servers** | `server.read`, `server.create`, `server.start`, `server.stop`, `server.delete`, `server.suspend`, `server.transfer`, `server.schedule` |
| **Nodes** | `node.read`, `node.create`, `node.update`, `node.delete`, `node.view_stats`, `node.manage_allocation` |
| **Locations** | `location.read`, `location.create`, `location.update`, `location.delete` |
| **Templates** | `template.read`, `template.create`, `template.update`, `template.delete` |
| **Users** | `user.read`, `user.create`, `user.update`, `user.delete`, `user.ban`, `user.unban`, `user.set_roles` |
| **Roles** | `role.read`, `role.create`, `role.update`, `role.delete` |
| **Backups** | `backup.read`, `backup.create`, `backup.delete`, `backup.restore` |
| **Files** | `file.read`, `file.write` |
| **Console** | `console.read`, `console.write` |
| **Databases** | `database.read`, `database.create`, `database.delete`, `database.rotate` |
| **Alerts** | `alert.read`, `alert.create`, `alert.update`, `alert.delete` |
| **API Keys** | `apikey.manage` |

### Built-in Role Presets

Catalyst ships with four role presets that can be used as starting points:

| Preset | Description | Permissions |
|--------|-------------|-------------|
| **Administrator** | Full system access | `*` |
| **Moderator** | Can manage most resources but not users/roles | `node.read`, `node.update`, `node.view_stats`, `location.read`, `template.read`, `user.read`, `server.read`, `server.start`, `server.stop`, `file.read`, `file.write`, `console.read`, `console.write`, `alert.read`, `alert.create`, `alert.update`, `alert.delete` |
| **Support** | Read-only access for support staff | `node.read`, `node.view_stats`, `location.read`, `template.read`, `server.read`, `file.read`, `console.read`, `alert.read`, `user.read` |
| **User** | Basic access to own servers | `server.read` |

### Creating a Custom Role

1. Navigate to **Admin → Roles**.
2. Click **Create Role**.
3. Enter a **Name** (must be unique, case-insensitive).
4. Optionally add a **Description**.
5. Select the **Permissions** to grant.
6. Click **Create**.

### Managing Role Permissions

- **Add a permission:** `POST /api/roles/:roleId/permissions` with `{ "permission": "server.start" }`
- **Remove a permission:** `DELETE /api/roles/:roleId/permissions/:permission`

### Assigning Roles to Users

- **Assign:** `POST /api/roles/:roleId/users/:userId`
- **Remove:** `DELETE /api/roles/:roleId/users/:userId`

### Node Access via Roles

Roles can be assigned access to specific nodes or all nodes (wildcard). When a role has node access, all users with that role can see and interact with those nodes.

- **View role nodes:** `GET /api/roles/:roleId/nodes`
- **Assign node to role:** `POST /api/nodes/:nodeId/assign` with `{ "targetType": "role", "targetId": "<roleId>" }`

### Deleting a Role

A role can only be deleted if no users are currently assigned to it. If users are assigned, you must remove all role assignments first.

---

## Node Management

Nodes are the compute machines that run game server containers. Each node runs the Catalyst Agent (a Rust binary) that communicates with the panel via WebSocket.

### Creating a Node

1. Navigate to **Admin → Nodes**.
2. Click **Create Node**.
3. Fill in the configuration:
   - **Name** — unique identifier (e.g., `node-us-east-1`)
   - **Description** — optional human-readable description
   - **Location** — select a configured location
   - **Hostname** — internal hostname the agent uses to connect
   - **Public Address** — the IP/hostname clients connect to (used for host-mode networking)
   - **Max Memory (MB)** — total RAM available for server allocation
   - **Max CPU Cores** — total CPU cores available for server allocation
   - **Server Data Dir** — optional custom path for server files (default: configured via `SERVER_DATA_DIR` env var)
4. Click **Create**.

After creation, a **secret key** is generated for the node. This is used for agent authentication.

### Node Deployment

After creating a node, deploy the agent:

1. Click **Generate Deployment Token** on the node.
2. A one-time deployment URL and API key are generated (valid for 24 hours).
3. Run the deploy script on the target machine using the provided URL.

Alternatively, generate a persistent API key:

1. Click **Generate API Key** on the node.
2. The key is prefixed with `catalyst_` and is stored with metadata linking it to the node.
3. Use `regenerate: true` to replace an existing key.

### Node Statistics

View real-time and allocated resource usage:

```bash
GET /api/nodes/:nodeId/stats
```

Returns:

- **Allocated resources** — memory and CPU cores assigned to servers
- **Available resources** — remaining capacity
- **Real-time metrics** — actual CPU%, memory usage, disk usage from agent heartbeats
- **Server counts** — total, running, and stopped

### Updating a Node

Modify node configuration including name, description, hostname, public address, and resource limits.

### Deleting a Node

A node can only be deleted if it has no running servers. Stop all servers on the node first.

### Node Allocations

Allocations define IP:port combinations available for server assignment. Similar to Pterodactyl's allocation system.

**Create allocations:**

```bash
POST /api/nodes/:nodeId/allocations
{
  "ip": "192.168.1.100",
  "ports": "25565-25570, 25580",
  "alias": "Main IP",
  "notes": "Primary allocation range"
}
```text

**Supported formats:**

- Single IP: `192.168.1.100`
- CIDR notation: `192.168.1.0/28` (expands to individual IPs)
- Port ranges: `25565-25570`
- Port lists: `25565, 25580, 25590`

**Limit:** Maximum 5,000 allocations per request. Port ranges are capped at 200 ports per range.

**Manage allocations:**

| Action | Endpoint |
|--------|----------|
| List allocations | `GET /api/nodes/:nodeId/allocations` |
| Create allocations | `POST /api/nodes/:nodeId/allocations` |
| Update alias/notes | `PATCH /api/nodes/:nodeId/allocations/:id` |
| Delete allocation | `DELETE /api/nodes/:nodeId/allocations/:id` |

Allocations assigned to a server cannot be deleted.

### Node Assignment (Access Control)

Control which users and roles can access specific nodes:

- **Assign to user:** `POST /api/nodes/:nodeId/assign` with `{ "targetType": "user", "targetId": "<userId>" }`
- **Assign to role:** `POST /api/nodes/:nodeId/assign` with `{ "targetType": "role", "targetId": "<roleId>" }`
- **Wildcard (all nodes):** `POST /api/nodes/assign-wildcard` with `{ "targetType": "role", "targetId": "<roleId>" }`

Assignments support optional expiration via the `expiresAt` field (ISO date string).

### Node Heartbeat

The agent sends heartbeats to `POST /api/nodes/:nodeId/heartbeat` with health data including CPU, memory, disk, container count, and network I/O. The panel updates the node's online status and stores metrics for the statistics dashboard.

---

## Server Templates

Server templates define the container configuration, startup commands, variables, and install scripts for game servers.

### Template Schema

Each template has the following properties:

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Human-readable template name |
| `description` | No | Detailed description |
| `author` | Yes | Template author/maintainer |
| `version` | Yes | Template version |
| `image` | Yes | Default container image |
| `images` | No | Array of selectable image variants |
| `defaultImage` | No | Default image when user doesn't select one |
| `installImage` | No | Container image for install script execution |
| `startup` | Yes | Startup command (supports `{{VARIABLE}}` interpolation) |
| `stopCommand` | Yes | Command sent to stdin for graceful shutdown |
| `sendSignalTo` | Yes | Signal on timeout: `SIGTERM`, `SIGINT`, or `SIGKILL` |
| `variables` | Yes | Array of environment variable definitions |
| `installScript` | No | Shell script for server installation |
| `supportedPorts` | Yes | Array of port numbers the server uses |
| `allocatedMemoryMb` | Yes | Default RAM allocation (min 128 MB) |
| `allocatedCpuCores` | Yes | Default CPU core allocation (min 1) |
| `features` | No | Feature flags (mod manager, config file, etc.) |

### Template Variables

Each variable definition includes:

| Property | Description |
|----------|-------------|
| `name` | Variable name (UPPER_SNAKE_CASE recommended) |
| `description` | User-facing description |
| `default` | Default value (always string) |
| `required` | Whether user must provide a value |
| `input` | UI input type: `text`, `number`, `password`, `checkbox`, `select`, `textarea` |
| `rules` | Validation rules (Laravel-style): `between:512,16384`, `in:survival,creative`, `min:1`, `max:255` |

### Template Features

The `features` object supports:

- **`restartOnExit`** — Auto-restart when the process exits unexpectedly
- **`maxInstances`** — Limit the number of servers from this template
- **`configFile`** — Primary config file path for the built-in editor
- **`modManager`** — Mod/addon management with CurseForge and Modrinth providers
- **`pluginManager`** — Plugin management configuration
- **`backupPaths`** — Paths to include in automated backups
- **`fileEditor`** — File editing capabilities and restricted paths

### Image Variants

Templates can offer multiple container images for users to choose from:

```json
{
  "images": [
    { "name": "temurin-21", "label": "Eclipse Temurin 21 JRE", "image": "eclipse-temurin:21-jre" },
    { "name": "temurin-17", "label": "Eclipse Temurin 17 JRE", "image": "eclipse-temurin:17-jre" }
  ],
  "defaultImage": "eclipse-temurin:21-jre"
}
```

The selected image is resolved at server start time via the `IMAGE_VARIANT` environment variable.

### Importing Pterodactyl Eggs

Catalyst can import Pterodactyl egg configurations:

1. Navigate to **Admin → Templates**.
2. Click **Import Pterodactyl Egg**.
3. Paste the egg JSON configuration.
4. Optionally assign to a Nest.
5. Click **Import**.

The import process maps:

- Pterodactyl variables → Catalyst variables
- Egg images → image variants
- Install scripts → preserved as-is
- Config file definitions → stored in template features
- Startup detection / log detection → stored in features

### Managing Templates

| Action | Permission | Endpoint |
|--------|-----------|----------|
| List templates | `template.read` | `GET /api/templates` |
| View template | `template.read` | `GET /api/templates/:id` |
| Create template | `template.create` | `POST /api/templates` |
| Update template | `template.update` | `PUT /api/templates/:id` |
| Delete template | `template.delete` | `DELETE /api/templates/:id` |
| Import Pterodactyl egg | `template.create` | `POST /api/templates/import-pterodactyl` |

Templates that are currently in use by servers cannot be deleted.

---

## Server Administration

Admins can view and manage all servers across the panel from **Admin → Servers**.

### Server Listing

The admin server list supports filtering by:

- **Status** — running, stopped, starting, stopping, installing, suspended
- **Search** — server name, ID, or node name
- **Owner** — filter by owner username or email
- **Pagination** — configurable page size

### Bulk Server Actions

Admins can perform actions on multiple servers simultaneously:

```bash
POST /api/admin/servers/actions
{
  "serverIds": ["server-id-1", "server-id-2"],
  "action": "start",
  "reason": "Maintenance complete"
}
```text

**Available actions:**

| Action | Description | Permission |
|--------|-------------|-----------|
| `start` | Start servers | `server.start` |
| `stop` | Gracefully stop servers | `server.stop` |
| `kill` | Force-kill servers | `server.stop` |
| `restart` | Restart servers | `server.start` |
| `suspend` | Suspend servers (stops running, prevents starts) | `server.suspend` |
| `unsuspend` | Remove suspension | `server.suspend` |
| `delete` | Delete servers (must be stopped) | `server.delete` |

Each action returns per-server results:

```json
{
  "success": true,
  "results": [
    { "serverId": "...", "status": "success" },
    { "serverId": "...", "status": "skipped", "error": "Node is offline" }
  ],
  "summary": { "success": 1, "skipped": 1 }
}
```

### Suspension Behavior

- Suspended servers are stopped if currently running.
- Suspension records the suspending admin, reason, and timestamp.
- When `SUSPENSION_ENFORCED=true` (default), suspended servers:
  - Cannot be started by users
  - Cannot be deleted unless `SUSPENSION_DELETE_BLOCKED=false`
  - Block backup, restore, and file operations
- System log entries are created on the server.

---

## Backup Management

Catalyst supports local, S3, and SFTP backup storage. Admins can configure backup settings and users can create/restore backups for servers they have access to.

### Storage Modes

| Mode | Description | Configuration |
|------|-------------|---------------|
| **Local** | Store on panel filesystem | `BACKUP_DIR` env var (default: `/var/lib/catalyst/backups`) |
| **S3** | Store in S3-compatible storage | `BACKUP_S3_BUCKET`, `BACKUP_S3_REGION`, `BACKUP_S3_ACCESS_KEY`, `BACKUP_S3_SECRET_KEY`, optional `BACKUP_S3_ENDPOINT`, `BACKUP_S3_PATH_STYLE` |
| **SFTP** | Store on remote SFTP server | Per-server configuration via encrypted settings |
| **Stream** | Stream through panel (for migration) | `BACKUP_STREAM_DIR` env var |

### Creating a Backup

1. Navigate to a server's **Backups** tab.
2. Click **Create Backup**.
3. Optionally provide a custom name (sanitized to alphanumeric + `._-`).
4. The backup is created as a `.tar.gz` archive.

**Requirements:**

- The node must be online.
- Either `backupAllocationMb > 0` or external storage (S3/SFTP) must be configured.
- The server cannot be suspended (when enforcement is enabled).

### Restoring a Backup

1. The server must be **stopped**.
2. The node must be **online**.
3. For S3/SFTP backups, the file is downloaded to a temporary location before restoration.

### Downloading Backups

Backups can be downloaded via the API or UI. For remote storage, the file is streamed directly from S3/SFTP without using local disk as intermediary.

### Deleting Backups

Deleting a backup removes it from all storage (local disk, S3, or SFTP) and deletes the database record.

### Backup Path Structure

- **Local:** `/var/lib/catalyst/backups/<server-uuid>/<backup-name>.tar.gz`
- **S3:** `s3://<bucket>/backups/<server-uuid>/<backup-name>.tar.gz`
- **SFTP:** `sftp://<host>:<port>/<basePath>/backups/<server-uuid>/<backup-name>.tar.gz`

---

## Alerts System

Catalyst provides a flexible alerting system that monitors server and node health.

### Alert Rule Types

| Type | Description |
|------|-------------|
| `resource_threshold` | Triggered when resource usage exceeds a threshold |
| `node_offline` | Triggered when a node goes offline |
| `server_crashed` | Triggered when a server crashes unexpectedly |

### Alert Targets

| Target | Description | Access |
|--------|-------------|--------|
| `server` | Monitor a specific server | Owner or users with `alert.*` permissions |
| `node` | Monitor a specific node | Admin only |
| `global` | System-wide monitoring | Admin only |

### Creating an Alert Rule

```json
POST /api/alert-rules
{
  "name": "High Memory Usage",
  "description": "Alert when memory exceeds 90%",
  "type": "resource_threshold",
  "target": "server",
  "targetId": "<server-id>",
  "conditions": { "metric": "memory", "threshold": 90 },
  "actions": { "type": "webhook", "url": "https://example.com/alert" },
  "enabled": true
}
```text

### Managing Alerts

- **List alerts:** `GET /api/alerts` — supports filtering by server, node, type, severity, and resolved status
- **View alert details:** `GET /api/alerts/:alertId` — includes delivery history
- **Resolve alert:** `POST /api/alerts/:alertId/resolve`
- **Bulk resolve:** `POST /api/alerts/bulk-resolve` with `{ "alertIds": [...] }`
- **Alert statistics:** `GET /api/alerts/stats` — counts by severity and type

### Alert Delivery

Each alert can trigger actions (webhooks, notifications). Delivery history is tracked per alert.

---

## Scheduled Tasks

Create automated tasks (cron jobs) for individual servers.

### Supported Actions

| Action | Description |
|--------|-------------|
| `start` | Start the server |
| `stop` | Stop the server |
| `restart` | Restart the server |
| `backup` | Create a backup |
| `command` | Send a command to the server console |

### Creating a Task

1. Navigate to a server's **Tasks** tab.
2. Click **Create Task**.
3. Configure:
   - **Name** — descriptive name
   - **Action** — what to do (start, stop, restart, backup, command)
   - **Payload** — for `command` actions, the command string to send
   - **Schedule** — standard cron expression (e.g., `0 3 * * *` for daily at 3 AM)
4. Click **Create**.

The scheduler validates the cron expression and calculates the next run time automatically.

### Cron Expression Examples

| Expression | Description |
|-----------|-------------|
| `0 3 * * *` | Daily at 3:00 AM |
| `*/30 * * * *` | Every 30 minutes |
| `0 */6 * * *` | Every 6 hours |
| `0 0 * * 0` | Weekly on Sunday at midnight |
| `0 0 1 * *` | Monthly on the 1st at midnight |

### Task Management

- **Execute now:** `POST /api/tasks/:serverId/tasks/:taskId/execute` — runs the task immediately regardless of schedule
- **Enable/disable:** Update the `enabled` field
- **Task execution tracking:** Each execution records `lastRunAt`, `runCount`, `lastStatus`, and `lastError`

### Timezone

Tasks run in the timezone specified by the `TZ` environment variable (default: `UTC`).

---

## API Key Management

API keys allow programmatic access to the Catalyst API. They can be scoped with specific permissions.

### Creating an API Key

1. Navigate to **Admin → API Keys** (or use the API directly).
2. Click **Create API Key**.
3. Configure:
   - **Name** — descriptive name (1–100 characters)
   - **Permissions** — select specific permissions or grant all (`allPermissions: true`)
   - **Expiration** — optional TTL in seconds (1 hour to 1 year)
   - **Rate limit** — max requests per time window (default: 100 per 60 seconds)
   - **Metadata** — optional key-value pairs for tracking

**Important:** You cannot grant permissions you don't have yourself. The `*` (Super Admin) permission bypasses this restriction.

4. Click **Create** and **copy the key immediately** — it cannot be retrieved again.

### API Key Properties

| Property | Description |
|----------|-------------|
| `prefix` | Key prefix (e.g., `catalyst_`) |
| `start` | First few characters for identification |
| `enabled` | Whether the key is active |
| `expiresAt` | Optional expiration timestamp |
| `lastRequest` | Timestamp of most recent use |
| `requestCount` | Total number of requests made |
| `remaining` | Remaining requests in current rate limit window |

### Managing API Keys

| Action | Endpoint |
|--------|----------|
| List all keys | `GET /api/admin/api-keys` |
| View key details | `GET /api/admin/api-keys/:id` |
| Update name/enabled | `PATCH /api/admin/api-keys/:id` |
| Delete key | `DELETE /api/admin/api-keys/:id` |
| View usage stats | `GET /api/admin/api-keys/:id/usage` |
| View permission catalog | `GET /api/admin/api-keys/permissions-catalog` |
| View your permissions | `GET /api/admin/api-keys/my-permissions` |

### Using API Keys

Include the key in the `Authorization` header:

```bash
curl -H "Authorization: Bearer catalyst_your_api_key_here" \
  https://your-catalyst.example.com/api/servers
```

---

## Webhooks

Webhooks notify external services about events in Catalyst. Each webhook payload is signed with HMAC-SHA256 for verification.

### Configuration

Webhooks are configured via the `WEBHOOK_URLS` environment variable or stored in the database (`SystemSetting` with id `webhooks`).

**Environment variable:**
```text
WEBHOOK_URLS=https://example.com/hook,https://other.com/hook
```

**Database:** Store a JSON array of URLs in the system settings.

### Webhook Secret

The signing secret is set via the `WEBHOOK_SECRET` environment variable. If not set, a random secret is generated on startup.

### Event Types

| Event | Trigger |
|-------|---------|
| `server.created` | New server deployed |
| `server.deleted` | Server removed |
| `server.suspended` | Server suspended |
| `server.unsuspended` | Server unsuspended |
| `server.bulk_suspended` | Multiple servers suspended |
| `server.bulk_deleted` | Multiple servers deleted |
| `user.deleted` | User account deleted |

### Payload Format

```json
{
  "event": "server.created",
  "serverId": "srv_abc123",
  "serverName": "My Minecraft Server",
  "userId": "user_xyz",
  "timestamp": "2026-04-18T21:00:00.000Z",
  "data": { "ownerId": "user_xyz" }
}
```text

### Signature Verification

Each webhook includes these headers:

- `X-Webhook-Signature` — HMAC-SHA256 signature
- `X-Webhook-Event` — Event type
- `X-Webhook-Timestamp` — Timestamp

Verify the signature:

```python
import hmac, hashlib

secret = "your_webhook_secret"
signature = request.headers["X-Webhook-Signature"]
computed = hmac.new(secret.encode(), request.body, hashlib.sha256).hexdigest()
assert hmac.compare_digest(computed, signature)
```

### Delivery

- Webhooks are delivered via HTTP POST with a 10-second timeout.
- Delivery is fire-and-forget (non-blocking).
- Failed deliveries are logged but not retried automatically.
- Webhook URLs are refreshed from the database every 60 seconds.

---

## Plugin Management

Plugins extend Catalyst's functionality with custom routes, WebSocket handlers, scheduled tasks, and frontend components.

### Viewing Plugins

Navigate to **Admin → Plugins** to see all installed plugins. Each entry shows:

- **Name** and **Display Name**
- **Version** and **Author**
- **Status** — `enabled`, `disabled`, or `error`
- **Permissions** required by the plugin
- **Backend/Frontend** indicators

### Managing Plugins

| Action | Endpoint | Permission |
|--------|----------|-----------|
| List plugins | `GET /api/plugins` | `admin.read` |
| View plugin details | `GET /api/plugins/:name` | `admin.read` |
| Enable/disable | `POST /api/plugins/:name/enable` | `admin.write` |
| Reload (hot-reload) | `POST /api/plugins/:name/reload` | `admin.write` |
| Update configuration | `PUT /api/plugins/:name/config` | `admin.write` |

### Plugin Configuration

Plugins can expose configuration keys that are managed via the API:

```bash
PUT /api/plugins/my-plugin/config
{
  "config": {
    "apiKey": "your-key",
    "threshold": 75
  }
}
```text

---

## Security Settings

Navigate to **Admin → Security** to configure security policies.

### Rate Limiting

| Setting | Default | Description |
|---------|---------|-------------|
| `authRateLimitMax` | 30 | Max authentication requests per window |
| `fileRateLimitMax` | 120 | Max file operation requests per window |
| `consoleRateLimitMax` | 60 | Max console input commands per window |
| `consoleOutputLinesMax` | 2000 | Max console output lines retained |
| `consoleOutputByteLimitBytes` | 262144 (256 KB) | Max console output throughput per second |

### Brute-Force Protection (Auth Lockouts)

| Setting | Default | Description |
|---------|---------|-------------|
| `lockoutMaxAttempts` | 5 | Failed login attempts before lockout |
| `lockoutWindowMinutes` | 15 | Time window for counting failed attempts |
| `lockoutDurationMinutes` | 15 | How long the lockout lasts |

### File Tunnel Security

| Setting | Default | Description |
|---------|---------|-------------|
| `fileTunnelRateLimitMax` | 100 | Max file tunnel requests per window |
| `fileTunnelMaxUploadMb` | 100 | Max single file upload size (MB) |
| `fileTunnelMaxPendingPerNode` | 50 | Max pending file operations per node |
| `fileTunnelConcurrentMax` | 10 | Max concurrent file transfers per node |

### Other Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `agentMessageMax` | 10000 | Max agent WebSocket messages per window |
| `agentMetricsMax` | 10000 | Max agent metrics messages per window |
| `serverMetricsMax` | 60 | Max server metrics messages per window |
| `auditRetentionDays` | 90 | Days to retain audit logs |
| `maxBufferMb` | 50 | Max buffer size for file operations (MB) |

All values must be positive numbers.

---

## SMTP & Email Configuration

Navigate to **Admin → System → SMTP** to configure email delivery.

### SMTP Settings

| Field | Description |
|-------|-------------|
| `host` | SMTP server hostname |
| `port` | SMTP server port (1–65535) |
| `username` | SMTP authentication username |
| `password` | SMTP authentication password |
| `from` | Sender email address |
| `replyTo` | Reply-to email address |
| `secure` | Use TLS/SSL connection |
| `requireTls` | Require TLS for all connections |
| `pool` | Enable connection pooling |
| `maxConnections` | Max pooled connections |
| `maxMessages` | Max messages per connection |

Fields cannot be empty strings — to clear a value, set it to `null`.

---

## Theme & Branding

Navigate to **Admin → Theme** to customize the panel's appearance.

### Theme Options

| Field | Description | Validation |
|-------|-------------|------------|
| `panelName` | Custom panel name shown in UI | Non-empty string |
| `logoUrl` | URL to custom logo image | Any valid URL or `null` |
| `faviconUrl` | URL to custom favicon | Any valid URL or `null` |
| `defaultTheme` | Default theme for new users | `light`, `dark`, or `system` |
| `enabledThemes` | Themes users can switch between | Array of `light` and/or `dark` (at least one required) |
| `customCss` | Custom CSS injected into the panel | Max 100 KB |
| `primaryColor` | Primary brand color | Hex format (`#RRGGBB`) |
| `secondaryColor` | Secondary brand color | Hex format (`#RRGGBB`) |
| `accentColor` | Accent color | Hex format (`#RRGGBB`) |
| `metadata` | Arbitrary metadata object | Any JSON object |

---

## IPAM (IP Address Management)

Catalyst includes a built-in IPAM system for managing IP addresses across macvlan networks.

### IP Pools

IP pools define network ranges available for server assignment on each node.

**Create a pool:**

```json
POST /api/admin/ip-pools
{
  "nodeId": "node-id",
  "networkName": "macvlan0",
  "cidr": "192.168.10.0/24",
  "gateway": "192.168.10.1",
  "startIp": "192.168.10.10",
  "endIp": "192.168.10.250",
  "reserved": ["192.168.10.1", "192.168.10.2"]
}
```

When a pool is created, the panel automatically sends a `create_network` command to the node's agent to set up the macvlan interface.

### Pool Information

| Field | Description |
|-------|-------------|
| `total` | Total usable IPs in the range |
| `reservedCount` | IPs reserved (gateway, etc.) |
| `usedCount` | IPs currently assigned to servers |
| `availableCount` | IPs available for assignment |

### Managing Pools

| Action | Permission | Endpoint |
|--------|-----------|----------|
| List pools | `admin.read` | `GET /api/admin/ip-pools` |
| Create pool | `admin.read` | `POST /api/admin/ip-pools` |
| Update pool | `admin.write` | `PUT /api/admin/ip-pools/:id` |
| Delete pool | `admin.write` | `DELETE /api/admin/ip-pools/:id` |
| View node pools | `node.read` | `GET /api/nodes/:nodeId/ip-pools` |
| List available IPs | `node.read` | `GET /api/nodes/:nodeId/ip-availability` |

Pools with active allocations cannot be deleted. Network changes are automatically propagated to agents.

---

## Database Host Management

Catalyst can manage external database servers for game servers (MySQL/MariaDB/PostgreSQL).

### Creating a Database Host

```json
POST /api/admin/database-hosts
{
  "name": "MySQL Primary",
  "host": "db.example.com",
  "port": 3306,
  "username": "catalyst",
  "password": "secure-password"
}
```text

| Field | Validation |
|-------|-----------|
| `name` | Min 3 characters, unique |
| `host` | Valid hostname or IP |
| `port` | 1–65535 (default: `DATABASE_HOST_PORT_DEFAULT` or 3306) |
| `username` | Required |
| `password` | Required |

### Managing Database Hosts

| Action | Endpoint |
|--------|----------|
| List hosts | `GET /api/admin/database-hosts` |
| Create host | `POST /api/admin/database-hosts` |
| Update host | `PUT /api/admin/database-hosts/:id` |
| Delete host | `DELETE /api/admin/database-hosts/:id` |

Database hosts with active server databases cannot be deleted.

---

## Audit Logs

Catalyst records comprehensive audit logs for all administrative actions.

### Viewing Audit Logs

Navigate to **Admin → Audit Logs**. Filter by:

- **User** — specific user ID
- **Action** — action type (supports partial match, e.g., `server.`)
- **Resource** — resource type (`server`, `user`, `role`, `node`, etc.)
- **Date range** — `from` and `to` ISO timestamps

### Common Audit Actions

| Action | Description |
|--------|-------------|
| `user_create` | User account created |
| `user_update` | User profile updated |
| `user_delete` | User account deleted |
| `user.role.assign` | Role assigned to user |
| `user.role.remove` | Role removed from user |
| `role.create` | Role created |
| `role.update` | Role updated |
| `role.delete` | Role deleted |
| `server.start` | Server started |
| `server.stop` | Server stopped |
| `server.restart` | Server restarted |
| `server.suspend` | Server suspended |
| `server.unsuspend` | Server unsuspended |
| `server.delete` | Server deleted |
| `security.settings.update` | Security settings changed |
| `smtp_update` | SMTP configuration changed |
| `theme_settings.update` | Theme settings changed |
| `api_key.create` | API key created |
| `api_key.update` | API key updated |
| `api_key.delete` | API key deleted |
| `database.host.create` | Database host created |
| `node.created.wildcard_warning` | Node created with existing wildcard assignments |

### Exporting Audit Logs

Export audit logs in CSV or JSON format:

```bash
# CSV export
GET /api/admin/audit-logs/export?format=csv&from=2026-01-01T00:00:00Z

# JSON export
GET /api/admin/audit-logs/export?format=json&resource=server
```

**Limits:**

- Exports are capped at 2,000 records
- CSV includes columns: id, timestamp, action, resource, resourceId, userId, username, email, details
- JSON export requires `admin.write` permission

### Retention

Audit logs are retained for the number of days configured in security settings (`auditRetentionDays`, default: 90 days).

---

## Pterodactyl Migration

Catalyst provides a built-in migration tool to import servers, nodes, and data from Pterodactyl panels.

### Prerequisites

1. At least one Catalyst node must be **online**.
2. Pterodactyl **Application API key** (`ptla_*`) — required.
3. Pterodactyl **Client API key** (`ptlc_*`) — required for backup and file migration.

### Migration Process

1. **Test Connection** — Verify Pterodactyl API access:
   ```json
   POST /api/admin/migration/test
   { "url": "https://pterodactyl.example.com", "key": "ptla_xxx" }
   ```text

2. **Select Scope:**
   - `full` — Migrate nodes, allocations, users, servers, eggs, and files
   - `node` — Migrate specific nodes and their servers
   - `server` — Migrate individual servers

3. **Map Nodes** — For `full` and `node` scopes, map each Pterodactyl node to a Catalyst node:
   ```json
   {
     "nodeMappings": {
       "ptero-node-1": "catalyst-node-id-1",
       "ptero-node-2": "catalyst-node-id-2"
     }
   }
   ```

4. **Start Migration:**
   ```json
   POST /api/admin/migration/start
   {
     "url": "https://pterodactyl.example.com",
     "key": "ptla_xxx",
     "clientApiKey": "ptlc_xxx",
     "scope": "full",
     "nodeMappings": { "ptero-node-1": "catalyst-node-1" }
   }
   ```text

### Monitoring Migration

- **List jobs:** `GET /api/admin/migration`
- **View status:** `GET /api/admin/migration/:jobId`
- **View steps:** `GET /api/admin/migration/:jobId/steps`
- **Pause:** `POST /api/admin/migration/:jobId/pause`
- **Resume:** `POST /api/admin/migration/:jobId/resume`
- **Cancel:** `POST /api/admin/migration/:jobId/cancel`
- **Retry failed step:** `POST /api/admin/migration/:jobId/retry/:stepId`

### Migration States

| Status | Description |
|--------|-------------|
| `pending` | Job created, waiting to start |
| `running` | Migration in progress |
| `validating` | Post-migration validation |
| `completed` | Migration finished successfully |
| `failed` | Migration failed |
| `paused` | Migration paused by admin |
| `cancelled` | Migration cancelled by admin |

Only one migration job can run at a time. File transfers during migration bypass the normal file tunnel size limits via a bypass token.

---

## Auth Lockouts

The Auth Lockouts page (**Admin → Security → Lockouts**) shows all current account lockouts from brute-force protection.

### Managing Lockouts

- **View lockouts:** Paginated list with search by email or IP address
- **Delete lockout:** Remove a lockout to allow the user to retry login immediately

Each lockout record shows the email, IP address, failed attempt count, and timestamp.

---

## OIDC / OAuth Provider Configuration

Catalyst supports OIDC providers for external authentication, specifically WHMCS and Paymenter billing systems.

### Configuring Providers

Navigate to **Admin → System → OIDC Config**.

Two providers are supported:

- **WHMCS** — WHMCS billing system SSO
- **Paymenter** — Paymenter billing system SSO

Each provider requires:

| Field | Description |
|-------|-------------|
| `clientId` | OAuth client ID |
| `clientSecret` | OAuth client secret |
| `discoveryUrl` | OIDC discovery document URL (must start with `https://`) |

### Configuration Sources

Settings can come from:

1. **Environment variables** — `WHMCS_OIDC_CLIENT_ID`, `WHMCS_OIDC_CLIENT_SECRET`, `WHMCS_OIDC_DISCOVERY_URL` (and `PAYMENTER_*` equivalents)
2. **Database** — Stored in theme settings metadata

Database values override environment variables. To clear a database value and fall back to env vars, submit an empty string for the field.

**Note:** After changing OIDC configuration, restart the Catalyst backend for changes to take full effect.

### Viewing Configuration

Client secrets are masked in API responses (only first 4 characters shown). The response includes a `source` field indicating whether each value comes from `database`, `env`, or `none`.

---

## Mod Manager Settings

Navigate to **Admin → System → Mod Manager** to configure API keys for mod provider services.

### Supported Providers

| Provider | Environment Variable | Description |
|----------|---------------------|-------------|
| **CurseForge** | — | CurseForge mod hosting API key |
| **Modrinth** | — | Modrinth mod hosting API key |

These keys enable the built-in mod manager on templates that have the `modManager` feature configured. Users can browse, search, and install mods/plugins directly from the panel.

---

## Quick Reference: Admin API Endpoints

### Users

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/users` | List users (paginated, searchable) |
| POST | `/api/admin/users` | Create user |
| PUT | `/api/admin/users/:userId` | Update user |
| GET | `/api/admin/users/:userId/servers` | Get user server access |
| POST | `/api/admin/users/:userId/delete` | Delete user |

### Servers (Admin)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/servers` | List all servers (filterable) |
| POST | `/api/admin/servers/actions` | Bulk server actions |

### Nodes

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/nodes` | Create node |
| GET | `/api/nodes` | List accessible nodes |
| GET | `/api/nodes/:nodeId` | Get node details |
| PUT | `/api/nodes/:nodeId` | Update node |
| DELETE | `/api/nodes/:nodeId` | Delete node |
| GET | `/api/nodes/:nodeId/stats` | Node resource statistics |
| POST | `/api/nodes/:nodeId/deployment-token` | Generate deployment token |
| GET/POST | `/api/nodes/:nodeId/api-key` | Manage agent API key |
| GET/POST/PATCH/DELETE | `/api/nodes/:nodeId/allocations/*` | Manage allocations |
| GET/POST/DELETE | `/api/nodes/:nodeId/assignments/*` | Manage node access |
| POST/DELETE | `/api/nodes/assign-wildcard/*` | Wildcard node assignments |

### System

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/stats` | System statistics |
| GET | `/api/admin/health` | Health check |
| GET/PUT | `/api/admin/security-settings` | Security configuration |
| GET/PUT | `/api/admin/smtp` | SMTP configuration |
| GET/PUT | `/api/admin/mod-manager` | Mod manager settings |
| GET/PATCH | `/api/admin/theme-settings` | Theme/branding |
| GET/PUT/DELETE | `/api/admin/ip-pools/*` | IP pool management |
| GET/POST/PUT/DELETE | `/api/admin/database-hosts/*` | Database host management |
| GET | `/api/admin/audit-logs` | View audit logs |
| GET | `/api/admin/audit-logs/export` | Export audit logs |
| GET/DELETE | `/api/admin/auth-lockouts/*` | Manage auth lockouts |
| GET/PATCH | `/api/admin/oidc-config` | OIDC provider settings |
