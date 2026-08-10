/**
 * Catalyst - Brute-Force Protection Middleware
 *
 * Account lockout mechanism to prevent unlimited password attempts.
 * Implements progressive lockout durations:
 * - 5 failed attempts = 5 minute lockout
 * - 10 failed attempts = 30 minute lockout
 * - 15 failed attempts = 1 hour lockout
 *
 * Also implements IP-based rate limiting for non-existent users to prevent
 * account enumeration attacks.
 *
 * Multi-worker notes:
 * - Per-user lockouts are stored on User.failedLoginAttempts / User.lockedUntil
 *   (shared via Postgres) — correct under WORKERS > 1.
 * - IP rate limits for unknown emails are stored in AuthLockout (shared via
 *   Postgres) so counters are coherent across workers. A short in-process
 *   read-through cache reduces write amplification but is not the source of
 *   truth.
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import type { PrismaClient, User } from "@prisma/client";
import { getWsGateway } from '../websocket/gateway';

const LOCKOUT_THRESHOLDS = [
  { attempts: 5, lockout: 5 * 60 * 1000 },    // 5 attempts = 5 min lockout
  { attempts: 10, lockout: 30 * 60 * 1000 },   // 10 attempts = 30 min lockout
  { attempts: 15, lockout: 60 * 60 * 1000 },   // 15 attempts = 1 hr lockout
];

/** IP rate limit: max attempts per window */
const IP_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const IP_RATE_LIMIT_MAX_ATTEMPTS = 20; // 20 attempts per 15 minutes for unknown users

/**
 * Short-lived local mirror of AuthLockout IP counters to avoid a DB round-trip
 * on every login when the same worker sees repeated probes. Always re-checked
 * against DB on miss / expiry. Not a multi-worker SoT.
 */
const ipAttemptLocalCache = new Map<string, { count: number; resetAt: number }>();
const IP_LOCAL_CACHE_MAX = 5_000;

/**
 * Get client IP from request, handling proxies
 */
function getClientIp(request: FastifyRequest): string {
  return request.ip || request.socket.remoteAddress || 'unknown';
}

function setLocalIpCache(ip: string, count: number, resetAt: number): void {
  ipAttemptLocalCache.set(ip, { count, resetAt });
  if (ipAttemptLocalCache.size > IP_LOCAL_CACHE_MAX) {
    const now = Date.now();
    for (const [k, v] of ipAttemptLocalCache) {
      if (now > v.resetAt) ipAttemptLocalCache.delete(k);
    }
    // Still oversized — drop arbitrary oldest-ish entries
    if (ipAttemptLocalCache.size > IP_LOCAL_CACHE_MAX) {
      let drop = ipAttemptLocalCache.size - IP_LOCAL_CACHE_MAX;
      for (const k of ipAttemptLocalCache.keys()) {
        ipAttemptLocalCache.delete(k);
        if (--drop <= 0) break;
      }
    }
  }
}

/**
 * Check and enforce IP-based rate limiting for non-existent users.
 * Persists counters in AuthLockout so multi-worker deployments share state.
 * Uses a synthetic email key `__ip__:<ip>` so rows are unique per IP without
 * colliding with real email lockout rows (unique on [email, ipAddress]).
 */
