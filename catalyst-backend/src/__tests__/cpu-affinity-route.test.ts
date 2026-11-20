/**
 * CPU pinning (cpuset) — create and update route wiring.
 *
 * The rules themselves live in `lib/cpu-affinity.ts` and are unit-tested there;
 * this file proves the routes apply them: a mask must fit the node's reported
 * CPU set (when it has one) and must name at least as many CPUs as the server is
 * allocated, a malformed mask comes back as a coded error naming the value, and
 * a node that has not reported its set defers to the agent at start time.
 */
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { nanoid } from 'nanoid';
import { prisma } from '../db.js';
import { serverRoutes } from '../routes/servers.js';

let locationId: string;
let pagedNodeId: string;
let unknownNodeId: string;
let templateId: string;
let ownerId: string;
let ownerRoleId: string;
const createdServerIds: string[] = [];

let nextPort = 31000;
const getNextPort = () => nextPort++;

function buildApp() {
  const app = Fastify({ logger: false });

  app.decorate('authenticate', async (request: any) => {
    request.user = {
      userId: ownerId,
      email: 'affinity@example.com',
      username: 'affinity',
      permissions: ['*'],
    };
  });

  app.decorate('wsGateway', {
    pushToAdminSubscribers: () => {},
    pushToGlobalSubscribers: () => {},
    sendToAgent: async () => true,
    requestFromAgent: async () => ({ success: true }),
    relayBackupStream: async () => {},
    routeToClients: async () => {},
  } as any);

  app.decorate('webhookService', {
    serverCreated: async () => {},
    serverDeleted: async () => {},
  });

  app.decorate('fileTunnel', {
    createTunnel: async () => ({ tunnelId: 'test-tunnel' }),
  });

  app.register(serverRoutes, { prefix: '/api/servers' });
  return app;
}

async function createServer(payload: Record<string, unknown>) {
  const app = buildApp();
  const response = await app.inject({
    method: 'POST',
    url: '/api/servers',
    payload: {
      name: `affinity-srv-${nanoid(6)}`,
      templateId,
      nodeId: pagedNodeId,
      locationId,
      allocatedMemoryMb: 1024,
      allocatedCpuCores: 2,
      allocatedDiskMb: 10240,
      primaryPort: getNextPort(),
      environment: {},
      networkMode: 'bridge',
      ...payload,
    },
  });
  const body = JSON.parse(response.body);
  if (body.data?.id) createdServerIds.push(body.data.id);
  await app.close();
  return { status: response.statusCode, body };
}

/** A stopped server row owned by the test user, on `pagedNodeId`. */
async function seedServer(overrides: Record<string, unknown> = {}) {
  const server = await prisma.server.create({
    data: {
      uuid: `affinity-${nanoid(12)}`,
      name: `affinity-seed-${nanoid(8)}`,
      templateId,
      nodeId: pagedNodeId,
      locationId,
      ownerId,
      allocatedMemoryMb: 1024,
      allocatedCpuCores: 2,
      allocatedDiskMb: 10240,
      primaryPort: getNextPort(),
      status: 'stopped',
      environment: {},
      ...overrides,
    },
  });
  createdServerIds.push(server.id);
  return server;
}

async function updateServer(serverId: string, payload: Record<string, unknown>) {
  const app = buildApp();
  const response = await app.inject({
    method: 'PUT',
    url: `/api/servers/${serverId}`,
    payload,
  });
  await app.close();
  return { status: response.statusCode, body: JSON.parse(response.body) };
}

