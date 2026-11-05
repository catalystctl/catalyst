import { describe, expect, it } from "vitest";
import { dispatchInstallCommand, InstallClaimConflictError } from "../routes/servers/power.js";
import { ServerState } from "../routes/servers/_helpers.js";
import { WebSocketGateway } from "../websocket/gateway.js";

const logger: any = {
  child: () => logger,
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

function fakeSocket() {
  return {
    readyState: 1, bufferedAmount: 0,
    on: () => {}, once: () => {}, off: () => {},
    send: () => {}, close: () => {}, terminate: () => {}, ping: () => {},
  };
}

function installationStatusFixture(status = ServerState.STOPPED) {
  const row = {
    id: "server-a",
    nodeId: "node-a",
    status,
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
  const updates: any[] = [];
  const matches = (where: any) =>
    where.id === row.id &&
    where.nodeId === row.nodeId &&
    where.status === row.status &&
    where.updatedAt instanceof Date &&
    where.updatedAt.getTime() === row.updatedAt.getTime();
  const store = {
    updateMany: async ({ where, data }: any) => {
      updates.push({ where, data });
      if (!matches(where)) return { count: 0 };
      row.status = data.status;
      row.updatedAt = data.updatedAt ?? new Date(row.updatedAt.getTime() + 1);
      return { count: 1 };
    },
    findUnique: async () => ({ ...row }),
  };
  return { row, store, updates };
}

function moveInstallationRow(row: any, status: ServerState, nodeId = row.nodeId) {
  row.status = status;
  row.nodeId = nodeId;
  row.updatedAt = new Date(row.updatedAt.getTime() + 1);
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function installationErrorGateway(status = "installing", serverNodeId = "node-a") {
  const row = { id: "server-a", nodeId: serverNodeId, status };
  const updates: any[] = [];
  const logs: any[] = [];
  const store: any = {
    systemSetting: { findUnique: async () => null },
    node: { findUnique: async () => null, update: async () => ({}) },
    server: {
      findUnique: async () => null,
      findMany: async () => [],
      findFirst: async ({ where }: any) =>
        where.id === row.id && where.nodeId === row.nodeId
          ? { id: row.id, status: row.status }
          : null,
      updateMany: async ({ where, data }: any) => {
        updates.push({ where, data });
        if (
          where.id !== row.id ||
          where.nodeId !== row.nodeId ||
          where.status !== row.status
        ) {
          return { count: 0 };
        }
        row.status = data.status;
        return { count: 1 };
      },
    },
    serverLog: { create: async ({ data }: any) => { logs.push(data); } },
  };
  const gateway: any = new WebSocketGateway(store, logger);
  gateway.agents.set("node-a", { nodeId: "node-a", socket: fakeSocket(), authenticated: true });
  gateway.testInstallationRow = row;
  gateway.testInstallationUpdates = updates;
  gateway.testInstallationLogs = logs;
  return gateway;
}

async function sendInstallError(
  gateway: any,
  metadataServerId = "server-a",
  operation = "install",
  includeComponentSuffix = true,
) {
  const stateUpdates: any[] = [];
  gateway.routeToClients = async (_serverId: string, message: any) => {
    if (message.type === "server_state_update") stateUpdates.push(message);
  };
  await gateway.handleAgentMessage(
    "node-a",
    gateway.agents.get("node-a").socket,
    JSON.stringify({
      type: "agent_error_report",
      level: "error",
      component: `agent:${operation}_server${includeComponentSuffix ? ":server-a" : ""}`,
      message: "synthetic image metadata failure",
      metadata: { serverId: metadataServerId, operation },
    }),
    false,
  );
  return stateUpdates;
}

describe("installer dispatch failure ordering", () => {
  it("claims INSTALLING before sending and preserves an immediate terminal failure", async () => {
    const fixture = installationStatusFixture();
    const calls: string[] = [];
    const updateMany = fixture.store.updateMany;
    fixture.store.updateMany = async (args: any) => {
      calls.push(args.data.status);
      if (calls.length === 1) expect(fixture.row.status).toBe(ServerState.STOPPED);
      return updateMany(args);
    };
    const gateway = {
      sendToAgent: async () => {
        calls.push("send");
        expect(fixture.row.status).toBe(ServerState.INSTALLING);
        moveInstallationRow(fixture.row, ServerState.ERROR);
        return false;
      },
    };

    await expect(dispatchInstallCommand(
      "server-a", ServerState.STOPPED, gateway, "node-a", {}, fixture.row.updatedAt, fixture.store,
    )).resolves.toBe(false);
    expect(calls).toEqual([ServerState.INSTALLING, "send", ServerState.STOPPED]);
    expect(fixture.row.status).toBe(ServerState.ERROR);
  });

  it("restores the previous state only for the claim whose command was not delivered", async () => {
    const fixture = installationStatusFixture();
    const result = await dispatchInstallCommand(
      "server-a",
      ServerState.STOPPED,
      { sendToAgent: async () => false },
      "node-a",
      {},
      fixture.row.updatedAt,
      fixture.store,
    );
    expect(result).toBe(false);
    expect(fixture.row.status).toBe(ServerState.STOPPED);
    expect(fixture.updates[1].where).toMatchObject({
      id: "server-a",
      nodeId: "node-a",
      status: ServerState.INSTALLING,
      updatedAt: fixture.updates[0].data.updatedAt,
    });
  });

  it("allows exactly one of two deferred concurrent claims to send", async () => {
    const fixture = installationStatusFixture();
    const expectedUpdatedAt = fixture.row.updatedAt;
    const sendStarted = deferred();
    const releaseSend = deferred();
    let sends = 0;
    const gateway = {
      sendToAgent: async () => {
        sends += 1;
        sendStarted.resolve();
        await releaseSend.promise;
        return true;
      },
    };

    const winner = dispatchInstallCommand(
      "server-a", ServerState.STOPPED, gateway, "node-a", {}, expectedUpdatedAt, fixture.store,
    );
    await sendStarted.promise;
    await expect(dispatchInstallCommand(
      "server-a", ServerState.STOPPED, gateway, "node-a", {}, expectedUpdatedAt, fixture.store,
    )).rejects.toBeInstanceOf(InstallClaimConflictError);
    releaseSend.resolve();
    await expect(winner).resolves.toBe(true);
    expect(sends).toBe(1);
    expect(fixture.row.status).toBe(ServerState.INSTALLING);
  });

  it("rejects a stale claim after a status ABA lifecycle cycle", async () => {
    const fixture = installationStatusFixture();
    const staleExpectedUpdatedAt = fixture.row.updatedAt;
    moveInstallationRow(fixture.row, ServerState.INSTALLING);
    moveInstallationRow(fixture.row, ServerState.STOPPED);
    let sends = 0;
    await expect(dispatchInstallCommand(
      "server-a",
      ServerState.STOPPED,
      { sendToAgent: async () => { sends += 1; return true; } },
      "node-a",
      {},
      staleExpectedUpdatedAt,
      fixture.store,
    )).rejects.toBeInstanceOf(InstallClaimConflictError);
    expect(sends).toBe(0);
    expect(fixture.row.status).toBe(ServerState.STOPPED);
  });

  it("does not roll back a newer installation claim after failed old delivery", async () => {
    const fixture = installationStatusFixture();
    const gateway = {
      sendToAgent: async () => {
        moveInstallationRow(fixture.row, ServerState.STOPPED);
        moveInstallationRow(fixture.row, ServerState.INSTALLING);
        return false;
      },
    };
    await expect(dispatchInstallCommand(
      "server-a", ServerState.STOPPED, gateway, "node-a", {}, fixture.row.updatedAt, fixture.store,
    )).resolves.toBe(false);
    expect(fixture.row.status).toBe(ServerState.INSTALLING);
    expect(fixture.updates[1].where.updatedAt).toBe(fixture.updates[0].data.updatedAt);
  });

  it("rethrows an outgoing send failure after token-scoped rollback", async () => {
    const fixture = installationStatusFixture();
    const sendError = new Error("outgoing socket failed");
    await expect(dispatchInstallCommand(
      "server-a",
      ServerState.STOPPED,
      { sendToAgent: async () => { throw sendError; } },
      "node-a",
      {},
      fixture.row.updatedAt,
      fixture.store,
    )).rejects.toBe(sendError);
    expect(fixture.row.status).toBe(ServerState.STOPPED);
  });

  it("does not send when the claim DAO fails", async () => {
    const fixture = installationStatusFixture();
    const daoError = new Error("claim DAO failed");
    fixture.store.updateMany = async () => { throw daoError; };
    let sends = 0;
    await expect(dispatchInstallCommand(
      "server-a",
      ServerState.STOPPED,
      { sendToAgent: async () => { sends += 1; return true; } },
      "node-a",
      {},
      fixture.row.updatedAt,
      fixture.store,
    )).rejects.toBe(daoError);
    expect(sends).toBe(0);
    expect(fixture.row.status).toBe(ServerState.STOPPED);
  });

  it("fails closed when the successful claim cannot be read back", async () => {
    const fixture = installationStatusFixture();
    fixture.store.findUnique = async (): Promise<any> => null;
    let sends = 0;
    await expect(dispatchInstallCommand(
      "server-a",
      ServerState.STOPPED,
      { sendToAgent: async () => { sends += 1; return true; } },
      "node-a",
      {},
      fixture.row.updatedAt,
      fixture.store,
    )).rejects.toBeInstanceOf(InstallClaimConflictError);
    expect(sends).toBe(0);
  });

  it("propagates claim lookup DAO failures without sending", async () => {
    const fixture = installationStatusFixture();
    const lookupError = new Error("claim lookup DAO failed");
    fixture.store.findUnique = async () => { throw lookupError; };
    let sends = 0;
    await expect(dispatchInstallCommand(
      "server-a",
      ServerState.STOPPED,
      { sendToAgent: async () => { sends += 1; return true; } },
      "node-a",
      {},
      fixture.row.updatedAt,
      fixture.store,
    )).rejects.toBe(lookupError);
    expect(sends).toBe(0);
  });

  it("propagates rollback DAO failures instead of reporting a clean delivery failure", async () => {
    const fixture = installationStatusFixture();
    const rollbackError = new Error("rollback DAO failed");
    const updateMany = fixture.store.updateMany;
    let writes = 0;
    fixture.store.updateMany = async (args: any) => {
      writes += 1;
      if (writes === 2) throw rollbackError;
      return updateMany(args);
    };
    await expect(dispatchInstallCommand(
      "server-a",
      ServerState.STOPPED,
      { sendToAgent: async () => false },
      "node-a",
      {},
      fixture.row.updatedAt,
      fixture.store,
    )).rejects.toBe(rollbackError);
    expect(fixture.row.status).toBe(ServerState.INSTALLING);
  });

  it("includes nodeId in the initial claim", async () => {
    const fixture = installationStatusFixture();
    fixture.row.nodeId = "node-b";
    let sends = 0;
    await expect(dispatchInstallCommand(
      "server-a",
      ServerState.STOPPED,
      { sendToAgent: async () => { sends += 1; return true; } },
      "node-a",
      {},
      fixture.row.updatedAt,
      fixture.store,
    )).rejects.toBeInstanceOf(InstallClaimConflictError);
    expect(sends).toBe(0);
    expect(fixture.updates[0].where.nodeId).toBe("node-a");
  });
});

describe("agent installer errors", () => {
  it("atomically moves the owning server's INSTALLING state to ERROR", async () => {
    const gateway = installationErrorGateway();
    const updates = await sendInstallError(gateway);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      serverId: "server-a", state: ServerState.ERROR,
    });
    expect(gateway.testInstallationUpdates[0].where).toEqual({
      id: "server-a",
      nodeId: "node-a",
      status: ServerState.INSTALLING,
    });
    expect(gateway.testInstallationRow.status).toBe(ServerState.ERROR);
    expect(gateway.testInstallationLogs).toHaveLength(1);
    gateway.destroy();
  });

  for (const operation of ["reinstall", "rebuild"]) {
    it(`accepts suffixless ${operation} errors with actual server metadata`, async () => {
      const gateway = installationErrorGateway();
      const updates = await sendInstallError(gateway, "server-a", operation, false);
      expect(updates).toHaveLength(1);
      expect(updates[0]).toMatchObject({ serverId: "server-a", state: ServerState.ERROR });
      expect(gateway.testInstallationRow.status).toBe(ServerState.ERROR);
      gateway.destroy();
    });
  }

  it("does not update or notify for a server owned by another node", async () => {
    const gateway = installationErrorGateway(ServerState.INSTALLING, "node-b");
    const updates = await sendInstallError(gateway);
    expect(updates).toEqual([]);
    expect(gateway.testInstallationUpdates).toEqual([]);
    expect(gateway.testInstallationLogs).toEqual([]);
    expect(gateway.testInstallationRow.status).toBe(ServerState.INSTALLING);
    gateway.destroy();
  });

  it("drops a stale error transition without overwriting a late terminal state", async () => {
    const gateway = installationErrorGateway();
    const originalUpdate = gateway.testInstallationUpdates;
    const storeUpdate = (gateway as any).prisma.server.updateMany;
    (gateway as any).prisma.server.updateMany = async (args: any) => {
      gateway.testInstallationRow.status = ServerState.STOPPED;
      return storeUpdate(args);
    };
    const updates = await sendInstallError(gateway);
    expect(updates).toEqual([]);
    expect(originalUpdate[0].where.status).toBe(ServerState.INSTALLING);
    expect(gateway.testInstallationLogs).toEqual([]);
    expect(gateway.testInstallationRow.status).toBe(ServerState.STOPPED);
    gateway.destroy();
  });

  it("drops a stale error transition after a late host transfer", async () => {
    const gateway = installationErrorGateway();
    const storeUpdate = (gateway as any).prisma.server.updateMany;
    (gateway as any).prisma.server.updateMany = async (args: any) => {
      gateway.testInstallationRow.nodeId = "node-b";
      return storeUpdate(args);
    };
    const updates = await sendInstallError(gateway);
    expect(updates).toEqual([]);
    expect(gateway.testInstallationUpdates[0].where).toMatchObject({ nodeId: "node-a" });
    expect(gateway.testInstallationLogs).toEqual([]);
    expect(gateway.testInstallationRow).toMatchObject({
      nodeId: "node-b",
      status: ServerState.INSTALLING,
    });
    gateway.destroy();
  });

  it("does not let an install error change a RUNNING server", async () => {
    const gateway = installationErrorGateway("running");
    const updates = await sendInstallError(gateway);
    expect(updates).toEqual([]);
    gateway.destroy();
  });

  it("does not trust a mismatched server ID in metadata", async () => {
    const gateway = installationErrorGateway();
    const updates = await sendInstallError(gateway, "other-server");
    expect(updates).toEqual([]);
    gateway.destroy();
  });
});
