import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PluginLoader } from '../loader';
import { DISCLAIMER_VERSION, PluginConsentRequiredError } from '../safety';
import type { LoadedPlugin } from '../types';

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

/** ESM backend module that writes marker files on lifecycle hooks. */
function backendModule(opts: { onLoad?: string; onEnable?: string }): string {
  const parts: string[] = [];
  if (opts.onLoad) {
    parts.push(
      `onLoad: async () => { await import('node:fs/promises').then(({ writeFile }) => writeFile(${JSON.stringify(opts.onLoad)}, 'x')); }`,
    );
  }
  if (opts.onEnable) {
    parts.push(
      `onEnable: async () => { await import('node:fs/promises').then(({ writeFile }) => writeFile(${JSON.stringify(opts.onEnable)}, 'x')); }`,
    );
  }
  return `export default { ${parts.join(', ')} };`;
}

function disabledRow(): Record<string, any> {
  return {
    enabled: false,
    version: '1.0.0',
    config: {},
    grantedPermissions: null,
    safetyAcceptedAt: null,
    safetyDisclaimerVersion: null,
    safetyAcceptedPluginVersion: null,
    safetyAcceptedPermissions: null,
  };
}

function consentedRow(): Record<string, any> {
  return {
    enabled: true,
    version: '1.0.0',
    config: {},
    grantedPermissions: null,
    safetyAcceptedAt: new Date(),
    safetyDisclaimerVersion: DISCLAIMER_VERSION,
    safetyAcceptedPluginVersion: '1.0.0',
    safetyAcceptedPermissions: [],
  };
}

/**
 * Mutable mock prisma. `findUnique` returns a live view of the row (so the
 * loader sees consent mutations applied between phases), and `update` applies
 * its `data` onto the row (so enable/disable/reload state changes stick).
 */
function makePrisma(initial: Record<string, any> | null) {
  const row: Record<string, any> | null = initial ? { ...initial } : null;
  const updateCalls: any[] = [];
  const prisma = {
    plugin: {
      findUnique: async (args?: any) => {
        if (row === null) return null;
        const select = args?.select;
        if (!select) return { ...row };
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(select)) out[k] = row[k] ?? null;
        return out;
      },
      upsert: async () => ({}),
      update: async (args: any) => {
        updateCalls.push(args?.data);
        if (row !== null) Object.assign(row, args?.data ?? {});
        return row ?? {};
      },
    },
    panelIdentity: {
      findUnique: async () => ({ installId: 'inst_test' }),
      create: async () => ({}),
    },
    systemError: {
      create: async () => ({}),
    },
  } as any;
  return { prisma, row, updateCalls };
}

