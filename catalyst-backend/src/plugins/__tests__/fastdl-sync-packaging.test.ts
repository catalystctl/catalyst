/**
 * Smoke test: fastdl-sync plugin manifest validates and backend entry loads
 * with a mock context (routes register, cron helpers work).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const PLUGIN_DIR = join(__dirname, '../../../../catalyst-plugins/fastdl-sync');

describe('fastdl-sync plugin packaging', () => {
  it('manifest passes the host validator', async () => {
    const { validateManifest } = await import('../validator.js');
    const manifest = JSON.parse(readFileSync(join(PLUGIN_DIR, 'plugin.json'), 'utf-8'));
    // validateManifest throws on invalid manifests and returns the parsed form
    const parsed = validateManifest(manifest);
    expect(parsed.name).toBe('fastdl-sync');
  });

  it('manifest declares fileTunnel-required permissions', () => {
    const manifest = JSON.parse(readFileSync(join(PLUGIN_DIR, 'plugin.json'), 'utf-8'));
    for (const p of ['server.read', 'server.write']) {
      expect(manifest.permissions).toContain(p);
    }
    expect(manifest.backend?.entry).toBe('backend/index.js');
    expect(manifest.frontend?.entry).toBe('frontend/index.ts');
  });

  it('backend entry loads and registers routes with a mock context', async () => {
    const mod = await import(pathToFileURL(join(PLUGIN_DIR, 'backend/index.js')).href);
    const backend = mod.default;
    expect(typeof backend.onLoad).toBe('function');
    expect(typeof backend.onEnable).toBe('function');

    const routes: Array<{ method: string; url: string }> = [];
    const logs: string[] = [];
    const ctx = {
      logger: {
        info: (o, m) => logs.push(m ?? o),
        warn: () => {},
        error: () => {},
        child: () => ctx.logger,
      },
      getConfig: (k) => undefined,
      requirePermission: () => undefined,
      registerRoute: (r) => routes.push(r),
      collection: () => ({
        find: async () => [],
        findOne: async () => null,
        insert: async () => ({}),
        update: async () => ({}),
        delete: async () => ({}),
        deleteMany: async () => ({}),
      }),
      fileTunnel: undefined,
    };

    await backend.onLoad(ctx);
    const urls = routes.map((r) => `${r.method} ${r.url}`);
    expect(urls).toContain('GET /pairings');
    expect(urls).toContain('GET /candidates');
    expect(urls).toContain('POST /pairings');
    expect(urls).toContain('DELETE /pairings/:id');
    expect(urls).toContain('POST /pairings/:id/sync');
    expect(urls).toContain('GET /pairings/:id/log');

    // onEnable with syncEnabled default true but invalid cron -> warn, no crash
    await backend.onEnable(ctx);
    backend.disableCron();
  });
});
