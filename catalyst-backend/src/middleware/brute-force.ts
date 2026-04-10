/**
 * Catalyst - Brute-Force Protection Middleware
 *
 * Account lockout mechanism to prevent unlimited password attempts.
 * Implements progressive lockout durations:
 * - 5 failed attempts = 5 minute lockout
 * - 10 failed attempts = 30 minute lockout
 * - 15 failed attempts = 1 hour lockout
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import type { PrismaClient, User } from "@prisma/client";

const LOCKOUT_THRESHOLDS = [
  { attempts: 5, lockout: 5 * 60 * 1000 },    // 5 attempts = 5 min lockout
  { attempts: 10, lockout: 30 * 60 * 1000 },   // 10 attempts = 30 min lockout
  { attempts: 15, lockout: 60 * 60 * 1000 },   // 15 attempts = 1 hr lockout
];

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
  (request as any).userForLockout = user;
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
  const user = (request as any).userForLockout as User | undefined;
  if (!user) return;

  const failedAttempts = user.failedLoginAttempts + 1;
  const updateData: any = {
    failedLoginAttempts: failedAttempts,
    lastFailedLogin: new Date(),
  };

  // Apply lockout if threshold reached
  const threshold = LOCKOUT_THRESHOLDS.find(t => failedAttempts >= t.attempts);
  if (threshold) {
    updateData.lockedUntil = new Date(Date.now() + threshold.lockout);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: updateData,
  });
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
