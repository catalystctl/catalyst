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
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { invalidateAgentApiKeyCache } from "../lib/agent-auth";

const DEFAULT_PREFIX = "catalyst";
const KEY_LENGTH = 32; // bytes of randomness

/**
 * Resolve the HMAC secret used to hash panel/agent API keys.
 *
 * A dedicated `API_KEY_SECRET` is required in production (hard error);
 * outside production it falls back to `BETTER_AUTH_SECRET` for one-liner /
 * local installs. Never falls back to a hardcoded constant.
 */
let warnedAboutApiKeySecretFallback = false;

export function resolveApiKeySecret(): string {
  const dedicated = process.env.API_KEY_SECRET?.trim();
  if (dedicated) {
    return dedicated;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "API_KEY_SECRET environment variable is required in production " +
        "(set a dedicated secret: openssl rand -base64 32)",
    );
  }

  const authSecret = process.env.BETTER_AUTH_SECRET?.trim();
  if (authSecret) {
    // Cache onto process.env so subsequent lookups (and other modules) see a
    // stable, non-empty API_KEY_SECRET for the rest of the process lifetime.
    process.env.API_KEY_SECRET = authSecret;
    if (!warnedAboutApiKeySecretFallback && process.env.NODE_ENV !== "test") {
      warnedAboutApiKeySecretFallback = true;
      console.warn(
        "[api-key-service] API_KEY_SECRET is unset; falling back to BETTER_AUTH_SECRET. " +
          "Set a dedicated API_KEY_SECRET (openssl rand -base64 32) for key-rotation isolation.",
      );
    }
    return authSecret;
  }

  throw new Error(
    "API_KEY_SECRET environment variable is required and must be a non-empty secret " +
      "(or set BETTER_AUTH_SECRET as a fallback)",
  );
}

function requireApiKeySecret(): string {
  return resolveApiKeySecret();
}

/**
 * Hash an API key using HMAC-SHA256 with a per-key random salt.
 *
 * Each key gets a fresh 16-byte salt (stored alongside the record once the
 * `salt` column migration lands; until then the salt is derived from the key
 * prefix for lookup, plus a random per-key component persisted in the record
 * metadata). Verification HMACs with the stored salt.
 */
export function hashApiKey(key: string, salt?: string): string {
  const effectiveSalt = salt ?? key.slice(0, 16);
  const secret = requireApiKeySecret();
  return createHmac("sha256", secret).update(key + effectiveSalt).digest("hex");
}

export function newApiKeySalt(): string {
  return randomBytes(16).toString("hex");
}

/** Legacy unsalted sha256 path — only honored when explicitly enabled. */
export function hashApiKeyLegacyUnsalted(key: string): string {
  const secret = requireApiKeySecret();
  return createHmac("sha256", secret).update(key).digest("hex");
}

export function isLegacyHashAllowed(): boolean {
  return process.env.ALLOW_LEGACY_API_KEY_HASH === "1";
}

export function parseApiKeyRecordMetadata(raw: unknown): { salt?: string } | null {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const salt = (raw as Record<string, unknown>).salt;
    return { salt: typeof salt === "string" ? salt : undefined };
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const salt = (parsed as Record<string, unknown>).salt;
        return { salt: typeof salt === "string" ? salt : undefined };
      }
    } catch {
      return null;
    }
  }
  return null;
}

