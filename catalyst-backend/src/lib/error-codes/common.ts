/**
 * Error codes shared across domains. Values are part of the public API: the
 * frontend translates them (errors namespace) and API consumers may branch on
 * them, so renaming a value is a breaking change.
 */
export const CommonErrorCodes = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  CONFLICT: "CONFLICT",
  NOT_FOUND: "NOT_FOUND",
  RATE_LIMITED: "RATE_LIMITED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  NETWORK_ERROR: "NETWORK_ERROR",
  FILE_ACCESS_DENIED: "FILE_ACCESS_DENIED",
  INSUFFICIENT_RESOURCES: "INSUFFICIENT_RESOURCES",
  CONTAINER_ERROR: "CONTAINER_ERROR",
  CREDENTIAL_ENCRYPTION_KEY_MISSING: "CREDENTIAL_ENCRYPTION_KEY_MISSING",
} as const;
