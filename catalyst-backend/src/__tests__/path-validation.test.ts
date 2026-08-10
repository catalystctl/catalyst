/**
 * Regression tests for path normalization / traversal collapse.
 * Pure unit tests — no DB, no filesystem.
 */
import { describe, it, expect } from "vitest";
import {
  normalizeRequestPath,
  validateAndNormalizePath,
  validateServerId,
} from "../lib/path-validation";

const SERVER_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

describe("normalizeRequestPath", () => {
  it("defaults empty / missing to root", () => {
    expect(normalizeRequestPath()).toBe("/");
    expect(normalizeRequestPath("")).toBe("/");
    expect(normalizeRequestPath("   ")).toBe("/");
    expect(normalizeRequestPath(".")).toBe("/");
  });

  it("collapses parent segments inside the virtual root", () => {
    expect(normalizeRequestPath("/a/../b")).toBe("/b");
    expect(normalizeRequestPath("/a/b/../c")).toBe("/a/c");
    expect(normalizeRequestPath("/a/./b/../c")).toBe("/a/c");
  });

  it("never escapes above root via leading ..", () => {
    expect(normalizeRequestPath("../etc/passwd")).toBe("/etc/passwd");
    expect(normalizeRequestPath("/../../etc/passwd")).toBe("/etc/passwd");
    expect(normalizeRequestPath("..")).toBe("/");
    expect(normalizeRequestPath("/..")).toBe("/");
    expect(normalizeRequestPath("/../../../")).toBe("/");
  });

  it("normalizes backslashes and repeated slashes", () => {
    expect(normalizeRequestPath("\\a\\b\\c")).toBe("/a/b/c");
    expect(normalizeRequestPath("//a///b//")).toBe("/a/b");
  });

  it("rejects null bytes in path segments", () => {
    expect(() => normalizeRequestPath("/a/\0b")).toThrow(/Invalid path/);
  });
});

describe("validateAndNormalizePath", () => {
  it("keeps collapsed paths inside the server jail", () => {
    expect(validateAndNormalizePath("/world/../server.properties", SERVER_ID)).toBe(
      "/server.properties",
    );
    expect(validateAndNormalizePath("plugins/./LuckPerms/../config.yml", SERVER_ID)).toBe(
      "/plugins/config.yml",
    );
  });

  it("does not allow host absolute paths after collapse", () => {
    // Leading .. collapses under logical root; result is still a server-relative path.
    expect(validateAndNormalizePath("../../etc/passwd", SERVER_ID)).toBe("/etc/passwd");
  });

  it("defaults undefined path to root", () => {
    expect(validateAndNormalizePath(undefined, SERVER_ID)).toBe("/");
  });

  it("rejects null bytes in the original path", () => {
    expect(() => validateAndNormalizePath("/a\0b", SERVER_ID)).toThrow(/Invalid path/);
  });

  it("rejects invalid server ids via the full validator", () => {
    expect(() => validateAndNormalizePath("/plugins", "not-a-uuid")).toThrow(
      /Invalid server ID/,
    );
    expect(() => validateAndNormalizePath("/", "")).toThrow(/Invalid server ID/);
    expect(() => validateServerId("not-a-uuid")).toThrow(/Invalid server ID/);
    expect(() => validateServerId("")).toThrow(/Invalid server ID/);
  });

  it("accepts dashed UUID server ids", () => {
    expect(() => validateServerId(SERVER_ID)).not.toThrow();
    expect(validateAndNormalizePath("/plugins", SERVER_ID)).toBe("/plugins");
  });
});
