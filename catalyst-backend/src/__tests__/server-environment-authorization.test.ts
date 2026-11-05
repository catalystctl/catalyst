/**
 * Regression for installer process-environment authorization (a05940edd).
 *
 * Non-admin generic environment maps must not add undeclared keys such as
 * BASH_ENV/PATH/LD_PRELOAD: install and rebuild execute egg scripts as uid 0.
 * Exact template declarations and panel-owned image/network fields still work,
 * while trusted admin/import/migration flows retain their existing behavior.
 */
import 'dotenv/config';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { prisma } from '../db.js';
import { findDisallowedServerEnvironmentKeys } from '../lib/server-environment.js';
import { nodeRoutes } from '../routes/nodes.js';
import { serverRoutes } from '../routes/servers.js';

const ATTACK_ENVIRONMENT = {
  BASH_ENV: '/data/persisted-install-hook.sh',
  PATH: '/data/bin:/usr/bin:/bin',
  LD_PRELOAD: '/data/persisted-install-hook.so',
};
const ODD_VARIABLE = 'mixedCase.variable-name';
const USER_PERMISSIONS = [
  'server.create',
  'server.clone',
  'server.update',
  'server.startup',
  'server.install',
  'server.reinstall',
  'server.rebuild',
];

describe('server environment declaration allowlist', () => {
  it('uses exact template declarations plus the panel-owned compatibility fields', () => {
    const variables = [{ name: ODD_VARIABLE }, { name: 'GAME_VERSION' }, { notAName: 'PATH' }];
    expect(
      findDisallowedServerEnvironmentKeys(
        {
          [ODD_VARIABLE]: 'unusual declarations remain valid',
          GAME_VERSION: 'testing',
          IMAGE_VARIANT: 'main',
          TEMPLATE_IMAGE: 'alpine:3.20',
          CATALYST_NETWORK_IP: '10.99.0.20',
        },
        variables,
      ),
    ).toEqual([]);

    expect(
      findDisallowedServerEnvironmentKeys(
        { GAME_VERSION: 'stable', ...ATTACK_ENVIRONMENT },
        variables,
      ),
    ).toEqual(expect.arrayContaining(['BASH_ENV', 'PATH', 'LD_PRELOAD']));
  });
});

