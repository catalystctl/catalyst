/**
 * SFTP Token Manager
 *
 * Manages dedicated, single-purpose SFTP tokens per user+server pair.
 * Tokens are prefixed with `sftp_` and stored in an in-memory cache.
 * Both the API endpoint and the SFTP server validate against this cache.
 *
 * Tokens are automatically revoked when a user is removed from a server.
 */

import crypto from "crypto";

const sftpTokenCache = new Map<string, SftpTokenEntry>();

interface SftpTokenEntry {
  token: string;
  userId: string;
  serverId: string;
  createdAt: number;
  expiresAt: number;
  ttlMs: number;
}

/** Default TTL if none specified: 5 minutes */
const DEFAULT_TTL_MS = 5 * 60 * 1000;

/** Minimum TTL: 1 minute */
const MIN_TTL_MS = 60 * 1000;

/** Maximum TTL: 1 year */
const MAX_TTL_MS = 365 * 24 * 60 * 60 * 1000;

/** Allowed TTL options presented to the user (label, milliseconds) */
export const SFTP_TTL_OPTIONS = [
  { label: "5 minutes", value: 5 * 60 * 1000 },
  { label: "15 minutes", value: 15 * 60 * 1000 },
  { label: "30 minutes", value: 30 * 60 * 1000 },
  { label: "1 hour", value: 60 * 60 * 1000 },
  { label: "6 hours", value: 6 * 60 * 60 * 1000 },
  { label: "24 hours", value: 24 * 60 * 60 * 1000 },
  { label: "7 days", value: 7 * 24 * 60 * 60 * 1000 },
  { label: "30 days", value: 30 * 24 * 60 * 60 * 1000 },
  { label: "90 days", value: 90 * 24 * 60 * 60 * 1000 },
  { label: "1 year", value: 365 * 24 * 60 * 60 * 1000 },
] as const;

/**
 * Resolve a TTL value, clamping to allowed range.
 */
export function resolveSftpTtl(ttlMs?: number | null): number {
  const val = typeof ttlMs === 'number' ? ttlMs : undefined;
  if (!Number.isFinite(val) || val! <= 0) return DEFAULT_TTL_MS;
  return Math.min(MAX_TTL_MS, Math.max(MIN_TTL_MS, val!));
}

/**
 * Generate or return an existing valid SFTP token for a user+server pair.
 * If a valid token already exists, it is returned (with its remaining TTL).
 * If expired or missing, a new token is generated with the specified TTL.
 */
export function generateSftpToken(
  userId: string,
  serverId: string,
  ttlMs?: number,
): { token: string; expiresAt: number; ttlMs: number } {
  const resolvedTtl = resolveSftpTtl(ttlMs);

  // Check for an existing unexpired token
  const existing = sftpTokenCache.get(`${userId}:${serverId}`);
  if (existing && existing.expiresAt > Date.now()) {
    return {
      token: existing.token,
      expiresAt: existing.expiresAt,
      ttlMs: existing.ttlMs,
    };
  }

  // Generate a new dedicated SFTP token
  const token = `sftp_${crypto.randomBytes(32).toString("hex")}`;
  const now = Date.now();

  const entry: SftpTokenEntry = {
    token,
    userId,
    serverId,
    createdAt: now,
    expiresAt: now + resolvedTtl,
    ttlMs: resolvedTtl,
  };

  sftpTokenCache.set(`${userId}:${serverId}`, entry);

  return {
    token,
    expiresAt: entry.expiresAt,
    ttlMs: resolvedTtl,
  };
}

/**
 * Force-rotate an SFTP token for a user+server pair, invalidating any existing one.
 */
export function rotateSftpToken(
  userId: string,
  serverId: string,
  ttlMs?: number,
): { token: string; expiresAt: number; ttlMs: number } {
  const resolvedTtl = resolveSftpTtl(ttlMs);
  const token = `sftp_${crypto.randomBytes(32).toString("hex")}`;
  const now = Date.now();

  const entry: SftpTokenEntry = {
    token,
    userId,
    serverId,
    createdAt: now,
    expiresAt: now + resolvedTtl,
    ttlMs: resolvedTtl,
  };

  sftpTokenCache.set(`${userId}:${serverId}`, entry);

  return {
    token,
    expiresAt: entry.expiresAt,
    ttlMs: resolvedTtl,
  };
}

