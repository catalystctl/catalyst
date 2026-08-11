/**
 * Catalyst - Secondary Allocations E2E Tests
 *
 * Covers multi-port allocation CRUD, hot-add/remove on running servers,
 * port conflict detection, and primary allocation protection.
 * Issue #134.
 */

import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { prisma } from '../db.js';
import { serverNetworkRoutes } from '../routes/servers/network.js';
import { nanoid } from 'nanoid';

// ============================================================================
// Test State
// ============================================================================

let testLocationId: string;
let testNodeId: string;
let testUserId: string;
let testTemplateId: string;
let adminRoleId: string;
let server1Id: string;
let server2Id: string;
let nextPort = 30000;

const createdServerIds: string[] = [];

function getNextPort() {
  return nextPort++;
}

// ============================================================================
// Test App Builder
// ============================================================================

function buildTestApp(userOverrides: Record<string, any> = {}) {
  const app = Fastify({ logger: false });

  app.decorate('authenticate', async (request: any, _reply: any) => {
    request.user = {
      userId: testUserId,
      email: 'test@example.com',
      username: 'testuser',
      permissions: ['*'],
      ...userOverrides,
    };
  });

  // Mock wsGateway with sendToAgent tracking
  const agentMessages: any[] = [];
  app.decorate('wsGateway', {
    pushToAdminSubscribers: () => {},
    pushToGlobalSubscribers: () => {},
    sendToAgent: async (_nodeId: string, message: any) => {
      agentMessages.push(message);
      return true;
    },
    requestFromAgent: async () => ({ success: true }),
    relayBackupStream: async () => {},
  } as any);

  // Expose captured messages for assertions
  app.decorate('agentMessages', agentMessages);

  return app;
}

// ============================================================================
// Setup / Teardown
// ============================================================================

beforeAll(async () => {
  const location = await prisma.location.create({
    data: { name: `alloc-test-location-${nanoid(8)}` },
  });
  testLocationId = location.id;

  const adminRole = await prisma.role.create({
    data: { name: `alloc-test-admin-${nanoid(8)}`, permissions: ['*'] },
  });
  adminRoleId = adminRole.id;

  const user = await prisma.user.create({
    data: {
      email: `alloc-test-${nanoid(8)}@example.com`,
      username: `allocuser${nanoid(4)}`,
      name: 'Alloc Test User',
      emailVerified: true,
      roles: { connect: { id: adminRoleId } },
    },
  });
  testUserId = user.id;

  const node = await prisma.node.create({
    data: {
      name: `alloc-test-node-${nanoid(8)}`,
      hostname: 'alloc-test-host',
      publicAddress: '10.0.0.1',
      secret: `alloc-secret-${nanoid(12)}`,
      maxMemoryMb: 32768,
      maxCpuCores: 16,
      locationId: testLocationId,
    },
  });
  testNodeId = node.id;

  const template = await prisma.serverTemplate.create({
    data: {
      name: `alloc-test-template-${nanoid(8)}`,
      author: 'Test',
      version: '1.0.0',
      image: 'alpine:3.19',
      startup: '/bin/sh',
      stopCommand: 'stop',
      sendSignalTo: 'SIGTERM',
      variables: [],
      installScript: '',
      supportedPorts: [],
      allocatedMemoryMb: 1024,
      allocatedCpuCores: 2,
    },
  });
  testTemplateId = template.id;

  // Create two servers on the same node for conflict testing
  const primaryPort1 = getNextPort();
  const server1 = await prisma.server.create({
    data: {
      name: `alloc-server1-${nanoid(6)}`,
      uuid: `alloc-uuid1-${nanoid(8)}`,
      templateId: testTemplateId,
      nodeId: testNodeId,
      locationId: testLocationId,
      ownerId: testUserId,
      status: 'stopped',
      primaryPort: primaryPort1,
      allocatedMemoryMb: 1024,
      allocatedCpuCores: 2,
      networkMode: 'bridge',
    },
  });
  server1Id = server1.id;
  createdServerIds.push(server1Id);

  const primaryPort2 = getNextPort();
  const server2 = await prisma.server.create({
    data: {
      name: `alloc-server2-${nanoid(6)}`,
      uuid: `alloc-uuid2-${nanoid(8)}`,
      templateId: testTemplateId,
      nodeId: testNodeId,
      locationId: testLocationId,
      ownerId: testUserId,
      status: 'stopped',
      primaryPort: primaryPort2,
      allocatedMemoryMb: 1024,
      allocatedCpuCores: 2,
      networkMode: 'bridge',
    },
  });
  server2Id = server2.id;
  createdServerIds.push(server2Id);
});

