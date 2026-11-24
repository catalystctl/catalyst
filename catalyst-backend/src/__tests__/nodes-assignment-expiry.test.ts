/**
 * PATCH /api/nodes/:nodeId/assignments/:assignmentId — in-place expiry edit.
 *
 * Changing an assignment's expiry used to mean delete + re-create on the
 * client, which lost `assignedAt`/`assignedBy` and raced with concurrent
 * readers. The route must:
 *  - require node.assign plus write scope on the node (mirror POST /assign),
 *  - keep the admin-tier hierarchy guard ('*'-only for admin-tier targets),
 *  - set a future `expiresAt`, keep `assignedAt`, and clear it on `null`,
 *  - reject an unparseable or past date with 400,
 *  - 404 when the assignment belongs to another node.
 */
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { prisma } from '../db.js';
import { nodeRoutes } from '../routes/nodes.js';
import { nanoid } from 'nanoid';

let testLocationId: string;
let testNodeId: string;
let otherNodeId: string;

let actorUserId: string; // node.assign, scoped to the test node
let noAccessUserId: string; // node.assign, no node access
let noPermUserId: string; // node access, no node.assign
let adminWriteUserId: string; // admin.write
let superUserId: string; // '*'

let plainTargetUserId: string;
let adminTargetUserId: string;

const allUserIds: string[] = [];
const allRoleIds: string[] = [];

function buildTestApp(userId: string, permissions: string[]) {
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async (request: any, _reply: any) => {
    request.user = {
      userId,
      email: 'expiry-test@example.com',
      username: 'expiry-test',
      permissions,
    };
  });
  app.decorate('wsGateway', {
    pushToAdminSubscribers: () => {},
    pushToGlobalSubscribers: () => {},
    sendToAgent: async () => true,
    requestFromAgent: async () => ({ success: true }),
    relayBackupStream: async () => {},
  } as any);
  return app;
}

async function injectAs(
  userId: string,
  permissions: string[],
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
  url: string,
  payload?: Record<string, any>,
) {
  const app = buildTestApp(userId, permissions);
  await app.register(nodeRoutes, { prefix: '/api/nodes' });
  const res = await app.inject({
    method,
    url,
    ...(payload !== undefined ? { payload: payload as any } : {}),
  });
  await app.close();
  return res;
}

async function createUser(name: string, roleId?: string) {
  const user = await prisma.user.create({
    data: {
      email: `${name}-${nanoid(8)}@example.com`,
      username: `${name}${nanoid(4)}`,
      name,
      emailVerified: true,
      ...(roleId ? { roles: { connect: { id: roleId } } } : {}),
    },
  });
  allUserIds.push(user.id);
  return user.id;
}

async function createRole(permissions: string[]) {
  const role = await prisma.role.create({
    data: { name: `exp-${permissions.join('-')}-${nanoid(6)}`, permissions },
  });
  allRoleIds.push(role.id);
  return role.id;
}

async function createAssignment(userId: string, nodeId = testNodeId, expiresAt?: Date) {
  return prisma.nodeAssignment.create({
    data: { nodeId, userId, assignedBy: adminWriteUserId, expiresAt },
  });
}

const futureIso = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

