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
  - [TOML Configuration File](#toml-configuration-file)
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
  - [IPv6 Support](#ipv6-support)
  - [CNI Config Protection](#cni-config-protection)
- [Firewall Management](#firewall-management)
  - [Supported Firewall Types](#supported-firewall-types)
  - [Rule Tracking and Persistence](#rule-tracking-and-persistence)
  - [Container IP Forwarding Rules](#container-ip-forwarding-rules)
  - [Manual Firewall Configuration](#manual-firewall-configuration)
- [Storage Management](#storage-management)
  - [Disk Images](#disk-images)
  - [Resizing Storage](#resizing-storage)
  - [Storage Image Mount Options](#storage-image-mount-options)
  - [Data Migration](#data-migration)
- [File Management](#file-management)
  - [File Tunnel](#file-tunnel)
  - [Path Security](#path-security)
  - [File Size Limits](#file-size-limits)
  - [Install URL (SSRF Protection)](#install-url-ssrf-protection)
- [Container Lifecycle](#container-lifecycle)
  - [Container Image Setup](#container-image-setup)
  - [Starting and Stopping](#starting-and-stopping)
  - [Console I/O](#console-io)
  - [Log Rotation](#log-rotation)
  - [Resource Monitoring](#resource-monitoring)
  - [Auto-Restart on Crash](#auto-restart-on-crash)
  - [TCP Health Checker](#tcp-health-checker)
- [Backup System](#backup-system)
  - [Encrypted Backups](#encrypted-backups)
  - [Backup Upload (Chunked)](#backup-upload-chunked)
  - [Backup Download (Streaming)](#backup-download-streaming)
  - [Restore (Pipe Relay)](#restore-pipe-relay)
- [WebSocket Communication Protocol](#websocket-communication-protocol)
  - [Connection](#connection)
  - [Handshake](#handshake)
  - [Health Reports](#health-reports)
  - [Resource Stats](#resource-stats)
  - [Server State Updates](#server-state-updates)
  - [EULA Required Events](#eula-required-events)
  - [Server Commands (Panel → Agent)](#server-commands-panel--agent)
  - [File Operations (Panel → Agent)](#file-operations-panel--agent)
  - [Backup Commands (Panel → Agent)](#backup-commands-panel--agent)
  - [Configuration Commands (Panel → Agent)](#configuration-commands-panel--agent)
  - [Background Tasks](#background-tasks)
- [System Setup (Automatic)](#system-setup-automatic)
  - [Dependency Detection and Installation](#dependency-detection-and-installation)
  - [CNI Plugin Installation](#cni-plugin-installation)
  - [containerd Socket Access](#containerd-socket-access)
- [Agent Updates](#agent-updates)
- [Logging](#logging)
- [Running as a systemd Service](#running-as-a-systemd-service)
- [Updating the Agent](#updating-the-agent)
- [Deployment Scenarios](#deployment-scenarios)
  - [Single Node (Development)](#single-node-development)
  - [Multi-Node Production](#multi-node-production)
  - [Air-Gapped / Offline Deployment](#air-gapped--offline-deployment)
  - [Headless / Containerized Deployment](#headless--containerized-deployment)
- [Troubleshooting](#troubleshooting)

---

## What Is the Agent?

The Catalyst agent is a lightweight Rust binary that runs on each **node** (physical or virtual machine) in your Catalyst deployment. It is responsible for:

- **Container management** — Creating, starting, stopping, and deleting game server containers using containerd
- **Networking** — Managing macvlan, bridge, and host networks for server containers via CNI plugins
- **File management** — Providing file operations (browse, upload, download, edit, archive) for server data directories via an HTTP file tunnel
- **Console I/O** — Streaming real-time server output and accepting commands via WebSocket
- **Firewall rules** — Automatically opening and closing ports for game servers across UFW, iptables, ipset, and firewalld
- **Storage management** — Managing disk images (sparse ext4 files) for per-server disk quotas with online grow and offline shrink
- **Health monitoring** — Reporting system resource usage (CPU, memory, disk, network) and per-container stats to the panel
- **Backup system** — Creating, downloading, uploading, and restoring encrypted server backups
- **Auto-restart** — Automatically restarting crashed servers with configurable rate limiting
- **TCP health checking** — Probing running game servers to detect unresponsive processes

The agent communicates exclusively with the Catalyst panel backend over **WebSocket** (with an HTTP-based long-polling file tunnel for file operations).

---

## Architecture Overview

```text
┌─────────────────────────────────────────────────────────────────────┐
│                        Node Machine                                  │
│                                                                      │
│  ┌──────────────────┐    WebSocket     ┌──────────────────────────┐ │
│  │   Catalyst Agent  │◄──────────────►│  Catalyst Panel (Backend) │ │
│  │    (Rust)         │    HTTP/WS      └──────────────────────────┘ │
│  │                  │                                                  │
│  │  ┌─────────────┐ │                                                  │
│  │  │ FileTunnel   │ │  HTTP long-poll (4 concurrent pollers)          │
│  │  │ Client       │ │  to {backend}/api/internal/file-tunnel/poll    │
│  │  └─────────────┘ │  Max 50 concurrent file operations             │
│  │                  │                                                  │
│  │  ┌─────────────┐ │                                                  │
│  │  │ Health      │ │  Sends every 5 seconds                        │
│  │  │ Monitor     │ │  (includes CPU, memory, disk, network,        │
│  │  │             │ │   container count, uptime)                    │
│  │  └─────────────┘ │                                                  │
│  │                  │                                                  │
│  │  ┌─────────────┐ │                                                  │
│  │  │ Event       │ │  Subscribes to containerd event stream          │
│  │  │ Monitor     │ │  + 30s periodic state reconciliation            │
│  │  └─────────────┘ │                                                  │
│  │                  │                                                  │
│  │  ┌─────────────┐ │                                                  │
│  │  │ TCP Health  │ │  Probes running game servers every 30s          │
│  │  │ Checker     │ │  Reports healthy/unhealthy state changes        │
│  │  └─────────────┘ │                                                  │
│  └──────┬───────────┘                                                  │
│         │                                                              │
│    ┌────┴─────┐                                                       │
│    │ containerd│  (socket: /run/containerd/containerd.sock)           │
│    └────┬─────┘                                                       │
│         │                                                              │
│    ┌────┴───────────────────────────────────────────┐                 │
│    │  Game Server Containers                         │                 │
│    │  ┌──────────┐ ┌──────────┐ ┌──────────┐       │                 │
│    │  │ Server 1 │ │ Server 2 │ │ Server 3 │       │                 │
│    │  │ (runc)   │ │ (runc)   │ │ (runc)   │       │                 │
│    │  └──────────┘ └──────────┘ └──────────┘       │                 │
│    └────────────────────────────────────────────────┘                 │
│                                                                      │
│  CNI Networks: macvlan / bridge (via /etc/cni/net.d)                 │
│  Data Dir:     /var/lib/catalyst/{server-uuid}/                      │
│  Firewall:     iptables / ufw / firewalld / ipset                    │
│  Log Dir:      /var/log/catalyst/console/{container-id}/             │
│  Metrics:      /var/lib/catalyst/metrics_buffer.jsonl                │
└─────────────────────────────────────────────────────────────────────┘
```

### Agent Components

| Component | Source File | Responsibility |
|---|---|---|
| **Runtime Manager** | `runtime_manager.rs` | Container lifecycle, console I/O, log rotation, resource tracking |
| **Network Manager** | `network_manager.rs` | CNI network creation, deletion, and IPAM management |
| **Firewall Manager** | `firewall_manager.rs` | Automatic firewall rule management for server ports |
| **File Manager** | `file_manager.rs` | File operations with path traversal protection |
| **File Tunnel** | `file_tunnel.rs` | HTTP long-poll client for file operations (12 operations) |
| **Storage Manager** | `storage_manager.rs` | Disk image creation, mounting, online grow, offline shrink |
| **System Setup** | `system_setup.rs` | Dependency detection and installation |
| **Updater** | `updater.rs` | Agent self-update via backend download |
| **WebSocket Handler** | `websocket_handler.rs` | Communication with the panel, server commands, backup handling, auto-restart |

### Background Tasks

The agent runs several background tasks concurrently:

| Task | Interval | Description |
|---|---|---|
| **Health Monitor** | Every 5s | Collects node-level CPU, memory, disk, network, container count, uptime |
| **Resource Stats** | Every 5s | Collects per-server CPU, memory, disk I/O, network I/O, disk usage |
| **Heartbeat** | Every 15s | Sends WebSocket heartbeat message to backend |
| **Log Rotation** | Every 5m | Checks container log files (stdout/stderr) for size >10MB, rotates if needed |
| **State Reconciliation** | Every 30s | Compares actual container states with reported states, sends updates for drift |
| **Event Monitor** | Continuous | Subscribes to containerd event stream for instant exit notifications |
| **TCP Health Checker** | Every 30s | Probes running game server ports, reports healthy/unhealthy state changes |
| **File Tunnel Polling** | Continuous | 4 concurrent long-poll workers waiting for file operation requests |
| **Backup Upload Cleanup** | Every 60s | Removes stale backup upload sessions (after 10 min inactivity) |

---

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

| Dependency | Purpose | Package Manager |
|---|---|---|
| **containerd** | Container runtime | apt, apk, yum/dnf, pacman, zypper |
| **runc / crun** | OCI runtime for containers | apt, apk, yum/dnf, pacman, zypper |
| **iproute2** | Network interface management | apt, apk, yum/dnf, pacman, zypper |
| **iptables** | Port forwarding and NAT rules | apt, apk, yum/dnf, pacman, zypper |
| **curl / tar / gzip** | CNI plugin download tools | apt, apk, yum/dnf, pacman, zypper |
| **CNI plugins** (v1.9.0) | bridge, host-local, portmap, macvlan | apt (containernetworking-plugins), apk (cni-plugins), or downloaded from GitHub with SHA256 verification |

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

The script installs the agent binary, generates `/opt/catalyst-agent/config.toml`, creates a systemd service, and starts the agent.

### Manual Installation

1. **Download or build** the agent binary (see [Building from Source](#building-from-source))

2. **Copy the binary:**
   ```bash
   sudo cp catalyst-agent /usr/local/bin/catalyst-agent
   sudo chmod +x /usr/local/bin/catalyst-agent
   ```

3. **Create the configuration directory:**
   ```bash
   sudo mkdir -p /opt/catalyst-agent /var/lib/catalyst
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
   # Or with explicit --config flag:
   sudo /usr/local/bin/catalyst-agent --config /opt/catalyst-agent/config.toml
   ```

> **Note:** The agent looks for config files in this order:
> 1. `./config.toml` (current directory, with `--config` flag override)
> 2. `/opt/catalyst-agent/config.toml` (system-wide default)
> 3. Environment variables (if no config file exists)

> **Security warning:** If `config.toml` is world-readable, the agent logs a warning on startup. Use `chmod 640 /opt/catalyst-agent/config.toml`.

### Docker Installation

The agent can also run in a container (useful for testing):

```bash
docker build -t catalyst-agent .
docker run -d \
  --name catalyst-agent \
  --privileged \
  -v /run/containerd/containerd.sock:/run/containerd/containerd.sock \
  -v /var/lib/catalyst:/var/lib/catalyst \
  -v /opt/catalyst-agent:/opt/catalyst-agent \
  -v /etc/cni/net.d:/etc/cni/net.d \
  -v /opt/cni/bin:/opt/cni/bin \
  catalyst-agent
```

The Dockerfile uses a two-stage build (Rust builder → Ubuntu 24.04 runtime) and runs as a non-root `catalyst` user (uid 1000). The default CMD passes `--config /opt/catalyst-agent/config.toml`.

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

The agent reads configuration from a TOML file (default: `./config.toml` or `/opt/catalyst-agent/config.toml`). Configuration can also be provided entirely via environment variables when no config file exists. **Environment variables take precedence over the TOML file** — if a config file is found but env vars are set, the env vars override.

### TOML Configuration File

Example configuration:

```toml
[server]
# Backend WebSocket URL (ws:// for development, wss:// for production)
backend_url = "wss://panel.example.com/ws"

# Unique node identifier (UUID from database)
node_id = "your-node-uuid-here"

# Agent API key (required for node authentication)
api_key = "your-api-key-here"

# Hostname of this server
hostname = "node1.example.com"

# Data directory for container volumes
data_dir = "/var/lib/catalyst"

# Maximum number of game servers allowed on this node
max_connections = 100

[containerd]
# Path to containerd socket
socket_path = "/run/containerd/containerd.sock"

# Containerd namespace for Catalyst containers
namespace = "catalyst"

[networking]
# Configure one or more macvlan networks (optional). If omitted, the agent will
# provision a default mc-lan-static network based on the primary interface.
#
# [[networking.networks]]
# name = "mc-lan-static"
# interface = "eth0"
# cidr = "10.5.5.0/24"
# gateway = "10.5.5.1"
# range_start = "10.5.5.50"
# range_end = "10.5.5.200"

[logging]
# Log level: trace, debug, info, warn, error
level = "info"

# Log format: json or text
format = "json"
```

### server Section

| Field | Type | Default | Description |
|---|---|---|---|
| `backend_url` | string | `ws://localhost:3000/ws` | WebSocket URL of the panel backend. Use `wss://` for production with TLS. Non-local `ws://` URLs trigger a security warning unless `CATALYST_ALLOW_INSECURE_WS=1` is set. |
| `node_id` | string | *(required)* | UUID of the node (from the panel database) |
| `api_key` | string | *(required)* | API key for authenticating with the panel (generated in the panel UI). Must not be empty. |
| `hostname` | string | System hostname | Hostname reported to the panel. Auto-detected via `hostname` command if not set. |
| `data_dir` | path | `/var/lib/catalyst` | Base directory for server data, disk images, firewall state, and metrics buffer |
| `max_connections` | number | `100` | Maximum number of game servers allowed on this node. The agent enforces this limit during server creation. |

### containerd Section

| Field | Type | Default | Description |
|---|---|---|---|
| `socket_path` | path | `/run/containerd/containerd.sock` | Path to the containerd gRPC socket |
| `namespace` | string | `catalyst` | containerd namespace for Catalyst containers |

### networking Section

| Field | Type | Default | Description |
|---|---|---|---|
| `networks` | array | `[]` | List of CNI network configurations (see below). Empty array means auto-detect. |
| `dns_servers` | array | `["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111", "2001:4860:4860::8888"]` | DNS servers for containers (includes IPv6 Cloudflare and Google DNS) |

#### Network Entry Fields

Each entry in `[[networking.networks]]`:

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Network name (1–63 chars, alphanumeric, `-`, `_`, `.`) |
| `interface` | string | No | Parent network interface (auto-detected from default route if omitted) |
| `cidr` | string | No | CIDR range for IP allocation (auto-detected from interface if omitted) |
| `gateway` | string | No | Gateway IP (auto-detected from default route if omitted) |
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
| `format` | string | `json` | Log format: `json` (structured with tracing-subscriber) or `text` (human-readable single-line) |

### Environment Variables

When no config file is found, the agent falls back to environment variables:

| Variable | Default | Description |
|---|---|---|
| `BACKEND_URL` | `ws://localhost:3000/ws` | Panel WebSocket URL |
| `NODE_ID` | *(required)* | Node UUID |
| `NODE_API_KEY` | *(required)* | API key for authentication |
| `HOSTNAME` | System hostname | Hostname reported to the panel |
| `DATA_DIR` | `/var/lib/catalyst` | Server data directory |
| `MAX_CONNECTIONS` | `100` | Maximum servers per node |
| `CONTAINERD_SOCKET` | `/run/containerd/containerd.sock` | containerd socket path |
| `CONTAINERD_NAMESPACE` | `catalyst` | containerd namespace |
| `LOG_LEVEL` | `info` | Log verbosity |
| `CATALYST_ALLOW_INSECURE_WS` | *(not set)* | Set to `"1"` to suppress `ws://` security warning (development only) |

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

1. Detects the primary network interface (from default route, or first non-loopback interface)
2. Detects the interface CIDR
3. Detects the default gateway (from `ip route show default`)
4. Calculates usable IP range from the CIDR
5. Creates a default `mc-lan-static` network

You can also use the panel's **Network Manager** to create, update, and delete CNI networks on the agent at runtime.

### IPv6 Support

The agent fully supports IPv6 networking:

- CNI configuration uses `::/0` default routes for IPv6 networks (vs `0.0.0.0/0` for IPv4)
- The CIDR detection and usable range calculation work for IPv6 addresses
- DNS servers include both IPv4 (8.8.8.8, 1.1.1.1) and IPv6 (2001:4860:4860::8888, 2606:4700:4700::1111)
- Firewall rules apply to both `iptables` and `ip6tables` as available

### CNI Config Protection

The agent protects existing CNI configurations from being overwritten when the host network changes:

1. On each startup, it re-detects the network interface, CIDR, and gateway
2. If the existing config differs from the detected network, it **logs a warning and skips overwriting**
3. This prevents breaking running containers during network reconfiguration

To apply new network settings: stop all containers, then restart the agent (or recreate the CNI network from the panel).

---

## Firewall Management

The agent automatically manages firewall rules for game server ports. When a server starts, the agent opens the necessary ports; when it stops, the rules are removed.

### Supported Firewall Types

The agent detects and uses the first available firewall:

| Firewall | Detection | Notes |
|---|---|---|
| **UFW** | `ufw status` contains "active" | Most common on Ubuntu. Uses comment-based rule management (`catalyst-game-server`). |
| **ipset + iptables** | `ipset list` succeeds + `iptables` available | Fastest for large rule sets. Uses a `catalyst_ports` ipset with `bitmap:port` range 1–65535. |
| **firewalld** | `firewall-cmd --state` returns "running" | RHEL/CentOS/Fedora. Uses `--permanent` flag with reload. |
| **iptables / ip6tables** | `iptables -L` succeeds | Universal fallback. Creates individual INPUT + FORWARD rules. |
| **None** | No firewall found | All ports are open (not recommended) |

Firewall detection is cached after the first call.

### Rule Tracking and Persistence

Firewall rules are tracked in `/var/lib/catalyst/firewall-rules.jsonl`:

```json
{"port":25565,"server_id":"srv-abc","container_ip":"10.42.0.5","proto":"tcp"}
```

This persistence ensures:
- Rules survive agent restarts (loaded from disk on startup)
- Rules can be cleaned up even if the agent was killed
- On shutdown, all tracked rules are automatically removed

Each firewall type uses a different removal strategy:
- **UFW**: Searches numbered rules by comment (`catalyst-game-server`), deletes from highest number to lowest
- **ipset**: Removes port from `catalyst_ports` set with `-exist` flag
- **firewalld**: Uses `--permanent --remove-port` with reload
- **iptables**: Parses rule numbers by comment, deletes from highest to lowest

### Container IP Forwarding Rules

For iptables/ipset firewalls, the agent also manages FORWARD chain rules for container IPs:

- When a server starts, the agent adds a FORWARD ACCEPT rule for the container's IP (both incoming and outgoing)
- When a server stops, the rule is removed
- UFW and firewalld handle forwarding internally — no explicit FORWARD rules needed

### Manual Firewall Configuration

If the agent's automatic firewall management conflicts with your existing firewall setup, you can:

1. **Disable automatic management** — The agent respects existing rules and won't duplicate them
2. **Pre-configure rules** — Add your own rules before the agent starts
3. **Use a specific firewall** — Set up your preferred firewall; the agent detects it automatically

---

## Storage Management

The agent manages server storage using **disk images** (sparse ext4 files) that provide per-server disk quotas.

### Disk Images

- **Location:** `/var/lib/catalyst/images/{server-uuid}.img`
- **Format:** ext4 filesystem in a sparse file
- **Mount point:** `/var/lib/catalyst/{server-uuid}/`
- **Mount options:** `loop,exec,nodev,nosuid` (exec is required for game binaries)

When a server is created:
1. The agent creates a sparse disk image of the requested size (via `fallocate`)
2. Formats it as ext4 (via `mkfs.ext4`)
3. Mounts it at the server's data directory
4. If data already exists at the data directory, it uses `rsync` to migrate it to the image

### Resizing Storage

The agent supports online and offline resizing:

- **Growing** — Can be done while the server is running (online). Uses `fallocate` + `resize2fs` on the mount point
- **Shrinking** — Requires the server to be stopped first (offline). Unmounts, runs `e2fsck -f`, then `resize2fs <size>M`, then `fallocate`, then remounts
- **Shrink recovery** — If shrink fails, the agent automatically attempts to remount the existing image to prevent data loss

### Storage Image Mount Options

The storage image is mounted with these security options:
- `loop` — Loopback device for the disk image
- `exec` — Allows execution of binaries (required for game servers)
- `nodev` — Prevents device files on the mounted filesystem
- `nosuid` — Prevents setuid/setgid bits from taking effect

The agent also handles `noexec` remount recovery: if an older mount has `noexec` (from before a fix), it automatically remounts with `exec`.

### Data Migration

If data already exists at the server's data directory when a disk image is created, the agent:
1. Creates a temporary migration directory
2. Mounts the new image to the migration directory
3. Uses `rsync -a` to copy data from the old location to the new image
4. Clears the old directory and removes the migration directory

This supports seamless upgrades from non-image-based deployments.

---

## File Management

### File Tunnel

The agent provides file operations via an HTTP-based **file tunnel** that uses long-polling to receive operation requests from the panel. This allows the panel to manage files on nodes without direct node access.

**Architecture:**
```
Panel Frontend → Panel Backend → Agent (File Tunnel HTTP Long-Poll)
```

The File Tunnel Client runs `POLL_CONCURRENCY` (4) concurrent long-poll workers, each polling `/api/internal/file-tunnel/poll` with a 35-second timeout. Results are processed concurrently, limited to `MAX_CONCURRENT_REQUESTS` (50) simultaneous operations.

**Supported operations:**

| Operation | Description |
|---|---|
| `list` | List directory contents (name, size, isDirectory, type, modified, mode) |
| `read` | Read file content (streamed as octet-stream) |
| `write` | Write/create file (content from request JSON) |
| `delete` | Delete file or directory |
| `mkdir` / `create` | Create directory or file |
| `rename` | Rename file or directory |
| `permissions` | Set file permissions (octal mode) |
| `compress` | Create tar.gz or zip archive from paths |
| `decompress` | Extract tar.gz or zip archive to targetPath |
| `archive-contents` | Browse archive contents without extracting |
| `upload` | Stream file from backend URL to target path |
| `install-url` | Download from external URL with SSRF protections |

### Path Security

All file operations are protected against path traversal:
- Paths are validated to stay within the server's data directory
- `..` components are rejected
- Symbolic links that escape the data directory are blocked
- Server IDs cannot contain path separators (validated as single path segments, max 128 chars)

### File Size Limits

| Limit | Value |
|---|---|
| Maximum individual file size | 500 MB |
| Maximum file tunnel request body | 100 MB |
| Maximum backup upload size | 10 GB |
| Backup upload inactivity timeout | 10 minutes |
| Maximum install URL download | 100 MB |

### Install URL (SSRF Protection)

The `install-url` file tunnel operation allows downloading files from external URLs to a server's data directory, with comprehensive SSRF (Server-Side Request Forgery) protection:

**SSRF protections:**
- Only `http` and `https` schemes allowed
- No embedded credentials in URLs (username/password)
- Resolves DNS to IPs and blocks private, loopback, link-local, multicast, unspecified, broadcast, CGNAT (100.64.0.0/10) ranges
- For IPv6: blocks loopback, unspecified, multicast, link-local, unique-local, and deprecated site-local (fec0::/10)
- Redirects are followed up to 10 times
- Each redirect URL is validated independently

**Download limits:**
- Hard 100 MB cap (checked via Content-Length header and stream size)
- 5-minute timeout
- 100 MB max file size

**Usage:**
```json
{
  "operation": "install-url",
  "serverUuid": "srv-abc123",
  "path": "/path/to/destination/file.jar",
  "data": {
    "url": "https://example.com/file.jar"
  }
}
```

---

## Container Lifecycle

### Container Image Setup

Server containers are created with these settings:

| Setting | Value |
|---|---|
| **Runtime** | `io.containerd.runc.v2` |
| **Namespace** | `catalyst` |
| **Data mount** | `/data` (mounted from disk image) |
| **Container user** | uid 1000:gid 1000 |
| **Container name** | `server-{serverId}` |
| **Console log dir** | `/var/log/catalyst/console/{container-id}/` |

### Starting and Stopping

**Resource limits per server:**

| Resource | Configured via | Description |
|---|---|---|
| **Memory** | `allocatedMemoryMb` | Container memory limit |
| **CPU** | `allocatedCpuCores` | CPU cores (fractional supported) |
| **Swap** | `allocatedSwapMb` | Swap space (0 = no swap) |
| **I/O Weight** | `ioWeight` | Block I/O priority (default: 500) |

**Port bindings:** Containers can have multiple port bindings defined per-server. The `primaryPort` is used for the game server's main connection.

**Server start sequence (`start_server_with_details`):**
1. Enforce max servers per node (`max_connections`)
2. Validate template and environment
3. Mount disk image (or create if missing, with migration if data exists)
4. Create server directory, set ownership to uid 1000:gid 1000
5. **Proton/SteamCMD detection:** If image name contains "proton" or "steamcmd", automatically set `STEAM_COMPAT_DATA_PATH` and `STEAM_COMPAT_CLIENT_INSTALL_PATH` environment variables, and pre-create compatdata/Steam directories on host
6. Replace template variables (`{{VARIABLE}}`) in startup command
7. Sync port-related env vars (`SERVER_PORT`, `GAME_PORT`) with primary port
8. Calculate `MEMORY_XMS` (default 50% of allocated MEMORY, configurable via `MEMORY_XMS_PERCENT`)
9. Normalize bash arithmetic syntax for `/bin/sh` compatibility
10. Resolve port bindings (container port → host port mapping)
11. Clean up any existing containers for this server
12. Create container with resource limits, network, mount, and port bindings
13. Start container, spawn log stream and exit monitor

**Stop sequence (graceful):**
1. Send stop command to container stdin (e.g., `stop` for Minecraft, configurable via template's `stopCommand`)
2. Wait up to 20 seconds for graceful shutdown
3. If not stopped, send configurable signal (default `SIGTERM`, configurable via template's `sendSignalTo`) with 30-second timeout
4. If still running, force `SIGKILL`
5. Remove the container
6. Clean up auto-restart state, port tracking, and health state

**Kill sequence:**
1. Stop the exit monitor
2. Force `SIGKILL` via `force_kill_container`
3. Always attempt to remove the container
4. Report state as `"crashed"` with exit code 137 (128 + 9/SIGKILL)

**Other server operations:**

| Operation | Description |
|---|---|
| `start_server` | Start existing container (from WebSocket handler) |
| `stop_server` | Graceful stop with configurable stop command and signal |
| `kill_server` | Force kill with SIGKILL, exit code 137 |
| `install_server` | Run template install script in temporary container, with SteamCMD retry support |
| `reinstall_server` | Stop + wipe data directory + run install script |
| `rebuild_server` | Stop + remove container only (data preserved) + start fresh |
| `delete_server` | Stop + remove containers + cleanup firewall rules + remove data directory |

### Console I/O

The agent provides real-time console streaming via WebSocket:

- **Output** — Container stdout/stderr is streamed to the panel from files at `/var/log/catalyst/console/{container-id}/{stdout,stderr}`
- **Input** — Commands from the panel are forwarded to the container's stdin via containerd exec
- **Console FIFO** — Uses a named pipe at `/tmp/catalyst-console/{container-id}` for reliable I/O
- **Line splitting** — Handles `\n` (Unix), `\r\n` (Windows), and `\r` (Paper/Minecraft overwrites) — `\r` emulates terminal behavior to prevent progress lines from concatenating
- **Batching** — Console output is batched up to `MAX_CONSOLE_BATCH_BYTES` (32 KB) before sending
- **Polling** — Log files are read every 50ms when data is available, 200ms when idle
- **Trailing line flush** — When a container stops, trailing partial lines are flushed before closing the stream

**Console stream management:**
- Each server gets a unique stream key: `{serverId}:{containerId}`
- Streams are deduplicated (running only one per server)
- On agent reconnection, all running containers' log streams are automatically restarted
- When transitioning from installer to game server container, existing streams are stopped first

### Log Rotation

Container logs are automatically rotated to prevent disk exhaustion:

- **Check interval:** Every 5 minutes (via periodic task)
- **Max log file size:** 10 MB per file (`stdout` or `stderr`)
- **Backup count:** 2 backup files (`stdout.1`, `stdout.2`)
- **Rotation strategy:** `stdout` → `stdout.1` → `stdout.2` (oldest dropped)
- **Log location:** `/var/log/catalyst/console/{container-id}/`

### Resource Monitoring

The agent tracks real-time resource usage per container and per-node:

**Node-level health report (every 5 seconds):**

| Metric | Source | Description |
|---|---|---|
| `cpuPercent` | cgroup CPU usage with time-based sampling | CPU percentage across all cores (can exceed 100% on multi-core) |
| `memoryUsageMb` | cgroup memory accounting | Current memory usage in MB |
| `memoryTotalMb` | cgroup memory accounting | Total memory in MB |
| `diskUsageMb` | Filesystem usage of `/var/lib/catalyst` | Data directory usage in MB |
| `diskTotalMb` | Filesystem total | Data directory total in MB |
| `containerCount` | containerd container list | Number of running containers |
| `uptimeSeconds` | System uptime | Seconds since node boot |
| `networkRxBytes` | `/proc/{pid}/net/dev` | Total network RX bytes |
| `networkTxBytes` | `/proc/{pid}/net/dev` | Total network TX bytes |

**Per-server resource stats (every 5 seconds):**

| Metric | Source | Description |
|---|---|---|
| `cpuPercent` | cgroup CPU usage sampling | CPU percentage (multi-core aware) |
| `memoryUsageMb` | cgroup memory accounting | Current memory usage in MB |
| `diskIoMb` | cgroup v2 `io.stat` (rbytes + wbytes) | Disk I/O in MB |
| `networkRxBytes` | `/proc/{pid}/net/dev` | Network RX bytes for container |
| `networkTxBytes` | `/proc/{pid}/net/dev` | Network TX bytes for container |
| `diskUsageMb` | Filesystem stats | Disk usage for server data dir |
| `diskTotalMb` | Filesystem total | Disk total for server data dir |

**Metrics buffering:** When the WebSocket connection is down, resource stats are buffered to `/var/lib/catalyst/metrics_buffer.jsonl` (max 100 MB). On reconnection, buffered metrics are flushed in batches of 500.

### Auto-Restart on Crash

When a server container crashes, the agent can automatically restart it with configurable limits:

**Auto-restart configuration (per server, set via WebSocket `start_server` message):**

```json
{
  "autoRestart": {
    "enabled": true,
    "delay": 10,
    "maxRestarts": 5,
    "windowSecs": 60
  }
}
```

| Field | Default | Description |
|---|---|---|
| `enabled` | `false` | Whether auto-restart is enabled |
| `delay` | `10` seconds | Delay before attempting restart |
| `maxRestarts` | `5` | Maximum restart attempts within the time window |
| `windowSecs` | `60` | Time window in seconds for counting restart attempts |

**Behavior:**
- On container exit, the agent checks if auto-restart is enabled
- If enabled, it records the restart timestamp and checks against the window
- If under the limit, waits `delay` seconds then restarts using the stored start message
- If the limit is reached, logs `"Auto-restart skipped: rate limit reached"` and reports `"crashed"` state
- If auto-restart fails, it still reports `"crashed"` state
- On intentional stop, auto-restart state is cleared

**EULA handling:** If a Minecraft EULA is not accepted, the server exits but auto-restart is **blocked** — the agent sends an `eula_required` event and waits for user acceptance via the frontend.

### TCP Health Checker

The agent runs a TCP health checker for all running game servers:

- **Interval:** Every 30 seconds
- **Probes:** Attempts TCP connection to each server's primary port on its container IP
- **Timeout:** 3 seconds per probe
- **State change only:** Reports `healthy` or `unhealthy` only when the state changes (avoids noise)
- **Reports:** Sends server state update with reason `"Health check passed"` or `"Health check failed"`
- **Container check:** Skips probes for containers that are no longer running

---

## Backup System

The agent supports creating, downloading, uploading, and restoring server backups with encryption and chunked transfer.

### Encrypted Backups

Backups are encrypted using **AES-256-GCM**:

- **Encryption:** AES-256-GCM with 32-byte key
- **Nonce:** 96-bit random nonce per encryption
- **Format:** `CATALYST_ENC_V1:` (18 bytes magic) + nonce (12 bytes) + ciphertext
- **Verification:** Magic header checked before decryption; authentication tag verified by GCM

### Backup Upload (Chunked)

Backup uploads support two formats:

1. **JSON chunk** — Standard JSON message with base64-encoded chunk data
2. **Binary chunk** — Raw tar data with 16-byte `requestId` header

**Upload lifecycle:**
1. `upload_backup_start` — Backend sends start request
2. `upload_backup_chunk` / binary frame — Chunk data follows
3. `upload_backup_complete` — Signals completion

**Limits:**
- Maximum upload size: 10 GB
- Inactivity timeout: 10 minutes (stale sessions cleaned up every 60s)
- Binary chunk format: first 16 bytes = request ID, remainder = data

### Backup Download (Streaming)

Backups are streamed to the panel in chunks:

1. `download_backup_start` — Backend requests download
2. Agent opens the backup file and streams chunks
3. Each chunk is sent as a WebSocket message
4. File descriptor is cleaned up after completion

### Restore (Pipe Relay)

Restores use a pipe relay for efficient data transfer:

1. `prepare_restore_stream` — Backend prepares restore request
2. Agent opens the backup file and streams it as binary frames
3. Backend pipes the tar stream directly into the container's data directory
4. `finish_restore_stream` — Signals completion

**Constraints:**
- Only one restore stream can be active at a time
- Streams are killed on disconnect to prevent orphaned processes
- Restore data is streamed directly without temporary files

---

## WebSocket Communication Protocol

### Connection

The agent connects to the panel at the configured `backend_url` (e.g., `wss://panel.example.com/ws`).

**Authentication:** The agent authenticates using the `api_key` from `config.toml`, sent as `x-node-api-key` header or `Authorization: Bearer` in the handshake message.

**Reconnection:** The agent automatically reconnects with progressive lockout if the backend rejects authentication (auth lockout with configurable `retryAfterSeconds`).

**WebSocket configuration:**
- Max frame size: 4 MB
- Max message size: 8 MB

### Handshake

On connection, the agent sends a handshake message:

```json
{
  "type": "node_handshake",
  "token": "your-api-key",
  "nodeId": "your-node-uuid",
  "tokenType": "api_key",
  "protocolVersion": "1.0"
}
```

The backend responds with `node_handshake_response` on success, or `error` on failure (with `retryAfterSeconds` for lockouts).

### Health Reports

Sent every 5 seconds from the health monitor:

```json
{
  "type": "health_report",
  "nodeId": "node-uuid",
  "timestamp": 1234567890,
  "cpuPercent": 45.2,
  "memoryUsageMb": 8192,
  "memoryTotalMb": 32768,
  "diskUsageMb": 51200,
  "diskTotalMb": 102400,
  "containerCount": 5,
  "uptimeSeconds": 86400,
  "networkRxBytes": 1048576,
  "networkTxBytes": 524288
}
```

### Resource Stats

Sent every 5 seconds from the resource monitor (per-server or node-level):

**Node-level (all servers = null):**
```json
{
  "type": "resource_stats",
  "timestamp": 1234567890,
  "metrics": [
    {
      "serverUuid": "srv-abc",
      "cpuPercent": 25.5,
      "memoryUsageMb": 1024,
      "diskIoMb": 10,
      "networkRxBytes": 100000,
      "networkTxBytes": 50000,
      "diskUsageMb": 5000,
      "diskTotalMb": 10000,
      "timestamp": 1234567890
    }
  ]
}
```

### Server State Updates

Sent on state changes (running, stopped, crashed, error, etc.):

```json
{
  "type": "server_state_update",
  "serverId": "server-name",
  "state": "running",
  "timestamp": 1234567890,
  "reason": "optional reason",
  "portBindings": {"25565": 25565},
  "exitCode": null
}
```

### EULA Required Events

Sent when a Minecraft server exits because EULA is not accepted:

```json
{
  "type": "eula_required",
  "serverId": "server-name",
  "serverUuid": "srv-uuid",
  "eulaText": "By playing on this server, you agree to...",
  "serverDir": "/var/lib/catalyst/srv-uuid",
  "timestamp": 1234567890
}
```

The frontend must respond with `accept_eula` or `decline_eula` to resume.

### Server Commands (Panel → Agent)

| Command | Description |
|---|---|
| `server_control` | Generic command with `action` field: `install`, `start`, `stop`, `kill`, `restart` |
| `install_server` | Run template install script in temporary container (with SteamCMD retry) |
| `reinstall_server` | Stop, wipe data, run install script |
| `rebuild_server` | Remove container, keep data, start fresh |
| `start_server` | Start server with full details (template, resources, environment) |
| `stop_server` | Graceful stop with configurable stop command and signal |
| `kill_server` | Force kill with SIGKILL |
| `restart_server` | Stop (with 30s max wait) then start |
| `delete_server` | Stop + remove containers + cleanup firewall rules + remove data |
| `console_input` | Send input to server's stdin |
| `resize_storage` | Resize disk image (online grow or offline shrink) |
| `resume_console` | Resume console stream for a server |
| `request_immediate_stats` | Request immediate resource stats for a server or all servers |
| `update_agent` | Trigger agent self-update |

### File Operations (Panel → Agent)

| Command | Description |
|---|---|
| `file_operation` | File operation request (handled by File Tunnel) |

The file tunnel supports 12 operations: `list`, `read`, `write`, `delete`, `create`, `rename`, `permissions`, `compress`, `decompress`, `archive-contents`, `upload`, `install-url`.

### Backup Commands (Panel → Agent)

| Command | Description |
|---|---|
| `create_backup` | Create a backup archive (async, with progress reporting) |
| `restore_backup` | Restore from a backup |
| `delete_backup` | Delete a backup |
| `download_backup_start` / `download_backup` | Stream backup download |
| `upload_backup_start` / `upload_backup_chunk` / `upload_backup_complete` | Upload backup chunks |
| `start_backup_stream` | Stream backup to remote storage (S3/SFTP) |
| `prepare_restore_stream` / `finish_restore_stream` | Pipe relay restore |

### Configuration Commands (Panel → Agent)

| Command | Description |
|---|---|
| `create_network` | Create a CNI network |
| `update_network` | Update an existing CNI network |
| `delete_network` | Delete a CNI network |

### Background Tasks

The agent manages these background tasks automatically:

| Task | Interval | Details |
|---|---|---|
| **Heartbeat** | Every 15s | Sends `"type": "heartbeat"` message |
| **Log Rotation** | Every 5m | Checks all container logs for size >10MB, rotates to `.1` and `.2` |
| **State Reconciliation** | Every 30s | Compares actual container states with reported states |
| **Event Monitoring** | Continuous | Subscribes to containerd event stream; falls back to 2s polling |
| **TCP Health Checker** | Every 30s | Probes running game server ports |
| **File Tunnel Polling** | Continuous | 4 concurrent long-poll workers |
| **Backup Upload Cleanup** | Every 60s | Removes stale sessions after 10 min inactivity |
| **Metrics Buffer Flush** | On reconnect | Flushes buffered resource stats (up to 500 per batch, max 100MB buffer) |

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
7. **curl / tar / gzip** — CNI plugin download tools
8. **CNI plugins** — bridge, host-local, portmap, macvlan (v1.9.0)

### CNI Plugin Installation

CNI plugins are installed from the official GitHub releases:

1. Downloads `cni-plugins-linux-{arch}-v1.9.0.tgz`
2. Verifies SHA256 checksum (pinned for amd64/arm64):
   - amd64: `58c037b23b0792b91c1a464f3c5d6d2d124ea74df761911c2c5ec8c714e5432d`
   - arm64: `259604308a06b35957f5203771358fbb9e89d09579b65b3e50551ffefc536d63`
3. Extracts to `/opt/cni/bin/`
4. Falls back to package manager installation if download fails
5. Searches for plugins in `/opt/cni/bin`, `/usr/libexec/cni`, and `/usr/lib/cni`

Required CNI plugins: `bridge`, `host-local`, `portmap`, `macvlan`.

### containerd Socket Access

For non-root users, the agent configures socket access:

1. Creates a `containerd` system group
2. Adds the current user to the group
3. Creates a systemd override at `/etc/systemd/system/containerd.service.d/override.conf` to set socket permissions to `0660`
4. Falls back to `chmod 666` as a last resort

The override file content:
```ini
[Service]
ExecStartPre=-/bin/chown root:containerd /run/containerd
ExecStartPost=-/bin/chmod 660 /run/containerd/containerd.sock
```

---

## Agent Updates

The agent supports self-updates initiated by the panel via the `update_agent` WebSocket command.

**Update flow:**
1. Panel sends `update_agent` command
2. Agent downloads new binary from `{backend_url}/api/agent/download`
3. Agent writes to `{binary_path}.update`
4. Agent renames current binary to `{binary_path}.backup`
5. Agent moves new binary into place
6. Agent performs `exec` (Unix) or spawns new process (non-Unix) with same arguments

**Security:**
- Download URL uses the same backend URL as WebSocket
- Binary is made executable on Unix (mode 0755)
- Current binary is backed up before replacement

---

## Logging

The agent uses structured logging via the `tracing` crate with `tracing-subscriber`.

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
  "timestamp": "2026-01-15T10:30:00.000Z",
  "level": "INFO",
  "message": "Container started",
  "span": {"name": "runtime_manager"},
  "container_id": "abc123",
  "server_uuid": "srv-xyz"
}
```

**Text format example:**
```text
2026-01-15T10:30:00.000Z  INFO catalyst_agent::runtime_manager: Container started container_id=abc123 server_uuid=srv-xyz
```

**Log filtering:** The agent sets the log filter to `catalyst_agent={level},tokio=info`, meaning only catalyst agent logs at the configured level and Tokio at info level are shown.

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
5. Console log streams are restarted for all running containers
6. Server states are reconciled to prevent drift

---

## Deployment Scenarios

### Single Node (Development)

- Run on a local VM or physical machine
- Single CNI network (auto-detected)
- No external firewall required
- Use `ws://localhost:3000/ws` with `CATALYST_ALLOW_INSECURE_WS=1`

### Multi-Node Production

- Multiple nodes behind a load balancer or DNS round-robin
- Each node has its own CNI networks (configured in `config.toml`)
- Use `wss://` with valid TLS certificates
- Configure separate firewalls per node (UFW, firewalld, or ipset)
- Nodes share the same panel backend

### Air-Gapped / Offline Deployment

- Nodes have no internet access
- CNI plugins must be pre-installed (downloaded on a connected machine, transferred via USB)
- Container images must be pre-loaded on each node (via `ctr images import`)
- The agent cannot auto-update; updates must be done manually

### Headless / Containerized Deployment

- Agent runs inside a Docker container (see [Docker Installation](#docker-installation))
- No systemd service needed
- All configuration via environment variables
- Requires `--privileged` mode for full functionality

---

## Troubleshooting

### Agent Won't Connect to Panel

**Symptoms:** Node shows as offline in the panel.

**Check:**
```bash
# Verify the WebSocket URL is correct
# Use wss:// for production (not ws://)
grep backend_url /opt/catalyst-agent/config.toml

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

### Metrics Buffer Overflow

**Symptoms:** Missing resource stats in the panel during extended outages.

**Check:**
```bash
# Check buffer size
ls -lh /var/lib/catalyst/metrics_buffer.jsonl
# Max 100 MB — oldest data is dropped when the cap is reached
```

### Steam/Proton Compatibility Issues

**Symptoms:** Server crashes immediately on start with Proton/SteamCMD images.

**Check:**
```bash
# Verify compatdata directory exists and has correct ownership
ls -la /var/lib/catalyst/{server-uuid}/.proton/
ls -la /var/lib/catalyst/{server-uuid}/Steam/
# Should be owned by uid 1000:gid 1000
```

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

### WebSocket Disconnection

**Symptoms:** Agent shows as offline, then comes back online.

**Check:**
```bash
# Look for reconnection logs
sudo journalctl -u catalyst-agent -f --no-pager | grep -E "(reconnect|connection|handshake)"
```

The agent automatically reconnects with exponential backoff. If the backend rejects auth, it applies a progressive lockout.

---

*Last updated: 2026-05-04*