/**
 * Validate an SFTP token (password) and return the associated session info.
 * Called by the SFTP server on each connection attempt.
 */
export function validateSftpToken(
  token: string,
  serverId: string,
): { userId: string; serverId: string } | null {
  for (const entry of sftpTokenCache.values()) {
    if (entry.token === token && entry.serverId === serverId && entry.expiresAt > Date.now()) {
      return { userId: entry.userId, serverId: entry.serverId };
    }
  }
  return null;
}

/**
 * Get the current token info for a user+server pair (if any).
 * Returns null if no valid token exists.
 */
export function getSftpTokenInfo(
  userId: string,
  serverId: string,
): { token: string; expiresAt: number; ttlMs: number } | null {
  const entry = sftpTokenCache.get(`${userId}:${serverId}`);
  if (entry && entry.expiresAt > Date.now()) {
    return {
      token: entry.token,
      expiresAt: entry.expiresAt,
      ttlMs: entry.ttlMs,
    };
  }
  return null;
}

/**
 * Invalidate (delete) the SFTP token for a user+server pair.
 */
export function invalidateSftpToken(userId: string, serverId: string): void {
  sftpTokenCache.delete(`${userId}:${serverId}`);
}

/**
 * List all active (non-expired) SFTP tokens for a specific server.
 * Returns entries with token info — does NOT expose the raw token value
 * to anyone except the token owner.
 */
export function listSftpTokensForServer(
  serverId: string,
  requestUserId: string,
  isOwner: boolean,
): Array<{
  userId: string;
  expiresAt: number;
  ttlMs: number;
  createdAt: number;
  token: string | null; // only visible to the token owner
  isSelf: boolean;
}> {
  const now = Date.now();
  const results: Array<{
    userId: string;
    expiresAt: number;
    ttlMs: number;
    createdAt: number;
    token: string | null;
    isSelf: boolean;
  }> = [];

  for (const entry of sftpTokenCache.values()) {
    if (entry.serverId === serverId && entry.expiresAt > now) {
      results.push({
        userId: entry.userId,
        expiresAt: entry.expiresAt,
        ttlMs: entry.ttlMs,
        createdAt: entry.createdAt,
        token: entry.userId === requestUserId ? entry.token : null,
        isSelf: entry.userId === requestUserId,
      });
    }
  }

  return results;
}

/**
 * Revoke (invalidate) a specific user's SFTP token for a server.
 * The server owner can revoke any user's token.
 * A user can only revoke their own token.
 */
export function revokeSftpToken(
  userId: string,
  serverId: string,
  requestUserId: string,
  isOwner: boolean,
): boolean {
  if (userId !== requestUserId && !isOwner) {
    return false; // not authorized
  }
  const key = `${userId}:${serverId}`;
  const existed = sftpTokenCache.has(key);
  sftpTokenCache.delete(key);
  return existed;
}

/**
 * Revoke ALL SFTP tokens for a specific server.
 * Used when a server is deleted or when the owner wants to kill all sessions.
 */
export function revokeAllSftpTokensForServer(serverId: string): number {
  let count = 0;
  for (const [key, entry] of sftpTokenCache) {
    if (entry.serverId === serverId) {
      sftpTokenCache.delete(key);
      count++;
    }
  }
  return count;
}

/**
 * Revoke all SFTP tokens for a specific user across ALL servers.
 * Used when a user is removed from a server or when their account is disabled.
 * If serverId is provided, only revokes tokens for that server.
 */
export function revokeSftpTokensForUser(userId: string, serverId?: string): number {
  let count = 0;
  for (const [key, entry] of sftpTokenCache) {
    if (entry.userId === userId) {
      if (serverId && entry.serverId !== serverId) continue;
      sftpTokenCache.delete(key);
      count++;
    }
  }
  return count;
}

/**
 * Clean up expired entries. Call periodically.
 */
export function pruneExpiredSftpTokens(): number {
  const now = Date.now();
  let pruned = 0;
  for (const [key, entry] of sftpTokenCache) {
    if (entry.expiresAt <= now) {
      sftpTokenCache.delete(key);
      pruned++;
    }
  }
  return pruned;
}

// Prune expired tokens every 5 minutes
setInterval(() => {
  pruneExpiredSftpTokens();
}, 5 * 60 * 1000);
