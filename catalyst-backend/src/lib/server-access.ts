/**
 * Pure access decision for ensureServerAccess (no DB / reply side-effects).
 *
 * Security contract (single source of truth for server AuthZ):
 * - Owners always allowed.
 * - Explicit per-server ServerAccess grants allowed.
 * - Global `*` / `admin.write` allowed.
 * - Global roles may grant granular server permissions (e.g. a "game manager"
 *   role holding `server.start` or `file.write`): when `requiredPermission`
 *   is provided, a role holding exactly that permission counts like a
 *   per-server grant — on every server. Mirrored by
 *   getEffectiveServerPermissions so UI and backend stay consistent.
 * - Node assignment alone is NOT enough — must also hold `node.update`
 *   (or another explicit admin manage path above).
 *
 * Callers that need effective permission *sets* (not just allow/deny) should
 * still use this decision, then map:
 *   owner | admin | node_manage → full server permission set
 *   role_permission → the role-granted server permissions
 *   server_access → explicit ServerAccess.permissions
 */
export type ServerAccessDecision =
  | {
      allowed: true;
      reason: "owner" | "server_access" | "admin" | "role_permission" | "node_manage";
    }
  | { allowed: false; reason: "forbidden" };

export function decideServerAccess(input: {
  isOwner: boolean;
  hasExplicitServerAccess: boolean;
  rolePermissions: string[];
  hasNodeAccess: boolean;
  /** Operation-scoped permission (e.g. "server.start", "backup.create").
   *  When set, a global role granting this permission is allowed too. */
  requiredPermission?: string;
}): ServerAccessDecision {
  if (input.isOwner) {
    return { allowed: true, reason: "owner" };
  }
  if (input.hasExplicitServerAccess) {
    return { allowed: true, reason: "server_access" };
  }
  if (input.rolePermissions.includes("*") || input.rolePermissions.includes("admin.write")) {
    return { allowed: true, reason: "admin" };
  }
  if (input.requiredPermission && input.rolePermissions.includes(input.requiredPermission)) {
    return { allowed: true, reason: "role_permission" };
  }
  // Node assignment alone must NOT grant server power/file ops.
  if (input.hasNodeAccess && input.rolePermissions.includes("node.update")) {
    return { allowed: true, reason: "node_manage" };
  }
  return { allowed: false, reason: "forbidden" };
}

/** True when role grants full-admin server observation / management. */
export function isFullAdminRole(rolePermissions: string[]): boolean {
  return rolePermissions.includes("*") || rolePermissions.includes("admin.write");
}

/** True when node assignment is paired with node.update (manage path). */
export function canManageViaNode(
  hasNodeAccess: boolean,
  rolePermissions: string[],
): boolean {
  return hasNodeAccess && rolePermissions.includes("node.update");
}
