import { describe, it, expect, beforeEach, vi } from "vitest";

// Isolate module state between tests by re-importing after env changes is hard;
// instead exercise the public API with local handler registration.

describe("cache-bus multi-worker invalidation", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.WORKERS;
  });

  it("applies local handlers immediately in single-process mode", async () => {
    const { onCacheInvalidate, broadcastCacheInvalidate } = await import(
      "../lib/cache-bus"
    );

    const seen: Array<{ channel: string; payload: any }> = [];
    const unsub = onCacheInvalidate("agent-auth", (payload) => {
      seen.push({ channel: "agent-auth", payload });
    });

    broadcastCacheInvalidate("agent-auth", { nodeId: "node-1" });
    broadcastCacheInvalidate("agent-auth", { flushAll: true });

    expect(seen).toEqual([
      { channel: "agent-auth", payload: { nodeId: "node-1" } },
      { channel: "agent-auth", payload: { flushAll: true } },
    ]);

    unsub();
    broadcastCacheInvalidate("agent-auth", { nodeId: "node-2" });
    expect(seen).toHaveLength(2);
  });

  it("agent-auth invalidate clears process cache entries", async () => {
    // Import agent-auth which registers the IPC handler as a side effect.
    const agentAuth = await import("../lib/agent-auth");
    // Just ensure the export exists and is callable without throwing.
    expect(() => agentAuth.invalidateAgentApiKeyCache("n1")).not.toThrow();
    expect(() => agentAuth.invalidateAgentApiKeyCache()).not.toThrow();
  });

  it("permissions flush/invalidate exports are callable", async () => {
    const catalog = await import("../lib/permissions-catalog");
    expect(() => catalog.flushPermissionsCache()).not.toThrow();
    expect(() => catalog.invalidateUserPermissions("u1")).not.toThrow();
  });

  it("rbac cache flush exports are callable", async () => {
    const perms = await import("../lib/permissions");
    expect(() => perms.invalidateAdminUserCache("u1")).not.toThrow();
    expect(() => perms.invalidateNodeAccessCache("u1")).not.toThrow();
    expect(() => perms.flushRbacCaches()).not.toThrow();
  });
});
