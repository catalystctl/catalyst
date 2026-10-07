/**
 * Global-stream delivery scope (REALTIME_AUDIT P1.1 / U1 user scope).
 *
 * - evaluateGlobalSseDelivery(): pure predicate for snapshot hit/miss,
 *   user-scope hit/miss, and unfiltered (full-admin) subscribers.
 * - pushToGlobalSubscribers(): snapshot-miss subscribers get a live access
 *   re-check (serverAllowsUser, cache + DB fallback) so a server granted
 *   after the handshake still delivers (gap G3); user-scoped payloads only
 *   reach their own subscriber.
 * - Subscriber count helpers used by the admin/global SSE caps (P4).
 */
import { describe, it, expect, afterAll, vi } from 'vitest';
import { WebSocketGateway, evaluateGlobalSseDelivery } from '../websocket/gateway.js';

// Server-scoped role resolution runs through permissions-catalog's own
// module-level prisma (dynamic import at call time), which a plain gateway
// prisma stub cannot reach once another suite has loaded the catalog (the
// suite runs with isolate:false and a shared module cache). Mock the
// resolver itself; everything else stays real via the spread.
const permState = vi.hoisted(() => ({ rolesByUser: new Map<string, string[]>() }));
vi.mock('../lib/permissions-catalog.js', async (importOriginal: () => Promise<object>) => ({
  ...(await importOriginal()),
  resolveServerPermissions: async (userId: string) =>
    permState.rolesByUser.get(userId) ?? [],
}));

const OWNER_ID = 'u-owner';
const STRANGER_ID = 'u-stranger';
const SERVER_ID = 'srv-live-recheck';

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
    findUnique: async () => ({
      id: SERVER_ID,
      ownerId: OWNER_ID,
      nodeId: 'node-1',
      access: [],
      node: { id: 'node-1', nodeAssignments: [] },
    }),
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

describe('evaluateGlobalSseDelivery (pure predicate)', () => {
  const scoped = (serverIds: string[], userId?: string) => ({
    serverIds: new Set(serverIds),
    userId,
  });

  it('scoped server hit → deliver', () => {
    expect(
      evaluateGlobalSseDelivery({ serverId: 's1' }, scoped(['s1'], 'u1')),
    ).toBe('deliver');
  });

  it('scoped server miss → recheck-live when the subscriber has a userId', () => {
    expect(
      evaluateGlobalSseDelivery({ serverId: 's2' }, scoped(['s1'], 'u1')),
    ).toBe('recheck-live');
  });

  it('scoped server miss without a subscriber userId → drop (nothing to verify)', () => {
    expect(evaluateGlobalSseDelivery({ serverId: 's2' }, scoped(['s1']))).toBe('drop');
  });

  it('user scope hit → deliver', () => {
    expect(
      evaluateGlobalSseDelivery({ userId: 'u1' }, scoped(['s1'], 'u1')),
    ).toBe('deliver');
  });

  it('user scope miss → drop for a scoped subscriber', () => {
    expect(
      evaluateGlobalSseDelivery({ userId: 'u2' }, scoped(['s1'], 'u1')),
    ).toBe('drop');
  });

  it('user scope miss + server outside the snapshot → drop (user filter first)', () => {
    expect(
      evaluateGlobalSseDelivery({ serverId: 's9', userId: 'u2' }, scoped(['s1'], 'u1')),
    ).toBe('drop');
  });

  it('user scope hit + server outside the snapshot → recheck-live', () => {
    expect(
      evaluateGlobalSseDelivery({ serverId: 's9', userId: 'u1' }, scoped(['s1'], 'u1')),
    ).toBe('recheck-live');
  });

  it('unfiltered (full-admin, serverIds undefined) receives everything', () => {
    const admin = { serverIds: undefined, userId: 'admin1' };
    expect(evaluateGlobalSseDelivery({ serverId: 's9', userId: 'u2' }, admin)).toBe('deliver');
    expect(evaluateGlobalSseDelivery({ userId: 'u2' }, admin)).toBe('deliver');
    expect(evaluateGlobalSseDelivery({}, admin)).toBe('deliver');
  });

  it('payload without serverId/userId → deliver to a scoped subscriber', () => {
    expect(evaluateGlobalSseDelivery({}, scoped(['s1'], 'u1'))).toBe('deliver');
  });
});

