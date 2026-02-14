import type { PrismaClient } from "@prisma/client";
import { createHash } from "crypto";

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
 * Hash an API key the same way Better Auth does: SHA-256 → base64url (no padding).
 */
function hashApiKey(key: string): string {
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
    return false;
  }

  try {
    const hashedKey = hashApiKey(apiKey);

    // Check in-memory cache first
    const cached = getCachedVerification(nodeId, hashedKey);
    if (cached === true) return true;

    // Direct DB lookup by hashed key (same hash Better Auth uses)
    const apiKeyRecord = await prisma.apikey.findUnique({
      where: { key: hashedKey },
      select: {
        enabled: true,
        expiresAt: true,
        metadata: true,
      },
    });

    if (!apiKeyRecord || !apiKeyRecord.enabled) {
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

    // Cache successful verification
    setCachedVerification(nodeId, hashedKey);
    return true;
  } catch {
    return false;
  }
}
