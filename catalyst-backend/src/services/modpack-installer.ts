/**
 * Catalyst - Modpack install orchestration.
 *
 * The node agent is the only process that can touch a server's files, so an
 * install is a sequence of file-tunnel operations: unpack the archive, place
 * the manifest's files, fold the pack's `overrides/` into the server root, then
 * remove the pack scaffolding.
 *
 * All I/O goes through an injected tunnel function so the whole sequence can be
 * exercised against a simulated filesystem in tests — the ordering and the
 * collision handling are the parts that actually break servers.
 */
import {
  assertSafeRelativePath,
  classifyModpack,
  curseforgeLoader,
  detectArchiveContainer,
  ModpackArchiveError,
  normalizeEntryName,
  parseCurseforgeManifest,
  parseMrpackIndex,
  planArchiveOverrides,
  planCurseforgeFiles,
  planMrpackFiles,
  type ArchiveContainer,
  type ArchiveEntryLike,
  type ModpackFormat,
  type PlannedModFile,
} from "../lib/modpack-archive.js";

export interface TunnelResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

/** One file-tunnel round trip. */
export type TunnelOp = (
  operation: string,
  filePath: string,
  data?: Record<string, unknown>,
) => Promise<TunnelResult>;

export interface ModpackInstallProgress {
  phase: "extracting" | "installing-files" | "applying-overrides" | "finalizing";
  completed: number;
  total: number;
}

export interface ModpackInstallRequest {
  tunnel: TunnelOp;
  /** Server-jail path of the already-downloaded archive. */
  archivePath: string;
  /** Server-jail directory the pack is installed into (usually "/"). */
  targetPath: string;
  /** Original archive filename, used for container detection. */
  filename: string;
  /** Sniffed magic bytes when the caller has them (uploads do). */
  magic?: Buffer;
  /** Resolve a provider-specific download URL for a planned file. */
  resolveDownload?: (file: PlannedModFile) => Promise<string | null>;
  onProgress?: (progress: ModpackInstallProgress) => void;
}

export interface ModpackInstallResult {
  format: ModpackFormat;
  container: ArchiveContainer;
  name?: string;
  version?: string;
  gameVersion?: string;
  modLoader?: string;
  /** Files written from provider downloads. */
  installedFiles: string[];
  /** Override files moved into place. */
  installedOverrides: number;
  /** Entries deliberately not installed. */
  skipped: Array<{ path: string; reason: string }>;
  /** Non-fatal problems (a single mod that could not be fetched). */
  warnings: string[];
}

const MANIFEST_NAMES = ["modrinth.index.json", "manifest.json"] as const;

function joinPath(base: string, relative: string): string {
  const left = base.replace(/\/+$/, "");
  const right = relative.replace(/^\/+/, "");
  if (!left) return `/${right}`;
  return `${left}/${right}`;
}

function normalizeDir(value: string): string {
  const cleaned = value.replace(/\\/g, "/").replace(/\/+$/, "");
  return cleaned.length === 0 ? "/" : cleaned;
}

/**
 * Find a pack whose manifest is one level down (`<wrapper>/modrinth.index.json`).
 *
 * Only used to reinterpret an archive that classified as generic. It requires
 * exactly one top-level directory, so a flat archive such as `mods/` + a stray
 * file can never be mistaken for a wrapper and have its contents hoisted.
 */
export function detectWrappedManifest(
  entries: ArchiveEntryLike[],
): { wrapper: string; format: "mrpack" | "curseforge" } | null {
  const roots = new Set<string>();
  for (const entry of entries) {
    const name = normalizeEntryName(entry.name);
    if (!name) continue;
    const [first] = name.split("/");
    if (first) roots.add(first);
  }
  if (roots.size !== 1) return null;
  const [wrapper] = [...roots];
  if (!wrapper) return null;

  const wrapperLower = wrapper.toLowerCase();
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const name = normalizeEntryName(entry.name).toLowerCase();
    if (!name.startsWith(`${wrapperLower}/`)) continue;
    const relative = name.slice(wrapperLower.length + 1);
    if (relative === "modrinth.index.json") return { wrapper, format: "mrpack" };
    if (relative === "manifest.json") return { wrapper, format: "curseforge" };
  }
  return null;
}

export class ModpackInstaller {
  constructor(private readonly request: ModpackInstallRequest) {}

  private get tunnel(): TunnelOp {
    return this.request.tunnel;
  }