async function checkIpRateLimit(
  prisma: PrismaClient,
  request: FastifyRequest,
): Promise<void> {
  const ip = getClientIp(request);
  const now = Date.now();
  const syntheticEmail = `__ip__:${ip}`;

  // Fast path: local cache says still under limit
  const local = ipAttemptLocalCache.get(ip);
  if (local && now <= local.resetAt) {
    if (local.count >= IP_RATE_LIMIT_MAX_ATTEMPTS) {
      const minutesRemaining = Math.ceil((local.resetAt - now) / 60000);
      throw new Error(
        `Too many login attempts. Try again in ${minutesRemaining} minute${minutesRemaining !== 1 ? 's' : ''}.`,
      );
    }
  } else if (local && now > local.resetAt) {
    ipAttemptLocalCache.delete(ip);
  }

  // Shared source of truth
  const existing = await prisma.authLockout.findUnique({
    where: {
      email_ipAddress: {
        email: syntheticEmail,
        ipAddress: ip,
      },
    },
  });

  let count = 1;
  let resetAt = now + IP_RATE_LIMIT_WINDOW_MS;
  let lockedUntil: Date | null = null;

  if (existing) {
    const windowStart = existing.firstFailedAt.getTime();
    const windowExpired = now - windowStart > IP_RATE_LIMIT_WINDOW_MS;
    const lockActive = existing.lockedUntil && existing.lockedUntil.getTime() > now;

    if (lockActive) {
      const minutesRemaining = Math.ceil((existing.lockedUntil!.getTime() - now) / 60000);
      setLocalIpCache(ip, existing.failureCount, existing.lockedUntil!.getTime());
      throw new Error(
        `Too many login attempts. Try again in ${minutesRemaining} minute${minutesRemaining !== 1 ? 's' : ''}.`,
      );
    }

    if (windowExpired) {
      // Reset window
      count = 1;
      resetAt = now + IP_RATE_LIMIT_WINDOW_MS;
      await prisma.authLockout.update({
        where: { id: existing.id },
        data: {
          failureCount: 1,
          firstFailedAt: new Date(now),
          lastFailedAt: new Date(now),
          lockedUntil: null,
          userAgent: request.headers['user-agent']?.slice(0, 512) ?? null,
        },
      });
    } else {
      count = existing.failureCount + 1;
      resetAt = windowStart + IP_RATE_LIMIT_WINDOW_MS;
      // Lock once the next attempt would exceed the max (count > MAX).
      // Keep count === MAX allowed so behavior matches the old in-memory limit.
      if (count > IP_RATE_LIMIT_MAX_ATTEMPTS) {
        lockedUntil = new Date(resetAt);
      }
      await prisma.authLockout.update({
        where: { id: existing.id },
        data: {
          failureCount: count,
          lastFailedAt: new Date(now),
          lockedUntil,
          userAgent: request.headers['user-agent']?.slice(0, 512) ?? null,
        },
      });

      if (count > IP_RATE_LIMIT_MAX_ATTEMPTS) {
        setLocalIpCache(ip, count, resetAt);
        const minutesRemaining = Math.ceil((resetAt - now) / 60000);
        throw new Error(
          `Too many login attempts. Try again in ${minutesRemaining} minute${minutesRemaining !== 1 ? 's' : ''}.`,
        );
      }
    }
  } else {
    await prisma.authLockout.create({
      data: {
        email: syntheticEmail,
        ipAddress: ip,
        failureCount: 1,
        firstFailedAt: new Date(now),
        lastFailedAt: new Date(now),
        userAgent: request.headers['user-agent']?.slice(0, 512) ?? null,
      },
    });
  }

  setLocalIpCache(ip, count, resetAt);
}

/**
 * Opportunistic cleanup of expired synthetic IP lockout rows.
 * Runs infrequently; not critical for correctness.
 */
let lastIpCleanupAt = 0;
async function maybeCleanupExpiredIpLockouts(prisma: PrismaClient): Promise<void> {
  const now = Date.now();
  if (now - lastIpCleanupAt < 5 * 60 * 1000) return;
  lastIpCleanupAt = now;
  const cutoff = new Date(now - IP_RATE_LIMIT_WINDOW_MS);
  try {
    await prisma.authLockout.deleteMany({
      where: {
        email: { startsWith: '__ip__:' },
        lastFailedAt: { lt: cutoff },
        OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date(now) } }],
      },
    });
  } catch {
    // best-effort
  }
  // Mirror local cache cleanup
  for (const [ip, data] of ipAttemptLocalCache) {
    if (now > data.resetAt) ipAttemptLocalCache.delete(ip);
  }
}

/**
 * Check if user account is locked and apply lockout if needed
 *
 * @param prisma - Prisma client instance
 * @param email - User email address
 * @param request - Fastify request (for storing user context)
 * @throws Error if account is locked
 */
export const bruteForceProtection = async (
  prisma: PrismaClient,
  email: string,
  request: FastifyRequest
): Promise<void> => {
  // Check IP-based rate limit FIRST, before checking user existence
  // This protects against account enumeration attacks on non-existent users
  await checkIpRateLimit(prisma, request);
  void maybeCleanupExpiredIpLockouts(prisma);

  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
  });

  if (!user) return; // Don't reveal if user exists

  // Check if account is locked
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const minutesRemaining = Math.ceil(
      (user.lockedUntil.getTime() - Date.now()) / 60000
    );
    throw new Error(`Account locked. Try again in ${minutesRemaining} minute${minutesRemaining !== 1 ? 's' : ''}.`);
  }

  // Store user in request for later use in handleFailedLogin/handleSuccessfulLogin
  request.userForLockout = user;
};

