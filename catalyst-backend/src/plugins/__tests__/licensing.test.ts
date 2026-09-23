import { describe, expect, it } from 'vitest';

import { PluginLicensingSchema, PluginManifestSchema, validateManifest } from '../validator';
import {
  hasEncryptedPayload,
  licensingCacheTtlHours,
  licensingContactHosts,
  summarizeLicensing,
  LICENSING_CACHE_TTL_HOURS,
} from '../licensing';

const baseManifest = {
  name: 'licensed-example',
  version: '1.0.0',
  displayName: 'Licensed Example',
  description: 'Reference client for vendor-owned license validation.',
  author: 'Catalyst Team',
  catalystVersion: '>=1.0.0',
};

describe('PluginLicensingSchema', () => {
  it('accepts a full declaration', () => {
    const parsed = PluginLicensingSchema.parse({
      licenseServer: 'https://licenses.vendor.example/v1/activate',
      buyUrl: 'https://vendor.example/buy',
      contact: ['licenses.vendor.example'],
      encrypted: true,
      failMode: 'closed',
      cacheTtlHours: 24,
    });
    expect(parsed.licenseServer).toContain('licenses.vendor.example');
    expect(parsed.encrypted).toBe(true);
  });

  it('accepts the loopback development exception', () => {
    expect(() =>
      PluginLicensingSchema.parse({ licenseServer: 'http://127.0.0.1:8787/v1/activate' }),
    ).not.toThrow();
    expect(() =>
      PluginLicensingSchema.parse({ licenseServer: 'http://localhost:8787/v1/activate' }),
    ).not.toThrow();
  });

  it('rejects cleartext http to non-loopback hosts', () => {
    expect(() =>
      PluginLicensingSchema.parse({ licenseServer: 'http://licenses.vendor.example/v1/activate' }),
    ).toThrow();
  });

  it('rejects a non-URL licenseServer', () => {
    expect(() => PluginLicensingSchema.parse({ licenseServer: 'not a url' })).toThrow();
  });

  it('rejects malformed contact hostnames and over-long lists', () => {
    expect(() =>
      PluginLicensingSchema.parse({
        licenseServer: 'https://a.example/x',
        contact: ['has spaces'],
      }),
    ).toThrow();
    expect(() =>
      PluginLicensingSchema.parse({
        licenseServer: 'https://a.example/x',
        contact: Array.from({ length: 9 }, (_, i) => `h${i}.example`),
      }),
    ).toThrow();
  });

  it('rejects out-of-range cacheTtlHours', () => {
    for (const cacheTtlHours of [0, -1, 8761, 1.5]) {
      expect(() =>
        PluginLicensingSchema.parse({ licenseServer: 'https://a.example/x', cacheTtlHours }),
      ).toThrow();
    }
  });
});

describe('PluginManifestSchema.licensing', () => {
  it('is optional and absent for unlicensed plugins', () => {
    const parsed = validateManifest({ ...baseManifest });
    expect(parsed.licensing).toBeUndefined();
  });

  it('validates the licensing block with the manifest', () => {
    const parsed = validateManifest({
      ...baseManifest,
      licensing: { licenseServer: 'https://licenses.vendor.example/v1/activate', encrypted: true },
    });
    expect(parsed.licensing?.encrypted).toBe(true);
  });

  it('still rejects a bad licenseServer inside the manifest', () => {
    expect(() =>
      PluginManifestSchema.parse({
        ...baseManifest,
        licensing: { licenseServer: 'ftp://nope' },
      }),
    ).toThrow();
  });
});

describe('summarizeLicensing', () => {
  it('returns null when no licensing block is declared', () => {
    expect(summarizeLicensing(undefined)).toBeNull();
    expect(summarizeLicensing(null)).toBeNull();
    expect(summarizeLicensing({} as never)).toBeNull();
  });

  it('derives contact hosts from licenseServer when not declared', () => {
    const disclosure = summarizeLicensing({
      licenseServer: 'https://licenses.vendor.example/v1/activate',
    });
    expect(disclosure?.contactHosts).toEqual(['licenses.vendor.example']);
  });

  it('prefers explicitly declared contact hosts', () => {
    const disclosure = summarizeLicensing({
      licenseServer: 'https://licenses.vendor.example/v1/activate',
      contact: ['a.example', 'b.example'],
    });
    expect(disclosure?.contactHosts).toEqual(['a.example', 'b.example']);
  });

  it('forces failMode closed when the payload is encrypted', () => {
    const disclosure = summarizeLicensing({
      licenseServer: 'https://licenses.vendor.example/v1/activate',
      encrypted: true,
      failMode: 'open',
    });
    // An encrypted plugin has nothing to fall open to — the key is required.
    expect(disclosure?.failMode).toBe('closed');
    expect(disclosure?.encrypted).toBe(true);
  });

  it('honours failMode open for non-encrypted plugins', () => {
    const disclosure = summarizeLicensing({
      licenseServer: 'https://licenses.vendor.example/v1/activate',
      failMode: 'open',
    });
    expect(disclosure?.failMode).toBe('open');
    expect(disclosure?.encrypted).toBe(false);
  });

  it('defaults cacheTtlHours to seven days', () => {
    const disclosure = summarizeLicensing({ licenseServer: 'https://a.example/x' });
    expect(disclosure?.cacheTtlHours).toBe(LICENSING_CACHE_TTL_HOURS);
    expect(LICENSING_CACHE_TTL_HOURS).toBe(168);
  });
});

describe('licensingContactHosts / licensingCacheTtlHours', () => {
  it('returns empty for nothing declared', () => {
    expect(licensingContactHosts(undefined)).toEqual([]);
    expect(licensingContactHosts(null)).toEqual([]);
  });

  it('falls back to empty when licenseServer is unparseable and no contact list', () => {
    expect(licensingContactHosts({ licenseServer: 'nope' })).toEqual([]);
  });

  it('caps contact lists', () => {
    const hosts = Array.from({ length: 8 }, (_, i) => `h${i}.example`);
    expect(licensingContactHosts({ licenseServer: 'https://a.example', contact: hosts })).toHaveLength(8);
  });

  it('rejects invalid ttl values', () => {
    expect(licensingCacheTtlHours({ cacheTtlHours: 0 })).toBe(LICENSING_CACHE_TTL_HOURS);
    expect(licensingCacheTtlHours({ cacheTtlHours: 24 })).toBe(24);
  });
});

describe('hasEncryptedPayload', () => {
  it('detects a .enc payload in backend/', () => {
    expect(hasEncryptedPayload(['index.js', 'payload.enc'])).toBe(true);
  });

  it('rejects a package with no payload', () => {
    expect(hasEncryptedPayload(['index.js', 'helpers.js'])).toBe(false);
    expect(hasEncryptedPayload([])).toBe(false);
  });

  it('ignores dotfiles and accepts nested basenames', () => {
    expect(hasEncryptedPayload(['.hidden.enc'])).toBe(false);
    expect(hasEncryptedPayload(['sub/payload.enc'])).toBe(true);
  });

  it('does not match a .enc suffix in the middle of a name', () => {
    expect(hasEncryptedPayload(['payload.enc.js'])).toBe(false);
  });
});
