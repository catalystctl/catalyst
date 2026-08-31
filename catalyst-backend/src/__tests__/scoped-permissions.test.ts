import { describe, it, expect } from "vitest";
import { mergeServerPermissions } from "../lib/permissions-catalog";
import { ALL_SERVER_PERMISSIONS } from "../lib/permissions-catalog";

describe("mergeServerPermissions — scoped role grants", () => {
  it("unions global perms with server and node grant rows", () => {
    const result = mergeServerPermissions(
      ["server.create", "node.read"],
      [["file.write", "console.read"]],
      [["server.start"]]
    );
    expect(result.sort()).toEqual(
      ["server.create", "node.read", "file.write", "console.read", "server.start"].sort()
    );
  });

  it("deduplicates across grant rows", () => {
    const result = mergeServerPermissions(
      [],
      [["file.write"]],
      [["file.write", "console.read"]]
    );
    expect(result.sort()).toEqual(["file.write", "console.read"].sort());
  });

  it("returns global perms untouched when there are no grants", () => {
    const result = mergeServerPermissions(["admin.write"], [], []);
    expect(result).toEqual(["admin.write"]);
  });

  it("includes wildcard node grants alongside specific ones", () => {
    const result = mergeServerPermissions(
      [],
      [],
      [["server.start"], ["backup.create"]]
    );
    expect(result.sort()).toEqual(["server.start", "backup.create"].sort());
  });
});

describe("ALL_SERVER_PERMISSIONS — catalog integrity", () => {
  it("is a non-empty, unique list", () => {
    expect(ALL_SERVER_PERMISSIONS.length).toBeGreaterThan(0);
    expect(new Set(ALL_SERVER_PERMISSIONS).size).toBe(ALL_SERVER_PERMISSIONS.length);
  });

  it("contains the permissions the role wizard grants", () => {
    for (const perm of [
      "server.read",
      "server.start",
      "server.stop",
      "console.write",
      "file.write",
      "backup.create",
      "server.schedule",
    ]) {
      expect(ALL_SERVER_PERMISSIONS).toContain(perm);
    }
  });
});
