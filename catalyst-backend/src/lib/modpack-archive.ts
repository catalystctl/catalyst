/**
 * Catalyst - Modpack archive recognition and install planning.
 *
 * Pure functions only: no I/O, no DB, no network. The route layer feeds them
 * the agent's `archive-contents` listing and the provider manifest bodies, so
 * every decision that can silently corrupt a server (which files to install,
 * where they land, what to skip) is unit-testable in isolation.
 *
 * Supported containers are the ones the node agent can actually unpack: zip
 * (including `.mrpack`, which is a zip with a `modrinth.index.json`) and tar
 * (any compression GNU tar auto-detects). Anything else is rejected here
 * rather than handed to the agent, which would try to read a 7z/rar as tar.
 */

/** Container the agent's extractor understands. */
export type ArchiveContainer = "zip" | "tar" | "unknown";

/** Recognised pack layouts. `generic-zip`/`tar` are plain archives. */
export type ModpackFormat = "mrpack" | "curseforge" | "generic-zip" | "tar" | "unknown";

export interface ArchiveEntryLike {
  name: string;
  isDirectory: boolean;
  size?: number;
}

export interface PlannedModFile {
  /** Archive-declared path relative to the server root, validated. */
  path: string;
  /** Download URL when the manifest carries one directly (Modrinth). */
  url?: string;
  /** Provider hashes, used to resolve a download URL (Modrinth). */
  hashes?: Record<string, string>;
  /** CurseForge numeric ids, resolved through the provider API. */
  projectId?: string;
  fileId?: string;
  size?: number;
}

export interface SkippedModFile {
  path: string;
  reason: "client-only" | "no-download" | "unsafe-path" | "optional-missing";
}

export interface ModpackPlan {
  format: ModpackFormat;
  /** Files fetched from the network. */
  files: PlannedModFile[];
  skipped: SkippedModFile[];
  /** Embedded override files to move into place after extraction. */
  overrides: Array<{ from: string; to: string }>;
  /** Pack metadata surfaced to the UI. */
  name?: string;
  version?: string;
  gameVersion?: string;
  modLoader?: string;
  /** Count of entries the plan will place (files + overrides). */
  totalFiles: number;
}

export class ModpackArchiveError extends Error {
  constructor(
    message: string,
    readonly reason:
      | "unsupported-format"
      | "invalid-manifest"
      | "unsafe-path"
      | "empty-pack",
  ) {
    super(message);
    this.name = "ModpackArchiveError";
  }
}

const ZIP_EXTENSIONS = new Set([".zip", ".mrpack", ".mr"]);
const TAR_EXTENSIONS = new Set([
  ".tar",
  ".tar.gz",
  ".tgz",
  ".tar.xz",
  ".txz",
  ".tar.bz2",
  ".tbz2",
  ".tar.zst",
  ".tzst",
]);

/**
 * Strip a leading `./` and trailing slashes so archive listings from different
 * tools compare equal. Member names are case-folded because packs exported on
 * Windows routinely disagree on the case of `Modrinth.index.json`.
 */
export function normalizeEntryName(name: string): string {
  return name
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+$/, "")
    .trim();
}

function extensionOf(filename: string): string {
  const lower = filename.toLowerCase();
  // Longest match first so `.tar.gz` is not reported as `.gz`.
  const twoPart = lower.match(/\.(tar\.(?:gz|xz|bz2|zst))$/);
  if (twoPart) return `.${twoPart[1]}`;
  const onePart = lower.match(/(\.[a-z0-9]+)$/);
  return onePart ? onePart[1] : "";
}

/**
 * Decide which extractor the agent will use. The agent keys off the filename
 * suffix (`.zip` → unzip, everything else → tar), so this must agree with it.
 * When magic bytes are supplied they win: a `.mrpack` renamed to `.tar` must
 * still be unzipped, and a truncated upload is rejected instead of misread.
 */
