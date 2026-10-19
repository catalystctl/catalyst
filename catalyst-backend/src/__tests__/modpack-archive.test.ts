import { describe, it, expect } from "vitest";
import {
  assertSafeRelativePath,
  classifyModpack,
  curseforgeLoader,
  detectArchiveContainer,
  isSupportedModpackArchive,
  normalizeEntryName,
  parseCurseforgeManifest,
  parseMrpackIndex,
  planArchiveOverrides,
  planCurseforgeFiles,
  planMrpackFiles,
  ModpackArchiveError,
} from "../lib/modpack-archive";

const zipMagic = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
const gzipMagic = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00]);
const xzMagic = Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]);
const bzip2Magic = Buffer.from([0x42, 0x5a, 0x68, 0x39, 0x31, 0x41, 0x59]);

const file = (name: string, size = 10) => ({ name, isDirectory: false, size });
const dir = (name: string) => ({ name, isDirectory: true });

describe("archive container detection", () => {
  it("recognises the modpack containers we advertise", () => {
    expect(detectArchiveContainer("pack.zip")).toBe("zip");
    expect(detectArchiveContainer("pack.mrpack")).toBe("zip");
    expect(detectArchiveContainer("pack.mr")).toBe("zip");
    expect(detectArchiveContainer("pack.tar")).toBe("tar");
    expect(detectArchiveContainer("pack.tar.gz")).toBe("tar");
    expect(detectArchiveContainer("pack.tgz")).toBe("tar");
    expect(detectArchiveContainer("pack.tar.xz")).toBe("tar");
    expect(detectArchiveContainer("pack.tar.zst")).toBe("tar");
  });

  it("is case-insensitive and rejects containers the agent cannot unpack", () => {
    expect(detectArchiveContainer("PACK.ZIP")).toBe("zip");
    expect(detectArchiveContainer("Pack.MrPack")).toBe("zip");
    expect(detectArchiveContainer("pack.7z")).toBe("unknown");
    expect(detectArchiveContainer("pack.rar")).toBe("unknown");
    expect(detectArchiveContainer("pack.jar")).toBe("unknown");
    expect(detectArchiveContainer("pack")).toBe("unknown");
  });

  it("trusts magic bytes over a misleading extension", () => {
    // A .mrpack renamed to .tar must still be unzipped, or the agent feeds it
    // to tar and fails.
    expect(detectArchiveContainer("pack.tar", zipMagic)).toBe("zip");
    expect(detectArchiveContainer("pack.zip", gzipMagic)).toBe("tar");
    expect(detectArchiveContainer("pack.zip", xzMagic)).toBe("tar");
    expect(detectArchiveContainer("pack.zip", bzip2Magic)).toBe("tar");
    // No extension at all, but a valid zip.
    expect(detectArchiveContainer("upload.bin", zipMagic)).toBe("zip");
  });

  it("falls back to the extension when magic bytes are absent or too short", () => {
    expect(detectArchiveContainer("pack.zip", Buffer.from([0x50]))).toBe("zip");
    expect(detectArchiveContainer("pack.tar.gz", undefined)).toBe("tar");
  });

  it("reports support for installable archives only", () => {
    expect(isSupportedModpackArchive("a.zip")).toBe(true);
    expect(isSupportedModpackArchive("a.7z")).toBe(false);
  });
});

