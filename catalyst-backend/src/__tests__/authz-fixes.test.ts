import { describe, expect, it } from "vitest";
import { checkAnyPerm, enforceKeyScope } from "../routes/servers/_helpers.js";
import { ALL_SERVER_PERMISSIONS } from "../lib/permissions-catalog.js";
import { WebSocketGateway } from "../websocket/gateway.js";

const loggerStub: any = {
  child: () => loggerStub,
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

function makeSocket() {
  const sent: any[] = [];
  return {
    readyState: 1,
    sent,
    on: () => {},
    once: () => {},
    off: () => {},
    send: (d: any) => sent.push(d),
    close: () => {},
    terminate: () => {},
    ping: () => {},
  };
}

function makePrisma(accessPerms: string[] | null, rolePerms: string[] = []) {
  return {
    systemSetting: { findUnique: async () => null },
    node: { findUnique: async () => null, update: async () => ({}) },
    server: {
      findUnique: async () => ({
        id: "s1",
        uuid: "u1",
        ownerId: "owner",
        nodeId: "n1",
        suspendedAt: null,
      }),
      findMany: async () => [],
    },
    serverAccess: {
      findUnique: async () => (accessPerms ? { permissions: accessPerms } : null),
    },
    nodeAssignment: { findFirst: async () => null, findMany: async () => [] },
    role: { findMany: async () => [{ permissions: rolePerms }] },
    roleServerGrant: { findMany: async () => [] },
    roleNodeGrant: { findMany: async () => [] },
  };
}

async function sendControl(accessPerms: string[] | null, action: string) {
  const prisma: any = makePrisma(accessPerms);
  const gw: any = new WebSocketGateway(prisma, loggerStub);
  const agentSocket = makeSocket();
  gw.agents.set("n1", {
    nodeId: "n1",
    socket: agentSocket,
    authenticated: true,
    lastHeartbeat: Date.now(),
  });
  const clientSocket = makeSocket();
  gw.clients.set("c1", {
    userId: "subuser",
    socket: clientSocket,
    authenticated: true,
    subscriptions: new Set<string>(),
  });
  await gw.handleClientMessage("c1", JSON.stringify({ type: "server_control", serverId: "s1", action }));
  const out = [...(agentSocket as any).sent, ...(clientSocket as any).sent].map((d) => {
    try {
      return JSON.parse(d);
    } catch {
      return d;
    }
  });
  gw.destroy();
  return out;
}

describe("authorization fix regressions", () => {
  it("suspend requires server.suspend, not admin.read", () => {
    expect(checkAnyPerm({ user: { permissions: ["admin.read"] } }, ["*", "admin.write", "server.suspend"])).toBe(false);
    expect(checkAnyPerm({ user: { permissions: ["server.suspend"] } }, ["*", "admin.write", "server.suspend"])).toBe(true);
    expect(checkAnyPerm({ user: { permissions: ["admin.write"] } }, ["*", "admin.write", "server.suspend"])).toBe(true);
  });

  it("API token scope ceilings per-server operations", () => {
    expect(enforceKeyScope(undefined, "file.write")).toBe(true);
    expect(enforceKeyScope({ permissions: ["server.read"] }, "file.write")).toBe(true);
    expect(enforceKeyScope({ permissions: ["server.read"], apiKeyId: "k1" }, "file.write")).toBe(false);
    expect(enforceKeyScope({ permissions: ["file.write"], apiKeyId: "k1" }, "file.write")).toBe(true);
    expect(enforceKeyScope({ permissions: ["*"], apiKeyId: "k1" }, "file.write")).toBe(true);
  });

  it("server permission registry includes download and lifecycle grants", () => {
    expect((ALL_SERVER_PERMISSIONS as readonly string[])).toContain("backup.download");
    expect((ALL_SERVER_PERMISSIONS as readonly string[])).toContain("server.update");
  });

  it("WS restart requires both start and stop", async () => {
    const stopOnly = await sendControl(["server.stop"], "restart");
    expect(stopOnly.some((m: any) => m?.error === "PERMISSION_DENIED")).toBe(true);
    const both = await sendControl(["server.start", "server.stop"], "restart");
    expect(both.some((m: any) => m?.type === "server_control" && m?.action === "restart")).toBe(true);
  });

  it("WS stop still allows stop-only holders", async () => {
    const out = await sendControl(["server.stop"], "stop");
    expect(out.some((m: any) => m?.type === "server_control")).toBe(true);
  });

  it("WS console_input requires console.write, not just any grant", async () => {
    const deniedPrisma: any = {
      systemSetting: { findUnique: async () => null },
      node: { findUnique: async () => null, update: async () => ({}) },
      server: {
        findUnique: async () => ({
          id: "s1",
          uuid: "u1",
          ownerId: "owner",
          nodeId: "n1",
          suspendedAt: null,
        }),
        findMany: async () => [],
      },
      serverAccess: { findUnique: async () => ({ permissions: ["console.read"] }) },
      nodeAssignment: { findFirst: async () => null, findMany: async () => [] },
      role: { findMany: async () => [] },
      roleServerGrant: { findMany: async () => [] },
      roleNodeGrant: { findMany: async () => [] },
    };
    const gw: any = new WebSocketGateway(deniedPrisma, loggerStub);
    gw.agents.set("n1", {
      nodeId: "n1",
      socket: makeSocket(),
      authenticated: true,
      lastHeartbeat: Date.now(),
    });
    const clientSocket = makeSocket();
    gw.clients.set("c1", {
      userId: "subuser",
      socket: clientSocket,
      authenticated: true,
      subscriptions: new Set<string>(),
    });
    await gw.handleClientMessage("c1", JSON.stringify({ type: "console_input", serverId: "s1", data: "help\n" }));
    const denied = (clientSocket as any).sent.map((d: string) => {
      try {
        return JSON.parse(d);
      } catch {
        return null;
      }
    });
    gw.destroy();
    expect(denied.some((m: any) => m?.error === "PERMISSION_DENIED")).toBe(true);
  });
});
