import { describe, it, expect } from "vitest";
import { WebSocketGateway } from "../websocket/gateway.js";

/**
 * Regression tests for the WS authorization contract:
 * - server_control / console_input are write channels: admin.read alone
 *   must NOT authorize them; node assignment alone must not either
 *   (decideServerAccess parity).
 * - node_manage pairing accepts node.server_manage (new vocabulary) and
 *   the legacy node.update split value.
 * - sendConsoleCommand enforces the API-key scope ceiling (console.write).
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
    roleServerGrant: { findMany: async () => [] },
    roleNodeGrant: { findMany: async () => [] },
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

describe("WS console_input authorization (write channel)", () => {
  it("denies console input to a user with only admin.read", async () => {
    const prisma: any = makePrismaStub();
    prisma.role.findMany = async () => [{ permissions: ["admin.read"] }];
    const gw: any = new WebSocketGateway(prisma, loggerStub);
    gw.agents.set("n1", {
      nodeId: "n1",
      socket: makeClientSocket(),
      authenticated: true,
      lastHeartbeat: Date.now(),
    });
    const client = {
      userId: "ro-console",
      socket: makeClientSocket(),
      authenticated: true,
      subscriptions: new Set<string>(),
    };
    gw.clients.set("c4", client);

    await (gw as any).handleClientMessage(
      "c4",
      JSON.stringify({ type: "console_input", serverId: "s1", data: "help\n" }),
    );

    const errors = client.socket.sent
      .map((d: any) => JSON.parse(d))
      .filter((m: any) => m.type === "error");
    expect(errors.some((e: any) => e.error === "PERMISSION_DENIED")).toBe(true);
    gw.destroy();
  });

  it("allows console input via node assignment paired with node.server_manage (new vocabulary)", async () => {
    const prisma: any = makePrismaStub();
    prisma.role.findMany = async () => [{ permissions: ["node.server_manage"] }];
    prisma.nodeAssignment.findFirst = async () => ({
      id: "na1",
      nodeId: "n1",
      userId: "nm-console",
      expiresAt: null,
    });
    const gw: any = new WebSocketGateway(prisma, loggerStub);
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
      userId: "nm-console",
      socket: makeClientSocket(),
      authenticated: true,
      subscriptions: new Set<string>(),
    };
    gw.clients.set("c5", client);

    await (gw as any).handleClientMessage(
      "c5",
      JSON.stringify({ type: "console_input", serverId: "s1", data: "help\n" }),
    );

    expect(agentReceived.length).toBe(1);
    const forwarded = JSON.parse(agentReceived[0]);
    expect(forwarded.type).toBe("console_input");
    expect(forwarded.serverUuid).toBe("u1");
    expect(forwarded.data).toBe("help\n");
    gw.destroy();
  });

  it("still allows console input via the legacy node.update split value", async () => {
    const prisma: any = makePrismaStub();
    prisma.role.findMany = async () => [{ permissions: ["node.update"] }];
    prisma.nodeAssignment.findFirst = async () => ({
      id: "na2",
      nodeId: "n1",
      userId: "legacy-console",
      expiresAt: null,
    });
    const gw: any = new WebSocketGateway(prisma, loggerStub);
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
      userId: "legacy-console",
      socket: makeClientSocket(),
      authenticated: true,
      subscriptions: new Set<string>(),
    };
    gw.clients.set("c6", client);

    await (gw as any).handleClientMessage(
      "c6",
      JSON.stringify({ type: "console_input", serverId: "s1", data: "help\n" }),
    );

    expect(agentReceived.length).toBe(1);
    gw.destroy();
  });
});

describe("WS subscribe authorization (node_manage vocabulary)", () => {
  it("grants subscribe with node assignment paired with node.server_manage", async () => {
    const prisma: any = makePrismaStub();
    prisma.role.findMany = async () => [{ permissions: ["node.server_manage"] }];
    prisma.nodeAssignment.findFirst = async () => ({
      id: "na3",
      nodeId: "n1",
      userId: "nm-sub",
      expiresAt: null,
    });
    const gw: any = new WebSocketGateway(prisma, loggerStub);
    const client = {
      userId: "nm-sub",
      socket: makeClientSocket(),
      authenticated: true,
      subscriptions: new Set<string>(),
      consoleSubscriptions: new Set<string>(),
    };
    gw.clients.set("c7", client);

    await (gw as any).handleClientMessage(
      "c7",
      JSON.stringify({ type: "subscribe", serverId: "s1" }),
    );

    const errors = client.socket.sent
      .map((d: any) => JSON.parse(d))
      .filter((m: any) => m.type === "error");
    expect(errors.length).toBe(0);
    expect(client.subscriptions.has("s1")).toBe(true);
    expect(client.consoleSubscriptions.has("s1")).toBe(true);
    gw.destroy();
  });

  it("grants subscribe for a read-tier admin (admin.read) with no server row", async () => {
    const prisma: any = makePrismaStub();
    prisma.role.findMany = async () => [{ permissions: ["admin.read"] }];
    const gw: any = new WebSocketGateway(prisma, loggerStub);
    const client = {
      userId: "ro-sub",
      socket: makeClientSocket(),
      authenticated: true,
      subscriptions: new Set<string>(),
      consoleSubscriptions: new Set<string>(),
    };
    gw.clients.set("c8", client);

    await (gw as any).handleClientMessage(
      "c8",
      JSON.stringify({ type: "subscribe", serverId: "s1" }),
    );

    const errors = client.socket.sent
      .map((d: any) => JSON.parse(d))
      .filter((m: any) => m.type === "error");
    expect(errors.length).toBe(0);
    expect(client.subscriptions.has("s1")).toBe(true);
    // Console output is a read stream — admin.read satisfies console.read.
    expect(client.consoleSubscriptions.has("s1")).toBe(true);
    gw.destroy();
  });
});

describe("sendConsoleCommand API-key scope ceiling", () => {
  it("rejects a console.read-only API key even for the server owner", async () => {
    const prisma: any = makePrismaStub();
    const gw: any = new WebSocketGateway(prisma, loggerStub);
    await expect(
      gw.sendConsoleCommand("s1", "owner", "help\n", {
        permissions: ["console.read"],
        apiKeyId: "k1",
      }),
    ).rejects.toMatchObject({ code: 403 });
    gw.destroy();
  });

  it("still enforces the user-level gate when the key holds console.write", async () => {
    const prisma: any = makePrismaStub();
    const gw: any = new WebSocketGateway(prisma, loggerStub);
    // A stranger with no row, no roles, no node access — the key's scope
    // must not REPLACE the user-level permission check.
    await expect(
      gw.sendConsoleCommand("s1", "plain", "help\n", {
        permissions: ["console.write"],
        apiKeyId: "k2",
      }),
    ).rejects.toMatchObject({ code: 403 });
    gw.destroy();
  });
});
