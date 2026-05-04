/**
 * Catalyst - Node Resource Over-Allocation Tests
 *
 * Comprehensive tests for the node memoryOverallocatePercent and
 * cpuOverallocatePercent feature. Covers node CRUD, stats calculation,
 * server creation effective limits, and server transfer effective limits.
 */

import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { prisma } from '../db.js';
import { nodeRoutes } from '../routes/nodes.js';
import { serverRoutes } from '../routes/servers.js';
import { nanoid } from 'nanoid';

// ============================================================================
// Test State
// ============================================================================

let testLocationId: string;
let testUserId: string;
let testTemplateId: string;
let adminRoleId: string;
const createdNodeIds: string[] = [];
const createdServerIds: string[] = [];
let nextPort = 20000;

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

  app.decorate('wsGateway', {
    pushToAdminSubscribers: () => {},
    pushToGlobalSubscribers: () => {},
    sendToAgent: async () => true,
    requestFromAgent: async () => ({ success: true }),
    relayBackupStream: async () => {},
  } as any);

  app.decorate('webhookService', {
    serverCreated: async () => {},
    serverDeleted: async () => {},
  });

  app.decorate('fileTunnel', {
    createTunnel: async () => ({ tunnelId: 'test-tunnel' }),
  });

  return app;
}

// ============================================================================
// Setup / Teardown
// ============================================================================