beforeAll(async () => {
  const location = await prisma.location.create({
    data: { name: `exp-location-${nanoid(8)}` },
  });
  testLocationId = location.id;

  const node = await prisma.node.create({
    data: {
      name: `exp-node-${nanoid(8)}`,
      hostname: 'exp-host',
      publicAddress: '10.97.0.1',
      secret: `exp-${nanoid(12)}`,
      maxMemoryMb: 8192,
      maxCpuCores: 4,
      locationId: testLocationId,
    },
  });
  testNodeId = node.id;

  const otherNode = await prisma.node.create({
    data: {
      name: `exp-node-other-${nanoid(8)}`,
      hostname: 'exp-host-2',
      publicAddress: '10.97.0.2',
      secret: `exp-${nanoid(12)}`,
      maxMemoryMb: 4096,
      maxCpuCores: 2,
      locationId: testLocationId,
    },
  });
  otherNodeId = otherNode.id;

  // Scoped node.assign holder: has an assignment on the test node.
  const actorRoleId = await createRole(['node.assign']);
  actorUserId = await createUser('exp-actor', actorRoleId);
  await prisma.nodeAssignment.create({
    data: { nodeId: testNodeId, userId: actorUserId, assignedBy: actorUserId },
  });

  // node.assign without any node access.
  noAccessUserId = await createUser('exp-noaccess', actorRoleId);

  const adminWriteRoleId = await createRole(['admin.write']);
  adminWriteUserId = await createUser('exp-admin', adminWriteRoleId);
  const superRoleId = await createRole(['*']);
  superUserId = await createUser('exp-super', superRoleId);

  // Node access (via node.read) but no node.assign.
  const readOnlyRoleId = await createRole(['node.read']);
  noPermUserId = await createUser('exp-noperm', readOnlyRoleId);
  await prisma.nodeAssignment.create({
    data: { nodeId: testNodeId, userId: noPermUserId, assignedBy: adminWriteUserId },
  });

  plainTargetUserId = await createUser('exp-target');
  const adminTargetRoleId = await createRole(['admin.write']);
  adminTargetUserId = await createUser('exp-admtarget', adminTargetRoleId);
});

afterAll(async () => {
  await prisma.nodeAssignment.deleteMany({ where: { nodeId: { in: [testNodeId, otherNodeId] } } }).catch(() => {});
  // wildcard-free fixtures only, but clean anything left for the actors
  await prisma.nodeAssignment
    .deleteMany({ where: { userId: { in: allUserIds } } })
    .catch(() => {});
  for (const id of [testNodeId, otherNodeId]) {
    if (id) await prisma.node.delete({ where: { id } }).catch(() => {});
  }
  for (const id of allUserIds.reverse()) {
    await prisma.user.delete({ where: { id } }).catch(() => {});
  }
  for (const id of allRoleIds.reverse()) {
    await prisma.role.delete({ where: { id } }).catch(() => {});
  }
  if (testLocationId) await prisma.location.delete({ where: { id: testLocationId } }).catch(() => {});
});

