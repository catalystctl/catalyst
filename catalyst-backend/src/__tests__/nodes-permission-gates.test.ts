/**
 * Route-level permission gates on /api/nodes (audit/permission-audit §4 + §5a):
 *  - ensurePermission is hasGrant-based: '*' / admin.write / admin.read
 *    (read class) pass; a bare catalog permission no longer admits unrelated
 *    callers, and admin bits no longer 403 at the raw-includes gate.
 *  - Node-scoped reads (hasNodeScope read): admin.read sees every node;
 *    node.read holders need an assignment.
 *  - Node-scoped writes (hasNodeScope write) incl. the agent-control
 *    cluster: node.agent_control (legacy node.update rides the alias) plus
 *    node access.
 *  - node.view_stats stats route admits admin bits without an assignment.
 */
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { prisma } from '../db.js';
import { nodeRoutes } from '../routes/nodes.js';
import { nanoid } from 'nanoid';

let testLocationId: string;
let testNodeId: string;
let plainUserId: string;
let assignedUserId: string;
let assignedRoleId: string;
let adminWriteUserId: string;
let adminWriteRoleId: string;

function buildTestApp(userId: string, permissions: string[], overrides: Record<string, any> = {}) {
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async (request: any, _reply: any) => {
    request.user = {
      userId,
      email: 'gates-test@example.com',
      username: 'gates-test',
      permissions,
      ...overrides,
    };
  });
  app.decorate('wsGateway', {
    pushToAdminSubscribers: () => {},
    pushToGlobalSubscribers: () => {},
    sendToAgent: async () => true,
    requestFromAgent: async () => ({ success: true }),
    relayBackupStream: async () => {},
    getDiscoveredContainers: () => [],
  } as any);
  return app;
}

async function injectAs(
  userId: string,
  permissions: string[],
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
  url: string,
  payload?: Record<string, any>,
  overrides: Record<string, any> = {},
) {
  const app = buildTestApp(userId, permissions, overrides);
  await app.register(nodeRoutes, { prefix: '/api/nodes' });
  const res = await app.inject({
    method,
    url,
    ...(payload !== undefined ? { payload: payload as any } : {}),
  });
  await app.close();
  return res;
}

beforeAll(async () => {
  const location = await prisma.location.create({
    data: { name: `gates-location-${nanoid(8)}` },
  });
  testLocationId = location.id;

  const node = await prisma.node.create({
    data: {
      name: `gates-node-${nanoid(8)}`,
      hostname: 'gates-host',
      publicAddress: '10.99.0.1',
      secret: `gates-${nanoid(12)}`,
      maxMemoryMb: 8192,
      maxCpuCores: 4,
      locationId: testLocationId,
    },
  });
  testNodeId = node.id;

  const plain = await prisma.user.create({
    data: {
      email: `gates-plain-${nanoid(8)}@example.com`,
      username: `gatesplain${nanoid(4)}`,
      name: 'Gates Plain',
      emailVerified: true,
    },
  });
  plainUserId = plain.id;

  const assignedRole = await prisma.role.create({
    data: { name: `gates-assigned-${nanoid(8)}`, permissions: ['node.update'] },
  });
  assignedRoleId = assignedRole.id;
  const assigned = await prisma.user.create({
    data: {
      email: `gates-assigned-${nanoid(8)}@example.com`,
      username: `gatesassign${nanoid(4)}`,
      name: 'Gates Assigned',
      emailVerified: true,
      roles: { connect: { id: assignedRoleId } },
    },
  });
  assignedUserId = assigned.id;
  await prisma.nodeAssignment.create({
    data: { nodeId: testNodeId, userId: assignedUserId, assignedBy: plainUserId },
  });

  const adminWriteRole = await prisma.role.create({
    data: { name: `gates-admin-${nanoid(8)}`, permissions: ['admin.write'] },
  });
  adminWriteRoleId = adminWriteRole.id;
  const adminWrite = await prisma.user.create({
    data: {
      email: `gates-admin-${nanoid(8)}@example.com`,
      username: `gatesadmin${nanoid(4)}`,
      name: 'Gates Admin',
      emailVerified: true,
      roles: { connect: { id: adminWriteRoleId } },
    },
  });
  adminWriteUserId = adminWrite.id;
});

afterAll(async () => {
  await prisma.deploymentToken.deleteMany({ where: { nodeId: testNodeId } }).catch(() => {});
  await prisma.apikey.deleteMany({ where: { name: `agent-${testNodeId.slice(0, 8)}` } }).catch(() => {});
  await prisma.nodeAssignment.deleteMany({ where: { nodeId: testNodeId } }).catch(() => {});
  if (testNodeId) await prisma.node.delete({ where: { id: testNodeId } }).catch(() => {});
  for (const id of [plainUserId, assignedUserId, adminWriteUserId]) {
    if (id) await prisma.user.delete({ where: { id } }).catch(() => {});
  }
  for (const id of [assignedRoleId, adminWriteRoleId]) {
    if (id) await prisma.role.delete({ where: { id } }).catch(() => {});
  }
  if (testLocationId) await prisma.location.delete({ where: { id: testLocationId } }).catch(() => {});
});

