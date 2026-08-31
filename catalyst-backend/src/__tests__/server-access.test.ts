/**
 * Regression: node assignment alone must NOT bypass ensureServerAccess.
 * Tests the pure decideServerAccess helper extracted from ensureServerAccess.
 */
import { describe, it, expect } from "vitest";
import { decideServerAccess, isFullAdminRole, canManageViaNode } from "../lib/server-access";

describe("decideServerAccess — node-access no longer bypasses", () => {
  it("allows the server owner without extra grants", () => {
    const result = decideServerAccess({
      isOwner: true,
      hasExplicitServerAccess: false,
      rolePermissions: [],
      hasNodeAccess: false,
    });
    expect(result).toEqual({ allowed: true, reason: "owner" });
  });

  it("allows explicit per-server ServerAccess grants", () => {
    const result = decideServerAccess({
      isOwner: false,
      hasExplicitServerAccess: true,
      rolePermissions: [],
      hasNodeAccess: false,
    });
    expect(result).toEqual({ allowed: true, reason: "server_access" });
  });

  it("allows global wildcard / admin.write", () => {
    expect(
      decideServerAccess({
        isOwner: false,
        hasExplicitServerAccess: false,
        rolePermissions: ["*"],
        hasNodeAccess: false,
      }),
    ).toEqual({ allowed: true, reason: "admin" });

    expect(
      decideServerAccess({
        isOwner: false,
        hasExplicitServerAccess: false,
        rolePermissions: ["admin.write"],
        hasNodeAccess: false,
      }),
    ).toEqual({ allowed: true, reason: "admin" });
  });

  it("DENIES node access alone (the historical bypass)", () => {
    const result = decideServerAccess({
      isOwner: false,
      hasExplicitServerAccess: false,
      rolePermissions: ["node.read", "server.read"],
      hasNodeAccess: true,
    });
    expect(result.allowed).toBe(false);
    expect(result).toEqual({ allowed: false, reason: "forbidden" });
  });

  it("DENIES node access with only admin.read (not write)", () => {
    const result = decideServerAccess({
      isOwner: false,
      hasExplicitServerAccess: false,
      rolePermissions: ["admin.read"],
      hasNodeAccess: true,
    });
    expect(result.allowed).toBe(false);
  });

  it("allows node access only when paired with node.update", () => {
    const result = decideServerAccess({
      isOwner: false,
      hasExplicitServerAccess: false,
      rolePermissions: ["node.update"],
      hasNodeAccess: true,
    });
    expect(result).toEqual({ allowed: true, reason: "node_manage" });
  });

  it("DENIES node.update without hasNodeAccess", () => {
    const result = decideServerAccess({
      isOwner: false,
      hasExplicitServerAccess: false,
      rolePermissions: ["node.update"],
      hasNodeAccess: false,
    });
    expect(result.allowed).toBe(false);
  });

  it("DENIES completely unprivileged users", () => {
    const result = decideServerAccess({
      isOwner: false,
      hasExplicitServerAccess: false,
      rolePermissions: [],
      hasNodeAccess: false,
    });
    expect(result.allowed).toBe(false);
  });

  it("owner wins even when other flags are falsey", () => {
    const result = decideServerAccess({
      isOwner: true,
      hasExplicitServerAccess: false,
      rolePermissions: [],
      hasNodeAccess: false,
    });
    expect(result.reason).toBe("owner");
  });

  it("DENIES server.read alone without ownership or grants", () => {
    const result = decideServerAccess({
      isOwner: false,
      hasExplicitServerAccess: false,
      rolePermissions: ["server.read", "server.start", "file.write"],
      hasNodeAccess: false,
    });
    expect(result).toEqual({ allowed: false, reason: "forbidden" });
  });

  it("explicit ServerAccess wins over bare node assignment", () => {
    const result = decideServerAccess({
      isOwner: false,
      hasExplicitServerAccess: true,
      rolePermissions: ["server.read"],
      hasNodeAccess: true,
    });
    expect(result).toEqual({ allowed: true, reason: "server_access" });
  });
});