/**
 * Handle failed login attempt - increment counter and apply lockout
 *
 * @param prisma - Prisma client instance
 * @param request - Fastify request (must have userForLockout set)
 */
export const handleFailedLogin = async (
  prisma: PrismaClient,
  request: FastifyRequest
): Promise<void> => {
  const user = request.userForLockout as User | undefined;
  if (!user) {
    // Failed login for non-existent user - the IP rate limit in bruteForceProtection
    // will handle this, but we don't need to do anything else here
    return;
  }

  // Use atomic increment to avoid race conditions with parallel login attempts.
  // This ensures the counter is always accurate even under concurrent load.
  const updatedUser = await prisma.user.update({
    where: { id: user.id },
    data: {
      failedLoginAttempts: { increment: 1 },
      lastFailedLogin: new Date(),
    },
  });

  // Apply lockout if threshold reached
  const threshold = [...LOCKOUT_THRESHOLDS].reverse().find(t => updatedUser.failedLoginAttempts >= t.attempts);
  if (threshold) {
    const lockedUntil = new Date(Date.now() + threshold.lockout);
    await prisma.user.update({
      where: { id: user.id },
      data: { lockedUntil },
    });

    // Also record a human-readable AuthLockout row for admin UI (real email, not synthetic)
    try {
      const ip = getClientIp(request);
      await prisma.authLockout.upsert({
        where: {
          email_ipAddress: {
            email: user.email,
            ipAddress: ip,
          },
        },
        create: {
          email: user.email,
          ipAddress: ip,
          failureCount: updatedUser.failedLoginAttempts,
          firstFailedAt: new Date(),
          lastFailedAt: new Date(),
          lockedUntil,
          userAgent: request.headers['user-agent']?.slice(0, 512) ?? null,
        },
        update: {
          failureCount: updatedUser.failedLoginAttempts,
          lastFailedAt: new Date(),
          lockedUntil,
          userAgent: request.headers['user-agent']?.slice(0, 512) ?? null,
        },
      });
    } catch {
      // Admin tracking is best-effort; User.lockedUntil is the enforcement SoT
    }

    try {
      const wsGateway = getWsGateway();
      wsGateway?.pushToAdminSubscribers('auth_lockout_created', {
        userId: user.id,
        lockedUntil: lockedUntil.toISOString(),
      });
    } catch { /* ignore — WS push is best-effort */ }
  }
};

/**
 * Handle successful login - reset failed attempts and lockout
 *
 * @param prisma - Prisma client instance
 * @param userId - User ID
 */
export const handleSuccessfulLogin = async (
  prisma: PrismaClient,
  userId: string
): Promise<void> => {
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastSuccessfulLogin: new Date(),
    },
    select: { email: true },
  });

  // Clear any admin-visible AuthLockout rows for this email
  try {
    await prisma.authLockout.deleteMany({
      where: { email: user.email },
    });
  } catch {
    // best-effort
  }
};

/**
 * Admin function to unlock a user account
 *
 * @param prisma - Prisma client instance
 * @param userId - User ID to unlock
 * @returns Updated user record
 */
export const unlockUserAccount = async (
  prisma: PrismaClient,
  userId: string
): Promise<User> => {
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
  });

  try {
    await prisma.authLockout.deleteMany({
      where: { email: user.email },
    });
  } catch {
    // best-effort
  }

  return user;
};

/**
 * Check if an account is currently locked
 *
 * @param prisma - Prisma client instance
 * @param email - User email address
 * @returns true if locked, false otherwise
 */
export const isAccountLocked = async (
  prisma: PrismaClient,
  email: string
): Promise<boolean> => {
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { lockedUntil: true },
  });

  if (!user || !user.lockedUntil) return false;

  return user.lockedUntil > new Date();
};

/**
 * Get remaining lockout time in minutes
 *
 * @param prisma - Prisma client instance
 * @param email - User email address
 * @returns Minutes remaining, or 0 if not locked
 */
export const getLockoutTimeRemaining = async (
  prisma: PrismaClient,
  email: string
): Promise<number> => {
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { lockedUntil: true },
  });

  if (!user || !user.lockedUntil) return 0;

  if (user.lockedUntil <= new Date()) return 0;

  return Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
};
