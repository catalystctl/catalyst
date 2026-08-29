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
import { prisma } from "../db.js";

const sftpTokenCache = new Map<string, SftpTokenEntry>();

/** Indexed lookup by token hash for O(1) validation */
const tokenIndex = new Map<string, string>(); // tokenHash -> `${userId}:${serverId}`


/** Add token to index (internal helper) */
function indexToken(token: string, userId: string, serverId: string) {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  tokenIndex.set(tokenHash, `${userId}:${serverId}`);
}

/** Remove token from index (internal helper) */
function unindexToken(token: string) {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  tokenIndex.delete(tokenHash);
}

interface SftpTokenEntry {
  token: string;
  userId: string;
  serverId: string;
  createdAt: number;
  expiresAt: number;
  ttlMs: number;
  /** Mint-time / last-check ban snapshot: true = banned, null = not yet checked. */
  banned?: boolean | null;
  /** Mint-time / last-check lock snapshot: future timestamp = locked, null = not yet checked. */
  lockedUntil?: string | Date | null;
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
  if (ttlMs === null || ttlMs === undefined) return DEFAULT_TTL_MS;
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) return DEFAULT_TTL_MS;
  return Math.min(MAX_TTL_MS, Math.max(MIN_TTL_MS, ttlMs));
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
  options?: { forceRenewal?: boolean },
): { token: string; expiresAt: number; ttlMs: number } {
  const resolvedTtl = resolveSftpTtl(ttlMs);
  const key = `${userId}:${serverId}`;

  // Check for an existing unexpired token (unless forceRenewal is set)
  const existing = sftpTokenCache.get(key);
  if (existing && existing.expiresAt > Date.now() && !options?.forceRenewal) {
    return {
      token: existing.token,
      expiresAt: existing.expiresAt,
      ttlMs: existing.ttlMs,
    };
  }

  // Remove old token from index if exists
  if (existing) {
    unindexToken(existing.token);
  }

  // Generate a new dedicated SFTP token
  const token = `sftp_${crypto.randomBytes(32).toString("hex")}`;
  const now = Date.now();

  // Snapshot the user's ban/lock state so validateSftpToken can reject
  // banned/locked holders even before the first live DB recheck lands.
  const mint: SftpTokenEntry = {
    token,
    userId,
    serverId,
    createdAt: now,
    expiresAt: now + resolvedTtl,
    ttlMs: resolvedTtl,
    banned: null,
    lockedUntil: null,
  };

  sftpTokenCache.set(key, mint);
  indexToken(token, userId, serverId);

  // Refresh the ban/lock snapshot from the DB (fire-and-forget; validation
  // stays synchronous). Also refreshes snapshots of any other live tokens
  // held by this user.
  void refreshUserStatusSnapshots(userId).catch(() => {});

  return {
    token,
    expiresAt: mint.expiresAt,
    ttlMs: resolvedTtl,
  };
}

/** How often a token's ban/lock snapshot is re-verified against the DB. */
const USER_STATUS_RECHECK_INTERVAL_MS = 60 * 1000;

/** userId -> last DB recheck timestamp (throttles live status refreshes). */
const lastUserStatusCheck = new Map<string, number>();

/**
 * Refresh banned/lockedUntil snapshots for all live tokens of a user.
 * Revokes tokens whose user is banned or currently locked.
 */
async function refreshUserStatusSnapshots(userId: string): Promise<void> {
  const account = await prisma.user.findUnique({
    where: { id: userId },
    select: { banned: true, lockedUntil: true },
  });
  if (!account) return;
  const now = Date.now();
  for (const entry of sftpTokenCache.values()) {
    if (entry.userId !== userId) continue;
    entry.banned = account.banned;
    entry.lockedUntil = account.lockedUntil;
    if (account.banned || (account.lockedUntil && new Date(account.lockedUntil).getTime() > now)) {
      unindexToken(entry.token);
      sftpTokenCache.delete(`${entry.userId}:${entry.serverId}`);
    }
  }
}

/**
 * Force-rotate an SFTP token for a user+server pair, invalidating any existing one.
 */
export function rotateSftpToken(
  userId: string,
  serverId: string,
  ttlMs?: number,
): { token: string; expiresAt: number; ttlMs: number } {
  return generateSftpToken(userId, serverId, ttlMs, { forceRenewal: true });
}

/**
 * Validate an SFTP token (password) and return the associated session info.
 * Called by the SFTP server on each connection attempt.
 */
export function validateSftpToken(
  token: string,
  serverId: string,
): { userId: string; serverId: string } | null {
  // O(1) lookup using token hash index
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const key = tokenIndex.get(tokenHash);
  if (!key) {
    return null;
  }

  const entry = sftpTokenCache.get(key);
  if (!entry) {
    // Index stale, clean it up
    unindexToken(token);
    return null;
  }

  // Verify serverId matches and token not expired
  if (entry.serverId === serverId && entry.expiresAt > Date.now()) {
    // Reject banned / locked users. Snapshots are set at mint time and
    // refreshed by the throttled DB recheck below.
    if (entry.banned) {
      return null;
    }
    if (entry.lockedUntil && new Date(entry.lockedUntil).getTime() > Date.now()) {
      return null;
    }

    // Throttled live recheck: tokens minted before a ban/lock (or minted when
    // the snapshot was still unknown) get revoked shortly after the fact.
    // Kept fire-and-forget so validation stays synchronous (the agent-facing
    // endpoint in index.ts does not await this function).
    const snapshotKnown = entry.banned !== null || entry.lockedUntil !== null;
    const lastCheck = snapshotKnown ? lastUserStatusCheck.get(entry.userId) ?? 0 : 0;
    const now = Date.now();
    if (now - lastCheck > USER_STATUS_RECHECK_INTERVAL_MS) {
      lastUserStatusCheck.set(entry.userId, now);
      void refreshUserStatusSnapshots(entry.userId).catch(() => {});
    }

    return { userId: entry.userId, serverId: entry.serverId };
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
  const entry = sftpTokenCache.get(`${userId}:${serverId}`);
  if (entry) {
    unindexToken(entry.token);
  }
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
  const entry = sftpTokenCache.get(key);
  if (entry) {
    unindexToken(entry.token);
  }
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
      unindexToken(entry.token);
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
      unindexToken(entry.token);
      sftpTokenCache.delete(key);
      count++;
    }
  }
  return count;
}

/** Clean up expired entries. Call periodically. */
export function pruneExpiredSftpTokens(): number {
  const now = Date.now();
  let pruned = 0;
  for (const [key, entry] of sftpTokenCache) {
    if (entry.expiresAt <= now) {
      unindexToken(entry.token);
      sftpTokenCache.delete(key);
      pruned++;
    }
  }
  // Keep the status-recheck throttle map bounded (only users with live tokens).
  const liveUserIds = new Set([...sftpTokenCache.values()].map((e) => e.userId));
  for (const userId of lastUserStatusCheck.keys()) {
    if (!liveUserIds.has(userId)) lastUserStatusCheck.delete(userId);
  }
  return pruned;
}

// Prune expired tokens every 5 minutes
setInterval(() => {
  pruneExpiredSftpTokens();
}, 5 * 60 * 1000);
