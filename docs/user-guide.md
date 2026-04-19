# User Guide

This guide covers all features available to Catalyst users — from the dashboard and server management to the file manager, SFTP access, backups, scheduling, alerts, and profile settings.

---

## Table of Contents

1. [Dashboard](#dashboard)
2. [Server Listing](#server-listing)
3. [Creating a Server](#creating-a-server)
4. [Server Details Page](#server-details-page)
5. [Server Console](#server-console)
6. [File Manager](#file-manager)
7. [SFTP Access](#sftp-access)
8. [Backup Management](#backup-management)
9. [Server Settings](#server-settings)
10. [Server Scheduling (Tasks)](#server-scheduling-tasks)
11. [Alerts](#alerts)
12. [Mod Manager](#mod-manager)
13. [Plugin Manager](#plugin-manager)
14. [Server Databases](#server-databases)
15. [Server Metrics](#server-metrics)
16. [Server Users & Invites](#server-users--invites)
17. [API Keys](#api-keys)
18. [Profile Settings](#profile-settings)
19. [Two-Factor Authentication (2FA)](#two-factor-authentication-2fa)
20. [Passkeys / WebAuthn](#passkeys--webauthn)
21. [Session Management](#session-management)

---

## Dashboard

The dashboard is the first page you see after logging in. It provides an overview of your servers and resources.

### Overview

The dashboard displays:

- **Greeting** — time-based greeting with your username
- **Stats cards** — servers online, nodes online, and unacknowledged alerts
- **Resource metrics** — CPU utilization, memory usage, and network throughput across your servers
- **Quick actions** — shortcuts to create a server, view servers, or manage your profile
- **Recent activity** — latest server events and actions

### Navigation

Use the sidebar to navigate between sections:

- **Servers** — Your server list
- **Profile** — Account settings, 2FA, passkeys, API keys
- **Admin** *(if permitted)* — Administrative tools

---

## Server Listing

Navigate to **Servers** to see all servers you have access to.

### Viewing Your Servers

The server list supports:

- **Search** — filter by server name or node name
- **Status filter** — Running, Stopped, Transitioning, Issues (crashed/suspended)
- **Access filter** — All, Owned (servers you created), Other (shared with you)
- **View modes** — Grid or list layout

Each server card shows:

- Server name and status badge
- Node name and location
- Resource usage (CPU, memory, disk)
- Quick actions (Start, Stop, Restart)

### Server Statuses

| Status | Description |
|--------|-------------|
| `running` | Server is active |
| `stopped` | Server is not running |
| `starting` | Server is in the process of starting |
| `stopping` | Server is shutting down |
| `installing` | Server is being installed |
| `crashed` | Server process exited unexpectedly |
| `suspended` | Server has been suspended by an admin |
| `transferring` | Server is being moved between nodes |

---

## Creating a Server

### Prerequisites

- You need the `server.create` permission
- At least one node must be online and have available resources
- At least one server template must be configured

### Steps

1. Navigate to **Servers** and click **Create Server**.
2. Fill in the configuration:
   - **Name** — a descriptive name for your server
   - **Description** — optional description
   - **Node** — select a target node from the dropdown (only shows nodes you have access to)
   - **Template** — select a game server template
3. Configure resources:
   - **Memory (MB)** — RAM allocation (minimum from template default)
   - **CPU Cores** — number of CPU cores to allocate
4. Set environment variables — template-specific settings (ports, game modes, etc.)
5. Configure networking:
   - **Primary Port** — the main game port
   - **Port Bindings** — additional port mappings (container port → host port)
   - **Network Mode** — bridge (default), host, or macvlan
6. Click **Create**.

### What Happens Next

1. The server is created in the database with `installing` status.
2. If the template has an install script, it runs in the specified install image container.
3. Once installation completes, the server transitions to `stopped`.
4. You can then start the server from the console or server details page.

---

## Server Details Page

Click on any server to open its details page. This is the central hub for managing a single server.

### Tabs

The server details page organizes features into tabs:

| Tab | Description |
|-----|-------------|
| **Console** | Real-time server console output and command input |
| **Files** | Browse, upload, download, edit, and manage files |
| **SFTP** | Generate SFTP connection tokens |
| **Backups** | Create, download, restore, and delete backups |
| **Tasks** | Create and manage scheduled tasks (cron jobs) |
| **Databases** | Create and manage server databases |
| **Metrics** | View historical CPU, memory, and disk usage charts |
| **Alerts** | Configure alert rules for this server |
| **Mod Manager** | Browse and install mods (CurseForge, Modrinth) |
| **Plugin Manager** | Browse and install plugins |
| **Configuration** | Edit server configuration files |
| **Users** | Manage sub-users and invites |
| **Settings** | Server settings (name, resources, ports, startup) |
| **Admin** *(owner only)* | Advanced admin settings (backup storage, network, reinstall) |

### Server Controls

At the top of the details page, you'll find quick-action buttons:

- **Start** — start the server
- **Stop** — gracefully stop the server
- **Restart** — stop and start the server
- **Kill** — force-kill the server process

### Server Overview

The overview section displays:

- Server name, status, and uptime
- Node and template information
- Resource allocation vs. actual usage (CPU, memory, disk)
- Primary IP and port
- Owner information

---

## Server Console

The console provides real-time interaction with your server.

### Accessing the Console

Navigate to your server → **Console** tab, or use the dedicated console page at `/servers/:serverId/console`.

### Features

- **Real-time output** — server stdout, stderr, system messages, and your input are streamed via Server-Sent Events (SSE)
- **Command input** — type commands and press Enter to send them to the server
- **Command history** — press ↑/↓ arrow keys to cycle through previous commands
- **Stream filters** — toggle visibility of stdout (green), stderr (red), system (blue), and stdin (yellow) streams
- **Search** — search within console output
- **Copy** — copy all visible console output to clipboard
- **Auto-scroll** — automatically scrolls to the latest output (can be toggled off)
- **Clear** — clear the console buffer

### Sending Commands

Commands can only be sent when:

1. The server is **running**
2. You are not **suspended**
3. The SSE connection is **active** (or reconnecting)

Type a command in the input field and press **Enter**. The command is sent via HTTP POST to the server's agent.

### EULA Prompts

Some game servers (like Minecraft) require EULA acceptance. When the server prompts for EULA acceptance, Catalyst displays a modal dialog where you can accept or decline.

### Console API

```bash
# Stream console output (SSE)
curl -N -H "Cookie: <session>" \
  https://your-catalyst.example.com/api/servers/:serverId/console/stream

# Send a command
curl -X POST -H "Cookie: <session>" \
  -H "Content-Type: application/json" \
  -d '{"command": "list"}' \
  https://your-catalyst.example.com/api/servers/:serverId/console/command
```

---

## File Manager

The file manager allows you to browse and manage your server's files directly from the web interface.

### Accessing the File Manager

Navigate to your server → **Files** tab.

### Features

| Feature | Description |
|---------|-------------|
| **Browse** | Navigate directories and view files |
| **Upload** | Upload files from your computer |
| **Download** | Download files to your computer |
| **Edit** | Edit text-based files in the built-in editor |
| **Create** | Create new files and directories |
| **Rename** | Rename files and directories |
| **Delete** | Delete files and directories |
| **Compress** | Create `.tar.gz` archives from selected files |
| **Decompress** | Extract `.tar.gz` archives |
| **Permissions** | View file permissions |
| **Search** | Search for files by name |

### File Operations

**Upload files:**
1. Navigate to the target directory.
2. Click **Upload**.
3. Select files from your computer.
4. Files are transferred via the file tunnel system to the node agent.

**Edit a file:**
1. Click on a file to open it in the editor.
2. Make your changes.
3. Click **Save**.

**Compress files:**
1. Select one or more files/directories.
2. Click **Compress**.
3. Enter an archive name.
4. The archive is created as a `.tar.gz` file.

**Decompress an archive:**
1. Select a `.tar.gz` archive.
2. Click **Decompress**.
3. The contents are extracted in place.

### Path Security

- File operations are restricted to the server's data directory.
- Paths are normalized and validated to prevent directory traversal.
- Maximum directory depth is enforced.
- The root path `/` maps to the server's data directory.

### File Tunnel

File operations use a secure tunnel system where the panel communicates with node agents to perform file I/O. Operations are rate-limited and size-restricted for security.

### Server Logs

Access raw server logs from the **Logs** tab or via the API:

```bash
GET /api/servers/:serverId/logs
```

---

## SFTP Access

SFTP (SSH File Transfer Protocol) allows you to access your server files using any SFTP client (FileZilla, WinSCP, Cyberduck, etc.).

### How SFTP Works in Catalyst

Catalyst runs a dedicated SFTP server (default port: 2022). Instead of using your account password, you generate short-lived SFTP tokens from the panel.

### Connecting via SFTP

1. Navigate to your server → **SFTP** tab.
2. Click **Generate Token**.
3. Select a **TTL (time-to-live)** for the token:

   | Option | Duration |
   |--------|----------|
   | 5 minutes | 5 min |
   | 15 minutes | 15 min |
   | 30 minutes | 30 min |
   | 1 hour | 1 hour |
   | 6 hours | 6 hours |
   | 24 hours | 24 hours |
   | 7 days | 7 days |
   | 30 days | 30 days |
   | 90 days | 90 days |
   | 1 year | 1 year |

4. Copy the generated token (starts with `sftp_`).
5. Configure your SFTP client:

   | Field | Value |
   |-------|-------|
   | **Host** | Your Catalyst panel hostname or IP |
   | **Port** | `2022` (or custom `SFTP_PORT`) |
   | **Username** | Your server ID |
   | **Password** | The generated SFTP token |

6. Connect to access your server's file directory.

### SFTP Security

- Tokens are single-purpose and scoped to a specific user + server pair.
- Tokens automatically expire after the selected TTL.
- Tokens are validated against an in-memory cache with SHA-256 indexing for O(1) lookups.
- Tokens are automatically revoked when you lose access to a server.
- Maximum file size for SFTP uploads is configurable (default: 100 MB).
- File operations are restricted to the server's data directory.

### SFTP Client Examples

**FileZilla:**
1. File → Site Manager → New Site
2. Protocol: SFTP
3. Host: `your-catalyst.example.com`, Port: `2022`
4. Logon Type: Normal
5. User: `<server-id>`, Password: `<sftp_token>`

**Command line (sftp):**
```bash
sftp -P 2022 -oPasswordPrompt=no \
  "sftp_token@your-catalyst.example.com"
```

**curl:**
```bash
curl -sftp -u "<server-id>:<sftp_token>" \
  --url "sftp://your-catalyst.example.com:2022/"
```

---

## Backup Management

### Creating a Backup

1. Navigate to your server → **Backups** tab.
2. Click **Create Backup**.
3. Optionally enter a custom backup name.
4. The backup is created as a `.tar.gz` archive of your server's files.

**Requirements:**
- The server's node must be online.
- Backup allocation must be configured, or external storage (S3/SFTP) must be set up.
- The server cannot be suspended.

### Restoring a Backup

1. **Stop** the server first (backups can only be restored to stopped servers).
2. Navigate to **Backups** tab.
3. Find the backup you want to restore.
4. Click **Restore**.
5. Confirm the restoration.

**Warning:** Restoration replaces all server files with the backup contents.

### Downloading a Backup

Click **Download** on any backup to save the `.tar.gz` file to your computer. Downloads work for local, S3, and SFTP storage modes.

### Deleting a Backup

Click **Delete** to remove a backup. This permanently deletes the backup from all storage backends.

### Backup Storage

Your admin configures where backups are stored:

| Mode | Description |
|------|-------------|
| **Local** | Stored on the panel server's filesystem |
| **S3** | Stored in S3-compatible cloud storage |
| **SFTP** | Stored on a remote SFTP server |

### Backup Retention

Admins can configure retention policies per server:
- **Count** — maximum number of backups to keep
- **Days** — maximum age of backups to keep

---

## Server Settings

The **Settings** tab allows you to configure various aspects of your server.

### Server Information

- **Name** — rename your server
- **Description** — update the description

### Resources

- **Memory (MB)** — adjust RAM allocation
- **CPU Cores** — adjust CPU core allocation

### Startup

- **Startup Command** — the command used to start the server (supports `{{VARIABLE}}` interpolation)
- **Stop Command** — command sent for graceful shutdown
- **Signal** — signal sent if stop command fails (`SIGTERM`, `SIGINT`, `SIGKILL`)

### Environment Variables

View and edit server environment variables. Template variables are shown with their descriptions and validation rules.

### Port Bindings

- **Primary Port** — the main game port
- **Additional Bindings** — map container ports to host ports
- **Allocations** — view and select from node-level port allocations

### Advanced Settings

| Setting | Description |
|---------|-------------|
| **Reinstall** | Re-run the template's install script (requires server to be stopped) |
| **Rebuild** | Rebuild the container without reinstalling |
| **Delete** | Permanently delete the server (requires `server.delete` permission, server must be stopped) |

### Transfer Server

Server owners can transfer ownership to another user:

1. Navigate to **Settings** → **Transfer Ownership**.
2. Enter the target user's email or username.
3. Confirm the transfer.

The target user must have an existing account on the panel. Requires `server.transfer` permission.

### Restart Policy

Configure how the server handles unexpected crashes:

- **Restart on exit** — automatically restart when the process exits
- **Crash counter** — tracks consecutive crashes to prevent restart loops
- **Reset crash count** — manually reset the crash counter

### Backup Settings (Admin/Owner)

Configure per-server backup storage:

- **Storage Mode** — local, S3, or SFTP
- **S3 Configuration** — bucket, region, access key, secret key, endpoint
- **SFTP Configuration** — host, port, username, password/private key, base path
- **Backup Allocation** — disk space reserved for local backups (MB)
- **Retention** — max backup count and max age (days)

---

## Server Scheduling (Tasks)

Create automated tasks (cron jobs) that run on a schedule for your server.

### Creating a Task

1. Navigate to your server → **Tasks** tab.
2. Click **Create Task**.
3. Configure:
   - **Name** — descriptive name for the task
   - **Action** — what the task does:
     - `start` — Start the server
     - `stop` — Stop the server
     - `restart` — Restart the server
     - `backup` — Create a backup
     - `command` — Send a command to the console
   - **Payload** — for `command` actions, the command string to send
   - **Schedule** — cron expression defining when the task runs
4. Click **Create**.

### Cron Expression Examples

| Expression | Schedule |
|-----------|----------|
| `0 3 * * *` | Every day at 3:00 AM |
| `*/30 * * * *` | Every 30 minutes |
| `0 */6 * * *` | Every 6 hours |
| `0 0 * * 0` | Every Sunday at midnight |
| `0 0 1 * *` | First of every month at midnight |

### Task Management

- **Execute now** — run the task immediately (useful for testing)
- **Enable/Disable** — toggle the task on or off
- **Edit** — modify name, action, payload, or schedule
- **Delete** — remove the task permanently

### Task Execution History

Each task tracks:

- **Last run** — when it was last executed
- **Run count** — total number of executions
- **Last status** — `success` or `failed`
- **Last error** — error message if the last execution failed
- **Next run** — calculated next execution time

---

## Alerts

Configure alert rules to monitor your server's health and receive notifications.

### Creating an Alert Rule

1. Navigate to your server → **Alerts** tab.
2. Click **Create Alert Rule**.
3. Configure:
   - **Name** — descriptive name
   - **Type** — alert trigger type:
     - `resource_threshold` — triggered when resource usage exceeds a threshold
     - `node_offline` — triggered when the node goes offline
     - `server_crashed` — triggered when the server crashes
   - **Conditions** — threshold values and comparison operators
   - **Actions** — what happens when the alert fires (webhook, notification)
   - **Enabled** — toggle the rule on or off

### Viewing Alerts

The alerts page shows all alerts for your server with filtering by:

- **Severity** — info, warning, critical
- **Resolved status** — unresolved or resolved
- **Type** — alert type

### Resolving Alerts

Click **Resolve** on an alert to mark it as handled. You can also bulk-resolve multiple alerts at once.

### Alert Statistics

View summary statistics:

- Total alerts count
- Unresolved alerts count
- Breakdown by severity and type

---

## Mod Manager

If the server template supports mod management, a **Mod Manager** tab is available.

### Browsing Mods

1. Navigate to your server → **Mod Manager** tab.
2. Browse available mods from supported providers:
   - **CurseForge** — requires admin-configured API key
   - **Modrinth** — requires admin-configured API key
3. Search by name, filter by category, game version, or loader.

### Installing Mods

1. Find the mod you want to install.
2. Select the desired version.
3. Click **Install**.
4. The mod file is downloaded to the configured path (e.g., `/mods`).

### Managing Installed Mods

- **View** — see all installed mods with version info
- **Uninstall** — remove a mod from the server
- **Check for updates** — scan installed mods for available updates
- **Update** — update a mod to the latest version

### Game Version Resolution

The mod manager can resolve game versions from Modrinth to ensure compatibility. Select your game version to filter compatible mods.

---

## Plugin Manager

Similar to the Mod Manager but for server plugins (e.g., Spigot/Bukkit plugins for Minecraft).

### Browsing Plugins

1. Navigate to your server → **Plugin Manager** tab.
2. Browse plugins from supported providers.
3. Search and filter by name, category, and version.

### Installing Plugins

1. Find the plugin you want.
2. Select the desired version.
3. Click **Install**.
4. The plugin file is downloaded to the configured path (e.g., `/plugins`).

### Managing Installed Plugins

- View, uninstall, check updates, and update installed plugins.

---

## Server Databases

If your admin has configured database hosts, you can create and manage databases for your server.

### Creating a Database

1. Navigate to your server → **Databases** tab.
2. Click **Create Database**.
3. Select a database host from the available hosts.
4. Enter a database name.
5. Click **Create**.

The database is provisioned on the remote database server, and connection credentials are displayed.

### Database Credentials

After creation, you'll see:

- **Host** — the database host address
- **Port** — the database port
- **Database name** — your database name
- **Username** — auto-generated username
- **Password** — auto-generated password

### Managing Databases

| Action | Description |
|--------|-------------|
| **View** | See all databases with connection details |
| **Rotate Password** | Generate a new password for a database |
| **Delete** | Remove a database and its data |

---

## Server Metrics

View historical resource usage charts for your server.

### Available Metrics

- **CPU Usage** — percentage over time
- **Memory Usage** — MB used over time
- **Disk Usage** — MB used over time
- **Network I/O** — bytes transmitted and received

### Time Ranges

Select from predefined time ranges (e.g., 1 hour, 6 hours, 24 hours, 7 days) to adjust the chart window.

### Accessing Metrics

Navigate to your server → **Metrics** tab.

---

## Server Users & Invites

Share access to your server with other users.

### Server Invites

1. Navigate to your server → **Users** tab.
2. Click **Create Invite**.
3. Configure:
   - **Email** — the email address of the person to invite
   - **Permissions** — select which permissions to grant:

     | Preset | Permissions |
     |--------|-------------|
     | **Read Only** | `server.read`, `alert.read`, `console.read`, `file.read`, `database.read` |
     | **Power User** | Start/stop, console, files, databases, alerts |
     | **Full Access** | All power user permissions plus transfer, delete, reinstall |

     You can also select permissions individually.

4. Click **Create**. An invite link is generated.

### Invite Expiry

Invites expire after **7 days** by default.

### Accepting an Invite

When someone receives an invite:

1. Click the invite link.
2. If you already have an account, click **Accept**.
3. If you don't have an account, register with:
   - **Email** — pre-filled from the invite (cannot be changed)
   - **Username** — your desired username (min 3 characters)
   - **Password** — your password (min 8 characters)
4. After registration, you're automatically granted access to the server.

### Managing Access

- **View users** — see all users with access to the server
- **Revoke access** — remove a user's access to the server
- **View permissions** — see what permissions each user has

### Permission Presets for Sub-users

| Preset | Description |
|--------|-------------|
| **Read Only** | View server info, read console, view files |
| **Power User** | Start/stop, send commands, edit files, manage databases |
| **Full Access** | Everything except ownership transfer and deletion |

---

## API Keys

Create API keys to programmatically interact with the Catalyst API.

### Creating an API Key

1. Navigate to **Profile** → **API Keys**.
2. Click **Create API Key**.
3. Configure:
   - **Name** — descriptive name (1–100 characters)
   - **Permissions** — select specific permissions to scope the key
   - **Expiration** — optional TTL (1 hour to 1 year)
   - **Rate Limit** — max requests per time window
4. Click **Create**.
5. **Copy the key immediately** — it cannot be shown again.

### API Key Properties

| Property | Description |
|----------|-------------|
| `prefix` | Key prefix for identification |
| `start` | First characters for visual identification |
| `enabled` | Whether the key is active |
| `expiresAt` | Optional expiration timestamp |
| `lastRequest` | Most recent usage |
| `requestCount` | Total requests made |
| `remaining` | Remaining requests in current rate limit window |

### Using API Keys

```bash
# Authenticate with your API key
curl -H "Authorization: Bearer catalyst_your_key_here" \
  https://your-catalyst.example.com/api/servers
```

### Managing API Keys

- **List** — view all your API keys
- **Enable/Disable** — toggle a key on or off
- **Rename** — update the key's name
- **Delete** — permanently revoke a key
- **View usage** — see request counts and rate limit status

### Agent Keys

API keys with `metadata.purpose = "agent"` are automatically created for node agents. These are managed by admins and should not be manually modified.

---

## Profile Settings

Navigate to **Profile** to manage your account.

### Account Information

- **Username** — your display name
- **Email** — your email address (used for login and invites)

### Changing Your Password

1. Navigate to **Profile** → **Password** section.
2. Enter your current password.
3. Enter and confirm your new password (min 8 characters).
4. Click **Update Password**.

### SSO Accounts

View linked external authentication accounts (WHMCS, Paymenter, etc.) if configured by your admin.

### Active Sessions

View all active sessions with:

- **Browser and OS** — detected from user-agent
- **IP Address** — where the session was created
- **Last active** — when the session was last used
- **Created** — when the session was started

You can revoke any session by clicking **Revoke**.

### Audit Log

View your personal activity log showing actions like:

- Login/logout events
- Password changes
- API key creation/deletion
- Server creation/deletion/start/stop
- 2FA and passkey changes

### Danger Zone

- **Export My Data** — download all your data
- **Delete Account** — permanently delete your account (requires typing "DELETE" to confirm)

---

## Two-Factor Authentication (2FA)

Enable 2FA for additional account security.

### Enabling 2FA

1. Navigate to **Profile** → **2FA** section.
2. Click **Enable 2FA**.
3. Scan the QR code with an authenticator app (Google Authenticator, Authy, etc.).
4. Enter the 6-digit code from your authenticator app.
5. **Save your backup codes** — these one-time codes can be used if you lose access to your authenticator.

### Backup Codes

When you enable 2FA, you receive backup codes:

- Store them in a safe place
- Each code can be used only once
- Use them to log in if you lose your authenticator device
- You can generate new backup codes at any time

### Disabling 2FA

1. Enter a valid 2FA code from your authenticator.
2. Click **Disable 2FA**.

---

## Passkeys / WebAuthn

Passkeys provide passwordless authentication using biometrics (fingerprint, face recognition) or hardware security keys.

### Adding a Passkey

1. Navigate to **Profile** → **Passkeys** section.
2. Click **Add Passkey**.
3. Enter a name for the passkey (e.g., "MacBook Touch ID", "YubiKey").
4. Your browser will prompt for biometric authentication or security key insertion.
5. The passkey is registered and can be used for login.

### Using Passkeys

On the login page, click **Sign in with Passkey** instead of entering a password. Your browser will prompt for biometric authentication or security key.

### Managing Passkeys

- **View** — see all registered passkeys with their names and registration dates
- **Delete** — remove a passkey

---

## Session Management

View and manage your active sessions.

### Viewing Sessions

Navigate to **Profile** → **Sessions** section. Each session shows:

- **Device** — browser name and operating system
- **IP Address** — where the session was created
- **Last Active** — when the session was last used
- **Created** — when the session started

### Revoking Sessions

Click **Revoke** on any session to immediately log out that device. This is useful if you suspect unauthorized access or want to log out of a device you no longer have access to.

---

## Quick Reference: User API Endpoints

### Servers

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/servers` | List servers you have access to |
| POST | `/api/servers` | Create a new server |
| GET | `/api/servers/:serverId` | Get server details |
| PUT | `/api/servers/:serverId` | Update server settings |
| DELETE | `/api/servers/:serverId` | Delete a server |
| POST | `/api/servers/:serverId/start` | Start server |
| POST | `/api/servers/:serverId/stop` | Stop server |
| POST | `/api/servers/:serverId/kill` | Force-kill server |
| POST | `/api/servers/:serverId/restart` | Restart server |
| POST | `/api/servers/:serverId/install` | Run install script |
| POST | `/api/servers/:serverId/reinstall` | Reinstall server |
| POST | `/api/servers/:serverId/rebuild` | Rebuild container |

### Console

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/servers/:serverId/console/stream` | SSE console output stream |
| POST | `/api/servers/:serverId/console/command` | Send console command |

### Files

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/servers/:serverId/files` | List files in directory |
| POST | `/api/servers/:serverId/files/upload` | Upload files |
| GET | `/api/servers/:serverId/files/download` | Download file |
| POST | `/api/servers/:serverId/files/create` | Create file/directory |
| POST | `/api/servers/:serverId/files/write` | Write/edit file content |
| POST | `/api/servers/:serverId/files/rename` | Rename file/directory |
| DELETE | `/api/servers/:serverId/files/delete` | Delete file/directory |
| POST | `/api/servers/:serverId/files/compress` | Create archive |
| POST | `/api/servers/:serverId/files/decompress` | Extract archive |
| POST | `/api/servers/:serverId/files/permissions` | Change file permissions |
| GET | `/api/servers/:serverId/files/archive-contents` | List archive contents |

### Backups

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/servers/:serverId/backups` | Create backup |
| GET | `/api/servers/:serverId/backups` | List backups |
| GET | `/api/servers/:serverId/backups/:backupId` | Get backup details |
| POST | `/api/servers/:serverId/backups/:backupId/restore` | Restore backup |
| DELETE | `/api/servers/:serverId/backups/:backupId` | Delete backup |
| GET | `/api/servers/:serverId/backups/:backupId/download` | Download backup |

### Tasks

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/tasks/:serverId/tasks` | Create scheduled task |
| GET | `/api/tasks/:serverId/tasks` | List tasks |
| GET | `/api/tasks/:serverId/tasks/:taskId` | Get task details |
| PUT | `/api/tasks/:serverId/tasks/:taskId` | Update task |
| DELETE | `/api/tasks/:serverId/tasks/:taskId` | Delete task |
| POST | `/api/tasks/:serverId/tasks/:taskId/execute` | Execute task immediately |

### Alerts

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/alert-rules` | Create alert rule |
| GET | `/api/alert-rules` | List alert rules |
| PUT | `/api/alert-rules/:ruleId` | Update alert rule |
| DELETE | `/api/alert-rules/:ruleId` | Delete alert rule |
| GET | `/api/alerts` | List alerts |
| POST | `/api/alerts/:alertId/resolve` | Resolve alert |

### Databases

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/servers/:serverId/databases` | Create database |
| GET | `/api/servers/:serverId/databases` | List databases |
| POST | `/api/servers/:serverId/databases/:databaseId/rotate` | Rotate password |
| DELETE | `/api/servers/:serverId/databases/:databaseId` | Delete database |

### Invites & Access

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/servers/:serverId/invites` | Create invite |
| GET | `/api/servers/:serverId/invites` | List invites |
| DELETE | `/api/servers/:serverId/invites/:inviteId` | Revoke invite |
| GET | `/api/servers/:serverId/access` | List server users |
| DELETE | `/api/servers/:serverId/access/:userId` | Remove user access |
| POST | `/api/invites/accept` | Accept invite (authenticated) |
| POST | `/api/invites/register` | Register & accept invite (new user) |
| GET | `/api/invites/:token` | Preview invite details |

### Server Configuration

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/servers/:serverId/allocations` | Add port allocation |
| DELETE | `/api/servers/:serverId/allocations/:containerPort` | Remove allocation |
| POST | `/api/servers/:serverId/allocations/primary` | Set primary allocation |
| PATCH | `/api/servers/:serverId/restart-policy` | Update restart policy |
| POST | `/api/servers/:serverId/reset-crash-count` | Reset crash counter |
| PATCH | `/api/servers/:serverId/backup-settings` | Update backup config |
| POST | `/api/servers/:serverId/transfer-ownership` | Transfer server ownership |
| POST | `/api/servers/:serverId/transfer` | Transfer to another node |
| POST | `/api/servers/:serverId/suspend` | Suspend server |
| POST | `/api/servers/:serverId/unsuspend` | Unsuspend server |
