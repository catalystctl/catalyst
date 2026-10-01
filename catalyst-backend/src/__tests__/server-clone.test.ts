/**
 * Server cloning tests.
 *
 * Covers the two clone modes, the node-specific preflight plan, the
 * server-enforced cross-node confirmation contract, configuration-clone
 * install, idempotency and boot reconciliation.
 *
 * DB-backed: fixtures are created per run and removed in afterAll.
 */

import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { prisma } from '../db.js';
import { serverRoutes } from '../routes/servers.js';
import { nanoid } from 'nanoid';
import {
  buildClonePlan,
  clearClonePreflightMemory,
  clearCloneProvenanceMemory,
  cloneFingerprint,
  loadCloneSource,
  resolveCloneMode,
  storeClonePreflight,
  storeCloneProvenance,
  takeClonePreflight,
  type CloneAuth,
  type CloneRequest,
} from '../services/server-clone.js';
import { reconcileStuckOperations } from '../lib/reconcile-operations.js';
import { clearIdempotencyMemory } from '../lib/idempotency.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

let locationAId: string;
let locationBId: string;
let userId: string;
let otherUserId: string;
let roleId: string;
let templateId: string;
let nodeAId: string;
let nodeBId: string;
const createdServerIds: string[] = [];
let nextPort = 25000;

const adminAuth: CloneAuth = {
  userId: '',
  canCreate: true,
  canSetOwner: true,
  canTransfer: true,
  canManageSuspended: true,
  canAccessTargetNode: true,
};

function getNextPort() {
  return nextPort++;
}

function baseRequest(overrides: Partial<CloneRequest> = {}): CloneRequest {
  return {
    mode: 'configuration',
    targetNodeId: nodeAId,
    includeAccess: true,
    includeRoleGrants: true,
    includeScheduledTasks: false,
    includeDatabases: false,
    ...overrides,
  };
}

async function createNode(locationId: string, overrides: Record<string, any> = {}) {
  const node = await prisma.node.create({
    data: {
      name: `clone-node-${nanoid(8)}`,
      locationId,
      hostname: 'node.example.com',
      publicAddress: '10.0.0.1',
      secret: `secret-${nanoid(16)}`,
      maxMemoryMb: 8192,
      maxCpuCores: 8,
      isOnline: true,
      ...overrides,
    },
  });
  return node;
}

async function createServer(nodeId: string, overrides: Record<string, any> = {}) {
  const port = getNextPort();
  const server = await prisma.server.create({
    data: {
      uuid: `uuid-${nanoid(12)}`,
      name: `clone-source-${nanoid(6)}`,
      templateId,
      nodeId,
      locationId: (await prisma.node.findUniqueOrThrow({ where: { id: nodeId } })).locationId,
      ownerId: userId,
      allocatedMemoryMb: 1024,
      allocatedCpuCores: 1,
      allocatedDiskMb: 4096,
      primaryPort: port,
      portBindings: { [port]: port },
      networkMode: 'bridge',
      environment: { SERVER_NAME: 'source' },
      status: 'stopped',
      ...overrides,
    },
  });
  createdServerIds.push(server.id);
  return server;
}

function buildTestApp() {
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async (request: any) => {
    request.user = {
      userId,
      email: 'clone@example.com',
      username: 'cloneuser',
      permissions: ['*'],
    };
  });
  app.decorate('wsGateway', {
    pushToAdminSubscribers: () => {},
    pushToGlobalSubscribers: () => {},
    routeToClients: async () => {},
    sendToAgent: async () => true,
    requestFromAgent: async () => ({ success: true }),
    relayBackupStream: async () => {},
  } as any);
  app.decorate('webhookService', {
    serverCreated: async () => {},
    serverCloned: async () => {},
  });
  app.decorate('fileTunnel', { createTunnel: async () => ({ tunnelId: 't' }) });
  return app;
}

// ── Setup ───────────────────────────────────────────────────────────────────

