import { describe, it, expect, vi, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { Logger } from 'pino';
import { createPluginContext } from '../context';
import { PluginRouteTable, registerPluginRouteDispatcher } from '../route-table';

/**
 * B3-9 contract: routes declaring `config.requiredPermissions` are
 * host-enforced per-caller — the dispatcher 403s authenticated callers whose
 * panel permissions do not satisfy at least one declared permission. Routes
 * declaring nothing keep the legacy "any authenticated caller" behaviour.
 */

function makeLogger(): Logger {
  return {
    child: () => makeLogger(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
}

function makePrisma() {
  return {
    plugin: { findUnique: vi.fn(), update: vi.fn(), upsert: vi.fn() },
    pluginStorage: { findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn() },
    pluginActionAudit: { create: vi.fn() },
  } as any;
}

const authenticate = vi.fn(async (req: any, reply: any) => {
  if (!req.headers.authorization) {
    reply.status(401).send({ success: false, error: 'Unauthorized' });
    return;
  }
  // Caller permissions are driven by the X-Perms header (comma-separated),
  // so each test can model a different caller without rewriting the hook.
  const raw = String(req.headers['x-perms'] ?? '');
  req.user = {
    userId: 'u_caller',
    permissions: raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [],
  };
});

afterEach(() => {
  authenticate.mockClear();
});

async function build(grants: string[]) {
  const app = Fastify({ logger: false });
  const table = new PluginRouteTable();
  registerPluginRouteDispatcher(app, table, {
    authenticate,
    permissionsProvider: () => grants,
  });

  // Build a plugin context that registers routes into `routes[]` the same
  // way a real plugin does; the host loader then moves them into the table.
  const routes: any[] = [];
  const ctx = createPluginContext(
    {
      name: 'authz-plugin',
      version: '1.0.0',
      displayName: 'Authz',
      description: '',
      author: '',
      catalystVersion: '>=1.0.0',
      permissions: [...grants],
    },
    undefined,
    makePrisma(),
    makeLogger(),
    {} as any,
    routes,
    [],
    new Map(),
    new Map(),
    new Map(),
    { emit: vi.fn(), on: vi.fn() } as any,
    undefined,
    undefined,
    () => grants,
    undefined,
  );

  function register(handlerRoutes: Array<{ method: string; url: string; handler: any; config?: any }>) {
    for (const r of handlerRoutes) {
      ctx.registerRoute(r);
    }
    // Move registered routes into the dispatcher table (mirrors the loader).
    for (const r of routes) {
      table.register('authz-plugin', r);
    }
  }

  await app.listen({ port: 0, host: '127.0.0.1' });
  return { app, register };
}

const authed = (perms: string[]) => ({
  authorization: 'Bearer x',
  'x-perms': perms.join(','),
});

describe('registerPluginRouteDispatcher per-caller authorization (B3-9)', () => {
  it('403s a caller lacking the declared permission, 200s a caller who holds it', async () => {
    // Plugin must hold admin.write itself so the route declaration does not
    // trip the registration warning (the gate we are testing here is the
    // per-caller check, not the plugin grant sanity warning).
    const { app, register } = await build(['admin.write']);
    register([
      {
        method: 'GET',
        url: '/admin-only',
        handler: async () => ({ ok: true }),
        config: { requiredPermissions: ['admin.write'] },
      },
    ]);

    const denied = await app.inject({
      method: 'GET',
      url: '/api/plugins/authz-plugin/admin-only',
      headers: authed(['server.read']),
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toEqual({ success: false, code: 'PLUGIN_ROUTE_FORBIDDEN', error: 'Permission denied' });

    const allowed = await app.inject({
      method: 'GET',
      url: '/api/plugins/authz-plugin/admin-only',
      headers: authed(['admin.write']),
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toEqual({ ok: true });
    await app.close();
  });

  it('a route declaring nothing admits any authenticated caller (backward compat)', async () => {
    const { app, register } = await build([]);
    register([
      {
        method: 'GET',
        url: '/open',
        handler: async () => ({ ok: true }),
      },
    ]);
    const res = await app.inject({
      method: 'GET',
      url: '/api/plugins/authz-plugin/open',
      headers: authed([]),
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('a public route is not permission-checked', async () => {
    const { app, register } = await build(['routes.public']);
    register([
      {
        method: 'GET',
        url: '/callback',
        handler: async () => ({ ok: true }),
        config: { auth: 'public', requiredPermissions: ['admin.write'] },
      },
    ]);
    // Anonymous caller (no auth header) still reaches the handler — public
    // routes skip authentication AND the per-caller permission check.
    const res = await app.inject({ method: 'GET', url: '/api/plugins/authz-plugin/callback' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });

  it("`*` satisfies a files.write requirement per hasGrant semantics", async () => {
    const { app, register } = await build(['files.write']);
    register([
      {
        method: 'POST',
        url: '/upload',
        handler: async () => ({ ok: true }),
        config: { requiredPermissions: ['files.write'] },
      },
    ]);
    const wildcardCaller = await app.inject({
      method: 'POST',
      url: '/api/plugins/authz-plugin/upload',
      headers: authed(['*']),
    });
    expect(wildcardCaller.statusCode).toBe(200);

    const adminWriteCaller = await app.inject({
      method: 'POST',
      url: '/api/plugins/authz-plugin/upload',
      headers: authed(['admin.write']),
    });
    expect(adminWriteCaller.statusCode).toBe(200);
    await app.close();
  });

  it('401s unauthenticated callers before the permission check (required routes)', async () => {
    const { app, register } = await build(['admin.write']);
    register([
      {
        method: 'GET',
        url: '/admin-only',
        handler: async () => ({ ok: true }),
        config: { requiredPermissions: ['admin.write'] },
      },
    ]);
    const res = await app.inject({ method: 'GET', url: '/api/plugins/authz-plugin/admin-only' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
