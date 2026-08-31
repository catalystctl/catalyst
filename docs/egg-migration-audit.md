# Egg → Catalyst Template Migration Audit

*Audit date: 2026-08-31. Scope: all vendored eggs in `/eggs`, the import pipeline in
`catalyst-backend/src/utils/egg-import.ts`, and the agent runtime that actually executes templates.*

---

## 1. Current state (what "migration" actually means here)

`eggs/` is a vendored snapshot of the Pterodactyl/Pelican game-eggs repo:
**165 game nests, 248 `egg-*.json` files** (PTDL_v2, exported ~2026-03).

The mechanical part of migration is already solved:

| Piece | Status |
|---|---|
| Import API | `POST /api/templates/import-pterodactyl` and `-batch` (routes/templates.ts) |
| Conversion | `egg-import.ts` — `$VAR`/`${VAR}` → `{{VAR}}`, install-script cleanup, built-in Wings vars, stop-command/signal parsing, Steam disk hints, structured validation |
| Runtime config files | Agent applies `features.pterodactylConfigFiles` at startup with full Wings parser set: `properties`, `file`, `json`, `yaml`, `ini`, `xml` (agent `config_parser.rs`) |
| Placeholders | Agent resolves `{{server.build.default.port}}`, `{{server.build.env.*}}`, `{{env.*}}`, bare `{{VAR}}` (agent `config_parser.rs`) |
| Install wrapper | Agent handles `/mnt/server → /data` symlink, `HOME=/data`, `set -e`, CR stripping, interpreter selection, chown 1000:1000 |
| Java | Agent computes a JVM heap plan and sizes the cgroup with off-heap overhead (`java-memory.ts` + agent lifecycle); Paper "0 bytes free" quirk handled |
| EULA | Native detection → pause → `eula_required` prompt (agent `console.rs`) |
| Wine | `XVFB=1` auto-injected when wine/proton startup detected |
| Stop | `stopCommand` delivered on stdin, or mapped signal (`^C`→SIGINT etc.) |

So **migration ≠ import**. Import is a solved, one-click problem. The work that matters is
**curating each egg so its defaults, images, variables, ports, resources, and stop behavior
are correct *in Catalyst*** — the auto-import makes reasonable guesses that are wrong for
many popular games. This audit ranks the games and lists the curation work per egg.

---

## 2. Platform gaps to close before/with Wave 1

Found while auditing; all block quality migrations of the top games.

1. **Missing eggs for two top-10 games.** The vendoring is incomplete:
   - **Rust (vanilla)** — only `rust_autowipe` and `rust_staging` are vendored; the plain `rust/rust` egg from upstream is missing. This is the #2 most-hosted game.
   - **Team Fortress 2 (vanilla)** — only `team_fortress_2_classic` is vendored.
   - Minor: BungeeCord (Waterfall/Travertine proxies are present, upstream BungeeCord is not).
   *Action: re-vendor these from the upstream repo before Wave 1.*

2. **`java_version` egg feature is not implemented.** Minecraft eggs rely on Wings to switch
   the Java image based on `MINECRAFT_VERSION`. Catalyst pins `defaultImage` at import time,
   and the import heuristic picks **the first `docker_images` key** — for Paper that is
   **Java 25**, even though the user's chosen MC version may need 8–21. Decide:
   implement the feature (agent/backend picks image from `MINECRAFT_VERSION`), or curate
   default images per egg and document version→Java mapping in each README.

