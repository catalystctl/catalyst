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
14. [Server Activity Log](#server-activity-log)
15. [Server Archiving](#server-archiving)
16. [Server Databases](#server-databases)
17. [Server Metrics](#server-metrics)
18. [Server Users & Invites](#server-users--invites)
19. [API Keys](#api-keys)
20. [Password Recovery](#password-recovery)
21. [Profile Settings](#profile-settings)
22. [Two-Factor Authentication (2FA)](#two-factor-authentication-2fa)
23. [Passkeys / WebAuthn](#passkeys--webauthn)
24. [Session Management](#session-management)
25. [Admin Audit Logs](#admin-audit-logs)
26. [Server Suspension](#server-suspension)
27. [Forgot Password & Reset Password Pages](#forgot-password--reset-password-pages)
28. [2FA Setup Page Details](#2fa-setup-page-details)
29. [System Settings](#system-settings)
30. [Security Settings](#security-settings)
31. [System Errors Dashboard](#system-errors-dashboard)
32. [Theme Settings](#theme-settings)
33. [Database Hosts](#database-hosts)
34. [System-wide Alerts](#system-wide-alerts)
35. [Migration Tool](#migration-tool)
36. [Node Details Page](#node-details-page)
37. [Template Details Page](#template-details-page)
38. [Cross-Tab Session Synchronization](#cross-tab-session-synchronization)
39. [Brute Force Protection & Lockout Viewer](#brute-force-protection--lockout-viewer)
40. [File Editing in File Manager](#file-editing-in-file-manager)

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
| `archived` | Server is archived (preserved, inactive) |

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
| **Mod Manager** | Browse and install mods (CurseForge, Modrinth, Paper) |
| **Plugin Manager** | Browse and install plugins (Modrinth, Spigot, Paper) |
| **Configuration** | Edit server configuration files |
| **Activity Log** | View recent actions performed on this server |
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
- **Stream filters** — toggle visibility of stdout (green), stderr (red), system (blue), and stdin (yellow) streams via filter buttons. This helps separate different log types when debugging.
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

### Console Optimization

The console uses Server-Sent Events (SSE) with advanced optimization:

- **32ms batched flush** — console output is accumulated and flushed in 32ms batches to reduce network overhead
- **Pre-allocated IDs** — each console entry has a pre-allocated ID for deduplication
- **Polling fallback** — if the SSE connection drops, the console automatically falls back to HTTP polling
- **Line/byte limits** — console output is rate-limited by the `consoleOutputLinesMax` and `consoleOutputByteLimitBytes` security settings to prevent resource exhaustion

> **Note:** The default console buffer is configurable via `CONSOLE_OUTPUT_BYTE_LIMIT_BYTES` (default: 256 KB). Admins can increase this in Admin → Security settings.

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
1. Click on a text-based file to open it in the built-in text editor.
2. The editor shows the **file path**, **filename**, and **line count** at the top.
3. Make your changes in the editor.
4. Changes are tracked with **dirty state** — a visual indicator shows unsaved changes.
5. Click **Save** to write changes to the server. Click **Cancel** to discard.
6. The editor supports standard text editing operations (copy, paste, find/replace in most browsers).

**Compress files:**
1. Select one or more files/directories.
2. Click **Compress**.
3. Enter an archive name.
4. The archive is created as a `.tar.gz` file.

**Browse archive contents:**
1. Select a `.tar.gz` archive file.
2. Click **Browse Contents** (or use the file manager to navigate into the archive).
3. The archive contents are displayed as a virtual directory — you can browse files without extracting.
4. Individual files can be previewed or downloaded directly from the archive.

> **Note:** Archive browsing is limited by the `maxBufferMb` security setting. Large archives may require increasing the buffer limit in admin settings.

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
```text

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

Click **Download** on any backup to save the `.tar.gz` file to your computer. Downloads work for local, S3, SFTP, and stream storage modes.

### Deleting a Backup

Click **Delete** to remove a backup. This permanently deletes the backup from all storage backends.

### Backup Storage

Your admin configures where backups are stored:

| Mode | Description |
|------|-------------|
| **Local** | Stored on the panel server's filesystem |
| **S3** | Stored in S3-compatible cloud storage |
| **SFTP** | Stored on a remote SFTP server |
| **Stream** | Transferred directly to target node during server transfer (zero-copy relay) |

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
| **Rebuild** | Rebuild the container without reinstalling (faster than reinstall, preserves data directory) |
| **Archive** | Archive the server (requires admin access; stops the server if running) |
| **Restore** | Restore a server from archive (requires admin access; server must be archived) |
| **Transfer** | Transfer server to another node (requires `server.transfer` permission, server must be stopped) |
| **Transfer Ownership** | Transfer server ownership to another user (server owner only) |
| **Delete** | Permanently delete the server (requires `server.delete` permission, server must be stopped) |
| **Suspend** | Suspend the server (admin only; prevents all server operations) |
| **Unsuspend** | Resume a suspended server (admin only) |
| **Restart Policy** | Configure auto-restart behavior on crash (see below) |
| **Backup Settings** | Configure per-server backup storage (see below) |

### Transfer Server (Node Transfer)

Server owners can transfer a server to another node on the cluster:

1. Navigate to **Settings**.
2. Find the **Transfer** section and click **Transfer to Another Node**.
3. Select the target node from the dropdown (only shows online nodes with enough resources).
4. Confirm the transfer.

**Requirements:**
- You must have `server.transfer` permission, or be the server owner.
- The server must be **stopped**.
- The target node must be **online**.
- The target node must have enough resources (CPU and memory) to accommodate the server.

**How it works:**
1. The server status changes to `transferring`.
2. A backup stream is created on the source node.
3. The stream is relayed directly to the target node (zero-copy — files never touch the panel).
4. Once the transfer completes, the server's IP is reassigned to the target node (if using IPAM).
5. The server returns to `stopped` status on the new node.

### Transfer Server Ownership

Server owners can transfer ownership to another user:

1. Navigate to **Settings** → **Transfer Ownership**.
2. Enter the target user's email or username.
3. Confirm the transfer.

The target user must have an existing account on the panel. Requires `server.transfer` permission.

### Restart Policy

Configure how the server handles unexpected crashes:

- **Restart on exit** — automatically restart when the process exits
- **Crash counter** — tracks consecutive crashes to prevent restart loops
- **Reset crash count** — manually reset the crash counter (accessible from Settings → Admin tab)

When the server crashes multiple times in succession, the crash counter prevents infinite restart loops. The admin can configure the maximum number of restarts before the server is marked as `issues` status.

### Backup Settings (Admin/Owner)

Configure per-server backup storage:

- **Storage Mode** — local, S3, SFTP, or stream
- **S3 Configuration** — bucket, region, access key, secret key, endpoint
- **SFTP Configuration** — host, port, username, password/private key, base path
- **Backup Allocation** — disk space reserved for local backups (MB)
- **Retention** — max backup count and max age (days)

Backup settings are managed per-server. The admin sets defaults, and server owners can override them within allowed limits.

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
   - **Paper** — Paper server builds (no API key required)
3. Search by name, filter by category, game version, or loader.
4. View trending/top downloads when no search query is entered.

### Installing Mods

1. Find the mod you want to install.
2. Select the desired version.
3. Choose the installation target (e.g., `mods`, `datapacks`, `modpacks`).
4. Click **Install**.
5. The mod file is downloaded to the configured path (e.g., `/mods`).

### Managing Installed Mods

- **View** — see all installed mods with version info and provider details
- **Uninstall** — remove a mod from the server
- **Check for updates** — scan installed mods for available updates (rate-limited to 5 checks per minute)
- **Update** — update a mod to the latest version

### Game Version Resolution

The mod manager can resolve game versions from Modrinth to ensure compatibility. Select your game version to filter compatible mods. For Paper builds, the provider resolves available versions automatically.

---

## Plugin Manager

If the server template supports plugin management, a **Plugin Manager** tab is available. Similar to the Mod Manager but for server plugins (e.g., Spigot/Bukkit plugins for Minecraft).

### Browsing Plugins

1. Navigate to your server → **Plugin Manager** tab.
2. Browse plugins from supported providers:
   - **Modrinth** — requires admin-configured API key
   - **Spigot** — SpigotMC plugin downloads (no API key required)
   - **Paper** — Paper plugin builds (no API key required)
3. Search by name, filter by category, and version.
4. View trending/top downloads when no search query is entered.

### Installing Plugins

1. Find the plugin you want to install.
2. Select the desired version.
3. Click **Install**.
4. The plugin file (`.jar`) is downloaded to the configured path (e.g., `/plugins`).

### Managing Installed Plugins

- **View** — see all installed plugins with provider and version info
- **Uninstall** — remove a plugin from the server
- **Check for updates** — scan installed plugins for available updates (rate-limited to 5 checks per minute)
- **Update** — update a plugin to the latest version

---

## Server Activity Log

The **Activity Log** tab shows a timeline of all actions performed on this server.

### Viewing Activity

1. Navigate to your server → **Activity Log** tab.
2. The log displays the most recent 25 actions with:
   - **Action type** — e.g., "Server started", "Backup created", "Console command sent"
   - **Timestamp** — when the action occurred
   - **User** — who performed the action (if applicable)
3. Pages through 25 entries at a time (auto-refreshes every 10 seconds).

### Activity Events

Common events tracked:
- Server power actions (start, stop, restart, kill)
- Backup creation and restoration
- Console command execution
- File operations (upload, download, edit, delete)
- Settings changes (resources, startup command, ports)
- User access changes (invites, revokes)
- Mod/plugin installation and removal
- Task execution
- Server suspension/resumption/archiving
- Node transfer

---

## Server Archiving

**Archiving** is an admin-level feature that preserves a server without deleting it.

### Archiving a Server

1. Navigate to your server → **Admin** tab.
2. Click **Archive Server**.
3. The server is immediately set to `archived` status.
4. If the server was running, it is gracefully stopped before archiving.

**Effects of archiving:**
- The server is removed from active node resource calculations.
- The server remains in the database with all configuration intact.
- The server cannot be started until restored.
- Files remain on the node's filesystem.

### Restoring an Archived Server

1. Navigate to your server → **Admin** tab.
2. Click **Restore Server**.
3. The server status returns to `stopped`.
4. The server reappears in the server list and can be started normally.

---

## Server Suspension

Servers can be **suspended** by administrators to temporarily disable a server without deleting it.

### Why Servers Get Suspended

- **Non-payment** — if payment integration is configured
- **Resource abuse** — exceeding CPU, memory, or disk limits
- **Policy violations** — violating terms of service
- **Investigation** — pending security review
- **Manual admin action** — at admin discretion

### How Suspension Appears to Users

When a server is suspended:

1. The server status shows as `suspended` in the server list.
2. A **suspension reason** is displayed (set by the admin).
3. The server cannot be started, stopped, or modified.
4. The console shows a message: "This server has been suspended. Contact your admin for details."

### Resuming a Suspended Server

Only administrators can unsuspend a server:

1. Navigate to **Admin** → **Servers**.
2. Find the suspended server.
3. Click **Unsuspend**.
4. The server returns to its previous state (stopped or running).

### Server Suspension API

```bash
# Suspend a server (admin only)
POST /api/servers/:serverId/suspend

# Unsuspend a server (admin only)
POST /api/servers/:serverId/unsuspend
```text

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
```text

### Managing API Keys

- **List** — view all your API keys
- **Enable/Disable** — toggle a key on or off
- **Rename** — update the key's name
- **Delete** — permanently revoke a key
- **View usage** — see request counts and rate limit status

### Agent Keys

API keys with `metadata.purpose = "agent"` are automatically created for node agents. These are managed by admins and should not be manually modified.

---

## Password Recovery

If you've forgotten your password, you can reset it using the password recovery flow.

### Resetting Your Password

1. Go to the login page at `/login`.
2. Click **Forgot Password?**
3. Enter the email address associated with your account.
4. Click **Send Reset Link**.
5. Check your email inbox for a password reset message.

### Completing the Reset

1. Click the link in the reset email.
2. You'll be taken to the **Reset Password** page at `/reset-password`.
3. Enter your new password (must meet complexity requirements).
4. Confirm the new password.
5. Click **Reset Password**.

You'll be redirected to the login page. Sign in with your new password.

### Email Delivery Requirements

Password recovery requires SMTP to be configured by your administrator:

- The admin must configure SMTP settings in **Admin → System** (`/admin/system`).
- Settings include: SMTP host, port, username, password, from address, and SSL/TLS options.
- If SMTP is not configured, password reset emails cannot be delivered.

### Troubleshooting

| Problem | Solution |
|---------|----------|
| Didn't receive the reset email | Check spam/junk folder; wait up to 5 minutes |
| Link expired | Request a new reset link (links expire after 1 hour) |
| Token invalid | Click "Request Reset" again — don't reuse old links |
| Admin says SMTP isn't configured | Contact your server administrator to configure email |

### Security

- Password reset tokens use constant-time comparison to prevent timing attacks.
- Tokens are single-use only.
- Failed reset attempts are rate-limited.

---

## Forgot Password & Reset Password Pages

These pages handle the complete password recovery flow in Catalyst.

### Forgot Password Page (`/forgot-password`)

When a user cannot remember their password, they visit the Forgot Password page.

**How to access:**
1. Go to the login page (`/login`).
2. Click the **Forgot Password?** link below the login form.
3. You'll be taken to `/forgot-password`.

**What the page does:**
1. Shows a single input field for the email address.
2. Validates the email format before submitting.
3. Sends a password reset email via better-auth if the email is registered.
4. Displays a confirmation message: "If an account exists for this email, you'll receive a password reset link."

> **Note:** For security, the page does NOT reveal whether an email is registered — the confirmation message is identical whether the email exists or not.

**What happens after submission:**
1. A password reset token is generated (1-hour expiry).
2. An email is sent to the registered address with a reset link.
3. The token uses constant-time comparison to prevent timing attacks.
4. Failed requests are rate-limited (typically 3 per hour per IP).

**Email contents:**
- A link to `/reset-password?token=<token>`
- Instructions for resetting the password
- A note that the link expires in 1 hour

### Reset Password Page (`/reset-password`)

This page completes the password recovery flow. It is accessed via the link in the reset email.

**How to access:**
1. Click the reset link in your password recovery email.
2. You'll be taken to `/reset-password?token=<token>`.

**What the page does:**
1. Validates the reset token in constant-time.
2. Displays two password fields: **New Password** and **Confirm New Password**.
3. Validates password complexity requirements (min 8 characters, matches common password lists, etc.).
4. When submitted:
   - The token is consumed (single-use only).
   - The user's password is updated in the database.
   - The user is redirected to the login page.
5. If the token is expired or already used, an error is displayed and the user is redirected to the Forgot Password page.

**Password requirements:**
| Requirement | Detail |
|------------|--------|
| **Minimum length** | 8 characters |
| **Maximum length** | 128 characters |
| **Cannot contain** | Common passwords, email address, username |

---

## 2FA Setup Page Details

The 2FA Setup page (`/two-factor`) handles the complete 2FA enrollment flow.

### Accessing the 2FA Setup Page

Navigate to **Profile** → **Security** → **Two-Factor Authentication**, or go directly to `/two-factor`.

### Step 1 — Verify Current Password

Before enabling 2FA, you must verify your current password:
1. Enter your current password in the verification field.
2. Click **Enable 2FA**.
3. The system validates the password before proceeding.

### Step 2 — Scan QR Code

After password verification, a QR code is displayed:
1. Open your authenticator app (Google Authenticator, Authy, Microsoft Authenticator, etc.).
2. Scan the QR code shown on the page.
3. The QR code contains the TOTP secret key encoded as a `otpauth://totp/` URI.
4. The app generates 6-digit codes that change every 30 seconds.

### Step 3 — Enter Verification Code

After scanning the QR code:
1. Enter the 6-digit code from your authenticator app.
2. Click **Verify**.
3. The system validates the code using time-based one-time password (TOTP) algorithm.
4. If valid, 2FA is enabled.

### Step 4 — Save Backup Codes

10 backup codes are generated. Each code can be used **only once**:
1. Display the codes on screen.
2. Copy them to a password manager, printed document, or secure location.
3. Click **I've Saved My Backup Codes** to proceed.

> **Important:** If you lose access to your authenticator device, these backup codes are your only way to log in. They cannot be recovered.

### Trust Device Option

During the verification step (Step 3), you'll see a checkbox: **"Trust this device for 30 days."**

When checked:
- Your browser fingerprint is stored server-side as a trusted device identifier.
- For 30 days, you won't need to enter a 2FA code from this browser.
- The device identity is based on a cryptographic fingerprint, not cookies alone.
- Each trusted device shows its registration date and fingerprint hash in the 2FA settings.
- You can revoke trust at any time by clicking **Revoke Trust** next to the device.
- Revoking a trusted device immediately requires 2FA on the next login attempt.

### Disabling 2FA

To disable 2FA:
1. Navigate to **Profile** → **Two-Factor Authentication**.
2. Enter a valid 2FA code from your authenticator.
3. Click **Disable 2FA**.
4. All backup codes are immediately invalidated.
5. Trusted devices are also untrusteds.

### Backup Code Usage

If you lose your authenticator device:
1. Go to the login page.
2. Click **Use a backup code** instead of entering a 2FA code.
3. Enter one of your 10 backup codes.
4. You'll be prompted to:
   - Generate new backup codes (invalidating the old ones)
   - Re-enable 2FA with a new QR code

---

## System Settings

The System Settings page (`/admin/system`) is the central hub for platform configuration. It provides a comprehensive dashboard showing system health and critical configuration options.

### Accessing System Settings

1. Navigate to **Admin** → **System** (`/admin/system`).
2. The page loads with three main sections: System Health, SMTP Configuration, and Mod Manager Settings.

### System Health Dashboard

The top section displays real-time platform health:

| Metric | Description |
|--------|-------------|
| **Panel Version** | Current running version of the panel |
| **Database Status** | Connected, disconnected, or degraded |
| **Online Nodes** | Number of nodes currently connected |
| **Offline Nodes** | Number of nodes that haven't reported in the last 5 minutes |
| **Stale Nodes** | Nodes that were online but haven't reported metrics in the last 15 minutes |
| **Total Users** | Number of registered users |
| **Total Servers** | Number of servers across all nodes |
| **Active Servers** | Servers currently in running or starting state |

The dashboard auto-refreshes every 30 seconds for real-time monitoring.

### SMTP Configuration

SMTP (Simple Mail Transfer Protocol) settings are critical for Catalyst to send emails: login verification, password resets, invite notifications, alert notifications, and audit log exports.

**Configuration fields:**

| Field | Description | Example |
|-------|-------------|--------|
| **Host** | SMTP server hostname or IP | `smtp.gmail.com` |
| **Port** | SMTP server port (587 for STARTTLS, 465 for SSL/TLS, 25 for unencrypted) | `587` |
| **Username** | SMTP authentication username | `noreply@yourdomain.com` |
| **Password** | SMTP authentication password or app-specific password | `••••••••` |
| **From Address** | Sender email address displayed to recipients | `Catalyst <noreply@yourdomain.com>` |
| **Reply-To** | Email address for replies (optional) | `admin@yourdomain.com` |
| **SSL/TLS** | Use encrypted TLS connection | ☑️ Enabled |
| **STARTTLS** | Upgrade connection to TLS after connecting (port 587) | ☑️ Enabled |
| **Connection Pool** | Maximum concurrent SMTP connections | `10` |
| **Max Connections** | Maximum connections per pool | `5` |
| **Max Messages** | Max messages per connection before reconnection | `100` |

**Sending a test email:**
1. Fill in all required fields.
2. Enter a test recipient email address.
3. Click **Send Test Email**.
4. A confirmation message appears: "Test email sent successfully" or an error if delivery failed.

> **⚠️ Security:** SMTP passwords are stored encrypted in the database. They are never logged or displayed in plain text.

**Common SMTP providers:**

| Provider | Host | Port | SSL/TLS | STARTTLS |
|----------|------|------|---------|----------|
| **Gmail** | `smtp.gmail.com` | 465 | ✅ | ❌ |
| **Gmail (STARTTLS)** | `smtp.gmail.com` | 587 | ❌ | ✅ |
| **SendGrid** | `smtp.sendgrid.net` | 465 | ✅ | ❌ |
| **Amazon SES** | `email-smtp.region.amazonaws.com` | 465 | ✅ | ❌ |
| **Mailgun** | `smtp.mailgun.org` | 465 | ✅ | ❌ |
| **Office 365** | `smtp.office365.com` | 587 | ❌ | ✅ |

### Mod Manager API Keys

The Mod Manager allows users to browse and install mods from CurseForge, Modrinth, and Paper. To access these providers, API keys are required.

**CurseForge API Key:**
1. Go to [CurseForge Developers](https://developers.curseforge.com/).
2. Create an API key for your application.
3. Paste the key into the **CurseForge API Key** field.
4. Click **Save**.

**Modrinth API Key:**
1. Go to [Modrinth API Settings](https://modrinth.com/user/settings).
2. Create an API key.
3. Paste the key into the **Modrinth API Key** field.
4. Click **Save**.

> **Note:** These API keys are used server-side only. They are not exposed to users or included in API responses.

### Auto Updater

The Auto Updater section shows version information and update controls:

| Field | Description |
|-------|-------------|
| **Current Version** | The currently installed panel version |
| **Latest Version** | The most recent release version (checked against GitHub) |
| **Update Available** | Boolean showing whether a newer version exists |
| **Release URL** | Link to the GitHub release page |
| **Auto-Update** | Toggle to automatically apply updates when available |

**Update behavior:**
- When a new version is detected, a notification banner appears at the top of the panel.
- If auto-update is enabled, the update is applied automatically on the next panel restart.
- If auto-update is disabled, the banner includes a manual update button.
- The panel detects whether it's running in Docker or native mode and shows the appropriate update instructions.

---

## Security Settings

The Security Settings page (`/admin/security`) provides comprehensive security configuration for the entire platform. It contains 18 configurable fields organized into four sections.

### Accessing Security Settings

1. Navigate to **Admin** → **Security** (`/admin/security`).
2. The page loads with four collapsible sections: Rate Limits, Lockout Policy, File Tunnel, and Auth Lockouts.

### Rate Limits

Controls how many requests different endpoints can receive per time window. These limits prevent resource exhaustion and abuse.

| Setting | Default | Description |
|---------|---------|-------------|
| **Auth Requests/Min** | 10 | Maximum authentication requests (login, register, reset) per minute per IP |
| **File Ops/Min** | 30 | Maximum file operations (upload, download, edit) per minute per server |
| **Console Input/Min** | 60 | Maximum console commands per minute per server |
| **Console Output Lines/Sec** | 1000 | Maximum console output lines per second per server |
| **Console Output Bytes/Sec** | 100000 | Maximum console output bytes per second per server |
| **Agent Messages/Sec** | 100 | Maximum WebSocket messages per second from agent |
| **Agent Metrics/Sec** | 50 | Maximum metric messages per second from agent |
| **Server Metrics/Sec** | 100 | Maximum metric messages per second per server |
| **File Upload/MB** | 100 | Maximum file upload size in megabytes |

> **⚠️ Warning:** Lowering rate limits too aggressively may cause legitimate users to be throttled. Test changes in a development environment before applying to production.

### Lockout Policy

Protects against brute-force login attempts by temporarily blocking IPs or emails after repeated failures.

| Setting | Default | Description |
|---------|---------|-------------|
| **Max Login Attempts** | 5 | Number of failed attempts before lockout |
| **Lockout Window** | 15 | Time window in minutes for counting failed attempts |
| **Lockout Duration** | 30 | Minutes to block an IP/email after reaching max attempts |
| **Enable IP Lockout** | ✅ | Block the IP address of failed login attempts |
| **Enable Email Lockout** | ✅ | Block login attempts for an email after too many failures |
| **Lockout Viewer** | — | Searchable table of active lockouts (see below) |

**Lockout Viewer:**
- Shows all currently active lockouts with:
  - **IP Address** — the blocked IP
  - **Email** — the blocked email address (if email lockout is enabled)
  - **Failure Count** — number of failed attempts that triggered the lockout
  - **Last Failed** — timestamp of the most recent failed attempt
  - **Status** — locked/unlocked
- Supports search by IP or email.
- Pagination: 50 entries per page.
- Administrators can manually clear lockouts by clicking **Clear** next to an entry.
- Auto-refreshes every 30 seconds.

### File Tunnel Security

Controls the secure file tunnel used by the file manager to communicate with node agents.

| Setting | Default | Description |
|---------|---------|-------------|
| **Tunnel Requests/Min** | 60 | Maximum file tunnel requests per minute per server |
| **Max Upload Size (MB)** | 100 | Maximum single file upload size through the tunnel |
| **Max Pending Per Node** | 50 | Maximum pending file operations queued per node |
| **Max Concurrent Per Agent** | 10 | Maximum concurrent file operations per agent |
| **Max Buffer (MB)** | 64 | Maximum output buffer for compress, decompress, and archive browsing |

### Auth Lockouts

The Auth Lockouts section provides a real-time view of active login lockouts (see [Brute Force Protection & Lockout Viewer](#brute-force-protection--lockout-viewer) below for details).

### Audit Retention

Controls how long audit logs are kept:

| Setting | Default | Description |
|---------|---------|-------------|
| **Audit Retention Days** | 90 | Number of days to retain audit log entries |

Logs older than the retention period are permanently deleted by a background pruning service.

### CORS & Helmet

| Setting | Description |
|---------|-------------|
| **CORS Origin** | Configured via the `CORS_ORIGIN` environment variable. Specifies which domains can make cross-origin requests to the API. Default allows all origins in development; restrict to specific domains in production. |
| **Helmet Headers** | Catalyst uses `@fastify/helmet` to set secure HTTP headers: `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection`, `Strict-Transport-Security`. These are configured automatically by the framework and cannot be disabled. |

---

## System Errors Dashboard

The System Errors dashboard (`/admin/system-errors`) displays client-side errors reported by frontend modules throughout the application.

### Accessing the Dashboard

1. Navigate to **Admin** → **System Errors** (`/admin/system-errors`).
2. The page loads with error statistics and a searchable table of reported errors.

### What Gets Reported

The `reportSystemError()` function is called by 60+ frontend modules, including:
- **AuthStore** — authentication failures, token refresh errors
- **useFileManager** — file upload failures, permission errors
- **useSetupStatus** — setup wizard errors
- **useSseConsole** — console stream disconnections, command failures
- **themeStore** — theme loading errors
- **ProfilePage** — profile update failures, avatar upload errors

### Error Information

Each reported error includes:
| Field | Description |
|-------|-------------|
| **Level** | `error`, `warn`, or `critical` |
| **Component** | The module or page that reported the error |
| **Message** | Error message (sensitive data is redacted automatically) |
| **Stack Trace** | JavaScript stack trace (if available) |
| **Metadata** | Contextual data (e.g., server ID, user agent, browser version) |
| **Resolved** | Whether the error has been acknowledged and marked as resolved |
| **Timestamp** | When the error was reported |

### Searching and Filtering

| Filter | Description |
|--------|-------------|
| **Search** | Full-text search across error messages |
| **Level** | Filter by `error`, `warn`, or `critical` |
| **Component** | Filter by the reporting module |
| **Date Range** | Filter by when errors were reported |

### Resolving Errors

1. Find the error in the table.
2. Click **Resolve** next to the error entry.
3. The error is marked as resolved and removed from the active list.
4. Resolved errors can still be viewed in a separate "Resolved" tab.

### Pagination

- 50 errors per page.
- Supports navigation through paginated results.
- Auto-refreshes every 30 seconds to show new errors.

---

## Theme Settings

The Theme Settings page (`/admin/theme-settings`) allows administrators to customize the look and feel of the Catalyst panel.

### Accessing Theme Settings

1. Navigate to **Admin** → **Theme Settings** (`/admin/theme-settings`).
2. The page displays a live preview panel alongside configuration controls.

### Panel Branding

| Setting | Description | Example |
|---------|-------------|--------|
| **Panel Name** | Display name shown in the browser title, sidebar, and login page | `My Game Panel` |
| **Logo URL** | URL to a custom logo image (recommended size: 200×50 pixels) | `https://example.com/logo.png` |
| **Favicon URL** | URL to a custom favicon (32×32 or 16×16 PNG) | `https://example.com/favicon.ico` |

### Color Scheme

Customize the panel's color palette with three primary colors:

| Color | Usage | Example |
|-------|-------|--------|
| **Primary** | Sidebar, buttons, primary links, active states | `#1d4ed8` (blue) |
| **Secondary** | Headers, accents, secondary buttons | `#16a34a` (green) |
| **Accent** | Highlights, notifications, badges | `#dc2626` (red) |

### Custom CSS

Inject custom CSS rules to further customize the appearance:

1. Navigate to the **Custom CSS** section.
2. Enter CSS rules in the editor.
3. Click **Apply** to see changes in the live preview.
4. Click **Save** to persist the CSS to the database.

> **⚠️ Warning:** Custom CSS is applied globally. Ensure your rules don't break the layout or accessibility of the panel. Invalid CSS will be rejected on save.

### Theme Preview

The preview panel shows:
- The sidebar with your logo and custom colors
- A sample server card with custom button styles
- The header with your panel name and color scheme
- Light and dark mode toggles for previewing both themes

### Light/Dark Mode

| Setting | Description |
|---------|-------------|
| **Default Mode** | Set the default theme for new users (light or dark) |
| **Per-User Override** | Individual users can toggle between light and dark mode from their profile settings |

---

## Database Hosts

The Database Hosts page (`/admin/database`) manages remote database servers that can be used for Catalyst server databases.

### Accessing Database Hosts

1. Navigate to **Admin** → **Database** (`/admin/database`).
2. The page shows a list of configured database hosts.

### Creating a Database Host

1. Click **Add Database Host**.
2. Configure the connection:

| Field | Description |
|-------|-------------|
| **Name** | Display name for the host (e.g., `Production MySQL`) |
| **Host** | Database server hostname or IP address |
| **Port** | Database port (3306 for MySQL, 5432 for PostgreSQL) |
| **Username** | Admin username with CREATE DATABASE and CREATE USER privileges |
| **Password** | Admin password |
| **Database Type** | MySQL, MariaDB, or PostgreSQL |

3. Click **Test Connection** to verify the settings.
4. Click **Save** to add the host.

### Database Host Actions

| Action | Description |
|--------|-------------|
| **Test Connection** | Verify connectivity with the database server |
| **Edit** | Modify host settings |
| **Delete** | Remove the host (prevents deletion if servers are using it) |

### Per-Server Database Provisioning

Once database hosts are configured, server owners can create databases from the server's **Databases** tab:

1. Navigate to your server → **Databases** tab.
2. Select a database host from the dropdown.
3. Enter a database name.
4. Click **Create**.

The database is provisioned on the remote host, and connection credentials are displayed to the user.

---

## System-wide Alerts

The System-wide Alerts page (`/admin/alerts`) manages alerts that affect the entire platform (not individual servers).

### Accessing Alerts

1. Navigate to **Admin** → **Alerts** (`/admin/alerts`).
2. The page shows a list of system-wide alert rules and active alerts.

### Creating Alert Rules

1. Click **Create Alert Rule**.
2. Configure:

| Field | Description |
|-------|-------------|
| **Name** | Descriptive name for the rule |
| **Type** | `node_offline` — triggers when a node goes offline; `server_crash_surge` — triggers when multiple servers crash simultaneously; `disk_usage` — triggers when total disk usage exceeds a threshold |
| **Conditions** | Threshold values and comparison operators |
| **Notification Channels** | Webhook URL, email recipients, or in-panel notification |
| **Enabled** | Toggle the rule on or off |

### Viewing System Alerts

System alerts are visible to all users with the `alert.read` permission:
1. An alert badge appears on the sidebar navigation.
2. Click the badge to view active alerts.
3. Click **Resolve** to mark an alert as handled.

---

## Migration Tool

The Migration Tool (`/admin/migration`) assists in migrating from Pterodactyl Panel to Catalyst.

### Accessing the Migration Tool

1. Navigate to **Admin** → **Migration** (`/admin/migration`).
2. The page shows migration configuration and progress.

### Migration Scopes

| Scope | Description |
|-------|-------------|
| **Full Migration** | Migrate all nodes, servers, users, and databases |
| **Node Migration** | Migrate specific nodes and their servers |
| **Server Migration** | Migrate individual servers across nodes |

### Migration Process

1. **Test Connection:**
   - Enter your Pterodactyl panel URL and API key.
   - Click **Test Connection** to verify access.
   - The tool retrieves a summary of Pterodactyl data (users, servers, nodes) for verification.

2. **Configure Mapping:**
   - **Node Mapping:** Map each Pterodactyl node to a Catalyst node.
   - **Server Mapping:** Verify each server's target node and allocation.
   - **User Mapping:** Map Pterodactyl users to Catalyst users (by email or manual mapping).

3. **Start Migration:**
   - Click **Start Migration** to begin.
   - Progress is shown step by step:
     - Migrating users...
     - Migrating nodes...
     - Migrating servers...
     - Migrating databases...
     - Migrating backups...
   - A progress bar shows completion percentage.

4. **Pause/Resume/Cancel:**
   - **Pause** — temporarily stop the migration.
   - **Resume** — continue from where you paused.
   - **Cancel** — abort the migration and roll back completed steps.

### Post-Migration

After migration completes:
- All migrated users will need to reset their passwords (password hashes are not compatible).
- Server databases should be tested for connectivity.
- Node allocations should be verified against the Catalyst node configuration.
- SFTP tokens will need to be regenerated for each server.

---

## Node Details Page

The Node Details page (`/admin/nodes/:nodeId`) provides a comprehensive view of a specific node's status, metrics, and configuration.

### Accessing Node Details

1. Navigate to **Admin** → **Nodes**.
2. Click on a node name in the list to open its details page.

### Overview Section

| Field | Description |
|-------|-------------|
| **Node Name** | Display name and UUID |
| **Status** | Online, Offline, or Stale |
| **Location** | The location this node belongs to |
| **Hostname** | System hostname of the node machine |
| **Public Address** | IP/hostname reachable from the panel |
| **Agent Version** | Version of the Catalyst agent running on the node |
| **Container Runtime** | containerd version |
| **Last Reported** | Timestamp of last heartbeat from the agent |

### Resource Metrics (Live)

Real-time resource usage displayed with gauges and historical charts:

| Metric | Current | Allocated | Available |
|--------|---------|-----------|----------|
| **CPU** | X% (X cores) | Y cores | Z cores |
| **Memory** | X MB / Y GB | Y GB | Z MB |
| **Disk** | X GB / Y GB | Y GB | Z GB |

Charts show historical trends (1 hour, 6 hours, 24 hours, 7 days).

### Server Summary

| Server State | Count |
|-------------|-------|
| Running | X |
| Stopped | X |
| Installing | X |
| Crashed | X |
| Suspended | X |
| Transferring | X |
| Total | X |

### Allocation Management

View and manage IP:port allocations:
1. Click the **Allocations** tab.
2. See all allocated IP:port combinations.
3. **Add Allocation:** Enter IP and port range.
4. **Remove Allocation:** Click delete next to an allocation.
5. **Edit Allocation:** Modify port range or IP.

### Agent Health

| Check | Status |
|-------|--------|
| **WebSocket Connection** | Connected / Disconnected |
| **Containerd Status** | Running / Stopped |
| **Systemd Service** | Active / Inactive |
| **Disk Space** | X GB available |
| **Memory Pressure** | Normal / High / Critical |
| **Network Connectivity** | Reachable / Unreachable |

### Node Actions

| Action | Description |
|--------|-------------|
| **Restart Agent** | Restart the agent service (downtime: 10-30 seconds) |
| **Regenerate API Key** | Generate a new API key (invalidates the old one) |
| **Deployment Token** | Generate a one-time deployment URL |
| **View System Logs** | Show agent logs from the last 24 hours |
| **Archive Node** | Set node to archived status |

---

## Template Details Page

The Template Details page (`/admin/templates/:templateId`) allows you to view and edit a server template's configuration.

### Accessing Template Details

1. Navigate to **Admin** → **Templates**.
2. Click on a template name to open its details page.

### Template Information

| Field | Description |
|-------|-------------|
| **Name** | Display name (e.g., `Minecraft Server (Paper)`) |
| **Description** | Human-readable description |
| **Author** | Template author |
| **Features** | Enabled features (e.g., Mod Manager, Plugin Manager, File Editor) |
| **EULA Required** | Whether the template requires EULA acceptance |
| **Created** | Template creation date |
| **Updated** | Last modification date |

### Template Variables

Edit template-specific variables used in startup commands and install scripts:

1. Click the **Variables** tab.
2. Each variable shows:
   - **Name** — variable name (e.g., `MEMORY`, `PORT`)
   - **Default** — default value
   - **Description** — what the variable controls
   - **Min/Max** — validation bounds
   - **Required** — whether the variable must be set when creating a server
3. Click **Edit** next to a variable to modify its settings.

### Template Configuration

Edit the template's configuration:

1. Click the **Config** tab.
2. Settings include:
   - **Container Image** — Docker image for the server
   - **Install Image** — Docker image for the install script
   - **Startup Command** — command to start the server (supports `{{VARIABLE}}` interpolation)
   - **Stop Command** — command for graceful shutdown
   - **Install Script** — script to run during server installation
   - **Startup Checks** — conditions that must be met before the server can start

### Template Actions

| Action | Description |
|--------|-------------|
| **Edit** | Modify the template's settings |
| **Duplicate** | Create a copy of the template (useful for creating variants) |
| **Delete** | Permanently remove the template (prevents deletion if servers use it) |

---

## Cross-Tab Session Synchronization

Catalyst automatically keeps your sessions synchronized across all open browser tabs.

### How It Works

- When you log in to Catalyst in one tab, all other open tabs are automatically logged in.
- When you log out from any tab, you are logged out of ALL tabs simultaneously.
- When your session expires, all tabs are notified and redirect to the login page.

### Technical Details

The synchronization is powered by two mechanisms:

1. **BroadcastChannel API** — a browser API that sends messages between tabs sharing the same origin. The `authStore` listens on the `catalyst-auth` channel and broadcasts session state changes to all tabs.
2. **localStorage event listeners** — as a fallback, changes are also stored in `localStorage` and listened for via the `storage` event.

This ensures that even if a tab is in a different browser window or process, it will still receive session state updates within milliseconds.

### What Gets Synced

| Event | Behavior |
|-------|----------|
| **Login** | All tabs refresh their auth state; sidebar updates to show logged-in menu |
| **Logout** | All tabs clear auth state and redirect to `/login` |
| **Session Expiry** | All tabs detect the expired session and redirect to `/login` |
| **2FA Enabled** | All tabs detect the change and may require re-authentication |
| **Password Changed** | All tabs are logged out (other sessions are revoked) |
| **API Key Created/Deleted** | All tabs update their API key list |

> **Note:** Cross-tab sync only works within the same browser and the same Catalyst panel. It does not sync across different browsers or different panel instances.

---

## Brute Force Protection & Lockout Viewer

Catalyst protects against brute-force login attempts through a combination of rate limiting, IP blocking, email blocking, and a lockout viewer.

### How Brute Force Protection Works

1. **Rate Limiting:**
   - Login attempts are limited to a configurable number per minute (default: 10 requests/minute per IP).
   - Exceeding the rate limit results in a `429 Too Many Requests` response.
   - The rate limiter uses a sliding window algorithm for accuracy.

2. **Lockout Policy:**
   - After a configurable number of consecutive failed login attempts (default: 5), the user's IP is blocked for a configurable duration (default: 30 minutes).
   - The user's email can also be blocked independently (if email lockout is enabled).
   - Lockouts are stored in the database and checked on every login attempt.

3. **Secure Token Comparison:**
   - All authentication tokens use constant-time comparison to prevent timing attacks.
   - This ensures that the time taken to compare tokens is the same regardless of whether the tokens match or not.

### Lockout Viewer

The lockout viewer (available in Admin → Security) displays all active lockouts in real-time:

| Column | Description |
|--------|-------------|
| **IP Address** | The blocked IP address |
| **Email** | The blocked email address (if email lockout is enabled) |
| **Failure Count** | Number of failed attempts that triggered the lockout |
| **Last Failed** | Timestamp of the most recent failed login attempt |
| **Status** | `locked` or `unlocked` (manually cleared by admin) |
| **Actions** | Click **Clear** to manually remove a lockout |

**Features:**
- **Search:** Filter lockouts by IP address or email.
- **Pagination:** 50 entries per page.
- **Auto-Refresh:** Updates every 30 seconds to show lockouts that are expiring.
- **Manual Clear:** Admins can immediately release a locked IP or email without waiting for the lockout to expire.

### Additional Security Features

| Feature | Description |
|---------|-------------|
| **Password Reset Rate Limiting** | Forgot password requests are rate-limited (typically 3 per hour per IP) |
| **Email Enumeration Prevention** | The forgot password page returns the same message whether the email exists or not |
| **Session Revocation** | Changing your password revokes all other sessions |
| **Token Expiry** | Password reset tokens expire after 1 hour and are single-use |
| **CORS Protection** | `@fastify/cors` restricts cross-origin requests to trusted domains |
| **Helmet Headers** | `@fastify/helmet` sets secure HTTP headers (CSP, X-Frame-Options, HSTS) |

---

## File Editing in File Manager

The File Manager includes a built-in text editor for editing configuration files directly from the web interface.

### Accessing the Editor

1. Navigate to your server → **Files** tab.
2. Navigate to the directory containing the file you want to edit.
3. Click on a text-based file (`.txt`, `.json`, `.yml`, `.cfg`, `.sh`, `.js`, `.py`, `.java`, etc.).

### Editor Features

| Feature | Description |
|---------|-------------|
| **File Path Display** | Shows the full server path to the file being edited |
| **File Name** | Displays the file name at the top of the editor |
| **Line Count** | Shows the total number of lines in the file |
| **Dirty State Tracking** | Visual indicator (orange dot) shows unsaved changes |
| **Save Button** | Writes changes to the server; only available when there are unsaved changes |
| **Cancel Button** | Discards all unsaved changes and returns to file browser |
| **Standard Text Editing** | Copy, paste, find/replace, multi-line selection supported by the browser's text editor |
| **Auto-Save Prevention** | Browser's auto-save and spell-check can interfere; disable in browser settings if needed |

### Editing Workflow

1. Click the file to open it in the editor.
2. Make your changes.
3. An orange dot appears next to the file name in the file list — this indicates unsaved changes.
4. Click **Save** to write the changes to the server.
5. If you close the editor without saving, changes are discarded.
6. If the file becomes too large, the editor may prompt you to open it in an external editor.

> **⚠️ Warning:** The file editor is not suitable for binary files (images, executables, archives). Editing binary files with the text editor may corrupt them. Use the upload/download features for binary files.

---

## Quick Reference: User API Endpoints

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

View and manage linked external authentication accounts (WHMCS, Paymenter, OpenID Connect, etc.) if configured by your admin.

#### Linking an SSO Account

1. Navigate to **Profile** → **SSO Accounts**.
2. Click **Link Account**.
3. Select your SSO provider (e.g., WHMCS, Paymenter).
4. You'll be redirected to the provider's authentication page.
5. After authenticating, you'll be returned to Catalyst with the account linked.

#### Unlinking an SSO Account

1. Navigate to **Profile** → **SSO Accounts**.
2. Find the account you want to unlink.
3. Click **Unlink**.
4. Confirm the action.

**Warning:** If this is your only login method, unlinking may lock you out. Ensure you have a password set up or another SSO account linked before removing.

### Active Sessions

View all active sessions with:

- **Browser and OS** — detected from user-agent
- **IP Address** — where the session was created
- **Last active** — when the session was last used
- **Created** — when the session was started

You can revoke any session by clicking **Revoke**.

### Audit Log

View your personal activity log showing a full timeline of actions with icons:

| Icon | Action |
|------|--------|
| 🔓 | Login / logout events |
| 🔑 | Password changes |
| 🗑️ | Server creation/deletion |
| ▶️ | Server start/stop |
| 🛡️ | 2FA enable/disable |
| 🔐 | Passkey changes |
| 🗝️ | API key creation/deletion |
| 👤 | User access changes |
| 📧 | Invite creation/acceptance |

The audit log shows:
- **Action type** — what happened, with a descriptive icon
- **Timestamp** — when the action occurred
- **Details** — relevant context (e.g., which server, which user)

> **Note:** This is your *personal* audit log. Administrators can also view a *system-wide* audit log (see [Admin Audit Logs](#admin-audit-logs) below).

### GDPR Data Export

Download a complete ZIP archive of all your personal data:

1. Navigate to **Profile** → **Export My Data**.
2. Click **Request Export**.
3. A ZIP file containing your user data is generated and available for download.

The export includes:
- Account information (username, email, profile data)
- Server ownership and access records
- API keys (not the keys themselves, but their metadata)
- Audit log entries
- Alert rules and configurations

> **Note:** Exports are generated asynchronously. Check your profile page for download availability.

### Account Deletion

Permanently delete your account and all associated data:

1. Navigate to **Profile** → **Danger Zone** → **Delete Account**.
2. Enter `DELETE` to confirm.
3. Enter your password to authenticate.
4. Click **Delete Account**.

**Consequences:**
- Your account and personal data are permanently removed.
- You will be immediately logged out from all sessions.
- You cannot recover your account or data after deletion.
- If you own servers, those servers will be transferred to the admin team or deleted (admin-dependent).
- If you have active subscriptions or payments, cancel them separately before deleting.

### Avatar Upload

Upload a profile avatar:

1. Navigate to **Profile** → **Account Information**.
2. Click **Upload Avatar**.
3. Select an image file.

**Restrictions:**
- **Accepted formats:** JPEG, PNG, GIF, WebP
- **Max size:** 2 MB
- **Validation:** Magic byte validation (file content, not just extension, is checked to prevent malicious uploads)
- SVG files are not accepted due to XSS risk

---

## Two-Factor Authentication (2FA)

Enable 2FA for additional account security.

### Enabling 2FA

1. Navigate to **Profile** → **2FA** section.
2. Click **Enable 2FA**.
3. You will be prompted to enter your current password for confirmation.
4. A QR code is displayed for your authenticator app (Google Authenticator, Authy, etc.).
5. Scan the QR code.
6. Enter the 6-digit verification code from your authenticator app.
7. **Save your backup codes** — these one-time codes can be used if you lose access to your authenticator.
8. Click **Confirm** to complete setup.

### Backup Codes

When you enable 2FA, 10 backup codes are generated:

- Store them in a safe, accessible place (password manager, printed copy, etc.)
- Each code can be used **only once**
- Use them to log in if you lose your authenticator device
- You can generate new backup codes at any time from the 2FA section (current codes are invalidated)

### Trust Device Option

During 2FA verification, you can check **"Trust this device for 30 days"**:

- When checked, subsequent logins from the same device/browser won't require a 2FA code for 30 days
- Only the browser fingerprint (not cookies alone) is used to verify device identity
- You can revoke trust at any time from the 2FA section
- Revoking a trusted device immediately requires 2FA on next login

### Disabling 2FA

1. Enter a valid 2FA code from your authenticator.
2. Click **Disable 2FA**.

---

## Passkeys / WebAuthn

Passkeys provide passwordless authentication using biometrics (fingerprint, face recognition) or hardware security keys.

### Adding a Passkey (2-Step Registration)

Passkey registration uses a 2-step process for enhanced security:

**Step 1 — Name the passkey:**
1. Navigate to **Profile** → **Passkeys** section.
2. Click **Add Passkey**.
3. Enter a descriptive name (e.g., "MacBook Touch ID", "YubiKey") to identify it later.
4. Click **Continue**.

**Step 2 — Verify with biometrics/security key:**
1. Your browser prompts for biometric authentication (Face ID, Touch ID, Windows Hello) or security key insertion.
2. Complete the authentication.
3. The passkey is registered.

> **Why 2 steps?** The name is committed first to prevent phishing — an attacker can't intercept the biometric challenge without also knowing which passkey you're registering.

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

## Admin Audit Logs

**This section is for administrators** who have the `audit-log.read` permission. The Admin Audit Logs page provides a system-wide view of all actions performed across the platform.

### Accessing Admin Audit Logs

1. Navigate to **Admin** → **Audit Logs** (`/admin/audit-logs`).
2. The page loads the system-wide audit trail with 15-second auto-refresh.

### Filtering Audit Logs

Filter by multiple criteria simultaneously:

| Filter | Description | Options |
|--------|-------------|--------|
| **Action Type** | What kind of action | login, logout, server.create, server.start, server.stop, server.delete, user.create, user.update, password.change, api.key.create, 2fa.enable, passkey.create, backup.create, file.edit, console.command, task.execute, alert.resolve, and more |
| **Resource Type** | What was affected | server, node, user, role, api_key, auth, backup, alert, template, email, security |
| **User** | Who performed the action | Search by username or email |
| **Date Range** | Time window | Start and end date pickers |

### Viewing Entries

Each audit log entry shows:
- **Action** — what was done (with icon)
- **Resource** — what was affected (e.g., server name, user email)
- **User** — who performed the action
- **Timestamp** — when it happened
- **Details** — additional context (e.g., old/new values for updates)

### Exporting Audit Logs

1. Click **Export CSV** on the audit logs page.
2. A CSV file is generated with all filtered entries.
3. The export includes: action, resource type, user, timestamp, IP address, and details.

### Retention

- Audit logs are automatically pruned based on the **Audit Retention** setting in Admin → Security.
- Default retention: 90 days.
- Logs older than the retention period are permanently deleted by a background pruning service.

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
| POST | `/api/servers/:serverId/archive` | Archive server (admin) |
| POST | `/api/servers/:serverId/restore` | Restore archived server (admin) |

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
| POST | `/api/servers/:serverId/activity-log` | Get server activity log |
