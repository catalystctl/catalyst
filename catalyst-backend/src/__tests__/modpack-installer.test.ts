import { describe, it, expect, vi } from "vitest";
import { ModpackInstaller, detectWrappedManifest } from "../services/modpack-installer";
import type { TunnelOp, TunnelResult } from "../services/modpack-installer";
import type { ArchiveEntryLike } from "../lib/modpack-archive";

/**
 * A fake node agent filesystem.
 *
 * Models the three behaviours the installer depends on and that are easy to get
 * wrong: `rename` onto an existing directory fails (so merges must recurse),
 * `delete` removes a tree, and `decompress` writes the archive's members under
 * the target directory.
 */
class FakeNode {
  files = new Map<string, { kind: "file" | "dir"; content?: string }>();
  ops: Array<{ operation: string; path: string }> = [];
  installed: Array<{ path: string; url: string }> = [];

  constructor(
    private archiveEntries: ArchiveEntryLike[],
    private archiveContents: Record<string, string> = {},
  ) {
    this.files.set("/", { kind: "dir" });
  }

  seedDir(path: string) {
    const parts = path.split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current += `/${part}`;
      if (!this.files.has(current)) this.files.set(current, { kind: "dir" });
    }
  }

  seedFile(path: string, content = "") {
    const parent = path.slice(0, path.lastIndexOf("/")) || "/";
    this.seedDir(parent);
    this.files.set(path, { kind: "file", content });
  }

  private parent(path: string) {
    return path.slice(0, path.lastIndexOf("/")) || "/";
  }

  private children(dir: string) {
    const prefix = dir === "/" ? "/" : `${dir}/`;
    const names = new Map<string, { kind: "file" | "dir" }>();
    for (const [path, entry] of this.files) {
      if (path === "/" || !path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      if (rest.length === 0) continue;
      const [first] = rest.split("/");
      if (!first) continue;
      const isDir = rest.includes("/") || entry.kind === "dir";
      names.set(first, { kind: isDir ? "dir" : "file" });
    }
    return names;
  }

  tunnel: TunnelOp = async (operation, path, data): Promise<TunnelResult> => {
    this.ops.push({ operation, path });
    switch (operation) {
      case "archive-contents":
        return { success: true, data: this.archiveEntries };

      case "decompress": {
        const target = String((data as any)?.targetPath ?? "/");
        this.seedDir(target);
        for (const entry of this.archiveEntries) {
          const full = `${target === "/" ? "" : target}/${entry.name}`.replace(/\/+/g, "/");
          if (entry.isDirectory) this.seedDir(full);
          else this.seedFile(full, this.archiveContents[entry.name] ?? "x");
        }
        return { success: true };
      }

      case "create": {
        if ((data as any)?.isDirectory) this.seedDir(path);
        else this.seedFile(path, String((data as any)?.content ?? ""));
        return { success: true };
      }

      case "list": {
        if (!this.files.has(path)) {
          return { success: false, error: `ENOENT: ${path}` };
        }
        if (this.files.get(path)!.kind !== "dir") {
          return { success: false, error: `ENOTDIR: ${path}` };
        }
        const data = [...this.children(path)].map(([name, entry]) => ({
          name,
          isDirectory: entry.kind === "dir",
          size: 0,
        }));
        return { success: true, data };
      }

      case "rename": {
        const to = String((data as any)?.to ?? "");
        const source = this.files.get(path);
        if (!source) return { success: false, error: `ENOENT: ${path}` };
        if (this.files.has(to)) {
          // POSIX rename replaces a file but refuses a non-empty directory.
          const dest = this.files.get(to)!;
          if (dest.kind === "dir") {
            return { success: false, error: `ENOTEMPTY: ${to}` };
          }
          this.files.delete(to);
        }
        this.seedDir(this.parent(to));
        // Move the whole subtree.
        for (const [existing, entry] of [...this.files]) {
          if (existing === path || existing.startsWith(`${path}/`)) {
            this.files.delete(existing);
            this.files.set(`${to}${existing.slice(path.length)}`, entry);
          }
        }
        return { success: true };
      }

      case "delete": {
        if (!this.files.has(path)) return { success: false, error: `ENOENT: ${path}` };
        for (const existing of [...this.files.keys()]) {
          if (existing === path || existing.startsWith(`${path}/`)) {
            this.files.delete(existing);
          }
        }
        return { success: true };
      }

      case "download": {
        const entry = this.files.get(path);
        if (!entry) return { success: false, error: `ENOENT: ${path}` };
        return { success: true, data: Buffer.from(entry.content ?? "") };
      }

      case "install-url": {
        const url = String((data as any)?.url ?? "");
        this.installed.push({ path, url });
        this.seedFile(path, `downloaded:${url}`);
        return { success: true };
      }

      default:
        return { success: false, error: `unsupported op ${operation}` };
    }
  };

  /** File paths only; directories are implied by their contents. */
  paths(): string[] {
    return [...this.files.entries()]
      .filter(([path, entry]) => path !== "/" && entry.kind === "file")
      .map(([path]) => path)
      .sort();
  }
}