beforeAll(async () => {
  const location = await prisma.location.create({ data: { name: `affinity-loc-${nanoid(8)}` } });
  locationId = location.id;

  const role = await prisma.role.create({ data: { name: `affinity-role-${nanoid(8)}`, permissions: ['*'] } });
  ownerRoleId = role.id;

  const owner = await prisma.user.create({
    data: {
      email: `affinity-${nanoid(8)}@example.com`,
      username: `affinity${nanoid(4)}`,
      name: 'affinity',
      emailVerified: true,
      roles: { connect: { id: ownerRoleId } },
    },
  });
  ownerId = owner.id;

  const template = await prisma.serverTemplate.create({
    data: {
      name: `affinity-template-${nanoid(8)}`,
      author: 'Test',
      version: '1.0.0',
      image: 'alpine:latest',
      startup: 'echo hello',
      stopCommand: 'stop',
      supportedPorts: [],
      variables: [],
      allocatedMemoryMb: 1024,
      allocatedCpuCores: 2,
    },
  });
  templateId = template.id;

  const paged = await prisma.node.create({
    data: {
      name: `affinity-node-${nanoid(8)}`,
      locationId,
      hostname: 'affinity.example.com',
      publicAddress: '10.0.0.21',
      secret: `secret-${nanoid(16)}`,
      maxMemoryMb: 32768,
      maxCpuCores: 16,
      // What the agent reports: containers on this node may use CPUs 0-3.
      hostCpuSet: '0-3',
      isOnline: true,
    },
  });
  pagedNodeId = paged.id;

  const unknown = await prisma.node.create({
    data: {
      name: `affinity-node-unknown-${nanoid(8)}`,
      locationId,
      hostname: 'affinity2.example.com',
      publicAddress: '10.0.0.22',
      secret: `secret-${nanoid(16)}`,
      maxMemoryMb: 32768,
      maxCpuCores: 16,
      hostCpuSet: null,
      isOnline: true,
    },
  });
  unknownNodeId = unknown.id;
});

afterAll(async () => {
  for (const id of createdServerIds) {
    await prisma.server.delete({ where: { id } }).catch(() => {});
  }
  for (const id of [pagedNodeId, unknownNodeId]) {
    if (id) {
      await prisma.nodeAllocation.deleteMany({ where: { nodeId: id } }).catch(() => {});
      await prisma.node.delete({ where: { id } }).catch(() => {});
    }
  }
  if (templateId) await prisma.serverTemplate.delete({ where: { id: templateId } }).catch(() => {});
  if (ownerId) await prisma.user.delete({ where: { id: ownerId } }).catch(() => {});
  if (ownerRoleId) await prisma.role.delete({ where: { id: ownerRoleId } }).catch(() => {});
  if (locationId) await prisma.location.delete({ where: { id: locationId } }).catch(() => {});
});

describe('POST /api/servers — CPU pinning', () => {
  it('stores a canonical mask that fits the node', async () => {
    const { status, body } = await createServer({ cpuAffinity: '1,0', allocatedCpuCores: 2 });
    expect(status, JSON.stringify(body)).toBe(201);
    const stored = await prisma.server.findUnique({ where: { id: body.data.id } });
    expect(stored?.cpuAffinity).toBe('0-1');
  });

  it('accepts a pin wider than the allocation', async () => {
    const { status, body } = await createServer({ cpuAffinity: '0-3', allocatedCpuCores: 1 });
    expect(status, JSON.stringify(body)).toBe(201);
    const stored = await prisma.server.findUnique({ where: { id: body.data.id } });
    expect(stored?.cpuAffinity).toBe('0-3');
  });

  it('refuses CPUs the node does not have', async () => {
    const { status, body } = await createServer({ cpuAffinity: '0-3,9', allocatedCpuCores: 2 });
    expect(status).toBe(400);
    expect(body.code).toBe('CPU_AFFINITY_UNAVAILABLE');
    expect(body.params).toEqual({ requested: '0-3,9', available: '0-3' });
  });

  it('refuses a pin narrower than the allocation', async () => {
    const { status, body } = await createServer({ cpuAffinity: '0', allocatedCpuCores: 2 });
    expect(status).toBe(400);
    expect(body.code).toBe('CPU_AFFINITY_BELOW_ALLOCATION');
    expect(body.params).toEqual({ cpus: 1, cores: 2 });
  });

  it('reports a malformed mask as a coded error naming the value', async () => {
    const { status, body } = await createServer({ cpuAffinity: '3-1' });
    expect(status).toBe(400);
    expect(body.code).toBe('CPU_AFFINITY_INVALID');
    expect(body.params.value).toBe('3-1');
  });

  it('accepts any mask on a node that has not reported its CPU set', async () => {
    const { status, body } = await createServer({
      nodeId: unknownNodeId,
      cpuAffinity: '0-63',
      allocatedCpuCores: 2,
    });
    expect(status, JSON.stringify(body)).toBe(201);
    const stored = await prisma.server.findUnique({ where: { id: body.data.id } });
    expect(stored?.cpuAffinity).toBe('0-63');
  });
});

