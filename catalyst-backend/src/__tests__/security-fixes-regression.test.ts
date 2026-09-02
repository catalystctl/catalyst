/**
 * Regression tests for security fixes from the 2026-09 adversarial audit.
 *
 * Covers:
 * 1. Alert webhook SSRF guard (isPrivateWebhookTarget / resolveAndCheckWebhookUrl)
 * 2. IPAM hard-delete release semantics (released IPs become re-allocatable)
 */
import { describe, it, expect } from "vitest";
import { URL } from "url";

describe("alert webhook SSRF guard", () => {
  // Direct unit coverage of the exported validators.
  describe("isPrivateHostname semantics via isPrivateWebhookTarget", () => {
    it("blocks non-http(s) schemes", async () => {
      const { isPrivateWebhookTarget } = await import(
        "../services/alert-service.js"
      );
      expect(await isPrivateWebhookTarget(new URL("ftp://example.com/x"))).toBe(true);
      expect(await isPrivateWebhookTarget(new URL("file:///etc/passwd"))).toBe(true);
    });

    it("blocks literal localhost and reserved names", async () => {
      const { isPrivateWebhookTarget } = await import(
        "../services/alert-service.js"
      );
      expect(await isPrivateWebhookTarget(new URL("http://localhost/hook"))).toBe(true);
      expect(await isPrivateWebhookTarget(new URL("http://localhost:6379/"))).toBe(true);
      expect(await isPrivateWebhookTarget(new URL("http://db.internal/hook"))).toBe(true);
    });

    it("blocks alternate textual IPv4 encodings", async () => {
      const { isPrivateWebhookTarget } = await import(
        "../services/alert-service.js"
      );
      // Hex, decimal, and octal representations of 127.0.0.1
      expect(await isPrivateWebhookTarget(new URL("http://0x7f000001/hook"))).toBe(true);
      expect(await isPrivateWebhookTarget(new URL("http://2130706433/hook"))).toBe(true);
      expect(await isPrivateWebhookTarget(new URL("http://0177.0.0.1/hook"))).toBe(true);
    });

    it("blocks IPv4-mapped IPv6 loopback/private", async () => {
      const { isPrivateWebhookTarget } = await import(
        "../services/alert-service.js"
      );
      expect(
        await isPrivateWebhookTarget(new URL("http://[::ffff:127.0.0.1]/hook"))
      ).toBe(true);
      expect(
        await isPrivateWebhookTarget(new URL("http://[::ffff:10.1.2.3]/hook"))
      ).toBe(true);
    });

    it("blocks public DNS names that resolve into private space", async () => {
      const { resolveAndCheckWebhookUrl } = await import(
        "../services/alert-service.js"
      );
      // localhost resolves to 127.0.0.1 via the OS resolver
      expect(await resolveAndCheckWebhookUrl(new URL("http://localhost.:8443/"))).toBe(true);
      // Unresolvable garbage fails closed
      expect(
        await resolveAndCheckWebhookUrl(
          new URL("http://catalyst-ssrf-nonexistent.invalid/hook")
        )
      ).toBe(true);
    });

    it("allows genuine public HTTPS targets", async () => {
      const { isPrivateWebhookTarget } = await import(
        "../services/alert-service.js"
      );
      expect(await isPrivateWebhookTarget(new URL("https://hooks.example.com/x"))).toBe(false);
    });
  });
});

describe("IPAM hard-delete release", () => {
  it("releaseIpForServer deletes the allocation row instead of soft-releasing", async () => {
    const calls: any[] = [];
    const allocation = {
      id: "alloc-1",
      poolId: "pool-1",
      serverId: "srv-1",
      ip: "10.42.0.5",
      releasedAt: null,
    };
    const prismaLike: any = {
      ipAllocation: {
        findFirst: async () => allocation,
        update: async (args: any) => {
          calls.push(["update", args]);
          return allocation;
        },
        delete: async (args: any) => {
          calls.push(["delete", args]);
          return allocation;
        },
      },
    };
    const { releaseIpForServer } = await import("../utils/ipam.js");
    const ip = await releaseIpForServer(prismaLike, "srv-1");
    expect(ip).toBe("10.42.0.5");
    // Must NOT soft-release (update with releasedAt) — must hard-delete.
    expect(calls.some(([op]) => op === "update")).toBe(false);
    expect(calls.some(([op, args]: any) => op === "delete" && args.where.id === "alloc-1")).toBe(true);
  });
});
