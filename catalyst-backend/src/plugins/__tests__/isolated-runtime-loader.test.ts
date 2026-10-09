import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PluginLoader } from '../loader';

const dirs: string[] = [];

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    name: 'test-plugin',
    version: '1.0.0',
    displayName: 'Test plugin',
    description: 'Test plugin',
    author: 'Tests',
    catalystVersion: '>=1.0.0',
    permissions: [],
    ...overrides,
  };
}

function dependencies() {
  return {
    plugin: {
      findUnique: async () => null,
      upsert: async () => ({}),
      update: async () => ({}),
    },
    panelIdentity: {
      findUnique: async () => ({ installId: 'inst_test' }),
      create: async () => ({}),
    },
    systemError: {
      create: async () => ({}),
    },
  } as any;
}

function loader(pluginsDir: string, prisma = dependencies()) {
  return new PluginLoader(
    pluginsDir,
    prisma,
    pino({ level: 'silent' }),
    {} as any,
    { authenticate: vi.fn() } as any,
    { hotReload: false },
  );
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('PluginLoader runtime isolation', () => {
  it('rejects isolated plugins before importing backend code', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'catalyst-isolated-loader-'));
    dirs.push(root);
    const pluginDir = path.join(root, 'test-plugin');
    await mkdir(pluginDir);
    const marker = path.join(root, 'imported');
    await writeFile(path.join(pluginDir, 'plugin.json'), JSON.stringify(manifest({
      runtime: 'isolated',
      backend: { entry: 'backend.mjs' },
    })));
    await writeFile(path.join(pluginDir, 'backend.mjs'), `await import('node:fs/promises').then(({ writeFile }) => writeFile(${JSON.stringify(marker)}, 'imported'))`);

    const instance = loader(root);
    await instance.loadPlugin(pluginDir);

    await expect(import('node:fs/promises').then(({ access }) => access(marker))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((instance as any).registry.get('test-plugin').status).toBe('error');
    expect((instance as any).registry.get('test-plugin').error.message).toContain('isolated plugin execution is unavailable');
  });

  it('continues to load legacy backend plugins in process', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'catalyst-legacy-loader-'));
    dirs.push(root);
    const pluginDir = path.join(root, 'test-plugin');
    await mkdir(pluginDir);
    const marker = path.join(root, 'loaded');
    await writeFile(path.join(pluginDir, 'plugin.json'), JSON.stringify(manifest({
      runtime: 'legacy',
      backend: { entry: 'backend.mjs' },
    })));
    await writeFile(path.join(pluginDir, 'backend.mjs'), `export default { onLoad: async () => { await import('node:fs/promises').then(({ writeFile }) => writeFile(${JSON.stringify(marker)}, 'loaded')); } }`);

    const instance = loader(root);
    await instance.loadPlugin(pluginDir);

    await expect(import('node:fs/promises').then(({ readFile }) => readFile(marker, 'utf8'))).resolves.toBe('loaded');
    expect((instance as any).registry.get('test-plugin').status).toBe('loaded');
  });
});
