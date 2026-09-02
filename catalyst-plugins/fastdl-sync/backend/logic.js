/**
 * FastDL sync — pure logic (no I/O).
 *
 * Everything here is deterministic and unit-testable: path classification,
 * exclusion matching, file-list diffing, and sv_downloadurl computation.
 * The I/O layer (backend/sync-engine.js) calls these helpers.
 */

// ── Downloadable content locations, by game family ────────────────────────────
//
// HL1 (GoldSrc) and HL2 (Source) engines download client content from a fixed
// set of directories relative to the game's mod dir (cstrike, garrysmod, tf2,
// ...). Everything else on the server (configs, addons, logs, demos) must NOT
// be published by a FastDL host.

/** Directories scanned inside each game dir (Source + GoldSrc union). */
const CONTENT_DIRS = new Set([
  // Maps & WADs (GoldSrc maps reference .wad files at gamedir root)
  'maps',
  // Models / sprites / textures
  'models',
  'sprites',
  'resource',
  'materials',
  'particles',
  'sound',
  'media',
  // Fonts and HUD resources (Source)
  'fonts',
  // GoldSrc misc
  'overviews',
  'events',
  'gfx',
]);

/** File extensions downloadable at the game dir ROOT (e.g. cstrike/*.wad). */
const ROOT_EXTENSIONS = new Set(['.wad']);

/** Never publish, regardless of location. Filenames are matched case-insensitively. */
const DENYLIST_BASENAMES = new Set([
  'server.cfg',
  'autoexec.cfg',
  'listenserver.cfg',
  'banned_user.cfg',
  'banned_ip.cfg',
  'motd.txt',
  'motd_default.txt',
  'mapcycle.txt',
  'maplist.txt',
  'adminlist.txt',
  'server.vdf',
  'gameinfo.txt',
  'liblist.gam',
  'users.ini',
]);

/** Files whose BASENAME ends with these are never published. */
const DENYLIST_SUFFIXES = ['.log', '.dem', '.vpk.tmp', '.bak', '.tmp'];

/**
 * Classify a path (relative to the server data root) as downloadable content.
 * Expected shape: `<gamedir>/<rest...>`. e.g.
 *   cstrike/maps/de_dust2.bsp          -> true
 *   cstrike/de_chateau.wad             -> true (root .wad)
 *   cstrike/cfg/server.cfg             -> false
 *   cstrike/server.cfg                 -> false (denylist)
 *   garrysmod/addons/someplugin/lua/x.lua -> false (not a content dir)
 *   undecidable/root.txt (no gamedir)  -> false
 */
export function isDownloadableContent(relPath) {
  const parts = String(relPath).split('/').filter(Boolean);
  if (parts.length < 2) return false; // must live inside a game dir

  // Denylist applies to the basename wherever it appears.
  const base = parts[parts.length - 1].toLowerCase();
  if (DENYLIST_BASENAMES.has(base)) return false;
  if (DENYLIST_SUFFIXES.some((s) => base.endsWith(s))) return false;

  const gameDir = parts[0];
  const rest = parts.slice(1);

  // Root of the game dir: only .wad files are standard download content.
  if (rest.length === 1) {
    return [...ROOT_EXTENSIONS].some((ext) => base.endsWith(ext));
  }

  // Otherwise the next segment must be a known content directory.
  const topDir = rest[0].toLowerCase();
  return CONTENT_DIRS.has(topDir);
}

/**
 * Extract the game dir (mod folder) from a server-relative path, or null.
 *   cstrike/maps/x.bsp -> cstrike
 *   lonefile.txt       -> null
 */
export function gameDirOf(relPath) {
  const parts = String(relPath).split('/').filter(Boolean);
  return parts.length >= 2 ? parts[0] : null;
}

/**
 * Map a source-server relative path to its FastDL docroot-relative location.
 * FastDL clients request `<gamedir>/<path>`, and the FastDL egg serves
 * `./fastdl/` as docroot — so files land in `fastdl/<gamedir>/<path>`.
 * Returns null for non-downloadable content.
 */
export function mapToFastdlPath(relPath) {
  if (!isDownloadableContent(relPath)) return null;
  return `fastdl/${relPath}`;
}

// ── Diffing ────────────────────────────────────────────────────────────────────

/**
 * Compare source scan vs last-synced state.
 *
 * @param {Map<string, {size:number, mtimeMs:number}>} source  current files (relPath -> stat)
 * @param {Record<string, {size:number, mtimeMs:number, etag?:string}>} state  last-synced snapshot
 * @returns {{ toCopy: string[], toDelete: string[], unchanged: number }}
 *   toCopy: source files that are new or changed
 *   toDelete: state entries whose source file disappeared
 */
export function diffFileLists(source, state) {
  const toCopy = [];
  for (const [path, stat] of source) {
    const prev = state[path];
    if (!prev || prev.size !== stat.size || prev.mtimeMs !== stat.mtimeMs) {
      toCopy.push(path);
    }
  }
  const toDelete = Object.keys(state).filter((path) => !source.has(path));
  return { toCopy, toDelete, unchanged: source.size - toCopy.length };
}

// ── sv_downloadurl ────────────────────────────────────────────────────────────

/**
 * Build the sv_downloadurl value for a FastDL server.
 * HL1/Source only support plain HTTP; the panel's primaryIp:primaryPort is
 * what the egg binds.
 */
export function buildDownloadUrl(primaryIp, primaryPort) {
  const ip = primaryIp && primaryIp !== '0.0.0.0' ? primaryIp : '<node-public-ip>';
  return `http://${ip}:${primaryPort}`;
}
