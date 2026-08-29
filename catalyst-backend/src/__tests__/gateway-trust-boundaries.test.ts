import { describe, it, expect } from "vitest";
import {
  sanitizeMetric,
  sanitizeIntMetric,
  toByteCounterBig,
} from "../websocket/gateway.js";
import { WebSocketGateway } from "../websocket/gateway.js";

/**
 * Regression tests for agent-message trust boundaries and metric column
 * clamping (audit findings H3/H4/H8, A6 cross-node matrix).
 */

const prismaStub: any = {
  systemSetting: { findUnique: async () => null },
  node: { findUnique: async () => null, update: async () => ({}) },
  server: { findUnique: async () => null, findMany: async () => [] },
};

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
    terminated: false,
    on: () => {},
    once: () => {},
    off: () => {},
    send: (data: any) => sent.push(data),
    close: () => {},
    terminate: () => {},
    ping: () => {},
  };
}

function seedAgent(gw: any, nodeId: string, socket: any, authenticated = true) {
  gw.agents.set(nodeId, {
    nodeId,
    socket,
    authenticated,
    lastHeartbeat: Date.now(),
    agentVersion: "1.0.0",
    protocolVersion: 1,
    connectedAt: Date.now(),
  });
}

describe("metric clamping (int4/int8 column safety)", () => {
  it("H8: sanitizeIntMetric clamps to int4 max when callers pass INT4 ceiling", () => {
    // The batch/single metric paths now pass INT4_MAX as the ceiling — values
    // beyond it must not reach the DB.
    expect(sanitizeIntMetric(3e9, 0, 2147483647)).toBe(2147483647);
    expect(sanitizeIntMetric(-5, 0, 2147483647)).toBe(0);
    expect(sanitizeIntMetric(Number.NaN, 0, 2147483647)).toBe(0);
  });

  it("H8: toByteCounterBig clamps to int8 max (1e20 input must not overflow)", () => {
    expect(toByteCounterBig(1e20)).toBe(9223372036854775807n);
    expect(toByteCounterBig(-1)).toBe(0n);
    expect(toByteCounterBig(Number.NaN)).toBe(0n);
    expect(toByteCounterBig(1024)).toBe(1024n);
  });
});

describe("agent message trust boundaries", () => {
  it("H3: console_output from a node that does not own the server is dropped", async () => {
    let logCreated = 0;
    const gw: any = new WebSocketGateway(
      {
        ...prismaStub,
        server: {
          ...prismaStub.server,
          // Server lives on node "owner-node"
          findUnique: async () => ({ id: "s1", nodeId: "owner-node" }),
        },
        serverLog: { create: async () => void logCreated++ },
      },
      loggerStub,
    );
    const attackerSocket = makeFakeSocket();
    seedAgent(gw, "attacker-node", attackerSocket);

    await gw.handleAgentMessage(
      "attacker-node",
      attackerSocket,
      JSON.stringify({ type: "console_output", serverId: "s1", data: "forged" }),
      false,
    );

    expect(logCreated).toBe(0);
    gw.destroy();
  });

  it("H3: console_output from the owning node still persists", async () => {
    let logCreated = 0;
    const gw: any = new WebSocketGateway(
      {
        ...prismaStub,
        server: {
          findUnique: async () => ({ id: "s1", nodeId: "owner-node" }),
          findMany: async () => [],
        },
        serverLog: { create: async () => void logCreated++ },
      },
      loggerStub,
    );
    const socket = makeFakeSocket();
    seedAgent(gw, "owner-node", socket);

    await gw.handleAgentMessage(
      "owner-node",
      socket,
      JSON.stringify({ type: "console_output", serverId: "s1", data: "hello" }),
      false,
    );

    expect(logCreated).toBe(1);
    gw.destroy();
  });

  it("H4: eula_required from a non-owning node is dropped", async () => {
    const routed: any[] = [];
    const gw: any = new WebSocketGateway(
      {
        ...prismaStub,
        server: {
          findUnique: async () => ({ id: "s1", nodeId: "owner-node" }),
          findMany: async () => [],
        },
      },
      loggerStub,
    );
    (gw as any).routeToClients = async (serverId: string, msg: any) => {
      routed.push({ serverId, msg });
    };
    const socket = makeFakeSocket();
    seedAgent(gw, "attacker-node", socket);

    await gw.handleAgentMessage(
      "attacker-node",
      socket,
      JSON.stringify({
        type: "eula_required",
        serverId: "s1",
        eulaText: "click here evil.com",
      }),
      false,
    );

    expect(routed.length).toBe(0);
    gw.destroy();
  });

  it("cross-node backup_restore_complete is dropped", async () => {
    const gw: any = new WebSocketGateway(
      {
        ...prismaStub,
        server: {
          findUnique: async () => ({ id: "s1", nodeId: "owner-node" }),
          findMany: async () => [],
          updateMany: async () => {
            throw new Error("must not be called");
          },
        },
        backup: { update: async () => ({}) },
      },
      loggerStub,
    );
    (gw as any).routeToClients = async () => {};
    const socket = makeFakeSocket();
    seedAgent(gw, "attacker-node", socket);

    await gw.handleAgentMessage(
      "attacker-node",
      socket,
      JSON.stringify({ type: "backup_restore_complete", serverId: "s1" }),
      false,
    );
    gw.destroy();
  });

  it("agent_error_report cannot flip another node's server to ERROR", async () => {
    let serverUpdated = 0;
    const gw: any = new WebSocketGateway(
      {
        ...prismaStub,
        server: {
          // findFirst scoped by nodeId — attacker node yields nothing.
          findFirst: async () => null,
          findUnique: async () => null,
          findMany: async () => [],
          update: async () => {
            serverUpdated += 1;
            return {};
          },
        },
        serverLog: { create: async () => {} },
      },
      loggerStub,
    );
    const socket = makeFakeSocket();
    seedAgent(gw, "attacker-node", socket);

    await gw.handleAgentMessage(
      "attacker-node",
      socket,
      JSON.stringify({
        type: "agent_error_report",
        component: "backup",
        message: "boom",
        metadata: { serverId: "victim-server" },
      }),
      false,
    );

    expect(serverUpdated).toBe(0);
    gw.destroy();
  });

  it("backup_complete cannot rewrite another server's backup record", async () => {
    let backupUpdated = 0;
    const gw: any = new WebSocketGateway(
      {
        ...prismaStub,
        server: {
          findUnique: async () => ({
            id: "s1",
            nodeId: "n1",
            status: "stopped",
          }),
          findMany: async () => [],
          update: async () => ({}),
        },
        backup: {
          findFirst: async () => null, // scoped lookup (id+serverId) → none
          update: async () => {
            backupUpdated += 1;
            return {};
          },
        },
      },
      loggerStub,
    );
    (gw as any).routeToClients = async () => {};
    const socket = makeFakeSocket();
    seedAgent(gw, "n1", socket);

    await gw.handleAgentMessage(
      "n1",
      socket,
      JSON.stringify({
        type: "backup_complete",
        serverId: "s1",
        backupId: "victim-backup",
        sizeMb: 1,
      }),
      false,
    );

    expect(backupUpdated).toBe(0);
    gw.destroy();
  });
});
