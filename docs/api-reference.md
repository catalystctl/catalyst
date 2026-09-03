---
title: API Reference
description: Complete reference for all Catalyst REST API endpoints, WebSocket protocol, SSE streams, and authentication methods.
---

# Catalyst API Reference

> **Base URL:** `https://your-domain.com/api`  
> **Version:** `1.0.0`  
> **Auth:** Session cookie, API key (`Bearer catalyst...`), or Agent header auth

All responses follow a consistent JSON envelope:

```json
{
  "success": true,
  "data": { /* response payload */ },
  "message": "optional human message"
}
```

Error responses omit `data`:

```json
{
  "error": "Human-readable error message",
  "details": [
    { "field": "email", "message": "Invalid email format" }
  ]
}
```

## Table of Contents

- [Authentication](#authentication)
  - [Session Authentication](#session-authentication)
  - [API Key Authentication](#api-key-authentication)
  - [Agent Authentication](#agent-authentication)
- [REST Endpoints](#rest-endpoints)
  - [Authentication Endpoints](#authentication-endpoints)
  - [User Profile](#user-profile)
  - [Server Management](#server-management)
    - [Core Server Routes](#core-server-routes)
    - [Server Power Operations](#server-power-operations)
    - [Server File Operations](#server-file-operations)
    - [Server Network](#server-network)
    - [Server Databases](#server-databases)
    - [Server Invites & Access](#server-invites--access)
    - [Server Variables](#server-variables)
    - [Server Stats](#server-stats)
    - [Server Mod & Plugin Manager](#server-mod--plugin-manager)
    - [Server Admin Operations](#server-admin-operations)
    - [Server Bulk Operations](#server-bulk-operations)
    - [Server Console & Streaming](#server-console--streaming)
    - [Server Backups](#server-backups)
  - [Node Management](#node-management)
  - [Admin Operations](#admin-operations)
  - [Role Management](#role-management)
  - [Template & Nest Management](#template--nest-management)
  - [Location Management](#location-management)
  - [Alert Management](#alert-management)
  - [Scheduled Tasks](#scheduled-tasks)
  - [Plugin Management](#plugin-management)
  - [API Key Management](#api-key-management)
  - [Migration](#migration)
  - [Dashboard & Metrics](#dashboard--metrics)
  - [File Tunnel Protocol](#file-tunnel-protocol)
  - [SFTP Tokens](#sftp-tokens)
  - [Agent Endpoints](#agent-endpoints)
  - [Setup Wizard](#setup-wizard)
  - [Public Endpoints](#public-endpoints)
- [WebSocket Gateway](#websocket-gateway)
- [SSE Streams](#sse-streams)
- [Rate Limiting](#rate-limiting)
- [Pagination](#pagination)
- [Error Responses](#error-responses)

---

## Authentication

### Session Authentication

All `/api/*` endpoints (except those marked `unauthenticated`) require session authentication. Sessions are managed via **Better Auth v1.6.9** with secure HTTP-only cookies.

```http
Cookie: better-auth.session_token=<session-token>
```

The session cookie is automatically sent by the frontend SPA. For API clients, extract the session token from `set-auth-token` header after login.

### API Key Authentication

Use the `Authorization` header with a bearer token:

```http
Authorization: Bearer catalyst_xxxxxxxxxxxxxxxxxxxxxxxx
```

API keys follow the format `catalyst_<base64>`. They are scoped to specific permissions and can expire.

**Key properties:**
- `id` — unique identifier
- `name` — human-readable label
- `prefix` — `catalyst`
- `start` — first 8 characters (safe to display)
- `enabled` — whether the key is active
- `allPermissions` — key may use the **full set of the creator/user’s live permissions** (not a synthetic superuser `*` if the user lacks `*`)
- `permissions` — array of specific permission strings
- `expiresAt` — optional expiration date
- `rateLimitMax` — requests per window (default 100)
- `rateLimitTimeWindow` — window in ms (default 60000)
- `lastRequest` — timestamp of last use
- `requestCount` — total requests made
- `metadata` — arbitrary key-value pairs

### Agent Authentication

The agent binary on server nodes authenticates using one of the following methods:

**Primary method (used in code):**
```http
X-Node-Id: <node-uuid>
X-Node-Api-Key: <node-api-key>
```

**Legacy Catalyst headers (also accepted):**
```http
X-Catalyst-Node-Id: <node-uuid>
X-Catalyst-Node-Token: <api-key>
```

**Authorization header:**
```http
Authorization: Bearer <node-api-key>
```

Agent endpoints bypass global rate limiting when valid credentials are provided.

---

## REST Endpoints

### Authentication Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/auth/register` | No | Register a new account |
| `POST` | `/api/auth/login` | No | Authenticate with email/password |
| `GET` | `/api/auth/me` | Session | Get current user profile summary |
| `GET` | `/api/auth/profile` | Session | Detailed user profile |
| `PATCH` | `/api/auth/profile` | Session | Update profile (username, firstName, lastName) |
| `PATCH` | `/api/auth/profile/preferences` | Session | Update user preferences |
| `POST` | `/api/auth/profile/change-password` | Session | Change current password |
| `POST` | `/api/auth/profile/set-password` | Session | Set password for SSO-only accounts |
| `POST` | `/api/auth/profile/avatar` | Session | Upload avatar image |
| `DELETE` | `/api/auth/profile/avatar` | Session | Remove avatar |
| `POST` | `/api/auth/profile/delete` | Session | Delete own account |
| `GET` | `/api/auth/profile/two-factor` | Session | Get 2FA status |
| `POST` | `/api/auth/profile/two-factor/enable` | Session | Enable TOTP 2FA |
| `POST` | `/api/auth/profile/two-factor/disable` | Session | Disable TOTP 2FA |
| `POST` | `/api/auth/profile/two-factor/generate-backup-codes` | Session | Generate backup codes |
| `GET` | `/api/auth/profile/passkeys` | Session | List registered passkeys |
| `POST` | `/api/auth/profile/passkeys` | Session | Start passkey registration |
| `POST` | `/api/auth/profile/passkeys/verify` | Session | Verify passkey registration |
| `PATCH` | `/api/auth/profile/passkeys/:id` | Session | Rename passkey |
| `DELETE` | `/api/auth/profile/passkeys/:id` | Session | Delete passkey |
| `GET` | `/api/auth/profile/sso/accounts` | Session | List linked SSO accounts |
| `POST` | `/api/auth/profile/sso/link` | Session | Link SSO account |
| `POST` | `/api/auth/profile/sso/unlink` | Session | Unlink SSO account |
| `GET` | `/api/auth/profile/sessions` | Session | List active sessions |
| `DELETE` | `/api/auth/profile/sessions/:id` | Session | Revoke a session |
| `DELETE` | `/api/auth/profile/sessions` | Session | Revoke all other sessions |
| `GET` | `/api/auth/profile/audit-log` | Session | Personal audit log |
| `GET` | `/api/auth/profile/export` | Session | GDPR account data export |
| `GET` | `/api/auth/profile/api-keys` | Session | List user's API keys |
| `POST` | `/api/auth/profile/resend-verification` | Session | Resend email verification |
| `POST` | `/api/auth/forgot-password` | No | Request password reset email |
| `GET` | `/api/auth/reset-password/validate` | No | Validate reset token |
| `POST` | `/api/auth/reset-password` | No | Reset password with token |

#### POST `/api/auth/register`

Register a new account. Sends a welcome email.

**Body:**
```json
{
  "email": "user@example.com",
  "username": "johndoe",
  "password": "securepassword123"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "userId": "...",
    "email": "user@example.com",
    "username": "johndoe",
    "role": "user",
    "permissions": ["server.read", "server.start", ...],
    "token": "set-auth-token-value"
  }
}
```

#### POST `/api/auth/login`

Authenticate and create a session. Handles 2FA redirect.

**Body:**
```json
{
  "email": "user@example.com",
  "password": "password",
  "rememberMe": false
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "userId": "...",
    "email": "...",
    "username": "...",
    "role": "user",
    "permissions": [...],
    "token": "set-auth-token-value"
  }
}
```

**Response (202 — 2FA required):**
```json
{
  "success": false,
  "data": { "twoFactorRequired": true, "token": "..." }
}
```

#### GET `/api/auth/me`

Get the current authenticated user's profile summary.

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "...",
    "email": "...",
    "username": "...",
    "name": "...",
    "firstName": "...",
    "lastName": "...",
    "image": "...",
    "role": "user",
    "permissions": ["server.read", "server.start", ...],
    "createdAt": "2024-01-01T00:00:00Z"
  }
}
```

#### PATCH `/api/auth/profile`

Update profile fields.

**Body:**
```json
{
  "username": "newname",
  "firstName": "John",
  "lastName": "Doe"
}
```

#### POST `/api/auth/profile/set-password`

Set password for accounts created via SSO/OAuth that don't yet have a password.

**Auth:** Session  
**Body:**
```json
{
  "newPassword": "newSecurePassword123"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "message": "Password set successfully"
  }
}
```

**Errors:**
- `400` — Password does not meet minimum complexity requirements
- `409` — Account already has a password set

#### POST `/api/auth/profile/change-password`

Change the current user's password. Optionally revokes all other active sessions.

**Auth:** Session  
**Body:**
```json
{
  "currentPassword": "oldPassword123",
  "newPassword": "newSecurePassword123",
  "revokeOtherSessions": false
}
```

The `revokeOtherSessions` field is optional (default `false`). When `true`, all other active sessions are invalidated after the password change.

**Response (200):**
```json
{
  "success": true,
  "data": {
    "message": "Password changed successfully"
  }
}
```

**Errors:**
- `400` — Current password is incorrect or new password does not meet complexity requirements

#### GET `/api/auth/profile/two-factor`

Get the current user's two-factor authentication (TOTP) status.

**Auth:** Session  
**Response (200):**
```json
{
  "success": true,
  "data": {
    "twoFactorEnabled": true
  }
}
```

#### POST `/api/auth/profile/passkeys`

Start a passkey (WebAuthn) registration flow. Returns challenge data for the browser to use with `navigator.credentials.create()`.

**Auth:** Session  
**Body:**
```json
{
  "name": "My Security Key",
  "authenticatorAttachment": "cross-platform"
}
```

Both fields are optional. `authenticatorAttachment` can be `"platform"` (device-bound, e.g. Touch ID) or `"cross-platform"` (roaming, e.g. YubiKey).

**Response (200):**
```json
{
  "success": true,
  "data": {
    "challenge": "base64-encoded-challenge",
    "rp": { "name": "Catalyst", "id": "panel.example.com" },
    "user": { "id": "base64-encoded-user-id", "name": "johndoe", "displayName": "John Doe" },
    "pubKeyCredParams": [{ "type": "public-key", "alg": -7 }],
    "timeout": 60000,
    "excludeCredentials": [],
    "authenticatorSelection": { "authenticatorAttachment": "cross-platform", "residentKey": "preferred", "userVerification": "preferred" },
    "attestation": "none"
  }
}
```

**Errors:**
- `400` — Passkey registration is not supported or misconfigured

Verify a passkey registration flow. Called after the browser's WebAuthn dialog completes.

**Auth:** Session  
**Body:**
```json
{
  "credential": {
    "id": "base64-encoded-credential-id",
    "rawId": "base64-encoded-raw-id",
    "response": {
      "clientDataJSON": "base64-encoded-client-data",
      "attestationObject": "base64-encoded-attestation"
    },
    "type": "public-key",
    "authenticatorAttachment": "cross-platform"
  }
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "verified": true,
    "passkey": {
      "id": "pk_xxx",
      "name": "My Security Key",
      "createdAt": "2024-01-01T00:00:00Z"
    }
  }
}
```

**Errors:**
- `400` — Invalid or expired credential

#### PATCH `/api/auth/profile/passkeys/:id`

Rename an existing passkey.

**Auth:** Session  
**Body:**
```json
{
  "name": "Updated Name"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "pk_xxx",
    "name": "Updated Name",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
}
```

**Errors:**
- `404` — Passkey not found

#### GET `/api/auth/profile/sso/accounts`

List all SSO/OAuth accounts linked to the current user.

**Auth:** Session  
**Response (200):**
```json
{
  "success": true,
  "data": {
    "accounts": [
      {
        "provider": "google",
        "providerAccountId": "112233445566",
        "createdAt": "2024-01-01T00:00:00Z"
      },
      {
        "provider": "github",
        "providerAccountId": "998877",
        "createdAt": "2024-02-01T00:00:00Z"
      }
    ]
  }
}
```

#### POST `/api/auth/profile/sso/link`

Link a new SSO/OAuth account to the current user. Initiates an OAuth authorization flow on the backend and returns a redirect URL for the client to open.

**Auth:** Session  
**Body:**
```json
{
  "providerId": "google"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "url": "https://accounts.google.com/o/oauth2/auth?client_id=...&redirect_uri=...&scope=...",
    "redirect": true
  }
}
```

**Errors:**
- `400` — Invalid or unsupported provider ID
- `409` — Account already linked to another user

#### POST `/api/auth/profile/sso/unlink`

Unlink an SSO/OAuth account. Prevents unlinking the only remaining sign-in method for the account.

**Auth:** Session  
**Body:**
```json
{
  "providerId": "google",
  "accountId": "optional-specific-account-id"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "unlinked": true
  }
}
```

**Errors:**
- `400` — Cannot unlink only sign-in method
- `404` — Provider not linked

#### DELETE `/api/auth/profile/sessions`

Revoke all other sessions, keeping only the current session. Useful for "Log out of all other devices."

**Auth:** Session  
**Body (optional):**
```json
{
  "keepCurrent": true
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "revoked": 5,
    "message": "5 sessions revoked"
  }
}
```

#### PATCH `/api/auth/profile/preferences`

Update user preferences. Arbitrary JSON object, max 16KB. Stored in the user profile.

**Auth:** Session  
**Body:**
```json
{
  "preferences": {
    "theme": "dark",
    "language": "en",
    "notifications": {
      "email": true,
      "webhook": false,
      "serverStart": true,
      "serverStop": false
    }
  }
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "preferences": {
      "theme": "dark",
      "language": "en",
      "notifications": {
        "email": true,
        "webhook": false
      }
    }
  }
}
```

**Errors:**
- `400` — Preferences exceed 16KB limit

#### DELETE `/api/auth/profile/avatar`

Remove the user's avatar image.

**Auth:** Session  
**Response (200):**
```json
{
  "success": true,
  "data": {
    "avatarRemoved": true
  }
}
```

#### POST `/api/auth/profile/resend-verification`

Resend the email verification link. Rate-limited to 3 requests per hour.

**Auth:** Session  
**Response (200):**
```json
{
  "success": true,
  "data": {
    "message": "Verification email sent. Check your inbox."
  }
}
```

**Errors:**
- `429` — Rate limit exceeded (3/hour)

#### GET `/api/auth/profile/audit-log`

Retrieve the user's personal audit log. Shows account-related events with pagination.

**Auth:** Session  
**Query params:**
- `limit` — number of events to return (default 20, max 100)
- `offset` — pagination offset (default 0)

**Response (200):**
```json
{
  "success": true,
  "data": {
    "events": [
      {
        "id": "evt_xxx",
        "action": "login",
        "timestamp": "2024-01-01T12:00:00Z",
        "ipAddress": "192.168.1.1",
        "userAgent": "Mozilla/5.0...",
        "metadata": {
          "method": "password",
          "twoFactorUsed": true
        }
      },
      {
        "id": "evt_yyy",
        "action": "password_change",
        "timestamp": "2024-01-02T10:00:00Z",
        "ipAddress": "192.168.1.1",
        "userAgent": "Mozilla/5.0..."
      }
    ],
    "total": 150,
    "limit": 20,
    "offset": 0
  }
}
```

#### GET `/api/auth/profile/export`

Export all user data as an inline JSON response. Includes profile, sessions, accounts, API keys, audit log, and server information.

**Auth:** Session  
**Response (200):**
```json
{
  "success": true,
  "data": {
    "profile": {
      "id": "user_xxx",
      "email": "user@example.com",
      "username": "johndoe",
      "name": "John Doe",
      "firstName": "John",
      "lastName": "Doe",
      "image": null,
      "role": "user",
      "permissions": ["server.read", "server.start"],
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-02T00:00:00Z"
    },
    "sessions": [
      {
        "id": "sess_xxx",
        "createdAt": "2024-01-01T00:00:00Z",
        "expiresAt": "2024-01-08T00:00:00Z",
        "ipAddress": "192.168.1.1",
        "userAgent": "Mozilla/5.0..."
      }
    ],
    "accounts": [
      {
        "provider": "google",
        "providerAccountId": "112233445566",
        "createdAt": "2024-01-01T00:00:00Z"
      }
    ],
    "apiKeys": [
      {
        "id": "key_xxx",
        "name": "CI/CD",
        "permissions": ["server.read"],
        "createdAt": "2024-01-01T00:00:00Z"
      }
    ],
    "auditLog": [
      {
        "id": "evt_xxx",
        "action": "login",
        "timestamp": "2024-01-01T12:00:00Z",
        "ipAddress": "192.168.1.1",
        "metadata": { "method": "password" }
      }
    ],
    "servers": [
      {
        "id": "srv_xxx",
        "name": "My Server",
        "status": "running",
        "createdAt": "2024-01-01T00:00:00Z"
      }
    ]
  }
}
```

**Errors:**
- `400` — Export already pending (wait for current to complete)

#### GET `/api/auth/reset-password/validate`

Validate a password reset token. Used by the frontend to check if the token is valid before showing the reset form.

**Auth:** No (public)  
**Query params:**
- `token` — the password reset token from the email

**Response (200):**
```json
{
  "success": true,
  "data": {
    "valid": true,
    "email": "user@example.com",
    "expiresAt": "2024-01-01T14:00:00Z"
  }
}
```

**Response (410):**
```json
{
  "error": "Reset token has expired"
}
```

**Response (400):**
```json
{
  "error": "Invalid reset token"
}
```

---

### User Profile

See [Authentication Endpoints](#authentication-endpoints) for profile-related routes.

**Complete profile fields (from `GET /api/auth/profile`):**
- `id` — UUID
- `email` — verified email address
- `emailVerified` — boolean, true if email has been verified
- `username` — unique, 2-32 characters
- `name` — display name
- `firstName`, `lastName` — separate name components
- `image` — data URI or null (avatar)
- `twoFactorEnabled` — boolean
- `preferences` — arbitrary JSON object (max 16KB), see [PATCH /api/auth/profile/preferences](#patch-apiauthprofilepreferences)
- `lastSuccessfulLogin` — ISO timestamp of last successful authentication
- `accounts` — array of linked SSO/OAuth accounts (provider, providerAccountId, createdAt)
- `role` — primary role identifier
- `permissions` — array of effective permissions
- `createdAt` — ISO timestamp of account creation
- `updatedAt` — ISO timestamp of last profile update

---

### Server Management

All server routes are under `/api/servers`. Each server has a unique `id` and `uuid`.

#### Core Server Routes

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/servers` | `server.read` | List user's accessible servers |
| `POST` | `/api/servers` | `admin.write` or node-assigned | Create a new server |
| `GET` | `/api/servers/:id` | `server.read` | Get server details |
| `PUT` | `/api/servers/:id` | `server.update` | Update server configuration |
| `DELETE` | `/api/servers/:id` | `server.delete` | Delete a server (must be stopped) |
| `POST` | `/api/servers/:id/storage/resize` | `file.write` or `server.update` | Resize server disk |

#### POST `/api/servers/:id/storage/resize` — Resize Server Disk

Resize the server's allocated disk space. Online grow is supported; shrinking requires the server to be stopped.

**Auth:** `file.write` or `server.update`  
**Body:**
```json
{
  "allocatedDiskMb": 20480
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "serverId": "srv_xxx",
    "allocatedDiskMb": 20480,
    "previousDiskMb": 10240,
    "requiresRestart": false,
    "message": "Disk resized successfully"
  }
}
```

**Errors:**
- `409` — Server must be stopped to shrink disk
- `400` — Disk size below minimum (1024 MB) or exceeds node capacity

#### Server Power Operations

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/servers/:id/start` | `server.start` | Start server |
| `POST` | `/api/servers/:id/stop` | `server.stop` | Stop server |
| `POST` | `/api/servers/:id/restart` | `server.start` + `server.stop` | Restart server |
| `POST` | `/api/servers/:id/kill` | `server.stop` | Force kill server |
| `POST` | `/api/servers/:id/install` | `server.install` | Install server (first deploy) |
| `POST` | `/api/servers/:id/reinstall` | `server.reinstall` | Reinstall (wipe + install) |
| `POST` | `/api/servers/:id/rebuild` | `server.rebuild` | Rebuild container (preserve data) |
| `POST` | `/api/servers/:id/suspend` | `server.suspend` or `admin` | Suspend server |
| `POST` | `/api/servers/:id/unsuspend` | `server.suspend` or `admin` | Unsuspend server |
| `POST` | `/api/servers/eula` | `server.install` | Respond to EULA prompt |

#### POST `/api/servers/:id/reinstall`

Completely wipe the server's disk and reinstall from scratch. This is irreversible — all data is lost.

**Auth:** `server.reinstall`  
**Response (200):**
```json
{
  "success": true,
  "data": {
    "message": "Reinstallation started. Server will restart automatically when complete."
  }
}
```

**Errors:**
- `409` — Server must be stopped before reinstall

#### POST `/api/servers/eula`

Respond to an EULA (End User License Agreement) prompt. The server must have an EULA requirement configured in its template.

**Auth:** `server.install`  
**Body:**
```json
{
  "serverId": "srv_xxx",
  "accepted": true
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "accepted": true
  }
}
```

#### POST `/api/servers/:id/suspend`

Suspend a server. Optionally stops the server first and records a reason for the suspension.

**Auth:** `server.suspend` or `admin`  
**Body:**
```json
{
  "reason": "Billing suspended",
  "stopServer": true
}
```

- `reason` — optional human-readable reason for suspension
- `stopServer` — if `true`, stops the server before suspending it

**Response (200):**
```json
{
  "success": true,
  "data": {
    "suspended": true,
    "message": "Server suspended"
  }
}

#### Server File Operations

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/servers/:id/files` | `file.read` | List files in directory. Query: `?path=/subdir` |
| `GET` | `/api/servers/:id/files/download` | `file.read` | Download file |
| `POST` | `/api/servers/:id/files/upload` | `file.write` | Upload file (multipart/form-data, `path` form field) |
| `POST` | `/api/servers/:id/files/write` | `file.write` | Write/update file content |
| `POST` | `/api/servers/:id/files/create` | `file.write` | Create file or directory. Body: `{name, type: "file" or "directory", content?}` |
| `POST` | `/api/servers/:id/files/rename` | `file.write` | Rename/move file |
| `DELETE` | `/api/servers/:id/files/delete` | `file.write` | Delete file or directory |
| `POST` | `/api/servers/:id/files/permissions` | `file.write` | Update file permissions (chmod) |
| `POST` | `/api/servers/:id/files/compress` | `file.write` | Compress files to archive |
| `POST` | `/api/servers/:id/files/decompress` | `file.write` | Extract archive |
| `POST` | `/api/servers/:id/files/archive-contents` | `file.read` | List archive contents |
| `GET` | `/api/servers/:id/logs` | `console.read` | Get server logs |

#### POST `/api/servers/:id/files/archive-contents`

List the contents of an archive file without extracting it.

**Auth:** `file.read`  
**Body:**
```json
{
  "path": "/path/to/archive.zip"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "contents": [
      { "path": "file1.txt", "size": 1024, "type": "file" },
      { "path": "dir/", "size": 0, "type": "directory" },
      { "path": "dir/file2.txt", "size": 2048, "type": "file" }
    ]
  }
}
```

**Supported archive formats:** `.zip`, `.tar.gz`, `.tgz`

**Errors:**
- `400` — Invalid archive format or corrupted archive
- `404` — File not found

#### POST `/api/servers/:id/files/permissions`

Set file permissions using octal or hex notation.

**Auth:** `file.write`  
**Body:**
```json
{
  "path": "/path/to/file",
  "mode": "0755"
}
```

The `mode` field accepts octal (e.g., `0755`, `0644`) or hex (e.g., `0x755`) notation.

**Response (200):**
```json
{
  "success": true,
  "data": {
    "path": "/path/to/file",
    "mode": "0755"
  }
}
```

#### GET `/api/servers/:id/logs`

Get server console logs. Returns recent log lines with pagination.

**Auth:** `console.read`  
**Query params:**
- `lines` — number of lines to return (default 100, max 1000)
- `stream` — `console` (default) or `stdout`/`stderr`

**Response (200):**
```json
{
  "success": true,
  "data": {
    "logs": [
      "[2024-01-01T00:00:00Z] [INFO] Server started",
      "[2024-01-01T00:00:01Z] [INFO] Loading world..."
    ],
    "count": 100,
    "hasMore": false
  }
}
```

#### Server Network

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/servers/:id/allocations` | `server.read` | List port allocations/bindings |
| `POST` | `/api/servers/:id/allocations` | `server.update` | Add port allocation |
| `DELETE` | `/api/servers/:id/allocations/:containerPort` | `server.update` | Remove allocation (not primary) |
| `POST` | `/api/servers/:id/allocations/primary` | `server.update` | Set primary port |

#### DELETE `/api/servers/:id/allocations/:containerPort`

Remove a port allocation from a server. The primary allocation cannot be removed.

**Auth:** Session (`server.update`)  
**Response (200):**
```json
{
  "success": true,
  "data": {
    "removed": {
      "containerPort": 25565,
      "hostPort": 25566,
      "ip": "192.168.1.100"
    }
  }
}
```

**Errors:**
- `409` — Cannot remove the primary allocation

#### POST `/api/servers/:id/allocations/primary`

Set the primary port for this server. The primary port is used for server identification and display.

**Auth:** Session (`server.update`)  
**Body:**
```json
{
  "containerPort": 25565
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "primaryAllocation": {
      "containerPort": 25565,
      "hostPort": 25566,
      "ip": "192.168.1.100"
    }
  }
}
```

#### Server Databases

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/servers/database-hosts` | authenticated | List available database hosts (id, name, host, port). Used to hide the Databases tab when none are configured |
| `GET` | `/api/servers/:id/databases` | `database.read` | List databases |
| `POST` | `/api/servers/:id/databases` | `database.create` | Create a database (returns 201). `hostId` required. `name` optional (auto-generated if <3 chars). 403 if databaseAllocation is 0, 409 if limit reached |
| `POST` | `/api/servers/:id/databases/:databaseId/rotate` | `database.rotate` | Rotate database password |
| `DELETE` | `/api/servers/:id/databases/:databaseId` | `database.delete` | Delete a database |

#### POST `/api/servers/:id/databases/:databaseId/rotate`

Rotate the database password. Returns the full updated database object including the new password.

**Auth:** Session (`database.rotate`)  
**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "db_xxx",
    "name": "catalyst_db_123",
    "username": "u_catalyst_123",
    "password": "newRandomPassword123",
    "host": "db.example.com",
    "port": 3306,
    "hostId": "host_xxx",
    "hostName": "Primary DB Host",
    "createdAt": "2024-01-01T00:00:00Z"
  }
}
```

#### Server Invites & Access

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/servers/:id/permissions` | `server.read` | List server access & permissions |
| `GET` | `/api/servers/:id/invites` | `server.read` | List pending invites |
| `POST` | `/api/servers/:id/invites` | Owner only | Create invite |
| `DELETE` | `/api/servers/:id/invites/:inviteId` | Owner only | Cancel invite |
| `POST` | `/api/servers/:id/access` | Owner only | Add/update access |
| `DELETE` | `/api/servers/:id/access/:targetUserId` | Owner only | Remove access |
| `POST` | `/api/servers/invites/accept` | `server.read` | Accept invite (authenticated) |
| `POST` | `/api/servers/invites/register` | No | Accept invite + register account |
| `GET` | `/api/servers/invites/:token` | No | Preview invite |

#### DELETE `/api/servers/:id/invites/:inviteId`

Cancel a pending server invite. The invite URL will no longer work.

**Auth:** Owner only  
**Response (200):**
```json
{
  "success": true,
  "data": {
    "cancelled": true
  }
}
```

#### POST `/api/servers/invites/register`

Accept an invite link and create a new account in a single flow. Intended for unauthenticated users clicking an invite link.

**Auth:** No  
**Body:**
```json
{
  "token": "invite-token-string",
  "username": "newuser",
  "password": "securePassword123"
}
```

The `email` is taken from the invite itself, not provided in the request body.

**Response (200):**
```json
{
  "success": true,
  "data": {
    "userId": "user_xxx",
    "serverId": "srv_xxx",
    "permissions": ["server.read", "server.start", "server.stop"],
    "token": "set-auth-token-value"
  }
}
```

**Errors:**
- `400` — Invalid token or missing required fields
- `409` — Email already registered (use `/api/servers/invites/accept` instead)

#### GET `/api/servers/invites/:token`

Preview an invite without accepting it. Returns the target email, server name, and permissions being offered.

**Auth:** No  
**Response (200):**
```json
{
  "success": true,
  "data": {
    "email": "newuser@example.com",
    "serverName": "My Survival Server",
    "permissions": ["server.read", "server.start", "server.stop", "console.read", "console.write"],
    "expiresAt": "2024-02-01T00:00:00Z"
  }
}
```

**Response (410):**
```json
{
  "error": "Invite has expired"
}
```

#### DELETE `/api/servers/:id/access/:targetUserId`

Remove another user's access to this server.

**Auth:** Owner only  
**Response (200):**
```json
{
  "success": true,
  "data": {
    "removed": "user_yyy",
    "message": "Access revoked for user_yyy"
  }
}
```

#### Server Variables

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/servers/:id/variables` | `server.read` | Get template variables |
| `PATCH` | `/api/servers/:id/variables` | `server.rebuild` | Update environment variables |

#### PATCH `/api/servers/:id/variables`

Update server environment variables with full validation. Returns detailed validation errors for any invalid values.

**Auth:** `server.rebuild`  
**Body:**
```json
{
  "variables": {
    "SERVER_NAME": "My Server",
    "MAX_PLAYERS": "50",
    "DIFFICULTY": "hard"
  }
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "updated": ["SERVER_NAME", "MAX_PLAYERS"],
    "skipped": ["DIFFICULTY"]
  }
}
```

**Validation error response (422):**
```json
{
  "error": "Validation failed",
  "details": [
    { "field": "MAX_PLAYERS", "message": "Must be between 1 and 100" },
    { "field": "DIFFICULTY", "message": "Must be one of: peaceful, easy, normal, hard" }
  ]
}
```

#### Server Stats

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/servers/:id/stats` | `server.read` | Get server metrics |
| `GET` | `/api/servers/:id/stats/history` | `server.read` | Historical server stats |
| `GET` | `/api/servers/:id/activity` | `server.read` | Server activity log |

#### GET `/api/servers/:id/stats/history`

Get historical server resource metrics with automatic downsampling. Returns data points aggregated by time bucket. Maximum query window is 7 days.

**Auth:** `server.read`  
**Query params:**
- `from` — start timestamp (ISO or Unix epoch)
- `to` — end timestamp (ISO or Unix epoch)
- `interval` — aggregation interval in seconds (default: 300)

**Response (200):**
```json
{
  "success": true,
  "data": {
    "metrics": [
      {
        "timestamp": "2024-01-01T00:00:00Z",
        "cpuPercent": 45.2,
        "memoryUsageMb": 1024,
        "memoryTotalMb": 2048,
        "diskReadOps": 150,
        "diskWriteOps": 80
      }
    ],
    "meta": {
      "from": "2024-01-01T00:00:00Z",
      "to": "2024-01-01T06:00:00Z",
      "interval": 300,
      "totalRaw": 15000,
      "returned": 72
    }
  }
}
```

#### GET `/api/servers/:id/activity`

Get a paginated log of server activity events (power actions, file ops, console commands, etc.).

**Auth:** Session  
**Query params:**
- `page` — page number (default 1)
- `limit` — number of events per page (default 20, max 100)

**Response (200):**
```json
{
  "success": true,
  "data": {
    "events": [
      {
        "id": "act_xxx",
        "type": "power_start",
        "timestamp": "2024-01-01T12:00:00Z",
        "actor": "user_xxx",
        "metadata": { "status": "running" }
      },
      {
        "id": "act_yyy",
        "type": "file_upload",
        "timestamp": "2024-01-01T12:05:00Z",
        "actor": "user_xxx",
        "metadata": { "path": "/world/player.dat", "size": 4096 }
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 250,
      "totalPages": 13
    }
  }
}
```

#### Server Mod & Plugin Manager

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/servers/:id/mod-manager/game-versions` | `server.read` | List game versions for a provider |
| `GET` | `/api/servers/:id/mod-manager/search` | `server.read` | Search mods |
| `GET` | `/api/servers/:id/mod-manager/versions` | `server.read` | List versions for a project |
| `POST` | `/api/servers/:id/mod-manager/install` | `file.write` | Install a mod |
| `GET` | `/api/servers/:id/mod-manager/installed` | `server.read` | List installed mods |
| `POST` | `/api/servers/:id/mod-manager/uninstall` | `file.write` | Uninstall a mod |
| `POST` | `/api/servers/:id/mod-manager/check-updates` | `server.read` | Check for mod updates |
| `GET` | `/api/servers/:id/plugin-manager/game-versions` | `server.read` | List plugin versions |
| `GET` | `/api/servers/:id/plugin-manager/search` | `server.read` | Search plugins |
| `GET` | `/api/servers/:id/plugin-manager/versions` | `server.read` | List versions for a plugin |
| `POST` | `/api/servers/:id/plugin-manager/install` | `file.write` | Install a plugin |
| `GET` | `/api/servers/:id/plugin-manager/installed` | `server.read` | List installed plugins |
| `POST` | `/api/servers/:id/plugin-manager/uninstall` | `file.write` | Uninstall a plugin |
| `POST` | `/api/servers/:id/plugin-manager/check-updates` | `server.read` | Check for plugin updates |
| `POST` | `/api/servers/:id/plugin-manager/update` | `file.write` | Update a plugin |

#### GET `/api/servers/:id/mod-manager/game-versions`

List available game versions for a mod provider (Modrinth, CurseForge, etc.).

**Auth:** `server.read`  
**Query params:**
- `provider` — `modrinth` (default), `curseforge`, or `paper`
- `gameVersion` — filter by Minecraft/other game version (e.g., `1.20.1`)

**Response (200):**
```json
{
  "success": true,
  "data": {
    "versions": [
      { "id": "1.20.1", "name": "1.20.1", "type": "release" },
      { "id": "1.20.2", "name": "1.20.2", "type": "release" },
      { "id": "1.20.4", "name": "1.20.4", "type": "release" }
    ],
    "provider": "modrinth",
    "count": 3
  }
}
```

#### GET `/api/servers/:id/mod-manager/search`

Search for mods across providers. Supports search by name, category, and game version.

**Auth:** `server.read`  
**Query params:**
- `query` — search query (required)
- `provider` — `modrinth`, `curseforge`, `paper` (required)
- `gameVersion` — filter by game version
- `target` — `mods` (default), `datapacks`, or `modpacks`
- `loader` — mod loader type (e.g., `forge`, `fabric`, `quilt`, `neoforge`)
- `page` — page number (default 1)
- `limit` — results per page (default 20, max 100)

**Response (200):**
```json
{
  "success": true,
  "data": {
    "results": [
      {
        "id": "mod_xxx",
        "name": "OptiFine",
        "description": "Performance and graphics enhancement mod",
        "author": "sp614x",
        "provider": "modrinth",
        "gameVersion": "1.20.1",
        "downloadCount": 50000000,
        "latestVersion": "optifine-mc1.20.1_HD_U_I6"
      }
    ],
    "total": 1523,
    "page": 1,
    "limit": 20
  }
}
```

#### POST `/api/servers/:id/mod-manager/install`

Install a mod from a provider. Downloads and places the mod file in the server's mods directory.

**Auth:** Session  
**Body:**
```json
{
  "provider": "modrinth",
  "target": "mods",
  "projectId": "mod_xxx",
  "versionId": "version_xxx",
  "projectName": "OptiFine",
  "filePath": "mods/"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "installed": true,
    "fileName": "optifine-mc1.20.1_HD_U_I6.jar",
    "filePath": "mods/optifine-mc1.20.1_HD_U_I6.jar",
    "sizeBytes": 15242880,
    "requiresRestart": true
  }
}
```

**Errors:**
- `400` — Invalid project or version ID
- `409` — Mod already installed (same version)
- `413` — Mod file exceeds maximum size (500 MB)

#### POST `/api/servers/:id/mod-manager/uninstall`

Remove an installed mod.

**Auth:** Session  
**Body:**
```json
{
  "filename": "optifine-mc1.20.1_HD_U_I6.jar"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "uninstalled": true,
    "requiresRestart": true
  }
}
```

#### GET `/api/servers/:id/mod-manager/installed`

List all installed mods with their metadata and update status.

**Auth:** Session (`server.read`)  
**Query params:**
- `target` — optional filter: `mods` (default), `datapacks`, or `modpacks`

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "name": "optifine-mc1.20.1_HD_U_I6.jar",
      "size": 15242880,
      "modifiedAt": "2024-01-01T00:00:00Z",
      "provider": "modrinth",
      "projectId": "mod_xxx",
      "versionId": "ver_xxx",
      "projectName": "OptiFine",
      "hasUpdate": true,
      "latestVersionId": "ver_yyy",
      "latestVersionName": "I7",
      "updateCheckedAt": "2024-01-02T00:00:00Z"
    }
  ]
}
```

#### POST `/api/servers/:id/mod-manager/update`

Update one or more installed mods to their latest available versions.

**Auth:** Session (`file.write`)  
**Body:**
```json
{
  "filenames": ["optifine-mc1.20.1_HD_U_I6.jar"]
}
```

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "filename": "optifine-mc1.20.1_HD_U_I6.jar",
      "updated": true,
      "oldVersion": "I6",
      "newVersion": "I7"
    }
  ]
}
```

**Errors:**
- `400` — One or more filenames not found in installed mods
- `409` — Mod already at latest version

#### POST `/api/servers/:id/mod-manager/check-updates`

Check for available updates to all installed mods.

**Auth:** Session  
**Response (200):**
```json
{
  "success": true,
  "data": {
    "checked": 15,
    "updatesAvailable": 3
  }
}
```

#### GET `/api/servers/:id/plugin-manager/installed`

List all installed plugins with their metadata and update status.

**Auth:** Session (`server.read`)  
**Query params:**
- `target` — optional filter: `plugins` (default), or `datapacks`

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "name": "EssentialsX-2.20.1.jar",
      "size": 8450000,
      "modifiedAt": "2024-01-01T00:00:00Z",
      "provider": "bukkit",
      "projectId": "essentialsx",
      "versionId": "2.20.1",
      "projectName": "EssentialsX",
      "hasUpdate": false,
      "latestVersionId": null,
      "latestVersionName": null,
      "updateCheckedAt": "2024-01-02T00:00:00Z"
    }
  ]
}
```

#### POST `/api/servers/:id/plugin-manager/uninstall`

Remove an installed plugin.

**Auth:** Session  
**Body:**
```json
{
  "filename": "EssentialsX-2.20.1.jar"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "uninstalled": true,
    "requiresRestart": true
  }
}
```

#### Server Admin Operations

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `PATCH` | `/api/servers/:id/restart-policy` | `server.start` | Set auto-restart policy |
| `POST` | `/api/servers/:id/reset-crash-count` | `server.start` | Reset crash count |
| `PATCH` | `/api/servers/:id/backup-settings` | `server.start` | Update backup configuration |
| `POST` | `/api/servers/:id/transfer` | `server.transfer` | Transfer server to another node |
| `POST` | `/api/servers/:id/transfer-ownership` | `admin.write` or owner | Transfer ownership to another user |
| `POST` | `/api/servers/:id/archive` | `server.suspend` or `admin` | Archive server |
| `POST` | `/api/servers/:id/restore` | `server.suspend` or `admin` | Restore from archive |

#### PATCH `/api/servers/:id/restart-policy`

Configure automatic restart behavior after crashes.

**Auth:** `server.start`  
**Body:**
```json
{
  "restartPolicy": "always",
  "maxCrashCount": 5
}
```

- `restartPolicy` — `"always"`, `"on-failure"`, or `"never"`
- `maxCrashCount` — maximum consecutive crash restarts before giving up

**Response (200):**
```json
{
  "success": true,
  "data": {
    "restartPolicy": "always",
    "maxCrashCount": 5
  }
}
```

#### POST `/api/servers/:id/reset-crash-count`

Reset the server's crash counter to zero. Used after manually resolving a crash loop.

**Auth:** `server.start`  
**Response (200):**
```json
{
  "success": true,
  "data": {
    "crashCount": 0,
    "message": "Crash count reset to 0"
  }
}
```

#### PATCH `/api/servers/:id/backup-settings`

Configure backup storage mode, retention, and provider settings (S3/SFTP).

**Auth:** `server.start`  
**Body:**
```json
{
  "storageMode": "local",
  "retentionCount": 10,
  "retentionDays": 30,
  "s3Config": {
    "bucket": "catalyst-backups",
    "region": "us-east-1",
    "endpoint": "https://s3.amazonaws.com",
    "accessKeyId": "AKIA...",
    "secretAccessKey": "...",
    "pathStyle": false
  },
  "sftpConfig": {
    "host": "backup.example.com",
    "port": 22,
    "username": "backups",
    "password": "...",
    "privateKey": "-----BEGIN OPENSSH PRIVATE KEY-----...",
    "privateKeyPassphrase": "...",
    "basePath": "/backups"
  }
}
```

- `storageMode` — `"local"`, `"s3"`, `"sftp"`, or `"stream"`
- `retentionCount` — max number of backups to keep
- `retentionDays` — max age of backups in days
- `s3Config` — required when `storageMode` is `"s3"`
- `sftpConfig` — required when `storageMode` is `"sftp"`

**Response (200):**
```json
{
  "success": true,
  "data": {
    "storageMode": "local",
    "retentionCount": 10,
    "retentionDays": 30
  }
}
```

#### POST `/api/servers/:id/transfer`

Transfer a server to another node. The server must be stopped. This is a streaming operation that copies the server data to the target node.

**Auth:** Session (`server.transfer`)  
**Body:**
```json
{
  "targetNodeId": "node_yyy"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "transferId": "transfer_xxx",
    "status": "in_progress",
    "progress": 0,
    "estimatedTimeSeconds": 300
  }
}
```

Transfer events are streamed via SSE to `/api/servers/:id/sse-events`.

**Errors:**
- `409` — Server must be stopped
- `400` — Target node has insufficient resources

#### POST `/api/servers/:id/transfer-ownership`

Transfer server ownership to another user. The target user must have permission to create servers in the same location.

**Auth:** `admin.write` or owner  
**Body:**
```json
{
  "newOwnerId": "user_yyy"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "transferredTo": "user_yyy",
    "message": "Server ownership transferred"
  }
}
```

**Errors:**
- `400` — User does not exist or lacks permission
- `409` — Target user already owns a server in this location

#### POST `/api/servers/:id/archive`

Archive a server. Stops the server and sets its status to `archived`. Archived servers are hidden from the active server list but retain all data.

**Auth:** `server.suspend` or `admin`  
**Response (200):**
```json
{
  "success": true,
  "data": {
    "archived": true,
    "message": "Server archived successfully"
  }
}
```

#### POST `/api/servers/:id/restore`

Restore an archived server. Sets the server status back to `stopped`, making it visible in the active server list again.

**Auth:** `server.suspend` or `admin`  
**Response (200):**
```json
{
  "success": true,
  "data": {
    "restored": true,
    "message": "Server restored from archive"
  }
}
```

#### Server Bulk Operations

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/servers/bulk/suspend` | `admin.write`, `admin.read`, or `server.suspend` | Bulk suspend servers |
| `POST` | `/api/servers/bulk/unsuspend` | `admin.write`, `admin.read`, or `server.suspend` | Bulk unsuspend servers |
| `DELETE` | `/api/servers/bulk` | `admin.write`, `admin.read`, or `server.suspend` (endpoint); `server.delete` (per-server) | Bulk delete servers |
| `POST` | `/api/servers/bulk/status` | No specific permission (filters accessible) | Bulk status check |

#### POST `/api/servers/bulk/suspend`

Suspend multiple servers at once. Optionally stops them first and sets a reason.

**Auth:** `admin.write`, `admin.read`, or `server.suspend`  
**Body:**
```json
{
  "serverIds": ["srv_1", "srv_2", "srv_3"],
  "stopServer": true,
  "reason": "Billing suspended"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "success": ["srv_1", "srv_2"],
    "failed": [
      { "id": "srv_3", "error": "Server not found" }
    ]
  },
  "summary": {
    "total": 3,
    "succeeded": 2,
    "failed": 1
  }
}
```

#### POST `/api/servers/bulk/unsuspend`

Unsuspend multiple servers at once. Re-enables scheduled tasks for each.

**Auth:** `admin.write`, `admin.read`, or `server.suspend`  
**Body:**
```json
{
  "serverIds": ["srv_1", "srv_2"]
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "success": ["srv_1", "srv_2"],
    "failed": []
  },
  "summary": {
    "total": 2,
    "succeeded": 2,
    "failed": 0
  }
}
```

#### DELETE `/api/servers/bulk`

Bulk delete servers. Maximum 100 servers per request. All servers must be stopped.

**Auth:** `admin.write`, `admin.read`, or `server.suspend` (endpoint); `server.delete` (per-server)  
**Body:**
```json
{
  "serverIds": ["srv_1", "srv_2", "srv_3"]
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "success": ["srv_1", "srv_2"],
    "failed": [
      { "id": "srv_3", "error": "Server is still running" }
    ]
  },
  "summary": {
    "total": 3,
    "succeeded": 2,
    "failed": 1
  }
}
```

**Errors:**
- `400` — Maximum 100 servers per request
- `409` — One or more servers are still running

#### POST `/api/servers/bulk/status`

Check the status of up to 200 servers in a single request. Returns server details filtered by the authenticated user's permissions.

**Auth:** Session  
**Body:**
```json
{
  "serverIds": ["srv_1", "srv_2", "srv_3"]
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "servers": [
      {
        "id": "srv_1",
        "name": "My Server",
        "status": "running",
        "cpuPercent": 45,
        "memoryUsageMb": 1024,
        "memoryTotalMb": 2048
      }
    ],
    "total": 3,
    "accessible": 3
  }
}
```

#### Server Console & Streaming

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/servers/:id/console` | `console.write` | Send command to console |

#### POST `/api/servers/:id/console`

Send a command to the server console. Maximum 4096 characters. A newline is automatically appended.

**Auth:** Session (`console.write`)  
**Body:**
```json
{
  "command": "say Hello world"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "sent": true,
    "command": "say Hello world",
    "echoed": "[Server] [CHAT] <user_xxx>: Hello world"
  }
}
```

**Errors:**
- `400` — Command exceeds 4096 character limit

#### GET `/api/servers/:serverId/console/stream` — Console SSE Stream

Real-time server console output via Server-Sent Events. Replaces the legacy WebSocket console for better proxy compatibility.

**Auth:** Session (`console.read`)  
**Headers:**
```http
Accept: text/event-stream
```

**Behavior:**
- Long-lived SSE connection that streams console output from the agent
- Sends an initial `connected` event with `serverId` and `timestamp`
- Pushes `console_output` events as the agent publishes them
- Emits `eula_required` when the server prompts for EULA acceptance
- Emits `error` events on connection or routing failures
- 25-second heartbeat comments to keep connection alive through proxies
- Maximum 50 concurrent subscribers per server

**Event types:**
- `connected` — `{ serverId, timestamp }` — connection established
- `console_output` — `{ type, serverId, data, timestamp }` — console line
- `eula_required` — `{ serverId, timestamp }` — EULA prompt detected
- `error` — `{ error, serverId? }` — connection or routing error

**Rate limiting:** Disabled (long-lived SSE stream)

**Errors:**
- `401` — Unauthorized
- `403` — Insufficient permissions (`console.read` required)
- `404` — Server not found
- `503` — Subscriber cap reached (50 concurrent viewers)

#### POST `/api/servers/:serverId/console/command` — Send Console Command

Send a command to the server console via HTTP. The command is forwarded to the agent via the WebSocket gateway.

**Auth:** `console.write`

**Auth:** Session (`console.write`)  
**Body:**
```json
{
  "command": "say Hello world"
}
```

- `command` — string, required, max 4096 characters, trimmed automatically
- A newline is automatically appended if not present

**Response (202):**
```json
{
  "success": true,
  "timestamp": "2024-01-01T12:00:00Z"
}
```

**Errors:**
- `400` — Command missing, empty, or exceeds 4096 characters
- `403` — Insufficient permissions or server is suspended
- `404` — Server not found
- `500` — Failed to route command to agent

#### Server Backups

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/servers/:serverId/backups` | `backup.read` | List backups with pagination |
| `POST` | `/api/servers/:serverId/backups` | `backup.create` | Create a backup |
| `GET` | `/api/servers/:serverId/backups/:backupId` | `backup.read` | Get backup details |
| `POST` | `/api/servers/:serverId/backups/:backupId/restore` | `backup.restore` | Restore from backup |
| `DELETE` | `/api/servers/:serverId/backups/:backupId` | `backup.delete` | Delete a backup |
| `GET` | `/api/servers/:serverId/backups/:backupId/download` | `backup.read` | Download backup file |

#### GET `/api/servers/:serverId/backups`

List backups for a server with pagination.

**Auth:** Session (`backup.read`)  
**Query params:**
- `limit` — results per page (default 50, max 100)
- `page` — page number (default 1)

**Response (200):**
```json
{
  "backups": [
    {
      "id": "bkp_xxx",
      "serverId": "srv_xxx",
      "name": "backup-2024-01-01T00-00-00Z",
      "path": "/var/lib/catalyst/backups/srv-uuid/backup-2024-01-01T00-00-00Z.tar.gz",
      "storageMode": "local",
      "sizeMb": 1024,
      "status": "completed",
      "createdAt": "2024-01-01T00:00:00Z",
      "completedAt": "2024-01-01T00:05:00Z",
      "restoredAt": null
    }
  ],
  "total": 15,
  "page": 1,
  "pageSize": 50,
  "totalPages": 1
}
```

**Errors:**
- `423` — Server is suspended

#### POST `/api/servers/:serverId/backups`

Create a new backup. The backup is created asynchronously — the agent compresses the server data and streams it to storage.

**Auth:** Session (`backup.create`)  
**Body (optional):**
```json
{
  "name": "pre-update-backup"
}
```

- `name` — optional custom backup name (sanitized to `[a-z0-9._-]`, max 120 chars). Defaults to `backup-<ISO-timestamp>`.

**Response (200):**
```json
{
  "success": true,
  "message": "Backup creation started",
  "backupName": "pre-update-backup",
  "backupId": "bkp_xxx"
}
```

**Errors:**
- `423` — Server is suspended
- `503` — Node is offline
- `403` — Backup allocation disabled (configure S3 or SFTP to enable)
- `500` — Missing storage key or gateway unavailable

#### POST `/api/servers/:serverId/backups/:backupId/restore`

Restore a server from a backup. The server must be stopped first.

**Auth:** Session (`backup.restore`)  
**Response (200):**
```json
{
  "success": true,
  "message": "Backup restoration started"
}
```

**Errors:**
- `400` — Server must be stopped before restoring
- `404` — Backup not found
- `423` — Server is suspended
- `503` — Node is offline or failed to send restore request
- `500` — Missing remote storage key or gateway unavailable

#### DELETE `/api/servers/:serverId/backups/:backupId`

Delete a backup. Removes the backup record and deletes the backup file from storage (local, S3, or SFTP).

**Auth:** Session (`backup.delete`)  
**Response (200):**
```json
{
  "success": true,
  "message": "Backup deleted"
}
```

**Errors:**
- `404` — Backup not found
- `423` — Server is suspended

#### GET `/api/servers/:serverId/backups/:backupId/download`

Download a backup file directly. For local storage, returns the file as `application/octet-stream`. For S3/SFTP, proxies the download.

**Auth:** Session (`backup.read`)  
**Response (200):** Binary file stream (`Content-Type: application/octet-stream`)

**Response (404):**
```json
{
  "error": "Backup file not found"
}
```

---

### Node Management

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/nodes` | `node.read` | List accessible nodes |
| `POST` | `/api/nodes` | `node.create` | Create a node |
| `GET` | `/api/nodes/:id` | `node.read` | Get node details |
| `PUT` | `/api/nodes/:id` | `node.update` | Update node configuration |
| `DELETE` | `/api/nodes/:id` | `node.delete` | Delete a node |
| `GET` | `/api/nodes/:id/stats` | `node.view_stats` | Get node resource statistics |
| `POST` | `/api/nodes/:id/heartbeat` | Agent | Node heartbeat (agent) |
| `POST` | `/api/nodes/:id/deployment-token` | `node.create` | Generate deployment token |
| `GET` | `/api/nodes/:id/api-key` | `node.read` | Check node API key exists |
| `POST` | `/api/nodes/:id/api-key` | `node.create` | Generate/regenerate API key |
| `GET` | `/api/nodes/:id/allocations` | `node.manage_allocation` | List node allocations (`?serverId`, `?search`) |
| `POST` | `/api/nodes/:id/allocations` | `node.manage_allocation` | Create allocations (`alias`, `notes`) |
| `PATCH` | `/api/nodes/:id/allocations/:allocId` | `node.manage_allocation` | Update allocation alias/notes |
| `DELETE` | `/api/nodes/:id/allocations/:allocId` | `node.manage_allocation` | Remove allocation |
| `GET` | `/api/nodes/:id/ip-pools` | `node.read` | List IPAM pools |
| `GET` | `/api/nodes/:id/ip-availability` | `node.read` | List available IPs |
| `GET` | `/api/nodes/:id/assignments` | `node.assign` | List node assignments |
| `POST` | `/api/nodes/:id/assign` | `node.assign` | Assign node to user/role |
| `DELETE` | `/api/nodes/:id/assignments/:assignId` | `node.assign` | Remove node assignment |
| `POST` | `/api/nodes/assign-wildcard` | `node.assign` | Assign all nodes (wildcard) to user/role |
| `DELETE` | `/api/nodes/assign-wildcard/:targetType/:targetId` | `node.assign` | Remove wildcard assignment |
| `GET` | `/api/nodes/accessible` | `node.read` | Get nodes accessible to user |
| `GET` | `/api/nodes/:id/unregistered-containers` | `admin.write` | List unregistered containers |
| `GET` | `/api/nodes/:id/unregistered-containers/:cid/suggest-template` | `admin.write` | Suggest template match |
| `POST` | `/api/nodes/:id/import-server` | `admin.write` | Import container as server |

#### POST `/api/nodes/:id/heartbeat` — Agent Heartbeat

Called by the agent binary every 30 seconds to report node health. This is an internal agent-to-backend endpoint.

**Auth:** One of the following (in order of priority):
- `X-Node-Api-Key: <node-api-key>`
- `X-Catalyst-Node-Token: <node-api-key>`
- `Authorization: Bearer <node-api-key>`

**Body:**
```json
{
  "health": {
    "cpuPercent": 45,
    "memoryUsageMb": 12000,
    "memoryTotalMb": 16384,
    "diskUsageMb": 50000,
    "diskTotalMb": 200000,
    "containerCount": 10,
    "networkRxBytes": 1000000,
    "networkTxBytes": 500000
  }
}
```

**Response (200):**
```json
{
  "success": true
}
```
```

#### GET `/api/nodes/:id/api-key`

Check if an API key exists for this node.

**Auth:** `node.read`  
**Response (200) — key exists:**
```json
{
  "success": true,
  "data": {
    "exists": true,
    "apiKey": {
      "id": "key_xxx",
      "name": "Node API Key",
      "preview": "catalyst_A1B2...",
      "createdAt": "2024-01-01T00:00:00Z",
      "enabled": true,
      "requestCount": 15234,
      "lastRequest": "2024-01-01T12:00:00Z"
    }
  }
}
```

**Response (200) — no key:**
```json
{
  "success": true,
  "data": {
    "exists": false
  }
}
```

#### POST `/api/nodes/:id/api-key`

Generate or regenerate the API key for a node. Regenerating invalidates the previous key.

**Auth:** `node.create`  
**Body (optional):**
```json
{
  "regenerate": true
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "nodeId": "node_xxx",
    "regenerated": true,
    "apiKey": {
      "id": "key_xxx",
      "name": "Node API Key",
      "preview": "catalyst_A1B2...",
      "token": "catalyst_A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6",
      "createdAt": "2024-01-01T00:00:00Z",
      "enabled": true
    },
    "warning": "This is the only time the API key will be shown. Store it securely."
  }
}
```

#### PATCH `/api/nodes/:id/allocations/:allocationId`

Update the alias or notes for a port allocation.

**Auth:** `node.manage_allocation`  
**Body:**
```json
{
  "alias": "Game Server 1",
  "notes": "Primary game server for community"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "allocationId": "alloc_xxx",
    "containerPort": 25565,
    "hostPort": 25565,
    "ip": "192.168.1.100",
    "alias": "Game Server 1",
    "notes": "Primary game server for community"
  }
}
```

#### GET `/api/nodes/:id/allocations`

List all port allocations for a node.

**Auth:** `node.manage_allocation`  
**Query params:**
- `serverId` — optional, filter allocations assigned to a specific server
- `search` — optional, search by IP address, alias, or notes

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": "alloc_xxx",
      "containerPort": 25565,
      "hostPort": 25565,
      "ip": "192.168.1.100",
      "alias": "Game Server 1",
      "notes": "Primary game server for community",
      "serverId": "srv_xxx"
    }
  ]
}
```

#### POST `/api/nodes/:id/allocations`

Create a new port allocation on a node.

**Auth:** `node.manage_allocation`  
**Body:**
```json
{
  "containerPort": 25565,
  "hostPort": 25565,
  "ip": "192.168.1.100",
  "alias": "Game Server 1",
  "notes": "Primary game server for community"
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "id": "alloc_xxx",
    "containerPort": 25565,
    "hostPort": 25565,
    "ip": "192.168.1.100",
    "alias": "Game Server 1",
    "notes": "Primary game server for community"
  }
}
```

#### GET `/api/nodes/:id/ip-pools`

List IPAM (IP Address Management) macvlan pools configured for this node.

**Auth:** `node.read`  
**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": "pool_xxx",
      "networkName": "Production IPs",
      "cidr": "10.0.0.0/24",
      "availableCount": 253
    }
  ]
}
```

#### GET `/api/nodes/:id/ip-availability`

List available IP addresses within the node's IP pools.

**Auth:** `node.read`  
**Query params:**
- `networkName` — **required**, name of the IP pool to query
- `limit` — max results (default 200, max 1000)

**Response (200):**
```json
{
  "success": true,
  "data": {
    "available": [
      "10.0.0.2",
      "10.0.0.3",
      "10.0.0.4"
    ],
    "total": 3,
    "poolName": "Production IPs"
  }
}
```

#### GET `/api/nodes/:id/unregistered-containers`

List Docker containers discovered on this node that do not have corresponding records in the Catalyst database. This is the first step in the container discovery/import workflow.

**Auth:** `admin.write`  
**Response (200):**
```json
{
  "success": true,
  "data": {
    "containers": [
      {
        "containerId": "abc123def",
        "name": "catalyst_server_xyz",
        "image": "ghcr.io/catalyst/valheim:1.0",
        "status": "running",
        "cpuPercent": 25,
        "memoryUsageMb": 1024,
        "createdAt": "2024-01-01T00:00:00Z"
      }
    ],
    "total": 2
  }
}
```

#### GET `/api/nodes/:id/unregistered-containers/:containerId/suggest-template`

Get a suggested template match for an unregistered container based on its image name and labels.

**Auth:** `admin.write`  
**Response (200):**
```json
{
  "success": true,
  "data": {
    "suggestedTemplate": {
      "id": "tpl_xxx",
      "name": "Valheim",
      "nestId": "nest_yyy",
      "confidence": 0.95
    },
    "alternativeTemplates": [
      {
        "id": "tpl_zzz",
        "name": "Valheim Beta",
        "confidence": 0.7
      }
    ]
  }
}
```

#### POST `/api/nodes/:id/import-server`

Import a discovered container as a Catalyst server. Creates the database record and registers the existing container.

**Auth:** `admin.write`  
**Body:**
```json
{
  "containerId": "abc123def",
  "templateId": "tpl_xxx",
  "name": "Imported Valheim Server",
  "ownerId": "user_xxx",
  "allocatedMemoryMb": 4096,
  "allocatedCpuCores": 2,
  "allocatedDiskMb": 20480,
  "primaryPort": 2456,
  "portBindings": ["2456:2456/udp", "2457:2457/udp"],
  "environment": {
    "WORLD_NAME": "MyWorld",
    "SERVER_PASSWORD": "secret123"
  }
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "srv_new",
    "name": "Imported Valheim Server",
    "status": "running",
    "nodeId": "node_xxx",
    "templateId": "tpl_xxx",
    "ownerId": "user_xxx",
    "allocatedMemoryMb": 4096,
    "allocatedCpuCores": 2,
    "allocatedDiskMb": 20480,
    "containerId": "abc123def",
    "createdAt": "2024-01-01T00:00:00Z"
  }
}
```

#### POST `/api/nodes/assign-wildcard`

Assign all nodes (wildcard) to a user or role. This grants access to all current and future nodes.

**Auth:** `node.assign`  
**Body:**
```json
{
  "targetType": "user",
  "targetId": "user_xxx",
  "expiresAt": "2024-12-31T23:59:59Z"
}
```

- `targetType` — `"user"` or `"role"`
- `targetId` — UUID of the user or role
- `expiresAt` — optional, ISO 8601 date when the assignment expires

**Response (200):**
```json
{
  "success": true,
  "data": {
    "assigned": true,
    "targetType": "user",
    "targetId": "user_xxx",
    "expiresAt": "2024-12-31T23:59:59Z"
  }
}
```

#### DELETE `/api/nodes/assign-wildcard/:targetType/:targetId`

Remove a wildcard node assignment from a user or role.

**Auth:** `node.assign`  
**Response (200):**
```json
{
  "success": true,
  "data": {
    "removed": true,
    "targetType": "user",
    "targetId": "user_xxx"
  }
}
```

#### POST `/api/nodes` — Create Node

**Body:**
```json
{
  "name": "Node-1",
  "description": "Production node",
  "locationId": "loc_xxx",
  "hostname": "node1.example.com",
  "publicAddress": "192.168.1.100",
  "maxMemoryMb": 16384,
  "maxCpuCores": 8,
  "serverDataDir": "/var/lib/catalyst/servers",
  "memoryOverallocatePercent": 110,
  "cpuOverallocatePercent": 150
}
```

#### GET `/api/nodes/:id/stats` — Node Statistics

**Response:**
```json
{
  "success": true,
  "data": {
    "nodeId": "...",
    "isOnline": true,
    "lastSeenAt": "2024-01-01T00:00:00Z",
    "resources": {
      "maxMemoryMb": 16384,
      "maxCpuCores": 8,
      "effectiveMaxMemoryMb": 18022,
      "effectiveMaxCpuCores": 12,
      "allocatedMemoryMb": 8192,
      "allocatedCpuCores": 4,
      "availableMemoryMb": 9830,
      "availableCpuCores": 8,
      "memoryUsagePercent": 50,
      "cpuUsagePercent": 33,
      "actualMemoryUsageMb": 12000,
      "actualMemoryTotalMb": 16384,
      "actualCpuPercent": 45,
      "actualDiskUsageMb": 50000,
      "actualDiskTotalMb": 200000
    },
    "servers": {
      "total": 10,
      "running": 7,
      "stopped": 3
    },
    "lastMetricsUpdate": "2024-01-01T00:00:00Z"
  }
}
```

---

### Admin Operations

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/admin/stats` | `admin.read` or any resource read perm | System-wide statistics |
| `GET` | `/api/admin/users` | `user.read` | List all users (paginated) |
| `POST` | `/api/admin/users` | `user.create` | Create a user |
| `PUT` | `/api/admin/users/:id` | `user.update` or `user.set_roles` | Update a user |
| `GET` | `/api/admin/users/:id/servers` | `user.read` | Get user's server access |
| `POST` | `/api/admin/users/:id/delete` | `user.delete` | Delete a user |
| `GET` | `/api/admin/nodes` | `node.read` | List all nodes with details |
| `GET` | `/api/admin/servers` | `server.read` | List all servers (paginated) |
| `POST` | `/api/admin/servers/actions` | Action-specific (see below) | Bulk server actions |
| `GET` | `/api/admin/audit-logs` | `admin.read` | System audit log |
| `GET` | `/api/admin/audit-logs/export` | `admin.write` | Export audit logs (CSV) |
| `GET` | `/api/admin/events` | `admin.read` | SSE admin event stream |
| `GET` | `/api/admin/health` | `admin.read` | System health check (DB + nodes) |
| `GET` | `/api/admin/system-errors` | `admin.read` | List system errors with filtering |
| `POST` | `/api/admin/system-errors/:id/resolve` | `admin.write` | Resolve a system error |
| `GET` | `/api/admin/security-settings` | `admin.read` | Get security settings |
| `PUT` | `/api/admin/security-settings` | `admin.write` | Update security settings |
| `GET` | `/api/admin/ip-pools` | `admin.read` | List IPAM pools |
| `POST` | `/api/admin/ip-pools` | `admin.write` | Create IPAM pool |
| `PUT` | `/api/admin/ip-pools/:poolId` | `admin.write` | Update IPAM pool |
| `DELETE` | `/api/admin/ip-pools/:poolId` | `admin.write` | Delete IPAM pool |
| `GET` | `/api/admin/database-hosts` | `admin.read` | List database hosts |
| `POST` | `/api/admin/database-hosts` | `admin.write` | Create database host |
| `PUT` | `/api/admin/database-hosts/:hostId` | `admin.write` | Update database host |
| `DELETE` | `/api/admin/database-hosts/:hostId` | `admin.write` | Delete database host |
| `GET` | `/api/admin/dns-settings` | `admin.read` | Get DNS settings |
| `PUT` | `/api/admin/dns-settings` | `admin.write` | Update DNS settings |
| `GET` | `/api/admin/mod-manager` | `admin.read` | Get mod manager settings |
| `PUT` | `/api/admin/mod-manager` | `admin.write` | Update mod manager settings |
| `GET` | `/api/admin/auth-lockouts` | `admin.read` | List auth lockouts |
| `DELETE` | `/api/admin/auth-lockouts/:lockoutId` | `admin.write` | Clear auth lockout |
| `GET` | `/api/admin/oidc-config` | `admin.read` | Get OIDC provider config |
| `PATCH` | `/api/admin/oidc-config` | `admin.write` | Update OIDC provider config |
| `GET` | `/api/admin/theme-settings` | `admin.read` | Get theme settings |
| `PATCH` | `/api/admin/theme-settings` | `admin.write` | Update theme settings |
| `GET` | `/api/update/status` | `admin.write` | Check for panel updates |
| `POST` | `/api/update/trigger` | `admin.write` | Trigger panel update |

#### GET `/api/admin/audit-logs/export`

Export the system audit log as a CSV file. Useful for compliance and debugging.

**Auth:** `admin.write`  
**Query params:**
- `from` — start timestamp (ISO or Unix epoch)
- `to` — end timestamp (ISO or Unix epoch)
- `action` — filter by action type (e.g., `user_created`, `server_deleted`)
- `resource` — filter by resource type (e.g., `server`, `user`, `node`)
- `userId` — filter by user ID

**Response (200):**
Returns a `text/csv` file with columns:
- `timestamp` — ISO 8601 timestamp
- `actor` — actor user ID or system
- `action` — action type
- `targetType` — resource type (user, server, node, etc.)
- `targetId` — resource ID
- `ipAddress` — actor's IP address
- `userAgent` — actor's user agent
- `metadata` — JSON string of additional context

#### POST `/api/update/trigger`

Trigger a panel update to the latest available version. Downloads the update package and applies it. The panel restarts automatically after the update completes. Update status is cached for 5 minutes.

**Auth:** `admin.write`  
**Response (200):**
```json
{
  "success": true,
  "data": {
    "updateId": "upd_xxx",
    "status": "downloading",
    "currentVersion": "1.0.0",
    "targetVersion": "1.1.0",
    "progress": 0,
    "message": "Update started. Panel will restart automatically."
  }
}
```

**Response (409):**
```json
{
  "error": "No update available",
  "data": {
    "currentVersion": "1.1.0",
    "latestVersion": "1.1.0"
  }
}
```

Update progress events are streamed via SSE to `/api/admin/events`.

#### GET `/api/admin/users` — List Users

List all users with pagination and search.

**Auth:** `user.read`  
**Query params:**
- `page` — page number (default 1)
- `limit` — results per page (default 20, max 100)
- `search` — filter by email or username (partial match)
- `role` — filter by role ID
- `status` — filter by status (`active`, `suspended`, `pending`)

**Response (200):**
```json
{
  "success": true,
  "data": {
    "users": [
      {
        "id": "user_xxx",
        "email": "user@example.com",
        "username": "johndoe",
        "role": "user",
        "status": "active",
        "createdAt": "2024-01-01T00:00:00Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 150,
      "totalPages": 8
    }
  }
}
```

#### POST `/api/admin/users` — Create User

Create a new user account. Optionally grant server access on creation.

**Auth:** `user.create`  
**Body:**
```json
{
  "email": "newuser@example.com",
  "username": "newuser",
  "password": "securePassword123",
  "role": "user",
  "serverIds": ["srv_1", "srv_2"],
  "serverPermissions": ["server.read", "server.start"]
}
```

**Notes:**
- `serverIds` and `serverPermissions` are optional. If provided, the user is granted access to the specified servers with the given permissions.
- `role` defaults to the system's default role if not specified.

#### GET `/api/admin/stats` — System Statistics

**Auth:** `admin.read` or any resource read permission (`user.read`, `role.read`, `node.read`, `location.read`, `template.read`, `server.read`, `apikey.manage`). Returns only counts the caller is authorized to view.

**Response:**
```json
{
  "users": 150,
  "servers": 45,
  "nodes": 3,
  "activeServers": 38
}
```

#### POST `/api/admin/servers/actions` — Bulk Actions

**Body:**
```json
{
  "serverIds": ["srv_1", "srv_2"],
  "action": "suspend",
  "reason": "Billing suspended"
}
```

Valid actions: `start`, `stop`, `kill`, `restart`, `suspend`, `unsuspend`, `delete`

**Action-specific permissions:**
- `start` / `restart` → `server.start`
- `stop` / `kill` → `server.stop`
- `suspend` / `unsuspend` → `server.suspend`
- `delete` → `server.delete`

**Notes:**
- `reason` is optional and only used with `suspend` action.

#### GET `/api/admin/health` — System Health

Check the overall system health including database connectivity and node status.

**Auth:** `admin.read`  
**Response (200):**
```json
{
  "success": true,
  "data": {
    "healthy": true,
    "database": "connected",
    "nodesOnline": 3,
    "nodesTotal": 3,
    "timestamp": "2024-01-01T00:00:00Z"
  }
}
```

#### GET `/api/admin/system-errors` — List System Errors

List system errors with optional filtering.

**Auth:** `admin.read`  
**Query params:**
- `resolved` — filter by resolved status (`true`/`false`)
- `limit` — max results (default 50)
- `offset` — pagination offset

**Response (200):**
```json
{
  "success": true,
  "data": {
    "errors": [
      {
        "id": "err_xxx",
        "message": "Node heartbeat timeout",
        "stack": "...",
        "resolved": false,
        "createdAt": "2024-01-01T00:00:00Z"
      }
    ],
    "total": 12
  }
}
```

#### POST `/api/admin/system-errors/:id/resolve` — Resolve System Error

Mark a system error as resolved.

**Auth:** `admin.write`  
**Response (200):**
```json
{
  "success": true,
  "data": {
    "resolved": true
  }
}
```

#### GET `/api/admin/security-settings` / PUT `/api/admin/security-settings`

Get or update global security settings.

**Auth:** `admin.read` (GET), `admin.write` (PUT)  
**Body (PUT):**
```json
{
  "registrationEnabled": true,
  "requireEmailVerification": true,
  "maxLoginAttempts": 5,
  "lockoutDurationMinutes": 30,
  "passwordMinLength": 8,
  "passwordRequireUppercase": true,
  "passwordRequireNumbers": true,
  "passwordRequireSpecial": true,
  "sessionTimeoutMinutes": 60,
  "apiKeyMaxRequestsPerMinute": 600,
  "allowApiKeyAuth": true,
  "allowAgentAuth": true,
  "agentAuthMaxRequestsPerMinute": 600
}
```

#### GET `/api/admin/ip-pools` / POST `/api/admin/ip-pools`

List or create IPAM (IP Address Management) pools.

**Auth:** `admin.read` (GET), `admin.write` (POST)  
**Body (POST):**
```json
{
  "name": "Production IPs",
  "subnet": "10.0.0.0/24",
  "gateway": "10.0.0.1",
  "nodeId": "node_xxx"
}
```

#### PUT `/api/admin/ip-pools/:poolId` / DELETE `/api/admin/ip-pools/:poolId`

Update or delete an IPAM pool.

**Auth:** `admin.write`  
**Body (PUT):**
```json
{
  "name": "Updated Pool Name",
  "subnet": "10.0.1.0/24",
  "gateway": "10.0.1.1"
}
```

#### GET `/api/admin/database-hosts` / POST `/api/admin/database-hosts`

List or create database hosts for server databases.

**Auth:** `admin.read` (GET), `admin.write` (POST)  
**Body (POST):**
```json
{
  "name": "MySQL Primary",
  "host": "db.example.com",
  "port": 3306,
  "username": "catalyst",
  "password": "securePassword123",
  "database": "catalyst_dbs",
  "maxDatabases": 100
}
```

#### PUT `/api/admin/database-hosts/:hostId` / DELETE `/api/admin/database-hosts/:hostId`

Update or delete a database host.

**Auth:** `admin.write`  
**Body (PUT):** Same as POST, all fields optional.

#### GET `/api/admin/oidc-config` / PATCH `/api/admin/oidc-config`

Get or update OIDC (OpenID Connect) provider configuration for SSO.

**Auth:** `admin.read` (GET), `admin.write` (PATCH)  
**Body (PATCH):**
```json
{
  "enabled": true,
  "provider": "authentik",
  "clientId": "catalyst-client-id",
  "clientSecret": "catalyst-client-secret",
  "authorizationEndpoint": "https://auth.example.com/application/o/authorize/",
  "tokenEndpoint": "https://auth.example.com/application/o/token/",
  "userInfoEndpoint": "https://auth.example.com/application/o/userinfo/",
  "scopes": ["openid", "profile", "email"]
}
```

---

### Role Management

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/roles` | `role.read` | List all roles |
| `GET` | `/api/roles/:id` | `role.read` | Get role details with assigned users |
| `POST` | `/api/roles` | `role.create` | Create a role |
| `PUT` | `/api/roles/:id` | `role.update` | Update a role |
| `DELETE` | `/api/roles/:id` | `role.delete` | Delete a role |
| `POST` | `/api/roles/:id/permissions` | `role.update` | Add a permission to role |
| `DELETE` | `/api/roles/:id/permissions/*` | `role.update` | Remove a permission from role |
| `POST` | `/api/roles/:id/users/:userId` | `user.set_roles` | Assign role to user |
| `DELETE` | `/api/roles/:id/users/:userId` | `user.set_roles` | Remove role from user |
| `GET` | `/api/roles/:id/nodes` | `node.read` | Get nodes assigned to role |
| `GET` | `/api/roles/users/:userId/roles` | `user.read` | Get user's roles and permissions |
| `GET` | `/api/roles/users/:userId/nodes` | `node.read` | Get nodes accessible to user via roles |
| `GET` | `/api/roles/presets` | `role.read` | Get available permission presets |

#### DELETE `/api/roles/:roleId/permissions/:permission`

Remove a specific permission from a role. The permission string must match exactly.

**Auth:** `role.update`  
**Response (200):**
```json
{
  "success": true,
  "data": {
    "roleId": "role_xxx",
    "removed": "server.delete",
    "remainingPermissions": ["server.read", "server.start", "server.stop"]
  }
}
```

#### GET `/api/roles/users/:userId/roles`

Get all roles assigned to a user along with their aggregated permissions. Useful for debugging permission issues.

**Auth:** `user.read`  
**Response (200):**
```json
{
  "success": true,
  "data": {
    "userId": "user_xxx",
    "roles": [
      {
        "id": "role_xxx",
        "name": "Administrator",
        "permissions": ["*"]
      }
    ],
    "effectivePermissions": ["*"],
    "roleHierarchy": "user -> Administrator"
  }
}
```

#### GET `/api/roles/presets`

Get available permission presets that can be used when creating roles. Presets provide common permission groupings.

**Auth:** `role.read`  
**Response (200):**
```json
{
  "success": true,
  "data": {
    "presets": [
      {
        "name": "Server Owner",
        "permissions": [
          "server.read", "server.start", "server.stop", "server.update",
          "server.delete", "console.read", "console.write",
          "file.read", "file.write", "backup.read", "backup.create",
          "alert.read", "alert.create"
        ]
      },
      {
        "name": "Moderator",
        "permissions": [
          "server.read", "console.read", "file.read"
        ]
      }
    ]
  }
}
```

#### GET `/api/roles/:roleId/nodes`

Get all nodes assigned to a role.

**Auth:** `node.read`  
**Response (200):**
```json
{
  "success": true,
  "data": {
    "nodes": [
      {
        "id": "node_xxx",
        "name": "Production",
        "assignedAt": "2024-01-01T00:00:00Z"
      }
    ],
    "total": 1
  }
}
```

#### Role Permissions

Catalyst uses a granular permission system. Each role has an array of permission strings:

```json
{
  "permissions": [
    "server.read",
    "server.start",
    "server.stop",
    "server.update",
    "server.delete",
    "server.install",
    "server.transfer",
    "server.schedule",
    "server.suspend",
    "console.read",
    "console.write",
    "file.read",
    "file.write",
    "backup.read",
    "backup.create",
    "backup.restore",
    "backup.delete",
    "database.read",
    "database.create",
    "database.rotate",
    "database.delete",
    "alert.read",
    "alert.create",
    "alert.update",
    "alert.delete",
    "node.read",
    "node.create",
    "node.update",
    "node.delete",
    "node.assign",
    "node.manage_allocation",
    "user.read",
    "user.create",
    "user.update",
    "user.delete",
    "user.set_roles",
    "role.read",
    "role.create",
    "role.update",
    "role.delete",
    "template.read",
    "template.create",
    "template.update",
    "template.delete",
    "apikey.manage",
    "admin.read",
    "admin.write",
    "view_stats"
  ]
}
```

The special permission `*` grants all permissions.

#### GET `/api/roles` — List Roles

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "role_xxx",
      "name": "Administrator",
      "description": "Full access",
      "permissions": ["*"],
      "userCount": 2,
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-01T00:00:00Z"
    },
    {
      "id": "role_yyy",
      "name": "Server Owner",
      "description": "Server management only",
      "permissions": [
        "server.read", "server.start", "server.stop", "server.update",
        "server.delete", "console.read", "console.write",
        "file.read", "file.write", "backup.read", "backup.create",
        "alert.read", "alert.create"
      ],
      "userCount": 15,
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

---

### Template & Nest Management

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/nests` | `template.read` | List all nests with template counts |
| `GET` | `/api/nests/:id` | `template.read` | Get nest with its templates |
| `POST` | `/api/nests` | `admin.write` | Create a nest |
| `PUT` | `/api/nests/:id` | `admin.write` | Update a nest |
| `DELETE` | `/api/nests/:id` | `admin.write` | Delete a nest |

**Note on nest deletion:** Deleting a nest does **not** delete its templates. The templates' `nestId` is set to `null`, making them orphaned. You can reassign orphaned templates to a new nest later.

| `GET` | `/api/locations` | `admin.read` | List all locations |
| `GET` | `/api/locations/:id` | `admin.read` | Get location with nodes |
| `POST` | `/api/locations` | `admin.write` | Create a location |
| `PUT` | `/api/locations/:id` | `admin.write` | Update a location |
| `DELETE` | `/api/locations/:id` | `admin.write` | Delete a location |
| `GET` | `/api/templates` | `template.read` | List all templates |
| `GET` | `/api/templates/:id` | `template.read` | Get template details |
| `POST` | `/api/templates` | `template.create` | Create a template |
| `PUT` | `/api/templates/:id` | `template.update` | Update a template |
| `DELETE` | `/api/templates/:id` | `template.delete` | Delete a template (if not in use) |
| `POST` | `/api/templates/import-pterodactyl` | `template.create` | Import Pterodactyl egg |

#### GET `/api/providers/status` — Provider API Key Availability

Reports which mod/plugin provider API keys are configured. Booleans only — key values are never exposed. Any authenticated user can read this (subusers see the same tabs); the frontend uses it to hide providers whose required key is missing (Modrinth, CurseForge) from the plugin/mod-manager provider dropdowns.

**Auth:** any authenticated user
**Response:**

```json
{
  "success": true,
  "data": {
    "modrinth": true,
    "curseforge": false
  }
}
```

#### POST `/api/templates/import-pterodactyl`

Import a Pterodactyl egg (template configuration) into Catalyst. Converts the egg format to Catalyst's template schema.

**Auth:** `template.create`  
**Body:**
```json
{
  "eggId": "abc123",
  "nestId": "nest_xxx",
  "name": "Minecraft - Paper",
  "description": "Paper Minecraft server",
  "author": "Community"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "imported": true,
    "templateId": "tpl_new",
    "variablesConverted": 12,
    "features": {
      "configFile": "server.properties",
      "startupDetection": { "done": "[Server thread/INFO]: Done" }
    }
  }
}
```

**Errors:**
- `400` — Invalid egg ID or nest mismatch
- `409` — Template with same name already exists in this nest

#### POST `/api/templates` — Create Template

Create a new server template.

**Auth:** `template.create`  
**Body:**
```json
{
  "name": "Valheim",
  "description": "Valheim game server",
  "author": "Catalyst Team",
  "version": "1.0.0",
  "image": "ghcr.io/catalyst/valheim:latest",
  "images": [
    { "name": "stable", "label": "Stable", "image": "ghcr.io/catalyst/valheim:1.0" },
    { "name": "beta", "label": "Beta", "image": "ghcr.io/catalyst/valheim:beta" }
  ],
  "defaultImage": "ghcr.io/catalyst/valheim:1.0",
  "installImage": "ghcr.io/catalyst/valheim-installer:latest",
  "startup": "./valheim_server.x86_64 -name \"{{SERVER_NAME}}\" -port {{SERVER_PORT}}",
  "stopCommand": "^C",
  "sendSignalTo": "SIGINT",
  "installScript": "#!/bin/bash\napt-get update && apt-get install -y valheim-server",
  "configFile": "serverconfig.txt",
  "variables": [
    {
      "name": "SERVER_NAME",
      "description": "Server name",
      "default": "My Valheim Server",
      "required": true,
      "input": "text",
      "rules": []
    },
    {
      "name": "SERVER_PORT",
      "description": "Server port",
      "default": "2456",
      "required": true,
      "input": "number",
      "rules": ["between:1024,65535"]
    }
  ],
  "supportedPorts": [2456],
  "allocatedMemoryMb": 2048,
  "allocatedCpuCores": 1,
  "features": {
    "configFile": "serverconfig.txt",
    "startupDetection": { "done": "[success] Server started" }
  },
  "nestId": "nest_xxx",
  "srvService": null,
  "srvProtocol": "tcp"
}
```

**Required fields:** `name`, `author`, `version`, `startup`, `stopCommand`, `sendSignalTo`, `supportedPorts`, `allocatedMemoryMb`, `allocatedCpuCores`

**Field details:**
- `name` — unique template name
- `author` — template author (required)
- `version` — semantic version (required)
- `image` — primary Docker image
- `images` — array of alternative images: `{ name, label?, image }`
- `defaultImage` — default image to use when creating servers
- `installImage` — Docker image used during installation
- `startup` — startup command template with `{{VARIABLE}}` interpolation
- `stopCommand` — command to gracefully stop the server (required)
- `sendSignalTo` — signal sent on stop: `"SIGTERM"`, `"SIGINT"`, or `"SIGKILL"` (required)
- `installScript` — shell script run during first install
- `configFile` — primary config file path (e.g. `server.properties`)
- `variables` — array of environment variable definitions
- `supportedPorts` — array of port numbers the server uses (required)
- `allocatedMemoryMb` — default memory allocation in MB (required)
- `allocatedCpuCores` — default CPU allocation (required)
- `features` — arbitrary feature flags object
- `nestId` — optional nest to group under
- `srvService` — optional SRV record service name
- `srvProtocol` — SRV protocol, default `"tcp"`

**Response (200):**
```json
{
  "success": true,
  "data": { /* created template object */ }
}
```

**Errors:**
- `409` — Template with same name already exists

#### PUT `/api/templates/:id` — Update Template

Update an existing template. All body fields are optional — only provided fields are updated.

**Auth:** `template.update`  
**Body:** Same schema as create (all fields optional).

**Response (200):**
```json
{
  "success": true,
  "data": { /* updated template object */ }
}
```

#### Template Structure

Templates define how game servers are deployed:

```json
{
  "id": "tpl_xxx",
  "name": "Valheim",
  "description": "Valheim game server",
  "author": "Catalyst Team",
  "version": "1.0.0",
  "image": "ghcr.io/catalyst/valheim:latest",
  "images": [
    { "name": "stable", "label": "Stable", "image": "ghcr.io/catalyst/valheim:1.0" },
    { "name": "beta", "label": "Beta", "image": "ghcr.io/catalyst/valheim:beta" }
  ],
  "defaultImage": "ghcr.io/catalyst/valheim:1.0",
  "installImage": "ghcr.io/catalyst/valheim-installer:latest",
  "startup": "./valheim_server.x86_64 -name \"{{SERVER_NAME}}\" -port {{SERVER_PORT}}",
  "stopCommand": "^C",
  "sendSignalTo": "SIGINT",
  "installScript": "#!/bin/bash\napt-get update && apt-get install -y valheim-server",
  "configFile": "serverconfig.txt",
  "variables": [
    {
      "name": "SERVER_NAME",
      "description": "Server name",
      "default": "My Valheim Server",
      "required": true,
      "input": "text",
      "rules": []
    }
  ],
  "supportedPorts": [2456],
  "allocatedMemoryMb": 2048,
  "allocatedCpuCores": 1,
  "features": {
    "configFile": "serverconfig.txt",
    "startupDetection": { "done": "[success] Server started" }
  },
  "nestId": "nest_xxx",
  "srvService": null,
  "srvProtocol": "tcp",
  "createdAt": "2024-01-01T00:00:00Z",
  "updatedAt": "2024-01-01T00:00:00Z"
}
```

---

### Location Management

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/locations` | `admin.read` | List all locations |
| `GET` | `/api/locations/:id` | `admin.read` | Get location with nodes |
| `POST` | `/api/locations` | `admin.write` | Create a location |
| `PUT` | `/api/locations/:id` | `admin.write` | Update a location |
| `DELETE` | `/api/locations/:id` | `admin.write` | Delete a location |

#### GET `/api/locations/:id`

Get a single location with its associated nodes.

**Auth:** `template.read`  
**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "loc_xxx",
    "name": "US East",
    "description": "Primary US datacenter",
    "nodes": [
      {
        "id": "node_xxx",
        "name": "Node-1",
        "hostname": "node1.example.com",
        "isOnline": true,
        "serverCount": 15
      }
    ],
    "nodeCount": 3,
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
}
```

---

### Alert Management

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/alert-rules` | `alert.read` (server rules) or `admin` (global) | List alert rules (filterable) |
| `GET` | `/api/alert-rules/:id` | `alert.read` | Get a specific rule |
| `POST` | `/api/alert-rules` | `alert.create` (server rules) or `admin` (global) | Create alert rule |
| `PUT` | `/api/alert-rules/:id` | `alert.update` (server rules) or `admin` (global) | Update alert rule |
| `DELETE` | `/api/alert-rules/:id` | `alert.delete` (server rules) or `admin` (global) | Delete alert rule |
| `GET` | `/api/alerts` | `alert.read` (server alerts) or `admin` (global) | List alerts (paginated) |
| `GET` | `/api/alerts/:id` | `alert.read` | Get a specific alert |
| `POST` | `/api/alerts/:id/resolve` | `alert.update` | Resolve an alert |
| `POST` | `/api/alerts/bulk-resolve` | `alert.update` | Bulk resolve alerts |
| `GET` | `/api/alerts/stats` | `alert.read` | Get alert statistics |
| `GET` | `/api/alerts/:id/deliveries` | `alert.read` | Get alert delivery log |

#### GET `/api/alerts/:alertId/deliveries`

Get the delivery history for a specific alert. Shows which delivery channels were attempted and their status.

**Auth:** Session  
**Response (200):**
```json
{
  "success": true,
  "data": {
    "alertId": "alert_xxx",
    "deliveries": [
      {
        "id": "del_xxx",
        "type": "email",
        "recipient": "admin@example.com",
        "status": "delivered",
        "sentAt": "2024-01-01T12:00:00Z",
        "deliveredAt": "2024-01-01T12:00:05Z"
      },
      {
        "id": "del_yyy",
        "type": "webhook",
        "url": "https://hooks.example.com/alerts",
        "status": "failed",
        "sentAt": "2024-01-01T12:00:00Z",
        "error": "HTTP 502: Bad Gateway"
      }
    ]
  }
}
```

#### GET `/api/alerts/stats`

Get alert statistics including total counts, breakdowns by severity and type, and trend data.

**Auth:** Session  
**Response (200):**
```json
{
  "success": true,
  "data": {
    "total": 150,
    "unresolved": 12,
    "resolved": 138,
    "bySeverity": {
      "critical": 3,
      "warning": 9,
      "info": 0
    },
    "byType": {
      "resource_threshold": 8,
      "node_offline": 3,
      "server_crashed": 1
    },
    "byTarget": {
      "server": 10,
      "node": 4,
      "global": 2
    },
    "last24h": {
      "new": 5,
      "resolved": 3
    }
  }
}
```

#### Alert Types

- `resource_threshold` — CPU, memory, or disk exceeds threshold
- `node_offline` — Node hasn't sent a heartbeat
- `server_crashed` — Server process has crashed

#### Alert Targets

- `server` — specific server (requires `targetId`)
- `node` — specific node (requires `targetId`)
- `global` — all servers/nodes

#### POST `/api/alert-rules` — Create Rule

**Body:**
```json
{
  "name": "High Memory Usage",
  "description": "Alert when memory exceeds 90%",
  "type": "resource_threshold",
  "target": "server",
  "targetId": "srv_xxx",
  "conditions": {
    "metric": "memory_usage_percent",
    "operator": ">",
    "value": 90,
    "durationSeconds": 300
  },
  "actions": {
    "webhook": { "url": "https://hooks.example.com/alerts" },
    "email": { "recipients": ["admin@example.com"] }
  },
  "enabled": true
}
```

---

### Scheduled Tasks

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/servers/:id/tasks` | `server.schedule` | List scheduled tasks |
| `GET` | `/api/servers/:id/tasks/:taskId` | `server.schedule` | Get a specific task |
| `POST` | `/api/servers/:id/tasks` | `server.schedule` | Create a task |
| `PUT` | `/api/servers/:id/tasks/:taskId` | `server.schedule` | Update a task |
| `DELETE` | `/api/servers/:id/tasks/:taskId` | `server.schedule` | Delete a task |
| `POST` | `/api/servers/:id/tasks/:taskId/execute` | `server.schedule` | Execute task immediately |

#### POST `/api/servers/:id/tasks` — Create Task

Create a scheduled task for a server. Tasks run automatically based on a cron expression.

**Auth:** Session (`server.schedule`)  
**Body:**
```json
{
  "name": "Daily Backup",
  "description": "Automated daily backup at 3 AM",
  "action": "backup",
  "payload": {
    "retention": 7
  },
  "schedule": "0 3 * * *"
}
```

- `name` — task name (required)
- `description` — optional human-readable description
- `action` — task action (required). Valid: `restart`, `stop`, `start`, `backup`, `command`
- `payload` — action-specific payload (optional, defaults to `{}`)
  - `command` action: `{ "command": "say Server restart in 1 minute" }`
  - `backup` action: `{ "retention": 7 }` (optional retention days)
  - `restart`, `stop`, `start` actions: payload can be omitted or empty `{}`
- `schedule` — cron expression in standard format (required). Example: `"0 3 * * *"` for daily at 3 AM.

**Response (200):**
```json
{
  "success": true,
  "task": {
    "id": "task_xxx",
    "serverId": "srv_xxx",
    "name": "Daily Backup",
    "description": "Automated daily backup at 3 AM",
    "action": "backup",
    "payload": { "retention": 7 },
    "schedule": "0 3 * * *",
    "enabled": true,
    "nextRunAt": "2024-01-02T03:00:00Z",
    "createdAt": "2024-01-01T00:00:00Z"
  }
}
```

**Errors:**
- `400` — Missing required fields, invalid cron expression, or invalid action
- `404` — Server not found
- `403` — Insufficient permissions
- `423` — Server is suspended

#### PUT `/api/servers/:id/tasks/:taskId` — Update Task

Update an existing scheduled task. All fields are optional — only provided fields are updated.

**Auth:** Session (`server.schedule`)  
**Body:** Same schema as create (all fields optional).

**Response (200):**
```json
{
  "success": true,
  "task": { /* updated task */ }
}
```

**Errors:**
- `400` — Invalid cron expression or invalid action
- `404` — Task or server not found
- `403` — Insufficient permissions
- `423` — Server is suspended

---

### Plugin Management

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/plugins` | `admin.read` | List all plugins |
| `GET` | `/api/plugins/:name` | `admin.read` | Get plugin details |
| `POST` | `/api/plugins/:name/enable` | `admin.write` | Enable or disable a plugin |
| `POST` | `/api/plugins/:name/reload` | `admin.write` | Hot-reload a plugin |
| `PUT` | `/api/plugins/:name/config` | `admin.write` | Update plugin configuration |
| `PUT` | `/api/plugins/:name/permissions` | `admin.write` | Replace effective permission grants |
| `POST` | `/api/plugins/install` | `admin.write` | Install/upgrade a `.catpkg.zip` by URL |
| `POST` | `/api/plugins/:name/uninstall` | `admin.write` | Remove an installed plugin |
| `GET` | `/api/plugins/marketplace` | `admin.read` | Browse configured marketplace indexes |
| `GET` | `/api/plugins/marketplace/sources` | `admin.read` | List marketplace sources (official, env, panel-added) |
| `POST` | `/api/plugins/marketplace/sources` | `admin.write` | Add a marketplace source from the panel |
| `PATCH` | `/api/plugins/marketplace/sources/:id` | `admin.write` | Enable or disable a panel-added source |
| `DELETE` | `/api/plugins/marketplace/sources/:id` | `admin.write` | Remove a panel-added source |
| `GET` | `/plugins-assets/:name/:file` | auth | Serve installed-plugin runtime frontend assets |
| `GET` | `/api/plugins/:name/frontend-manifest` | `admin.read` | Get plugin frontend manifest |

#### GET `/api/plugins`

List all installed plugins with their status and metadata.

**Auth:** `admin.read`  
**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "name": "webhook-notifier",
      "version": "1.2.0",
      "displayName": "Webhook Notifier",
      "description": "Send server events to webhooks",
      "author": "Example",
      "status": "enabled",
      "enabled": true,
      "loadedAt": "2024-01-01T00:00:00Z",
      "enabledAt": "2024-01-01T00:00:00Z",
      "error": null,
      "permissions": ["server.read", "server.start"],
      "hasBackend": true,
      "hasFrontend": true,
      "dependencies": [],
      "hasDeclaredEvents": true,
      "declaredEvents": ["server.start", "server.stop"]
    }
  ]
}
```

**Response fields:**
- `status` — `"enabled"`, `"disabled"`, `"error"`, or `"loading"`
- `loadedAt` — ISO timestamp when the plugin was first loaded
- `enabledAt` — ISO timestamp when the plugin was last enabled
- `error` — error message if the plugin failed to load, otherwise `null`
- `hasDeclaredEvents` — whether the plugin declares event handlers
- `declaredEvents` — array of event names the plugin handles

#### GET `/api/plugins/:name`

Get detailed information about a specific plugin, including its runtime state, registered routes, WebSocket handlers, and scheduled tasks.

**Auth:** `admin.read`  
**Response (200):**
```json
{
  "success": true,
  "data": {
    "name": "webhook-notifier",
    "version": "1.2.0",
    "displayName": "Webhook Notifier",
    "description": "Send server events to webhooks",
    "author": "Example",
    "catalystVersion": ">=1.0.0",
    "status": "enabled",
    "enabled": true,
    "loadedAt": "2024-01-01T00:00:00Z",
    "enabledAt": "2024-01-01T00:00:00Z",
    "error": null,
    "permissions": ["server.read", "server.start"],
    "config": {
      "webhookUrl": { "type": "string", "default": "" },
      "notifyOnStart": { "type": "boolean", "default": true }
    },
    "configSchema": { /* raw config object */ },
    "hasBackend": true,
    "hasFrontend": true,
    "routes": [
      { "method": "POST", "url": "/api/webhooks/send" }
    ],
    "wsHandlers": ["webhook_events"],
    "tasks": [{ "cron": "0 * * * *" }],
    "dependencies": [],
    "events": {
      "server.start": "onServerStart",
      "server.stop": "onServerStop"
    },
    "exposedApis": ["webhook-send", "webhook-list"]
  }
}
```

**Response fields:**
- `configSchema` — the plugin's raw config schema object
- `routes` — array of `{ method, url }` for backend routes registered by the plugin
- `wsHandlers` — array of WebSocket handler names
- `tasks` — array of `{ cron }` for scheduled tasks registered by the plugin
- `exposedApis` — array of API names exposed by the plugin for inter-plugin communication

#### POST `/api/plugins/:name/enable`

Enable or disable a plugin. Enabling loads the plugin's backend and frontend. Disabling unloads it.

**Auth:** `admin.write`  
**Body:**
```json
{
  "enabled": true,
  "safety": { "disclaimerVersion": "1" }
}
```

- `enabled` — boolean, required
- `safety.disclaimerVersion` — optional; required to pass the safety-consent gate when re-acceptance is pending (first enable, plugin update, added permissions, or disclaimer bump)

**Response (200):**
```json
{
  "success": true,
  "message": "Plugin enabled successfully"
}
```

**Consent gate response (409):**
```json
{
  "success": false,
  "code": "SAFETY_CONSENT_REQUIRED",
  "reason": "permissions_grew",
  "requestedPermissions": ["server.read"],
  "disclaimerVersion": "1"
}
```

**Errors:**
- `400` — Plugin failed to enable/disable
- `404` — Plugin not found
- `409` — Safety disclaimer acceptance required (`SAFETY_CONSENT_REQUIRED`)

#### PUT `/api/plugins/:name/permissions`

Replace the admin-controlled effective grants for a plugin. The grant list must be a subset of the plugin's declared permissions. Revocations take effect immediately for the plugin's data and RPC access.

**Auth:** `admin.write`  
**Body:**
```json
{
  "granted": ["server.read"]
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Plugin permissions updated",
  "data": {
    "declaredPermissions": ["server.read", "server.write"],
    "grantedPermissions": ["server.read"],
    "revokedPermissions": ["server.write"]
  }
}
```

**Errors:**
- `400` — Grant list contains undeclared permissions
- `404` — Plugin not found or in error state

#### POST `/api/plugins/:name/reload`

Hot-reload a plugin. Unloads and re-loads the plugin without restarting the panel. Useful during development.

**Auth:** `admin.write`  
**Response (200):**
```json
{
  "success": true,
  "message": "Plugin reloaded successfully"
}
```

**Errors:**
- `400` — Plugin failed to reload
- `404` — Plugin not found

#### PUT `/api/plugins/:name/config`

Update a plugin's runtime configuration. The config object must match the plugin's `configSchema`.

**Auth:** `admin.write`  
**Body:**
```json
{
  "config": {
    "webhookUrl": "https://hooks.example.com/alerts",
    "notifyOnStart": true
  }
}
```

- `config` — object matching the plugin's config schema (required)

**Response (200):**
```json
{
  "success": true,
  "message": "Plugin configuration updated"
}
```

**Errors:**
- `400` — Invalid config values
- `404` — Plugin not found

#### GET `/api/plugins/:name/frontend-manifest`

Get the frontend manifest for a plugin. Returns information about registered routes, tabs, slots, and components that the plugin adds to the frontend.

**Auth:** Session  
**Response (200):**
```json
{
  "success": true,
  "data": {
    "name": "webhook-notifier",
    "version": "1.2.0",
    "routes": [
      { "path": "/webhooks", "component": "WebhookPage" }
    ],
    "adminTabs": [
      { "id": "webhook-settings", "label": "Webhooks", "order": 5 }
    ],
    "slots": [
      { "name": "server-header", "component": "WebhookStatusBadge" }
    ],
    "hasErrorBoundary": true
  }
}
```

#### Plugin Manifest Structure

```json
{
  "name": "webhook-notifier",
  "version": "1.2.0",
  "displayName": "Webhook Notifier",
  "description": "Send server events to webhooks",
  "author": "Example",
  "catalystVersion": ">=1.0.0",
  "status": "enabled",
  "enabled": true,
  "permissions": ["server.read", "server.start"],
  "config": {
    "webhookUrl": { "type": "string", "default": "" },
    "notifyOnStart": { "type": "boolean", "default": true }
  },
  "dependencies": [],
  "hasBackend": true,
  "hasFrontend": true,
  "events": {
    "server.start": "onServerStart",
    "server.stop": "onServerStop"
  }
}
```

---

### API Key Management

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/admin/api-keys/permissions-catalog` | `apikey.manage` | List all permissions |
| `GET` | `/api/admin/api-keys/my-permissions` | `apikey.manage` | Current user's permissions |
| `GET` | `/api/admin/api-keys` | `apikey.manage` | List all API keys |
| `GET` | `/api/admin/api-keys/:id` | `apikey.manage` | Get API key details |
| `POST` | `/api/admin/api-keys` | `apikey.manage` | Create API key |
| `PATCH` | `/api/admin/api-keys/:id` | `apikey.manage` | Update API key |
| `DELETE` | `/api/admin/api-keys/:id` | `apikey.manage` | Delete API key |
| `GET` | `/api/admin/api-keys/:id/usage` | `apikey.manage` | Get API key usage stats |

#### GET `/api/admin/api-keys/permissions-catalog`

List all available permission categories and their individual permissions. Useful for building permission selection UIs.

**Auth:** `apikey.manage`  
**Response (200):**
```json
{
  "success": true,
  "data": {
    "categories": [
      {
        "name": "server",
        "permissions": [
          "server.read", "server.start", "server.stop", "server.update",
          "server.delete", "server.install", "server.transfer",
          "server.schedule", "server.suspend"
        ]
      },
      {
        "name": "console",
        "permissions": ["console.read", "console.write"]
      },
      {
        "name": "file",
        "permissions": ["file.read", "file.write"]
      }
    ]
  }
}
```

#### GET `/api/admin/api-keys/my-permissions`

Get the effective permissions for the authenticated user or API key. Shows the flattened list of all permissions.

**Auth:** Session or API key  
**Response (200):**
```json
{
  "success": true,
  "data": {
    "permissions": [
      "server.read", "server.start", "server.stop",
      "console.read", "file.read"
    ],
    "hasAllPermissions": false,
    "roleNames": ["Server Owner", "Moderator"]
  }
}
```

#### GET `/api/admin/api-keys/:id/usage`

Get usage statistics for an API key, including request counts and rate limit information.

**Auth:** `apikey.manage`  
**Response (200):**
```json
{
  "success": true,
  "data": {
    "keyId": "key_xxx",
    "totalRequests": 15234,
    "requestsLastHour": 150,
    "requestsLastDay": 2500,
    "requestsLastWeek": 12000,
    "rateLimit": {
      "max": 100,
      "timeWindowMs": 60000,
      "currentWindowCount": 12
    },
    "lastRequestAt": "2024-01-01T12:00:00Z",
    "topEndpoints": [
      { "path": "/api/servers", "count": 5000 },
      { "path": "/api/servers/:id/start", "count": 2000 }
    ]
  }
}
```

#### POST `/api/admin/api-keys` — Create API Key

**Body:**
```json
{
  "name": "CI/CD Pipeline",
  "expiresIn": 86400000,
  "allPermissions": false,
  "permissions": [
    "server.read",
    "server.start",
    "server.stop"
  ],
  "metadata": {
    "pipeline": "github-actions",
    "repo": "example/app"
  },
  "rateLimitMax": 100,
  "rateLimitTimeWindow": 60000
}
```

---

### Migration

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/admin/migration/catalyst-nodes` | `admin.write` | List online Catalyst nodes |
| `POST` | `/api/admin/migration/test` | `admin.write` | Test Pterodactyl connection |
| `POST` | `/api/admin/migration/start` | `admin.write` | Start a migration |
| `GET` | `/api/admin/migration` | `admin.write` | List migration jobs |
| `GET` | `/api/admin/migration/:jobId` | `admin.write` | Get migration job status |
| `POST` | `/api/admin/migration/:jobId/pause` | `admin.write` | Pause migration |
| `POST` | `/api/admin/migration/:jobId/resume` | `admin.write` | Resume migration |
| `POST` | `/api/admin/migration/:jobId/cancel` | `admin.write` | Cancel migration |
| `GET` | `/api/admin/migration/:jobId/steps` | `admin.write` | Get migration steps |
| `POST` | `/api/admin/migration/:jobId/retry/:stepId` | `admin.write` | Retry a failed step |

#### POST `/api/admin/migration/test`

Test the connection to a Pterodactyl panel before starting a migration. Verifies the API key, panel URL, and permissions.

**Auth:** `admin.write`  
**Body:**
```json
{
  "url": "https://pterodactyl.example.com",
  "key": "ptla_xxxxxxxxxxxxxxxxxxxxxxxx",
  "clientApiKey": "ptlc_xxxxxxxxxxxxxxxxxxxxxxxx"
}
```

- `url` — Pterodactyl panel URL (required)
- `key` — Application API key (`ptla_*`) (required)
- `clientApiKey` — Client API key (`ptlc_*`) — required for backup and file migration

**Response (200):**
```json
{
  "success": true,
  "data": {
    "connected": true,
    "panelVersion": "1.11.5",
    "apiAccess": true,
    "nodesFound": 3,
    "serversFound": 45
  }
}
```

**Errors:**
- `400` — Invalid API key or connection refused
- `403` — API key lacks required permissions

#### POST `/api/admin/migration/start`

Start a new Pterodactyl → Catalyst migration job. Only one migration can run at a time.

**Auth:** `admin.write`  
**Body:**
```json
{
  "url": "https://pterodactyl.example.com",
  "key": "ptla_xxxxxxxxxxxxxxxxxxxxxxxx",
  "clientApiKey": "ptlc_xxxxxxxxxxxxxxxxxxxxxxxx",
  "scope": "full",
  "nodeMappings": {
    "ptero-node-1": "catalyst-node-1",
    "ptero-node-2": "catalyst-node-2"
  },
  "serverMappings": {
    "ptero-server-1": "catalyst-node-1"
  }
}
```

- `url` — Pterodactyl panel URL (required)
- `key` — Application API key (`ptla_*`) (required)
- `clientApiKey` — Client API key (`ptlc_*`) — required for backup/file migration
- `scope` — migration scope: `"full"`, `"node"`, or `"server"` (default `"full"`)
- `nodeMappings` — map of Pterodactyl node IDs to Catalyst node IDs. Required for `"full"` and `"node"` scopes.
- `serverMappings` — map of Pterodactyl server IDs to Catalyst node IDs. Required for `"server"` scope.

**Response (200):**
```json
{
  "success": true,
  "jobId": "job_xxx"
}
```

**Errors:**
- `400` — Missing URL or API key
- `409` — A migration is already in progress

#### POST `/api/admin/migration/:jobId/pause`

Pause a running migration. All in-progress steps are completed, but no new steps are started.

**Auth:** `admin.write`  
**Response (200):**
```json
{
  "success": true,
  "data": {
    "status": "paused",
    "message": "Migration paused. Use /resume to continue or /cancel to abort."
  }
}
```

#### POST `/api/admin/migration/:jobId/resume`

Resume a paused migration from where it left off.

**Auth:** `admin.write`  
**Response (200):**
```json
{
  "success": true,
  "data": {
    "status": "running",
    "message": "Migration resumed from step 5/12"
  }
}
```

#### POST `/api/admin/migration/:jobId/cancel`

Cancel a migration. All in-progress steps are abandoned. Data migration is irreversible.

**Auth:** `admin.write`  
**Response (200):**
```json
{
  "success": true,
  "data": {
    "status": "cancelled",
    "message": "Migration cancelled"
  }
}
```

#### GET `/api/admin/migration/:jobId/steps`

Get the detailed steps of a migration job with pagination. Shows each step's status, progress, and any errors.

**Auth:** `admin.write`  
**Query params:**
- `page` — page number (default 1)
- `limit` — steps per page (default 50)
- `phase` — filter by phase (e.g., `users`, `nodes`, `servers`)
- `status` — filter by status (`pending`, `running`, `completed`, `failed`)

**Response (200):
```json
{
  "success": true,
  "data": {
    "steps": [
      {
        "id": "step_1",
        "name": "Migrate Users",
        "status": "completed",
        "startedAt": "2024-01-01T00:00:00Z",
        "completedAt": "2024-01-01T00:05:00Z",
        "progress": 100
      },
      {
        "id": "step_2",
        "name": "Migrate Servers",
        "status": "in_progress",
        "startedAt": "2024-01-01T00:05:00Z",
        "progress": 45
      },
      {
        "id": "step_3",
        "name": "Migrate Nodes",
        "status": "pending"
      }
    ],
    "total": 12,
    "page": 1,
    "limit": 50
  }
}
```

#### POST `/api/admin/migration/:jobId/retry/:stepId`

Retry a failed migration step. Useful after fixing the underlying issue that caused the failure.

**Auth:** `admin.write`  
**Response (200):**
```json
{
  "success": true,
  "data": {
    "status": "running",
    "message": "Step retry started"
  }
}
```

#### Migration Scopes

- `full` — Migrate all servers, nodes, users
- `node` — Migrate servers on specific nodes
- `server` — Migrate specific servers

---

### Dashboard & Metrics

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/dashboard/stats` | `server.read` (permission-scoped response) | Dashboard statistics |
| `GET` | `/api/dashboard/activity` | `server.read` (permission-scoped response) | Recent activity feed |
| `GET` | `/api/dashboard/resources` | `node.read` or `admin` | Cluster resource utilization |
| `GET` | `/api/metrics` | `server.read` | Cluster/server metrics |
| `GET` | `/api/servers/:serverId/metrics/stream` | `server.read` | SSE server metrics stream |
| `GET` | `/api/servers/:serverId/metrics` | `server.read` | Server metrics REST endpoint |
| `GET` | `/api/nodes/:nodeId/metrics` | `admin.read` | Node metrics REST endpoint |

#### GET `/api/dashboard/stats` — Dashboard Statistics

**Auth:** Session. Response is **permission-scoped**:
- Non-admins see counts for their own accessible servers only
- `server.read` gates server counts, `node.read` gates node counts, `alert.read` gates alert counts
- Missing permissions return `0` for that dimension

**Response (200):**
```json
{
  "success": true,
  "data": {
    "servers": 45,
    "serversOnline": 38,
    "nodes": 3,
    "nodesOnline": 3,
    "alerts": 12,
    "alertsUnacknowledged": 3
  }
}
```

Note: Response is cached with a 10-second TTL keyed by user ID and permissions. Stats returned vary based on the user's permissions — non-admins only see counts for servers they own or have access to. Node and alert counts are only shown to users with `node.read` and `alert.read` permissions respectively.

#### GET `/api/dashboard/activity` — Recent Activity Feed

**Auth:** Session. Response is **permission-scoped** — non-admins see only their own activity.

Get recent activity across the system, drawn from audit logs. Aggregates and maps raw event types to human-readable messages.

**Auth:** Session  
**Query params:**
- `limit` — number of events (default 5, max 20)

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": "act_xxx",
      "title": "Server started",
      "detail": "server: srv_xxx",
      "time": "2m ago",
      "type": "server"
    },
    {
      "id": "act_yyy",
      "title": "User created",
      "detail": "user: user_newuser",
      "time": "1h ago",
      "type": "user"
    }
  ]
}
```

**Notes:**
- Response is cached with a 10-second TTL keyed by user ID and permissions.
- Non-admin users only see their own activity.
- The `time` field is a human-readable relative timestamp (e.g., "2m ago", "1h ago").

#### GET `/api/dashboard/resources` — Resource Utilization

**Auth:** `node.read` or `admin`. Returns zeros if the user lacks both permissions.

Get aggregated resource utilization across all online nodes. Provides high-level cluster health metrics.

**Auth:** Session  
**Response (200):**
```json
{
  "success": true,
  "data": {
    "cpuUtilization": 67,
    "memoryUtilization": 72,
    "networkThroughput": 35
  }
}
```

**Notes:**
- `networkThroughput` is a placeholder/estimated value (`runningServers * 5`, capped at 100), not an actual network measurement. Real network throughput requires live agent metrics.
- Users without `node.read` or `admin.read` permissions receive `{ cpuUtilization: 0, memoryUtilization: 0, networkThroughput: 0 }`.

#### GET `/api/servers/:serverId/metrics` — Server Metrics REST

Get historical server resource metrics with automatic bucketing. Returns aggregated data points evenly spaced across the requested time window.

**Auth:** Session (`server.read`)  
**Query params:**
- `hours` — hours of history to return (default: 1, max: 168)
- `limit` — number of buckets to return (default: 100, max: 1000)

**Response (200):**
```json
{
  "success": true,
  "data": {
    "latest": {
      "cpuPercent": 45.2,
      "memoryUsageMb": 1024,
      "diskIoMb": 5,
      "diskUsageMb": 51200,
      "networkRxBytes": "1000000",
      "networkTxBytes": "500000",
      "timestamp": "2024-01-01T12:00:00Z"
    },
    "averages": {
      "cpuPercent": 42.1,
      "memoryUsageMb": 980,
      "diskIoMb": 4,
      "diskUsageMb": 51000
    },
    "history": [
      {
        "cpuPercent": 40.5,
        "memoryUsageMb": 1024,
        "diskIoMb": 5,
        "diskUsageMb": 51200,
        "networkRxBytes": 0.95,
        "networkTxBytes": 0.48,
        "timestamp": "2024-01-01T11:00:00Z"
      }
    ],
    "count": 100
  }
}
```

**Notes:**
- `history` is returned in chronological order (oldest first)
- Network values in `history` are rate-normalized to MB/s
- Empty buckets (no data) return `null` for all metric fields
- Suspended servers return `423` with suspension details

**Errors:**
- `403` — Forbidden (not owner, no access, no node access)
- `404` — Server not found
- `423` — Server is suspended

#### GET `/api/nodes/:nodeId/metrics` — Node Metrics REST

Get historical node resource metrics with automatic bucketing. Same bucketing logic as server metrics but for the node itself.

**Auth:** `admin.read` or `admin.write` (admin only)  
**Query params:**
- `hours` — hours of history to return (default: 1)
- `limit` — number of buckets to return (default: 100)

**Response (200):**
```json
{
  "success": true,
  "data": {
    "latest": {
      "cpuPercent": 45.2,
      "memoryUsageMb": 12000,
      "memoryTotalMb": 16384,
      "diskUsageMb": 50000,
      "diskTotalMb": 200000,
      "networkRxBytes": "1000000",
      "networkTxBytes": "500000",
      "containerCount": 10,
      "timestamp": "2024-01-01T12:00:00Z"
    },
    "averages": {
      "cpuPercent": 42.1,
      "memoryUsageMb": 11500,
      "diskUsageMb": 48000,
      "containerCount": 10
    },
    "history": [
      {
        "cpuPercent": 40.5,
        "memoryUsageMb": 12000,
        "memoryTotalMb": 16384,
        "diskUsageMb": 50000,
        "diskTotalMb": 200000,
        "networkRxBytes": 0.95,
        "networkTxBytes": 0.48,
        "timestamp": "2024-01-01T11:00:00Z"
      }
    ],
    "count": 100,
    "node": {
      "id": "node_xxx",
      "name": "Production",
      "maxMemoryMb": 16384,
      "maxCpuCores": 8,
      "isOnline": true
    }
  }
}
```

**Errors:**
- `403` — Admin access required
- `404` — Node not found

---

### File Tunnel Protocol

> **Warning:** These are internal agent-to-backend endpoints. They are authenticated via node headers and bypass normal API authentication. Do not call these directly unless you are the agent binary.

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/internal/file-tunnel/poll` | `X-Node-Id` + `X-Node-Api-Key` | Agent polls for pending file ops |
| `POST` | `/api/internal/file-tunnel/response/:requestId` | `X-Node-Id` + `X-Node-Api-Key` | Agent sends file op result (JSON) |
| `POST` | `/api/internal/file-tunnel/response/:requestId/stream` | `X-Node-Id` + `X-Node-Api-Key` | Agent sends binary file data |
| `GET` | `/api/internal/file-tunnel/upload/:requestId` | `X-Node-Id` + `X-Node-Api-Key` | Agent fetches upload data |

#### GET `/api/internal/file-tunnel/poll`

The agent polls this endpoint every N seconds to check for pending file operations. Returns pending operations since the last poll.

**Auth:** `X-Node-Id` + `X-Node-Api-Key`  
**Query params:**
- `since` — ISO timestamp of last poll (returns ops after this time)

**Response (200):**
```json
{
  "success": true,
  "data": {
    "operations": [
      {
        "requestId": "req_xxx",
        "type": "read",
        "serverId": "srv_xxx",
        "path": "/world/player.dat",
        "offset": 0,
        "length": 4096,
        "createdAt": "2024-01-01T12:00:00Z"
      },
      {
        "requestId": "req_yyy",
        "type": "write",
        "serverId": "srv_xxx",
        "path": "/config.yml",
        "contentLength": 256,
        "createdAt": "2024-01-01T12:01:00Z"
      }
    ],
    "hasMore": false
  }
}
```

#### POST `/api/internal/file-tunnel/response/:requestId`

Agent sends the result of a file operation as JSON (for metadata-only operations like list, delete, permission changes).

**Auth:** `X-Node-Id` + `X-Node-Api-Key`  
**Body (for `read` operation):**
```json
{
  "requestId": "req_xxx",
  "status": "completed",
  "result": {
    "files": [
      { "path": "/world/", "type": "directory" },
      { "path": "/world/player.dat", "type": "file", "size": 4096 }
    ]
  }
}
```

**Body (for `write` operation):**
```json
{
  "requestId": "req_yyy",
  "status": "completed",
  "result": {
    "bytesWritten": 256
  }
}
```

**Body (for failed operation):**
```json
{
  "requestId": "req_xxx",
  "status": "error",
  "error": {
    "code": "ENOENT",
    "message": "No such file or directory"
  }
}
```

#### POST `/api/internal/file-tunnel/response/:requestId/stream`

Agent sends binary file data for operations that require streaming (file reads/downloads). Used when the file size exceeds the JSON response size limit.

**Auth:** `X-Node-Id` + `X-Node-Api-Key`  
**Content-Type:** `application/octet-stream`  
**Body:** Binary file data

**Response (200):**
```json
{
  "success": true,
  "data": {
    "requestId": "req_xxx",
    "status": "completed",
    "bytesReceived": 1048576
  }
}
```

#### GET `/api/internal/file-tunnel/upload/:requestId`

Agent fetches the upload data for write/upload operations. Returns the file content to write.

**Auth:** `X-Node-Id` + `X-Node-Api-Key`  
**Response (200):**
```
Content-Type: application/octet-stream
Content-Length: 256

[256 bytes of file content]
```

**Response (204):**
No content — the upload was sent as part of the poll request.

---

### SFTP Tokens

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/sftp/connection-info` | Session | Get SFTP connection details |
| `POST` | `/api/sftp/rotate-token` | Session | Rotate SFTP token |
| `GET` | `/api/sftp/tokens` | Session | List SFTP tokens (non-owners see only own token) |
| `DELETE` | `/api/sftp/tokens/:targetUserId` | Session | Revoke token for specific user (own token only unless owner) |
| `DELETE` | `/api/sftp/tokens` | Owner only | Revoke all tokens for server |

#### GET `/api/sftp/connection-info`

**Query params:**
- `serverId` — required
- `ttl` — optional token lifetime in ms

**Response:**
```json
{
  "success": true,
  "data": {
    "enabled": true,
    "host": "panel.example.com",
    "port": 2022,
    "sftpPassword": "sftp_<opaque-token>",
    "username": "<server-uuid>",
    "expiresAt": "2024-01-01T01:00:00Z",
    "ttlMs": 3600000,
    "ttlOptions": [
      { "label": "1 hour", "value": 3600000 },
      { "label": "24 hours", "value": 86400000 }
    ]
  }
}
```

---

### Agent Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/agent/version` | No | Running panel version (install script pin) |
| `GET` | `/api/agent/download` | No | Download agent binary |
| `GET` | `/api/agent/download-checksum` | No | SHA-256 sidecar for the agent binary |
| `GET` | `/api/agent/deploy-script` | No | Get deployment script |
| `GET` | `/api/deploy/:token` | No | Get deployment script for token |

#### GET `/api/agent/version`

**Response:** `{ "version": "1.18.8", "agentVersion": "1.18.8", "releaseRepo": "catalystctl/catalyst" }`

`agentVersion` is the semver the install script should download. `null` if `package.json` is unreadable.

#### GET `/api/agent/download`

**Query params:**
- `arch` — `x86_64` (default) or `aarch64`/`arm64`
- `version` — optional semver (e.g. `1.18.8`). Invalid values return 400. When omitted, the panel's own version is used — **not** GitHub `/latest`.

Returns a **static musl** Linux binary (`catalyst-agent-{arch}-linux-musl`) for that version. Both architectures are published by the release workflow.

#### GET `/api/deploy/:token`

Get the canonical deployment script for a deployment token.

**Query params:**
- `apiKey` — required, the node's API key

---

### Setup Wizard

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/setup/complete` | No | Complete first-time setup |
| `GET` | `/api/setup/status` | No | Check setup status |
| `GET` | `/api/setup/status` | No | Check setup status |

#### POST `/api/setup/complete`

Complete the initial setup wizard. Creates the admin user, configures theme settings, and marks the panel as ready.

**Auth:** No (public, idempotent if partially completed)  
**Body:**
```json
{
  "email": "admin@example.com",
  "username": "admin",
  "password": "securePassword123",
  "panelName": "Catalyst",
  "primaryColor": "#0d9488",
  "secondaryColor": "#8b5cf6",
  "accentColor": "#06b6d4",
  "defaultTheme": "dark",
  "logoUrl": "https://example.com/logo.png",
  "metadata": {}
}
```

- `email` — valid email, required
- `username` — 2–32 characters, required
- `password` — minimum 8 characters, required
- `panelName` — display name for the panel (default: `"Catalyst"`)
- `primaryColor` — 6-digit hex color (default: `"#0d9488"`)
- `secondaryColor` — 6-digit hex color (default: `"#8b5cf6"`)
- `accentColor` — 6-digit hex color (default: `"#06b6d4"`)
- `defaultTheme` — `"light"` or `"dark"` (default: `"dark"`)
- `logoUrl` — optional logo URL
- `metadata` — optional arbitrary JSON object (default: `{}`)

**Response (200):**
```json
{
  "success": true,
  "data": {
    "setupComplete": true,
    "userId": "user_xxx",
    "themeSettings": {
      "panelName": "Catalyst Panel",
      "primaryColor": "#3b82f6",
      "accentColor": "#8b5cf6",
      "defaultTheme": "dark",
      "logoUrl": "https://example.com/logo.png"
    }
  }
}
```

#### GET `/api/setup/status`

Check whether first-time setup is required. Returns `false` if a user already exists (setup is complete).

**Auth:** No (public)  
**Response (200):**
```json
{
  "success": true,
  "data": {
    "setupRequired": false,
    "reason": "User already exists"
  }
}
```

**Response (when setup IS required):**
```json
{
  "success": true,
  "data": {
    "setupRequired": true,
    "reason": "No users exist in the system"
  }
}
```

---

### Public Endpoints

| Method | Endpoint | Auth | Rate Limit |
|--------|----------|------|------------|
| `GET` | `/health` | No | 1/minute (exempt) |
| `GET` | `/api/update/status` | No | 600/minute |
| `GET` | `/api/theme-settings/public` | No | 600/minute |
| `POST` | `/api/system-errors/report` | No | 30/minute |
| `GET` | `/docs` | No | N/A (Swagger UI) |

---

## WebSocket Gateway

**Endpoint:** `wss://your-domain.com/ws`

The WebSocket gateway is the bidirectional communication channel between the backend and agent nodes.

### Connection Flow

1. Client upgrades to WebSocket with `Cookie: better-auth.session_token=...`
2. After connection, client sends a handshake message to authenticate:

```json
{
  "type": "auth",
  "token": "session-token",
  "serverId": "srv_xxx"
}
```

3. Backend responds with `auth_success` or `auth_error`

### Server Subscriptions

Clients subscribe to server events:

```json
{
  "type": "subscribe",
  "serverId": "srv_xxx"
}
```

### Authentication

- **Agent connections** use `X-Node-Id` + `X-Node-Api-Key` headers in the HTTP upgrade request
- **User connections** use session cookies (`better-auth.session_token`)
- After connection, users send an `auth` message with their session token
- Agent connections are authenticated at the TCP level during the WebSocket handshake

### Agent → Backend Messages

| Type | Direction | Description |
|------|-----------|-------------|
| `heartbeat` | Agent → Backend | Node health report with CPU/memory/disk/network |
| `server_state_update` | Agent → Backend | Server status changes (start/stop/crash) |
| `console_output` | Agent → Backend | Console log lines |
| `resource_stats` | Agent → Backend | CPU/memory/disk for a server |
| `resource_stats_batch` | Agent → Backend | Batched metrics for backfill (max 500 items) |
| `server_state_sync` | Agent → Backend | Container state reconciliation |
| `server_state_sync_complete` | Agent → Backend | Reconciliation completion with missing container detection |
| `discovered_servers` | Agent → Backend | Auto-import container discovery |
| `backup_stream_complete` | Agent → Backend | Backup stream finished |
| `download_backup` | Agent → Backend | Binary backup download frames |
| `file_operation_response` | Agent → Backend | Response to a legacy WS `file_operation` (not used by the HTTP file tunnel) |

### Backend → Agent Messages

| Type | Direction | Description |
|------|-----------|-------------|
| `start_server` | Backend → Agent | Start with template, environment, resources |
| `stop_server` | Backend → Agent | Stop server |
| `kill_server` | Backend → Agent | Force kill |
| `restart_server` | Backend → Agent | Stop then start |
| `install_server` | Backend → Agent | Fresh install |
| `reinstall_server` | Backend → Agent | Wipe + install |
| `rebuild_server` | Backend → Agent | Rebuild container |
| `create_backup` | Backend → Agent | Start backup |
| `restore_backup` | Backend → Agent | Restore from backup |
| `delete_server` | Backend → Agent | Remove server container |
| `file_tunnel_request` | Backend → Agent | *(Not sent over WS — file ops use HTTP long-poll)* |
| `request_immediate_stats` | Backend → Agent | Request live metrics |
| `resume_console` | Backend → Agent | Resume console stream after reconnect |

### Server Messages (Agent → Backend)

| Type | Description |
|------|-------------|
| `console_output` | Server console output |
| `power_action` | Server power state change |
| `install_start` | Installation started |
| `install_complete` | Installation finished |
| `metrics_update` | Server resource metrics |
| `resource_stats_batch` | Batched metrics for backfill (max 500) |
| `server_state_sync` | Container state reconciliation |
| `server_state_sync_complete` | Reconciliation completion with missing container detection |
| `discovered_servers` | Auto-import container discovery |
| `file_operation` | Legacy WS file-op result (HTTP file tunnel is the production path) |
| `backup_status` | Backup progress/status |
| `health_check` | Agent health report |

### Server Messages (Backend → Agent)

| Type | Description |
|------|-------------|
| `start_server` | Start the server container |
| `stop_server` | Stop the server container |
| `restart_server` | Restart the server |
| `kill_server` | Force kill the server |
| `console_input` | Send command to server |
| `install_server` | First-time install |
| `reinstall_server` | Wipe and reinstall |
| `rebuild_server` | Rebuild container |
| `create_backup` | Create a backup |
| `restore_backup` | Restore from backup |
| `delete_server` | Remove the server |
| `resume_console` | Resume console stream after reconnect |
| `resize_storage` | Resize disk |

---

## SSE Streams

### Console Stream (`/api/servers/:serverId/console/stream`)

Real-time server console output via Server-Sent Events.

```http
Accept: text/event-stream
Authorization: Bearer ...
```

**Event types:**
- `console` — console output lines
- `connected` — connection established
- `error` — connection error

### Per-Server Event Stream (`/api/servers/:serverId/events`)

Per-server real-time event stream for a specific server's events.

```http
Accept: text/event-stream
Authorization: Bearer ...
```

**Event types:**
- `server_state_update` — server power state changed
- `server_state` — server state (alias for state_update)
- `backup_complete` — backup finished successfully
- `backup_restore_complete` — backup restore finished
- `backup_delete_complete` — backup deletion finished
- `eula_required` — server requires EULA acceptance
- `alert` — alert triggered for this server
- `server_log` — server log line
- `task_progress` — scheduled task progress update
- `task_complete` — scheduled task completed
- `resource_stats` — server resource metrics
- `storage_resize_complete` — disk resize finished
- `server_deleted` — server was deleted
- `server_created` — server was created
- `server_updated` — server config changed
- `server_suspended` — server suspended
- `server_unsuspended` — server unsuspended
- `user_created` — new user (system event)
- `user_deleted` — user deleted (system event)
- `user_updated` — user updated (system event)
- `mod_install_complete` — mod installation finished
- `mod_uninstall_complete` — mod uninstallation finished
- `mod_update_complete` — mod update finished
- `plugin_install_complete` — plugin installation finished
- `plugin_uninstall_complete` — plugin uninstallation finished
- `plugin_update_complete` — plugin update finished

### Global Event Stream (`/api/servers/all-servers/events`)

Global event stream for all servers the authenticated user has access to. Used by the AppLayout to broadcast events across all server tabs without subscribing to each individually.

```http
Accept: text/event-stream
Authorization: Bearer ...
```

Same event types as per-server stream, but events from all accessible servers.

### Metrics Stream (`/api/servers/:serverId/metrics/stream`)

Real-time server resource metrics via SSE. The agent pushes metrics every 15 seconds.

```http
Accept: text/event-stream
Authorization: Bearer ...
```

**Event types:**
- `resource_stats` — server resource metrics
- `storage_resize_complete` — disk resize finished (data includes new size)

**Event data (`resource_stats`):**
```json
{
  "cpuPercent": 45,
  "memoryUsageMb": 12000,
  "memoryTotalMb": 16384,
  "diskUsageMb": 50000,
  "diskTotalMb": 200000,
  "networkRxBytes": 1000000,
  "networkTxBytes": 500000
}
```

### Admin Event Stream (`/api/admin/events`)

Admin-wide real-time event stream (broadcast to all admin subscribers).

**Auth:** `admin.read` (session or agent)  
**Format:** SSE with `event: {type}` and `data: {json}`

**Full list of admin event types (40+):**

**User events:**
- `user_created` — new user created
- `user_deleted` — user deleted
- `user_updated` — user profile/roles changed

**Server events:**
- `server_created` — new server created
- `server_deleted` — server deleted
- `server_updated` — server config changed
- `server_suspended` — server suspended
- `server_unsuspended` — server unsuspended

**Node events:**
- `node_created` — new node added
- `node_deleted` — node removed
- `node_updated` — node config changed

**Template events:**
- `template_created` — new template
- `template_deleted` — template deleted
- `template_updated` — template config changed

**Alert events:**
- `alert_created` — new alert
- `alert_resolved` — alert resolved
- `alert_deleted` — alert deleted
- `alert_rule_created` — new alert rule
- `alert_rule_deleted` — alert rule deleted
- `alert_rule_updated` — alert rule changed

**Role events:**
- `role_created` — new role
- `role_deleted` — role deleted
- `role_updated` — role changed

**API key events:**
- `api_key_created` — new API key
- `api_key_updated` — API key changed
- `api_key_deleted` — API key deleted

**Location events:**
- `location_created` — new location
- `location_updated` — location changed
- `location_deleted` — location deleted

**Nest events:**
- `nest_created` — new nest
- `nest_updated` — nest changed
- `nest_deleted` — nest deleted

**Database events:**
- `database_host_created` — new database host
- `database_host_updated` — database host changed
- `database_host_deleted` — database host deleted
- `database_created` — server database created
- `database_deleted` — server database deleted
- `database_password_rotated` — server database password rotated

**IP Pool events:**
- `ip_pool_created` — new IP pool
- `ip_pool_updated` — IP pool changed
- `ip_pool_deleted` — IP pool deleted

**Security settings events:**
- `security_settings_updated` — security settings changed
- `smtp_settings_updated` — SMTP settings changed
- `theme_settings_updated` — theme settings changed
- `system_settings_updated` — system settings changed
- `oidc_settings_updated` — OIDC settings changed
- `auth_lockout_created` — auth lockout triggered
- `auth_lockout_cleared` — auth lockout cleared

**Audit events:**
- `audit_log_created` — audit log entry created

**Other events:**
- `system_error` — system error reported
- `plugin_updated` — plugin config changed
- `task_created` — new scheduled task
- `task_updated` — task changed
- `task_deleted` — task deleted
- `node_assigned` — node assigned to user/role
- `node_unassigned` — node unassigned
- `wildcard_assigned` — wildcard allocation assigned
- `wildcard_removed` — wildcard allocation removed
- `mod_install_complete` — mod installation finished
- `mod_uninstall_complete` — mod uninstallation finished
- `mod_update_complete` — mod update finished
- `plugin_install_complete` — plugin installation finished
- `plugin_uninstall_complete` — plugin uninstallation finished
- `plugin_update_complete` — plugin update finished

---

## Rate Limiting

Global rate limiting is enforced via `@fastify/rate-limit`:

| Setting | Default | Description |
|---------|---------|-------------|
| `max` | 600 requests | Per-IP/User limit |
| `timeWindow` | 1 minute | Window duration |

### Exceptions

- **Agent endpoints** — bypass rate limiting when valid `X-Catalyst-Node-Token` is provided
- **Internal endpoints** — `/api/internal/*` bypass rate limiting
- **Health check** — exempt (`/health`)
- **Auth endpoints** — configurable via security settings (usually stricter)
- **SSE streams** — exempt (long-lived connections)
- **WebSocket** — authenticated via handshake, not rate-limited

### API Key Rate Limiting

Each API key has its own rate limit:
- `rateLimitMax` — max requests per window
- `rateLimitTimeWindow` — window duration in milliseconds
- Default: 100 requests per 60 seconds

---

## Pagination

List endpoints support standard pagination:

```
GET /api/servers?page=1&limit=20
```

**Response:**
```json
{
  "servers": [ ... ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "totalPages": 8
  }
}
```

---

## Error Responses

| Status | Description |
|--------|-------------|
| `400` | Bad request (validation error) |
| `401` | Unauthorized (missing/invalid auth) |
| `403` | Forbidden (insufficient permissions) |
| `404` | Not found |
| `409` | Conflict (duplicate, state mismatch) |
| `410` | Gone (expired resource) |
| `413` | Payload too large |
| `422` | Unprocessable entity |
| `423` | Locked (server suspended) |
| `429` | Too many requests (rate limited) |
| `500` | Internal server error |
| `503` | Service unavailable |

### Validation Errors

```json
{
  "error": "Validation failed",
  "details": [
    { "field": "email", "message": "Invalid email format" },
    { "field": "password", "message": "Password must be at least 8 characters" }
  ]
}
```

### Server State Errors

```json
{
  "error": "Cannot start server in running state. Server must be stopped.",
  "currentStatus": "running",
  "allowedStates": ["stopped", "crashed"]
}
```

### Resource Limit Errors

```json
{
  "error": "Insufficient memory. Available: 2048MB, Required: 4096MB",
  "available": {
    "memoryMb": 2048,
    "cpuCores": 2
  },
  "required": {
    "memoryMb": 4096,
    "cpuCores": 4
  }
}
```

---

## Permission Reference

### Server Permissions

| Permission | Description |
|-----------|-------------|
| `server.read` | View server details |
| `server.start` | Start server |
| `server.stop` | Stop server |
| `server.update` | Update server configuration |
| `server.delete` | Delete server |
| `server.install` | Install/reinstall server |
| `server.rebuild` | Rebuild server |
| `server.suspend` | Suspend/unsuspend server |
| `server.transfer` | Transfer server (between nodes) |
| `server.schedule` | Create/manage scheduled tasks |

### Console Permissions

| Permission | Description |
|-----------|-------------|
| `console.read` | Read console output |
| `console.write` | Send commands to console |

### File Permissions

| Permission | Description |
|-----------|-------------|
| `file.read` | List and download files |
| `file.write` | Upload, edit, delete files |

### Backup Permissions

| Permission | Description |
|-----------|-------------|
| `backup.read` | View backup history |
| `backup.create` | Create backups |
| `backup.restore` | Restore from backups |
| `backup.delete` | Delete backups |

### Database Permissions

| Permission | Description |
|-----------|-------------|
| `database.read` | View databases |
| `database.create` | Create databases |
| `database.rotate` | Rotate passwords |
| `database.delete` | Delete databases |

### Alert Permissions

| Permission | Description |
|-----------|-------------|
| `alert.read` | View alerts |
| `alert.create` | Create alert rules |
| `alert.update` | Update alert rules |
| `alert.delete` | Delete alert rules |

### Node Permissions

| Permission | Description |
|-----------|-------------|
| `node.read` | View nodes |
| `node.create` | Create nodes |
| `node.update` | Update node config |
| `node.delete` | Delete nodes |
| `node.assign` | Assign nodes to users/roles |
| `node.manage_allocation` | Manage port allocations |
| `node.view_stats` | View node resource stats |

### User Permissions

| Permission | Description |
|-----------|-------------|
| `user.read` | View users |
| `user.create` | Create users |
| `user.update` | Update users |
| `user.delete` | Delete users |
| `user.set_roles` | Assign/remove roles |

### Template Permissions

| Permission | Description |
|-----------|-------------|
| `template.read` | View templates/nests |
| `template.create` | Create templates |
| `template.update` | Update templates |
| `template.delete` | Delete templates |

### Admin Permissions

| Permission | Description |
|-----------|-------------|
| `admin.read` | View admin panel, audit logs |
| `admin.write` | Full admin access, start migrations |

### Other Permissions

| Permission | Description |
|-----------|-------------|
| `apikey.manage` | Manage API keys |
| `view_stats` | View system statistics |

---

## Cross-References

- For environment variables that control rate limits, see [environment-variables.md](./environment-variables.md)
- For integration examples, see [automation.md](./automation.md)
- For agent authentication details, see [agent.md](./agent.md)
- For admin-only endpoints, see [admin-guide.md](./admin-guide.md)
- For WebSocket message formats, see the [Plugin System Guide](./plugins.md)
- For Docker deployment, see [docker-setup.md](./docker-setup.md)

---

## API Key Format

API keys follow the format: `catalyst_<base64-encoded-uuid>`

Example: `catalyst_A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6`

Keys can be scoped:
- **Full access** (`allPermissions: true`) — uses the full set of the owning user’s **current** permissions (shrinks if the user loses perms; not an independent `*` grant)
- **Scoped** (`permissions: [...]`) — limited to specific permissions

---

*This documentation covers the complete API surface. All 150+ endpoints across 23 route files are documented. For the most current API surface, check the Swagger UI at `/docs` when the panel is running.*
