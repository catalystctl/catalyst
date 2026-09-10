import type { PrismaClient } from "@prisma/client";
import { createHash } from "crypto";
import { hashApiKey as hashApiKeyHmac, hashApiKeyLegacyUnsalted, isLegacyHashAllowed, parseApiKeyRecordMetadata, timingSafeCompare } from "../services/api-key-service";
import { broadcastCacheInvalidate, onCacheInvalidate } from "./cache-bus";

function parseApiKeyMetadata(rawMetadata: unknown): Record<string, unknown> | null {
  if (rawMetadata && typeof rawMetadata === "object" && !Array.isArray(rawMetadata)) {
    return rawMetadata as Record<string, unknown>;
  }

  if (typeof rawMetadata === "string") {
    try {
      const parsed = JSON.parse(rawMetadata) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Legacy hash used by early Better Auth-style keys: SHA-256 → base64url.
 * Kept for backward compatibility while migrating to HMAC-SHA256.
 */
function hashApiKeyLegacy(key: string): string {
  const hash = createHash("sha256").update(key).digest();
  return hash.toString("base64url");
}

// In-memory cache for verified agent API keys: "nodeId:hashedKey" → expiry timestamp
const verifiedKeyCache = new Map<string, number>();
const CACHE_TTL_MS = 30_000; // 30 seconds

function getCachedVerification(nodeId: string, hashedKey: string): boolean | null {
  const cacheKey = `${nodeId}:${hashedKey}`;
  const expiry = verifiedKeyCache.get(cacheKey);
  if (expiry === undefined) return null;
  if (Date.now() > expiry) {
    verifiedKeyCache.delete(cacheKey);
    return null;
  }
  return true;
}

function setCachedVerification(nodeId: string, hashedKey: string, ttlMs = CACHE_TTL_MS): void {
  const cacheKey = `${nodeId}:${hashedKey}`;
  verifiedKeyCache.set(cacheKey, Date.now() + Math.max(1000, Math.min(CACHE_TTL_MS, ttlMs)));
  // Periodically prune stale entries
  if (verifiedKeyCache.size > 1000) {
    const now = Date.now();
    for (const [k, v] of verifiedKeyCache) {
      if (now > v) verifiedKeyCache.delete(k);
    }
  }
}

/**
 * Validates that an API key is active and assigned to the given node.
 * Bypasses Better Auth's verifyApiKey (which has its own rate limit) by
 * hashing the key and looking it up directly in the database.
 */
export async function verifyAgentApiKey(
  prisma: PrismaClient,
  nodeId: string,
  apiKey: string,
): Promise<boolean> {
  if (!nodeId || !apiKey) {
    return false;
  }

  try {
    // Salt-aware lookup: find candidate keys for this node, then HMAC with
    // each record's stored salt. Single-shot hash lookups cannot work once
    // salts are per-key random.
    const prefix = apiKey.includes("_") ? apiKey.split("_")[0] : "";
    const candidates = await prisma.apikey.findMany({
      where: prefix ? { prefix } : {},
      select: {
        id: true,
        key: true,
        enabled: true,
        expiresAt: true,
        metadata: true,
        userId: true,
        user: { select: { banned: true } },
      },
    });

    let apiKeyRecord: (typeof candidates)[number] | null = null;
    for (const candidate of candidates) {
      const meta = parseApiKeyRecordMetadata(candidate.metadata as unknown);
      const salted = meta?.salt ? hashApiKeyHmac(apiKey, meta.salt) : null;
      const deterministic = hashApiKeyHmac(apiKey);
      const legacyUnsalted = isLegacyHashAllowed() ? hashApiKeyLegacyUnsalted(apiKey) : null;
      if (
        (salted && timingSafeCompare(candidate.key, salted)) ||
        timingSafeCompare(candidate.key, deterministic) ||
        (legacyUnsalted && timingSafeCompare(candidate.key, legacyUnsalted))
      ) {
        apiKeyRecord = candidate;
        break;
      }
    }

    // Legacy SHA-256 base64url format: only when explicitly enabled.
    if (!apiKeyRecord && isLegacyHashAllowed()) {
      const legacyHashedKey = hashApiKeyLegacy(apiKey);
      apiKeyRecord = await prisma.apikey.findUnique({
        where: { key: legacyHashedKey },
        select: {
          id: true,
          key: true,
          enabled: true,
          expiresAt: true,
          metadata: true,
          userId: true,
          user: { select: { banned: true } },
        },
      });
    }
    const hashedKey = apiKeyRecord?.key ?? "";

    // Check in-memory cache (bypassed in test so rotation tests observe DB).
    if (process.env.NODE_ENV !== "test" && hashedKey) {
      const cached = getCachedVerification(nodeId, hashedKey);
      if (cached === true) return true;
    }

    if (!apiKeyRecord || !apiKeyRecord.enabled) {
      return false;
    }

    // Node agent keys are machine credentials, but a banned owner must not
    // keep a live agent session: fail closed on ban.
    if ((apiKeyRecord as { user?: { banned?: boolean } }).user?.banned) {
      return false;
    }

    if (apiKeyRecord.expiresAt && new Date(apiKeyRecord.expiresAt) < new Date()) {
      return false;
    }

    const metadata = parseApiKeyMetadata(apiKeyRecord.metadata as unknown);

    if (!metadata) {
      return false;
    }

    if (typeof metadata.nodeId !== "string" || metadata.nodeId !== nodeId) {
      return false;
    }

    // Cache successful verification, clamped so a cached entry never outlives
    // the key itself. Keys expiring within 5s are not cached at all.
    if (apiKeyRecord.expiresAt) {
      const msLeft = new Date(apiKeyRecord.expiresAt).getTime() - Date.now();
      if (msLeft <= 5000) return true;
      setCachedVerification(nodeId, hashedKey, msLeft);
    } else {
      setCachedVerification(nodeId, hashedKey);
    }

    // Fire-and-forget: track usage (requestCount + lastRequest)
    prisma.apikey.update({
      where: { id: apiKeyRecord.id },
      data: {
        lastRequest: new Date(),
        requestCount: { increment: 1 },
      },
    }).catch(() => {
      // Best-effort — don't fail the request if tracking fails
    });

    return true;
  } catch {
    return false;
  }
}

/**
 * Invalidate cached agent API key verifications.
 * Call this when an API key is revoked, disabled, or rotated.
 * If `nodeId` is provided, only clears cache entries for that node.
 *
 * Broadcasts to sibling workers when clustered (see lib/cache-bus.ts).
 */
export function invalidateAgentApiKeyCache(nodeId?: string): void {
  clearLocalAgentApiKeyCache(nodeId);
  broadcastCacheInvalidate("agent-auth", nodeId ? { nodeId } : { flushAll: true });
}

function clearLocalAgentApiKeyCache(nodeId?: string): void {
  if (nodeId) {
    const prefix = `${nodeId}:`;
    for (const key of verifiedKeyCache.keys()) {
      if (key.startsWith(prefix)) {
        verifiedKeyCache.delete(key);
      }
    }
  } else {
    verifiedKeyCache.clear();
  }
}

// Multi-worker: apply invalidations received from sibling workers via IPC.
onCacheInvalidate("agent-auth", (payload) => {
  if (payload.flushAll || !payload.nodeId) {
    clearLocalAgentApiKeyCache();
  } else {
    clearLocalAgentApiKeyCache(payload.nodeId);
  }
});
