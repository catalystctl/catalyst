import { describe, it, expect } from "vitest";
import { WebSocketGateway } from "../websocket/gateway.js";

/**
 * Regression: SFTP mutations happen entirely on the node, so the agent reports
 * them over the control-plane WebSocket and the gateway must translate that
 * message into the same `server_files_changed` SSE event the panel's file
 * routes emit (routes/servers/files.ts `notifyFileChange`).
 *
 * The gateway must also refuse a server that does not belong to the reporting
 * node — the payload carries filesystem paths, so a compromised node must not
 * be able to publish another node's paths.
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

function makeGateway(serverRow: any, routed: any[]) {
  const gw: any = new WebSocketGateway(
    {
      ...prismaStub,
      server: {
        findUnique: async () => serverRow,
        findMany: async () => [],
      },
    },
    loggerStub,
  );
  (gw as any).routeToClients = async (serverId: string, msg: any) => {
    routed.push({ serverId, msg });
  };
  return gw;
}

describe("agent server_files_changed → SSE", () => {
  it("routes an SFTP write for a server on the reporting node", async () => {
    const routed: any[] = [];
    const gw = makeGateway({ id: "s1", nodeId: "owner-node" }, routed);
    const socket = makeFakeSocket();
    seedAgent(gw, "owner-node", socket);

    await gw.handleAgentMessage(
      "owner-node",
      socket,
      JSON.stringify({
        type: "server_files_changed",
        serverId: "s1",
        action: "write",
        path: "/plugins/a.jar",
      }),
      false,
    );

    expect(routed.length).toBe(1);
    expect(routed[0].serverId).toBe("s1");
    // Must match the existing contract the frontend handler reads.
    expect(routed[0].msg.type).toBe("server_files_changed");
    expect(routed[0].msg.serverId).toBe("s1");
    expect(routed[0].msg.action).toBe("write");
    expect(routed[0].msg.path).toBe("/plugins/a.jar");
    expect(typeof routed[0].msg.timestamp).toBe("number");
    gw.destroy();
  });

  it("preserves the rename from/to shape and omits absent fields", async () => {
    const routed: any[] = [];
    const gw = makeGateway({ id: "s1", nodeId: "owner-node" }, routed);
    const socket = makeFakeSocket();
    seedAgent(gw, "owner-node", socket);

    await gw.handleAgentMessage(
      "owner-node",
      socket,
      JSON.stringify({
        type: "server_files_changed",
        serverId: "s1",
        action: "rename",
        from: "/a.txt",
        to: "/b.txt",
      }),
      false,
    );

    expect(routed.length).toBe(1);
    expect(routed[0].msg.action).toBe("rename");
    expect(routed[0].msg.from).toBe("/a.txt");
    expect(routed[0].msg.to).toBe("/b.txt");
    // nulls would break the frontend's `typeof x === 'string'` checks.
    expect(routed[0].msg.path).toBeUndefined();
    gw.destroy();
  });

  it("drops a message for a server that belongs to another node", async () => {
    const routed: any[] = [];
    const gw = makeGateway({ id: "s1", nodeId: "owner-node" }, routed);
    const socket = makeFakeSocket();
    seedAgent(gw, "attacker-node", socket);

    await gw.handleAgentMessage(
      "attacker-node",
      socket,
      JSON.stringify({
        type: "server_files_changed",
        serverId: "s1",
        action: "delete",
        path: "/secret.txt",
      }),
      false,
    );

    expect(routed.length).toBe(0);
    gw.destroy();
  });

  it("drops a message with no serverId (per-server fan-out needs it)", async () => {
    const routed: any[] = [];
    const gw = makeGateway(null, routed);
    const socket = makeFakeSocket();
    seedAgent(gw, "owner-node", socket);

    await gw.handleAgentMessage(
      "owner-node",
      socket,
      JSON.stringify({
        type: "server_files_changed",
        action: "write",
        path: "/x",
      }),
      false,
    );

    expect(routed.length).toBe(0);
    gw.destroy();
  });

  it("drops a message for an unknown server", async () => {
    const routed: any[] = [];
    const gw = makeGateway(null, routed);
    const socket = makeFakeSocket();
    seedAgent(gw, "owner-node", socket);

    await gw.handleAgentMessage(
      "owner-node",
      socket,
      JSON.stringify({
        type: "server_files_changed",
        serverId: "ghost",
        action: "write",
        path: "/x",
      }),
      false,
    );

    expect(routed.length).toBe(0);
    gw.destroy();
  });
});
