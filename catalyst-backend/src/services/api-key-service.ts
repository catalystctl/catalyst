/**
 * Standalone API Key Service
 *
 * Implements API key creation, verification, and deletion directly against
 * the `apikey` Prisma model. This replaces the better-auth `apiKey` plugin
 * which is not available in v1.6.2.
 */

import { prisma } from "../db";
import { Prisma } from "@prisma/client";
import { createHash, randomBytes } from "crypto";

const DEFAULT_PREFIX = "catalyst";
const KEY_LENGTH = 32; // bytes of randomness

/**
 * Hash an API key using SHA-256 → base64url (same format better-auth uses).
 */
export function hashApiKey(key: string): string {
  const hash = createHash("sha256").update(key).digest();
  return hash.toString("base64url");
}

/**
 * Create a new API key. Returns the full key (only shown once) and the DB record.
 */
export async function createApiKey(params: {
  userId: string;
  name?: string;
  prefix?: string;
  expiresIn?: number; // seconds
  permissions?: Record<string, string[]>;
  metadata?: Record<string, unknown>;
  rateLimitEnabled?: boolean;
  rateLimitMax?: number;
  rateLimitTimeWindow?: number;
}) {
  const {
    userId,
    name,
    prefix = DEFAULT_PREFIX,
    expiresIn,
    permissions,
    metadata,
    rateLimitEnabled = true,
    rateLimitMax = 100,
    rateLimitTimeWindow = 60000,
  } = params;

  // Generate random key
  const random = randomBytes(KEY_LENGTH).toString("base64url");
  const fullKey = `${prefix}_${random}`;
  const hashedKey = hashApiKey(fullKey);

  // Calculate expiry
  const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;

  // Calculate rate limit refill
  const remaining = rateLimitEnabled ? rateLimitMax : null;
  const refillInterval = rateLimitEnabled ? rateLimitTimeWindow : null;
  const refillAmount = rateLimitEnabled ? rateLimitMax : null;

  const record = await prisma.apikey.create({
    data: {
      name: name || null,
      key: hashedKey,
      start: fullKey.slice(0, prefix.length + 3) + "...", // first few chars for display
      prefix,
      userId,
      enabled: true,
      expiresAt,
      ...(permissions ? { permissions: permissions as Prisma.InputJsonValue } : {}),
      ...(metadata ? { metadata: metadata as Prisma.InputJsonValue } : {}),
      rateLimitEnabled,
      rateLimitTimeWindow,
      rateLimitMax,
      remaining,
      refillInterval,
      refillAmount,
      lastRefillAt: new Date(),
    },
  });

  // Return the full key alongside the record (full key is only shown once)
  return {
    id: record.id,
    key: fullKey,
    name: record.name,
    prefix: record.prefix,
    start: record.start,
    enabled: record.enabled,
    expiresAt: record.expiresAt,
    permissions: record.permissions,
    metadata: record.metadata,
    rateLimitEnabled: record.rateLimitEnabled,
    rateLimitMax: record.rateLimitMax,
    rateLimitTimeWindow: record.rateLimitTimeWindow,
    userId: record.userId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * Verify an API key. Returns the key record and associated user if valid.
 */
export async function verifyApiKey(fullKey: string): Promise<{
  valid: boolean;
  key?: {
    id: string;
    name: string | null;
    permissions: unknown;
    metadata: unknown;
    userId: string;
    rateLimitEnabled: boolean;
    rateLimitMax: number;
    rateLimitTimeWindow: number;
    remaining: number | null;
    lastRefillAt: Date;
    refillInterval: number | null;
    refillAmount: number | null;
  };
  user?: {
    id: string;
    email: string;
    name: string;
    username: string;
    emailVerified: boolean;
    role: string;
  };
} | null> {
  const hashedKey = hashApiKey(fullKey);

  const apiKeyRecord = await prisma.apikey.findUnique({
    where: { key: hashedKey },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          username: true,
          emailVerified: true,
          role: true,
          roles: {
            select: { name: true },
            take: 1,
          },
        },
      },
    },
  });

  if (!apiKeyRecord || !apiKeyRecord.enabled) {
    return null;
  }

  if (apiKeyRecord.expiresAt && new Date(apiKeyRecord.expiresAt) < new Date()) {
    return null;
  }

  // Rate limit check and refill
  if (apiKeyRecord.rateLimitEnabled && apiKeyRecord.remaining !== null) {
    const now = new Date();
    const lastRefill = apiKeyRecord.lastRefillAt ? new Date(apiKeyRecord.lastRefillAt) : now;
    const elapsed = now.getTime() - lastRefill.getTime();

    if (
      apiKeyRecord.refillInterval &&
      apiKeyRecord.refillAmount &&
      elapsed >= apiKeyRecord.refillInterval
    ) {
      // Refill
      const refilled = Math.min(
        (apiKeyRecord.remaining ?? 0) + apiKeyRecord.refillAmount,
        apiKeyRecord.rateLimitMax
      );
      await prisma.apikey.update({
        where: { id: apiKeyRecord.id },
        data: {
          remaining: refilled,
          lastRefillAt: now,
        },
      });
      apiKeyRecord.remaining = refilled;
    }

    if ((apiKeyRecord.remaining ?? 0) <= 0) {
      return null; // Rate limited
    }

    // Decrement
    await prisma.apikey.update({
      where: { id: apiKeyRecord.id },
      data: {
        remaining: { decrement: 1 },
        lastRequest: now,
        requestCount: { increment: 1 },
      },
    });
  } else {
    // Just track usage
    await prisma.apikey.update({
      where: { id: apiKeyRecord.id },
      data: {
        lastRequest: new Date(),
        requestCount: { increment: 1 },
      },
    });
  }

  const userRole = apiKeyRecord.user.roles?.[0]?.name || "user";

  return {
    valid: true,
    key: {
      id: apiKeyRecord.id,
      name: apiKeyRecord.name,
      permissions: apiKeyRecord.permissions,
      metadata: apiKeyRecord.metadata,
      userId: apiKeyRecord.userId,
      rateLimitEnabled: apiKeyRecord.rateLimitEnabled,
      rateLimitMax: apiKeyRecord.rateLimitMax,
      rateLimitTimeWindow: apiKeyRecord.rateLimitTimeWindow,
      remaining: apiKeyRecord.remaining,
      lastRefillAt: apiKeyRecord.lastRefillAt || new Date(),
      refillInterval: apiKeyRecord.refillInterval,
      refillAmount: apiKeyRecord.refillAmount,
    },
    user: {
      id: apiKeyRecord.user.id,
      email: apiKeyRecord.user.email,
      name: apiKeyRecord.user.name || "",
      username: apiKeyRecord.user.username,
      emailVerified: !!apiKeyRecord.user.emailVerified,
      role: userRole,
    },
  };
}

/**
 * Delete (revoke) an API key by ID.
 */
export async function deleteApiKey(keyId: string, userId?: string): Promise<boolean> {
  const where: any = { id: keyId };
  if (userId) {
    where.userId = userId;
  }
  try {
    await prisma.apikey.delete({ where });
    return true;
  } catch {
    return false;
  }
}
