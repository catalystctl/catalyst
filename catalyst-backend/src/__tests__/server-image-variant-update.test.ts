/**
 * Regression for the admin "container image" switch failing with
 * "Invalid request body".
 *
 * The panel stores the whole environment map, and an imported egg's optional
 * variable (`"default_value": ""`) lands in it as an empty string — 160 of 167
 * upstream eggs have at least one. `PATCH /:serverId/variables` stores `""` the
 * same way when a user clears an optional variable. Because
 * `serverUpdateSchema.environment` required `min(1)` per value, the admin tab's
 * full-map round-trip (changing the image variant, saving the env editor) was
 * rejected before the route ever ran, and the only message the panel showed was
 * the generic "Invalid request body".
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { prisma } from '../db.js';
import { serverRoutes } from '../routes/servers.js';

const PERMISSIONS = [
  'server.create',
  'server.update',
  'server.startup',
  'server.read',
  'server.rebuild',
  'server.install',
];

describe('admin image variant change round-trips the stored environment', () => {
  let app: FastifyInstance;
  let userId: string;
  let roleId: string;
  let locationId: string;
  let nodeId: string;
  let templateId: string;
  let serverId: string;
  let primaryPort = 45000 + Math.floor(Math.random() * 10000);
  const testName = `image-variant-${nanoid(6)}`;

  beforeAll(async () => {
    const role = await prisma.role.create({
      data: { name: `${testName}-role`, permissions: PERMISSIONS },
    });
    roleId = role.id;
    const user = await prisma.user.create({
      data: {
        email: `${testName}@example.com`,
        username: `imgvar${nanoid(5)}`,
        name: 'Image variant tester',
        emailVerified: true,
        roles: { connect: { id: roleId } },
      },
    });
    userId = user.id;
    const location = await prisma.location.create({ data: { name: `${testName}-location` } });
    locationId = location.id;
    const node = await prisma.node.create({
      data: {
        name: `${testName}-node`,
        locationId,
        hostname: 'image-variant.example.com',
        publicAddress: '10.99.1.10',
        secret: `image-variant-${nanoid(16)}`,
        maxMemoryMb: 1_000_000,
        maxCpuCores: 1024,
        isOnline: true,
      },
    });
    nodeId = node.id;
    const template = await prisma.serverTemplate.create({
      data: {
        name: `${testName}-template`,
        author: 'Test',
        version: '1.0.0',
        image: 'eclipse-temurin:21-jre',
        images: [
          { name: 'java21', label: 'Java 21', image: 'eclipse-temurin:21-jre' },
          { name: 'java17', label: 'Java 17', image: 'eclipse-temurin:17-jre' },
        ],
        defaultImage: 'eclipse-temurin:21-jre',
        startup: 'echo template-startup',
        stopCommand: 'stop',
        supportedPorts: [],
        // SEED mirrors an imported egg's optional variable with an empty
        // default; MEMORY mirrors a legacy import that stored a scalar.
        variables: [
          { name: 'GAME_VERSION', default: 'stable', required: true, input: 'text', rules: ['required', 'string'] },
          { name: 'SEED', default: '', required: false, input: 'text', rules: [] },
          { name: 'MEMORY', default: '1024', required: false, input: 'number', rules: [] },
        ],
        allocatedMemoryMb: 512,
        allocatedCpuCores: 1,
      },
    });
    templateId = template.id;

    app = Fastify({ logger: false });
    app.decorate('authenticate', async (request: any) => {
      request.user = {
        userId,
        email: `${testName}@example.com`,
        username: 'image-variant',
        permissions: PERMISSIONS,
      };
    });
    app.decorate('wsGateway', {
      pushToAdminSubscribers: () => {},
      pushToGlobalSubscribers: () => {},
      routeToClients: async () => {},
      sendToAgent: async () => true,
      requestFromAgent: async () => ({ success: true }),
      relayBackupStream: async () => {},
      getDiscoveredContainers: () => [],
    } as any);
    app.decorate('webhookService', {
      serverCreated: async () => {},
      serverCloned: async () => {},
      serverDeleted: async () => {},
    });
    app.decorate('fileTunnel', { createTunnel: async () => ({ tunnelId: 'image-variant-test' }) });
    await app.register(serverRoutes, { prefix: '/api/servers' });

    const created = await app.inject({
      method: 'POST',
      url: '/api/servers',
      payload: {
        name: `${testName}-server`,
        templateId,
        nodeId,
        locationId,
        ownerId: userId,
        allocatedMemoryMb: 512,
        allocatedCpuCores: 1,
        allocatedDiskMb: 2048,
        primaryPort,
        networkMode: 'bridge',
        environment: { GAME_VERSION: 'stable' },
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    serverId = created.json().data.id;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (serverId) {
      await prisma.serverLog.deleteMany({ where: { serverId } }).catch(() => {});
      await prisma.auditLog.deleteMany({ where: { resourceId: serverId } }).catch(() => {});
      await prisma.serverAccess.deleteMany({ where: { serverId } }).catch(() => {});
      await prisma.server.deleteMany({ where: { id: serverId } }).catch(() => {});
    }
    if (nodeId) await prisma.server.deleteMany({ where: { nodeId } }).catch(() => {});
    if (templateId) await prisma.serverTemplate.delete({ where: { id: templateId } }).catch(() => {});
    if (nodeId) await prisma.node.delete({ where: { id: nodeId } }).catch(() => {});
    if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    if (roleId) await prisma.role.delete({ where: { id: roleId } }).catch(() => {});
    if (locationId) await prisma.location.delete({ where: { id: locationId } }).catch(() => {});
    primaryPort = 0;
  });

  it('stores the empty template default so the round-trip is realistic', async () => {
    const stored = await prisma.server.findUniqueOrThrow({ where: { id: serverId } });
    expect((stored.environment as Record<string, string>).SEED).toBe('');
  });

  it('accepts the full environment the admin tab sends when changing the image variant', async () => {
    const before = await prisma.server.findUniqueOrThrow({ where: { id: serverId } });
    // Exactly what ServerAdminTab.handleChangeImageVariant sends: the stored
    // map with the new variant, minus the stale resolved image.
    const nextEnv: Record<string, string> = {
      ...(before.environment as Record<string, string>),
      IMAGE_VARIANT: 'java17',
    };
    delete nextEnv.TEMPLATE_IMAGE;

    const response = await app.inject({
      method: 'PUT',
      url: `/api/servers/${serverId}`,
      payload: { environment: nextEnv },
    });
    expect(response.statusCode, response.body).toBe(200);

    const stored = await prisma.server.findUniqueOrThrow({ where: { id: serverId } });
    expect(stored.environment).toMatchObject({
      GAME_VERSION: 'stable',
      SEED: '',
      IMAGE_VARIANT: 'java17',
      // The route re-resolves the image from the variant.
      TEMPLATE_IMAGE: 'eclipse-temurin:17-jre',
    });
  });

  it('accepts an empty optional variable cleared through the variables route', async () => {
    const cleared = await app.inject({
      method: 'PATCH',
      url: `/api/servers/${serverId}/variables`,
      payload: { GAME_VERSION: 'stable', SEED: '' },
    });
    expect(cleared.statusCode, cleared.body).toBe(200);
    expect(cleared.json().data.SEED).toBe('');

    const stored = await prisma.server.findUniqueOrThrow({ where: { id: serverId } });
    const response = await app.inject({
      method: 'PUT',
      url: `/api/servers/${serverId}`,
      payload: { environment: stored.environment },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().data.environment.SEED).toBe('');
  });

  it('keeps the length bound reportable with a translatable code', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: `/api/servers/${serverId}`,
      payload: { environment: { GAME_VERSION: 'stable', SEED: 'x'.repeat(4097) } },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().details).toEqual([
      expect.objectContaining({
        field: 'environment.SEED',
        code: 'VALIDATION_TOO_LONG',
        params: { max: 4096 },
      }),
    ]);
  });

  it('coerces a legacy non-string environment value instead of rejecting the map', async () => {
    const stored = await prisma.server.findUniqueOrThrow({ where: { id: serverId } });
    const response = await app.inject({
      method: 'PUT',
      url: `/api/servers/${serverId}`,
      payload: {
        environment: { ...(stored.environment as Record<string, string>), MEMORY: 2048 },
      },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().data.environment.MEMORY).toBe('2048');
  });

  it('still rejects a payload that is not a string map', async () => {
    const stored = await prisma.server.findUniqueOrThrow({ where: { id: serverId } });
    const response = await app.inject({
      method: 'PUT',
      url: `/api/servers/${serverId}`,
      payload: {
        environment: { ...(stored.environment as Record<string, string>), GAME_VERSION: { nested: true } },
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('Invalid request body');
  });
});
