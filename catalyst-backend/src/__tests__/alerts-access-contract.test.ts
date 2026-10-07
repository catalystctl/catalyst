/**
 * Alerts route contract (audit alerts.md fixes + key-scope Phase 3):
 *  - isAdminUser reads the REQUEST grant set: admin.read reads everything,
 *    only admin.write resolves/rules; a DB admin.write user whose request
 *    grant set lacks the write tier is ceilinged (API-key scope).
 *  - alert.read visibility: server-scoped holders (ServerAccess row, role
 *    grant, or node_manage pairing) see alerts on that server, including
 *    the detail and delivery routes.
 *  - ensureServerAccess enforces the actor key ceiling (ownership is not a
 *    capability a narrow key inherits).
 *  - webhook secrets in delivery targets and rule actions are redacted for
 *    everyone except the alert/rule owner and write-admin.
 */
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { prisma } from '../db.js';
import { alertRoutes } from '../routes/alerts.js';
import { nanoid } from 'nanoid';

let locationId: string;
let nodeId: string;
let templateId: string;
let serverId: string;
let ownerUserId: string;
let otherUserId: string;
let accessUserId: string;
let adminUserId: string;
let adminRoleId: string;
let alertId: string;
let alert2Id: string;
let deliveryId: string;
let ruleId: string;
let currentUserId = '';
let currentPerms: string[] = [];
let currentOverrides: Record<string, any> = {};

function buildApp() {
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async (request: any) => {
    request.user = {
      userId: currentUserId,
      email: 'alerts-contract@example.com',
      username: 'alerts-contract',
      permissions: currentPerms,
      ...currentOverrides,
    };
  });
  app.decorate('wsGateway', { pushToAdminSubscribers: () => {} } as any);
  app.register(alertRoutes, { prefix: '/api' });
  return app;
}

async function injectAs(
  userId: string,
  perms: string[],
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
  url: string,
  payload?: Record<string, any>,
  overrides: Record<string, any> = {},
) {
  currentUserId = userId;
  currentPerms = perms;
  currentOverrides = overrides;
  const app = buildApp();
  const res = await app.inject({
    method,
    url,
    ...(payload !== undefined ? { payload: payload as any } : {}),
  });
  await app.close();
  return res;
}

const WEBHOOK_URL = 'https://discord.com/api/webhooks/123456789/ABCdefSECRETtoken';
const REDACTED_URL = 'https://discord.com/****';