describe('PATCH /api/nodes/:nodeId/assignments/:assignmentId', () => {
  it('sets an expiry in place and preserves assignedAt', async () => {
    const assignment = await createAssignment(plainTargetUserId);
    const expiresAt = futureIso();

    const res = await injectAs(
      actorUserId,
      ['node.assign'],
      'PATCH',
      `/api/nodes/${testNodeId}/assignments/${assignment.id}`,
      { expiresAt },
    );

    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
    expect(res.json().data.expiresAt).toBeTruthy();

    const stored = await prisma.nodeAssignment.findUnique({ where: { id: assignment.id } });
    expect(stored?.expiresAt?.toISOString()).toBe(new Date(expiresAt).toISOString());
    expect(stored?.assignedAt.getTime()).toBe(assignment.assignedAt.getTime());
    expect(stored?.assignedBy).toBe(assignment.assignedBy);

    await prisma.nodeAssignment.delete({ where: { id: assignment.id } }).catch(() => {});
  });

  it('clears the expiry when expiresAt is null', async () => {
    const assignment = await createAssignment(
      plainTargetUserId,
      testNodeId,
      new Date(Date.now() + 60 * 60 * 1000),
    );

    const res = await injectAs(
      actorUserId,
      ['node.assign'],
      'PATCH',
      `/api/nodes/${testNodeId}/assignments/${assignment.id}`,
      { expiresAt: null },
    );

    expect(res.statusCode).toBe(200);
    const stored = await prisma.nodeAssignment.findUnique({ where: { id: assignment.id } });
    expect(stored?.expiresAt).toBeNull();

    await prisma.nodeAssignment.delete({ where: { id: assignment.id } }).catch(() => {});
  });

  it('rejects a past date with 400', async () => {
    const assignment = await createAssignment(plainTargetUserId);
    const res = await injectAs(
      actorUserId,
      ['node.assign'],
      'PATCH',
      `/api/nodes/${testNodeId}/assignments/${assignment.id}`,
      { expiresAt: new Date(Date.now() - 60_000).toISOString() },
    );
    expect(res.statusCode).toBe(400);
    await prisma.nodeAssignment.delete({ where: { id: assignment.id } }).catch(() => {});
  });

  it('rejects an unparseable date with 400', async () => {
    const assignment = await createAssignment(plainTargetUserId);
    const res = await injectAs(
      actorUserId,
      ['node.assign'],
      'PATCH',
      `/api/nodes/${testNodeId}/assignments/${assignment.id}`,
      { expiresAt: 'not-a-date' },
    );
    expect(res.statusCode).toBe(400);
    await prisma.nodeAssignment.delete({ where: { id: assignment.id } }).catch(() => {});
  });

  it('404s when the assignment belongs to another node', async () => {
    const assignment = await createAssignment(plainTargetUserId, otherNodeId);
    const res = await injectAs(
      adminWriteUserId,
      ['admin.write'],
      'PATCH',
      `/api/nodes/${testNodeId}/assignments/${assignment.id}`,
      { expiresAt: futureIso() },
    );
    expect(res.statusCode).toBe(404);
    await prisma.nodeAssignment.delete({ where: { id: assignment.id } }).catch(() => {});
  });

  it('node.assign without node access cannot change an expiry', async () => {
    const assignment = await createAssignment(plainTargetUserId);
    const res = await injectAs(
      noAccessUserId,
      ['node.assign'],
      'PATCH',
      `/api/nodes/${testNodeId}/assignments/${assignment.id}`,
      { expiresAt: futureIso() },
    );
    expect(res.statusCode).toBe(403);
    const stored = await prisma.nodeAssignment.findUnique({ where: { id: assignment.id } });
    expect(stored?.expiresAt).toBeNull();
    await prisma.nodeAssignment.delete({ where: { id: assignment.id } }).catch(() => {});
  });

  it('a caller without node.assign is refused', async () => {
    const assignment = await createAssignment(plainTargetUserId);
    const res = await injectAs(
      noPermUserId,
      ['node.read'],
      'PATCH',
      `/api/nodes/${testNodeId}/assignments/${assignment.id}`,
      { expiresAt: futureIso() },
    );
    expect(res.statusCode).toBe(403);
    await prisma.nodeAssignment.delete({ where: { id: assignment.id } }).catch(() => {});
  });

  it('hierarchy: write-admin cannot edit an admin-tier assignment', async () => {
    const assignment = await createAssignment(adminTargetUserId);
    const res = await injectAs(
      adminWriteUserId,
      ['admin.write'],
      'PATCH',
      `/api/nodes/${testNodeId}/assignments/${assignment.id}`,
      { expiresAt: futureIso() },
    );
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain('admin-tier');
    await prisma.nodeAssignment.delete({ where: { id: assignment.id } }).catch(() => {});
  });

  it('hierarchy: "*" may edit an admin-tier assignment', async () => {
    const assignment = await createAssignment(adminTargetUserId);
    const res = await injectAs(
      superUserId,
      ['*'],
      'PATCH',
      `/api/nodes/${testNodeId}/assignments/${assignment.id}`,
      { expiresAt: futureIso() },
    );
    expect(res.statusCode).toBe(200);
    await prisma.nodeAssignment.delete({ where: { id: assignment.id } }).catch(() => {});
  });

  it('404s for an unknown assignment id', async () => {
    const res = await injectAs(
      adminWriteUserId,
      ['admin.write'],
      'PATCH',
      `/api/nodes/${testNodeId}/assignments/does-not-exist`,
      { expiresAt: futureIso() },
    );
    expect(res.statusCode).toBe(404);
  });
});