describe('subscriber counts (P4 caps)', () => {
  it('counts admin subscribers across add/unsubscribe', () => {
    const gw = makeGateway();
    const before = gw.getAdminSseSubscriberCount();
    const a = gw.addAdminEventSubscriber(['alert_created'], () => {});
    const b = gw.addAdminEventSubscriber(['alert_created'], () => {});
    expect(gw.getAdminSseSubscriberCount()).toBe(before + 2);
    a.unsubscribe();
    expect(gw.getAdminSseSubscriberCount()).toBe(before + 1);
    b.unsubscribe();
    expect(gw.getAdminSseSubscriberCount()).toBe(before);
  });

  it('counts global subscribers across add/unsubscribe', () => {
    const gw = makeGateway();
    const before = gw.getGlobalSseSubscriberCount();
    const a = gw.addGlobalSseSubscriber(['alert'], () => {}, ['s1'], 'u1');
    const b = gw.addGlobalSseSubscriber(['alert'], () => {}, undefined, 'admin');
    expect(gw.getGlobalSseSubscriberCount()).toBe(before + 2);
    a.unsubscribe();
    b.unsubscribe();
    expect(gw.getGlobalSseSubscriberCount()).toBe(before);
  });
});

describe('pushToGlobalSubscribers delivery', () => {
  it('re-checks live access on snapshot miss (grant newer than handshake)', async () => {
    const gw = makeGateway();
    const ownerReceived: string[] = [];
    const strangerReceived: string[] = [];
    // Empty handshake snapshots: both predate the (later) grant.
    gw.addGlobalSseSubscriber(['alert'], (_e, d) => ownerReceived.push(d), [], OWNER_ID);
    gw.addGlobalSseSubscriber(['alert'], (_e, d) => strangerReceived.push(d), [], STRANGER_ID);

    await gw.pushToGlobalSubscribers('alert', {
      type: 'alert',
      serverId: SERVER_ID,
      alertId: 'a1',
      timestamp: Date.now(),
    });

    expect(ownerReceived.length).toBe(1);
    expect(strangerReceived.length).toBe(0);
  });

  it('delivers payload serverId directly to snapshot subscribers', async () => {
    const gw = makeGateway();
    const received: string[] = [];
    gw.addGlobalSseSubscriber(['alert'], (_e, d) => received.push(d), ['s-in-snapshot'], 'u1');

    await gw.pushToGlobalSubscribers('alert', {
      type: 'alert',
      serverId: 's-in-snapshot',
      alertId: 'a2',
      timestamp: Date.now(),
    });

    expect(received.length).toBe(1);
    const parsed = JSON.parse(received[0]);
    expect(parsed.type).toBe('alert');
    expect(parsed.serverId).toBe('s-in-snapshot');
  });

  it('user-scoped payload reaches only that user (+ unfiltered admins)', async () => {
    const gw = makeGateway();
    const mine: string[] = [];
    const others: string[] = [];
    const admin: string[] = [];
    gw.addGlobalSseSubscriber(['alert'], (_e, d) => mine.push(d), ['any'], 'u1');
    gw.addGlobalSseSubscriber(['alert'], (_e, d) => others.push(d), ['any'], 'u2');
    gw.addGlobalSseSubscriber(['alert'], (_e, d) => admin.push(d), undefined, 'admin1');

    await gw.pushToGlobalSubscribers('alert', {
      type: 'alert',
      userId: 'u1',
      alertId: 'a3',
      title: 'Server down',
      message: 'Server X is offline',
      resolved: false,
      timestamp: Date.now(),
    });

    expect(mine.length).toBe(1);
    expect(others.length).toBe(0);
    expect(admin.length).toBe(1);
    expect(JSON.parse(mine[0]).userId).toBe('u1');
  });

  it('ignores subscribers not listening for the event type', async () => {
    const gw = makeGateway();
    const received: string[] = [];
    gw.addGlobalSseSubscriber(['server_created'], (_e, d) => received.push(d), undefined, 'admin1');

    await gw.pushToGlobalSubscribers('alert', { type: 'alert', alertId: 'a4' });
    expect(received.length).toBe(0);
  });
});

/**
 * Realtime fixes landed with the permission-vocabulary contract:
 * - Fix 2: read-tier admins (admin.read) receive the global read feed
 *   explicitly, including snapshot-miss events whose server row is gone.
 * - Fix 3: the 60s re-auth sweeper closes unfiltered streams whose owner
 *   lost the qualifying grant, and delivery skips already-marked streams.
 * - Fix 4: the console.read allowlist baseline only seeds rows carrying
 *   console.read; SSE-only subscribers resolve into allowlists (previously
 *   only WS clients were candidates, so SSE admins silently got nothing).
 */

/** Prisma stub with per-user global role permissions; also seeds the
 *  mocked resolveServerPermissions so candidates resolve without a DB. */