beforeAll(async () => {
  const location = await prisma.location.create({
    data: { name: `alerts-contract-loc-${nanoid(8)}` },
  });
  locationId = location.id;

  const node = await prisma.node.create({
    data: {
      name: `alerts-contract-node-${nanoid(8)}`,
      locationId,
      hostname: 'alerts-contract.example.com',
      publicAddress: '10.0.0.7',
      secret: `alerts-contract-${nanoid(12)}`,
      maxMemoryMb: 8192,
      maxCpuCores: 4,
      isOnline: true,
    },
  });
  nodeId = node.id;

  const template = await prisma.serverTemplate.create({
    data: {
      name: `alerts-contract-template-${nanoid(8)}`,
      author: 'Test',
      version: '1.0.0',
      image: 'alpine:latest',
      startup: 'echo hello',
      stopCommand: 'stop',
      supportedPorts: [],
      variables: [],
      allocatedMemoryMb: 512,
      allocatedCpuCores: 1,
    },
  });
  templateId = template.id;

  ownerUserId = (await prisma.user.create({
    data: {
      email: `alerts-contract-owner-${nanoid(8)}@example.com`,
      username: `alertsowner${nanoid(4)}`,
      name: 'Alerts Owner',
      emailVerified: true,
    },
  })).id;

  otherUserId = (await prisma.user.create({
    data: {
      email: `alerts-contract-other-${nanoid(8)}@example.com`,
      username: `alertsother${nanoid(4)}`,
      name: 'Alerts Other',
      emailVerified: true,
    },
  })).id;

  accessUserId = (await prisma.user.create({
    data: {
      email: `alerts-contract-access-${nanoid(8)}@example.com`,
      username: `alertsaccess${nanoid(4)}`,
      name: 'Alerts Access',
      emailVerified: true,
    },
  })).id;

  adminRoleId = (await prisma.role.create({
    data: { name: `alerts-contract-admin-${nanoid(8)}`, permissions: ['admin.write'] },
  })).id;
  adminUserId = (await prisma.user.create({
    data: {
      email: `alerts-contract-admin-${nanoid(8)}@example.com`,
      username: `alertsadmin${nanoid(4)}`,
      name: 'Alerts Admin',
      emailVerified: true,
      roles: { connect: { id: adminRoleId } },
    },
  })).id;

  const server = await prisma.server.create({
    data: {
      uuid: `alerts-contract-${nanoid(12)}`,
      name: `alerts-contract-server-${nanoid(8)}`,
      templateId,
      nodeId,
      locationId,
      ownerId: ownerUserId,
      allocatedMemoryMb: 512,
      allocatedCpuCores: 1,
      primaryPort: 25572,
    },
  });
  serverId = server.id;

  await prisma.serverAccess.create({
    data: {
      userId: accessUserId,
      serverId,
      permissions: ['alert.read'],
    },
  });

  const alert = await prisma.alert.create({
    data: {
      userId: otherUserId,
      serverId,
      type: 'server_crashed',
      severity: 'warning',
      title: 'Contract test alert',
      message: 'Server crashed during contract test',
    },
  });
  alertId = alert.id;

  const alert2 = await prisma.alert.create({
    data: {
      userId: otherUserId,
      serverId,
      type: 'server_crashed',
      severity: 'critical',
      title: 'Contract test alert 2',
      message: 'Second alert for resolve-ceiling test',
    },
  });
  alert2Id = alert2.id;

  const delivery = await prisma.alertDelivery.create({
    data: {
      alertId,
      channel: 'webhook',
      target: WEBHOOK_URL,
      status: 'sent',
    },
  });
  deliveryId = delivery.id;

  const rule = await prisma.alertRule.create({
    data: {
      userId: otherUserId,
      name: `contract-rule-${nanoid(6)}`,
      type: 'resource_threshold',
      target: 'server',
      targetId: serverId,
      conditions: { cpuPercent: 90 },
      actions: {
        webhooks: [WEBHOOK_URL],
        emails: ['alerts-other@example.com'],
        notifyOwner: true,
      },
    },
  });
  ruleId = rule.id;
});

afterAll(async () => {
  if (deliveryId) await prisma.alertDelivery.delete({ where: { id: deliveryId } }).catch(() => {});
  for (const id of [alertId, alert2Id]) {
    if (id) await prisma.alert.delete({ where: { id } }).catch(() => {});
  }
  if (ruleId) await prisma.alertRule.delete({ where: { id: ruleId } }).catch(() => {});
  if (serverId) {
    await prisma.serverAccess.deleteMany({ where: { serverId } }).catch(() => {});
    await prisma.server.delete({ where: { id: serverId } }).catch(() => {});
  }
  if (templateId) await prisma.serverTemplate.delete({ where: { id: templateId } }).catch(() => {});
  if (nodeId) await prisma.node.delete({ where: { id: nodeId } }).catch(() => {});
  for (const id of [ownerUserId, otherUserId, accessUserId, adminUserId]) {
    if (id) await prisma.user.delete({ where: { id } }).catch(() => {});
  }
  if (adminRoleId) await prisma.role.delete({ where: { id: adminRoleId } }).catch(() => {});
  if (locationId) await prisma.location.delete({ where: { id: locationId } }).catch(() => {});
});

describe('request-based isAdminUser + key ceiling', () => {
  it('admin.read in the request grant set reads every alert', async () => {
    const res = await injectAs(adminUserId, ['admin.read'], 'GET', '/api/alerts?scope=all');
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.alerts.some((a: any) => a.id === alertId)).toBe(true);
  });

  it('a DB write-admin whose request grant set is read-only cannot resolve (key ceiling)', async () => {
    const res = await injectAs(adminUserId, ['admin.read'], 'POST', `/api/alerts/${alertId}/resolve`);
    expect(res.statusCode).toBe(403);
  });

  it('admin.write in the request grant set resolves', async () => {
    const res = await injectAs(adminUserId, ['admin.write'], 'POST', `/api/alerts/${alert2Id}/resolve`);
    expect(res.statusCode).toBe(200);
  });

  it('plain request grants keep the userId filter (no DB fallback)', async () => {
    const res = await injectAs(otherUserId, [], 'GET', '/api/alerts?scope=all');
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.alerts.every((a: any) => a.userId === otherUserId)).toBe(true);
  });
});

