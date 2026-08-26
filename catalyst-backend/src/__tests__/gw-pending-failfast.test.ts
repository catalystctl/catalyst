import { describe, it, expect, afterAll } from "vitest";
import { WebSocketGateway } from "../websocket/gateway.js";

/**
 * Unit tests for failPendingRequestsForNode() — the CHANGE 1 fail-fast that
 * rejects every in-flight pending agent request belonging to a node whose
 * connection dropped or was replaced.
 *
 * No real gateway sockets are used: the gateway is instantiated with stub
 * Prisma/logger (same pattern as gateway-reliability.test.ts) and fake
 * pending requests are inserted directly into `pendingAgentRequests`.
 */

const prismaStub = {
  systemSetting: {
    findUnique: async () => null,
  },
  node: {
    findUnique: async () => null,
    update: async () => ({}),
  },
};

const loggerStub = {
  child: () => loggerStub,
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as any;

// Timers backing the fake entries' `timeout` field; cleared below so vitest
// never sees a dangling handle.
const timers: ReturnType<typeof setTimeout>[] = [];

afterAll(() => {
  for (const t of timers) clearTimeout(t);
});

/**
 * Insert a fake pending request into the gateway map. Routes the eventual
 * resolve/reject into a observable `settled` promise (so we can assert on the
 * rejection without any unhandled-rejection noise).
 */
function insertFakeRequest(
  map: Map<string, any>,
  requestId: string,
  nodeId: string,
): Promise<{ ok: boolean; value: any }> {
  const timer = setTimeout(() => {}, 60_000);
  timers.push(timer);
  let settle!: (outcome: { ok: boolean; value: any }) => void;
  const settled = new Promise<{ ok: boolean; value: any }>((s) => (settle = s));
  map.set(requestId, {
    resolve: (value: any) => settle({ ok: true, value }),
    reject: (error: Error) => settle({ ok: false, value: error }),
    timeout: timer,
    kind: "json",
    nodeId,
  });
  return settled;
}

describe("failPendingRequestsForNode", () => {
  it("rejects only the disconnected node's requests and returns the count", async () => {
    const gw = new WebSocketGateway(prismaStub as any, loggerStub);
    const map: Map<string, any> = (gw as any).pendingAgentRequests;

    const n1Settled = insertFakeRequest(map, "req-n1", "n1");
    const n2Settled = insertFakeRequest(map, "req-n2", "n2");
    expect(map.size).toBe(2);

    const failed = (gw as any).failPendingRequestsForNode("n1", "gone");

    // Exactly the one matching entry was rejected…
    expect(failed).toBe(1);
    // …and removed from the map, while the other node's entry survives.
    expect(map.has("req-n1")).toBe(false);
    expect(map.get("req-n2")).toBeDefined();
    expect(map.size).toBe(1);

    // The matching request observed its rejection with the given reason.
    const n1Outcome = await n1Settled;
    expect(n1Outcome.ok).toBe(false);
    expect(n1Outcome.value).toBeInstanceOf(Error);
    expect(n1Outcome.value.message).toBe("gone");

    // The other node's request was NOT touched — it remains unsettled.
    const n2Untouched = await Promise.race([
      n2Settled.then(() => false),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 20)),
    ]);
    expect(n2Untouched).toBe(true);

    // Re-running for the same node finds nothing left to fail.
    expect((gw as any).failPendingRequestsForNode("n1", "gone again")).toBe(0);

    try {
      gw.destroy();
    } catch {
      /* ignore */
    }
  });
});
