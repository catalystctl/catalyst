import { describe, it, expect, afterAll } from 'vitest';
import Fastify from 'fastify';
import {
  matchRoutePath,
  PluginRouteTable,
  registerPluginRouteDispatcher,
} from '../route-table';

describe('matchRoutePath', () => {
  it('matches static and :param segments', () => {
    expect(matchRoutePath('/api/plugins/fastdl-sync/pairings', '/api/plugins/fastdl-sync/pairings')).toEqual({});
    expect(matchRoutePath('/api/plugins/fastdl-sync/pairings/:id', '/api/plugins/fastdl-sync/pairings/abc')).toEqual({
      id: 'abc',
    });
    expect(matchRoutePath('/pairings/:id/sync', '/pairings/xyz/sync')).toEqual({ id: 'xyz' });
  });

  it('rejects length or segment mismatches', () => {
    expect(matchRoutePath('/pairings/:id', '/pairings')).toBeNull();
    expect(matchRoutePath('/pairings/list', '/pairings/other')).toBeNull();
  });
});

describe('PluginRouteTable', () => {
  it('matches method + path and ignores other plugins', () => {
    const table = new PluginRouteTable();
    table.register('fastdl-sync', {
      method: 'GET',
      url: '/api/plugins/fastdl-sync/pairings/:id',
      handler: async () => ({ ok: true }),
    });
    const hit = table.match('fastdl-sync', 'GET', '/api/plugins/fastdl-sync/pairings/p1');
    expect(hit?.params).toEqual({ id: 'p1' });
    expect(table.match('other', 'GET', '/api/plugins/fastdl-sync/pairings/p1')).toBeNull();
    expect(table.match('fastdl-sync', 'POST', '/api/plugins/fastdl-sync/pairings/p1')).toBeNull();
  });

  it('drops handlers on removePlugin', () => {
    const table = new PluginRouteTable();
    table.register('x', { method: 'GET', url: '/api/plugins/x/a', handler: async () => ({}) });
    table.removePlugin('x');
    expect(table.match('x', 'GET', '/api/plugins/x/a')).toBeNull();
  });
});

describe('registerPluginRouteDispatcher', () => {
  const app = Fastify({ logger: false });
  const table = new PluginRouteTable();
  // Host admin routes must remain more specific than the catch-all.
  app.post('/api/plugins/:name/enable', async () => ({ host: true }));
  registerPluginRouteDispatcher(app, table);

  afterAll(async () => {
    await app.close();
  });

  it('forwards to handlers registered after listen()', async () => {
    await app.listen({ port: 0, host: '127.0.0.1' });

    table.register('fastdl-sync', {
      method: 'GET',
      url: '/api/plugins/fastdl-sync/pairings/:id',
      handler: async (request) => ({
        success: true,
        id: (request.params as { id: string }).id,
      }),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/plugins/fastdl-sync/pairings/pair_1',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, id: 'pair_1' });
  });

  it('returns 404 for unknown plugin routes', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/plugins/fastdl-sync/nope',
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('Plugin route not found');
  });

  it('does not steal host plugin-admin routes', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/plugins/fastdl-sync/enable',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ host: true });
  });
});
