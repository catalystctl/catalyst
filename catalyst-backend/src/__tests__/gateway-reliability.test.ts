import { describe, it, expect, afterAll } from "vitest";
import { WebSocketGateway } from "../websocket/gateway.js";

/**
 * Unit tests for the agent-link reliability features:
 * outbox queueing/TTL, terminate()-based teardown, protocol negotiation
 * constants, and the reliability counters exposed via getReliabilityStats().
 *
 * The gateway is instantiated with stub Prisma/logger; timers created by the
 * constructor are cleared in destroy().
 */

const prismaStub = {
  systemSetting: {
    findUnique: async () => null,
  },
  node: {
    findUnique: async () => null,
    update: async () => ({}),
  },
  server: {
    findMany: async () => [],
  },
};

const loggerStub = {
  child: () => loggerStub,
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as any;

const gateways: WebSocketGateway[] = [];
function makeGateway(): WebSocketGateway {
  const gw = new WebSocketGateway(prismaStub as any, loggerStub);
  gateways.push(gw);
  return gw;
}

afterAll(() => {
  for (const gw of gateways) {
    try {
      gw.destroy();
    } catch {
      /* ignore */
    }
  }
});

function fakeSocket(overrides: Record<string, any> = {}) {
  return Object.assign(
    {
      readyState: 1,
      sent: [] as string[],
      terminated: false,
      closed: false,
      send(payload: string) {
        this.sent.push(payload);
      },
      close() {
        this.closed = true;
      },
      terminate() {
        this.terminated = true;
      },
      ping() {},
      on() {},
    },
    overrides,
  );
}

describe("WebSocketGateway agent-link reliability", () => {
  it("queues OUTBOXABLE messages while the agent is offline", () => {
    const gw = makeGateway();
    const sent = gw.sendToAgent("node-1", { type: "start_server", serverId: "s1" });
    // Offline + queueable → returns true (queued), and lands in the outbox.
    return sent.then((ok) => {
      expect(ok).toBe(true);
      const queued = (gw as any).outbox.get("node-1");
      expect(queued).toHaveLength(1);
      expect(JSON.parse(queued[0].payload).type).toBe("start_server");
    });
  });

  it("does not queue non-control messages while offline", () => {
    const gw = makeGateway();
    return gw.sendToAgent("node-2", { type: "some_bulk_payload" }).then((ok) => {
      expect(ok).toBe(false);
      expect((gw as any).outbox.has("node-2")).toBe(false);
    });
  });

  it("drops queued commands beyond the TTL on drain", async () => {
    const gw = makeGateway();
    const socket = fakeSocket();
    const drainFn = (gw as any).drainOutbox.bind(gw);
    const stale = { payload: JSON.stringify({ type: "start_server" }), queuedAt: Date.now() - 60_000 };
    const fresh = { payload: JSON.stringify({ type: "stop_server" }), queuedAt: Date.now() };
    (gw as any).outbox.set("node-3", [stale, fresh]);
    await drainFn("node-3", { nodeId: "node-3", socket, authenticated: true, lastHeartbeat: Date.now() });
    expect((gw as any).outbox.has("node-3")).toBe(false);
    expect(socket.sent).toHaveLength(1);
    expect(JSON.parse(socket.sent[0]).type).toBe("stop_server");
  });

  it("caps the per-node outbox size", () => {
    const gw = makeGateway();
    const max = (gw.constructor as any).OUTBOX_MAX_PER_NODE;
    let accepted = 0;
    for (let i = 0; i < max + 5; i++) {
      if ((gw as any).queueInOutbox("node-4", { type: "request_immediate_stats" })) accepted++;
    }
    expect(accepted).toBe(max);
  });

  it("sheds low-priority traffic under backpressure but delivers critical types", () => {
    const gw = makeGateway();
    const socket = fakeSocket({ bufferedAmount: 100 * 1024 * 1024 });
    (gw as any).agents.set("node-5", {
      nodeId: "node-5",
      socket,
      authenticated: true,
      lastHeartbeat: Date.now(),
    });

    const criticalPromise = gw.sendToAgent("node-5", { type: "restart_server" });
    const bulkPromise = gw.sendToAgent("node-5", { type: "request_immediate_stats" });

    return Promise.all([criticalPromise, bulkPromise]).then(([crit, bulk]) => {
      expect(crit).toBe(true); // control-plane always attempts delivery
      expect(bulk).toBe(false); // shed under backpressure
      expect(socket.sent).toHaveLength(1);
      expect((gw as any).reliabilityBackpressureDrops.get("node-5")).toBe(1);
    });
  });

  it("terminates replaced sockets instead of polite-closing them", () => {
    const gw = makeGateway();
    const zombie = fakeSocket();
    const terminateFn = (gw as any).terminateSocket.bind(gw);
    terminateFn(zombie);
    expect(zombie.terminated).toBe(true);
    expect(zombie.closed).toBe(false);

    // Falls back to close() when terminate() is unavailable.
    const legacy = fakeSocket();
    (legacy as any).terminate = undefined;
    terminateFn(legacy);
    expect(legacy.closed).toBe(true);
  });

  it("exposes cumulative reliability counters", () => {
    const gw = makeGateway();
    (gw as any).bumpCounter((gw as any).reliabilityHeartbeatTimeouts, "n9");
    (gw as any).recordAgentConnection("n9");
    const stats = gw.getReliabilityStats();
    expect(stats.heartbeatTimeouts.n9).toBe(1);
    expect(stats.connections.n9).toHaveLength(1);
  });

  it("refuses bulk binary sends once backpressure watermark is exceeded", () => {
    const gw = makeGateway();
    const slow = fakeSocket({ bufferedAmount: 100 * 1024 * 1024 });
    (gw as any).agents.set("node-bp", {
      nodeId: "node-bp",
      socket: slow,
      authenticated: true,
      lastHeartbeat: Date.now(),
    });
    expect(gw.sendBinaryToAgent("node-bp", Buffer.alloc(16))).toBe(false);
    // And a healthy socket accepts the payload.
    const fast = fakeSocket();
    (gw as any).agents.get("node-bp").socket = fast;
    expect(gw.sendBinaryToAgent("node-bp", Buffer.alloc(16))).toBe(true);
    expect(fast.sent).toHaveLength(1);
  });

  it("warns about unknown server syncs only once per TTL window", () => {
    const gw = makeGateway();
    const warnOnce = (gw as any).warnUnknownServerSyncOnce.bind(gw);
    for (let i = 0; i < 25; i++) warnOnce("n10", "stale-container");
    expect((gw as any).unknownServerSyncWarned.size).toBe(1);
    expect((gw as any).unknownServerSyncWarned.get("n10:stale-container")).toBeGreaterThan(0);
  });
});
