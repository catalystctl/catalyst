# Pterodactyl Egg Migration

Import Pterodactyl eggs into Catalyst as templates. This guide describes what the importer actually does — verified against `catalyst-backend/src/utils/egg-import.ts` and `catalyst-backend/src/routes/templates.ts`.

> Migration (live-panel import via **Admin → Migration**) and egg import (JSON → template) are different flows. This page covers egg → template import. The `eggs/` directory in the repo is a vendored upstream snapshot used for testing, not a migration source.

## Concepts: Egg vs Catalyst Template

| Pterodactyl | Catalyst | Notes |
|---|---|---|
| Egg | Template (`ServerTemplate`) | One egg becomes one template |
| Nest | Nest | Reused when matched, or auto-created from the egg category |
| `docker_images` | `images[]` + `image` + `defaultImage` | First image wins; the rest become variants |
| `startup` with `$VAR` / `${VAR}` | Startup with `{{VAR}}` | Converted automatically, uppercase names only |
| Egg variables | Template variables | Rules preserved as strings; `in:a,b` becomes a select |
| `scripts.installation` | `installScript` + `installImage` + `installEntrypoint` | Script copied almost verbatim |
| `config.stop` | `stopCommand` + `sendSignalTo` | Signals mapped, see below |
| `config.startup` / `config.logs` / `config.files` | `features.startupDetection` / `logDetection` / `pterodactylConfigFiles` | Stored as template features |