beforeAll(async () => {
  clearIdempotencyMemory();
  clearClonePreflightMemory();
  clearCloneProvenanceMemory();

  const locationA = await prisma.location.create({ data: { name: `clone-loc-a-${nanoid(6)}` } });
  const locationB = await prisma.location.create({ data: { name: `clone-loc-b-${nanoid(6)}` } });
  locationAId = locationA.id;
  locationBId = locationB.id;

  const role = await prisma.role.create({
    data: { name: `clone-role-${nanoid(6)}`, permissions: ['*'] },
  });
  roleId = role.id;

  const user = await prisma.user.create({
    data: {
      email: `clone-${nanoid(8)}@example.com`,
      username: `cloneuser${nanoid(4)}`,
      name: 'Clone Tester',
      emailVerified: true,
      roles: { connect: { id: roleId } },
    },
  });
  userId = user.id;
  adminAuth.userId = userId;

  const other = await prisma.user.create({
    data: {
      email: `clone-other-${nanoid(8)}@example.com`,
      username: `cloneother${nanoid(4)}`,
      name: 'Other User',
      emailVerified: true,
    },
  });
  otherUserId = other.id;

  const template = await prisma.serverTemplate.create({
    data: {
      name: `clone-template-${nanoid(6)}`,
      author: 'Test',
      version: '1.0.0',
      image: 'alpine:latest',
      startup: 'echo hello',
      stopCommand: 'stop',
      supportedPorts: [],
      variables: [{ name: 'SERVER_NAME', default: 'default' }],
      allocatedMemoryMb: 512,
      allocatedCpuCores: 1,
    },
  });
  templateId = template.id;

  // Route-level tests create several servers on these nodes, so give them
  // enough capacity that the shared fixtures never trip the memory blocker.
  nodeAId = (await createNode(locationAId, { maxMemoryMb: 1_000_000, maxCpuCores: 1024 })).id;
  nodeBId = (await createNode(locationBId, { maxMemoryMb: 1_000_000, maxCpuCores: 1024 })).id;
});

