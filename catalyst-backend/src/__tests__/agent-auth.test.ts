import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../db";
import { verifyAgentApiKey, invalidateAgentApiKeyCache } from "../lib/agent-auth";
import { createApiKey, deleteApiKey } from "../services/api-key-service";
import { nanoid } from "nanoid";

describe("Agent Auth - verifyAgentApiKey", () => {
  const testNodeId = `test-node-${nanoid(8)}`;
  let testUserId: string;
  let testLocationId: string;
  let apiKeyId: string;
  let apiKeyRaw: string;

  beforeAll(async () => {
    // Create a test user (required for api-key-service foreign key)
    const user = await prisma.user.create({
      data: {
        id: `test-user-${nanoid(8)}`,
        email: `test-auth-${nanoid(8)}@example.com`,
        name: "Test Auth User",
        username: `testauth${nanoid(8)}`,
        emailVerified: true,
      },
    });
    testUserId = user.id;

    // Create a test location (required for node)
    const location = await prisma.location.create({
      data: {
        id: `test-loc-${nanoid(8)}`,
        name: `Test Auth Location ${nanoid(4)}`,
        description: "Test location for auth",
      },
    });
    testLocationId = location.id;

    // Create a test node
    await prisma.node.create({
      data: {
        id: testNodeId,
        name: `test-node-auth-${nanoid(4)}`,
        hostname: "test-host",
        publicAddress: "192.168.1.1",
        secret: nanoid(32),
        maxMemoryMb: 4096,
        maxCpuCores: 4,
        locationId: testLocationId,
      },
    });

    // Create an API key for the node using the same service as production
    const keyRecord = await createApiKey({
      name: `agent-${testNodeId.slice(0, 8)}`,
      userId: testUserId,
      prefix: "catalyst",
      metadata: {
        nodeId: testNodeId,
        purpose: "agent",
      },
    });

    apiKeyId = keyRecord.id;
    apiKeyRaw = keyRecord.key;
  });

  afterAll(async () => {
    invalidateAgentApiKeyCache(testNodeId);
    if (apiKeyId) {
      await deleteApiKey(apiKeyId).catch(() => {});
    }
    await prisma.node.delete({ where: { id: testNodeId } }).catch(() => {});
    await prisma.location.delete({ where: { id: testLocationId } }).catch(() => {});
    await prisma.user.delete({ where: { id: testUserId } }).catch(() => {});
  });

  it("verifies a valid agent API key created by api-key-service", async () => {
    const result = await verifyAgentApiKey(prisma, testNodeId, apiKeyRaw);
    expect(result).toBe(true);
  });

  it("caches successful verifications", async () => {
    // First call warms the cache
    await verifyAgentApiKey(prisma, testNodeId, apiKeyRaw);
    // Second call should hit cache and still return true
    const result = await verifyAgentApiKey(prisma, testNodeId, apiKeyRaw);
    expect(result).toBe(true);
  });

  it("rejects an invalid API key", async () => {
    const result = await verifyAgentApiKey(prisma, testNodeId, "invalid_key_xyz");
    expect(result).toBe(false);
  });

  it("rejects a valid key for the wrong node", async () => {
    const wrongNodeId = `wrong-node-${nanoid(8)}`;
    const result = await verifyAgentApiKey(prisma, wrongNodeId, apiKeyRaw);
    expect(result).toBe(false);
  });

  it("rejects an empty token", async () => {
    expect(await verifyAgentApiKey(prisma, testNodeId, "")).toBe(false);
    expect(await verifyAgentApiKey(prisma, testNodeId, "   ")).toBe(false);
  });

  it("rejects when nodeId is missing", async () => {
    expect(await verifyAgentApiKey(prisma, "", apiKeyRaw)).toBe(false);
  });
});