describe("pack layout classification", () => {
  it("detects an .mrpack by its root index", () => {
    expect(classifyModpack("zip", [file("modrinth.index.json"), dir("overrides")])).toBe("mrpack");
  });

  it("detects a CurseForge pack by its root manifest", () => {
    expect(classifyModpack("zip", [file("manifest.json"), dir("overrides")])).toBe("curseforge");
  });

  it("treats a zip with no root manifest as a generic archive", () => {
    expect(classifyModpack("zip", [dir("mods"), file("mods/foo.jar")])).toBe("generic-zip");
  });

  it("ignores manifests nested below the root", () => {
    // A mod jar containing its own manifest.json must not be mistaken for a pack.
    expect(classifyModpack("zip", [file("mods/lib/manifest.json")])).toBe("generic-zip");
  });

  it("is case-insensitive about the manifest name", () => {
    expect(classifyModpack("zip", [file("Modrinth.Index.JSON")])).toBe("mrpack");
    expect(classifyModpack("zip", [file("./manifest.json")])).toBe("curseforge");
  });

  it("classifies tar containers as tar regardless of contents", () => {
    expect(classifyModpack("tar", [file("manifest.json")])).toBe("tar");
    expect(classifyModpack("unknown", [file("manifest.json")])).toBe("unknown");
  });
});

describe("normalizeEntryName", () => {
  it("strips ./ prefixes, trailing slashes and backslashes", () => {
    expect(normalizeEntryName("./mods/foo.jar")).toBe("mods/foo.jar");
    expect(normalizeEntryName("overrides/")).toBe("overrides");
    expect(normalizeEntryName("mods\\foo.jar")).toBe("mods/foo.jar");
  });
});

describe("path safety", () => {
  it("accepts ordinary relative paths", () => {
    expect(assertSafeRelativePath("mods/foo.jar")).toBe("mods/foo.jar");
    expect(assertSafeRelativePath("./config/x.toml")).toBe("config/x.toml");
  });

  it("rejects absolute, traversal and empty paths", () => {
    for (const bad of ["/etc/passwd", "../escape.jar", "mods/../../x", "C:\\x", "", "   ", "a//b"]) {
      expect(() => assertSafeRelativePath(bad)).toThrow(ModpackArchiveError);
    }
  });

  it("rejects non-strings and null bytes", () => {
    expect(() => assertSafeRelativePath(undefined)).toThrow(ModpackArchiveError);
    expect(() => assertSafeRelativePath(42)).toThrow(ModpackArchiveError);
    expect(() => assertSafeRelativePath("mods/a\0b.jar")).toThrow(ModpackArchiveError);
  });
});

describe(".mrpack index", () => {
  const validIndex = {
    formatVersion: 1,
    game: "minecraft",
    versionId: "1.0.0",
    name: "Test Pack",
    files: [
      {
        path: "mods/sodium.jar",
        hashes: { sha1: "abc", sha512: "def" },
        env: { client: "required", server: "unsupported" },
        downloads: ["https://cdn.example/sodium.jar"],
        fileSize: 1234,
      },
      {
        path: "mods/lithium.jar",
        hashes: { sha1: "ghi" },
        env: { client: "required", server: "required" },
        downloads: ["https://cdn.example/lithium.jar"],
        fileSize: 99,
      },
      {
        path: "mods/nodl.jar",
        env: { server: "required" },
        downloads: [],
      },
    ],
    dependencies: { minecraft: "1.20.1", "fabric-loader": "0.15.0" },
  };

  it("rejects a non-v1 formatVersion", () => {
    expect(() => parseMrpackIndex({ ...validIndex, formatVersion: 2 })).toThrow(
      /Unsupported .mrpack formatVersion 2/,
    );
    expect(() => parseMrpackIndex({ files: [] })).toThrow(/no formatVersion/);
  });

  it("rejects a body without a files array", () => {
    expect(() => parseMrpackIndex({ formatVersion: 1 })).toThrow(/no files array/);
    expect(() => parseMrpackIndex(null)).toThrow(ModpackArchiveError);
  });

  it("drops client-only files so a server pack does not get shaders", () => {
    const { files, skipped } = planMrpackFiles(parseMrpackIndex(validIndex));
    expect(files.map((f) => f.path)).toEqual(["mods/lithium.jar"]);
    expect(skipped).toEqual([
      { path: "mods/sodium.jar", reason: "client-only" },
      { path: "mods/nodl.jar", reason: "no-download" },
    ]);
  });

  it("carries hashes and size through for verification", () => {
    const { files } = planMrpackFiles(parseMrpackIndex(validIndex));
    expect(files[0]).toMatchObject({
      path: "mods/lithium.jar",
      url: "https://cdn.example/lithium.jar",
      hashes: { sha1: "ghi" },
      size: 99,
    });
  });

  it("skips files whose declared path escapes the server root", () => {
    const { files, skipped } = planMrpackFiles(
      parseMrpackIndex({
        formatVersion: 1,
        files: [
          { path: "../../etc/cron.d/x", downloads: ["https://e/x"] },
          { path: "/etc/passwd", downloads: ["https://e/y"] },
          { path: "mods/ok.jar", downloads: ["https://e/z"] },
        ],
      }),
    );
    expect(files.map((f) => f.path)).toEqual(["mods/ok.jar"]);
    expect(skipped.every((s) => s.reason === "unsafe-path")).toBe(true);
    expect(skipped).toHaveLength(2);
  });
});

