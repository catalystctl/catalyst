/**
 * Catalyst - Path Validation Utilities
 *
 * Hardened path validation with canonical path checking to prevent
 * path traversal attacks. Uses defense-in-depth approach.
 *
 * Security considerations:
 * - Validates server ID format (UUID)
 * - Normalizes Unicode (NFC) to prevent homograph attacks
 * - Normalizes paths to prevent directory traversal
 * - Uses realpathSync to resolve symlinks and check canonical paths
 * - Logs security events for rejected paths
 */

import path from 'path';
import fs from 'fs';
import { captureSystemError } from '../services/error-logger';

// Unicode normalization - use built-in Intl for NFC normalization
// This prevents homograph attacks where different Unicode representations
// of the same path could bypass validation
function normalizeUnicode(str: string): string {
  // Use String.prototype.normalize if available (Node.js has full Unicode support)
  if (typeof str.normalize === 'function') {
    return str.normalize('NFC');
  }
  return str;
}

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
    captureSystemError({
      level: 'critical',
      component: 'PathValidation',
      message: 'Path Validation Security Event',
      metadata: { event },
    }).catch(() => {});
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
 * 2. Normalizes Unicode (NFC) to prevent homograph attacks
 * 3. Normalizes the requested path
 * 4. Resolves the canonical path (resolving symlinks)
 * 5. Ensures the canonical path is within the server directory
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

  // Apply Unicode normalization (NFC) to prevent homograph attacks
  const unicodeNormalized = normalizeUnicode(resolvedPath);

  const serverBase = path.join(SERVER_FILES_ROOT, serverId);

  // Normalize the requested path
  const normalized = normalizeRequestPath(unicodeNormalized);
  const fullPath = path.join(serverBase, normalized);

  // Logical path traversal check (no filesystem access — files live on the agent,
  // not necessarily on this backend machine)
  const resolved = path.resolve(fullPath);
  const resolvedBase = path.resolve(serverBase);

  if (!resolved.startsWith(resolvedBase + path.sep) && resolved !== resolvedBase) {
    logSecurityEvent(userId, serverId, resolvedPath, 'Path traversal attempt detected');
    throw new Error('Path traversal attempt detected');
  }

  // Block null bytes
  if (resolvedPath.includes('\0')) {
    logSecurityEvent(userId, serverId, resolvedPath, 'Null byte in path');
    throw new Error('Invalid path');
  }

  // Symlink escape check: Use realpathSync to detect if the path resolves
  // to a location outside the server directory via symlink manipulation
  try {
    const realResolved = fs.realpathSync(fullPath);
    const realResolvedBase = fs.realpathSync(serverBase);
    
    if (!realResolved.startsWith(realResolvedBase + path.sep) && realResolved !== realResolvedBase) {
      logSecurityEvent(userId, serverId, resolvedPath, 'Path traversal attempt via symlink detected');
      throw new Error('Path traversal attempt detected');
    }
  } catch (err: any) {
    // ENOENT is expected if the file doesn't exist yet
    // ENOTDIR may occur for partial paths - this is acceptable
    if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR') {
      throw err;
    }
    // For non-existent paths, verify the parent directory is within bounds
    try {
      const parentDir = path.join(fullPath, '..');
      const realParent = fs.realpathSync(parentDir);
      const realResolvedBase = fs.realpathSync(serverBase);
      if (!realParent.startsWith(realResolvedBase + path.sep) && realParent !== realResolvedBase) {
        logSecurityEvent(userId, serverId, resolvedPath, 'Path traversal attempt via parent directory detected');
        throw new Error('Path traversal attempt detected');
      }
    } catch {
      // Parent doesn't exist either - will be caught by file operation
    }
  }

  return normalized;
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
