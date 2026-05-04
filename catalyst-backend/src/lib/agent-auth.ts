import type { PrismaClient } from "@prisma/client";
import { createHash } from "crypto";
import { hashApiKey as hashApiKeyHmac } from "../services/api-key-service";

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

function setCachedVerification(nodeId: string, hashedKey: string): void {
  const cacheKey = `${nodeId}:${hashedKey}`;
  verifiedKeyCache.set(cacheKey, Date.now() + CACHE_TTL_MS);
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
    console.log(`[AGENT_AUTH_DEBUG] reject: missing nodeId=${!!nodeId} or apiKey=${!!apiKey}`);
    return false;
  }

  try {
    // Try HMAC-SHA256 hash first (current api-key-service format)
    const hashedKey = hashApiKeyHmac(apiKey);
    console.log(`[AGENT_AUTH_DEBUG] nodeId=${nodeId} hmacHash=${hashedKey}`);

    // Check in-memory cache first
    const cached = getCachedVerification(nodeId, hashedKey);
    if (cached === true) {
      console.log(`[AGENT_AUTH_DEBUG] nodeId=${nodeId} cache HIT`);
      return true;
    }

    // Direct DB lookup by hashed key
    let apiKeyRecord = await prisma.apikey.findUnique({
      where: { key: hashedKey },
      select: {
        enabled: true,
        expiresAt: true,
        metadata: true,
      },
    });
    console.log(`[AGENT_AUTH_DEBUG] nodeId=${nodeId} hmac lookup found=${!!apiKeyRecord}`);

    // Fallback to legacy SHA-256 base64url hash for backward compatibility
    if (!apiKeyRecord) {
      const legacyHashedKey = hashApiKeyLegacy(apiKey);
      console.log(`[AGENT_AUTH_DEBUG] nodeId=${nodeId} legacyHash=${legacyHashedKey}`);
      apiKeyRecord = await prisma.apikey.findUnique({
        where: { key: legacyHashedKey },
        select: {
          enabled: true,
          expiresAt: true,
          metadata: true,
        },
      });
      console.log(`[AGENT_AUTH_DEBUG] nodeId=${nodeId} legacy lookup found=${!!apiKeyRecord}`);
    }

    if (!apiKeyRecord || !apiKeyRecord.enabled) {
      console.log(`[AGENT_AUTH_DEBUG] nodeId=${nodeId} reject: record=${!!apiKeyRecord} enabled=${apiKeyRecord?.enabled}`);
      return false;
    }

    if (apiKeyRecord.expiresAt && new Date(apiKeyRecord.expiresAt) < new Date()) {
      console.log(`[AGENT_AUTH_DEBUG] nodeId=${nodeId} reject: expired`);
      return false;
    }

    const metadata = parseApiKeyMetadata(apiKeyRecord.metadata as unknown);
    console.log(`[AGENT_AUTH_DEBUG] nodeId=${nodeId} metadata=${JSON.stringify(metadata)}`);

    if (!metadata) {
      console.log(`[AGENT_AUTH_DEBUG] nodeId=${nodeId} reject: no metadata`);
      return false;
    }

    if (typeof metadata.nodeId !== "string" || metadata.nodeId !== nodeId) {
      console.log(`[AGENT_AUTH_DEBUG] nodeId=${nodeId} reject: metadata.nodeId=${metadata.nodeId} !== ${nodeId}`);
      return false;
    }

    // Cache successful verification
    setCachedVerification(nodeId, hashedKey);
    console.log(`[AGENT_AUTH_DEBUG] nodeId=${nodeId} ACCEPT`);
    return true;
  } catch (err) {
    console.log(`[AGENT_AUTH_DEBUG] nodeId=${nodeId} EXCEPTION:`, err);
    return false;
  }
}

/**
 * Invalidate cached agent API key verifications.
 * Call this when an API key is revoked, disabled, or rotated.
 * If `nodeId` is provided, only clears cache entries for that node.
 */
export function invalidateAgentApiKeyCache(nodeId?: string): void {
  if (nodeId) {
    // Clear only entries for the specific node
    const prefix = `${nodeId}:`;
    for (const key of verifiedKeyCache.keys()) {
      if (key.startsWith(prefix)) {
        verifiedKeyCache.delete(key);
      }
    }
  } else {
    // Clear all cached verifications
    verifiedKeyCache.clear();
  }
}