describe("CurseForge manifest", () => {
  const validManifest = {
    minecraft: {
      version: "1.20.1",
      modLoaders: [
        { id: "forge-47.2.0", primary: false },
        { id: "neoforge-20.4.1", primary: true },
      ],
    },
    manifestType: "minecraftModpack",
    manifestVersion: 1,
    name: "CF Pack",
    version: "2.1.0",
    files: [
      { projectID: 238222, fileID: 4566, required: true },
      { projectID: 0, fileID: 0, required: true },
    ],
    overrides: "overrides",
  };

  it("rejects a manifest.json that is not a modpack", () => {
    expect(() => parseCurseforgeManifest({ files: [] })).toThrow(/no minecraft block/);
    expect(() => parseCurseforgeManifest({ minecraft: {} })).toThrow(/no files array/);
  });

  it("parses metadata and the primary loader", () => {
    const manifest = parseCurseforgeManifest(validManifest);
    expect(manifest.name).toBe("CF Pack");
    expect(manifest.minecraft.version).toBe("1.20.1");
    expect(curseforgeLoader(manifest)).toBe("neoforge");
    expect(manifest.overrides).toBe("overrides");
  });

  it("plans mods into /mods and skips unresolvable entries", () => {
    const { files, skipped } = planCurseforgeFiles(parseCurseforgeManifest(validManifest));
    expect(files).toEqual([
      { path: "mods/238222-4566.jar", projectId: "238222", fileId: "4566" },
    ]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].reason).toBe("no-download");
  });

  it("defaults overrides to the conventional directory", () => {
    expect(parseCurseforgeManifest({ minecraft: {}, files: [] }).overrides).toBe("overrides");
  });
});

describe("embedded overrides", () => {
  const entries = [
    file("overrides/config/foo.toml"),
    file("overrides/mods/extra.jar"),
    file("overrides/client-overrides/config/client.toml"),
    file("client-overrides/config/client.toml"),
    file("modrinth.index.json"),
    dir("overrides"),
  ];

  it("maps overrides/ into the server root and drops client-only files", () => {
    expect(planArchiveOverrides(entries)).toEqual([
      { from: "overrides/config/foo.toml", to: "config/foo.toml" },
      { from: "overrides/mods/extra.jar", to: "mods/extra.jar" },
    ]);
  });

  it("honours a custom overrides directory name", () => {
    const custom = [file("packroot/config/bar.toml")];
    expect(planArchiveOverrides(custom, "packroot")).toEqual([
      { from: "packroot/config/bar.toml", to: "config/bar.toml" },
    ]);
  });

  it("is case-insensitive about the overrides directory", () => {
    expect(planArchiveOverrides([file("Overrides/config/x.toml")])).toEqual([
      { from: "Overrides/config/x.toml", to: "config/x.toml" },
    ]);
  });

  it("returns nothing when the pack has no overrides", () => {
    expect(planArchiveOverrides([file("mods/a.jar")])).toEqual([]);
  });
});
