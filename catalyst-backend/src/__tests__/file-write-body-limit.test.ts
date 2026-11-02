/**
 * Regression: saving a config file through the Configuration tab failed with
 * `413 {"code":"FST_ERR_CTP_BODY_TOO_LARGE","message":"Request body is too
 * large"}` for any file at or above 10MiB.
 *
 * `POST /api/servers/:id/files/write` carries the file body as JSON, so it
 * inherited Fastify's global 10MB `bodyLimit` (src/server.ts). That global cap
 * protects the request envelope; it is not the panel's file-size policy. The
 * panel exposes `fileTunnelMaxUploadMb` (default 500MB) for that, and the
 * streaming upload route already honoured it — so a 12MB file could be
 * uploaded through the file manager but not saved through the editor, which is
 * the inconsistency these tests pin down.
 *
 * The route now (a) raises its own `bodyLimit` to the same ceiling the upload
 * route uses, (b) refuses a body larger than the configured gate in
 * `preParsing` (before it is buffered), and (c) keeps a handler-side byte check
 * for chunked requests that declare no Content-Length.
 */
import 'dotenv/config';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { randomUUID } from 'node:crypto';

import { prisma } from '../db.js';
import { serverRoutes } from '../routes/servers.js';
import { invalidateConfig } from '../lib/config-cache.js';
import { SECURITY_SETTING_ID } from '../services/mailer.js';

const MiB = 1024 * 1024;

let userId: string;
let nodeId: string;
let templateId: string;
let locationId: string;
let serverId: string;
// The file routes derive the path sandbox from the server UUID and validate it
// as a 36-char UUID (lib/path-validation.ts:validateServerId).
const serverUuid = randomUUID();

/** Records every tunnel call so a test can prove the write reached the agent. */
let tunnelCalls: Array<{ op: string; data?: Record<string, unknown> }> = [];

let app: FastifyInstance;

/** The operator's gate before the suite ran, restored in afterAll. */
let originalMaxUploadMb: number | null = null;

function buildApp(): FastifyInstance {
  const instance = Fastify({ logger: false });

  // Mirror production auth: the persona is the admin that owns the server.
  instance.decorate('authenticate', async (request: any) => {
    request.user = {
      userId,
      email: 'file-write-limit@example.com',
      username: 'file-write-limit',
      permissions: ['*'],
    };
  });

  instance.decorate('wsGateway', {
    pushToAdminSubscribers: () => {},
    pushToGlobalSubscribers: () => {},
    routeToClients: async () => {},
  } as any);

  // The file routes talk to the node through the tunnel; stub it so the test
  // asserts the request shape instead of needing a live agent.
  instance.decorate('fileTunnel', {
    isNodeConnected: () => true,
    createStagingPath: () => '/tmp/file-write-limit-staging',
    queueRequest: async (
      _nodeId: string,
      operation: string,
      _serverUuid: string,
      _path: string,
      data?: Record<string, unknown>,
    ) => {
      tunnelCalls.push({ op: operation, data });
      return { success: true };
    },
  } as any);

  instance.register(serverRoutes, { prefix: '/api/servers' });
  return instance;
}

/** Persist the panel max-upload gate and drop the settings cache. */
async function setMaxUploadMb(maxUploadMb: number): Promise<void> {
  await prisma.systemSetting.update({
    where: { id: SECURITY_SETTING_ID },
    data: { fileTunnelMaxUploadMb: maxUploadMb },
  });
  await invalidateConfig('security');
}

async function postWrite(instance: FastifyInstance, content: string, headers?: Record<string, string>) {
  return instance.inject({
    method: 'POST',
    url: `/api/servers/${serverId}/files/write`,
    headers: { 'content-type': 'application/json', ...headers },
    payload: JSON.stringify({ path: '/server.properties', content }),
  });
}