describe('nodes permission gates (hasGrant)', () => {
  it('rejects a caller with no permissions', async () => {
    const res = await injectAs(plainUserId, [], 'GET', '/api/nodes');
    expect(res.statusCode).toBe(403);
  });

  it('admits admin.read, admin.write and "*" through the admin gate', async () => {
    for (const perms of [['admin.read'], ['admin.write'], ['*']]) {
      const res = await injectAs(plainUserId, perms, 'GET', '/api/nodes');
      expect(res.statusCode).toBe(200);
    }
  });

  it('node.read alone does not read a node the caller cannot access', async () => {
    const res = await injectAs(plainUserId, ['node.read'], 'GET', `/api/nodes/${testNodeId}`);
    expect(res.statusCode).toBe(403);
  });

  it('admin.read reads node detail without an assignment', async () => {
    const res = await injectAs(plainUserId, ['admin.read'], 'GET', `/api/nodes/${testNodeId}`);
    expect(res.statusCode).toBe(200);
  });

  it('a node assignment scopes node.read holders to the node', async () => {
    const res = await injectAs(assignedUserId, ['node.read'], 'GET', `/api/nodes/${testNodeId}`);
    expect(res.statusCode).toBe(200);
  });
});

describe('node stats gate', () => {
  it('requires node.view_stats (node.read is not enough)', async () => {
    const res = await injectAs(plainUserId, ['node.read'], 'GET', `/api/nodes/${testNodeId}/stats`);
    expect(res.statusCode).toBe(403);
  });

  it('admin.read reads stats without an assignment', async () => {
    const res = await injectAs(plainUserId, ['admin.read'], 'GET', `/api/nodes/${testNodeId}/stats`);
    expect(res.statusCode).toBe(200);
  });

  it('node.view_stats with a node assignment reads stats', async () => {
    const res = await injectAs(assignedUserId, ['node.view_stats'], 'GET', `/api/nodes/${testNodeId}/stats`);
    expect(res.statusCode).toBe(200);
  });
});