describe('PUT /api/servers/:id — CPU pinning', () => {
  it('re-pins a stopped server and canonicalises the value', async () => {
    const server = await seedServer();
    const { status, body } = await updateServer(server.id, { cpuAffinity: '3,2' });
    expect(status, JSON.stringify(body)).toBe(200);
    expect((await prisma.server.findUnique({ where: { id: server.id } }))?.cpuAffinity).toBe('2-3');
  });

  it('refuses a mask the node does not have', async () => {
    const server = await seedServer();
    const { status, body } = await updateServer(server.id, { cpuAffinity: '0-9' });
    expect(status).toBe(400);
    expect(body.code).toBe('CPU_AFFINITY_UNAVAILABLE');
  });

  it('validates the resolved pair when only the core count changes', async () => {
    const server = await seedServer({ cpuAffinity: '0-1' });
    const { status, body } = await updateServer(server.id, { allocatedCpuCores: 4 });
    expect(status).toBe(400);
    expect(body.code).toBe('CPU_AFFINITY_BELOW_ALLOCATION');
    expect(body.params).toEqual({ cpus: 2, cores: 4 });
    // Nothing was written.
    const stored = await prisma.server.findUnique({ where: { id: server.id } });
    expect(stored?.allocatedCpuCores).toBe(2);
  });

  it('leaves an unrelated update alone even when the stored pin is narrower than the cores', async () => {
    // A row can end up in this state out of band (Pterodactyl import, direct
    // SQL). Renaming it must not fail because of a pre-existing inconsistency.
    const server = await seedServer({ cpuAffinity: '0', allocatedCpuCores: 4 });
    const { status, body } = await updateServer(server.id, { name: `renamed-${nanoid(6)}` });
    expect(status, JSON.stringify(body)).toBe(200);
    expect((await prisma.server.findUnique({ where: { id: server.id } }))?.cpuAffinity).toBe('0');
  });

  it('clears the pin with null and with an empty string', async () => {
    const server = await seedServer({ cpuAffinity: '0-1' });
    const viaNull = await updateServer(server.id, { cpuAffinity: null });
    expect(viaNull.status).toBe(200);
    expect((await prisma.server.findUnique({ where: { id: server.id } }))?.cpuAffinity).toBeNull();

    const repinned = await updateServer(server.id, { cpuAffinity: '0-1' });
    expect(repinned.status).toBe(200);
    const viaEmpty = await updateServer(server.id, { cpuAffinity: '' });
    expect(viaEmpty.status).toBe(200);
    expect((await prisma.server.findUnique({ where: { id: server.id } }))?.cpuAffinity).toBeNull();
  });

  it('accepts a pin on a running server, because it only applies on the next start', async () => {
    const server = await seedServer({ status: 'running', allocatedCpuCores: 2 });
    const { status, body } = await updateServer(server.id, { cpuAffinity: '0-1' });
    expect(status, JSON.stringify(body)).toBe(200);
    expect((await prisma.server.findUnique({ where: { id: server.id } }))?.cpuAffinity).toBe('0-1');
  });
});
