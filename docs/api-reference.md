# API Reference Guide

Complete reference for the Catalyst REST API, WebSocket protocol, and Server-Sent Events (SSE) streaming endpoints.

## Table of Contents

- [Overview](#overview)
- [Authentication](#authentication)
  - [Session Authentication](#session-authentication)
  - [API Key Authentication](#api-key-authentication)
  - [Agent Authentication](#agent-authentication)
- [Rate Limiting](#rate-limiting)
- [Request & Response Format](#request--response-format)
- [Error Handling](#error-handling)
- [Pagination](#pagination)
- [Permission System](#permission-system)
- [API Endpoints](#api-endpoints)
  - [Health Check](#health-check)
  - [Authentication](#authentication-endpoints)
  - [User Profile](#user-profile)
  - [Passkeys & WebAuthn](#passkeys--webauthn)
  - [Two-Factor Authentication](#two-factor-authentication)
  - [Sessions](#sessions)
  - [SSO Account Management](#sso-account-management)
  - [API Keys](#api-keys-1)
  - [Nodes](#nodes)
  - [Node Allocations](#node-allocations)
  - [Node Assignments](#node-assignments)
  - [Servers](#servers)
  - [Server Console (SSE)](#server-console-sse)
  - [Server Events (SSE)](#server-events-sse)
  - [Server Metrics (SSE)](#server-metrics-sse)
  - [Server Backups](#server-backups)
  - [Scheduled Tasks](#scheduled-tasks)
  - [Templates](#templates)
  - [Nests](#nests)
  - [Roles](#roles)
  - [Alert Rules](#alert-rules)
  - [Alerts](#alerts)
  - [Dashboard](#dashboard)
  - [SFTP](#sftp)
  - [Admin](#admin)
  - [Audit Logs](#audit-logs)
  - [Plugins](#plugins)
  - [Migration (Pterodactyl)](#migration-pterodactyl)
  - [Theme Settings](#theme-settings)
- [WebSocket API](#websocket-api)
  - [Connection](#connection)
  - [Client-to-Server Messages](#client-to-server-messages)
  - [Server-to-Client Messages](#server-to-client-messages)
- [SSE Streaming](#sse-streaming)
  - [Console Stream](#console-stream)
  - [Event Stream](#event-stream)
  - [Metrics Stream](#metrics-stream)

---

## Overview

The Catalyst API is a RESTful HTTP API built with Fastify. All endpoints return JSON. The API supports three real-time communication channels:

- **REST API** — CRUD operations for all resources
- **WebSocket** (`/ws`) — Bidirectional real-time communication (server control, console I/O, agent relay)
- **SSE** (Server-Sent Events) — Unidirectional streaming (console output, server events, metrics)

Base URL defaults to `http://localhost:3000`. An interactive Swagger UI is available at `/docs`.

---

## Authentication

### Session Authentication

Most API endpoints accept session cookies. Authenticate by logging in, and the session cookie (`better-auth.session_token`) is returned automatically.

```bash
# Login and save session cookie
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@example.com", "password": "yourpassword"}' \
  -c cookies.txt

# Use session cookie for authenticated requests
curl http://localhost:3000/api/auth/me -b cookies.txt
```

### API Key Authentication

API keys are prefixed with `catalyst` and are passed in the `Authorization` header as a Bearer token.

```bash
# Create an API key (requires admin session)
curl -X POST http://localhost:3000/api/admin/api-keys \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <session-token>" \
  -d '{"name": "My Script", "permissions": ["server.read", "server.start", "server.stop"]}'

# Use the API key for subsequent requests
curl http://localhost:3000/api/dashboard/stats \
  -H "Authorization: Bearer catalyst_abc123..."
```

API keys can be scoped with specific permissions or granted `allPermissions: true` for full access. Key-specific rate limits can be configured at creation time.

### Agent Authentication

Node agents authenticate using headers on internal endpoints:

| Header | Description |
|--------|-------------|
| `X-Node-Id` | UUID of the node |
| `X-Node-Api-Key` | API key created for the node |

These headers are intentionally excluded from CORS — agent requests are server-to-server only.

---

## Rate Limiting

| Context | Default Limit | Window |
|---------|--------------|--------|
| Global (per IP/user) | 600 requests | 1 minute |
| Auth endpoints | Configurable (default 10) | 1 minute |
| File operations | Configurable (default 30) | 1 minute |
| Console output | Configurable (default 2000 lines) | 1 second |
| Console input | 10 commands | 1 second |
| Agent endpoints | Bypassed (key-authenticated) | — |
| Health check | 10⁹ | 1 minute |

Rate limit headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`) are included in responses. When exceeded, the API returns `429 Too Many Requests`.

---

## Request & Response Format

All request bodies must be JSON (`Content-Type: application/json`). All responses are JSON.

### Standard Response Envelope

```json
{
  "success": true,
  "data": { ... }
}
```

### Error Response

```json
{
  "error": "Error message"
}
```

### Paginated Response

```json
{
  "data": [ ... ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "totalPages": 8
  }
}
```

---

## Error Handling

| Status Code | Meaning |
|-------------|---------|
| `400` | Bad Request — validation error or missing fields |
| `401` | Unauthorized — invalid or missing credentials |
| `403` | Forbidden — insufficient permissions |
| `404` | Not Found — resource does not exist |
| `409` | Conflict — duplicate resource or state conflict |
| `423` | Locked — server is suspended |
| `429` | Too Many Requests — rate limit exceeded |
| `500` | Internal Server Error |

### Error Codes

| Code | Description |
|------|-------------|
| `AUTH_INVALID_TOKEN` | Invalid authentication token |
| `AUTH_EXPIRED` | Token has expired |
| `NODE_NOT_FOUND` | Node does not exist |
| `NODE_OFFLINE` | Node is not reachable |
| `SERVER_NOT_FOUND` | Server does not exist |
| `SERVER_ALREADY_RUNNING` | Server is already running |
| `INSUFFICIENT_RESOURCES` | Not enough node resources |
| `CONTAINER_ERROR` | Container operation failed |
| `NETWORK_ERROR` | Network-related error |
| `FILE_ACCESS_DENIED` | Insufficient file permissions |
| `PERMISSION_DENIED` | User lacks required permission |

---

## Pagination

Paginated endpoints accept query parameters:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | number | `1` | Page number |
| `limit` | number | `20`–`50` | Items per page |
| `search` | string | — | Text search filter |
| `sort` | string | — | Sort field |

---

## Permission System

Catalyst uses a role-based access control (RBAC) system. Permissions are string identifiers organized into categories:

### Permission Categories

| Category | Permissions |
|----------|------------|
| **Administration** | `*`, `admin.read`, `admin.write` |
| **Servers** | `server.read`, `server.create`, `server.start`, `server.stop`, `server.delete`, `server.suspend`, `server.transfer`, `server.schedule` |
| **Nodes** | `node.read`, `node.create`, `node.update`, `node.delete`, `node.view_stats`, `node.manage_allocation`, `node.assign` |
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

The wildcard permission `*` grants all permissions.

---

## API Endpoints

### Health Check

```
GET /health
```

Unauthenticated health check endpoint.

**Response:**

```json
{ "status": "ok", "timestamp": "2026-04-18T21:00:00.000Z" }
```

---

### Authentication Endpoints

All auth endpoints are prefixed with `/api/auth`. Auth routes have separate rate limiting (configurable, default 10 req/min).

#### Register

```
POST /api/auth/register
```

Create a new user account.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `email` | string | ✅ | Email address |
| `username` | string | ✅ | Username (2–32 chars) |
| `password` | string | ✅ | Password (min 8 chars) |

**Response** `201`:

```json
{
  "success": true,
  "data": {
    "userId": "clx...",
    "email": "user@example.com",
    "username": "myuser",
    "role": "user",
    "permissions": [],
    "token": "..."
  }
}
```

#### Login

```
POST /api/auth/login
```

Authenticate with email and password. Supports `rememberMe` for extended sessions.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `email` | string | ✅ | Email address |
| `password` | string | ✅ | Password |
| `rememberMe` | boolean | ❌ | Extended session |

**Response** `200`:

```json
{
  "success": true,
  "data": {
    "userId": "clx...",
    "email": "admin@example.com",
    "username": "admin",
    "role": "administrator",
    "permissions": ["*"],
    "token": "..."
  }
}
```

If two-factor authentication is enabled, returns `202` with `{ twoFactorRequired: true }`.

#### Get Current User

```
GET /api/auth/me
```

Returns the authenticated user's profile, role, and permissions.

#### Forgot Password

```
POST /api/auth/forgot-password
```

| Field | Type | Required |
|-------|------|----------|
| `email` | string | ✅ |

Always returns success to prevent email enumeration.

#### Reset Password

```
POST /api/auth/reset-password
```

| Field | Type | Required |
|-------|------|----------|
| `token` | string | ✅ |
| `password` | string | ✅ |

#### Validate Reset Token

```
GET /api/auth/reset-password/validate?token=<token>
```

#### Sign Out

```
POST /api/auth/sign-out
```

Invalidates the current session.

---

### User Profile

All profile endpoints require authentication.

#### Get Profile

```
GET /api/auth/profile
```

Returns extended profile with security metadata (2FA status, failed login attempts, linked accounts).

#### Update Profile

```
PATCH /api/auth/profile
```

| Field | Type | Description |
|-------|------|-------------|
| `username` | string | New username (2–32 chars) |
| `firstName` | string | First name |
| `lastName` | string | Last name |

#### Change Password

```
POST /api/auth/profile/change-password
```

| Field | Type | Required |
|-------|------|----------|
| `currentPassword` | string | ✅ |
| `newPassword` | string | ✅ |
| `revokeOtherSessions` | boolean | ❌ |

#### Set Password (SSO-only accounts)

```
POST /api/auth/profile/set-password
```

| Field | Type | Required |
|-------|------|----------|
| `newPassword` | string | ✅ |

#### Update Preferences

```
PATCH /api/auth/profile/preferences
```

Accepts any JSON object of key-value preferences.

#### Avatar Upload

```
POST /api/auth/profile/avatar
```

Multipart file upload. Accepted types: JPEG, PNG, GIF, WebP, SVG. Max 2MB.

#### Remove Avatar

```
DELETE /api/auth/profile/avatar
```

#### Resend Email Verification

```
POST /api/auth/profile/resend-verification
```

#### Personal Audit Log

```
GET /api/auth/profile/audit-log?limit=50&offset=0
```

#### Export Account Data (GDPR)

```
GET /api/auth/profile/export
```

Returns a JSON file with all user data (sessions, accounts, API keys, audit logs, server access).

#### User's API Keys Overview

```
GET /api/auth/profile/api-keys
```

Lists API keys owned by the current user.

#### Delete Account

```
POST /api/auth/profile/delete
```

Requires `{ "confirm": "DELETE" }` in the body. Fails if the user owns any servers.

---

### Passkeys & WebAuthn

#### List Passkeys

```
GET /api/auth/profile/passkeys
```

#### Register Passkey (generate options)

```
POST /api/auth/profile/passkeys
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Passkey name |
| `authenticatorAttachment` | string | `"platform"` or `"cross-platform"` |

#### Verify Passkey Registration

```
POST /api/auth/profile/passkeys/verify
```

#### Delete Passkey

```
DELETE /api/auth/profile/passkeys/:id
```

#### Rename Passkey

```
PATCH /api/auth/profile/passkeys/:id
```

---

### Two-Factor Authentication

#### Get 2FA Status

```
GET /api/auth/profile/two-factor
```

#### Enable 2FA

```
POST /api/auth/profile/two-factor/enable
```

| Field | Type | Required |
|-------|------|----------|
| `password` | string | ✅ |

Returns TOTP secret and QR code data.

#### Disable 2FA

```
POST /api/auth/profile/two-factor/disable
```

| Field | Type | Required |
|-------|------|----------|
| `password` | string | ✅ |

#### Generate Backup Codes

```
POST /api/auth/profile/two-factor/generate-backup-codes
```

---

### Sessions

#### List Active Sessions

```
GET /api/auth/profile/sessions
```

#### Revoke Specific Session

```
DELETE /api/auth/profile/sessions/:id
```

#### Revoke All Other Sessions

```
DELETE /api/auth/profile/sessions
```

---

### SSO Account Management

#### List Linked Accounts

```
GET /api/auth/profile/sso/accounts
```

#### Link SSO Account

```
POST /api/auth/profile/sso/link
```

| Field | Type | Required |
|-------|------|----------|
| `providerId` | string | ✅ |

#### Unlink SSO Account

```
POST /api/auth/profile/sso/unlink
```

| Field | Type | Required |
|-------|------|----------|
| `providerId` | string | ✅ |
| `accountId` | string | ❌ |

---

### API Keys

All API key endpoints require the `apikey.manage` permission.

#### Get Permissions Catalog

```
GET /api/admin/api-keys/permissions-catalog
```

Returns all permission categories and their individual permissions for building permission selectors.

#### Get Current User Permissions

```
GET /api/admin/api-keys/my-permissions
```

Returns the authenticated user's effective permissions (used to cap what can be granted to an API key).

#### Create API Key

```
POST /api/admin/api-keys
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | string | ✅ | — | Key name |
| `expiresIn` | number | ❌ | — | TTL in seconds (3600–31536000) |
| `allPermissions` | boolean | ❌ | `false` | Grant all permissions |
| `permissions` | string[] | ❌ | `[]` | Scoped permissions |
| `metadata` | object | ❌ | — | Arbitrary metadata |
| `rateLimitMax` | number | ❌ | `100` | Per-minute rate limit |
| `rateLimitTimeWindow` | number | ❌ | `60000` | Rate limit window (ms) |

**Response** `200`:

```json
{
  "success": true,
  "data": {
    "id": "...",
    "key": "catalyst_abc123...",
    "name": "My Script",
    "prefix": "catalyst_abc1",
    "allPermissions": false,
    "permissions": ["server.read", "server.start"],
    "expiresAt": "2026-05-18T00:00:00.000Z"
  }
}
```

> **Note:** The full API key is only returned once at creation. Store it securely.

#### List API Keys

```
GET /api/admin/api-keys
```

#### Get API Key

```
GET /api/admin/api-keys/:id
```

#### Update API Key

```
PATCH /api/admin/api-keys/:id
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | New name |
| `enabled` | boolean | Enable/disable |

#### Delete API Key

```
DELETE /api/admin/api-keys/:id
```

#### Get API Key Usage

```
GET /api/admin/api-keys/:id/usage
```

Returns request count, remaining quota, last used timestamp, and rate limit info.

---

### Nodes

All node endpoints are prefixed with `/api/nodes` and require authentication.

#### List Nodes

```
GET /api/nodes
```

Permission: `node.read`. Admins see all nodes; non-admins see only nodes they have access to.

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "...",
      "name": "node-1",
      "description": "US East",
      "hostname": "node1.example.com",
      "publicAddress": "192.168.1.100",
      "maxMemoryMb": 32768,
      "maxCpuCores": 16,
      "isOnline": true,
      "lastSeenAt": "2026-04-18T20:00:00.000Z",
      "serverCount": 5,
      "location": { "id": "...", "name": "US East" }
    }
  ]
}
```

#### Get Node Details

```
GET /api/nodes/:nodeId
```

Permission: `node.read`. Includes the node's servers list.

#### Create Node

```
POST /api/nodes
```

Permission: `node.create`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | ✅ | Unique node name |
| `description` | string | ❌ | Description |
| `locationId` | string | ✅ | Location UUID |
| `hostname` | string | ✅ | Agent hostname |
| `publicAddress` | string | ✅ | Public IP or hostname |
| `maxMemoryMb` | number | ✅ | Total available memory |
| `maxCpuCores` | number | ✅ | Total available CPU cores |
| `serverDataDir` | string | ❌ | Custom server data directory |

#### Update Node

```
PUT /api/nodes/:nodeId
```

Permission: `node.update`. All fields from create are optional.

#### Delete Node

```
DELETE /api/nodes/:nodeId
```

Permission: `node.delete`. Fails if the node has running servers.

#### Get Node Statistics

```
GET /api/nodes/:nodeId/stats
```

Permission: `node.view_stats`. Returns resource allocation, real-time metrics from agent, and server counts.

#### Node Heartbeat (Agent)

```
POST /api/nodes/:nodeId/heartbeat
```

Called by the agent. Authenticated via agent API key headers.

| Field | Type | Description |
|-------|------|-------------|
| `health.cpuPercent` | number | CPU usage percentage |
| `health.memoryUsageMb` | number | Used memory in MB |
| `health.memoryTotalMb` | number | Total memory in MB |
| `health.diskUsageMb` | number | Used disk in MB |
| `health.diskTotalMb` | number | Total disk in MB |
| `health.containerCount` | number | Running container count |
| `health.networkRxBytes` | number | Bytes received |
| `health.networkTxBytes` | number | Bytes transmitted |

#### Get Accessible Nodes

```
GET /api/nodes/accessible
```

Returns nodes the current user has access to, including wildcard status.

#### Generate Deployment Token

```
POST /api/nodes/:nodeId/deployment-token
```

Permission: `node.create`. Returns a one-time deployment URL and agent API key.

#### Check Agent API Key

```
GET /api/nodes/:nodeId/api-key
```

Permission: `node.read`. Checks if an agent API key exists for the node.

#### Generate/Regenerate Agent API Key

```
POST /api/nodes/:nodeId/api-key
```

Permission: `node.create`. Body: `{ "regenerate": true }` to regenerate.

---

### Node Allocations

Port allocations for nodes (Pterodactyl-style). All prefixed with `/api/nodes/:nodeId/allocations`.

#### List Allocations

```
GET /api/nodes/:nodeId/allocations?serverId=&search=
```

Permission: `node.manage_allocation`.

#### Create Allocations

```
POST /api/nodes/:nodeId/allocations
```

Permission: `node.manage_allocation`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `ip` | string | ✅ | IP address or CIDR range |
| `ports` | string | ✅ | Port list (e.g., `"25565,25565-25570"`) |
| `alias` | string | ❌ | Allocation alias |
| `notes` | string | ❌ | Notes |

Port ranges support comma-separated values and ranges (e.g., `25565,25570-25580`). CIDR ranges are expanded into individual IPs. Max 5000 allocations per request.

#### Update Allocation

```
PATCH /api/nodes/:nodeId/allocations/:allocationId
```

#### Delete Allocation

```
DELETE /api/nodes/:nodeId/allocations/:allocationId
```

Fails if the allocation is assigned to a server.

#### List IP Pools

```
GET /api/nodes/:nodeId/ip-pools
```

Returns macvlan IP pool information for the node.

#### List Available IPs

```
GET /api/nodes/:nodeId/ip-availability?networkName=<name>&limit=200
```

---

### Node Assignments

Control which users and roles can access specific nodes.

#### Get Node Assignments

```
GET /api/nodes/:nodeId/assignments
```

Permission: `node.assign`.

#### Assign Node to User/Role

```
POST /api/nodes/:nodeId/assign
```

Permission: `node.assign`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `targetType` | string | ✅ | `"user"` or `"role"` |
| `targetId` | string | ✅ | User or role UUID |
| `expiresAt` | string | ❌ | ISO date for expiry |

#### Remove Assignment

```
DELETE /api/nodes/:nodeId/assignments/:assignmentId
```

#### Assign All Nodes (Wildcard)

```
POST /api/nodes/assign-wildcard
```

Permission: `node.assign`. Same body as assign, but with `nodeId: null` (all nodes).

#### Remove Wildcard Assignment

```
DELETE /api/nodes/assign-wildcard/:targetType/:targetId
```

---

### Servers

All server endpoints are prefixed with `/api/servers`.

#### List Servers

```
GET /api/servers
```

Permission: `server.read`. Owners see their servers; admins see all.

Query parameters: `page`, `limit`, `status`, `search`, `owner`.

#### Get Server Details

```
GET /api/servers/:serverId
```

Permission: `server.read` (or ownership/access).

#### Create Server

```
POST /api/servers
```

Permission: `server.create` (or admin/node assignment).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | ✅ | Server name |
| `description` | string | ❌ | Description |
| `templateId` | string | ✅ | Template UUID |
| `nodeId` | string | ✅ | Node UUID |
| `locationId` | string | ✅ | Location UUID |
| `allocatedMemoryMb` | number | ✅ | Memory in MB |
| `allocatedCpuCores` | number | ✅ | CPU cores |
| `allocatedDiskMb` | number | ✅ | Disk in MB |
| `backupAllocationMb` | number | ❌ | Backup storage in MB |
| `databaseAllocation` | number | ❌ | Database allocation in MB |
| `primaryPort` | number | ✅ | Primary game port |
| `primaryIp` | string | ❌ | Primary IP (from IPAM) |
| `allocationId` | string | ❌ | Node allocation UUID |
| `portBindings` | object | ❌ | `{ containerPort: hostPort }` |
| `networkMode` | string | ❌ | `"host"`, `"bridge"`, or custom |
| `environment` | object | ❌ | Environment variables |
| `ownerId` | string | ❌ | Owner UUID (admin only) |

#### Update Server

```
PUT /api/servers/:serverId
```

Permission: Ownership or `server.create`. Supports updating name, description, resources, ports, environment, and networking.

#### Delete Server

```
DELETE /api/servers/:serverId
```

Permission: Ownership or `server.delete`. Server must be stopped.

#### Start Server

```
POST /api/servers/:serverId/start
```

Permission: `server.start`. Sends start command to the agent.

#### Stop Server

```
POST /api/servers/:serverId/stop
```

Permission: `server.stop`.

#### Kill Server

```
POST /api/servers/:serverId/kill
```

Permission: `server.stop`. Force-stops the server.

#### Restart Server

```
POST /api/servers/:serverId/restart
```

Permission: `server.start`.

#### Reinstall Server

```
POST /api/servers/:serverId/reinstall
```

Permission: `server.reinstall`.

#### Rebuild Server

```
POST /api/servers/:serverId/rebuild
```

Permission: `server.rebuild`. Rebuilds container without reinstalling.

#### Suspend Server

```
POST /api/servers/:serverId/suspend
```

Permission: `server.suspend`. Stops the server and prevents operations.

| Field | Type | Description |
|-------|------|-------------|
| `reason` | string | Suspension reason |

#### Unsuspend Server

```
POST /api/servers/:serverId/unsuspend
```

Permission: `server.suspend`.

#### Transfer Server Ownership

```
POST /api/servers/:serverId/transfer
```

Permission: `server.transfer`.

| Field | Type | Required |
|-------|------|----------|
| `newOwnerId` | string | ✅ |

#### Get Effective Permissions

```
GET /api/servers/:serverId/permissions
```

Returns the current user's effective permissions on this server.

#### Server Access Management

```
GET /api/servers/:serverId/access
POST /api/servers/:serverId/access
PATCH /api/servers/:serverId/access/:userId
DELETE /api/servers/:serverId/access/:userId
```

Manage sub-user access to a server with permission presets (`readOnly`, `power`, `full`).

#### Invite User to Server

```
POST /api/servers/:serverId/invite
```

Creates an invite link for a user to join the server with specified permissions.

#### File Operations

All file endpoints operate through the file tunnel to the agent:

```
GET  /api/servers/:serverId/files?path=/
POST /api/servers/:serverId/files/upload
POST /api/servers/:serverId/files/delete
POST /api/servers/:serverId/files/compress
POST /api/servers/:serverId/files/decompress
GET  /api/servers/:serverId/files/download?path=/server.properties
```

Permissions: `file.read` for GET, `file.write` for POST.

#### Mod Manager

```
GET  /api/servers/:serverId/mods/search?provider=modrinth&query=&page=1
GET  /api/servers/:serverId/mods/:provider/:projectId
POST /api/servers/:serverId/mods/:provider/:projectId/versions/:versionId/install
GET  /api/servers/:serverId/mods/installed
DELETE /api/servers/:serverId/mods/installed/:modFileId
```

#### Plugin Manager

```
GET  /api/servers/:serverId/plugins/search?provider=modrinth&query=&page=1
GET  /api/servers/:serverId/plugins/:provider/:projectId
POST /api/servers/:serverId/plugins/:provider/:projectId/versions/:versionId/install
GET  /api/servers/:serverId/plugins/installed
DELETE /api/servers/:serverId/plugins/installed/:pluginFileId
```

#### Database Management

```
GET    /api/servers/:serverId/databases
POST   /api/servers/:serverId/databases
DELETE /api/servers/:serverId/databases/:databaseId
POST   /api/servers/:serverId/databases/:databaseId/rotate-password
```

Permissions: `database.read`, `database.create`, `database.delete`, `database.rotate`.

---

### Server Console (SSE)

#### Console Stream

```
GET /api/servers/:serverId/console/stream
```

Long-lived SSE stream delivering real-time console output. Authenticated via session cookie.

**Events received:**

| Event | Description |
|-------|-------------|
| `connected` | Initial connection confirmation |
| `console_output` | Console line from the server |
| `console_batch` | Batched console lines |
| `server_state_update` | Server status change |
| `server_log` | Server log entry |
| `backup_complete` | Backup finished |
| `eula_required` | EULA acceptance needed |

**Keep-alive:** Heartbeat comment every 25 seconds.

#### Send Console Command

```
POST /api/servers/:serverId/console/command
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `command` | string | ✅ | Command to send (max 4096 chars) |

Permission: `console.write`. Returns `202` on success.

```bash
# Send a command via cURL
curl -X POST http://localhost:3000/api/servers/srv_abc/console/command \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"command": "say Hello World"}'
```

---

### Server Events (SSE)

#### Event Stream

```
GET /api/servers/:serverId/events
```

Per-server event stream for state changes, backups, alerts, and more.

```
GET /api/servers/all-servers/events
```

Global event stream for all servers the user can access.

**Events received:**

| Event | Description |
|-------|-------------|
| `server_state_update` | Server status changed |
| `backup_complete` | Backup created |
| `backup_restore_complete` | Backup restored |
| `backup_delete_complete` | Backup deleted |
| `eula_required` | EULA needs acceptance |
| `alert` | Alert triggered |
| `server_log` | Server log entry |
| `task_progress` | Scheduled task progress |
| `task_complete` | Task completed |
| `resource_stats` | Resource usage update |
| `storage_resize_complete` | Storage resized |
| `user_created` | New user registered |
| `user_deleted` | User deleted |

---

### Server Metrics (SSE)

#### Metrics Stream

```
GET /api/servers/:serverId/metrics/stream
```

Long-lived SSE stream delivering real-time resource metrics.

**Events received:**

| Event | Description |
|-------|-------------|
| `resource_stats` | CPU, memory, disk, network stats |
| `storage_resize_complete` | Storage resize notification |

---

### Server Backups

All backup endpoints are prefixed with `/api/servers/:serverId/backups`.

#### Create Backup

```
POST /api/servers/:serverId/backups
```

Permission: `backup.create`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | ❌ | Backup name (auto-generated if omitted) |

Requires the node to be online. Supports local, S3, and SFTP storage modes.

#### List Backups

```
GET /api/servers/:serverId/backups?limit=50&page=1
```

Permission: `backup.read`.

#### Get Backup

```
GET /api/servers/:serverId/backups/:backupId
```

#### Restore Backup

```
POST /api/servers/:serverId/backups/:backupId/restore
```

Permission: `backup.restore`. Server must be stopped.

#### Delete Backup

```
DELETE /api/servers/:serverId/backups/:backupId
```

Permission: `backup.delete`.

#### Download Backup

```
GET /api/servers/:serverId/backups/:backupId/download
```

Permission: `backup.read`. Returns the backup as a `.tar.gz` file.

---

### Scheduled Tasks

All task endpoints are prefixed with `/api/servers/:serverId/tasks`.

#### Create Task

```
POST /api/servers/:serverId/tasks
```

Permission: `server.schedule`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | ✅ | Task name |
| `description` | string | ❌ | Description |
| `action` | string | ✅ | `start`, `stop`, `restart`, `backup`, `command` |
| `payload` | object | ❌ | Action-specific payload |
| `schedule` | string | ✅ | Cron expression (e.g., `"0 3 * * *"`) |

For `command` actions, include `{ "command": "say Restarting..." }` in `payload`.

#### List Tasks

```
GET /api/servers/:serverId/tasks
```

#### Get Task

```
GET /api/servers/:serverId/tasks/:taskId
```

#### Update Task

```
PUT /api/servers/:serverId/tasks/:taskId
```

#### Delete Task

```
DELETE /api/servers/:serverId/tasks/:taskId
```

#### Execute Task Immediately

```
POST /api/servers/:serverId/tasks/:taskId/execute
```

---

### Templates

All template endpoints are prefixed with `/api/templates`.

#### List Templates

```
GET /api/templates
```

Permission: `template.read`.

#### Get Template

```
GET /api/templates/:templateId
```

#### Create Template

```
POST /api/templates
```

Permission: `template.create`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | ✅ | Template name |
| `description` | string | ❌ | Description |
| `author` | string | ✅ | Author |
| `version` | string | ✅ | Version |
| `image` | string | ✅ | Container image |
| `images` | array | ❌ | Alternative images |
| `defaultImage` | string | ❌ | Default image name |
| `installImage` | string | ❌ | Installation image |
| `startup` | string | ✅ | Startup command |
| `stopCommand` | string | ✅ | Stop command |
| `sendSignalTo` | string | ✅ | `SIGTERM`, `SIGINT`, or `SIGKILL` |
| `variables` | array | ✅ | Environment variable definitions |
| `installScript` | string | ❌ | Install script |
| `supportedPorts` | number[] | ✅ | Supported ports |
| `allocatedMemoryMb` | number | ✅ | Default memory |
| `allocatedCpuCores` | number | ✅ | Default CPU cores |
| `features` | object | ❌ | Feature flags |

#### Update Template

```
PUT /api/templates/:templateId
```

Permission: `template.update`.

#### Delete Template

```
DELETE /api/templates/:templateId
```

Permission: `template.delete`. Fails if the template is in use by any server.

#### Import Pterodactyl Egg

```
POST /api/templates/import-pterodactyl
```

Permission: `template.create`. Accepts a full Pterodactyl egg JSON as the body.

| Field | Type | Required |
|-------|------|----------|
| *(Pterodactyl egg fields)* | object | ✅ |
| `nestId` | string | ❌ |

---

### Nests

All nest endpoints are prefixed with `/api/nests`.

#### List Nests

```
GET /api/nests
```

Permission: `template.read`. Includes template count.

#### Get Nest

```
GET /api/nests/:nestId
```

Includes all templates in the nest.

#### Create Nest

```
POST /api/nests
```

Admin only.

| Field | Type | Required |
|-------|------|----------|
| `name` | string | ✅ |
| `description` | string | ❌ |
| `icon` | string | ❌ |
| `author` | string | ❌ |

#### Update Nest

```
PUT /api/nests/:nestId
```

Admin only.

#### Delete Nest

```
DELETE /api/nests/:nestId
```

Admin only. Disconnects templates from the nest before deleting.

---

### Roles

All role endpoints are prefixed with `/api/roles`.

#### List Roles

```
GET /api/roles
```

Permission: `role.read`. Includes user count.

#### Get Role

```
GET /api/roles/:roleId
```

Includes all users assigned to the role.

#### Create Role

```
POST /api/roles
```

Permission: `role.create`.

| Field | Type | Required |
|-------|------|----------|
| `name` | string | ✅ |
| `description` | string | ❌ |
| `permissions` | string[] | ✅ |

#### Update Role

```
PUT /api/roles/:roleId
```

Permission: `role.update`.

#### Delete Role

```
DELETE /api/roles/:roleId
```

Permission: `role.delete`. Fails if the role has assigned users.

#### Add Permission to Role

```
POST /api/roles/:roleId/permissions
```

Permission: `role.update`. Body: `{ "permission": "server.start" }`.

#### Remove Permission from Role

```
DELETE /api/roles/:roleId/permissions/<permission>
```

Permission: `role.update`.

#### Assign Role to User

```
POST /api/roles/:roleId/users/:userId
```

Permission: `user.set_roles`.

#### Remove Role from User

```
DELETE /api/roles/:roleId/users/:userId
```

Permission: `user.set_roles`.

#### Get User Roles

```
GET /api/roles/users/:userId/roles
```

Permission: `user.read`. Returns roles and aggregated permissions.

#### Get User Nodes

```
GET /api/roles/users/:userId/nodes
```

Returns nodes accessible to a user (direct assignments, role-based, and wildcard).

#### Get Role Nodes

```
GET /api/roles/:roleId/nodes
```

Permission: `node.read`. Returns nodes assigned to a role.

#### Get Role Presets

```
GET /api/roles/presets
```

Permission: `role.read`. Returns built-in permission presets.

---

### Alert Rules

All alert rule endpoints are prefixed with `/api/alert-rules`.

#### Create Alert Rule

```
POST /api/alert-rules
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | ✅ | Rule name |
| `description` | string | ❌ | Description |
| `type` | string | ✅ | `resource_threshold`, `node_offline`, `server_crashed` |
| `target` | string | ✅ | `server`, `node`, `global` |
| `targetId` | string | conditional | Required for `server` and `node` targets |
| `conditions` | object | ✅ | Threshold conditions |
| `actions` | object | ✅ | Alert actions |
| `enabled` | boolean | ❌ | Default: `true` |

#### List Alert Rules

```
GET /api/alert-rules?type=&enabled=&scope=mine&target=&targetId=
```

#### Get Alert Rule

```
GET /api/alert-rules/:ruleId
```

#### Update Alert Rule

```
PUT /api/alert-rules/:ruleId
```

#### Delete Alert Rule

```
DELETE /api/alert-rules/:ruleId
```

---

### Alerts

All alert endpoints are prefixed with `/api/alerts`.

#### List Alerts

```
GET /api/alerts?page=1&limit=50&serverId=&nodeId=&type=&severity=&resolved=&scope=mine
```

#### Get Alert

```
GET /api/alerts/:alertId
```

#### Resolve Alert

```
POST /api/alerts/:alertId/resolve
```

#### Bulk Resolve Alerts

```
POST /api/alerts/bulk-resolve
```

Body: `{ "alertIds": ["id1", "id2"] }`.

#### Get Alert Deliveries

```
GET /api/alerts/:alertId/deliveries
```

#### Get Alert Statistics

```
GET /api/alerts/stats?scope=mine
```

Returns counts by severity and type.

---

### Dashboard

All dashboard endpoints are prefixed with `/api/dashboard`.

#### Dashboard Statistics

```
GET /api/dashboard/stats
```

Returns server counts, node counts, and alert counts based on user permissions.

#### Recent Activity

```
GET /api/dashboard/activity?limit=5
```

Returns recent audit log entries formatted as activity feed items.

#### Resource Utilization

```
GET /api/dashboard/resources
```

Returns aggregate CPU, memory, and network utilization across all online nodes.

---

### SFTP

All SFTP endpoints are prefixed with `/api/sftp`.

#### Get Connection Info

```
GET /api/sftp/connection-info?serverId=<id>&ttl=<ms>
```

Generates an SFTP token for connecting to a server.

**Response:**

```json
{
  "success": true,
  "data": {
    "enabled": true,
    "host": "panel.example.com",
    "port": 2022,
    "sftpPassword": "token_abc...",
    "expiresAt": "2026-04-18T22:00:00.000Z",
    "ttlMs": 3600000,
    "ttlOptions": [
      { "label": "1 Hour", "value": 3600000 },
      { "label": "6 Hours", "value": 21600000 },
      { "label": "24 Hours", "value": 86400000 }
    ]
  }
}
```

#### Rotate Token

```
POST /api/sftp/rotate-token
```

Body: `{ "serverId": "...", "ttlMs": 3600000 }`.

#### List SFTP Tokens

```
GET /api/sftp/tokens?serverId=<id>
```

Owners see all tokens; non-owners see only their own.

#### Revoke SFTP Token

```
DELETE /api/sftp/tokens/:targetUserId?serverId=<id>
```

#### Revoke All SFTP Tokens

```
DELETE /api/sftp/tokens?serverId=<id>
```

Owner only.

---

### Admin

All admin endpoints are prefixed with `/api/admin`.

#### System Statistics

```
GET /api/admin/stats
```

Returns user, server, node, and active server counts.

#### User Management

```
GET    /api/admin/users?page=1&limit=20&search=
POST   /api/admin/users
PUT    /api/admin/users/:userId
POST   /api/admin/users/:userId/delete
GET    /api/admin/users/:userId/servers
```

Permissions: `user.read`, `user.create`, `user.update`, `user.delete`.

**Create user** accepts: `email`, `username`, `password`, `roleIds[]`, `serverIds[]`, `serverPermissions[]`.

**Delete user** accepts: `{ "force": true, "transferToUserId": "..." }` to auto-transfer owned servers.

#### Bulk Server Actions

```
POST /api/admin/servers/actions
```

Body:

```json
{
  "serverIds": ["id1", "id2"],
  "action": "start",
  "reason": "Scheduled maintenance"
}
```

Supported actions: `start`, `stop`, `kill`, `restart`, `suspend`, `unsuspend`, `delete`.

#### Security Settings

```
GET /api/admin/security-settings
PUT /api/admin/security-settings
```

Permission: `admin.read` / `admin.write`.

#### SMTP Settings

```
GET /api/admin/smtp-settings
PUT /api/admin/smtp-settings
```

#### Mod Manager Settings

```
GET /api/admin/mod-manager-settings
PUT /api/admin/mod-manager-settings
```

#### Audit Logs

```
GET /api/admin/audit-logs?page=1&limit=50&userId=&action=&resource=&from=&to=
GET /api/admin/audit-logs/export?format=csv
```

Permission: `admin.read` for listing, `admin.write` for export.

#### Admin Events (SSE)

```
GET /api/admin/events
```

SSE stream for real-time admin events (user changes, template changes, alerts, etc.).

---

### Plugins

All plugin endpoints are prefixed with `/api/plugins`. All require admin access.

#### List Plugins

```
GET /api/plugins
```

#### Get Plugin

```
GET /api/plugins/:name
```

Includes registered routes, WebSocket handlers, and scheduled tasks.

#### Enable/Disable Plugin

```
POST /api/plugins/:name/enable
```

Body: `{ "enabled": true }`.

#### Reload Plugin

```
POST /api/plugins/:name/reload
```

Hot-reloads the plugin from disk.

#### Update Plugin Config

```
PUT /api/plugins/:name/config
```

Body: `{ "config": { "key": "value" } }`.

#### Get Frontend Manifest

```
GET /api/plugins/:name/frontend-manifest
```

---

### Migration (Pterodactyl)

All migration endpoints are prefixed with `/api/admin/migration`. All require `admin.write`.

#### List Catalyst Nodes

```
GET /api/admin/migration/catalyst-nodes
```

Returns online nodes with memory usage for migration target selection.

#### Test Pterodactyl Connection

```
POST /api/admin/migration/test
```

Body: `{ "url": "https://panel.example.com", "key": "ptla_...", "clientApiKey": "ptlc_..." }`.

#### Start Migration

```
POST /api/admin/migration/start
```

Body:

```json
{
  "url": "https://pterodactyl.example.com",
  "key": "ptla_...",
  "clientApiKey": "ptlc_...",
  "scope": "full",
  "nodeMappings": { "ptero_node_1": "catalyst_node_1" },
  "serverMappings": {}
}
```

Scopes: `full` (nodes + servers + files), `node` (node config only), `server` (individual servers).

#### List Migration Jobs

```
GET /api/admin/migration
```

#### Get Migration Status

```
GET /api/admin/migration/:jobId
```

#### Control Migration

```
POST /api/admin/migration/:jobId/pause
POST /api/admin/migration/:jobId/resume
POST /api/admin/migration/:jobId/cancel
```

#### Get Migration Steps

```
GET /api/admin/migration/:jobId/steps?phase=&status=&page=1&limit=50
```

#### Retry Failed Step

```
POST /api/admin/migration/:jobId/retry/:stepId
```

---

### Theme Settings

#### Get Public Theme Settings

```
GET /api/theme-settings/public
```

Unauthenticated. Returns panel name, logo, colors, enabled themes, and configured OAuth providers.

---

## WebSocket API

### Connection

```
ws://localhost:3000/ws
```

Connect to the WebSocket gateway for bidirectional real-time communication.

**Connection limits:** Max 1000 agent connections, 5000 client connections, 50 per user.

### Client-to-Server Messages

#### Server Control

```json
{
  "type": "start_server",
  "serverId": "srv_abc"
}
```

| Type | Description |
|------|-------------|
| `start_server` | Start a server |
| `stop_server` | Stop a server |
| `kill_server` | Force-stop a server |
| `restart_server` | Restart a server |
| `console_input` | Send console command |

#### Console Input

```json
{
  "type": "console_input",
  "serverId": "srv_abc",
  "data": "say Hello World\n"
}
```

### Server-to-Client Messages

#### Console Output

```json
{
  "type": "console_output",
  "serverId": "srv_abc",
  "timestamp": 1713500000000,
  "data": "[INFO] Hello World",
  "stream": "stdout"
}
```

#### Server State Update

```json
{
  "type": "server_state_update",
  "serverId": "srv_abc",
  "state": "running",
  "timestamp": 1713500000000,
  "reason": null,
  "portBindings": { "25565": 25565 },
  "exitCode": null
}
```

#### Health Report

```json
{
  "type": "health_report",
  "nodeId": "node_abc",
  "health": {
    "cpuPercent": 45.2,
    "memoryUsageMb": 8192,
    "memoryTotalMb": 32768,
    "uptime": 86400,
    "containerCount": 5,
    "diskUsageMb": 102400,
    "diskTotalMb": 512000
  },
  "timestamp": 1713500000000
}
```

#### File Operation Response

```json
{
  "type": "file_operation_response",
  "requestId": "req_abc",
  "success": true,
  "data": { ... },
  "error": null
}
```

#### Resource Stats

```json
{
  "type": "resource_stats",
  "serverId": "srv_abc",
  "cpuPercent": 12.5,
  "memoryUsageMb": 1024,
  "memoryLimitMb": 4096,
  "diskUsageMb": 500,
  "networkRxBytes": 1024000,
  "networkTxBytes": 512000,
  "timestamp": 1713500000000
}
```

### Agent-to-Backend Messages

Agents connect via WebSocket and send heartbeat, console output, and status updates. Agent authentication uses the `node_handshake` message type with `token` and `nodeId` fields.

---

## SSE Streaming

### Console Stream

```bash
curl -N http://localhost:3000/api/servers/srv_abc/console/stream \
  -b cookies.txt
```

Events: `connected`, `console_output`, `console_batch`, `server_state_update`, `server_log`, `backup_complete`, `eula_required`.

### Event Stream

```bash
curl -N http://localhost:3000/api/servers/srv_abc/events \
  -b cookies.txt

# Global stream for all servers
curl -N http://localhost:3000/api/servers/all-servers/events \
  -b cookies.txt
```

Events: `server_state_update`, `backup_complete`, `backup_restore_complete`, `backup_delete_complete`, `eula_required`, `alert`, `server_log`, `task_progress`, `task_complete`, `resource_stats`, `storage_resize_complete`, `user_created`, `user_deleted`.

### Metrics Stream

```bash
curl -N http://localhost:3000/api/servers/srv_abc/metrics/stream \
  -b cookies.txt
```

Events: `resource_stats`, `storage_resize_complete`.

---

## Quick Reference Examples

### cURL

```bash
# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"secret"}' \
  -c cookies.txt

# Create an API key
API_KEY=$(curl -s -X POST http://localhost:3000/api/admin/api-keys \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"name":"automation","allPermissions":true}' | jq -r '.data.key')

# List all servers
curl http://localhost:3000/api/servers \
  -H "Authorization: Bearer $API_KEY"

# Start a server
curl -X POST http://localhost:3000/api/servers/srv_abc/start \
  -H "Authorization: Bearer $API_KEY"

# Send console command
curl -X POST http://localhost:3000/api/servers/srv_abc/console/command \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"command":"say Welcome!"}'

# Create a backup
curl -X POST http://localhost:3000/api/servers/srv_abc/backups \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"name":"pre-update-backup"}'
```

### Python

```python
import requests

BASE = "http://localhost:3000"
s = requests.Session()

# Login
r = s.post(f"{BASE}/api/auth/login", json={
    "email": "admin@example.com",
    "password": "secret"
})
print(f"Logged in as {r.json()['data']['username']}")

# List servers
servers = s.get(f"{BASE}/api/servers").json()
for server in servers.get("data", []):
    print(f"  {server['name']} - {server['status']}")

# Start a server
server_id = servers["data"][0]["id"]
s.post(f"{BASE}/api/servers/{server_id}/start")
print(f"Started {server_id}")

# Create backup
r = s.post(f"{BASE}/api/servers/{server_id}/backups",
           json={"name": "auto-backup"})
print(f"Backup: {r.json()}")
```

### Node.js

```javascript
const BASE = "http://localhost:3000";

async function api(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.CATALYST_API_KEY}`,
    },
    ...options,
  });
  return res.json();
}

// List servers
const { data: servers } = await api("/api/servers");
console.log(servers.map(s => `${s.name}: ${s.status}`));

// Start first server
await api(`/api/servers/${servers[0].id}/start`, { method: "POST" });

// Send console command
await api(`/api/servers/${servers[0].id}/console/command`, {
  method: "POST",
  body: JSON.stringify({ command: "list" }),
});
```
