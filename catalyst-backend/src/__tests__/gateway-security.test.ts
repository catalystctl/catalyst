import { describe, it, expect, afterAll, vi } from "vitest";
import { WebSocketGateway } from "../websocket/gateway.js";

/**
 * Regression tests for confirmed WebSocket gateway security & reliability bugs
 * found in the production-readiness audit.
 *
 * Harness style follows gateway-reliability.test.ts / gw-pending-failfast.test.ts:
 * a real WebSocketGateway instantiated with stub Prisma + stub logger, and
 * fake sockets driven by hand.
 */

const prismaStub: any = {
  systemSetting: { findUnique: async () => null },
  node: {
    findUnique: async () => null,
    update: async () => ({}),
  },
  server: {
    findUnique: async () => null,
    findMany: async () => [],
  },
};
const loggerStub: any = {
  child: () => loggerStub,
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

interface FakeSocket {
  readyState: number;
  sent: any[];
  bufferedAmount: number;
  terminated: boolean;
  on(ev: string, fn: (...args: any[]) => void): void;
  once(ev: string, fn: (...args: any[]) => void): void;
  off(ev: string, fn: (...args: any[]) => void): void;
  send(data: any): void;
  close(): void;
  terminate(): void;
  ping(): void;
  __emit(ev: string, ...args: any[]): void;
}

function makeFakeSocket(): FakeSocket {
  const listeners = new Map<string, Array<(...args: any[]) => void>>();
  const sent: any[] = [];
  const socket: FakeSocket = {
    readyState: 1, // open
    sent,
    bufferedAmount: 0,
    terminated: false,
    on: (ev, fn) => {
      const arr = listeners.get(ev) ?? [];
      arr.push(fn);
      listeners.set(ev, arr);
    },
    once: (ev, fn) => {
      const wrapped = (...args: any[]) => {
        socket.off(ev, wrapped);
        fn(...args);
      };
      const arr = listeners.get(ev) ?? [];
      arr.push(wrapped);
      listeners.set(ev, arr);
    },
    off: (ev, fn) => {
      const arr = listeners.get(ev) ?? [];
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
    send: (data) => {
      sent.push(data);
    },
    close: () => {},
    terminate: () => {
      socket.terminated = true;
    },
    ping: () => {},
    __emit: (ev, ...args) => {
      const arr = listeners.get(ev) ?? [];
      for (const fn of [...arr]) fn(...args);
    },
  };
  return socket;
}

const timers: ReturnType<typeof setTimeout>[] = [];
afterAll(() => {
  for (const t of timers) clearTimeout(t);
});

function seedAgent(gw: any, nodeId: string, socket: FakeSocket) {
  gw.agents.set(nodeId, {
    nodeId,
    socket,
    authenticated: true,
    lastHeartbeat: Date.now(),
    agentVersion: "1.0.0",
    protocolVersion: 1,
    connectedAt: Date.now(),
  });
}

describe("Gateway security & reliability regressions", () => {
  it("C1: a tokenless socket must NOT displace a live authenticated agent", async () => {    const gw: any = new WebSocketGateway(prismaStub, loggerStub);
    const liveSocket = makeFakeSocket();
    seedAgent(gw, "n1", liveSocket);

    const attacker = makeFakeSocket();
    await gw.handleAgentConnection(attacker, "n1", null);

    // The live agent must still own the slot.
    const current = gw.agents.get("n1");
    expect(current).toBeTruthy();
    expect(current.socket).toBe(liveSocket);
    expect(current.authenticated).toBe(true);
    gw.destroy();
  });

  it("C2: binary frames from a non-source node are not forwarded into the backup relay", async () => {
    const gw: any = new WebSocketGateway(prismaStub, loggerStub);
    const srcSocket = makeFakeSocket();
    const dstSocket = makeFakeSocket();
    seedAgent(gw, "src-node", srcSocket);
    seedAgent(gw, "dst-node", dstSocket);

    const relayPromise = gw.relayBackupStream("src-node", "dst-node", {
      backupId: "b1",
    });

    // An intruder (different node) sends binary frames.
    const intruder = makeFakeSocket();
    seedAgent(gw, "intruder", intruder);
    gw.handleAgentMessage("intruder", intruder, Buffer.from("hostile"), true);
    await Promise.resolve();
    expect(dstSocket.sent.length).toBe(0);

    // Frames from the true source ARE forwarded.
    gw.handleAgentMessage("src-node", srcSocket, Buffer.from("real"), true);
    await Promise.resolve();
    const forwarded = dstSocket.sent.filter((d: any) => Buffer.isBuffer(d));
    expect(forwarded.length).toBe(1);
    expect(forwarded[0].toString()).toBe("real");

    gw.rejectBackupRelay("src-node", new Error("test cleanup"));
    await expect(relayPromise).rejects.toThrow("test cleanup");
    gw.destroy();
  });

  it("H2: relay is rejected when the TARGET node disconnects mid-transfer", async () => {
    const gw: any = new WebSocketGateway(prismaStub, loggerStub);
    const srcSocket = makeFakeSocket();
    const dstSocket = makeFakeSocket();
    seedAgent(gw, "src-node", srcSocket);
    seedAgent(gw, "dst-node", dstSocket);

    const relayPromise = gw.relayBackupStream("src-node", "dst-node", {
      backupId: "b1",
    });

    // Target node dies: onClose-equivalent rejects the relay.
    gw.rejectBackupRelay("dst-node", new Error("target disconnected"));
    await expect(relayPromise).rejects.toThrow("target disconnected");
    // The source socket's relay flag must be cleared.
    expect((srcSocket as any).__catalystRelaySocket).toBeUndefined();
    gw.destroy();
  });

  it("C3: maintenance sweep clears console byte budgets and warn counters", async () => {
    const gw: any = new WebSocketGateway(prismaStub, loggerStub);

    (gw.serverConsoleBytes as Map<string, unknown>).set("ghost-1", {
      count: 1024,
      resetAt: Date.now() - 1000,
    });
    (gw.agentLimitWarnings as Map<string, unknown>).set("n9", {
      resetAt: Date.now() - 1000,
    });
    (gw.serverCommandCounters as Map<string, unknown>).set("s9", {
      count: 5,
      resetAt: Date.now() - 1_000_000,
    });
    (gw.clientMessageCounters as Map<string, unknown>).set("c9", {
      count: 999,
      resetAt: Date.now() - 1_000_000,
    });

    gw.sweepCounters();

    expect((gw.serverConsoleBytes as Map<string, unknown>).size).toBe(0);
    expect((gw.agentLimitWarnings as Map<string, unknown>).size).toBe(0);
    expect((gw.serverCommandCounters as Map<string, unknown>).size).toBe(0);
    expect((gw.clientMessageCounters as Map<string, unknown>).size).toBe(0);
    gw.destroy();
  });

  it("H7: heartbeat reap fails pending requests and cleans up the node", async () => {
    const gw: any = new WebSocketGateway(prismaStub, loggerStub);
    const socket = makeFakeSocket();
    seedAgent(gw, "n-reap", socket);

    const timer = setTimeout(() => {}, 60_000);
    timers.push(timer);
    let settled: { ok: boolean } | null = null;
    const settle = (v: { ok: boolean }) => {
      settled = v;
    };
    void new Promise<{ ok: boolean }>((s) => {
      settle({ ok: false });
    });
    (gw.pendingAgentRequests as Map<string, unknown>).set("req-reap", {
      resolve: () => settle({ ok: true }),
      reject: () => settle({ ok: false }),
      timeout: timer,
      kind: "json",
      nodeId: "n-reap",
    });

    // Make the agent heartbeat-dead and run one reap pass by invoking the
    // interval body that startHeartbeatCheck would have registered.
    const agent = gw.agents.get("n-reap");
    agent.lastHeartbeat = Date.now() - 61_000;

    vi.useFakeTimers();
    gw.startHeartbeatCheck();
    vi.advanceTimersByTime(10_000);
    vi.useRealTimers();

    expect(socket.terminated).toBe(true);
    expect(gw.agents.has("n-reap")).toBe(false);
    expect(gw.pendingAgentRequests.has("req-reap")).toBe(false);
    expect(settled).toEqual({ ok: false });
    gw.destroy();
  });

  it("M13: requestFromAgent generates unique request ids (no silent overwrite)", async () => {
    const gw: any = new WebSocketGateway(prismaStub, loggerStub);
    const socket = makeFakeSocket();
    seedAgent(gw, "n1", socket);

    const first = gw.requestFromAgent("n1", { type: "ping" }, 15_000);
    const second = gw.requestFromAgent("n1", { type: "ping" }, 15_000);
    expect(gw.pendingAgentRequests.size).toBe(2);

    gw.failPendingRequestsForNode("n1", "cleanup");
    await expect(first).rejects.toThrow();
    await expect(second).rejects.toThrow();
    expect(gw.pendingAgentRequests.size).toBe(0);
    gw.destroy();
  });

  it("M1: outbox drain does not lose remaining commands when one send throws", async () => {
    // Local prisma stub: the drain's stale-command re-validation must see
    // both servers as running so the stop commands survive to the send phase.
    const prisma: any = {
      ...prismaStub,
      server: {
        findUnique: async () => null,
        findMany: async () => [
          { id: "s1", status: "running", suspendedAt: null },
          { id: "s2", status: "running", suspendedAt: null },
        ],
      },
    };
    const gw: any = new WebSocketGateway(prisma, loggerStub);
    let sendCalls = 0;
    const flakySocket = makeFakeSocket();
    flakySocket.send = () => {
      sendCalls += 1;
      if (sendCalls === 1) throw new Error("boom");
    };
    seedAgent(gw, "n-flaky", flakySocket);

    gw.queueInOutbox("n-flaky", { type: "stop_server", serverId: "s1" });
    gw.queueInOutbox("n-flaky", { type: "stop_server", serverId: "s2" });

    await gw.drainOutbox("n-flaky", gw.agents.get("n-flaky"));

    // First send throws; the failed entry AND the second entry must be
    // re-queued for the next reconnect instead of being silently lost.
    expect(sendCalls).toBe(1);
    const requeued = (gw as any).outbox.get("n-flaky") ?? [];
    expect(requeued.length).toBe(2);
    gw.destroy();
  });

  it("M3: destroy() rejects pending requests and clears the relay", async () => {
    const gw: any = new WebSocketGateway(prismaStub, loggerStub);
    const timer = setTimeout(() => {}, 60_000);
    timers.push(timer);
    let rejected = false;
    void new Promise((_resolve, reject) => {
      (gw.pendingAgentRequests as Map<string, unknown>).set("req-d", {
        resolve: () => {},
        reject: () => {
          rejected = true;
        },
        timeout: timer,
        kind: "json",
        nodeId: "n1",
      });
      void reject;
    });

    gw.destroy();

    expect(rejected).toBe(true);
    expect(gw.pendingAgentRequests.size).toBe(0);
  });

  it("C1b: handshake-path auth binds the agent under the REAL node id (not the pre-auth key)", async () => {
    // E2E regression: handleAgentMessage receives the ROUTING key (the
    // __preauth: key) as its nodeId parameter. The handshake must authenticate
    // against and bind to agent.preAuthNodeId, otherwise the agent stays
    // registered under the temporary key forever and sendToAgent(realId) fails.
    const authCalls: string[] = [];
    const prisma: any = {
      ...prismaStub,
      node: {
        findUnique: async ({ where }: any) => {
          authCalls.push(where.id);
          // The production lookup is by node id — only succeed for the real id.
          return where.id === "real-node" ? { id: "real-node", hostname: "h" } : null;
        },
        update: async () => ({}),
      },
      server: { findUnique: async () => null, findMany: async () => [] },
    };
    const gw: any = new WebSocketGateway(prisma, loggerStub);
    // Stub token verification (the real one does HMAC lookup via agent-auth).
    gw.authenticateAgentToken = async (nodeId: string) => {
      authCalls.push(nodeId);
      return nodeId === "real-node" ? { node: { id: "real-node", hostname: "h" }, authType: "api_key" } : null;
    };

    const socket = makeFakeSocket();
    await gw.handleAgentConnection(socket, "real-node", null);

    // Socket is registered under its pre-auth key and sends the handshake.
    const preAuthEntry = [...gw.agents.entries()].find(([k]) =>
      k.startsWith("__preauth:real-node:"),
    );
    expect(preAuthEntry).toBeTruthy();
    const preAuthKey = preAuthEntry![0];

    gw.handleAgentMessage(
      preAuthKey,
      socket,
      JSON.stringify({
        type: "node_handshake",
        token: "tok",
        protocolVersion: "1.0",
      }),
      false,
    );
    await new Promise((r) => setTimeout(r, 10));

    // Auth must have targeted the REAL node id, and the entry must now be
    // bound under "real-node" with the pre-auth key gone.
    expect(authCalls).toContain("real-node");
    expect(gw.agents.has(preAuthKey)).toBe(false);
    expect(gw.agents.has("real-node")).toBe(true);
    expect(gw.agents.get("real-node").authenticated).toBe(true);
    gw.destroy();
  });
});
