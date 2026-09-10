/**
 * Game server lifecycle, console, files, backups and tasks error codes.
 * Values are part of the public API — the frontend translates them.
 */
export const ServerErrorCodes = {
  SERVER_NOT_FOUND: "SERVER_NOT_FOUND",
  SERVER_ALREADY_RUNNING: "SERVER_ALREADY_RUNNING",
} as const;
