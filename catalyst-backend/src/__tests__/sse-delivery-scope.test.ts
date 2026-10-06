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
import { describe, it, expect, afterAll } from 'vitest';
import { WebSocketGateway, evaluateGlobalSseDelivery } from '../websocket/gateway.js';

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
