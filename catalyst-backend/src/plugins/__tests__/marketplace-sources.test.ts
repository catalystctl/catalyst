/**
 * Tests for marketplace source configuration and update detection.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  getMarketplaceIndexUrls,
  OFFICIAL_MARKETPLACE_INDEX_URL,
  annotateMarketplaceEntries,
  isPluginUpdateAvailable,
  type MarketplaceEntry,
} from '../marketplace/service';

const ENV_KEY = 'PLUGIN_MARKETPLACE_URLS';
const original = process.env[ENV_KEY];

afterEach(() => {
  if (original === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = original;
});

describe('getMarketplaceIndexUrls', () => {
  it('defaults to the official catalyst-plugins index when unset', () => {
    delete process.env[ENV_KEY];
    expect(getMarketplaceIndexUrls()).toEqual([OFFICIAL_MARKETPLACE_INDEX_URL]);
    expect(OFFICIAL_MARKETPLACE_INDEX_URL).toContain('catalystctl/catalyst-plugins');
  });

  it('returns only configured sources when set', () => {
    process.env[ENV_KEY] = 'https://example.com/idx.json, https://other.example/idx.json';
    expect(getMarketplaceIndexUrls()).toEqual([
      'https://example.com/idx.json',
      'https://other.example/idx.json',
    ]);
  });

  it('does not append the official source when custom sources are configured', () => {
    process.env[ENV_KEY] = 'https://example.com/idx.json';
    expect(getMarketplaceIndexUrls()).not.toContain(OFFICIAL_MARKETPLACE_INDEX_URL);
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
