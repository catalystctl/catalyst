/**
 * Wildcard/assignment escalation guards on /api/nodes (audit infra.md §4 P0 +
 * test-plan §5e):
 *  - assign-wildcard requires write-admin or the caller's own wildcard reach
 *    (bare node.assign must not grant fleet-wide visibility),
 *  - self-target wildcard assignment is blocked,
 *  - the hierarchy guard makes admin-tier principals '*'-only targets,
 *  - assignment deletion is node-scoped like POST /assign.
 */
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { prisma } from '../db.js';
import { nodeRoutes } from '../routes/nodes.js';
import { nanoid } from 'nanoid';

let testLocationId: string;
let testNodeId: string;
let actorUserId: string;
let actorRoleId: string;
let reachUserId: string;
let noAccessUserId: string;
let noAccessRoleId: string;
let adminWriteUserId: string;
let adminWriteRoleId: string;
let superUserId: string;
let superRoleId: string;
let targetUserId: string;
let adminTargetUserId: string;
let adminTargetRoleId: string;
let wildcardTargetUserId: string;
let targetAssignmentId: string;
let adminTargetAssignmentId: string;
const allUserIds: string[] = [];
const allRoleIds: string[] = [];
const allAssignmentIds: string[] = [];

function buildTestApp(userId: string, permissions: string[]) {
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async (request: any, _reply: any) => {
    request.user = {
      userId,
      email: 'escalation-test@example.com',
      username: 'escalation-test',
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
    data: { name: `esc-${permissions.join('-')}-${nanoid(6)}`, permissions },
  });
  allRoleIds.push(role.id);
  return role.id;
}

async function trackAssignment(assignmentId: string) {
  allAssignmentIds.push(assignmentId);
}

beforeAll(async () => {
  const location = await prisma.location.create({
    data: { name: `esc-location-${nanoid(8)}` },
  });
  testLocationId = location.id;

  const node = await prisma.node.create({
    data: {
      name: `esc-node-${nanoid(8)}`,
      hostname: 'esc-host',
      publicAddress: '10.98.0.1',
      secret: `esc-${nanoid(12)}`,
      maxMemoryMb: 8192,
      maxCpuCores: 4,
      locationId: testLocationId,
    },
  });
  testNodeId = node.id;

  // node.assign holder with a node assignment (scoped, no wildcard reach)
  actorRoleId = await createRole(['node.assign']);
  actorUserId = await createUser('esc-actor', actorRoleId);
  await prisma.nodeAssignment.create({
    data: { nodeId: testNodeId, userId: actorUserId, assignedBy: actorUserId },
  });

  // node.assign holder WITH wildcard reach (assignment nodeId = null)
  reachUserId = await createUser('esc-reach', actorRoleId);
  const reachWildcard = await prisma.nodeAssignment.create({
    data: { nodeId: null, userId: reachUserId, assignedBy: actorUserId },
  });
  await trackAssignment(reachWildcard.id);

  // node.assign holder with no node access at all
  noAccessRoleId = await createRole(['node.assign']);
  noAccessUserId = await createUser('esc-noaccess', noAccessRoleId);

  // write-admin and super actors
  adminWriteRoleId = await createRole(['admin.write']);
  adminWriteUserId = await createUser('esc-admin', adminWriteRoleId);
  superRoleId = await createRole(['*']);
  superUserId = await createUser('esc-super', superRoleId);

  // targets: plain user and admin-tier user, both assigned to the node
  targetUserId = await createUser('esc-target');
  const targetAssignment = await prisma.nodeAssignment.create({
    data: { nodeId: testNodeId, userId: targetUserId, assignedBy: adminWriteUserId },
  });
  targetAssignmentId = targetAssignment.id;
  await trackAssignment(targetAssignmentId);

  adminTargetRoleId = await createRole(['admin.write']);
  adminTargetUserId = await createUser('esc-admtarget', adminTargetRoleId);
  const adminTargetAssignment = await prisma.nodeAssignment.create({
    data: { nodeId: testNodeId, userId: adminTargetUserId, assignedBy: adminWriteUserId },
  });
  adminTargetAssignmentId = adminTargetAssignment.id;
  await trackAssignment(adminTargetAssignmentId);

  // throwaway target for wildcard-create tests (assignNode replaces the
  // target's existing assignments, so it must not touch the fixtures above)
  wildcardTargetUserId = await createUser('esc-wctarget');
});