  private async op(
    operation: string,
    filePath: string,
    data?: Record<string, unknown>,
  ): Promise<TunnelResult> {
    const result = await this.tunnel(operation, filePath, data);
    if (!result?.success) {
      throw new ModpackArchiveError(
        `${operation} failed for ${filePath}: ${result?.error ?? "unknown error"}`,
        "empty-pack",
      );
    }
    return result;
  }

  /** List an archive without extracting it. */
  async inspect(): Promise<{
    container: ArchiveContainer;
    format: ModpackFormat;
    entries: ArchiveEntryLike[];
    wrapper: string | null;
  }> {
    const container = detectArchiveContainer(this.request.filename, this.request.magic);
    if (container === "unknown") {
      throw new ModpackArchiveError(
        `Unsupported modpack archive "${this.request.filename}" (supported: .zip, .mrpack, .mr, .tar, .tar.gz, .tgz, .tar.xz, .tar.bz2)`,
        "unsupported-format",
      );
    }

    const result = await this.op("archive-contents", this.request.archivePath);
    const entries: ArchiveEntryLike[] = Array.isArray(result.data)
      ? (result.data as any[]).map((entry) => ({
          name: String(entry?.name ?? ""),
          isDirectory: Boolean(entry?.isDirectory),
          size: typeof entry?.size === "number" ? entry.size : undefined,
        }))
      : [];

    if (entries.length === 0) {
      throw new ModpackArchiveError("Archive is empty", "empty-pack");
    }

    let format = classifyModpack(container, entries);
    let wrapper: string | null = null;
    if (format === "generic-zip" || format === "tar") {
      // A pack re-zipped inside a folder: the manifest is one level down.
      const wrapped = detectWrappedManifest(entries);
      if (wrapped) {
        format = wrapped.format;
        wrapper = wrapped.wrapper;
      }
    }

    return { container, format, entries, wrapper };
  }

  /**
   * Move every child of `fromDir` into `toDir`, merging where the destination
   * already exists.
   *
   * `rename` covers a whole subtree in one round trip, so this only recurses
   * into the directories that actually collide — a fresh server needs one
   * rename per top-level entry, an existing one a few more.
   */
  async mergeDirectory(fromDir: string, toDir: string): Promise<number> {
    const listing = await this.op("list", fromDir);
    const children = Array.isArray(listing.data) ? (listing.data as any[]) : [];
    let moved = 0;

    for (const child of children) {
      const name = String(child?.name ?? "");
      if (!name) continue;
      const source = joinPath(fromDir, name);
      const destination = joinPath(toDir, name);

      try {
        await this.op("rename", source, { to: destination });
        moved += 1;
      } catch (error) {
        if (!child?.isDirectory) throw error;
        // The destination exists and is a directory: merge into it.
        await this.mergeDirectory(source, destination);
        moved += 1;
      }
    }

    return moved;
  }

  /** Best-effort cleanup that never masks the original failure. */
  private async remove(path: string): Promise<void> {
    try {
      await this.tunnel("delete", path);
    } catch {
      /* leaving scaffolding behind is preferable to failing the install */
    }
  }

  async install(): Promise<ModpackInstallResult> {
    const { format, container, entries, wrapper } = await this.inspect();
    const target = normalizeDir(this.request.targetPath);
    const progress = this.request.onProgress ?? (() => {});
    const isManifestPack = format === "mrpack" || format === "curseforge";
    const extractRoot = wrapper ? joinPath(target, wrapper) : target;

    progress({ phase: "extracting", completed: 0, total: 1 });
    // The agent's extractor writes into an existing directory, so a configured
    // install subdirectory has to exist first (the root always does).
    if (target !== "/") {
      await this.op("create", target, { isDirectory: true });
    }
    await this.op("decompress", this.request.archivePath, { targetPath: target });
    progress({ phase: "extracting", completed: 1, total: 1 });

    const result: ModpackInstallResult = {
      format,
      container,
      installedFiles: [],
      installedOverrides: 0,
      skipped: [],
      warnings: [],
    };

    if (isManifestPack) {
      await this.applyManifest(result, extractRoot, target, progress);
    }

    // Fold the pack's overrides into the server root. They are applied after
    // the manifest files so a pack author's bundled config wins.
    const overridesDir = `${wrapper ? `${wrapper}/` : ""}overrides`;
    const overrides = planArchiveOverrides(entries, overridesDir);
    if (overrides.length > 0) {
      const total = overrides.length;
      progress({ phase: "applying-overrides", completed: 0, total });
      await this.mergeIfPresent(joinPath(extractRoot, "overrides"), target);
      result.installedOverrides = total;
      progress({ phase: "applying-overrides", completed: total, total });
    }

    if (isManifestPack) {
      // Pack metadata and scaffolding must not be left in the server root.
      for (const name of [...MANIFEST_NAMES, "modlist.html"]) {
        await this.remove(joinPath(extractRoot, name));
      }
      await this.remove(joinPath(extractRoot, "overrides"));
      await this.remove(joinPath(extractRoot, "client-overrides"));
    }

    if (wrapper) {
      // Anything else bundled inside the wrapper (a `mods/`, `config/`, …) is
      // real pack content: hoist it before dropping the wrapper directory,
      // otherwise deleting the wrapper destroys it.
      await this.mergeIfPresent(extractRoot, target);
      await this.remove(joinPath(target, wrapper));
    }

    progress({ phase: "finalizing", completed: 1, total: 1 });
    return result;
  }