afterAll(async () => {
  // Clean up servers
  for (const id of createdServerIds) {
    await prisma.serverAccess.deleteMany({ where: { serverId: id } });
    await prisma.server.delete({ where: { id } }).catch(() => {});
  }
  // Clean up template, node, user, role, location
  if (testTemplateId) await prisma.serverTemplate.delete({ where: { id: testTemplateId } });
  if (testNodeId) await prisma.node.delete({ where: { id: testNodeId } });
  if (testUserId) await prisma.user.delete({ where: { id: testUserId } });
  if (adminRoleId) await prisma.role.delete({ where: { id: adminRoleId } });
  if (testLocationId) await prisma.location.delete({ where: { id: testLocationId } });
});

// ============================================================================
// Helper
// ============================================================================

async function request(app: ReturnType<typeof Fastify>, method: string, url: string, body?: any) {
  const response = await app.inject({
    method,
    url,
    payload: body,
  });
  return { status: response.statusCode, body: response.json() };
}

// ============================================================================
// Tests
// ============================================================================

describe('Secondary Allocations — stopped server', () => {
  it('GET /:serverId/allocations returns primary allocation', async () => {
    const app = buildTestApp();
    await app.register(serverNetworkRoutes);

    const { status, body } = await request(app, 'GET', `/${server1Id}/allocations`);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].isPrimary).toBe(true);
  });

  it('POST /:serverId/allocations adds secondary allocation on stopped server', async () => {
    const app = buildTestApp();
    await app.register(serverNetworkRoutes);

    const hostPort = getNextPort();
    const containerPort = hostPort + 1; // Different container port
    const { status, body } = await request(app, 'POST', `/${server1Id}/allocations`, {
      containerPort,
      hostPort,
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.containerPort).toBe(containerPort);
    expect(body.data.hostPort).toBe(hostPort);
    expect(body.data.isPrimary).toBe(false);
  });

  it('allocation appears in GET response after adding', async () => {
    const app = buildTestApp();
    await app.register(serverNetworkRoutes);

    // Add a secondary allocation first within this same test
    const hostPort = getNextPort();
    const containerPort = hostPort + 2;
    const addRes = await request(app, 'POST', `/${server1Id}/allocations`, { containerPort, hostPort });
    expect(addRes.status).toBe(200);

    // Now verify it appears
    const { status, body } = await request(app, 'GET', `/${server1Id}/allocations`);
    expect(status).toBe(200);
    expect(body.data.length).toBeGreaterThanOrEqual(2);
  });

  it('POST /:serverId/allocations/primary changes primary allocation', async () => {
    const app = buildTestApp();
    await app.register(serverNetworkRoutes);

    // Get current allocations to find a secondary one
    const { body: listBody } = await request(app, 'GET', `/${server1Id}/allocations`);
    const secondary = listBody.data.find((a: any) => !a.isPrimary);
    expect(secondary).toBeDefined();

    const { status, body } = await request(app, 'POST', `/${server1Id}/allocations/primary`, {
      containerPort: secondary.containerPort,
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.primaryPort).toBe(secondary.containerPort);
  });

  it('DELETE /:serverId/allocations/:containerPort removes secondary allocation', async () => {
    const app = buildTestApp();
    await app.register(serverNetworkRoutes);

    // Add a fresh secondary allocation to remove
    const hostPort = getNextPort();
    const containerPort = hostPort + 100;
    const addRes = await request(app, 'POST', `/${server1Id}/allocations`, { containerPort, hostPort });
    expect(addRes.status).toBe(200);

    const { status, body } = await request(app, 'DELETE', `/${server1Id}/allocations/${containerPort}`);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('cannot remove primary allocation', async () => {
    const app = buildTestApp();
    await app.register(serverNetworkRoutes);

    // Get current primary
    const { body: listBody } = await request(app, 'GET', `/${server1Id}/allocations`);
    const primary = listBody.data.find((a: any) => a.isPrimary);
    expect(primary).toBeTruthy();

    const { status, body } = await request(app, 'DELETE', `/${server1Id}/allocations/${primary.containerPort}`);
    expect(status).toBe(400);
    expect(body.error).toContain('Cannot remove primary allocation');
  });
});

describe('Secondary Allocations — hot-add on running server', () => {
  beforeAll(async () => {
    // Set server1 to running status
    await prisma.server.update({ where: { id: server1Id }, data: { status: 'running' } });
  });

  afterAll(async () => {
    // Reset to stopped
    await prisma.server.update({ where: { id: server1Id }, data: { status: 'stopped' } });
  });

  it('POST /:serverId/allocations adds allocation while server is running', async () => {
    const app = buildTestApp();
    await app.register(serverNetworkRoutes);

    const hostPort = getNextPort();
    const containerPort = hostPort + 50;
    const { status, body } = await request(app, 'POST', `/${server1Id}/allocations`, {
      containerPort,
      hostPort,
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.containerPort).toBe(containerPort);
    expect(body.data.hostPort).toBe(hostPort);
  });

  it('agent receives allocation_added message on hot-add', async () => {
    const app = buildTestApp();
    await app.register(serverNetworkRoutes);

    const hostPort = getNextPort();
    const containerPort = hostPort + 51;
    const addRes = await request(app, 'POST', `/${server1Id}/allocations`, { containerPort, hostPort });
    expect(addRes.status).toBe(200);

    const messages = (app as any).agentMessages as any[];
    const addedMsg = messages.find(
      (m: any) => m.type === 'allocation_added' && m.hostPort === hostPort
    );
    expect(addedMsg).toBeTruthy();
    expect(addedMsg.serverId).toBe(server1Id);
    expect(addedMsg.protocol).toBe('tcp');
  });

  it('hot-add appears in GET allocations', async () => {
    const app = buildTestApp();
    await app.register(serverNetworkRoutes);

    const { status, body } = await request(app, 'GET', `/${server1Id}/allocations`);
    expect(status).toBe(200);
    // Should have at least primary + some secondaries
    expect(body.data.length).toBeGreaterThanOrEqual(2);
  });
});

describe('Secondary Allocations — hot-remove on running server', () => {
  beforeAll(async () => {
    await prisma.server.update({ where: { id: server1Id }, data: { status: 'running' } });
  });

  afterAll(async () => {
    await prisma.server.update({ where: { id: server1Id }, data: { status: 'stopped' } });
  });

  it('DELETE /:serverId/allocations/:containerPort removes secondary while running', async () => {
    const app = buildTestApp();
    await app.register(serverNetworkRoutes);

    // Add a secondary allocation first
    const hostPort = getNextPort();
    const containerPort = hostPort + 200;
    const addRes = await request(app, 'POST', `/${server1Id}/allocations`, { containerPort, hostPort });
    expect(addRes.status).toBe(200);

    // Now remove it
    const { status, body } = await request(app, 'DELETE', `/${server1Id}/allocations/${containerPort}`);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('agent receives allocation_removed message on hot-remove', async () => {
    const app = buildTestApp();
    await app.register(serverNetworkRoutes);

    // Add and then remove
    const hostPort = getNextPort();
    const containerPort = hostPort + 201;
    const addRes = await request(app, 'POST', `/${server1Id}/allocations`, { containerPort, hostPort });
    expect(addRes.status).toBe(200);

    // Clear previous messages
    const messages = (app as any).agentMessages as any[];
    messages.length = 0;

    await request(app, 'DELETE', `/${server1Id}/allocations/${containerPort}`);

    const removedMsg = messages.find(
      (m: any) => m.type === 'allocation_removed'
    );
    expect(removedMsg).toBeTruthy();
    expect(removedMsg.serverId).toBe(server1Id);
    expect(removedMsg.hostPort).toBe(hostPort);
    // Should include remainingPortBindings for re-adding surviving rules
    expect(removedMsg.remainingPortBindings).toBeDefined();
  });

  it('cannot remove primary allocation even when running (AC-4)', async () => {
    const app = buildTestApp();
    await app.register(serverNetworkRoutes);

    const { body: listBody } = await request(app, 'GET', `/${server1Id}/allocations`);
    const primary = listBody.data.find((a: any) => a.isPrimary);
    expect(primary).toBeTruthy();

    const { status, body } = await request(app, 'DELETE', `/${server1Id}/allocations/${primary.containerPort}`);
    expect(status).toBe(400);
    expect(body.error).toContain('Cannot remove primary allocation');
  });
});

describe('Secondary Allocations — multiple secondary allocations', () => {
  it('can add >10 secondary allocations', async () => {
    const app = buildTestApp();
    await app.register(serverNetworkRoutes);

    const added: number[] = [];
    for (let i = 0; i < 11; i++) {
      const hostPort = getNextPort();
      const containerPort = hostPort + 500 + i;
      const { status } = await request(app, 'POST', `/${server1Id}/allocations`, {
        containerPort,
        hostPort,
      });
      expect(status).toBe(200);
      added.push(containerPort);
    }

    // Verify all appear
    const { body } = await request(app, 'GET', `/${server1Id}/allocations`);
    for (const cp of added) {
      expect(body.data.some((a: any) => a.containerPort === cp)).toBe(true);
    }
  });
});

describe('Port Conflict Detection', () => {
  it('rejects allocation with host port already used by another server on same node', async () => {
    const app = buildTestApp();
    await app.register(serverNetworkRoutes);

    // Get server2's primary port
    const server2 = await prisma.server.findUnique({ where: { id: server2Id } });
    const conflictPort = server2!.primaryPort;

    // Try to add that port to server1
    const containerPort = conflictPort + 999;
    const { status, body } = await request(app, 'POST', `/${server1Id}/allocations`, {
      containerPort,
      hostPort: conflictPort,
    });
    expect(status).toBe(400);
    expect(body.error).toContain('already in use');
  });

  it('allows same host port on different IPs', async () => {
    // Assign different primaryIp to server2 so same port is OK
    const app = buildTestApp();
    await app.register(serverNetworkRoutes);

    const server2 = await prisma.server.findUnique({ where: { id: server2Id } });
    const sharedPort = getNextPort();

    // Set server1 primaryIp to 10.0.0.1 and server2 to 10.0.0.2
    await prisma.server.update({
      where: { id: server1Id },
      data: { primaryIp: '10.0.0.1' },
    });
    await prisma.server.update({
      where: { id: server2Id },
      data: { primaryIp: '10.0.0.2' },
    });

    try {
      // Add the port to server2 first
      const addRes = await request(app, 'POST', `/${server2Id}/allocations`, {
        containerPort: sharedPort,
        hostPort: sharedPort,
      });
      expect(addRes.status).toBe(200);

      // Now try same port on server1 (different IP) — should succeed
      const { status, body } = await request(app, 'POST', `/${server1Id}/allocations`, {
        containerPort: sharedPort + 1,
        hostPort: sharedPort,
      });
      expect(status).toBe(200);
    } finally {
      // Clean up IPs — always run even if assertions fail
      await prisma.server.update({
        where: { id: server1Id },
        data: { primaryIp: null },
      });
      await prisma.server.update({
        where: { id: server2Id },
        data: { primaryIp: null },
      });
    }
  });
});

describe('Allocation persistence across server lifecycle', () => {
  it('allocations persist after server stop', async () => {
    const app = buildTestApp();
    await app.register(serverNetworkRoutes);

    // Add allocations while running
    await prisma.server.update({ where: { id: server1Id }, data: { status: 'running' } });

    const hostPort = getNextPort();
    const containerPort = hostPort + 600;
    const addRes = await request(app, 'POST', `/${server1Id}/allocations`, { containerPort, hostPort });
    expect(addRes.status).toBe(200);

    // Stop the server
    await prisma.server.update({ where: { id: server1Id }, data: { status: 'stopped' } });

    // Verify allocation persists
    const { body } = await request(app, 'GET', `/${server1Id}/allocations`);
    const found = body.data.some((a: any) => a.containerPort === containerPort && a.hostPort === hostPort);
    expect(found).toBe(true);
  });
});

describe('Set primary allocation on running server', () => {
  beforeAll(async () => {
    await prisma.server.update({ where: { id: server1Id }, data: { status: 'running' } });
  });

  afterAll(async () => {
    await prisma.server.update({ where: { id: server1Id }, data: { status: 'stopped' } });
  });

  it('POST /:serverId/allocations/primary works on running server', async () => {
    const app = buildTestApp();
    await app.register(serverNetworkRoutes);

    // Get allocations
    const { body: listBody } = await request(app, 'GET', `/${server1Id}/allocations`);
    const secondary = listBody.data.find((a: any) => !a.isPrimary);
    expect(secondary).toBeDefined();

    const { status, body } = await request(app, 'POST', `/${server1Id}/allocations/primary`, {
      containerPort: secondary.containerPort,
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.primaryPort).toBe(secondary.containerPort);
  });

  it('no agent message sent for primary change (no firewall change needed)', async () => {
    const app = buildTestApp();
    await app.register(serverNetworkRoutes);

    // Get allocations
    const { body: listBody } = await request(app, 'GET', `/${server1Id}/allocations`);
    const secondary = listBody.data.find((a: any) => !a.isPrimary);
    expect(secondary).toBeDefined();

    const messages = (app as any).agentMessages as any[];
    messages.length = 0;

    await request(app, 'POST', `/${server1Id}/allocations/primary`, {
      containerPort: secondary.containerPort,
    });

    // No allocation_added or allocation_removed should be sent
    const agentMsg = messages.find(
      (m: any) => m.type === 'allocation_added' || m.type === 'allocation_removed'
    );
    expect(agentMsg).toBeFalsy();
  });
});
