/**
 * Nodes, allocations, databases, templates and migration error codes.
 * Values are part of the public API — the frontend translates them.
 */
export const InfrastructureErrorCodes = {
  NODE_NOT_FOUND: "NODE_NOT_FOUND",
  NODE_OFFLINE: "NODE_OFFLINE",
} as const;