const mrpackEntries: ArchiveEntryLike[] = [
  { name: "modrinth.index.json", isDirectory: false },
  { name: "overrides/config/mod.toml", isDirectory: false },
  { name: "overrides/mods/bundled.jar", isDirectory: false },
  { name: "client-overrides/config/client.toml", isDirectory: false },
];

const mrpackIndex = {
  formatVersion: 1,
  game: "minecraft",
  versionId: "1.2.0",
  name: "My Pack",
  files: [
    {
      path: "mods/fabric-api.jar",
      hashes: { sha1: "aaa" },
      env: { client: "required", server: "required" },
      downloads: ["https://cdn.example/fabric-api.jar"],
      fileSize: 100,
    },
    {
      path: "mods/sodium.jar",
      hashes: { sha1: "bbb" },
      env: { client: "required", server: "unsupported" },
      downloads: ["https://cdn.example/sodium.jar"],
    },
  ],
  dependencies: { minecraft: "1.20.1", "fabric-loader": "0.15.0" },
};

function makeMrpack() {
  return new FakeNode(mrpackEntries, {
    "modrinth.index.json": JSON.stringify(mrpackIndex),
  });
}

describe("ModpackInstaller — .mrpack", () => {
  it("installs manifest files, folds overrides into the root, and cleans up", async () => {
    const node = makeMrpack();
    const installer = new ModpackInstaller({
      tunnel: node.tunnel,
      archivePath: "/pack.mrpack",
      targetPath: "/",
      filename: "pack.mrpack",
    });

    const result = await installer.install();

    expect(result.format).toBe("mrpack");
    expect(result.name).toBe("My Pack");
    expect(result.version).toBe("1.2.0");
    expect(result.gameVersion).toBe("1.20.1");
    expect(result.modLoader).toBe("fabric");
    expect(result.installedFiles).toEqual(["mods/fabric-api.jar"]);
    expect(result.installedOverrides).toBe(2);

    // The server root holds the mods and the overrides, not the pack layout.
    expect(node.paths()).toEqual([
      "/config/mod.toml",
      "/mods/bundled.jar",
      "/mods/fabric-api.jar",
    ]);
  });

  it("never installs client-only files", async () => {
    const node = makeMrpack();
    const installer = new ModpackInstaller({
      tunnel: node.tunnel,
      archivePath: "/pack.mrpack",
      targetPath: "/",
      filename: "pack.mrpack",
    });
    const result = await installer.install();

    expect(result.installedFiles).not.toContain("mods/sodium.jar");
    expect(result.skipped).toContainEqual({ path: "mods/sodium.jar", reason: "client-only" });
    expect(node.installed.map((i) => i.url)).toEqual(["https://cdn.example/fabric-api.jar"]);
    expect(node.paths().some((p) => p.includes("client"))).toBe(false);
  });

  it("reports progress in install order", async () => {
    const node = makeMrpack();
    const phases: string[] = [];
    const installer = new ModpackInstaller({
      tunnel: node.tunnel,
      archivePath: "/pack.mrpack",
      targetPath: "/",
      filename: "pack.mrpack",
      onProgress: (p) => phases.push(p.phase),
    });
    await installer.install();

    expect(phases[0]).toBe("extracting");
    expect(phases).toContain("installing-files");
    expect(phases).toContain("applying-overrides");
    expect(phases[phases.length - 1]).toBe("finalizing");
  });

  it("keeps going when one mod cannot be downloaded", async () => {
    const node = makeMrpack();
    const failing: TunnelOp = async (operation, path, data) => {
      if (operation === "install-url") {
        return { success: false, error: "HTTP 404" };
      }
      return node.tunnel(operation, path, data);
    };

    const result = await new ModpackInstaller({
      tunnel: failing,
      archivePath: "/pack.mrpack",
      targetPath: "/",
      filename: "pack.mrpack",
    }).install();

    expect(result.installedFiles).toEqual([]);
    expect(result.warnings.join(" ")).toContain("HTTP 404");
  });
});

