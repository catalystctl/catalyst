import { describe, it, expect, vi, afterEach } from 'vitest';
import Fastify from 'fastify';
import {
  PluginRouteTable,
  registerPluginRouteDispatcher,
  routeAuthMode,
} from '../route-table';

describe('routeAuthMode', () => {
  it('defaults to required and recognizes public/optional', () => {
    expect(routeAuthMode({ method: 'GET', url: '/x', handler: async () => {} })).toBe('required');
    expect(
      routeAuthMode({ method: 'GET', url: '/x', handler: async () => {}, config: { auth: 'public' } }),
    ).toBe('public');
    expect(
      routeAuthMode({ method: 'GET', url: '/x', handler: async () => {}, config: { auth: 'optional' } }),
    ).toBe('optional');
    expect(
      routeAuthMode({ method: 'GET', url: '/x', handler: async () => {}, config: { auth: 'weird' } }),
    ).toBe('required');
  });
});

describe('registerPluginRouteDispatcher auth modes', () => {
  const authenticate = vi.fn(async (_req: any, reply: any) => {
    if (!_req.headers.authorization) {
      reply.status(401).send({ error: 'Unauthorized' });
    } else {
      _req.user = { userId: 'u_1', permissions: [] };
    }
  });
  const resolveUser = vi.fn(async (req: any) =>
    req.headers.authorization ? { userId: 'u_opt', email: 'e@x', username: 'opt', permissions: [] } : null,
  );

  afterEach(() => {
    authenticate.mockClear();
    resolveUser.mockClear();
  });

  async function build(grants: string[]) {
    const app = Fastify({ logger: false });
    const table = new PluginRouteTable();
    registerPluginRouteDispatcher(app, table, {
      authenticate,
      resolveUser,
      permissionsProvider: () => grants,
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    return { app, table };
  }

  it('required routes 401 unauthenticated calls (legacy behaviour)', async () => {
    const { app, table } = await build(['routes.public']);
    table.register('p1', {
      method: 'GET',
      url: '/api/plugins/p1/secure',
      handler: async () => ({ ok: true }),
      config: { auth: 'required' },
    });
    const denied = await app.inject({ method: 'GET', url: '/api/plugins/p1/secure' });
    expect(denied.statusCode).toBe(401);
    const allowed = await app.inject({
      method: 'GET',
      url: '/api/plugins/p1/secure',
      headers: { authorization: 'Bearer x' },
    });
    expect(allowed.statusCode).toBe(200);
    await app.close();
  });

  it('public routes skip authentication when the grant is live', async () => {
    const { app, table } = await build(['routes.public']);
    table.register('p1', {
      method: 'GET',
      url: '/api/plugins/p1/callback',
      handler: async () => ({ ok: true }),
      config: { auth: 'public' },
    });
    const res = await app.inject({ method: 'GET', url: '/api/plugins/p1/callback' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(authenticate).not.toHaveBeenCalled();
    await app.close();
  });

  it('revoking routes.public immediately re-secures public routes', async () => {
    let grants = ['routes.public'];
    const app = Fastify({ logger: false });
    const table = new PluginRouteTable();
    registerPluginRouteDispatcher(app, table, {
      authenticate,
      resolveUser,
      permissionsProvider: () => grants,
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    table.register('p1', {
      method: 'GET',
      url: '/api/plugins/p1/callback',
      handler: async () => ({ ok: true }),
      config: { auth: 'public' },
    });

    const anon = await app.inject({ method: 'GET', url: '/api/plugins/p1/callback' });
    expect(anon.statusCode).toBe(200);

    grants = []; // admin revoked
    const denied = await app.inject({ method: 'GET', url: '/api/plugins/p1/callback' });
    expect(denied.statusCode).toBe(401);
    await app.close();
  });

  it('optional routes attach request.user for session bearers and stay anonymous otherwise', async () => {
    const { app, table } = await build(['routes.public']);
    table.register('p1', {
      method: 'GET',
      url: '/api/plugins/p1/authorize',
      handler: async (req) => ({ userId: (req as any).user?.userId ?? null }),
      config: { auth: 'optional' },
    });
    const anon = await app.inject({ method: 'GET', url: '/api/plugins/p1/authorize' });
    expect(anon.statusCode).toBe(200);
    expect(anon.json()).toEqual({ userId: null });

    const authed = await app.inject({
      method: 'GET',
      url: '/api/plugins/p1/authorize',
      headers: { authorization: 'Bearer x' },
    });
    expect(authed.json()).toEqual({ userId: 'u_opt' });
    await app.close();
  });

  it('unmatched routes still 401 before 404 for anonymous callers', async () => {
    const { app, table } = await build(['routes.public']);
    table.register('p1', {
      method: 'GET',
      url: '/api/plugins/p1/known',
      handler: async () => ({ ok: true }),
    });
    const res = await app.inject({ method: 'GET', url: '/api/plugins/p1/unknown' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
