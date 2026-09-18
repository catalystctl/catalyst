import { describe, it, expect } from 'vitest';
import { PluginManifestSchema } from '../validator';

const baseManifest = {
  name: 'discord-oauth',
  version: '1.0.0',
  displayName: 'Discord OAuth',
  description: 'Discord sign-in with role sync',
  author: 'Someone',
  catalystVersion: '>=1.0.0',
  permissions: ['auth.sessions'],
};

describe('PluginManifestSchema authProviders', () => {
  it('accepts a well-formed provider declaration', () => {
    const result = PluginManifestSchema.parse({
      ...baseManifest,
      authProviders: [{ id: 'discord', label: 'Discord', authorizePath: 'authorize' }],
    });
    expect(result.authProviders).toEqual([
      { id: 'discord', label: 'Discord', authorizePath: 'authorize' },
    ]);
  });

  it('rejects providers missing id or label', () => {
    expect(() =>
      PluginManifestSchema.parse({ ...baseManifest, authProviders: [{ id: 'discord' }] }),
    ).toThrow();
    expect(() =>
      PluginManifestSchema.parse({ ...baseManifest, authProviders: [{ label: 'Discord' }] }),
    ).toThrow();
  });

  it('rejects authorize paths with traversal characters', () => {
    expect(() =>
      PluginManifestSchema.parse({
        ...baseManifest,
        authProviders: [{ id: 'x', label: 'X', authorizePath: '../escape' }],
      }),
    ).toThrow();
  });

  it('caps the number of providers per plugin', () => {
    const providers = Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, label: `P${i}` }));
    expect(() => PluginManifestSchema.parse({ ...baseManifest, authProviders: providers })).toThrow();
  });
});