describe("ModpackInstaller — CurseForge manifest", () => {
  const entries: ArchiveEntryLike[] = [
    { name: "manifest.json", isDirectory: false },
    { name: "overrides/config/cf.toml", isDirectory: false },
    { name: "mods/embedded.jar", isDirectory: false },
  ];

  const manifest = {
    minecraft: { version: "1.19.2", modLoaders: [{ id: "forge-43.2.0", primary: true }] },
    manifestType: "minecraftModpack",
    manifestVersion: 1,
    name: "CF Pack",
    version: "3.0.0",
    files: [{ projectID: 111, fileID: 222, required: true }],
  };

  it("resolves provider URLs and lands mods in /mods", async () => {
    const node = new FakeNode(entries, { "manifest.json": JSON.stringify(manifest) });
    const resolveDownload = vi.fn(async () => "https://cf.example/111/222.jar");

    const result = await new ModpackInstaller({
      tunnel: node.tunnel,
      archivePath: "/cf.zip",
      targetPath: "/",
      filename: "cf.zip",
      resolveDownload,
    }).install();

    expect(result.format).toBe("curseforge");
    expect(result.name).toBe("CF Pack");
    expect(result.gameVersion).toBe("1.19.2");
    expect(result.modLoader).toBe("forge");
    expect(resolveDownload).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "111", fileId: "222" }),
    );
    expect(node.paths()).toContain("/mods/111-222.jar");
    expect(node.paths()).toContain("/config/cf.toml");
  });

  it("warns instead of failing when no download can be resolved", async () => {
    const node = new FakeNode(entries, { "manifest.json": JSON.stringify(manifest) });
    const result = await new ModpackInstaller({
      tunnel: node.tunnel,
      archivePath: "/cf.zip",
      targetPath: "/",
      filename: "cf.zip",
      resolveDownload: async () => null,
    }).install();

    expect(result.warnings.join(" ")).toContain("No download available");
    expect(result.installedFiles).toEqual([]);
  });
});

