/**
 * Authentication, registration, session and profile error codes.
 * Values are part of the public API — the frontend translates them.
 */
export const AuthErrorCodes = {
  AUTH_INVALID_TOKEN: "AUTH_INVALID_TOKEN",
  AUTH_EXPIRED: "AUTH_EXPIRED",
} as const;