export function detectArchiveContainer(filename: string, magic?: Buffer): ArchiveContainer {
  if (magic && magic.length >= 4) {
    if (magic[0] === 0x50 && magic[1] === 0x4b) return "zip";
    if (magic[0] === 0x1f && magic[1] === 0x8b) return "tar";
    if (magic[0] === 0x42 && magic[1] === 0x5a && magic[2] === 0x68) return "tar";
    if (magic[0] === 0xfd && magic[1] === 0x37 && magic[2] === 0x7a) return "tar";
    if (magic.length >= 262 && magic.subarray(257, 262).toString("latin1") === "ustar") {
      return "tar";
    }
  }

  const ext = extensionOf(filename);
  if (ZIP_EXTENSIONS.has(ext)) return "zip";
  if (TAR_EXTENSIONS.has(ext)) return "tar";
  return "unknown";
}

/** True when the filename has a container we can install. */
export function isSupportedModpackArchive(filename: string, magic?: Buffer): boolean {
  return detectArchiveContainer(filename, magic) !== "unknown";
}

/**
 * Identify the pack layout from a root-level listing.
 *
 * Only root-level manifests count: a `manifest.json` buried in a nested folder
 * belongs to some bundled library, not to the pack.
 */
export function classifyModpack(
  container: ArchiveContainer,
  entries: ArchiveEntryLike[],
): ModpackFormat {
  if (container === "unknown") return "unknown";

  const rootFiles = new Set(
    entries
      .filter((entry) => !entry.isDirectory)
      .map((entry) => normalizeEntryName(entry.name).toLowerCase())
      .filter((name) => name.length > 0 && !name.includes("/")),
  );

  if (container === "zip") {
    if (rootFiles.has("modrinth.index.json")) return "mrpack";
    if (rootFiles.has("manifest.json")) return "curseforge";
    return "generic-zip";
  }
  return "tar";
}

/**
 * Reject any archive-declared path that could escape the server root or name a
 * path the agent refuses. Returns the normalized relative path.
 */
export function assertSafeRelativePath(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ModpackArchiveError("Archive entry has no path", "unsafe-path");
  }
  if (value.includes("\0")) {
    throw new ModpackArchiveError("Archive entry contains a null byte", "unsafe-path");
  }
  const normalized = normalizeEntryName(value);
  if (normalized.length === 0) {
    throw new ModpackArchiveError("Archive entry has an empty path", "unsafe-path");
  }
  if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) {
    throw new ModpackArchiveError(`Archive entry is absolute: ${value}`, "unsafe-path");
  }
  const segments = normalized.split("/");
  for (const segment of segments) {
    if (segment === ".." || segment === "." || segment.length === 0) {
      throw new ModpackArchiveError(`Archive entry escapes the root: ${value}`, "unsafe-path");
    }
  }
  return normalized;
}

// ── Modrinth `.mrpack` ───────────────────────────────────────────────────

export interface MrpackIndexFile {
  path: string;
  hashes?: Record<string, string>;
  env?: { client?: string; server?: string };
  downloads?: string[];
  fileSize?: number;
}

export interface MrpackIndex {
  formatVersion: number;
  game: string;
  versionId?: string;
  name?: string;
  files: MrpackIndexFile[];
  dependencies?: Record<string, string>;
}

/**
 * Validate a `modrinth.index.json` body. Modrinth's spec requires
 * `formatVersion: 1`; anything else is a pack format we do not understand.
 */