describe("ModpackInstaller — generic archives", () => {
  it("extracts a flat zip as-is", async () => {
    const entries: ArchiveEntryLike[] = [
      { name: "mods", isDirectory: true },
      { name: "mods/a.jar", isDirectory: false },
      { name: "server.properties", isDirectory: false },
    ];
    const node = new FakeNode(entries);
    const result = await new ModpackInstaller({
      tunnel: node.tunnel,
      archivePath: "/generic.zip",
      targetPath: "/",
      filename: "generic.zip",
    }).install();

    expect(result.format).toBe("generic-zip");
    expect(node.paths()).toEqual(["/mods/a.jar", "/server.properties"]);
  });

  it("does not hoist a lone mods directory out of a flat archive", async () => {
    // A single top-level dir is ambiguous; only a manifest inside it proves
    // the archive is wrapped.
    const entries: ArchiveEntryLike[] = [
      { name: "mods", isDirectory: true },
      { name: "mods/a.jar", isDirectory: false },
    ];
    const node = new FakeNode(entries);
    await new ModpackInstaller({
      tunnel: node.tunnel,
      archivePath: "/x.zip",
      targetPath: "/",
      filename: "x.zip",
    }).install();

    expect(node.paths()).toEqual(["/mods/a.jar"]);
  });

  it("installs into a target subdirectory, creating it first", async () => {
    const entries: ArchiveEntryLike[] = [{ name: "mods/a.jar", isDirectory: false }];
    const node = new FakeNode(entries);
    await new ModpackInstaller({
      tunnel: node.tunnel,
      archivePath: "/x.zip",
      targetPath: "/modpacks",
      filename: "x.zip",
    }).install();

    // The agent's extractor refuses a missing target directory, so it is
    // created before the archive is handed over.
    const createIndex = node.ops.findIndex((op) => op.operation === "create");
    const decompressIndex = node.ops.findIndex((op) => op.operation === "decompress");
    expect(node.ops[createIndex]).toEqual({ operation: "create", path: "/modpacks" });
    expect(createIndex).toBeLessThan(decompressIndex);
    expect(node.paths()).toEqual(["/modpacks/mods/a.jar"]);
  });

  it("rejects containers the agent cannot unpack", async () => {
    const node = new FakeNode([]);
    await expect(
      new ModpackInstaller({
        tunnel: node.tunnel,
        archivePath: "/x.7z",
        targetPath: "/",
        filename: "x.7z",
      }).install(),
    ).rejects.toThrow(/Unsupported modpack archive/);
    // The archive was never handed to the extractor.
    expect(node.ops).toEqual([]);
  });

  it("rejects an empty archive", async () => {
    const node = new FakeNode([]);
    await expect(
      new ModpackInstaller({
        tunnel: node.tunnel,
        archivePath: "/x.zip",
        targetPath: "/",
        filename: "x.zip",
      }).install(),
    ).rejects.toThrow(/Archive is empty/);
  });
});

describe("ModpackInstaller — wrapped packs", () => {
  const entries: ArchiveEntryLike[] = [
    { name: "MyPack/modrinth.index.json", isDirectory: false },
    { name: "MyPack/overrides/config/w.toml", isDirectory: false },
    { name: "MyPack/mods/local.jar", isDirectory: false },
  ];

  it("detects a manifest one level down", () => {
    expect(detectWrappedManifest(entries)).toEqual({ wrapper: "MyPack", format: "mrpack" });
    expect(detectWrappedManifest([{ name: "mods/a.jar", isDirectory: false }])).toBeNull();
  });

  it("installs a wrapped pack and removes the wrapper directory", async () => {
    const node = new FakeNode(entries, {
      "MyPack/modrinth.index.json": JSON.stringify({
        formatVersion: 1,
        files: [
          {
            path: "mods/net.jar",
            downloads: ["https://cdn.example/net.jar"],
            env: { server: "required" },
          },
        ],
        dependencies: { minecraft: "1.20.1" },
      }),
    });

    const result = await new ModpackInstaller({
      tunnel: node.tunnel,
      archivePath: "/wrapped.zip",
      targetPath: "/",
      filename: "wrapped.zip",
    }).install();

    expect(result.format).toBe("mrpack");
    expect(node.paths()).toEqual(["/config/w.toml", "/mods/local.jar", "/mods/net.jar"]);
    expect(node.paths().some((p) => p.startsWith("/MyPack"))).toBe(false);
  });
});

describe("ModpackInstaller — merge collisions", () => {
  it("merges into an existing directory instead of failing the install", async () => {
    const entries: ArchiveEntryLike[] = [
      { name: "modrinth.index.json", isDirectory: false },
      { name: "overrides/config/existing.toml", isDirectory: false },
      { name: "overrides/config/new.toml", isDirectory: false },
    ];
    const node = new FakeNode(entries, {
      "modrinth.index.json": JSON.stringify({ formatVersion: 1, files: [] }),
    });
    // The server already has a config directory with a file of its own.
    node.seedFile("/config/server.properties", "keep-me");

    await new ModpackInstaller({
      tunnel: node.tunnel,
      archivePath: "/p.mrpack",
      targetPath: "/",
      filename: "p.mrpack",
    }).install();

    expect(node.paths()).toEqual([
      "/config/existing.toml",
      "/config/new.toml",
      "/config/server.properties",
    ]);
    // Pre-existing server content survives.
    expect(node.files.get("/config/server.properties")?.content).toBe("keep-me");
  });
});