function makeRolePrisma(
  rolesByUser: Record<string, string[]>,
  serverRow?: Record<string, unknown> | null,
): any {
  for (const [uid, perms] of Object.entries(rolesByUser)) {
    permState.rolesByUser.set(uid, perms);
  }
  return {
    systemSetting: { findUnique: async () => null },
    node: { findUnique: async () => null, update: async () => ({}) },
    server: {
      findUnique: async () => serverRow ?? null,
      findMany: async () => [],
    },
    serverAccess: { findUnique: async () => null },
    nodeAssignment: { findFirst: async () => null, findMany: async () => [] },
    role: {
      findMany: async ({ where }: any) => {
        const uid = where?.users?.some?.id as string | undefined;
        const perms = uid ? rolesByUser[uid] : undefined;
        return perms ? [{ permissions: perms }] : [];
      },
    },
    roleServerGrant: { findMany: async () => [] },
    roleNodeGrant: { findMany: async () => [] },
  };
}

describe('pushToGlobalSubscribers admin_read branch (read-tier feed)', () => {
  it('delivers snapshot-miss events to an admin.read subscriber when the server row is gone', async () => {
    // server_deleted-style payload: the row no longer resolves, so the
    // per-server allowlist cannot answer — the explicit admin_read branch
    // must (contract item 1: admin.read reads every server).
    const gw = new WebSocketGateway(makeRolePrisma({ 'u-adm9': ['admin.read'] }, null), loggerStub);
    gateways.push(gw);
    const received: string[] = [];
    gw.addGlobalSseSubscriber(['server_deleted'], (_e, d) => received.push(d), ['s0'], 'u-adm9');

    await gw.pushToGlobalSubscribers('server_deleted', {
      type: 'server_deleted',
      serverId: 'srv-gone',
    });

    expect(received.length).toBe(1);
    expect(JSON.parse(received[0]).serverId).toBe('srv-gone');
  });

  it('still drops a plain stranger on snapshot miss (no admin grant, no access)', async () => {
    const gw = new WebSocketGateway(makeRolePrisma({}, null), loggerStub);
    gateways.push(gw);
    const received: string[] = [];
    gw.addGlobalSseSubscriber(['server_deleted'], (_e, d) => received.push(d), ['s0'], 'u-none9');

    await gw.pushToGlobalSubscribers('server_deleted', {
      type: 'server_deleted',
      serverId: 'srv-gone',
    });

    expect(received.length).toBe(0);
  });

  it('skips an unfiltered subscriber the sweeper marked revoked (adminOk=false)', async () => {
    const gw = makeGateway();
    const revoked: string[] = [];
    const active: string[] = [];
    gw.addGlobalSseSubscriber(['alert'], (_e, d) => revoked.push(d), undefined, 'u-rev10');
    gw.addGlobalSseSubscriber(['alert'], (_e, d) => active.push(d), undefined, 'u-live10');
    // Simulate the last re-auth run outcome for the revoked subscriber.
    for (const [, sub] of (gw as any).globalSseSubscribers) {
      if (sub.userId === 'u-rev10') sub.adminOk = false;
    }

    await gw.pushToGlobalSubscribers('alert', { type: 'alert', serverId: 's9' });

    expect(revoked.length).toBe(0);
    expect(active.length).toBe(1);
  });
});

describe('reauthGlobalSubscribers (unfiltered-feed re-auth)', () => {
  it('closes an unfiltered stream whose owner lost the read-tier grant', async () => {
    const prisma = makeRolePrisma({ 'u-live11': ['admin.read'] });
    const gw = new WebSocketGateway(prisma, loggerStub);
    gateways.push(gw);
    const received: string[] = [];
    let closed = false;
    gw.addGlobalSseSubscriber(['alert'], (_e, d) => received.push(d), undefined, 'u-gone11');
    gw.addGlobalSseSubscriber(['alert'], (_e, d) => received.push(d), undefined, 'u-live11', () => {
      closed = true;
    });
    // The "gone" subscriber's close hook is the one that must fire.
    let goneClosed = false;
    for (const [, sub] of (gw as any).globalSseSubscribers) {
      if (sub.userId === 'u-gone11') {
        sub.close = () => {
          goneClosed = true;
        };
      }
    }

    await (gw as any).reauthGlobalSubscribers();

    expect(goneClosed).toBe(true);
    const userIdsLeft = [...(gw as any).globalSseSubscribers.values()].map((s: any) => s.userId);
    expect(userIdsLeft).toEqual(['u-live11']);
    expect((gw as any).globalSseSubscribers.values().next().value.adminOk).toBe(true);
    // The revoked stream got a terminal error event before closing.
    const revokedEvents = received
      .map((d) => JSON.parse(d))
      .filter((m: any) => m.error === 'admin_permission_revoked');
    expect(revokedEvents.length).toBe(1);
  });

  it('keeps unfiltered admin.write / * streams open (hasGrant read tier)', async () => {
    const prisma = makeRolePrisma({ 'u-aw11': ['admin.write'], 'u-star11': ['*'] });
    const gw = new WebSocketGateway(prisma, loggerStub);
    gateways.push(gw);
    gw.addGlobalSseSubscriber(['alert'], () => {}, undefined, 'u-aw11');
    gw.addGlobalSseSubscriber(['alert'], () => {}, undefined, 'u-star11');

    await (gw as any).reauthGlobalSubscribers();

    expect((gw as any).globalSseSubscribers.size).toBe(2);
    for (const [, sub] of (gw as any).globalSseSubscribers) {
      expect(sub.adminOk).toBe(true);
    }
  });

  it('leaves scoped (snapshot) subscribers alone — they re-check per emit', async () => {
    const prisma = makeRolePrisma({});
    const gw = new WebSocketGateway(prisma, loggerStub);
    gateways.push(gw);
    gw.addGlobalSseSubscriber(['alert'], () => {}, ['s1'], 'u-scoped11');

    await (gw as any).reauthGlobalSubscribers();

    expect((gw as any).globalSseSubscribers.size).toBe(1);
  });
});

