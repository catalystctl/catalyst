import type { PrismaClient } from "@prisma/client";
import { auth } from "../auth";

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
 * Validates that an API key is active and assigned to the given node.
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
    const verification = await auth.api.verifyApiKey({
      body: { key: apiKey },
    } as any);
    const verificationData = (verification as any)?.response ?? verification;
    const verifiedKeyId = verificationData?.key?.id;

    if (!verificationData?.valid || typeof verifiedKeyId !== "string") {
      return false;
    }

    const apiKeyRecord = await prisma.apikey.findUnique({
      where: { id: verifiedKeyId },
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

    return typeof metadata.nodeId === "string" && metadata.nodeId === nodeId;
  } catch {
    return false;
  }
}
