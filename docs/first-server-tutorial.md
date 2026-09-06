# Deploy Your First Game Server

End-to-end tutorial: Minecraft (Paper) on Catalyst, from node to connected player. Every button and tab name below matches the current UI.

## Prerequisites

- Panel installed and setup wizard completed ([Getting Started](getting-started.md), Steps 1–2).
- A node with the agent connected (**Admin → Nodes** shows it **online**).
- At least one allocation on the node (**Allocations** on the node details page, e.g. `25565`).
- A Paper template: import `eggs/minecraft/java/paper/egg-paper.json` via **Admin → Templates → Import** (see [Pterodactyl Migration](pterodactyl-migration.md)), or use your own template. After import, open the template and confirm the default image is the Java version you want (import keeps the first listed image).

## 1. Open server creation

Go to **Servers** → **New server** (dialog title **Create new server**).

## 2. Details

- **Server Name** (required, letters/numbers/`-_.()&'` and spaces) — e.g. `My Minecraft Server`.
- **Description** (optional).
- **Template** — pick the Paper template.
- **Node** — pick your online node.
- **Image Variant** — appears only if the template defines variants; pick the Java version matching your Minecraft version.

## 3. Resources (Resource Allocation)

- **Memory (MB)** — backend range 512–131072 (the UI also shows a 256 floor, but the backend minimum wins). Paper 1.21: `2048` is a comfortable start.
- **CPU Cores** — backend range 1–128. Start with `2`.
- **Disk (MB)** — backend range 1024–1048576. Start with `10240`.
- **Swap (MB)**, **Backup (MB)**, **Database Allocation** — leave blank for provider defaults.

## 4. Network

- **Network Mode** — `Host (port mapping)` unless you run macvlan with an agent-side network configured.
- **Primary Allocation** — select your `25565` allocation. The **Primary Port** field is read-only and fills from the allocation.
- **Additional Port Bindings** — only if you need extra ports (e.g. RCON, query).

## 5. Startup variables

Required variables show an asterisk. For Paper:

- `MINECRAFT_VERSION` — e.g. `1.21.11`.
- `SERVER_JARFILE` — e.g. `server.jar`.
- `BUILD_NUMBER` — leave empty for latest.
- `MEMORY`/`MEMORY_XMS` style sizing variables if your template defines them — keep within the resources from step 3.

`SERVER_DIR` is managed by the panel and hidden.

## 6. Create and install

Click **Create server**. Creation writes a `stopped` server row and the UI immediately calls install, navigating to `/servers/:id/console` (the **Console** tab). The agent pulls the image, creates the data directory, and runs the install script (downloads Paper, writes `server.properties`/`eula.txt`).

Watch the console: connection labels show `Live`, `Reconnecting`, `Disconnected`, or `Connecting`. Use the stream filters (stdout/stderr/system/stdin), search, and scrollback settings as needed.

## 7. Accept the EULA and start

1. If an EULA prompt appears, accept it in the EULA modal.
2. Use **Start** in the server controls. (**Stop** graceful, **Restart**, **Kill** with confirmation, and **Cancel install** while installing.)
3. Console should reach the Paper done message (`... For help, type "help"` pattern family).

## 8. Connect

Point your Minecraft client at `<node public address>:<primary port>` (e.g. `play.example.com:25565`). Verify with `list` in the console input (commands send only while running and connected).

## 9. Operate

- **Console** — commands, history (arrow keys), filters.
- **Files** — browse, upload, download, edit, create, rename, delete, `.tar.gz` compress/decompress.
- **SFTP** — **SFTP** tab → token from the panel; username is the server ID, port is the node SFTP port (often `2022`).
- **Backups** — **Create backup**; storage mode per-server (Local/S3/SFTP/Stream; local and stream hidden when allocation is zero).
- **Tasks** (**Scheduled Tasks**) — cron actions (start/stop/restart/backup/command).
- **Configuration** — startup variables. **Settings** — name/resources. **Admin** — transfers, allocations, restart policy, suspension, archive, reinstall, delete.
- Stop/restart from the controls; confirm the console goes quiet before maintenance.

## Troubleshooting a failed install

| Symptom | Check |
|---|---|
| Stuck in `installing` | Use **Cancel install** (works while `installing`; resets to `stopped` even if the node is offline), verify the node is online and the template install image is reachable, then reinstall (destructive — back up first) |
| Image pull errors | Node disk space, registry reachability from the node, correct default image variant |
| Install script errors | Open the template's install script; compare with the console output tail |
| Server starts then stops | Startup variables (version/build/jar name), memory within allocation, EULA accepted |
| Can't connect | Allocation IP/port matches what you dial; node firewall allows it; server shows running and the done message |

Collect before opening an issue: template name + version, install/console tail, node online status, allocation, and resource settings. Redact API keys, tokens, and passwords.
