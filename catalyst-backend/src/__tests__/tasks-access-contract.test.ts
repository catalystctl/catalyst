/**
 * Scheduled-task access contract (test-plan §5g):
 *  - task LISTING admits admin.read (read tier) but not plain users —
 *    reads gate on server.read like every other server read (A-READ-GAP:
 *    listings previously demanded server.schedule);
 *  - task CREATE/EXECUTE match the action's capability: restart needs
 *    server.start AND server.stop, command needs console.write (on top of
 *    server.schedule);
 *  - a node manager (assignment + node.update) can list and run tasks.
 *
 * P-A inject harness with session-shaped request.user. Execute-after-gate
 * deterministically ends in 500 "Task scheduler not available" because the
 * test app has no taskScheduler — asserting that code (not 403) proves the
 * permission layer passed.
 */
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { prisma } from '../db.js';
import { taskRoutes } from '../routes/tasks.js';
import { nanoid } from 'nanoid';

let ownerUserId: string;
let adminReadUserId: string;
let plainUserId: string;
let nodeManagerUserId: string;
let scheduleOnlyUserId: string;
let schedulePowerUserId: string;
let scheduleCommandUserId: string;
let ownerRoleId: string;
let adminReadRoleId: string;
let plainRoleId: string;
let nodeManagerRoleId: string;
let locationId: string;
let nodeId: string;
let templateId: string;
let serverId: string;
let currentUserId = '';

function buildApp() {
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async (request: any) => {
    const user = await prisma.user.findUnique({
      where: { id: currentUserId },
      select: { roles: { select: { permissions: true } } },
    });
    request.user = {
      userId: currentUserId,
      email: 'tasks-test@example.com',
      username: 'tasks-test',
      permissions: user?.roles.flatMap((r) => r.permissions) ?? [],
    };
  });
  app.register(taskRoutes, { prefix: '/api/servers' });
  return app;
}

async function createUser(roleId: string | null, name: string) {
  const user = await prisma.user.create({
    data: {
      email: `${name}-${nanoid(8)}@example.com`,
      username: `${name}${nanoid(4)}`,
      name,
      emailVerified: true,
      ...(roleId ? { roles: { connect: { id: roleId } } } : {}),
    },
  });
  return user.id;
}

async function callAs(
  userId: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  payload?: Record<string, unknown> | string,
): Promise<{ statusCode: number; body: string }> {
  const app = buildApp();
  currentUserId = userId;
  const res = await app.inject({
    method,
    url,
    ...(payload !== undefined ? { payload, headers: { 'content-type': 'application/json' } } : {}),
  });
  await app.close();
  return res as unknown as { statusCode: number; body: string };
}

function users() {
  return {
    owner: ownerUserId,
    adminRead: adminReadUserId,
    plain: plainUserId,
    nodeManager: nodeManagerUserId,
    scheduleOnly: scheduleOnlyUserId,
    schedulePower: schedulePowerUserId,
    scheduleCommand: scheduleCommandUserId,
  };
}
const userByKey = (key: string) => users()[key as keyof ReturnType<typeof users>];

const validTask = (action: string) => ({
  name: `test-task-${nanoid(6)}`,
  action,
  schedule: '0 3 * * *',
  payload: {},
});