  /** Merge `fromDir` into `target`, tolerating a missing source directory. */
  private async mergeIfPresent(fromDir: string, target: string): Promise<void> {
    const listing = await this.tunnel("list", fromDir);
    if (!listing?.success) return; // no overrides directory: normal
    await this.mergeDirectory(fromDir, target);
  }

  private async applyManifest(
    result: ModpackInstallResult,
    extractRoot: string,
    target: string,
    progress: (progress: ModpackInstallProgress) => void,
  ): Promise<void> {
    const manifestName = result.format === "mrpack" ? "modrinth.index.json" : "manifest.json";
    const manifestPath = joinPath(extractRoot, manifestName);

    let files: PlannedModFile[] = [];
    try {
      const downloaded = await this.op("download", manifestPath);
      const raw = JSON.parse(this.extractBody(downloaded.data));

      if (result.format === "mrpack") {
        const index = parseMrpackIndex(raw);
        result.name = index.name;
        result.version = index.versionId;
        result.gameVersion = index.dependencies?.minecraft;
        result.modLoader = loaderFromDependencies(index.dependencies ?? {});
        const planned = planMrpackFiles(index);
        files = planned.files;
        result.skipped.push(...planned.skipped);
      } else {
        const manifest = parseCurseforgeManifest(raw);
        result.name = manifest.name;
        result.version = manifest.version;
        result.gameVersion = manifest.minecraft.version;
        result.modLoader = curseforgeLoader(manifest);
        const planned = planCurseforgeFiles(manifest);
        files = planned.files;
        result.skipped.push(...planned.skipped);
      }
    } catch (error: any) {
      if (error instanceof ModpackArchiveError) throw error;
      throw new ModpackArchiveError(
        `Cannot read ${manifestName}: ${error?.message ?? error}`,
        "invalid-manifest",
      );
    }

    const total = files.length;
    let completed = 0;
    progress({ phase: "installing-files", completed, total });

    for (const file of files) {
      let url = file.url ?? null;
      if (!url && this.request.resolveDownload) {
        url = await this.request.resolveDownload(file);
      }
      if (!url) {
        result.warnings.push(`No download available for ${file.path}`);
        completed += 1;
        progress({ phase: "installing-files", completed, total });
        continue;
      }

      const destination = joinPath(target, assertSafeRelativePath(file.path));
      try {
        await this.op("install-url", destination, { url });
        result.installedFiles.push(file.path);
      } catch (error: any) {
        // One unreachable mod must not abort a 200-mod pack.
        result.warnings.push(`${file.path}: ${error?.message ?? "download failed"}`);
      }
      completed += 1;
      progress({ phase: "installing-files", completed, total });
    }
  }

  /** The `download` op returns either a buffer wrapper or raw text. */
  private extractBody(data: unknown): string {
    if (typeof data === "string") return data;
    if (Buffer.isBuffer(data)) return data.toString("utf8");
    if (data && typeof data === "object") {
      const record = data as Record<string, unknown>;
      if (typeof record.content === "string") return record.content;
      if (typeof record.body === "string") return record.body;
      if (Buffer.isBuffer(record.body)) return record.body.toString("utf8");
    }
    throw new ModpackArchiveError("Manifest download returned no content", "invalid-manifest");
  }
}

function loaderFromDependencies(dependencies: Record<string, string>): string | undefined {
  if (dependencies["fabric-loader"]) return "fabric";
  if (dependencies["quilt-loader"]) return "quilt";
  if (dependencies.forge) return "forge";
  if (dependencies.neoforge) return "neoforge";
  return undefined;
}
