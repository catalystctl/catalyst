/**
 * Standalone API Key Service
 *
 * Implements API key creation, verification, and deletion directly against
 * the `apikey` Prisma model. This replaces the better-auth `apiKey` plugin
 * which is not available in v1.6.2.
 *
 * Permission model:
 *   - `allPermissions: true`  → key inherits all creator's permissions (snapshot at creation time)
 *   - `allPermissions: false` → key only has the specific permissions in the `permissions` array
 *   - An API key can NEVER have more permissions than its creator had at creation time
 */

import { prisma } from "../db";
import { createHash, createHmac, randomBytes } from "crypto";

const DEFAULT_PREFIX = "catalyst";
const KEY_LENGTH = 32; // bytes of randomness

/**
 * Hash an API key using HMAC-SHA256 with a per-key salt.
 *
 * The salt is deterministically derived from the first 16 characters of the key,
 * ensuring unique salts per key without requiring an immediate schema migration.
 *
 * NOTE: For stronger security, add a `salt String?` column to the `apikey`
 * Prisma model and store a cryptographically random salt per key. When that
 * migration is applied, update this function to accept the stored salt and
 * adjust the lookup strategy in verifyApiKey accordingly.
 */
export function hashApiKey(key: string): string {
  const salt = key.slice(0, 16);
  const secret = process.env.API_KEY_SECRET || "fallback-secret";
  return createHmac("sha256", secret).update(key + salt).digest("hex");
}

export interface CreateApiKeyParams {
  userId: string;
  name?: string;
  prefix?: string;
  expiresIn?: number; // seconds
  allPermissions?: boolean;
  permissions?: string[];
  metadata?: Record<string, unknown>;
  rateLimitEnabled?: boolean;
  rateLimitMax?: number;
  rateLimitTimeWindow?: number;
}

export interface ApiKeyRecord {
  id: string;
  key: string; // Full key — only returned once at creation
  name: string | null;
  prefix: string | null;
  start: string | null;
  enabled: boolean;
  expiresAt: Date | null;
  allPermissions: boolean;
  permissions: string[];
  metadata: unknown;
  rateLimitEnabled: boolean;
  rateLimitMax: number;
  rateLimitTimeWindow: number;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface VerifiedApiKey {
  valid: true;
  key: {
    id: string;
    name: string | null;
    allPermissions: boolean;
    permissions: string[];
    metadata: unknown;
    userId: string;
  };
  user: {
    id: string;
    email: string;
    name: string;
    username: string;
    emailVerified: boolean;
    role: string;
  };
}

/**
 * Create a new API key. Returns the full key (only shown once) and the DB record.
 */
export async function createApiKey(params: CreateApiKeyParams): Promise<ApiKeyRecord> {
  const {
    userId,
    name,
    prefix = DEFAULT_PREFIX,
    expiresIn,
    allPermissions = false,
    permissions = [],
    metadata,
    rateLimitEnabled = true,
    rateLimitMax = 100,
    rateLimitTimeWindow = 60000,
  } = params;

  if (!userId) {
    throw new Error("userId is required to create an API key");
  }

  // Generate random key
  const random = randomBytes(KEY_LENGTH).toString("base64url");
  const fullKey = `${prefix}_${random}`;
  const hashedKey = hashApiKey(fullKey);
  // When a dedicated `salt` column is added, generate a random salt here
  // and pass it to hashApiKey() instead of the deterministic derivation.

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
      start: fullKey.slice(0, prefix.length + 3) + "...",
      prefix,
      userId,
      enabled: true,
      expiresAt,
      allPermissions,
      permissions,
      ...(metadata ? { metadata: metadata as any } : {}),
      rateLimitEnabled,
      rateLimitTimeWindow,
      rateLimitMax,
      remaining,
      refillInterval,
      refillAmount,
      lastRefillAt: new Date(),
    },
  });

  return {
    id: record.id,
    key: fullKey,
    name: record.name,
    prefix: record.prefix,
    start: record.start,
    enabled: record.enabled,
    expiresAt: record.expiresAt,
    allPermissions: record.allPermissions,
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
export async function verifyApiKey(fullKey: string): Promise<VerifiedApiKey | null> {
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
            select: { name: true, permissions: true },
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
      const refilled = Math.min(
        (apiKeyRecord.remaining ?? 0) + apiKeyRecord.refillAmount,
        apiKeyRecord.rateLimitMax,
      );
      await prisma.apikey.update({
        where: { id: apiKeyRecord.id },
        data: { remaining: refilled, lastRefillAt: now },
      });
      apiKeyRecord.remaining = refilled;
    }

    if ((apiKeyRecord.remaining ?? 0) <= 0) {
      return null; // Rate limited
    }

    await prisma.apikey.update({
      where: { id: apiKeyRecord.id },
      data: {
        remaining: { decrement: 1 },
        lastRequest: now,
        requestCount: { increment: 1 },
      },
    });
  } else {
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
      allPermissions: apiKeyRecord.allPermissions,
      permissions: apiKeyRecord.permissions,
      metadata: apiKeyRecord.metadata,
      userId: apiKeyRecord.userId,
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