beforeAll(async () => {
  // Remember the operator's configured gate so the suite restores it exactly.
  const current = await prisma.systemSetting.findUnique({
    where: { id: SECURITY_SETTING_ID },
    select: { fileTunnelMaxUploadMb: true },
  });
  originalMaxUploadMb = current?.fileTunnelMaxUploadMb ?? null;

  const role = await prisma.role.create({
    data: { name: `test-file-write-limit-${nanoid(8)}`, permissions: ['*'] },
  });
  const user = await prisma.user.create({
    data: {
      email: `file-write-limit-${nanoid(8)}@example.com`,
      username: `fwl${nanoid(6)}`,
      name: 'file write limit',
      emailVerified: true,
      roles: { connect: { id: role.id } },
    },
  });
  userId = user.id;

  const location = await prisma.location.create({
    data: { name: `test-fwl-loc-${nanoid(6)}` },
  });
  locationId = location.id;

  const node = await prisma.node.create({
    data: {
      name: `test-fwl-node-${nanoid(6)}`,
      hostname: '127.0.0.1',
      publicAddress: '127.0.0.1',
      secret: `secret-${nanoid(16)}`,
      locationId: location.id,
      isOnline: true,
      maxMemoryMb: 8192,
      maxCpuCores: 4,
    },
  });
  nodeId = node.id;

  const template = await prisma.serverTemplate.create({
    data: {
      name: `test-fwl-template-${nanoid(6)}`,
      description: 'regression fixture',
      author: 'test',
      version: '1.0.0',
      startup: 'java -jar server.jar',
      stopCommand: 'stop',
      image: 'eclipse-temurin:21',
      variables: [],
      supportedPorts: [25565],
      allocatedMemoryMb: 1024,
      allocatedCpuCores: 1,
      features: {},
    },
  });
  templateId = template.id;

  const server = await prisma.server.create({
    data: {
      name: `test-fwl-server-${nanoid(6)}`,
      uuid: serverUuid,
      ownerId: user.id,
      nodeId: node.id,
      templateId: template.id,
      locationId: location.id,
      status: 'stopped',
      environment: {},
      allocatedMemoryMb: 1024,
      allocatedCpuCores: 1,
      allocatedDiskMb: 1024,
      primaryPort: 25565,
    },
  });
  serverId = server.id;

  app = buildApp();
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  // Leave the panel exactly as we found it: this suite mutates the persisted
  // max-upload gate, and a stale low value would break every later file write.
  if (originalMaxUploadMb !== null) {
    await setMaxUploadMb(originalMaxUploadMb);
  }
  // Guard every id: a failed beforeAll leaves these undefined, and
  // `deleteMany({ where: { id: undefined } })` means "no filter" — which would
  // wipe the whole table. Only delete fixtures we actually created.
  const ids = { serverId, templateId, nodeId, locationId, userId };
  if (ids.serverId) await prisma.server.deleteMany({ where: { id: ids.serverId } });
  if (ids.templateId) await prisma.serverTemplate.deleteMany({ where: { id: ids.templateId } });
  if (ids.nodeId) await prisma.node.deleteMany({ where: { id: ids.nodeId } });
  if (ids.locationId) await prisma.location.deleteMany({ where: { id: ids.locationId } });
  if (ids.userId) await prisma.user.deleteMany({ where: { id: ids.userId } });
  await prisma.role.deleteMany({ where: { name: { startsWith: 'test-file-write-limit-' } } });
});

beforeEach(async () => {
  tunnelCalls = [];
  // Restore the shipped default for every case.
  await setMaxUploadMb(500);
});

describe('files/write body limit', () => {
  it('accepts a file larger than the 10MB global request-envelope cap', async () => {
    // 12MiB is over Fastify's default bodyLimit; before the fix this was the
    // exact request that produced FST_ERR_CTP_BODY_TOO_LARGE.
    const content = `motd=${'a'.repeat(12 * MiB)}`;
    const res = await postWrite(app, content);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ success: true });
    expect(tunnelCalls).toHaveLength(1);
    expect(tunnelCalls[0].op).toBe('write');
    expect(tunnelCalls[0].data?.content).toHaveLength(content.length);
  });

  it('still accepts a normal small file', async () => {
    const content = 'motd=A Minecraft Server\nserver-port=25565';
    const res = await postWrite(app, content);

    expect(res.statusCode).toBe(200);
    expect(tunnelCalls[0].data?.content).toBe(content);
  });

  it('rejects a body over the configured max-upload gate with a translatable 413', async () => {
    await setMaxUploadMb(1);
    const content = `motd=${'a'.repeat(2 * MiB)}`;
    const res = await postWrite(app, content);

    expect(res.statusCode).toBe(413);
    // The panel's own gate, not Fastify's opaque envelope error.
    expect(res.json()).toMatchObject({ code: 'FILE_TOO_LARGE', params: { maxMb: 1 } });
    expect(res.json().code).not.toBe('FST_ERR_CTP_BODY_TOO_LARGE');
    // Nothing was sent to the node.
    expect(tunnelCalls).toHaveLength(0);
  });

  it('accepts a body under a lowered gate', async () => {
    await setMaxUploadMb(1);
    const content = `motd=${'a'.repeat(256 * 1024)}`;
    const res = await postWrite(app, content);

    expect(res.statusCode).toBe(200);
  });

  it('enforces the gate for chunked bodies that declare no Content-Length', async () => {
    await setMaxUploadMb(1);
    const content = `motd=${'a'.repeat(2 * MiB)}`;

    // A real chunked request: no content-length, transferred in pieces, so the
    // preParsing header check cannot fire and the handler backstop must.
    const body = Buffer.from(JSON.stringify({ path: '/server.properties', content }));
    const chunks: Buffer[] = [];
    for (let offset = 0; offset < body.length; offset += 64 * 1024) {
      chunks.push(body.subarray(offset, offset + 64 * 1024));
    }

    const address = new URL(await app.listen({ port: 0, host: '127.0.0.1' }));
    const res = await fetch(`http://${address.host}/api/servers/${serverId}/files/write`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk);
          controller.close();
        },
      }),
      // Node requires this to stream a request body.
      duplex: 'half',
    } as { duplex: 'half' });

    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ code: 'FILE_TOO_LARGE', params: { maxMb: 1 } });
    expect(tunnelCalls).toHaveLength(0);
  });
});
