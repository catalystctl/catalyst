import { describe, it, expect } from "vitest";
import { WebSocketGateway } from "../websocket/gateway.js";

/**
 * Regression tests for the WS server_control / console_input authorization
 * contract: admin.read alone must NOT authorize power actions; node
 * assignment alone must not either (decideServerAccess parity).
 */

const loggerStub: any = {
  child: () => loggerStub,
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

function makeClientSocket() {
  const sent: any[] = [];
  return {
    readyState: 1,
    sent,
    on: () => {},
    once: () => {},
    off: () => {},
    send: (data: any) => sent.push(data),
    close: () => {},
    terminate: () => {},
    ping: () => {},
  };
}

/** Prisma stub where user "readOnlyAdmin" has admin.read only, "plain" has
 *  neither, "nodeUser" has node assignment but no node.update role perm. */
function makePrismaStub(): any {
  return {
    systemSetting: { findUnique: async () => null },
    node: { findUnique: async () => null, update: async () => ({}) },
    server: {
      findUnique: async () => ({
        id: "s1",
        uuid: "u1",
        nodeId: "n1",
        ownerId: "owner",
        suspendedAt: null,
      }),
      findMany: async () => [],
    },
    serverAccess: { findUnique: async () => null },
    nodeAssignment: { findFirst: async () => null, findMany: async () => [] },
    role: {
      findMany: async ({ where }: any) => {
        void where;
        return [];
      },
    },
  };
}

describe("WS server_control authorization", () => {
  it("does NOT crash when role lookup fails and denies a user with no grants", async () => {
    const gw: any = new WebSocketGateway(makePrismaStub(), loggerStub);
    const client = {
      userId: "plain",
      socket: makeClientSocket(),
      authenticated: true,
      subscriptions: new Set<string>(),
    };
    gw.clients.set("c1", client);

    await (gw as any).handleClientMessage(
      "c1",
      JSON.stringify({ type: "server_control", serverId: "s1", action: "kill" }),
    );

    const errors = client.socket.sent
      .map((d: any) => JSON.parse(d))
      .filter((m: any) => m.type === "error");
    expect(errors.some((e: any) => e.error === "PERMISSION_DENIED")).toBe(true);
    gw.destroy();
  });

  it("denies power control to a user with only admin.read", async () => {
    const prisma: any = makePrismaStub();
    // Give the "readonly" user a role carrying only admin.read.
    prisma.role.findMany = async () => [{ permissions: ["admin.read"] }];
    const gw: any = new WebSocketGateway(prisma, loggerStub);
    const client = {
      userId: "readonly",
      socket: makeClientSocket(),
      authenticated: true,
      subscriptions: new Set<string>(),
    };
    gw.clients.set("c2", client);

    await (gw as any).handleClientMessage(
      "c2",
      JSON.stringify({ type: "server_control", serverId: "s1", action: "stop" }),
    );

    const errors = client.socket.sent
      .map((d: any) => JSON.parse(d))
      .filter((m: any) => m.type === "error");
    // No access row, not owner, no admin.write, no node.update → denied.
    expect(errors.some((e: any) => e.error === "PERMISSION_DENIED")).toBe(true);
    gw.destroy();
  });

  it("allows power control for the owner", async () => {
    const gw: any = new WebSocketGateway(makePrismaStub(), loggerStub);
    const agentReceived: any[] = [];
    const agentSocket = makeClientSocket();
    (agentSocket as any).send = (d: any) => agentReceived.push(d);
    gw.agents.set("n1", {
      nodeId: "n1",
      socket: agentSocket,
      authenticated: true,
      lastHeartbeat: Date.now(),
    });
    const client = {
      userId: "owner",
      socket: makeClientSocket(),
      authenticated: true,
      subscriptions: new Set<string>(),
    };
    gw.clients.set("c3", client);

    await (gw as any).handleClientMessage(
      "c3",
      JSON.stringify({ type: "server_control", serverId: "s1", action: "stop" }),
    );

    expect(agentReceived.length).toBe(1);
    const msg = JSON.parse(agentReceived[0]);
    // The gateway forwards the control message to the agent (the agent's
    // dispatcher translates server_control → stop).
    expect(msg.type).toBe("server_control");
    expect(msg.action).toBe("stop");
    gw.destroy();
  });
});
