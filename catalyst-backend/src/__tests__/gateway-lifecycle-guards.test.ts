import { describe, it, expect } from "vitest";
import { WebSocketGateway } from "../websocket/gateway.js";

/**
 * Regression tests for deferred-but-now-fixed reliability items:
 * - outbox stale-command re-validation at drain time (start/stop/kill/restart
 *   replayed against current DB state instead of blindly),
 * - the 30s agent state sync no longer force-overriding guarded transitional
 *   states (INSTALLING / TRANSFERRING / CLONING),
 * - sync_complete no longer marking INSTALLING/TRANSFERRING/CLONING servers
 *   as STOPPED when their container is (expectedly) absent.
 */

const loggerStub: any = {
  child: () => loggerStub,
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

function makeFakeSocket() {
  const sent: any[] = [];
  return {
    readyState: 1,
    sent,
    bufferedAmount: 0,
    on: () => {},
    once: () => {},
    off: () => {},
    send: (data: any) => sent.push(data),
    close: () => {},
    terminate: () => {},
    ping: () => {},
  };
}

function seedAgent(gw: any, nodeId: string, socket: any) {
  gw.agents.set(nodeId, {
    nodeId,
    socket,
    authenticated: true,
    lastHeartbeat: Date.now(),
  });
}

describe("outbox stale-command re-validation", () => {
  it("drops a queued start_server when the server is no longer startable", async () => {
    const prisma: any = {
      systemSetting: { findUnique: async () => null },
      node: { findUnique: async () => null, update: async () => ({}) },
      server: {
        findMany: async () => [{ id: "s1", status: "running", suspendedAt: null }],
      },
    };
    const gw: any = new WebSocketGateway(prisma, loggerStub);
    const socket = makeFakeSocket();
    seedAgent(gw, "n1", socket);
    gw.queueInOutbox("n1", { type: "start_server", serverId: "s1" });

    await gw.drainOutbox("n1", gw.agents.get("n1"));

    expect(socket.sent.length).toBe(0);
    gw.destroy();
  });

  it("drops a queued stop_server for a server that was suspended meanwhile", async () => {
    const prisma: any = {
      systemSetting: { findUnique: async () => null },
      node: { findUnique: async () => null, update: async () => ({}) },
      server: {
        findMany: async () => [{ id: "s1", status: "stopped", suspendedAt: new Date() }],
      },
    };
    const gw: any = new WebSocketGateway(prisma, loggerStub);
    const socket = makeFakeSocket();
    seedAgent(gw, "n1", socket);
    gw.queueInOutbox("n1", { type: "stop_server", serverId: "s1" });

    await gw.drainOutbox("n1", gw.agents.get("n1"));

    expect(socket.sent.length).toBe(0);
    gw.destroy();
  });

  it("replays a power command when DB state still allows it", async () => {
    const prisma: any = {
      systemSetting: { findUnique: async () => null },
      node: { findUnique: async () => null, update: async () => ({}) },
      server: {
        findMany: async () => [{ id: "s1", status: "stopped", suspendedAt: null }],
      },
    };
    const gw: any = new WebSocketGateway(prisma, loggerStub);
    const socket = makeFakeSocket();
    seedAgent(gw, "n1", socket);
    gw.queueInOutbox("n1", { type: "start_server", serverId: "s1" });

    await gw.drainOutbox("n1", gw.agents.get("n1"));

    expect(socket.sent.length).toBe(1);
    expect(JSON.parse(socket.sent[0]).type).toBe("start_server");
    gw.destroy();
  });

  it("replays power commands when DB re-validation fails (fail-open)", async () => {
    const prisma: any = {
      systemSetting: { findUnique: async () => null },
      node: { findUnique: async () => null, update: async () => ({}) },
      server: {
        findMany: async () => {
          throw new Error("db down");
        },
      },
    };
    const gw: any = new WebSocketGateway(prisma, loggerStub);
    const socket = makeFakeSocket();
    seedAgent(gw, "n1", socket);
    gw.queueInOutbox("n1", { type: "start_server", serverId: "s1" });

    await gw.drainOutbox("n1", gw.agents.get("n1"));

    expect(socket.sent.length).toBe(1);
    gw.destroy();
  });

  it("never drops non-power outbox commands (stats/resume)", async () => {
    const prisma: any = {
      systemSetting: { findUnique: async () => null },
      node: { findUnique: async () => null, update: async () => ({}) },
      server: {
        findMany: async () => [],
      },
    };
    const gw: any = new WebSocketGateway(prisma, loggerStub);
    const socket = makeFakeSocket();
    seedAgent(gw, "n1", socket);
    gw.queueInOutbox("n1", { type: "request_immediate_stats", serverId: "s1" });
    gw.queueInOutbox("n1", { type: "resume_console", serverId: "s1" });

    await gw.drainOutbox("n1", gw.agents.get("n1"));

    expect(socket.sent.length).toBe(2);
    gw.destroy();
  });
});

describe("state sync transitional-state protection", () => {
  it("sync cannot force INSTALLING → STOPPED (start mid-install race)", async () => {
    let statusWritten: string | null = null;
    const prisma: any = {
      systemSetting: { findUnique: async () => null },
      node: { findUnique: async () => null, update: async () => ({}) },
      server: {
        findUnique: async () => ({
          id: "s1",
          nodeId: "n1",
          status: "installing",
          suspendedAt: null,
        }),
        update: async ({ data }: any) => {
          statusWritten = data.status;
          return {};
        },
      },
      serverLog: { create: async () => {} },
    };
    const gw: any = new WebSocketGateway(prisma, loggerStub);
    (gw as any).routeToClients = async () => {};
    const socket = makeFakeSocket();
    seedAgent(gw, "n1", socket);

    await gw.handleAgentMessage(
      "n1",
      socket,
      JSON.stringify({ type: "server_state_sync", serverId: "s1", state: "stopped" }),
      false,
    );

    expect(statusWritten).toBeNull();
    gw.destroy();
  });

  it("sync still reconciles ordinary drifted states (stopped → running)", async () => {
    let statusWritten: string | null = null;
    const prisma: any = {
      systemSetting: { findUnique: async () => null },
      node: { findUnique: async () => null, update: async () => ({}) },
      server: {
        findUnique: async () => ({
          id: "s1",
          nodeId: "n1",
          status: "stopped",
          suspendedAt: null,
        }),
        update: async ({ data }: any) => {
          statusWritten = data.status;
          return {};
        },
      },
      serverLog: { create: async () => {} },
    };
    const gw: any = new WebSocketGateway(prisma, loggerStub);
    (gw as any).routeToClients = async () => {};
    const socket = makeFakeSocket();
    seedAgent(gw, "n1", socket);

    await gw.handleAgentMessage(
      "n1",
      socket,
      JSON.stringify({ type: "server_state_sync", serverId: "s1", state: "running" }),
      false,
    );

    expect(statusWritten).toBe("running");
    gw.destroy();
  });

  it("sync_complete does not mark INSTALLING servers STOPPED for missing containers", async () => {
    let stoppedWrites = 0;
    const prisma: any = {
      systemSetting: { findUnique: async () => null },
      node: { findUnique: async () => null, update: async () => ({}) },
      server: {
        // INSTALLING is excluded from the query now; return empty result set
        // while a spy verifies the query shape would have excluded it.
        findMany: async ({ where }: any) => {
          const excluded = where.status.notIn;
          if (
            !excluded.includes("installing") ||
            !excluded.includes("transferring") ||
            !excluded.includes("cloning")
          ) {
            throw new Error("sync_complete query must exclude transitional states");
          }
          return [];
        },
        update: async () => {
          stoppedWrites += 1;
          return {};
        },
      },
      serverLog: { create: async () => {} },
    };
    const gw: any = new WebSocketGateway(prisma, loggerStub);
    (gw as any).routeToClients = async () => {};
    const socket = makeFakeSocket();
    seedAgent(gw, "n1", socket);

    await gw.handleAgentMessage(
      "n1",
      socket,
      JSON.stringify({
        type: "server_state_sync_complete",
        nodeId: "n1",
        foundContainers: [],
      }),
      false,
    );

    expect(stoppedWrites).toBe(0);
    gw.destroy();
  });
});