beforeAll(async () => {
  const mkRole = (perms: string[], tag: string) =>
    prisma.role.create({ data: { name: `test-tasks-${tag}-${nanoid(8)}`, permissions: perms } });
  const [ownerRole, adminReadRole, plainRole, nodeManagerRole] = await Promise.all([
    mkRole(['*'], 'owner'),
    mkRole(['admin.read'], 'adminread'),
    mkRole(['alert.read'], 'plain'),
    mkRole(['node.read', 'node.update'], 'nodemanager'),
  ]);
  ownerRoleId = ownerRole.id;
  adminReadRoleId = adminReadRole.id;
  plainRoleId = plainRole.id;
  nodeManagerRoleId = nodeManagerRole.id;

  [ownerUserId, adminReadUserId, plainUserId, nodeManagerUserId, scheduleOnlyUserId, schedulePowerUserId, scheduleCommandUserId] =
    await Promise.all([
      createUser(ownerRoleId, 'tasks-owner'),
      createUser(adminReadRoleId, 'tasks-adminread'),
      createUser(plainRoleId, 'tasks-plain'),
      createUser(nodeManagerRoleId, 'tasks-nodemanager'),
      createUser(null, 'tasks-scheduleonly'),
      createUser(null, 'tasks-schedulepower'),
      createUser(null, 'tasks-schedulecommand'),
    ]);

  const location = await prisma.location.create({ data: { name: `test-tasks-loc-${nanoid(8)}` } });
  locationId = location.id;
  const node = await prisma.node.create({
    data: {
      name: `test-tasks-node-${nanoid(8)}`,
      locationId,
      hostname: 'tasks.example.com',
      publicAddress: '10.0.0.10',
      secret: `secret-${nanoid(16)}`,
      maxMemoryMb: 8192,
      maxCpuCores: 4,
      isOnline: true,
    },
  });
  nodeId = node.id;
  await prisma.nodeAssignment.create({
    data: { nodeId, userId: nodeManagerUserId, assignedBy: ownerUserId },
  });

  const template = await prisma.serverTemplate.create({
    data: {
      name: `test-tasks-template-${nanoid(8)}`,
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

  const server = await prisma.server.create({
    data: {
      uuid: `test-tasks-${nanoid(12)}`,
      name: `test-tasks-server-${nanoid(8)}`,
      templateId,
      nodeId,
      locationId,
      ownerId: ownerUserId,
      allocatedMemoryMb: 512,
      allocatedCpuCores: 1,
      primaryPort: 25570,
    },
  });
  serverId = server.id;

  // Subuser rows: schedule-only, schedule+power, schedule+console.
  await prisma.serverAccess.createMany({
    data: [
      { serverId, userId: scheduleOnlyUserId, permissions: ['server.read', 'server.schedule'] },
      { serverId, userId: schedulePowerUserId, permissions: ['server.read', 'server.schedule', 'server.start', 'server.stop'] },
      { serverId, userId: scheduleCommandUserId, permissions: ['server.read', 'server.schedule', 'console.write'] },
    ],
  });
});

afterAll(async () => {
  if (serverId) {
    await prisma.scheduledTask.deleteMany({ where: { serverId } }).catch(() => {});
    await prisma.serverAccess.deleteMany({ where: { serverId } }).catch(() => {});
    await prisma.server.delete({ where: { id: serverId } }).catch(() => {});
  }
  if (templateId) await prisma.serverTemplate.delete({ where: { id: templateId } }).catch(() => {});
  if (nodeId) {
    await prisma.nodeAssignment.deleteMany({ where: { nodeId } }).catch(() => {});
    await prisma.node.delete({ where: { id: nodeId } }).catch(() => {});
  }
  for (const id of [ownerUserId, adminReadUserId, plainUserId, nodeManagerUserId, scheduleOnlyUserId, schedulePowerUserId, scheduleCommandUserId]) {
    if (id) await prisma.user.delete({ where: { id } }).catch(() => {});
  }
  for (const id of [ownerRoleId, adminReadRoleId, plainRoleId, nodeManagerRoleId]) {
    if (id) await prisma.role.delete({ where: { id } }).catch(() => {});
  }
  if (locationId) await prisma.location.delete({ where: { id: locationId } }).catch(() => {});
});

describe('task listing read gate', () => {
  it.each([
    ['admin.read role', 'adminRead'],
    ['ServerAccess row [server.read, server.schedule]', 'scheduleOnly'],
    ['node manager (assignment + node.update)', 'nodeManager'],
  ])('admits %s', async (_label, key) => {
    const res = await callAs(userByKey(key), 'GET', `/api/servers/${serverId}/tasks`);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).tasks).toBeDefined();
  });

  it('rejects a plain user', async () => {
    const res = await callAs(userByKey('plain'), 'GET', `/api/servers/${serverId}/tasks`);
    expect(res.statusCode).toBe(403);
  });
});

describe('task create action-capability gate', () => {
  it('owner can create a command task', async () => {
    const res = await callAs(userByKey('owner'), 'POST', `/api/servers/${serverId}/tasks`, validTask('command'));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).task.action).toBe('command');
  });

  it('schedule-only subuser cannot create a restart task (needs server.start + server.stop)', async () => {
    const res = await callAs(userByKey('scheduleOnly'), 'POST', `/api/servers/${serverId}/tasks`, validTask('restart'));
    expect(res.statusCode).toBe(403);
  });

  it('schedule-only subuser cannot create a backup task (needs backup.create)', async () => {
    const res = await callAs(userByKey('scheduleOnly'), 'POST', `/api/servers/${serverId}/tasks`, validTask('backup'));
    expect(res.statusCode).toBe(403);
  });

  it('schedule-only subuser cannot create a command task (needs console.write)', async () => {
    const res = await callAs(userByKey('scheduleOnly'), 'POST', `/api/servers/${serverId}/tasks`, validTask('command'));
    expect(res.statusCode).toBe(403);
  });

  it.each([
    ['restart (power pair)', 'schedulePower', 'restart'],
    ['command (console)', 'scheduleCommand', 'command'],
  ])('schedule subuser with matching permissions can create a %s task', async (_label, key, action) => {
    const res = await callAs(userByKey(key), 'POST', `/api/servers/${serverId}/tasks`, validTask(action));
    expect(res.statusCode).toBe(200);
  });
});

describe('task execute action gate', () => {
  let commandTaskId = '';
  beforeAll(async () => {
    const res = await callAs(userByKey('owner'), 'POST', `/api/servers/${serverId}/tasks`, validTask('command'));
    commandTaskId = JSON.parse(res.body).task.id;
  });

  it('schedule-only subuser cannot execute a command task', async () => {
    const res = await callAs(userByKey('scheduleOnly'), 'POST', `/api/servers/${serverId}/tasks/${commandTaskId}/execute`);
    expect(res.statusCode).toBe(403);
  });

  it.each([
    ['schedule subuser with console.write', 'scheduleCommand'],
    ['node manager (assignment + node.update)', 'nodeManager'],
  ])('%s passes the execute permission layer (500 = no scheduler in the test app)', async (_label, key) => {
    const res = await callAs(userByKey(key), 'POST', `/api/servers/${serverId}/tasks/${commandTaskId}/execute`);
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).code).toBe('TASK_SCHEDULER_UNAVAILABLE');
  });
});