describe("isFullAdminRole / canManageViaNode helpers", () => {
  it("isFullAdminRole requires * or admin.write (not admin.read)", () => {
    expect(isFullAdminRole(["*"])).toBe(true);
    expect(isFullAdminRole(["admin.write"])).toBe(true);
    expect(isFullAdminRole(["admin.read"])).toBe(false);
    expect(isFullAdminRole(["node.update"])).toBe(false);
    expect(isFullAdminRole([])).toBe(false);
  });

  it("canManageViaNode requires both assignment and node.update", () => {
    expect(canManageViaNode(true, ["node.update"])).toBe(true);
    expect(canManageViaNode(true, ["node.read"])).toBe(false);
    expect(canManageViaNode(false, ["node.update"])).toBe(false);
    expect(canManageViaNode(false, [])).toBe(false);
  });
});

describe("decideServerAccess — requiredPermission (global role grants)", () => {
  it("allows when a global role grants the exact required permission", () => {
    const result = decideServerAccess({
      isOwner: false,
      hasExplicitServerAccess: false,
      rolePermissions: ["server.start"],
      hasNodeAccess: false,
      requiredPermission: "server.start",
    });
    expect(result).toEqual({ allowed: true, reason: "role_permission" });
  });

  it("denies when the role holds a DIFFERENT server permission", () => {
    const result = decideServerAccess({
      isOwner: false,
      hasExplicitServerAccess: false,
      rolePermissions: ["server.start"],
      hasNodeAccess: false,
      requiredPermission: "server.stop",
    });
    expect(result).toEqual({ allowed: false, reason: "forbidden" });
  });

  it("denies when requiredPermission is set but no role grant exists", () => {
    const result = decideServerAccess({
      isOwner: false,
      hasExplicitServerAccess: false,
      rolePermissions: [],
      hasNodeAccess: false,
      requiredPermission: "backup.create",
    });
    expect(result).toEqual({ allowed: false, reason: "forbidden" });
  });

  it("admin.write still wins over a missing required permission", () => {
    const result = decideServerAccess({
      isOwner: false,
      hasExplicitServerAccess: false,
      rolePermissions: ["admin.write"],
      hasNodeAccess: false,
      requiredPermission: "backup.create",
    });
    expect(result).toEqual({ allowed: true, reason: "admin" });
  });

  it("explicit ServerAccess grants access regardless of requiredPermission", () => {
    // The caller is responsible for checking the access row's permissions;
    // the decision only distinguishes the grant source.
    const result = decideServerAccess({
      isOwner: false,
      hasExplicitServerAccess: true,
      rolePermissions: [],
      hasNodeAccess: false,
      requiredPermission: "file.write",
    });
    expect(result).toEqual({ allowed: true, reason: "server_access" });
  });

  it("role_permission is checked before the node_manage path", () => {
    const result = decideServerAccess({
      isOwner: false,
      hasExplicitServerAccess: false,
      rolePermissions: ["server.start", "node.update"],
      hasNodeAccess: true,
      requiredPermission: "server.start",
    });
    expect(result).toEqual({ allowed: true, reason: "role_permission" });
  });

  it("node_manage still applies when the role lacks the required permission", () => {
    const result = decideServerAccess({
      isOwner: false,
      hasExplicitServerAccess: false,
      rolePermissions: ["node.update"],
      hasNodeAccess: true,
      requiredPermission: "server.start",
    });
    expect(result).toEqual({ allowed: true, reason: "node_manage" });
  });

  it("owner bypasses requiredPermission entirely", () => {
    const result = decideServerAccess({
      isOwner: true,
      hasExplicitServerAccess: false,
      rolePermissions: [],
      hasNodeAccess: false,
      requiredPermission: "file.write",
    });
    expect(result).toEqual({ allowed: true, reason: "owner" });
  });
});