afterAll(async () => {
  await prisma.server.deleteMany({ where: { id: { in: createdServerIds } } }).catch(() => {});
  await prisma.ipPool.deleteMany({ where: { nodeId: { in: [nodeAId, nodeBId] } } }).catch(() => {});
  await prisma.nodeAllocation
    .deleteMany({ where: { nodeId: { in: [nodeAId, nodeBId] } } })
    .catch(() => {});
  await prisma.node.deleteMany({ where: { id: { in: [nodeAId, nodeBId] } } }).catch(() => {});
  await prisma.serverTemplate.delete({ where: { id: templateId } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } }).catch(() => {});
  await prisma.role.delete({ where: { id: roleId } }).catch(() => {});
  await prisma.location
    .deleteMany({ where: { id: { in: [locationAId, locationBId] } } })
    .catch(() => {});
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe('resolveCloneMode', () => {
  it('passes an explicit mode through', () => {
    expect(resolveCloneMode({ mode: 'full' })).toBe('full');
    expect(resolveCloneMode({ mode: 'configuration' })).toBe('configuration');
  });

  it('maps the legacy copyFiles boolean', () => {
    expect(resolveCloneMode({ copyFiles: true })).toBe('full');
    expect(resolveCloneMode({ copyFiles: false })).toBe('configuration');
    expect(resolveCloneMode({})).toBe('configuration');
  });
});

describe('buildClonePlan', () => {
  it('derives locationId from the target node, not the source', async () => {
    const source = await createServer(nodeAId);
    const loaded = await loadCloneSource(source.id);
    const plan = await buildClonePlan({
      source: loaded,
      raw: baseRequest({ targetNodeId: nodeBId }),
      auth: adminAuth,
    });

    expect(plan.crossNode).toBe(true);
    expect(plan.resolved.locationId).toBe(locationBId);
    expect(plan.changes.some((c) => c.field === 'location' && c.nodeSpecific)).toBe(true);
    expect(plan.changes.map((c) => c.field)).toEqual(
      expect.arrayContaining(['node', 'dataDir', 'sftp', 'primaryIp', 'primaryPort']),
    );
  });

  it('allows a configuration clone of a running source and flags that install runs', async () => {
    const source = await createServer(nodeAId, { status: 'running' });
    const loaded = await loadCloneSource(source.id);
    const plan = await buildClonePlan({
      source: loaded,
      raw: baseRequest(),
      auth: adminAuth,
    });

    expect(plan.blockers.some((b) => b.code === 'CLONE_SOURCE_NOT_STOPPED')).toBe(false);
    expect(plan.requirements.installWillRun).toBe(true);
    expect(plan.requirements.sourceStopped).toBe(false);
  });

  it('blocks a full clone of a running source', async () => {
    const source = await createServer(nodeAId, { status: 'running' });
    const loaded = await loadCloneSource(source.id);
    const plan = await buildClonePlan({
      source: loaded,
      raw: baseRequest({ mode: 'full' }),
      auth: adminAuth,
    });

    expect(plan.blockers.map((b) => b.code)).toContain('CLONE_SOURCE_NOT_STOPPED');
    expect(plan.requirements.sourceStopped).toBe(true);
  });

  it('assigns fresh host ports for a same-node bridge clone', async () => {
    const source = await createServer(nodeAId, {
      primaryPort: 31000,
      portBindings: { 31000: 31000 },
    });
    const loaded = await loadCloneSource(source.id);
    const plan = await buildClonePlan({ source: loaded, raw: baseRequest(), auth: adminAuth });

    expect(plan.crossNode).toBe(false);
    expect(plan.resolved.portBindings[31000]).not.toBe(31000);
  });

  it('blocks when the target node is offline', async () => {
    const source = await createServer(nodeAId);
    const offlineNode = await createNode(locationBId, { isOnline: false });
    try {
      const loaded = await loadCloneSource(source.id);
      const plan = await buildClonePlan({
        source: loaded,
        raw: baseRequest({ targetNodeId: offlineNode.id }),
        auth: adminAuth,
      });
      expect(plan.blockers.map((b) => b.code)).toContain('CLONE_TARGET_NODE_OFFLINE');
    } finally {
      await prisma.node.delete({ where: { id: offlineNode.id } }).catch(() => {});
    }
  });

  it('blocks when the target node lacks memory', async () => {
    const source = await createServer(nodeAId);
    const smallNode = await createNode(locationBId, { maxMemoryMb: 1024, memoryOverallocatePercent: 0 });
    try {
      const loaded = await loadCloneSource(source.id);
      const plan = await buildClonePlan({
        source: loaded,
        raw: baseRequest({ targetNodeId: smallNode.id, allocatedMemoryMb: 4096 }),
        auth: adminAuth,
      });
      expect(plan.blockers.map((b) => b.code)).toContain('INSUFFICIENT_RESOURCES');
    } finally {
      await prisma.node.delete({ where: { id: smallNode.id } }).catch(() => {});
    }
  });

  it('blocks an IPAM network mode the target node has no pool for', async () => {
    const source = await createServer(nodeAId);
    const loaded = await loadCloneSource(source.id);
    const plan = await buildClonePlan({
      source: loaded,
      raw: baseRequest({ targetNodeId: nodeBId, networkMode: 'macvlan' }),
      auth: adminAuth,
    });
    expect(plan.blockers.map((b) => b.code)).toContain('CLONE_NETWORK_MODE_UNSUPPORTED');
    expect(plan.target.supportedNetworkModes).not.toContain('macvlan');
  });

  it('warns about variables the template no longer declares', async () => {
    const source = await createServer(nodeAId, {
      environment: { SERVER_NAME: 'x', LEGACY_FLAG: '1' },
    });
    const loaded = await loadCloneSource(source.id);
    const plan = await buildClonePlan({ source: loaded, raw: baseRequest(), auth: adminAuth });
    expect(plan.warnings.map((w) => w.code)).toContain('CLONE_SOURCE_ENV_STALE');
  });

  it('blocks a suspended source unless the caller can manage suspensions', async () => {
    const source = await createServer(nodeAId, {
      suspendedAt: new Date(),
      suspensionReason: 'test',
    });
    const loaded = await loadCloneSource(source.id);

    const blocked = await buildClonePlan({ source: loaded, raw: baseRequest(), auth: adminAuth });
    expect(blocked.blockers.map((b) => b.code)).not.toContain('CLONE_SOURCE_SUSPENDED');

    const denied = await buildClonePlan({
      source: loaded,
      raw: baseRequest(),
      auth: { ...adminAuth, canManageSuspended: false },
    });
    expect(denied.blockers.map((b) => b.code)).toContain('CLONE_SOURCE_SUSPENDED');
  });

  it('blocks a cross-node clone without server.transfer', async () => {
    const source = await createServer(nodeAId);
    const loaded = await loadCloneSource(source.id);
    const plan = await buildClonePlan({
      source: loaded,
      raw: baseRequest({ targetNodeId: nodeBId }),
      auth: { ...adminAuth, canTransfer: false },
    });
    expect(plan.blockers.map((b) => b.code)).toContain('PERMISSION_DENIED');
  });
});

describe('host-network port conflicts', () => {
  it('shifts the port block when the target node already runs a host-network server', async () => {
    const source = await createServer(nodeAId, {
      networkMode: 'host',
      primaryPort: 25000,
      portBindings: { 25000: 25000 },
    });
    // An existing host-network server on the target node holds the same port.
    await createServer(nodeBId, {
      networkMode: 'host',
      primaryPort: 25000,
      portBindings: { 25000: 25000 },
    });

    const loaded = await loadCloneSource(source.id);
    const plan = await buildClonePlan({
      source: loaded,
      raw: baseRequest({ targetNodeId: nodeBId, networkMode: 'host' }),
      auth: adminAuth,
    });

    expect(plan.resolved.primaryPort).not.toBe(25000);
    expect(plan.resolved.primaryPort).toBeGreaterThan(25000);
    expect(plan.warnings.map((w) => w.code)).toContain('CLONE_HOST_PORTS_SHIFTED');
  });
});

describe('POST /:serverId/clone/preflight (disk probe)', () => {
  it('asks the source node for the data size and the target node for free space', async () => {
    const source = await createServer(nodeAId);
    const calls: string[] = [];
    const app = buildTestApp();
    (app as any).wsGateway.requestFromAgent = async (nodeId: string, message: any) => {
      calls.push(`${nodeId}:${message.type}`);
      // The source directory only exists on the source node; free space only on
      // the target node. Each node answers the half it can measure.
      return nodeId === nodeBId
        ? { success: true, targetFreeBytes: 1000 }
        : { success: true, sourceBytes: 500 };
    };
    await app.register(serverRoutes, { prefix: '/api/servers' });

    const res = await app.inject({
      method: 'POST',
      url: `/api/servers/${source.id}/clone/preflight`,
      payload: { mode: 'full', targetNodeId: nodeBId },
    });

    expect(res.statusCode).toBe(200);
    const plan = JSON.parse(res.body).data;
    expect(plan.source.dataSizeBytes).toBe(500);
    expect(plan.target.capacity.diskFreeBytes).toBe(1000);
    expect(calls).toContain(`${nodeAId}:clone_preflight`);
    expect(calls).toContain(`${nodeBId}:clone_preflight`);
    expect(plan.warnings.map((w: any) => w.code)).not.toContain('CLONE_SOURCE_SIZE_UNKNOWN');

    await app.close();
  });
});

describe('clone preflight store', () => {
  it('is single-use and scoped to the issuing user', async () => {
    const source = await createServer(nodeAId);
    const loaded = await loadCloneSource(source.id);
    const plan = await buildClonePlan({ source: loaded, raw: baseRequest(), auth: adminAuth });

    const stored = await storeClonePreflight(plan, userId);
    expect(stored.preflightId).toBeTruthy();
    expect(stored.fingerprint).toBe(cloneFingerprint(plan));

    // Wrong user cannot consume it.
    expect(await takeClonePreflight(stored.preflightId, otherUserId)).toBeNull();
    // The right user can, exactly once.
    const taken = await takeClonePreflight(stored.preflightId, userId);
    expect(taken?.fingerprint).toBe(stored.fingerprint);
    expect(await takeClonePreflight(stored.preflightId, userId)).toBeNull();
  });
});

describe('POST /:serverId/clone', () => {
  it('requires a preflight for a cross-node clone', async () => {
    const source = await createServer(nodeAId);
    const app = buildTestApp();
    await app.register(serverRoutes, { prefix: '/api/servers' });

    const response = await app.inject({
      method: 'POST',
      url: `/api/servers/${source.id}/clone`,
      payload: { name: 'cross clone', mode: 'configuration', nodeId: nodeBId },
    });

    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body).code).toBe('CLONE_PREFLIGHT_REQUIRED');
    await app.close();
  });

  it('creates a configuration clone, sets installing and queues the install', async () => {
    const source = await createServer(nodeAId);
    const sent: any[] = [];
    const app = buildTestApp();
    (app as any).wsGateway.sendToAgent = async (_nodeId: string, message: any) => {
      sent.push(message);
      return true;
    };
    await app.register(serverRoutes, { prefix: '/api/servers' });

    const preflight = await app.inject({
      method: 'POST',
      url: `/api/servers/${source.id}/clone/preflight`,
      payload: { mode: 'configuration', targetNodeId: nodeAId },
    });
    expect(preflight.statusCode).toBe(200);
    const plan = JSON.parse(preflight.body).data;
    expect(plan.requirements.installWillRun).toBe(true);

    const response = await app.inject({
      method: 'POST',
      url: `/api/servers/${source.id}/clone`,
      payload: {
        name: 'config clone',
        mode: 'configuration',
        nodeId: nodeAId,
        preflightId: plan.preflightId,
        fingerprint: plan.fingerprint,
        acknowledgedWarnings: plan.warnings.map((w: any) => w.code),
      },
    });

    expect(response.statusCode).toBe(201);
    const clone = JSON.parse(response.body).data;
    createdServerIds.push(clone.id);

    const stored = await prisma.server.findUniqueOrThrow({ where: { id: clone.id } });
    expect(stored.status).toBe('installing');
    expect(stored.description).toBe(source.description);
    expect(stored.templateId).toBe(templateId);
    expect(stored.nodeId).toBe(nodeAId);

    const install = sent.find((message) => message.type === 'install_server');
    expect(install).toBeTruthy();
    expect(install.serverId).toBe(clone.id);
    expect(install.environment.SERVER_DIR).toContain(stored.uuid);

    await app.close();
  });

  it('rejects an unacknowledged warning', async () => {
    const source = await createServer(nodeAId, { environment: { SERVER_NAME: 'x', LEGACY: '1' } });
    const app = buildTestApp();
    await app.register(serverRoutes, { prefix: '/api/servers' });

    const preflight = await app.inject({
      method: 'POST',
      url: `/api/servers/${source.id}/clone/preflight`,
      payload: { mode: 'configuration', targetNodeId: nodeAId },
    });
    const plan = JSON.parse(preflight.body).data;
    expect(plan.warnings.map((w: any) => w.code)).toContain('CLONE_SOURCE_ENV_STALE');

    const response = await app.inject({
      method: 'POST',
      url: `/api/servers/${source.id}/clone`,
      payload: {
        name: 'nope',
        mode: 'configuration',
        nodeId: nodeAId,
        preflightId: plan.preflightId,
        fingerprint: plan.fingerprint,
        acknowledgedWarnings: [],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).code).toBe('CLONE_WARNINGS_UNACKNOWLEDGED');
    await app.close();
  });

  it('rejects a stale preflight when the options changed', async () => {
    const source = await createServer(nodeAId);
    const app = buildTestApp();
    await app.register(serverRoutes, { prefix: '/api/servers' });

    const preflight = await app.inject({
      method: 'POST',
      url: `/api/servers/${source.id}/clone/preflight`,
      payload: { mode: 'configuration', targetNodeId: nodeAId, allocatedMemoryMb: 2048 },
    });
    const plan = JSON.parse(preflight.body).data;

    const response = await app.inject({
      method: 'POST',
      url: `/api/servers/${source.id}/clone`,
      payload: {
        name: 'stale',
        mode: 'configuration',
        nodeId: nodeAId,
        allocatedMemoryMb: 4096,
        preflightId: plan.preflightId,
        fingerprint: plan.fingerprint,
        acknowledgedWarnings: plan.warnings.map((w: any) => w.code),
      },
    });

    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body).code).toBe('CLONE_PREFLIGHT_STALE');
    await app.close();
  });

  it('accepts the cross-node submit payload the clone dialog actually sends', async () => {
    // The dialog builds ONE payload for both calls, so the submit body carries
    // `targetNodeId` (the preflight field) and no `nodeId`. Reading only
    // `nodeId` here silently fell back to the source node, which re-resolved
    // the plan against the wrong node and tripped CLONE_PREFLIGHT_STALE.
    const source = await createServer(nodeAId);
    const app = buildTestApp();
    await app.register(serverRoutes, { prefix: '/api/servers' });

    const preflight = await app.inject({
      method: 'POST',
      url: `/api/servers/${source.id}/clone/preflight`,
      payload: { mode: 'configuration', targetNodeId: nodeBId },
    });
    expect(preflight.statusCode).toBe(200);
    const plan = JSON.parse(preflight.body).data;
    expect(plan.resolved.nodeId).toBe(nodeBId);

    const response = await app.inject({
      method: 'POST',
      url: `/api/servers/${source.id}/clone`,
      payload: {
        name: 'cross clone from dialog',
        mode: 'configuration',
        targetNodeId: nodeBId,
        preflightId: plan.preflightId,
        fingerprint: plan.fingerprint,
        acknowledgedWarnings: plan.warnings.map((w: any) => w.code),
      },
    });

    expect(response.statusCode).toBe(201);
    const clone = JSON.parse(response.body).data;
    createdServerIds.push(clone.id);
    expect(clone.nodeId).toBe(nodeBId);
    await app.close();
  });

  it('does not create a second server for a repeated Idempotency-Key', async () => {
    const source = await createServer(nodeAId);
    const app = buildTestApp();
    await app.register(serverRoutes, { prefix: '/api/servers' });
    const idempotencyKey = `idem-${nanoid(10)}`;
    const payload = {
      name: `idem clone ${nanoid(4)}`,
      mode: 'configuration',
      nodeId: nodeAId,
      acknowledgedWarnings: ['CLONE_SOURCE_SIZE_UNKNOWN'],
    };

    const first = await app.inject({
      method: 'POST',
      url: `/api/servers/${source.id}/clone`,
      headers: { 'idempotency-key': idempotencyKey },
      payload,
    });
    expect(first.statusCode).toBe(201);
    const firstBody = JSON.parse(first.body);
    createdServerIds.push(firstBody.data.id);

    const second = await app.inject({
      method: 'POST',
      url: `/api/servers/${source.id}/clone`,
      headers: { 'idempotency-key': idempotencyKey },
      payload,
    });
    expect(second.statusCode).toBe(201);
    expect(JSON.parse(second.body).data.id).toBe(firstBody.data.id);

    await app.close();
  });
});

