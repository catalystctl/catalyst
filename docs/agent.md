# Agent Guide

Complete documentation for the Catalyst agent — the Rust-based component that runs on each node and manages game server containers.

## Table of Contents

- [What Is the Agent?](#what-is-the-agent)
- [Architecture Overview](#architecture-overview)
- [System Requirements](#system-requirements)
- [Installation](#installation)
  - [One-Click Deployment (from Panel)](#one-click-deployment-from-panel)
  - [Manual Installation](#manual-installation)
  - [Docker Installation](#docker-installation)
  - [Building from Source](#building-from-source)
- [Configuration Reference](#configuration-reference)
  - [server Section](#server-section)
  - [containerd Section](#containerd-section)
  - [networking Section](#networking-section)
  - [logging Section](#logging-section)
  - [Environment Variables](#environment-variables)
- [Networking](#networking)
  - [macvlan (Recommended for Game Servers)](#macvlan-recommended-for-game-servers)
  - [Host Networking](#host-networking)
  - [Bridge Networking](#bridge-networking)
  - [Automatic Network Detection](#automatic-network-detection)
- [Firewall Management](#firewall-management)
  - [Supported Firewall Types](#supported-firewall-types)
  - [Rule Tracking and Persistence](#rule-tracking-and-persistence)
  - [Manual Firewall Configuration](#manual-firewall-configuration)
- [Storage Management](#storage-management)
  - [Disk Images](#disk-images)
  - [Resizing Storage](#resizing-storage)
- [File Management](#file-management)
  - [File Tunnel](#file-tunnel)
  - [Path Security](#path-security)
  - [File Size Limits](#file-size-limits)
- [Container Lifecycle](#container-lifecycle)
  - [Creating Containers](#creating-containers)
  - [Starting and Stopping](#starting-and-stopping)
  - [Console I/O](#console-io)
  - [Log Rotation](#log-rotation)
  - [Resource Monitoring](#resource-monitoring)
- [WebSocket Communication Protocol](#websocket-communication-protocol)
  - [Connection](#connection)
  - [Health Reports](#health-reports)
  - [Resource Stats](#resource-stats)
  - [Server Commands](#server-commands)
- [System Setup (Automatic)](#system-setup-automatic)
  - [Dependency Detection and Installation](#dependency-detection-and-installation)
  - [CNI Plugin Installation](#cni-plugin-installation)
  - [containerd Socket Access](#containerd-socket-access)
- [Logging](#logging)
- [Running as a systemd Service](#running-as-a-systemd-service)
- [Updating the Agent](#updating-the-agent)
- [Troubleshooting](#troubleshooting)

---

## What Is the Agent?

The Catalyst agent is a lightweight Rust binary that runs on each **node** (physical or virtual machine) in your Catalyst deployment. It is responsible for:

- **Container management** — Creating, starting, stopping, and deleting game server containers using containerd
- **Networking** — Managing macvlan, bridge, and host networks for server containers
- **File management** — Providing file operations (browse, upload, download, edit) for server data directories
- **Console I/O** — Streaming real-time server output and accepting commands via WebSocket
- **Firewall rules** — Automatically opening and closing ports for game servers
- **Storage management** — Managing disk images for server data with resize support
- **Health monitoring** — Reporting system resource usage (CPU, memory, disk, network) to the panel

The agent communicates exclusively with the Catalyst panel backend over **WebSocket** (with an HTTP-based file tunnel as a fallback).

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Node Machine                          │
│                                                         │
│  ┌──────────────┐    WebSocket    ┌──────────────────┐  │
│  │   Catalyst   │◄──────────────►│  Catalyst Panel  │  │
│  │    Agent     │    HTTP/WS      │    (Backend)     │  │
│  │  (Rust)      │                 └──────────────────┘  │
│  └──────┬───────┘                                        │
│         │                                                │
│    ┌────┴─────┐                                         │
│    │ containerd│  (socket: /run/containerd/containerd.sock)
│    └────┬─────┘                                         │
│         │                                                │
│    ┌────┴──────────────────────────────────────┐        │
│    │  Game Server Containers                    │        │
│    │  ┌──────────┐ ┌──────────┐ ┌──────────┐   │        │
│    │  │ Server 1 │ │ Server 2 │ │ Server 3 │   │        │
│    │  │ (runc)   │ │ (runc)   │ │ (runc)   │   │        │
│    │  └──────────┘ └──────────┘ └──────────┘   │        │
│    └───────────────────────────────────────────┘        │
│                                                         │
│  CNI Networks: macvlan / bridge (via /etc/cni/net.d)   │
│  Data Dir:     /var/lib/catalyst/{server-uuid}/         │
│  Firewall:     iptables / ufw / firewalld               │
└─────────────────────────────────────────────────────────┘
```

### Agent Components

| Component | Source File | Responsibility |
|---|---|---|
| **Runtime Manager** | `runtime_manager.rs` | Container lifecycle, console I/O, log rotation, resource tracking |
| **Network Manager** | `network_manager.rs` | CNI network creation, deletion, and IPAM management |
| **Firewall Manager** | `firewall_manager.rs` | Automatic firewall rule management for server ports |
| **File Manager** | `file_manager.rs` | File operations with path traversal protection |
| **File Tunnel** | `file_tunnel.rs` | HTTP-based file operations proxied through the panel |
| **Storage Manager** | `storage_manager.rs` | Disk image creation, mounting, resizing |
| **WebSocket Handler** | `websocket_handler.rs` | Communication with the panel backend |
| **System Setup** | `system_setup.rs` | Dependency detection and installation |

## System Requirements

| Requirement | Minimum | Recommended |
|---|---|---|
| **OS** | Linux (x86_64, aarch64) | Ubuntu 22.04+, Debian 12+ |
| **containerd** | 1.6+ | Latest stable (with CRI plugin) |
| **OCI Runtime** | runc or crun | runc latest |
| **CPU** | 2 cores | 4+ cores (for game servers) |
| **RAM** | 2 GB | 4+ GB (varies by game servers) |
| **Disk** | 10 GB (agent + data) | SSD with 50+ GB |
| **Network** | Outbound to panel WebSocket endpoint | Low-latency connection to panel |
| **Privileges** | Root or containerd socket access | Root (for network/firewall management) |

### Auto-Installed Dependencies

On first run, the agent automatically detects and installs:

- **containerd** — Container runtime
- **runc** (or crun) — OCI runtime for containers
- **iproute2** — Network interface management
- **iptables** — Port forwarding and NAT rules
- **CNI plugins** (v1.9.0) — bridge, host-local, portmap, macvlan

The agent supports these package managers: `apk` (Alpine), `apt` (Debian/Ubuntu), `yum`/`dnf` (RHEL/Fedora), `pacman` (Arch), `zypper` (openSUSE).

---

## Installation

### One-Click Deployment (from Panel)

The recommended method for production deployments:

1. In the panel, navigate to **Admin** → **Nodes**
2. Select your node and go to the **Agent** tab
3. Click **Generate Deployment Token** — this creates:
   - A one-time deployment URL (valid for 24 hours)
   - An agent API key
4. On the node machine, run:
   ```bash
   curl -fsSL https://your-panel.com/api/deploy/YOUR_TOKEN | sudo bash
   ```

The script installs the agent binary, generates `config.toml`, creates a systemd service, and starts the agent.

### Manual Installation

1. **Download or build** the agent binary (see [Building from Source](#building-from-source))

2. **Copy the binary:**
   ```bash
   sudo cp catalyst-agent /usr/local/bin/catalyst-agent
   sudo chmod +x /usr/local/bin/catalyst-agent
   ```

3. **Create the configuration directory:**
   ```bash
   sudo mkdir -p /etc/catalyst-agent /var/lib/catalyst
   ```

4. **Create `config.toml`:**
   ```toml
   [server]
   backend_url = "wss://panel.example.com/ws"
   node_id = "your-node-uuid"
   api_key = "your-api-key"
   hostname = "node-1"
   data_dir = "/var/lib/catalyst"
   max_connections = 100

   [containerd]
   socket_path = "/run/containerd/containerd.sock"
   namespace = "catalyst"

   [networking]
   # Networks auto-detected if omitted

   [logging]
   level = "info"
   format = "json"
   ```

5. **Run the agent:**
   ```bash
   sudo /usr/local/bin/catalyst-agent /etc/catalyst-agent/config.toml
   ```

### Docker Installation

The agent can also run in a container (useful for testing):

```bash
docker build -t catalyst-agent catalyst-agent/
docker run -d \
  --name catalyst-agent \
  --privileged \
  -v /run/containerd/containerd.sock:/run/containerd/containerd.sock \
  -v /var/lib/catalyst:/var/lib/catalyst \
  -v /etc/cni/net.d:/etc/cni/net.d \
  -v /opt/cni/bin:/opt/cni/bin \
  catalyst-agent
```

> **Note:** Running the agent in Docker is not recommended for production. It requires `--privileged` access for containerd, networking, and firewall management. Use the native binary for production deployments.

### Building from Source

Requires the Rust toolchain (see `rust-toolchain.toml`):

```bash
cd catalyst-agent
cargo build --release
# Binary at: target/release/catalyst-agent
```

---

## Configuration Reference

The agent reads configuration from a TOML file (default: `./config.toml` or `/opt/catalyst-agent/config.toml`). Configuration can also be provided via environment variables when no config file exists.

### server Section

| Field | Type | Default | Description |
|---|---|---|---|
| `backend_url` | string | `ws://localhost:3000/ws` | WebSocket URL of the panel backend. Use `wss://` for production with TLS. |
| `node_id` | string | *(required)* | UUID of the node (from the panel database) |
| `api_key` | string | *(required)* | API key for authenticating with the panel (generated in the panel UI) |
| `hostname` | string | System hostname | Hostname reported to the panel |
| `data_dir` | path | `/var/lib/catalyst` | Base directory for server data, disk images, and firewall state |
| `max_connections` | number | `100` | Maximum concurrent WebSocket connections |

### containerd Section

| Field | Type | Default | Description |
|---|---|---|---|
| `socket_path` | path | `/run/containerd/containerd.sock` | Path to the containerd gRPC socket |
| `namespace` | string | `catalyst` | containerd namespace for Catalyst containers |

### networking Section

| Field | Type | Default | Description |
|---|---|---|---|
| `networks` | array | `[]` | List of CNI network configurations (see below) |
| `dns_servers` | array | `["1.1.1.1", "8.8.8.8"]` | DNS servers for containers |

#### Network Entry Fields

Each entry in `[[networking.networks]]`:

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Network name (1–63 chars, alphanumeric, `-`, `_`, `.`) |
| `interface` | string | No | Parent network interface (auto-detected if omitted) |
| `cidr` | string | No | CIDR range for IP allocation (auto-detected from interface if omitted) |
| `gateway` | string | No | Gateway IP (auto-detected if omitted) |
| `range_start` | string | No | First usable IP in range (auto-calculated from CIDR) |
| `range_end` | string | No | Last usable IP in range (auto-calculated from CIDR) |

**Example — Multiple networks:**

```toml
[[networking.networks]]
name = "mc-lan-static"
interface = "eth0"
cidr = "10.5.5.0/24"
gateway = "10.5.5.1"
range_start = "10.5.5.50"
range_end = "10.5.5.200"

[[networking.networks]]
name = "mc-public"
interface = "eth0"
cidr = "98.168.52.0/24"
gateway = "98.168.52.1"
range_start = "98.168.52.50"
range_end = "98.168.52.200"
```

### logging Section

| Field | Type | Default | Description |
|---|---|---|---|
| `level` | string | `info` | Log level: `trace`, `debug`, `info`, `warn`, `error` |
| `format` | string | `json` | Log format: `json` (structured) or `text` (human-readable) |

### Environment Variables

When no config file is found, the agent falls back to environment variables:

| Variable | Default | Description |
|---|---|---|
| `BACKEND_URL` | `ws://localhost:3000/ws` | Panel WebSocket URL |
| `NODE_ID` | *(required)* | Node UUID |
| `NODE_API_KEY` | *(required)* | API key for authentication |
| `DATA_DIR` | `/var/lib/catalyst` | Server data directory |
| `CONTAINERD_SOCKET` | `/run/containerd/containerd.sock` | containerd socket path |
| `CONTAINERD_NAMESPACE` | `catalyst` | containerd namespace |
| `LOG_LEVEL` | `info` | Log verbosity |

---

## Networking

The agent supports three networking modes for game server containers. The mode is set per-server when creating a server in the panel.

### macvlan (Recommended for Game Servers)

macvlan gives each container its own MAC address and IP address on the physical network, making it directly accessible — essential for games that need a dedicated IP.

- Each server gets a unique IP from the configured IP range
- Containers appear as separate devices on the network
- Port conflicts are avoided since each container has its own IP
- Supports multiple network configurations (e.g., internal + public ranges)

**CNI configuration file:** `/etc/cni/net.d/{network-name}.conflist`

```json
{
  "cniVersion": "1.0.0",
  "name": "mc-lan-static",
  "plugins": [
    {
      "type": "macvlan",
      "master": "eth0",
      "mode": "bridge",
      "ipam": {
        "type": "host-local",
        "ranges": [[
          {
            "subnet": "10.5.5.0/24",
            "rangeStart": "10.5.5.50",
            "rangeEnd": "10.5.5.200",
            "gateway": "10.5.5.1"
          }
        ]],
        "routes": [{ "dst": "0.0.0.0/0" }]
      }
    }
  ]
}
```

### Host Networking

In host mode, the container shares the host's network namespace. The server binds directly to the node's IP address.

- No IP allocation needed
- Set via `CATALYST_NETWORK_IP` environment variable (defaults to node's public address)
- Best for when you need the server to use the node's IP directly
- Port conflicts must be managed manually

### Bridge Networking

Standard CNI bridge networking with port forwarding.

- Containers get an internal IP (e.g., 10.0.0.x)
- Port forwarding maps host ports to container ports
- The agent manages iptables rules for port forwarding
- Simple setup but all containers share the host's IP

### Automatic Network Detection

If no networks are configured in `config.toml`, the agent automatically:

1. Detects the primary network interface (from default route)
2. Detects the interface CIDR
3. Detects the default gateway
4. Calculates usable IP range from the CIDR
5. Creates a default `mc-lan-static` network

You can also use the panel's **Network Manager** to create, update, and delete CNI networks on the agent at runtime.

---

## Firewall Management

The agent automatically manages firewall rules for game server ports. When a server starts, the agent opens the necessary ports; when it stops, the rules are removed.

### Supported Firewall Types

The agent detects and uses the first available firewall:

| Firewall | Detection | Notes |
|---|---|---|
| **UFW** | `ufw` command | Most common on Ubuntu |
| **iptables** | `iptables` command | Universal fallback |
| **firewalld** | `firewall-cmd` command | RHEL/CentOS/Fedora |
| **None** | No firewall found | All ports are open (not recommended) |

### Rule Tracking and Persistence

Firewall rules are tracked in `/var/lib/catalyst/firewall-rules.jsonl`:

```json
{"port":25565,"server_id":"srv-abc","container_ip":"10.42.0.5","proto":"tcp"}
```

This persistence ensures:
- Rules survive agent restarts
- Rules can be cleaned up even if the agent was killed
- On shutdown, all tracked rules are automatically removed

### Manual Firewall Configuration

If the agent's automatic firewall management conflicts with your existing firewall setup, you can:

1. **Disable automatic management** — The agent respects existing rules and won't duplicate them
2. **Pre-configure rules** — Add your own rules before the agent starts
3. **Use a specific firewall** — Set up your preferred firewall; the agent detects it automatically

---

## Storage Management

The agent manages server storage using **disk images** (sparse files) that provide per-server disk quotas.

### Disk Images

- **Location:** `/var/lib/catalyst/images/{server-uuid}.img`
- **Format:** ext4 filesystem in a sparse file
- **Mount point:** `/var/lib/catalyst/{server-uuid}/`

When a server is created:
1. The agent creates a sparse disk image of the requested size
2. Formats it as ext4
3. Mounts it at the server's data directory

### Resizing Storage

The agent supports online and offline resizing:

- **Growing** — Can be done while the server is running (online)
- **Shrinking** — Requires the server to be stopped first (offline)

Storage can be resized from the panel's server settings.

---

## File Management

### File Tunnel

The agent provides file operations via an HTTP-based **file tunnel** that proxies through the panel backend. This allows the panel to manage files on nodes without direct node access.

**Architecture:**
```
Panel Frontend → Panel Backend → Agent (HTTP file tunnel)
```

**Supported operations:**

| Operation | Description |
|---|---|
| `list` | List directory contents |
| `read` | Read file content |
| `write` | Write/create file |
| `delete` | Delete file or directory |
| `mkdir` | Create directory |
| `rename` | Rename file or directory |
| `compress` | Create tar.gz or zip archive |
| `decompress` | Extract tar.gz or zip archive |
| `stat` | Get file metadata (size, permissions, modified time) |

### Path Security

All file operations are protected against path traversal:

- Paths are validated to stay within the server's data directory
- `..` components are rejected
- Symbolic links that escape the data directory are blocked
- Server IDs cannot contain path separators

### File Size Limits

| Limit | Value |
|---|---|
| Maximum individual file size | 500 MB |
| Maximum file tunnel request body | 100 MB |
| Maximum backup upload size | 10 GB |
| Backup upload inactivity timeout | 10 minutes |

---

## Container Lifecycle

### Creating Containers

When a server is deployed, the agent:

1. **Pulls the container image** from the configured registry
2. **Creates a containerd snapshot** for the server filesystem
3. **Sets up networking** (macvlan, bridge, or host)
4. **Configures resource limits** (CPU, memory)
5. **Creates firewall rules** for server ports
6. **Mounts storage** (disk image at the server data directory)

### Starting and Stopping

**Start sequence:**
1. Create the container task in containerd
2. Start the task
3. Begin streaming console output
4. Report running status to the panel

**Stop sequence (graceful):**
1. Send the configured stop command to the container's stdin (e.g., `stop` for Minecraft)
2. Wait for the process to exit gracefully
3. If it doesn't exit within the timeout, send `SIGTERM`
4. As a last resort, send `SIGKILL`
5. Clean up firewall rules and port forwarding

**Stop policy** is configured per template:
- `stopCommand` — Command sent to stdin for graceful shutdown
- `sendSignalTo` — Signal sent after timeout: `SIGTERM` or `SIGINT`

### Console I/O

The agent provides real-time console streaming via WebSocket:

- **Output** — Container stdout/stderr is streamed to the panel
- **Input** — Commands from the panel are forwarded to the container's stdin
- **Console FIFO** — Uses a named pipe at `/tmp/catalyst-console/{container-id}` for reliable I/O

### Log Rotation

Container logs are automatically rotated to prevent disk exhaustion:

| Setting | Value |
|---|---|
| Maximum log file size | 50 MB |
| Number of backup files | 3 |
| Log location | Managed by containerd |

### Resource Monitoring

The agent tracks real-time resource usage per container:

- **CPU** — Percentage calculated from cgroup CPU usage with time-based sampling
- **Memory** — From cgroup memory accounting
- **Disk I/O** — Read/write bytes from cgroup blkio
- **Network I/O** — RX/TX bytes from `/proc/{pid}/net/dev`
- **Container count** — Total running containers on the node

Health reports are sent to the panel every **30 seconds**.

---

## WebSocket Communication Protocol

### Connection

The agent connects to the panel at the configured `backend_url` (e.g., `wss://panel.example.com/ws`).

**Authentication:** The agent authenticates using the `api_key` configured in `config.toml`, sent as a header (`x-node-api-key` or `Authorization: Bearer`).

**Reconnection:** The agent automatically reconnects with exponential backoff if the connection drops.

### Health Reports

Sent every 30 seconds:

```json
{
  "type": "health_report",
  "nodeId": "node-uuid",
  "health": {
    "cpuPercent": 45.2,
    "memoryUsageMb": 8192,
    "memoryTotalMb": 32768,
    "diskUsageMb": 51200,
    "diskTotalMb": 102400,
    "containerCount": 5,
    "networkRxBytes": 1048576,
    "networkTxBytes": 524288
  }
}
```

### Resource Stats

Per-server resource statistics are collected and reported alongside health reports.

### Server Commands

The agent receives commands from the panel to manage server containers:

| Command | Action |
|---|---|
| `start` | Create and start a server container |
| `stop` | Gracefully stop a server |
| `kill` | Force-stop with SIGKILL |
| `restart` | Stop then start |
| `install` | Run the template's install script |
| `exec` | Execute a command inside a running container |
| `console_input` | Send input to the server's stdin |
| `backup` | Create a backup archive |
| `restore` | Restore from a backup |

---

## System Setup (Automatic)

On first run, the agent automatically sets up the required system dependencies. This process is idempotent — it skips already-installed components.

### Dependency Detection and Installation

The agent detects and installs these dependencies in order:

1. **Package manager** — Detects `apk`, `apt`, `yum`, `dnf`, `pacman`, or `zypper`
2. **containerd** — Container runtime (if not found)
3. **OCI runtime** — `runc` or `crun` (if not found)
4. **containerd service** — Ensures the socket is available and accessible
5. **iproute2** — Network interface management tools
6. **iptables** — Firewall and NAT tools
7. **CNI plugins** — bridge, host-local, portmap, macvlan (v1.9.0)

### CNI Plugin Installation

CNI plugins are installed from the official GitHub releases:

1. Downloads `cni-plugins-linux-{arch}-v1.9.0.tgz`
2. Verifies SHA256 checksum (pinned for amd64/arm64)
3. Extracts to `/opt/cni/bin/`
4. Falls back to package manager installation if download fails

Required CNI plugins: `bridge`, `host-local`, `portmap`, `macvlan`.

### containerd Socket Access

For non-root users, the agent configures socket access:

1. Creates a `containerd` system group
2. Adds the current user to the group
3. Creates a systemd override to set socket permissions to `0660`
4. Falls back to `chmod 666` as a last resort

---

## Logging

The agent uses structured logging via the `tracing` crate.

**Log levels:**

| Level | Use |
|---|---|
| `trace` | Very verbose — every internal operation |
| `debug` | Debug information — container operations, network config |
| `info` | Normal operations — startup, health reports, container events |
| `warn` | Non-critical issues — failed commands, fallbacks |
| `error` | Critical failures — connection errors, setup failures |

**JSON format example:**
```json
{
  "timestamp": "2025-01-15T10:30:00.000Z",
  "level": "INFO",
  "message": "Container started",
  "span": {"name": "runtime_manager"},
  "container_id": "abc123",
  "server_uuid": "srv-xyz"
}
```

**Text format example:**
```
2025-01-15T10:30:00.000Z  INFO catalyst_agent::runtime_manager: Container started container_id=abc123 server_uuid=srv-xyz
```

---

## Running as a systemd Service

Create a systemd service file for the agent:

```bash
sudo tee /etc/systemd/system/catalyst-agent.service << 'EOF'
[Unit]
Description=Catalyst Agent - Game Server Container Management
After=network-online.target containerd.service
Requires=containerd.service
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/catalyst-agent /etc/catalyst-agent/config.toml
Restart=always
RestartSec=5s
TimeoutStartSec=120
TimeoutStopSec=30
LimitNOFILE=1048576
LimitNPROC=1048576

# Security settings
NoNewPrivileges=false
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now catalyst-agent
```

**Service management:**

```bash
# Check status
sudo systemctl status catalyst-agent

# View logs
sudo journalctl -u catalyst-agent -f

# Restart
sudo systemctl restart catalyst-agent

# Stop
sudo systemctl stop catalyst-agent
```

---

## Updating the Agent

### Binary Update

```bash
# Stop the agent
sudo systemctl stop catalyst-agent

# Replace the binary
sudo cp catalyst-agent-new /usr/local/bin/catalyst-agent
sudo chmod +x /usr/local/bin/catalyst-agent

# Start the agent
sudo systemctl start catalyst-agent
```

### Building from Source

```bash
cd catalyst-agent
git pull origin main
cargo build --release
sudo systemctl stop catalyst-agent
sudo cp target/release/catalyst-agent /usr/local/bin/catalyst-agent
sudo systemctl start catalyst-agent
```

### Zero-Downtime Update

The agent is designed to handle updates gracefully:

1. On startup, it cleans up stale CNI leases from containers that no longer exist
2. Firewall rules are reloaded from the persistent state file
3. Existing containers continue running during the update
4. The agent reconnects to the panel and resumes health reporting

---

## Troubleshooting

### Agent Won't Connect to Panel

**Symptoms:** Node shows as offline in the panel.

**Check:**
```bash
# Verify the WebSocket URL is correct
# Use wss:// for production (not ws://)
grep backend_url /etc/catalyst-agent/config.toml

# Test connectivity
curl -v https://panel.example.com/health

# Check agent logs
sudo journalctl -u catalyst-agent -f --no-pager
```

**Common causes:**
- Wrong `backend_url` (must include `/ws` path)
- API key mismatch (regenerate from the panel)
- Firewall blocking outbound WebSocket connections
- TLS certificate issues (ensure CA certificates are installed)

### containerd Socket Not Found

**Symptoms:** Agent fails to start with "containerd socket is not available".

**Fix:**
```bash
# Check if containerd is running
sudo systemctl status containerd

# Check socket exists
ls -la /run/containerd/containerd.sock

# Start containerd
sudo systemctl start containerd

# If using a custom socket path, update config.toml
```

### Permission Denied on containerd Socket

**Symptoms:** "permission denied" when accessing the socket.

**Fix:**
```bash
# Run as root (recommended)
sudo /usr/local/bin/catalyst-agent /etc/catalyst-agent/config.toml

# Or configure socket access for non-root users
sudo usermod -aG containerd $USER
sudo systemctl restart containerd
# Log out and back in for group changes to take effect
```

### CNI Network Not Working

**Symptoms:** Containers fail to start with CNI errors.

**Check:**
```bash
# Verify CNI config exists
ls -la /etc/cni/net.d/

# Check CNI plugins are installed
ls -la /opt/cni/bin/

# Verify network configuration
cat /etc/cni/net.d/mc-lan-static.conflist

# Test network interface
ip addr show eth0
ip route show default
```

**Fix:** Delete the CNI config and let the agent regenerate it:
```bash
sudo rm /etc/cni/net.d/*.conflist
sudo systemctl restart catalyst-agent
```

### Port Conflicts

**Symptoms:** Server fails to start because a port is already in use.

**Check:**
```bash
# Check what's using a port
sudo ss -tlnp | grep :25565

# Check firewall rules
sudo iptables -L -n -t nat
```

### Out of Disk Space

**Symptoms:** Servers fail to start, containers crash.

**Check:**
```bash
# Check disk usage
df -h /var/lib/catalyst

# Check disk image sizes
ls -lh /var/lib/catalyst/images/

# Check individual server sizes
du -sh /var/lib/catalyst/*/
```

### High CPU Usage

**Symptoms:** Node reports high CPU in the panel.

**Check:**
```bash
# Check running containers
sudo ctr -n catalyst task ls

# Check system processes
top

# Check container resource usage
sudo ctr -n catalyst tasks metrics
```

### Firewall Rules Not Being Cleaned Up

**Symptoms:** Ports remain open after servers are stopped.

**Check:**
```bash
# View tracked rules
cat /var/lib/catalyst/firewall-rules.jsonl

# Check current firewall rules
sudo ufw status
# or
sudo iptables -L -n
```

**Fix:** Manually remove all tracked rules by restarting the agent (it cleans up on shutdown).

### Enable Debug Logging

For detailed troubleshooting, temporarily enable debug logging:

```toml
[logging]
level = "debug"
format = "text"
```

Then restart the agent and check logs:
```bash
sudo systemctl restart catalyst-agent
sudo journalctl -u catalyst-agent -f --no-pager | head -100
```