describe('node write scoping', () => {
  it('node.update without node access cannot PUT a node', async () => {
    const res = await injectAs(plainUserId, ['node.update'], 'PUT', `/api/nodes/${testNodeId}`, {
      name: `gates-renamed-${nanoid(6)}`,
    });
    expect(res.statusCode).toBe(403);
  });

  it('node.update with a node assignment may PUT a node', async () => {
    const res = await injectAs(assignedUserId, ['node.update'], 'PUT', `/api/nodes/${testNodeId}`, {
      name: `gates-renamed-${nanoid(6)}`,
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('agent-control cluster (node.agent_control + hasNodeScope)', () => {
  it('node.update (legacy) without node access cannot restart the agent', async () => {
    const res = await injectAs(plainUserId, ['node.update'], 'POST', `/api/nodes/${testNodeId}/agent/restart`);
    expect(res.statusCode).toBe(403);
  });

  it('node.agent_control without node access cannot restart the agent', async () => {
    const res = await injectAs(plainUserId, ['node.agent_control'], 'POST', `/api/nodes/${testNodeId}/agent/restart`);
    expect(res.statusCode).toBe(403);
  });

  it('node.agent_control with a node assignment passes the scope (offline 409, not 403)', async () => {
    const res = await injectAs(assignedUserId, ['node.agent_control'], 'POST', `/api/nodes/${testNodeId}/agent/restart`);
    expect(res.statusCode).toBe(409);
  });

  it('legacy node.update with a node assignment still controls the agent (alias window)', async () => {
    const res = await injectAs(assignedUserId, ['node.update'], 'POST', `/api/nodes/${testNodeId}/agent/restart`);
    expect(res.statusCode).toBe(409);
  });

  it('admin.write passes scope without an assignment (offline 409, not 403)', async () => {
    const res = await injectAs(adminWriteUserId, ['admin.write'], 'POST', `/api/nodes/${testNodeId}/agent/restart`);
    expect(res.statusCode).toBe(409);
  });

  it('agent status is visible to admin.read without an assignment', async () => {
    const res = await injectAs(plainUserId, ['admin.read'], 'GET', `/api/nodes/${testNodeId}/agent/status`);
    expect(res.statusCode).toBe(200);
  });

  it('agent status is node-scoped for plain node.read holders', async () => {
    const denied = await injectAs(plainUserId, ['node.read'], 'GET', `/api/nodes/${testNodeId}/agent/status`);
    expect(denied.statusCode).toBe(403);
    const allowed = await injectAs(assignedUserId, ['node.read'], 'GET', `/api/nodes/${testNodeId}/agent/status`);
    expect(allowed.statusCode).toBe(200);
  });

  it('agent config reads are node-scoped (TARGET-§2.6)', async () => {
    const denied = await injectAs(plainUserId, ['node.read'], 'GET', `/api/nodes/${testNodeId}/agent/config`);
    expect(denied.statusCode).toBe(403);
    // Scope passes; the fixture node is offline, so the agent answers 409.
    const allowed = await injectAs(plainUserId, ['admin.read'], 'GET', `/api/nodes/${testNodeId}/agent/config`);
    expect(allowed.statusCode).toBe(409);
  });
});

describe('read-route any-of expansions', () => {
  it('allocations list accepts node.read with node access', async () => {
    const denied = await injectAs(plainUserId, ['node.read'], 'GET', `/api/nodes/${testNodeId}/allocations`);
    expect(denied.statusCode).toBe(403);
    const allowed = await injectAs(assignedUserId, ['node.read'], 'GET', `/api/nodes/${testNodeId}/allocations`);
    expect(allowed.statusCode).toBe(200);
  });

  it('assignments list accepts node.read with node access', async () => {
    const denied = await injectAs(plainUserId, ['node.read'], 'GET', `/api/nodes/${testNodeId}/assignments`);
    expect(denied.statusCode).toBe(403);
    const allowed = await injectAs(assignedUserId, ['node.read'], 'GET', `/api/nodes/${testNodeId}/assignments`);
    expect(allowed.statusCode).toBe(200);
  });

  it('unregistered containers gate on node.read + node scope, not literal admin.write', async () => {
    const denied = await injectAs(plainUserId, ['node.read'], 'GET', `/api/nodes/${testNodeId}/unregistered-containers`);
    expect(denied.statusCode).toBe(403);
    const allowed = await injectAs(plainUserId, ['admin.read'], 'GET', `/api/nodes/${testNodeId}/unregistered-containers`);
    expect(allowed.statusCode).toBe(200);
  });
});

describe('server-creation contract on import-server (TARGET-§2.4)', () => {
  it('server.create passes the gate (validation-blocked, not 403)', async () => {
    const res = await injectAs(plainUserId, ['server.create'], 'POST', `/api/nodes/${testNodeId}/import-server`, {});
    expect(res.statusCode).toBe(400);
  });

  it('admin.write passes the gate (validation-blocked, not 403)', async () => {
    const res = await injectAs(plainUserId, ['admin.write'], 'POST', `/api/nodes/${testNodeId}/import-server`, {});
    expect(res.statusCode).toBe(400);
  });

  it('the node-manage path (assignment + legacy node.update) passes the gate', async () => {
    const res = await injectAs(assignedUserId, ['node.update'], 'POST', `/api/nodes/${testNodeId}/import-server`, {});
    expect(res.statusCode).toBe(400);
  });

  it('node.update without node access is 403', async () => {
    const res = await injectAs(plainUserId, ['node.update'], 'POST', `/api/nodes/${testNodeId}/import-server`, {});
    expect(res.statusCode).toBe(403);
  });
});

describe('agent-key minting requires the node-manage pairing (node.server_manage)', () => {
  it('node.create alone is no longer the gate (403)', async () => {
    const res = await injectAs(plainUserId, ['node.create'], 'POST', `/api/nodes/${testNodeId}/api-key`);
    expect(res.statusCode).toBe(403);
  });

  it('node.server_manage without node access is 403', async () => {
    const res = await injectAs(plainUserId, ['node.server_manage'], 'POST', `/api/nodes/${testNodeId}/api-key`);
    expect(res.statusCode).toBe(403);
  });

  it('assignment + legacy node.update role may mint the agent key', async () => {
    const res = await injectAs(assignedUserId, ['node.update'], 'POST', `/api/nodes/${testNodeId}/api-key`);
    expect(res.statusCode).toBe(200);
    await prisma.apikey.deleteMany({ where: { name: `agent-${testNodeId.slice(0, 8)}` } }).catch(() => {});
  });

  it('write-admin may mint the deployment token', async () => {
    const res = await injectAs(adminWriteUserId, ['admin.write'], 'POST', `/api/nodes/${testNodeId}/deployment-token`);
    expect(res.statusCode).toBe(200);
    await prisma.deploymentToken.deleteMany({ where: { nodeId: testNodeId } }).catch(() => {});
    await prisma.apikey.deleteMany({ where: { name: `agent-${testNodeId.slice(0, 8)}` } }).catch(() => {});
  });
});

describe('GET /accessible widens for admin.read', () => {
  it('admin.read sees every node with wildcard semantics', async () => {
    const res = await injectAs(plainUserId, ['admin.read'], 'GET', '/api/nodes/accessible');
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.hasWildcard).toBe(true);
    expect(body.data.some((n: any) => n.id === testNodeId)).toBe(true);
  });

  it('node.read without assignment sees an empty list', async () => {
    const res = await injectAs(plainUserId, ['node.read'], 'GET', '/api/nodes/accessible');
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.hasWildcard).toBe(false);
    expect(body.data.some((n: any) => n.id === testNodeId)).toBe(false);
  });

  it('an assigned node.read holder sees the node', async () => {
    const res = await injectAs(assignedUserId, ['node.read'], 'GET', '/api/nodes/accessible');
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data.some((n: any) => n.id === testNodeId)).toBe(true);
  });
});