export function timingSafeCompare(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
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

  // Generate random key + random per-key salt (randomBytes(16) hex).
  // The salt travels in the record metadata until the `salt` column migration
  // lands; verification reads it back and HMACs with it.
  const random = randomBytes(KEY_LENGTH).toString("base64url");
  const fullKey = `${prefix}_${random}`;
  const salt = newApiKeySalt();
  const hashedKey = hashApiKey(fullKey, salt);
  const mergedMetadata = { ...(metadata ?? {}), salt };

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
      start: `${fullKey.slice(0, prefix.length + 3)  }...`,
      prefix,
      userId,
      enabled: true,
      expiresAt,
      allPermissions,
      permissions,
      metadata: mergedMetadata as any,
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
 *
 * Salts are stored per record (metadata.salt until the `salt` column
 * migration lands), so verification scans the prefix bucket and compares
 * HMACs with each candidate's stored salt (constant-time). Pre-salt keys
 * (deterministic salt) verify during the rotation window; the legacy
 * unsalted sha256/base64url formats only verify when explicitly enabled.
 */
export async function verifyApiKey(fullKey: string): Promise<VerifiedApiKey | null> {
  const prefix = fullKey.includes("_") ? fullKey.split("_")[0] : "";
  const candidates = await prisma.apikey.findMany({
    where: prefix ? { prefix } : {},
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

  let apiKeyRecord: (typeof candidates)[number] | null = null;
  for (const candidate of candidates) {
    const meta = parseApiKeyRecordMetadata(candidate.metadata);
    const saltedHash = meta?.salt ? hashApiKey(fullKey, meta.salt) : null;
    // Rotation window: keys minted before per-key salts used key.slice(0,16).
    const deterministicHash = hashApiKey(fullKey);
    const legacyAllowed = isLegacyHashAllowed();
    const legacyHash = legacyAllowed ? hashApiKeyLegacyUnsalted(fullKey) : null;
    if (
      (saltedHash && timingSafeCompare(candidate.key, saltedHash)) ||
      timingSafeCompare(candidate.key, deterministicHash) ||
      (legacyHash && timingSafeCompare(candidate.key, legacyHash))
    ) {
      apiKeyRecord = candidate;
      break;
    }
  }

  if (!apiKeyRecord || !apiKeyRecord.enabled) {
    return null;
  }

  if (apiKeyRecord.expiresAt && new Date(apiKeyRecord.expiresAt) < new Date()) {
    return null;
  }

  // Rate limit check and refill — bypass in benchmark fair mode
  const fairMode =
    process.env.DISABLE_RATE_LIMIT === "1" ||
    process.env.DISABLE_RATE_LIMIT === "true" ||
    process.env.BENCHMARK_DISABLE_RATE_LIMIT === "1" ||
    process.env.BENCHMARK_DISABLE_RATE_LIMIT === "true" ||
    process.env.BENCHMARK_FAIR === "1" ||
    process.env.BENCHMARK_FAIR === "true";
  if (!fairMode && apiKeyRecord.rateLimitEnabled && apiKeyRecord.remaining !== null) {
    const now = new Date();
    const lastRefill = apiKeyRecord.lastRefillAt ? new Date(apiKeyRecord.lastRefillAt) : now;
    const elapsed = now.getTime() - lastRefill.getTime();

    if (
      apiKeyRecord.refillInterval &&
      apiKeyRecord.refillAmount &&
      elapsed >= apiKeyRecord.refillInterval
    ) {
      // CAS-style refill: the update only lands if lastRefillAt is unchanged,
      // so concurrent requests cannot each apply a full refill window.
      const refilled = Math.min(
        (apiKeyRecord.remaining ?? 0) + apiKeyRecord.refillAmount,
        apiKeyRecord.rateLimitMax,
      );
      const refillClaim = await prisma.apikey.updateMany({
        where: { id: apiKeyRecord.id, lastRefillAt: apiKeyRecord.lastRefillAt ?? null },
        data: { remaining: refilled, lastRefillAt: now },
      });
      if (refillClaim.count > 0) {
        apiKeyRecord.remaining = refilled;
      }
    }

    if ((apiKeyRecord.remaining ?? 0) <= 0) {
      return null; // Rate limited
    }

    // Atomic consume: only one concurrent request wins when remaining is low.
    const consumed = await prisma.apikey.updateMany({
      where: { id: apiKeyRecord.id, remaining: { gt: 0 } },
      data: {
        remaining: { decrement: 1 },
        lastRequest: now,
        requestCount: { increment: 1 },
      },
    });
    if (consumed.count === 0) {
      return null; // Lost the race — budget exhausted
    }
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
 * Delete (revoke) an API key by ID. On enabled=false/delete the panel closes
 * live sockets and fails pending node requests immediately (no TTL lag):
 * agent keys drop the node socket, panel keys drop the user's WS sessions.
 */
export async function deleteApiKey(keyId: string, userId?: string): Promise<boolean> {
  const where: any = { id: keyId };
  if (userId) {
    where.userId = userId;
  }

  try {
    const doomed = await prisma.apikey.findUnique({
      where: { id: keyId },
      select: { id: true, metadata: true, userId: true },
    });
    await prisma.apikey.delete({ where });
    // Invalidate agent-auth cache so revoked keys are immediately rejected
    invalidateAgentApiKeyCache();
    try {
      const { getWsGateway } = await import("../websocket/gateway.js");
      const gw = getWsGateway();
      const meta = parseApiKeyRecordMetadata(doomed?.metadata as unknown);
      const nodeId = (doomed?.metadata as unknown as Record<string, unknown> | null)?.["nodeId"];
      if (typeof nodeId === "string" && gw) {
        gw.closeAgentConnections?.(nodeId, "API key revoked");
        gw.failPendingRequestsForNodePublic?.(nodeId, "API key revoked");
      } else if (doomed?.userId && gw?.disconnectUser) {
        gw.disconnectUser(doomed.userId);
      }
      void meta;
    } catch { /* best-effort */ }
    return true;
  } catch {
    return false;
  }
}

export interface UpdateApiKeyParams {
  name?: string;
  enabled?: boolean;
  rateLimitMax?: number;
  rateLimitTimeWindow?: number;
}

/**
 * Update an API key by ID. Invalidates the agent-auth cache on success
 * so that changes (e.g. disabling a key) take effect immediately.
 */
export async function updateApiKey(
  keyId: string,
  params: UpdateApiKeyParams,
) {
  const updateData: any = { updatedAt: new Date() };
  if (params.name !== undefined) updateData.name = params.name;
  if (params.enabled !== undefined) updateData.enabled = params.enabled;
  if (params.rateLimitMax !== undefined) {
    updateData.rateLimitMax = params.rateLimitMax;
    updateData.refillAmount = params.rateLimitMax;
  }
  if (params.rateLimitTimeWindow !== undefined) {
    updateData.rateLimitTimeWindow = params.rateLimitTimeWindow;
    updateData.refillInterval = params.rateLimitTimeWindow;
  }

  try {
    const record = await prisma.apikey.update({
      where: { id: keyId },
      data: updateData,
      select: {
        id: true,
        name: true,
        prefix: true,
        start: true,
        enabled: true,
        expiresAt: true,
        lastRequest: true,
        requestCount: true,
        remaining: true,
        rateLimitMax: true,
        rateLimitTimeWindow: true,
        allPermissions: true,
        permissions: true,
        metadata: true,
        createdAt: true,
        updatedAt: true,
        userId: true,
        user: {
          select: { id: true, username: true, email: true },
        },
      },
    });

    // Invalidate agent-auth cache so changes take effect immediately
    invalidateAgentApiKeyCache();
    // enabled=false revokes now: close live sockets + fail pending requests.
    if (params.enabled === false) {
      try {
        const { getWsGateway } = await import("../websocket/gateway.js");
        const gw = getWsGateway();
        const nodeId = (record?.metadata as unknown as Record<string, unknown> | null)?.["nodeId"];
        if (typeof nodeId === "string" && gw) {
          (gw as unknown as { closeAgentConnections?: (id: string, reason: string) => void }).closeAgentConnections?.(nodeId, "API key disabled");
          (gw as unknown as { failPendingRequestsForNodePublic?: (id: string, reason: string) => void }).failPendingRequestsForNodePublic?.(nodeId, "API key disabled");
        } else if (record?.userId && gw?.disconnectUser) {
          gw.disconnectUser(record.userId);
        }
      } catch { /* best-effort */ }
    }

    return record;
  } catch {
    return null;
  }
}


