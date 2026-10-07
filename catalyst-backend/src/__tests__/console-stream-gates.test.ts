/**
 * Console stream/command route gates (REALTIME_AUDIT fixes 1, 5, 6):
 *
 * - POST /console/command is a WRITE channel: admin.read must not authorize
 *   command input (parity with the WS console_input gate) — admin.write
 *   required. Key regression for the B-WRITE-LEAK finding.
 * - API-key scope ceiling: the key itself must hold console.read (GET) /
 *   console.write (POST); the owner's grants never widen a key.
 * - node_manage pairing accepts node.server_manage (new vocabulary) and the
 *   legacy node.update split value; bare node assignment stays denied.
 *
 * P-A harness: authenticate decorated to inject request.user; prisma is
 * module-mocked so no DB is needed. GET allow-side is not exercised here —
 * it hijacks the reply; its key-scope deny side returns plain JSON 403.
 */
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { consoleStreamRoutes } from '../routes/console-stream.js';

// vi.mock hoists above the const declarations, so the stubs must read state
// captured through vi.hoisted.
const state = vi.hoisted(() => ({
  accessRows: [] as Array<{ userId: string; permissions: string[] }>,
  rolesByUser: new Map<string, string[][]>(),
  nodeAssignmentUsers: new Set<string>(),
}));

vi.mock('../db.js', () => ({
  prisma: {
    server: {
      findUnique: async ({ where, include }: any) => {
        void include;
        if (where?.id !== 'srv1') return null;
        return {
          id: 'srv1',
          uuid: 'uuid-1',
          nodeId: 'node1',
          ownerId: 'owner1',
          suspendedAt: null,
          access: state.accessRows,
          node: { id: 'node1', nodeAssignments: [] },
        };
      },
    },
    serverAccess: { findUnique: async () => null },
    nodeAssignment: {
      findFirst: async ({ where }: any) => {
        if (
          where?.nodeId === 'node1' &&
          where?.userId &&
          state.nodeAssignmentUsers.has(where.userId)
        ) {
          return { id: 'na1', nodeId: 'node1', userId: where.userId, expiresAt: null };
        }
        return null;
      },
      findMany: async () => [],
    },
    role: {
      findMany: async ({ where }: any) => {
        const uid = where?.users?.some?.id as string | undefined;
        const roles = uid ? (state.rolesByUser.get(uid) ?? []) : [];
        return roles.map((permissions, i) => ({ id: `role-${i}`, permissions }));
      },
    },
    roleServerGrant: { findMany: async () => [] },
    roleNodeGrant: { findMany: async () => [] },
    systemError: { create: async () => ({}) },
  },
}));

// The route resolves server-scoped role permissions through the module-level
// prisma of permissions-catalog (its own dynamic import at request time), so
// mocking db.js alone cannot reach it when another suite already loaded the
// catalog (vitest runs with isolate:false and a shared module cache). Mock
// the resolver itself, spreading the real module for everything else.
vi.mock('../lib/permissions-catalog.js', async (importOriginal: () => Promise<object>) => ({
  ...(await importOriginal()),
  resolveServerPermissions: async (userId: string) =>
    state.rolesByUser.get(userId)?.flat() ?? [],
}));

function buildApp(actor: Record<string, unknown>) {
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async (request: any) => {
    request.user = { ...actor };
  });
  const commands: any[] = [];
  const wsGateway = {
    getSseSubscriberCount: () => 0,
    addSseSubscriber: () => ({ unsubscribe: () => {}, touch: () => {} }),
    sendConsoleCommand: async (serverId: string, userId: string, command: string, actorArg: any) => {
      commands.push({ serverId, userId, command, actor: actorArg });
    },
  };
  app.register((app: any) => consoleStreamRoutes(app, wsGateway as any), {
    prefix: '/api/servers',
  });
  return { app, commands };
}

