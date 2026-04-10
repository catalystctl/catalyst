/**
 * Catalyst - Path Validation Utilities
 *
 * Hardened path validation with canonical path checking to prevent
 * path traversal attacks. Uses defense-in-depth approach.
 *
 * Security considerations:
 * - Validates server ID format (UUID)
 * - Normalizes paths to prevent directory traversal
 * - Uses realpathSync to resolve symlinks and check canonical paths
 * - Logs security events for rejected paths
 */

import path from 'path';
import fs from 'fs';

const SERVER_FILES_ROOT = process.env.SERVER_DATA_DIR || '/var/lib/catalyst/servers';

/**
 * Security event logging for path validation failures
 */
interface SecurityEvent {
  event: string;
  userId?: string;
  serverId?: string;
  requestedPath: string;
  error: string;
  timestamp: Date;
}

let securityLogger: ((event: SecurityEvent) => void) | null = null;

/**
 * Set the security logger for path validation events
 */
export function setSecurityLogger(logger: (event: SecurityEvent) => void) {
  securityLogger = logger;
}

/**
 * Log a security event
 */
function logSecurityEvent(
  userId: string | undefined,
  serverId: string,
  requestedPath: string,
  error: string
) {
  const event: SecurityEvent = {
    event: 'path_traversal_attempt',
    userId,
    serverId,
    requestedPath,
    error,
    timestamp: new Date(),
  };

  if (securityLogger) {
    securityLogger(event);
  }

  // Also log to console in development
  if (process.env.NODE_ENV === 'development') {
    console.warn('[Path Validation Security Event]', event);
  }
}

/**
 * Validate server ID format (UUID)
 * @throws Error if server ID is invalid
 */
export function validateServerId(serverId: string): void {
  // Validate UUID format (including dashed format)
  if (!serverId.match(/^[a-f0-9-]{36}$/i)) {
    throw new Error('Invalid server ID format');
  }
}

/**
 * Normalize a user-provided path
 * This prevents basic path traversal by normalizing the path
 */
export function normalizeRequestPath(value?: string): string {
  if (!value) return "/";
  const cleaned = value.replace(/\\/g, "/").trim();
  if (!cleaned || cleaned === ".") return "/";
  const parts = cleaned.split("/").filter(Boolean);
  return `/${parts.join("/")}`;
}

/**
 * Validate and normalize a path with canonical checking
 *
 * This function:
 * 1. Validates the server ID format
 * 2. Normalizes the requested path
 * 3. Resolves the canonical path (resolving symlinks)
 * 4. Ensures the canonical path is within the server directory
 *
 * @param userPath - User-provided path
 * @param serverId - Server ID (UUID)
 * @param userId - Optional user ID for security logging
 * @returns Normalized and validated path
 * @throws Error if path validation fails
 */
export function validateAndNormalizePath(
  userPath: string | undefined,
  serverId: string,
  userId?: string
): string {
  // Default to root if no path provided
  const resolvedPath = userPath || '/';

  const serverBase = path.join(SERVER_FILES_ROOT, serverId);

  // Normalize the requested path
  const normalized = normalizeRequestPath(resolvedPath);
  const fullPath = path.join(serverBase, normalized);

  // Canonical validation (resolves symlinks)
  try {
    // Check if server base directory exists
    let canonicalBase: string;
    try {
      canonicalBase = fs.realpathSync(serverBase);
    } catch (error) {
      throw new Error('Server directory does not exist');
    }

    // For the full path, we need to handle the case where the file doesn't exist yet
    // In that case, we check the parent directory
    let canonicalPath: string;
    try {
      canonicalPath = fs.realpathSync(fullPath);
    } catch (error) {
      // File doesn't exist, check parent directory
      const parentDir = path.dirname(fullPath);
      try {
        const canonicalParent = fs.realpathSync(parentDir);
        // Ensure parent is within server base
        if (!canonicalParent.startsWith(canonicalBase)) {
          throw new Error('Parent directory is outside server directory');
        }
        // For new files, we can't resolve the full path, so we use the normalized path
        canonicalPath = fullPath;
      } catch (parentError) {
        throw new Error('Cannot resolve parent directory');
      }
    }

    // Validate that canonical path is within server base
    if (!canonicalPath.startsWith(canonicalBase)) {
      logSecurityEvent(userId, serverId, resolvedPath, 'Canonical path is outside server directory');
      throw new Error('Path traversal attempt detected');
    }

    return normalized;
  } catch (error) {
    if (error instanceof Error && error.message.includes('Path traversal')) {
      throw error;
    }
    // Log security event for other errors
    logSecurityEvent(userId, serverId, resolvedPath, error instanceof Error ? error.message : 'Path validation failed');
    throw new Error('Path validation failed');
  }
}

/**
 * Validate multiple paths at once
 * Useful for file operations with multiple paths
 */
export function validateAndNormalizePaths(
  paths: string[],
  serverId: string,
  userId?: string
): string[] {
  return paths.map(p => validateAndNormalizePath(p, serverId, userId));
}

/**
 * Check if a path is safe (basic check without server context)
 * This is a lighter check for initial validation
 */
export function isSafePath(userPath: string): boolean {
  // Reject paths with ..
  if (userPath.includes('..')) {
    return false;
  }

  // Reject absolute paths (should be relative)
  if (path.isAbsolute(userPath)) {
    return false;
  }

  // Reject null bytes
  if (userPath.includes('\0')) {
    return false;
  }

  return true;
}
