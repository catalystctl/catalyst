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
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import type { PrismaClient, User } from "@prisma/client";
import { getWsGateway } from '../websocket/gateway';

const LOCKOUT_THRESHOLDS = [
  { attempts: 5, lockout: 5 * 60 * 1000 },    // 5 attempts = 5 min lockout
  { attempts: 10, lockout: 30 * 60 * 1000 },   // 10 attempts = 30 min lockout
  { attempts: 15, lockout: 60 * 60 * 1000 },   // 15 attempts = 1 hr lockout
];

/** IP-based rate limiting for non-existent user attempts */
const ipAttemptCache = new Map<string, { count: number; resetAt: number }>();

/** IP rate limit: max attempts per window */
const IP_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const IP_RATE_LIMIT_MAX_ATTEMPTS = 20; // 20 attempts per 15 minutes for unknown users

/**
 * Get client IP from request, handling proxies
 */
function getClientIp(request: FastifyRequest): string {
  // Check X-Forwarded-For header first (for proxied requests)
  const forwarded = request.headers['x-forwarded-for'];
  if (forwarded) {
    const ips = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    return ips.split(',')[0].trim();
  }
  // Fall back to direct IP
  return request.ip || request.socket.remoteAddress || 'unknown';
}

/**
 * Check and enforce IP-based rate limiting for non-existent users.
 * This prevents attackers from rapidly probing for valid email addresses.
 */
function checkIpRateLimit(request: FastifyRequest): void {
  const ip = getClientIp(request);
  const now = Date.now();
  
  const ipData = ipAttemptCache.get(ip);
  
  if (ipData) {
    // Check if window has expired
    if (now > ipData.resetAt) {
      // Reset the window
      ipAttemptCache.set(ip, { count: 1, resetAt: now + IP_RATE_LIMIT_WINDOW_MS });
      return;
    }
    
    // Check if rate limit exceeded
    if (ipData.count >= IP_RATE_LIMIT_MAX_ATTEMPTS) {
      const minutesRemaining = Math.ceil((ipData.resetAt - now) / 60000);
      throw new Error(`Too many login attempts. Try again in ${minutesRemaining} minute${minutesRemaining !== 1 ? 's' : ''}.`);
    }
    
    // Increment counter
    ipData.count++;
  } else {
    // First attempt from this IP in the window
    ipAttemptCache.set(ip, { count: 1, resetAt: now + IP_RATE_LIMIT_WINDOW_MS });
  }
}

/**
 * Clean up expired IP entries periodically
 */
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of ipAttemptCache) {
    if (now > data.resetAt) {
      ipAttemptCache.delete(ip);
    }
  }
}, 5 * 60 * 1000); // Clean up every 5 minutes

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
  checkIpRateLimit(request);
  
  const user = await prisma.user.findUnique({ where: { email } });

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
  const threshold = LOCKOUT_THRESHOLDS.find(t => updatedUser.failedLoginAttempts >= t.attempts);
  if (threshold) {
    const lockedUntil = new Date(Date.now() + threshold.lockout);
    await prisma.user.update({
      where: { id: user.id },
      data: { lockedUntil },
    });

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
  await prisma.user.update({
    where: { id: userId },
    data: {
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastSuccessfulLogin: new Date(),
    },
  });
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
  return prisma.user.update({
    where: { id: userId },
    data: {
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
  });
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
  const user = await prisma.user.findUnique({
    where: { email },
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
  const user = await prisma.user.findUnique({
    where: { email },
    select: { lockedUntil: true },
  });

  if (!user || !user.lockedUntil) return 0;

  if (user.lockedUntil <= new Date()) return 0;

  return Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
};