export function parseMrpackIndex(raw: unknown): MrpackIndex {
  if (!raw || typeof raw !== "object") {
    throw new ModpackArchiveError("modrinth.index.json is not an object", "invalid-manifest");
  }
  const value = raw as Record<string, unknown>;
  const formatVersion = Number(value.formatVersion);
  if (!Number.isFinite(formatVersion)) {
    throw new ModpackArchiveError("modrinth.index.json has no formatVersion", "invalid-manifest");
  }
  if (formatVersion !== 1) {
    throw new ModpackArchiveError(
      `Unsupported .mrpack formatVersion ${formatVersion}`,
      "invalid-manifest",
    );
  }
  if (!Array.isArray(value.files)) {
    throw new ModpackArchiveError("modrinth.index.json has no files array", "invalid-manifest");
  }

  const files: MrpackIndexFile[] = [];
  for (const entry of value.files) {
    if (!entry || typeof entry !== "object") continue;
    const file = entry as Record<string, unknown>;
    const path = typeof file.path === "string" ? file.path : "";
    const hashes =
      file.hashes && typeof file.hashes === "object"
        ? Object.fromEntries(
            Object.entries(file.hashes as Record<string, unknown>)
              .filter(([, v]) => typeof v === "string")
              .map(([k, v]) => [k, String(v)]),
          )
        : undefined;
    const downloads = Array.isArray(file.downloads)
      ? file.downloads.filter((url): url is string => typeof url === "string")
      : [];
    const env =
      file.env && typeof file.env === "object"
        ? (file.env as { client?: string; server?: string })
        : undefined;
    files.push({
      path,
      hashes,
      downloads,
      env,
      fileSize: typeof file.fileSize === "number" ? file.fileSize : undefined,
    });
  }

  return {
    formatVersion,
    game: typeof value.game === "string" ? value.game : "minecraft",
    versionId: typeof value.versionId === "string" ? value.versionId : undefined,
    name: typeof value.name === "string" ? value.name : undefined,
    files,
    dependencies:
      value.dependencies && typeof value.dependencies === "object"
        ? (value.dependencies as Record<string, string>)
        : undefined,
  };
}

/** Map Modrinth's `dependencies` block onto a human loader label. */
function mrpackLoader(index: MrpackIndex): string | undefined {
  const deps = index.dependencies ?? {};
  if (deps["fabric-loader"]) return "fabric";
  if (deps["quilt-loader"]) return "quilt";
  if (deps.forge) return "forge";
  if (deps.neoforge) return "neoforge";
  return undefined;
}

/**
 * Turn a `.mrpack` index into installable files.
 *
 * `env.server === "unsupported"` files are client-only (shaders, client mods)
 * and must never be written to a server: installing them is the classic
 * "pack installed but the server crashes on boot" failure.
 */
export function planMrpackFiles(index: MrpackIndex): {
  files: PlannedModFile[];
  skipped: SkippedModFile[];
} {
  const files: PlannedModFile[] = [];
  const skipped: SkippedModFile[] = [];

  for (const entry of index.files) {
    let target: string;
    try {
      target = assertSafeRelativePath(entry.path);
    } catch {
      skipped.push({ path: String(entry.path ?? ""), reason: "unsafe-path" });
      continue;
    }
    if (entry.env?.server === "unsupported") {
      skipped.push({ path: target, reason: "client-only" });
      continue;
    }
    const url = entry.downloads?.[0];
    if (!url) {
      skipped.push({ path: target, reason: "no-download" });
      continue;
    }
    files.push({
      path: target,
      url,
      hashes: entry.hashes,
      size: entry.fileSize,
    });
  }

  return { files, skipped };
}

// ── CurseForge `manifest.json` ───────────────────────────────────────────

export interface CurseforgeManifestFile {
  projectID?: number;
  fileID?: number;
  required?: boolean;
}

export interface CurseforgeManifest {
  minecraft: {
    version?: string;
    modLoaders?: Array<{ id?: string; primary?: boolean }>;
  };
  files: CurseforgeManifestFile[];
  overrides?: string;
  name?: string;
  version?: string;
}

/**
 * Validate a CurseForge `manifest.json`. The `minecraft` block is what
 * distinguishes a pack manifest from the many unrelated `manifest.json`
 * files that ship inside mods.
 */