describe('POST /:serverId/clone/:cloneId/retry', () => {
  it('requires recorded provenance and re-runs the copy when present', async () => {
    const source = await createServer(nodeAId);
    const cloneServer = await createServer(nodeAId, { status: 'stopped' });
    const app = buildTestApp();
    await app.register(serverRoutes, { prefix: '/api/servers' });

    const missing = await app.inject({
      method: 'POST',
      url: `/api/servers/${source.id}/clone/${cloneServer.id}/retry`,
    });
    expect(missing.statusCode).toBe(404);

    await storeCloneProvenance(cloneServer.id, {
      sourceId: source.id,
      targetNodeId: nodeAId,
      mode: 'full',
    });

    const accepted = await app.inject({
      method: 'POST',
      url: `/api/servers/${source.id}/clone/${cloneServer.id}/retry`,
    });
    expect(accepted.statusCode).toBe(202);

    // The copy is fire-and-forget; let it settle.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const reloaded = await prisma.server.findUniqueOrThrow({ where: { id: cloneServer.id } });
    expect(reloaded.status).toBe('stopped');
    const logs = await prisma.serverLog.findMany({ where: { serverId: cloneServer.id } });
    expect(logs.some((log) => log.data.includes('Retrying the file copy'))).toBe(true);

    await app.close();
  });
});

describe('reconcileStuckOperations', () => {
  it('moves an abandoned cloning server back to stopped with a log', async () => {
    const server = await createServer(nodeAId, { status: 'cloning' });
    const longAgo = new Date(Date.now() - 60 * 60 * 1000);
    await prisma.$executeRawUnsafe(
      'UPDATE "Server" SET "updatedAt" = $1 WHERE "id" = $2',
      longAgo,
      server.id,
    );

    const logger: any = { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} };
    const count = await reconcileStuckOperations(prisma, logger);
    expect(count).toBeGreaterThanOrEqual(1);

    const reloaded = await prisma.server.findUniqueOrThrow({ where: { id: server.id } });
    expect(reloaded.status).toBe('stopped');

    const logs = await prisma.serverLog.findMany({ where: { serverId: server.id } });
    expect(logs.some((log) => log.data.includes('interrupted by a panel restart'))).toBe(true);
  });
});
