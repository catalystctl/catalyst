# Getting Started Guide

A step-by-step walkthrough for setting up and using Catalyst for the first time.

## Table of Contents

- [Before You Begin](#before-you-begin)
- [Step 1: Install the Panel](#step-1-install-the-panel)
- [Step 2: Initial Login](#step-2-initial-login)
- [Step 3: Configure Your Profile](#step-3-configure-your-profile)
- [Step 4: Create a Location](#step-4-create-a-location)
- [Step 5: Create a Node](#step-5-create-a-node)
- [Step 6: Deploy the Agent](#step-6-deploy-the-agent)
  - [One-Click Deployment](#one-click-deployment)
  - [Manual Agent Setup](#manual-agent-setup)
  - [Networking Configuration](#networking-configuration)
- [Step 7: Server Templates](#step-7-server-templates)
  - [Using Built-in Templates](#using-built-in-templates)
  - [Understanding Template Variables](#understanding-template-variables)
- [Step 8: Create Your First Server](#step-8-create-your-first-server)
- [Step 9: Install the Server](#step-9-install-the-server)
- [Step 10: Access the Console](#step-10-access-the-console)
- [Step 11: Basic Server Management](#step-11-basic-server-management)
- [Next Steps](#next-steps)

---

## Before You Begin

Make sure you have:

- **Installed the panel** following the [Installation Guide](./installation.md)
- **Access to a node machine** (can be the same server or a separate one) with:
  - Linux (Ubuntu 22.04+, Debian 12+, or similar)
  - Root or sudo access
  - containerd installed and running
  - At least 2 CPU cores and 2 GB RAM available for game servers

---

## Step 1: Install the Panel

If you haven't already, follow the [Installation Guide](./installation.md) to deploy Catalyst using Docker Compose:

```bash
git clone https://github.com/your-org/catalyst.git
cd catalyst
cp .env.example .env
# Edit .env with your values
./dev.sh
```

After the stack starts, seed the database to create the initial admin user:

```bash
docker compose exec backend bun run db:seed
```

The seed creates:
- **Admin account:** `admin@example.com` / `admin123`
- **Default roles:** Administrator, Moderator, User
- **Sample templates:** Minecraft (Paper), Node.js Bot
- **Development node:** `development-1`
- **Location:** US East 1

> **⚠️ Important:** Change the admin password immediately after your first login.

---

## Step 2: Initial Login

1. Open your browser and navigate to `http://localhost` (or your configured domain)
2. Click **Sign In** on the login page
3. Enter the admin credentials:
   - **Email:** `admin@example.com`
   - **Password:** `admin123`
4. Click **Sign In**

You'll be taken to the dashboard where you can see an overview of your system.

### Registration

If you have user registration enabled, new users can click **Create Account** to register. Registration requires:

- **Email** — must be unique across the system
- **Username** — 2–32 characters, must be unique
- **Password** — must meet complexity requirements

New users receive a welcome email and start with the default "User" role (read-only access to their own servers).

---

## Step 3: Configure Your Profile

After your first login, update your admin profile:

1. Click your **avatar** or username in the top-right corner
2. Navigate to **Profile Settings**
3. Update your display name, first name, and last name
4. Upload an avatar image (JPEG, PNG, GIF, WebP, or SVG, max 2 MB)

### Enable Two-Factor Authentication

It's strongly recommended to enable 2FA for admin accounts:

1. Go to **Profile** → **Security** → **Two-Factor Authentication**
2. Click **Enable 2FA**
3. Enter your password to confirm
4. Scan the QR code with an authenticator app (Google Authenticator, Authy, etc.)
5. Enter the verification code
6. **Save your backup codes** in a secure location

### Set Up Passkeys (WebAuthn)

For passwordless login support:

1. Go to **Profile** → **Security** → **Passkeys**
2. Click **Add Passkey**
3. Name your passkey (e.g., "MacBook Touch ID")
4. Follow your browser's biometric prompt

### Change Your Password

1. Go to **Profile** → **Security** → **Change Password**
2. Enter your current password
3. Enter and confirm the new password
4. Optionally check **Revoke other sessions** to sign out all other devices

---

## Step 4: Create a Location

Locations are logical groupings for your nodes (e.g., data centers, regions).

1. Navigate to **Admin** → **Locations** (or **Nodes** → **Locations**)
2. Click **Create Location**
3. Fill in the details:
   - **Name:** e.g., `US East 1`
   - **Description:** e.g., `US East Coast Data Center`
4. Click **Save**

Locations are used to organize nodes and help users choose where to deploy their servers.

---

## Step 5: Create a Node

A node represents a physical or virtual machine that runs game server containers.

1. Navigate to **Admin** → **Nodes**
2. Click **Create Node**
3. Fill in the required fields:

| Field | Description | Example |
|---|---|---|
| **Name** | Unique identifier for the node | `node-1` |
| **Description** | Optional description | `Main game server node` |
| **Location** | The location from Step 4 | `US East 1` |
| **Hostname** | System hostname of the machine | `node-1.example.com` |
| **Public Address** | IP address or hostname reachable from the panel | `192.168.1.100` |
| **Max Memory (MB)** | Total RAM available for servers | `32000` |
| **Max CPU Cores** | Total CPU cores available | `16` |
| **Server Data Dir** | (Optional) Override data directory path | `/var/lib/catalyst` |

4. Click **Save**

After creation, the node will appear in the list with an **offline** status until the agent connects.

### Node Allocations

Allocations define the IP:port combinations available on a node. You can add them when creating the node or later:

1. Select the node from the list
2. Go to the **Allocations** tab
3. Click **Add Allocation**
4. Enter the IP address and port range:
   - **IP:** `192.168.1.100` or a CIDR range like `10.0.0.0/24`
   - **Ports:** `25565-25585` (supports individual ports, ranges, and comma-separated values)
5. Click **Save**

When creating a server, you'll assign it an allocation from the available pool.

### Generate Agent API Key

The agent needs an API key to authenticate with the panel:

1. Select the node
2. Go to the **Agent** tab (or click **Generate API Key**)
3. Click **Generate API Key**
4. **Copy the API key** — you'll need it for the agent configuration

> **Important:** The API key is only shown once. Store it securely.

---

## Step 6: Deploy the Agent

The Catalyst agent is a Rust binary that runs on each node. It manages containers using containerd and communicates with the panel over WebSocket.

### System Requirements

On each node machine:

- **OS:** Linux (Ubuntu 22.04+, Debian 12+, or similar)
- **containerd** installed and running (with CRI plugin)
- **Root access** (required for containerd socket access and network management)
- **Ports:** Agent needs outbound access to the panel's WebSocket endpoint (`/ws`)
- **Network:** The panel must be able to reach the node's public address

### One-Click Deployment

The easiest way to deploy the agent:

1. In the panel, select your node and go to the **Agent** tab
2. Click **Generate Deployment Token**
3. This creates a one-time deployment URL (valid for 24 hours) and an API key
4. On the node machine, run the deployment command:
   ```bash
   curl -fsSL https://your-panel.com/api/deploy/YOUR_TOKEN | sudo bash
   ```

The deployment script will:
- Install the agent binary
- Generate `config.toml` with the correct settings
- Set up systemd service
- Start the agent

### Manual Agent Setup

If you prefer manual installation:

1. **Build or download** the agent binary:
   ```bash
   # From source
   cd catalyst-agent
   cargo build --release
   sudo cp target/release/catalyst-agent /usr/local/bin/
   ```

2. **Create the configuration file** at `/etc/catalyst/config.toml`:
   ```toml
   [server]
   backend_url = "wss://panel.example.com/ws"
   node_id = "your-node-uuid"
   api_key = "your-api-key-from-panel"
   hostname = "node-1"
   data_dir = "/var/lib/catalyst"
   max_connections = 100

   [containerd]
   socket_path = "/run/containerd/containerd.sock"
   namespace = "catalyst"

   [logging]
   level = "info"
   format = "json"
   ```

3. **Create a systemd service:**
   ```ini
   [Unit]
   Description=Catalyst Agent
   After=network-online.target containerd.service
   Requires=containerd.service

   [Service]
   Type=simple
   ExecStart=/usr/local/bin/catalyst-agent /etc/catalyst/config.toml
   Restart=always
   RestartSec=5s

   [Install]
   WantedBy=multi-user.target
   ```

4. **Start the agent:**
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now catalyst-agent
   ```

### Networking Configuration

The agent supports multiple networking modes for game server containers:

#### macvlan (Recommended for Game Servers)

macvlan gives each container its own MAC address and IP on the network, which is essential for games that need direct IP access (e.g., Minecraft).

Add network configuration to the agent's `config.toml`:

```toml
[[networking.networks]]
name = "mc-lan-static"
interface = "eth0"
cidr = "10.5.5.0/24"
gateway = "10.5.5.1"
range_start = "10.5.5.50"
range_end = "10.5.5.200"
```

If no networks are configured, the agent will automatically create a default network based on the primary interface.

#### Host Networking

For servers that need to bind directly to the host's network interfaces:

When creating a server, set the `networkMode` to `host`. The server will use the node's public IP address directly.

#### Bridge (Default)

Standard Docker bridge networking. The panel handles port forwarding from the host to the container.

---

## Step 7: Server Templates

Templates define how game servers are configured and deployed. Catalyst comes with built-in templates and supports custom ones.

### Using Built-in Templates

After seeding, you'll have two default templates:

#### Minecraft Server (Paper)

| Setting | Value |
|---|---|
| **Image** | Eclipse Temurin 21 JRE |
| **Default RAM** | 1024 MB |
| **Default CPU** | 2 cores |
| **Port** | 25565 |
| **Features** | Auto-restart, mod manager, plugin manager, file editor |

**Template Variables:**

| Variable | Default | Description |
|---|---|---|
| `MEMORY` | `1024` | Amount of RAM in MB (512–16384) |
| `MEMORY_XMS` | `512` | Initial heap size in MB (256–8192) |
| `PORT` | `25565` | Server port (1024–65535) |
| `VERSION` | `1.21.11` | Minecraft version to install |
| `BUILD` | *(latest)* | Paper build number (empty = latest) |

#### Node.js Bot (Git Repository)

| Setting | Value |
|---|---|
| **Image** | Node.js 20 (Debian Slim) |
| **Default RAM** | 1024 MB |
| **Default CPU** | 1 core |
| **Port** | 3000 |
| **Features** | Auto-restart, Git-based deployment |

**Template Variables:**

| Variable | Default | Description |
|---|---|---|
| `GIT_REPO` | *(required)* | Git clone URL |
| `GIT_BRANCH` | `main` | Branch or tag to deploy |
| `NPM_INSTALL_COMMAND` | `npm install --no-audit --no-fund` | Dependency install command |
| `START_COMMAND` | `npm start` | Fallback startup command |
| `BOT_START_COMMAND` | *(empty)* | Optional startup command override |
| `PORT` | `3000` | Application listen port (1024–65535) |
| `NODE_ENV` | `production` | Node.js runtime environment |

### Understanding Template Variables

Templates use `{{VARIABLE_NAME}}` syntax for interpolation in startup commands and install scripts. When you create a server, the panel replaces these placeholders with the values you provide.

**Example — Minecraft startup command:**
```
java -Xms{{MEMORY_XMS}}M -Xmx{{MEMORY}}M -jar paper.jar nogui
```

With `MEMORY=2048` and `MEMORY_XMS=1024`, this becomes:
```
java -Xms1024M -Xmx2048M -jar paper.jar nogui
```

**Built-in placeholders available in install scripts:**

| Placeholder | Description |
|---|---|
| `{{SERVER_DIR}}` | Absolute path to the server data directory |
| `{{VARIABLE_NAME}}` | Any user-defined template variable |
| `{{TEMPLATE_IMAGE}}` | The container image specified in the template |

---

## Step 8: Create Your First Server

1. Navigate to **Servers** → **Create Server** (or click **+** on the dashboard)
2. Fill in the server details:

#### Basic Settings

| Field | Description | Example |
|---|---|---|
| **Name** | Display name for your server | `My Minecraft Server` |
| **Description** | Optional description | `Survival server for friends` |
| **Node** | The node to deploy on | `node-1` |
| **Template** | Server template | `Minecraft Server (Paper)` |

#### Resource Allocation

| Field | Description | Example |
|---|---|---|
| **Memory (MB)** | RAM to allocate | `2048` |
| **CPU Cores** | CPU cores to allocate | `2` |
| **Disk (MB)** | Disk space to allocate | `10240` |

#### Network Settings

| Field | Description | Example |
|---|---|---|
| **Primary Port** | Main server port | `25565` |
| **Primary IP** | IP address (for IPAM networks) | Auto-assigned |
| **Network Mode** | `mc-lan-static`, `bridge`, or `host` | `mc-lan-static` |

#### Template Variables

Fill in the template-specific variables (e.g., for Minecraft: Memory, Version, Build). Required fields are marked with an asterisk.

3. Click **Create Server**

The server is created in a **stopped** state. You need to install it before starting.

---

## Step 9: Install the Server

Before a server can run, it needs to be installed (this downloads game files and runs the template's install script).

1. Go to your server's detail page
2. Click **Install** (or **Reinstall** to re-run the installation)
3. The agent will:
   - Pull the container image
   - Create the server data directory
   - Execute the install script inside a temporary container
   - Download game files (e.g., Paper.jar for Minecraft)
   - Set up default configuration files

Installation progress is shown in the server console. For Minecraft, this downloads the Paper jar and creates default `server.properties` and `eula.txt`.

---

## Step 10: Access the Console

The real-time console lets you interact with your server:

1. Go to your server's detail page
2. Click the **Console** tab
3. The console shows real-time server output via WebSocket
4. Type commands in the input field and press Enter to send them

**Console features:**
- Real-time output streaming (WebSocket)
- Command history (use arrow keys)
- Scroll through past output
- The console buffer is configurable via `CONSOLE_OUTPUT_BYTE_LIMIT_BYTES` (default: 256 KB)

**Common Minecraft console commands:**
```
help                   — Show available commands
list                   — List online players
op <username>          — Grant operator status
whitelist add <player> — Add player to whitelist
stop                   — Stop the server gracefully
```

---

## Step 11: Basic Server Management

### Start / Stop / Restart

Use the control buttons on the server page:

| Action | Description |
|---|---|
| **Start** | Boot the server container |
| **Stop** | Gracefully stop (sends the stop command, then SIGTERM) |
| **Restart** | Stop and start the server |
| **Kill** | Force-stop (sends SIGKILL immediately) |

### File Manager

Access your server files through the web UI:

1. Go to your server → **Files** tab
2. Browse the server directory structure
3. You can:
   - **Upload** files (drag and drop or click to select)
   - **Download** files
   - **Edit** text files directly in the browser
   - **Create** new files and directories
   - **Delete** files and directories
   - **Compress / decompress** archives (`.tar.gz`, `.zip`)
   - **Rename** files and directories

### SFTP Access

For SFTP access (if enabled on the panel):

1. Go to your server → **Settings** → **SFTP**
2. Generate an SFTP token
3. Connect with your SFTP client:
   ```
   Host: your-panel.com
   Port: 2022
   Username: <your-username>.<server-uuid>
   Password: <sftp-token>
   ```

### Backups

Create and manage server backups:

1. Go to your server → **Backups** tab
2. Click **Create Backup**
3. Backups can be stored locally or on S3 (configured in panel settings)
4. Download existing backups or restore them to the server

### Server Settings

Configure your server from the **Settings** tab:

- **General:** Rename the server, update description
- **Resources:** Adjust memory, CPU, and disk allocations
- **Environment:** Edit template variables
- **Ports:** Change port bindings
- **Startup:** Modify the startup command and stop signal
- **Reinstall:** Re-run the installation script

---

## Next Steps

Now that you have a working setup, explore these features:

- **[Admin Guide](./admin-guide.md)** — User management, roles, permissions, themes, and system configuration
- **[Agent Guide](./agent.md)** — Advanced agent configuration, networking, firewall, and troubleshooting
- **[API Reference](./api-reference.md)** — REST API and WebSocket documentation for automation
- **[Automation Guide](./automation.md)** — Scheduled tasks, webhooks, and plugin development
- **[User Guide](./user-guide.md)** — Complete user documentation for day-to-day server management
