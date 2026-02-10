# Catalyst User Guide (End Users)

**For:** Server owners/operators managing game servers

## Table of Contents

- [Getting Started](#getting-started)
- [Create a Server](#create-a-server)
- [Start, Stop, Restart](#start-stop-restart)
- [Console](#console)
- [Files](#files)
- [Backups](#backups)
- [Schedules & Tasks](#schedules--tasks)
- [Alerts](#alerts)
- [Networking Tips](#networking-tips)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)
- [Glossary](#glossary)

---

## Getting Started

## Getting Started

1. Sign in to the Catalyst panel with your account credentials.
2. Select an existing server or create a new one (if your role permits).
3. Open the server console to verify it starts cleanly.

## Create a Server

1. Go to **Servers → Create**.
2. Choose a template (e.g., Minecraft/Paper).
3. Pick a node and resource allocations (CPU, RAM, disk).
4. Select networking:
   - **Bridge**: Node IP + port mapping (most common).
   - **Host**: Host network, no port mapping (lowest latency).
   - **Macvlan/IPAM**: Static LAN IP from the pool.
5. Click **Create** and wait for install/start.

## Start, Stop, Restart

- Use the server controls from the server list or detail page.
- If a server is suspended, actions are blocked.

## Console

- Open **Console** to view output and send commands.
- Use commands exactly as you would in a native server terminal.

## Files

- Use the File Manager to edit configs, upload plugins/mods, and manage logs.
- Path traversal is blocked; you can only access your server directory.

## Backups

1. Go to **Backups**.
2. Create a new backup (local or remote if configured).
3. Download or restore as needed.

## Schedules & Tasks

- Create scheduled tasks for restarts or commands.
- Use standard cron expressions.

## Alerts

- Configure alerts for CPU, memory, disk, or status thresholds.
- Alerts are visible in the Alerts UI.

## Networking Tips

- Use **Bridge** for most setups.
- Use **Host** when latency is critical and you can avoid port conflicts.
- Use **Macvlan/IPAM** for LAN addressability.

## Troubleshooting

- **Server won’t start**: check console output and verify template variables.
- **No console output**: verify node is online and agent is connected.
- **Can’t upload files**: confirm permissions and file size limits.
- **Port conflicts**: switch port bindings or use a different node IP (bridge).

## FAQ

**Q: Why can’t I edit allocations while running?**
A: Resource changes require the server to be stopped for safety.

**Q: What is CATALYST_NETWORK_IP?**
A: The assigned IP used for macvlan or host networking.

**Q: Why is my server suspended?**
A: Suspension is enforced by admins; contact support.

## Glossary

- **Node**: A host machine running the Catalyst agent.
- **Template**: Server definition with image/install/startup settings.
- **IPAM**: IP address management for macvlan networks.
- **Bridge**: Port-mapped container networking.