3. **Resource defaults are too generic.** Import hardcodes `allocatedCpuCores: 2` and memory
   = `SERVER_MEMORY` var default or **1024 MB**. That is fine for Terraria, absurd for
   CS2/ARK/ASA/Palworld/Enshrouded. Add a per-game resource preset table (memory/CPU/disk)
   applied during curation — the Steam-appid disk table (`STEAM_APP_DISK_MB`) already does
   this for disk; extend the same idea. Also: **appid `2430930` is ARK: Survival Ascended**,
   currently mislabeled `// Palworld (alt)` in the table — verify and fix, and add missing
   appids (DayZ 2232530? etc. — derive from each egg's `SRCDS_APPID` during migration).

4. **Multi-port games get a single `supportedPorts: [primary]`.** Catalyst supports secondary
   allocations (`portBindings`, `syncPortEnvironmentVariables`), but the importer doesn't
   declare them. The top games are all multi-port: Rust (query/RCON/app), CS2 (SRCDS+TV),
   Palworld (RCON/REST), Valheim (query/beacon/backup), ARK (query/RCON per map), Squad,
   DayZ, Insurgency. Curation must declare secondary ports and their env-var mapping.

5. *(Optional, non-blocking)* Eggs pull `ghcr.io/ptero-eggs` yolks/installers. Works today;
   consider pinning digests or mirroring into a Catalyst registry for supply-chain safety.

---

## 3. Priority tiers (by real-world hosting demand)

Ranking reflects hosting-provider demand on Pterodactyl/Pelican panels: Minecraft dominates;
Rust, CS2, ARK, Palworld, GMod, Valheim and Terraria form the next band; then the survival/
sandbox wave (Enshrouded, V Rising, Core Keeper, 7DtD, DayZ, PZ, Satisfactory, Factorio…).

### Tier 1 — ship first (a panel without these is unusable)

| # | Game | Eggs (all) | Runtime | Key curation work |
|---|---|---|---|---|
| 1 | **Minecraft** | **48** — Java: paper, purpur, spigot, fabric, forge, neoforge, quilt, folia, mohist, arclight, magma, spongeforge, spongevanilla, glowstone, krypton, canvas-mc, cuberite, limbo, nanolimbo, vanillacord, ftb-installer, curseforge-generic, modrinth-generic, technic ×10; Bedrock: vanilla (+ARM64), pocketmine, nukkit, powernukkitx, levilamina, gomint, liteloader; Proxies: velocity, waterfall, travertine, viaaas, waterdog-pe (×2 dupes); Crossplay: purpur-geysermc-floodgate | Java / PHP / Node | Biggest single win (~20% of all eggs). See §4.1 |
| 2 | **Rust** | 2 vendored (**vanilla missing**) + autowipe, staging | Unity/SteamCMD | Vendor vanilla; wipe scheduling → Catalyst automation instead of autowipe egg; multi-port; Oxide/uMod var; 4–8 GB preset |
| 3 | **Counter-Strike** | cs2, css, cs1.6-rehlds, cs1.6-vanilla (4) | Source2/Source/SteamCMD | GSLT, TV_PORT secondary alloc, game mode/type selects, native Metamod:Source/CounterStrikeSharp via built-in mod-manager; 4 GB+ preset, 40 GB disk already mapped |
| 4 | **Palworld** | palworld, palworld-proton (2) | SteamCMD/Proton | Replace startup's `PalworldServerConfigParser` + RCON-stdin hack with agent `ini` config specs + native REST stop; REST/RCON secondary ports; 8–16 GB preset |
| 5 | **Valheim** | vanilla, bepinex, valheim-plus (3) | SteamCMD/Proton(BepInEx) | Keep `^C`→SIGINT stop; crossplay (PlayFab) port + var; map BACKUP_* vars → Catalyst scheduled backups where possible; password ≥5 chars rule preserved |
| 6 | **ARK** | survival_evolved, survival_ascended (2) | SteamCMD/Proton | Heaviest multi-port (game/query/RCON per map); ASA = appid 2430930 (fix mislabeled disk entry); 12–16 GB preset ASA; GameUserSettings.ini via `ini` parser |
| 7 | **Garry's Mod** | gmod (1) | Source/SteamCMD | Workshop collection download var, GSLT feature, tickrate, gamemode select; CS:S mount content var; 2–4 GB preset |
| 8 | **Terraria** | vanilla, tmodloader, tshock, tshock-legacy (4) | .NET | Simple; pin dotnet image per variant (TShock→.NET 6+), map port only, `exit` stdin stop |
| 9 | **GTA / FiveM** | fivem, altv, mtasa, ragemp, samp, openmp, gtac, ragecoop (8) | Custom/Leaf | FiveM first: license key var (required), txAdmin port as secondary, max clients; the rest are tier-2 effort |

### Tier 2 — second wave (high demand, low-to-medium effort)

| Game | Eggs | Notes |
|---|---|---|
| Unturned | 1 | RocketMod/UWS vars; port+query |
| DayZ | 1 | `serverDZ.cfg` + `beserver_x64.cfg` already in config files — verify `ini`/`file` parsers apply; STEAM_USER/PASS for mod downloads; multi-port |
| 7 Days to Die | 1 | `serverconfig.xml` via `xml` parser (already stored); telnet port secondary; stop path (`shutdown` via telnet) needs QA in Catalyst |
| Project Zomboid | 1 | `servertest.ini` via `ini` parser; Steam query port secondary |
| Satisfactory | 1 | REST API port secondary; beacon port; 8 GB preset |
| Factorio | 4 | vanilla (+ARM64), clusterio, modupdate; factorio token var; rcon port |
| Enshrouded | 1 (+server json) | Wine; 8 GB preset; `enshrouded_server.json` via `json` parser |
| V Rising | 2 (vanilla, bepinex) | Wine; `ServerHostSettings.json` via `json` parser; query port |
| Conan Exiles | 1 | Wine; multi-port (game+query+port+RCON); 8 GB preset |
| Arma 3 / Reforger | 2 | Steam workshop mods; multi-port; 4–8 GB preset; Arma uses `server.cfg`/`network.cfg` via config files |
| Left 4 Dead 2 (+L4D1) | 2 | Standard SRCDS; GSLT; TV port |
| SCP: Secret Laboratory | 2 (dedicated, exiled) | Multi-port range; 7.9k+ community servers |
| Space Engineers | 2 (default, torch) | Torch variant is the preferred modded path; `SpaceEngineers-Dedicated.cfg` via `xml` |
| Sons/The Forest | 2 | Wine/Proton path; XVFB already handled |
| **Team Fortress 2** | **0 — missing** | Vendor from upstream; classic SRCDS egg; TV_PORT; appid 232250 already in disk table |

### Tier 3 — long tail (batch import is fine; curate on request)

Squad, Insurgency Sandstorm, Killing Floor 2, Core Keeper, Abiotic Factor, Sunkenland,
Soulmask, Necesse, Mordhau, Holdfast, Post Scriptum, Ground Branch, Stationeers,
Stormworks, Starbound, Don't Starve, Eco, Barotrauma, Mindustry, Vintage Story, Veloren,
Minetest, OpenTTD/OpenRA/OpenRCT2, CS:S-era Source classics (Black Mesa, FoF, NMRIH,
SvenCoop, SourceCoop, HL2DM, TF2C, Battalion, IOSoccer, Quake Live, UrbanTerror, Doom/
Zandronum, Soldat/2, DDNet, Teeworlds, Xonotic, SuperTuxKart, Classicube…), GTA minor
variants, VR eggs (Pavlov, Neos, Resonite), and the remaining ~80 niche eggs.

These import cleanly today (validation + unresolved-var tests pass); curate opportunistically.

---

## 4. Per-game optimization notes (the "not copy-paste" part)

### 4.1 Minecraft (48 eggs) — highest leverage

- **Heap:** Eggs hardcode `-Xms128M -XX:MaxRAMPercentage=95.0`. Catalyst's agent owns JVM
  heap planning (computes `-Xmx` + cgroup overhead incl. direct/metaspace). Standardize:
  drop `MaxRAMPercentage` conflicts, keep a single `-Xms` var, and let the planner own `-Xmx`.
- **Aikar's flags:** add as a curated variable (default ON for paper/purpur/folia) rather than
  baking into every startup string.
- **Java image:** fix the first-key default (Paper→Java 25). Curate per-egg defaults or
  implement the `java_version` feature to switch image from `MINECRAFT_VERSION` (see §2.2).
- **Mod-manager wiring:** Catalyst ships providers for paper, spigot, curseforge, modrinth,
  metamod, sourcemod, counterstrikesharp. Tag templates with the right features so the plugin
  UI lights up for paper/purpur/spigot/ftb/curseforge/modrinth eggs.
- **EULA:** native pause/prompt exists — nothing to do beyond keeping feature parity; verify
  UI surfaces `eula_required` for all java eggs.
- **Proxies:** velocity/waterfall/travertine — set 512–1024 MB presets, no config files,
  and `startup done` patterns verified for "running" detection.
- **Bedrock:** pocketmine/powernukkitx run on PHP yolks — verify images resolve; the ARM64
  vanilla variant is a nice differentiator to surface in the UI.
- **Hygiene:** remove the duplicate waterdog-pe egg; keep the unresolved-`{{VAR}}` import
  test (`pterodactyl-egg-import.test.ts`) green as the gate for each migrated egg.

### 4.2 SteamCMD family (Rust, CS2, GMod, L4D2, …)

- Map every extra port (`QUERY_PORT`, `RCON_PORT`, `TV_PORT`, `APP_PORT`) to Catalyst
  secondary allocations and keep `syncPortEnvironmentVariables` naming (`SERVER_PORT_<n>`).
- Curate `STEAM_GSLT` / token vars as password-type, non-editable-by-users where appropriate.
- Prefer stdin stop (`quit`) — verified supported — and confirm SIGTERM grace for save-on-exit.
- Use `features.startupDonePattern` from each egg's `config.startup.done` for accurate status.

### 4.3 Wine/Proton family (Palworld, Valheim, ARK ASA, Enshrouded, V Rising, SotF…)

- `XVFB=1` is automatic; nothing to add — but pin a wine/proton image variant per game.
- Replace egg-internal config-parser hacks (Palworld) with native agent config-file specs.
- Generous memory presets (8–16 GB) — the 1024 MB import default will OOM instantly.
- Prefer REST/RCON/`shutdown` stops over SIGKILL; map signals via `sendSignalTo` (`^C`→SIGINT
  for Valheim).

### 4.4 Config-driven games (DayZ, PZ, ARK, Space Engineers, Enshrouded, 7DtD)

- Egg `config.files` blobs are already carried into `features.pterodactylConfigFiles` and the
  agent applies them with the right parser. Curation task: **boot-test each** and confirm the
  parser produced valid output (ini/xml parsers are best-effort).

---

## 5. Suggested execution plan

- **Wave 0 (platform, small):** vendor missing eggs (Rust, TF2, BungeeCord); decide
  `java_version` strategy; per-game resource preset table; fix `2430930` mislabel + extend
  appid disk table; secondary-port declaration support for templates.
- **Wave 1 (Tier 1):** Minecraft → Rust → CS2 → Palworld → Valheim → ARK → GMod → Terraria →
  FiveM. Each egg: import → curate → boot-smoke (start, config applied, stop, restart) →
  README updated.
- **Wave 2 (Tier 2):** as listed in §3; most are 1-egg games with the same recipe.
- **Wave 3 (Tier 3):** rely on batch import; curate on demand.
- **QA gate:** extend the unresolved-vars test into a per-template migration checklist
  (see §6) and add boot-smoke coverage for Tier 1 in `tests/e2e`.

## 6. Definition of done (per egg)

1. Default image curated (not first-key), alternatives declared, install image pinned.
2. Startup uses `{{VAR}}` with validated rules; every referenced var defined.
3. Secondary ports declared and env-mapped; `supportedPorts` accurate.
4. Memory/CPU/disk presets from the per-game table.
5. Stop path verified (stdin command or signal); `startupDonePattern` set.
6. Config-file specs boot-tested with the correct parser.
7. Features wired where applicable: mod-manager, EULA, steam_disk_space, file denylist.
8. README reflects Catalyst-specific behavior (not the upstream Pterodactyl one).