afterAll(async () => {
  // wildcard rows have nodeId null — clean by tracked ids and by principal
  for (const id of allAssignmentIds) {
    await prisma.nodeAssignment.delete({ where: { id } }).catch(() => {});
  }
  await prisma.nodeAssignment.deleteMany({ where: { nodeId: testNodeId } }).catch(() => {});
  if (testNodeId) await prisma.node.delete({ where: { id: testNodeId } }).catch(() => {});
  for (const id of allUserIds.reverse()) {
    await prisma.user.delete({ where: { id } }).catch(() => {});
  }
  for (const id of allRoleIds.reverse()) {
    await prisma.role.delete({ where: { id } }).catch(() => {});
  }
  if (testLocationId) await prisma.location.delete({ where: { id: testLocationId } }).catch(() => {});
});

describe('assignment deletion guards', () => {
  it('node.assign without node access cannot delete an assignment', async () => {
    const res = await injectAs(noAccessUserId, ['node.assign'], 'DELETE', `/api/nodes/${testNodeId}/assignments/${targetAssignmentId}`);
    expect(res.statusCode).toBe(403);
  });

  it('a scoped node.assign holder may delete a plain-target assignment', async () => {
    const res = await injectAs(actorUserId, ['node.assign'], 'DELETE', `/api/nodes/${testNodeId}/assignments/${targetAssignmentId}`);
    expect(res.statusCode).toBe(200);
    targetAssignmentId = '';
  });

  it('hierarchy: write-admin cannot delete an admin-tier assignment', async () => {
    const res = await injectAs(adminWriteUserId, ['admin.write'], 'DELETE', `/api/nodes/${testNodeId}/assignments/${adminTargetAssignmentId}`);
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain('admin-tier');
  });

  it('hierarchy: "*" may delete an admin-tier assignment', async () => {
    const res = await injectAs(superUserId, ['*'], 'DELETE', `/api/nodes/${testNodeId}/assignments/${adminTargetAssignmentId}`);
    expect(res.statusCode).toBe(200);
    adminTargetAssignmentId = '';
  });

  it('wildcard deletion requires write-admin or wildcard reach', async () => {
    const res = await injectAs(noAccessUserId, ['node.assign'], 'DELETE', `/api/nodes/assign-wildcard/user/${targetUserId}`);
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain('Wildcard node reach required');
  });
});

describe('assign-wildcard escalation guards', () => {
  it('bare node.assign cannot grant wildcard reach to someone else', async () => {
    const res = await injectAs(actorUserId, ['node.assign'], 'POST', '/api/nodes/assign-wildcard', {
      targetType: 'user',
      targetId: targetUserId,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain('Wildcard node reach required');
  });

  it('wildcard reach cannot self-assign fleet-wide access', async () => {
    const res = await injectAs(reachUserId, ['node.assign'], 'POST', '/api/nodes/assign-wildcard', {
      targetType: 'user',
      targetId: reachUserId,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain('yourself');
  });

  it('write-admin may create a wildcard assignment for a plain target', async () => {
    const res = await injectAs(adminWriteUserId, ['admin.write'], 'POST', '/api/nodes/assign-wildcard', {
      targetType: 'user',
      targetId: wildcardTargetUserId,
    });
    expect(res.statusCode).toBe(201);
    await prisma.nodeAssignment
      .deleteMany({ where: { nodeId: null, userId: wildcardTargetUserId } })
      .catch(() => {});
  });

  it('write-admin cannot self-assign fleet-wide access', async () => {
    const res = await injectAs(adminWriteUserId, ['admin.write'], 'POST', '/api/nodes/assign-wildcard', {
      targetType: 'user',
      targetId: adminWriteUserId,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain('yourself');
  });

  it('hierarchy: write-admin cannot wildcard-assign an admin-tier principal', async () => {
    const res = await injectAs(adminWriteUserId, ['admin.write'], 'POST', '/api/nodes/assign-wildcard', {
      targetType: 'user',
      targetId: adminTargetUserId,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain('admin-tier');
  });

  it('hierarchy: "*" may wildcard-assign an admin-tier principal', async () => {
    const res = await injectAs(superUserId, ['*'], 'POST', '/api/nodes/assign-wildcard', {
      targetType: 'user',
      targetId: adminTargetUserId,
    });
    expect(res.statusCode).toBe(201);
    await prisma.nodeAssignment
      .deleteMany({ where: { nodeId: null, userId: adminTargetUserId } })
      .catch(() => {});
  });
});
