/**
 * Tests for marketplace source configuration and update detection.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addMarketplaceSource,
  browseMarketplaces,
  clearMarketplaceCache,
  getEffectiveMarketplaceUrls,
  getMarketplaceIndexUrls,
  isOfficialMarketplaceDisabled,
  listMarketplaceSources,
  normalizeMarketplaceUrl,
  OFFICIAL_MARKETPLACE_INDEX_URL,
  annotateMarketplaceEntries,
  isPluginUpdateAvailable,
  type MarketplaceEntry,
} from '../marketplace/service';

const ENV_KEY = 'PLUGIN_MARKETPLACE_URLS';
const DISABLE_KEY = 'PLUGIN_MARKETPLACE_DISABLE_OFFICIAL';
const original = process.env[ENV_KEY];
const originalDisable = process.env[DISABLE_KEY];

beforeEach(() => {
  clearMarketplaceCache();
  vi.unstubAllGlobals();
});

afterEach(() => {
  if (original === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = original;
  if (originalDisable === undefined) delete process.env[DISABLE_KEY];
  else process.env[DISABLE_KEY] = originalDisable;
  vi.unstubAllGlobals();
});

describe('getMarketplaceIndexUrls', () => {
  it('defaults to the official catalyst-plugins index when unset', () => {
    delete process.env[ENV_KEY];
    delete process.env[DISABLE_KEY];
    expect(getMarketplaceIndexUrls()).toEqual([OFFICIAL_MARKETPLACE_INDEX_URL]);
    expect(OFFICIAL_MARKETPLACE_INDEX_URL).toContain('catalystctl/catalyst-plugins');
  });

  it('browses custom sources together with the official index', () => {
    delete process.env[DISABLE_KEY];
    process.env[ENV_KEY] = 'https://example.com/idx.json, https://other.example/idx.json';
    expect(getMarketplaceIndexUrls()).toEqual([
      OFFICIAL_MARKETPLACE_INDEX_URL,
      'https://example.com/idx.json',
      'https://other.example/idx.json',
    ]);
  });

  it('dedupes repeated sources and the official URL', () => {
    delete process.env[DISABLE_KEY];
    process.env[ENV_KEY] = `https://example.com/idx.json, https://example.com/idx.json, ${OFFICIAL_MARKETPLACE_INDEX_URL}`;
    expect(getMarketplaceIndexUrls()).toEqual([
      OFFICIAL_MARKETPLACE_INDEX_URL,
      'https://example.com/idx.json',
    ]);
  });

  it('returns only custom sources when the official index is disabled', () => {
    process.env[ENV_KEY] = 'https://example.com/idx.json';
    process.env[DISABLE_KEY] = 'true';
    expect(isOfficialMarketplaceDisabled()).toBe(true);
    expect(getMarketplaceIndexUrls()).toEqual(['https://example.com/idx.json']);
  });

  it('returns no sources when disabled with nothing configured', () => {
    delete process.env[ENV_KEY];
    process.env[DISABLE_KEY] = '1';
    expect(getMarketplaceIndexUrls()).toEqual([]);
  });
});

describe('isPluginUpdateAvailable', () => {
  it('detects a newer marketplace patch as an update', () => {
    expect(isPluginUpdateAvailable('1.0.0', '1.0.1')).toBe(true);
  });

  it('is false when versions match', () => {
    expect(isPluginUpdateAvailable('1.0.1', '1.0.1')).toBe(false);
  });

  it('is false when the installed copy is already newer', () => {
    expect(isPluginUpdateAvailable('1.1.0', '1.0.9')).toBe(false);
  });

  it('is false when either version is missing', () => {
    expect(isPluginUpdateAvailable(null, '1.0.1')).toBe(false);
    expect(isPluginUpdateAvailable('1.0.0', undefined)).toBe(false);
  });
});

describe('annotateMarketplaceEntries', () => {
  const entry = (over: Partial<MarketplaceEntry> = {}): MarketplaceEntry => ({
    name: 'fastdl-sync',
    version: '1.0.1',
    downloadUrl: 'https://example.com/fastdl-sync-1.0.1.catpkg.zip',
    ...over,
  });

  it('marks an older installed copy as updateAvailable', () => {
    const [annotated] = annotateMarketplaceEntries(
      [entry()],
      new Map([['fastdl-sync', '1.0.0']]),
    );
    expect(annotated.installed).toBe(true);
    expect(annotated.installedVersion).toBe('1.0.0');
    expect(annotated.updateAvailable).toBe(true);
  });

  it('does not flag an up-to-date install', () => {
    const [annotated] = annotateMarketplaceEntries(
      [entry()],
      new Map([['fastdl-sync', '1.0.1']]),
    );
    expect(annotated.installed).toBe(true);
    expect(annotated.updateAvailable).toBe(false);
  });

  it('leaves uninstalled plugins without an update flag', () => {
    const [annotated] = annotateMarketplaceEntries([entry()], new Map());
    expect(annotated.installed).toBe(false);
    expect(annotated.installedVersion).toBeNull();
    expect(annotated.updateAvailable).toBe(false);
  });
});

describe('browseMarketplaces', () => {
  const logger = { info: () => {}, warn: () => {}, error: () => {} };

  function mockIndexes(indexes: Record<string, unknown>) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (!(url in indexes)) throw new Error('network down');
        return {
          ok: true,
          json: async () => indexes[url],
        } as Response;
      }),
    );
  }

  it('merges entries from the official and custom sources together', async () => {
    delete process.env[DISABLE_KEY];
    process.env[ENV_KEY] = 'https://custom.example/index.json';
    mockIndexes({
      [OFFICIAL_MARKETPLACE_INDEX_URL]: {
        plugins: [
          { name: 'official-plugin', version: '1.0.0', downloadUrl: 'https://cdn.example/o.zip' },
        ],
      },
      'https://custom.example/index.json': {
        plugins: [
          { name: 'custom-plugin', version: '2.0.0', downloadUrl: 'https://cdn.example/c.zip' },
        ],
      },
    });

    const result = await browseMarketplaces(logger, { forceRefresh: true });
    expect(result.sources).toHaveLength(2);
    expect(result.sources.every((s) => s.ok)).toBe(true);
    expect(new Set(result.entries.map((e) => e.name))).toEqual(
      new Set(['official-plugin', 'custom-plugin']),
    );
    expect(result.entries.find((e) => e.name === 'custom-plugin')?.sourceUrl).toBe(
      'https://custom.example/index.json',
    );
  });

  it('prefers the newest version when several sources list the same plugin', async () => {
    delete process.env[DISABLE_KEY];
    process.env[ENV_KEY] = 'https://custom.example/index.json';
    mockIndexes({
      [OFFICIAL_MARKETPLACE_INDEX_URL]: {
        plugins: [
          { name: 'shared-plugin', version: '1.0.0', downloadUrl: 'https://cdn.example/old.zip' },
        ],
      },
      'https://custom.example/index.json': {
        plugins: [
          { name: 'shared-plugin', version: '1.2.0', downloadUrl: 'https://cdn.example/new.zip' },
        ],
      },
    });

    const result = await browseMarketplaces(logger, { forceRefresh: true });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].version).toBe('1.2.0');
    expect(result.entries[0].downloadUrl).toBe('https://cdn.example/new.zip');
  });

  it('still returns the healthy source when another marketplace fails', async () => {
    delete process.env[DISABLE_KEY];
    process.env[ENV_KEY] = 'https://broken.example/index.json, https://custom.example/index.json';
    mockIndexes({
      [OFFICIAL_MARKETPLACE_INDEX_URL]: {
        plugins: [
          { name: 'official-plugin', version: '1.0.0', downloadUrl: 'https://cdn.example/o.zip' },
        ],
      },
      'https://custom.example/index.json': {
        plugins: [
          { name: 'custom-plugin', version: '1.0.0', downloadUrl: 'https://cdn.example/c.zip' },
        ],
      },
    });

    const result = await browseMarketplaces(logger, { forceRefresh: true });
    expect(result.sources).toHaveLength(3);
    expect(result.sources.find((s) => s.url === 'https://broken.example/index.json')?.ok).toBe(false);
    expect(new Set(result.entries.map((e) => e.name))).toEqual(
      new Set(['official-plugin', 'custom-plugin']),
    );
  });
});

describe('normalizeMarketplaceUrl', () => {
  it('accepts http(s) URLs with surrounding whitespace trimmed', () => {
    expect(normalizeMarketplaceUrl('  https://example.com/index.json  ')).toBe(
      'https://example.com/index.json',
    );
  });

  it('rejects empty, non-URL, and non-http(s) input', () => {
    expect(() => normalizeMarketplaceUrl('')).toThrow('required');
    expect(() => normalizeMarketplaceUrl('not a url')).toThrow('valid http');
    expect(() => normalizeMarketplaceUrl('ftp://example.com/index.json')).toThrow('http:// or https://');
  });
});

describe('panel-managed marketplace sources', () => {
  const prisma = (overrides: Record<string, unknown> = {}) =>
    ({
      marketplaceSource: {
        findMany: vi.fn(async () => []),
        create: vi.fn(async ({ data }: any) => ({ id: 'src-1', ...data })),
        update: vi.fn(async ({ data }: any) => ({ id: 'src-1', url: 'https://custom.example/index.json', ...data })),
        delete: vi.fn(async () => ({ id: 'src-1', url: 'https://custom.example/index.json' })),
        ...overrides,
      },
    }) as any;

  it('merges enabled panel sources after env URLs', async () => {
    delete process.env[DISABLE_KEY];
    process.env[ENV_KEY] = 'https://env.example/index.json';
    const db = prisma({
      findMany: vi.fn(async () => [
        { url: 'https://panel.example/index.json' },
        { url: 'https://env.example/index.json' },
      ]),
    });
    expect(await getEffectiveMarketplaceUrls(db)).toEqual([
      OFFICIAL_MARKETPLACE_INDEX_URL,
      'https://env.example/index.json',
      'https://panel.example/index.json',
    ]);
  });

  it('lists official, env, and custom sources with editability', async () => {
    delete process.env[DISABLE_KEY];
    process.env[ENV_KEY] = 'https://env.example/index.json';
    const db = prisma({
      findMany: vi.fn(async () => [
        { id: 'src-1', url: 'https://panel.example/index.json', label: 'Team', enabled: false },
      ]),
    });
    const sources = await listMarketplaceSources(db);
    expect(sources.map((s) => s.origin)).toEqual(['official', 'env', 'custom']);
    expect(sources.find((s) => s.origin === 'official')).toMatchObject({
      id: 'official',
      removable: false,
      enabled: true,
    });
    expect(sources.find((s) => s.origin === 'custom')).toMatchObject({
      id: 'src-1',
      removable: true,
      enabled: false,
    });
  });

  it('refuses to add a marketplace that is already configured', async () => {
    delete process.env[DISABLE_KEY];
    process.env[ENV_KEY] = '';
    const db = prisma();
    await expect(
      addMarketplaceSource(db, OFFICIAL_MARKETPLACE_INDEX_URL, null, null),
    ).rejects.toThrow('already configured');
    expect(db.marketplaceSource.create).not.toHaveBeenCalled();
  });

  it('browses explicit panel URLs together', async () => {
    delete process.env[DISABLE_KEY];
    process.env[ENV_KEY] = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        json: async () => ({
          plugins: [{ name: `plugin-from-${new URL(url).host}`, version: '1.0.0', downloadUrl: 'https://cdn.example/p.zip' }],
        }),
      }) as Response),
    );
    const result = await browseMarketplaces(
      { info: () => {}, warn: () => {}, error: () => {} },
      {
        forceRefresh: true,
        urls: ['https://a.example/index.json', 'https://b.example/index.json'],
      },
    );
    expect(result.sources).toHaveLength(2);
    expect(result.entries).toHaveLength(2);
  });
});
