/**
 * Diagnostic script for agent API key authentication issues.
 *
 * Run from the catalyst-backend directory with bun (loads .env):
 *   bun run scripts/diag-agent-auth.ts <nodeId> <rawApiKey>
 *
 * Or with dotenv:
 *   npx dotenv-cli -e .env -- npx tsx scripts/diag-agent-auth.ts <nodeId> <rawApiKey>
 */
import { createHash, createHmac } from "crypto";
import { prisma } from "../src/db";

function hashApiKeyLegacy(key: string): string {
  const hash = createHash("sha256").update(key).digest();
  return hash.toString("base64url");
}

function hashApiKeyHmac(key: string): string {
  const salt = key.slice(0, 16);
  const secret = process.env.API_KEY_SECRET || "fallback-secret";
  return createHmac("sha256", secret).update(key + salt).digest("hex");
}

async function diagnose(nodeId: string, rawKey: string) {
  console.log("=== Agent Auth Diagnostic ===\n");
  console.log("Node ID:", nodeId);
  console.log("Raw key (first 20 chars):", rawKey.slice(0, 20) + "...");
  console.log("Raw key length:", rawKey.length);
  console.log("API_KEY_SECRET env:", process.env.API_KEY_SECRET ? "[SET]" : "[NOT SET - using fallback-secret]");
  console.log();

  const hmacHash = hashApiKeyHmac(rawKey);
  const legacyHash = hashApiKeyLegacy(rawKey);

  console.log("HMAC-SHA256 hash (api-key-service):", hmacHash);
  console.log("Legacy SHA-256 base64url hash:", legacyHash);
  console.log();

  const node = await prisma.node.findUnique({ where: { id: nodeId } });
  console.log("Node exists:", !!node);
  if (node) {
    console.log("  Node name:", node.name);
    console.log("  Node hostname:", node.hostname);
  }
  console.log();

  // Find ALL apikeys (including ones for other nodes) that match either hash
  const hmacRecord = await prisma.apikey.findUnique({
    where: { key: hmacHash },
    select: { id: true, enabled: true, metadata: true, start: true, prefix: true },
  });

  const legacyRecord = await prisma.apikey.findUnique({
    where: { key: legacyHash },
    select: { id: true, enabled: true, metadata: true, start: true, prefix: true },
  });

  console.log("Direct hash lookups:");
  console.log("  HMAC hash found:", !!hmacRecord);
  if (hmacRecord) {
    console.log("    ID:", hmacRecord.id);
    console.log("    Enabled:", hmacRecord.enabled);
    console.log("    Metadata:", JSON.stringify(hmacRecord.metadata));
    const meta = hmacRecord.metadata as any;
    console.log("    metadata.nodeId:", meta?.nodeId);
    console.log("    metadata.nodeId === arg nodeId:", meta?.nodeId === nodeId);
  }

  console.log("  Legacy hash found:", !!legacyRecord);
  if (legacyRecord) {
    console.log("    ID:", legacyRecord.id);
    console.log("    Enabled:", legacyRecord.enabled);
    console.log("    Metadata:", JSON.stringify(legacyRecord.metadata));
    const meta = legacyRecord.metadata as any;
    console.log("    metadata.nodeId:", meta?.nodeId);
    console.log("    metadata.nodeId === arg nodeId:", meta?.nodeId === nodeId);
  }
  console.log();

  // Also find any keys assigned to this node
  const nodeKeys = await prisma.apikey.findMany({
    where: {
      metadata: {
        path: ["nodeId"],
        equals: nodeId,
      },
    },
    select: { id: true, key: true, enabled: true, start: true, prefix: true },
  });

  console.log("API keys with metadata.nodeId =", nodeId, ":", nodeKeys.length);
  for (const k of nodeKeys) {
    console.log("  Key ID:", k.id);
    console.log("  Enabled:", k.enabled);
    console.log("  Start:", k.start);
    console.log("  Stored hash:", k.key);
    console.log("  Matches HMAC:", k.key === hmacHash);
    console.log("  Matches legacy:", k.key === legacyHash);
  }

  await prisma.$disconnect();
}

const [nodeId, rawKey] = process.argv.slice(2);
if (!nodeId || !rawKey) {
  console.error("Usage: bun run scripts/diag-agent-auth.ts <nodeId> <rawApiKey>");
  process.exit(1);
}

diagnose(nodeId, rawKey).catch((e) => {
  console.error(e);
  process.exit(1);
});
