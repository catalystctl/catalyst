import { describe, it, expect } from "vitest";
import { mergeServerPermissions } from "../lib/permissions-catalog";
import {
  ALL_PERMISSIONS,
  ALL_SERVER_PERMISSIONS,
  expandPermissionAliases,
  isValidPermission,
} from "../lib/permissions-catalog";

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

  it("contains the wave-1 server-scoped additions", () => {
    for (const perm of [
      "server.clone",
      "server.kill",
      "server.network",
      "server.storage",
      "server.archive",
      "server.migrate",
      "mods.manage",
      "plugins.manage",
    ]) {
      expect(ALL_SERVER_PERMISSIONS).toContain(perm);
    }
  });

  it("excludes panel-tier values", () => {
    // Panel-level capabilities are global grants, not subuser grants.
    for (const perm of [
      "server.create",
      "server.suspend",
      "node.server_manage",
      "node.agent_control",
      "apikey.read",
      "apikey.write",
      "admin.read",
      "migration.manage",
    ]) {
      expect(ALL_SERVER_PERMISSIONS).not.toContain(perm);
    }
  });
});

describe("isValidPermission — acceptance and rejection (wave 1)", () => {
  it("accepts '*', every catalog value, and legacy split values", () => {
    expect(isValidPermission("*")).toBe(true);
    for (const perm of ALL_PERMISSIONS) {
      expect(isValidPermission(perm)).toBe(true);
    }
    for (const perm of [
      "apikey.manage",
      "server.update",
      "node.update",
      "server.suspend",
      "server.transfer",
      "server.create",
      "server.stop",
    ]) {
      expect(isValidPermission(perm)).toBe(true);
    }
  });

  it("accepts scoped forms of valid values", () => {
    expect(isValidPermission("server.read:srv_123")).toBe(true);
    expect(isValidPermission("node.delete:node_abc")).toBe(true);
    expect(isValidPermission("node.read:node_1:extra")).toBe(true);
    expect(isValidPermission("apikey.manage:k1")).toBe(true);
  });

  it("rejects unknown strings and malformed scopes", () => {
    expect(isValidPermission("")).toBe(false);
    expect(isValidPermission("file.sftp")).toBe(false); // deliberately not a permission
    expect(isValidPermission("foo.bar")).toBe(false);
    expect(isValidPermission("server.read:")).toBe(false);
    expect(isValidPermission("*:node_1")).toBe(false);
    expect(isValidPermission("uncataloged.read")).toBe(false);
  });
});

describe("expandPermissionAliases — effective-set mapping (wave 1)", () => {
  it("emits the stored value plus its split targets", () => {
    expect(expandPermissionAliases("server.stop")).toEqual(["server.stop", "server.kill"]);
    expect(expandPermissionAliases("server.update")).toEqual([
      "server.update", "server.network", "server.storage",
    ]);
    expect(expandPermissionAliases("apikey.manage")).toEqual([
      "apikey.manage", "apikey.read", "apikey.write",
    ]);
  });

  it("preserves scope suffixes on the emitted targets", () => {
    expect(expandPermissionAliases("node.update:node_1")).toEqual([
      "node.update:node_1",
      "node.server_manage:node_1",
      "node.agent_control:node_1",
    ]);
  });

  it("passes non-legacy values through untouched", () => {
    expect(expandPermissionAliases("server.read")).toEqual(["server.read"]);
    expect(expandPermissionAliases("mods.manage")).toEqual(["mods.manage"]);
    expect(expandPermissionAliases("server.read:srv_1")).toEqual(["server.read:srv_1"]);
  });
});
