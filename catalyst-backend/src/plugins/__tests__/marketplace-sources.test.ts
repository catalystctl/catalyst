/**
 * Tests for marketplace source configuration.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { getMarketplaceIndexUrls, OFFICIAL_MARKETPLACE_INDEX_URL } from '../marketplace/service';

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