function loader(pluginsDir: string, prisma: any) {
  return new PluginLoader(
    pluginsDir,
    prisma,
    pino({ level: 'silent' }),
    {} as any,
    { authenticate: vi.fn() } as any,
    { hotReload: false },
  );
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function pluginOf(instance: PluginLoader, name = 'test-plugin'): LoadedPlugin {
  const plugin = instance.getRegistry().get(name);
  if (!plugin) throw new Error(`plugin ${name} missing from registry`);
  return plugin;
}

/** Create the plugin dir + backend, build a loader over a mutable row, and load it. */
async function setupPlugin(
  root: string,
  initialRow: Record<string, any>,
  backendOpts: { onLoad?: string; onEnable?: string },
) {
  const pluginDir = path.join(root, 'test-plugin');
  await mkdir(pluginDir, { recursive: true });
  await writeFile(
    path.join(pluginDir, 'plugin.json'),
    JSON.stringify(manifest({ runtime: 'legacy', backend: { entry: 'backend.mjs' } })),
  );
  await writeFile(path.join(pluginDir, 'backend.mjs'), backendModule(backendOpts));
  const { prisma, row, updateCalls } = makePrisma(initialRow);
  const instance = loader(root, prisma);
  await instance.loadPlugin(pluginDir);
  return { instance, row, updateCalls, pluginDir };
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('PluginLoader consent lifecycle', () => {
  it('loads inert when never enabled/consented — no plugin code runs', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'catalyst-consent-t1-'));
    dirs.push(root);
    const loaded = path.join(root, 'loaded');
    const { instance } = await setupPlugin(root, disabledRow(), { onLoad: loaded });

    const plugin = pluginOf(instance);
    expect(await exists(loaded)).toBe(false);
    expect(plugin.status).toBe('disabled');
    expect(plugin.backend).toBeUndefined();
    expect(plugin.resolvedPath).toBeTruthy();
  });

  it('enable without consent throws and imports nothing', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'catalyst-consent-t2-'));
    dirs.push(root);
    const loaded = path.join(root, 'loaded');
    const { instance } = await setupPlugin(root, disabledRow(), { onLoad: loaded });

    let caught: unknown;
    try {
      await instance.enablePlugin('test-plugin');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PluginConsentRequiredError);
    expect((caught as PluginConsentRequiredError).reason).toBe('never_accepted');

    const plugin = pluginOf(instance);
    expect(await exists(loaded)).toBe(false);
    expect(plugin.backend).toBeUndefined();
    expect(plugin.status).toBe('disabled');
  });

  it('enable after consent activates: onLoad then onEnable', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'catalyst-consent-t3-'));
    dirs.push(root);
    const loaded = path.join(root, 'loaded');
    const enabled = path.join(root, 'enabled');
    const { instance, row, updateCalls } = await setupPlugin(root, disabledRow(), {
      onLoad: loaded,
      onEnable: enabled,
    });
    if (!row) throw new Error('test row missing');

    // Admin accepts the safety disclaimer now.
    Object.assign(row, {
      safetyAcceptedAt: new Date(),
      safetyDisclaimerVersion: DISCLAIMER_VERSION,
      safetyAcceptedPluginVersion: '1.0.0',
      safetyAcceptedPermissions: [],
    });

    await instance.enablePlugin('test-plugin');

    expect(await exists(loaded)).toBe(true);
    expect(await exists(enabled)).toBe(true);
    const plugin = pluginOf(instance);
    expect(plugin.status).toBe('enabled');
    expect(plugin.backend).toBeDefined();
    expect(updateCalls.some((d) => d?.enabled === true)).toBe(true);
  });

  it('reload with bumped version does not execute/re-enable and sets enabled=false', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'catalyst-consent-t4-'));
    dirs.push(root);
    const loaded = path.join(root, 'loaded');
    const enabled = path.join(root, 'enabled');
    const reloaded = path.join(root, 'reloaded');
    const { instance, row, pluginDir } = await setupPlugin(root, disabledRow(), {
      onLoad: loaded,
      onEnable: enabled,
    });
    if (!row) throw new Error('test row missing');

    // Consent + enable so the plugin is running at v1.0.0.
    Object.assign(row, {
      safetyAcceptedAt: new Date(),
      safetyDisclaimerVersion: DISCLAIMER_VERSION,
      safetyAcceptedPluginVersion: '1.0.0',
      safetyAcceptedPermissions: [],
    });
    await instance.enablePlugin('test-plugin');

    // Out-of-band update: bump version and rewrite onLoad to write a NEW
    // marker. The accepted snapshot still pins v1.0.0 → re-consent required.
    await writeFile(
      path.join(pluginDir, 'plugin.json'),
      JSON.stringify(manifest({ runtime: 'legacy', version: '2.0.0', backend: { entry: 'backend.mjs' } })),
    );
    await writeFile(path.join(pluginDir, 'backend.mjs'), backendModule({ onLoad: reloaded }));

    await instance.reloadPlugin('test-plugin');

    const plugin = pluginOf(instance);
    expect(await exists(reloaded)).toBe(false);
    expect(plugin.status).toBe('disabled');
    expect(row.enabled).toBe(false);
  });

  it('enabled+consented load activates at startup', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'catalyst-consent-t5-'));
    dirs.push(root);
    const loaded = path.join(root, 'loaded');
    const { instance } = await setupPlugin(root, consentedRow(), { onLoad: loaded });

    const plugin = pluginOf(instance);
    expect(await exists(loaded)).toBe(true);
    expect(plugin.status).toBe('loaded');
    expect(plugin.backend).toBeDefined();
  });

  it('marketplace install (discoverSingle) is inert', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'catalyst-consent-t6-'));
    dirs.push(root);
    const loaded = path.join(root, 'loaded');
    const pluginDir = path.join(root, 'test-plugin');
    await mkdir(pluginDir, { recursive: true });
    await writeFile(
      path.join(pluginDir, 'plugin.json'),
      JSON.stringify(manifest({ runtime: 'legacy', backend: { entry: 'backend.mjs' } })),
    );
    await writeFile(path.join(pluginDir, 'backend.mjs'), backendModule({ onLoad: loaded }));
    const { prisma } = makePrisma(null);
    const instance = loader(root, prisma);

    await instance.discoverSingle('test-plugin');

    const plugin = pluginOf(instance);
    expect(await exists(loaded)).toBe(false);
    expect(plugin.status).toBe('disabled');
    expect(plugin.backend).toBeUndefined();
  });

  it('grandfathered startup activates a previously-enabled plugin before backfill', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'catalyst-consent-t7-'));
    dirs.push(root);
    const loaded = path.join(root, 'loaded');
    // Enabled before the disclaimer feature existed: no acceptance recorded.
    const { instance } = await setupPlugin(
      root,
      { ...disabledRow(), enabled: true },
      { onLoad: loaded },
    );

    const plugin = pluginOf(instance);
    expect(await exists(loaded)).toBe(true);
    expect(plugin.status).toBe('loaded');
  });

  it('hot-reload at the same version re-enables without re-consent', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'catalyst-consent-t8-'));
    dirs.push(root);
    const loaded = path.join(root, 'loaded');
    const enabled = path.join(root, 'enabled');
    const reloaded = path.join(root, 'reloaded');
    const { instance, row, pluginDir } = await setupPlugin(root, consentedRow(), {
      onLoad: loaded,
      onEnable: enabled,
    });
    if (!row) throw new Error('test row missing');
    await instance.enablePlugin('test-plugin');

    // Same version, new code: consent is unchanged, so the reload applies it.
    await writeFile(path.join(pluginDir, 'backend.mjs'), backendModule({ onLoad: reloaded }));
    await instance.reloadPlugin('test-plugin');

    const plugin = pluginOf(instance);
    expect(await exists(reloaded)).toBe(true);
    expect(plugin.status).toBe('enabled');
    expect(row.enabled).toBe(true);
  });

  it('disable then enable keeps a single activation and route set', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'catalyst-consent-t9-'));
    dirs.push(root);
    const loaded = path.join(root, 'loaded');
    const enabled = path.join(root, 'enabled');
    const { instance, row } = await setupPlugin(root, consentedRow(), {
      onLoad: loaded,
      onEnable: enabled,
    });
    if (!row) throw new Error('test row missing');
    await instance.enablePlugin('test-plugin');
    const backendBefore = pluginOf(instance).backend;

    await instance.disablePlugin('test-plugin');
    expect(pluginOf(instance).status).toBe('disabled');

    await instance.enablePlugin('test-plugin');
    const plugin = pluginOf(instance);
    expect(plugin.status).toBe('enabled');
    // Re-enable must not re-import: same module instance, no second onLoad.
    expect(plugin.backend).toBe(backendBefore);
    expect(row.enabled).toBe(true);
  });

  it('enables a frontend-only plugin with no backend entry', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'catalyst-consent-t10-'));
    dirs.push(root);
    const pluginDir = path.join(root, 'test-plugin');
    await mkdir(pluginDir, { recursive: true });
    await writeFile(
      path.join(pluginDir, 'plugin.json'),
      JSON.stringify(manifest({ runtime: 'legacy' })),
    );
    const { prisma, row } = makePrisma(consentedRow());
    const instance = loader(root, prisma);
    await instance.loadPlugin(pluginDir);
    if (!row) throw new Error('test row missing');

    await instance.enablePlugin('test-plugin');

    const plugin = pluginOf(instance);
    expect(plugin.status).toBe('enabled');
    expect(plugin.backend).toBeUndefined();
    expect(row.enabled).toBe(true);
  });
});