describe('POST /api/servers/:serverId/console/command gates', () => {
  it('denies command input to an admin.read-only user (write channel)', async () => {
    state.rolesByUser.set('u-ar', [['admin.read']]);
    const { app, commands } = buildApp({ userId: 'u-ar', permissions: ['admin.read'] });

    const res = await app.inject({
      method: 'POST',
      url: '/api/servers/srv1/console/command',
      payload: { command: 'say hi' },
    });

    expect(res.statusCode).toBe(403);
    expect(commands.length).toBe(0);
    await app.close();
  });

  it('accepts an admin.write user and forwards the command', async () => {
    state.rolesByUser.set('u-aw', [['admin.write']]);
    const { app, commands } = buildApp({ userId: 'u-aw', permissions: ['admin.write'] });

    const res = await app.inject({
      method: 'POST',
      url: '/api/servers/srv1/console/command',
      payload: { command: 'say hi' },
    });

    expect(res.statusCode).toBe(202);
    expect(commands.length).toBe(1);
    expect(commands[0].command).toBe('say hi\n');
    await app.close();
  });

  it('denies an API key without console.write even though its owner may write', async () => {
    // owner1 owns the fixture server (owner branch passes), but the key
    // only carries console.read.
    const { app, commands } = buildApp({
      userId: 'owner1',
      permissions: ['console.read'],
      apiKeyId: 'k1',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/servers/srv1/console/command',
      payload: { command: 'say hi' },
    });

    expect(res.statusCode).toBe(403);
    expect(commands.length).toBe(0);
    await app.close();
  });

  it('accepts an owner-authenticated key holding console.write and threads the actor', async () => {
    const { app, commands } = buildApp({
      userId: 'owner1',
      permissions: ['console.write'],
      apiKeyId: 'k2',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/servers/srv1/console/command',
      payload: { command: 'say hi' },
    });

    expect(res.statusCode).toBe(202);
    expect(commands.length).toBe(1);
    expect(commands[0].actor).toMatchObject({ apiKeyId: 'k2', permissions: ['console.write'] });
    await app.close();
  });

  it('allows a node manager via node assignment + node.server_manage (new vocabulary)', async () => {
    state.nodeAssignmentUsers.add('u-nm');
    state.rolesByUser.set('u-nm', [['node.server_manage']]);
    const { app, commands } = buildApp({ userId: 'u-nm', permissions: [] });

    const res = await app.inject({
      method: 'POST',
      url: '/api/servers/srv1/console/command',
      payload: { command: 'say hi' },
    });

    expect(res.statusCode).toBe(202);
    expect(commands.length).toBe(1);
    await app.close();
  });

  it('still allows the legacy node.update split value', async () => {
    state.nodeAssignmentUsers.add('u-legacy');
    state.rolesByUser.set('u-legacy', [['node.update']]);
    const { app, commands } = buildApp({ userId: 'u-legacy', permissions: [] });

    const res = await app.inject({
      method: 'POST',
      url: '/api/servers/srv1/console/command',
      payload: { command: 'say hi' },
    });

    expect(res.statusCode).toBe(202);
    expect(commands.length).toBe(1);
    await app.close();
  });

  it('denies a bare node assignment (no node.server_manage / node.update)', async () => {
    state.nodeAssignmentUsers.add('u-bare');
    state.rolesByUser.set('u-bare', []);
    const { app, commands } = buildApp({ userId: 'u-bare', permissions: [] });

    const res = await app.inject({
      method: 'POST',
      url: '/api/servers/srv1/console/command',
      payload: { command: 'say hi' },
    });

    expect(res.statusCode).toBe(403);
    expect(commands.length).toBe(0);
    await app.close();
  });
});

describe('GET /api/servers/:serverId/console/stream key scope (deny side)', () => {
  it('denies an API key without console.read even for the owner', async () => {
    // Owner passes the user-level gate; the key-scope ceiling must still
    // reject before the stream is hijacked (plain JSON 403).
    const { app } = buildApp({
      userId: 'owner1',
      permissions: ['server.read'],
      apiKeyId: 'k3',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/servers/srv1/console/stream',
    });

    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