beforeAll(async () => {
  const location = await prisma.location.create({
    data: { name: `test-location-${nanoid(8)}` },
  });
  testLocationId = location.id;

  const adminRole = await prisma.role.create({
    data: { name: `test-admin-${nanoid(8)}`, permissions: ['*'] },
  });
  adminRoleId = adminRole.id;

  const user = await prisma.user.create({
    data: {
      email: `test-${nanoid(8)}@example.com`,
      username: `testuser${nanoid(4)}`,
      name: 'Test User',
      emailVerified: true,
      roles: { connect: { id: adminRoleId } },
    },
  });
  testUserId = user.id;

  const template = await prisma.serverTemplate.create({
    data: {
      name: `test-template-${nanoid(8)}`,
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
  testTemplateId = template.id;
});

afterAll(async () => {
  for (const serverId of createdServerIds) {
    await prisma.server.delete({ where: { id: serverId } }).catch(() => {});
  }
  for (const nodeId of createdNodeIds) {
    await prisma.nodeAllocation.deleteMany({ where: { nodeId } }).catch(() => {});
    await prisma.node.delete({ where: { id: nodeId } }).catch(() => {});
  }
  if (testTemplateId) {
    await prisma.serverTemplate.delete({ where: { id: testTemplateId } }).catch(() => {});
  }
  if (testUserId) {
    await prisma.user.delete({ where: { id: testUserId } }).catch(() => {});
  }
  if (adminRoleId) {
    await prisma.role.delete({ where: { id: adminRoleId } }).catch(() => {});
  }
  if (testLocationId) {
    await prisma.location.delete({ where: { id: testLocationId } }).catch(() => {});
  }
});

// ============================================================================
// Helpers
// ============================================================================

async function createNode(payload: Record<string, any>) {
  const app = buildTestApp();
  await app.register(nodeRoutes, { prefix: '/api/nodes' });

  const response = await app.inject({
    method: 'POST',
    url: '/api/nodes',
    payload: {
      locationId: testLocationId,
      hostname: 'node.example.com',
      publicAddress: '10.0.0.1',
      maxMemoryMb: 8192,
      maxCpuCores: 4,
      ...payload,
    },
  });

  const body = JSON.parse(response.body);
  if (body.data?.id) {
    createdNodeIds.push(body.data.id);
  }
  return { status: response.statusCode, body };
}

async function updateNode(nodeId: string, payload: Record<string, any>) {
  const app = buildTestApp();
  await app.register(nodeRoutes, { prefix: '/api/nodes' });

  const response = await app.inject({
    method: 'PUT',
    url: `/api/nodes/${nodeId}`,
    payload,
  });

  return { status: response.statusCode, body: JSON.parse(response.body) };
}

async function getNodeStats(nodeId: string) {
  const app = buildTestApp();
  await app.register(nodeRoutes, { prefix: '/api/nodes' });

  const response = await app.inject({
    method: 'GET',
    url: `/api/nodes/${nodeId}/stats`,
  });

  return { status: response.statusCode, body: JSON.parse(response.body) };
}

async function createServer(payload: Record<string, any>) {
  const app = buildTestApp();
  await app.register(serverRoutes, { prefix: '/api/servers' });

  const response = await app.inject({
    method: 'POST',
    url: '/api/servers',
    payload: {
      name: `test-server-${nanoid(6)}`,
      templateId: testTemplateId,
      nodeId: createdNodeIds[0],
      locationId: testLocationId,
      allocatedMemoryMb: 1024,
      allocatedCpuCores: 1,
      allocatedDiskMb: 10240,
      primaryPort: getNextPort(),
      environment: {},
      networkMode: 'bridge',
      ...payload,
    },
  });

  const body = JSON.parse(response.body);
  if (body.data?.id) {
    createdServerIds.push(body.data.id);
  }
  return { status: response.statusCode, body };
}

async function transferServer(serverId: string, targetNodeId: string) {
  const app = buildTestApp();
  await app.register(serverRoutes, { prefix: '/api/servers' });

  const response = await app.inject({
    method: 'POST',
    url: `/api/servers/${serverId}/transfer`,
    payload: { targetNodeId },
  });

  return { status: response.statusCode, body: JSON.parse(response.body) };
}

// ============================================================================
// 1. Node Creation with Over-Allocation
// ============================================================================

describe('Node Creation with Over-Allocation', () => {
  it('creates a node with memoryOverallocatePercent=50 and cpuOverallocatePercent=50', async () => {
    const { status, body } = await createNode({
      name: `node-50-${nanoid(6)}`,
      memoryOverallocatePercent: 50,
      cpuOverallocatePercent: 50,
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.memoryOverallocatePercent).toBe(50);
    expect(body.data.cpuOverallocatePercent).toBe(50);
  });

  it('creates a node with memoryOverallocatePercent=-1 and cpuOverallocatePercent=-1 (unlimited)', async () => {
    const { status, body } = await createNode({
      name: `node-unlimited-${nanoid(6)}`,
      memoryOverallocatePercent: -1,
      cpuOverallocatePercent: -1,
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.memoryOverallocatePercent).toBe(-1);
    expect(body.data.cpuOverallocatePercent).toBe(-1);
  });

  it('defaults over-allocation to 0 when not specified', async () => {
    const { status, body } = await createNode({
      name: `node-default-${nanoid(6)}`,
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.memoryOverallocatePercent).toBe(0);
    expect(body.data.cpuOverallocatePercent).toBe(0);
  });

  it('rejects memoryOverallocatePercent=-2', async () => {
    const { status, body } = await createNode({
      name: `node-invalid-${nanoid(6)}`,
      memoryOverallocatePercent: -2,
    });

    expect(status).toBe(400);
    expect(body.error).toContain('memoryOverallocatePercent must be an integer >= -1');
  });

  it('rejects cpuOverallocatePercent=-2', async () => {
    const { status, body } = await createNode({
      name: `node-invalid-cpu-${nanoid(6)}`,
      cpuOverallocatePercent: -2,
    });

    expect(status).toBe(400);
    expect(body.error).toContain('cpuOverallocatePercent must be an integer >= -1');
  });

  it('rejects non-integer over-allocation values', async () => {
    const app = buildTestApp();
    await app.register(nodeRoutes, { prefix: '/api/nodes' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        name: `node-bad-type-${nanoid(6)}`,
        locationId: testLocationId,
        hostname: 'node.example.com',
        publicAddress: '10.0.0.1',
        maxMemoryMb: 8192,
        maxCpuCores: 4,
        memoryOverallocatePercent: 50.5,
      },
    });

    const body = JSON.parse(response.body);
    expect(response.statusCode).toBe(400);
    expect(body.error).toContain('memoryOverallocatePercent must be an integer >= -1');
  });
});

// ============================================================================
// 2. Node Update with Over-Allocation
// ============================================================================

describe('Node Update with Over-Allocation', () => {
  let nodeId: string;

  beforeAll(async () => {
    const { body } = await createNode({
      name: `node-update-${nanoid(6)}`,
      memoryOverallocatePercent: 0,
      cpuOverallocatePercent: 0,
    });
    nodeId = body.data.id;
  });

  it('updates a node over-allocation values', async () => {
    const { status, body } = await updateNode(nodeId, {
      memoryOverallocatePercent: 25,
      cpuOverallocatePercent: 25,
    });

    expect(status).toBe(200);
    expect(body.data.memoryOverallocatePercent).toBe(25);
    expect(body.data.cpuOverallocatePercent).toBe(25);
  });

  it('sets over-allocation to unlimited (-1)', async () => {
    const { status, body } = await updateNode(nodeId, {
      memoryOverallocatePercent: -1,
      cpuOverallocatePercent: -1,
    });

    expect(status).toBe(200);
    expect(body.data.memoryOverallocatePercent).toBe(-1);
    expect(body.data.cpuOverallocatePercent).toBe(-1);
  });

  it('sets over-allocation back to 0', async () => {
    const { status, body } = await updateNode(nodeId, {
      memoryOverallocatePercent: 0,
      cpuOverallocatePercent: 0,
    });

    expect(status).toBe(200);
    expect(body.data.memoryOverallocatePercent).toBe(0);
    expect(body.data.cpuOverallocatePercent).toBe(0);
  });
});

// ============================================================================
// 3. Node Stats with Over-Allocation
// ============================================================================

describe('Node Stats with Over-Allocation', () => {
  it('shows correct effective limits when over-allocation is set', async () => {
    const { body: createBody } = await createNode({
      name: `node-stats-50-${nanoid(6)}`,
      maxMemoryMb: 10000,
      maxCpuCores: 10,
      memoryOverallocatePercent: 50,
      cpuOverallocatePercent: 50,
    });
    const id = createBody.data.id;

    const { status, body } = await getNodeStats(id);
    expect(status).toBe(200);
    expect(body.data.resources.effectiveMaxMemoryMb).toBe(15000); // 10000 * 1.5
    expect(body.data.resources.effectiveMaxCpuCores).toBe(15); // 10 * 1.5
    expect(body.data.resources.memoryUsagePercent).toBe(0);
    expect(body.data.resources.cpuUsagePercent).toBe(0);
  });

  it('shows unlimited (Infinity/Null) correctly', async () => {
    const { body: createBody } = await createNode({
      name: `node-stats-unlimited-${nanoid(6)}`,
      maxMemoryMb: 10000,
      maxCpuCores: 10,
      memoryOverallocatePercent: -1,
      cpuOverallocatePercent: -1,
    });
    const id = createBody.data.id;

    const { status, body } = await getNodeStats(id);
    expect(status).toBe(200);
    expect(body.data.resources.effectiveMaxMemoryMb).toBeNull();
    expect(body.data.resources.effectiveMaxCpuCores).toBeNull();
    expect(body.data.resources.availableMemoryMb).toBeNull();
    expect(body.data.resources.availableCpuCores).toBeNull();
    expect(body.data.resources.memoryUsagePercent).toBe(0);
    expect(body.data.resources.cpuUsagePercent).toBe(0);
  });

  it('calculates usage percentages against effective limits', async () => {
    const { body: createBody } = await createNode({
      name: `node-stats-usage-${nanoid(6)}`,
      maxMemoryMb: 10000,
      maxCpuCores: 10,
      memoryOverallocatePercent: 100,
      cpuOverallocatePercent: 100,
    });
    const nodeId = createBody.data.id;

    // Create a server consuming 25% of the effective limit
    const { body: serverBody } = await createServer({
      nodeId,
      allocatedMemoryMb: 5000, // 25% of effective 20000
      allocatedCpuCores: 5, // 25% of effective 20
    });
    expect(serverBody.success).toBe(true);

    const { status, body } = await getNodeStats(nodeId);
    expect(status).toBe(200);
    expect(body.data.resources.allocatedMemoryMb).toBe(5000);
    expect(body.data.resources.allocatedCpuCores).toBe(5);
    expect(body.data.resources.effectiveMaxMemoryMb).toBe(20000);
    expect(body.data.resources.effectiveMaxCpuCores).toBe(20);
    expect(body.data.resources.memoryUsagePercent).toBe(25);
    expect(body.data.resources.cpuUsagePercent).toBe(25);
    expect(body.data.resources.availableMemoryMb).toBe(15000);
    expect(body.data.resources.availableCpuCores).toBe(15);
  });
});

// ============================================================================
// 4. Server Creation Respects Effective Limits
// ============================================================================

describe('Server Creation Respects Effective Limits', () => {
  it('succeeds when allocated resources are within effective limit', async () => {
    const { body: nodeBody } = await createNode({
      name: `node-create-ok-${nanoid(6)}`,
      maxMemoryMb: 10000,
      maxCpuCores: 10,
      memoryOverallocatePercent: 50,
      cpuOverallocatePercent: 50,
    });
    const nodeId = nodeBody.data.id;

    // 8000 MB memory and 8 cores are within effective limits of 15000 MB / 15 cores
    const { status, body } = await createServer({
      nodeId,
      allocatedMemoryMb: 8000,
      allocatedCpuCores: 8,
    });

    expect(status).toBe(201);
    expect(body.success).toBe(true);
  });

  it('is rejected when allocated memory exceeds effective limit', async () => {
    const { body: nodeBody } = await createNode({
      name: `node-create-mem-${nanoid(6)}`,
      maxMemoryMb: 10000,
      maxCpuCores: 10,
      memoryOverallocatePercent: 0,
      cpuOverallocatePercent: 0,
    });
    const nodeId = nodeBody.data.id;

    // 15000 MB memory exceeds physical limit of 10000 MB
    const { status, body } = await createServer({
      nodeId,
      allocatedMemoryMb: 15000,
      allocatedCpuCores: 1,
    });

    expect(status).toBe(400);
    expect(body.error).toContain('Insufficient memory');
  });

  it('is rejected when allocated CPU exceeds effective limit', async () => {
    const { body: nodeBody } = await createNode({
      name: `node-create-cpu-${nanoid(6)}`,
      maxMemoryMb: 10000,
      maxCpuCores: 4,
      memoryOverallocatePercent: 0,
      cpuOverallocatePercent: 0,
    });
    const nodeId = nodeBody.data.id;

    // 8 cores exceeds physical limit of 4 cores
    const { status, body } = await createServer({
      nodeId,
      allocatedMemoryMb: 1024,
      allocatedCpuCores: 8,
    });

    expect(status).toBe(400);
    expect(body.error).toContain('Insufficient CPU');
  });

  it('succeeds with unlimited over-allocation even if allocated > physical', async () => {
    const { body: nodeBody } = await createNode({
      name: `node-create-unlimited-${nanoid(6)}`,
      maxMemoryMb: 10000,
      maxCpuCores: 4,
      memoryOverallocatePercent: -1,
      cpuOverallocatePercent: -1,
    });
    const nodeId = nodeBody.data.id;

    // 50000 MB memory and 50 cores exceed physical limits but over-allocation is unlimited
    const { status, body } = await createServer({
      nodeId,
      allocatedMemoryMb: 50000,
      allocatedCpuCores: 50,
    });

    expect(status).toBe(201);
    expect(body.success).toBe(true);
  });
});

// ============================================================================
// 5. Server Transfer Respects Effective Limits
// ============================================================================

describe('Server Transfer Respects Effective Limits', () => {
  it('succeeds when target node has enough effective capacity', async () => {
    const { body: sourceNodeBody } = await createNode({
      name: `node-src-ok-${nanoid(6)}`,
      maxMemoryMb: 10000,
      maxCpuCores: 10,
      memoryOverallocatePercent: 0,
      cpuOverallocatePercent: 0,
    });
    const sourceNodeId = sourceNodeBody.data.id;

    const { body: targetNodeBody } = await createNode({
      name: `node-tgt-ok-${nanoid(6)}`,
      maxMemoryMb: 20000,
      maxCpuCores: 20,
      memoryOverallocatePercent: 50,
      cpuOverallocatePercent: 50,
    });
    const targetNodeId = targetNodeBody.data.id;

    // Nodes are created offline by default; set them online for transfer
    await prisma.node.update({ where: { id: sourceNodeId }, data: { isOnline: true } });
    await prisma.node.update({ where: { id: targetNodeId }, data: { isOnline: true } });

    // Create server on source node
    const { body: serverBody } = await createServer({
      nodeId: sourceNodeId,
      allocatedMemoryMb: 8000,
      allocatedCpuCores: 8,
    });
    const serverId = serverBody.data.id;

    const { status, body } = await transferServer(serverId, targetNodeId);
    expect(status).toBe(200);
    expect(body.success).toBe(true);

    // Verify server is now on target node
    const server = await prisma.server.findUnique({ where: { id: serverId } });
    expect(server?.nodeId).toBe(targetNodeId);
  });

  it('is rejected when target node effective capacity is exceeded', async () => {
    const { body: sourceNodeBody } = await createNode({
      name: `node-src-full-${nanoid(6)}`,
      maxMemoryMb: 10000,
      maxCpuCores: 10,
      memoryOverallocatePercent: 0,
      cpuOverallocatePercent: 0,
    });
    const sourceNodeId = sourceNodeBody.data.id;

    const { body: targetNodeBody } = await createNode({
      name: `node-tgt-full-${nanoid(6)}`,
      maxMemoryMb: 4000,
      maxCpuCores: 4,
      memoryOverallocatePercent: 0,
      cpuOverallocatePercent: 0,
    });
    const targetNodeId = targetNodeBody.data.id;

    // Nodes are created offline by default; set them online for transfer
    await prisma.node.update({ where: { id: sourceNodeId }, data: { isOnline: true } });
    await prisma.node.update({ where: { id: targetNodeId }, data: { isOnline: true } });

    // Create server on source node that exceeds target node capacity
    const { body: serverBody } = await createServer({
      nodeId: sourceNodeId,
      allocatedMemoryMb: 8000,
      allocatedCpuCores: 8,
    });
    const serverId = serverBody.data.id;

    const { status, body } = await transferServer(serverId, targetNodeId);
    expect(status).toBe(400);
    expect(body.error).toContain('Target node does not have enough resources');

    // Verify server is still on source node
    const server = await prisma.server.findUnique({ where: { id: serverId } });
    expect(server?.nodeId).toBe(sourceNodeId);
  });
});

console.log('Node Over-Allocation Tests loaded successfully');