describe('non-admin server environment routes and installer payloads', () => {
  let app: FastifyInstance;
  let userId: string;
  let roleId: string;
  let locationId: string;
  let nodeId: string;
  let templateId: string;
  let serverId: string;
  let currentPermissions = USER_PERMISSIONS;
  let nextPort = 33000 + Math.floor(Math.random() * 10000);
  let discoveredContainers: any[] = [];
  const sentCommands: any[] = [];
  const createdServerIds: string[] = [];
  const testName = `env-auth-${nanoid(6)}`;

  const createPayload = (name: string, environment: Record<string, string>) => ({
    name,
    templateId,
    nodeId,
    locationId,
    allocatedMemoryMb: 512,
    allocatedCpuCores: 1,
    allocatedDiskMb: 2048,
    // Clone assignment probes sourcePort+1; leave space between fixtures.
    primaryPort: (nextPort += 100),
    networkMode: 'bridge',
    environment,
  });

  beforeAll(async () => {
    const role = await prisma.role.create({
      data: { name: `${testName}-role`, permissions: USER_PERMISSIONS },
    });
    roleId = role.id;
    const user = await prisma.user.create({
      data: {
        email: `${testName}@example.com`,
        username: `envauth${nanoid(5)}`,
        name: 'Environment authorization tester',
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
        hostname: 'env-auth.example.com',
        publicAddress: '10.99.0.10',
        secret: `env-auth-${nanoid(16)}`,
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
        image: 'alpine:latest',
        images: [{ name: 'main', label: 'Main', image: 'alpine:3.20' }],
        defaultImage: 'alpine:3.20',
        startup: 'echo template-startup',
        stopCommand: 'stop',
        supportedPorts: [],
        variables: [
          {
            name: 'GAME_VERSION',
            default: 'stable',
            required: true,
            input: 'text',
            rules: ['required', 'string', 'in:stable,testing'],
          },
          {
            name: ODD_VARIABLE,
            default: 'default-value',
            required: false,
            input: 'text',
            rules: [],
          },
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
        username: 'env-auth',
        permissions: currentPermissions,
      };
    });
    app.decorate('wsGateway', {
      pushToAdminSubscribers: () => {},
      pushToGlobalSubscribers: () => {},
      routeToClients: async () => {},
      sendToAgent: async (_nodeId: string, command: any) => {
        sentCommands.push(command);
        return true;
      },
      requestFromAgent: async () => ({ success: true }),
      relayBackupStream: async () => {},
      getDiscoveredContainers: () => discoveredContainers,
    } as any);
    app.decorate('webhookService', {
      serverCreated: async () => {},
      serverCloned: async () => {},
      serverDeleted: async () => {},
    });
    app.decorate('fileTunnel', { createTunnel: async () => ({ tunnelId: 'env-auth-test' }) });
    await app.register(serverRoutes, { prefix: '/api/servers' });
    await app.register(nodeRoutes, { prefix: '/api/nodes' });
  });

  afterEach(() => {
    currentPermissions = USER_PERMISSIONS;
  });

  afterAll(async () => {
    currentPermissions = USER_PERMISSIONS;
    if (app) await app.close();
    if (createdServerIds.length > 0) {
      await prisma.serverLog.deleteMany({ where: { serverId: { in: createdServerIds } } }).catch(() => {});
      await prisma.auditLog.deleteMany({ where: { resourceId: { in: createdServerIds } } }).catch(() => {});
      await prisma.serverAccess.deleteMany({ where: { serverId: { in: createdServerIds } } }).catch(() => {});
      await prisma.server.deleteMany({ where: { id: { in: createdServerIds } } }).catch(() => {});
    }
    // Also clean route-created rows if an assertion failed before tracking them.
    if (nodeId) await prisma.server.deleteMany({ where: { nodeId } }).catch(() => {});
    if (templateId) await prisma.serverTemplate.delete({ where: { id: templateId } }).catch(() => {});
    if (nodeId) await prisma.node.delete({ where: { id: nodeId } }).catch(() => {});
    if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    if (roleId) await prisma.role.delete({ where: { id: roleId } }).catch(() => {});
    if (locationId) await prisma.location.delete({ where: { id: locationId } }).catch(() => {});
  });

  it('rejects undeclared shell/loader keys on create without storing a server', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/servers',
      payload: createPayload(`${testName}-blocked-create`, {
        GAME_VERSION: 'stable',
        ...ATTACK_ENVIRONMENT,
      }),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('SERVER_VARIABLE_INVALID');
    expect(response.json().error).toContain('BASH_ENV');
    expect(response.json().error).toContain('PATH');
    expect(response.json().error).toContain('LD_PRELOAD');
    expect(response.json().params).toEqual({ name: 'BASH_ENV, PATH, LD_PRELOAD' });
    const localized = 'Invalid value for variable {{name}}'.replace(
      '{{name}}',
      response.json().params.name,
    );
    expect(localized).toBe('Invalid value for variable BASH_ENV, PATH, LD_PRELOAD');
    expect(localized).not.toContain('{{name}}');
    expect(await prisma.server.findFirst({ where: { name: `${testName}-blocked-create` } })).toBeNull();
  });

  it('creates declared values and panel-owned image/network fields, then rejects an undeclared update', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/servers',
      payload: createPayload(`${testName}-valid`, {
        GAME_VERSION: 'stable',
        [ODD_VARIABLE]: 'created-value',
        IMAGE_VARIANT: 'main',
      }),
    });
    expect(response.statusCode).toBe(201);
    const created = response.json().data;
    serverId = created.id;
    createdServerIds.push(serverId);
    expect(created.environment).toMatchObject({
      GAME_VERSION: 'stable',
      [ODD_VARIABLE]: 'created-value',
      IMAGE_VARIANT: 'main',
      TEMPLATE_IMAGE: 'alpine:3.20',
    });

    const before = await prisma.server.findUniqueOrThrow({ where: { id: serverId } });
    const rejected = await app.inject({
      method: 'PUT',
      url: `/api/servers/${serverId}`,
      payload: {
        environment: {
          GAME_VERSION: 'testing',
          [ODD_VARIABLE]: 'must-not-be-written',
          ...ATTACK_ENVIRONMENT,
        },
      },
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().code).toBe('SERVER_VARIABLE_INVALID');
    expect(rejected.json().params.name).toBe('BASH_ENV, PATH, LD_PRELOAD');
    expect(rejected.json().params.variables).toBeUndefined();
    expect((await prisma.server.findUniqueOrThrow({ where: { id: serverId } })).environment).toEqual(
      before.environment,
    );

    const accepted = await app.inject({
      method: 'PUT',
      url: `/api/servers/${serverId}`,
      payload: {
        startupCommand: './custom-start --channel {{GAME_VERSION}}',
        environment: {
          GAME_VERSION: 'testing',
          [ODD_VARIABLE]: 'updated-value',
          IMAGE_VARIANT: 'main',
          CATALYST_NETWORK_IP: '10.99.0.20',
        },
      },
    });
    expect(accepted.statusCode).toBe(200);
    const stored = await prisma.server.findUniqueOrThrow({ where: { id: serverId } });
    expect(stored.environment).toMatchObject({
      GAME_VERSION: 'testing',
      [ODD_VARIABLE]: 'updated-value',
      IMAGE_VARIANT: 'main',
      TEMPLATE_IMAGE: 'alpine:3.20',
      CATALYST_NETWORK_IP: '10.99.0.20',
    });

    const variables = await app.inject({
      method: 'PATCH',
      url: `/api/servers/${serverId}/variables`,
      payload: {
        GAME_VERSION: 'testing',
        [ODD_VARIABLE]: 'variable-route-value',
        BASH_ENV: '/data/not-a-template-variable.sh',
      },
    });
    expect(variables.statusCode).toBe(200);
    expect(variables.json().data[ODD_VARIABLE]).toBe('variable-route-value');
    expect(variables.json().data.BASH_ENV).toBeUndefined();
  });

  it('filters directly persisted hostile keys on non-admin install, reinstall and rebuild payloads', async () => {
    const customStartup = './custom-start --channel {{GAME_VERSION}}';
    const current = await prisma.server.findUniqueOrThrow({ where: { id: serverId } });
    // Deliberately bypass every HTTP validation layer. These rows represent
    // legacy data or direct database tampering discovered during review.
    await prisma.server.update({
      where: { id: serverId },
      data: {
        status: 'stopped',
        environment: {
          ...(current.environment as Record<string, string>),
          ...ATTACK_ENVIRONMENT,
          SERVER_DIR: '/data/hostile-server-dir',
          STARTUP: 'stored-startup-spoof',
          SERVER_PORT: '1',
          SERVER_MEMORY: '1',
          SERVER_UUID: 'stored-uuid-spoof',
          UUID: 'stored-uuid-spoof',
        },
      },
    });
    for (const [endpoint, type] of [
      ['install', 'install_server'],
      ['reinstall', 'reinstall_server'],
      ['rebuild', 'rebuild_server'],
    ] as const) {
      await prisma.server.update({ where: { id: serverId }, data: { status: 'stopped' } });
      sentCommands.length = 0;
      const response = await app.inject({
        method: 'POST',
        url: `/api/servers/${serverId}/${endpoint}`,
        payload: {},
      });
      expect(response.statusCode).toBe(202);
      const command = sentCommands.find((entry) => entry.type === type);
      expect(command).toBeTruthy();
      expect(command.environment).toMatchObject({
        GAME_VERSION: 'testing',
        [ODD_VARIABLE]: 'variable-route-value',
        TEMPLATE_IMAGE: 'alpine:3.20',
        CATALYST_NETWORK_IP: '10.99.0.20',
        STARTUP: customStartup,
        SERVER_MEMORY: '512',
      });
      expect(command.environment.SERVER_DIR).toContain(`/`);
      const stored = await prisma.server.findUniqueOrThrow({ where: { id: serverId } });
      expect(command.environment.SERVER_DIR).toContain(`/var/lib/catalyst/servers/`);
      expect(command.environment.SERVER_DIR).toContain(stored.uuid);
      expect(command.environment.SERVER_PORT).toBe(String(stored.primaryPort));
      expect(command.environment.SERVER_UUID).toBe(stored.uuid);
      expect(command.environment.UUID).toBe(stored.uuid);
      expect(command.networkMode).toBe(stored.networkMode);
      expect(command.template.startup).toBe(customStartup);
      expect(stored.environment).toMatchObject(ATTACK_ENVIRONMENT);
      for (const key of Object.keys(ATTACK_ENVIRONMENT)) {
        expect(command.environment[key], `${type} must not forward ${key}`).toBeUndefined();
      }
    }
  });

  for (const endpoint of ['install', 'reinstall'] as const) {
    it(`gives one deferred concurrent ${endpoint} request a 202 and the loser a 409 before send`, async () => {
      await prisma.server.update({ where: { id: serverId }, data: { status: 'stopped' } });
      sentCommands.length = 0;
      const originalUpdateMany = prisma.server.updateMany.bind(prisma.server);
      let claims = 0;
      let releaseClaims!: () => void;
      const bothClaims = new Promise<void>((resolve) => { releaseClaims = resolve; });
      const updateManySpy = vi.spyOn(prisma.server, 'updateMany');
      updateManySpy.mockImplementation((async (args: any) => {
        if (
          args?.where?.id === serverId &&
          args?.where?.updatedAt instanceof Date &&
          args?.data?.status === 'installing'
        ) {
          claims += 1;
          if (claims === 2) releaseClaims();
          // Both route reads happen before either real guarded write executes.
          await bothClaims;
        }
        return originalUpdateMany(args);
      }) as any);

      try {
        const responses = await Promise.all([
          app.inject({ method: 'POST', url: `/api/servers/${serverId}/${endpoint}`, payload: {} }),
          app.inject({ method: 'POST', url: `/api/servers/${serverId}/${endpoint}`, payload: {} }),
        ]);
        expect(responses.map((response) => response.statusCode).sort()).toEqual([202, 409]);
        const loser = responses.find((response) => response.statusCode === 409)!;
        expect(loser.json().code).toBe('SERVER_STATE_TRANSITION_INVALID');
      } finally {
        releaseClaims();
        updateManySpy.mockRestore();
      }
      expect(claims).toBe(2);
      expect(
        sentCommands.filter(
          (entry) =>
            entry.serverId === serverId &&
            entry.type === `${endpoint}_server`,
        ),
      ).toHaveLength(1);
    });
  }

  it('blocks undeclared clone overrides and installs a legitimate configuration clone', async () => {
    await prisma.server.update({ where: { id: serverId }, data: { status: 'stopped' } });
    const review = await app.inject({
      method: 'POST',
      url: `/api/servers/${serverId}/clone/preflight`,
      payload: {
        mode: 'configuration',
        targetNodeId: nodeId,
        environment: { GAME_VERSION: 'stable', ...ATTACK_ENVIRONMENT },
      },
    });
    expect(review.statusCode).toBe(200);
    const reviewCause = review.json().data.blockers.find(
      (blocker: any) => blocker.code === 'SERVER_VARIABLE_INVALID',
    );
    expect(reviewCause.params).toEqual({ name: 'BASH_ENV, PATH, LD_PRELOAD' });
    expect(
      'Invalid value for variable {{name}}'.replace('{{name}}', reviewCause.params.name),
    ).not.toContain('{{name}}');

    const countBefore = await prisma.server.count({ where: { templateId } });
    const blocked = await app.inject({
      method: 'POST',
      url: `/api/servers/${serverId}/clone`,
      payload: {
        name: `${testName}-blocked-clone`,
        mode: 'configuration',
        nodeId,
        environment: { GAME_VERSION: 'stable', ...ATTACK_ENVIRONMENT },
      },
    });
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json().code).toBe('SERVER_VARIABLE_INVALID');
    expect(blocked.json().params).toMatchObject({ name: 'BASH_ENV, PATH, LD_PRELOAD' });
    const renderedCause = 'Invalid value for variable {{name}}'.replace(
      '{{name}}',
      blocked.json().params.name,
    );
    expect(renderedCause).toBe('Invalid value for variable BASH_ENV, PATH, LD_PRELOAD');
    expect(renderedCause).not.toContain('{{name}}');
    expect(await prisma.server.count({ where: { templateId } })).toBe(countBefore);

    sentCommands.length = 0;
    const accepted = await app.inject({
      method: 'POST',
      url: `/api/servers/${serverId}/clone`,
      payload: {
        name: `${testName}-valid-clone`,
        mode: 'configuration',
        nodeId,
        environment: {
          GAME_VERSION: 'stable',
          [ODD_VARIABLE]: 'clone-value',
          IMAGE_VARIANT: 'main',
        },
      },
    });
    expect(accepted.statusCode).toBe(201);
    const clone = accepted.json().data;
    createdServerIds.push(clone.id);
    const stored = await prisma.server.findUniqueOrThrow({ where: { id: clone.id } });
    expect(stored.environment).toMatchObject({
      GAME_VERSION: 'stable',
      [ODD_VARIABLE]: 'clone-value',
      TEMPLATE_IMAGE: 'alpine:3.20',
    });
    const install = sentCommands.find(
      (entry) => entry.type === 'install_server' && entry.serverId === clone.id,
    );
    expect(install).toBeTruthy();
    expect(install.environment[ODD_VARIABLE]).toBe('clone-value');
    // Clones preserve their historical template startup (not the source's
    // per-server override); the payload still receives the generated builtin.
    expect(install.environment.STARTUP).toBe('echo template-startup');
    expect(install.environment.SERVER_DIR).toContain(stored.uuid);
    for (const key of Object.keys(ATTACK_ENVIRONMENT)) {
      expect((stored.environment as Record<string, unknown>)[key]).toBeUndefined();
      expect(install.environment[key]).toBeUndefined();
    }
    expect(install.networkMode).toBe(stored.networkMode);
  });

  it('preserves trusted admin generic-map behavior', async () => {
    currentPermissions = ['admin.write'];
    const name = `${testName}-admin`;
    const response = await app.inject({
      method: 'POST',
      url: '/api/servers',
      payload: createPayload(name, { GAME_VERSION: 'stable', ...ATTACK_ENVIRONMENT }),
    });
    expect(response.statusCode, response.body).toBe(201);
    const adminServerId = response.json().data.id;
    createdServerIds.push(adminServerId);
    expect(response.json().data.environment).toMatchObject(ATTACK_ENVIRONMENT);

    const update = await app.inject({
      method: 'PUT',
      url: `/api/servers/${adminServerId}`,
      payload: { environment: { GAME_VERSION: 'testing', ...ATTACK_ENVIRONMENT } },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json().data.environment).toMatchObject(ATTACK_ENVIRONMENT);

    await prisma.server.update({ where: { id: adminServerId }, data: { status: 'stopped' } });
    sentCommands.length = 0;
    const install = await app.inject({
      method: 'POST',
      url: `/api/servers/${adminServerId}/install`,
      payload: {},
    });
    expect(install.statusCode).toBe(202);
    const command = sentCommands.find(
      (entry) => entry.type === 'install_server' && entry.serverId === adminServerId,
    );
    expect(command).toBeTruthy();
    // The bypass is explicit and limited to the admin actor context.
    expect(command.environment).toMatchObject(ATTACK_ENVIRONMENT);
    currentPermissions = USER_PERMISSIONS;
  });

  it('applies the same rule to non-admin container import and preserves admin import', async () => {
    const blockedContainerId = `env-import-${nanoid(10)}`;
    discoveredContainers = [
      {
        containerId: blockedContainerId,
        status: 'Exited',
        networkMode: 'bridge',
        memoryLimitMb: 512,
        cpuCores: 1,
      },
    ];
    const blocked = await app.inject({
      method: 'POST',
      url: `/api/nodes/${nodeId}/import-server`,
      payload: {
        containerId: blockedContainerId,
        name: `${testName}-blocked-import`,
        templateId,
        ownerId: userId,
        environment: { GAME_VERSION: 'stable', ...ATTACK_ENVIRONMENT },
      },
    });
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json().code).toBe('SERVER_VARIABLE_INVALID');
    expect(blocked.json().params).toEqual({ name: 'BASH_ENV, PATH, LD_PRELOAD' });
    expect(await prisma.server.findUnique({ where: { id: blockedContainerId } })).toBeNull();

    currentPermissions = ['admin.write'];
    const adminContainerId = `env-import-${nanoid(10)}`;
    discoveredContainers = [
      {
        containerId: adminContainerId,
        status: 'Exited',
        networkMode: 'bridge',
        memoryLimitMb: 512,
        cpuCores: 1,
      },
    ];
    const accepted = await app.inject({
      method: 'POST',
      url: `/api/nodes/${nodeId}/import-server`,
      payload: {
        containerId: adminContainerId,
        name: `${testName}-admin-import`,
        templateId,
        ownerId: userId,
        environment: { GAME_VERSION: 'stable', ...ATTACK_ENVIRONMENT },
      },
    });
    expect(accepted.statusCode).toBe(201);
    createdServerIds.push(adminContainerId);
    expect(accepted.json().data.environment).toMatchObject(ATTACK_ENVIRONMENT);
    currentPermissions = USER_PERMISSIONS;
  });
});
