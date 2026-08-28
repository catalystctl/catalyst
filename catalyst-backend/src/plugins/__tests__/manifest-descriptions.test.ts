import { describe, it, expect } from 'vitest';
import { PluginManifestSchema } from '../validator';
import { resolveCapabilitySummaries } from '../safety';

const baseManifest = {
  name: 'test-plugin',
  version: '1.0.0',
  displayName: 'Test Plugin',
  description: 'A test',
  author: 'Someone',
  catalystVersion: '>=1.0.0',
  permissions: ['server.read'],
};

describe('PluginManifestSchema permissionDescriptions', () => {
  it('accepts descriptions scoped to declared permissions', () => {
    const result = PluginManifestSchema.parse({
      ...baseManifest,
      permissionDescriptions: { 'server.read': 'Read server names for its leaderboard' },
    });
    expect(result.permissionDescriptions).toEqual({
      'server.read': 'Read server names for its leaderboard',
    });
  });

  it('rejects descriptions referencing undeclared permissions (typo guard)', () => {
    expect(() =>
      PluginManifestSchema.parse({
        ...baseManifest,
        permissionDescriptions: { 'servers.read': 'typo scope' },
      }),
    ).toThrow(/is not declared/);
  });

  it('rejects empty or oversized descriptions', () => {
    expect(() =>
      PluginManifestSchema.parse({
        ...baseManifest,
        permissionDescriptions: { 'server.read': '' },
      }),
    ).toThrow();
    expect(() =>
      PluginManifestSchema.parse({
        ...baseManifest,
        permissionDescriptions: { 'server.read': 'x'.repeat(201) },
      }),
    ).toThrow();
  });

  it('valid even without the field', () => {
    const result = PluginManifestSchema.parse(baseManifest);
    expect(result.permissions).toEqual(['server.read']);
  });
});

describe('resolveCapabilitySummaries', () => {
  it('uses builtin copy for known scopes', () => {
    const [summary] = resolveCapabilitySummaries(['server.read']);
    expect(summary.source).toBe('builtin');
    expect(summary.label).toBe('Read servers');
  });

  it('plugin-provided description overrides builtin copy', () => {
    const [summary] = resolveCapabilitySummaries(['server.read'], {
      'server.read': 'Only reads server names, nothing else',
    });
    expect(summary.source).toBe('plugin');
    expect(summary.description).toBe('Only reads server names, nothing else');
    // risk metadata still applies to unknown-token scopes
    expect(summary.riskLevel).toBe('medium');
  });

  it('falls back gracefully for unknown scopes with humanized labels', () => {
    const [summary] = resolveCapabilitySummaries(['tickets.read']);
    expect(summary.source).toBe('fallback');
    expect(summary.label).toBe('Tickets read');
    expect(summary.description).toBeTruthy();
  });

  it('descriptions survive for every declared token and keep order', () => {
    const summaries = resolveCapabilitySummaries(
      ['server.write', 'tickets.read'],
      { 'tickets.read': 'List tickets' },
    );
    expect(summaries.map((s) => s.token)).toEqual(['server.write', 'tickets.read']);
    expect(summaries[0].source).toBe('builtin');
    expect(summaries[1].source).toBe('plugin');
  });

  it('ignores non-string and blank plugin descriptions', () => {
    const [summary] = resolveCapabilitySummaries(['user.read'], {
      'user.read': '   ',
      // @ts-expect-error deliberately invalid input shape
      bogus: 42,
    });
    expect(summary.source).toBe('builtin');
  });
});