Catalyst templates additionally require `author`, `version` (always seeded as `1.0.0` on import — the egg's `meta.version` is kept as `features.pterodactylSpecVersion`), `allocatedMemoryMb` (default `1024`), `allocatedCpuCores` (always `2` on import), and `supportedPorts` (single primary port).

## Importing

### Where

**Admin → Templates → Import** (requires the `template.create` permission), or directly:

- `POST /api/templates/import-pterodactyl` — single egg JSON in the request body.
- `POST /api/templates/import-pterodactyl-batch` — `{ nestId?, repoUrl? }`; fetches eggs from a GitHub repo, imports in batches of 5, never aborts on a single failure. Returns `200` when all succeed, `207` on partial failure with `{ imported, failed }` lists.

In the UI, a single JSON/YAML file prefills the manual template form (client-side conversion); multiple files or a repo URL run the batch endpoint.

> UI prefill diverges slightly from the backend importer: the form drops Pelican `images[]` arrays (backend keeps them), ignores explicit `field_type` (backend honors `select`/`number`/`password`), strips type tokens from `rules`, and shows auto-injected builtins (`SERVER_MEMORY`/`SERVER_PORT`/`SERVER_IP`/`TZ`) as editable while the backend stores them hidden and non-editable. For the canonical result, prefer the API import or re-check the saved template after a UI import.

### Where to get the egg JSON

Export it from your Pterodactyl panel (**Admin → Nests → Eggs → Export**) or from a community egg repository. Both `PTDL_v1`/`v2`/`v3` meta versions validate (unknown versions warn, not fail).

### Validation

Every egg is validated before conversion. Blocking errors (`422 Egg validation failed`):

- `MISSING_NAME`, `MISSING_STARTUP`, `MISSING_IMAGES`
- `INVALID_IMAGE_REF`, `INVALID_INSTALL_SCRIPT`, `INSTALL_SCRIPT_TOO_LARGE` (>1 MiB)
- `MISSING_VAR_NAME`, `DUPLICATE_VARIABLE`, `INVALID_VAR_DEFAULT`, `VARIABLE_VALUE_TOO_LARGE` (>64 KiB), `TOO_MANY_VARIABLES` (>256), `CIRCULAR_VARIABLE_REF`
- Route-level: `409` duplicate template name, `400` nest not found / bad `repoUrl`, `502` GitHub fetch failure

Warnings (import succeeds, listed in `warnings[]`): unknown meta version, unusual install entrypoint, unknown stop signal (falls back to `SIGTERM`), over-long stop command, variable colliding with a builtin, non-canonical image reference.

## Conversion reference

| Egg field | Catalyst field / rule |
|---|---|
| `name` (trimmed) | Template `name`; empty or duplicate is rejected |
| `description`, `author` | Copied; author defaults to `Pterodactyl Import` |
| `docker_images {label: ref}` / Pelican `images[]` | `images[] {name, label, image}`; `image` = `defaultImage` = first entry |
| `startup` | `${VAR}` then `$VAR` → `{{VAR}}` (uppercase `[A-Z_][A-Z0-9_]*` only; already-`{{}}` text untouched) |
| `variables[]` | `name` from `env_variable`/`name`; `default` from `default_value`; `required` when rules contain `required`; `userViewable`/`userEditable` default true; input type from `field_type`, else `boolean`→checkbox, `integer`/`numeric`→number, `in:`→select, else text; `options` split from `in:a,b,c`; all rules kept |
| `SERVER_MEMORY`/`PORT`/`IP`/`TZ` referenced but undefined | Auto-appended hidden non-editable defaults (`1024`, `25565`, `0.0.0.0`, `UTC`) |
| `scripts.installation.script` | Copied with only `\/`→`/` unescaping; `/mnt/server` paths and `[[ ]]`/`set -e` are handled by the agent runtime, not rewritten |
| `scripts.installation.container` / `entrypoint` | `installImage` / `installEntrypoint` (default `bash`) |
| `config.stop` | `^C`/`^c`/`^^C`→`SIGINT`, `^SIGKILL`/`^X`→`SIGKILL`, `SIGINT`/`SIGTERM`/`SIGKILL` passthrough; `^...` prefix or leading `/` stripped to a `stopCommand`; anything else becomes `stopCommand` with `SIGTERM` |
| `config.startup.done` | `features.startupDonePattern` + `startupDetection` |
| `config.logs` | `features.logDetection` |
| `config.files` | `features.pterodactylConfigFiles`; first key → `features.configFile` |
| `features[]` | `features.pterodactylFeatures` (`restartOnExit: true` always set) |
| Disk hints (`STEAM_*` app IDs, `steam_disk_space`) | `features.recommendedDiskMb`/`minimumDiskMb` when >10 GB; otherwise the server-creation fallback (`10240` MB) applies |
| `file_denylist` | Merged into `features.fileDenylist` |
| Pelican `tags`, `update_url`, `export_files` | `features.tags` / `updateUrl` / `exportFiles` |
| Ports | Single primary from `SERVER_PORT`/`PORT`/`GAME_PORT`/`QUERY_PORT`, else `25565` |
| Nest | `options.nestId`, else find-or-create by egg category (batch derives it from the repo path) |

## Compatibility table

| Pterodactyl feature | Catalyst support | Notes |
|---|---|---|
| Startup command | Supported | `$VAR`/`${VAR}` converted to `{{VAR}}` |
| Variables, defaults, `required` | Supported | Rules kept as strings |
| `user_viewable` / `user_editable` | Supported | Defaults true |
| `in:a,b,c` select options | Supported | Becomes select input |
| Docker images | Supported | First image is default; rest are variants — curate per egg (e.g. Paper imports default to the first listed Java image) |
| JSON-string or object `config.*` | Supported | Parsed via `tryParseJson` |
| Signal stops (`^C`, `SIGINT`, …) | Supported | Closed map; unknown signals warn and fall back to `SIGTERM` |
| Install script | Partial | Copied verbatim; `/mnt/server` and shell constructs rely on the agent runtime |
| Install container/entrypoint | Partial | Stored; unusual entrypoints warn |
| `config.files` parsing | Partial | Stored as features; first key only is surfaced as `configFile` |
| Startup done-pattern / logs | Partial | Stored as detection features |
| `eula`, `pid_limit`, `java_version` | Ignored (carried as feature strings) | Not acted on, except disk hints |
| Secondary ports (query/RCON/TV) | Not imported | Only the primary port is stored |
| Memory/CPU sizing | Generic | `1024` MB / `2` cores — tune per template |
| `copy_script_from`, `config.extends`, `sortable`, `_comment` | Ignored | Not stored |
| Live server migration | Not supported | Eggs import as templates; existing Pterodactyl servers, files, and databases are not migrated — recreate servers from the imported template |

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `422 Egg validation failed: MISSING_IMAGES` | Egg has no `docker_images`/`images` | Add at least one image mapping |
| `422 MISSING_STARTUP` | Empty `startup` | Provide the egg's start command |
| `422 DUPLICATE_VARIABLE` / `MISSING_VAR_NAME` | Malformed `variables[]` | Ensure each variable has a unique `env_variable` |
| `422 CIRCULAR_VARIABLE_REF` | Defaults reference each other (`A={{B}}`, `B={{A}}`) | Break the cycle |
| `422 INSTALL_SCRIPT_TOO_LARGE` | Script >1 MiB | Trim or host assets externally |
| `409` duplicate name | Template exists | Rename the egg or delete the existing template |
| Import succeeds with `UNKNOWN_STOP_SIGNAL` warning | Exotic stop character | Confirm the `SIGTERM` fallback is acceptable, or set an explicit signal |
| Wrong default Java image (e.g. Paper) | First-key-wins mapping | Edit the template and set the right default image |
| Server asks for a port the template lacks | Only primary port imported | Add query/RCON ports as bindings at server creation |
| `502 Failed to fetch egg list` | Bad `repoUrl` or GitHub unreachable | Check the repo URL and network |

## After import

1. Open the template, verify the default image, startup command, and variables.
2. Adjust memory/CPU defaults and supported ports.
3. Create a test server from the template and watch the **Console** tab during install.
4. Promote the template for general use only after a clean install + start cycle.