describe('getAllowedUsersForServer console.read baseline + SSE candidates', () => {
  it('seeds only access rows that carry console.read; owner always stays', async () => {
    const serverRow = {
      id: 'srv12',
      ownerId: 'u-owner12',
      nodeId: 'node-12',
      access: [
        { userId: 'u-cr12', permissions: ['console.read'] },
        { userId: 'u-sr12', permissions: ['server.read'] },
      ],
      node: { id: 'node-12', nodeAssignments: [] },
    };
    const gw = new WebSocketGateway(makeRolePrisma({}, serverRow), loggerStub);
    gateways.push(gw);

    const consoleAllow = await (gw as any).getAllowedUsersForServer('srv12', true, 'console.read');
    expect(consoleAllow.has('u-owner12')).toBe(true);
    expect(consoleAllow.has('u-cr12')).toBe(true);
    expect(consoleAllow.has('u-sr12')).toBe(false);

    const serverReadAllow = await (gw as any).getAllowedUsersForServer('srv12', true);
    expect(serverReadAllow.has('u-sr12')).toBe(true);
    expect(serverReadAllow.has('u-cr12')).toBe(true);
  });

  it('admits SSE-only read-tier subscribers (they were never WS candidates)', async () => {
    const serverRow = {
      id: 'srv13',
      ownerId: 'u-owner13',
      nodeId: 'node-13',
      access: [],
      node: { id: 'node-13', nodeAssignments: [] },
    };
    const prisma = makeRolePrisma({ 'u-adm13': ['admin.read'], 'u-cr13': ['console.read'] }, serverRow);
    const gw = new WebSocketGateway(prisma, loggerStub);
    gateways.push(gw);
    // Unfiltered global events subscriber + per-server console subscriber:
    // both are SSE-only sessions (no WS client, no row, no node assignment).
    gw.addGlobalSseSubscriber(['alert'], () => {}, undefined, 'u-adm13');
    gw.addSseSubscriber('srv13', () => {}, 'u-cr13');
    // Scoped-to-OTHER-server subscriber must not become a candidate here.
    gw.addGlobalSseSubscriber(['alert'], () => {}, ['other-server'], 'u-scoped13');

    const allow = await (gw as any).getAllowedUsersForServer('srv13', true);

    expect(allow.has('u-adm13')).toBe(true);
    expect(allow.has('u-scoped13')).toBe(false);
    // console.read does not grant the server.read (stats/lifecycle) feed —
    // the console subscriber lands in the console.read allowlist instead.
    expect(allow.has('u-cr13')).toBe(false);
    const consoleAllow = await (gw as any).getAllowedUsersForServer('srv13', true, 'console.read');
    expect(consoleAllow.has('u-cr13')).toBe(true);
  });
});

describe('pruneServerSubscriptions console registry (global flush)', () => {
  it('drops a console SSE subscriber whose row no longer carries console.read', async () => {
    const serverRow = {
      id: 'srv14',
      ownerId: 'u-owner14',
      nodeId: 'node-14',
      access: [{ userId: 'u-crev14', permissions: ['server.read'] }],
      node: { id: 'node-14', nodeAssignments: [] },
    };
    const prisma = makeRolePrisma({}, serverRow);
    const gw = new WebSocketGateway(prisma, loggerStub);
    gateways.push(gw);
    gw.addSseSubscriber('srv14', () => {}, 'u-crev14');

    (gw as any).pruneServerSubscriptions();
    // checkServer runs as a detached promise — give it a tick to land.
    await new Promise((r) => setTimeout(r, 50));

    const subs = (gw as any).sseSubscribers.get('srv14');
    expect(subs === undefined || subs.size === 0).toBe(true);
  });
});
