/**
 * Plugin UI visibility (server-header-stats era).
 *
 * A plugin decides who sees its UI through `requiredPermissions` on its tabs,
 * pages and slot components — which the panel can only evaluate if every
 * signed-in user bootstraps the plugin store. These tests pin the two ends of
 * that contract:
 *  - GET /api/plugins: admins get the full inventory; everyone else gets a
 *    reduced, frontend-only list (no consent, capability or config data).
 *  - GET /plugins-assets/:name/:filename: a signed-in non-admin may fetch the
 *    browser bundle of an enabled plugin (or nothing would render), but not a
 *    sourcemap, and not from a disabled or backend-only plugin.
 */

import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pluginRoutes } from '../../routes/plugins.js';

const pluginsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-visibility-'));

function entry(overrides: Record<string, any>) {
  return {
    status: 'enabled',
    routes: [],
    tasks: new Map(),
    wsHandlers: new Map(),
    loadedAt: new Date().toISOString(),
    enabledAt: new Date().toISOString(),
    manifest: {
      name: 'sample',
      version: '1.0.0',
      displayName: 'Sample',
      description: 'Sample plugin',
      author: 'Tests',
      catalystVersion: '>=1.0.0',
      permissions: [],
      ...overrides.manifest,
    },
    ...overrides,
  };
}

const registryEntries = [
  entry({ manifest: { name: 'ui-plugin', displayName: 'UI Plugin' }, status: 'enabled' }),
  entry({ manifest: { name: 'headless', displayName: 'Headless' }, status: 'enabled' }),
  entry({ manifest: { name: 'off', displayName: 'Off' }, status: 'disabled' }),
];

// Only the two frontend-shipping plugins are addressable by the panel.
registryEntries[0].manifest.frontend = { entry: 'frontend/index.ts' };
registryEntries[2].manifest.frontend = { entry: 'frontend/index.ts' };

const pluginLoader = {
  getPluginsDir: () => pluginsDir,
  discoverSingle: async () => {},
  getRegistry: () => ({
    getAll: () => registryEntries,
    get: (name: string) => registryEntries.find((p) => p.manifest.name === name) ?? null,
  }),
};

const prisma = {
  plugin: { findMany: async () => [] },
  pluginActionAudit: { create: async () => ({}) },
};

let currentUser: { id: string; permissions: string[] } = { id: 'u1', permissions: [] };

async function buildApp() {
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async (request: any) => {
    request.user = currentUser;
  });
  await pluginRoutes(app as any, pluginLoader as any, prisma as any);
  await app.ready();
  return app;
}

let app: any;

beforeAll(async () => {
  for (const name of ['ui-plugin', 'off', 'headless']) {
    fs.mkdirSync(path.join(pluginsDir, name, 'frontend'), { recursive: true });
    fs.writeFileSync(path.join(pluginsDir, name, 'frontend', 'frontend.mjs'), 'export default {};');
    fs.writeFileSync(path.join(pluginsDir, name, 'frontend', 'frontend.mjs.map'), '{}');
  }
  app = await buildApp();
});

afterAll(async () => {
  await app?.close();
  fs.rmSync(pluginsDir, { recursive: true, force: true });
});

describe('GET /api/plugins — reduced inventory for non-admins', () => {
  it('lists only enabled frontend plugins, without admin-only fields', async () => {
    currentUser = { id: 'u1', permissions: ['server.view'] };
    const res = await app.inject({ method: 'GET', url: '/api/plugins' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.map((p: any) => p.name)).toEqual(['ui-plugin']);
    const listed = body.data[0];
    expect(listed.hasFrontend).toBe(true);
    expect(listed.enabled).toBe(true);
    // No consent, capability, licensing or config surface for non-admins.
    expect(listed.capabilityCounts).toBeUndefined();
    expect(listed.consentRequired).toBeUndefined();
    expect(listed.declaredPermissions).toBeUndefined();
    expect(listed.config).toBeUndefined();
  });

  it('gives admins the full inventory', async () => {
    currentUser = { id: 'admin', permissions: ['admin.read'] };
    const res = await app.inject({ method: 'GET', url: '/api/plugins' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.map((p: any) => p.name).sort()).toEqual(['headless', 'off', 'ui-plugin']);
    expect(body.data[0].capabilityCounts).toBeDefined();
    expect(body.data[0].consentRequired).toBeDefined();
  });
});

describe('GET /plugins-assets — plugin bundles for signed-in users', () => {
  it('serves the bundle of an enabled frontend plugin to a non-admin', async () => {
    currentUser = { id: 'u1', permissions: ['server.view'] };
    const res = await app.inject({ method: 'GET', url: '/plugins-assets/ui-plugin/frontend.mjs' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('export default');
  });

  it('refuses sourcemaps to non-admins but serves them to admins', async () => {
    currentUser = { id: 'u1', permissions: ['server.view'] };
    const denied = await app.inject({
      method: 'GET',
      url: '/plugins-assets/ui-plugin/frontend.mjs.map',
    });
    expect(denied.statusCode).toBe(403);

    currentUser = { id: 'admin', permissions: ['admin.read'] };
    const allowed = await app.inject({
      method: 'GET',
      url: '/plugins-assets/ui-plugin/frontend.mjs.map',
    });
    expect(allowed.statusCode).toBe(200);
  });

  it('hides disabled and backend-only plugins from non-admins', async () => {
    currentUser = { id: 'u1', permissions: ['server.view'] };
    const disabled = await app.inject({
      method: 'GET',
      url: '/plugins-assets/off/frontend.mjs',
    });
    expect(disabled.statusCode).toBe(404);

    const headless = await app.inject({
      method: 'GET',
      url: '/plugins-assets/headless/frontend.mjs',
    });
    expect(headless.statusCode).toBe(404);
  });

  it('still rejects traversal and non-allowlisted extensions', async () => {
    currentUser = { id: 'admin', permissions: ['admin.read'] };
    const traversal = await app.inject({
      method: 'GET',
      url: '/plugins-assets/ui-plugin/..%2F..%2Fpackage.json',
    });
    expect(traversal.statusCode).toBe(404);

    const oddExt = await app.inject({
      method: 'GET',
      url: '/plugins-assets/ui-plugin/notes.txt',
    });
    expect(oddExt.statusCode).toBe(404);
  });
});