export function parseCurseforgeManifest(raw: unknown): CurseforgeManifest {
  if (!raw || typeof raw !== "object") {
    throw new ModpackArchiveError("manifest.json is not an object", "invalid-manifest");
  }
  const value = raw as Record<string, unknown>;
  const minecraft = value.minecraft;
  if (!minecraft || typeof minecraft !== "object") {
    throw new ModpackArchiveError(
      "manifest.json has no minecraft block (not a CurseForge modpack)",
      "invalid-manifest",
    );
  }
  if (!Array.isArray(value.files)) {
    throw new ModpackArchiveError("manifest.json has no files array", "invalid-manifest");
  }

  const mc = minecraft as Record<string, unknown>;
  const loaders = Array.isArray(mc.modLoaders)
    ? mc.modLoaders
        .filter((loader): loader is Record<string, unknown> => !!loader && typeof loader === "object")
        .map((loader) => ({
          id: typeof loader.id === "string" ? loader.id : undefined,
          primary: loader.primary === true,
        }))
    : [];

  const files: CurseforgeManifestFile[] = [];
  for (const entry of value.files) {
    if (!entry || typeof entry !== "object") continue;
    const file = entry as Record<string, unknown>;
    files.push({
      projectID: Number.isFinite(Number(file.projectID)) ? Number(file.projectID) : undefined,
      fileID: Number.isFinite(Number(file.fileID)) ? Number(file.fileID) : undefined,
      required: file.required !== false,
    });
  }

  return {
    minecraft: {
      version: typeof mc.version === "string" ? mc.version : undefined,
      modLoaders: loaders,
    },
    files,
    overrides: typeof value.overrides === "string" ? value.overrides : "overrides",
    name: typeof value.name === "string" ? value.name : undefined,
    version: typeof value.version === "string" ? value.version : undefined,
  };
}

/**
 * Turn a CurseForge manifest into installable files.
 *
 * CurseForge does not record the destination path, so mods land in `/mods` —
 * the only location the format defines for them. `projectID: 0` entries are
 * "download from a URL the user pasted" and cannot be resolved here.
 */
export function planCurseforgeFiles(manifest: CurseforgeManifest): {
  files: PlannedModFile[];
  skipped: SkippedModFile[];
} {
  const files: PlannedModFile[] = [];
  const skipped: SkippedModFile[] = [];

  for (const entry of manifest.files) {
    if (!entry.projectID || !entry.fileID) {
      skipped.push({ path: `project:${entry.projectID ?? "?"}`, reason: "no-download" });
      continue;
    }
    files.push({
      path: `mods/${entry.projectID}-${entry.fileID}.jar`,
      projectId: String(entry.projectID),
      fileId: String(entry.fileID),
    });
  }

  return { files, skipped };
}

/** Best-effort loader label from a CurseForge manifest. */
export function curseforgeLoader(manifest: CurseforgeManifest): string | undefined {
  const loaders = manifest.minecraft.modLoaders ?? [];
  const primary = loaders.find((loader) => loader.primary) ?? loaders[0];
  if (!primary?.id) return undefined;
  // Ids look like "forge-47.2.0" / "fabric-0.15.0"; keep the loader name.
  const [loader] = primary.id.split("-");
  return loader ? loader.toLowerCase() : undefined;
}

// ── Embedded overrides ───────────────────────────────────────────────────

/**
 * Collect the files under a pack's overrides directory.
 *
 * `overrides/` is shared by both sides and belongs on the server.
 * `client-overrides/` is client-only and must be dropped. CurseForge's
 * `overrides` field may name a different directory.
 */
export function planArchiveOverrides(
  entries: ArchiveEntryLike[],
  overridesDir = "overrides",
): Array<{ from: string; to: string }> {
  const root = normalizeEntryName(overridesDir).toLowerCase();
  const result: Array<{ from: string; to: string }> = [];

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const name = normalizeEntryName(entry.name);
    const lower = name.toLowerCase();
    if (!lower.startsWith(`${root}/`)) continue;
    const relative = name.slice(root.length + 1);
    if (relative.length === 0) continue;
    // Drop client-only overrides: they are never server files.
    if (relative.toLowerCase().startsWith("client-overrides/")) continue;
    try {
      result.push({ from: name, to: assertSafeRelativePath(relative) });
    } catch {
      // Unsafe override paths are skipped rather than aborting the install.
    }
  }

  return result;
}

/** Count files under a directory prefix, used for UI summaries. */
export function countEntriesUnder(entries: ArchiveEntryLike[], prefix: string): number {
  const root = normalizeEntryName(prefix).toLowerCase();
  return entries.filter((entry) => {
    if (entry.isDirectory) return false;
    return normalizeEntryName(entry.name).toLowerCase().startsWith(`${root}/`);
  }).length;
}