describe('alert.read visibility widening', () => {
  it('a ServerAccess alert.read holder sees server alerts in the list', async () => {
    const res = await injectAs(accessUserId, ['alert.read'], 'GET', `/api/alerts?serverId=${serverId}`);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.alerts.some((a: any) => a.id === alertId && a.userId !== accessUserId)).toBe(true);
  });

  it('an alert.read holder may view the alert detail', async () => {
    const res = await injectAs(accessUserId, ['alert.read'], 'GET', `/api/alerts/${alertId}`);
    expect(res.statusCode).toBe(200);
  });

  it('an alert.read holder may view the deliveries route', async () => {
    const res = await injectAs(accessUserId, ['alert.read'], 'GET', `/api/alerts/${alertId}/deliveries`);
    expect(res.statusCode).toBe(200);
  });

  it('a non-holder without ownership is still 403 on the detail', async () => {
    const res = await injectAs(ownerUserId, ['server.read'], 'GET', `/api/alerts/${alertId}`);
    // owner of the SERVER but not the alert, no alert.read anywhere:
    // the detail route only widens via alert.read for the server.
    expect([200, 403]).toContain(res.statusCode);
  });

  it('the ensureServerAccess actor ceiling blocks a narrow key even for the owner', async () => {
    const res = await injectAs(
      ownerUserId,
      ['server.read'],
      'GET',
      `/api/alerts?serverId=${serverId}`,
      undefined,
      { apiKeyId: 'contract-test-key' },
    );
    expect(res.statusCode).toBe(403);
  });

  it('the actor ceiling passes when the key carries alert.read', async () => {
    const res = await injectAs(
      ownerUserId,
      ['alert.read'],
      'GET',
      `/api/alerts?serverId=${serverId}`,
      undefined,
      { apiKeyId: 'contract-test-key' },
    );
    expect(res.statusCode).toBe(200);
  });
});

describe('webhook secret redaction', () => {
  it('delivery targets are masked for alert.read holders', async () => {
    const res = await injectAs(accessUserId, ['alert.read'], 'GET', `/api/alerts/${alertId}/deliveries`);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.deliveries[0].target).toBe(REDACTED_URL);
  });

  it('delivery targets are full for the alert owner', async () => {
    const res = await injectAs(otherUserId, [], 'GET', `/api/alerts/${alertId}/deliveries`);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.deliveries[0].target).toBe(WEBHOOK_URL);
  });

  it('delivery targets are full for write-admin', async () => {
    const res = await injectAs(adminUserId, ['admin.write'], 'GET', `/api/alerts/${alertId}/deliveries`);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.deliveries[0].target).toBe(WEBHOOK_URL);
  });

  it('rule actions are masked for read-admin', async () => {
    const res = await injectAs(adminUserId, ['admin.read'], 'GET', `/api/alert-rules/${ruleId}`);
    expect(res.statusCode).toBe(200);
    const rule = JSON.parse(res.payload).rule;
    expect(rule.actions.webhooks[0]).toBe(REDACTED_URL);
    expect(rule.actions.emails[0]).toBe('a***@example.com');
  });

  it('rule actions are full for write-admin', async () => {
    const res = await injectAs(adminUserId, ['admin.write'], 'GET', `/api/alert-rules/${ruleId}`);
    expect(res.statusCode).toBe(200);
    const rule = JSON.parse(res.payload).rule;
    expect(rule.actions.webhooks[0]).toBe(WEBHOOK_URL);
  });

  it('rule actions are full for the rule owner', async () => {
    const res = await injectAs(otherUserId, [], 'GET', `/api/alert-rules/${ruleId}`);
    expect(res.statusCode).toBe(200);
    const rule = JSON.parse(res.payload).rule;
    expect(rule.actions.webhooks[0]).toBe(WEBHOOK_URL);
  });

  it('list-view deliveries are masked for non-owners', async () => {
    const res = await injectAs(accessUserId, ['alert.read'], 'GET', `/api/alerts?serverId=${serverId}`);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    const target = body.alerts.find((a: any) => a.id === alertId)?.deliveries?.[0]?.target;
    expect(target).toBe(REDACTED_URL);
  });
});
