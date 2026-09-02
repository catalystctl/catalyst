# Auto FastDL (fastdl-sync)

Automatic Fast Download content sync for Half-Life 1 / Source engine game
servers (Counter-Strike 1.6, Garry's Mod, CS:S, TF2, ...).

Without FastDL, joining clients download custom content from the game server
itself at a few KB/s. FastDL moves those downloads to a plain HTTP server the
client fetches at line speed. **Auto FastDL removes the manual step**: instead
of uploading every file twice (game server + FastDL host), the plugin scans
game servers and mirrors downloadable content into your FastDL server's
docroot on a schedule.

## How it works

1. Admin pairs a **game server** (source) with a **FastDL server** (target) —
   the target is typically a server created from Catalyst's *FastDL (Caddy)*
   template. Both should live on the **same node** (file transfers stream
   through the panel, so cross-node works too but is slower).
2. On every sync (cron, default every 5 minutes) the plugin walks the source
   server's content directories via the panel's file tunnel:
   `maps/`, `models/`, `sprites/`, `resource/`, `materials/`, `particles/`,
   `sound/`, `media/`, `fonts/`, `overviews/`, `events/`, `gfx/`, plus
   root-level `.wad` files in each game dir.
3. New and changed files are streamed source → panel → FastDL server.
   Deleted files are removed from the docroot (configurable).
4. Configs and sensitive files are never published (built-in denylist:
   `server.cfg`, `autoexec.cfg`, banned lists, logs, demos, ...).

## Setup

1. Install the plugin (Admin → Plugins) and grant it the requested
   permissions (`server.read/write`, `files.read/write`).
2. Create a FastDL server from the *FastDL (Caddy)* template.
3. Open **Admin → Auto FastDL**, pick source + target, click **Pair**.
4. Click **Sync now** (or wait for the schedule). Copy the shown
   `sv_downloadurl` line into the game server's `server.cfg`:
   `sv_downloadurl "http://<fastdl-ip>:<port>"`, then `changelevel`.

## Plugin settings

| Setting | Default | Purpose |
|---|---|---|
| `syncEnabled` | on | Run the scheduled sync |
| `syncIntervalCron` | `*/5 * * * *` | Sync schedule |
| `generateBzip2` | off | Also upload `.bz2` twins (HL1 clients fetch these automatically; ~60-80% less bandwidth, needs the `bzip2` CLI on the panel host) |
| `bz2MinSizeMb` | 2 | Minimum file size for `.bz2` twins |
| `maxFileSizeMb` | 512 | Skip larger files |
| `deleteRemoved` | on | Delete docroot files whose source disappeared |

## Permissions model

The plugin stores pairings in its own collections and never writes outside
the FastDL server's `fastdl/` docroot. All panel routes it registers require
an authenticated admin; sync transfers go through the panel's file tunnel
with its existing per-node caps and timeouts.
